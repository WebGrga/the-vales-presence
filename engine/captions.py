"""Captions as their own cheap layer: ASS subtitles burned in by ffmpeg (libass), not Remotion.

Why not Remotion: spoken captions run through most of a video, so as windows they would merge into one render nearly as long as the video
(the thing this pipeline exists to stop), and any change to one word would re-render it. As ASS they cost seconds, change per block and
need no render at all. The look is fixed and plain: a rounded dark box, white words, the word being said in gold, words still to come dimmed,
a short fade at each end of a block. (A template that really needs a different caption look may draw its captions as ordinary Remotion
events instead and accept the longer windows; most should not.)

A caption event is {"id", "kind": "caption", "at", "end", "words": [[start, end, "word"(, accent 0/1)], ...]}.
Style: events.json "captions": {"style": {...}} over the defaults below (colors are #rrggbb).

    python captions.py [--video <video/>]     writes video/out/work/captions.ass (compose.py does it for you)
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pipelib import KIT, Cut, find_font, read_json

DEFAULTS = {
    'long': {'font': 'Arial Black', 'file': 'ariblk.ttf', 'size': 56, 'x': 1195, 'y': 960, 'maxw': 1400, 'pad_x': 26, 'pad_y': 12, 'radius': 18,
             'color': '#ffffff', 'active': '#f2c94c', 'accent': '#f2c94c', 'dim': 0.18, 'box': '#16120e', 'box_alpha': 0.84, 'fade_in': 0.08, 'fade_out': 0.12, 'gap': 14},
    # Shorts: the Shorts look: Montserrat 900 on a dark rounded box at the seam
    # of the SPLIT (y 1180), x 60-900 (centre 480, 840 wide: clear of the Shorts buttons), words dim until said, then white (accent words yellow),
    # the word being said pops to `pop` and settles over `pop_s` seconds (a pop of 1.06 or less and a gap of 0.36 em, or two words such as "fully writing" read as one).
    # mode 'word' = every word is its own positioned event (a pop never moves its neighbours). `size` is picked from the block's length when
    # `autosize` = [[min chars, size], ...] (largest first); an event may set its own size, x, y (e.g. y 1300 on a full-height punch).
    'short': {'font': 'Montserrat Black', 'file': 'Montserrat-Black.ttf', 'mode': 'word', 'size': 64, 'autosize': [[26, 50], [20, 56], [0, 64]],
              'x': 480, 'y': 1180, 'maxw': 840, 'pad_x': 28, 'pad_y': 10, 'radius': 20, 'color': '#ffffff', 'active': None, 'accent': '#ffd84a', 'dim': 0.35,
              'box': '#0d0d10', 'box_alpha': 0.82, 'fade_in': 0.08, 'fade_out': 0.12, 'gap_em': 0.36, 'pop': 1.06, 'pop_s': 0.12, 'line_h': 1.15,
              'current': None, 'outline': 0, 'outline_color': '#000000'},     # current = colour of ONLY the word being said; outline = black stroke in px (0 = none); box_alpha 0 = no box
}


BS = chr(92)


def bgr(hexcolor):
    h = hexcolor.lstrip('#')
    return f'&H{h[4:6]}{h[2:4]}{h[0:2]}&'.upper()


def alpha(a):
    """ASS alpha: 00 opaque .. FF clear. `a` is opacity 0..1."""
    return f'&H{int(round((1 - a) * 255)):02X}&'


def ts(t):
    t = max(0.0, t)
    cs = int(round(t * 100))
    return f'{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}'


# the same font under the file names other systems give it
ALIASES = {'ariblk.ttf': ['ariblk.ttf', 'Arial Black.ttf', 'ArialBlack.ttf'], 'Montserrat-Black.ttf': ['Montserrat-Black.ttf']}


def font_path(style):
    """The caption font file: kit/fonts, then the system's fonts (pipelib.font_dirs). A missing font gives its kit/fonts path (which does not exist)."""
    for n in ALIASES.get(style['file'], [style['file']]):
        p = find_font(n)
        if p:
            return p
    return os.path.join(KIT, 'fonts', style['file'])


# the bundled font a style falls back to when its own is not on this system (Arial Black is not on Linux)
FALLBACK = {'font': 'Montserrat Black', 'file': 'Montserrat-Black.ttf'}


def with_font(style):
    """The style as given when its font file is found, else the style with the bundled fallback font."""
    if os.path.isfile(font_path(style)):
        return style
    return {**style, **FALLBACK}


