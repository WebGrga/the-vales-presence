"""Join safety of a cut: is every edge of the edit list in the quiet, with its word whole and a little air round it? Measured on the SOURCE audio and the source word files.

    python joins.py check [--video <video/>] [--json] [--src r1]
    python joins.py snap  [--video <video/>] [--dry]

check   every join of edl.json (between two items, and the first and last edge): a kept word clipped (the edge inside a word's span with sound running across it: exit 1),
        a piece of a removed word left in, a cut in continuous speech, less than 0.2 s of room after the last kept word or 0.05 s before the next, an edge not in the quiet
        (sound within 20 ms of it), dead air at the join (over 1 s of air on both sides together), cuts closer than 1.5 s (they play as a stutter). Plain lines; --json also writes
        video/out/work/joins.json. Word times may be loose: the energy near an edge is the truth, the words only name whose sound it is.
snap    moves every edge that has a problem, at most 0.15 s (--reach S to allow more), to the quietest point that keeps the room above and never lands in sound or crosses a word; recomputes at/len back
        to back (whole frames) and rewrites edl.json (the first edit list is kept in out/work/edl.before-snap.json). Exit 2 and nothing changed when the rough has been handed over
        (a lock file or out/rough.json exists): a locked cut goes back to you for review, it is not fixed here. The rough is not rebuilt: run build_rough.py (or the template's build) after.
Recordings are read through their edl `file` (a path relative to video/, or absolute); the audio is the first track unless a source says "track": N. The envelope of a recording is cached in out/work/joins-env/.
"""
import argparse
import copy
import hashlib
import os
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import edl as edlmod
import joins_logic as jl
from pipelib import Cut, read_json, say, write_json
from tmap import read_words


def path_of(cut, rel):
    """A file named in edl.json: relative to video/, or absolute."""
    return rel if os.path.isabs(rel) else cut.p(rel)


def decode(path, track=0, sr=16000):
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vn', '-map', f'0:a:{track}', '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-'], capture_output=True)
    if r.returncode:
        raise SystemExit(f'cannot read the sound of {path}: {r.stderr[-300:].decode(errors="replace")}')
    return np.frombuffer(r.stdout, dtype=np.float32)


def get_env(cut, src):
    """The Env of a source recording, from the cache or made once (about 4 s for 45 minutes)."""
    f = path_of(cut, src['file'])
    st = os.stat(f)
    key = hashlib.sha256(f'{os.path.abspath(f)}|{st.st_size}|{int(st.st_mtime)}|{src.get("track", 0)}|1'.encode()).hexdigest()[:16]
    d = os.path.join(cut.work, 'joins-env')
    c = os.path.join(d, key + '.npy')
    if os.path.isfile(c):
        return jl.Env(np.load(c))
    db = jl.envelope(decode(f, src.get('track', 0)))
    os.makedirs(d, exist_ok=True)
    np.save(c, db.astype(np.float32))
    return jl.Env(db)


def get_words(cut, src):
    w = src.get('words')
    p = path_of(cut, w) if w else None
    return read_words(p) if p and os.path.isfile(p) else None


def locked(cut):
    return bool(cut.lock_files) or os.path.isfile(cut.rough_json)


class Audit:
    """Everything the check and the snap read: the edit list with the envelope and words of each source."""

    def __init__(self, cut, edl, only=None):
        self.cut, self.edl = cut, edl
        self.items = edl['items']
        self.env, self.words, self.nowords = {}, {}, set()
        for k, s in edl['sources'].items():
            if only and k != only:
                continue
            if any(it.get('src') == k and 'src_in' in it for it in self.items):
                self.env[k] = get_env(cut, s)
                w = get_words(cut, s)
                if w is None:
                    self.nowords.add(k)
                self.words[k] = w or []

    def edges(self):
        """Every edge of a piece of source sound that is a real cut: [{item, side, src, t, limit, join}] (join k = the start of item k; the last join is the end of the rough)."""
        out = []
        n = len(self.items)
        for i, it in enumerate(self.items):
            if it.get('src') not in self.env or 'src_in' not in it:
                continue
            if not (i > 0 and jl.contiguous(self.items[i - 1], it)):
                out.append({'item': i, 'side': 'in', 'src': it['src'], 't': it['src_in'], 'limit': it['src_out'], 'join': i})
            if not (i + 1 < n and jl.contiguous(it, self.items[i + 1])):
                out.append({'item': i, 'side': 'out', 'src': it['src'], 't': it['src_out'], 'limit': it['src_in'], 'join': i + 1})
        return out

    def state(self, e, t=None):
        s = jl.edge_state(self.env[e['src']], self.words[e['src']], e['t'] if t is None else t, e['side'], e['limit'])
        s.update(item=e['item'], join=e['join'], src=e['src'])
        return s


