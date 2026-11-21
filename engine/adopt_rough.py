"""Adopt a finished rough cut that has no edit list (a Short cut before the pipeline, or any rough.mp4 someone made by hand): write video/out/edl.json with ONE item
that is the whole rough, so handover.py can run on it.

    python adopt_rough.py [--video <video/>] [--beat-at 5.18 --beat-at 12.67 ...]
    python handover.py --whisper-rough            # the ONE Whisper pass over the rough, at the handover, because there are no source word files

--beat-at: starts of the cut's beats (seconds of the rough) when you know them: the list is then one item per beat (kind S, no `src`: no source words), so
tmap.beat(n) works in make_overlays.py. Without it there is a single beat. This is for testing a template on an old workshop and for roughs with no sources;
a rough made by a template's build script writes its own edl.json (split_edl.py or edl.py) and its words come from the sources.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import edl as edlmod
from pipelib import Cut, probe

if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--video'); ap.add_argument('--beat-at', type=float, action='append', default=[])
    a = ap.parse_args()
    cut = Cut(a.video)
    info = probe(cut.rough)
    total = round(info.get('nb_frames', 0) / info['fps'], 3) if info.get('nb_frames') else round(info['duration'], 3)
    e = edlmod.new(info['fps'], info['width'], info['height'], {})
    pts = [0.0] + sorted(a.beat_at) + [total]
    for n, (s, t) in enumerate(zip(pts, pts[1:]), 1):
        edlmod.add(e, 'S', t - s, beat=n, at=s)
    e['total'] = total
    bad = edlmod.validate(e)
    if bad:
        raise SystemExit('\n'.join(bad))
    edlmod.write(cut.edl, e)
    print(f'edl.json: {len(e["items"])} beat(s), {total} s (no sources: run handover.py --whisper-rough)')
