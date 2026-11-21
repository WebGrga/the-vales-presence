"""The default rough builder: any edl.json -> out/rough.mp4. A template with its own build (build.py) may keep it; this one needs nothing but the edit list.

    python build_rough.py [--video <video/>] [--out <file>] [--jobs 3] [--cpu] [--no-level] [--force]

Reads  video/out/edl.json (format: edl.py) and the recordings it names (`file`: relative to video/, or absolute; the sound is the first audio track unless the source says "track": N).
Item kinds it builds (anything else in an item is ignored):
  a piece of a source   `src`, `src_in`, `src_out` (speed 1): sound and picture from the recording; the picture starts at `pic_in` (default src_in) of `pic_src` (default src), so a
                        split edit (sound here, picture there) is just a `pic_in` of its own; `vf` = an ffmpeg filter for the picture (a crop, then scaled back to the size).
  a sped wait           no `src`; `pic_src`, `pic_in`, `pic_out` and `speed` > 1: the picture from pic_in..pic_out played faster (setpts), the sound muted. `len` = (pic_out - pic_in) / speed.
  a held still          no `src`; `pic_src` + `pic_in` (no pic_out): that one frame held for `len`, muted.
  a blank card          nothing of those: a plain `color` (default 0x141414), muted.
Picture: every piece is cut at frames at the edl's fps and size (a different source size is scaled and padded), encoded ONCE (the probed encoder, encoders.py: NVENC, QSV, AMF, VideoToolbox or x264; --cpu = x264) into out/work/rough-seg/<hash>.mp4
(the hash covers the recording, the frames and the settings: a re-run of an unchanged piece costs nothing), joined with -c copy. Sound: pieces joined with 12 ms equal-power crossfades
(rough_audio.py) inside the room tone. out/work/rough-cat.mp4 = that picture + the joined sound (lossless); then level.py makes out/rough.mp4 from it, once: the ONE loudness pass.
Refuses to overwrite a handed-over rough (a lock file or out/rough.json exists) unless --out names another file. Prints how the length compares with the edit list's `total`.
"""
import argparse
import concurrent.futures as cf
import os
import subprocess
import sys
import threading
import time
from fractions import Fraction

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import edl as edlmod
import encoders
import level as levelmod
import rough_audio as ra
from joins import locked, path_of
from pipelib import Cut, canon, fail, probe, say, sha_short, step, write_json

VERSION = 1
BLANK = '0x141414'


def rate(fps):
    f = Fraction(fps).limit_denominator(1001)
    return f'{f.numerator}/{f.denominator}' if f.denominator != 1 else str(f.numerator)


def classify(it):
    """('src' | 'wait' | 'hold' | 'blank', None) or (None, why not)."""
    if it.get('src'):
        if 'src_in' not in it or 'src_out' not in it:
            return None, 'has a src but no src_in/src_out'
        if abs(it.get('speed', 1) - 1) > 1e-6:
            return None, 'plays source sound at a speed other than 1: a sped stretch has no `src` (use pic_src, pic_in, pic_out, speed)'
        return 'src', None
    if it.get('pic_src') and 'pic_in' in it:
        if 'pic_out' in it or it.get('speed', 1) > 1:
            if 'pic_out' not in it:
                return None, 'is a sped wait with no pic_out'
            return 'wait', None
        return 'hold', None
    return 'blank', None


def encoder(cpu):
    """(the rough profile's arguments, the encoder's name): the probed encoder (encoders.py), x264 when `cpu`."""
    name = encoders.best(cpu)
    return encoders.args('rough', name), name


