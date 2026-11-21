"""Tests of faces.py and focus.py (the pure maths on synthetic data, and the ffmpeg path on a clip made here):  python test_faces.py
No real footage and no network: the pictures are made with numpy and ffmpeg."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import faces
import focus
from pipelib import Cut


def samp(t, box=None, eyes=None, look=0.0, found=True):
    if box is None:
        return {'t': t, 'found': False, 'box': None, 'eyes': None, 'mouth': None, 'look': 0.0, 'conf': 0.0, 'n': 0}
    return {'t': t, 'found': found, 'box': list(box), 'eyes': list(eyes or [(box[0] + box[2]) / 2, box[1] + (box[3] - box[1]) * 0.35]),
            'mouth': [(box[0] + box[2]) / 2, box[1] + (box[3] - box[1]) * 0.8], 'look': look, 'conf': 0.9, 'n': 1}


def still_face(cx=960, top=300, w=260, h=340, look=0.0):
    return {'box': [cx - w / 2, top, cx + w / 2, top + h], 'eyes': [cx, top + 0.35 * h], 'look': look, 'fh': h, 'fw': w, 'n': 5, 'found': 1.0}


class FaceMaths(unittest.TestCase):
    def test_look_sign_and_deadband(self):
        self.assertEqual(faces.look_of((90, 100), (110, 100), (100, 120)), 0.0)         # nose in the middle: straight on
        self.assertGreater(faces.look_of((90, 100), (110, 100), (108, 120)), 0.5)        # nose toward the right of the picture
        self.assertLess(faces.look_of((90, 100), (110, 100), (94, 120)), -0.3)
        self.assertEqual(faces.look_of((90, 100), (110, 100), (300, 120)), 1.0)         # capped

    def test_parse_row(self):
        row = [100, 50, 40, 60, 110, 70, 130, 70, 120, 85, 112, 100, 128, 100, 0.93]
        f = faces.parse_row(row)
        self.assertEqual(f['box'], [100, 50, 140, 110])
        self.assertEqual(f['eyes'], [120, 70])
        self.assertEqual(f['mouth'], [120, 100])
        self.assertAlmostEqual(f['conf'], 0.93)

    def test_pick_face_big_sure_and_continuous(self):
        small = {'box': [10, 10, 30, 30], 'conf': 0.95}
        big = {'box': [200, 200, 300, 330], 'conf': 0.8}
        self.assertIs(faces.pick_face([small, big]), big)                                # a sprite is small
        other = {'box': [600, 200, 720, 340], 'conf': 0.85}
        self.assertIs(faces.pick_face([big, other], prev_box=[205, 205, 300, 330]), big)  # whoever was there a moment ago
        self.assertIsNone(faces.pick_face([]))

    def test_smooth_fills_short_gaps_only(self):
        s = [samp(i * 0.25, (100, 100, 200, 220)) for i in range(4)]
        s += [samp(1.0 + i * 0.25) for i in range(3)] + [samp(1.75, (100, 100, 200, 220))]        # 0.75 s gap: filled
        s += [samp(2.0 + i * 0.25) for i in range(10)] + [samp(4.5, (100, 100, 200, 220))]        # 2.5 s gap: not
        out = faces.smooth(s)
        self.assertTrue(all(o['box'] for o in out[4:7]) and all(o['filled'] for o in out[4:7]) and not out[4]['found'])
        self.assertTrue(all(o['box'] is None for o in out[9:17]))
        self.assertTrue(out[-1]['box'])

    def test_smooth_drops_a_one_frame_jump(self):
        s = [samp(i * 0.25, (100, 100, 200, 220)) for i in range(11)]
        s[5] = samp(1.25, (700, 500, 800, 620))                                            # a wrong face for one frame
        out = faces.smooth(s)
        self.assertLess(abs(out[5]['box'][0] - 100), 5)
        self.assertEqual(s[5]['box'][0], 700)                                              # the input is untouched

    def test_smooth_keeps_a_real_move(self):
        s = [samp(i * 0.25, (100 + 20 * i, 100, 200 + 20 * i, 220)) for i in range(11)]
        out = faces.smooth(s)
        self.assertAlmostEqual(out[5]['box'][0], 200, delta=8)
        self.assertGreater(out[10]['box'][0], out[0]['box'][0] + 120)

    def test_stats_trim_the_stray_frame_and_take_the_stretch(self):
        s = [samp(i * 0.25, (500, 200, 700, 440)) for i in range(40)]
        s[10] = samp(2.5, (900, 200, 1100, 440))
        st = faces.stats(s, 0, 9.75)
        self.assertEqual(st['box'][0], 500)
        self.assertEqual(st['box'][2], 700)
        self.assertEqual(st['n'], 40)
        self.assertEqual(faces.stats(s, 3.0, 3.1)['n'], 1)                                 # shorter than a sample: the nearest one
        self.assertIsNone(faces.stats([samp(0, None)], 0, 1))

    def test_to_frame(self):
        st = faces.to_frame(still_face(cx=100, top=10, w=40, h=60), (2.0, 70, -300))
        self.assertEqual(st['box'], [230.0, -280.0, 310.0, -160.0])
        self.assertEqual(st['fh'], 120)

    def test_fit_axis(self):
        self.assertEqual(faces.fit_axis(400, 600, 500, 1000, pref=250), (250, True))
        self.assertEqual(faces.fit_axis(400, 600, 500, 1000, pref=0), (100, True))     # the window must reach the bottom of the need
        self.assertEqual(faces.fit_axis(400, 600, 500, 1000, pref=900), (400, True))
        self.assertEqual(faces.fit_axis(0, 1000, 500, 1000, pref=0), (250, False))     # wider than the window: centred, not ok
        s, ok = faces.fit_axis(-50, 100, 500, 1000, pref=-200)                         # a need past the edge of the frame
        self.assertEqual((s, ok), (0, True))


class Framing(unittest.TestCase):
    W, H = 1920, 1080

    def box(self, st, scale=1.1):
        return faces.punch_box(st, self.W, self.H, scale)

    def test_eyes_a_third_down_and_chin_in(self):
        st = still_face(cx=960, top=300, w=260, h=340)
        b = self.box(st, 1.3)
        h = self.H / b['zoom']
        self.assertTrue(b['fits'])
        self.assertAlmostEqual((st['eyes'][1] - b['y']) / h, 1 / 3, delta=0.01)
        self.assertGreater(b['y'] + h, st['box'][3])                                       # chin and mouth are in
        self.assertLess(b['y'], st['box'][1])                                              # so is the top of the head
        self.assertAlmostEqual(b['zoom'], 1.3)

    def test_never_past_the_frame(self):
        for cx, top in ((100, 20), (1850, 700), (960, 740), (30, 10)):
            b = self.box(still_face(cx=cx, top=top, w=200, h=260), 1.5)
            self.assertGreaterEqual(b['x'], 0)
            self.assertGreaterEqual(b['y'], 0)
            self.assertLessEqual(b['x'] + self.W / b['zoom'], self.W + 0.5)
            self.assertLessEqual(b['y'] + self.H / b['zoom'], self.H + 0.5)

    def test_a_face_at_the_bottom_keeps_the_chin(self):
        st = still_face(cx=960, top=760, w=240, h=300)
        b = self.box(st, 1.4)
        self.assertGreaterEqual(b['y'] + self.H / b['zoom'], st['box'][3] - 0.01)

    def test_room_on_the_side_he_looks(self):
        right, left, straight = (self.box(still_face(look=v), 1.5) for v in (1.0, -1.0, 0.0))
        self.assertGreater(right['x'], straight['x'])                                      # looking right: the crop moves right, the face sits left of centre
        self.assertLess(left['x'], straight['x'])

    def test_zoom_drops_when_the_stretch_moves_too_much(self):
        st = still_face(cx=960, top=300, w=1500, h=700)                                    # the box over the stretch is huge
        b = self.box(st, 1.5)
        self.assertFalse(b['fits'])
        self.assertLess(b['zoom'], 1.5)
        self.assertGreaterEqual(b['zoom'], 1.0)
        self.assertLessEqual(b['asked'] - b['zoom'], 0.5)

    def test_zoom_is_never_below_one(self):
        self.assertEqual(self.box(still_face(), 0.7)['zoom'], 1.0)

    def test_reframe_box_vertical(self):
        st = still_face(cx=700, top=300, w=220, h=300)
        r = faces.reframe_box(st, (0, 0, 1920, 1080), 9 / 16)
        self.assertEqual((r['w'], r['h']), (608, 1080))
        self.assertTrue(r['fits'] and r['w'] % 2 == 0 and r['x'] % 2 == 0)
        self.assertLessEqual(r['x'], st['box'][0])
        self.assertGreaterEqual(r['x'] + r['w'], st['box'][2])
        self.assertAlmostEqual(r['w'] / r['h'], 9 / 16, delta=0.003)

    def test_reframe_box_stays_in_bounds_and_in_a_corner(self):
        st = still_face(cx=150, top=300, w=200, h=260)                                      # near the left edge
        r = faces.reframe_box(st, (0, 0, 1920, 1080), 9 / 16)
        self.assertEqual(r['x'], 0)
        bounds = (0, 700, 640, 380)                                                         # a webcam inset
        st2 = still_face(cx=300, top=760, w=120, h=150)
        r2 = faces.reframe_box(st2, bounds, 9 / 16)
        self.assertGreaterEqual(r2['x'], 0)
        self.assertGreaterEqual(r2['y'], 700)
        self.assertLessEqual(r2['y'] + r2['h'], 1080)
        self.assertLessEqual(r2['x'] + r2['w'], 640)

    def test_reframe_box_odd_bounds_stay_inside(self):
        r = faces.reframe_box(still_face(cx=200, top=800, w=100, h=130), (0, 753, 470, 327), 9 / 16)
        self.assertLessEqual(r['y'] + r['h'], 753 + 327)
        self.assertLessEqual(r['x'] + r['w'], 470)
        self.assertEqual((r['w'] % 2, r['h'] % 2), (0, 0))

    def test_reframe_tighter_puts_the_eyes_a_third_down(self):
        st = still_face(cx=960, top=300, w=260, h=340)
        r = faces.reframe_box(st, (0, 0, 1920, 1080), 9 / 16, zoom=1.4)
        self.assertAlmostEqual(r['h'], 1080 / 1.4, delta=2)
        self.assertAlmostEqual((st['eyes'][1] - r['y']) / r['h'], 1 / 3, delta=0.02)

    def test_a_face_wider_than_the_crop_is_tight_or_not_fitting(self):
        st = still_face(cx=960, top=300, w=590, h=700)
        r = faces.reframe_box(st, (0, 0, 1920, 1080), 9 / 16)
        self.assertTrue(r['fits'] and r['tight'])
        st = still_face(cx=960, top=300, w=700, h=700)
        self.assertFalse(faces.reframe_box(st, (0, 0, 1920, 1080), 9 / 16)['fits'])


EDL_ITEMS = [
    {'kind': 'S', 'at': 0.0, 'len': 10.0, 'src': 'r1', 'src_in': 10.0, 'src_out': 20.0},
    {'kind': 'S', 'at': 10.0, 'len': 5.0, 'src': 'r1', 'src_in': 20.0, 'src_out': 25.0},      # no cut between these two
    {'kind': 'W', 'at': 15.0, 'len': 3.0, 'speed': 6.0, 'pic_src': 'r1', 'pic_in': 30.0, 'pic_out': 48.0},   # a sped wait: no sound
    {'kind': 'S', 'at': 18.0, 'len': 8.0, 'src': 'r1', 'src_in': 40.0, 'src_out': 48.0},
    {'kind': 'S', 'at': 26.0, 'len': 4.0, 'src': 'r2', 'src_in': 5.0, 'src_out': 9.0},
]


class RoughToSource(unittest.TestCase):
    def test_runs_merge_where_the_source_goes_on(self):
        runs = faces.src_runs(EDL_ITEMS, 2.0, 24.0)
        self.assertEqual([(r['src'], r['at'], r['end'], r['s0'], r['s1']) for r in runs],
                         [('r1', 2.0, 15.0, 12.0, 25.0), ('r1', 18.0, 24.0, 40.0, 46.0)])

    def test_waits_and_other_sources(self):
        runs = faces.src_runs(EDL_ITEMS, 14.0, 28.0)
        self.assertEqual([(r['src'], r['s0'], r['s1']) for r in runs], [('r1', 24.0, 25.0), ('r1', 40.0, 48.0), ('r2', 5.0, 7.0)])
        self.assertEqual(faces.src_runs(EDL_ITEMS, 15.2, 17.8), [])

    def test_a_stretch_inside_one_item(self):
        r = faces.src_runs(EDL_ITEMS, 3.0, 4.5)[0]
        self.assertEqual((r['s0'], r['s1']), (13.0, 14.5))


def put(path, doc):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(doc, f)


class PunchOverTheCut(unittest.TestCase):
    """A workshop made here: faces on the left in source 10-25, on the right in 40-48; punch and reframe follow the cut."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix='test_faces_')
        v = os.path.join(cls.tmp, 'ws', 'video')
        os.makedirs(os.path.join(v, 'out', 'work'))
        os.makedirs(os.path.join(v, 'footage'))
        edl = {'version': 2, 'fps': 60, 'width': 1920, 'height': 1080, 'total': 26.0, 'sources': {'r1': {'file': 'footage/cam.mp4'}}, 'items': EDL_ITEMS[:4]}
        put(os.path.join(v, 'out', 'edl.json'), edl)
        put(os.path.join(v, 'out', 'rough.json'), {'fps': 60, 'width': 1920, 'height': 1080, 'duration': 26.0})
        s = []
        for i in range(0, 200):
            t = i * 0.25
            x = 500 if t < 30 else 1300
            s.append(samp(t, (x, 300, x + 220, 590)))
        put(os.path.join(v, 'out', 'work', 'faces-r1.json'), {'size': [1920, 1080], 'samples': faces.smooth(s)})
        cls.cut = Cut(v)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_punch_follows_the_face_through_the_edl(self):
        left = faces.punch(2.0, 8.0, 1.2, 'r1', self.cut)
        right = faces.punch(19.0, 24.0, 1.2, 'r1', self.cut)
        self.assertLessEqual(left['x'], 500 - 0.1 * 220)                                    # the crop starts left of the face
        self.assertGreaterEqual(left['x'] + 1920 / 1.2, 720 + 22)                          # and reaches past it
        self.assertLessEqual(right['x'], 1300 - 22)
        self.assertGreater(right['x'], left['x'] + 300)                                     # moved with the face
        self.assertTrue(left['fits'] and right['fits'])
        self.assertEqual(left['zoom'], 1.2)

    def test_punch_across_the_cut_holds_both(self):
        b = faces.punch(5.0, 22.0, 2.0, 'r1', self.cut)                                    # the face is at x 500 and at x 1300 in this stretch
        self.assertLess(b['zoom'], 2.0)                                                    # so the crop is lowered until it holds both
        self.assertLessEqual(b['x'], 500)
        self.assertGreaterEqual(b['x'] + 1920 / b['zoom'], 1520)

    def test_punch_asks_for_the_placement_when_sizes_differ(self):
        with self.assertRaises(ValueError):
            faces.punch(2.0, 8.0, 1.1, 'r1', self.cut, frame=(1080, 760))
        b = faces.punch(2.0, 8.0, 1.1, 'r1', self.cut, place=(1.0, 0, -100), frame=(1080, 760))
        self.assertLessEqual(b['x'] + 1080 / b['zoom'], 1080.5)

    def test_punch_with_no_face_raises(self):
        with self.assertRaises(ValueError):
            faces.punch(100, 120, 1.1, 'r1', self.cut)             # past the end of the cut: nothing under it

    def test_reframe_changes_only_on_cuts(self):
        out = faces.reframe(0.0, 26.0, 9 / 16, 'r1', self.cut)
        self.assertEqual(len(out), 2)                                                      # the two unbroken runs of the source: 10-25 and 40-48
        self.assertEqual((out[0]['at'], out[0]['end']), (0.0, 15.0))
        self.assertEqual((out[1]['at'], out[1]['end']), (18.0, 26.0))
        for r in out:
            self.assertEqual((r['w'], r['h']), (608, 1080))
            self.assertTrue(r['fits'])
        self.assertLess(out[0]['x'], out[1]['x'])
        self.assertEqual(out[0]['crop'], f"crop=608:1080:{out[0]['x']}:{out[0]['y']}")


