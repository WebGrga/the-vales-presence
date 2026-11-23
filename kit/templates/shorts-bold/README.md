# shorts-bold

A vertical Short (1080x1920) with a strong top band: a hook on frame 0, a label pill, a big number, a box drawn round something on screen, an end line, word-lit captions in the lower third and a low music bed.

| file | goes to | what it is |
|---|---|---|
| `components.tsx` | `video/remotion/src/components.tsx` | the engine's Shorts kit (`Band`, `Label`, `Pops`, `EndText`, `Box`, `Marker`, `Underline`, `Tag`, `Chips`, `Scrim`, `Flash`) plus `Stat`, a big number with a label |
| `make_overlays.py` | `video/out/work/make_overlays.py` | the visuals as events: `video/out/events.json` and `timeline.json` |
| `stills.json` | `video/remotion/stills.json` | how long `Stat` takes to settle, so its still stretches are held instead of drawn |
| `show.tsx` | `video/remotion/src/show.tsx` | copy of `kit/show/show.tsx`: `Callout`, `Spotlight`, `Inset`, `Flow`, `Compare`, `Count` (counting number), `Steps`, `Scoreboard` (see `kit/show/README.md`); `components.tsx` imports it |

## Run

```bash
cd <project>/video/out/work
python make_overlays.py                  # events.json + timeline.json
python <repo>/engine/run.py --proof      # 540p proof of the overlay windows: look at out/proof-sheet.jpg
python <repo>/engine/run.py --final      # the final: only windows that changed are rendered
```

`make_overlays.py` finds the engine by itself (the `engine/` folder above it) or through `PRESENCE_ENGINE`.

## Make it yours

- As shipped, every time is a share of the Short's length, so it runs on any locked rough. Anchor each event on a spoken word instead: `from shortcaps import find`, then `at = find(W, 'because')[0]`.
- Write the real text in `HOOK`, `LABEL`, `STAT` and `END`. Made text starts at y 120 or lower: the phone's own icons sit above it.
- Measure the `Box` on a still of your rough (`ffmpeg -ss 12 -i ../rough.mp4 -frames:v 1 still.png`): `[x, y, w, h]` in pixels of the 1080x1920 frame.
- Captions sit at y 1320 for a full-height picture; a split layout (screen above, face below) puts them at the seam, y 1180.
- Sounds are names from `kit/sounds` (`pop`, `marker`, `hit`, `whoosh`, and the bed `music`).
- Change one line and run again: only that event's window is rendered again.
