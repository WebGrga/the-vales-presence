# shorts-calm

A calm vertical Short (1080x1920): a light title card that types on, one label card, thin strokes under a line of text on screen, a soft marker behind a word, and captions that show a whole line at once in a dark pill (no word lighting, no pop). One block of text is on screen at a time.

| file | goes to | what it is |
|---|---|---|
| `components.tsx` | `video/remotion/src/components.tsx` | `Card` (title or label), `Strokes` (underlines that draw in), and the kit's `Marker` |
| `make_overlays.py` | `video/out/work/make_overlays.py` | the visuals as events: `video/out/events.json` and `timeline.json` |

## Run

```bash
cd <project>/video/out/work
python make_overlays.py                  # events.json + timeline.json
python <repo>/engine/run.py --proof      # 540p proof of the overlay windows: look at out/proof-sheet.jpg
python <repo>/engine/run.py --final      # the final: only windows that changed are rendered
```

## Make it yours

- Write the real lines in `TITLE` and `LABEL`. For long lines, lower `size`.
- Times are shares of the Short so it runs on any rough; anchor them on spoken words for a real one.
- `Strokes` and `Marker` positions are pixels of the 1080x1920 rough: measure them on a still.
- Captions pause while a card is up (`blocked`). The caption look is all of `style`: font, size, position (x 480 is the centre of the safe area x 60-900), box and its alpha.
- The accent colour is `ACCENT` in `components.tsx`, or `accent` in a card's props.