# ---------------------------------------------------------------------------------------------------------------- focus

def frames_with_pane(n=20, W=192, H=108, rect=(100, 20, 180, 90), webcam=None, seed=1):
    """n gray frames: the pane `rect` (x0, y0, x1, y1) re-drawn every frame (text scrolling), the rest still."""
    rng = np.random.RandomState(seed)
    f = np.full((n, H, W), 60, np.uint8)
    x0, y0, x1, y1 = rect
    for i in range(n):
        f[i, y0:y1, x0:x1] = rng.randint(0, 255, (y1 - y0, x1 - x0))
        if webcam:
            a, b, c, d = webcam
            f[i, b:d, a:c] = rng.randint(0, 255, (d - b, c - a))
    return f


class Focus(unittest.TestCase):
    W, H = 1920, 1080

    def counts(self, **kw):
        return focus.change_counts(frames_with_pane(**kw))

    def test_change_counts(self):
        c, pairs = self.counts()
        self.assertEqual(pairs, 19)
        self.assertGreater(c[50, 140], 15)
        self.assertEqual(c[5, 5], 0)

    def test_box_of_the_pane(self):
        c, pairs = self.counts()
        cells = focus.box_of_cells(focus.dense_cells(c, pairs))
        self.assertLessEqual(abs(cells[0] - 100), 1)
        self.assertLessEqual(abs(cells[1] - 20), 1)
        self.assertLessEqual(abs(cells[2] - 180), 1)
        self.assertLessEqual(abs(cells[3] - 90), 1)

    def test_a_pointer_trail_and_a_lone_cell_are_not_a_pane(self):
        c = np.zeros((108, 192), np.int32)
        c[40, 10:180] = 5                                                                   # a thin streak
        c[80, 20] = 9                                                                       # a clock digit
        self.assertIsNone(focus.box_of_cells(focus.dense_cells(c, 19)))
        c[30:70, 60:100] = 4                                                                # and a real pane next to them
        cells = focus.box_of_cells(focus.dense_cells(c, 19))
        self.assertEqual((cells[0], cells[2]), (60, 100))
        self.assertLessEqual(cells[1], 31)

    def test_the_webcam_is_left_out(self):
        c, pairs = self.counts(webcam=(0, 70, 45, 108))
        with_cam = focus.analyse(c, pairs, self.W, self.H)
        without = focus.analyse(c, pairs, self.W, self.H, masks=[(0, 700, 450, 380)])
        self.assertLess(with_cam['box'][0], 400)                                            # the box stretches over to the camera
        self.assertGreater(without['box'][0], 900)
        self.assertFalse(without.get('mask'))                                               # the zoom does not reach the camera
        ign = focus.analyse(c, pairs, self.W, self.H, ignore=[(0, 700, 450, 380)])
        self.assertEqual(ign['box'], without['box'])
        self.assertNotIn('mask', ign)

    def test_aspect_snap(self):
        crop = focus.snap_aspect([1000, 100, 1400, 900], 16 / 9, 1920, 1080)                # a tall pane
        self.assertAlmostEqual(crop[2] / crop[3], 16 / 9, delta=0.01)
        self.assertLessEqual(crop[1], 100)
        self.assertGreaterEqual(crop[1] + crop[3], 900)
        self.assertGreaterEqual(crop[0], 0)
        self.assertLessEqual(crop[0] + crop[2], 1920 + 1e-6)
        wide = focus.snap_aspect([100, 100, 1500, 300], 16 / 9, 1920, 1080)                 # a wide strip: height grows
        self.assertAlmostEqual(wide[2], 1400)
        self.assertAlmostEqual(wide[3], 1400 * 9 / 16)
        self.assertEqual(focus.snap_aspect([0, 0, 1920, 1000], 16 / 9, 1920, 1080), (0.0, 0.0, 1920.0, 1080.0))
        x, y, w, h = focus.snap_aspect([5, 5, 105, 105], 1080 / 760, 1920, 1080)            # the output's own shape
        self.assertAlmostEqual(w / h, 1080 / 760, delta=0.01)
        self.assertGreaterEqual(x, 0)

    def test_zoom_limit(self):
        crop = focus.snap_aspect([900, 500, 1000, 560], 16 / 9, 1920, 1080)
        x, y, w, h, held = focus.limit_zoom(crop, [900, 500, 1000, 560], 1920, 1080, 2.0)
        self.assertFalse(held)
        self.assertAlmostEqual(1920 / w, 2.0)
        self.assertLessEqual(abs((x + w / 2) - 950), 1)
        x, y, w, h, held = focus.limit_zoom((100, 100, 1200, 675), [100, 100, 1300, 775], 1920, 1080, 2.0)
        self.assertTrue(held)

    def test_analyse_gives_an_E_zoom_box(self):
        c, pairs = self.counts()
        a = focus.analyse(c, pairs, self.W, self.H)
        self.assertGreater(a['zoom'], 1.05)
        self.assertLessEqual(a['zoom'], 2.0)
        w, h = self.W / a['zoom'], self.H / a['zoom']
        self.assertGreaterEqual(a['x'], 0)
        self.assertLessEqual(a['x'] + w, self.W + 0.5)
        self.assertLessEqual(a['y'] + h, self.H + 0.5)
        b = a['box']
        self.assertLessEqual(a['x'], b[0])                                                  # the pane is inside the crop, with its padding
        self.assertGreaterEqual(a['x'] + w, b[2] - 1)
        self.assertGreaterEqual(a['y'] + h, b[3] - 1)

    def test_nothing_changes_or_everything_does(self):
        still = np.full((20, 108, 192), 80, np.uint8)
        c, p = focus.change_counts(still)
        a = focus.analyse(c, p, self.W, self.H)
        self.assertEqual((a['zoom'], a['x'], a['y']), (1.0, 0.0, 0.0))
        self.assertIn('nothing', a['note'])
        rng = np.random.RandomState(3)
        busy = rng.randint(0, 255, (20, 108, 192)).astype(np.uint8)
        a = focus.analyse(*focus.change_counts(busy), self.W, self.H)
        self.assertLess(a['zoom'], 1.1)
        self.assertIn('most of the screen', a['note'])

    def test_a_mask_the_zoom_takes_in_is_handed_back(self):
        c, pairs = self.counts(rect=(90, 30, 150, 80))
        a = focus.analyse(c, pairs, self.W, self.H, masks=[(1000, 700, 300, 150)])
        self.assertEqual((a['mask']['x'], a['mask']['y']), (1000, 700))
        self.assertEqual(a['mask']['color'], '#000000')
        a2 = focus.analyse(c, pairs, self.W, self.H, masks=[(0, 900, 300, 180)])
        self.assertNotIn('mask', a2)

    def test_place_into_a_band(self):
        c, pairs = self.counts()
        a = focus.analyse(c, pairs, self.W, self.H, frame=(1080, 760), place=(0.5, 70, 53))
        w, h = 1080 / a['zoom'], 760 / a['zoom']
        self.assertLessEqual(a['x'] + w, 1080.5)
        self.assertLessEqual(a['y'] + h, 760.5)
        self.assertAlmostEqual(w / h, 1080 / 760, delta=0.02)

    def test_cam_rect_guess(self):
        r = focus.cam_rect([181, 831, 278, 963], 1920, 1080)
        self.assertEqual((r[0], r[1]), (0, 1080 - r[3]))                                    # anchored bottom-left
        self.assertGreater(r[2], 470)
        self.assertLess(r[2], 600)
        r = focus.cam_rect([1600, 100, 1700, 240], 1920, 1080)
        self.assertGreater(r[0], 1200)
        self.assertEqual(r[1], 0)


