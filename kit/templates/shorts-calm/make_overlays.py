"""shorts-calm: the visuals of a calm vertical Short (1080x1920) as events. A title card, one label card, strokes under a line on screen,
a soft marker box, and captions that show a whole line at once in a dark pill (no word lighting, no pop).

Copy this file to <project>/video/out/work/ and components.tsx to <project>/video/remotion/src/components.tsx, then run from video/out/work/:
    python make_overlays.py            -> video/out/events.json + video/out/timeline.json
    python <engine>/run.py --proof     -> a 540p proof of the overlay windows only
    python <engine>/run.py --final     -> the final: only changed windows are rendered

As shipped it runs on any locked rough: every time is a share of the Short's length and the sample text is neutral. Positions are pixels
of the 1080x1920 rough: measure them from a still of yours (ffmpeg -ss 12 -i ../rough.mp4 -frames:v 1 still.png).
"""
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
from shortcaps import words_of, blocks                    # noqa: E402
from captions import Measure, DEFAULTS                    # noqa: E402

cut = Cut()
E = Events.for_cut(cut, 'short')
LEN = E.doc['duration']
W = words_of(cut)
t = lambda share: round(LEN * share, 3)                   # a moment as a share of the Short (replace with spoken-word anchors)

# ---- made text and marks (one block of text at a time; text starts at y 120 or lower)
TITLE = ['A QUIETER WAY', 'TO SAY IT']
LABEL = ['Say the one thing that matters']
E.add('TITLE', 'text', 0.0, min(3.2, t(0.15)), comp='Card', text=' '.join(TITLE), what='title card, top band, types on',
      props=dict(lines=TITLE, size=60, type=True, top=120))
E.add('UNDER', 'effect', t(0.25), t(0.25) + 4.0, comp='Strokes', what='strokes under two lines of text on screen (measure from a still)',
      props=dict(strokes=[dict(x=80, y=1040, w=520, at=0), dict(x=80, y=1100, w=440, at=0.25)]), sfx=dict(file='marker', vol=0.25))
E.add('BOX', 'effect', t(0.45), t(0.45) + 4.0, comp='Marker', what='a soft marker behind a word on screen',
      props=dict(box=[420, 700, 300, 46], color='#4f8cff', alpha=0.45, draw=0.35))
E.add('LABEL', 'text', t(0.65), t(0.65) + 3.5, comp='Card', text=' '.join(LABEL), what='label card, top band',
      props=dict(lines=LABEL, size=46, top=120))
blocked = [(0.0, min(3.2, t(0.15))), (t(0.65), t(0.65) + 3.5)]  # captions pause while a card is up

# ---- captions, style B: the whole line at once in a dark pill, lower third, x 60-900 (clear of the Shorts buttons)
style = dict(DEFAULTS['short'], mode='word', size=58, autosize=None, x=480, y=1340, maxw=840, pad_x=28, pad_y=10, radius=18, box_alpha=0.7,
             gap_em=0.27, dim=1.0, pop=1.0, active=None, accent='#ffffff')
E.doc['captions'] = {'style': style}


def fit(text, size=58, maxw=800):
    while size > 40 and Measure(style, size).width(text) > maxw:
        size -= 2
    return size


lines = blocks(W, max_words=6, max_chars=30, pause=0.6, sentence_case=True, drop={'um', 'uh', 'er', 'ah', 'hmm'}, skip=blocked)
for n, c in enumerate(lines):
    a = max(0.0, c[0][0] - 0.05)
    b = lines[n + 1][0][0] - 0.05 if n + 1 < len(lines) else min(c[-1][1] + 0.6, LEN)
    b = min(b, c[-1][1] + 0.8)
    for s0, _ in blocked:
        if a < s0 < b:
            b = s0 - 0.05
    if b - a < 0.3:
        continue
    text = ' '.join(x[2] for x in c)
    # every word starts with the line (a = a + 0.01): the whole line shows at once
    E.add(f'K{n + 1}', 'caption', round(a, 3), round(b, 3), words=[[round(a, 3), round(a + 0.01, 3), x[2]] for x in c], text=text,
          what='caption line, style B', size=fit(text))

doc = E.write(cut)
print(len(W), 'words,', len(lines), 'caption lines,', len(doc['events']), 'events | stretches over 10 s with no change:', gaps(cut, doc))
