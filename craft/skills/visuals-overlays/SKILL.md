---
name: visuals-overlays
description: Dress a locked rough with overlays, zooms, captions and sound, and hide private things on screen with blur boxes: write events.json with the engine's Events builder and an overlay kit, check a proof, then render the final once. Use at the visuals stage, after the rough is approved and locked, and for a note like "blur the numbers".
---

# Overlays: events, proof, then final

The rough is locked. Visuals sit on top of it and never change a word of the talk. Work from `video/`.

## Start from the plan

Open `out/visual-plan.md`. When it is missing, write it first with the visuals-plan skill. Every event below comes from a beat in it, and an event with no beat does not go in. The pace in the house rules is filled from the plan, never with echo words or filler emoji.

## What you have

- `out/rough-words.json`: every word with its time in the rough. **Times come only from here** (or from `tmap`), never from guesses or from the source recording's clock.
- `out/rough-scenes.json`: where the picture changes.
- The overlay kit in `remotion/src/components.tsx`: it exports `COMPONENTS`, and each component's doc comment lists its props. If the project has no kit yet, copy one from the app's `kit/templates/` that suits the video, and say which.
- The show components (`Callout`, `Spotlight`, `Inset`, `Flow`, `Compare`, `Stat`, `Steps`, `Scoreboard`) point at, explain, count and compare real things. They live in the app's `kit/show/show.tsx`. When the project's kit lacks them, copy that file into `remotion/src/` and add `...SHOW` to `COMPONENTS` (`import { SHOW } from './show'`). Their doc comments list the props. Prefer them to text pieces whenever the plan says point, explain, count or compare.
- The house rules and the brief: what the user likes on screen and what the video must show.
- **The user's own edits, which win over yours:** `out/redactions.json` (blur boxes the user drew in the viewer) and `out/event-edits.json` (overlays the user changed in the inspector: words, props, timing, hidden). The engine applies both on every check, proof and final; you never copy them into events.json. Read them before a round so you know what the user already fixed. To take one of their edits over into your plan, put it in `make_overlays.py` and tell the user; do not delete their files.

## Write events.json

Write the plan as a script, `out/work/make_overlays.py`, so a note changes a line and runs again:

```python
import os, sys; sys.path.insert(0, os.path.join(os.environ['PRESENCE_ROOT'], 'engine'))
from pipelib import Cut; from tmap import load; from events import Events, gaps
cut = Cut(); T = load(cut.edl)
E = Events.for_cut(cut, 'long')          # 'long' or 'short': the pace check's numbers
E.add('L1', 'text', 40.9, 44.1, comp='Label', props={'text': 'One request'}, what='label L1', sfx={'file': 'pop', 'vol': 0.16})
E.zoom('Z1', 23.4, 49.5, x=0, y=30, zoom=1.5, what='the settings pane')
E.caption('K1', [[1.0, 1.3, 'Hello'], [1.3, 1.7, 'there']])
doc = E.write(cut)
print(gaps(cut, doc))                     # stretches over 10 s where nothing changes
```

- An event is `{id, kind, at, end}` plus what draws it: `comp` and `props` (a Remotion component), zoom fields (drawn by ffmpeg, no render), `box` (a blur, drawn by ffmpeg, no render), or `words` (a caption, drawn as subtitles, no render).
- `kind` is the pace check's word: `text`, `card`, `effect`, `caption`, `zoom`; and `blur`, which the pace check leaves out.
- **Ids are stable.** Never renumber on an edit: a changed id is a new window to render.
- Positions on the screen recording (a box for `Callout`, `Spotlight`, `Inset`) come from looking at a still at that time (`sheet.py` or an ffmpeg frame), never from a guess. Pass `avoid` with the face-cam corner when the component takes it.
- Anchor each overlay on the word it belongs to, so it appears as the thing is said.
- Leave room: an overlay that covers the speaker's face or the subject on screen is in the wrong place.
- Captions never show fillers. Zooms never overlap.

## Private things on screen: blur boxes

Keys, passwords, emails, account ids, private numbers (views, CTR, revenue), home paths, other people's messages: hide them with a blur box, never with an overlay component and never with a pipeline of your own. There is no OCR step: you find them by looking.

```python
E.blur('B1', 28.0, 34.0, [40, 38, 1400, 44], mode='blur', what='CTR and impressions in the header')   # box = [x, y, w, h] in the rough's pixels
E.blur('B2', 61.2, 66.0, [0, 980, 640, 100], mode='pixelate')                                      # or 'fill' (a solid box, the safest)
```

- Find them with your eyes: `python $ENGINE/sheet.py` (or ffmpeg frames at the times the words or the scenes point to) and read the frames. Inspect lists what it saw in `out/review-items.json`.
- The box is in the **rough's** pixels (before any zoom; a zoom over it scales the blur with the picture). Pad it about 10 px each side. One box per place on screen; if the text moves, give each place its own box and time.
- Times from `rough-words.json` or the scenes: from the moment it shows to the moment it goes, not the words around it.
- A blur costs no render: only the chunks of the final it overlaps are encoded again, so a blur fix is a `--final` of a minute or two, not a long background job. Say which boxes you added and ask the user to check them in the viewer (they show there, live, and the user can move them).
- When the user asks for a blur and you cannot tell where, ask them to draw the box in the viewer (Blur box, then I and O) instead of guessing.

## Proof

`python $ENGINE/run.py --proof` (background). It renders only the windows whose hash changed, at 540p, and writes `out/proof.mp4` and `out/proof-sheet.jpg` with each clip labelled by time and event ids. Look at the sheet and the clips yourself before anyone else does, and check them against `visual-plan.md`: each event does what its beat says, in the place it names. Then look for: text that is cut off, an overlay over a face, a zoom that hides what is used, timing that lands before the word. Fix the events and run `--proof` again; it re-renders only what changed. Report how long each proof took.

## Final

When the proof is right, `python $ENGINE/run.py --final` once (background). It renders the remaining windows, composes the video in cached chunks, and runs `check_cut.py`: the final must have the rough's length, frames and voice, and the locked files must still match. A failed check is never handed over: read what it says and fix it.

## After a note

Change the events the note names and nothing else, run `--proof` for those, then `--final`. Only the touched windows and chunks render again, so a fix takes seconds to minutes, not a full render. Say how long it took.
