"""Source time -> rough time through edl.json, and the source words mapped into the rough. Shared by every cut.

    import sys; sys.path.insert(0, ENGINE)          # ENGINE = the engine/ folder of the repo
    from tmap import load
    T = load()                      # video/out/edl.json (found from the cwd), or load('path/to/edl.json')
    T.m('r1', 59.8)                 # where that source second lands in the rough (a time inside a cut-away gap lands on the next kept part)
    T.m('r1', 92.6, edge='end')     # same, but a gap lands on the END of the previous kept part (use it for the end of an overlay)
    T.beat(4), T.beat(4, True)      # start / end of a beat in the rough
    T.total                         # rough length

CLI:  python tmap.py r1:59.8 b4      (b4 = start and end of beat 4)

Rules (kept as they always were, so old plans map the same): a source time maps when it falls inside
[src_in - 0.05, src_out + 0.05] of an item (position = at + max(0, t - src_in)); between two kept parts it lands on the next one;
before the first or past the last kept part it is an error.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import edl as edlmod

SLACK = 0.05


class TMap:
    def __init__(self, edl):
        self.edl = edl
        self.total = edl['total']
        self.items = edl['items']
        self.parts = {}   # src -> [items with sound from that source], in source order
        for it in self.items:
            if 'src' in it and 'src_in' in it and 'src_out' in it:
                self.parts.setdefault(it['src'], []).append(it)
        self.cut_order = {k: list(v) for k, v in self.parts.items()}
        for v in self.parts.values():
            v.sort(key=lambda it: (it['src_in'], it['at']))

    def m(self, src, t, edge='start'):
        if src not in self.parts:
            raise ValueError(f'tmap: no part of the cut has sound from source "{src}"')
        for it in self.cut_order[src]:          # a time inside a kept part: the first one in cut order
            if it['src_in'] - SLACK <= t <= it['src_out'] + SLACK:
                return round(it['at'] + max(0.0, t - it['src_in']), 3)
        prev = None
        for it in self.parts[src]:              # in a gap: the next kept part in source order (or the end of the previous one)
            if it['src_in'] > t:
                if edge == 'end' and prev is not None:
                    return round(prev['at'] + prev['len'], 3)
                return round(it['at'], 3)
            prev = it
        raise ValueError(f'tmap: source {src} at {t}s is past every kept part (the last one ends at {self.parts[src][-1]["src_out"]})')

    def kept(self, src, t):
        """True when the source second is inside a kept part (not in a gap)."""
        return any(it['src_in'] - SLACK <= t <= it['src_out'] + SLACK for it in self.parts.get(src, []))

    def beat(self, b, end=False):
        xs = [it for it in self.items if it.get('beat') == b]
        if not xs:
            raise ValueError(f'tmap: no item has beat {b}')
        return round(xs[-1]['at'] + xs[-1]['len'], 3) if end else round(xs[0]['at'], 3)

    def map_words(self, words_by_src, stretch=0.9, visible=0.0):
        """Words of every source mapped into the rough: [[start, end, word, src, src_start], ...] sorted by start.
        A word counts when it lies inside a kept part (its end after src_in + 0.08 and its start before src_out - 0.05).
        Whisper stretches a word over the silence before it: a word is never started more than `stretch` s before its end.
        `visible` (0..1): a word that runs past the END of the part counts only when at least that share of it (at most its first 0.45 s) is inside the part
        (0.5 at the handover: a Short is cut at word edges, and a sliver of the next word's first sound is not a word to caption). The head of a part is
        left to the old rule, because Whisper stretches a word back over the silence before it, so its start time is not to be trusted."""
        out = []
        for it in self.items:
            src = it.get('src')
            if src is None or src not in words_by_src or 'src_in' not in it:
                continue
            s0, s1, at = it['src_in'], it['src_out'], it['at']
            for a, b, w in words_by_src[src]:
                if b <= s0 + 0.08 or a >= s1 - 0.05:
                    continue
                a2 = max(a, s0, b - stretch)
                if a2 >= min(b, s1):                                                    # a stretched word whose speech lies past this part's end: not in it
                    continue
                if visible and b > s1 and (s1 - a) < visible * min(b - a, 0.45):      # the tail of a part: the next word's first sound is not a word
                    continue
                out.append([round(at + a2 - s0, 3), round(at + min(b, s1) - s0, 3), w, src, a])
        out.sort(key=lambda x: (x[0], x[1]))
        return out


def read_words(path):
    """A words.tsv (start<TAB>end<TAB>word per line) as [(start, end, word)]."""
    out = []
    with open(path, encoding='utf-8') as f:
        for line in f:
            p = line.rstrip('\n').split('\t')
            if len(p) >= 3:
                out.append((float(p[0]), float(p[1]), p[2]))
    return out


def load(path=None):
    if path is None:
        from pipelib import Cut
        path = Cut().edl
    e = edlmod.load(path)
    bad = edlmod.validate(e)
    if bad:
        raise ValueError('edl.json is not valid:\n  ' + '\n  '.join(bad))
    return TMap(e)


if __name__ == '__main__':
    T = load()
    for a in sys.argv[1:]:
        if a.startswith('b'):
            print(a, T.beat(int(a[1:])), T.beat(int(a[1:]), True))
        else:
            s, t = a.split(':')
            print(a, T.m(s, float(t)))