@unittest.skipUnless(shutil.which('ffmpeg'), 'no ffmpeg')
class FocusOnAClip(unittest.TestCase):
    """The ffmpeg path: a 1280x720 clip where only a pane at the right changes."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix='test_focus_')
        cls.clip = os.path.join(cls.tmp, 'pane.mp4')
        W, H, n = 1280, 720, 60
        rng = np.random.RandomState(5)
        p = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', f'{W}x{H}', '-r', '10', '-i', '-',
                              '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', cls.clip], stdin=subprocess.PIPE)
        base = np.full((H, W), 70, np.uint8)
        for i in range(n):
            f = base.copy()
            f[100:620, 800:1200] = rng.randint(0, 255, (520, 400))
            p.stdin.write(f.tobytes())
        p.stdin.close()
        p.wait()

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_focus_finds_the_pane(self):
        r = focus.focus(self.clip, 0.5, 5.5, fps=5)
        b = r['box']
        self.assertLessEqual(abs(b[0] - 800), 15)
        self.assertLessEqual(abs(b[1] - 100), 15)
        self.assertLessEqual(abs(b[2] - 1200), 15)
        self.assertLessEqual(abs(b[3] - 620), 15)
        self.assertGreater(r['zoom'], 1.1)
        self.assertEqual(r['pairs'], 24)

    def test_read_frames_times(self):
        got = list(faces.read_frames(self.clip, 4, None, 320, 1.0, 3.0))
        self.assertEqual(len(got), 8)
        self.assertAlmostEqual(got[0][0], 1.0)
        self.assertAlmostEqual(got[-1][0], 2.75)
        self.assertEqual(got[0][1].shape, (180, 320, 3))
        self.assertEqual(got[0][2][4], 4.0)                                                 # source pixels per detector pixel

    def test_region_crop(self):
        got = list(faces.read_frames(self.clip, 4, (800, 100, 400, 520), 200, 0, 1))
        self.assertEqual(got[0][1].shape[:2], (260, 200))
        self.assertEqual(got[0][2][2:4], (800, 100))


class Region(unittest.TestCase):
    def test_region_around_a_face(self):
        r = faces.region_around([181, 831, 278, 963], 1920, 1080)
        self.assertTrue(r[0] <= 181 and r[0] + r[2] >= 278 and r[1] <= 831 and r[1] + r[3] >= 963)
        self.assertTrue(all(v % 2 == 0 for v in r))
        self.assertLessEqual(r[1] + r[3], 1080)
        self.assertIsNone(faces.region_around([400, 100, 1500, 1000], 1920, 1080))          # a full-frame camera: look everywhere


if __name__ == '__main__':
    unittest.main(verbosity=1)