class Build:
    def __init__(self, cut, edl, cpu, jobs):
        self.cut, self.edl, self.jobs = cut, edl, jobs
        self.fps, self.w, self.h = edl['fps'], edl['width'], edl['height']
        self.enc, self.enc_name = encoder(cpu)
        self.seg_dir = os.path.join(cut.work, 'rough-seg')
        os.makedirs(self.seg_dir, exist_ok=True)
        self.files, self.info = {}, {}
        self.lock = threading.Lock()
        self.hits = self.made = 0

    def src(self, key):
        if key not in self.edl['sources']:
            fail(self.cut, f'the edit list names source "{key}" that is not in "sources"')
        if key not in self.files:
            f = path_of(self.cut, self.edl['sources'][key]['file'])
            if not os.path.isfile(f):
                fail(self.cut, f'source "{key}": the file {f} is missing')
            self.files[key] = f
            self.info[key] = probe(f)
        return self.files[key], self.info[key]

    def vfilter(self, key, it, kind, n):
        """The picture filter chain of a piece and the ffmpeg input arguments that go with it."""
        fps = rate(self.fps)
        f = []
        if kind == 'wait':
            f.append(f'setpts=PTS/{(it["pic_out"] - it["pic_in"]) / it["len"]:.6f}')
        f.append(f'fps={fps}')
        if kind == 'hold':
            f += ['trim=end_frame=1', 'loop=loop=-1:size=1', f'setpts=N/({fps})/TB']
        if kind != 'blank':
            _, inf = self.src(it.get('pic_src') or it['src'])
            if (inf['width'], inf['height']) != (self.w, self.h) and not it.get('vf'):
                f.append(f'scale={self.w}:{self.h}:force_original_aspect_ratio=decrease:flags=lanczos,pad={self.w}:{self.h}:(ow-iw)/2:(oh-ih)/2')
        if it.get('vf'):
            f.append(it['vf'])
            f.append(f'scale={self.w}:{self.h}:flags=lanczos')
        f += ['setsar=1', 'format=yuv420p', f'tpad=stop_mode=clone:stop={max(30, n)}' if kind != 'blank' else 'null']
        return ','.join(f)

    def segment(self, i, it, kind):
        n = max(1, int(round(it['len'] * self.fps)))
        psrc = it.get('pic_src') or it.get('src')
        d = {'v': VERSION, 'kind': kind, 'n': n, 'fps': self.fps, 'w': self.w, 'h': self.h, 'enc': self.enc, 'vf': it.get('vf'), 'color': it.get('color', BLANK)}
        if kind != 'blank':
            f, inf = self.src(psrc)
            st = os.stat(f)
            t0 = it['pic_in'] if 'pic_in' in it else it['src_in']
            d.update(file=os.path.abspath(f), size=st.st_size, mtime=int(st.st_mtime), t0=round(t0, 4))
            if kind == 'wait':
                d['t1'] = round(it['pic_out'], 4)
        key = sha_short(d, 20)
        out = os.path.join(self.seg_dir, key + '.mp4')
        if os.path.isfile(out):
            with self.lock:
                self.hits += 1
            return out, n
        cmd = ['ffmpeg', '-v', 'error', '-y']
        if kind == 'blank':
            cmd += ['-f', 'lavfi', '-i', f'color=c={it.get("color", BLANK)}:s={self.w}x{self.h}:r={rate(self.fps)}']
        else:
            cmd += ['-ss', f'{t0:.4f}']
            if kind == 'wait':
                cmd += ['-t', f'{it["pic_out"] - it["pic_in"] + 1:.4f}']
            cmd += ['-i', f]
        tmp = out + f'.{os.getpid()}.{i}.tmp.mp4'
        cmd += ['-vf', self.vfilter(psrc, it, kind, n), '-an', '-frames:v', str(n), *self.enc, '-r', rate(self.fps), '-video_track_timescale', '15360', tmp]
        r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
        if r.returncode:
            raise RuntimeError(f'item {i} ({kind}): ffmpeg failed: {r.stderr[-600:]}')
        got = probe(tmp).get('nb_frames')
        if got is not None and got != n:
            raise RuntimeError(f'item {i} ({kind}): made {got} frames, wanted {n}')
        os.replace(tmp, out)
        with self.lock:
            self.made += 1
        return out, n

    def audio(self, pl):
        """The sound of the whole cut, from the recordings."""
        cache = {}

        def fetch(key, t0, count):
            f, inf = self.src(key)
            track = self.edl['sources'][key].get('track', 0)
            lead = 0
            if t0 < 0:
                lead, t0 = int(round(-t0 * ra.SR)), 0.0
            r = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{t0:.5f}', '-i', f, '-vn', '-map', f'0:a:{track}', '-ac', '2', '-ar', str(ra.SR),
                                '-t', f'{(count - lead) / ra.SR + 0.01:.5f}', '-f', 'f32le', '-'], capture_output=True)
            if r.returncode:
                raise RuntimeError(f'cannot read the sound of {f}: {r.stderr[-300:].decode(errors="replace")}')
            a = np.frombuffer(r.stdout, dtype=np.float32).reshape(-1, 2)
            out = np.zeros((count, 2), dtype=np.float32)
            m = min(len(a), count - lead)
            out[lead:lead + m] = a[:m]
            return out

        # the reads run in threads first (ffmpeg does the work), then the pure mix
        wanted = [(p['src'], p['t0'] - p['hl'] / ra.SR, p['hl'] + p['n'] + p['hr']) for p in pl if p['src']]
        with cf.ThreadPoolExecutor(self.jobs) as ex:
            got = list(ex.map(lambda w: fetch(*w), wanted))
        for w, a in zip(wanted, got):
            cache[(w[0], round(w[1], 6), w[2])] = a
        return ra.render(pl, lambda s, t0, c: cache[(s, round(t0, 6), c)])


