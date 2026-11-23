"""Hold the still stretches of an overlay window instead of rendering every frame of them (the first speed-up of the cut pipeline).

Most overlays sit still for seconds: a ring, a label that has popped in, a diagram step that is built. Chrome used to render every one of those frames.
Now a window is cut into FULL stretches (every frame rendered: something moves) and HOLD stretches (the picture is the same: a few frames are rendered,
one is held by the .mov's own timestamps). How a hold is found (the choice, and why):

  1. PLAN, before any render, from the events themselves. An event's picture can only change near its start (`head` seconds: the pop-in), near its end
     (`tail`: the fade-out) and after each moment its props name (a number inside `props` that falls between `at` and `end` is a time at which a diagram
     step or a text begins: `settle` seconds after it the step has landed). Everything else is a hold candidate, and so is a stretch with nothing on (the
     0.5 s pads and the gaps). Pixel hashing alone cannot do this job: it can only find a still stretch after Chrome has paid for every frame of it.
     An event can say more in events.json: `"still": false` (never hold: a looping animation), `"still": {"from": t, "to": t}` or a list of those
     (declared still: those stretches hold whatever the props say), `"settle": s` (this event's animations settle in s seconds). A template can give
     whole components their numbers in `remotion/stills.json` ({"Ring": {"head": 0.5, "tail": 0.3}, "Band": {"rel": ["after"]}}); see load_table.
  2. VERIFY, by pixels, cheaply: of every hold Chrome also draws its first frame, one just after it (the settle check), one every `verify_every` seconds and the
     last one. They are compared with the frame that is held (premultiplied, max difference of any channel <= TOLERANCE). A hold whose samples differ is not
     trusted: it is rendered in full (a second, targeted render of just that stretch). A wrong guess therefore costs time and never a wrong picture.
     (A change of less than `verify_every` that comes and goes between two samples and is not named by the event would be missed: that is what `still: false` is for.)
  3. PACK: the frames that were rendered go into a .mov with their real timestamps (variable frame rate: ffmpeg's overlay filter shows a frame until the next
     one's timestamp, so a held frame costs nothing at compose time either), and neighbours with identical PNG bytes are dropped as well.

Pure planning functions are tested in test_holds.py; `finish_window` verifies and packs one rendered window.
"""
import hashlib
import json
import math
import os
import subprocess

PARAMS = {'head': 2.4, 'tail': 0.5, 'settle': 2.4, 'lead': 0.3, 'margin_frames': 3, 'min_hold': 0.8, 'verify_every': 1.5, 'verify_first': 0.25,
          'rel': ['after', 'delay'], 'hold': True}
TOLERANCE = 2          # max difference of any channel (0..255, premultiplied) between a sampled frame and the held one: invisible, and zero for a settled picture
VERSION = 1
BIAS = 0.0005          # seconds the packed frames are shifted earlier in compose.py, so rounding can never make a frame arrive late


# ---------------------------------------------------------------------------------------------------------------- the numbers per component

def load_table(cut=None, fmt=None, extra=None):
    """{'default': params, 'comps': {name: overrides}}: the built-in numbers, then the pipeline's remotion/stills.json (and stills-short.json for a Short: the Shorts
    kit's components all animate in under half a second), then the workshop's remotion/stills.json.
    A file is {"default": {...}, "Ring": {"head": 0.5}, ...}: every key but "default" is a component name; values: head, tail, settle, lead (seconds),
    rel (prop keys whose numbers are seconds AFTER the event's start), hold (false = this component never holds)."""
    table = {'default': dict(PARAMS), 'comps': {}}
    here = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'remotion')
    files = [os.path.join(here, 'stills.json')] + ([os.path.join(here, 'stills-short.json')] if fmt == 'short' else [])
    if cut is not None:
        files.append(os.path.join(cut.remotion, 'stills.json'))
    for f in files:
        if os.path.isfile(f):
            try:
                j = json.load(open(f, encoding='utf-8'))
            except ValueError:
                continue
            table['default'].update({k: v for k, v in (j.get('default') or {}).items()})
            for k, v in j.items():
                if k != 'default' and isinstance(v, dict):
                    table['comps'].setdefault(k, {}).update(v)
    if extra:
        table['default'].update(extra)
    return table


def params_of(e, table):
    p = dict(table['default'])
    p.update(table['comps'].get(e.get('comp'), {}))
    if 'settle' in e:
        p['settle'] = p['head'] = float(e['settle'])
    return p


# ---------------------------------------------------------------------------------------------------------------- the plan

TIME_KEYS = ('at', 'at2', 't', 'time', 'start', 'end', 'press', 'after', 'delay')
PAIR_KEYS = ('score', 'env')      # [[time, value], ...]: the first number of each pair is a moment (the show kit's Scoreboard)


