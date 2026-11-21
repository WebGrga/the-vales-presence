"""The edit list: video/out/edl.json, written by a template's rough-cut build (build.py) and read by everything after it.

FORMAT (version 2)
{
  "version": 2,
  "fps": 60, "width": 1920, "height": 1080,          # of rough.mp4
  "total": 591.533,                                   # seconds, = the sum of the items' `len`
  "sources": {                                        # every recording a part comes from
    "r1": {"file": "footage/rec1.mkv",                # relative to video/
           "words": "out/work/words-r1.tsv"}          # word times of that recording: start<TAB>end<TAB>word (words.py / transcribe.py); optional
  },
  "items": [                                          # in cut order, back to back: at[i+1] == at[i] + len[i]
    {"kind": "S", "beat": 1, "at": 0.0, "len": 7.35,  # position in the rough and length (seconds)
     "src": "r1", "src_in": 27.82, "src_out": 35.17}  # sound (and words) come from src_in..src_out of source `src`, at speed 1
    ...
  ]
}
`kind` is a free letter that the template gives meaning to; the pipeline only cares about these fields:
  at, len          every item
  src, src_in, src_out   items whose SOUND is a stretch of a source (kinds S, P, V): their words map into the rough
  beat             optional, lets tmap.beat(n) find where a beat starts and ends
Everything else (pic_in, crop, speed, ...) is the template's own bookkeeping and is passed through untouched.
A voice-over slot is a source too: sources.vo = {file: "vo/all.wav", words: "vo/all-words.tsv"} and the slot is {kind V, src vo, src_in: offset of the line in all.wav}.
Ramps, holds and end cards have no src: they carry no words.
Two optional fields every reader passes through (written by the rough cut stage, read by cuts.py and the review screen):
  cut_before   {"kind": "pause|filler|retake|aside|wait|other", "why": "...", "flag": false, "ask": "..."}: the cut between the previous item and this one, in words;
               `flag` true = a judgment call for you and `ask` says what to decide.
  a sped wait  an item with kind "W", no `src`, `pic_src`, `pic_in`, `pic_out` and `speed` > 1 (len = (pic_out - pic_in) / speed): the picture of a stretch of a recording played faster,
               muted, no words map. build_rough.py builds it; `add_wait` writes it.

Helpers: new, add, add_piece (a piece of a recording, optional cut_before), add_wait (a sped wait), cut_before (the field), write, load, validate, migrate.

CLI:  python edl.py check [edl.json]                      validate
      python edl.py migrate edl.json --fps 60 --size 1920x1080 --source r1=footage/rec1.mkv[,words] ...    upgrade a version-1 file in place
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

VERSION = 2


def new(fps, width, height, sources):
    return {'version': VERSION, 'fps': fps, 'width': width, 'height': height, 'total': 0.0, 'sources': dict(sources), 'items': []}


def add(edl, kind, length, beat=None, **fields):
    """Append an item at the end of the cut (its `at` is the running total). Returns the item."""
    it = {'kind': kind}
    if beat is not None:
        it['beat'] = beat
    at = fields.pop('at', None)          # an exact start (from the builder's running time) avoids rounding drift
    it.update(fields)
    it['at'] = round(edl['total'] if at is None else at, 3)
    it['len'] = round(length, 3)
    edl['items'].append(it)
    edl['total'] = round(it['at'] + it['len'], 3)
    return it


CUT_KINDS = ('pause', 'filler', 'retake', 'aside', 'wait', 'other')


def cut_before(kind, why='', flag=False, ask=''):
    """The `cut_before` field of an item: the cut between the item before and this one."""
    return {'kind': kind, 'why': why, 'flag': bool(flag), 'ask': ask}


def add_piece(edl, kind, src, src_in, src_out, beat=None, cut_before=None, frames=True, **fields):
    """Append a piece of a recording at speed 1 (sound and picture from `src`; `pic_in` defaults to src_in). With `frames` (default) its length is whole frames and src_out is adjusted to match."""
    length = src_out - src_in
    if frames:
        length = max(1, round(length * edl['fps'])) / edl['fps']
        src_out = round(src_in + length, 3)
    fields.setdefault('pic_in', src_in)
    if cut_before is not None:
        fields['cut_before'] = cut_before
    return add(edl, kind, length, beat=beat, src=src, src_in=src_in, src_out=src_out, **fields)


def add_wait(edl, pic_src, pic_in, pic_out, speed, beat=None, cut_before=None, kind='W', **fields):
    """Append a sped wait: the picture of pic_in..pic_out of `pic_src` played `speed` times faster, muted. Its length is whole frames."""
    length = max(1, round((pic_out - pic_in) / speed * edl['fps'])) / edl['fps']
    if cut_before is not None:
        fields['cut_before'] = cut_before
    return add(edl, kind, length, beat=beat, pic_src=pic_src, pic_in=pic_in, pic_out=pic_out, speed=speed, **fields)


def write(path, edl, flags=None):
    edl = dict(edl)
    edl['version'] = VERSION
    if flags is not None:
        edl['flags'] = flags
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(edl, f, indent=1, ensure_ascii=False)
        f.write('\n')
    os.replace(tmp, path)


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def _new_fields(i, it, edl):
    """Problems with the optional fields only: cut_before, a sped wait, speed, pic_src. Lists without them are never touched."""
    bad = []
    cb = it.get('cut_before')
    if cb is not None:
        if not isinstance(cb, dict) or cb.get('kind') not in CUT_KINDS:
            bad.append(f'item {i} has a cut_before that is not {{"kind": one of {", ".join(CUT_KINDS)}, "why", "flag", "ask"}}')
        elif any(k in cb and not isinstance(cb[k], t) for k, t in (('why', str), ('ask', str), ('flag', bool))):
            bad.append(f'item {i}: cut_before "why" and "ask" are text and "flag" is true or false')
    if 'speed' in it and (not isinstance(it['speed'], (int, float)) or isinstance(it['speed'], bool) or it['speed'] <= 0):
        bad.append(f'item {i} has a speed that is not a number above 0')
    if it.get('pic_src') and it['pic_src'] not in edl['sources']:
        bad.append(f'item {i} names picture source "{it["pic_src"]}" that is not in "sources"')
    if it.get('kind') == 'W':
        need = [k for k in ('pic_src', 'pic_in', 'pic_out', 'speed') if k not in it]
        if need:
            bad.append(f'item {i} is a sped wait (kind "W") but has no {", ".join(need)}')
        elif 'src' in it:
            bad.append(f'item {i} is a sped wait (kind "W"): it has no sound of its own, so no "src" (the picture comes from pic_src)')
        elif it['speed'] <= 1:
            bad.append(f'item {i} is a sped wait with speed {it["speed"]}: a wait is played faster than 1')
        elif abs((it['pic_out'] - it['pic_in']) / it['speed'] - it.get('len', 0)) > 0.05:
            bad.append(f'item {i} is a sped wait: pic_in..pic_out {it["pic_in"]}..{it["pic_out"]} at {it["speed"]}x is {(it["pic_out"] - it["pic_in"]) / it["speed"]:.3f} s, but len is {it.get("len")}')
    return bad


def validate(edl):
    """A list of plain-words problems (empty = fine)."""
    bad = []
    if edl.get('version') != VERSION:
        bad.append(f"edl.json is version {edl.get('version')}, the pipeline reads version {VERSION}: run `edl.py migrate`")
    for k in ('fps', 'width', 'height', 'total', 'sources', 'items'):
        if k not in edl:
            bad.append(f'edl.json has no "{k}"')
    if bad:
        return bad
    t = 0.0
    for i, it in enumerate(edl['items']):
        for k in ('kind', 'at', 'len'):
            if k not in it:
                bad.append(f'item {i} has no "{k}"')
        if 'at' not in it or 'len' not in it:
            continue
        if abs(it['at'] - t) > 0.0015:
            bad.append(f'item {i} starts at {it["at"]} but the one before it ends at {t:.3f}: the items must run back to back')
        t = it['at'] + it['len']
        bad += _new_fields(i, it, edl)
        if 'src' in it:
            if it['src'] not in edl['sources']:
                bad.append(f'item {i} names source "{it["src"]}" that is not in "sources"')
            if 'src_in' not in it or 'src_out' not in it:
                bad.append(f'item {i} has a src but no src_in/src_out')
    if abs(t - edl['total']) > 0.0015:
        bad.append(f'total is {edl["total"]} but the items add up to {t:.3f}')
    return bad


def migrate(edl, fps, width, height, sources):
    if edl.get('version') == VERSION:
        return edl
    edl = dict(edl)
    edl.update(version=VERSION, fps=fps, width=width, height=height, sources=sources)
    items = []
    for it in edl['items']:                      # version 1 called a ramp 'ramp' and kept its picture range in src: it carries no sound
        it = dict(it)
        if it.get('kind') in ('ramp', 'R') and 'src' in it:
            it['kind'] = 'R'; it['pic_src'] = it.pop('src'); it['pic_in'] = it.pop('src_in'); it['pic_out'] = it.pop('src_out')
        if it.get('kind') == 'endcard':
            it['kind'] = 'E'
        items.append(it)
    edl['items'] = items
    return edl


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    c = sub.add_parser('check'); c.add_argument('file', nargs='?')
    m = sub.add_parser('migrate'); m.add_argument('file')
    m.add_argument('--fps', type=float, default=60); m.add_argument('--size', default='1920x1080')
    m.add_argument('--source', action='append', default=[], help='key=file[,words]')
    a = ap.parse_args(argv)
    if a.cmd == 'check':
        from pipelib import Cut
        f = a.file or Cut().edl
        bad = validate(load(f))
        print('\n'.join(bad) if bad else f'{f}: fine')
        return 1 if bad else 0
    w, h = map(int, a.size.split('x'))
    src = {}
    for s in a.source:
        k, v = s.split('=', 1)
        file, _, words = v.partition(',')
        src[k] = {'file': file, **({'words': words} if words else {})}
    e = migrate(load(a.file), a.fps, w, h, src)
    write(a.file, e)
    bad = validate(e)
    print('\n'.join(bad) if bad else 'migrated')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
