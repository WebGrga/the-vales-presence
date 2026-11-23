---
name: visuals-plan
description: Plan what each stretch of a locked rough needs on screen before placing any overlay: a beat sheet (video/out/visual-plan.md) of what is said, what is visible and where, what the viewer must get, and the one visual that does it (point at, explain, count, compare, name, react, or nothing). Use at the start of the visuals stage, and when someone says the visuals feel random, basic or like they repeat the speech.
---

# Plan the visuals from what the viewer needs

The first question is never "what overlay goes here". It is "what does the viewer need to see or understand at this moment, and is it already on screen". An overlay earns its place by pointing at, explaining, counting or comparing something real. A piece that does none of these is noise, however lively. Write the plan before you write any event.

## Write `video/out/visual-plan.md`

1. Read `out/rough-words.json` and `out/rough-scenes.json`. Cut the talk into beats: a sentence or a few that make one point. Times come only from those files.
2. For each beat look at the picture. Run `python $ENGINE/sheet.py` or take ffmpeg stills at the beat's start, middle and end, and read them. Write what is visible **and where, in the frame's pixels** (for example "judges' box x 1180 y 90 w 520 h 260; face cam bottom-left x 0 y 760 w 480 h 320").
3. Write what the viewer must get from the beat in one line.
4. Choose the visual and give the reason:
   - **Point at it**: `Callout` (arrow, label and ring on a box), `Spotlight` (dim all but a box on a busy screen), a ring or arrow from the kit.
   - **Explain it**: `Flow` (how it works, how it was built), `Steps` (a list ticked as it is said).
   - **Count it**: `Stat` (one number said or shown), `Scoreboard` (matches, races, A/B tests).
   - **Compare it**: `Compare` (before/after, A vs B), `Inset` of an earlier moment or a detail next to the live screen.
   - **Name it**: the name, number or verdict as the label of something shown (a callout on the thing, a node, a scoreboard row), never as a word floating on its own.
   - **React**: a sound effect, or a ring or spotlight on the moment (a win, a fail, a surprise).
   - **Zoom**: only to make a small detail readable.
   - **Nothing**: when the screen already shows it. Say so in the plan; a quiet beat is a decision.
5. Give every chosen piece its exact box or position, its start on the word it belongs to, and its end.

## Rules

- A label never repeats the spoken words. If the speaker says "the judges score it", the callout on the judges' box does not say "JUDGES". It may say "3 judges, 0 to 10" or "Judge 2: 4/10".
- No emoji, and no lone text (pop-in words, stamps, title words on their own): they read as filler. Text appears only as part of something shown. Only the house rules can ask for them.
- Never the same component three beats in a row. Mix points, explains, counts and quiet beats.
- Positions on a screen recording come from a still at that time, never from a guess. If the thing moves, plan one box per stretch.
- Keep clear of the face cam and of what the speaker is showing.
- **High quality or nothing.** A visual goes in only where it really shows something. A stretch with nothing worth showing stays clean: never a filler to keep a pace. A pace in the house rules is a ceiling, never a quota. House rules win over this skill; when they ask for a lot happening, find more real things to point at, explain and count, never fillers.

## Format

One entry per beat, in time order. A good one, from a screen-recorded devlog of a game arena (crowd, judges, a rehearsal mode; face cam bottom-left):

(Every position, name and score in this example is made up to show the form. Yours come only from your own stills and the words of your rough: a Scoreboard, Stat or Compare shows only numbers and names that are said or shown in the video.)

```
## 3. 02:41 to 02:52
Said: "the judges give it a score and the crowd reacts"
On screen: arena, crowd in the stands (y 500 to 900), judges' box top-right (x 1180 y 90 w 520 h 260), match timer top-centre; face cam bottom-left (x 0 y 760 w 480 h 320).
Viewer must get: the judges are a separate panel that scores each match, not the crowd.
Visual: Callout on the judges' box (x 1180 y 90 w 520 h 260, text "judges score every match", side left, avoid the face cam), anchored on "judges"; then Scoreboard for the match (Red 0 to 7 at "score", Blue 0 to 4), at 02:47.
Why: the box is small and the viewer cannot tell which part of the screen is meant; the score is a real number from the match.
```

The same beat done badly:

```
Visual: Pop "JUDGES" at "judges" + a random emoji at "crowd".
```

That echoes the speech, points at nothing and tells the viewer nothing new. Other beats of the same video can be `Nothing` ("the rehearsal toggle is big and centred and the speaker reads its label"), `Flow` (rehearsal mode: "crowd off", "judges only", "score saved", each node on its word) or `Stat` ("412 matches" counting up when said).

## Check before you place events

Read the finished plan once as a viewer. Does each beat get a different kind of help? Does any label repeat the speech? Is there any emoji or lone text? Is the face cam free? Then hand the plan to the visuals-overlays skill. When a note moves a beat, change its entry in `visual-plan.md` too.
