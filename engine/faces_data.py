"""Faces: the pure part. Choosing a face among a frame's detections, smoothing a track, the face over a stretch of time, and the move into a picture's
pixels. No ffmpeg, no OpenCV (see faces.py for the whole)."""
import numpy as np

KEYS = ('x0', 'y0', 'x1', 'y1', 'ex', 'ey', 'mx', 'my', 'look')


def iou(a, b):
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / u if u > 0 else 0.0


def look_of(eyes_l, eyes_r, nose):
    """Which way the head turns, in the picture: the nose's offset from the middle of the eyes in eye distances, -1 (left) .. 1 (right).
    Under 0.1 is straight on; 0.35 and over is a full turn."""
    d = float(np.hypot(eyes_r[0] - eyes_l[0], eyes_r[1] - eyes_l[1])) or 1.0
    v = (nose[0] - (eyes_l[0] + eyes_r[0]) / 2) / d
    if abs(v) < 0.1:
        return 0.0
    return float(max(-1.0, min(1.0, v / 0.35)))


def parse_row(row):
    """One YuNet row (x, y, w, h, 5 landmarks, score) -> a face dict in the same pixels."""
    x, y, w, h = row[0:4]
    re_, le, nose, rm, lm = [(row[4 + 2 * i], row[5 + 2 * i]) for i in range(5)]
    return {'box': [x, y, x + w, y + h], 'eyes': [(re_[0] + le[0]) / 2, (re_[1] + le[1]) / 2],
            'mouth': [(rm[0] + lm[0]) / 2, (rm[1] + lm[1]) / 2], 'look': look_of(re_, le, nose), 'conf': float(row[14])}


def pick_face(faces, prev_box=None):
    """The face of the camera among those a frame shows: big and sure, and the one that was there a moment ago (a pixel-art character or an
    avatar is small and unsure; two people are told apart by who was where)."""
    best, best_s = None, 0.0
    for f in faces:
        b = f['box']
        s = f['conf'] * ((b[2] - b[0]) * (b[3] - b[1])) ** 0.5
        if prev_box is not None and iou(prev_box, b) > 0.2:
            s *= 3.0
        if s > best_s:
            best, best_s = f, s
    return best


def _rows(samples):
    a = np.full((len(samples), len(KEYS)), np.nan)
    for i, s in enumerate(samples):
        if s.get('box'):
            a[i] = [*s['box'], *s['eyes'], *s['mouth'], s['look']]
    return a


def smooth(samples, max_gap=1.5, med=5, avg=3):
    """Raw samples [{t, found, box, eyes, mouth, look, conf, n}] -> the same, smoothed: gaps up to `max_gap` s are filled by a straight line
    (`filled`), then each value is the median of `med` neighbours (a one-frame jump to a wrong face or a bad box goes), then the mean of `avg`.
    A gap longer than `max_gap` stays empty (box None). Pure."""
    n = len(samples)
    a = _rows(samples)
    ts = np.array([s['t'] for s in samples], dtype=float)
    ok = ~np.isnan(a[:, 0])
    filled = np.zeros(n, dtype=bool)
    idx = np.flatnonzero(ok)
    for p, q in zip(idx, idx[1:]):
        if q - p > 1 and ts[q] - ts[p] <= max_gap:
            for k in range(p + 1, q):
                u = (ts[k] - ts[p]) / (ts[q] - ts[p])
                a[k] = a[p] * (1 - u) + a[q] * u
                filled[k] = True
    valid = ~np.isnan(a[:, 0])
    m = _window(a, valid, med, np.median)
    r = _window(m, valid, avg, np.mean)
    out = []
    for i, s in enumerate(samples):
        d = {'t': s['t'], 'found': bool(s.get('found')), 'filled': bool(filled[i]), 'conf': round(float(s.get('conf') or 0.0), 2), 'n': s.get('n', 0)}
        if valid[i]:
            v = r[i]
            d.update(box=[round(float(x), 1) for x in v[0:4]], eyes=[round(float(x), 1) for x in v[4:6]], mouth=[round(float(x), 1) for x in v[6:8]],
                     look=round(float(v[8]), 2))
        else:
            d.update(box=None, eyes=None, mouth=None, look=0.0)
        out.append(d)
    return out


def _window(src, valid, w, fn):
    """Each valid row replaced by fn (median or mean) of the valid rows within w // 2 each side."""
    n = len(src)
    out = src.copy()
    h = w // 2
    if w <= 1:
        return out
    for i in np.flatnonzero(valid):
        lo, hi = max(0, i - h), min(n, i + h + 1)
        out[i] = fn(src[lo:hi][valid[lo:hi]], axis=0)
    return out


def stats(samples, s0, s1):
    """The face over the source stretch s0..s1: the box that holds it throughout (5th to 95th percentile of each edge, so one stray frame does not
    widen it), its middle eyes, the median turn and the median face height. A stretch shorter than a sample takes the nearest sample. None when no face."""
    sel = [s for s in samples if s.get('box') and s0 - 1e-6 <= s['t'] <= s1 + 1e-6]
    if not sel:
        near = [s for s in samples if s.get('box')]
        if not near:
            return None
        mid = (s0 + s1) / 2
        best = min(near, key=lambda s: abs(s['t'] - mid))
        if abs(best['t'] - mid) > 1.0:
            return None
        sel = [best]
    a = _rows(sel)
    box = [float(np.percentile(a[:, 0], 5)), float(np.percentile(a[:, 1], 5)), float(np.percentile(a[:, 2], 95)), float(np.percentile(a[:, 3], 95))]
    return {'n': len(sel), 'found': sum(1 for s in sel if s['found']) / len(sel), 'box': box,
            'eyes': [float(np.median(a[:, 4])), float(np.median(a[:, 5]))], 'look': float(np.median(a[:, 8])),
            'fh': float(np.median(a[:, 3] - a[:, 1])), 'fw': float(np.median(a[:, 2] - a[:, 0]))}


def to_frame(st, place):
    """Face stats from source pixels to the picture's pixels: pixel * scale + (ox, oy)."""
    if not place:
        return st
    k, ox, oy = place
    b, e = st['box'], st['eyes']
    return dict(st, box=[b[0] * k + ox, b[1] * k + oy, b[2] * k + ox, b[3] * k + oy], eyes=[e[0] * k + ox, e[1] * k + oy], fh=st['fh'] * k, fw=st['fw'] * k)
