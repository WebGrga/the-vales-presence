---
name: thumbnail-options
description: Make 2 to 4 YouTube thumbnail options as PNGs in studio/thumbs/ with options.json, composed in code (a frame of the video, the user's own photo, big words, shapes) with an AI background only when an image model is on. Never AI faces of the user, never AI text. Use at the thumbnails stage or when the user asks for new thumbnails.
---

# Thumbnail options

Read: the picked or starred titles in `studio/titles.json`, the brief in `studio/research/videos.json` (`thumbs` field, written by research-thumbnails), `studio/plan.md`, and `studio/thumbs/options.json` if it exists (keep the user's picks and notes).

## Only for titles that passed the gate

`studio/titles.json` may have a `gate` and a `score` per option. Make thumbnails only for titles at or above the gate (the picked or starred ones first). If the premise fails, fix the premise, not the picture: new pictures moved weak premises by 0 to 1 places.

## Clarity first, before anything is drawn

For each concept answer in one line: would a stranger who has never heard of this tool know at a glance what the video is about and why to click? If not, the concept fails whatever the craft. Say which concepts fail, with the reason, and do not render them. A plan's concepts are a start, not a spec: check each one before you render it.

- **One idea, read in under a second at 168 px wide**; it adds the result or stakes the title leaves out, and shows something that appears in the video's first minute. Proof (a real frame, a real screen) over decoration.
- **Title and picture tell one story**: the topic in plain words (shown or said) plus the hook. Never the same words twice, never a phrase that needs the video to make sense (a game word, a rule, a twist whose setup is not on the picture).
- **A number needs its meaning on the picture.** "70 MIN" crossed out and "36 SEC" means nothing without what took that long.
- Ask "why would they click?" three times, each about the answer before, until you reach the viewer's goal and reward. Write the words from that answer.

## The shape that works for a tool video: three elements at most

1. **A big face** with a gesture that says the claim, or the **real logo** of the tool when there is no face (the logo file, never a drawing of it; put it on a background it stands out from, never on a ground of its own colour).
2. **The real screen, big** (half the frame or more), captured so it shows the topic at a glance (the result, not a screen of menus).
3. **One thick line of text on a solid box**, in plain words that name the topic.

Count every chip, badge, arrow, highlighted word and extra logo as an element. Say "AI" inside an element that is already there, not as one more box. After the layout, **enlarge every element until no big empty ground is left**: what is small is not seen at phone size.

## Text and face

- Text: one line, a heavy font, big (a fifth of the height or more), on a solid box behind it; the words the viewer would use. At most one highlighted word, none when another element already carries colour.
- Face: big (a third of the frame or more), cut at the waist so no legs show, an expression that matches the video; no outline by default (only where it would sink into the ground). A face alone is no edge. Never an AI-made face.
- Arrows run through open space, above the text; never a coloured mark on a ground of the same colour.
- Never fake proof with AI-made UI. Real UI wording only.
- The bottom-right corner stays empty (the duration covers it). Nothing covers a face; nothing touches an edge.

## Contact-sheet check at 160×90

Before any option is shown, make one contact sheet of all options at 160×90 each (e.g. `magick montage thumbs/*.png -resize 160x90 -tile 4x -geometry +6+6 thumbs/sheet-160.png`, or Pillow), open it, and look: each subject readable, the topic clear, nothing busy. Write the result per option as `sheet160` in options.json (`"ok"` or a few words on what failed) and fix before you list it. Write the file `sheet-160.png` into `studio/thumbs/`.

## Each option carries the promise

`clarity`: `clear: <why>` or `weak: <why>` (the answer to the stranger question; be honest, the user sees it on the card). `promise`: one line, what the viewer will see happen if they click (and what could fail). The thumbnail's promise must be kept in the first minute of the video.

## AI images, an honest note

Background images behind a screen added nothing in tests: a generated scene tied a flat colour or lost to it. Use a picture model only when the scene itself is the subject. Pictures cost time (see the Studio's model list); make one per option, not many.

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
    { "id": "a", "file": "a.png", "how": "code", "title": "t1", "spec": "a.json", "promise": "You see an app appear on the real screen; it could break on the last day.", "sheet160": "ok", "clarity": "clear: a stranger sees an app being built and the word BROKE", "why": "Result frame + face, 2 words; models the outliers' face-right layout." },
    { "id": "b", "file": "b.png", "how": "mixed", "title": "t2", "spec": "b.json", "model": "flux-schnell-local", "prompt": "…", "why": "…" }
  ],
  "picked": null,
  "shortlist": []
}
```

- `how`: `code` (no AI), `ai` (an AI picture as is, rare), `mixed` (AI background + code). `title`: the id of the title it was made for, so the feed pairs them.
- Make 2 to 4 options that differ in idea, not just colour (one with a face and one without, when the user has photos). Keep existing ids, the user's `picked`, `shortlist` and `notes`; a remake of a noted option gets a new id.

The user compares them big, at feed size and at phone size in the Studio, then in the Feed page between the real videos.
