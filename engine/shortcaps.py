"""Caption blocks for a Short, made from rough-words.json (the source words mapped into the rough: no Whisper over the rough in a visuals round).

    from shortcaps import words_of, blocks, add_captions
    W = words_of(cut)                                         # [[start, end, word, src, src_start], ...] of rough-words.json
    add_captions(E, W, fix={'cloud': 'Claude'}, accent={'lost', 'never'}, skip=[(12.67, 15.67)], duration=E.doc['duration'])

A block is at most `max_words` words and `max_chars` characters (over about 26 characters a line overflows the 840 px caption box),
broken after a sentence end or a comma, after a word in `breaks` (the sentence ends of a transcript that came with no punctuation), at a pause longer than
`pause` (`sentence_case=True`: the transcripts of a Short's parts come lower case and unpunctuated, so the first word, the word after a `breaks` word and "I" get capitals and a `breaks` word gets its full stop, the way the hand-made captions read), where the words come from another part of the cut (the source changes), and across a `skip` window (a window where no caption is wanted: a voice-over
slot that carries its own on-screen text, a held card). `fix` = {spoken word (lower case, no punctuation): the word to show} for what Whisper mishears
("cloud" for Claude) and `accent` = words drawn in the accent colour. `renames` = {block index or id: ...} is not needed: edit `fix`.
Timing like the Remotion captions had it: a block starts 0.05 s before its first word and ends at the next block's start or 0.6 s after its last word.
"""
import re
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pipelib import read_json


def words_of(cut, src=None):
    """The words of rough-words.json, optionally only those from sources in `src` (a set of keys such as {'vo'})."""
    ws = read_json(cut.rough_words)['words']
    return [w for w in ws if src is None or w[3] in src]


def core(w):
    return re.sub(r"[^\w']", '', w).lower()


def blocks(words, max_words=5, max_chars=26, pause=0.55, fix=None, accent=(), skip=(), drop=(), breaks=(), sentence_case=False):
    """Group words into caption blocks: [[[start, end, 'Word', accent 0/1], ...], ...]."""
    fix = {k.lower(): v for k, v in (fix or {}).items()}
    accent = {a.lower() for a in accent}
    nth_breaks = {(b[0].lower(), b[1]) for b in breaks if isinstance(b, tuple)}      # ('learning', 1): only after the first time it is said
    breaks = {b.lower() for b in breaks if isinstance(b, str)}
    seen = {}
    out, cur = [], []
    prev_src = None
    prev_break = False
    cap_next = True
    for a, b, w, *rest in words:
        w_src = rest[0] if rest else ''
        c = core(w)
        if c in drop or not c:
            continue
        seen[c] = seen.get(c, 0) + 1
        is_break = c in breaks or (c, seen[c]) in nth_breaks
        if any(s0 - 0.05 <= a < s1 for s0, s1 in skip):
            if cur:
                out.append(cur); cur = []
            continue
        shown = w.replace(re.sub(r"[^\w']", '', w), fix[c]) if c in fix else w
        if not shown:
            continue
        if sentence_case:
            if re.fullmatch(r"i(['’]\w+)?", shown.lower().strip('.,?!')):
                shown = 'I' + shown[1:]
            if cap_next and shown[:1].islower():
                shown = shown[:1].upper() + shown[1:]
            cap_next = False
            if is_break and not re.search(r'[.?!,:;]$', shown):
                shown += '.'
            if is_break or re.search(r'[.?!]$', shown):
                cap_next = True
        item = [round(a, 3), round(b, 3), shown, 1 if c in accent else 0]
        if cur:
            prev = cur[-1]
            chars = sum(len(x[2]) + 1 for x in cur) + len(shown)
            if (len(cur) >= max_words or chars > max_chars or re.search(r'[.?!,:;]$', prev[2]) or a - prev[1] > pause
                    or prev_break or (len(w_src) and w_src != prev_src)):
                out.append(cur); cur = []
        cur.append(item)
        prev_src = w_src
        prev_break = is_break
    if cur:
        out.append(cur)
    # a block of one short word (a lone "We" or "Yes,") is too brief to read and would overlap the next one: it joins the block after it
    i = 0
    while i < len(out) - 1:
        c = out[i]
        if (len(c) == 1 and c[0][1] - c[0][0] < 0.6 and not re.search(r'[.?!]$', c[0][2]) and len(out[i + 1]) < max_words + 1
                and len(c[0][2]) + 1 + sum(len(x[2]) + 1 for x in out[i + 1]) <= max_chars + 4):
            out[i + 1] = c + out[i + 1]
            del out[i]
        else:
            i += 1
    return out


def add_captions(E, words, prefix='K', last_end=None, tail=0.6, **kw):
    """Blocks -> caption events K1, K2, ... (the ids are stable while the words and the settings are). Returns the blocks."""
    bl = blocks(words, **kw)
    dur = last_end if last_end is not None else E.doc['duration']
    for n, c in enumerate(bl):
        at = max(0.0, c[0][0] - 0.05)
        nxt = bl[n + 1][0][0] - 0.05 if n + 1 < len(bl) else dur
        end = min(nxt, c[-1][1] + tail)
        if n + 1 == len(bl):
            end = dur
        if end - at < 0.3:
            end = min(at + 0.3, max(nxt, at + 0.1))      # never into the next block
        E.add(f'{prefix}{n + 1}', 'caption', at, end, words=c, text=' '.join(x[2] for x in c), what='word-lit caption at the seam')
    return bl


def find(words, word, after=0.0, before=1e9, nth=1):
    """[start, end] of the nth spoken `word` (lower case, no punctuation) between `after` and `before`: anchor an overlay on a spoken word, never on a typed time.
    Raises when it is not there (a changed rough must fail loudly, not draw a box in the wrong place)."""
    n = 0
    for a, b, w, *_ in words:
        if core(w) == word.lower() and after - 1e-6 <= a < before:
            n += 1
            if n == nth:
                return [a, b]
    raise ValueError(f'shortcaps.find: the word "{word}" (number {nth}) is not spoken between {after} and {before} s: is this the rough these times were made for?')


def patch(words, inserts):
    """Put back the small words Whisper dropped ("it", "we", "the"): inserts = [(word spoken before it, the word to add, nth occurrence of that word)].
    The new word takes the last 0.12 s (or a third) of the word before it, so no time is invented. Returns a new list; use it before add_captions."""
    out = [list(w) for w in words]
    for after, new, nth in [(i + (1,))[:3] if len(i) == 2 else i for i in inserts]:
        n = 0
        for k, w in enumerate(out):
            if core(w[2]) == after.lower():
                n += 1
                if n == nth:
                    d = min(0.12, (w[1] - w[0]) / 3)
                    nxt = out[k + 1] if k + 1 < len(out) else w
                    out.insert(k + 1, [round(w[1] - d, 3), w[1], new, *nxt[3:]])        # it belongs to the part the next word is in
                    w[1] = round(w[1] - d, 3)
                    break
        else:
            raise ValueError(f'shortcaps.patch: the word "{after}" (number {nth}) is not in the words')
    return out
