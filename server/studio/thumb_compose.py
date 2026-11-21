"""Compose a thumbnail in code from a JSON spec: a background (a frame of the video, a picture, a colour or a
gradient), then layers of pictures (the user's own cut-out photo, a screenshot, an AI background prop), text and
shapes. Needs only Pillow (and ffmpeg on PATH for video frames).

    python thumb_compose.py studio/thumbs/a.json studio/thumbs/a.png [--small]

--small also writes a-small.png at 320x180, the size a phone feed shows, to check the words still read.

Positions and sizes are fractions of the canvas (0 to 1): x, y, w, h; text "size" is a fraction of the height.
Paths in the spec are relative to the spec's own folder. The spec format is in craft/skills/thumbnail-options/SKILL.md.
"""
import json
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageColor, ImageDraw, ImageFilter, ImageFont

FONT_NAMES = ["Anton-Regular", "Anton", "BebasNeue-Regular", "Montserrat-Black", "ariblk", "Arial Black", "impact",
              "DejaVuSans-Bold", "LiberationSans-Bold", "arialbd", "Arial Bold", "Helvetica-Bold", "Arial"]


def font_dirs():
    here = os.path.dirname(os.path.abspath(__file__))
    dirs = [os.path.join(here, "..", "..", "kit", "fonts")]
    if sys.platform == "win32":
        dirs += [os.path.join(os.environ.get("WINDIR", "C:\\Windows"), "Fonts"),
                 os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "Windows", "Fonts")]
    elif sys.platform == "darwin":
        dirs += ["/System/Library/Fonts", "/Library/Fonts", os.path.expanduser("~/Library/Fonts")]
    else:
        dirs += ["/usr/share/fonts", "/usr/local/share/fonts", os.path.expanduser("~/.fonts"), os.path.expanduser("~/.local/share/fonts")]
    return [d for d in dirs if d and os.path.isdir(d)]


_FONT_FILES = None


def find_font(name):
    global _FONT_FILES
    if name and os.path.isfile(name):
        return name
    if _FONT_FILES is None:
        _FONT_FILES = {}
        for d in font_dirs():
            for root, _, files in os.walk(d):
                for f in files:
                    if f.lower().endswith((".ttf", ".otf", ".ttc")):
                        _FONT_FILES.setdefault(os.path.splitext(f)[0].lower(), os.path.join(root, f))
    for n in ([name] if name else []) + FONT_NAMES:
        hit = _FONT_FILES.get(str(n).lower().replace(" ", "")) or _FONT_FILES.get(str(n).lower())
        if hit:
            return hit
    return None


def load_font(name, px):
    f = find_font(name)
    if f:
        return ImageFont.truetype(f, px)
    try:
        return ImageFont.load_default(px)
    except TypeError:
        return ImageFont.load_default()


def color(c, alpha=1.0):
    r, g, b, *a = ImageColor.getrgb(c or "#000000")
    return (r, g, b, int(255 * alpha * ((a[0] / 255) if a else 1)))


def cover(img, w, h, focus=(0.5, 0.5)):
    s = max(w / img.width, h / img.height)
    img = img.resize((max(w, round(img.width * s)), max(h, round(img.height * s))), Image.LANCZOS)
    x = round((img.width - w) * focus[0]); y = round((img.height - h) * focus[1])
    return img.crop((x, y, x + w, y + h))


def video_frame(video, t):
    out = os.path.join(tempfile.mkdtemp(prefix="thumb-"), "frame.png")
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", str(t), "-i", video, "-frames:v", "1", "-y", out], check=True)
    return Image.open(out).convert("RGBA")


def background(spec, base, w, h):
    bg = spec.get("background") or {"color": "#14141c"}
    if "frame" in bg:
        img = video_frame(os.path.join(base, bg["frame"]["video"]), bg["frame"].get("t", 0))
    elif "image" in bg:
        img = Image.open(os.path.join(base, bg["image"])).convert("RGBA")
    elif "gradient" in bg:
        a, b = color(bg["gradient"][0]), color(bg["gradient"][1])
        img = Image.new("RGBA", (w, h))
        d = ImageDraw.Draw(img)
        vertical = bg.get("direction", "diagonal") == "vertical"
        for i in range(w + h if not vertical else h):
            k = i / ((w + h) if not vertical else h)
            col = tuple(round(a[j] + (b[j] - a[j]) * k) for j in range(4))
            d.line([(i, 0), (0, i)] if not vertical else [(0, i), (w, i)], fill=col, width=2)
        return img
    else:
        return Image.new("RGBA", (w, h), color(bg.get("color", "#14141c")))
    img = cover(img, w, h, tuple(bg.get("focus", (0.5, 0.5))))
    if bg.get("blur"):
        img = img.filter(ImageFilter.GaussianBlur(bg["blur"]))
    return img


