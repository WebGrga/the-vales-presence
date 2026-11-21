"""The cut list for review: video/out/cuts.json, every cut of the rough, so you can review the rough cut by cut (Before/After, Keep / Restore / Note).

    python cuts.py [--video <video/>] [--no-clips]          (handover.py calls it at its end; --no-cuts there skips it)

A cut is every place where the SOUND jumps inside one source (the removed stretch between two kept parts of the same source) and every
source change. Parts that run on (src_out of one = src_in of the next) are no cut. Items with speed > 1 (sped waits) are not sound: they go in
"sped" and hide the jump they explain. A part with no sound of its own (a hold, an end card) is skipped when two sound parts meet.

For each cut: `at` (rough second), the source, the removed span (`from`, `to`, `len`), about 8 kept words just before, the removed words
(source words that are not in the rough), about 8 kept words just after, the `cut_before` fields of the edit list (kind, why, flag, ask; else
kind "other", flag false; a gap under 0.15 s with no word in it is kind "pause"), and two short clips in video/out/work/cuts/:
  before = the source 3 s before the removed span to 3 s after it (a removal over 20 s: its first 6 s and last 6 s with 0.3 s of black between;
           a source change or a jump back: 3 s each side of both places, 0.3 s of black between)
  after  = the rough 3 s each side of `at`
Clips are 540p (the short side), 30 fps, H.264 (the probed encoder, encoders.py), AAC. A clip is made once: its key (the file's size and time and the span for `before`, the
rough's size and time and the span for `after`: the rough is the edit list built, so a changed edit list with the same rough keeps its clips) is in out/work/cuts/keys.json; a re-run makes only the missing ones. A failed clip is a warning, not an error.
A jump is `"jump": "source"` or `"back"` with `len` 0 and `from` = `to` = where the next part starts in its source; `prev` says where the part before ended.
Ids are c1, c2, ... in cut order: a changed edit list can renumber them.
The clips (plan, ffmpeg, cache) are in cuts_clips.py; this file finds the cuts, picks the words and writes the document.
"""
import argparse
import bisect
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cuts_clips
import edl as edlmod
import tmap
from pipelib import Cut, read_json, say, sha256_file, step, write_json

TOL = 0.01            # parts closer than this in the source run on (no cut)
PAUSE_MAX = 0.15      # a gap this short with no word in it only trims a breath
MAX_SHOWN = 40        # a removal of more words than twice this shows its first and last this many
CTX_WORDS = 8         # kept words shown on each side


# ---------- pure: finding the cuts ----------

def is_sound(it):
    """A part whose sound is a stretch of a source at speed 1."""
    return 'src' in it and 'src_in' in it and 'src_out' in it and not (it.get('speed') or 1) > 1


def is_sped(it):
    return (it.get('speed') or 1) > 1


def sped_of(items):
    """Sped waits: [{id, at, len, src, from, to, speed}] (picture range of the source, played faster and muted)."""
    out = []
    for it in items:
        if not is_sped(it):
            continue
        src = it.get('pic_src') or it.get('src')
        a = it.get('pic_in', it.get('src_in'))
        b = it.get('pic_out', it.get('src_out'))
        if a is not None and b is None:
            b = a + it['len'] * it['speed']
        w = {'id': f'w{len(out) + 1}', 'at': round(it['at'], 3), 'len': round(it['len'], 3), 'src': src,
             'from': None if a is None else round(a, 3), 'to': None if b is None else round(b, 3), 'speed': it['speed']}
        cb = it.get('cut_before')
        if cb:
            w['cut_before'] = {k: cb[k] for k in ('kind', 'why', 'flag', 'ask') if k in cb}
        out.append(w)
    return out


