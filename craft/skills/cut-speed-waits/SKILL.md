---
name: cut-speed-waits
description: Play the waits of a screen recording fast instead of cutting them (an install, a build, a render, an agent working, a page loading), so the viewer sees the work happen and still feels the time pass. Use in the rough cut of screen footage when the scan reports busy waits.
---

# Speed through waits

When nobody talks and the screen shows work in progress, playing it fast keeps the feeling that time passed and shows the result arriving. A plain cut makes the result look instant, which can feel like a trick.

## Speed it or cut it

`scan.md` lists every wait with `screen` busy or still and a suggested `speed`.

- **Busy** (a progress bar, text streaming in, a log scrolling, a page filling, an agent's steps going by): speed it up.
- **Still** (nothing changes on screen): cut it. Fast nothing is still nothing.

## How a sped wait plays

- It lasts about 2 to 5 seconds on screen whatever its real length, so a long render plays much faster than a short install.
- It starts when the speaker stops talking and ends just before the result appears or they speak again. The result itself plays at normal speed.
- Speech is never sped up. If they talk in the middle of a wait, those words play at speed 1 and the stretches on either side are sped.
- A sped stretch is muted: fast keyboard and fan noise only distract.

## In the edit list

Each sped wait is one item of `out/edl.json`: `kind` "W", `pic_src`, `pic_in`, `pic_out`, `speed` above 1, no `src` (no words map out of it), and `cut_before.kind` "wait". The `edl.py` helper `add_wait` writes it, and `build_rough.py` builds it. Run `joins.py check` afterwards like any other cut.
