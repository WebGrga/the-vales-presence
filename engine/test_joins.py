"""Tests of join safety, the rough sound and the rough builder:  python test_joins.py   (synthetic audio: tones with gaps; one short ffmpeg run at the end, no recordings needed)"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import wave

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import edl as edlmod
import joins
import joins_logic as jl
import rough_audio as ra
import tmap

SR = 16000


def signal(seconds, tones, noise=0.0004, seed=1, sr=SR):
    """Room tone with tone bursts: tones = [(start, end)] -> a float array."""
    rng = np.random.RandomState(seed)
    n = int(seconds * sr)
    x = (rng.randn(n) * noise).astype(np.float32)
    for a, b in tones:
        i, j = int(a * sr), int(b * sr)
        t = np.arange(j - i) / sr
        env = np.minimum(1, np.minimum(t / 0.01, (t[-1] - t) / 0.01))      # 10 ms ramps: a word, not a click
        x[i:j] += (0.2 * env * np.sin(2 * np.pi * 300 * t)).astype(np.float32)
    return x


WORDS = [(1.0, 1.5, 'one'), (1.8, 2.3, 'two'), (3.5, 4.0, 'three'), (4.3, 4.8, 'four'), (6.0, 6.5, 'five'), (6.55, 7.0, 'six')]
TONES = [(a, b) for a, b, _ in WORDS]


def env():
    return jl.Env(jl.envelope(signal(9.0, TONES)))


class EnvelopeTests(unittest.TestCase):
    def test_levels(self):
        e = env()
        self.assertLess(e.floor, -60)
        self.assertGreater(e.loud, -30)
        self.assertTrue(e.sound(1.1, 1.2))
        self.assertFalse(e.sound(2.6, 3.2))
        self.assertAlmostEqual(e.sound_end_before(2.9, 0.0), 2.3, delta=0.03)
        self.assertAlmostEqual(e.sound_start_after(2.4, 9.0), 3.5, delta=0.02)

    def test_music_under_the_voice_is_not_sound(self):
        x = signal(9.0, TONES) + signal(9.0, [(0, 9.0)], noise=0, sr=SR) * 0.02       # a steady bed 20 dB under the words
        e = jl.Env(jl.envelope(x))
        self.assertFalse(e.sound(2.6, 3.2))
        self.assertTrue(e.sound(3.6, 3.9))


class EdgeTests(unittest.TestCase):
    def setUp(self):
        self.e = env()

    def st(self, t, side, limit):
        return jl.edge_state(self.e, WORDS, t, side, limit)

    def test_clipped_end_and_start(self):
        s = self.st(3.8, 'out', 3.0)                      # the piece ends in the middle of "three"
        self.assertEqual((s['state'], s['word']), ('clipped', 'three'))
        s = self.st(4.5, 'in', 5.5)                       # the piece starts in the middle of "four": that word is kept
        self.assertEqual((s['state'], s['word']), ('clipped', 'four'))

    def test_piece_of_a_removed_word(self):
        s = self.st(4.6, 'out', 3.0)                      # ends 0.3 s into "four": more than half of it is kept, so its tail is cut off
        self.assertEqual(s['state'], 'clipped')
        s = self.st(3.9, 'in', 5.0)                       # starts in the last fifth of "three": the word is removed, its tail is left in
        self.assertEqual((s['state'], s['word']), ('piece', 'three'))

    def test_room(self):
        self.assertEqual(self.st(2.6, 'out', 1.0)['issues'], [])                       # 0.3 s after "two"
        self.assertIn('room', self.st(2.4, 'out', 1.0)['issues'])                      # 0.1 s
        self.assertEqual(self.st(3.4, 'in', 5.0)['issues'], [])                        # 0.1 s before "three"
        self.assertIn('room', self.st(3.48, 'in', 5.0)['issues'])                      # 0.02 s
        self.assertAlmostEqual(self.st(2.6, 'out', 1.0)['room'], 0.3, delta=0.02)

    def test_speech_with_no_pause(self):
        s = self.st(6.52, 'out', 5.0)                     # between "five" and "six", 30 ms of gap
        self.assertIn(s['state'], ('speech', 'ok'))
        s2 = jl.edge_state(self.e, [], 3.8, 'out', 3.0)    # no words at all: a sound is a sound
        self.assertEqual(s2['state'], 'speech')


class SnapTests(unittest.TestCase):
    def setUp(self):
        self.e = env()

    def plan(self, t, side, limit, lo=0.0, hi=9.0, words=WORDS):
        return jl.plan_edge(self.e, words, t, side, limit, lo, hi)

    def test_fine_edge_stays(self):
        self.assertEqual(self.plan(2.6, 'out', 1.0)[0], None)

    def test_short_room_gets_room(self):
        t, _ = self.plan(2.36, 'out', 1.0)                # 0.06 s after "two" -> 0.2 s or more
        self.assertIsNotNone(t)
        self.assertGreaterEqual(t - 2.3, 0.2 - 0.02)
        self.assertLessEqual(abs(t - 2.36), jl.MAX_MOVE + 1e-6)
        t, _ = self.plan(3.49, 'in', 5.0)                 # 0.01 s before "three"
        self.assertLessEqual(t, 3.5 - 0.05 + 0.01)
        self.assertLessEqual(abs(t - 3.49), jl.MAX_MOVE + 1e-6)

    def test_clipped_tail_moves_to_the_quiet(self):
        t, why = self.plan(4.72, 'out', 4.3)              # 80 ms of "four" left: kept whole by moving 0.1 s on
        self.assertIsNotNone(t, why)
        self.assertGreater(t, 4.8)
        self.assertFalse(self.e.sound(t - 0.02, t + 0.02))

    def test_too_far_is_left(self):
        t, why = self.plan(3.72, 'out', 3.0)              # in the middle of "three": the quiet is 0.22 s before it and 0.3 s after
        self.assertIsNone(t)
        self.assertIn('by hand', why)

    def test_never_crosses_a_word(self):
        # edge between "five" and "six" with a short gap: it may not jump into "six" or back into "five"
        t, _ = jl.plan_edge(self.e, WORDS, 6.52, 'out', 5.0, 0.0, 9.0)
        if t is not None:
            self.assertTrue(6.5 - 0.02 <= t <= 6.55 + 0.02)

    def test_snap_edl(self):
        e = edlmod.new(30, 320, 180, {'a': {'file': 'a.mkv'}})
        edlmod.add(e, 'S', 1.4, src='a', src_in=0.9, src_out=2.3 + 0.1, pic_in=0.9)       # ends 0.1 s after "two"
        edlmod.add(e, 'S', 1.0, src='a', src_in=3.49, src_out=4.49, pic_in=3.49)          # starts 0.01 s before "three", ends in "three"? no: 4.49 is in the quiet
        edlmod.add(e, 'H', 1.0, pic_src='a', pic_in=1.0)
        a = joins.Audit.__new__(joins.Audit)
        a.cut, a.edl, a.items, a.env, a.words, a.nowords = None, e, e['items'], {'a': self.e}, {'a': WORDS}, set()
        new, moves, left = joins.snap_edl(a)
        self.assertEqual(edlmod.validate(new), [])
        self.assertTrue(moves)
        for it in new['items']:
            if 'src' in it:
                self.assertLess(abs(it['len'] * 30 - round(it['len'] * 30)), 0.05)           # whole frames (to the 3 decimals the edit list keeps)
        it0, it1 = new['items'][0], new['items'][1]
        self.assertGreaterEqual(it0['src_out'] - 2.3, 0.2 - 0.03)
        self.assertLessEqual(3.5 - it1['src_in'], 0.2)
        self.assertAlmostEqual(it1['pic_in'] - it1['src_in'], 0.0, places=3)                 # the picture moved with the sound
        self.assertEqual(new['items'][2]['len'], 1.0)
        self.assertAlmostEqual(new['total'], sum(i['len'] for i in new['items']), places=2)
        self.assertEqual(e['items'][0]['src_out'], 2.4)                                       # the input is untouched


class CheckTests(unittest.TestCase):
    def test_audit_findings(self):
        e = edlmod.new(30, 320, 180, {'a': {'file': 'a.mkv'}})
        edlmod.add(e, 'S', 1.5, src='a', src_in=0.8, src_out=2.3)                  # ok: 0.2 before, ends at "two"'s end + 0 -> room warn
        edlmod.add(e, 'S', 0.3, src='a', src_in=3.6, src_out=3.9)                  # starts and ends inside "three": clipped, and 0.3 s between cuts
        edlmod.add(e, 'S', 1.0, src='a', src_in=5.0, src_out=5.9)                  # silent piece: dead air with its neighbour? neighbour ends mid word
        a = joins.Audit.__new__(joins.Audit)
        a.cut, a.edl, a.items, a.env, a.words, a.nowords = None, e, e['items'], {'a': env()}, {'a': WORDS}, set()
        fin, states = joins.audit_joins(a)
        kinds = {(f['join'], f['kind']) for f in fin}
        self.assertIn((1, 'clipped'), kinds)
        self.assertIn((2, 'clipped'), kinds)
        self.assertIn((2, 'stutter'), kinds)
        self.assertTrue(any(f['kind'] == 'room' for f in fin))
        self.assertTrue(all(f['say'] for f in fin))
        for f in fin:
            self.assertEqual(f['severity'], 'error' if f['kind'] == 'clipped' else 'warn')

    def test_contiguous_pieces_are_not_a_cut(self):
        e = edlmod.new(30, 320, 180, {'a': {'file': 'a.mkv'}})
        edlmod.add(e, 'S', 1.0, src='a', src_in=1.0, src_out=2.0)
        edlmod.add(e, 'S', 1.0, src='a', src_in=2.0, src_out=3.0)
        a = joins.Audit.__new__(joins.Audit)
        a.cut, a.edl, a.items, a.env, a.words, a.nowords = None, e, e['items'], {'a': env()}, {'a': WORDS}, set()
        self.assertEqual(sorted((x['item'], x['side']) for x in a.edges()), [(0, 'in'), (1, 'out')])

    def test_dead_air(self):
        e = edlmod.new(30, 320, 180, {'a': {'file': 'a.mkv'}})
        edlmod.add(e, 'S', 2.0, src='a', src_in=0.3, src_out=2.3 + 0.7)        # 0.7 s of air at the end
        edlmod.add(e, 'S', 2.0, src='a', src_in=3.1, src_out=5.1)               # 0.4 s of air at the start
        a = joins.Audit.__new__(joins.Audit)
        a.cut, a.edl, a.items, a.env, a.words, a.nowords = None, e, e['items'], {'a': env()}, {'a': WORDS}, set()
        fin, _ = joins.audit_joins(a)
        self.assertIn('dead_air', {f['kind'] for f in fin})

    def test_locked_snap_refuses(self):
        for folder in ('.presence',):                    # the lock file
            with self.subTest(folder=folder):
                self.locked_snap_refuses(folder)

    def locked_snap_refuses(self, folder):
        d = tempfile.mkdtemp()
        try:
            os.makedirs(os.path.join(d, 'video', 'out'))
            os.makedirs(os.path.join(d, folder))
            e = edlmod.new(30, 320, 180, {'a': {'file': 'a.mkv'}})
            edlmod.add(e, 'S', 1.0, src='a', src_in=1.0, src_out=2.0)
            edlmod.write(os.path.join(d, 'video', 'out', 'edl.json'), e)
            with open(os.path.join(d, folder, 'locks.json'), 'w') as lf:
                lf.write('{"locks": {}}')
            f = os.path.join(d, 'video', 'out', 'edl.json')
            with open(f, 'rb') as fh:
                before = fh.read()
            self.assertEqual(joins.main(['snap', '--video', os.path.join(d, 'video')]), 2)
            with open(f, 'rb') as fh:
                self.assertEqual(fh.read(), before)
        finally:
            shutil.rmtree(d, ignore_errors=True)


class RoughSoundTests(unittest.TestCase):
    def items(self):
        return [{'len': 1.0, 'src': 'a', 'src_in': 1.0, 'src_out': 2.0}, {'len': 1.0, 'src': 'a', 'src_in': 5.0, 'src_out': 6.0},
                {'len': 0.5, 'kind': 'H'}, {'len': 1.0, 'src': 'a', 'src_in': 6.0, 'src_out': 7.0}, {'len': 1.0, 'src': 'a', 'src_in': 7.0, 'src_out': 8.0}]

    def src(self):
        t = np.arange(SR48 * 12) / SR48
        return (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)

    def fetch(self, key, t0, count):
        s = self.src()
        i = int(round(t0 * SR48))
        out = np.zeros((count, 2), dtype=np.float32)
        a = s[max(i, 0):i + count]
        out[max(0, -i):max(0, -i) + len(a), 0] = a
        out[max(0, -i):max(0, -i) + len(a), 1] = a
        return out

    def test_length_and_crossfade(self):
        pl = ra.plan(self.items(), 30)
        self.assertEqual(pl[-1]['start'] + pl[-1]['n'], int(4.5 * SR48))
        self.assertEqual((pl[0]['hr'], pl[1]['hl']), (576, 576))            # a real cut: crossfaded
        self.assertEqual((pl[1]['fout'], pl[3]['fin']), (480, 480))          # next to a hold: fades inside the piece
        self.assertEqual((pl[3]['hr'], pl[4]['hl'], pl[4]['t0']), (0, 0, 7.0))   # one stretch straight on: no fade at all
        out = ra.render(pl, self.fetch)
        self.assertEqual(len(out), int(4.5 * SR48))
        step = np.abs(np.diff(out[:, 0]))
        self.assertLess(float(step.max()), 0.3 * 2 * np.pi * 220 / SR48 * 1.6 + 0.001)      # no click anywhere: no jump bigger than the tone's own slope
        self.assertEqual(float(np.abs(out[SR48 * 2:SR48 * 2 + 10, 0]).max()) >= 0, True)
        self.assertEqual(float(np.abs(out[int(2.0 * SR48) + 100:int(2.5 * SR48) - 100]).max()), 0.0)     # the hold is silent
        straight = self.fetch('a', 6.0, 2 * SR48)
        np.testing.assert_allclose(out[int(2.5 * SR48) + 480:int(4.5 * SR48) - 480, 0], straight[480:2 * SR48 - 480, 0], atol=1e-6)    # the straight-on pair is the source itself

    def test_equal_power(self):
        rng = np.random.RandomState(3)
        noise = rng.randn(SR48 * 12).astype(np.float32) * 0.1

        def fetch(key, t0, count):
            i = int(round(t0 * SR48))
            a = noise[i:i + count]
            return np.stack([a, a], 1)
        items = [{'len': 1.0, 'src': 'a', 'src_in': 1.0, 'src_out': 2.0}, {'len': 1.0, 'src': 'a', 'src_in': 5.0, 'src_out': 6.0}]
        out = ra.render(ra.plan(items, 30), fetch)
        mid = out[SR48 - 576:SR48 + 576, 0]
        side = out[SR48 - 5000:SR48 - 3000, 0]
        self.assertAlmostEqual(float(np.sqrt((mid ** 2).mean())) / float(np.sqrt((side ** 2).mean())), 1.0, delta=0.15)       # no dip, no bump at the join


SR48 = 48000


class EdlFieldTests(unittest.TestCase):
    def test_cut_before_and_wait(self):
        e = edlmod.new(30, 320, 180, {'a': {'file': 'a.mkv'}})
        edlmod.add_piece(e, 'S', 'a', 1.0, 2.0, cut_before={'kind': 'filler', 'why': 'an um', 'flag': True, 'ask': 'keep the pause?'})
        edlmod.add_wait(e, 'a', 10.0, 40.0, 6.0, why='install')
        edlmod.add_piece(e, 'S', 'a', 50.0, 51.0, cut_before={'kind': 'wait', 'why': 'back to speed'})
        self.assertEqual(edlmod.validate(e), [])
        self.assertAlmostEqual(e['items'][1]['len'], 5.0, places=3)
        self.assertEqual(e['items'][1]['kind'], 'W')
        self.assertNotIn('src', e['items'][1])
        self.assertEqual(e['items'][1]['speed'], 6.0)
        self.assertEqual(e['total'], round(1.0 + 5.0 + 1.0, 3))

    def test_validation_of_the_new_fields(self):
        e = edlmod.new(30, 320, 180, {'a': {'file': 'a.mkv'}})
        edlmod.add_piece(e, 'S', 'a', 1.0, 2.0)
        e['items'][0]['cut_before'] = {'kind': 'nonsense'}
        e['items'].append({'kind': 'W', 'at': 1.0, 'len': 1.0, 'speed': 0, 'pic_src': 'zz'})
        e['total'] = 2.0
        bad = ' '.join(edlmod.validate(e))
        self.assertIn('cut_before', bad)
        self.assertIn('speed', bad)
        self.assertIn('zz', bad)
        old = edlmod.new(30, 320, 180, {'a': {'file': 'a.mkv'}})
        edlmod.add(old, 'S', 1.0, src='a', src_in=1.0, src_out=2.0, crop=False)       # an old list with the template's own fields stays valid
        self.assertEqual(edlmod.validate(old), [])


class RealRunTests(unittest.TestCase):
    """A small synthetic workshop: a 320x180 recording with tones for words, a second recording of another size, a hold, a wait and a blank card."""

    @classmethod
    def setUpClass(cls):
        cls.d = tempfile.mkdtemp()
        cls.video = os.path.join(cls.d, 'video')
        os.makedirs(os.path.join(cls.video, 'footage'))
        os.makedirs(os.path.join(cls.video, 'out', 'work'))
        x = signal(9.0, TONES, sr=SR48)
        wav = os.path.join(cls.video, 'footage', 'a.wav')
        with wave.open(wav, 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR48)
            w.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())
        for name, size in (('a', '320x180'), ('b', '160x90')):
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'testsrc2=s={size}:r=30:d=9', '-i', wav, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
                            '-c:a', 'aac', '-shortest', os.path.join(cls.video, 'footage', name + '.mkv')], check=True)
        with open(os.path.join(cls.video, 'footage', 'a.tsv'), 'w') as f:
            f.write(''.join(f'{a}\t{b}\t{w}\n' for a, b, w in WORDS))
        e = edlmod.new(30, 320, 180, {'a': {'file': 'footage/a.mkv', 'words': 'footage/a.tsv'}, 'b': {'file': 'footage/b.mkv'}})
        edlmod.add_piece(e, 'S', 'a', 0.7, 2.6, beat=1)                                   # "one" "two", clean edges
        edlmod.add_piece(e, 'S', 'a', 3.2, 4.7, beat=2, cut_before={'kind': 'pause', 'why': 'long pause'})
        edlmod.add(e, 'H', 0.5, beat=3, pic_src='a', pic_in=2.0)                          # a held still
        edlmod.add_wait(e, 'b', 1.0, 4.0, 3.0, beat=3)                                     # 3 s of the small recording at 3x: 1 s
        edlmod.add(e, 'S', 2.0, beat=4, src='a', src_in=5.2, src_out=7.2, pic_src='b', pic_in=5.2)       # sound from a, picture from b (scaled up)
        edlmod.add(e, 'E', 0.5, beat=5)                                                    # a blank card
        edlmod.write(os.path.join(cls.video, 'out', 'edl.json'), e)
        cls.edl = e

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.d, ignore_errors=True)

    def test_a_build_the_rough(self):
        r = subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'build_rough.py'), '--video', self.video, '--cpu', '--jobs', '2'], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        rough = os.path.join(self.video, 'out', 'rough.mp4')
        info = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,width,height,r_frame_rate:format=duration',
                                          '-of', 'json', rough], capture_output=True, text=True).stdout)
        st = info['streams'][0]
        self.assertEqual((st['width'], st['height'], st['r_frame_rate']), (320, 180, '30/1'))
        total = self.edl['total']
        self.assertLessEqual(abs(int(st['nb_read_frames']) - round(total * 30)), 1)
        self.assertLessEqual(abs(float(info['format']['duration']) - total), 2 / 30 + 0.03)
        T = tmap.load(os.path.join(self.video, 'out', 'edl.json'))                         # words still map as before
        self.assertAlmostEqual(T.m('a', 1.0), 0.3, places=2)
        self.assertAlmostEqual(T.m('a', 3.5), 1.9 + 0.3, places=2)
        # a second run costs no encoding
        r = subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'build_rough.py'), '--video', self.video, '--cpu', '--no-level'], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn('0 pieces encoded', r.stdout)

    def test_b_the_voice_is_the_source(self):
        # the rough's first piece is the recording's 0.7..2.6 s: correlate the two sounds (the level is normalised, the shape is not)
        rough = os.path.join(self.video, 'out', 'rough.mp4')
        a = np.frombuffer(subprocess.run(['ffmpeg', '-v', 'error', '-i', rough, '-t', '1.8', '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], capture_output=True).stdout, dtype=np.float32)
        b = np.frombuffer(subprocess.run(['ffmpeg', '-v', 'error', '-ss', '0.7', '-t', '1.8', '-i', os.path.join(self.video, 'footage', 'a.mkv'), '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'],
                                         capture_output=True).stdout, dtype=np.float32)
        n = min(len(a), len(b))
        a, b = a[:n], b[:n]
        size = 1 << int(np.ceil(np.log2(2 * n)))
        cc = np.fft.irfft(np.fft.rfft(a, size) * np.conj(np.fft.rfft(b, size)), size)
        c = float(max(cc[:800].max(), cc[-800:].max()) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-12))       # best match within 50 ms of lag (both go through AAC)
        self.assertGreater(c, 0.95)

    def test_c_check_and_snap_on_files(self):
        r = subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'joins.py'), 'check', '--video', self.video, '--json'], capture_output=True, text=True)
        self.assertEqual(r.returncode, 1, r.stdout)                                        # the second piece ends inside "four"
        self.assertIn('kept word "four" is cut off', r.stdout)
        with open(os.path.join(self.video, 'out', 'work', 'joins.json')) as fh:
            doc = json.load(fh)
        self.assertTrue(any(f['kind'] == 'clipped' for f in doc['findings']))
        r = subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'joins.py'), 'snap', '--video', self.video], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        e = edlmod.load(os.path.join(self.video, 'out', 'edl.json'))
        self.assertEqual(edlmod.validate(e), [])
        self.assertGreater(e['items'][1]['src_out'], 4.8)                                  # "four" is whole now
        self.assertTrue(os.path.isfile(os.path.join(self.video, 'out', 'work', 'edl.before-snap.json')))
        r = subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'joins.py'), 'check', '--video', self.video], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout)


if __name__ == '__main__':
    unittest.main(verbosity=1)
