"""events.json: every overlay event of a cut, written by the visuals step, and the timeline.json the pace check reads.

    python events.py check [--video <video/>]    validate events.json, write timeline.json, print the window plan and the gap pass
    python events.py gaps  [--video <video/>]    only the "something changes at least every 10 s" pass (overlay events + scene changes + cuts)

FORMAT of video/out/events.json  (all times are seconds of rough.mp4; every one comes from rough-words.json or tmap over edl.json)
{
  "version": 1,
  "format": "long",                 # "long" (1920x1080) or "short" (1080x1920): which house numbers the pace check uses
  "fps": 60, "width": 1920, "height": 1080, "duration": 591.533,     # must equal rough.json
  "events": [ {event}, ... ],
  "sfx":  [ {"t": 12.1, "file": "pop", "vol": 0.16} ],               # extra sound-effect cues (file = a sound name: video/assets, then kit/sounds)
  "captions": {"style": {...}}      # optional: the look of every caption (see captions.py)
}
EVENT (one thing on screen; `id` is stable across edits: the cache and the proof use it)
  id      "L1"                       unique, short, never reused for another thing
  kind    "zoom" | "text" | "caption" | "card" | "effect"      the pace check's kinds (house-rules.md): text = a made text block, card = a chapter/title/end card,
                                      effect = a made animation or mark with no readable words (ring, arrow, diagram step)
  at, end seconds
  --- who draws it ---
  comp    "Label"                    a component exported from the template's remotion/src/components.tsx  (kind text/card/effect)
  props   {...}                      handed to that component as `props` (plus id, at, end); anything JSON
  zoom events (ffmpeg crop+scale, never Remotion):  "zoom": 1.5, "x": 576, "y": 100 (top-left of the crop in the rough's pixels, the crop is
          width/zoom x height/zoom), optional "ease": 0.4 (seconds in and out, inOutCubic; 0 = hard cut), optional "mask": {"x","y","w","h","color"}
          (a rectangle in rough pixels painted while the zoom is fully in, e.g. over a webcam strip)
          a push: "zoom": 1.0, "to": 1.08, optional "ox"/"oy" (the point that stays put, default the centre): a slow move over the whole event
          "region": [x, y, w, h]  (either kind) zooms only that part of the frame and leaves the rest alone (a SPLIT's top band, the cam stays)
  blur events (ffmpeg, in the compose pass, never Remotion; redact.py): "box": [x, y, w, h] in the rough's pixels, "mode": "blur"|"pixelate"|"fill",
          optional "strength" (radius or block size) and "color" (fill). Not counted by the pace check. Boxes you drew in the viewer come from
          video/out/redactions.json, and your overlay inspector edits from video/out/event-edits.json (user_edits.py): both are applied on load
  caption events (ASS subtitles burned by ffmpeg, not Remotion): "words": [[start, end, "word"], ...] or [[start, end, "word", accent 0/1], ...]
          optional per caption: "y" / "x" / "size" (e.g. y 1300 on a full-height punch), the look is the style of events.json "captions": {"style": {...}}
  "bed": {"file": "music", "vol": 0.09, "env": [[t, level], ...], "start", "end", "fade_in", "fade_out"}   optional top-level music bed (see sfx.py)
  --- for the pace check ---
  text    "ONE REQUEST"              the words shown (default: props.text; for captions the words joined)
  what    "label L1"                 one line of what it is (the pace check prints it)
  pace    [{at, end, kind, text, what, zoom}, ...]    optional: this event counts as these timeline entries instead of one (a diagram built in steps)
  --- other ---
  render  false                      timeline only: it is already in the rough (a crop baked into the cut) or drawn some other way
  sfx     {"file": "pop", "vol": 0.16, "offset": 0.0}   or a list of those: a sound at at+offset
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pipelib import Cut, fail, read_json, say, step, write_json
import redact
import user_edits

KINDS = ('zoom', 'text', 'caption', 'card', 'effect', 'blur')
VERSION = 1


class Events:
    """Builder for a template's make_overlays.py:

        E = Events.for_cut(cut, 'long')
        E.add('L1', 'text', 12.1, 15.3, comp='Label', props={'text': 'ONE REQUEST'}, what='label', sfx={'file': 'pop', 'vol': .16})
        E.zoom('P1', 23.4, 49.5, x=0, y=30, zoom=1.5, what='three title picks')
        E.caption('C1', [[1.0, 1.3, 'Hello'], ...])
        E.write(cut)
    """

    def __init__(self, fmt, fps, width, height, duration):
        self.doc = {'version': VERSION, 'format': fmt, 'fps': fps, 'width': width, 'height': height, 'duration': duration,
                    'events': [], 'sfx': []}

    @classmethod
    def for_cut(cls, cut, fmt):
        r = read_json(cut.rough_json)
        return cls(fmt, r['fps'], r['width'], r['height'], r['duration'])

    def add(self, id, kind, at, end, comp=None, props=None, text=None, what=None, pace=None, render=None, sfx=None, **extra):
        e = {'id': id, 'kind': kind, 'at': round(at, 3), 'end': round(end, 3)}
        if comp:
            e['comp'] = comp
        if props is not None:
            e['props'] = props
        if text:
            e['text'] = text
        if what:
            e['what'] = what
        if pace:
            e['pace'] = pace
        if render is False:
            e['render'] = False
        if sfx:
            e['sfx'] = sfx
        e.update(extra)
        self.doc['events'].append(e)
        return e

    def zoom(self, id, at, end, x, y, zoom=1.5, ease=0.4, mask=None, what=None, **extra):
        return self.add(id, 'zoom', at, end, what=what, zoom=zoom, x=x, y=y, ease=ease, **({'mask': mask} if mask else {}), **extra)

    def push(self, id, at, end, zoom=1.0, to=1.08, ox=None, oy=None, region=None, what=None, **extra):
        """A slow push: the zoom goes from `zoom` to `to` (sine eased) over the whole event, about the point (ox, oy) of the frame (default its centre),
        and cuts back at `end`. Keep `to` under the Shorts cap of 2.0 counted on the base crop."""
        kw = {k: v for k, v in (('ox', ox), ('oy', oy), ('region', region)) if v is not None}
        return self.add(id, 'zoom', at, end, what=what, zoom=zoom, to=to, **kw, **extra)

    def framing(self, id, at, end, zoom, what):
        """A crop that is already baked into the rough (a SPLIT's top box and cam band together): counted by the pace check, drawn by nobody."""
        return self.add(id, 'zoom', at, end, what=what, zoom=zoom, render=False)

    def bed(self, file='music', vol=0.09, env=None, fade_in=0.3, fade_out=0.4, start=0.0, end=None):
        """A music bed under the whole cut (the Shorts' lo-fi bed): `file` from video/assets or kit/sounds, level `vol` (or `env` = [[t, level], ...],
        linear between points) with a fade at each end. It is mixed under the rough's voice at that fixed level; the voice is never re-levelled."""
        self.doc['bed'] = {'file': file, 'vol': vol, 'start': start, 'end': end if end is not None else self.doc['duration'], 'fade_in': fade_in, 'fade_out': fade_out,
                           **({'env': env} if env else {})}

    def blur(self, id, at, end, box, mode='blur', strength=None, what=None, **extra):
        """Blur (or "pixelate", or "fill") the box [x, y, w, h] of the rough's picture from at to end: private text, a face, a number. ffmpeg draws it
        in the compose pass, so it costs no render; a zoom over it scales it with the picture."""
        kw = {'strength': strength} if strength is not None else {}
        return self.add(id, 'blur', at, end, what=what, box=[round(v) for v in box], mode=mode, **kw, **extra)

    def caption(self, id, words, what=None, **extra):
        return self.add(id, 'caption', words[0][0] - 0.05, words[-1][1] + 0.35, words=words, what=what, **extra)

    def sfx(self, t, file, vol=0.3):
        self.doc['sfx'].append({'t': round(t, 3), 'file': file, 'vol': vol})

    def write(self, cut):
        self.doc['events'].sort(key=lambda e: (e['at'], e['id']))
        self.doc['sfx'].sort(key=lambda s: s['t'])
        bad = validate(self.doc, cut)
        if bad:
            fail(cut, 'events.json is not valid:\n  ' + '\n  '.join(bad))
        write_json(cut.events, self.doc)
        write_json(cut.timeline, timeline(self.doc))
        return self.doc


def drawn_by(e):
    """'ffmpeg' (zoom), 'ass' (caption), 'remotion' (comp) or None (timeline only)."""
    if e.get('render') is False:
        return None
    if e['kind'] in ('zoom', 'blur'):
        return 'ffmpeg'
    if e['kind'] == 'caption':
        return 'ass'
    return 'remotion' if e.get('comp') else None


def validate(doc, cut=None):
    """Plain-words problems (empty list = fine)."""
    bad = []
    for k in ('format', 'fps', 'width', 'height', 'duration', 'events'):
        if k not in doc:
            bad.append(f'events.json has no "{k}"')
    if bad:
        return bad
    if doc['format'] not in ('long', 'short'):
        bad.append('"format" must be "long" or "short"')
    if cut is not None and os.path.isfile(cut.rough_json):
        r = read_json(cut.rough_json)
        if abs(r['duration'] - doc['duration']) > 0.01 or (r['width'], r['height']) != (doc['width'], doc['height']) or abs(r['fps'] - doc['fps']) > 0.01:
            bad.append(f'events.json says {doc["width"]}x{doc["height"]} {doc["fps"]} fps {doc["duration"]} s but rough.json says {r["width"]}x{r["height"]} {r["fps"]} fps {r["duration"]} s: the events are for another rough')
    ids = set()
    zooms = []
    for e in doc['events']:
        i = e.get('id', '?')
        if not e.get('id'):
            bad.append(f'an event has no id: {json.dumps(e)[:80]}')
            continue
        if i in ids:
            bad.append(f'id "{i}" is used twice')
        ids.add(i)
        if e.get('kind') not in KINDS:
            bad.append(f'{i}: kind "{e.get("kind")}" is not one of {", ".join(KINDS)}')
            continue
        if not (isinstance(e.get('at'), (int, float)) and isinstance(e.get('end'), (int, float))):
            bad.append(f'{i}: needs numbers at and end')
            continue
        if e['at'] < -0.001 or e['end'] > doc['duration'] + 0.05:
            bad.append(f'{i}: runs {e["at"]}-{e["end"]} s but the rough is {doc["duration"]} s long')
        if e['end'] <= e['at']:
            bad.append(f'{i}: ends ({e["end"]}) before it starts ({e["at"]})')
        by = drawn_by(e)
        if by == 'remotion' and not isinstance(e.get('comp'), str):
            bad.append(f'{i}: needs a comp')
        if e['kind'] in ('text', 'card', 'effect') and e.get('render') is not False and not e.get('comp') and e.get('pace') is None:
            bad.append(f'{i}: kind {e["kind"]} has no comp: say which component draws it, or set "render": false if it is already in the rough')
        if e['kind'] == 'zoom' and e.get('render') is not False:
            W, H = doc['width'], doc['height']
            rg = e.get('region')
            if rg is not None:
                if not (isinstance(rg, list) and len(rg) == 4 and rg[0] >= 0 and rg[1] >= 0 and rg[2] > 0 and rg[3] > 0 and rg[0] + rg[2] <= W and rg[1] + rg[3] <= H):
                    bad.append(f'{i}: "region" must be [x, y, w, h] inside the {W}x{H} frame')
                    continue
                W, H = rg[2], rg[3]
            if e.get('to') is not None:       # a push: zoom -> to about (ox, oy)
                if not (isinstance(e.get('zoom'), (int, float)) and e['zoom'] >= 1 and isinstance(e['to'], (int, float)) and e['to'] >= 1):
                    bad.append(f'{i}: a push needs zoom and to (1 or more)')
                zooms.append(e)
            elif not (isinstance(e.get('zoom'), (int, float)) and e['zoom'] >= 1 and isinstance(e.get('x'), (int, float)) and isinstance(e.get('y'), (int, float))):
                bad.append(f'{i}: a zoom needs zoom (1 or more), x and y')
            else:
                w, h = W / e['zoom'], H / e['zoom']
                if e['x'] < 0 or e['y'] < 0 or e['x'] + w > W + 0.5 or e['y'] + h > H + 0.5:
                    bad.append(f'{i}: the zoom crop {w:.0f}x{h:.0f} at {e["x"]},{e["y"]} falls outside the {W}x{H} frame')
                zooms.append(e)
        if e['kind'] == 'blur' and e.get('render') is not False:
            bad += redact.validate_blur(e, doc['width'], doc['height'])
        if e['kind'] == 'caption' and not e.get('words'):
            bad.append(f'{i}: a caption needs words')
    zooms.sort(key=lambda e: e['at'])
    for a, b in zip(zooms, zooms[1:]):
        if b['at'] < a['end'] - 1e-6:
            bad.append(f'zoom {a["id"]} ({a["at"]}-{a["end"]}) overlaps zoom {b["id"]} ({b["at"]}-{b["end"]})')
    return bad


def timeline(doc):
    """The timeline.json the pace check reads: {"format", "events": [{at, end, kind, zoom?, text?, what?}]}. Same shape as before the pipeline."""
    out = []
    for e in doc['events']:
        if e['kind'] == 'blur':          # a redaction is not a change on screen for the pace check
            continue
        if e.get('pace'):
            for p in e['pace']:
                out.append({k: p[k] for k in ('at', 'end', 'kind', 'zoom', 'text', 'what') if k in p and p[k] not in (None, '')})
            continue
        t = {'at': e['at'], 'end': e['end'], 'kind': e['kind']}
        if e['kind'] == 'zoom':
            t['zoom'] = max(e.get('zoom', 1.5), e.get('to') or 0)
        text = e.get('text') or (e.get('props') or {}).get('text')
        if e['kind'] == 'caption' and not text:
            text = ' '.join(w[2] for w in e['words'])
        if text:
            t['text'] = text
        if e.get('what'):
            t['what'] = e['what']
        out.append(t)
    out.sort(key=lambda x: x['at'])
    return {'format': doc['format'], 'events': out}


def gaps(cut, doc, limit=10.0):
    """Stretches longer than `limit` s with nothing changing: overlay events + footage scene changes + cuts of the edit list."""
    ch = {0.0}
    for e in doc['events']:
        if e['kind'] != 'blur':
            ch.update((e['at'], e['end']))
    if os.path.isfile(cut.rough_scenes):
        ch.update(read_json(cut.rough_scenes)['times'])
    if os.path.isfile(cut.edl):
        ch.update(it['at'] for it in read_json(cut.edl)['items'])
    pts = sorted(ch) + [doc['duration']]
    return [(round(a, 1), round(b, 1)) for a, b in zip(pts, pts[1:]) if b - a > limit]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('cmd', choices=('check', 'gaps')); ap.add_argument('--video')
    a = ap.parse_args(argv)
    cut = Cut(a.video)
    notes = []
    doc = user_edits.load(cut, notes)
    for n in notes:
        say(cut, 'NOTE: ' + n)
    if a.cmd == 'check':
        with step(cut, 'events-check', events=len(doc['events'])):
            bad = validate(doc, cut)
            if bad:
                fail(cut, 'events.json is not valid:\n  ' + '\n  '.join(bad))
            write_json(cut.timeline, timeline(doc))
        by = {}
        for e in doc['events']:
            by[drawn_by(e) or 'none'] = by.get(drawn_by(e) or 'none', 0) + 1
        say(cut, f'events.json fine: {len(doc["events"])} events ({", ".join(f"{k} {v}" for k, v in sorted(by.items()))}); timeline.json written')
    g = gaps(cut, doc)
    say(cut, 'stretches over 10 s with no change: ' + (', '.join(f'{x}-{y}' for x, y in g) if g else 'none'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
