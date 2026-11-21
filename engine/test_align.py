"""Tests of align.py's pure parts:  python test_align.py   (no GPU, no model, no recording: the model's odds are made up)"""
import json
import os
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import align
import align_ctc
import align_edges
import align_text

BASE = ('-', '|', 'E', 'T', 'A', 'O', 'N', 'I', 'H', 'S', 'R', 'D', 'L', 'U', 'M', 'W', 'C', 'F', 'G', 'Y', 'P', 'B', 'V', 'K', "'", 'X', 'J', 'Q', 'Z')
MMS = ('-', 'a', 'i', 'e', 'n', 'o', 'u', 't', 's', 'r', 'm', 'k', 'l', 'd', 'g', 'h', 'y', 'b', 'p', 'w', 'c', 'v', 'j', 'z', 'f', "'", 'q', 'x', '*')
A = align_text.alpha_from_labels(BASE)
M = align_text.alpha_from_labels(MMS)
WILDCOLS = list(range(2, 29))


def letters(text, alpha=A):
    return [alpha['letters'][c] for c in text.lower() if c in alpha['letters']]


def fake_lp(frames, spots, classes=29):
    """Odds where each (frame, class) in spots is near certain and every other frame is blank."""
    lp = np.full((frames, classes), np.log(0.002), dtype=np.float32)
    lp[:, 0] = np.log(0.95)
    for f, c in spots:
        lp[f, :] = np.log(0.002)
        lp[f, c] = np.log(0.95)
    return lp


class TextTests(unittest.TestCase):
    def test_numbers(self):
        self.assertEqual(align_text.spoken_number('1999')[0], 'nineteen ninety nine')
        self.assertEqual(align_text.spoken_number('429')[:2], ['four hundred twenty nine', 'four twenty nine'])
        self.assertEqual(align_text.spoken_number('5.5'), ['five point five'])
        self.assertEqual(align_text.spoken_number('$7.63')[0], 'seven sixty three')
        self.assertEqual(align_text.spoken_number('50%'), ['fifty percent'])
        self.assertEqual(align_text.spoken_number('1st'), ['first'])
        self.assertEqual(align_text.spoken_number('21st'), ['twenty first'])
        self.assertEqual(align_text.spoken_number('3,500'), ['three thousand five hundred'])
        self.assertEqual(align_text.spoken_number('10k')[1], 'ten thousand')
        self.assertEqual(align_text.spoken_number('"17."'), ['seventeen'])
        self.assertIsNone(align_text.spoken_number('GPT-5'))
        self.assertIsNone(align_text.spoken_number('hello'))
        self.assertIsNone(align_text.spoken_number('1234567890123'))

    def test_readings(self):
        self.assertEqual(align_text.word_readings("Didn't,", A), [letters("didn't")])
        self.assertEqual(align_text.word_readings('Hello.', A), [letters('hello')])
        self.assertEqual(align_text.word_readings('’s', A), [letters('s')])           # a lone curly apostrophe: no apostrophe token
        self.assertEqual(align_text.word_readings('naïve', A), [letters('naive')])
        self.assertIsNone(align_text.word_readings('...', A))
        self.assertIsNone(align_text.word_readings('[Music]', A))
        self.assertIsNone(align_text.word_readings('', A))
        self.assertEqual(align_text.word_readings('日本', A), [[align_text.WILD]])
        self.assertEqual(align_text.word_readings('&', A), [[align_text.WILD]])
        # a hyphen is a word break where the model has a separator, nothing where it has none
        self.assertEqual(align_text.word_readings('mid-round', A), [letters('mid') + [A['sep']] + letters('round')])
        self.assertEqual(align_text.word_readings('mid-round', M), [letters('midround', M)])
        # a number in a name is said in words
        gpt = align_text.word_readings('GPT-5', A)[0]
        self.assertEqual(gpt, letters('gpt') + [A['sep']] + letters('five'))
        # a number written in digits has more than one way to be said
        self.assertGreaterEqual(len(align_text.word_readings('429', A)), 2)
        self.assertEqual(align_text.word_readings('2026', A)[0], letters('twenty') + [A['sep']] + letters('twenty') + [A['sep']] + letters('six'))

    def test_alphabets(self):
        self.assertEqual(A['sep'], 1)
        self.assertIsNone(M['sep'])
        self.assertEqual(M['letters']['a'], 1)
        self.assertNotIn('*', M['letters'])
        self.assertIn("'", A['letters'])

    def test_group_tokens(self):
        tokens, owner, spoken, spelled = align_text.group_tokens(['hi', '...', 'you'], A)
        self.assertEqual(tokens, letters('hi') + [1] + letters('you') + [1])
        self.assertEqual(owner, [0, 0, -1, 2, 2, 2, -1])
        self.assertEqual((spoken, spelled), (2, 2))
        t2 = align_text.group_tokens(['hi', 'you'], M)[0]
        self.assertEqual(t2, letters('hi', M) + letters('you', M))
        self.assertEqual(align_text.group_tokens(['5%', '日本'], A)[2:], (2, 1))

    def test_fillers(self):
        for w in ['um', 'Um,', 'uh', 'Uh.', 'er', 'ah', 'Ah,', 'hmm', 'Hmm,', 'Hmmmm', 'uhh', 'umm', 'mm', 'uh-huh', 'Mm-hmm', 'erm']:
            self.assertTrue(align_text.is_filler(w), w)
        for w in ['hum', 'umbrella', 'the', 'ahead', 'error', 'her', 'a', 'uhm-bye', '']:
            self.assertFalse(align_text.is_filler(w), w)


