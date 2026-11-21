---
name: research-thumbnails
description: Study the thumbnails of the niche's outlier videos (already saved by research-titles) and write down what the winners do, as a brief the thumbnail stage can use. Use at the research stage after research-titles.
---

# Research thumbnails: what the winners look like at feed size

Use the pictures research-titles saved in `studio/research/thumbs/<id>.jpg` (the list is `studio/research/videos.json`). Look at the real images: open them with Read (they are pictures; you can see them). Start with the videos marked `"starred": true` (the user's chosen models, also in `models`), skip `"hidden": true` ones, and include some `tier: "flop"` pictures to see what the weak ones lack.

## Look at them the way a viewer does

A feed shows a thumbnail at about 360 px wide on a desktop and 168 to 390 px on a phone, for less than a second. For each of the top 6 to 10 outliers and 4 to 6 low scorers (outlier under 1), note:

- **the one thing seen first** (a face, an object, a screen, a number) and where it sits (left or right third);
- **words**: how many (0 to 4 is usual for winners; 7+ is mostly flops), what they add that the title doesn't say;
- **a face**: there or not, how big, what feeling;
- **contrast**: is one thing much brighter and more saturated than the rest? Dark is fine, dim is not;
- **proof**: a real screen, result or number, or only decoration;
- **the bottom-right corner**: the duration covers it; winners keep it empty.

Compare winners with the low scorers: a pattern only counts if the winners have it and the flops mostly don't.

## Write the brief

Add a `thumbs` field to `studio/research/videos.json` (keep the rest) with:

```json
"thumbs": {
  "patterns": ["face right third, product left, 2-3 big words on top", "..."],
  "avoid": ["7+ words", "a plain dim screenshot", "..."],
  "colors": "what stands out against these feeds (the niche is mostly X, so Y pops)",
  "ideas": ["3 concrete layouts for THIS video, each naming the real frame or photo it uses"]
}
```

Name the source of every picture element you propose: a frame of the user's footage (with its time), the user's own photo, a screen capture, or an AI background (only if an image model is on: `node "$PRESENCE_ROOT/server/studio/image-gen.js" --list`).

Never propose an AI-generated face of the user or AI-generated text in the picture.
