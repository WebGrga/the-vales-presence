---
name: title-options
description: Write YouTube title options for a finished video into studio/titles.json, modelled on the niche's real outliers, with families, reasons and an honesty check. Use at the titles stage, or when the user asks for more or better titles.
---

# Title options

Read: `studio/research/videos.json` (videos, outlier scores, your notes), `studio/plan.md`, the final cut's words (`video/out/rough-words.json` or captions) so every title is true to what the video shows, and `studio/titles.json` if it exists (the user's picks, notes and edits are there).

## Method: premise first, with a gate

The premise sets the ceiling; packaging adds about 2 points. A weak premise stays mid-pack whatever the picture, so judge the premise as text before any picture is drawn.

1. **Model, don't invent.** Pick 3 to 5 title shapes from the strongest outliers (outlier ≥ 2×), e.g. "I [did X] in [time]", "[X] vs [Y]: [verdict]", "The [adjective] way to [result]", a question with stakes. Look at one or two shapes from outside the niche too.
2. **Write 30 to 50 premise + title lines** (one line each: the premise in a sentence, then the title) across at least 4 shapes. Only premises the video really shows. Every line has its own premise: if two premises would make the same thing happen on screen, write one of them. Use its real specifics: exact numbers (47, not "about 50"), the real tool or place, strong verbs ("broke", "replaced", "beat").
   - A premise that works: one sentence a stranger can picture, a test with an uncertain ending, no insider words, a payoff that can be shown on a thumbnail. Typical shapes: a famous thing under an impossible limit; one simple action repeated a big number of times; a tool the viewer already uses, shown doing something new; a handicap that guarantees a result worth watching.
   - Ask "why would they click?" three times in a row, each about the answer before, until you reach the viewer's goal and the reward; write from that last answer, not from what happened in your video.
3. **Clarity check on every line.** Would a stranger who has never heard of this tool know from the title alone what the video is about and why to click? The title says the topic in the viewer's own words, plus a hook (a good side and a bad side, or a familiar feeling). A line that fails is cut here; name why. A number needs its meaning next to it.
4. **Judge as text, with real winners mixed in.** Take the 12 strongest real titles from `studio/research/videos.json` (by outlier score). Mix them with your lines, number them, hide which are which, and score every line 0 to 10 as a viewer who has never seen the channel would click. Use three fresh sub-agents that see only the numbered list (average their scores); if you must score alone, say so in `about`, because one judge flatters. Write the scores into `lines` in `studio/titles.json` (see below).
   Be a hard judge: a stranger scrolling clicks on very little. Real winners usually land between 4 and 8 and most of your own lines should land below them; if more than a third of your lines clear the gate, the scoring is too soft, so score the whole list again with more reserve before you go on.
5. **The gate** is the 3rd-best real title's score. Only lines at or above it get thumbnails. If fewer than 3 lines pass, rewrite the premises (not the wording) and judge again, once. Say in `about` how many passed.
6. **Group by idea, then cut.** Take the lines above the gate and group them by the idea they promise: two lines are the same idea when the viewer would see the same thing happen, however it is worded ("in a weekend" and "in 48 hours" and "in one weekend" are one idea; "zero code" and "I didn't write a line" are one idea; the same title as a statement and as a question is one idea). Keep only the best line of each group. Name each group in 3 to 5 words (its `idea`).
   **Cut to 3 to 8 options**, one per group, so every option has a different `idea`. If only 3 or 4 ideas pass the gate, give 3 or 4 options: do not fill the list with rewordings, and do not lower the gate to get more. Different shapes, so there is a real choice:
   - the hook lands in the first ~45 characters; the whole under ~70 (the Studio flags 55+ and 70+);
   - one idea per title; no clickbait the video doesn't pay off; no two options with the same idea in other words (their `idea` fields all differ: read them side by side before you write the file);
   - no other channel in the niche could use the same title: write beside it the one thing only this video has, or drop it.
7. **Honesty check**: a title fails only if the thing it promises never happens on screen in any form, or a viewer who watched it all would feel cheated. Bold is good; false is not.
8. **The promise**: one line per option, what the viewer will see happen (and what could fail).

## studio/titles.json

```json
{
  "about": "one line: what these titles try, and how many of the lines passed the gate",
  "gate": 7.5,
  "lines": [
    { "premise": "Five agents build one app in a weekend", "title": "I Let AI Agents Build My App in 48 Hours", "score": 8.2, "clear": true },
    { "premise": "A tour of the setup", "title": "My Agent Setup, Explained", "score": 4.1, "clear": false, "failed": "a stranger cannot tell what the video gives them" }
  ],
  "options": [
    { "id": "t1", "title": "I Let AI Agents Build My App in 48 Hours", "family": "challenge + time frame", "premise": "Five agents build one app in a weekend", "idea": "app built in a weekend", "promise": "You watch an app appear from an empty folder; it could fail on the last day.", "score": 8.2, "why": "Models the 93× outlier's shape; the time frame is in 5 of the top 8." }
  ],
  "picked": null,
  "shortlist": []
}
```

- Keep every existing option's `id` and its place; add new ones with new ids (`t9`, `t10`, ...). Never remove or rename options the user picked, starred, edited or wrote (`"by": "you"`); keep `picked`, `shortlist` and `notes` as they are. The Studio also keeps the user's choices in `studio/choices.json` and lays them over your file.
- Read the user's `notes` on options: they say what to change. A new version of a noted option gets a new id and a `why` that names the note.
- `lines` is every premise + title line you wrote (30 to 50), with its score and, for a line that failed the clarity check, `failed` in a few words; `gate` is the 3rd-best real title's score; the Titles page shows them as a ranked list with the gate line. An option carries the `premise`, `idea`, `promise` and `score` of its line.
- `why` is one short line of evidence (which outlier, which pattern), not praise.

The user picks, edits and stars titles on the Studio's Titles page; starred ones go into the feed test.
