"""scan.py's part for the picture: waits (no words for 4 s or more) and how the screen moves in them."""
import subprocess
from concurrent.futures import ThreadPoolExecutor

import numpy as np

import pipelib

WAIT_MIN = 4.0
PIC_FPS = 2
PIC_W, PIC_H = 320, 180
PIC_PIXEL = 16                 # grey levels a pixel must change between two samples to count
PIC_AREA = 0.002               # share of pixels that changed: a sample pair is "moving" over this
PIC_BUSY = 0.4                 # share of moving sample pairs: busy over this
PIC_WHOLE = 20.0               # a wait up to this long is sampled whole; a longer one in PIC_WINDOWS windows of PIC_WINDOW s
PIC_WINDOWS, PIC_WINDOW = 4, 5.0
INSET = (0.30, 0.40)           # a corner block (share of width, of height) that moves 4x more than the rest is a camera inset and is left out

def find_waits(words, duration, min_len=WAIT_MIN):
    """[[s, e]] stretches with no word for at least min_len s (the start and the end of the recording count)."""
    out = []
    t = 0.0
    for s, e, _ in words:
        if s - t >= min_len:
            out.append([round(t, 3), round(s, 3)])
        t = max(t, e)
    if duration - t >= min_len:
        out.append([round(t, 3), round(duration, 3)])
    return out


def wait_speed(length):
    """The speed that plays a wait in about 3 s, clamped 2..20."""
    return round(min(20.0, max(2.0, length / 3.0)), 1)


def wait_windows(s, e):
    """The stretches of a wait whose picture is sampled: all of it up to PIC_WHOLE s, else PIC_WINDOWS windows of PIC_WINDOW s spread over it."""
    if e - s <= PIC_WHOLE:
        return [(s, e)]
    step = (e - s) / PIC_WINDOWS
    return [(round(s + step * (i + 0.5) - PIC_WINDOW / 2, 3), round(s + step * (i + 0.5) + PIC_WINDOW / 2, 3)) for i in range(PIC_WINDOWS)]


def inset_corner(changed):
    """'top-left' ... 'bottom-right' when one corner block moves 4x more than the rest of the picture (a camera strip with a person in
    it), else None. `changed` is (pairs, h, w) booleans."""
    h, w = changed.shape[1:]
    bh, bw = int(h * INSET[1]), int(w * INSET[0])
    total = changed.sum()
    best = None
    for name, (ys, xs) in {'top-left': (slice(0, bh), slice(0, bw)), 'top-right': (slice(0, bh), slice(w - bw, w)),
                           'bottom-left': (slice(h - bh, h), slice(0, bw)), 'bottom-right': (slice(h - bh, h), slice(w - bw, w))}.items():
        inside = changed[:, ys, xs].sum()
        rate_in = inside / (len(changed) * bh * bw)
        rate_out = (total - inside) / (len(changed) * (h * w - bh * bw))
        if rate_in >= 0.01 and rate_in >= 4 * rate_out and (best is None or rate_in > best[0]):
            best = (rate_in, name)
    return best[1] if best else None


def picture_verdict(stacks):
    """(screen, moving, inset) from grey sample frames, one (n, h, w) array or a list of them (sample pairs never cross two arrays).
    `moving` is the share of sample pairs where over PIC_AREA of the pixels changed by PIC_PIXEL grey levels or more; screen is "busy"
    when that share is over PIC_BUSY, else "still". A corner that moves far more than the rest (a camera strip) is left out first and
    named in `inset`. Fewer than two frames: still."""
    if isinstance(stacks, np.ndarray) and stacks.ndim == 3:
        stacks = [stacks]
    diffs = [np.abs(np.diff(np.asarray(f).astype(np.int16), axis=0)) >= PIC_PIXEL for f in stacks if len(f) >= 2]
    if not diffs:
        return 'still', 0.0, None
    d = np.concatenate(diffs)
    inset = inset_corner(d)
    if inset:
        h, w = d.shape[1:]
        bh, bw = int(h * INSET[1]), int(w * INSET[0])
        keep = np.ones((h, w), dtype=bool)
        keep[(h - bh if 'bottom' in inset else 0):(h if 'bottom' in inset else bh), (w - bw if 'right' in inset else 0):(w if 'right' in inset else bw)] = False
        share = d[:, keep].mean(axis=1)
    else:
        share = d.reshape(len(d), -1).mean(axis=1)
    moving = float((share > PIC_AREA).mean())
    return ('busy' if moving > PIC_BUSY else 'still'), round(moving, 3), inset


def sample_picture(path, s, e, has_video=True):
    """Grey PIC_W x PIC_H frames of path from s to e, PIC_FPS a second (None when ffmpeg gives nothing)."""
    if not has_video or e - s <= 0:
        return None
    cmd = ['ffmpeg', '-v', 'error', '-ss', f'{s:.3f}', '-t', f'{e - s:.3f}', '-i', path, '-map', '0:v:0', '-an', '-sn',
           '-vf', f'fps={PIC_FPS},scale={PIC_W}:{PIC_H}:flags=area,format=gray', '-f', 'rawvideo', '-']
    r = subprocess.run(cmd, capture_output=True)
    size = PIC_W * PIC_H
    n = len(r.stdout) // size
    if r.returncode or n < 1:
        return None
    return np.frombuffer(r.stdout[:n * size], dtype=np.uint8).reshape(n, PIC_H, PIC_W)


def measure_waits(path, spans, has_video=True, jobs=4):
    """The `waits` list: [{s, e, screen, speed, moving, inset?, sampled}] for the [s, e] spans. A long wait is sampled in windows."""
    tasks = [(i, w) for i, sp in enumerate(spans) for w in wait_windows(*sp)]
    with ThreadPoolExecutor(max_workers=jobs) as ex:
        got = list(ex.map(lambda t: sample_picture(path, t[1][0], t[1][1], has_video), tasks))
    out = []
    for i, sp in enumerate(spans):
        stacks = [g for (j, _), g in zip(tasks, got) if j == i and g is not None]
        w = {'s': sp[0], 'e': sp[1]}
        if stacks:
            screen, moving, inset = picture_verdict(stacks)
            w.update(screen=screen, speed=wait_speed(sp[1] - sp[0]), moving=moving, sampled=round(sum(len(x) for x in stacks) / PIC_FPS, 1))
            if inset:
                w['inset'] = inset
        else:
            w.update(screen='still', speed=wait_speed(sp[1] - sp[0]), picture='not measured')
        out.append(w)
    return out

def has_video(path):
    try:
        return 'width' in pipelib.probe(path)
    except Exception:
        return False
