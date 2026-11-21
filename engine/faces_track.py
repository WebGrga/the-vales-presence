"""Faces: reading a source and writing faces-<name>.json. ffmpeg decodes small frames, OpenCV's YuNet finds the face in each; the file is found in
the workshop's video/out/work. See faces.py."""
import json
import os
import subprocess
import sys
import time

import numpy as np

os.environ.setdefault('OPENCV_LOG_LEVEL', 'ERROR')      # OpenCV 5 prints a warning for every detector it makes

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from faces_data import parse_row, pick_face, smooth

PIPE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.path.join(PIPE, 'models', 'face_detection_yunet_2023mar.onnx')
MODEL_NAME = 'yunet-2023mar'
VERSION = 1


def probe_size(path):
    from pipelib import probe
    p = probe(path)
    return p['width'], p['height'], p['duration']


def read_frames(path, fps, region, det_w, start=None, end=None):
    """ffmpeg decodes at `fps`, crops the region, scales to det_w wide: yields (time, bgr array). The ffmpeg's input is read once, in order."""
    W, H, dur = probe_size(path)
    rx, ry, rw, rh = region or (0, 0, W, H)
    dw = min(det_w, rw)
    dh = int(round(rh * dw / rw / 2)) * 2
    dw -= dw % 2
    vf = f'fps={fps},crop={rw}:{rh}:{rx}:{ry},scale={dw}:{dh}:flags=area'
    cmd = ['ffmpeg', '-v', 'error', '-nostdin']
    if start:
        cmd += ['-ss', str(start)]
    cmd += ['-i', path]
    if end is not None:
        cmd += ['-t', str(end - (start or 0))]
    cmd += ['-an', '-sn', '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-']
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    n = dw * dh * 3
    i = 0
    try:
        while True:
            buf = p.stdout.read(n)
            if len(buf) < n:
                break
            yield (start or 0) + i / fps, np.frombuffer(buf, np.uint8).reshape(dh, dw, 3), (dw, dh, rx, ry, rw / dw)
            i += 1
    finally:
        p.stdout.close()
        p.kill()
        p.wait()


def region_around(box, W, H, pad=3.0, min_w=320):
    """Where to look for the camera's face from then on: a rectangle `pad` face-widths around a face box, as even numbers, inside the W x H frame.
    None when the face is already a large part of the frame (a full-frame camera: look everywhere)."""
    fw, fh = box[2] - box[0], box[3] - box[1]
    rw = max(min_w, fw * pad)
    rh = max(min_w * 9 / 16, fh * pad)
    if rw >= 0.6 * W or rh >= 0.6 * H:
        return None
    rw, rh = int(rw // 2 * 2), int(rh // 2 * 2)
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    x = int(min(max(cx - rw / 2, 0), W - rw) // 2 * 2)
    y = int(min(max(cy - rh / 2, 0), H - rh) // 2 * 2)
    return [x, y, rw, rh]


def _detect(path, fps, region, det_w, start, end, min_conf, model):
    """Raw samples [{t, found, n, box, eyes, mouth, look, conf}] of the source (ffmpeg frames, YuNet on each)."""
    import cv2
    det = None
    raw, prev = [], None
    for t, img, (dw, dh, rx, ry, k) in read_frames(path, fps, region, det_w, start, end):
        if det is None:
            det = cv2.FaceDetectorYN.create(model, '', (dw, dh), min_conf, 0.3, 5000)
        _, rows = det.detect(img)
        faces = []
        for row in (rows if rows is not None else []):
            f = parse_row(row)
            f['box'] = [f['box'][0] * k + rx, f['box'][1] * k + ry, f['box'][2] * k + rx, f['box'][3] * k + ry]
            f['eyes'] = [f['eyes'][0] * k + rx, f['eyes'][1] * k + ry]
            f['mouth'] = [f['mouth'][0] * k + rx, f['mouth'][1] * k + ry]
            faces.append(f)
        f = pick_face(faces, prev)
        if f:
            prev = f['box']
            raw.append({'t': round(t, 3), 'found': True, 'n': len(faces), **f})
        else:
            raw.append({'t': round(t, 3), 'found': False, 'n': 0, 'conf': 0.0, 'box': None, 'eyes': None, 'mouth': None, 'look': 0.0})
    return raw


def track(path, fps=4.0, region='auto', start=None, end=None, det_w=640, min_conf=0.6, model=MODEL):
    """Find the face in every sample of the source: (smoothed samples, facts about the run). `region` = [x, y, w, h] to look only there (a webcam
    inset), None to look at the whole frame, 'auto' to find the face in the first 12 s of the range and look only around it after that (the
    camera inset does not move; it is faster and no avatar or sprite on the screen can be taken for the face). Needs cv2 (OpenCV 4.5.4 or later)."""
    if not os.path.isfile(model):
        raise FileNotFoundError(f'face model missing: {model} (download face_detection_yunet_2023mar.onnx from huggingface.co/opencv/face_detection_yunet into models/)')
    t_start = time.time()
    detect = region
    if region == 'auto':
        W, H, _ = probe_size(path)
        s0 = start or 0
        probe_raw = _detect(path, 2, None, det_w, s0, s0 + 12, min_conf, model)
        hits = [r['box'] for r in probe_raw if r['found']]
        detect = None
        if len(hits) >= 3:
            med = [float(np.median([b[i] for b in hits])) for i in range(4)]
            detect = region_around(med, W, H)
    raw = _detect(path, fps, detect, det_w, start, end, min_conf, model)
    secs = time.time() - t_start
    samples = smooth(raw)
    return samples, {'ms': int(secs * 1000), 'samples': len(samples), 'detect': detect,
                     'found': round(sum(1 for s in samples if s['found']) / max(1, len(samples)), 3)}


def workshop_work(source=None, video=None):
    """video/out/work of the workshop: --video, $PRESENCE_VIDEO, the cwd, or the workshop the source file lives in."""
    from pipelib import Cut
    try:
        return Cut(video).work
    except SystemExit:
        pass
    if source and os.path.exists(source):
        d = os.path.dirname(os.path.abspath(source))
        while True:
            if os.path.isdir(os.path.join(d, 'footage')) and os.path.isdir(os.path.join(d, 'out')):
                return os.path.join(d, 'out', 'work')
            p = os.path.dirname(d)
            if p == d:
                break
            d = p
    return None


def faces_path(name, work):
    return os.path.join(work, f'faces-{name}.json')


def load_faces(name_or_path, cut=None, out=None):
    """The faces-<name>.json of a source (by name in the workshop's work folder, or a path)."""
    if os.path.isfile(name_or_path):
        p = name_or_path
    else:
        work = out or (cut.work if cut else workshop_work())
        p = faces_path(name_or_path, work) if work else None
    if not p or not os.path.isfile(p):
        raise FileNotFoundError(f'no faces file for "{name_or_path}": run  python faces.py track <source>  first (it writes video/out/work/faces-<name>.json)')
    with open(p, encoding='utf-8') as f:
        return json.load(f)
