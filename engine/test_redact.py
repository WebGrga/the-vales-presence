"""Tests of the blur boxes and your edits on top of events.json:  python test_redact.py   (ffmpeg for the pixel test, no GPU, no recordings)"""
import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compose
import compose_chunks
import events as ev
import redact
import user_edits

HAVE_FFMPEG = subprocess.run(['ffmpeg', '-version'], capture_output=True).returncode == 0


def doc(*extra):
    return {'version': 1, 'format': 'long', 'fps': 60, 'width': 1920, 'height': 1080, 'duration': 100.0, 'sfx': [],
            'events': [{'id': 'L1', 'kind': 'text', 'at': 2.0, 'end': 4.0, 'comp': 'Label', 'props': {'text': 'HELLO', 'side': 'right'}},
                       {'id': 'Z1', 'kind': 'zoom', 'at': 20.0, 'end': 30.0, 'zoom': 1.5, 'x': 576, 'y': 100}, *extra]}


BLUR = {'id': 'B1', 'kind': 'blur', 'at': 10.0, 'end': 12.0, 'box': [101, 51, 301, 81], 'mode': 'blur'}


class BoxTests(unittest.TestCase):
    def test_even_and_clamped(self):
        self.assertEqual(redact.even_box([101, 51, 301, 81], 1920, 1080), [100, 50, 302, 82])
        self.assertEqual(redact.even_box([1800, 1000, 400, 400], 1920, 1080), [1800, 1000, 120, 80])
        self.assertEqual(redact.even_box([-50, -50, 100, 100], 1920, 1080), [0, 0, 50, 50])
        self.assertIsNone(redact.even_box([2000, 10, 50, 50], 1920, 1080))
        self.assertIsNone(redact.even_box(['a', 1, 2, 3], 1920, 1080))

    def test_validate(self):
        self.assertEqual(ev.validate(doc(BLUR)), [])
        bad = ev.validate(doc({**BLUR, 'box': [3000, 0, 10, 10]}))
        self.assertTrue(any('outside' in b for b in bad), bad)
        self.assertTrue(any('box' in b for b in ev.validate(doc({**BLUR, 'box': None}))))
        self.assertTrue(any('mode' in b for b in ev.validate(doc({**BLUR, 'mode': 'swirl'}))))
        self.assertEqual(ev.drawn_by(BLUR), 'ffmpeg')

    def test_not_in_the_pace_check_or_the_windows(self):
        d = doc(BLUR)
        self.assertEqual(ev.timeline(d), ev.timeline(doc()))
        self.assertEqual(len(compose.plan(d) if hasattr(compose, 'plan') else []), 1)

    def test_builder(self):
        E = ev.Events('long', 60, 1920, 1080, 100.0)
        e = E.blur('B2', 1.0, 2.0, [10.4, 20.6, 100, 50], mode='pixelate')
        self.assertEqual((e['kind'], e['box'], e['mode']), ('blur', [10, 21, 100, 50], 'pixelate'))

    def test_lines(self):
        self.assertEqual(redact.blur_lines([], '[0:v]', '[rb]', 1920, 1080), [])
        ls = redact.blur_lines([BLUR, {**BLUR, 'id': 'B2', 'mode': 'pixelate'}], '[c0]', '[rb]', 1920, 1080, t_off=15.0)
        self.assertEqual(len(ls), 6)
        self.assertTrue(ls[0].startswith('[c0]split'))
        self.assertIn('crop=302:82:100:50,boxblur', ls[1])
        self.assertIn("enable='between(t+15.000000,10.0,12.0)'", ls[2])
        self.assertIn('flags=neighbor', ls[4])
        self.assertTrue(ls[-1].endswith('[rb]'))
        fill = redact.blur_lines([{**BLUR, 'mode': 'fill', 'color': '#112233'}], '[0:v]', '[rb]', 1920, 1080)
        self.assertIn('color=0x112233', fill[1])

    def test_prepend(self):
        g = ['[c0]fps=60,split=1[s0]', '[s0]trim=start_frame=0[y0]']
        self.assertIs(redact.prepend([], g, '[rb]'), g)
        out = redact.prepend(redact.blur_lines([BLUR], '[c0]', '[rb]', 1920, 1080), g, '[rb]')
        self.assertEqual(out[3], '[rb]fps=60,split=1[s0]')

    def test_strength_limits(self):
        self.assertLessEqual(redact.strength_of({'mode': 'blur', 'strength': 500}, 40, 40), 9)
        self.assertGreaterEqual(redact.strength_of({'mode': 'pixelate'}, 300, 300), 16)


