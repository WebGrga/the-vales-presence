"""Tests of the pure parts of the pipeline:  python test_pipeline.py   (no GPU, no Remotion, no recordings needed)"""
import copy
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import captions
import compose
import edl as edlmod
import encoders
import pipelib
import events as ev
import sfx
import tmap
import windows

SRC = {'r1': {'file': 'footage/a.mkv', 'words': 'work/w.tsv'}}


def make_edl():
    e = edlmod.new(60, 1920, 1080, SRC)
    edlmod.add(e, 'S', 10.0, beat=1, src='r1', src_in=100.0, src_out=110.0)
    edlmod.add(e, 'R', 2.0, beat=2, pic_src='r1', pic_in=300.0, pic_out=306.0)
    edlmod.add(e, 'S', 5.0, beat=3, src='r1', src_in=200.0, src_out=205.0)
    return e


class EdlTests(unittest.TestCase):
    def test_valid(self):
        self.assertEqual(edlmod.validate(make_edl()), [])
        self.assertEqual(make_edl()['total'], 17.0)

    def test_gap_and_unknown_source(self):
        e = make_edl()
        e['items'][2]['at'] = 13.0
        e['items'].append({'kind': 'S', 'at': 17.0, 'len': 1, 'src': 'zz', 'src_in': 0, 'src_out': 1})
        bad = ' '.join(edlmod.validate(e))
        self.assertIn('back to back', bad)
        self.assertIn('zz', bad)

    def test_migrate_ramp(self):
        old = {'total': 3.0, 'items': [{'kind': 'ramp', 'src': 'r1', 'src_in': 1, 'src_out': 4, 'speed': 3, 'at': 0, 'len': 1.0},
                                       {'kind': 'endcard', 'at': 1.0, 'len': 2.0}]}
        m = edlmod.migrate(old, 60, 1920, 1080, SRC)
        self.assertEqual(edlmod.validate(m), [])
        self.assertNotIn('src', m['items'][0])
        self.assertEqual(m['items'][0]['pic_in'], 1)


class TmapTests(unittest.TestCase):
    def setUp(self):
        self.T = tmap.TMap(make_edl())

    def test_map(self):
        self.assertEqual(self.T.m('r1', 103.0), 3.0)
        self.assertEqual(self.T.m('r1', 99.97), 0.0)           # inside the 0.05 slack
        self.assertEqual(self.T.m('r1', 150.0), 12.0)          # a gap: the next kept part
        self.assertEqual(self.T.m('r1', 150.0, edge='end'), 10.0)   # ... or the end of the previous one
        with self.assertRaises(ValueError):
            self.T.m('r1', 500.0)

    def test_ramp_has_no_sound(self):
        with self.assertRaises(ValueError):
            self.T.m('r1', 301.0)

    def test_beat(self):
        self.assertEqual(self.T.beat(3), 12.0)
        self.assertEqual(self.T.beat(3, True), 17.0)

    def test_words(self):
        w = {'r1': [(99.0, 100.2, 'cut'), (101.0, 101.5, 'kept'), (109.99, 110.4, 'edge'), (150.0, 151.0, 'gone'), (200.5, 201.0, 'two')]}
        out = self.T.map_words(w)
        names = [x[2] for x in out]
        self.assertIn('kept', names)
        self.assertNotIn('gone', names)
        k = out[names.index('kept')]
        self.assertAlmostEqual(k[0], 1.0)
        self.assertAlmostEqual(out[names.index('two')][0], 12.5)


def make_doc():
    return {'version': 1, 'format': 'long', 'fps': 60, 'width': 1920, 'height': 1080, 'duration': 100.0, 'sfx': [{'t': 5, 'file': 'pop', 'vol': 0.2}],
            'events': [
                {'id': 'L1', 'kind': 'text', 'at': 2.0, 'end': 4.0, 'comp': 'Label', 'props': {'text': 'HELLO'}, 'sfx': {'file': 'pop', 'vol': 0.1}},
                {'id': 'R1', 'kind': 'effect', 'at': 4.8, 'end': 6.0, 'comp': 'Ring', 'props': {'box': [1, 2, 3, 4]}, 'what': 'ring'},
                {'id': 'L2', 'kind': 'text', 'at': 50.0, 'end': 52.0, 'comp': 'Label', 'props': {'text': 'LATER'}},
                {'id': 'Z1', 'kind': 'zoom', 'at': 20.0, 'end': 30.0, 'zoom': 1.5, 'x': 576, 'y': 100},
                {'id': 'C1', 'kind': 'caption', 'at': 60.0, 'end': 62.0, 'words': [[60.05, 60.4, 'Hello'], [60.5, 61.0, 'there']]},
                {'id': 'B1', 'kind': 'zoom', 'at': 70.0, 'end': 80.0, 'zoom': 1.5, 'render': False, 'what': 'baked into the rough'},
            ]}


