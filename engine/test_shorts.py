"""Tests of what the Shorts added to the pipeline:  python test_shorts.py   (and python test_pipeline.py for the rest; both must pass)
Word-mode captions, caption blocks from words, the SPLIT edit list helper, push and region zooms, the music bed."""
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import captions
import check_cut
import handover
import level
import compose
import edl as edlmod
import events as ev
import sfx
import shortcaps
import split_edl
import tmap

BS = chr(92)


def short_doc():
    return {'version': 1, 'format': 'short', 'fps': 60, 'width': 1080, 'height': 1920, 'duration': 25.0, 'events': [
        {'id': 'K1', 'kind': 'caption', 'at': 1.0, 'end': 3.0, 'words': [[1.1, 1.4, 'Hello'], [1.5, 1.9, 'big', 1], [2.0, 2.5, 'world']]},
        {'id': 'K2', 'kind': 'caption', 'at': 5.0, 'end': 6.5, 'y': 1300, 'words': [[5.1, 5.4, 'Lower'], [5.5, 6.0, 'now']]}]}


def pos(line):
    p = line.split(BS + 'pos(')[1].split(')')[0].split(',')
    return float(p[0]), float(p[1])


class ShortCaptionTests(unittest.TestCase):
    def test_word_mode_is_one_positioned_event_per_word(self):
        a = captions.build(short_doc())
        self.assertIn('PlayResX: 1080', a)
        self.assertEqual(a.count('Dialogue: 0,'), 2)                 # one box per block
        self.assertEqual(a.count('Dialogue: 2,'), 5)                 # one popping word each
        self.assertIn(BS + 't(0,120,' + BS + 'fscx100' + BS + 'fscy100)', a)   # the pop settles over 0.12 s
        self.assertIn(BS + 'fscx106', a)                             # a pop of 1.06 or less
        self.assertIn('Montserrat Black', a)

    def test_caption_may_set_its_own_y_and_stays_in_the_safe_zone(self):
        lines = [l for l in captions.build(short_doc()).splitlines() if l.startswith('Dialogue: 2,')]
        k2 = [l for l in lines if l.endswith('Lower') or l.endswith('now')]
        self.assertEqual({pos(l)[1] for l in k2}, {1300.0})
        for l in lines:
            self.assertTrue(60 <= pos(l)[0] <= 900, l)

    def test_long_style_unchanged(self):
        d = short_doc()
        d['format'] = 'long'; d['width'] = 1920; d['height'] = 1080
        a = captions.build(d)
        self.assertIn(captions.with_font(captions.DEFAULTS['long'])['font'], a)   # Arial Black, or the bundled font where it is missing
        self.assertEqual(a.count('Dialogue: 2,'), 0)

    def test_two_rows_when_too_wide(self):
        d = short_doc()
        d['events'][0]['words'] = [[1.0 + i * 0.3, 1.2 + i * 0.3, w] for i, w in enumerate(['Extraordinarily', 'complicated', 'arrangement', 'overflowing'])]
        lines = [l for l in captions.build(d).splitlines() if l.startswith('Dialogue: 2,') and any(l.endswith(w) for w in ('Extraordinarily', 'complicated', 'arrangement', 'overflowing'))]
        self.assertEqual(len({pos(l)[1] for l in lines}), 2)

    @unittest.skipUnless(subprocess.run(['ffmpeg', '-version'], capture_output=True).returncode == 0, 'no ffmpeg')
    def test_rendered_text_is_the_size_the_style_says(self):
        # libass sizes by the Windows line metrics: a frame is rendered and the width of the text measured against the font's own width at that size
        import numpy as np
        from PIL import Image
        doc = {'format': 'short', 'width': 1080, 'height': 1920, 'captions': {'style': {'box_alpha': 0, 'dim': 0, 'pop': 1.0}},
               'events': [{'id': 'K', 'kind': 'caption', 'at': 0, 'end': 2, 'words': [[0, 1, 'HHHHHHHH']]}]}
        with tempfile.TemporaryDirectory() as td:
            os.makedirs(os.path.join(td, 'fonts'))
            import shutil
            shutil.copy2(captions.font_path(captions.DEFAULTS['short']), os.path.join(td, 'fonts', 'Montserrat-Black.ttf'))
            open(os.path.join(td, 'c.ass'), 'w', encoding='utf-8-sig').write(captions.build(doc))
            r = subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=1080x1920:d=1:r=10', '-vf', 'ass=c.ass:fontsdir=fonts', '-frames:v', '1', 'o.png'],
                               cwd=td, capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            a = np.array(Image.open(os.path.join(td, 'o.png')).convert('L'))
            xs = np.where(a > 128)[1]
            width = xs.max() - xs.min() + 1
            expect = captions.Measure(captions.DEFAULTS['short'], 64).width('HHHHHHHH')
            self.assertLess(abs(width - expect) / expect, 0.05, (width, expect))

    def test_font_files_are_found(self):
        self.assertTrue(os.path.isfile(captions.font_path(captions.DEFAULTS['short'])))
        self.assertTrue(os.path.isfile(captions.font_path(captions.with_font(captions.DEFAULTS['long']))))

    def test_a_missing_font_falls_back_to_the_bundled_one(self):
        st = captions.with_font({**captions.DEFAULTS['long'], 'font': 'No Such Font', 'file': 'no-such-font.ttf'})
        self.assertEqual(st['file'], 'Montserrat-Black.ttf')
        self.assertTrue(os.path.isfile(captions.font_path(st)))
        self.assertEqual(captions.with_font(captions.DEFAULTS['short']), captions.DEFAULTS['short'])


