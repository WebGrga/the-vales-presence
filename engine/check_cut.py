"""The cut check: is the final still the cut you approved? Exit 0 only when every check passes; every line is plain words.

    python check_cut.py [video/out/final.mp4] [--video <video/>] [--words]

1. length   the final runs as long as the rough (rough.json) within 1 s, with the same size and fps.
2. locked   edl.json and rough.mp4 still hash to what rough.json says, and to the lock file (.presence/locks.json, when it exists).
3. voice    the voice in the final is the rough's voice, untouched and in step. Method: both audio tracks are decoded to 16 kHz mono and compared
            second by second (normalised correlation at the one global lag). Why this and not a transcript: the final's audio IS the rough's audio
            plus quiet sound effects, so a direct comparison proves the voice is identical where a speech recogniser only shows that two noisy
            guesses agree; it needs no GPU, no model, no tolerance for mishearing, and a dropped, shifted or doubled word shows up at once as a
            second where the correlation falls. Seconds where an effect plays are held to a looser bar (they add sound on purpose).
4. words    (only with --words) the same check the other way round: faster-whisper "small" on the final and on the rough with the same settings,
            the two word sequences compared word for word. Slow (about 2 minutes) and noisy on its own, so it backs the voice check up, not replaces it;
            the rough's transcript is cached by its sha256 in video/out/work/check/.
Writes video/out/check.json.
"""
import argparse
import difflib
import json
import os
import re
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sfx as sfxmod
import user_edits
from pipelib import Cut, PIPE, now_iso, probe, read_json, say, sha256_file, step, uv_script, write_json

SR = 16000


def audio(path):
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vn', '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True)
    if r.returncode:
        raise RuntimeError(f'cannot read the audio of {path}: {r.stderr[-300:].decode(errors="replace")}')
    return np.frombuffer(r.stdout, dtype=np.float32)


