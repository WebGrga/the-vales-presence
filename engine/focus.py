"""Where the screen changes: the part of a screen recording a zoom should frame.

    python focus.py <source> <t0> <t1> [--frame W,H] [--mask x,y,w,h]... [--cam r1] [--max-zoom 2.0] [--pad 0.06] [--fps 5] [--draw still.png]
    python focus.py r1 83.2 96.0 --rough [--video <video/>] ...       (t0 t1 are ROUGH seconds, mapped through edl.json: what E.zoom takes)

The stretch is read with ffmpeg as small grayscale frames (192 wide, `--fps` a second); two frames in a row that differ at a pixel (by more than
`thr`) count there. A cell counts as "changing" when it changed in at least two pairs and its neighbourhood is dense, which drops a lone clock, a blinking
caret and the pointer's thin trail but keeps a pane that scrolls, plays or types. The box of what is left (its edges trimmed by 1%) is padded, widened to
the output's shape (`--frame`, default the source's size) and clamped to the zoom you will accept (`--max-zoom`, default 2): the answer is an `E.zoom`
box (x, y, zoom) in the output's pixels. `--mask x,y,w,h` (source pixels, repeat it) leaves a region out of the measure (a webcam inset, which always
moves); when the zoom box still takes in part of a mask the answer carries `mask` for `E.zoom(..., mask=...)`, which paints it over while zoomed.
`--cam <faces file>` leaves the webcam inset out of the measure without a rectangle: it is guessed from where the speaker's face is (the nearest corner, the face sits in its middle).
`--draw` saves the frame at the middle of the stretch with the changing box (green), the zoom box (yellow) and the masks (red): look at it.
When almost nothing changes, or all of the screen does, the answer is zoom 1 (`note` says why): then there is no pane to frame.

    from focus import focus, focus_rough
    f = focus_rough(83.2, 96.0, 'r1', cut, masks=[(0, 753, 470, 327)])      # {'x': 410.0, 'y': 120.0, 'zoom': 1.6, 'box': [...], 'mask': {...}, ...}
    E.zoom('F1', 83.2, 96.0, x=f['x'], y=f['y'], zoom=f['zoom'], mask=f.get('mask'), what='the chat pane')

Measures only; what is shown is decided by what is said.
"""
import argparse
import json
import os
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

GRID = 192          # grayscale frame width, cells
THR = 10            # a pixel changed when it moved by more than this (of 255)
MIN_COUNT = 2       # a cell counts after changing in this many pairs of frames
DENSE = 0.3         # share of a 5 x 5 neighbourhood that changed, to be part of a pane
TRIM = 1.0          # percent of the changing cells left off each edge of the box
MIN_SHARE = 0.002   # fewer changing cells than this share of the frame = nothing changes
PAD = 0.06          # box padding, share of its size each side (at least 8 px)


# ---------------------------------------------------------------------------------------------------------------- pure

def change_counts(frames, thr=THR):
    """frames: T x H x W uint8 grayscale. -> (H x W int array: in how many pairs of neighbouring frames the pixel changed by more than thr, pairs)."""
    f = frames.astype(np.int16)
    d = np.abs(f[1:] - f[:-1]) > thr
    return d.sum(axis=0).astype(np.int32), len(d)


def mask_cells(counts, rects, W, H):
    """Zero the cells under rects [(x, y, w, h)] given in source pixels (a webcam inset): returns a copy."""
    out = counts.copy()
    gh, gw = out.shape
    for x, y, w, h in rects or []:
        x0, y0 = int(np.floor(x * gw / W)), int(np.floor(y * gh / H))
        x1, y1 = int(np.ceil((x + w) * gw / W)), int(np.ceil((y + h) * gh / H))
        out[max(0, y0):max(0, y1), max(0, x0):max(0, x1)] = 0
    return out


def dense_cells(counts, pairs, min_count=MIN_COUNT, dense=DENSE):
    """The boolean map of cells that changed in `min_count` pairs and sit in a dense neighbourhood (5 x 5 mean >= `dense`)."""
    m = (counts >= min(min_count, max(1, pairs))).astype(np.float32)
    p = np.pad(m, 2)
    c = np.cumsum(np.cumsum(p, axis=0), axis=1)
    c = np.pad(c, ((1, 0), (1, 0)))
    h, w = m.shape
    s = c[5:5 + h, 5:5 + w] - c[0:h, 5:5 + w] - c[5:5 + h, 0:w] + c[0:h, 0:w]
    return (m > 0) & (s / 25.0 >= dense)


