"""The edit list of a shell-built Short (a SPLIT: screen crop on top, cam band below), written from a build.sh in a few lines.

A Short's rough cut is one ffmpeg call per beat (a segment file `s_b2.mp4`...), joined by concat. This writes the matching video/out/edl.json
(format: edl.py) so the pipeline's handover and tmap know where every part's SOUND comes from. Call it at the end of build.sh, from video/out/work/:

    python $P/split_edl.py --video ../.. --size 1080x1920 --fps 60 \\
        --source p3=footage/p3-rec1-4119.4.mp4,out/work/words-p3.tsv  --source vo=out/work/vo.wav,out/work/vo.tsv \\
        --item "S 2 s_b2.mp4 p3 2.80 5.44"  --item "V 5 s_b5.mp4 vo 0.0 3.0"  --item "H 7 s_b7.mp4"

--source key=file[,words]   a recording whose sound is in the cut: `file` is relative to video/, `words` (optional) is its start<TAB>end<TAB>word file
                            (handover.py --transcribe makes a missing one once, from the file)
--item "KIND BEAT SEGFILE [SRC SRC_IN SRC_OUT] [k=v ...]"   one segment in cut order. SEGFILE is measured (its video length is the item's `len`), so the list
                            adds up to the joined file. SRC SRC_IN SRC_OUT: the part's sound is that stretch of source SRC at speed 1 (SRC_OUT '+' = SRC_IN plus the segment's length). Items with no
                            sound from a source (a held still, a silent end) leave them out. Extra k=v words are passed through (crop=..., pic_in=...).
KIND is a letter you choose: S a live part, V a voice-over slot, H a held picture, E an end hold. BEAT is the beat number of the plan (tmap.beat(n)).
Without --item lines nothing is written. The rough's length is checked by handover.py (edl total against rough.mp4, 1 s).
"""
import argparse
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import edl as edlmod


def seg_len(path):
    """Length of a segment's picture in seconds: frames / fps when the file has them, else the stream's or the container's duration (.mkv has no stream duration)."""
    r = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration,nb_frames,r_frame_rate:format=duration', '-of', 'json', path],
                       capture_output=True, text=True)
    j = json.loads(r.stdout)
    st = (j.get('streams') or [{}])[0]
    if str(st.get('nb_frames', '')).isdigit() and '/' in st.get('r_frame_rate', ''):
        n, m = st['r_frame_rate'].split('/')
        return int(st['nb_frames']) * float(m) / float(n)
    try:
        return float(st['duration'])
    except (KeyError, ValueError):
        return float(j['format']['duration'])


def build(fps, width, height, sources, items, lengths=None):
    """sources: {key: {file, words?}}; items: [dict(kind, beat, len | seg, src?, src_in?, src_out?, ...)]. Returns the edl dict (validated)."""
    e = edlmod.new(fps, width, height, sources)
    for it in items:
        it = dict(it)
        kind, beat = it.pop('kind'), it.pop('beat', None)
        length = it.pop('len', None)
        seg = it.pop('seg', None)
        if length is None:
            length = (lengths or {}).get(seg) if lengths else seg_len(seg)
        if it.get('src_out') == '+':
            it['src_out'] = round(it['src_in'] + length, 3)
        edlmod.add(e, kind, length, beat=beat, **it)
    bad = edlmod.validate(e)
    if bad:
        raise SystemExit('edl is not valid:\n  ' + '\n  '.join(bad))
    return e


def parse_item(s):
    p = s.split()
    it = {'kind': p[0], 'beat': int(p[1]), 'seg': p[2]}
    rest = p[3:]
    if rest and '=' not in rest[0]:
        it['src'], it['src_in'] = rest[0], float(rest[1])
        it['src_out'] = rest[2] if rest[2] == '+' else float(rest[2])      # '+' = src_in + the segment's length
        rest = rest[3:]
    for kv in rest:
        k, v = kv.split('=', 1)
        try:
            v = float(v)
        except ValueError:
            pass
        it[k] = v
    return it


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--video', default='../..', help='the workshop video/ folder (default: two up from video/out/work)')
    ap.add_argument('--size', default='1080x1920'); ap.add_argument('--fps', type=float, default=60)
    ap.add_argument('--source', action='append', default=[]); ap.add_argument('--item', action='append', default=[])
    ap.add_argument('--out', help='default <video>/out/edl.json')
    a = ap.parse_args(argv)
    w, h = map(int, a.size.split('x'))
    src = {}
    for s in a.source:
        k, v = s.split('=', 1)
        f, _, words = v.partition(',')
        src[k] = {'file': f, **({'words': words} if words else {})}
    e = build(a.fps, w, h, src, [parse_item(x) for x in a.item])
    out = a.out or os.path.join(os.path.abspath(a.video), 'out', 'edl.json')
    edlmod.write(out, e)
    print(f'edl.json: {len(e["items"])} items, {e["total"]:.3f} s')
    return 0


if __name__ == '__main__':
    sys.exit(main())