def fonts_dir(cut):
    """A folder with the caption fonts (work/fonts), for libass's fontsdir: copies of the two caption fonts, wherever they were found."""
    import shutil
    d = os.path.join(cut.work, 'fonts')
    os.makedirs(d, exist_ok=True)
    for n in ('Montserrat-Black.ttf', 'ariblk.ttf'):
        p = font_path({'file': n})
        if os.path.isfile(p) and not os.path.isfile(os.path.join(d, n)):
            shutil.copy2(p, os.path.join(d, n))
    return d


def ff_path(p):
    """A path inside an ffmpeg filter argument: forward slashes, the colon escaped."""
    return p.replace(chr(92), "/").replace(":", chr(92) + ":")


def win_k(path):
    """em / (usWinAscent + usWinDescent) of a TrueType font: libass sizes a line by the Windows metrics, so the ASS Fontsize is size / k to make the em `size` px
    (Montserrat Black 0.640: measured on a rendered frame, 0.63; Arial Black 0.709). None when the file cannot be read."""
    import struct
    try:
        with open(path, 'rb') as fh:
            d = fh.read()
        n = struct.unpack('>H', d[4:6])[0]
        tabs = {}
        for i in range(n):
            tag, _, off, _ln = struct.unpack('>4sIII', d[12 + 16 * i:28 + 16 * i])
            tabs[tag.decode('latin-1')] = off
        upm = struct.unpack('>H', d[tabs['head'] + 18:tabs['head'] + 20])[0]
        wa, wd = struct.unpack('>HH', d[tabs['OS/2'] + 74:tabs['OS/2'] + 78])
        return upm / float(wa + wd)
    except (OSError, KeyError, struct.error):
        return None


class Measure:
    """Text width in video pixels for a style `size` given as the em size in px (like CSS). libass sizes by line height (ascent + descent), so the ASS Fontsize is size / k, k = em / (ascent + descent)."""

    def __init__(self, style, size=None):
        from PIL import ImageFont
        self.ok = True
        self.k = 0.709   # Arial Black: em / (ascent + descent)
        self.size = size or style['size']
        try:
            f = ImageFont.truetype(font_path(style), 200)
            self.k = win_k(font_path(style)) or 200.0 / sum(f.getmetrics())
            self.font = f
        except OSError:
            self.ok = False

    def width(self, text):
        if not self.ok:
            return len(text) * self.size * 0.62
        return self.font.getlength(text) * self.size / 200.0


def rounded_box(x0, y0, x1, y1, r):
    """ASS drawing commands for a rounded rectangle (bezier corners)."""
    k = r * 0.5523
    f = lambda v: f'{v:.1f}'
    return (f'm {f(x0 + r)} {f(y0)} l {f(x1 - r)} {f(y0)} b {f(x1 - r + k)} {f(y0)} {f(x1)} {f(y0 + r - k)} {f(x1)} {f(y0 + r)} '
            f'l {f(x1)} {f(y1 - r)} b {f(x1)} {f(y1 - r + k)} {f(x1 - r + k)} {f(y1)} {f(x1 - r)} {f(y1)} '
            f'l {f(x0 + r)} {f(y1)} b {f(x0 + r - k)} {f(y1)} {f(x0)} {f(y1 - r + k)} {f(x0)} {f(y1 - r)} '
            f'l {f(x0)} {f(y0 + r)} b {f(x0)} {f(y0 + r - k)} {f(x0 + r - k)} {f(y0)} {f(x0 + r)} {f(y0)}')