class EventTests(unittest.TestCase):
    def test_valid(self):
        self.assertEqual(ev.validate(make_doc()), [])

    def test_problems(self):
        d = make_doc()
        d['events'].append({'id': 'L1', 'kind': 'text', 'at': 1, 'end': 2, 'comp': 'Label'})
        d['events'].append({'id': 'Z2', 'kind': 'zoom', 'at': 25.0, 'end': 28.0, 'zoom': 2.0, 'x': 0, 'y': 0})
        d['events'].append({'id': 'T9', 'kind': 'text', 'at': 90, 'end': 120, 'comp': 'Label'})
        d['events'].append({'id': 'X', 'kind': 'banner', 'at': 1, 'end': 2})
        d['events'].append({'id': 'Z3', 'kind': 'zoom', 'at': 90, 'end': 95, 'zoom': 1.5, 'x': 1500, 'y': 0})
        bad = ' '.join(ev.validate(d))
        for s in ('used twice', 'overlaps zoom', 'rough is 100', 'banner', 'falls outside'):
            self.assertIn(s, bad)

    def test_timeline_format(self):
        t = ev.timeline(make_doc())
        self.assertEqual(set(t), {'format', 'events'})
        self.assertEqual(t['format'], 'long')
        kinds = [e['kind'] for e in t['events']]
        self.assertEqual(kinds, ['text', 'effect', 'zoom', 'text', 'caption', 'zoom'])
        z = [e for e in t['events'] if e['kind'] == 'zoom'][0]
        self.assertEqual(z['zoom'], 1.5)
        cap = [e for e in t['events'] if e['kind'] == 'caption'][0]
        self.assertEqual(cap['text'], 'Hello there')

    def test_pace_override(self):
        d = make_doc()
        d['events'][0]['pace'] = [{'at': 2, 'end': 3, 'kind': 'text', 'text': 'a', 'what': 'x'}, {'at': 3, 'end': 4, 'kind': 'effect', 'what': 'y'}]
        t = ev.timeline(d)
        self.assertEqual(len([e for e in t['events'] if e['at'] in (2, 3)]), 2)

    def test_sfx_cues(self):
        c = sfx.cues(make_doc())
        self.assertEqual([x['t'] for x in c], [2.0, 5])


class WindowTests(unittest.TestCase):
    def test_merge_pad_and_clamp(self):
        ws = windows.plan(make_doc(), 'code')
        self.assertEqual(len(ws), 2)                                  # L1 and R1 (0.8 s apart) merge; L2 alone; zoom/caption/baked make none
        self.assertEqual((ws[0]['start'], ws[0]['end']), (1.5, 6.5))
        self.assertEqual(ws[0]['events'], ['L1', 'R1'])
        self.assertEqual(ws[0]['frames'], 300)
        d = make_doc()
        d['events'][0].update(at=0.1, end=0.3)
        self.assertEqual(windows.plan(d, 'code')[0]['start'], 0.0)

    def test_hash_changes_only_for_the_edited_window(self):
        a = windows.plan(make_doc(), 'code')
        d = make_doc()
        d['events'][2]['props']['text'] = 'CHANGED'
        b = windows.plan(d, 'code')
        self.assertEqual(a[0]['hash'], b[0]['hash'])
        self.assertNotEqual(a[1]['hash'], b[1]['hash'])
        d = make_doc()
        d['events'][2]['what'] = 'pace words only'; d['events'][2]['sfx'] = {'file': 'pop', 'vol': 0.5}
        self.assertEqual(a[1]['hash'], windows.plan(d, 'code')[1]['hash'])          # words for the pace check and sound do not change the picture
        self.assertNotEqual(a[0]['hash'], windows.plan(make_doc(), 'other code')[0]['hash'])
        self.assertNotEqual(a[0]['hash'], windows.plan(make_doc(), 'code', proof=True)[0]['hash'])

    def test_proof_frames_even(self):
        w = windows.plan(make_doc(), 'code', proof=True)[0]
        self.assertEqual(w['a'] % 2, 0)
        self.assertEqual(w['frames'], (w['b'] - w['a'] + 1) // 2)


class RenderLayerTests(unittest.TestCase):
    def test_zoom_filter(self):
        d = make_doc()
        f = compose.zoom_filter(d, [d['events'][3]])
        self.assertIn('perspective=', f)
        self.assertIn('eval=frame', f)
        self.assertIn("x0='", f)
        self.assertEqual(compose.zoom_filter(d, []), '')

    @unittest.skipUnless(subprocess.run(['ffmpeg', '-version'], capture_output=True).returncode == 0, 'no ffmpeg')
    def test_zoom_filter_runs(self):
        d = make_doc()
        d['events'][3].update(at=0.2, end=1.2, x=100, y=50)
        with tempfile.TemporaryDirectory() as td:
            out = os.path.join(td, 'o.mp4')
            r = subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=1920x1080:r=60:d=1.5', '-vf',
                                compose.zoom_filter(d, [d['events'][3]]), '-frames:v', '60', '-c:v', 'libx264', '-preset', 'ultrafast', out], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)


