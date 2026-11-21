"""The clips of the cut list (see cuts.py): the plan of what each cut shows, the ffmpeg command, the cache.

Two clips per cut in video/out/work/cuts/: `cN-before.mp4` (the source around the removal) and `cN-after.mp4` (the rough around the cut).
540p (the short side), 30 fps, H.264 (the probed encoder, encoders.py), AAC, 3 ffmpeg jobs at a time. A clip is made once: work/cuts/keys.json holds a key per file;
a re-run makes only the missing or changed ones, and drops the clips of cuts that are gone.
"""
import concurrent.futures
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import encoders
from pipelib import probe, read_json, run, sha_short, write_json

PAD = 3.0             # seconds of context in a clip
LONG = 20.0           # a removal longer than this shows only its two ends
EDGE = 6.0            # ... this much of each end
GAP = 0.3             # black between two pieces
SHORT_SIDE = 540
FPS = 30
CLIP_VERSION = 1      # bump when the encoding changes: every key changes
CLIPS_DIR = 'cuts'
CLIP_NAME = re.compile(r'^c\d+-(before|after)\.mp4$')


# ---------- pure: the clip plan ----------

def clip_plan(cut, total):
    """{'before': [{'src', 'ss', 'dur'}, ...] (one piece, or two with black between), 'after': {'ss', 'dur'}} for one cut (seconds)."""
    def piece(src, a, b):
        a = max(0.0, a)
        return {'src': src, 'ss': round(a, 3), 'dur': round(max(0.1, b - a), 3)}
    if cut['jump']:
        before = [piece(cut['prev']['src'], cut['prev']['out'] - PAD, cut['prev']['out'] + PAD),
                  piece(cut['src'], cut['from'] - PAD, cut['from'] + PAD)]
    elif cut['len'] > LONG:
        before = [piece(cut['src'], cut['from'] - PAD, cut['from'] + EDGE), piece(cut['src'], cut['to'] - EDGE, cut['to'] + PAD)]
    else:
        before = [piece(cut['src'], cut['from'] - PAD, cut['to'] + PAD)]
    a = max(0.0, cut['at'] - PAD)
    b = min(total, cut['at'] + PAD)
    return {'before': before, 'after': {'ss': round(a, 3), 'dur': round(max(0.1, b - a), 3)}}


# ---------- clips ----------

def src_path(cut, rel):
    """A source file named in edl.json: relative to video/, or absolute."""
    return rel if os.path.isabs(rel) else cut.p(rel)


class Media:
    """What a source file has (cached per file): size, video, audio."""

    def __init__(self, cut, edl):
        self.cut, self.edl, self.info = cut, edl, {}

    def path(self, src):
        if src == 'rough':
            return self.cut.rough
        return src_path(self.cut, self.edl['sources'][src]['file'])

    def get(self, src):
        if src not in self.info:
            p = self.path(src)
            if not os.path.isfile(p):
                self.info[src] = None
            else:
                i = probe(p)
                st = os.stat(p)
                i.update(path=p, bytes=st.st_size, mtime=st.st_mtime_ns)
                self.info[src] = i
        return self.info[src]


def box_of(info, edl):
    """(w, h) of a clip: the short side is 540, the shape that of the first piece's picture (the rough's, when it has none)."""
    w, h = (info.get('width'), info.get('height')) if info and info.get('width') else (edl['width'], edl['height'])
    if w >= h:
        return int(round(SHORT_SIDE * w / h / 2)) * 2, SHORT_SIDE
    return SHORT_SIDE, int(round(SHORT_SIDE * h / w / 2)) * 2


def ffmpeg_cmd(pieces, out, box):
    """One ffmpeg command: each piece of (info, ss, dur) scaled into `box`, joined with 0.3 s of black between, encoded small on the GPU."""
    W, H = box
    cmd = ['ffmpeg', '-hide_banner', '-v', 'error', '-y']
    fc = []
    labels = []
    for i, (info, ss, dur) in enumerate(pieces):
        cmd += ['-ss', f'{ss:.3f}', '-t', f'{dur:.3f}', '-i', info['path']]
        if info.get('width'):
            fc.append(f'[{i}:v:0]scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={FPS},format=yuv420p[v{i}]')
        else:
            fc.append(f'color=c=black:s={W}x{H}:r={FPS}:d={dur:.3f},format=yuv420p[v{i}]')
        if info.get('acodec'):
            fc.append(f'[{i}:a:0]aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur={dur:.3f},atrim=0:{dur:.3f}[a{i}]')
        else:
            fc.append(f'anullsrc=r=48000:cl=stereo:d={dur:.3f}[a{i}]')
        labels.append((f'v{i}', f'a{i}'))
        if i < len(pieces) - 1:
            fc.append(f'color=c=black:s={W}x{H}:r={FPS}:d={GAP},format=yuv420p[vg{i}]')
            fc.append(f'anullsrc=r=48000:cl=stereo:d={GAP}[ag{i}]')
            labels.append((f'vg{i}', f'ag{i}'))
    ins = ''.join(f'[{v}][{a}]' for v, a in labels)
    fc.append(f'{ins}concat=n={len(labels)}:v=1:a=1[v][a]')
    cmd += ['-filter_complex', ';'.join(fc), '-map', '[v]', '-map', '[a]',
            *encoders.args('clip'), '-g', str(FPS),
            '-c:a', 'aac', '-b:a', '80k', '-movflags', '+faststart', '-f', 'mp4', out]
    return cmd


