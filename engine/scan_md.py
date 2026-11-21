"""scan.py's part for scan.md: the readable lines of scan.json, grouped and capped."""
from scan_picture import PIC_WHOLE, PIC_WINDOW, PIC_WINDOWS

CAP = 40                       # lines per list in scan.md

def fmt_t(t):
    t = max(0.0, t)
    h, rest = divmod(t, 3600)
    m, s = divmod(rest, 60)
    s = int(s * 10) / 10.0                     # truncate, so 59.96 is not "60.0"
    return f'{int(h)}:{int(m):02d}:{s:04.1f}' if h else f'{int(m)}:{s:04.1f}'


def span_t(a, b):
    return f'{fmt_t(a)}-{fmt_t(b)} ({b - a:.1f} s)'


def around(words, s, e, n=4):
    """'last n words before s | first n words after e'."""
    before = [w for ws, we, w in words if we <= s + 0.05][-n:]
    after = [w for ws, we, w in words if ws >= e - 0.05][:n]
    return f'"{" ".join(before)} | {" ".join(after)}"'


def capped(items, cap=CAP, pick=None):
    """(shown, hidden count): all when short; else the `pick`ed (default the first) cap items."""
    if len(items) <= cap:
        return list(items), 0
    return (pick(items) if pick else items[:cap]), len(items) - cap


def per_minute(times, top=6):
    c = {}
    for t in times:
        c[int(t // 60)] = c.get(int(t // 60), 0) + 1
    best = sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))[:top]
    return ', '.join(f'{m}:00 x{n}' for m, n in sorted(best))


def snippet(words, s, e, n=10):
    ws = [w for ws_, we, w in words if ws_ >= s - 0.01 and we <= e + 0.01]
    return ' '.join(ws[:n]) + (' ...' if len(ws) > n else '')


def md_source(sid, d, words):
    """The readable part of one source."""
    L = []
    a = L.append
    a(f"## {sid}  {d.get('file', '')}  ({fmt_t(d.get('duration', 0))}, {d.get('n_words', 0)} words)")
    sp = d.get('speech_db')
    a(f"room tone {d['floor_db']} dB; speech about {sp if sp is not None else '?'} dB (the middle phrase); silence = under {d.get('silence_db', '?')} dB.")
    for n in d.get('notes', []):
        a('NOTE: ' + n)
    a('')
    fl = d['fillers']
    kinds = {}
    for f in fl:
        kinds[f['w']] = kinds.get(f['w'], 0) + 1
    a(f"### Fillers: {len(fl)}" + (' (' + ', '.join(f'{k} {v}' for k, v in sorted(kinds.items(), key=lambda kv: -kv[1])) + ')' if fl else ''))
    shown, more = capped(fl)
    for f in shown:
        a(f"  {fmt_t(f['s'])} {f['w']} {around(words, f['s'], f['e'], 3)}")
    if more:
        a(f"  ... {more} more not listed (json has all); busiest minutes of all: {per_minute([f['s'] for f in fl])}")
    a('')
    rt = d['retakes']
    a(f'### Retakes: {len(rt)}')
    shown, more = capped(rt, cap=25)
    for r in shown:
        a(f"  {fmt_t(r['first'][0])} said again at {fmt_t(r['again'][0])} ({r['why']}): \"{r['words']}\"")
        a(f"    first {span_t(*r['first'])}: {snippet(words, *r['first'])}")
        a(f"    again {span_t(*r['again'])}: {snippet(words, *r['again'])}")
    if more:
        a(f"  ... {more} more not listed (json has all), in {per_minute([r['again'][0] for r in rt])}")
    a('')
    asd = d['asides']
    a(f'### Quiet asides: {len(asd)} (db = how far under the phrases around it)')
    shown, more = capped(asd)
    for x in shown:
        faint = '  [only %.0f dB over the room tone: may not be speech]' % x['over_floor'] if x.get('over_floor', 99) < 8 else ''
        a(f"  {span_t(x['s'], x['e'])} {x['db']} dB: \"{x['words']}\"{faint}")
    if more:
        a(f'  ... {more} more not listed (json has all)')
    a('')
    da = d['dead_air']
    a(f'### Dead air (no words, no speech-level sound, 2 s or more): {len(da)}, {sum(b - x for x, b in da):.0f} s in all')
    shown, more = capped(da, pick=lambda it: sorted(sorted(it, key=lambda r: r[0] - r[1])[:CAP]))
    for s, e in shown:
        a(f"  {span_t(s, e)} {around(words, s, e)}")
    if more:
        a(f'  ... {more} shorter ones not listed (the longest {CAP} are; json has all)')
    a('')
    wt = d['waits']
    busy = [w for w in wt if w['screen'] == 'busy']
    a(f"### Waits (no words for 4 s or more): {len(wt)}, {sum(w['e'] - w['s'] for w in wt):.0f} s in all; {len(busy)} busy (picture keeps changing), {len(wt) - len(busy)} still"
      + ('; waits over %g s were sampled in %d windows of %g s' % (PIC_WHOLE, PIC_WINDOWS, PIC_WINDOW) if any(w['e'] - w['s'] > PIC_WHOLE for w in wt) else ''))
    shown, more = capped(wt, pick=lambda it: sorted(sorted(it, key=lambda w: w['s'] - w['e'])[:CAP], key=lambda w: w['s']))
    for w in shown:
        extra = (', camera strip ' + w['inset'] + ' left out' if w.get('inset') else '') + (', picture not measured' if w.get('picture') else '')
        a(f"  {span_t(w['s'], w['e'])} {w['screen']} (picture changed in {round(w.get('moving', 0) * 100)}% of samples{extra}), x{w['speed']:g} plays it in {(w['e'] - w['s']) / w['speed']:.1f} s {around(words, w['s'], w['e'])}")
    if more:
        a(f'  ... {more} shorter ones not listed (the longest {CAP} are; json has all)')
    a('')
    sl = d['silences']
    bands = [(0.4, 0.7), (0.7, 1.0), (1.0, 2.0), (2.0, 1e9)]
    cnt = [sum(1 for s, e in sl if lo <= e - s < hi) for lo, hi in bands]
    a(f"### Silences (level under {d.get('silence_db', '?')} dB, over 0.4 s): {len(sl)}, {sum(e - s for s, e in sl):.0f} s in all; "
      f"0.4-0.7 s: {cnt[0]}, 0.7-1 s: {cnt[1]}, 1-2 s: {cnt[2]}, over 2 s: {cnt[3]}")
    big = [x for x in sl if x[1] - x[0] >= 1.0]
    shown, more = capped(big, pick=lambda it: sorted(sorted(it, key=lambda r: r[0] - r[1])[:CAP]))
    for s, e in shown:
        a(f"  {span_t(s, e)} {around(words, s, e)}")
    if more:
        a(f'  ... {more} more over 1 s not listed (the longest {CAP} are; json has all); the {len(sl) - len(big)} under 1 s are in the json only')
    a('')
    return L


def write_md(doc, words_by_src):
    L = ['# Scan: measurements of the recordings', '',
         'Measured, not decided: every time is seconds into that source as m:ss.s. "|" in a quote marks the stretch; the words are the ones either side.',
         'scan.json has every item; lists here are capped (%d lines, retakes 25) and say how many were left out.' % CAP, '']
    for sid, d in doc['sources'].items():
        L += md_source(sid, d, words_by_src.get(sid, []))
    return '\n'.join(L) + '\n'


# ---------------------------------------------------------------- running
