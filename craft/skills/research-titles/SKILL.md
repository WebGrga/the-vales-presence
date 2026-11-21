---
name: research-titles
description: Find the top and outlier videos of a video's niche and what their titles share, and save them for the Studio (studio/research/videos.json + thumbnails). Use at the research stage, or whenever titles need evidence from real videos.
---

# Research titles: what already wins in this niche

The goal is evidence, not inspiration: which real videos on this topic did far better than their channel usually does, and what their titles have in common. Titles and thumbnails later model these (never copy them).

## 1. Name the topic in viewer words

Read `brief.md` and `studio/plan.md` if it exists. Write down 3 to 5 search phrases a viewer would type, not the creator's jargon. One broad ("build an app with ai"), one narrow (the exact tool or result), one outcome phrase ("app in a weekend").

## 2. Fetch with the research tool

First look at `studio/research/videos.json`: the user may already have searched from the Studio's Research page (a query bar of editable phrases, no agent needed). If it has videos, do not search again unless the user asks; go to step 3 with what is there. Every search is kept as a run in `studio/research/runs/`, and `videos.json` is always the current run (or the merged runs) with the user's marks.

The app folder is `PRESENCE_ROOT` if set, else three folders up from the project (`../../..`). From the project folder:

```bash
node "$PRESENCE_ROOT/server/studio/research-fetch.js" --project . --query "build an app with ai agents" --query "<second phrase>" --query "<third phrase>" --n 20
```

Give all the phrases in one command (repeat `--query`): one command is one run. Optional: `--channel @handle` (a competitor, repeatable), `--when week|month|year` (when it was posted), `--lang de`.

It runs yt-dlp for metadata only (nothing is downloaded but thumbnails), works out each channel's usual views (the median of its last 30 uploads) and the **outlier score** = views / that median, saves the thumbnails to `studio/research/thumbs/` and merges everything into `studio/research/videos.json`. It never overwrites an earlier run. Shorts (under 70 s) are left out. Each video carries a `tier`: `top` (2x its channel's usual or more), `typical` or `flop` (under half); the run includes real typical and flop videos of the channels on purpose.

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

## The user's stars and hides

Videos with `"starred": true` (also listed in `models` at the top of the file) are the ones the user chose as models: read them first and learn from them above the rest. Videos with `"hidden": true` are ones the user threw out: ignore them. Never remove or change these marks.

## Done when

`studio/research/videos.json` has at least 12 videos with views, most with an outlier score and a thumbnail, and your notes. Also follow `research-thumbnails` at the same stage when the recipe asks for thumbnails.

## Premise step (for the Titles stage)

Research also feeds the premise. Beside the title patterns, add to `notes` in `studio/research/videos.json`:

- **Live demand**: what is rising in this niche this month (a new tool, a news spike, a rising search). Be early: the first good video on a new thing takes the biggest share. Note a format whose recent videos got fewer views than its old ones: formats decay.
- **One audience**: who this video is for, in one phrase. A premise that works for one audience rarely works for two.
- **The viewer's own words**: 3 to 5 phrases of the pain or wish as a viewer would say it ("which tab was it in?").
- **Real flops and typical videos** next to the hits, when you have them: what the niche's average video looks like, so a premise is judged against the whole niche, not only its outliers.

