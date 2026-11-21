"""Faces: the framing maths and what the cut makes of it. A crop that holds a face (`fit_axis`, `window_for`), the E.zoom box (`punch_box`), the vertical
crop (`reframe_box`), the stretches of sources under a rough stretch (`src_runs`), and `punch` / `reframe` over an edl.json. See faces.py."""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from faces_data import stats, to_frame
from faces_track import load_faces

def fit_axis(need_lo, need_hi, view, total, pref):
    """Where a window of length `view` starts on an axis of length `total` so that need_lo..need_hi is inside, as close to `pref` as it can be.
    Returns (start, ok). When the need is wider than the window, ok is False and the window is centred on the need. Never leaves 0..total."""
    need_lo, need_hi = max(0.0, need_lo), min(float(total), need_hi)
    lo, hi = max(0.0, need_hi - view), min(total - view, need_lo)
    if lo <= hi + 1e-9:
        return min(max(pref, lo), hi if hi >= lo else lo), True
    mid = (need_lo + need_hi) / 2
    return min(max(mid - view / 2, 0.0), max(total - view, 0.0)), False


HEAD = 0.25      # room above the box's top, in face heights (the box starts at the brow; hair is above)
CHIN = 0.12      # room under the box's bottom, in face heights (chin and mouth stay in)
SIDE = 0.10      # room left and right, in face widths
TURN = 0.06      # how far the face sits off centre toward where it looks, in crop widths, at a full turn
THIRD = 1 / 3    # the eyes this far down the crop


def window_for(st, W, H, zoom, aspect=None):
    """A crop of the W x H picture at `zoom` (width W/zoom, height H/zoom, or with `aspect` a crop of that shape as tall as H/zoom) placed from the
    face stats `st` (in the picture's pixels). Returns (x, y, w, h, ok): ok is True (margins held), 'tight' (the box is in, the margins are not) or False."""
    h = H / zoom
    w = W / zoom if aspect is None else min(W, h * aspect)
    if aspect is not None and w == W:
        h = w / aspect
    x0, y0, x1, y1 = st['box']
    fh, fw = st['fh'], st['fw']
    ey = st['eyes'][1]
    cx = (x0 + x1) / 2
    y, oky = fit_axis(y0 - HEAD * fh, y1 + CHIN * fh, h, H, ey - h * THIRD)
    x, okx = fit_axis(x0 - SIDE * fw, x1 + SIDE * fw, w, W, cx - w / 2 + TURN * st['look'] * w)
    if oky and okx:
        return x, y, w, h, True
    # the margins do not fit: the box itself still may (tight); else the face is wider than the crop
    y2, oky2 = fit_axis(y0, y1, h, H, ey - h * THIRD) if not oky else (y, True)
    x2, okx2 = fit_axis(x0, x1, w, W, cx - w / 2 + TURN * st['look'] * w) if not okx else (x, True)
    return x2, y2, w, h, ('tight' if oky2 and okx2 else False)


def punch_box(st, W, H, scale=1.1):
    """The E.zoom box for a face (stats in the picture's pixels): {'x', 'y', 'zoom', 'fits', 'asked'}. The zoom drops from `scale` toward 1 by 0.01
    until the face over the whole stretch fits with its margins (`fits` is then False: the zoom is lower than asked); at 1 the crop is the frame."""
    asked = max(1.0, float(scale))
    z = asked
    while True:
        x, y, w, h, ok = window_for(st, W, H, z)
        if ok is True or z <= 1.0 + 1e-9:
            break
        z = max(1.0, round(z - 0.01, 4))
    x = max(0.0, min(x, W - W / z))
    y = max(0.0, min(y, H - H / z))
    # floor to a tenth so x + W/zoom never passes the frame (events.py checks it)
    return {'x': int(x * 10) / 10, 'y': int(y * 10) / 10, 'zoom': round(z, 3), 'fits': z >= asked - 1e-9, 'asked': round(asked, 3)}


