---
name: upload-youtube
description: Prepare the YouTube upload (description, chapters, tags, settings in studio/upload.json) for the user to check and send with the Upload button. Never uploads. Use at the upload stage.
---

# Prepare the upload

You prepare; the user uploads. The upload runs only from the **Upload to YouTube** button in the Studio, which asks once more. You never call the upload route, never run an upload script, never publish.

## What to write in studio/upload.json

Keep every field already there (the user may have typed in the Studio); change only what is empty or what the user's notes ask.

```json
{
  "description": "…",
  "tags": ["…"],
  "privacy": "private",
  "category": "22",
  "madeForKids": false,
  "synthetic": false
}
```

- **description**: the first two lines carry the promise in other words than the title (they show under the video and in search). Then a short paragraph, then **chapters** (`0:00 Title` per beat, the first at 0:00, at least 3, each at least 10 s apart) taken from the final cut's real times (`video/out/rough-words.json`, `video/out/events.json` or the edit list), then links the user gave. No `<` or `>`; under 5000 bytes.
- **tags**: 5 to 12 short phrases a viewer would search; under 500 characters together.
- **privacy**: leave `private` unless the user asked otherwise. A schedule (`publishAt`, ISO time) only with `private`.
- **madeForKids**: the user's decision; never set it to true on your own.
- **synthetic**: true when the video shows realistic AI-made people, places or events (YouTube asks creators to say so). An AI background in the thumbnail alone does not count.
- `category`: 22 People & Blogs, 28 Science & Technology, 27 Education, 24 Entertainment, 26 Howto & Style, 20 Gaming.

The title and thumbnail are the user's picks in the Studio (`studio/titles.json` `picked`, `studio/thumbs/options.json` `picked`); don't change them here.

## The bet

Also write `studio/bet.json` if it is missing, a bet the user can change on the Feed page: `{"metric": "ctr", "direction": "above", "median": "", "note": "one line: why this package should move it"}`. Metric is one of `ctr` (impressions click-through), `views48` (views in the first 48 hours), `retention` (average view duration) or `subs`; direction `above` or `below` the user's own median for that metric. The Studio shows the bet a week after the upload, with a place to write the result. `median` is the user's own usual number for that metric: leave it empty for the user to write; never invent it.

## Then

Tell the user in one or two lines what to check on the Upload page (the package, the description, the visibility), and that **Dry run** shows every request without sending anything.