class CaptionTests(unittest.TestCase):
    def test_ass(self):
        a = captions.build(make_doc())
        self.assertIn('PlayResX: 1920', a)
        self.assertIn('Dialogue: 0,0:01:00.00', a)
        self.assertEqual(a.count('Dialogue: 1,'), 2)          # one per word state
        self.assertIsNone(captions.build({'format': 'long', 'width': 1, 'height': 1, 'events': []}))


class ConfigTests(unittest.TestCase):
    """pipelib's config: environment names, the lock file, the workshop, sounds and fonts."""

    def setUp(self):
        self.saved = {k: os.environ.pop(k) for k in list(os.environ) if k.startswith('PRESENCE_')}
        self.local = {}
        self.orig_local = pipelib._local_config
        pipelib._local_config = lambda: self.local          # the machine's own presence.local.json must not change these tests

    def tearDown(self):
        pipelib._local_config = self.orig_local
        for k in [k for k in os.environ if k.startswith('PRESENCE_')]:
            del os.environ[k]
        os.environ.update(self.saved)

    def test_env_name(self):
        self.assertEqual(pipelib.env('COMPOSE_JOBS', '3'), '3')
        os.environ['PRESENCE_COMPOSE_JOBS'] = '7'
        self.assertEqual(pipelib.env('COMPOSE_JOBS', '3'), '7')

    def test_local_config_file(self):
        self.local = {'compose_jobs': '5', 'locks': '.other/locks.json', 'sounds': '~/s'}
        self.assertEqual(pipelib.env('COMPOSE_JOBS', '3'), '5')
        os.environ['PRESENCE_COMPOSE_JOBS'] = '7'
        self.assertEqual(pipelib.env('COMPOSE_JOBS', '3'), '7')          # the environment wins
        self.assertEqual(pipelib.sound_dirs()[0], os.path.expanduser('~/s'))
        with tempfile.TemporaryDirectory() as d:
            v = self.workshop(d)
            self.assertEqual(pipelib.Cut(v).locks, os.path.join(os.path.dirname(v), '.other', 'locks.json'))

    def workshop(self, d):
        v = os.path.join(d, 'proj', 'video')
        os.makedirs(os.path.join(v, 'out'))
        os.makedirs(os.path.join(v, 'footage'))
        return v

    def test_locks(self):
        with tempfile.TemporaryDirectory() as d:
            v = self.workshop(d)
            ws = os.path.dirname(v)
            c = pipelib.Cut(v)
            self.assertEqual(c.locks, os.path.join(ws, '.presence', 'locks.json'))
            self.assertEqual(c.lock_files, [])
            os.makedirs(os.path.join(ws, '.presence'))
            with open(os.path.join(ws, '.presence', 'locks.json'), 'w') as f:
                f.write('{"locks": {}}')
            self.assertEqual(pipelib.Cut(v).lock_files, [os.path.join(ws, '.presence', 'locks.json')])
            other = os.path.join(d, 'elsewhere.json')
            os.environ['PRESENCE_LOCKS'] = other
            self.assertEqual(pipelib.Cut(v).locks, other)

    def test_workshop_from_env(self):
        with tempfile.TemporaryDirectory() as d:
            v = self.workshop(d)
            os.environ['PRESENCE_VIDEO'] = v
            self.assertEqual(pipelib.find_video(), os.path.abspath(v))
            os.environ['PRESENCE_VIDEO'] = os.path.join(d, 'nowhere')
            self.assertEqual(pipelib.find_video(), os.path.join(d, 'nowhere'))
            self.assertEqual(pipelib.find_video(v), os.path.abspath(v))          # --video wins

    def test_sounds_workshop_first_then_kit(self):
        with tempfile.TemporaryDirectory() as d:
            v = self.workshop(d)
            c = pipelib.Cut(v)
            extra = os.path.join(d, 'sounds')
            os.makedirs(extra)
            os.environ['PRESENCE_SOUNDS'] = extra
            dirs = pipelib.sound_dirs(c)
            self.assertEqual(dirs, [os.path.join(v, 'assets'), os.path.join(v, 'public'), extra, os.path.join(pipelib.KIT, 'sounds')])
            with open(os.path.join(extra, 'zap.wav'), 'wb') as f:
                f.write(b'x')
            self.assertEqual(pipelib.asset(c, 'zap'), os.path.join(extra, 'zap.wav'))
            os.makedirs(os.path.join(v, 'assets'))
            with open(os.path.join(v, 'assets', 'zap.wav'), 'wb') as f:
                f.write(b'y')
            self.assertEqual(pipelib.asset(c, 'zap'), os.path.join(v, 'assets', 'zap.wav'))       # the workshop's own sound wins
            with self.assertRaises(FileNotFoundError):
                pipelib.asset(c, 'no-such-sound')

    def test_fonts(self):
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, 'sub'))
            with open(os.path.join(d, 'sub', 'Some-Font.ttf'), 'wb') as f:
                f.write(b'x')
            os.environ['PRESENCE_FONTS'] = d
            dirs = pipelib.font_dirs()
            self.assertEqual(dirs[:2], [d, os.path.join(pipelib.KIT, 'fonts')])
            self.assertEqual(pipelib.find_font('some-font.TTF'), os.path.join(d, 'sub', 'Some-Font.ttf'))     # nested, any case
            self.assertIsNone(pipelib.find_font('no-such-font.ttf'))

    def test_no_absolute_home_paths_in_the_engine(self):
        here = os.path.dirname(os.path.abspath(__file__))
        bad = []
        needles = ('C:/Users/', 'C:' + chr(92) + 'Users', '/home/', '/Users/')
        for root, dirs, files in os.walk(here):
            dirs[:] = [x for x in dirs if x not in ('node_modules', '__pycache__')]
            for n in files:
                if n.endswith(('.py', '.mjs', '.ts', '.tsx', '.md')) or n == 'package.json':
                    with open(os.path.join(root, n), encoding='utf-8', errors='replace') as f:
                        text = f.read()
                    bad += [f'{n}: {x}' for x in needles if x in text and n != os.path.basename(__file__)]
        self.assertEqual(bad, [])