def reframe_box(st, bounds, aspect=9 / 16, zoom=1.0):
    """A crop of the source with the shape `aspect` (width / height), inside `bounds` = (x, y, w, h), that holds the face stats `st` (source pixels):
    as tall as bounds / zoom, even numbers (h264). Returns {'x', 'y', 'w', 'h', 'fits'}."""
    bx, by, bw, bh = bounds
    local = dict(st, box=[st['box'][0] - bx, st['box'][1] - by, st['box'][2] - bx, st['box'][3] - by], eyes=[st['eyes'][0] - bx, st['eyes'][1] - by])
    x, y, w, h, ok = window_for(local, bw, bh, max(1.0, zoom), aspect)
    w2, h2 = int(round(w / 2)) * 2, int(round(h / 2)) * 2
    w2, h2 = w2 - 2 * (w2 > bw), h2 - 2 * (h2 > bh)                 # even, and never past the bounds
    xi = int(round(min(max(x, 0.0), bw - w2) / 2)) * 2
    yi = int(round(min(max(y, 0.0), bh - h2) / 2)) * 2
    return {'x': int(bx + xi), 'y': int(by + yi), 'w': w2, 'h': h2, 'fits': bool(ok), 'tight': ok == 'tight'}


# ---------------------------------------------------------------------------------------------------------------- pure: rough time -> source runs

def src_runs(items, t0, t1):
    """The stretches of sources under rough time t0..t1: [{src, at, end, s0, s1}], in rough order. Items without sound from a source (a sped wait, a
    still, a card) are skipped; neighbours that are one unbroken stretch of the same source (no cut between them) are one run."""
    runs = []
    for it in sorted(items, key=lambda i: i['at']):
        if 'src' not in it or 'src_in' not in it:
            continue
        a, b = max(t0, it['at']), min(t1, it['at'] + it['len'])
        if b - a <= 1e-6:
            continue
        s0 = it['src_in'] + (a - it['at'])
        s1 = s0 + (b - a)
        r = runs[-1] if runs else None
        if r and r['src'] == it['src'] and abs(r['s1'] - s0) < 0.05 and abs(r['end'] - a) < 1e-3:
            r['end'], r['s1'] = b, s1
        else:
            runs.append({'src': it['src'], 'at': a, 'end': b, 's0': s0, 's1': s1})
    return runs


def _edl_items(cut):
    from tmap import load
    T = load(cut.edl)
    return T.items, T.edl


def _faces_for(src, cut, out=None):
    return load_faces(src, cut=cut, out=out)


def _stats_for(runs, faces_by_src):
    """Face stats over several runs, merged: the box that holds all of them."""
    sts = []
    for r in runs:
        f = faces_by_src(r['src'])
        st = stats(f['samples'], r['s0'], r['s1'])
        if st:
            sts.append((st, r['end'] - r['at']))
    if not sts:
        return None
    if len(sts) == 1:
        return sts[0][0]
    w = np.array([d for _, d in sts])
    box = [min(s['box'][0] for s, _ in sts), min(s['box'][1] for s, _ in sts), max(s['box'][2] for s, _ in sts), max(s['box'][3] for s, _ in sts)]
    return {'n': sum(s['n'] for s, _ in sts), 'found': float(np.average([s['found'] for s, _ in sts], weights=w)), 'box': box,
            'eyes': [float(np.average([s['eyes'][i] for s, _ in sts], weights=w)) for i in (0, 1)],
            'look': float(np.average([s['look'] for s, _ in sts], weights=w)), 'fh': float(np.average([s['fh'] for s, _ in sts], weights=w)),
            'fw': float(np.average([s['fw'] for s, _ in sts], weights=w))}


def _runs(t0, t1, src, cut):
    if src == 'rough':
        return [{'src': 'rough', 'at': t0, 'end': t1, 's0': t0, 's1': t1}]
    items, _ = _edl_items(cut)
    runs = src_runs(items, t0, t1)
    if src:
        runs = [r for r in runs if r['src'] == src]
    return runs


