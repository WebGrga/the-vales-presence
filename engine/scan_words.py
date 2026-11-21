"""scan.py's part for words: the word file, fillers, phrases, retakes (see scan.py for what each means)."""
import bisect
import difflib
import re

PHRASE_GAP = 0.5               # a pause over this ends a phrase
PHRASE_MAX = 30                # words: a longer run without a pause is cut here
PHRASE_SILENCE = 0.4           # s: a silence in the sound this long between two words ends a phrase
RETAKE_WITHIN = 30.0           # s from the end of the first phrase to the start of the second
RETAKE_REACH = 8               # phrases ahead that can repeat a phrase

STOP = set('a an the and or but so to of in on at for with is are was were be it its this that i you he she we they my me your our '
           'then than there here just like yeah okay ok well now if as not no do does did have has had will would can could '
           'gonna going got get what when how why who which from by about up out one all'.split())
SENTENCE_END = re.compile(r"[.?!][\"')]*$")
FILLER_RE = re.compile(r"^(u+h*m+|u+h+m*|e+r+m*|e+h+m*|a+h+|a+hm+|h+m+|m+h*m+|m{2,})$")

def read_words(path):
    """[(start, end, word)] from a start<TAB>end<TAB>word file; bad lines are skipped."""
    out = []
    with open(path, encoding='utf-8') as f:
        for line in f:
            p = line.rstrip('\r\n').split('\t')
            if len(p) < 3:
                continue
            try:
                out.append((float(p[0]), float(p[1]), p[2].strip()))
            except ValueError:
                continue
    out.sort(key=lambda w: (w[0], w[1]))
    return out


def norm(w):
    return re.sub(r"[^a-z0-9']", '', w.lower())


def is_filler(w):
    return bool(FILLER_RE.match(norm(w)))


def find_fillers(words):
    return [{'s': round(s, 3), 'e': round(e, 3), 'w': norm(w)} for s, e, w in words if is_filler(w)]

def phrases(words, silences=None, gap=PHRASE_GAP):
    """Words cut into phrases: [{i0, i1 (word indexes, inclusive), s, e}]. A phrase ends at a pause over `gap` s between two words, after
    a full stop, after PHRASE_MAX words, and where the sound has a silence (the [s, e] list `silences`, 0.4 s or more) between two words:
    older word files stretch a word over the pause after it, so the word times alone miss it."""
    sil = sorted(silences or [])
    starts = [x[0] for x in sil]

    def silent_between(a, b):
        i = bisect.bisect_left(starts, a - 10.0)
        while i < len(sil) and sil[i][0] < b:
            if min(sil[i][1], b) - max(sil[i][0], a) >= PHRASE_SILENCE - 1e-6:
                return True
            i += 1
        return False
    out = []
    for i, (s, e, w) in enumerate(words):
        if out:
            last = words[out[-1]['i1']]
            if (s - last[1] <= gap and out[-1]['i1'] - out[-1]['i0'] + 1 < PHRASE_MAX and not SENTENCE_END.search(last[2])
                    and not silent_between(last[0], s + 0.3)):
                out[-1]['i1'] = i
                out[-1]['e'] = max(out[-1]['e'], e)
                continue
        out.append({'i0': i, 'i1': i, 's': s, 'e': e})
    return out


def phrase_tokens(words, ph):
    """[(word index, normalised word)] of a phrase without fillers and empty words."""
    return [(i, norm(words[i][2])) for i in range(ph['i0'], ph['i1'] + 1) if norm(words[i][2]) and not is_filler(words[i][2])]


def small(ws):
    return all(w in STOP for w in ws)


def match_phrases(a, b):
    """Why phrase b (a list of words) says phrase a again, or None. The reason is plain words; the second value is the repeated words."""
    k = 0
    while k < min(len(a), len(b)) and a[k] == b[k]:
        k += 1
    if k >= 4 or (k == 3 and not small(a[:3])):
        return f'same start {k} words', ' '.join(a[:k])
    m = min(len(a), len(b))
    if m >= 4 and max(len(a), len(b)) <= 2 * m + 2:
        blocks = [x for x in difflib.SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks() if x.size]
        shared = sum(x.size for x in blocks)
        longest = max((x.size for x in blocks), default=0)
        best = next((x for x in blocks if x.size == longest), None)
        if longest >= 3 and shared >= 0.7 * m and not small(a[best.a:best.a + longest]):
            return f'repeats {shared} of {m} words', ' '.join(a[best.a:best.a + longest])
    return None


def inside_restart(toks):
    """A line that starts again inside itself: [(p, q, n)] where the n words at token p come again at token q (q - p <= n + 4)."""
    ws = [t[1] for t in toks]
    out = []
    p = 0
    while p < len(ws) - 5:
        hit = None
        for q in range(p + 3, min(len(ws) - 2, p + 13)):
            n = 0
            while q + n < len(ws) and ws[p + n] == ws[q + n] and p + n < q:
                n += 1
            if n >= 3 and q - p <= n + 4 and not (n == 3 and small(ws[p:p + 3])):
                hit = (p, q, n)
                break
        if hit:
            out.append(hit)
            p = hit[1]
        else:
            p += 1
    return out


def find_retakes(words, silences=None):
    """Lines said again. Each: {first: [s, e], again: [s, e], words, why}, in order of the second saying."""
    phs = phrases(words, silences)
    toks = [phrase_tokens(words, p) for p in phs]
    out = []
    for i, p in enumerate(phs):
        a = [t[1] for t in toks[i]]
        if len(a) < 3:
            continue
        for j in range(i + 1, min(len(phs), i + 1 + RETAKE_REACH)):
            if phs[j]['s'] - p['e'] > RETAKE_WITHIN:
                break
            b = [t[1] for t in toks[j]]
            if len(b) < 3:
                continue
            r = match_phrases(a, b)
            if r:
                out.append({'first': [round(p['s'], 3), round(p['e'], 3)], 'again': [round(phs[j]['s'], 3), round(phs[j]['e'], 3)],
                            'words': r[1], 'why': r[0]})
                break
    for tk in toks:                                   # a line that restarts inside itself
        for p, q, n in inside_restart(tk):
            first_s, first_e = words[tk[p][0]][0], words[tk[q - 1][0]][1]
            again_s, again_e = words[tk[q][0]][0], words[tk[q + n - 1][0]][1]
            out.append({'first': [round(first_s, 3), round(first_e, 3)], 'again': [round(again_s, 3), round(again_e, 3)],
                        'words': ' '.join(t[1] for t in tk[p:p + n]), 'why': f'restarts inside the line, {n} words said twice'})
    best = {}
    for r in out:                                     # one saying has one earlier saying: the nearest
        k = tuple(r['again'])
        if k not in best or r['first'][0] > best[k]['first'][0]:
            best[k] = r
    return sorted(best.values(), key=lambda r: (r['again'][0], r['first'][0]))