def global_lag(x, y, max_lag=SR // 2):
    """Lag (samples) at which y best matches x, from one FFT cross-correlation of the first 120 s; positive = y is later."""
    n = min(len(x), len(y), 120 * SR)
    a, b = x[:n], y[:n]
    size = 1 << int(np.ceil(np.log2(2 * n)))
    cc = np.fft.irfft(np.fft.rfft(b, size) * np.conj(np.fft.rfft(a, size)), size)
    cc = np.concatenate([cc[-max_lag:], cc[:max_lag + 1]])
    return int(np.argmax(cc)) - max_lag


def layer16(path):
    """The sound-effects layer (work/sfx.f32: raw float32, 48 kHz stereo) as 16 kHz mono, resampled the way the two audio tracks are."""
    r = subprocess.run(['ffmpeg', '-v', 'error', '-f', 'f32le', '-ar', '48000', '-ac', '2', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True)
    if r.returncode:
        raise RuntimeError(f'cannot read the effects layer {path}: {r.stderr[-300:].decode(errors="replace")}')
    return np.frombuffer(r.stdout, dtype=np.float32)


def voice_check(rough, final, cue_times, block=1.0, hard=0.9, soft=0.75, layer=None):
    """`layer` = the effects layer file the compose pass mixed in (and no limiter acted): it is taken off the final first, so a bed or an effect under a quiet
    voice cannot fail the comparison; what is compared is then the rough's voice against the final's, as the final's audio is exactly rough + layer."""
    x, y = audio(rough), audio(final)
    zl = None
    if layer:
        z = layer16(layer)
        n = min(len(y), len(z))
        y = y.copy()
        y[:n] -= z[:n]
        zl = z
        cue_times = []
    lag = global_lag(x, y)
    if lag > 0:
        y = y[lag:]
    elif lag < 0:
        x = x[-lag:]
    n = min(len(x), len(y))
    x, y = x[:n], y[:n]
    bl = int(block * SR)
    bad, worst, voiced = [], 1.0, 0
    cue = np.zeros(n // bl + 2, dtype=bool)
    for t in cue_times:
        for k in range(int(t), int(t + 2.5) + 1):
            if k < len(cue):
                cue[k] = True
    for i in range(n // bl):
        a, b = x[i * bl:(i + 1) * bl], y[i * bl:(i + 1) * bl]
        ea = float(np.sqrt(np.mean(a * a)))
        if ea < 10 ** (-45 / 20):        # no voice in the rough here
            continue
        voiced += 1
        c = float(np.dot(a, b) / (np.sqrt(np.dot(a, a) * np.dot(b, b)) + 1e-12))
        worst = min(worst, c)
        bar = soft if cue[i] else hard
        if zl is not None and len(zl) >= (i + 1) * bl and float(np.sqrt(np.mean(zl[i * bl:(i + 1) * bl] ** 2))) >= 0.8 * ea:
            bar = min(bar, 0.6)      # the music or an effect is as loud as the voice here: the AAC noise the removal leaves is then as big as the voice
        if c < bar:
            bad.append((i, round(c, 3)))
    return {'lag_ms': round(1000 * lag / SR, 2), 'voiced_seconds': voiced, 'worst_correlation': round(worst, 3), 'bad_seconds': bad,
            'seconds_compared': n // bl, 'final_samples': len(y) + max(lag, 0), 'rough_samples': len(x) + max(-lag, 0)}


def norm_words(path):
    out = []
    for line in open(path, encoding='utf-8'):
        p = line.rstrip('\n').split('\t')
        if len(p) >= 3:
            w = re.sub(r"[^a-z0-9']", '', p[2].lower())
            if w:
                out.append(w)
    return out


def words_check(cut, final, rj):
    d = os.path.join(cut.work, 'check')
    os.makedirs(d, exist_ok=True)
    rt = os.path.join(d, f"rough-{rj['rough_sha256'][:12]}-small.tsv")
    ft = os.path.join(d, 'final-small.tsv')
    if not os.path.isfile(rt):
        uv_script(os.path.join(PIPE, 'transcribe.py'), cut.rough, rt, '--model', 'small')
    uv_script(os.path.join(PIPE, 'transcribe.py'), final, ft, '--model', 'small')
    a, b = norm_words(rt), norm_words(ft)
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    diffs = [(op, ' '.join(a[i1:i2]), ' '.join(b[j1:j2])) for op, i1, i2, j1, j2 in sm.get_opcodes() if op != 'equal']
    return {'rough_words': len(a), 'final_words': len(b), 'ratio': round(sm.ratio(), 4), 'differences': diffs[:40]}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('final', nargs='?'); ap.add_argument('--video'); ap.add_argument('--words', action='store_true')
    a = ap.parse_args(argv)
    cut = Cut(a.video)
    final = a.final or cut.final
    problems, lines = [], []
    if not os.path.isfile(cut.rough_json):
        say(cut, 'FAILED: there is no rough.json: the rough cut was never handed over (run handover.py).')
        return 1
    if not os.path.isfile(final):
        say(cut, f'FAILED: there is no final at {final}.')
        return 1
    rj = read_json(cut.rough_json)
    res = {'checked': now_iso(), 'final': final}
    with step(cut, 'check-cut') as d:
        fi = probe(final)
        dd = fi['duration'] - rj['duration']
        res['length'] = {'rough': rj['duration'], 'final': round(fi['duration'], 3), 'diff': round(dd, 3)}
        if abs(dd) > 1.0:
            problems.append(f'LENGTH: the final runs {fi["duration"]:.2f} s but the approved rough runs {rj["duration"]:.2f} s ({dd:+.2f} s): visuals must not change the cut.')
        else:
            lines.append(f'length ok: final {fi["duration"]:.2f} s, rough {rj["duration"]:.2f} s ({dd:+.2f} s)')
        if fi.get('nb_frames') and rj.get('nb_frames') and abs(fi['nb_frames'] - rj['nb_frames']) > 8:      # a start offset of the rough's picture shows as a few repeated first frames
            problems.append(f'FRAMES: the final has {fi["nb_frames"]} picture frames, the rough {rj["nb_frames"]}: the compose pass lost or doubled frames (the container length alone would not show it).')
        if (fi['width'], fi['height']) != (rj['width'], rj['height']) or abs(fi['fps'] - rj['fps']) > 0.01:
            problems.append(f'SIZE: the final is {fi["width"]}x{fi["height"]} at {fi["fps"]:g} fps, the rough {rj["width"]}x{rj["height"]} at {rj["fps"]:g} fps.')
        # locked files
        sha = {'edl': sha256_file(cut.edl) if os.path.isfile(cut.edl) else None, 'rough': sha256_file(cut.rough) if os.path.isfile(cut.rough) else None}
        if sha['rough'] != rj['rough_sha256']:
            problems.append('LOCKED: rough.mp4 is not the file that was handed over (its sha256 differs from rough.json). The rough goes back to you for review, never fixed here.')
        if sha['edl'] != rj['edl_sha256']:
            problems.append('LOCKED: edl.json is not the one that was handed over (its sha256 differs from rough.json).')
        for lf in cut.lock_files:
            for rel, l in (read_json(lf).get('locks') or {}).items():
                f = os.path.join(cut.workshop, *rel.split('/'))
                if not os.path.isfile(f):
                    problems.append(f'LOCKED: {rel} is missing but you approved it.')
                elif (sha['rough'] if rel.endswith('rough.mp4') else sha['edl'] if rel.endswith('edl.json') else sha256_file(f)) != l['sha256']:
                    problems.append(f'LOCKED: {rel} differs from the file you approved ({os.path.basename(os.path.dirname(lf))}/locks.json).')
            lines.append(f'{os.path.basename(os.path.dirname(lf))}/locks.json checked')
        if not any(p.startswith('LOCKED') for p in problems):
            lines.append('locked files unchanged (rough.mp4, edl.json)')
        # voice
        doc = user_edits.load(cut) if os.path.isfile(cut.events) else None
        cues = [c['t'] for c in sfxmod.cues(doc)] if doc else []
        layer = None
        if doc and (cues or doc.get('bed')):
            info = sfxmod.build(cut, doc)         # remakes work/sfx.f32 the way compose.py mixed it
            layer = info['file'] if info['file'] and not info['limit'] else None     # a limiter that acted changed the voice too: the looser per-cue bar then
        v = voice_check(cut.rough, final, cues, layer=layer)
        res['layer_removed'] = bool(layer)
        res['voice'] = v
        if abs(v['lag_ms']) > 30:
            problems.append(f'VOICE: the final\'s sound is {v["lag_ms"]:+.1f} ms out of step with the rough.')
        if v['bad_seconds']:
            w = ', '.join(f'{int(s // 60)}:{s % 60:02d} ({c})' for s, c in v['bad_seconds'][:12])
            problems.append(f'VOICE: in {len(v["bad_seconds"])} of {v["voiced_seconds"]} spoken seconds the final\'s voice does not match the rough (second: correlation): {w}')
        else:
            lines.append(f'voice ok: all {v["voiced_seconds"]} spoken seconds match the rough (worst correlation {v["worst_correlation"]}, lag {v["lag_ms"]} ms)')
        if a.words:
            w = words_check(cut, final, rj)
            res['words'] = w
            if w['ratio'] < 0.985:
                problems.append(f'WORDS: the final\'s words differ from the rough\'s (match {w["ratio"]:.3f}); first differences: {w["differences"][:6]}')
            else:
                lines.append(f'words ok: {w["rough_words"]} rough words, {w["final_words"]} final words, match {w["ratio"]:.3f}, {len(w["differences"])} differences')
        res['passed'] = not problems
        res['problems'] = problems
        write_json(os.path.join(cut.out, 'check.json'), res)
        d['passed'] = res['passed']
    for l in lines:
        say(cut, l)
    for p in problems:
        say(cut, 'FAILED: ' + p)
    say(cut, 'CHECK PASSED' if not problems else f'CHECK FAILED: {len(problems)} problem(s)')
    return 0 if not problems else 1


if __name__ == '__main__':
    sys.exit(main())