def _pick_src(src, cut):
    if src:
        return src
    import glob
    names = [os.path.basename(p)[6:-5] for p in glob.glob(os.path.join(cut.work, 'faces-*.json'))]
    if len(names) == 1:
        return names[0]
    raise ValueError(f'say which source (src=): faces files here are {names or "none (run track first)"}')


def punch(t0, t1, scale=1.1, src=None, cut=None, place=None, frame=None, out=None):
    """The E.zoom box for the ROUGH stretch t0..t1: {'x', 'y', 'zoom', 'fits', 'asked', 'eyes', 'face', 'n'} (x, y, zoom for E.zoom).
    `src` the source key (or 'rough' for a faces file made on rough.mp4), `place` = (scale, ox, oy) when the source is placed in the rough (source
    pixel * scale + offset), `frame` = (w, h) of the picture zoomed (default the rough's size). Raises when no face was found in the stretch."""
    from pipelib import Cut
    cut = cut or Cut()
    src = _pick_src(src, cut)
    runs = _runs(t0, t1, src, cut)
    cache = {}
    get = lambda s: cache.setdefault(s, _faces_for(s, cut, out))
    st = _stats_for(runs, get)
    if not st:
        raise ValueError(f'no face found between {t0} and {t1} (source {src}): the faces file has no sample there')
    if frame is None:
        from pipelib import read_json
        r = read_json(cut.rough_json)
        frame = (r['width'], r['height'])
    W, H = frame
    if place is None:
        sw, sh = get(runs[0]['src'])['size']
        if (sw, sh) != (W, H) and src != 'rough':
            raise ValueError(f'the source is {sw}x{sh} and the picture {W}x{H}: say how it is placed (place=(scale, ox, oy))')
    b = punch_box(to_frame(st, place), W, H, scale)
    b.update(n=st['n'], eyes=[round(v, 1) for v in to_frame(st, place)['eyes']], face=[round(v, 1) for v in to_frame(st, place)['box']])
    return b


def reframe(t0, t1, aspect=9 / 16, src=None, cut=None, bounds=None, zoom=1.0, out=None):
    """Vertical crops of the SOURCE for the ROUGH stretch t0..t1: [{at, end, src, from, to, x, y, w, h, crop, fits, face}], one per run between cuts
    (the crop is steady inside a run). `bounds` = (x, y, w, h) the crop must stay inside (default the faces file's region, else the whole frame).
    `crop` is the ffmpeg filter. A run with no face reuses the last crop (face False)."""
    from pipelib import Cut
    cut = cut or Cut()
    src = _pick_src(src, cut)
    runs = _runs(t0, t1, src, cut)
    out_list, last = [], None
    cache = {}
    for r in runs:
        f = cache.setdefault(r['src'], _faces_for(r['src'], cut, out))
        sw, sh = f['size']
        bd = bounds or f.get('region') or (0, 0, sw, sh)
        st = stats(f['samples'], r['s0'], r['s1'])
        if st:
            box = reframe_box(st, bd, aspect, zoom)
            last = box
        elif last:
            box = dict(last, fits=False)
        else:
            h = int(bd[3] / max(1.0, zoom) // 2 * 2)
            w = int(min(bd[2], h * aspect) // 2 * 2)
            box = {'x': int(bd[0] + (bd[2] - w) // 2 // 2 * 2), 'y': int(bd[1]), 'w': w, 'h': h, 'fits': False}
        out_list.append({'at': round(r['at'], 3), 'end': round(r['end'], 3), 'src': r['src'], 'from': round(r['s0'], 3), 'to': round(r['s1'], 3),
                         **box, 'crop': f"crop={box['w']}:{box['h']}:{box['x']}:{box['y']}", 'face': bool(st)})
    return out_list