def shadow_of(layer_img, radius, opacity=0.6, offset=(0, 0)):
    a = layer_img.split()[-1].filter(ImageFilter.GaussianBlur(radius))
    sh = Image.new("RGBA", layer_img.size, (0, 0, 0, 0))
    sh.putalpha(a.point(lambda v: int(v * opacity)))
    return sh, offset


def outline_of(img, width, col):
    a = img.split()[-1].filter(ImageFilter.MaxFilter(width * 2 + 1))
    o = Image.new("RGBA", img.size, color(col))
    o.putalpha(a)
    return o


def place(canvas, img, x, y):
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    layer.paste(img, (round(x), round(y)), img)
    return Image.alpha_composite(canvas, layer)


def picture(canvas, L, base):
    W, H = canvas.size
    img = Image.open(os.path.join(base, L["src"])).convert("RGBA")
    if L.get("crop"):
        cx, cy, cw, ch = L["crop"]
        img = img.crop((round(cx * img.width), round(cy * img.height), round((cx + cw) * img.width), round((cy + ch) * img.height)))
    if "h" in L:
        th = round(L["h"] * H); tw = round(img.width * th / img.height) if "w" not in L else round(L["w"] * W)
    else:
        tw = round(L.get("w", 0.5) * W); th = round(img.height * tw / img.width)
    img = img.resize((max(1, tw), max(1, th)), Image.LANCZOS)
    if L.get("flip"):
        img = img.transpose(Image.FLIP_LEFT_RIGHT)
    pad = 0
    if L.get("outline"):
        pad = int(L["outline"].get("width", 8)) + 2
        big = Image.new("RGBA", (img.width + 2 * pad, img.height + 2 * pad), (0, 0, 0, 0)); big.paste(img, (pad, pad), img)
        img = Image.alpha_composite(outline_of(big, int(L["outline"].get("width", 8)), L["outline"].get("color", "#ffffff")), big)
    x, y = L.get("x", 0) * W - pad, L.get("y", 0) * H - pad
    if L.get("shadow"):
        sh, _ = shadow_of(img, max(4, W // 100))
        canvas = place(canvas, sh, x + W * 0.006, y + H * 0.01)
    return place(canvas, img, x, y)


def wrap(draw, text, font, max_w):
    lines = []
    for para in text.split("\n"):
        cur = ""
        for word in para.split():
            test = (cur + " " + word).strip()
            if not cur or draw.textlength(test, font=font) <= max_w:
                cur = test
            else:
                lines.append(cur); cur = word
        lines.append(cur)
    return lines


def text(canvas, L):
    W, H = canvas.size
    t = L["text"].upper() if L.get("upper") else L["text"]
    px = max(8, round(L.get("size", 0.15) * H))
    font = load_font(L.get("font"), px)
    tmp = ImageDraw.Draw(canvas)
    max_w = L.get("maxWidth", 0.9) * W
    while px > 12:
        lines = wrap(tmp, t, font, max_w)
        if all(tmp.textlength(ln, font=font) <= max_w for ln in lines) and len(lines) <= L.get("maxLines", 3):
            break
        px = round(px * 0.92); font = load_font(L.get("font"), px)
    lines = wrap(tmp, t, font, max_w)
    lh = round(px * L.get("lineHeight", 1.05))
    sw_raw = L["stroke"].get("width", 0.08) if isinstance(L.get("stroke"), dict) else 0
    sw = round(sw_raw * px) if 0 < sw_raw <= 1 else round(sw_raw)  # a fraction of the font size, or pixels
    widths = [tmp.textlength(ln, font=font) for ln in lines]
    bw, bh = max(widths) + 2 * sw, lh * len(lines) + 2 * sw
    layer = Image.new("RGBA", (int(bw + 4 * sw + 8), int(bh + 4 * sw + 8)), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for i, ln in enumerate(lines):
        lx = {"center": (bw - widths[i]) / 2, "right": bw - widths[i]}.get(L.get("align", "left"), 0) + sw
        d.text((lx, i * lh + sw), ln, font=font, fill=color(L.get("color", "#ffffff")),
               stroke_width=sw, stroke_fill=color(L["stroke"].get("color", "#000000")) if sw else None)
    x, y = L.get("x", 0.05) * W, L.get("y", 0.05) * H
    if L.get("align") == "center":
        x -= bw / 2
    elif L.get("align") == "right":
        x -= bw
    if L.get("box"):
        bp = round(L["box"].get("pad", 0.02) * H)
        box = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        ImageDraw.Draw(box).rounded_rectangle([x - bp, y - bp, x + bw + bp, y + bh + bp], radius=round(L["box"].get("radius", 0.01) * H),
                                              fill=color(L["box"].get("color", "#d62828")))
        canvas = Image.alpha_composite(canvas, box)
    if L.get("shadow"):
        sh, _ = shadow_of(layer, max(3, px // 12), 0.75)
        canvas = place(canvas, sh, x + px * 0.04, y + px * 0.06)
    return place(canvas, layer, x, y)


def shape(canvas, L):
    W, H = canvas.size
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    ow = round(L.get("outline", {}).get("width", 0)) if isinstance(L.get("outline"), dict) else 0
    oc = color(L["outline"].get("color", "#ffffff")) if ow else None
    fill = color(L["color"], L.get("opacity", 1)) if L.get("color") else None
    if L["type"] == "rect":
        x, y = L["x"] * W, L["y"] * H
        d.rounded_rectangle([x, y, x + L["w"] * W, y + L["h"] * H], radius=round(L.get("radius", 0) * H), fill=fill, outline=oc, width=ow)
    elif L["type"] == "circle":
        cx, cy, r = L["x"] * W, L["y"] * H, L["r"] * H
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill, outline=oc, width=ow)
    elif L["type"] == "arrow":
        (x1, y1), (x2, y2) = [(p[0] * W, p[1] * H) for p in (L["from"], L["to"])]
        wd = max(2, round(L.get("width", 0.02) * H))
        col = color(L.get("color", "#ff2d2d"))
        d.line([(x1, y1), (x2, y2)], fill=col, width=wd)
        import math
        ang = math.atan2(y2 - y1, x2 - x1); hl = wd * 3.2
        pts = [(x2 + math.cos(ang) * wd, y2 + math.sin(ang) * wd),
               (x2 - hl * math.cos(ang - 0.5), y2 - hl * math.sin(ang - 0.5)),
               (x2 - hl * math.cos(ang + 0.5), y2 - hl * math.sin(ang + 0.5))]
        d.polygon(pts, fill=col)
    if L.get("shadow"):
        sh, _ = shadow_of(layer, max(3, W // 160))
        canvas = place(canvas, sh, W * 0.004, H * 0.008)
    return Image.alpha_composite(canvas, layer)


def compose(spec, base):
    W, H = spec.get("size", [1280, 720])
    canvas = background(spec, base, W, H)
    if spec.get("tint"):
        canvas = Image.alpha_composite(canvas, Image.new("RGBA", (W, H), color(spec["tint"].get("color", "#000000"), spec["tint"].get("opacity", 0.3))))
    for L in spec.get("layers", []):
        kind = L.get("type")
        if kind == "image":
            canvas = picture(canvas, L, base)
        elif kind == "text":
            canvas = text(canvas, L)
        elif kind in ("rect", "circle", "arrow"):
            canvas = shape(canvas, L)
        else:
            sys.exit(f"Unknown layer type {kind!r} (image, text, rect, circle, arrow)")
    return canvas.convert("RGB")


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    spec_path, out = sys.argv[1], sys.argv[2]
    with open(spec_path, encoding="utf-8-sig") as f:
        spec = json.load(f)
    img = compose(spec, os.path.dirname(os.path.abspath(spec_path)))
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    img.save(out)
    msg = f"{out}  {img.width}x{img.height}"
    if "--small" in sys.argv:
        stem, ext = os.path.splitext(out)
        img.resize((320, round(320 * img.height / img.width)), Image.LANCZOS).save(f"{stem}-small{ext or '.png'}")
        msg += f"  + {stem}-small{ext or '.png'}"
    print(msg)


if __name__ == "__main__":
    main()