def say_of(s):
    side = 'starts' if s['side'] == 'in' else 'ends'
    w = f' "{s["word"]}"' if s['word'] else ''
    return {'clipped': f'kept word{w} is cut off: the piece {side} inside it (sound runs across the edge)',
            'piece': f'a piece of the removed word{w} is left in: the piece {side} inside it',
            'speech': f'the piece {side} in the middle of continuous speech' + (f' (by{w})' if w else ' (a sound with no word in it)'),
            'room': (f'only {s["room"]:.2f} s of room after the last kept word (wanted {jl.ROOM_AFTER} s)' if s['side'] == 'out'
                     else f'only {s["room"]:.2f} s of room before the next kept word (wanted {jl.ROOM_BEFORE} s)'),
            'loud': f'the edge is not in the quiet: {s["peak"]:.0f} dB within 20 ms of it (the room here is under {s["quiet"]:.0f} dB)'}


def audit_joins(a):
    """The findings of the check: [{join, at, kind, severity, src, t, say}] and the per-edge states."""
    items, fin, edges = a.items, [], a.edges()
    states = {}
    for e in edges:
        s = a.state(e)
        states[(e['item'], e['side'])] = s
        at = items[e['join']]['at'] if e['join'] < len(items) else a.edl['total']
        for kind in s['issues']:
            fin.append({'join': e['join'], 'at': round(at, 3), 'kind': kind, 'severity': 'error' if kind == 'clipped' else 'warn', 'src': e['src'], 't': s['t'], 'side': e['side'],
                        'word': s['word'], 'room': s['room'], 'say': say_of(s)[kind]})
    n = len(items)
    for k in range(1, n):                                   # dead air: the air at the end of one piece and the start of the next, together
        x, y = states.get((k - 1, 'out')), states.get((k, 'in'))
        if x and y and x['room'] + y['room'] > jl.DEAD_AIR:
            fin.append({'join': k, 'at': items[k]['at'], 'kind': 'dead_air', 'severity': 'warn', 'src': y['src'], 't': y['t'], 'room': round(x['room'] + y['room'], 3),
                        'say': f'dead air at the join: {x["room"]:.2f} s left after the last word before it and {y["room"]:.2f} s before the next, {x["room"] + y["room"]:.2f} s together'})
    cuts = [k for k in range(1, n) if not jl.contiguous(items[k - 1], items[k])]
    for k1, k2 in zip(cuts, cuts[1:]):                      # cuts closer than 1.5 s play as a stutter
        d = items[k2]['at'] - items[k1]['at']
        if d < jl.STUTTER:
            fin.append({'join': k2, 'at': items[k2]['at'], 'kind': 'stutter', 'severity': 'warn', 'src': items[k1].get('src'), 't': items[k1].get('src_in'), 'len': round(d, 3),
                        'say': f'two cuts {d:.2f} s apart (a piece of {d:.2f} s at {items[k1]["at"]:.2f} s in the rough): they play as a stutter'})
    fin.sort(key=lambda f: (f['join'], f['kind'] != 'clipped'))
    return fin, states


def clock(t):
    return f'{int(t // 60)}:{t % 60:05.2f}'


def cmd_check(cut, a_):
    edl = edlmod.load(cut.edl)
    bad = edlmod.validate(edl)
    if bad:
        print('edl.json is not valid:\n  ' + '\n  '.join(bad))
        return 1
    a = Audit(cut, edl, a_.src)
    for k in a.nowords:
        print(f'note: source "{k}" has no word file: sound running across an edge is reported as a clipped word')
    fin, states = audit_joins(a)
    for f in fin:
        print(f'{"CLIPPED" if f["severity"] == "error" else "warn   "} join {f["join"]:>2} at {clock(f["at"])}  {f["src"] or ""} {f["t"] if f["t"] is not None else ""}: {f["say"]}')
    counts = {}
    for f in fin:
        counts[f['kind']] = counts.get(f['kind'], 0) + 1
    edges = len(states)
    summary = (f'{edges} edges checked in {len(edl["items"])} items: ' + (', '.join(f'{v} {k.replace("_", " ")}' for k, v in sorted(counts.items())) if counts else 'all fine'))
    print(summary)
    if a_.json:
        write_json(os.path.join(cut.work, 'joins.json'), {'version': 1, 'edl_total': edl['total'], 'counts': counts,
                                                          'sources': {k: {'floor_db': round(e.floor, 1), 'loud_db': round(e.loud, 1), 'gate_db': round(e.gate, 1)} for k, e in a.env.items()},
                                                          'edges': [{k: v for k, v in s.items()} for s in states.values()], 'findings': fin})
    say(cut, 'joins check: ' + summary)
    return 1 if counts.get('clipped') else 0


