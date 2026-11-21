"""shorts-bold: the visuals of a vertical Short (1080x1920) as events. A hook in the top band on frame 0, a label, a big number,
a box drawn round something on screen, an end line, word-lit captions and a low music bed.

Copy this file to <project>/video/out/work/ and components.tsx to <project>/video/remotion/src/components.tsx, then run from video/out/work/:
    python make_overlays.py            -> video/out/events.json + video/out/timeline.json
    python <engine>/run.py --proof     -> a 540p proof of the overlay windows only
    python <engine>/run.py --final     -> the final: only changed windows are rendered

As shipped it runs on any locked rough: every time is a share of the Short's length and the sample text is neutral. Make it yours by
anchoring each event on a spoken word (find(W, 'word')) and by writing the real text. Change one line and run again: only that window
is rendered again.
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
from shortcaps import words_of, add_captions              # noqa: E402
from captions import DEFAULTS                             # noqa: E402

cut = Cut()
E = Events.for_cut(cut, 'short')
LEN = E.doc['duration']
W = words_of(cut)                                         # [[start, end, word, src, src_start], ...] in seconds of the rough
TOP = 120                                                 # made text starts at y 120 or lower (the phone's own icons sit above)
t = lambda share: round(LEN * share, 3)                   # a moment as a share of the Short (replace with find(W, 'word') anchors)

# ---- the text: neutral samples, write your own
HOOK = [dict(p=['THREE STEPS'], size=92), dict(p=[['ONE FIX', 'y']], size=108)]
LABEL = 'STEP 1: MEASURE IT'
STAT = dict(value='3x', label='FASTER', at=t(0.45))
END = [dict(p=['NOW YOU TRY IT'], size=84)]
END_AT = max(t(0.85), LEN - 3.0)

E.add('HOOK', 'text', 0.0, min(3.0, t(0.15)), comp='Band', text='THREE STEPS, ONE FIX',
      what='frame-0 hook in the top band', props=dict(top=TOP, h=280, lines=HOOK))
E.add('LABEL', 'text', t(0.2), t(0.2) + 3.0, comp='Label', text=LABEL, what='label pill in the top band',
      props=dict(text=LABEL, size=54, bg='g', top=TOP), sfx=dict(file='pop', vol=0.22))
E.add('BOX', 'effect', t(0.34), t(0.34) + 4.0, comp='Box', what='a box drawn round the thing being talked about (measure x, y, w, h from a still)',
      props=dict(box=[90, 620, 900, 260], color='y', tint=True, draw=0.4), sfx=dict(file='marker', vol=0.3))
E.add('STAT', 'text', STAT['at'], STAT['at'] + 3.5, comp='Stat', text=f"{STAT['value']} {STAT['label']}", what='a big number with its label',
      props=dict(value=STAT['value'], label=STAT['label'], top=TOP + 40), sfx=dict(file='hit', vol=0.25))
E.add('END', 'text', END_AT, LEN, comp='EndText', text='NOW YOU TRY IT', what='end line over a dimmed picture',
      props=dict(lines=END, top=760, dim=0.45), sfx=dict(file='whoosh', vol=0.25))
E.bed('music', vol=0.07, fade_in=0.3, fade_out=0.4)       # kit/sounds/music.wav, low under the voice; the voice itself is never re-levelled

# ---- captions: every word once, lit as it is said, kept clear of the made text above. Fillers (um, uh) are not shown.
E.doc['captions'] = {'style': dict(DEFAULTS['short'], y=1320)}     # full-height picture: the lower third (a split layout sits at y 1180)
blocks = add_captions(E, W, max_words=4, max_chars=24, sentence_case=True, drop={'um', 'uh', 'er', 'ah', 'hmm'},
                      skip=[(END_AT, LEN)], last_end=END_AT)          # no captions under the end line

doc = E.write(cut)
print(len(W), 'words,', len(blocks), 'caption blocks,', len(doc['events']), 'events | stretches over 10 s with no change:', gaps(cut, doc))
