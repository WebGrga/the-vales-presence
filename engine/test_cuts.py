"""Tests of the cut list for review:  python test_cuts.py   (the pure parts need nothing; the clip tests need ffmpeg: any H.264 encoder, encoders.py)"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cuts
import cuts_clips
import edl as edlmod
import encoders
import handover
from pipelib import Cut, probe, read_json

SRC = {'r1': {'file': 'footage/a.mkv', 'words': 'work/w.tsv'}, 'r2': {'file': 'footage/b.mkv'}}


def S(at, ln, src, a, b, **k):
    return {'kind': 'S', 'at': at, 'len': ln, 'src': src, 'src_in': a, 'src_out': b, **k}


def make_items():
    """0-10 runs on to 10-14 (no cut), then a removal 14..20, a source change, a jump back, and a hold between two parts that run on."""
    return [S(0, 10, 'r1', 100, 110), S(10, 4, 'r1', 110, 114),
            S(14, 5, 'r1', 120, 125, cut_before={'kind': 'retake', 'why': 'said twice', 'flag': True, 'ask': 'which take?'}),
            S(19, 3, 'r2', 7, 10),
            S(22, 2, 'r2', 3, 5),
            {'kind': 'H', 'at': 24, 'len': 1},
            S(25, 2, 'r2', 5, 7)]


class FindTests(unittest.TestCase):
    def test_cuts(self):
        c = cuts.find_cuts(make_items())
        self.assertEqual(len(c), 3)                                  # 110 -> 110 runs on; 5 -> 5 across the hold runs on
        a, b, d = c
        self.assertEqual((a['at'], a['src'], a['from'], a['to'], a['len'], a['jump']), (14.0, 'r1', 114, 120, 6, None))
        self.assertEqual(a['cut_before']['kind'], 'retake')
        self.assertEqual((b['at'], b['jump'], b['src'], b['prev']), (19.0, 'source', 'r2', {'src': 'r1', 'out': 125}))
        self.assertEqual((b['from'], b['to'], b['len']), (7, 7, 0.0))
        self.assertEqual((d['at'], d['jump'], d['from']), (22.0, 'back', 3))

    def test_hold_between_keeps_the_jump_and_its_cut_before(self):
        it = [S(0, 5, 'r1', 0, 5), {'kind': 'H', 'at': 5, 'len': 1, 'cut_before': {'kind': 'pause', 'why': 'x'}}, S(6, 4, 'r1', 9, 13)]
        c = cuts.find_cuts(it)
        self.assertEqual(len(c), 1)
        self.assertEqual((c[0]['at'], c[0]['len'], c[0]['cut_before']['kind']), (5.0, 4, 'pause'))

    def test_sped_wait_explains_its_jump(self):
        wait = {'kind': 'W', 'at': 5, 'len': 10, 'pic_src': 'r1', 'pic_in': 105, 'pic_out': 165, 'speed': 6}
        it = [S(0, 5, 'r1', 100, 105), wait, S(15, 5, 'r1', 165, 170)]
        self.assertEqual(cuts.find_cuts(it), [])
        self.assertEqual(cuts.sped_of(it), [{'id': 'w1', 'at': 5, 'len': 10, 'src': 'r1', 'from': 105, 'to': 165, 'speed': 6}])
        it[2]['src_in'] = 200                                        # the wait does not reach where the next part starts: a real cut too
        self.assertEqual(len(cuts.find_cuts(it)), 1)

    def test_sped_keeps_cut_before_and_a_ramp_range(self):
        it = [{'kind': 'R', 'at': 0, 'len': 2, 'pic_src': 'r1', 'pic_in': 10, 'speed': 3, 'cut_before': {'kind': 'wait', 'flag': False}}]
        s = cuts.sped_of(it)
        self.assertEqual((s[0]['to'], s[0]['cut_before']['kind']), (16, 'wait'))   # pic_out = pic_in + len * speed

    def test_first_item_and_no_sound_items_make_no_cut(self):
        self.assertEqual(cuts.find_cuts([{'kind': 'E', 'at': 0, 'len': 1}]), [])
        self.assertEqual(cuts.find_cuts([S(0, 1, 'r1', 0, 1)]), [])


class WordsTests(unittest.TestCase):
    ROUGH = [[0.0, 0.4, 'so', 'r1', 100.0], [0.4, 0.8, 'the', 'r1', 100.4], [0.8, 1.2, 'thing', 'r1', 100.8],
             [1.2, 1.6, 'is', 'r1', 105.0], [1.6, 2.0, 'new', 'r1', 105.4]]

    def test_context(self):
        w = cuts.Words(self.ROUGH)
        self.assertEqual(cuts.text_of(w.before(1.2, 2)), 'the thing')
        self.assertEqual(cuts.text_of(w.after(1.2, 8)), 'is new')
        self.assertEqual(cuts.text_of(w.before(0.0, 8)), '')

    def test_removed_words_are_the_ones_missing_from_the_rough(self):
        src = [(100.0, 100.4, 'so'), (100.8, 101.0, 'thing'), (101.0, 101.5, 'um'), (102.0, 102.5, 'so'), (105.0, 105.3, 'is'), (110.0, 110.4, 'later')]
        kept = {('r1', 100.0), ('r1', 100.8), ('r1', 105.0)}
        cut = {'src': 'r1', 'from': 101.0, 'to': 105.0, 'len': 4.0}
        self.assertEqual(cuts.removed_words(src, kept, cut), ('um so', 2))
        self.assertEqual(cuts.removed_words(src, kept, dict(cut, len=0.0)), ('', 0))     # a jump removes nothing here
        self.assertEqual(cuts.removed_words(src, kept | {('r1', 101.0)}, cut), ('so', 1))   # a word the rough uses elsewhere is not removed

    def test_long_removal_is_shortened_but_counted(self):
        src = [(float(i), i + 0.5, f'w{i}') for i in range(200)]
        t, n = cuts.removed_words(src, set(), {'src': 'r1', 'from': 0.0, 'to': 200.0, 'len': 200.0})
        self.assertEqual(n, 200)
        self.assertEqual(len(t.split()), 2 * cuts.MAX_SHOWN + 1)
        self.assertTrue(t.startswith('w0 ') and t.endswith(' w199') and ' ... ' in t)

    def test_kind(self):
        tiny = {'jump': None, 'len': 0.1}
        self.assertEqual(cuts.kind_of(tiny, '')[0], 'pause')
        self.assertEqual(cuts.kind_of(tiny, 'um')[0], 'other')
        self.assertEqual(cuts.kind_of({'jump': None, 'len': 1.0}, '')[0], 'other')
        self.assertEqual(cuts.kind_of({'jump': 'source', 'len': 0.0}, '')[0], 'other')
        self.assertEqual(cuts.kind_of({'jump': None, 'len': 2, 'cut_before': {'kind': 'filler', 'why': 'um', 'flag': True, 'ask': '?'}}, 'um'), ('filler', 'um', True, '?'))
        self.assertEqual(cuts.kind_of({'jump': None, 'len': 0.1, 'cut_before': {'kind': 'retake'}}, ''), ('retake', '', False, ''))


class PlanTests(unittest.TestCase):
    def test_short_removal_is_one_piece(self):
        p = cuts_clips.clip_plan({'jump': None, 'src': 'r1', 'from': 50.0, 'to': 58.5, 'len': 8.5, 'at': 41.2}, 600)
        self.assertEqual(p['before'], [{'src': 'r1', 'ss': 47.0, 'dur': 14.5}])
        self.assertEqual(p['after'], {'ss': 38.2, 'dur': 6.0})

    def test_long_removal_shows_its_two_ends(self):
        p = cuts_clips.clip_plan({'jump': None, 'src': 'r1', 'from': 100.0, 'to': 160.0, 'len': 60.0, 'at': 30.0}, 600)
        self.assertEqual(p['before'], [{'src': 'r1', 'ss': 97.0, 'dur': 9.0}, {'src': 'r1', 'ss': 154.0, 'dur': 9.0}])
        self.assertEqual(len(cuts_clips.clip_plan({'jump': None, 'src': 'r1', 'from': 0.0, 'to': 20.0, 'len': 20.0, 'at': 1}, 9)['before']), 1)   # 20 s is not over 20

    def test_jump_shows_both_places(self):
        c = {'jump': 'source', 'src': 'r2', 'from': 7.0, 'to': 7.0, 'len': 0.0, 'at': 19.0, 'prev': {'src': 'r1', 'out': 125.0}}
        self.assertEqual(cuts_clips.clip_plan(c, 100)['before'], [{'src': 'r1', 'ss': 122.0, 'dur': 6.0}, {'src': 'r2', 'ss': 4.0, 'dur': 6.0}])

    def test_clamped_to_the_footage(self):
        p = cuts_clips.clip_plan({'jump': None, 'src': 'r1', 'from': 1.0, 'to': 2.0, 'len': 1.0, 'at': 1.0}, 3.5)
        self.assertEqual(p['before'], [{'src': 'r1', 'ss': 0.0, 'dur': 5.0}])
        self.assertEqual(p['after'], {'ss': 0.0, 'dur': 3.5})
        self.assertEqual(cuts_clips.clip_plan({'jump': None, 'src': 'r1', 'from': 1.0, 'to': 2.0, 'len': 1.0, 'at': 11.0}, 12.0)['after'], {'ss': 8.0, 'dur': 4.0})

    def test_command(self):
        a = {'path': 'a.mkv', 'width': 1920, 'height': 1080, 'acodec': 'aac'}
        one = cuts_clips.ffmpeg_cmd([(a, 1.0, 6.0)], 'o.mp4', (960, 540))
        two = cuts_clips.ffmpeg_cmd([(a, 1.0, 6.0), (a, 90.0, 6.0)], 'o.mp4', (960, 540))
        self.assertIn(encoders.best(), one)                          # the probed encoder, with its clip settings
        self.assertEqual(one[one.index('-c:v') + 1], encoders.best())
        self.assertIn('concat=n=1', ' '.join(one))
        self.assertIn('concat=n=3', ' '.join(two))                    # piece, black, piece
        self.assertEqual(cuts_clips.box_of({'width': 1080, 'height': 1920}, {'width': 1, 'height': 1}), (540, 960))
        self.assertEqual(cuts_clips.box_of(None, {'width': 1920, 'height': 1080}), (960, 540))


class BuildTests(unittest.TestCase):
    def test_document(self):
        e = edlmod.new(30, 640, 360, SRC)
        for it in make_items():
            edlmod.add(e, it['kind'], it['len'], **{k: v for k, v in it.items() if k not in ('kind', 'len')})
        rough = [[0.0, 1.0, 'one', 'r1', 100.0], [13.0, 14.0, 'two', 'r1', 113.0], [14.0, 15.0, 'three', 'r1', 120.0]]
        src = {'r1': [(113.0, 114.0, 'two'), (116.0, 117.0, 'gone'), (120.0, 121.0, 'three')]}
        d = cuts.build(e, rough, src)
        self.assertEqual([c['id'] for c in d['cuts']], ['c1', 'c2', 'c3'])
        c1 = d['cuts'][0]
        self.assertEqual((c1['kind'], c1['flag'], c1['ask'], c1['removed'], c1['before'], c1['after']), ('retake', True, 'which take?', 'gone', 'one two', 'three'))
        self.assertEqual(d['cuts'][1]['jump'], 'source')
        self.assertEqual(d['sped'], [])
        json.dumps(d)


def have_ffmpeg():
    try:
        return subprocess.run(['ffmpeg', '-version'], capture_output=True).returncode == 0
    except OSError:
        return False


def tiny_workshop(td):
    """video/ with a 40 s source (a test picture and a tone) and a rough built from three parts of it (2-8, 14-20, 30-34)."""
    v = os.path.join(td, 'ws', 'video')
    os.makedirs(os.path.join(v, 'footage'))
    os.makedirs(os.path.join(v, 'out', 'work'))
    ff = ['ffmpeg', '-v', 'error', '-y']
    a_mp4 = os.path.join(v, 'footage', 'a.mp4')
    subprocess.run([*ff, '-f', 'lavfi', '-i', 'testsrc=s=640x360:r=30:d=40', '-f', 'lavfi', '-i', 'sine=f=300:d=40', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', a_mp4], check=True)
    parts = [(2.0, 8.0), (14.0, 20.0), (30.0, 34.0)]
    e = edlmod.new(30, 640, 360, {'r1': {'file': 'footage/a.mp4', 'words': 'out/work/w.tsv'}})
    for n, (a, b) in enumerate(parts, 1):
        extra = {'cut_before': {'kind': 'retake', 'why': 'twice', 'flag': True, 'ask': 'keep?'}} if n == 2 else {}
        edlmod.add(e, 'S', b - a, beat=n, src='r1', src_in=a, src_out=b, **extra)
    edlmod.write(os.path.join(v, 'out', 'edl.json'), e)
    ins, fl = [], []
    for n, (a, b) in enumerate(parts):
        ins += ['-ss', str(a), '-t', str(b - a), '-i', a_mp4]
        fl.append(f'[{n}:v:0][{n}:a:0]')
    subprocess.run([*ff, *ins, '-filter_complex', ''.join(fl) + 'concat=n=3:v=1:a=1[v][a]', '-map', '[v]', '-map', '[a]', '-r', '30', '-c:v', 'libx264', '-preset', 'ultrafast',
                    '-pix_fmt', 'yuv420p', '-c:a', 'aac', os.path.join(v, 'out', 'rough.mp4')], check=True)
    with open(os.path.join(v, 'out', 'work', 'w.tsv'), 'w') as f:
        for i, w in enumerate(['alpha', 'beta', 'gamma', 'delta', 'one', 'two', 'three', 'four']):
            f.write(f'{1.0 + i * 4:.2f}\t{1.5 + i * 4:.2f}\t{w}\n')           # at 1, 5, 9, 13, 17, 21, 25, 29 s
    return v


@unittest.skipUnless(have_ffmpeg(), 'no ffmpeg')
class ClipTests(unittest.TestCase):
    def test_run_makes_clips_once(self):
        with tempfile.TemporaryDirectory() as td:
            v = tiny_workshop(td)
            cut = Cut(v)
            doc = cuts.run_cuts(cut)
            self.assertEqual(len(doc['cuts']), 2)
            out = read_json(os.path.join(v, 'out', 'cuts.json'))
            self.assertNotIn('plan', out['cuts'][0])
            c = out['cuts'][0]
            self.assertEqual((c['at'], c['from'], c['to'], c['kind'], c['flag']), (6.0, 8.0, 14.0, 'retake', True))
            self.assertEqual(c['removed'], 'gamma delta')                      # 9 s and 13 s are inside 8..14; 5 s and 17 s are kept
            self.assertEqual((c['before'], c['after']), ('beta', 'one'))
            for c in out['cuts']:
                for k in ('before', 'after'):
                    i = probe(os.path.join(v, *c['clips'][k].split('/')))
                    self.assertEqual((i['vcodec'], i['height']), ('h264', 540))
                    self.assertTrue(i['duration'] > 2)
            clip = lambda c, k: os.path.join(v, *out['cuts'][c]['clips'][k].split('/'))
            self.assertAlmostEqual(probe(clip(0, 'before'))['duration'], 12.0, delta=0.25)     # 5..17: 3 + 6 + 3
            self.assertAlmostEqual(probe(clip(0, 'after'))['duration'], 6.0, delta=0.25)
            d = os.path.join(cut.work, 'cuts')
            stamp = {f: os.stat(os.path.join(d, f)).st_mtime_ns for f in os.listdir(d)}
            cuts.run_cuts(cut)                                                   # a re-run makes nothing
            self.assertEqual(stamp, {f: os.stat(os.path.join(d, f)).st_mtime_ns for f in os.listdir(d)})
            os.remove(os.path.join(d, 'c2-after.mp4'))
            e = edlmod.load(cut.edl)
            made, kept, problems = cuts_clips.make_clips(cut, e, cuts.build(e, [], {}))
            self.assertEqual((made, kept, problems), (1, 3, []))                 # only the missing one

    def test_missing_source_is_a_problem_not_an_error(self):
        with tempfile.TemporaryDirectory() as td:
            v = tiny_workshop(td)
            os.remove(os.path.join(v, 'footage', 'a.mp4'))
            doc = cuts.run_cuts(Cut(v))
            self.assertEqual(len(doc['cuts']), 2)
            self.assertNotIn('before', doc['cuts'][0]['clips'])
            self.assertIn('after', doc['cuts'][0]['clips'])                    # the rough is still there

    def test_no_clips_flag(self):
        with tempfile.TemporaryDirectory() as td:
            v = tiny_workshop(td)
            self.assertEqual(cuts.main(['--video', v, '--no-clips']), 0)
            self.assertFalse(os.path.exists(os.path.join(v, 'out', 'work', 'cuts')))
            self.assertEqual(read_json(os.path.join(v, 'out', 'cuts.json'))['cuts'][0]['clips'], {})


@unittest.skipUnless(have_ffmpeg(), 'no ffmpeg')
class HandoverTests(unittest.TestCase):
    def test_a_failing_cut_list_never_fails_the_handover(self):
        with tempfile.TemporaryDirectory() as td:
            v = tiny_workshop(td)
            real = cuts.run_cuts

            def boom(*a, **k):
                raise RuntimeError('boom')
            cuts.run_cuts = boom
            try:
                self.assertEqual(handover.main(['--video', v, '--no-scenes']), 0)
            finally:
                cuts.run_cuts = real
            self.assertTrue(os.path.isfile(os.path.join(v, 'out', 'rough.json')))
            with open(os.path.join(v, 'out', 'work', 'pipeline.log'), encoding='utf-8') as f:
                self.assertIn('WARNING: the cut list', f.read())

    def test_no_cuts_flag(self):
        with tempfile.TemporaryDirectory() as td:
            v = tiny_workshop(td)
            self.assertEqual(handover.main(['--video', v, '--no-scenes', '--no-cuts']), 0)
            self.assertFalse(os.path.exists(os.path.join(v, 'out', 'cuts.json')))


if __name__ == '__main__':
    unittest.main(verbosity=1)
