---
name: shorts-pick-moments
description: Find the moments of a long video or recording that stand alone as Shorts (a hook in the first seconds, one point, a payoff, under 60 seconds) and write them as picks for the user to choose from. Use at the pick stage of making Shorts from a long video.
---

# Pick moments for Shorts

A Short is not a trailer for the long video. It is one complete thing a stranger scrolling past can follow from its first second: a question answered, a claim proved, a mistake and its fix, a reveal.

## Read the whole thing

Use the rough's words when there is a rough (`out/rough-words.json`), else the recordings' word files (transcribe them first if they are missing). Read the whole talk before you pick. Run `python $ENGINE/scan.py` if you need to know where the pauses and retakes are.

## A good moment

- **It opens strong.** Its first sentence, alone, makes someone stay: a surprising claim, a clear question, a result shown before it is explained. If the strong line comes in the middle, the Short can start there.
- **One point.** It makes one point and finishes it. Two half points are no Short.
- **It stands alone.** It needs nothing said earlier: no "as I said", no "this one" without showing what. A few words of setup can be cut in from elsewhere only when the join is clean.
- **It pays off.** It ends on the answer, the result or a line that lands, not trailing into the next topic.
- **It fits.** Between about 20 and 59 seconds once tightened. A great moment that runs long is still a pick: say what you would cut.
- **It shows.** A moment where something visible happens on screen beats one of pure talk.

Pick more than are needed, about twice, so the user has a real choice, and never two that make the same point.

## Write the picks

Write `studio/shorts/picks.json`:

```json
{ "picks": [
  { "id": "p1", "src": "rough", "from": 312.4, "to": 351.0, "title": "The one setting that halves the render",
    "hook": "the first line, as said", "why": "a claim, the proof on screen, a clear result", "len": 38.6, "trim": "the aside at 330 s goes" }
] }
```

`src` is `rough` (times in the rough) or a source key like `r1` (times in that recording). `from` and `to` sit in the quiet between words. `len` and `trim` are optional. Keep ids stable when you revise the list, and never set `chosen` yourself: the user marks the picks they want as cards, then approves. Report how many you found and which you think are strongest, and why, in a sentence each.