def _numbers(x, out, key=None, rel=(), at=0.0):
    """The numbers of an event's props that may be moments: every float (74.5, 25.0), and integers only under a time-like key (at, t, press, after):
    pixel boxes and sizes are integers, and a window of 15 s should not grow a busy zone for every coordinate that happens to fall inside it."""
    if isinstance(x, bool):
        return
    if isinstance(x, (int, float)):
        if isinstance(x, float) or key in TIME_KEYS or key in rel:
            out.append(float(x) + (at if key in rel else 0.0))
    elif isinstance(x, dict):
        for k, v in x.items():
            _numbers(v, out, k, rel, at)
    elif isinstance(x, (list, tuple)):
        if key in PAIR_KEYS and len(x) == 2 and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in x):
            out.append(float(x[0]))
            return
        for v in x:
            _numbers(v, out, key, rel, at)


def declared(e):
    """The event's own word: None (nothing said), False (never hold), or [(from, to)] stretches that are still."""
    s = e.get('still')
    if s is None:
        return None
    if s is False:
        return False
    if isinstance(s, dict):
        s = [s]
    return [(float(x['from']), float(x.get('to', e['end']))) for x in s]


def busy_zones(e, fps, table):
    """[(t0, t1)] seconds in which the picture of event `e` may be changing."""
    p = params_of(e, table)
    at, end = e['at'], e['end']
    m = p['margin_frames'] / fps
    d = declared(e)
    if d is False or not p.get('hold', True):
        return [(at - m, end + m)]
    if d:
        zones, cur = [], at - m
        for a, b in sorted(d):
            if a > cur:
                zones.append((cur, a))
            cur = max(cur, b)
        if cur < end + m:
            zones.append((cur, end + m))
        return zones
    zones = [(at - m, at + p['head']), (end - p['tail'], end + m)]
    nums = []
    _numbers(e.get('props'), nums, None, tuple(p.get('rel') or ()), at)
    for t in nums:
        if at < t < end:
            zones.append((t - p['lead'], t + p['settle']))
    return zones


def merge(zs):
    out = []
    for a, b in sorted(zs):
        if out and a <= out[-1][1]:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


def plan_window(events, a, b, fps, nth=1, table=None):
    """Cut frames a..b-1 of a window (rough frame numbers; a proof renders every nth) into stretches, in order, covering a..b exactly:
    [{'kind': 'full'|'hold', 'a': first frame, 'b': end frame (exclusive)}]. `events` are the events the window draws."""
    table = table or load_table()
    ks = list(range(a, b, nth))
    n = len(ks)
    if n == 0:
        return []
    zones = []
    for e in events:
        zones += busy_zones(e, fps, table)
    flag = [False] * n
    for z0, z1 in merge(zones):
        i0 = max(0, int(math.ceil((z0 * fps - a) / nth - 1e-9)))
        i1 = min(n, int(math.ceil((z1 * fps - a) / nth - 1e-9)))
        for i in range(i0, i1):
            flag[i] = True
    min_len = max(2, int(math.ceil(table['default']['min_hold'] * fps / nth)))
    runs, i = [], 0
    while i < n:
        j = i
        while j < n and flag[j] == flag[i]:
            j += 1
        runs.append([flag[i], i, j])
        i = j
    for r in runs:                      # a quiet run too short to be worth a hold joins its busy neighbours
        if not r[0] and (r[2] - r[1]) < min_len:
            r[0] = True
    out = []
    for busy, i, j in runs:
        kind = 'full' if busy else 'hold'
        if out and out[-1]['kind'] == kind:
            continue
        out.append({'kind': kind, 'a': ks[i]})
    for k, s in enumerate(out):
        s['b'] = out[k + 1]['a'] if k + 1 < len(out) else b
    return out


