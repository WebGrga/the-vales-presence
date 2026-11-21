"""Chunked compose: the final in pieces of ~15 s (Shorts ~10 s), each encoded and cached by what touches its frames, then joined with `-c copy`.

    python compose.py --final [--single | --chunk-seconds 15 --jobs 3 --force]

Why: the whole-video encode took 4.2 min for 9:51 (it is the zoom pass, 31 overlay windows and a GPU encode running as one ffmpeg), and a final after one changed label
paid all of it again. A chunk is a closed group of pictures that starts on a forced keyframe, so chunks join with `-c copy` and no re-encode. The sound is never cut:
the voice (plus the sound-effects layer) is mixed once into one audio file (cached by what is in it) and muxed at the join, so no AAC priming can click at a seam.

A chunk's cache key is the hash of everything that touches its frames: the rough's sha256 and the chunk's frame range, every Remotion event that is on screen in it
(the picture at a time depends only on the events active at that time and on the template code, not on which window the event was rendered in: a changed ring in a
60 s chain re-encodes only the chunks where that ring is on), every zoom and caption event that overlaps it, the caption style, the size, fps, colour tags and the
encoder settings. Boundaries are on a fixed grid (every chunk_seconds), each moved at most a quarter of a chunk to the calmest nearby frame (no window, no zoom): the
grid does not depend on the events, and a boundary depends only on the events near it, so one edit moves no far-away boundary.

Frame-exact: a chunk reads the rough from the keyframe before it (-ss on the exact midpoint between two frames' timestamps, from a packet table of the rough),
`setpts=N/(fps*TB)` makes the timestamps by frame count, `-frames:v` stops it at its last frame; zooms are computed in the rough's absolute frame time (zoom_graph's `fo`),
so a zoom that runs across a seam is the same on both sides; captions are written per chunk with times shifted by the chunk's start (as the proof clips do).
"""
import concurrent.futures
import hashlib
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import captions
import encoders
import compose as cm
import holds as holdmod
import redact
import sfx as sfxmod
from pipelib import PIPE, Cut, fail, probe, read_json, run, say, sha256_file, sha_short, step, write_json
from windows import code_hash, visual
from events import drawn_by

VERSION = 'chunks-2'
BIAS = holdmod.BIAS


def ffmpeg_version():
    try:
        return subprocess.run(['ffmpeg', '-version'], capture_output=True, text=True).stdout.splitlines()[0][:60]
    except OSError:
        return ''


# ---------------------------------------------------------------------------------------------------------------- the rough's frame table

def rough_table(cut, rj):
    """{'pts': [seconds of frame i in display order], 'key': [display index of every keyframe]} of the rough, cached by its sha256 (a packet probe: no decode)."""
    path = os.path.join(cut.work, 'rough-packets.json')
    if os.path.isfile(path):
        j = read_json(path)
        if j.get('sha') == rj['rough_sha256']:
            return j
    r = run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', cut.rough])
    pk = []
    for line in r[1].splitlines():
        a = line.strip().split(',')
        if len(a) >= 2 and a[0] not in ('', 'N/A'):
            pk.append((float(a[0]), 'K' in a[1]))
    pk.sort()
    j = {'sha': rj['rough_sha256'], 'pts': [p for p, _ in pk], 'key': [i for i, (_, k) in enumerate(pk) if k]}
    write_json(path, j, indent=None)
    return j


# ---------------------------------------------------------------------------------------------------------------- chunk boundaries