class PlanTests(unittest.TestCase):
    def words(self, n, step=0.5, dur=0.3, pause_at=None, pause=1.0):
        out, t = [], 0.0
        for i in range(n):
            out.append((round(t, 3), round(t + dur, 3), 'w%d' % i))
            t += step + (pause if pause_at and i in pause_at else 0)
        return out

    def test_groups_cover_everything_in_order(self):
        w = self.words(300)
        g = align_ctc.plan_groups(w, max_s=25.0)
        self.assertEqual(g[0][0], 0)
        self.assertEqual(g[-1][1], 299)
        for (a, b), (c, d) in zip(g, g[1:]):
            self.assertEqual(c, b + 1)
        for a, b in g:
            self.assertLessEqual(w[b][1] - w[a][0], 25.0 + 1e-6)
        self.assertGreater(len(g), 5)

    def test_groups_cut_at_the_longest_pause(self):
        w = self.words(100, pause_at={44}, pause=1.2)      # a pause after word 44, near the end of the first 25 s
        g = align_ctc.plan_groups(w, max_s=25.0)
        self.assertEqual(g[0], (0, 44))

    def test_groups_small_and_empty(self):
        self.assertEqual(align_ctc.plan_groups([]), [])
        self.assertEqual(align_ctc.plan_groups(self.words(1)), [(0, 0)])
        self.assertEqual(align_ctc.plan_groups(self.words(10)), [(0, 9)])
        long_word = [(0.0, 40.0, 'x'), (40.0, 41.0, 'y')]
        self.assertEqual(align_ctc.plan_groups(long_word, max_s=25.0), [(0, 0), (1, 1)])

    def test_frames(self):
        self.assertEqual(align_ctc.frames_for(399), 0)
        self.assertEqual(align_ctc.frames_for(400), 1)
        self.assertEqual(align_ctc.frames_for(16000), 49)         # what wav2vec2 gives for one second

    def test_chunks(self):
        for samples in (16000, 30 * 16000, 31 * 16000, 100 * 16000 + 123, 3600 * 16000):
            ch = align_ctc.plan_chunks(samples)
            total = align_ctc.frames_for(samples)
            self.assertEqual(ch[0]['keep'][0], 0)
            self.assertEqual(ch[-1]['keep'][1], total)
            for a, b in zip(ch, ch[1:]):
                self.assertEqual(a['keep'][1], b['keep'][0])           # nothing missing, nothing twice
            for c in ch:
                self.assertLessEqual(c['length'], 30 * 16000)
                self.assertEqual(c['start'] % align_ctc.FRAME, 0)
                first = c['start'] // align_ctc.FRAME
                self.assertGreaterEqual(c['keep'][0], first)
                self.assertLessEqual(c['keep'][1], first + align_ctc.frames_for(c['length']))
        self.assertEqual(align_ctc.plan_chunks(100), [])

    def test_stitch_puts_every_frame_back(self):
        samples = 75 * 16000
        ch = align_ctc.plan_chunks(samples)
        total = align_ctc.frames_for(samples)
        outs = []
        for c in ch:
            first = c['start'] // align_ctc.FRAME
            n = align_ctc.frames_for(c['length'])
            outs.append(np.arange(first, first + n, dtype=np.float32)[:, None] * np.ones((1, 3), dtype=np.float32))
        out = align_ctc.stitch(ch, outs)
        self.assertEqual(out.shape, (total, 3))
        self.assertTrue((out[:, 0] == np.arange(total)).all())


