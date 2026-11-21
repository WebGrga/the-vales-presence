# The kit

What the engine dresses a video with. Everything here is free to use in your videos.

- `templates/`: example overlay kits. Copy one into a project (its README says where each file goes), then change the text and the times.
  - `shorts-bold`: a vertical Short with a hook band, a label, a big number, a drawn box, an end line, word-lit captions and a music bed.
  - `shorts-calm`: a calm vertical Short with light cards, underlines, a soft marker and whole-line captions.
  - `longform-clean`: a 16:9 long video with lower-third labels, a chapter card, a bar chart, a picture with rings, punch-ins and an end card.
- `sounds/`: short sound effects and two music beds, made in code (`sounds/sounds.json` lists them). The engine finds a sound by its name (`pop`, `whoosh`, `music`).
- `fonts/`: Montserrat Black for burned-in captions (SIL Open Font License, `fonts/OFL.txt`).

A template's `components.tsx` exports `COMPONENTS`, a map of names to React components that each draw one event (`ev.at`, `ev.end` in seconds of the rough, `ev.props`). Leave the background transparent: the engine renders only the stretches where something is on screen and lays them over the locked rough. Type-check a template with `python engine/typecheck.py kit/templates/<name>`.
