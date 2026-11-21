"""longform-clean: the visuals of a long video (1920x1080) as events. Lower-third labels, a chapter card, a bar chart, an optional
picture with rings, punch-ins from punches.json, sound cues, the end card, and (off by default) captions.

Copy this file and punches.json to <project>/video/out/work/ and components.tsx to <project>/video/remotion/src/components.tsx, then
run from video/out/work/:
    python make_overlays.py            -> video/out/events.json + video/out/timeline.json
    python <engine>/run.py --proof     -> a 540p proof of the overlay windows only
    python <engine>/run.py --final     -> the final, composed in cached chunks: a changed label re-renders one window and one or two chunks

As shipped it runs on any locked rough: every time is a share of the video's length and the sample text is neutral. Make it yours by
anchoring each event on a spoken word (find(W, 'word', after=...)) and by writing the real text.
"""
import json
import os
import sys


def engine_dir():
    """The engine of The Vale's Presence: $PRESENCE_ENGINE, else the nearest engine/ folder above this file or the current folder."""
    if os.environ.get('PRESENCE_ENGINE'):
        return os.environ['PRESENCE_ENGINE']
    for start in (os.getcwd(), os.path.dirname(os.path.abspath(__file__))):
        d = start
        while True:
            if os.path.isfile(os.path.join(d, 'engine', 'pipelib.py')):
                return os.path.join(d, 'engine')
            up = os.path.dirname(d)
            if up == d:
                break
            d = up
    sys.exit("The engine was not found: set PRESENCE_ENGINE to the engine folder of The Vale's Presence.")


sys.path.insert(0, engine_dir())
from pipelib import Cut                                   # noqa: E402
from events import Events, gaps                           # noqa: E402
from shortcaps import words_of, add_captions              # noqa: E402
from captions import DEFAULTS                             # noqa: E402

cut = Cut()
E = Events.for_cut(cut, 'long')
LEN = E.doc['duration']
W = words_of(cut)
t = lambda share: round(LEN * share, 3)                   # a moment as a share of the video (replace with spoken-word anchors)
here = os.path.dirname(os.path.abspath(__file__))

# ---- the text: neutral samples, write your own. (id, at, end, text, kicker, sound)
LABELS = [
    ('L1', 0.0, min(3.0, t(0.05)), 'One idea, start to finish', None, None),
    ('L2', t(0.22), t(0.22) + 3.0, 'Measure before you cut', 'Step 1', 'pop'),
    ('L3', t(0.55), t(0.55) + 3.0, 'Keep only what moves it forward', 'Step 2', 'pop'),
]
CARDS = [
    ('C1', t(0.35), t(0.35) + 3.5, 'Chapter', dict(n=2, title='The fix', sub='what changed and why'), 'chapter card'),
    ('C2', t(0.70), t(0.70) + 5.0, 'Bars', dict(title='Minutes per round', rows=[['Before', 70.0], ['After', 6.7]], unit=' min'), 'bar chart: before and after'),
    ('C3', max(t(0.92), LEN - 8.0), LEN, 'End', dict(text='WATCH NEXT'), 'end card with two end-screen slots'),
]
PICTURE = 'picture.png'   # put an image in <project>/video/remotion/public/ to show the Picture card
CAPTIONS = False          # long videos usually carry subtitles instead (Export, SRT); True burns word-lit captions in

for i, a, b, text, kicker, snd in LABELS:
    E.add(i, 'text', a, b, comp='Label', props=dict(text=text, kicker=kicker), text=text, what=f'lower-third label {i}',
          sfx=dict(file=snd, vol=0.3) if snd else None)
for i, a, b, comp, props, what in CARDS:
    E.add(i, 'card', a, b, comp=comp, props=props, text=props.get('title') or props.get('text'), what=what)
if os.path.isfile(os.path.join(cut.remotion, 'public', PICTURE)):
    E.add('P1', 'card', t(0.82), t(0.82) + 5.0, comp='Picture', what='a picture with two rings drawn in',
          props=dict(src=PICTURE, rings=[dict(cx=300, cy=240, rx=120, ry=70, after=0.6), dict(cx=1100, cy=600, rx=160, ry=90, after=2.0)]))
    E.sfx(t(0.82) + 0.6, 'marker', 0.35)
E.sfx(t(0.70), 'rise', 0.25)
E.sfx(max(t(0.92), LEN - 8.0), 'whoosh', 0.3)

# ---- punch-ins: 1.5x crops eased in and out by ffmpeg (no render). Times as shares of the video here; use real seconds of the rough.
try:
    punches = json.load(open(os.path.join(here, 'punches.json'), encoding='utf-8'))['punches']
except FileNotFoundError:
    punches = []
for p in punches:
    a, b = (t(p['a']), t(p['b'])) if p.get('share') else (p['a'], p['b'])
    if b <= LEN:
        E.zoom(p['id'], a, b, x=p['x'], y=p['y'], zoom=p.get('zoom', 1.5), ease=0.35, what=p.get('what', 'punch-in'))

# ---- captions (off by default): word-lit, kept off while a card or label is up
if CAPTIONS:
    blocked = [(a, b) for _, a, b, *_ in LABELS] + [(a, b) for _, a, b, *_ in CARDS]
    E.doc['captions'] = {'style': dict(DEFAULTS['long'], font='Montserrat Black', file='Montserrat-Black.ttf')}
    add_captions(E, W, max_words=6, max_chars=34, sentence_case=True, drop={'um', 'uh', 'er', 'ah', 'hmm'}, skip=blocked)

doc = E.write(cut)
print(len(W), 'words,', len(doc['events']), 'events | stretches over 10 s with no change:', gaps(cut, doc))
