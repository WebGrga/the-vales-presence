"""Seam checks of a chunked final: are the joins invisible and the timeline clean?

    python seams.py [final.mp4] [--video <video/>] [--against other.mp4] [--stills N]

1. frames      the final has exactly the rough's number of picture frames (no frame repeated or dropped at a join);
2. timestamps  every video packet's pts is the previous one plus one frame (constant frame rate, monotonic, no gap or overlap), the audio's too;
3. keyframes   every chunk starts on a keyframe (closed GOP: the decoder needs nothing from the chunk before);
4. joins       for every join (or N of them): the frames just before and after, from the final and (with --against) from another final of the same cut:
               how much the picture changes across the join compared with how much it changes between ordinary neighbouring frames, and the PSNR of each
               frame against the other final. A picture that jumps at a join would show as a change many times the usual one.
Prints plain words; exit 1 on a failed check. Writes video/out/seams/joins.jpg (before | after, pairs) when it has joins to show.
"""
import argparse
import json
import math
import os
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pipelib import Cut, read_json, run, say


def packets(path, kind='v'):
    r = run(['ffprobe', '-v', 'error', '-select_streams', f'{kind}:0', '-show_entries', 'packet=pts,dts,duration,flags', '-of', 'csv=p=0', path])
    out = []
    for line in r[1].splitlines():
        a = line.strip().split(',')
        if len(a) >= 4:
            out.append((int(a[0]) if a[0] not in ('', 'N/A') else None, int(a[1]) if a[1] not in ('', 'N/A') else None, 'K' in a[3]))
    return out


def tb_of(path, kind='v'):
    r = run(['ffprobe', '-v', 'error', '-select_streams', f'{kind}:0', '-show_entries', 'stream=time_base,nb_frames,r_frame_rate', '-of', 'json', path])
    s = json.loads(r[1])['streams'][0]
    n, d = s['time_base'].split('/')
    return int(n) / int(d), s


def grab(path, frame, fps, n=4):
    """Frames `frame` .. frame+n-1 of a video as float arrays (seeks to the midpoint before it)."""
    t = max(0.0, (frame - 0.5) / fps)
    r = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{t:.5f}', '-i', path, '-frames:v', str(n), '-an', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True)
    return r.stdout