def build_line(doc, caps, st):
    """mode 'line' (the long-form look): the whole line is one Dialogue per word state; the word being said is gold."""
    W, H = doc['width'], doc['height']
    ms = Measure(st)
    fs = round(st['size'] / ms.k)
    head = (f"[Script Info]\nScriptType: v4.00+\nPlayResX: {W}\nPlayResY: {H}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n"
            f"[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
            f"ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
            f"Style: Cap,{st['font']},{fs},{bgr(st['color'])},{bgr(st['color'])},&H00000000&,&H00000000&,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1\n"
            f"Style: Box,{st['font']},{fs},{bgr(st['box'])},{bgr(st['box'])},&H00000000&,&H00000000&,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1\n\n"
            f"[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")
    lines = [head]
    sp = ms.width(' ') + st['gap'] * 0.0
    for e in caps:
        words = e['words']
        txt = [w[2] for w in words]
        # two lines when the block is wider than the box allows: break at the middle word
        full = ms.width(' '.join(txt))
        rows = [list(range(len(words)))]
        if full > st['maxw'] and len(words) > 1:
            cut = min(range(1, len(words)), key=lambda i: abs(ms.width(' '.join(txt[:i])) - ms.width(' '.join(txt[i:]))))
            rows = [list(range(cut)), list(range(cut, len(words)))]
        wmax = max(ms.width(' '.join(txt[i] for i in r)) for r in rows)
        lh = st['size'] * 1.15
        bw, bh = wmax + 2 * st['pad_x'], lh * len(rows) + 2 * st['pad_y']
        cx, cy = st['x'], st['y']
        x0, y0 = cx - bw / 2, cy - bh / 2
        fade = f"\\fad({int(st['fade_in'] * 1000)},{int(st['fade_out'] * 1000)})"
        lines.append(f"Dialogue: 0,{ts(e['at'])},{ts(e['end'])},Box,,0,0,0,,{{\\an7\\pos(0,0)\\1c{bgr(st['box'])}\\1a{alpha(st['box_alpha'])}\\bord0\\shad0{fade}\\p1}}"
                     f"{rounded_box(x0, y0, x0 + bw, y0 + bh, st['radius'])}{{\\p0}}")
        # one Dialogue per word state: the words said so far white, the one being said gold, the rest dim
        starts = [w[0] - 0.04 for w in words]
        starts[0] = e['at']
        for i, w in enumerate(words):
            t0 = starts[i]
            t1 = starts[i + 1] if i + 1 < len(words) else e['end']
            if t1 <= t0:
                continue
            parts = []
            for ri, r in enumerate(rows):
                seg = []
                for j in r:
                    acc = len(words[j]) > 3 and words[j][3]
                    if j < i:
                        col, a = (st['accent'] if acc else st['color']), 1
                    elif j == i:
                        col, a = st['active'], 1
                    else:
                        col, a = st['color'], st['dim']
                    seg.append(f"{{\\1c{bgr(col)}\\1a{alpha(a)}}}{words[j][2].replace('{', '(').replace('}', ')')}")
                parts.append(' '.join(seg))
            text = '\\N'.join(parts)
            fd = fade if (i == 0 or i == len(words) - 1) else ''
            lines.append(f"Dialogue: 1,{ts(t0)},{ts(t1)},Cap,,0,0,0,,{{\\an5\\pos({cx:.1f},{cy:.1f}){fd}}}{text}")
    return '\n'.join(lines) + '\n'



def head_text(st, W, H, fs):
    return (f"[Script Info]\nScriptType: v4.00+\nPlayResX: {W}\nPlayResY: {H}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n"
            f"[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
            f"ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
            f"Style: Cap,{st['font']},{fs},{bgr(st['color'])},{bgr(st['color'])},&H00000000&,&H00000000&,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1\n"
            f"Style: Box,{st['font']},{fs},{bgr(st['box'])},{bgr(st['box'])},&H00000000&,&H00000000&,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1\n\n"
            f"[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")


def pick_size(st, text):
    """The block's font size: an event's own, else from the text length by `autosize` [[min chars, size], ...] (largest first), else `size`."""
    n = len(text)
    for mn, sz in st.get('autosize') or []:
        if n > mn:
            return sz
    return st['size']