def build(cut, a):
    edl = edlmod.load(cut.edl)
    bad = edlmod.validate(edl)
    if bad:
        fail(cut, 'edl.json is not valid:\n  ' + '\n  '.join(bad))
    B = Build(cut, edl, a.cpu, a.jobs)
    kinds = []
    for i, it in enumerate(edl['items']):
        k, why = classify(it)
        if k is None:
            fail(cut, f'item {i} ({it.get("kind")}) {why}')
        kinds.append(k)
    with step(cut, 'build-rough', items=len(kinds), encoder=B.enc_name) as d:
        t0 = time.time()
        if a.force:
            for f in os.listdir(B.seg_dir):
                os.remove(os.path.join(B.seg_dir, f))
        for it in edl['items']:                              # probe the recordings once, before the threads
            for k in ('src', 'pic_src'):
                if it.get(k):
                    B.src(it[k])
        with cf.ThreadPoolExecutor(a.jobs) as ex:
            segs = list(ex.map(lambda x: B.segment(x[0], x[1], kinds[x[0]]), enumerate(edl['items'])))
        frames = sum(n for _, n in segs)
        say(cut, f'pictures: {B.made} pieces encoded ({B.enc_name}), {B.hits} from the cache, {frames} frames, {time.time() - t0:.0f} s')
        pl = ra.plan(edl['items'], edl['fps'])
        t1 = time.time()
        sound = B.audio(pl)
        say(cut, f'sound: {len(sound) / ra.SR:.3f} s joined with {sum(1 for p in pl if p["hl"])} crossfades, {time.time() - t1:.0f} s')
        wav = os.path.join(cut.work, 'rough-cat.wav')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(ra.SR), '-ac', '2', '-i', '-', '-c:a', 'pcm_f32le', wav], input=sound.tobytes(), check=True)
        lst = os.path.join(cut.work, 'rough-seg.txt')
        with open(lst, 'w', encoding='utf-8') as f:
            f.write(''.join(f"file '{p.replace(chr(92), '/')}'\n" for p, _ in segs))
        cat = os.path.join(cut.work, 'rough-cat.mp4')
        r = subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'alac',
                            '-sample_fmt', 's32p', '-movflags', '+faststart', cat], capture_output=True, text=True, encoding='utf-8', errors='replace')
        if r.returncode:
            fail(cut, 'joining the pieces failed: ' + r.stderr[-500:])
        os.remove(wav)
        d.update(cat=cat, frames=frames, encoded=B.made, cached=B.hits)
    out = os.path.abspath(a.out) if a.out else cut.rough
    if not a.no_level:
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with step(cut, 'level-rough'):
            levelmod.level(cat, out)
    info = probe(out if not a.no_level else cat)
    write_json(os.path.join(cut.work, 'rough-build.json'), {'version': VERSION, 'items': len(kinds), 'frames': frames, 'encoder': B.enc_name, 'encoded': B.made, 'cached': B.hits,
                                                            'edl_total': edl['total'], 'rough_seconds': round(info['duration'], 3), 'rough': out})
    diff = info['duration'] - edl['total']
    say(cut, f'rough: {info["duration"]:.3f} s, edit list {edl["total"]:.3f} s ({diff:+.3f} s, {diff * edl["fps"]:+.1f} frames)')
    if abs(diff) > 2.5 / edl['fps'] + 0.02:
        fail(cut, f'the rough is {diff:+.3f} s from the edit list: something was lost or doubled')
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--video'); ap.add_argument('--out', help='write the rough here instead of out/rough.mp4 (allowed on a handed-over cut)')
    ap.add_argument('--jobs', type=int, default=3); ap.add_argument('--cpu', action='store_true', help='x264 instead of the probed hardware encoder')
    ap.add_argument('--no-level', action='store_true', help='stop at out/work/rough-cat.mp4'); ap.add_argument('--force', action='store_true', help='drop the cached pieces first')
    a = ap.parse_args(argv)
    cut = Cut(a.video)
    if locked(cut) and not a.out:
        print('The cut is locked: the rough has been handed over (a lock file or out/rough.json exists), so out/rough.mp4 is not rebuilt. Use --out <file> to build somewhere else.')
        return 2
    return build(cut, a)


if __name__ == '__main__':
    sys.exit(main())