def chunk_bounds(doc, ws, nframes, seconds):
    """Frame numbers where chunks start: [0, b1, b2, ..., nframes]. A fixed grid of `seconds`, each line moved to the calmest frame within a quarter of a chunk."""
    fps = doc['fps']
    G = max(int(round(seconds * fps)), 2)
    if nframes <= G * 1.5:
        return [0, nframes]
    R = G // 4
    busy = [(w['a'], w['b'], 2.0) for w in ws]
    busy += [(int(z['at'] * fps), int(z['end'] * fps) + 1, 1.0) for z in cm.video_zooms(doc)]

    def score(f):
        return sum(w for a, b, w in busy if a < f < b)

    cuts = [0]
    k = 1
    while k * G < nframes - G // 2:
        g = k * G
        cand = range(max(cuts[-1] + G // 2, g - R), min(nframes - G // 3, g + R) + 1)
        best = min(cand, key=lambda f: (score(f), abs(f - g)))
        cuts.append(best)
        k += 1
    cuts.append(nframes)
    return cuts


# ---------------------------------------------------------------------------------------------------------------- one chunk

def overlaps(e, A, B, fps):
    return e['at'] * fps < B and e['end'] * fps > A


def chunk_inputs(doc, ws, A, B, cut, code):
    """Everything that touches frames A..B-1, as plain data: the chunk's cache key is its hash."""
    fps = doc['fps']
    evs = [e for e in doc['events'] if drawn_by(e) == 'remotion' and overlaps(e, A, B, fps)]
    zs = [z for z in cm.video_zooms(doc) if overlaps(z, A, B, fps)]
    cs = [e for e in doc['events'] if e['kind'] == 'caption' and e.get('render') is not False and overlaps(e, A, B, fps)]
    out = {'events': sorted((visual(e) for e in evs), key=lambda e: e['id']), 'zooms': zs, 'caps': cs, 'code': code if evs else '',
           'cap_style': (doc.get('captions') or {}) if cs else None}
    bl = [e for e in redact.blurs(doc) if overlaps(e, A, B, fps)]
    if bl:                                   # only a chunk with a blur box carries the key: every other chunk keeps the key it always had
        out['blurs'] = bl
    return out


def chunk_cmd(cut, doc, ws, A, B, key, tab, sync_args, info):
    """The ffmpeg command, its working folder and its inputs' description for the chunk of frames A..B-1."""
    fps = doc['fps']
    n = B - A
    cdir = os.path.join(cut.work, 'chunks')
    pts, keys = tab['pts'], tab['key']
    # the keyframe at or before frame A, and the exact midpoint between frame A-1 and A (an accurate seek then returns frame A first)
    kf = max([k for k in keys if k <= A] or [0])
    seek = (pts[A - 1] + pts[A]) / 2 if A > 0 else 0.0
    zs = [z for z in cm.video_zooms(doc) if overlaps(z, A, B, fps)]
    cs = [e for e in doc['events'] if e['kind'] == 'caption' and e.get('render') is not False and overlaps(e, A, B, fps)]
    inside = [w for w in ws if w['a'] < B and w['b'] > A]
    S = A / fps
    inputs = ['-ss', f'{seek:.6f}', '-i', cut.rough]
    graph = ['[0:v]setpts=N/(' + f'{fps}' + '*TB)[c0]']
    zg = cm.zoom_graph(doc, zs, '[zz]', fo=A, nframes=n)
    zg[0] = zg[0].replace('[0:v]', '[c0]', 1)
    bl = [e for e in redact.blurs(doc) if overlaps(e, A, B, fps)]
    graph += redact.prepend(redact.blur_lines(bl, '[c0]', '[rb]', doc['width'], doc['height'], t_off=S), zg, '[rb]')      # blur boxes, before the zoom
    ass = None
    if cs:
        # the whole captions file, in the rough's own time: the frames are shifted to absolute time for the subtitle filter and back (an event that began before the chunk
        # must not restart its fade and its word pops at the chunk's first frame: a per-chunk file with negative times did exactly that)
        ass = (f"setpts=PTS+{S:.6f}/TB,ass='{captions.ff_path(os.path.join(cut.work, 'captions.ass'))}':fontsdir='{captions.ff_path(captions.fonts_dir(cut))}',setpts=PTS-{S:.6f}/TB")
    on_top = bool((doc.get('captions') or {}).get('on_top'))
    graph.append(f"[zz]{ass + ',' if ass and not on_top else ''}format=yuv420p[b0]")
    for i, w in enumerate(inside, 1):
        s_in = max(0, A - w['a']) / fps                       # where in the window's .mov the chunk starts (its timeline starts at the window's first frame)
        off = max(0, w['a'] - A) / fps                        # how late into the chunk the window starts
        inputs += ['-ss', f'{s_in:.6f}', '-noaccurate_seek', '-i', w['file']] if s_in > 0 else ['-i', w['file']]
        graph.append(f"[{i}:v]setpts=PTS+({off:.6f}-{BIAS})/TB[w{i}]")
        graph.append(f"[b{i - 1}][w{i}]overlay=eof_action=pass:repeatlast=0:format=auto:enable='between(t,{max(0, w['a'] - A) / fps - 1e-6:.6f},{(w['b'] - A) / fps - 1e-6:.6f})'[b{i}]")
    vout = f'[b{len(inside)}]'
    if on_top and ass:
        graph.append(f"{vout}{ass},format=yuv420p[bc]")
        vout = '[bc]'
    script = key + '.filter'
    with open(os.path.join(cdir, script), 'w', encoding='utf-8') as f:
        f.write(';\n'.join(graph) + '\n')
    gop = int(round(2 * fps))
    col = []
    if info.get('color_space') in ('bt709',):
        col = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709']
    cmd = ['ffmpeg', '-hide_banner', '-nostats', '-v', 'warning', '-y', *inputs, '-filter_complex_script', script, '-map', vout, '-an',
           *cm.final_args(), '-g', str(gop), *encoders.closed_gop(), *col, '-fps_mode', 'cfr', '-frames:v', str(n), '-movflags', '+faststart',
           key + '.part.mp4']
    return cmd, cdir, len(inside), len(zs), len(cs)


def encode_chunk(cut, doc, ws, A, B, key, tab, info):
    cdir = os.path.join(cut.work, 'chunks')
    out = os.path.join(cdir, key + '.mp4')
    cmd, cwd, nw, nz, nc = chunk_cmd(cut, doc, ws, A, B, key, tab, None, info)
    t0 = time.time()
    with open(cut.log_file, 'a', encoding='utf-8') as lg:
        lg.write(f'$ (chunk {A}-{B}) {" ".join(cmd)}\n')
        r = subprocess.run(cmd, cwd=cwd, stdout=lg, stderr=lg)
    if r.returncode:
        tail = open(cut.log_file, encoding='utf-8', errors='replace').read()[-1500:]
        fail(cut, f'the chunk {A}-{B} failed (ffmpeg exit {r.returncode}). Last lines of the log:\n{tail}')
    part = os.path.join(cdir, key + '.part.mp4')
    got = probe(part).get('nb_frames')
    if got != B - A:
        fail(cut, f'the chunk {A}-{B} came out with {got} frames, expected {B - A}: the seek into the rough or a window overlay lost or doubled frames. Run compose.py --single, and report it as an engine bug.')
    os.replace(part, out)
    for ext in ('.filter',):
        try:
            os.remove(os.path.join(cdir, key + ext))
        except OSError:
            pass
    return time.time() - t0


# ---------------------------------------------------------------------------------------------------------------- the sound, once

def audio_file(cut, doc, rj, sfx_info):
    """(path of the audio to mux, input args for it, codec args, seconds). With no effects layer: the rough's own audio stream, copied. Else: voice + layer mixed
    once into work/audio-<key>.m4a (cached by the rough, the layer's bytes and whether the limiter acts)."""
    if not sfx_info['file']:
        return cut.rough, ['-c:a', 'copy'], 0.0, None
    h = hashlib.sha256()
    with open(sfx_info['file'], 'rb') as f:
        for b in iter(lambda: f.read(1 << 22), b''):
            h.update(b)
    key = sha_short({'rough': rj['rough_sha256'], 'layer': h.hexdigest(), 'limit': sfx_info['limit'], 'v': VERSION})
    out = os.path.join(cut.work, f'audio-{key}.m4a')
    if os.path.isfile(out):
        return out, ['-c:a', 'copy'], 0.0, key
    t0 = time.time()
    ach, _, _ = cm.audio_args(sfx_info, 1)
    cmd = ['ffmpeg', '-hide_banner', '-nostats', '-v', 'warning', '-y', '-i', cut.rough, '-f', 'f32le', '-ar', str(sfxmod.SR), '-ac', '2', '-i', sfx_info['file'],
           '-filter_complex', ach, '-map', '[aout]', '-vn', '-c:a', 'aac', '-b:a', '256k', out + '.part.m4a']
    cm.run_ffmpeg(cut, cmd, cut.work, 'the sound mix')
    os.replace(out + '.part.m4a', out)
    return out, ['-c:a', 'copy'], time.time() - t0, key


# ---------------------------------------------------------------------------------------------------------------- the pass

def compose_final_chunked(cut, doc, ws, out=None, seconds=None, jobs=3, force=False, prune=False):
    out = out or cut.final
    fps = doc['fps']
    rj = read_json(cut.rough_json)
    info = probe(cut.rough)
    nb = int(round(doc['duration'] * fps))
    if info.get('nb_frames'):
        nb = min(nb, info['nb_frames'])
    seconds = seconds or (10.0 if doc.get('format') == 'short' else 15.0)
    tab = rough_table(cut, rj)
    if len(tab['pts']) < nb:
        fail(cut, f'the rough has {len(tab["pts"])} frames in its packet table but the cut needs {nb}')
    ass_all = captions.write(cut, doc)            # the whole captions file stays for the single pass and for reading
    sfx_info = sfxmod.build(cut, doc)
    cdir = os.path.join(cut.work, 'chunks')
    os.makedirs(cdir, exist_ok=True)
    captions.fonts_dir(cut)
    bounds = chunk_bounds(doc, ws, nb, seconds)
    code = code_hash(cut)
    common = {'rough': rj['rough_sha256'], 'size': [doc['width'], doc['height'], fps], 'color': info.get('color_space'), 'enc': cm.final_args(), 'v': VERSION, 'ff': ffmpeg_version(),
              'on_top': bool((doc.get('captions') or {}).get('on_top'))}
    chunks = []
    for A, B in zip(bounds, bounds[1:]):
        inp = chunk_inputs(doc, ws, A, B, cut, code)
        key = sha_short({'A': A, 'B': B, **inp, **common})
        chunks.append({'a': A, 'b': B, 'key': key, 'file': os.path.join(cdir, key + '.mp4'), **{k: len(v) if isinstance(v, list) else 0 for k, v in inp.items() if k in ('events', 'zooms', 'caps')}})
    todo = [c for c in chunks if force or not os.path.isfile(c['file'])]
    say(cut, f'composing in {len(chunks)} chunks ({seconds:g} s each): {len(todo)} to encode, {len(chunks) - len(todo)} cached; {len(ws)} overlay windows, '
             f'{len(cm.video_zooms(doc))} zooms, {"captions, " if ass_all else ""}{sfx_info["cues"]} sound cues'
             + (f', {len(redact.blurs(doc))} blur boxes' if redact.blurs(doc) else '') + f'; {min(jobs, max(1, len(todo)))} at a time')
    t0 = time.time()
    secs = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(jobs, len(todo))) + 1) as pool:
        # the sound, once: mixed beside the chunks (cached by the rough and the effects layer, so a label change does not touch it)
        afut = pool.submit(audio_file, cut, doc, rj, sfx_info)
        gate = concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(jobs, len(todo))))
        futs = {gate.submit(encode_chunk, cut, doc, ws, c['a'], c['b'], c['key'], tab, info): c for c in todo}
        for fu in concurrent.futures.as_completed(futs):
            c = futs[fu]
            secs[c['key']] = fu.result()
            say(cut, f"  chunk {c['a'] / fps:.1f}-{c['b'] / fps:.1f} s encoded in {secs[c['key']]:.1f} s ({c['events']} overlay events, {c['zooms']} zooms, {c['caps']} captions)")
        gate.shutdown()
        a_path, a_codec, t_aud, a_key = afut.result()
    t_enc = time.time() - t0
    # join: concat demuxer, `-c copy`, with the audio muxed in
    t1 = time.time()
    lst = os.path.join(cdir, 'join.txt')
    us = lambda fr: int(round(fr * 1e6 / fps))          # each chunk lasts exactly its frames: cumulative microseconds, so no join drifts by a rounding
    with open(lst, 'w', encoding='utf-8') as f:
        f.write(''.join(f"file '{os.path.basename(c['file'])}'\nduration {(us(c['b']) - us(c['a'])) / 1e6:.6f}\n" for c in chunks))
    start = tab['pts'][0] if tab['pts'] else 0.0
    tmp = os.path.join(cut.out, 'final.part.mp4')
    v_in = (['-itsoffset', f'{start:.6f}'] if start > 1e-4 else []) + ['-f', 'concat', '-safe', '0', '-i', lst]
    cmd = ['ffmpeg', '-hide_banner', '-nostats', '-v', 'warning', '-y', *v_in, '-i', a_path, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', *a_codec,
           '-movflags', '+faststart', tmp]
    cm.run_ffmpeg(cut, cmd, cdir, 'the join of the chunks')
    try:
        os.replace(tmp, out)
    except PermissionError:
        aside = out[:-4] + '.old-' + time.strftime('%H%M%S') + '.mp4'
        os.rename(out, aside)
        os.replace(tmp, out)
        say(cut, f'the old final was open elsewhere; moved it aside to {os.path.basename(aside)}')
    t_join = time.time() - t1
    if prune:
        keep = {os.path.basename(c['file']) for c in chunks}
        for n in os.listdir(cdir):
            if n.endswith('.mp4') and n not in keep:
                os.remove(os.path.join(cdir, n))
    return {'seconds': time.time() - t0, 'chunks': len(chunks), 'encoded': len(todo), 'reused': len(chunks) - len(todo), 'encode_s': round(t_enc, 1),
            'audio_s': round(t_aud, 1), 'join_s': round(t_join, 1), 'bounds': [round(b / fps, 2) for b in bounds[1:-1]], 'encoded_ranges': [[round(c['a'] / fps, 1), round(c['b'] / fps, 1)] for c in todo]}, sfx_info
