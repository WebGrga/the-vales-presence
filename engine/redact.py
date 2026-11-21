"""Blur / redact boxes: a box of the rough's picture blurred, pixelated or filled over a time range, drawn by ffmpeg in the compose pass.

An event of kind "blur" (in events.json, or a box you drew in the viewer, kept in video/out/redactions.json):
    {"id": "B1", "kind": "blur", "at": 12.0, "end": 15.5, "box": [x, y, w, h], "mode": "blur"|"pixelate"|"fill", "strength": 24, "color": "#000000"}
`box` is in the rough's pixels (the picture before any zoom: a zoom over it scales the blur with it), `strength` is the blur radius or the size of a
pixel block (default: a fifth of the box's short side, at least 8 for a blur, 16 for pixelate), `color` the fill colour. Blur boxes never make an
overlay window and never touch Remotion: a chunk of the final that one overlaps is re-encoded, nothing else.

video/out/redactions.json (written by the screen, read here; the agent may add boxes too):
    {"version": 1, "boxes": [{"id": "R1", "at": 12.0, "end": 15.5, "x": 100, "y": 40, "w": 300, "h": 60, "mode": "blur", "note": "..."}]}
Its boxes become events with the id "user-<id>" (so they never clash with the visuals' own ids).
"""
import os

MODES = ('blur', 'pixelate', 'fill')
PREFIX = 'user-'


def even_box(box, W, H):
    """[x, y, w, h] clamped to the frame, on even pixels (yuv420p crops need them), at least 2x2. None when nothing of it is in the frame."""
    try:
        x, y, w, h = (float(v) for v in box)
    except (TypeError, ValueError):
        return None
    x0, y0 = max(0.0, x), max(0.0, y)
    x1, y1 = min(float(W), x + w), min(float(H), y + h)
    if x1 - x0 < 2 or y1 - y0 < 2:
        return None
    ex, ey = int(x0) // 2 * 2, int(y0) // 2 * 2
    ew = max(2, int(x1 - ex) // 2 * 2)
    eh = max(2, int(y1 - ey) // 2 * 2)
    ew, eh = min(ew, (W - ex) // 2 * 2), min(eh, (H - ey) // 2 * 2)
    return [ex, ey, ew, eh] if ew >= 2 and eh >= 2 else None


def strength_of(e, w, h):
    s = e.get('strength')
    short = min(w, h)
    if e.get('mode', 'blur') == 'pixelate':
        n = int(s) if isinstance(s, (int, float)) and s >= 2 else max(16, short // 5)
        return max(2, min(n, short))
    n = int(s) if isinstance(s, (int, float)) and s >= 1 else max(8, short // 5)
    return max(1, min(n, short // 4 - 1 if short >= 8 else 1))       # chroma planes are half size: boxblur needs radius <= their half


def validate_blur(e, W, H):
    """Plain-words problems with one blur event (empty = fine)."""
    i, bad = e.get('id', '?'), []
    b = e.get('box')
    if not (isinstance(b, list) and len(b) == 4 and all(isinstance(v, (int, float)) for v in b)):
        return [f'{i}: a blur needs "box": [x, y, w, h] in the rough\'s pixels']
    if b[2] <= 0 or b[3] <= 0:
        bad.append(f'{i}: the blur box has no size')
    elif even_box(b, W, H) is None:
        bad.append(f'{i}: the blur box {b} is outside the {W}x{H} frame')
    if e.get('mode', 'blur') not in MODES:
        bad.append(f'{i}: blur mode "{e.get("mode")}" is not one of {", ".join(MODES)}')
    return bad


def blurs(doc):
    """The blur events that draw, in time order."""
    return sorted([e for e in doc.get('events', []) if e.get('kind') == 'blur' and e.get('render') is not False], key=lambda e: (e['at'], e['id']))


def effect(e, w, h):
    mode = e.get('mode', 'blur')
    if mode == 'fill':
        col = '0x' + str(e.get('color') or '#000000').lstrip('#')
        return f'drawbox=x=0:y=0:w={w}:h={h}:color={col}:t=fill'
    n = strength_of(e, w, h)
    if mode == 'pixelate':
        return f'scale={max(1, w // n)}:{max(1, h // n)}:flags=area,scale={w}:{h}:flags=neighbor'
    c = max(1, min(n // 2, min(w, h) // 4 - 1 if min(w, h) >= 8 else 1))
    return f'boxblur=luma_radius={n}:luma_power=3:chroma_radius={c}:chroma_power=3'


def blur_lines(evs, inp, out, W, H, t_off=0.0, tag='rb'):
    """Filter lines that take `inp` to `out` with every blur box drawn while it is on. `t_off` = the rough time of the stream's t = 0 (a chunk, a proof
    clip). [] when there are no boxes (the caller keeps its graph as it was)."""
    evs = [(e, even_box(e['box'], W, H)) for e in evs]
    evs = [(e, b) for e, b in evs if b]
    if not evs:
        return []
    lines, cur = [], inp
    for k, (e, (x, y, w, h)) in enumerate(evs):
        nxt = out if k == len(evs) - 1 else f'[{tag}{k}]'
        on = f"between(t+{t_off:.6f},{e['at']},{e['end']})"
        lines.append(f'{cur}split[{tag}m{k}][{tag}c{k}]')
        lines.append(f'[{tag}c{k}]crop={w}:{h}:{x}:{y},{effect(e, w, h)}[{tag}e{k}]')
        lines.append(f"[{tag}m{k}][{tag}e{k}]overlay={x}:{y}:format=auto:enable='{on}'{nxt}")
        cur = nxt
    return lines


def prepend(lines, graph, label):
    """Put blur `lines` (which end in `label`) in front of a graph whose first line reads `[0:v]` or `[c0]`: that first input becomes `label`."""
    if not lines:
        return graph
    src = lines[0][:lines[0].index(']') + 1]
    first = graph[0].replace(src, label, 1)
    return lines + [first] + graph[1:]


def overlapping(doc, a, b):
    """The blur events on screen between rough seconds a and b."""
    return [e for e in blurs(doc) if e['at'] < b and e['end'] > a]


# ---------------------------------------------------------------------------------------------------------------- redactions.json

def box_events(red, W, H):
    """The boxes of a redactions.json document as blur events (bad ones left out, with the reason)."""
    out, skipped = [], []
    for b in (red or {}).get('boxes', []) if isinstance(red, dict) else []:
        if not isinstance(b, dict) or not b.get('id'):
            skipped.append('a box without an id')
            continue
        try:
            at, end = round(float(b['at']), 3), round(float(b['end']), 3)
            box = [float(b['x']), float(b['y']), float(b['w']), float(b['h'])]
        except (KeyError, TypeError, ValueError):
            skipped.append(f'{b["id"]}: needs at, end, x, y, w, h')
            continue
        if end <= at or even_box(box, W, H) is None:
            skipped.append(f'{b["id"]}: empty in time or outside the frame')
            continue
        e = {'id': PREFIX + str(b['id']), 'kind': 'blur', 'at': at, 'end': end, 'box': [round(v) for v in box], 'mode': b.get('mode') if b.get('mode') in MODES else 'blur',
             'what': 'your box' + (f': {b["note"]}' if b.get('note') else '')}
        for k in ('strength', 'color'):
            if b.get(k) is not None:
                e[k] = b[k]
        out.append(e)
    return out, skipped


def redactions_path(cut):
    return os.path.join(cut.out, 'redactions.json')