def _explained(between, prev, nxt):
    """True when sped waits between two sound parts cover exactly the jump (the wait's picture runs from where the first ended to where the next starts)."""
    waits = [b for b in between if is_sped(b)]
    if not waits or prev['src'] != nxt['src']:
        return False
    first, last = waits[0], waits[-1]
    a = first.get('pic_in', first.get('src_in'))
    b = last.get('pic_out', last.get('src_out'))
    if a is None or b is None or (first.get('pic_src') or first.get('src')) != prev['src']:
        return False
    return abs(a - prev['src_out']) <= 0.1 and abs(b - nxt['src_in']) <= 0.1


def find_cuts(items):
    """The cuts between the sound parts of an edit list, in order: [{at, src, from, to, len, jump, prev, cut_before, i_prev, i_next}].
    `at` is the rough second where the part before ends. A forward gap in one source is a removal (`jump` None); a source change or a jump back has
    `from` = `to` = the next part's start and `prev` = {src, out}."""
    cuts = []
    prev = None
    prev_i = None
    between = []
    for i, it in enumerate(items):
        if not is_sound(it):
            between.append(it)
            continue
        if prev is not None:
            gap = it['src_in'] - prev['src_out']
            same = it['src'] == prev['src']
            if same and abs(gap) <= TOL:
                pass                                                        # the sound runs on
            elif _explained(between, prev, it):
                pass                                                        # a sped wait covers it
            else:
                cb = it.get('cut_before') or next((b['cut_before'] for b in between if b.get('cut_before')), None)
                c = {'at': round(prev['at'] + prev['len'], 3), 'src': it['src'], 'cut_before': cb, 'i_prev': prev_i, 'i_next': i,
                     'prev': {'src': prev['src'], 'out': round(prev['src_out'], 3)}}
                if same and gap > 0:
                    c.update(**{'from': round(prev['src_out'], 3), 'to': round(it['src_in'], 3), 'len': round(gap, 3), 'jump': None})
                else:
                    c.update(**{'from': round(it['src_in'], 3), 'to': round(it['src_in'], 3), 'len': 0.0, 'jump': 'back' if same else 'source'})
                cuts.append(c)
        prev, prev_i, between = it, i, []
    return cuts


class Words:
    """Words sorted by start, with the lookups the cut list needs."""

    def __init__(self, words):
        self.w = sorted(words, key=lambda x: (x[0], x[1]))
        self.starts = [x[0] for x in self.w]

    def before(self, t, n, eps=0.01):
        """The last n words that end by t."""
        i = bisect.bisect_right(self.starts, t + eps)
        return [x for x in self.w[max(0, i - n - 4):i] if x[1] <= t + eps][-n:]

    def after(self, t, n, eps=0.01):
        """The first n words that start at or after t."""
        i = bisect.bisect_left(self.starts, t - eps)
        return self.w[i:i + n]


def text_of(words):
    return ' '.join(str(x[2]).strip() for x in words if str(x[2]).strip())


def removed_words(src_words, kept, cut):
    """(text, count): see `_removed`; a long removal shows only its first and last 40 words (the text of a 100 s removal is a page)."""
    ws = _removed(src_words, kept, cut)
    n = len(ws)
    if n > 2 * MAX_SHOWN:
        return text_of(ws[:MAX_SHOWN]) + ' ... ' + text_of(ws[-MAX_SHOWN:]), n
    return text_of(ws), n


def _removed(src_words, kept, cut):
    """Source words inside the removal (from..to) that are not in the rough anywhere; `kept` = {(src, source start)} of the rough's words
    (a word used again elsewhere, a hook taken from the middle, is not removed)."""
    if cut['len'] <= 0 or not src_words:
        return []
    return [w for w in src_words if w[1] > cut['from'] and w[0] < cut['to'] and (cut['src'], w[0]) not in kept]


def kind_of(cut, removed):
    """(kind, why, flag, ask) from the edit list's cut_before, else 'other' (a tiny gap with no words: 'pause')."""
    cb = cut.get('cut_before') or {}
    kind = cb.get('kind')
    if not kind:
        kind = 'pause' if (cut['jump'] is None and cut['len'] < PAUSE_MAX and not removed) else 'other'
    return kind, cb.get('why', ''), bool(cb.get('flag', False)), cb.get('ask', '')