def box_of_cells(mask, trim=TRIM):
    """(x0, y0, x1, y1) in cells (x1, y1 exclusive) of the True cells with `trim` percent of them left off each edge; None when there are none."""
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None
    x0, x1 = np.percentile(xs, [trim, 100 - trim])
    y0, y1 = np.percentile(ys, [trim, 100 - trim])
    return int(np.floor(x0)), int(np.floor(y0)), int(np.floor(x1)) + 1, int(np.floor(y1)) + 1


def box_px(cells, gw, gh, W, H):
    """A box in cells to source pixels."""
    return [cells[0] * W / gw, cells[1] * H / gh, cells[2] * W / gw, cells[3] * H / gh]


def pad_box(box, W, H, pad=PAD, min_px=8):
    w, h = box[2] - box[0], box[3] - box[1]
    px, py = max(min_px, w * pad), max(min_px, h * pad)
    return [max(0.0, box[0] - px), max(0.0, box[1] - py), min(float(W), box[2] + px), min(float(H), box[3] + py)]


def snap_aspect(box, aspect, W, H):
    """The smallest crop of the shape `aspect` (width / height) inside the W x H frame that holds `box`, centred on it (pushed inside the frame).
    (x, y, w, h); the whole frame when the box needs more than that."""
    bw, bh = max(box[2] - box[0], 1.0), max(box[3] - box[1], 1.0)
    w, h = (bw, bw / aspect) if bw / bh > aspect else (bh * aspect, bh)
    if w >= W - 1e-6 or h >= H - 1e-6:
        return 0.0, 0.0, float(W), float(H)
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    return min(max(cx - w / 2, 0.0), W - w), min(max(cy - h / 2, 0.0), H - h), w, h


def limit_zoom(crop, box, W, H, max_zoom=2.0):
    """A crop no tighter than max_zoom: when the box is smaller than that, the crop grows around the box's centre. (x, y, w, h, held): `held` False
    when the crop was loosened (the box is smaller than the zoom allows, so it is not the whole story)."""
    x, y, w, h = crop
    if W / w <= max_zoom + 1e-9:
        return x, y, w, h, True
    nw, nh = W / max_zoom, H / max_zoom
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    return min(max(cx - nw / 2, 0.0), W - nw), min(max(cy - nh / 2, 0.0), H - nh), nw, nh, False


def zoom_box(crop, W, H):
    """An E.zoom (x, y, zoom) from a crop of the W x H frame; x and y floored to a tenth so the crop never passes the frame."""
    x, y, w, h = crop
    z = W / w
    return {'x': int(max(0.0, min(x, W - w)) * 10) / 10, 'y': int(max(0.0, min(y, H - h)) * 10) / 10, 'zoom': round(z, 3)}


def rect_hits(crop, rect):
    x, y, w, h = crop
    return rect[0] < x + w and rect[0] + rect[2] > x and rect[1] < y + h and rect[1] + rect[3] > y


def cam_rect(face_box, W, H, pad=0.15):
    """A guess at a webcam inset from where the face sits: the inset is anchored in the nearest corner and the face sits about in its middle, so it is twice
    as wide and as tall as the face's middle is from that corner's sides (a little more: `pad`). (x, y, w, h) in source pixels. A guess: look at --draw."""
    cx, cy = (face_box[0] + face_box[2]) / 2, (face_box[1] + face_box[3]) / 2
    left, top = cx <= W / 2, cy <= H / 2
    w = min(W * 0.6, 2 * (cx if left else W - cx) * (1 + pad))
    h = min(H * 0.6, 2 * (cy if top else H - cy) * (1 + pad))
    w, h = int(w), int(h)
    return (0 if left else W - w, 0 if top else H - h, w, h)