class ShortCapsTests(unittest.TestCase):
    W = [[0.0, 0.3, 'This', 'a', 0], [0.3, 0.6, 'is', 'a', 0], [0.6, 1.0, 'cloud', 'a', 0], [1.0, 1.4, 'code.', 'a', 0], [1.5, 1.8, 'Next', 'a', 0],
         [1.8, 2.2, 'one', 'a', 0], [4.0, 4.3, 'skipped', 'a', 0], [6.0, 6.3, 'later', 'a', 0]]

    def test_blocks_break_at_sentence_pause_and_skip_and_fix(self):
        b = shortcaps.blocks(self.W, fix={'cloud': 'Claude'}, accent={'next'}, skip=[(3.9, 4.5)])
        self.assertEqual([' '.join(x[2] for x in c) for c in b], ['This is Claude code.', 'Next one', 'later'])
        self.assertEqual(b[1][0][3], 1)

    def test_breaks_and_a_change_of_part(self):
        w = [[0.0, 0.2, 'a', 'p1'], [0.2, 0.4, 'blow', 'p1'], [0.4, 0.6, 'it', 'p1'], [0.6, 0.8, 'went', 'p2'], [0.8, 1.0, 'on', 'p2']]
        self.assertEqual([len(c) for c in shortcaps.blocks(w, breaks={'blow'})], [2, 3])      # a break after 'blow'; the lone 'it' (0.2 s) joins the next block
        self.assertEqual([len(c) for c in shortcaps.blocks(w)], [3, 2])

    def test_sentence_case(self):
        w = [[0.0, 0.2, 'this', 'p'], [0.2, 0.4, 'is', 'p'], [0.4, 0.6, 'blow', 'p'], [0.6, 0.8, 'then', 'p'], [0.8, 1.0, 'i', 'p'], [1.0, 1.2, 'asked', 'p']]
        b = shortcaps.blocks(w, breaks={'blow'}, sentence_case=True)
        self.assertEqual([' '.join(x[2] for x in c) for c in b], ['This is blow.', 'Then I asked'])

    def test_find_anchors_on_a_spoken_word(self):
        self.assertEqual(shortcaps.find(self.W, 'next'), [1.5, 1.8])
        with self.assertRaises(ValueError):
            shortcaps.find(self.W, 'next', after=2.0)

    def test_block_limits(self):
        w = [[i * 0.3, i * 0.3 + 0.2, 'wordy'] for i in range(12)]
        for c in shortcaps.blocks(w):
            self.assertLessEqual(len(c), 5)
            self.assertLessEqual(len(' '.join(x[2] for x in c)), 26)

    def test_add_captions_makes_valid_events(self):
        E = ev.Events('short', 60, 1080, 1920, 10.0)
        shortcaps.add_captions(E, self.W)
        self.assertEqual(ev.validate(E.doc), [])
        self.assertEqual(E.doc['events'][-1]['end'], 10.0)


