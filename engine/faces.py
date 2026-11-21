# /// script
# requires-python = ">=3.9"
# dependencies = ["numpy", "opencv-python-headless"]
# ///
"""Faces in a camera source, and the framings they give: a punch-in box and a vertical crop that keep the face.

    python faces.py track <source> [--fps 4] [--region x,y,w,h|none] [--from s] [--to s] [--width 640] [--name n] [--out dir]
    python faces.py punch <t0> <t1> [--scale 1.1] [--src r1] [--place scale,ox,oy] [--frame W,H] [--id P1]
    python faces.py reframe <t0> <t1> [--aspect 9/16] [--src r1] [--bounds x,y,w,h] [--zoom 1.0]

`track` reads the source at a few frames a second (ffmpeg, small frames), finds the face in each (OpenCV's YuNet through `cv2.FaceDetectorYN`;
the 230 KB model is `models/face_detection_yunet_2023mar.onnx`, MIT, from the OpenCV Zoo) and writes `<workshop>/video/out/work/faces-<name>.json`:
per sample the time, the face box, the eyes (their middle), the mouth, which way the head turns (`look`, -1 left .. 1 right, in the picture) and the
detector's confidence; gaps shorter than 1.5 s are filled and one-frame jumps are smoothed out. Coordinates are pixels of the SOURCE frame.
A webcam inset in a screen recording: the first 12 s are searched whole, then only the part of the frame around the face is (`detect` in the file; `--region none`
searches everywhere, `--region x,y,w,h` says where). The time is the ffmpeg decode of the source (about 3-5 s per minute of 1080p60); the detector
(YuNet at 640 px wide, 10-20 ms a frame on the CPU) is the smaller part.
`<source>` is a file or an edl key (`r1`); the name is the key or the file's stem; with the name `rough` the faces are those of out/rough.mp4 itself
(times are then rough times and nothing is mapped).

`punch(t0, t1, scale=1.1)` gives the `E.zoom` box (x, y, zoom) for a stretch of the ROUGH, placed from where the face is through all of it (the box of
the face over the whole stretch must stay in, not one frame): eyes about a third down, a little more room on the side the head turns toward, the chin and
mouth always in (the zoom is lowered, down to 1, if the stretch moves too much to hold at `scale`), never past the frame. Rough times go to source times
through edl.json (`tmap`). A source whose picture is not the rough's (a SPLIT's cam band) says how it is placed: `place=(scale, ox, oy)`, rough pixel =
source pixel * scale + (ox, oy); for a zoom with a `region` the box is in that region's pixels (`frame=(w, h)` of the region).
`reframe(t0, t1, aspect=9/16)` gives crops of the SOURCE (x, y, w, h) for a vertical Short: one per run of the source between cuts (the crop never moves
inside a run; it changes only where the rough cuts), each placed so the whole run's face is in, eyes a third down when the crop is tighter than the
frame (`zoom` > 1) and room toward where the head turns.

    import sys; sys.path.insert(0, ENGINE)          # ENGINE = the engine/ folder of the repo
    from faces import punch, reframe
    b = punch(23.4, 49.5, scale=1.1, src='r1', cut=cut)       # {'x': 96.0, 'y': 40.5, 'zoom': 1.1, 'fits': True, ...}
    E.zoom('P1', 23.4, 49.5, x=b['x'], y=b['y'], zoom=b['zoom'], ease=0, what='punch on the claim')
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# the pieces, under the names this module has always had (other code and the tests import them from here)
from faces_data import (KEYS, iou, look_of, parse_row, pick_face, smooth, stats, to_frame)                           # noqa: F401
from faces_frame import (CHIN, HEAD, SIDE, THIRD, TURN, _edl_items, _faces_for, _pick_src, _runs, _stats_for, fit_axis,   # noqa: F401
                         punch, punch_box, reframe, reframe_box, src_runs, window_for)
from faces_track import (MODEL, MODEL_NAME, VERSION, _detect, faces_path, load_faces, probe_size, read_frames, region_around,   # noqa: F401
                         track, workshop_work)


def _ints(s):
    return [int(round(float(v))) for v in s.split(',')]


def resolve_source(arg, video=None):
    """(path, name) of a track argument: an edl key of this workshop, or a file."""
    if os.path.isfile(arg):
        return os.path.abspath(arg), os.path.splitext(os.path.basename(arg))[0]
    from pipelib import Cut
    cut = Cut(video)
    if arg == 'rough':
        return cut.rough, 'rough'
    from pipelib import read_json
    e = read_json(cut.edl)
    if arg in e.get('sources', {}):
        return cut.p(e['sources'][arg]['file']), arg
    raise SystemExit(f'"{arg}" is neither a file nor a source of this edl.json')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    t = sub.add_parser('track')
    t.add_argument('source')
    t.add_argument('--fps', type=float, default=4.0)
    t.add_argument('--region', default='auto', help='x,y,w,h of the camera inside the frame (a webcam inset): look only there; "none" = the whole frame; '
                   'default auto = find the face in the first 12 s, then look only around that')
    t.add_argument('--from', dest='start', type=float)
    t.add_argument('--to', dest='end', type=float)
    t.add_argument('--width', type=int, default=640, help='detector input width, px')
    t.add_argument('--name')
    t.add_argument('--out', help='folder for faces-<name>.json (default video/out/work)')
    t.add_argument('--video')
    for name in ('punch', 'reframe'):
        p = sub.add_parser(name)
        p.add_argument('t0', type=float)
        p.add_argument('t1', type=float)
        p.add_argument('--src')
        p.add_argument('--video')
        p.add_argument('--out', help='folder of the faces file (default video/out/work)')
        p.add_argument('--id', default='P1')
        if name == 'punch':
            p.add_argument('--scale', type=float, default=1.1)
            p.add_argument('--place', type=lambda s: [float(v) for v in s.split(',')], help='scale,ox,oy: rough = source * scale + (ox, oy)')
            p.add_argument('--frame', type=_ints, help='W,H of the picture zoomed (default the rough)')
        else:
            p.add_argument('--aspect', default='9/16')
            p.add_argument('--bounds', type=_ints)
            p.add_argument('--zoom', type=float, default=1.0)
    a = ap.parse_args(argv)
    if a.cmd == 'track':
        path, name = resolve_source(a.source, a.video)
        name = a.name or name
        work = a.out or workshop_work(path, a.video)
        if not work:
            raise SystemExit('Cannot find the workshop: pass --out <folder> (or --video <path to video/>).')
        os.makedirs(work, exist_ok=True)
        W, H, dur = probe_size(path)
        region = a.region if a.region == 'auto' else None if a.region == 'none' else _ints(a.region)
        samples, info = track(path, a.fps, region, a.start, a.end, a.width)
        doc = {'version': VERSION, 'source': path, 'name': name, 'model': MODEL_NAME, 'size': [W, H], 'fps': a.fps,
               'region': region if isinstance(region, list) else None, 'detect': info['detect'], 'range': [a.start or 0, a.end if a.end is not None else round(dur, 3)], 'ms': info['ms'], 'found': info['found'],
               'samples': samples}
        p = faces_path(name, work)
        tmp = p + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
        os.replace(tmp, p)
        footage = doc['range'][1] - doc['range'][0]
        print(f"{p}: {info['samples']} samples, face in {info['found'] * 100:.0f}% (looked in {info['detect'] or 'the whole frame'}), {info['ms'] / 1000:.1f} s for {footage:.0f} s of footage "
              f"({info['ms'] / 1000 / max(footage, 1e-9) * 60:.1f} s per minute)")
        return 0
    from pipelib import Cut
    cut = Cut(a.video)
    if a.cmd == 'punch':
        b = punch(a.t0, a.t1, a.scale, a.src, cut, tuple(a.place) if a.place else None, tuple(a.frame) if a.frame else None, a.out)
        print(json.dumps(b))
        print(f"E.zoom('{a.id}', {a.t0}, {a.t1}, x={b['x']}, y={b['y']}, zoom={b['zoom']}, ease=0)" + ('' if b['fits'] else '   # the face does not fit at this zoom: look at it'))
        return 0
    n, d = (a.aspect.split('/') + ['1'])[:2]
    for r in reframe(a.t0, a.t1, float(n) / float(d), a.src, cut, tuple(a.bounds) if a.bounds else None, a.zoom, a.out):
        print(json.dumps(r))
    return 0


if __name__ == '__main__':
    sys.exit(main())
