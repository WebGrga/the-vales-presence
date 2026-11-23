# show

Eight overlay pieces that point at, explain, count or compare something real on the screen. They are shared by every template: one file, `show.tsx`, exporting `SHOW`.

| piece | what it does | props (all times are seconds of the rough) |
|---|---|---|
| `Callout` | a ring or rounded highlight, an arrow that draws on, then a label that pops | `{x, y, w?, h?, text, side?, color?, size?}` (x, y: a point, or the box's top-left with w and h) |
| `Spotlight` | dims everything except a box, the edge glows | `{x, y, w, h, text?, dim?, radius?}` |
| `Inset` | a still from the footage (or any image in `remotion/public/`) in a framed card with a caption | `{src, label?, w?, h?, x?, y?, from?: "left"\|"right"}` |
| `Flow` | boxes and arrows that build up as they are said | `{nodes: [{id, text, at}], edges?: [{from, to, at?, label?}], layout?: "row"\|"column"\|"cycle", title?, x?, y?, w?}` |
| `Compare` | two sides, the second arriving at `at2` | `{left: {title, src?, lines?}, right: {...}, at2?, vs?, colors?}` |
| `Stat` | one number counting up | `{value, unit?, label, from?, decimals?, x?, y?, color?}` |
| `Steps` | a checklist that ticks item by item | `{title?, items: [{text, at}], x?, y?, w?}` |
| `Scoreboard` | named rows whose scores change at given times | `{rows: [{name, score: [[at, value], ...]}], title?, max?, decimals?, unit?, x?, y?, w?, colors?}` |

Every piece also takes `avoid: {x, y, w, h}` (the face-cam corner): a piece that would cover it moves to the nearest free side (Callout puts its label on another side). Every x, y, w, h is a pixel of the frame, so the same props work at 1920x1080 and 1080x1920 (text scales down a little in a vertical frame); read them off a still of the footage at that moment. Each piece's doc comment in `show.tsx` is the full list.

## Use

1. Copy `show.tsx` next to the project's `components.tsx` (`video/remotion/src/show.tsx`).
2. In `components.tsx`: `import { SHOW } from "./show";` and spread it: `export const COMPONENTS = { ...SHOW, ...yours }`. The three templates already do.
3. Events use the name as `comp`: `{"id": "C1", "kind": "effect", "at": 61.2, "end": 66, "comp": "Callout", "props": {"x": 1000, "y": 360, "w": 260, "h": 120, "text": "The YouTube village"}}`.

In `shorts-bold` the piece called `Stat` there is the big text number, so the counting one is `Count`.

## Holds

Each piece moves for under about a second after it starts (and after each time in its props) and then sits still, so the engine draws the held stretches once. Times in props use the keys `at`, `at2` and `[[at, value]]` pairs under `score`, which `engine/holds.py` knows as moments. Springs are snapped to their end value (a scale of 1.0000000002 made Chrome redraw text a pixel lower and failed the hold check).

