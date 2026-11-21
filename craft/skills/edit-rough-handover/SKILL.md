---
name: edit-rough-handover
description: Take a project from dropped-in footage to a rough cut handed over for review (words, measurements, the edit list, clean joins, rough.mp4, the cuts list with Before/After clips), and take notes from a send-back. Use at the rough stage of any cut.
---

# From footage to a handed-over rough

The rough stage ends when the user can review every cut: `video/out/rough.mp4`, `rough.json`, `rough-words.json` and `cuts.json` with its clips exist, and every join passes. Work from `video/`. Long steps run in the background (see CLAUDE.md): start, say what runs, end the turn.

## 1. Words, once per recording

For each file in `footage/`, `uv run $ENGINE/transcribe.py footage/<file> out/work/words-<src>.tsv`. It is verbatim (fillers kept) and aligned (each word on its sound). Name sources `r1`, `r2`... in recording order. A word file that exists is not made again.

## 2. Measure

`python $ENGINE/scan.py` writes `out/work/scan.md`. Read it whole. Note the length of each recording and what the scan left out.

## 3. Plan the cut

Read `brief.md` and the house rules, then cut with the skills switched on for this stage (the dialogue pass first, waits and length when they apply). Write the plan as a small script, `out/work/build_edl.py`, that builds the edit list with the engine's helpers, so a send-back changes a line and runs again:

```python
import os, sys; sys.path.insert(0, os.path.join(os.environ['PRESENCE_ROOT'], 'engine'))
from edl import new, add_piece, add_wait, cut_before, write
edl = new(fps=60, width=1920, height=1080, sources={'r1': {'file': 'footage/rec1.mkv', 'words': 'out/work/words-r1.tsv'}})
add_piece(edl, 'S', 'r1', 27.82, 35.17, beat=1)
add_piece(edl, 'S', 'r1', 36.40, 51.02, beat=1, cut_before=cut_before('retake', 'second take of the opening line'))
write('out/edl.json', edl)
```

Check the helpers' real signatures in `$ENGINE/edl.py` before you write the script. Every cut gets a `cut_before` with a kind and a plain `why`; flag only what is the user's to decide.

## 4. Clean joins

`python $ENGINE/edl.py check`, then `python $ENGINE/joins.py check`. Fix what it reports in the plan, or `joins.py snap` small edge problems and check again. Repeat until check passes. A clipped word is never handed over.

## 5. Build and hand over

`python $ENGINE/build_rough.py` (background), then `python $ENGINE/handover.py` (background). The handover writes `rough.json`, `rough-words.json`, `rough-scenes.json` and `cuts.json` with a Before and After clip for every cut. A failure making clips is a warning, not a failed handover: say so.

## 6. Report

In a few lines: the source length and the rough's length, how many cuts of each kind, what is flagged and why, any aside that asked for something, how long each render took. Then the stage is done and the user reviews.

## When the rough comes back

The user's choices come first. They arrive in the send-back notes (each cut's keep, restore or note; the review itself is kept as `out/cuts-review.sent-<time>.json`), and `out/edl.working.json` holds their Keep/Restore, struck words, ripple deletes, splits and moved joins already applied when it exists (`working.trims` lists each join they moved, `working.blades` each split). Start from their working list, apply the notes on top, never undo a choice they made, and go through steps 4 to 6 again. A join they moved is theirs: `joins.py check` still measures it, and if it clips a word, tell them where and by how much instead of moving it back yourself. `build_rough.py` refuses while a handed-over rough is there: delete `out/rough.json` before the build (the handover writes it again). If a note shows a way of working that would go wrong on another video, write the lesson (CLAUDE.md, "The house rules book").

## After "Approve & lock"

The rough is locked. Never run `build_rough.py`, `joins.py snap` or anything else that writes `edl.json` or `rough.mp4` again. If the talk must change, ask the user to reopen the rough review.