def decode(raw, w, h, n):
    sz = w * h * 3
    return [np.frombuffer(raw[i * sz:(i + 1) * sz], dtype=np.uint8).reshape(h, w, 3).astype(np.float32) for i in range(min(n, len(raw) // sz))]


def psnr(a, b):
    m = float(np.mean((a - b) ** 2))
    return 99.0 if m < 1e-9 else 10 * math.log10(255 * 255 / m)


def check(cut, final, against=None, stills=None, joins=None):
    rj = read_json(cut.rough_json)
    fps = rj['fps']
    W, H = rj['width'], rj['height']
    problems, lines = [], []
    # 1. frames
    tb, s = tb_of(final)
    pk = packets(final)
    n_final = len(pk)
    lines.append(f"frames: final {n_final}, rough {rj['nb_frames']}")
    if rj.get('nb_frames') and abs(n_final - rj['nb_frames']) > 0:
        problems.append(f'FRAMES: the final has {n_final} frames, the rough {rj["nb_frames"]}')
    # 2. timestamps
    step = round(1 / fps / tb)
    pts = sorted(p for p, _, _ in pk if p is not None)
    d = [b - a for a, b in zip(pts, pts[1:])]
    odd = [i for i, x in enumerate(d) if abs(x - step) > 1]
    dts = [x for _, x, _ in pk if x is not None]
    nonmono = sum(1 for a, b in zip(dts, dts[1:]) if b <= a)
    lines.append(f"timestamps: {len(pts)} pts, step {step} ticks of 1/{round(1 / tb)} s ({1 / tb / step:g} fps), {len(odd)} irregular steps, {nonmono} non-increasing dts, first pts {pts[0] * tb:.4f} s")
    if odd:
        problems.append(f'TIMESTAMPS: {len(odd)} steps are not one frame (first at frame {odd[0]}: {d[odd[0]]} ticks instead of {step})')
    if nonmono:
        problems.append(f'TIMESTAMPS: {nonmono} decoding timestamps do not increase')
    # audio
    atb, _ = tb_of(final, 'a')
    ap = [p for p, _, _ in packets(final, 'a') if p is not None]
    ad = sorted(set(b - a for a, b in zip(ap, ap[1:])))
    lines.append(f"audio: {len(ap)} packets, steps {ad[:4]} ticks, first pts {ap[0] * atb:.4f} s")
    if len(ad) > 2:
        problems.append(f'AUDIO: packet steps vary: {ad[:6]}')
    # 3. keyframes at the joins
    keys = [i for i, (p, _, k) in enumerate(sorted((x for x in pk if x[0] is not None), key=lambda x: x[0])) if k]
    jl = os.path.join(cut.work, 'chunks', 'join.txt')
    cuts = []
    if os.path.isfile(jl):
        import compose_chunks as cc
        for line in open(jl, encoding='utf-8'):
            if not line.startswith('file '):
                continue
            f = os.path.join(cut.work, 'chunks', line.split("'")[1])
            cuts.append(int(read_json_frames(f)))
        cum = np.cumsum([0] + cuts)[1:-1]
        cum = [int(x) for x in cum]
        miss = [c for c in cum if c not in set(keys)]
        lines.append(f"keyframes: {len(keys)} in the final; {len(cum)} joins, {len(cum) - len(miss)} of them on a keyframe")
        if miss:
            problems.append(f'KEYFRAMES: joins at frames {miss[:6]} are not on a keyframe')
    else:
        cum = joins or []
    # 4. the joins
    if cum:
        pick = cum if not stills else [cum[int(i * (len(cum) - 1) / max(1, stills - 1))] for i in range(min(stills, len(cum)))]
        rows = []
        for j in pick:
            raw = grab(final, j - 2, fps, 4)             # frames j-2, j-1 | j, j+1 : the join sits between the second and the third
            f = decode(raw, W, H, 4)
            if len(f) < 4:
                continue
            across = float(np.mean(np.abs(f[1] - f[2])))
            near = (float(np.mean(np.abs(f[0] - f[1]))) + float(np.mean(np.abs(f[2] - f[3])))) / 2
            row = {'frame': j, 'time': round(j / fps, 2), 'change_across': round(across, 3), 'change_near': round(near, 3), 'ratio': round(across / max(near, 0.05), 2)}
            if against:
                g6 = decode(grab(against, j - 3, fps, 6), W, H, 6)
                if len(g6) == 6:
                    # the other file may start a frame off (a seek lands on its own timestamps): take the alignment, of -1, 0, +1 frames, that fits best
                    best = max((-1, 0, 1), key=lambda s: sum(psnr(f[i], g6[i + 1 + s]) for i in range(4)))
                    g = g6[1 + best:5 + best]
                    row['psnr'] = [round(psnr(f[i], g[i]), 1) for i in range(4)]
                    row['against_across'] = round(float(np.mean(np.abs(g[1] - g[2]))), 3)
                    row['shift'] = best
            rows.append(row)
        for r in rows:
            lines.append(f"join at frame {r['frame']} ({r['time']} s): change across the join {r['change_across']}, between neighbours {r['change_near']} (x{r['ratio']})"
                         + (f"; against the other final: PSNR {r['psnr']} dB, its change across {r['against_across']}" if 'psnr' in r else ''))
        # a join is fine when the picture changes across it as much as the other final's does at the same frames (real motion is not a seam), and its frames are as close
        # to the other final as that final's neighbours are (a quality dip after the join would show as a low PSNR on the frame after it)
        if against:
            bad = [r for r in rows if 'psnr' in r and (r['change_across'] > 1.5 * r['against_across'] + 0.3 or min(r['psnr']) < 30)]
            if bad:
                problems.append(f'JOINS: at frames {[r["frame"] for r in bad]} the picture changes across the join more than in the other final, or is far from it (PSNR below 30 dB)')
        else:
            worst = max((r['ratio'] for r in rows), default=0)
            if worst > 6:
                lines.append(f'(without --against a join with real motion across it cannot be told from a jump: ratio {worst}; give --against another final)')
    return lines, problems


def read_json_frames(path):
    r = run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=nb_frames', '-of', 'csv=p=0', path])
    return int(r[1].strip().split()[0])


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('final', nargs='?'); ap.add_argument('--video'); ap.add_argument('--against'); ap.add_argument('--stills', type=int, default=None)
    a = ap.parse_args(argv)
    cut = Cut(a.video)
    lines, problems = check(cut, a.final or cut.final, a.against, a.stills)
    for l in lines:
        say(cut, l)
    for p in problems:
        say(cut, 'FAILED: ' + p)
    say(cut, 'SEAMS OK' if not problems else f'SEAMS FAILED: {len(problems)}')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
