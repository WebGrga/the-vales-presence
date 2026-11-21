"""The sound of a rough cut: pieces of source sound joined with short equal-power crossfades, in samples. Pure numpy (the ffmpeg reading is in build_rough.py), tested by test_joins.py.

A join between two pieces of source sound is a CENTRED crossfade: each side reaches `xf` seconds (12 ms) past its edge into the recording and the two fade over 2 x xf, so the
rough keeps its length and every picture frame stays where the edit list put it. Equal power (cos/sin): the room tone each side of a join is a different stretch of noise, so
the sum stays level. A piece that meets silence (a hold, a wait, the start or end of the rough) fades 10 ms (raised cosine) inside itself. Two pieces that play one stretch
straight on (the split of an item) are joined with no fade: they are the same samples.
"""
import math

import numpy as np

SR = 48000
XF = 0.012
EDGE = 0.010


def plan(items, fps, sr=SR, xf=XF, edge=EDGE):
    """One dict per item, in samples: start, n, src (None = silent), t0 (source second the piece starts), hl/hr (extra samples read before/after for the crossfades),
    fin/fout (a fade inside the piece at an edge that meets silence). Items' lengths are whole frames, so start/n are exact."""
    out, fr = [], 0
    for it in items:
        a = int(round(fr * sr / fps))                     # whole frames, counted from the start: the 3-decimal `len`s of the list would drift by a few samples each
        fr += max(1, int(round(it['len'] * fps)))
        n = int(round(fr * sr / fps)) - a
        src = it.get('src') if 'src_in' in it and 'src_out' in it else None
        out.append({'start': a, 'n': n, 'src': src, 't0': it['src_in'] if src else None, 'hl': 0, 'hr': 0, 'fin': 0, 'fout': 0})
    for k, p in enumerate(out):
        if p['src'] is None:
            continue
        prev = out[k - 1] if k else None
        if prev is not None and prev['src'] == p['src'] and abs(items[k]['src_in'] - items[k - 1]['src_out']) < 0.004:
            p['t0'] = items[k - 1]['src_out']                    # one stretch straight on: no fade, the very same samples
        elif prev is not None and prev['src'] is not None:
            h = min(int(round(xf * sr)), prev['n'] // 4, p['n'] // 4)
            p['hl'], prev['hr'] = h, h
        else:
            p['fin'] = min(int(round(edge * sr)), p['n'] // 4)
        nxt = out[k + 1] if k + 1 < len(out) else None
        if nxt is None or nxt['src'] is None:
            p['fout'] = min(int(round(edge * sr)), p['n'] // 4)
    return out


def render(pl, fetch, channels=2):
    """The whole rough sound: fetch(src, t0, count) -> (count, channels) float32 of the recording from source second t0 (zeros outside it)."""
    total = pl[-1]['start'] + pl[-1]['n'] if pl else 0
    out = np.zeros((total, channels), dtype=np.float32)
    for p in pl:
        if p['src'] is None:
            continue
        sr = SR
        a = fetch(p['src'], p['t0'] - p['hl'] / sr, p['hl'] + p['n'] + p['hr']).astype(np.float32)
        g = np.ones(len(a), dtype=np.float32)
        if p['hl']:
            th = (np.arange(2 * p['hl']) + 0.5) / (2 * p['hl']) * (math.pi / 2)
            g[:2 * p['hl']] = np.sin(th)
        if p['hr']:
            th = (np.arange(2 * p['hr']) + 0.5) / (2 * p['hr']) * (math.pi / 2)
            g[len(a) - 2 * p['hr']:] = np.cos(th)
        if p['fin']:
            g[:p['fin']] *= np.sin((np.arange(p['fin']) + 0.5) / p['fin'] * (math.pi / 2)) ** 2
        if p['fout']:
            g[len(a) - p['fout']:] *= np.cos((np.arange(p['fout']) + 0.5) / p['fout'] * (math.pi / 2)) ** 2
        a = a * g[:, None]
        s0 = p['start'] - p['hl']
        lo = max(0, s0)
        out[lo:s0 + len(a)] += a[lo - s0:]
    return out
