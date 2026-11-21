"""Draws the app's 16 px pixel icons into web/icons/<name>.png (our own work, free to use with the app).

Each icon is a small grid of letters below (one letter = one pixel, '.' = clear); the grid is centred on a
16 x 16 canvas and every clear pixel that touches a coloured one gets the dark outline, so the grids only hold
the fills. Colours come from web/style/palette.json. The page shows them at 2x with image-rendering: pixelated.

    python tools/gen_icons.py          (needs Pillow)
"""
import json
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'web', 'icons')
PALETTE = os.path.join(ROOT, 'web', 'style', 'palette.json')

# letter -> palette colour name
KEY = {
    'o': 'outline', 'a': 'cream', 'w': 'white', 'W': 'wall', 'y': 'yellow', 'O': 'orange', 'r': 'red', 'R': 'lred',
    'd': 'dred', 'g': 'green', 'G': 'lgreen', 'b': 'blue', 'B': 'lblue', 'D': 'dblue', 'n': 'brown', 'N': 'lbrown',
    't': 'tan', 'h': 'dbrown', 's': 'lgrey', 'S': 'grey', 'x': 'dgrey', 'p': 'purple', 'P': 'lpurple', 'c': 'teal',
    'i': 'pink', 'k': 'ink',
}

ICONS = {
    'play': """
gg
gGg
gGGg
gGGGg
gGGGGg
gGGGGGg
gGGGGGGg
gGGGGGGg
gGGGGGg
gGGGGg
gGGGg
gGGg
gGg
gg""",
    'pause': """
aaa..aaa
aWa..aWa
aWa..aWa
aWa..aWa
aWa..aWa
aWa..aWa
aWa..aWa
aWa..aWa
aWa..aWa
aWa..aWa
aWa..aWa
aaa..aaa""",
    'stop': """
rrrrrrrrrr
rRRRRRRRRr
rRrrrrrrRr
rRrrrrrrRr
rRrrrrrrRr
rRrrrrrrRr
rRrrrrrrRr
rRrrrrrrRr
rRRRRRRRRr
rrrrrrrrrr""",
    'scissors': """
ss.......ss
.ss.....ss.
..ss...ss..
...ss.ss...
....sss....
.....s.....
....r.r....
..rrr.rrr..
.rr.r.r.rr.
.r..r.r..r.
.rr.r.r.rr.
..rrr.rrr..""",
    'cut': """
....yy....
....yy....
OOOOyyOOOO
.OOOyyOOO.
..OOyyOO..
....yy....
....yy....
....yy....
....yy....
....yy....
..OOyyOO..
.OOOyyOOO.
OOOOyyOOOO
....yy....""",
    'keep': """
..........gg
.........gGg
........gGg.
.......gGg..
gg....gGg...
gGg..gGg....
.gGggGg.....
..gGGg......
...gg.......""",
    'cross': """
rr......rr
rRr....rRr
.rRr..rRr.
..rRrrRr..
...rRRr...
...rRRr...
..rRrrRr..
.rRr..rRr.
rRr....rRr
rr......rr""",
    'restore': """
....yy......
...yWy......
..yWWyyyyyy.
.yWWWWWWWWyy
..yWWyyyyyWy
...yWy....yWy
....yy.....yy
...........yy
..........yWy
.....yyyyyWy.
.....yWWWWy..
.....yyyyy...""",
    'undo': """
....bb......
...bBb......
..bBBbbbbbb.
.bBBBBBBBBbb
..bBBbbbbbBb
...bBb....bBb
....bb.....bb
...........bb
..........bBb
.....bbbbbBb.
.....bBBBBb..
.....bbbbb...""",
    'redo': ('mirror', 'undo'),  # undo turned around
    'lock': """
...ssss...
..sS..Ss..
.sS....Ss.
.s......s.
.s......s.
yyyyyyyyyy
yWWWWWWWWy
yWyyyyyyWy
yWyyhhyyWy
yWyyhhyyWy
yWyyyhyyWy
yWyyyyyyWy
yyyyyyyyyy""",
    'agent': """
...nnnnnn...
..nNNNNNNn..
.nNNNNNNNNn.
.nNttttttNn.
.nttttttttn.
.ttktttktt..
.ttktttktt..
.tttttttttt.
..tttrrttt..
...tttttt...
..bbbbbbbb..
.bBBbbbbBBb.
bBBBbyybBBBb
bBBBbbbbBBBb""",
    'film': """
xxxxxxxxxxxx
xaxxaxxaxxax
xxxxxxxxxxxx
xBBBBxBBBBBx
xBDDBxBDDBBx
xBDDBxBDDBBx
xBBBBxBBBBBx
xxxxxxxxxxxx
xaxxaxxaxxax
xxxxxxxxxxxx""",
    'music': """
.......pppp
....ppppPPp
....pPPPPPp
....pppp.pp
....p....pp
....p....pp
....p....pp
....p..PPPp
.PPPp.PPPPp
PPPPp.PPPp.
PPPPp......
.PPp.......""",
    'export': """
.....gg.....
....gGGg....
...gGGGGg...
..gGGGGGGg..
....gGGg....
....gGGg....
nnn.gGGg.nnn
nNn.gggg.nNn
nNn......nNn
nNnnnnnnnnNn
nNNNNNNNNNNn
nnnnnnnnnnnn""",
    'upload': """
.....bb.....
....bBBb....
...bBBBBb...
..bBBBBBBb..
....bBBb....
....bBBb....
....bBBb....
....bbbb....
............
ssssssssssss
sSSSSSSSSSSs
ssssssssssss""",
    'note': """
WWWWWWWWWW
WaaaaaaaaW
WaxxxxxxaW
WaaaaaaaaW
WaxxxxxaaW
WaaaaaaaaW
WaxxxxxxaW
WaaaaaaaaW
WaxxxxaaaW
WaaaaaaaaW
WaaaaaaWWW
WaaaaaaWa.
WWWWWWWW..""",
    'flag': """
n..........
nOOOOOOO...
nOyyyyyOOO.
nOyyyyyyyO.
nOyyyyyyyO.
nOOOyyyyyO.
n..OOOOOOO.
n..........
n..........
n..........
n..........
nn.........""",
    'go': """
n..........
nrrrrrrr...
nrRRRRRrrr.
nrRRRRRRRr.
nrRRRRRRRr.
nrrrRRRRRr.
n..rrrrrrr.
n..........
n..........
n..........
n..........
nn.........""",
    'back': """
....OO......
...OyO......
..OyyOOOOOO.
.OyyyyyyyyO.
.OyyyyyyyyO.
..OyyOOOOOO.
...OyO......
....OO......""",
    'send': """
..........BB
........BBwB
......BBwwB.
....BBwwwB..
..BBwwwwB...
BBwwwwwB....
..BBwwB.....
....BwB.....
....BB......""",
    'folder': """
nnnn........
nNNNn.......
nNNNNnnnnnnn
nttttttttttn
ntWWWWWWWWtn
ntWWWWWWWWtn
ntWWWWWWWWtn
ntWWWWWWWWtn
ntttttttttttn
nnnnnnnnnnnn""",
    'wave': """
.....g......
.....g...g..
..g..g...g..
..g..g.g.g..
g.g.gg.g.g.g
g.g.gg.g.g.g
g.g.gg.g.g.g
..g..g.g.g..
..g..g...g..
.....g...g..
.....g......""",
    'zoomin': """
..aaaa....
.aBBBBa...
aBBwBBBa..
aBwwwBBa..
aBBwBBBa..
aBBBBBBa..
.aBBBBa...
..aaaana..
......nnn.
.......nnn
........nn""",
    'zoomout': """
..aaaa....
.aBBBBa...
aBBBBBBa..
aBwwwBBa..
aBBBBBBa..
aBBBBBBa..
.aBBBBa...
..aaaana..
......nnn.
.......nnn
........nn""",
    'snap': """
rr....ss
rr....ss
rr....ss
rr....ss
rRr..sSs
rRRrrSSs
.rRRSSs.
..rrss..""",
    'frameprev': """
aa....aa
aa...aWa
aa..aWWa
aa.aWWWa
aaaWWWWa
aaaWWWWa
aa.aWWWa
aa..aWWa
aa...aWa
aa....aa""",
    'framenext': """
aa....aa
aWa...aa
aWWa..aa
aWWWa.aa
aWWWWaaa
aWWWWaaa
aWWWa.aa
aWWa..aa
aWa...aa
aa....aa""",
    'cutprev': """
....yy....
...yWWy...
..yWWWWy..
.yWWWWWWy.
yyyyWWyyyy
....WW....
....WW....
OOOOOOOOOO
OOOOOOOOOO""",
    'cutnext': """
OOOOOOOOOO
OOOOOOOOOO
....WW....
....WW....
yyyyWWyyyy
.yWWWWWWy.
..yWWWWy..
...yWWy...
....yy....""",
    'gear': """
....ss....
..s.ss.s..
.ssssssss.
..ssSSss..
ssSS..SSss
ssSS..SSss
..ssSSss..
.ssssssss.
..s.ss.s..
....ss....""",
    'sparkle': """
.....y.....
.....y.....
....yyy....
....yWy....
yyyyWWWyyyy
..yyWWWyy..
....yWy....
....yyy....
.....y.....
.....y.....""",
    'book': """
nnnnnnnnnnnn
nWWWWnnWWWWn
nWxxWnnWxxWn
nWWWWnnWWWWn
nWxxWnnWxWWn
nWWWWnnWWWWn
nWxxWnnWxxWn
nWWWWnnWWWWn
nnnnnnnnnnnn
.nnnnnnnnnn.""",
    'clock': """
...aaaa...
..aWWWWa..
.aWWxWWWa.
aWWWxWWWWa
aWWWxWWWWa
aWWWxxxWWa
aWWWWWWWWa
.aWWWWWWa.
..aWWWWa..
...aaaa...""",
    'coin': """
...yyyy...
..yWWWWy..
.yWyyyyOy.
yWyWWWyyOy
yWyWyyyyOy
yWyWyyyyOy
yWyyyyyyOy
.yOyyyyOy.
..yOOOOy..
...yyyy...""",
    'text': """
cccccccccc
cBBBBBBBBc
cBBccccBBc
cccBBBBccc
..cBBBBc..
..cBBBBc..
..cBBBBc..
..cBBBBc..
..cBBBBc..
..cccccc..""",
    'layers': """
.....pp.....
...ppPPpp...
.ppPPPPPPpp.
ppPPPPPPPPpp
.ppPPPPPPpp.
p..ppPPpp..p
ppp..pp..ppp
.pppp..pppp.
...pppppp...
.....pp.....""",
    'question': """
..yyyyy..
.yWWWWWy.
yWWyyyWWy
yyy...yWy
.....yWy.
....yWy..
....yWy..
....yyy..
.........
....yyy..
....yWy..
....yyy..""",
    'eye': """
....aaaa....
..aaWWWWaa..
.aWWWbbWWWa.
aWWWbBBbWWWa
aWWWbBkbWWWa
.aWWWbbWWWa.
..aaWWWWaa..
....aaaa....""",
    'phone': """
xxxxxxx
xBBBBBx
xBBBBBx
xBBBBBx
xBBBBBx
xBBBBBx
xBBBBBx
xBBBBBx
xBBBBBx
xBBBBBx
xxxaxxx
xxxxxxx""",
    'mic': """
...ssss...
..sSSSSs..
..sSxxSs..
..sSSSSs..
..sSxxSs..
..sSSSSs..
n.sSSSSs.n
n..ssss..n
.n......n.
..nnnnnn..
....nn....
..nnnnnn..""",
    'plus': """
...gggg...
...gGGg...
...gGGg...
gggggGgggg
gGGGGGGGGg
gGGGGGGGGg
gggggGgggg
...gGGg...
...gGGg...
...gggg...""",
    'ab': """
.rrrr..bbbb.
rRRRRr.bBBBb
rRrrRr.bBbbB
rRRRRr.bBBBb
rRrrRr.bBbbB
rRrrRr.bBBBb
rr..rr.bbbb.""",
    'strike': """
............
.aaa.aaa.aa.
.aWa.aWa.aW.
.aWa.aWa.aW.
rrrrrrrrrrrr
rRRRRRRRRRRr
rrrrrrrrrrrr
.aWa.aWa.aW.
.aaa.aaa.aa.""",
    'home': """
.....rr.....
....rRRr....
...rRRRRr...
..rRRRRRRr..
.rRRRRRRRRr.
rrrrrrrrrrrr
.tWWWWWWWWt.
.tWWnnnWWWt.
.tWWnNnWbWt.
.tWWnNnWWWt.
.tttnnnttttt""",
    'tower': """
s.s.s.s.
ssssssss
.sSSSSs.
.sSkkSs.
.sSkkSs.
.sSSSSs.
.sSSSSs.
.sSnnSs.
.sSnnSs.
ssssssss""",
}


def hexrgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (255,)


def grid_of(text):
    if isinstance(text, tuple):  # ('mirror', other): the other icon flipped left to right
        return [r[::-1] for r in grid_of(ICONS[text[1]])]
    rows = [r for r in text.strip('\n').split('\n')]
    w = max(len(r) for r in rows)
    return [r.ljust(w, '.') for r in rows]


def draw(name, text, colors):
    rows = grid_of(text)
    h, w = len(rows), len(rows[0])
    if h > 14 or w > 14:
        raise SystemExit(f'{name}: {w}x{h} is too big (14x14 at most, the outline needs the edge)')
    ox, oy = (16 - w) // 2, (16 - h) // 2
    img = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    px = img.load()
    filled = set()
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch == '.':
                continue
            if ch not in KEY:
                raise SystemExit(f'{name}: unknown letter {ch!r}')
            px[ox + x, oy + y] = hexrgb(colors[KEY[ch]])
            filled.add((ox + x, oy + y))
    line = hexrgb(colors['outline'])
    for (x, y) in list(filled):
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < 16 and 0 <= ny < 16 and (nx, ny) not in filled:
                px[nx, ny] = line
    return img


def main():
    with open(PALETTE, encoding='utf-8') as f:
        colors = json.load(f)['colors']
    os.makedirs(OUT, exist_ok=True)
    names = sys.argv[1:] or sorted(ICONS)
    for name in names:
        draw(name, ICONS[name], colors).save(os.path.join(OUT, name + '.png'))
    with open(os.path.join(OUT, 'icons.json'), 'w', encoding='utf-8') as f:
        json.dump(sorted(ICONS), f)
        f.write('\n')
    print(f'{len(names)} icons -> web/icons/')


if __name__ == '__main__':
    main()