class PathTests(unittest.TestCase):
    def test_spans_on_made_up_odds(self):
        toks = letters('hi')                       # H I
        lp = fake_lp(20, [(5, toks[0]), (9, toks[1])])
        spans, score = align_ctc.ctc_path(lp, toks)
        self.assertEqual(spans[0][0], 5)
        self.assertEqual(spans[1][0], 9)
        self.assertGreater(score, -10)

    def test_repeated_letter_needs_a_blank(self):
        toks = letters('ee')
        self.assertIsNone(align_ctc.ctc_path(fake_lp(1, []), toks))                  # one frame cannot hold two
        self.assertIsNone(align_ctc.ctc_path(fake_lp(2, []), toks))                  # the blank between them is needed
        self.assertIsNotNone(align_ctc.ctc_path(fake_lp(3, []), toks))

    def test_too_short_and_empty(self):
        self.assertIsNone(align_ctc.ctc_path(fake_lp(2, []), letters('abc')))
        self.assertIsNone(align_ctc.ctc_path(fake_lp(5, []), []))

    def test_context_is_optional(self):
        toks = letters('go') + [1] + letters('on')
        lp = fake_lp(30, [(3, toks[0]), (6, toks[1]), (9, 1)])                   # the sound holds "go" and then nothing
        spans, score = align_ctc.ctc_path(lp, toks, needed=3)
        self.assertEqual(len(spans), 3)
        self.assertEqual(spans[0][0], 3)
        self.assertEqual(spans[1][0], 6)

    def test_context_takes_the_sound_that_is_its_own(self):
        # "go" then "on" is said; the run is only "go": without the context the path would reach for "o" of "on"
        g, o, n = letters('g')[0], letters('o')[0], letters('n')[0]
        lp = fake_lp(40, [(3, g), (6, o), (9, 1), (14, o), (17, n), (20, 1)])
        spans, _ = align_ctc.ctc_path(lp, [g, o, 1] + [o, n, 1], needed=3)
        self.assertEqual([s[0] for s in spans], [3, 6, 9])

    def test_wildcard_matches_any_sound(self):
        t = letters('a')[0]
        toks = [t, 1, align_text.WILD, 1, t]
        lp = fake_lp(40, [(3, t), (6, 1), (12, letters('z')[0]), (13, 1), (20, t)])
        spans, _ = align_ctc.ctc_path(lp, toks, wild_cols=WILDCOLS)
        self.assertEqual(spans[0][0], 3)
        self.assertEqual(spans[4][0], 20)
        self.assertTrue(6 < spans[2][0] < 20)


class AlignTests(unittest.TestCase):
    def test_words_land_where_the_sound_is(self):
        # "hi you": h at frame 20 (0.40 s), i at 24, separator at 27, y at 40 (0.80 s), o at 43, u at 46, separator at 49
        h, i, y, o, u = (letters(c)[0] for c in 'hiyou')
        lp = fake_lp(100, [(20, h), (24, i), (27, 1), (40, y), (43, o), (46, u), (49, 1)])
        words = [(0.30, 0.50, 'hi'), (0.70, 1.00, 'you')]
        old = (align_ctc.ONSET_LEAD, align_ctc.END_PAD)
        align_ctc.ONSET_LEAD, align_ctc.END_PAD = 0.0, 0.0
        try:
            new, scores = align.align_words(lp, words, A, WILDCOLS)
        finally:
            align_ctc.ONSET_LEAD, align_ctc.END_PAD = old
        self.assertEqual([w[2] for w in new], ['hi', 'you'])
        self.assertAlmostEqual(new[0][0], 0.40, delta=0.001)
        self.assertAlmostEqual(new[0][1], 0.56, delta=0.001)         # to the end of the separator's frame
        self.assertAlmostEqual(new[1][0], 0.80, delta=0.001)
        self.assertAlmostEqual(new[1][1], 1.00, delta=0.001)
        self.assertGreater(min(scores), 0.9)

    def test_a_word_not_in_the_sound_keeps_its_time(self):
        h, i = letters('h')[0], letters('i')[0]
        lp = fake_lp(100, [(20, h), (24, i), (27, 1)])                 # only "hi" is there
        words = [(0.30, 0.50, 'hi'), (0.70, 1.00, 'ghost')]
        new, scores = align.align_words(lp, words, A, WILDCOLS)
        self.assertEqual(scores[1], 0.0)
        self.assertEqual((new[1][0], new[1][1]), (0.70, 1.00))
        self.assertGreater(scores[0], 0.9)

    def test_symbol_word_keeps_its_time_and_neighbours_still_align(self):
        h, i = letters('h')[0], letters('i')[0]
        lp = fake_lp(100, [(20, h), (24, i), (27, 1)])
        new, scores = align.align_words(lp, [(0.30, 0.50, 'hi'), (0.70, 1.00, '日本')], A, WILDCOLS)
        self.assertEqual(scores[1], 0.0)
        self.assertEqual(new[1][2], '日本')

    def test_the_file_survives(self):
        w = [(1.0, 1.5, "don't"), (1.5, 2.25, 'Hmm,'), (2.25, 3.0, '日本')]
        with tempfile.TemporaryDirectory() as td:
            p = os.path.join(td, 'w.tsv')
            with open(p, 'w', encoding='utf-8') as f:
                f.write(align.format_words(w))
            self.assertEqual(align.read_words(p), w)
            with open(p, encoding='utf-8') as f:
                for line in f:
                    self.assertEqual(len(line.rstrip('\n').split('\t')), 3)          # three columns, always
            with open(p, 'a', encoding='utf-8') as f:
                f.write('broken line\n\t\t\n')
            self.assertEqual(len(align.read_words(p)), 3)

    def test_sidecar(self):
        d = align.sidecar_doc('MMS_FA', [(1.0, 1.5, 'a'), (2.0, 2.5, 'b')], [0.9, 0.0], 1234.7)
        self.assertEqual(sorted(d), ['model', 'ms', 'words'])
        self.assertEqual(d['words'], [[1.0, 1.5, 'a', 0.9], [2.0, 2.5, 'b', 0.0]])
        self.assertEqual(d['ms'], 1234)
        json.dumps(d)