class WordMapTests(unittest.TestCase):
    def test_a_sliver_of_the_next_word_is_not_a_word(self):
        e = edlmod.new(60, 1080, 1920, {'p': {'file': 'x.mp4'}})
        edlmod.add(e, 'S', 1.0, beat=1, src='p', src_in=2.0, src_out=3.0)
        T = tmap.TMap(e)
        w = {'p': [(2.1, 2.5, 'whole'), (2.9, 3.4, 'cutoff'), (1.8, 2.3, 'half')]}
        names = lambda out: [x[2] for x in out]
        self.assertIn('cutoff', names(T.map_words(w)))                       # the old edge rule keeps it (starts before the end - 0.05)
        self.assertEqual(names(T.map_words(w, visible=0.5)), ['half', 'whole'])


class SplitEdlTests(unittest.TestCase):
    def test_build_back_to_back_with_sources(self):
        src = {'p3': {'file': 'footage/p3.mp4', 'words': 'work/p3.tsv'}}
        e = split_edl.build(60, 1080, 1920, src, [dict(kind='S', beat=1, seg='a', len=2.0, src='p3', src_in=1.0, src_out=3.0), dict(kind='H', beat=2, seg='b', len=1.5)])
        self.assertEqual(e['total'], 3.5)
        self.assertEqual(edlmod.validate(e), [])
        self.assertEqual(tmap.TMap(e).m('p3', 2.0), 1.0)

    def test_parse_item(self):
        it = split_edl.parse_item('S 2 s_b2.mp4 p3 2.80 5.44 crop=540:580:400:172')
        self.assertEqual((it['kind'], it['beat'], it['seg'], it['src'], it['src_in'], it['src_out'], it['crop']), ('S', 2, 's_b2.mp4', 'p3', 2.8, 5.44, '540:580:400:172'))
        self.assertNotIn('src', split_edl.parse_item('H 7 hold.mp4'))


class PushZoomTests(unittest.TestCase):
    def doc(self):
        d = short_doc()
        d['events'] = [{'id': 'P1', 'kind': 'zoom', 'at': 0.2, 'end': 1.0, 'zoom': 1.0, 'to': 1.08, 'ox': 540, 'oy': 600},
                       {'id': 'R1', 'kind': 'zoom', 'at': 1.2, 'end': 1.9, 'zoom': 1.5, 'x': 100, 'y': 50, 'region': [0, 0, 1080, 1160]},
                       {'id': 'F1', 'kind': 'zoom', 'at': 0.0, 'end': 20.0, 'zoom': 2.0, 'render': False, 'what': 'baked'}]
        return d

    def test_valid_and_region_bounds(self):
        d = self.doc()
        self.assertEqual(ev.validate(d), [])
        d['events'][1]['region'] = [0, 0, 1080, 3000]
        self.assertIn('region', ' '.join(ev.validate(d)))
        d = self.doc(); d['events'][1]['x'] = 600
        self.assertIn('falls outside', ' '.join(ev.validate(d)))

    def test_timeline_reports_the_bigger_zoom(self):
        t = ev.timeline(self.doc())
        self.assertEqual(sorted(e['zoom'] for e in t['events']), [1.08, 1.5, 2.0])

    def test_builder_helpers(self):
        E = ev.Events('short', 60, 1080, 1920, 25.0)
        E.push('P1', 1, 3, zoom=1.0, to=1.06, ox=540, oy=500)
        E.framing('F1', 0, 5, 2.0, 'SPLIT: top box and cam band, both 2.0x')
        E.bed(vol=0.08)
        self.assertEqual(E.doc['events'][1].get('render'), False)
        self.assertEqual(ev.validate(E.doc), [])
        self.assertEqual(E.doc['bed']['end'], 25.0)

    @unittest.skipUnless(subprocess.run(['ffmpeg', '-version'], capture_output=True).returncode == 0, 'no ffmpeg')
    def test_push_and_region_graph_run(self):
        d = self.doc()
        with tempfile.TemporaryDirectory() as td:
            out = os.path.join(td, 'o.mp4')
            g = ';'.join(compose.zoom_graph(d, compose.video_zooms(d), '[o]'))
            r = subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=1080x1920:r=60:d=2.2', '-filter_complex', g, '-map', '[o]', '-frames:v', '120',
                                '-c:v', 'libx264', '-preset', 'ultrafast', out], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertGreater(os.path.getsize(out), 1000)