def build(edl, rough_words, src_words):
    """The cuts.json document without clips. `rough_words` [[start, end, word, src, src_start]]; `src_words` {src: [(start, end, word)]}."""
    items = edl['items']
    rough = Words(rough_words)
    kept = {(x[3], x[4]) for x in rough_words if len(x) > 4}
    doc_cuts = []
    for n, c in enumerate(find_cuts(items), 1):
        removed, n_removed = removed_words(src_words.get(c['src'], []), kept, c)
        kind, why, flag, ask = kind_of(c, removed)
        d = {'id': f'c{n}', 'at': c['at'], 'src': c['src'], 'from': c['from'], 'to': c['to'], 'len': c['len'],
             'kind': kind, 'why': why, 'flag': flag, 'ask': ask,
             'before': text_of(rough.before(c['at'], CTX_WORDS)), 'removed': removed, 'removed_n': n_removed, 'after': text_of(rough.after(c['at'], CTX_WORDS)),
             'clips': {}}
        if c['jump']:
            d['jump'] = c['jump']
            d['prev'] = c['prev']
        d['plan'] = cuts_clips.clip_plan(c, edl['total'])
        doc_cuts.append(d)
    return {'version': 1, 'rough': 'out/rough.mp4', 'total': edl['total'], 'cuts': doc_cuts, 'sped': sped_of(items)}


# ---------- the run ----------

def read_source_words(cut, edl):
    out = {}
    for key, s in edl['sources'].items():
        w = s.get('words')
        if w and os.path.isfile(cuts_clips.src_path(cut, w)):
            out[key] = tmap.read_words(cuts_clips.src_path(cut, w))
    return out


def run_cuts(cut, clips=True, rough_words=None, src_words=None, jobs_n=3):
    """Write video/out/cuts.json (and the clips). Returns the document."""
    edl = edlmod.load(cut.edl)
    bad = edlmod.validate(edl)
    if bad:
        raise ValueError('edl.json is not valid: ' + bad[0])
    if src_words is None:
        src_words = read_source_words(cut, edl)
    if rough_words is None:
        if os.path.isfile(cut.rough_words):
            rough_words = read_json(cut.rough_words)['words']
        else:
            rough_words = tmap.TMap(edl).map_words(src_words, visible=0.5)
    with step(cut, 'cuts') as d:
        doc = build(edl, rough_words, src_words)
        doc['edl_sha256'] = sha256_file(cut.edl)
        out = os.path.join(cut.out, 'cuts.json')
        problems = []
        if clips and doc['cuts']:
            made, kept, problems = cuts_clips.make_clips(cut, edl, doc, jobs_n)
            d.update(clips_made=made, clips_kept=kept)
        for c in doc['cuts']:
            c.pop('plan', None)
        write_json(out, doc)
        d.update(cuts=len(doc['cuts']), sped=len(doc['sped']), problems=len(problems))
        flagged = sum(1 for c in doc['cuts'] if c['flag'])
        say(cut, f'cuts: {len(doc["cuts"])} cuts ({flagged} for you), {len(doc["sped"])} sped, cuts.json written' + ('' if clips else ' (no clips)'))
        for p in problems:
            say(cut, f'WARNING: clip not made: {p}')
    return doc


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--video'); ap.add_argument('--no-clips', action='store_true'); ap.add_argument('--jobs', type=int, default=3)
    a = ap.parse_args(argv)
    cut = Cut(a.video)
    if not os.path.isfile(cut.edl):
        say(cut, f'FAILED: there is no edit list at {cut.edl}')
        return 1
    run_cuts(cut, clips=not a.no_clips, jobs_n=a.jobs)
    return 0


if __name__ == '__main__':
    sys.exit(main())
