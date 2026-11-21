---
name: cut-dialogue-pass
description: Plan the rough cut of talking footage (a talking head, a devlog, a screen session with a voice) by taking out false starts, retakes, fillers, asides and dead air, while the speaker still sounds like themselves and every word stays whole. Use at the rough stage, before the rough is built.
---

# The dialogue pass

The rough cut of talk is mostly taking things out. The aim is a speaker who sounds sure and natural, never one who sounds chopped.

## Measure first

Run `python $ENGINE/scan.py` from `video/`. It writes `out/work/scan.md` with, per recording: the room tone and speech level, silences, fillers, retakes, quiet asides, dead air and waits. It measures; you decide. The word files it reads come from `transcribe.py`, which keeps the fillers that were said and places each word on its sound.

Read `scan.md` once from top to bottom, then read the words around every retake and aside before you choose.

## What comes out

- **Retakes.** A line said again: keep the delivery that works and cut the other, together with the moment of noticing ("no, wait", "let me say that again"). The later take is usually the meant one, but not always; clean edges never decide it. A phrase repeated for emphasis is not a retake.
- **Asides.** A line much quieter than the talk around it is usually a note to whoever edits ("cut that", "grab a screenshot here"). Cut it with the pause around it, and quote it in your report; flag it when it asks for something to be done.
- **Fillers.** Cut an "um" or "uh" when the line flows better without it. Keep one that carries real hesitation the moment needs.
- **Dead air.** About a second with nothing happening already plays as dead air. Typing, loading and waiting cut to the moment the result appears, or play fast when watching it tells the viewer something (see `cut-speed-waits`).
- Coughs, sighs, lip smacks, a notification sound, a remark to someone off-mic: out, with the pause around them.

## How tight

A pause earns its length: a beat before a reveal, a reaction, time to read what just appeared on screen. The speaker's own short pauses inside a sentence are how they talk; leave them. Between sentences of one thought, about a quarter to a third of a second of air is a good guide. Several cuts in a row play as a stutter: let the speech between cuts run as it was said.

Before you finish, account for every stretch of two seconds or more without a word: cut it, speed it, or keep it for what is on screen, and know which.

## The joins

Every join keeps about 0.2 s of room tone after the last kept word and about 0.05 s before the next one, with both edges in the quiet and never inside a word. `python $ENGINE/joins.py check` lists clipped words, tight or loose air and stutters; `python $ENGINE/joins.py snap` moves edges a little to fix them; check again after a snap. A clipped word is never handed over.

## Say why, flag what is theirs

Each item of `out/edl.json` that follows a cut carries `cut_before: {kind, why, flag, ask}`, with `kind` one of pause, filler, retake, aside, wait, other, and `why` in a few plain words. Set `flag: true` with an `ask` only for what is the user's to decide: which take they meant, whether a line belongs. A join you could fix yourself is not a question. At the rough review the user sees every cut with its removed words and Before/After, flagged ones first.
