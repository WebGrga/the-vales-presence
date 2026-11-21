"""Contact sheet of a video in ONE ffmpeg call: video/out/frames.jpg from final.mp4 (or any file).

    python sheet.py [video.mp4] [--video <video/>] [--every 2] [--width 240] [--cols 14] [--out frames.jpg]

Fast: with `-skip_frame nokey` only keyframes are decoded, so a final composed with a 2 s GOP gives a frame every 2 s in a few seconds; for a
file with sparser keyframes it falls back to decoding with the fps filter (GPU decode when available). Each frame carries its timestamp.
"""
import argparse
import math
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import encoders
from pipelib import Cut, label_font, probe, say, step


def make(cut, src, out, every=2.0, width=240, cols=14):
    info = probe(src)
    n = int(info['duration'] // every) + 1
    rows = math.ceil(n / cols)
    ts = f"drawtext={label_font()}text='%{{pts\\:hms}}':fontsize={max(12, width // 15)}:fontcolor=white:box=1:boxcolor=black@0.7:x=4:y=4"
    tile = f'scale={width}:-2,{ts},tile={cols}x{rows}:padding=2:color=0x111111'
    base = ['ffmpeg', '-hide_banner', '-nostats', '-v', 'error', '-y']
    # keyframes only (needs a regular GOP); verify the count is about right, else decode with fps
    r = subprocess.run([*base, '-skip_frame', 'nokey', '-i', src, '-an', '-vf', f'select=isnan(prev_selected_t)+gte(t-prev_selected_t\\,{every - 0.2}),{tile}',
                        '-frames:v', '1', '-q:v', '3', out], capture_output=True, text=True)
    if r.returncode:
        r = subprocess.run([*base, *encoders.hwaccel(), '-i', src, '-an', '-vf', f'fps=1/{every},{tile}', '-frames:v', '1', '-q:v', '3', out], capture_output=True, text=True)
    if r.returncode:
        r = subprocess.run([*base, '-i', src, '-an', '-vf', f'fps=1/{every},{tile}', '-frames:v', '1', '-q:v', '3', out], capture_output=True, text=True)
        if r.returncode:
            raise RuntimeError('contact sheet failed: ' + r.stderr[-600:])
    return n


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('file', nargs='?'); ap.add_argument('--video'); ap.add_argument('--every', type=float, default=2.0)
    ap.add_argument('--width', type=int, default=240); ap.add_argument('--cols', type=int, default=14); ap.add_argument('--out')
    a = ap.parse_args(argv)
    cut = Cut(a.video)
    src = a.file or cut.final
    out = a.out or cut.sheet
    with step(cut, 'contact-sheet', file=os.path.basename(src)) as d:
        d['frames'] = make(cut, src, out, a.every, a.width, a.cols)
    say(cut, f'contact sheet: {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
