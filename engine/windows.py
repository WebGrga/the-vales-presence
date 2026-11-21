"""Which stretches of the cut need Remotion, and which of them are already rendered.

A window is a run of overlay events (those with a comp that Remotion draws) with less than 1 s between them, padded 0.5 s each side and
clamped to the video. Zoom events (ffmpeg) and captions (ASS) never make windows. Each window has a hash of its events (every setting),
its frame range, fps, size and the template's code (remotion/src + public + the Remotion version): the rendered file is
video/out/work/overlays/<hash>.mov (proof: overlays-proof/<hash>.mov), so a re-edit renders only the windows whose hash changed.

    python windows.py [--video <video/>] [--proof]     print the plan: windows, frames, cached or not
"""
import argparse
import hashlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from events import drawn_by
from pipelib import Cut, PIPE, canon, env, read_json, sha_short, write_json

# How a rendered window is stored: Chrome renders PNG frames (alpha), ffmpeg packs them into a lossless alpha .mov. PNG codec chosen by measurement on a
# 1034-frame window: 150 MB, against 1.5 GB for utvideo and 326 MB for qtrle, with the same decode speed. 'prores' = Remotion's own ProRes 4444 encoder
# (the first design: its ffmpeg was the bottleneck, 5.5 fps per window and 1.26 GB per 29 s): PRESENCE_OVERLAY_CODEC=prores. The codec is part of every window's hash.
CODEC = env('OVERLAY_CODEC', 'png')
ENCODERS = {'png': ['-c:v', 'png', '-pix_fmt', 'rgba', '-compression_level', '3'], 'utvideo': ['-c:v', 'utvideo', '-pix_fmt', 'gbrap'],
            'qtrle': ['-c:v', 'qtrle', '-pix_fmt', 'argb']}
MERGE_GAP = 1.0
PAD = 0.5
PROOF_SCALE = 0.5
PROOF_NTH = 2


def code_hash(cut):
    """Hash of everything that decides how a frame looks besides the events: the template's src and public files, the shared Remotion
    files, and the Remotion version (the workshop's own remotion/node_modules, else the engine's). A change to any of them re-renders every window."""
    h = hashlib.sha256()
    roots = [os.path.join(cut.remotion, 'src'), os.path.join(cut.remotion, 'public')]
    for root in roots:
        for d, dirs, files in os.walk(root):
            dirs.sort()
            for f in sorted(files):
                p = os.path.join(d, f)
                h.update(os.path.relpath(p, cut.remotion).replace('\\', '/').encode())
                with open(p, 'rb') as fh:
                    h.update(fh.read())
    for base in (cut.remotion, os.path.join(PIPE, 'remotion')):
        pk = os.path.join(base, 'node_modules', 'remotion', 'package.json')
        if os.path.isfile(pk):
            with open(pk, 'rb') as fh:
                h.update(fh.read())
            break
    return h.hexdigest()[:16]


def visual(e):
    """The part of an event that decides how it looks (what Remotion gets and what the hash covers). Not the pace-check words, not the sound."""
    return {k: e[k] for k in ('id', 'kind', 'comp', 'at', 'end', 'props') if k in e}


def plan(doc, code='', proof=False, pad=PAD, merge_gap=MERGE_GAP):
    """The windows of an events.json document: [{start, end, a, b, events: [ids], hash}], a..b-1 inclusive frames of the rough."""
    fps, dur = doc['fps'], doc['duration']
    total = round(dur * fps)
    evs = [e for e in doc['events'] if drawn_by(e) == 'remotion']
    evs.sort(key=lambda e: e['at'])
    groups = []
    for e in evs:
        if groups and e['at'] - groups[-1]['end'] < merge_gap:
            g = groups[-1]
            g['end'] = max(g['end'], e['end'])
            g['events'].append(e)
        else:
            groups.append({'start': e['at'], 'end': e['end'], 'events': [e]})
    out = []
    nth = PROOF_NTH if proof else 1
    for g in groups:
        s, t = max(0.0, g['start'] - pad), min(dur, g['end'] + pad)
        a = int(s * fps + 1e-6)
        a -= a % nth                       # a proof frame k must sit on frame a + k*nth of the rough
        b = min(total, -int(-(t * fps - 1e-6) // 1))
        key = {'events': sorted((visual(e) for e in g['events']), key=lambda e: e['id']), 'a': a, 'b': b, 'fps': fps, 'w': doc['width'], 'h': doc['height'],
               'code': code, 'codec': CODEC, 'proof': [PROOF_SCALE, nth] if proof else 0}
        out.append({'start': round(a / fps, 3), 'end': round(b / fps, 3), 'a': a, 'b': b, 'events': [e['id'] for e in g['events']],
                    'hash': sha_short(key), 'frames': (b - a + nth - 1) // nth})
    return out


def overlay_dir(cut, proof=False):
    d = os.path.join(cut.work, 'overlays-proof' if proof else 'overlays')
    os.makedirs(d, exist_ok=True)
    return d


def mov_path(cut, w, proof=False):
    return os.path.join(overlay_dir(cut, proof), w['hash'] + '.mov')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--video'); ap.add_argument('--proof', action='store_true')
    a = ap.parse_args(argv)
    cut = Cut(a.video)
    import user_edits
    doc = user_edits.load(cut)
    ws = plan(doc, code_hash(cut), a.proof)
    fr = sum(w['frames'] for w in ws)
    for w in ws:
        c = 'cached' if os.path.isfile(mov_path(cut, w, a.proof)) else 'to render'
        print(f"{w['start']:8.2f}-{w['end']:8.2f} {w['frames']:6d} frames {w['hash']} {c:9} {', '.join(w['events'])}")
    print(f"{len(ws)} windows, {fr} frames of {round(doc['duration'] * doc['fps'])} ({100 * fr / max(1, doc['duration'] * doc['fps']):.0f}%)")
    return 0


if __name__ == '__main__':
    sys.exit(main())
