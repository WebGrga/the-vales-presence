---
name: shorts-reframe-captions
description: Turn a picked moment or a vertical cut into a finished Short: a 9:16 reframe placed from the face or the subject, word-by-word captions in the safe zone, a hook in the first second and a clean end. Use at the cut and visuals stages of a Short.
---

# Reframe and caption a Short

A Short is 1080x1920 at the source's frame rate. It is watched on a phone, often without sound, with the app's buttons over its right side and bottom.

## The cut

From a long video, each chosen pick (`"chosen": true` in `studio/shorts/picks.json`) becomes its own Short in its own workshop, `shorts/<pick id>/video/`, with `out/final.mp4` at the end. Run the engine with `--video` pointing there.

Cut the moment like any rough (`cut-dialogue-pass`, tighter than a long video: a Short has no room for a breath that does not earn it) and fit it under 60 seconds (`cut-fit-length`). Start on the hook line, with no greeting and no run-up. End on the payoff, with no sign-off.

## The reframe

- Camera footage: `python $ENGINE/faces.py track <source>` once, then `python $ENGINE/faces.py reframe <t0> <t1> --src <source>`. It gives one 9:16 crop per unbroken run, moving only on cuts. A crop that drifts while someone talks reads as a wobble.
- Screen footage: frame the pane or the thing being shown (`cut-frame-screen`, `focus.py`). Text must read on a phone: when it cannot at full width, show the part that matters, or split the frame with the camera in one band and the screen in the other.
- The face keeps its eyes about a third of the way down. Nothing that matters sits in the bottom fifth or the right edge, where the app's buttons are.
- A punch-in that is a crop of the footage is part of the cut, not of the visuals.

## The captions

- Word by word, from `out/rough-words.json` (the `shortcaps.py` helpers in the engine: `add_captions`, `find`, `patch`): at most about five words a block, breaking at sentence ends, commas and pauses.
- The word being said lights up; an accent colour only on the few words that carry the point.
- In the safe zone: clear of the top bar, the bottom fifth and the right-hand buttons. Move them when they would cover a face or the subject.
- No fillers in the captions. Put back a small word the transcript dropped (`patch`) rather than leave a gap.

## The hook

The first second carries the promise: the hook line spoken at once, and a short top-band text (a few words) when the first frame alone does not say what this is. Then the visuals follow `visuals-overlays`: proof first, the final once, `check_cut.py` passing.

## Report

The Short's length, where it starts and ends in the source, the reframe runs, and anything you would like the user to look at.
