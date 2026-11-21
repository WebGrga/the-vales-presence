---
name: cut-punch-in
description: Punch in and out on a talking head or a camera band (tighter across jump cuts and on lines that matter), placed from where the face really is through the whole stretch. Use at the visuals stage when the cut has camera footage.
---

# Punch-ins on a face

A punch-in is a tighter framing of the same shot. Used well it hides a jump cut and puts weight on a line; used on every sentence it becomes a rhythm the viewer notices.

## Measure the face

`python $ENGINE/faces.py track <source>` finds the face in a recording once. `python $ENGINE/faces.py punch <t0> <t1> --scale 1.1 --src <source>` gives one zoom box for a stretch of the rough, placed from where the face is through the whole stretch, not from one frame. It answers `fits: false` when the speaker moves too much for that framing; take a milder one.

## Where

- Where two pieces of the same shot meet at a cut, change the framing across the cut so it reads as a new angle, not a jump. Inside a sentence a mild step in is enough; come back out where the thought ends. Cuts close together can share the tight framing.
- After a cut that removed a long wait, the speaker often comes back in a different position: give that line the tighter framing.
- Push in on a line with weight (a punchline, a key claim, a reveal) and come back out when the thought ends.
- Hold each framing for at least a few seconds.

## The framing

- About 110% of the wide frame across a jump cut, about 120% on a line with weight, further only for a deliberate close-up.
- Eyes about a third of the way down, a little more room on the side the speaker looks toward, chin and mouth always in.
- The framing changes on the cut or on a beat between sentences, never in the middle of a word. It is a cut, not a move (a zoom with `ease` 0), unless a slow push is asked for.
- Never let a framing flash by: well under a second reads as a glitch. When an insert hands back to the camera near a framing change, make both happen on the same frame.
- Stay within what the source holds: a 1080p source goes soft past a small punch-in.
- A camera inset over a screen recording stays as it is; framing the screen is `cut-frame-screen`.

## In events.json

Each framing is an `E.zoom(id, at, end, x=, y=, zoom=, ease=0, what=)` event with rough times. Zooms never overlap and never touch Remotion, so they cost no render.