def snap_edl(a, reach=jl.MAX_MOVE, orig=None):
    """Plan every edge and return (new edl, [moves], [left]). Pure given the Audit. `orig` = the items of the very first edit list (before any snap): an edge never ends further than `reach` from where it was there,
    so snapping twice cannot walk an edge away."""
    edl = copy.deepcopy(a.edl)
    items = edl['items']
    plan = {}
    for e in a.edges():
        it = a.items[e['item']]
        lo, hi = (0.0, it['src_out'] - 0.2) if e['side'] == 'in' else (it['src_in'] + 0.2, a.env[e['src']].seconds())
        if orig:
            o = orig[e['item']]['src_in' if e['side'] == 'in' else 'src_out']
            lo, hi = max(lo, o - reach), min(hi, o + reach)
        t, why = jl.plan_edge(a.env[e['src']], a.words[e['src']], e['t'], e['side'], e['limit'], lo, hi, reach)
        s = a.state(e)
        if t is not None and abs(t - e['t']) >= 0.015:           # a smaller move is only the frame rounding of the last snap
            plan[(e['item'], e['side'])] = (t, e, s)
        elif why != 'fine':
            plan[(e['item'], e['side'], 'left')] = (why, e, s)
    # two pieces of one source must not overlap after the moves: undo a pair that would
    for i in range(len(items) - 1):
        x, y = items[i], items[i + 1]
        if x.get('src') and x.get('src') == y.get('src') and 'src_out' in x and 'src_in' in y and y['src_in'] >= x['src_out'] - 0.004:
            o = plan[(i, 'out')][0] if (i, 'out') in plan else x['src_out']
            n = plan[(i + 1, 'in')][0] if (i + 1, 'in') in plan else y['src_in']
            if o > n:
                plan.pop((i, 'out'), None)
                plan.pop((i + 1, 'in'), None)
    moves = []
    for (i, side, *left), v in plan.items():
        if left:
            continue
        t, e, s = v
        it = items[i]
        d = round(t - e['t'], 3)
        if side == 'in':
            it['src_in'] = t
            if 'pic_in' in it:
                it['pic_in'] = round(it['pic_in'] + d, 3)
        else:
            it['src_out'] = t
        moves.append({'item': i, 'join': e['join'], 'side': side, 'src': e['src'], 'from': e['t'], 'to': t, 'ms': round(d * 1000), 'was': s['issues'], 'word': s['word']})
    at = 0.0
    for it in items:
        if 'src' in it and 'src_in' in it and 'src_out' in it:
            ln = jl.frames(it['src_out'] - it['src_in'], edl['fps']) / edl['fps']
            it['src_out'] = round(it['src_in'] + ln, 3)
            it['len'] = round(ln, 3)
        it['at'] = round(at, 3)
        at = it['at'] + it['len']
    edl['total'] = round(at, 3)
    left = [{'item': k[0], 'join': v[1]['join'], 'side': k[1], 'src': v[1]['src'], 't': v[1]['t'], 'why': v[0], 'was': v[2]['issues'], 'word': v[2]['word']}
            for k, v in plan.items() if len(k) == 3]
    return edl, moves, left


def cmd_snap(cut, a_):
    if locked(cut):
        print('The cut is locked: the rough has been handed over (a lock file or out/rough.json exists), so snap changes nothing. A locked cut goes back to you for review; it is not fixed here.')
        return 2
    edl = edlmod.load(cut.edl)
    bad = edlmod.validate(edl)
    if bad:
        print('edl.json is not valid:\n  ' + '\n  '.join(bad))
        return 1
    a = Audit(cut, edl)
    bak = os.path.join(cut.work, 'edl.before-snap.json')
    first = edlmod.load(bak)['items'] if os.path.isfile(bak) else None
    if first and (len(first) != len(edl['items']) or any(x.get('src') != y.get('src') for x, y in zip(first, edl['items']))):
        first = None
    new, moves, left = snap_edl(a, a_.reach, first)
    for m in moves:
        print(f'moved   join {m["join"]:>2} {m["src"]} {m["from"]:.3f} -> {m["to"]:.3f} ({m["ms"]:+d} ms, the {"start" if m["side"] == "in" else "end"} of item {m["item"]}): was {", ".join(m["was"])}' + (f' at "{m["word"]}"' if m["word"] else ''))
    for m in left:
        print(f'left    join {m["join"]:>2} {m["src"]} {m["t"]:.3f} (the {"start" if m["side"] == "in" else "end"} of item {m["item"]}): {m["why"]}; was {", ".join(m["was"])}')
    bad = edlmod.validate(new)
    if bad:
        print('the snapped list is not valid, nothing written:\n  ' + '\n  '.join(bad))
        return 1
    print(f'{len(moves)} edges moved, {len(left)} left as they were; length {edl["total"]:.3f} -> {new["total"]:.3f} s')
    if a_.dry or not moves:
        return 0
    if not os.path.isfile(bak):
        edlmod.write(bak, edl)
    edlmod.write(cut.edl, new)
    say(cut, f'joins snap: {len(moves)} edges moved, edl.json rewritten (the first one is {bak}); rebuild the rough')
    print('edl.json rewritten. The rough is now out of date: run build_rough.py (or the template build).')
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    for name in ('check', 'snap'):
        p = sub.add_parser(name)
        p.add_argument('--video')
    sub.choices['check'].add_argument('--json', action='store_true')
    sub.choices['check'].add_argument('--src')
    sub.choices['snap'].add_argument('--dry', action='store_true')
    sub.choices['snap'].add_argument('--reach', type=float, default=jl.MAX_MOVE, help='the furthest an edge may move, seconds (default 0.15)')
    a = ap.parse_args(argv)
    cut = Cut(a.video)
    return cmd_check(cut, a) if a.cmd == 'check' else cmd_snap(cut, a)


if __name__ == '__main__':
    sys.exit(main())
