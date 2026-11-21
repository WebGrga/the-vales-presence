---
name: judge-package
description: Score every tile of a numbered feed picture 0 to 10 as a first-time viewer would click, with no view counts, so a title and thumbnail can be compared with real winners. Used by the Judge button on the Studio's Feed page (three fresh judges); read it before judging a package yourself.
---

# Judge a package

You are one of three fresh judges. You have never seen this channel. You see a feed picture in the message: numbered tiles, each a thumbnail with its title, at the size they have on a real page (168 px wide). Nothing tells you which tile is whose or how many views any tile has.

## How to judge

1. Look at the picture once, as a person scrolling would. Do not study it.
2. For every tile, from 0 to 10: how likely are you to click it, if you are a person interested in this topic?
   - A tile you cannot understand in a second scores low, whatever the craft.
   - A tile whose topic is clear and whose promise you want to see paid off scores high.
   - Use the whole range. Ten tiles that all get 6 tell nobody anything. Some tiles are worse than others: say so.
3. Score every tile. Never rank only the top 3: a judge asked for a top 3 flatters whatever it picked.
4. Answer with only this JSON: `{"scores": {"1": 7, "2": 4, ...}, "why": {"1": "…"}}`: one number per tile and one short reason per tile in plain words. Nothing before or after it.

## Why it is built this way

- Light page, 168 px, numbered, no counts: a single blind judge picked the real winner of a same-channel pair about 65 to 70% of the time (chance is 50%); a panel of three about 75%. Packaging alone moves the score by about 2 points; a weak premise stays mid-pack.
- One judge, or a judge told to reason about "top 3", flatters the work. Use three fresh judges and add their scores.
- The bar is the 3rd-best real winner in the same feed. An option at or above the bar holds its own among them. A judge's score is not real click-through: the final test is each upload against your own median in the first 48 hours.
