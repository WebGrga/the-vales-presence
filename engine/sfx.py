"""The sound-effects layer: every cue of events.json (the top-level "sfx" list and each event's "sfx") placed on a silent track as long as the rough.

    python sfx.py [--video <video/>]      writes video/out/work/sfx.f32 (raw float32, 48 kHz stereo) and prints the mix's peak

compose.py mixes this layer over the rough's own audio at fixed levels (each cue's "vol"); the voice is never re-levelled. The only limiter
is a safety one, used when the summed peak would clip. A cue is {"t": seconds, "file": "pop", "vol": 0.16}; `file` is a name in
video/assets/, video/public/, $PRESENCE_SOUNDS, then the app's kit/sounds/ (".wav" added when there is no extension; pipelib.sound_dirs).
"""
import argparse
import os
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pipelib import Cut, asset, read_json, say, step
import user_edits

SR = 48000
CLIP = 0.95


def pcm(path, start=None, dur=None):
    cmd = ['ffmpeg', '-v', 'error']
    if start:
        cmd += ['-ss', f'{start:.3f}']
    cmd += ['-i', path]
    if dur:
        cmd += ['-t', f'{dur:.3f}']
    cmd += ['-vn', '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-']
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode:
        raise RuntimeError(f'ffmpeg could not read {path}: {r.stderr[-400:].decode(errors="replace")}')
    return np.frombuffer(r.stdout, dtype=np.float32).reshape(-1, 2)


def cues(doc):
    out = [dict(c) for c in doc.get('sfx', [])]
    for e in doc['events']:
        s = e.get('sfx')
        for c in ([s] if isinstance(s, dict) else (s or [])):
            out.append({'t': e['at'] + c.get('offset', 0.0), 'file': c['file'], 'vol': c.get('vol', 0.3)})
    out.sort(key=lambda c: c['t'])
    return out


def bed_track(cut, doc, n):
    """The music bed as a float32 stereo buffer of n samples (zeros outside start..end): the file looped, scaled by `vol` (or the linear envelope `env`
    = [[t, level], ...]) and faded in and out. None when the document has no bed."""
    b = doc.get('bed')
    if not b:
        return None
    x = pcm(asset(cut, b['file']))
    t0, t1 = float(b.get('start', 0.0)), float(b.get('end') or doc['duration'])
    i0, i1 = int(round(t0 * SR)), min(n, int(round(t1 * SR)))
    m = max(0, i1 - i0)
    reps = -(-m // max(1, len(x)))
    y = np.tile(x, (reps, 1))[:m] if m else x[:0]
    t = np.arange(m) / SR + t0
    if b.get('env'):
        ts_, lv = zip(*sorted(b['env']))
        g = np.interp(t, ts_, lv)
    else:
        g = np.full(m, float(b.get('vol', 0.1)))
    fi, fo = float(b.get('fade_in', 0.0)), float(b.get('fade_out', 0.0))
    if fi > 0:
        g = g * np.clip((t - t0) / fi, 0, 1)
    if fo > 0:
        g = g * np.clip((t1 - t) / fo, 0, 1)
    buf = np.zeros((n, 2), dtype=np.float32)
    buf[i0:i0 + m] = (y * g[:, None]).astype(np.float32)
    return buf


def build(cut, doc):
    """Returns {'file': path or None, 'cues': n, 'peak': summed peak of voice + effects, 'limit': bool}."""
    cs = cues(doc)
    path = os.path.join(cut.work, 'sfx.f32')
    if not cs and not doc.get('bed'):
        if os.path.isfile(path):
            os.remove(path)
        return {'file': None, 'cues': 0, 'peak': 0.0, 'limit': False}
    n = int(round(doc['duration'] * SR))
    buf = bed_track(cut, doc, n)
    if buf is None:
        buf = np.zeros((n, 2), dtype=np.float32)
    cache = {}
    for c in cs:
        if c['file'] not in cache:
            cache[c['file']] = pcm(asset(cut, c['file']))
        x = cache[c['file']] * float(c['vol'])
        i = int(round(c['t'] * SR))
        if i < 0 or i >= n:
            continue
        seg = x[: n - i]
        buf[i:i + len(seg)] += seg
    voice = pcm(cut.rough)
    m = min(len(voice), n)
    peak = float(np.max(np.abs(voice[:m] + buf[:m]))) if m else 0.0
    buf.tofile(path)
    return {'file': path, 'cues': len(cs) + (1 if doc.get('bed') else 0), 'peak': peak, 'limit': peak > CLIP}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--video')
    a = ap.parse_args(argv)
    cut = Cut(a.video)
    doc = user_edits.load(cut)
    with step(cut, 'sfx-layer') as d:
        r = build(cut, doc)
        d.update(cues=r['cues'], peak=round(r['peak'], 3), limiter=r['limit'])
        say(cut, f"sfx layer: {r['cues']} cues, summed peak {r['peak']:.3f}{' (limiter on)' if r['limit'] else ''}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