def analyse(counts, pairs, W, H, frame=None, masks=(), max_zoom=2.0, pad=PAD, place=None, ignore=()):
    """The framing from a change map (cells over the W x H source frame): {'x', 'y', 'zoom', 'box', 'crop', 'share', 'note', 'mask'?}.
    `frame` = (w, h) of the picture zoomed (default the source's), `place` = (scale, ox, oy) = source pixel * scale + (ox, oy) into that picture.
    `masks` are left out of the measure and handed back as `mask` when the zoom takes them in; `ignore` rects are only left out of the measure."""
    k, ox, oy = place or (1.0, 0.0, 0.0)
    FW, FH = frame or (W * k, H * k)
    gh, gw = counts.shape
    m = dense_cells(mask_cells(counts, [*masks, *ignore], W, H), pairs)
    share = float(m.mean())
    out = {'x': 0.0, 'y': 0.0, 'zoom': 1.0, 'box': None, 'crop': [0.0, 0.0, float(FW), float(FH)], 'share': round(share, 4), 'pairs': pairs}
    if share < MIN_SHARE:
        out['note'] = 'almost nothing changes: no pane to frame (zoom 1)'
        return out
    cells = box_of_cells(m)
    box = box_px(cells, gw, gh, W, H)
    out['box'] = [round(v, 1) for v in box]
    fb = [box[0] * k + ox, box[1] * k + oy, box[2] * k + ox, box[3] * k + oy]            # into the picture's pixels
    fb = pad_box(fb, FW, FH, pad)
    crop = snap_aspect(fb, FW / FH, FW, FH)
    x, y, w, h, held = limit_zoom(crop, fb, FW, FH, max_zoom)
    z = zoom_box((x, y, w, h), FW, FH)
    out.update(z)
    out['crop'] = [round(x, 1), round(y, 1), round(w, 1), round(h, 1)]
    if z['zoom'] < 1.1:
        out['note'] = 'the changing part is most of the screen: no pane to frame'
    elif not held:
        out['note'] = f'the changing part is smaller than zoom {max_zoom:g} frames: loosened to the limit'
    hit = [r for r in masks if rect_hits((x, y, w, h), (r[0] * k + ox, r[1] * k + oy, r[2] * k, r[3] * k))]
    if hit:
        r = hit[0]
        out['mask'] = {'x': int(round(r[0] * k + ox)), 'y': int(round(r[1] * k + oy)), 'w': int(round(r[2] * k)), 'h': int(round(r[3] * k)), 'color': '#000000'}
    return out


# ---------------------------------------------------------------------------------------------------------------- reading the source

def read_gray(path, s0, s1, fps=5.0, gw=GRID, size=None):
    """Small grayscale frames of the source from s0 to s1 (seconds): T x gh x gw uint8."""
    from pipelib import probe
    W, H = size or (lambda p: (p['width'], p['height']))(probe(path))
    gh = int(round(H * gw / W))
    cmd = ['ffmpeg', '-v', 'error', '-nostdin', '-ss', str(max(0.0, s0)), '-i', path, '-t', str(s1 - s0), '-an', '-sn',
           '-vf', f'fps={fps:g},scale={gw}:{gh}:flags=area,format=gray', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode:
        raise RuntimeError('ffmpeg failed: ' + r.stderr.decode('utf-8', 'replace')[-500:])
    a = np.frombuffer(r.stdout, np.uint8)
    n = len(a) // (gw * gh)
    return a[:n * gw * gh].reshape(n, gh, gw), (W, H)


def measure(runs, fps=5.0, gw=GRID, thr=THR):
    """Change counts over runs [(path, s0, s1)] (pairs are taken inside a run, never across a cut): (counts, pairs, (W, H))."""
    total, pairs, wh = None, 0, None
    for path, s0, s1 in runs:
        fr, wh = read_gray(path, s0, s1, fps, gw)
        if len(fr) < 2:
            continue
        c, p = change_counts(fr, thr)
        total = c if total is None else total + c
        pairs += p
    if total is None:
        raise ValueError('fewer than two frames in the stretch: make it longer (or raise --fps)')
    return total, pairs, wh


def focus(path, s0, s1, frame=None, masks=(), max_zoom=2.0, pad=PAD, fps=5.0, place=None, ignore=()):
    """The framing of the change in source seconds s0..s1 of a file (see the module docstring)."""
    counts, pairs, (W, H) = measure([(path, s0, s1)], fps)
    return analyse(counts, pairs, W, H, frame, masks, max_zoom, pad, place, ignore)


def focus_rough(t0, t1, src, cut, frame=None, masks=(), max_zoom=2.0, pad=PAD, fps=5.0, place=None, ignore=()):
    """The same for the ROUGH stretch t0..t1: the source stretches under it come from edl.json, `frame` defaults to the rough's size."""
    from faces import src_runs
    from pipelib import read_json
    from tmap import load
    T = load(cut.edl)
    edl = T.edl
    runs = [r for r in src_runs(T.items, t0, t1) if r['src'] == src]
    if not runs:
        raise ValueError(f'source {src} has no sound under the rough {t0}-{t1}')
    if frame is None:
        r = read_json(cut.rough_json)
        frame = (r['width'], r['height'])
    counts, pairs, (W, H) = measure([(cut.p(edl['sources'][src]['file']), r['s0'], r['s1']) for r in runs], fps)
    if place is None and (W, H) != tuple(frame):
        raise ValueError(f'the source is {W}x{H} and the picture {frame[0]}x{frame[1]}: say how it is placed (place=(scale, ox, oy))')
    return analyse(counts, pairs, W, H, frame, masks, max_zoom, pad, place, ignore)


def cam_from_faces(name_or_path, cut=None):
    """The inset guess from a faces-<name>.json (the median face box over the whole track)."""
    from faces import load_faces
    f = load_faces(name_or_path, cut)
    b = np.array([s['box'] for s in f['samples'] if s['box']])
    if not len(b):
        raise ValueError('no face in that faces file')
    W, H = f['size']
    return cam_rect([float(v) for v in np.median(b, axis=0)], W, H)


def draw(path, t, result, masks, ignore, out):
    """A still of the source at second t with the changing box (green), the zoom box (yellow, in source pixels) and the masks (red; orange for the ignored inset)."""
    from PIL import Image, ImageDraw
    tmp = out + '.tmp.png'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(t), '-i', path, '-frames:v', '1', tmp], check=True)
    im = Image.open(tmp).convert('RGB')
    d = ImageDraw.Draw(im)
    if result.get('box'):
        d.rectangle(result['box'], outline=(0, 255, 0), width=3)
    k, ox, oy = result['place']
    x, y, w, h = result['crop']
    d.rectangle([(x - ox) / k, (y - oy) / k, (x + w - ox) / k, (y + h - oy) / k], outline=(255, 255, 0), width=5)
    for r, col in [(r, (255, 0, 0)) for r in masks] + [(r, (255, 140, 0)) for r in ignore]:
        d.rectangle([r[0], r[1], r[0] + r[2], r[1] + r[3]], outline=col, width=3)
    im.save(out)
    os.remove(tmp)