def clip_jobs(cut, edl, doc, media):
    """[(cut id, 'before'|'after', key, [(info, ss, dur)], box)]; a clip whose source file is missing is left out (and named in `missing`)."""
    jobs, missing = [], []
    for c in doc['cuts']:
        plan = c['plan']
        pcs = [(media.get(p['src']), p['ss'], p['dur']) for p in plan['before']]
        if any(x[0] is None for x in pcs):
            missing.append(c['id'])
        else:
            key = sha_short({'v': CLIP_VERSION, 'p': [(i['bytes'], i['mtime'], ss, dur) for i, ss, dur in pcs], 'box': box_of(pcs[0][0], edl)})
            jobs.append((c['id'], 'before', key, pcs, box_of(pcs[0][0], edl)))
        r = media.get('rough')
        if r is None:
            missing.append(c['id'])
        else:
            a = plan['after']
            key = sha_short({'v': CLIP_VERSION, 'rough': (r['bytes'], r['mtime']), 'ss': a['ss'], 'dur': a['dur'], 'box': box_of(r, edl)})
            jobs.append((c['id'], 'after', key, [(r, a['ss'], a['dur'])], box_of(r, edl)))
    return jobs, missing


def make_clips(cut, edl, doc, jobs_n=3):
    """Makes the missing clips; fills each cut's `clips` and `clip_keys`. Returns (made, kept, [problems])."""
    media = Media(cut, edl)
    d = os.path.join(cut.work, CLIPS_DIR)
    os.makedirs(d, exist_ok=True)
    kpath = os.path.join(d, 'keys.json')
    try:
        keys = read_json(kpath)
    except (OSError, ValueError):
        keys = {}
    was = dict(keys)
    jobs, missing = clip_jobs(cut, edl, doc, media)
    problems = [f'{c}: the source file is missing' for c in sorted(set(missing))]
    by_id = {c['id']: c for c in doc['cuts']}
    todo = []
    kept = 0
    for cid, which, key, pcs, box in jobs:
        name = f'{cid}-{which}.mp4'
        if keys.get(name) == key and os.path.isfile(os.path.join(d, name)):
            kept += 1
            by_id[cid]['clips'][which] = f'out/work/{CLIPS_DIR}/{name}'
            by_id[cid].setdefault('clip_keys', {})[which] = key
        else:
            todo.append((cid, which, key, pcs, box, name))

    def one(j):
        cid, which, key, pcs, box, name = j
        tmp = os.path.join(d, f'.{name}.tmp.mp4')
        try:
            run(ffmpeg_cmd(pcs, tmp, box))
            os.replace(tmp, os.path.join(d, name))
            return j, None
        except Exception as e:
            if os.path.exists(tmp):
                os.remove(tmp)
            return j, f'{cid} {which}: {str(e).splitlines()[0][:200]}'

    made = 0
    with concurrent.futures.ThreadPoolExecutor(jobs_n) as ex:
        for j, err in ex.map(one, todo):
            cid, which, key, pcs, box, name = j
            if err:
                problems.append(err)
                keys.pop(name, None)
                continue
            made += 1
            keys[name] = key
            by_id[cid]['clips'][which] = f'out/work/{CLIPS_DIR}/{name}'
            by_id[cid].setdefault('clip_keys', {})[which] = key
    live = {f'{c["id"]}-{w}.mp4' for c in doc['cuts'] for w in ('before', 'after')}
    for f in os.listdir(d):                                  # clips of cuts that are gone
        if CLIP_NAME.match(f) and f not in live:
            os.remove(os.path.join(d, f))
            keys.pop(f, None)
    if keys != was:
        write_json(kpath, keys)
    return made, kept, problems