def sample_frames(a, b, fps, nth=1, table=None):
    """The frames of a hold that Chrome draws: the first, one soon after (the settle check), one every verify_every seconds, the last."""
    d = (table or load_table())['default']
    step = max(nth, int(round(d['verify_every'] * fps / nth)) * nth)
    first = max(nth, int(round(d['verify_first'] * fps / nth)) * nth)
    fr = {a}
    if a + first < b:
        fr.add(a + first)
    f = a + step
    while f < b:
        fr.add(f)
        f += step
    fr.add(a + ((b - 1 - a) // nth) * nth)
    return sorted(fr)


def calls_for(stretches, fps, nth=1, table=None):
    """The render calls of a window [{'a','b','nth'}] (frames a, a+nth, ... < b): one per full stretch, and for a hold one strided call for its regular samples
    plus single-frame calls for the others; calls that touch are merged, so most holds cost one or two calls (about 0.4 s each)."""
    d = (table or load_table())['default']
    calls = []
    for s in stretches:
        if s['kind'] == 'full':
            calls.append({'a': s['a'], 'b': s['b'], 'nth': nth})
            continue
        step = max(nth, int(round(d['verify_every'] * fps / nth)) * nth)
        regular = set(range(s['a'], s['b'], step))
        calls.append({'a': s['a'], 'b': s['b'], 'nth': step})
        for f in sample_frames(s['a'], s['b'], fps, nth, table):
            if f not in regular:
                calls.append({'a': f, 'b': f + nth, 'nth': nth})
    calls.sort(key=lambda c: (c['a'], c['nth']))
    # a call that only adds frames the neighbour already draws is dropped; contiguous plain calls are merged
    out = []
    for c in calls:
        if out and out[-1]['nth'] == nth and c['nth'] == nth and c['a'] <= out[-1]['b']:
            out[-1]['b'] = max(out[-1]['b'], c['b'])
        else:
            out.append(dict(c))
    return out


def frames_of(calls):
    return sum((c['b'] - c['a'] + c['nth'] - 1) // c['nth'] for c in calls)


def summarize(stretches, nth=1):
    n = lambda k: sum((s['b'] - s['a'] + nth - 1) // nth for s in stretches if s['kind'] == k)
    return {'full': n('full'), 'held': n('hold'), 'holds': sum(1 for s in stretches if s['kind'] == 'hold')}


# ---------------------------------------------------------------------------------------------------------------- verify and pack

def _premult(path):
    import numpy as np
    from PIL import Image
    im = np.asarray(Image.open(path).convert('RGBA'), dtype=np.float32)
    a = im[..., 3:4] / 255.0
    return np.concatenate([im[..., :3] * a, im[..., 3:4]], axis=-1)


def max_diff(path_a, path_b):
    import numpy as np
    return float(np.abs(_premult(path_a) - _premult(path_b)).max())


def md5(path):
    return hashlib.md5(open(path, 'rb').read()).hexdigest()


def fpath(d, f):
    return os.path.join(d, f'f{f}.png')


def verify(d, stretches, fps, nth=1, table=None):
    """Compare the sampled frames of every hold with its last sample (the settled one). Returns (failed holds, {max_diff, samples})."""
    bad, worst, n = [], 0.0, 0
    for s in stretches:
        if s['kind'] != 'hold' or s.get('failed'):
            continue
        fr = [f for f in sample_frames(s['a'], s['b'], fps, nth, table) if os.path.isfile(fpath(d, f))]
        ref = fr[-1]
        s['ref'] = ref
        mx = 0.0
        # equal bytes need no decode
        h_ref = md5(fpath(d, ref))
        for f in fr[:-1]:
            n += 1
            if md5(fpath(d, f)) == h_ref:
                continue
            mx = max(mx, max_diff(fpath(d, f), fpath(d, ref)))
        s['diff'] = mx
        worst = max(worst, mx)
        if mx > TOLERANCE:
            bad.append(s)
    return bad, {'max_diff': worst, 'samples': n}


def pack_list(d, stretches, a, b, fps, nth=1):
    """The frames that go into the .mov: [(frame, png path)] in order, with the hold's reference frame at the start of each hold and neighbours with the same
    bytes dropped; the window's last frame is always an entry (so the .mov ends where the window does)."""
    kept, last_h = [], None
    for s in stretches:
        if s['kind'] == 'hold' and not s.get('failed'):
            frames = [(s['a'], fpath(d, s['ref']))]
        else:
            frames = [(f, fpath(d, f)) for f in range(s['a'], s['b'], nth)]
        for f, p in frames:
            h = md5(p)
            if h != last_h:
                kept.append((f, p))
                last_h = h
    last = a + ((b - 1 - a) // nth) * nth
    if kept[-1][0] != last:
        kept.append((last, kept[-1][1]))
    return kept


def concat_text(kept, a, b, fps, nth=1):
    """ffmpeg concat-demuxer list: each kept frame lasts until the next kept frame's real time (cumulative microseconds: no drift)."""
    us = lambda f: int(round((f - a) * 1e6 / fps))
    lines = []
    for i, (f, p) in enumerate(kept):
        end = kept[i + 1][0] if i + 1 < len(kept) else f + nth
        lines.append(f"file '{p.replace(chr(92), '/')}'\noption framerate 90000\nduration {(us(end) - us(f)) / 1e6:.6f}")
    p = kept[-1][1].replace(chr(92), '/')
    lines.append(f"file '{p}'\noption framerate 90000")
    return '\n'.join(lines) + '\n'


def write_mov(d, kept, out_part, a, b, fps, nth, encode):
    lst = os.path.join(d, 'list.txt')
    with open(lst, 'w', encoding='utf-8') as f:
        f.write(concat_text(kept, a, b, fps, nth))
    cmd = ['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-fps_mode', 'passthrough', *encode, '-video_track_timescale', '90000', '-f', 'mov', out_part]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode:
        raise RuntimeError('ffmpeg could not pack the window: ' + r.stderr[-800:])


def finish_window(d, w, stretches, fps, nth, encode, table=None):
    """Verify a rendered window's holds and pack it. Returns (bad holds, stats); when there are bad holds nothing is packed (they must be rendered in full first,
    then call again with their stretches marked 'failed')."""
    a, b = w['a'], w['b']
    bad, st = verify(d, stretches, fps, nth, table)
    bad = [s for s in bad if not s.get('failed')]
    if bad:
        return bad, st
    kept = pack_list(d, stretches, a, b, fps, nth)
    out = w['file']
    write_mov(d, kept, out + '.part.mov', a, b, fps, nth, encode)
    os.replace(out + '.part.mov', out)
    st['entries'] = len(kept)
    return [], st