class EncoderTests(unittest.TestCase):
    def test_profiles_cover_every_encoder(self):
        for p, table in encoders.PROFILES.items():
            self.assertEqual(sorted(table), sorted(encoders.ORDER), p)
            for name, a in table.items():
                self.assertEqual(a[:2], ['-c:v', name], (p, name))

    def test_nvenc_settings_are_the_measured_ones(self):
        # cache keys of rough pieces and final chunks hold these lists: changing them invalidates every cache made on an NVIDIA machine
        self.assertEqual(encoders.PROFILES['final']['h264_nvenc'], ['-c:v', 'h264_nvenc', '-preset', 'p6', '-tune', 'hq', '-rc', 'vbr', '-cq', '19', '-b:v', '0',
                                                                    '-spatial-aq', '1', '-temporal-aq', '1', '-rc-lookahead', '32', '-bf', '3', '-profile:v', 'high', '-pix_fmt', 'yuv420p'])
        self.assertEqual(encoders.PROFILES['rough']['h264_nvenc'], ['-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'hq', '-rc', 'vbr', '-cq', '22', '-b:v', '0',
                                                                    '-bf', '0', '-g', '120', '-forced-idr', '1'])
        self.assertEqual(encoders.PROFILES['rough']['libx264'], ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-bf', '0', '-g', '120'])
        self.assertEqual(compose.NVENC, encoders.PROFILES['final']['h264_nvenc'])

    def test_forced_encoder(self):
        saved = {k: os.environ.pop(k) for k in ('PRESENCE_ENCODER',) if k in os.environ}
        try:
            for value, want in (('cpu', 'libx264'), ('libx264', 'libx264'), ('h264_qsv', 'h264_qsv')):
                os.environ['PRESENCE_ENCODER'] = value
                encoders.best.cache_clear()
                self.assertEqual(encoders.best(), want)
                self.assertEqual(encoders.args('rough')[1], want)
            self.assertEqual(encoders.best(cpu=True), 'libx264')
            self.assertEqual(encoders.closed_gop('h264_nvenc'), ['-forced-idr', '1', '-flags', '+cgop'])
            self.assertEqual(encoders.closed_gop('libx264'), ['-flags', '+cgop'])
            self.assertEqual(encoders.hwaccel('libx264'), [])
        finally:
            os.environ.pop('PRESENCE_ENCODER', None)
            os.environ.update(saved)
            encoders.best.cache_clear()

    def test_every_working_encoder_encodes_every_profile(self):
        here = [n for n in encoders.ORDER if encoders.works(n)]
        self.assertIn('libx264', here)
        for name in here:
            for p in encoders.PROFILES:
                with self.subTest(encoder=name, profile=p):
                    r = subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=0.5', '-vf', 'format=yuv420p',
                                        *encoders.args(p, name), *(encoders.closed_gop(name) if p == 'final' else []), '-f', 'mp4', '-y', os.devnull],
                                       capture_output=True, text=True)
                    self.assertEqual(r.returncode, 0, r.stderr[-400:])


if __name__ == '__main__':
    unittest.main(verbosity=1)
