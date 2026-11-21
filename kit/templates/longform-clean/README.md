# longform-clean

A long video (1920x1080) dressed lightly: lower-third labels, a chapter card, a bar chart, an optional picture with rings drawn in, punch-ins, sound cues and an end card with two slots for the end-screen elements. Captions are off by default (export subtitles as SRT instead); one switch turns word-lit captions on.

| file | goes to | what it is |
|---|---|---|
| `components.tsx` | `video/remotion/src/components.tsx` | `Label`, `Chapter`, `Bars`, `Picture`, `End` |
| `make_overlays.py` | `video/out/work/make_overlays.py` | the visuals as events: `video/out/events.json` and `timeline.json` |
| `punches.json` | `video/out/work/punches.json` | punch-ins: 1.5x crops eased in and out by ffmpeg, never rendered |

## Run

```bash
cd <project>/video/out/work
python make_overlays.py                  # events.json + timeline.json
python <repo>/engine/run.py --proof      # 540p proof of the overlay windows: look at out/proof-sheet.jpg
python <repo>/engine/run.py --final      # the final, composed in cached chunks
```

On a 2-minute rough the shipped events make 6 overlay windows, and the proof takes about 45 s.

## Make it yours

- `LABELS` and `CARDS` hold the text. Times are shares of the video so it runs on any rough; give real seconds of the rough, or anchor on spoken words (`find(W, 'word', after=...)` from `shortcaps`).
- `Picture` shows `video/remotion/public/picture.png` when it exists; ring positions are pixels of the image at its shown size (1500x844 by default).
- Punch-ins: check each crop on a still first, and never let two overlap.
- `CAPTIONS = True` burns word-lit captions in Montserrat Black, paused while a card is up.
- Changing one label re-renders one window and re-encodes the one or two chunks it sits in.