class MergeTests(unittest.TestCase):
    def test_placed_words_take_their_time_others_are_fitted_in_between(self):
        words = [(0.0, 1.0, 'a'), (1.0, 2.0, 'b'), (2.0, 3.0, 'c'), (3.0, 4.0, 'd')]
        timings = [(0.1, 0.9, 0.9), None, (2.5, 3.0, 0.8), (3.2, 3.9, 0.7)]
        new, scores = align_edges.merge_times(words, timings)
        self.assertEqual(new[0][:2], (0.1, 0.9))
        self.assertEqual(scores[1], 0.0)
        self.assertGreaterEqual(new[1][0], 0.9)
        self.assertLessEqual(new[1][1], 2.5)
        self.assertEqual(new[2][:2], (2.5, 3.0))
        for a, b in zip(new, new[1:]):
            self.assertLessEqual(a[1], b[0] + 1e-9)
        self.assertEqual([w[2] for w in new], ['a', 'b', 'c', 'd'])

    def test_low_score_is_not_placed(self):
        words = [(0.0, 1.0, 'a'), (5.0, 6.0, 'b')]
        new, scores = align_edges.merge_times(words, [(0.2, 0.8, 0.9), (5.5, 5.7, 0.05)])
        self.assertEqual(new[1][:2], (5.0, 6.0))
        self.assertEqual(scores, [0.9, 0.0])

    def test_unplaced_run_squeezed_between_neighbours(self):
        words = [(0.0, 1.0, 'a'), (1.0, 5.0, 'x'), (5.0, 6.0, 'b')]
        new, _ = align_edges.merge_times(words, [(0.0, 1.0, 1.0), None, (2.0, 3.0, 1.0)])
        self.assertGreaterEqual(new[1][0], 1.0)
        self.assertLessEqual(new[1][1], 2.0)

    def test_order_holds_when_the_aligned_word_ends_late(self):
        words = [(0.0, 1.0, 'a'), (1.0, 1.2, 'x'), (2.0, 3.0, 'b')]
        new, _ = align_edges.merge_times(words, [(0.0, 1.9, 1.0), None, (2.0, 3.0, 1.0)])
        self.assertGreaterEqual(new[1][0], 1.9)
        self.assertLessEqual(new[1][1], 2.0)

    def test_the_same_count_always(self):
        words = [(float(i), i + 0.5, 'w%d' % i) for i in range(20)]
        timings = [None if i % 3 == 0 else (i + 0.1, i + 0.4, 0.9) for i in range(20)]
        new, scores = align_edges.merge_times(words, timings)
        self.assertEqual(len(new), 20)
        self.assertEqual(len(scores), 20)

    def test_sound_islands(self):
        db = np.full(400, -70.0)
        db[100:130] = -30            # 0.30 s of sound at 1.00 s
        db[140:145] = -30            # a blip 0.10 s later, joined? gap of 0.10 s: no
        db[200:203] = -30            # 0.03 s: too short, dropped
        db[300:320] = -30
        db[322:340] = -30            # a dip of 0.02 s: joined
        isl = align_edges.sound_islands(db, 0.0, 4.0)
        self.assertEqual([(round(a, 2), round(b, 2)) for a, b in isl], [(1.0, 1.3), (1.4, 1.45), (3.0, 3.4)])
        self.assertEqual(align_edges.sound_islands(db, 2.0, 2.5), [])
        self.assertEqual(align_edges.sound_islands(db, 5.0, 6.0), [])

    def test_a_filler_goes_on_the_sound(self):
        # "uh" whisper puts at 1.0-1.1 (it is a 0.4 s sound at 1.2-1.6); the neighbours are aligned either side
        db = np.full(400, -70.0)
        db[60:100] = -30             # the word before: 0.6-1.0
        db[120:160] = -30            # the filler: 1.2-1.6
        db[180:230] = -30            # the word after: 1.8-2.3
        words = [(0.6, 1.0, 'so'), (1.0, 1.1, 'uh'), (1.8, 2.3, 'yes')]
        new, scores = align_edges.merge_times(words, [(0.6, 1.0, 0.95), None, (1.8, 2.3, 0.95)], db=db, alpha=A)
        self.assertAlmostEqual(new[1][0], 1.2, delta=0.011)
        self.assertAlmostEqual(new[1][1], 1.6, delta=0.011)
        self.assertEqual(scores[1], 0.0)

    def test_a_filler_the_model_thought_it_heard_still_goes_on_the_sound(self):
        db = np.full(400, -70.0)
        db[60:100] = -30
        db[120:160] = -30
        db[180:230] = -30
        words = [(0.6, 1.0, 'so'), (1.0, 1.4, 'ah'), (1.8, 2.3, 'yes')]
        new, scores = align_edges.merge_times(words, [(0.6, 1.0, 0.95), (1.5, 1.6, 0.98), (1.8, 2.3, 0.95)], db=db, alpha=A)
        self.assertAlmostEqual(new[1][0], 1.2, delta=0.011)
        self.assertAlmostEqual(new[1][1], 1.6, delta=0.011)
        # without the loudness the aligned time stands
        new2, _ = align_edges.merge_times(words, [(0.6, 1.0, 0.95), (1.5, 1.6, 0.98), (1.8, 2.3, 0.95)])
        self.assertEqual(new2[1][:2], (1.5, 1.6))

    def test_edges_inside_sound_go_out_to_its_edge(self):
        db = np.full(500, -70.0)
        db[100:130] = -30            # a word's sound: 1.00-1.30
        words = [(1.08, 1.22, 'word')]
        new = align_edges.snap_to_sound(words, [0.9], db)
        self.assertEqual(new[0][:2], (1.0, 1.3))
        # an edge already in the quiet, or a word the model did not hear, stays
        self.assertEqual(align_edges.snap_to_sound([(0.9, 1.4, 'word')], [0.9], db)[0][:2], (0.9, 1.4))
        self.assertEqual(align_edges.snap_to_sound(words, [0.0], db)[0][:2], (1.08, 1.22))
        # further than the reach: stays
        db2 = np.full(500, -70.0)
        db2[100:160] = -30
        self.assertEqual(align_edges.snap_to_sound([(1.3, 1.5, 'w')], [0.9], db2)[0][0], 1.3)

    def test_snap_never_runs_into_the_neighbours_or_through_connected_speech(self):
        db = np.full(500, -70.0)
        db[100:200] = -30            # one unbroken sound: two words said without a pause
        words = [(1.00, 1.45, 'one'), (1.50, 2.00, 'two')]
        new = align_edges.snap_to_sound(words, [0.9, 0.9], db)
        self.assertEqual(new[0][1], 1.45)               # no quiet gap between them: nothing moves
        self.assertEqual(new[1][0], 1.50)
        # a pause between: the first word's end goes out to its sound's end, never past the second word's start
        db[145:150] = -70.0
        new = align_edges.snap_to_sound([(1.0, 1.40, 'one'), (1.5, 2.0, 'two')], [0.9, 0.9], db)
        self.assertEqual(new[0][1], 1.45)
        self.assertLessEqual(new[0][1], new[1][0])

    def test_a_word_over_silence_takes_no_time(self):
        db = np.full(400, -70.0)
        db[60:100] = -30
        db[300:340] = -30
        words = [(0.6, 1.0, 'so'), (1.5, 2.0, 'uh'), (3.0, 3.4, 'yes')]
        new, _ = align_edges.merge_times(words, [(0.6, 1.0, 0.95), None, (3.0, 3.4, 0.95)], db=db, alpha=A)
        self.assertEqual(new[1][0], new[1][1])
        self.assertGreaterEqual(new[1][0], 1.0)


if __name__ == '__main__':
    unittest.main(verbosity=1)