class ChunkKeyTests(unittest.TestCase):
    def test_a_chunk_without_a_box_keeps_its_key(self):
        a = compose_chunks.chunk_inputs(doc(), [], 0, 540, None, 'code')
        b = compose_chunks.chunk_inputs(doc(BLUR), [], 0, 540, None, 'code')
        self.assertEqual(a, b)
        self.assertNotIn('blurs', a)
        c = compose_chunks.chunk_inputs(doc(BLUR), [], 540, 1440, None, 'code')
        self.assertEqual([e['id'] for e in c['blurs']], ['B1'])

    def test_proof_windows_only_grow_with_a_box(self):
        self.assertEqual(compose.proof_windows(doc(), [], 'x'), compose.proof_windows(doc(), [], 'x'))
        with_box = compose.proof_windows(doc(BLUR), [], 'x')
        self.assertEqual(len(with_box), len(compose.proof_windows(doc(), [], 'x')) + 1)


class EditTests(unittest.TestCase):
    def test_nothing_to_apply(self):
        d = doc()
        self.assertIs(user_edits.merge(d)[0], d)
        self.assertIs(user_edits.apply_edits(d, {'edits': {}})[0], d)

    def test_edits(self):
        d = doc()
        out, missing = user_edits.apply_edits(d, {'version': 1, 'edits': {'L1': {'at': 2.5, 'end': 4.25, 'text': 'HI', 'props': {'text': 'HI'}}, 'X9': {'at': 1}}})
        self.assertEqual(missing, ['X9'])
        l1 = out['events'][0]
        self.assertEqual((l1['at'], l1['end'], l1['text'], l1['props']), (2.5, 4.25, 'HI', {'text': 'HI', 'side': 'right'}))
        self.assertEqual(d['events'][0]['props']['text'], 'HELLO')          # the original is not changed
        hid, _ = user_edits.apply_edits(d, {'edits': {'L1': {'hide': True}}})
        self.assertEqual([e['id'] for e in hid['events']], ['Z1'])

    def test_redactions(self):
        red = {'version': 1, 'boxes': [{'id': 'R1', 'at': 1, 'end': 3, 'x': 10, 'y': 10, 'w': 50, 'h': 20, 'note': 'a key'},
                                       {'id': 'R2', 'at': 3, 'end': 1, 'x': 0, 'y': 0, 'w': 5, 'h': 5}, {'at': 1}]}
        out, notes = user_edits.merge(doc(), None, red)
        e = [x for x in out['events'] if x['kind'] == 'blur']
        self.assertEqual([x['id'] for x in e], ['user-R1'])
        self.assertEqual(e[0]['box'], [10, 10, 50, 20])
        self.assertEqual(e[0]['what'], 'your box: a key')
        self.assertEqual(len(notes), 1)
        self.assertEqual(ev.validate(out), [])

    def test_load_from_files(self):
        with tempfile.TemporaryDirectory() as td:
            class C: pass
            cut = C(); cut.out = td; cut.events = os.path.join(td, 'events.json')
            with open(cut.events, 'w') as f:
                json.dump(doc(), f)
            self.assertEqual(user_edits.load(cut), doc())
            with open(os.path.join(td, 'redactions.json'), 'w') as f:
                json.dump({'boxes': [{'id': 'R1', 'at': 1, 'end': 2, 'x': 0, 'y': 0, 'w': 40, 'h': 40}]}, f)
            with open(os.path.join(td, 'event-edits.json'), 'w') as f:
                json.dump({'edits': {'L1': {'text': 'NEW'}}}, f)
            d = user_edits.load(cut)
            self.assertEqual(d['events'][0]['text'], 'NEW')
            self.assertEqual(d['events'][-1]['id'], 'user-R1')


@unittest.skipUnless(HAVE_FFMPEG, 'no ffmpeg')
class PixelTests(unittest.TestCase):
    def frames(self, graph, td):
        out = os.path.join(td, 'f.gray')
        script = os.path.join(td, 'g.filter')
        with open(script, 'w') as f:
            f.write(';\n'.join(graph) + '\n')
        r = subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=10:d=1.5', '-filter_complex_script', script, '-map', '[vout]',
                            '-pix_fmt', 'gray', '-f', 'rawvideo', out], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        return np.fromfile(out, dtype=np.uint8).reshape(-1, 180, 320).astype(int)

    def test_box_blurs_only_inside_and_only_while_on(self):
        e = {'id': 'B1', 'kind': 'blur', 'at': 0.5, 'end': 1.0, 'box': [100, 40, 120, 80], 'mode': 'pixelate', 'strength': 20}
        with tempfile.TemporaryDirectory() as td:
            plain = self.frames(['[0:v]format=yuv420p[vout]'], td)
            got = self.frames(redact.blur_lines([e], '[0:v]', '[rb]', 320, 180) + ['[rb]format=yuv420p[vout]'], td)
        self.assertEqual(plain.shape, got.shape)
        on, off = 7, 2                                   # frames at 0.7 s and 0.2 s
        inside = (slice(44, 116), slice(104, 216))
        self.assertGreater(np.abs(plain[on][inside] - got[on][inside]).mean(), 3)
        self.assertLess(np.abs(plain[off] - got[off]).max(), 2)
        outside = got[on].copy(); outside[40:120, 100:220] = plain[on][40:120, 100:220]
        self.assertLess(np.abs(plain[on] - outside).max(), 3)


if __name__ == '__main__':
    unittest.main()