class BedTests(unittest.TestCase):
    @unittest.skipUnless(subprocess.run(['ffmpeg', '-version'], capture_output=True).returncode == 0, 'no ffmpeg')
    def test_bed_envelope_and_fades(self):
        class FakeCut:
            pass
        with tempfile.TemporaryDirectory() as td:
            os.makedirs(os.path.join(td, 'assets')); wav = os.path.join(td, 'assets', 'tone.wav')
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=220:d=1', '-ar', '48000', '-ac', '2', wav], check=True)
            c = FakeCut(); c.video = td; c.work = td
            d = {'duration': 4.0, 'events': [], 'bed': {'file': 'tone', 'start': 0.0, 'end': 4.0, 'fade_in': 0.5, 'fade_out': 0.5, 'env': [[0, 0.5], [2, 0.5], [3, 0.1]]}}
            buf = sfx.bed_track(c, d, 4 * sfx.SR)
            self.assertEqual(buf.shape, (4 * sfx.SR, 2))
            self.assertLess(abs(buf[:100]).max(), 0.05)                      # fading in from silence
            self.assertGreater(abs(buf[sfx.SR:int(1.5 * sfx.SR)]).max(), 0.03)  # the full level, looped past the 1 s file
            self.assertLess(abs(buf[int(3.2 * sfx.SR):int(3.4 * sfx.SR)]).max(), 0.02)   # the lowered level
            self.assertIsNone(sfx.bed_track(c, {'duration': 1, 'events': []}, 10))


FFMPEG = subprocess.run(['ffmpeg', '-version'], capture_output=True).returncode == 0


class CheckCutLayerTests(unittest.TestCase):
    @unittest.skipUnless(FFMPEG, 'no ffmpeg')
    def test_a_bed_under_a_quiet_voice_is_taken_off_before_comparing(self):
        import numpy as np
        with tempfile.TemporaryDirectory() as td:
            rng = np.random.default_rng(1)
            n = 48000 * 4
            voice = (rng.standard_normal((n, 2)) * 0.01).astype(np.float32)                 # a quiet voice
            bed = (np.sin(np.arange(n) / 20.0)[:, None] * 0.2 * np.ones((1, 2))).astype(np.float32)   # a bed 20 dB above it
            def wav(name, x):
                raw = os.path.join(td, name + '.f32'); x.tofile(raw)
                out = os.path.join(td, name + '.wav')
                subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', '48000', '-ac', '2', '-i', raw, out], check=True)
                return out
            rough, final, shifted = wav('rough', voice), wav('final', voice + bed), wav('shifted', np.roll(voice, 9000, axis=0) + bed)
            layer = os.path.join(td, 'sfx.f32'); bed.tofile(layer)
            self.assertTrue(check_cut.voice_check(rough, final, [], layer=layer)['bad_seconds'] == [])
            self.assertNotEqual(check_cut.voice_check(rough, shifted, [], layer=layer)['bad_seconds'] + [abs(check_cut.voice_check(rough, shifted, [], layer=layer)['lag_ms'])], [0.0])


class FrameTagTests(unittest.TestCase):
    @unittest.skipUnless(FFMPEG, 'no ffmpeg')
    def test_mixed_tags_are_found_and_level_py_makes_them_uniform(self):
        with tempfile.TemporaryDirectory() as td:
            a, b, cat, out = (os.path.join(td, x) for x in ('a.mp4', 'b.mp4', 'cat.mp4', 'rough.mp4'))
            enc = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-t', '1']
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=320x240:r=30', '-f', 'lavfi', '-i', 'sine=f=300:r=48000', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', *enc, a], check=True)
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30', '-f', 'lavfi', '-i', 'sine=f=300:r=48000', '-colorspace', 'smpte170m', '-color_primaries', 'smpte170m', '-color_trc', 'smpte170m', *enc, b], check=True)
            lst = os.path.join(td, 'l.txt'); open(lst, 'w').write("file '" + a + "'" + chr(10) + "file '" + b + "'" + chr(10))
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', cat], check=True)
            self.assertGreater(len(handover.frame_props(cat)), 1)
            level.level(cat, out)
            self.assertEqual(len(handover.frame_props(out)), 1)


if __name__ == '__main__':
    unittest.main(verbosity=1)
