---
name: title-options
description: Write YouTube title options for a finished video into studio/titles.json, modelled on the niche's real outliers, with families, reasons and an honesty check. Use at the titles stage, or when the user asks for more or better titles.
---

# Title options

Read: `studio/research/videos.json` (videos, outlier scores, your notes), `studio/plan.md`, the final cut's words (`video/out/rough-words.json` or captions) so every title is true to what the video shows, and `studio/titles.json` if it exists (the user's picks, notes and edits are there).

## Method

1. **Model, don't invent.** Pick 3 to 5 title shapes from the strongest outliers (outlier ≥ 2×), e.g. "I [did X] in [time]", "[X] vs [Y]: [verdict]", "The [adjective] way to [result]", "[Number] [things] that [result]", a question with stakes. Look at one or two shapes from outside the niche too.
2. **Write 12 or more** across at least 3 shapes. Use the video's real specifics: exact numbers (47, not "about 50"), the real tool or place, strong verbs ("broke", "replaced", "beat").
3. **Cut to 4 to 8** for the user:
   - the hook lands in the first ~45 characters; the whole under ~70 (the Studio flags 55+ and 70+);
   - one idea per title; no clickbait the video doesn't pay off;
   - it reads clearly to someone outside the niche;
   - different from each other (different shapes), so the user has a real choice.
4. **Honesty check**: a title fails only if the thing it promises never happens on screen in any form, or a viewer who watched it all would feel cheated. Bold is good; false is not.

## studio/titles.json

```json
{
  "about": "one line: what these titles try",
  "options": [
    { "id": "t1", "title": "I Let AI Agents Build My App in 48 Hours", "family": "challenge + time frame", "why": "Models the 93× outlier's shape; the time frame is in 5 of the top 8." }
  ],
  "picked": null,
  "shortlist": []
}
```

- Keep every existing option's `id` and its place; add new ones with new ids (`t9`, `t10`, ...). Never remove or rename options the user picked, starred, edited or wrote (`"by": "you"`); keep `picked`, `shortlist` and `notes` as they are. The Studio also keeps the user's choices in `studio/choices.json` and lays them over your file.
- Read the user's `notes` on options: they say what to change. A new version of a noted option gets a new id and a `why` that names the note.
- `why` is one short line of evidence (which outlier, which pattern), not praise.

The user picks, edits and stars titles on the Studio's Titles page; starred ones go into the feed test.