# ---------------------------------------------------------------------------------------------------------------- command line

def _ints(s):
    return [int(round(float(v))) for v in s.split(',')]


def main(argv=None):
    from pipelib import Cut
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('source', help='a file (t0 t1 are its seconds), or with --rough an edl source key (t0 t1 are rough seconds)')
    ap.add_argument('t0', type=float)
    ap.add_argument('t1', type=float)
    ap.add_argument('--rough', action='store_true')
    ap.add_argument('--video')
    ap.add_argument('--frame', type=_ints, help='W,H of the picture zoomed (default: the rough, or the source)')
    ap.add_argument('--place', type=lambda s: [float(v) for v in s.split(',')], help='scale,ox,oy: picture = source * scale + (ox, oy)')
    ap.add_argument('--mask', type=_ints, action='append', default=[], help='x,y,w,h of a region to leave out (source pixels); repeat')
    ap.add_argument('--cam', help='a faces file (name or path): leave the webcam inset out of the measure, found from where the face is (a guess: look at --draw)')
    ap.add_argument('--max-zoom', type=float, default=2.0)
    ap.add_argument('--pad', type=float, default=PAD)
    ap.add_argument('--fps', type=float, default=5.0)
    ap.add_argument('--id', default='F1')
    ap.add_argument('--draw', help='save a still with the boxes drawn on it')
    a = ap.parse_args(argv)
    masks = [tuple(m) for m in a.mask]
    ignore = [cam_from_faces(a.cam, Cut(a.video) if a.rough else None)] if a.cam else []
    frame = tuple(a.frame) if a.frame else None
    place = tuple(a.place) if a.place else None
    if a.rough:
        from pipelib import read_json
        cut = Cut(a.video)
        res = focus_rough(a.t0, a.t1, a.source, cut, frame, masks, a.max_zoom, a.pad, a.fps, place, ignore)
        path = cut.p(read_json(cut.edl)['sources'][a.source]['file'])
        from faces import src_runs
        from tmap import load
        run = [r for r in src_runs(load(cut.edl).items, a.t0, a.t1) if r['src'] == a.source][0]
        mid = (run['s0'] + run['s1']) / 2
    else:
        path, mid = a.source, (a.t0 + a.t1) / 2
        res = focus(path, a.t0, a.t1, frame, masks, a.max_zoom, a.pad, a.fps, place, ignore)
    print(json.dumps(res))
    z = f"E.zoom('{a.id}', {a.t0}, {a.t1}, x={res['x']}, y={res['y']}, zoom={res['zoom']}" + (f", mask={res['mask']}" if res.get('mask') else '') + ')'
    print(z + (f"   # {res['note']}" if res.get('note') else ''))
    if a.draw:
        from pipelib import probe
        p = probe(path)
        res['frame'] = list(frame or (p['width'], p['height']))
        res['place'] = list(place or (1, 0, 0))
        draw(path, mid, res, masks, ignore, a.draw)
    return 0


if __name__ == '__main__':
    sys.exit(main())
