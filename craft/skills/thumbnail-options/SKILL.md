---
name: thumbnail-options
description: Make 2 to 4 YouTube thumbnail options as PNGs in studio/thumbs/ with options.json, composed in code (a frame of the video, the user's own photo, big words, shapes) with an AI background only when an image model is on. Never AI faces of the user, never AI text. Use at the thumbnails stage or when the user asks for new thumbnails.
---

# Thumbnail options

Read: the picked or starred titles in `studio/titles.json`, the brief in `studio/research/videos.json` (`thumbs` field, written by research-thumbnails), `studio/plan.md`, and `studio/thumbs/options.json` if it exists (keep the user's picks and notes).

## What a thumbnail must do

- **One idea, read in under a second at 168 px wide.** One thing is seen first; make it the brightest, most saturated thing in the frame.
- **Add what the title lacks**: the result, the stakes, the before/after. Never repeat the title word for word.
- **0 to 4 big words**, at least a fifth of the height tall, thick outline or a box behind them.
- **Proof over decoration**: a real frame of the result, a real screen, a real number.
- **The bottom-right corner stays empty** (the duration covers it).
- **Show it early**: what the thumbnail shows appears in the first minute of the video.

## Where every pixel comes from

| element | source |
|---|---|
| the user's face | only their own photos or a frame of their footage, never generated. Cut out with transparency (e.g. `uvx rembg i photo.jpg face.png` if they have it; else keep the frame's background) |
| words | set in code (the composer), never painted by an image model |
| the scene, a result | a frame of the video: the composer takes `{"frame": {"video": "../../video/out/final.mp4", "t": 83.2}}` |
| backgrounds, props, scenes | an AI image model, **only if one is enabled** (`node "$PRESENCE_ROOT/server/studio/image-gen.js" --list` shows `ready: true`). Else a frame, a gradient or a plain colour |

AI prompts: describe a scene or object with lighting and composition, leave empty space where the face and words will go, and say "no text, no letters, no people". Make backgrounds at 1344×768 (the composer crops to 1280×720).

```bash
node "$PRESENCE_ROOT/server/studio/image-gen.js" --model <id> --prompt "an empty workbench under a single warm lamp, dark blue room, lots of empty space on the left, no text, no people" --out studio/thumbs/bg-1.png
```

Paid models cost money per picture: make one background per option, not many.

## Compose in code

Write one spec per option, `studio/thumbs/<id>.json`, and render it:

```bash
python "$PRESENCE_ROOT/server/studio/thumb_compose.py" studio/thumbs/a.json studio/thumbs/a.png --small
```

The spec (positions and sizes are fractions of the canvas; paths are relative to the spec):

```json
{
  "size": [1280, 720],
  "background": { "frame": { "video": "../../video/out/final.mp4", "t": 83.2 }, "blur": 0 },
  "tint": { "color": "#000000", "opacity": 0.25 },
  "layers": [
    { "type": "image", "src": "face.png", "x": 0.58, "y": 0.06, "h": 0.94, "outline": { "color": "#ffffff", "width": 8 }, "shadow": true },
    { "type": "text", "text": "it worked", "upper": true, "x": 0.05, "y": 0.08, "size": 0.2, "maxWidth": 0.55, "color": "#ffe14a", "stroke": { "color": "#000000", "width": 0.08 }, "shadow": true },
    { "type": "rect", "x": 0.04, "y": 0.62, "w": 0.4, "h": 0.25, "color": "#d62828", "radius": 0.02 },
    { "type": "circle", "x": 0.25, "y": 0.75, "r": 0.1, "outline": { "color": "#ff3b3b", "width": 10 } },
    { "type": "arrow", "from": [0.4, 0.75], "to": [0.56, 0.6], "color": "#ff3b3b", "width": 0.025 }
  ]
}
```

Background: `frame`, `image` (`{"image": "bg-1.png", "focus": [0.5, 0.4]}`), `gradient` (`["#0f2a4a", "#3a0f4a"]`) or `color`. Text: `font` (a file or a name; bold display fonts are found in `kit/fonts` and the system), `align` left|center|right (x is the anchor), `box` `{color, pad}`, `maxLines`. Image: `w` or `h`, `crop` `[x, y, w, h]`, `flip`. Later layers draw on top.

`--small` also writes `<id>-small.png` at 320×180: open it (Read) and check the words still read and the one thing still stands out. Fix and re-render until it does.

## studio/thumbs/options.json

```json
{
  "options": [
    { "id": "a", "file": "a.png", "how": "code", "title": "t1", "spec": "a.json", "why": "Result frame + face, 2 words; models the outliers' face-right layout." },
    { "id": "b", "file": "b.png", "how": "mixed", "title": "t2", "spec": "b.json", "model": "flux-schnell-local", "prompt": "…", "why": "…" }
  ],
  "picked": null,
  "shortlist": []
}
```

- `how`: `code` (no AI), `ai` (an AI picture as is, rare), `mixed` (AI background + code). `title`: the id of the title it was made for, so the feed pairs them.
- Make 2 to 4 options that differ in idea, not just colour. Keep existing ids, the user's `picked`, `shortlist` and `notes`; a remake of a noted option gets a new id.

The user compares them big, at feed size and at phone size in the Studio, then in the Feed page between the real videos.
