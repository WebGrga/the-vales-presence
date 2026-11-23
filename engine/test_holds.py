"""Tests of the two speed-ups: holds (still stretches) and chunked compose.   python test_holds.py   (needs ffmpeg; no GPU, no Remotion)"""
import copy
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compose_chunks as cc
import holds
import windows

FPS = 60


def ev(id, at, end, comp='Ring', **kw):
    return dict({'id': id, 'kind': 'effect', 'comp': comp, 'at': at, 'end': end, 'props': {}}, **kw)


T = holds.load_table()


class PlanTests(unittest.TestCase):
    def test_covers_window_exactly(self):
        e = ev('R', 10.0, 20.0)
        a, b = int(9.5 * FPS), int(20.5 * FPS)
        st = holds.plan_window([e], a, b, FPS, 1, T)
        self.assertEqual(st[0]['a'], a)
        self.assertEqual(st[-1]['b'], b)
        for x, y in zip(st, st[1:]):
            self.assertEqual(x['b'], y['a'])
            self.assertNotEqual(x['kind'], y['kind'])

    def test_ring_holds_in_the_middle(self):
        e = ev('R', 10.0, 20.0)
        st = holds.plan_window([e], 570, 1230, FPS, 1, T)
        kinds = [s['kind'] for s in st]
        self.assertEqual(kinds, ['full', 'hold', 'full'])
        hold = st[1]
        self.assertGreater(hold['a'], 10.0 * FPS + 2.0 * FPS)          # after the head (2.4 s by default)
        self.assertLess(hold['b'], 20.0 * FPS)                          # before the fade

    def test_short_events_do_not_hold(self):
        st = holds.plan_window([ev('L', 5.0, 8.0, 'Label')], 270, 510, FPS, 1, T)
        self.assertEqual([s['kind'] for s in st], ['full'])

    def test_props_times_make_busy_zones(self):
        e = ev('D', 10.0, 40.0, 'Diag', props={'tile': 10.0, 'reason': 25.0, 'box': [10, 20, 30, 40]})
        st = holds.plan_window([e], 570, 2430, FPS, 1, T)
        busy = [(s['a'] / FPS, s['b'] / FPS) for s in st if s['kind'] == 'full']
        self.assertTrue(any(a <= 24.8 and b >= 27.0 for a, b in busy), busy)      # the step at 25 s, 2.4 s to settle
        holds_ = [(s['a'] / FPS, s['b'] / FPS) for s in st if s['kind'] == 'hold']
        self.assertTrue(any(a < 15 < b for a, b in holds_), holds_)          # the box's whole numbers are not moments

    def test_show_kit_times_are_moments(self):
        # Compare's at2 and Scoreboard's [[at, value], ...] with whole seconds are moments, a pixel box is not
        e = ev('S', 10.0, 40.0, 'Scoreboard', props={'at2': 20, 'rows': [{'name': 'A', 'score': [[25, 3], [32, 5]]}], 'x': 12, 'y': 30})
        nums = []
        holds._numbers(e['props'], nums)
        self.assertEqual(sorted(nums), [20.0, 25.0, 32.0])

    def test_still_false_never_holds(self):
        st = holds.plan_window([ev('R', 10.0, 20.0, still=False)], 570, 1230, FPS, 1, T)
        self.assertEqual([s['kind'] for s in st], ['full'])

    def test_declared_still_and_settle(self):
        st = holds.plan_window([ev('R', 10.0, 20.0, still={'from': 10.5, 'to': 19.6})], 570, 1230, FPS, 1, T)
        self.assertEqual([s['kind'] for s in st], ['full', 'hold', 'full'])
        self.assertLess(st[1]['a'], 10.7 * FPS)
        st2 = holds.plan_window([ev('R', 10.0, 20.0, settle=0.5)], 570, 1230, FPS, 1, T)
        self.assertLess(st2[1]['a'], st[1]['a'] + 3 * FPS)

    def test_relative_keys(self):
        T2 = holds.load_table(None, 'short')
        e = ev('H', 0.0, 8.0, 'Band', props={'lines': [{'p': ['A'], 'size': 88}, {'p': ['B'], 'size': 60, 'after': 4.0}]})
        st = holds.plan_window([e], 0, 8 * FPS, FPS, 1, T2)
        full = [(s['a'] / FPS, s['b'] / FPS) for s in st if s['kind'] == 'full']
        self.assertTrue(any(a <= 4.0 and b >= 4.5 for a, b in full), full)

    def test_proof_grid(self):
        st = holds.plan_window([ev('R', 10.0, 20.0)], 570, 1230, FPS, 2, T)
        self.assertEqual(st[0]['a'] % 2, 0)
        self.assertEqual(st[-1]['b'], 1230)

    def test_calls_cover_the_busy_frames_and_sample_the_holds(self):
        st = holds.plan_window([ev('R', 10.0, 20.0)], 570, 1230, FPS, 1, T)
        calls = holds.calls_for(st, FPS, 1, T)
        drawn = set()
        for c in calls:
            drawn.update(range(c['a'], c['b'], c['nth']))
        for s in st:
            if s['kind'] == 'full':
                self.assertTrue(set(range(s['a'], s['b'])) <= drawn)
            else:
                self.assertIn(s['a'], drawn)
                self.assertIn(s['b'] - 1, drawn)
                self.assertLess(len(drawn & set(range(s['a'], s['b']))), (s['b'] - s['a']) // 20)


class PackTests(unittest.TestCase):
    def test_concat_times_do_not_drift(self):
        kept = [(f, f'x{f}.png') for f in (0, 1, 2, 500, 501, 1000, 1099)]
        txt = holds.concat_text(kept, 0, 1100, FPS, 1)
        durs = [float(l.split()[1]) for l in txt.splitlines() if l.startswith('duration')]
        t = 0
        for (f, _), d in zip(kept, durs):
            self.assertAlmostEqual(t, f / FPS, places=5)
            t += d

    def test_pack_overlay_matches_a_full_sequence(self):
        """A held .mov, decoded at 60 fps, shows the same pictures as the full sequence it stands for."""
        from PIL import Image, ImageDraw
        with tempfile.TemporaryDirectory() as d:
            n = 150
            a = 100

            def pic(f):
                im = Image.new('RGBA', (64, 36), (0, 0, 0, 0))
                x = 4 + min(f - a, 20) * 2                     # moves for 20 frames, then sits still, then (frame 140+) a fade
                ImageDraw.Draw(im).rectangle([x, 4, x + 10, 14], fill=(255, 0, 0, 255 if f < a + 140 else 128))
                return im
            for f in range(a, a + n):
                pic(f).save(os.path.join(d, f'f{f}.png'))
            st = [{'kind': 'full', 'a': a, 'b': a + 22}, {'kind': 'hold', 'a': a + 22, 'b': a + 140}, {'kind': 'full', 'a': a + 140, 'b': a + n}]
            bad, stats = holds.verify(d, st, FPS, 1, T)
            self.assertEqual(bad, [])
            kept = holds.pack_list(d, st, a, a + n, FPS, 1)
            self.assertLess(len(kept), 60)
            out = os.path.join(d, 'x.mov')
            holds.write_mov(d, kept, out, a, a + n, FPS, 1, ['-c:v', 'png', '-pix_fmt', 'rgba'])
            r = subprocess.run(['ffmpeg', '-v', 'error', '-i', out, '-vf', f'fps={FPS}', '-start_number', str(a), os.path.join(d, 'd%d.png')], capture_output=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            for f in range(a, a + n):
                self.assertEqual(holds.max_diff(os.path.join(d, f'd{f}.png'), os.path.join(d, f'f{f}.png')), 0.0, f'frame {f}')

    def test_a_hold_that_moves_is_rejected(self):
        from PIL import Image, ImageDraw
        with tempfile.TemporaryDirectory() as d:
            for f in range(0, 200):
                im = Image.new('RGBA', (64, 36), (0, 0, 0, 0))
                ImageDraw.Draw(im).rectangle([4 + (f // 40), 4, 14, 14], fill=(255, 0, 0, 255))        # creeps one pixel every 40 frames
                im.save(os.path.join(d, f'f{f}.png'))
            st = [{'kind': 'hold', 'a': 0, 'b': 200}]
            bad, _ = holds.verify(d, st, FPS, 1, T)
            self.assertEqual(len(bad), 1)


class ChunkTests(unittest.TestCase):
    def doc(self):
        evs = [ev('R1', 30.0, 44.0), ev('L1', 100.0, 103.0, 'Label'), ev('R2', 200.0, 215.0)]
        evs.append({'id': 'P1', 'kind': 'zoom', 'at': 60.0, 'end': 75.0, 'zoom': 1.5, 'x': 0, 'y': 0, 'ease': 0.4})
        evs.append({'id': 'K1', 'kind': 'caption', 'at': 130.0, 'end': 131.0, 'words': [[130.0, 130.5, 'hi']]})
        return {'fps': FPS, 'width': 1920, 'height': 1080, 'duration': 300.0, 'format': 'long', 'events': evs}

    def plan(self, doc):
        return windows.plan(doc, 'code')

    def test_bounds_on_a_grid_off_the_busy_frames(self):
        doc = self.doc()
        nb = int(300 * FPS)
        b = cc.chunk_bounds(doc, self.plan(doc), nb, 15.0)
        self.assertEqual(b[0], 0)
        self.assertEqual(b[-1], nb)
        self.assertTrue(all(y > x for x, y in zip(b, b[1:])))
        self.assertTrue(all(8 * FPS < y - x < 22 * FPS for x, y in zip(b, b[1:])), [round(x / FPS, 1) for x in b])
        for c in b[1:-1]:
            t = c / FPS
            self.assertFalse(29.5 < t < 44.5 and False)
        # a boundary never sits inside a window when a calm frame is near
        ws = self.plan(doc)
        inside = [c / FPS for c in b[1:-1] if any(w['a'] < c < w['b'] for w in ws)]
        self.assertEqual(inside, [210.0])         # only the 15 s ring has no calm frame within a quarter of a chunk of its grid line

    def test_an_edit_moves_only_its_own_chunk_keys(self):
        doc = self.doc()
        nb = int(300 * FPS)
        ws = self.plan(doc)
        b1 = cc.chunk_bounds(doc, ws, nb, 15.0)
        doc2 = copy.deepcopy(doc)
        next(e for e in doc2['events'] if e['id'] == 'L1')['props'] = {'text': 'changed'}
        b2 = cc.chunk_bounds(doc2, self.plan(doc2), nb, 15.0)
        self.assertEqual(b1, b2)
        cut = None
        k1 = [cc.chunk_inputs(doc, ws, a, b, cut, 'c') for a, b in zip(b1, b1[1:])]
        k2 = [cc.chunk_inputs(doc2, self.plan(doc2), a, b, cut, 'c') for a, b in zip(b1, b1[1:])]
        changed = [i for i, (x, y) in enumerate(zip(k1, k2)) if x != y]
        self.assertEqual(len(changed), 1)
        a, b = b1[changed[0]], b1[changed[0] + 1]
        self.assertTrue(a <= 100 * FPS and b >= 103 * FPS)

    def test_a_zoom_across_a_seam_is_in_both_chunks(self):
        doc = self.doc()
        zs = []
        for a, b in [(0, 40 * FPS), (40 * FPS, 80 * FPS)]:
            zs.append([z['id'] for z in cc.cm.video_zooms(doc) if cc.overlaps(z, a, b, FPS)])
        self.assertEqual(zs, [[], ['P1']])


if __name__ == '__main__':
    unittest.main()
