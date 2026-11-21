"""Draw the numbered feed picture the judges look at: a light page, tiles 168 px wide with a number and the title
under each, no view counts, no channel names. Needs only Pillow.

    python judge_sheet.py spec.json out.png

spec: { "tiles": [ { "n": 1, "pic": "path/to/thumb.png", "title": "..." } ], "cols": 4 }  (paths are absolute)
"""
import json
import os
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from thumb_compose import load_font, wrap  # noqa: E402

TILE_W, TILE_H = 168, 94
GAP_X, GAP_Y, PAD = 16, 14, 18


def main():
    spec = json.load(open(sys.argv[1], encoding="utf-8"))
    tiles = spec["tiles"]
    cols = max(1, int(spec.get("cols", 4)))
    rows = -(-len(tiles) // cols)
    cell_h = TILE_H + 8 + 30 + GAP_Y
    W = PAD * 2 + cols * TILE_W + (cols - 1) * GAP_X
    H = PAD * 2 + rows * cell_h
    page = Image.new("RGB", (W, H), "#ffffff")
    d = ImageDraw.Draw(page)
    f_title = load_font("arial", 11)
    f_num = load_font("arialbd", 15)
    for i, t in enumerate(tiles):
        x = PAD + (i % cols) * (TILE_W + GAP_X)
        y = PAD + (i // cols) * cell_h
        try:
            im = Image.open(t["pic"]).convert("RGB").resize((TILE_W, TILE_H), Image.LANCZOS)
        except Exception:
            im = Image.new("RGB", (TILE_W, TILE_H), "#cccccc")
        page.paste(im, (x, y))
        d.rounded_rectangle((x + 4, y + 4, x + 28, y + 24), radius=5, fill="#111111")
        label = str(t["n"])
        w = d.textlength(label, font=f_num)
        d.text((x + 16 - w / 2, y + 6), label, font=f_num, fill="#ffffff")
        lines = wrap(d, str(t.get("title", "")), f_title, TILE_W)[:2]
        for j, ln in enumerate(lines):
            d.text((x, y + TILE_H + 6 + j * 14), ln, font=f_title, fill="#0f0f0f")
    page.save(sys.argv[2])


if __name__ == "__main__":
    main()
