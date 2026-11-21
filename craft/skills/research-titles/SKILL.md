---
name: research-titles
description: Find the top and outlier videos of a video's niche and what their titles share, and save them for the Studio (studio/research/videos.json + thumbnails). Use at the research stage, or whenever titles need evidence from real videos.
---

# Research titles: what already wins in this niche

The goal is evidence, not inspiration: which real videos on this topic did far better than their channel usually does, and what their titles have in common. Titles and thumbnails later model these (never copy them).

## 1. Name the topic in viewer words

Read `brief.md` and `studio/plan.md` if it exists. Write down 3 to 5 search phrases a viewer would type, not the creator's jargon. One broad ("build an app with ai"), one narrow (the exact tool or result), one outcome phrase ("app in a weekend").

## 2. Fetch with the research tool

The app folder is `PRESENCE_ROOT` if set, else three folders up from the project (`../../..`). From the project folder:

```bash
node "$PRESENCE_ROOT/server/studio/research-fetch.js" --project . --query "build an app with ai agents" --n 20 --channels 8
node "$PRESENCE_ROOT/server/studio/research-fetch.js" --project . --query "<second phrase>" --n 15
```

It runs yt-dlp for metadata only (nothing is downloaded but thumbnails), works out each channel's usual views (the median of its last 30 uploads) and the **outlier score** = views / that median, saves the thumbnails to `studio/research/thumbs/` and merges everything into `studio/research/videos.json`. Run it once per phrase; it merges, never loses what is there. Shorts (under 70 s) are left out.

Found a strong video by WebSearch or by name? Add it: `--add "https://www.youtube.com/watch?v=...,https://youtu.be/..."`.

If yt-dlp is missing, say so in one line (install: `uv tool install yt-dlp` or `pip install yt-dlp`) and stop the stage; don't invent numbers.

## 3. Read the numbers like a researcher

- An **outlier** is 2× or more of its channel's usual. 5× is a real hit. Views alone mostly measure channel size.
- A big channel's 1.2× is weaker evidence than a small channel's 8×.
- Be wary of a hit older than a year (trend timing) and of one tied to news.
- Look outside the niche too: the same viewer, another topic (one search for the format, not the topic).

## 4. Write your notes into the file

Add a `notes` field at the top of `studio/research/videos.json` (keep the rest as it is) with 5 to 10 short lines:

- the 3 to 5 strongest outliers and *why you think* each won (promise, stakes, specificity, timing);
- the title shapes they share (e.g. "result + time frame", "I tried X for N days", "X vs Y");
- what nobody in the niche says yet (the gap this video can own);
- any outlier you would *not* model, and why.

You may add a short `note` to single videos too. The Studio's Research page shows the grid, the outlier scores and the title patterns it computes (length, numbers, caps, questions, brackets, first person, two-part titles, repeated words: top against all).

## Done when

`studio/research/videos.json` has at least 12 videos with views, most with an outlier score and a thumbnail, and your notes. Also follow `research-thumbnails` at the same stage when the recipe asks for thumbnails.
