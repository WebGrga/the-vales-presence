"""Rough handover: the end of the rough cut stage. Run once, after the rough cut's build.py and its levelling.

    python handover.py [--video <video/>] [--transcribe] [--whisper-rough] [--no-scenes] [--no-cuts]

Reads  video/out/rough.mp4, video/out/edl.json (format: edl.py), the word files of the sources named in edl.json.
Writes video/out/rough.json        {duration, fps, width, height, nb_frames, edl_sha256, rough_sha256, made}
       video/out/rough-words.json  the source words mapped through edl.json (tmap), in rough time:
                                   {"duration", "count", "words": [[start, end, "word", "src", src_start], ...]}
       video/out/rough-scenes.json footage scene changes in the rough (for the "something changes every 10 s" gap pass)
       video/out/cuts.json         every cut of the rough, with two short clips each, for the cut review (cuts.py; --no-cuts skips it;
                                   a failure there is a warning, never a failed handover)
No new Whisper pass over the rough: the words come from the recordings' own word files. A missing word file is made
with --transcribe (faster-whisper on the GPU, once per recording); without it the handover stops and says which.
--whisper-rough is the fallback for a cut whose edit list has no source word files (a Short built from a shell script): ONE faster-whisper
pass over the finished rough, done here at the handover and never again in a visuals round; rough-words.json then says "method": "whisper-on-rough".
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import edl as edlmod
import tmap
from pipelib import Cut, PIPE, fail, now_iso, probe, read_json, run, say, sha256_file, step, uv_script, write_json


def ensure_words(cut, edl, transcribe):
    have = {}
    for key, src in edl['sources'].items():
        w = src.get('words')
        if not w:
            continue
        path = cut.p(w)
        if not os.path.isfile(path):
            if not transcribe:
                fail(cut, f'the word file of source "{key}" ({w}) is missing. Run handover.py --transcribe to make it once from {src["file"]}.')
            with step(cut, f'transcribe-{key}', source=src['file']) as d:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                uv_script(os.path.join(PIPE, 'transcribe.py'), cut.p(src['file']), path)
                d['out'] = w
        have[key] = tmap.read_words(path)
    return have


def frame_props(path):
    """{ 'pix_fmt color_range color_space size': frame count } over every video frame of the file (one entry when the stream is uniform; keyframes only: a join always starts a new group of pictures)."""
    r = run(['ffprobe', '-v', 'error', '-skip_frame', 'nokey', '-select_streams', 'v:0', '-show_entries', 'frame=pix_fmt,color_range,color_space,color_primaries,color_transfer,width,height',
             '-of', 'csv=p=0', path])
    out = {}
    for line in r[1].splitlines():
        line = line.strip().rstrip(',')
        if line:
            out[line] = out.get(line, 0) + 1
    return out


def scenes(cut, threshold=0.03):
    """Footage scene changes of the rough (times in seconds). Software decode at 160 px wide; the GPU decode path is tried first."""
    base = ['ffmpeg', '-hide_banner', '-nostats', '-i', cut.rough, '-an']
    vf = f"scale=160:-2,select='gt(scene,{threshold})',showinfo"
    r = run([*base, '-vf', vf, '-f', 'null', '-'], check=True)
    out = []
    for line in r[2].splitlines():
        i = line.find('pts_time:')
        if i >= 0 and 'showinfo' in line:
            out.append(round(float(line[i + 9:].split()[0]), 3))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--video'); ap.add_argument('--transcribe', action='store_true'); ap.add_argument('--no-scenes', action='store_true'); ap.add_argument('--whisper-rough', action='store_true'); ap.add_argument('--no-cuts', action='store_true')
    a = ap.parse_args(argv)
    cut = Cut(a.video)
    if not os.path.isfile(cut.rough):
        fail(cut, f'there is no rough cut at {cut.rough}')
    edl = edlmod.load(cut.edl)
    bad = edlmod.validate(edl)
    if bad:
        fail(cut, 'edl.json is not valid:\n  ' + '\n  '.join(bad))
    with step(cut, 'handover') as d:
        info = probe(cut.rough)
        if abs(info['duration'] - edl['total']) > 1.0:
            fail(cut, f'rough.mp4 runs {info["duration"]:.2f} s but edl.json adds up to {edl["total"]:.2f} s: the edit list is not the one this rough was built from.')
        if abs(info['fps'] - edl['fps']) > 0.01 or (info['width'], info['height']) != (edl['width'], edl['height']):
            fail(cut, f'rough.mp4 is {info["width"]}x{info["height"]} at {info["fps"]} fps but edl.json says {edl["width"]}x{edl["height"]} at {edl["fps"]} fps.')
        props = frame_props(cut.rough)
        if len(props) > 1:
            fail(cut, f'rough.mp4 changes its frame properties in the middle of the stream ({"; ".join(f"{n} frames {p}" for p, n in props.items())}): ffmpeg re-configures its filters there and the zoom pass loses frames. '
                      'Join the rough through pipeline/level.py (it tags every frame BT.709) or tag every segment the same way.')
        method = 'edl-source-words'
        words = None
        if a.whisper_rough:
            method = 'whisper-on-rough'
            tsv = os.path.join(cut.work, 'rough-words.tsv')
            with step(cut, 'transcribe-rough', note='fallback: no source word files') as dt:
                uv_script(os.path.join(PIPE, 'transcribe.py'), cut.rough, tsv)
            mapped = [[x[0], x[1], x[2], 'rough', x[0]] for x in tmap.read_words(tsv)]
        else:
            words = ensure_words(cut, edl, a.transcribe)
            T = tmap.TMap(edl)
            mapped = T.map_words(words, visible=0.5)
        write_json(cut.rough_words, {'duration': edl['total'], 'method': method, 'count': len(mapped), 'words': mapped}, indent=None)
        if not a.no_scenes:
            with step(cut, 'handover-scenes') as ds:
                sc = scenes(cut)
                write_json(cut.rough_scenes, {'threshold': 0.03, 'times': sc}, indent=None)
                ds['count'] = len(sc)
        # the length of the PICTURE (frames / fps): the container's length also counts an audio tail, and the overlay windows would then run past the last frame
        pic = round(info['nb_frames'] / info['fps'], 3) if info.get('nb_frames') else round(info['duration'], 3)
        rj = {'duration': pic, 'fps': info['fps'], 'width': info['width'], 'height': info['height'],
              'nb_frames': info.get('nb_frames'), 'edl_sha256': sha256_file(cut.edl), 'rough_sha256': sha256_file(cut.rough), 'made': now_iso()}
        write_json(cut.rough_json, rj)
        d.update(words=len(mapped), duration=rj['duration'])
        say(cut, f'handover: rough {rj["duration"]:.2f} s, {len(mapped)} words, rough.json written')
    if not a.no_cuts:
        try:                                         # the cut list is for review: it must never fail the handover
            import cuts
            cuts.run_cuts(cut, rough_words=mapped, src_words=words)
        except BaseException as e:
            if isinstance(e, KeyboardInterrupt):
                raise
            say(cut, f'WARNING: the cut list (cuts.json) was not made: {type(e).__name__}: {str(e)[:300]}. Run `python cuts.py` to try again.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
