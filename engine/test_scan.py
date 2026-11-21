"""Tests of scan.py and its parts scan_sound, scan_words, scan_picture, scan_md (synthetic sound and word lists, one tiny recording through ffmpeg):  python test_scan.py"""
import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
import wave

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scan
import scan_md
import scan_picture
import scan_sound
import scan_words

RNG = np.random.RandomState(7)


def read_json(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def read_text(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def synth(duration, speech=(), noise=3.0, silent=()):
    """int16 samples at 16 kHz: room noise everywhere, a 440 Hz tone (amplitude a) over each (s, e, a) of `speech`, digital zero over `silent`."""
    n = int(duration * scan_sound.SR)
    x = RNG.normal(0, noise, n)
    t = np.arange(n) / scan_sound.SR
    for s, e, a in speech:
        i, j = int(s * scan_sound.SR), int(e * scan_sound.SR)
        x[i:j] += a * np.sin(2 * np.pi * 440 * t[i:j])
    for s, e in silent:
        x[int(s * scan_sound.SR):int(e * scan_sound.SR)] = 0
    return np.clip(x, -32768, 32767).astype(np.int16)


def say(text, start, per=0.3, gap=0.0):
    """[(s, e, word)] of the words of `text`, `per` s each, from `start`."""
    out, t = [], start
    for w in text.split():
        out.append((round(t, 3), round(t + per * 0.9, 3), w))
        t += per + gap
    return out


class StretchTests(unittest.TestCase):
    def test_frame_db(self):
        x = synth(1.0, [(0, 1.0, 10000)], noise=0)
        db = scan_sound.frame_db(x)
        self.assertEqual(len(db), 50)
        self.assertAlmostEqual(float(db[10]), 20 * np.log10(10000 / np.sqrt(2) / 32768), delta=0.2)
        self.assertLess(float(scan_sound.frame_db(np.zeros(3200, dtype=np.int16))[0]), -90)

    def test_runs(self):
        m = np.array([0, 1, 1, 1, 0, 0, 1, 0, 1, 1, 0], dtype=bool)
        self.assertEqual(scan_sound.runs(m, 1.0), [[1, 4], [6, 7], [8, 10]])
        self.assertEqual(scan_sound.runs(m, 1.0, min_len=2), [[1, 4], [8, 10]])
        self.assertEqual(scan_sound.runs(m, 1.0, merge_gap=2), [[1, 10]])
        self.assertEqual(scan_sound.runs(m, 1.0, merge_gap=1), [[1, 4], [6, 10]])
        self.assertEqual(scan_sound.runs(np.zeros(0, dtype=bool)), [])
        self.assertEqual(scan_sound.runs(np.ones(5, dtype=bool), 1.0), [[0, 5]])

    def test_room_floor_ignores_digital_zero_and_talk(self):
        db = np.concatenate([np.full(500, -70.0), np.full(300, -100.0), np.full(400, -30.0)])
        talk = np.zeros(len(db), dtype=bool)
        talk[800:] = True
        self.assertAlmostEqual(scan_sound.room_floor(db, talk), -70.0, delta=0.1)
        self.assertLess(scan_sound.room_floor(np.full(500, -100.0), np.zeros(500, dtype=bool)), -90)       # nothing but zero: it says so
        self.assertAlmostEqual(scan_sound.room_floor(np.full(50, -40.0), np.ones(50, dtype=bool)), -40.0)   # all talk: the low end of everything

    def test_drop_blips(self):
        live = np.zeros(100, dtype=bool)
        live[10:13] = True                     # 60 ms click
        live[50:80] = True                     # 600 ms sound
        out = scan_sound.drop_blips(live)
        self.assertFalse(out[10:13].any())
        self.assertTrue(out[50:80].all())

    def test_smooth_db_hides_a_dip(self):
        db = np.full(50, -30.0)
        db[25] = -100.0
        self.assertGreater(float(scan_sound.smooth_db(db)[25]), -37)


class WordTests(unittest.TestCase):
    def test_filler_words(self):
        for w in ['um', 'Um,', 'uh', 'Uh.', 'umm', 'uhh', 'uhm', 'er', 'err', 'erm', 'ah', 'ahh', 'hmm', 'Hmm.', 'hm', 'mm', 'mmm', 'eh', 'ehm']:
            self.assertTrue(scan_words.is_filler(w), w)
        for w in ['a', 'ahead', 'umbrella', 'hum', 'her', 'error', 'ear', 'oh', 'ok', 'hey', 'the', 'ham', 'yeah', 'm', 'uh-huh', '']:
            self.assertFalse(scan_words.is_filler(w), w)

    def test_find_fillers(self):
        w = say('so um the thing uh is hmm', 1.0)
        f = scan_words.find_fillers(w)
        self.assertEqual([x['w'] for x in f], ['um', 'uh', 'hmm'])
        self.assertEqual(f[0], {'s': 1.3, 'e': 1.57, 'w': 'um'})

    def test_read_words_skips_bad_lines(self):
        with tempfile.TemporaryDirectory() as td:
            p = os.path.join(td, 'w.tsv')
            with open(p, 'w', encoding='utf-8') as f:
                f.write('1.0\t1.5\tbonjour\nnot a line\n0.2\t0.4\tfirst\n\n2.0\t2.1\n')
            self.assertEqual(scan_words.read_words(p), [(0.2, 0.4, 'first'), (1.0, 1.5, 'bonjour')])

    def test_phrases(self):
        w = say('one two three', 0) + say('four five six', 3.0) + [(4.0, 4.2, 'end.')] + say('next one here', 4.8)
        self.assertEqual([(p['i0'], p['i1']) for p in scan_words.phrases(w)], [(0, 2), (3, 6), (7, 9)])
        # a silence in the sound between two words cuts too, even when the word times run on
        w2 = [(0.0, 0.3, 'a'), (0.3, 1.5, 'b'), (1.5, 1.8, 'c'), (1.85, 2.1, 'd')]     # b is stretched over the pause after it
        self.assertEqual(len(scan_words.phrases(w2)), 1)
        self.assertEqual([(p['i0'], p['i1']) for p in scan_words.phrases(w2, [[0.7, 1.45]])], [(0, 1), (2, 3)])
        self.assertEqual(len(scan_words.phrases(w2, [[0.7, 0.9]])), 1)                    # a short one does not
        long = say(' '.join(['w'] * 70), 0)
        self.assertTrue(all(p['i1'] - p['i0'] < scan_words.PHRASE_MAX for p in scan_words.phrases(long)))


class RetakeTests(unittest.TestCase):
    def test_same_start(self):
        w = say('so the thing is we need more time', 0) + say('so the thing is we need less', 5.0)
        r = scan_words.find_retakes(w)
        self.assertEqual(len(r), 1)
        self.assertEqual(r[0]['first'][0], 0)
        self.assertEqual(r[0]['again'][0], 5.0)
        self.assertEqual(r[0]['words'], 'so the thing is we need')
        self.assertIn('same start 6 words', r[0]['why'])

    def test_overlap_with_a_new_start(self):
        w = say('there is a lot of it', 0) + say('im gonna be honest there is a lot of it', 4.0)
        r = scan_words.find_retakes(w)
        self.assertEqual(len(r), 1)
        self.assertIn('repeats 6 of 6 words', r[0]['why'])

    def test_too_far_apart_or_unlike(self):
        w = say('so the thing is we need more time', 0) + say('so the thing is we need less', 40.0)
        self.assertEqual(scan_words.find_retakes(w), [])
        self.assertEqual(scan_words.find_retakes(say('the sky is blue today', 0) + say('we should build a bridge', 3.0)), [])

    def test_small_words_do_not_make_a_retake(self):
        w = say('and then we went home early', 0) + say('and then we saw a dog', 4.0)
        self.assertEqual(scan_words.find_retakes(w), [])
        w = say('and then we went home early', 0) + say('and then we went home late', 4.0)      # 5 words alike: it is
        self.assertEqual(len(scan_words.find_retakes(w)), 1)

    def test_fillers_do_not_hide_a_retake(self):
        w = say('so um the thing is', 0) + say('so the uh thing is that', 4.0)
        self.assertEqual(len(scan_words.find_retakes(w)), 1)

    def test_restart_inside_a_line(self):
        w = say('what i would also want what i would also want is the entrance', 0)
        r = scan_words.find_retakes(w)
        self.assertEqual(len(r), 1)
        self.assertEqual(r[0]['words'], 'what i would also want')
        self.assertEqual(r[0]['first'], [0, 1.47])
        self.assertAlmostEqual(r[0]['again'][0], 1.5)
        self.assertIn('restarts inside the line', r[0]['why'])
        far = say('they have time to research and then in the end they have time to create', 0)   # a parallel line, 8 words later
        self.assertEqual(scan_words.find_retakes(far), [])

    def test_one_earlier_saying_per_again(self):
        w = say('we are gonna build the castle', 0) + say('we are gonna build the castle', 3.0) + say('we are gonna build the castle', 6.0)
        r = scan_words.find_retakes(w)
        self.assertEqual([(x['first'][0], x['again'][0]) for x in r], [(0, 3.0), (3.0, 6.0)])


class AsideTests(unittest.TestCase):
    def test_quiet_phrase_between_loud_ones(self):
        words, speech, t = [], [], 0.0
        for k in range(9):
            ph = say('this is a normal line of speech', t)
            words += ph
            amp = 300 if k == 4 else 3000                      # the 5th line is 20 dB quieter
            speech.append((ph[0][0], ph[-1][1], amp))
            t += 4.0
        x = synth(t, speech)
        db = scan_sound.frame_db(x)
        a = scan.analyse(db, words, t)['asides']
        self.assertEqual(len(a), 1)
        self.assertAlmostEqual(a[0]['s'], 16.0, places=1)
        self.assertLess(a[0]['db'], -15)
        self.assertGreater(a[0]['over_floor'], 10)

    def test_even_speech_has_none(self):
        words, speech, t = [], [], 0.0
        for k in range(9):
            ph = say('this is a normal line of speech', t)
            words += ph
            speech.append((ph[0][0], ph[-1][1], 3000 if k % 2 else 2200))
            t += 4.0
        self.assertEqual(scan.analyse(scan_sound.frame_db(synth(t, speech)), words, t)['asides'], [])


class WaitTests(unittest.TestCase):
    def test_find_waits(self):
        w = say('one two', 2.0) + say('three', 8.0) + say('four', 9.0)
        self.assertEqual(scan_picture.find_waits(w, 20.0), [[0.0, 2.0], [2.57, 8.0], [9.27, 20.0]][1:])
        self.assertEqual(scan_picture.find_waits(say('one', 5.0), 20.0)[0], [0.0, 5.0])
        self.assertEqual(scan_picture.find_waits([], 10.0), [[0.0, 10.0]])
        self.assertEqual(scan_picture.find_waits(say('hello', 0.0), 3.0), [])

    def test_speed(self):
        self.assertEqual(scan_picture.wait_speed(4.0), 2.0)           # clamped up
        self.assertEqual(scan_picture.wait_speed(9.0), 3.0)
        self.assertEqual(scan_picture.wait_speed(600.0), 20.0)        # clamped down

    def test_windows(self):
        self.assertEqual(scan_picture.wait_windows(10.0, 25.0), [(10.0, 25.0)])
        ws = scan_picture.wait_windows(0.0, 400.0)
        self.assertEqual(len(ws), scan_picture.PIC_WINDOWS)
        self.assertEqual(ws[0], (round(50 - 2.5, 3), round(50 + 2.5, 3)))
        self.assertTrue(all(ws[i][1] <= ws[i + 1][0] for i in range(len(ws) - 1)))
        self.assertGreaterEqual(ws[0][0], 0)
        self.assertLessEqual(ws[-1][1], 400)


class PictureTests(unittest.TestCase):
    H, W = scan_picture.PIC_H, scan_picture.PIC_W

    def frames(self, n, change=None, base=100):
        f = np.full((n, self.H, self.W), base, dtype=np.uint8)
        if change:
            for i in range(n):
                change(f[i], i)
        return f

    def test_still(self):
        self.assertEqual(scan_picture.picture_verdict(self.frames(20))[0], 'still')

    def test_compression_noise_is_still(self):
        f = self.frames(20)
        f = np.clip(f.astype(int) + RNG.randint(-3, 4, f.shape), 0, 255).astype(np.uint8)
        self.assertEqual(scan_picture.picture_verdict(f)[:2], ('still', 0.0))

    def test_a_pane_that_keeps_changing_is_busy(self):
        def pane(fr, i):
            fr[20:100, 150:300] = (i * 37) % 200 + 20           # a log scrolling in a pane, 20% of the frame
        screen, moving, inset = scan_picture.picture_verdict(self.frames(20, pane))
        self.assertEqual(screen, 'busy')
        self.assertEqual(moving, 1.0)

    def test_one_change_is_not_busy(self):
        def once(fr, i):
            if i >= 10:
                fr[20:100, 150:300] = 220                      # a page loaded once
        screen, moving, _ = scan_picture.picture_verdict(self.frames(20, once))
        self.assertEqual(screen, 'still')
        self.assertAlmostEqual(moving, 1 / 19, places=2)

    def test_a_camera_strip_is_left_out(self):
        def cam(fr, i):
            fr[110:180, 0:90] = (i * 53) % 230 + 10             # a face moving in the bottom-left corner
        screen, moving, inset = scan_picture.picture_verdict(self.frames(20, cam))
        self.assertEqual(screen, 'still')
        self.assertEqual(inset, 'bottom-left')

    def test_the_strip_does_not_hide_a_busy_screen(self):
        def both(fr, i):
            fr[110:180, 0:90] = (i * 53) % 230 + 10
            fr[20:100, 150:300] = (i * 37) % 200 + 20
        screen, _, inset = scan_picture.picture_verdict(self.frames(20, both))
        self.assertEqual(screen, 'busy')

    def test_pairs_do_not_cross_windows(self):
        a, b = self.frames(6, base=50), self.frames(6, base=200)    # very different, but never compared
        self.assertEqual(scan_picture.picture_verdict([a, b])[0], 'still')
        self.assertEqual(scan_picture.picture_verdict(self.frames(1))[0], 'still')
        self.assertEqual(scan_picture.picture_verdict([])[0], 'still')


class AnalyseTests(unittest.TestCase):
    """One synthetic recording: 40 s, room noise, speech in two places, a quiet stretch, a digital-zero stretch."""

    @classmethod
    def setUpClass(cls):
        w = say('so the thing is um we need more time', 1.0) + say('so the thing is we need more money', 6.0) + say('and that is it', 30.0)
        cls.words = w
        speech = [(s, e, 3000) for s, e, _ in w]
        cls.x = synth(40.0, speech)
        cls.d = scan.analyse(scan_sound.frame_db(cls.x), w, 40.0)

    def test_floor_and_speech(self):
        self.assertAlmostEqual(self.d['floor_db'], 20 * np.log10(3.0 / 32768), delta=2.5)
        self.assertAlmostEqual(self.d['speech_db'], 20 * np.log10(3000 / np.sqrt(2) / 32768), delta=3)

    def test_silences_come_from_the_sound(self):
        sil = self.d['silences']
        self.assertTrue(any(abs(s - 8.4) < 0.3 and abs(e - 30.0) < 0.3 for s, e in sil), sil)    # between the two blocks of speech
        self.assertTrue(all(e - s >= 0.4 - 1e-9 for s, e in sil))

    def test_filler_and_retake(self):
        self.assertEqual([f['w'] for f in self.d['fillers']], ['um'])
        self.assertEqual(len(self.d['retakes']), 1)
        self.assertEqual(self.d['retakes'][0]['first'][0], 1.0)
        self.assertEqual(self.d['retakes'][0]['again'][0], 6.0)

    def test_dead_air_and_waits(self):
        da = self.d['dead_air']
        self.assertTrue(any(s < 9.6 and e > 29.5 for s, e in da), da)
        self.assertTrue(any(s < 10 and e > 29.9 for s, e in self.d['wait_spans']))
        self.assertTrue(any(s > 31 and e == 40.0 for s, e in self.d['wait_spans']))

    def test_sound_with_no_words_is_not_dead_air(self):
        x = synth(20.0, [(0.5, 1.5, 3000), (4.0, 14.0, 3000)])          # ten seconds of loud sound nobody speaks over
        d = scan.analyse(scan_sound.frame_db(x), say('hello there', 0.5), 20.0)
        self.assertFalse(any(s < 6 and e > 12 for s, e in d['dead_air']), d['dead_air'])
        self.assertTrue(any(s < 6 and e > 12 for s, e in d['wait_spans']))      # but nobody spoke: a wait

    def test_gated_mic(self):
        w = say('first line of speech here', 1.0) + say('second line of speech here', 12.0)
        x = synth(25.0, [(s, e, 3000) for s, e, _ in w], noise=0, silent=[(0, 1.0), (3, 12), (14, 25)])
        x[int(4 * scan_sound.SR):int(8 * scan_sound.SR)] += RNG.normal(0, 8, int(4 * scan_sound.SR)).astype(np.int16)    # the gate lets some hiss through
        d = scan.analyse(scan_sound.frame_db(x), w, 25.0)
        self.assertGreater(d['floor_db'], -90)                                  # digital zero is not the room tone
        self.assertTrue(any('digital silence' in n for n in d['notes']))

    def test_old_word_file_without_fillers_says_so(self):
        d = scan.analyse(scan_sound.frame_db(synth(8.0, [(1, 3, 3000)])), say('a plain line here', 1.0), 8.0)
        self.assertTrue(any('fillers can not be counted' in n for n in d['notes']))
        self.assertFalse(any('fillers' in n for n in self.d['notes']))
        e = scan.analyse(scan_sound.frame_db(synth(8.0)), [], 8.0)
        self.assertTrue(any('no words' in n for n in e['notes']))
        self.assertEqual(e['waits'] if 'waits' in e else e['wait_spans'], [[0.0, 8.0]])


class MdTests(unittest.TestCase):
    def test_times(self):
        self.assertEqual(scan_md.fmt_t(0), '0:00.0')
        self.assertEqual(scan_md.fmt_t(65.37), '1:05.3')
        self.assertEqual(scan_md.fmt_t(59.96), '0:59.9')
        self.assertEqual(scan_md.fmt_t(3725.5), '1:02:05.5')

    def test_around(self):
        w = say('one two three four five six seven eight nine ten', 0)
        self.assertEqual(scan_md.around(w, 1.5, 1.8, 2), '"four five | seven eight"')
        self.assertEqual(scan_md.around(w, 0.0, 0.1, 3), '" | two three four"')

    def test_write_md_caps_and_says_so(self):
        words = say('hello world ' * 30, 0)
        d = {'file': 'footage/a.mkv', 'duration': 2000.0, 'n_words': len(words), 'floor_db': -60.0, 'speech_db': -25.0, 'silence_db': -54.0, 'notes': [],
             'fillers': [{'s': 10.0 * k, 'e': 10.0 * k + 0.3, 'w': 'um'} for k in range(1, 101)],
             'retakes': [], 'asides': [{'s': 5.0, 'e': 7.0, 'db': -14.0, 'words': 'note to self', 'over_floor': 20.0},
                         {'s': 9.0, 'e': 10.0, 'db': -12.0, 'words': 'hiss', 'over_floor': 3.0}],
             'dead_air': [[100.0 + 10 * k, 103.0 + 10 * k] for k in range(60)],
             'waits': [{'s': 1.0, 'e': 12.0, 'screen': 'busy', 'speed': 3.7, 'moving': 0.9}, {'s': 50.0, 'e': 60.0, 'screen': 'still', 'speed': 3.3, 'moving': 0.0, 'inset': 'bottom-left'}],
             'silences': [[10.0 * k, 10.0 * k + 0.5] for k in range(1, 300)] + [[4000.0, 4003.0]]}
        md = scan_md.write_md({'version': 1, 'sources': {'r1': d}}, {'r1': words})
        self.assertIn('## r1', md)
        self.assertIn('### Fillers: 100 (um 100)', md)
        self.assertIn('60 more not listed', md)                      # 100 fillers, 40 shown
        self.assertIn('20 shorter ones not listed', md)              # 60 dead-air stretches, 40 shown
        self.assertIn('busiest minutes', md)
        self.assertIn('0:01.0-0:12.0 (11.0 s) busy', md)
        self.assertIn('camera strip bottom-left left out', md)
        self.assertIn('may not be speech', md)                       # the 3 dB aside
        self.assertIn('1:06:40.0', md)                               # an hour-long source reads as h:mm:ss.s
        self.assertLess(len(md.splitlines()), 260)

    def test_md_of_an_empty_scan(self):
        d = {'file': 'x.mkv', 'duration': 10.0, 'n_words': 0, 'floor_db': -50.0, 'speech_db': None, 'notes': ['the word file has no words'],
             'fillers': [], 'retakes': [], 'asides': [], 'dead_air': [], 'waits': [], 'silences': []}
        md = scan_md.write_md({'version': 1, 'sources': {'a': d}}, {})
        self.assertIn('Fillers: 0', md)
        self.assertIn('NOTE: the word file has no words', md)


class RunTests(unittest.TestCase):
    """A 14 s recording through ffmpeg and the command: words, a still wait, a busy wait."""

    @staticmethod
    def main(argv):
        with contextlib.redirect_stdout(io.StringIO()):
            return scan.main(argv)

    def test_end_to_end(self):
        if subprocess.run(['ffmpeg', '-version'], capture_output=True).returncode:
            self.skipTest('no ffmpeg')
        with tempfile.TemporaryDirectory() as td:
            words = say('so um the thing is', 0.2, per=0.35) + say('here we go again now', 6.0, per=0.35) + say('bye', 13.2)
            x = synth(14.0, [(s, e, 3000) for s, e, _ in words])
            wav = os.path.join(td, 'a.wav')
            with wave.open(wav, 'wb') as f:
                f.setnchannels(1)
                f.setsampwidth(2)
                f.setframerate(scan_sound.SR)
                f.writeframes(x.tobytes())
            mkv = os.path.join(td, 'rec.mkv')
            vf = ('color=c=gray:s=320x180:r=10:d=14[bg];color=c=white:s=60x60:r=10:d=14[box];'
                  "[bg][box]overlay=x='mod(t*70,250)':y=60:enable='gte(t,8)'[v]")
            r = subprocess.run(['ffmpeg', '-v', 'error', '-y', '-filter_complex', vf, '-i', wav, '-map', '[v]', '-map', '0:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                                '-c:a', 'aac', '-shortest', mkv], capture_output=True, text=True)
            if r.returncode:
                self.skipTest('ffmpeg could not make the test recording: ' + r.stderr[-200:])
            tsv = os.path.join(td, 'words.tsv')
            with open(tsv, 'w', encoding='utf-8') as f:
                f.write(''.join(f'{s}\t{e}\t{w}\n' for s, e, w in words))
            out = os.path.join(td, 'out')
            self.assertEqual(self.main(['--file', mkv, '--words', tsv, '--src', 'r9', '--out', out]), 0)
            doc = read_json(os.path.join(out, 'scan.json'))
            self.assertEqual(doc['version'], 1)
            d = doc['sources']['r9']
            for k in ('floor_db', 'silences', 'fillers', 'retakes', 'asides', 'dead_air', 'waits'):
                self.assertIn(k, d)
            self.assertEqual([f['w'] for f in d['fillers']], ['um'])
            w = d['waits']
            self.assertEqual(len(w), 2, w)                           # 2.1-6.0 and 8.0-13.2
            self.assertEqual([x['screen'] for x in w], ['still', 'busy'])
            self.assertEqual(w[0]['speed'], 2.0)
            md = read_text(os.path.join(out, 'scan.md'))
            self.assertIn('## r9', md)
            self.assertIn('busy', md)
            # a second source scanned later keeps the first one's part
            self.assertEqual(self.main(['--file', mkv, '--words', tsv, '--src', 'r8', '--out', out]), 0)
            doc = read_json(os.path.join(out, 'scan.json'))
            self.assertEqual(sorted(doc['sources']), ['r8', 'r9'])
            md = read_text(os.path.join(out, 'scan.md'))
            self.assertIn('## r9', md)
            self.assertIn('## r8', md)


if __name__ == '__main__':
    unittest.main(verbosity=1)
