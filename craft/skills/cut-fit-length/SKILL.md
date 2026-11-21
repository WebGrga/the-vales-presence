---
name: cut-fit-length
description: Bring a cut to a target length (a Short under 60 seconds, a long video of about N minutes) by taking out what the video needs least, whole passages first and breaths last. Use when the brief, the plan or the user names a length and the cut runs over.
---

# Fit a target length

If no length was named, this skill does nothing: cut for the talk, not for a number.

## Read it first

Read the whole cut start to end, as it plays, before you choose anything. Then take out whole passages before you tighten lines. A video that loses a tangent still feels like itself; a video with every breath squeezed out feels rushed.

## What goes first, roughly in this order

1. Asides and tangents that never come back.
2. A second example, story or demo that makes the same point as one you keep. Keep the clearer one.
3. Recaps of what the viewer just saw, and setup they don't need for what comes next.
4. Long build-ups to a point that lands just as well when it arrives sooner.
5. Only then pauses and fillers (`cut-dialogue-pass`), if any are left.

Keep the promise the opening makes and the part that pays it off, anything the ending refers back to, and anything the brief names. A passage that is the only place something needed is said stays.

## Every cut lands

Cut between sentences or between thoughts. The line after a cut must make sense without what went: no "as I said" pointing at removed words, no "the second thing" when the first is gone. Take a few more words when the join needs it. Run `joins.py check` on every join.

## Hit the number, then stop

"Under ten minutes" means under; "about eight" means within a few seconds of eight. Don't keep cutting because more could go. When the target can only be reached by losing something the video needs, cut what clearly doesn't belong and flag the rest (`cut_before.flag`, with an `ask` that says in one sentence what the viewer would lose): that choice is the user's. Report the length you reached.