def build_word(doc, caps, st0):
    """mode 'word' (the Shorts look): the dark box, then every word as its own event at its own fixed position, so a pop never moves its neighbours.
    Per word: dim from the block's start, then at its start time it pops to `pop` (scale about its centre) and settles to 1 over `pop_s`,
    in white (accent words in the accent colour, or `active` when set), until the block ends."""
    W, H = doc['width'], doc['height']
    lines = []
    fs0 = None
    for e in caps:
        st = dict(st0)
        for k in ('x', 'y', 'size', 'maxw'):
            if e.get(k) is not None:
                st[k] = e[k]
        words = e['words']
        txt = [w[2] for w in words]
        size = e.get('size') or pick_size(st, ' '.join(txt))
        ms = Measure(st, size)
        fs = round(size / ms.k)
        fs0 = fs0 or fs
        gap = st['gap_em'] * size
        wid = [ms.width(t) for t in txt]
        def rowwidth(idx):
            return sum(wid[i] for i in idx) + gap * (len(idx) - 1)
        rows = [list(range(len(words)))]
        if rowwidth(rows[0]) > st['maxw'] and len(words) > 1:
            cut = min(range(1, len(words)), key=lambda i: abs(rowwidth(list(range(i))) - rowwidth(list(range(i, len(words))))))
            rows = [list(range(cut)), list(range(cut, len(words)))]
        wmax = max(rowwidth(r) for r in rows)
        lh = size * st['line_h']
        bw, bh = wmax + 2 * st['pad_x'], lh * len(rows) + 2 * st['pad_y']
        cx, cy = st['x'], st['y']
        x0, y0 = cx - bw / 2, cy - bh / 2
        fade = f"\\fad({int(st['fade_in'] * 1000)},{int(st['fade_out'] * 1000)})"
        if st["box_alpha"] > 0: lines.append(f"Dialogue: 0,{ts(e['at'])},{ts(e['end'])},Box,,0,0,0,,{{\\an7\\pos(0,0)\\1c{bgr(st['box'])}\\1a{alpha(st['box_alpha'])}\\bord0\\shad0{fade}\\p1}}"
                     f"{rounded_box(x0, y0, x0 + bw, y0 + bh, st['radius'])}{{\\p0}}")
        starts = [max(e['at'], w[0] - 0.04) for w in words]
        for ri, r in enumerate(rows):
            x = cx - rowwidth(r) / 2
            y = cy - (lh * len(rows)) / 2 + lh * (ri + 0.5)
            for j in r:
                w = words[j]
                wx = x + wid[j] / 2
                x += wid[j] + gap
                acc = len(w) > 3 and w[3]
                on_col = st['accent'] if acc else (st['active'] or st['color'])
                tx = w[2].replace('{', '(').replace('}', ')')
                pos = f"\\an5\\pos({wx:.1f},{y:.1f})\\fs{fs}"
                t0 = starts[j]
                ol = (BS + 'bord' + format(st['outline'], 'g') + BS + '3c' + bgr(st['outline_color']) + BS + 'shad0') if st.get('outline') else ''
                nxt = starts[j + 1] if j + 1 < len(words) else e['end']
                if t0 > e['at'] + 0.001:      # waiting: dim
                    f = f"\\fad({int(st['fade_in'] * 1000)},0)"
                    lines.append(f"Dialogue: 1,{ts(e['at'])},{ts(t0)},Cap,,0,0,0,,{{{pos}{f}\\1c{bgr(st['color'])}\\1a{alpha(st['dim'])}}}{tx}")
                pop, ps = st['pop'], int(st['pop_s'] * 1000)
                fo = f"\\fad(0,{int(st['fade_out'] * 1000)})"
                if st.get('current') and nxt > t0 + 0.02:     # only the word being said is lit (`current`), the words said before it go back to white
                    lines.append(f"Dialogue: 2,{ts(t0)},{ts(nxt)},Cap,,0,0,0,,{{{pos}{ol}\\1c{bgr(st['current'])}\\1a&H00&"
                                 f"\\fscx{pop * 100:.0f}\\fscy{pop * 100:.0f}\\t(0,{ps},\\fscx100\\fscy100)}}{tx}")
                    if nxt < e['end'] - 0.001:
                        lines.append(f"Dialogue: 2,{ts(nxt)},{ts(e['end'])},Cap,,0,0,0,,{{{pos}{fo}{ol}\\1c{bgr(on_col)}\\1a&H00&}}{tx}")
                    continue
                lines.append(f"Dialogue: 2,{ts(t0)},{ts(e['end'])},Cap,,0,0,0,,{{{pos}{fo}{ol}\\1c{bgr(on_col)}\\1a&H00&"
                             f"\\fscx{pop * 100:.0f}\\fscy{pop * 100:.0f}\\t(0,{ps},\\fscx100\\fscy100)}}{tx}")
    return head_text(st0, W, H, fs0 or round(st0['size'] / 0.709)) + '\n'.join(lines) + '\n'


def build(doc):
    """The ASS file text for every caption event of an events document, or None when there are none."""
    caps = [e for e in doc['events'] if e['kind'] == 'caption' and e.get('render') is not False]
    if not caps:
        return None
    st = dict(DEFAULTS[doc['format']])
    st.update((doc.get('captions') or {}).get('style') or {})
    st = with_font(st)
    if st.get('mode') == 'word':
        return build_word(doc, caps, st)
    return build_line(doc, caps, st)


def write(cut, doc):
    """Writes video/out/work/captions.ass; returns its file name relative to work/ (None when there are no captions)."""
    ass = build(doc)
    path = os.path.join(cut.work, 'captions.ass')
    if ass is None:
        if os.path.isfile(path):
            os.remove(path)
        return None
    with open(path, 'w', encoding='utf-8-sig') as f:
        f.write(ass)
    return 'captions.ass'


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--video')
    a = ap.parse_args()
    c = Cut(a.video)
    print(write(c, read_json(c.events)) or 'no captions')
