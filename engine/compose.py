"""Compose: ONE ffmpeg pass over the locked rough: zoom (crop+scale, eased), captions (ASS), every overlay window (lossless alpha .mov) at its offset,
the sound-effects layer mixed under the rough's own audio, encoded with the GPU.

    python compose.py --final [--video <video/>] [--single] [--chunk-seconds 15] [--jobs 3] [--force] [--prune]   -> video/out/final.mp4
    python compose.py --proof [--video <video/>]      -> video/out/proof.mp4 + proof-sheet.jpg: each changed window as a short 540p 30 fps clip

Final, by default in CHUNKS (compose_chunks.py: ~15 s pieces, each cached by what touches its frames, joined with -c copy, the sound mixed once and muxed at the join);
`--single` is the one-pass way this file always had (below). Single pass: the probed encoder's `final` profile (encoders.py; on NVENC p6, constant quality cq 19, no bitrate cap), same size and fps as the rough, GOP of 2 s. Audio is the rough's voice
untouched plus the effects layer (amix, normalize=0: nothing re-levelled); the limiter is only added when the summed peak would clip,
and with no effects the audio stream is copied. Run render_windows.py first (run.py does both).
"""
import argparse
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import captions
import encoders
import events as evmod
import redact
import sfx as sfxmod
import user_edits
from pipelib import Cut, PIPE, env, fail, label_font, probe, read_json, run, say, sha_short, step, write_json
from windows import PAD, PROOF_NTH, PROOF_SCALE, code_hash, mov_path, plan
from holds import BIAS      # held overlays carry exact timestamps: shift them 0.5 ms early so rounding can never make a frame late

NVENC = encoders.PROFILES['final']['h264_nvenc']      # the settings the engine was measured with (kept under this name for older callers)


def final_args():
    """The encoder arguments of a final (single pass and chunks): the probed encoder's `final` profile."""
    return encoders.args('final')


def ease(x):
    return f'if(lt({x},0.5),4*pow({x},3),1-pow(2-2*({x}),3)/2)'


def sine(x):
    return f'(1-cos(PI*({x})))/2'


def zoom_filter(doc, zooms, frame_off=0, dims=None):
    """perspective filter that crops and scales the frame per frame to the eased zoom of whichever zoom event is on. '' when none.
    `dims` = (width, height) of the picture being zoomed (the whole rough, or a zoom's `region`).
    Two kinds: a hold zoom (zoom, x, y: the crop's top-left; eased in and out over `ease` s), and a push (`to` = the zoom it ends at, `ox`/`oy` = the
    point that stays put, default the centre: a slow, sine-eased move from `zoom` to `to` over the whole event, no easing out: it cuts back at `end`)."""
    if not zooms:
        return ''
    fps = doc['fps']
    W, H = dims or (doc['width'], doc['height'])
    tt = f'((in+{frame_off})/{fps})'
    px, py, pw, ph = [], [], [], []
    for z in zooms:
        a, b, E = z['at'], z['end'], float(z.get('ease', 0.4))
        if z.get('to') is not None:
            z0, z1 = float(z['zoom']), float(z['to'])
            zt = f"({z0}+({z1 - z0:.5f})*{sine(f'clip(({tt}-{a})/{b - a},0,1)')})"
            g = f'between({tt},{a},{b})'
            ox, oy = z.get('ox', W / 2), z.get('oy', H / 2)
            px.append(f"{ox}*(1-1/{zt})*{g}")
            py.append(f"{oy}*(1-1/{zt})*{g}")
            pw.append(f"{W}*(1-1/{zt})*{g}")
            ph.append(f"{H}*(1-1/{zt})*{g}")
            continue
        if E > 0:
            p = f"between({tt},{a},{b})*min({ease(f'clip(({tt}-{a})/{E},0,1)')},{ease(f'clip(({b}-{tt})/{E},0,1)')})"
        else:
            p = f'between({tt},{a},{b})'
        px.append(f"{z['x']}*{p}")
        py.append(f"{z['y']}*{p}")
        pw.append(f"{W - W / z['zoom']:.4f}*{p}")
        ph.append(f"{H - H / z['zoom']:.4f}*{p}")
    rx, ry, w, h = '+'.join(px), '+'.join(py), f"W-({'+'.join(pw)})", f"H-({'+'.join(ph)})"
    ex = {'x0': f'({rx})', 'y0': f'({ry})', 'x1': f'({rx})+({w})', 'y1': f'({ry})', 'x2': f'({rx})', 'y2': f'({ry})+({h})',
          'x3': f'({rx})+({w})', 'y3': f'({ry})+({h})'}
    return 'perspective=' + ':'.join(f"{k}='{v}'" for k, v in ex.items()) + ':eval=frame:interpolation=cubic'


def mask_filters(zooms, t_off=0.0):
    out = []
    for z in zooms:
        m = z.get('mask')
        if m:
            E = float(z.get('ease', 0.4))
            col = '0x' + m.get('color', '#000000').lstrip('#')
            out.append(f"drawbox=x={m['x']}:y={m['y']}:w={m['w']}:h={m['h']}:color={col}:t=fill:enable='between(t+{t_off},{z['at'] + E * 0.95},{z['end'] - E * 0.95})'")
    return out


def zoom_graph(doc, zooms, out, fo=0, nframes=None):
    """Filter lines that take [0:v] to `out` with the zooms applied. Only the zoom stretches go through `perspective` (about 80 fps): the stream is
    split, each zoom is trimmed out by frame, zoomed, and everything is concatenated back (frame exact, one pass, no extra decode of the file).
    `fo` = the rough frame that [0:v] starts at (a proof clip), `nframes` = how many frames [0:v] has (None = to the end)."""
    fps = doc['fps']
    segs, cur = [], 0
    for z in zooms:
        a = max(cur, int(z['at'] * fps + 1e-6) - fo)
        b = -int(-(z['end'] * fps - 1e-6) // 1) - fo
        if nframes is not None:
            b = min(b, nframes)
        if b <= a:
            continue
        if a > cur:
            segs.append((cur, a, None))
        segs.append((a, b, z))
        cur = b
    if not segs:
        return [f'[0:v]null{out}']
    if nframes is None or cur < nframes:
        segs.append((cur, None, None))
    # fps first: a rough with a hole in its timestamps (a variable-frame-rate cut) would make trim + concat lose frames; fps makes it constant
    lines = [f'[0:v]fps={fps:g},split={len(segs)}' + ''.join(f'[s{k}]' for k in range(len(segs)))]
    for k, (a, b, z) in enumerate(segs):
        chain = f"trim=start_frame={a}" + (f":end_frame={b}" if b is not None else '') + f',setpts=N/({fps}*TB)'      # timestamps by frame count: a rough with jittery pts cannot make the concat drop frames
        if z and z.get('region'):
            # a SPLIT-aware zoom: only the region (e.g. the top band) is cropped and scaled; the rest of the frame (the cam) stays
            rx, ry, rw, rh = z['region']
            ab = a + fo
            lines.append(f'[s{k}]{chain},split[f{k}][r{k}]')
            lines.append(f'[r{k}]crop={rw}:{rh}:{rx}:{ry},{zoom_filter(doc, [z], ab, (rw, rh))}[g{k}]')
            lines.append(f'[f{k}][g{k}]overlay={rx}:{ry}:format=auto[y{k}]')
            continue
        if z:
            ab = a + fo
            # the mask is in rough pixels (README): paint it before the zoom, so it scales with the crop
            for m in mask_filters([z], ab / fps):
                chain += ',' + m
            chain += ',' + zoom_filter(doc, [z], ab)
        lines.append(f'[s{k}]{chain}[y{k}]')
    lines.append(''.join(f'[y{k}]' for k in range(len(segs))) + f'concat=n={len(segs)}:v=1:a=0{out}')
    return lines


def ass_filter(ass, cut):
    return f"ass='captions.ass':fontsdir='{captions.ff_path(captions.fonts_dir(cut))}'," if ass else ''


def video_zooms(doc):
    return sorted([e for e in doc['events'] if e['kind'] == 'zoom' and e.get('render') is not False], key=lambda e: e['at'])


def audio_args(sfx_info, nin_sfx):
    """(filter chain part, map args, codec args) for the sound."""
    if not sfx_info['file']:
        return None, ['-map', '0:a:0'], ['-c:a', 'copy']
    chain = f'[0:a:0][{nin_sfx}:a]amix=inputs=2:normalize=0:duration=first:dropout_transition=0'
    chain += ',alimiter=limit=0.95:level=false[aout]' if sfx_info['limit'] else '[aout]'
    return chain, ['-map', '[aout]'], ['-c:a', 'aac', '-b:a', '256k']


def run_ffmpeg(cut, cmd, cwd, what):
    t0 = time.time()
    with open(cut.log_file, 'a', encoding='utf-8') as lg:
        lg.write(f'$ {" ".join(cmd)}\n')
        p = subprocess.Popen(cmd, cwd=cwd, stdout=lg, stderr=lg)
        p.wait()
    if p.returncode:
        tail = open(cut.log_file, encoding='utf-8', errors='replace').read()[-1800:]
        fail(cut, f'{what} failed (ffmpeg exit {p.returncode}). Last lines of the log:\n{tail}')
    return time.time() - t0


def compose_final(cut, doc, ws, out=None):
    out = out or cut.final
    info = probe(cut.rough)
    zooms = video_zooms(doc)
    ass = captions.write(cut, doc)
    sfx_info = sfxmod.build(cut, doc)
    inputs = ['-i', cut.rough]
    nb = int(round(doc['duration'] * doc['fps']))      # a zoom that reaches the end must not leave an empty trailing segment
    graph = zoom_graph(doc, zooms, '[zz]', nframes=nb)
    graph = redact.prepend(redact.blur_lines(redact.blurs(doc), '[0:v]', '[rb]', doc['width'], doc['height']), graph, '[rb]')      # blur boxes, before the zoom
    on_top = bool((doc.get('captions') or {}).get('on_top'))      # captions above the overlay windows (opaque full-frame scenes would hide them)
    graph.append(f"[zz]{ass_filter(ass, cut) if not on_top else ''}format=yuv420p[b0]")
    for i, w in enumerate(ws, 1):
        inputs += ['-i', w['file']]
        graph.append(f"[{i}:v]setpts=PTS+{w['start']}/TB[w{i}]")
        graph.append(f"[b{i - 1}][w{i}]overlay=eof_action=pass:repeatlast=0:format=auto:enable='between(t,{w['start']},{w['end']})'[b{i}]")
    vout = f'[b{len(ws)}]'
    if on_top and ass:
        graph.append(f"{vout}{ass_filter(ass, cut).rstrip(',')}[bc]")
        vout = '[bc]'
    nin = len(ws) + 1
    if sfx_info['file']:
        inputs += ['-f', 'f32le', '-ar', str(sfxmod.SR), '-ac', '2', '-i', sfx_info['file']]
    ach, amap, acodec = audio_args(sfx_info, nin)
    if ach:
        graph.append(ach)
    script = os.path.join(cut.work, 'compose.filter')
    with open(script, 'w', encoding='utf-8') as f:
        f.write(';\n'.join(graph) + '\n')
    gop = int(round(2 * doc['fps']))
    col = []
    if info.get('color_space') in ('bt709',):
        col = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709']
    tmp = os.path.join(cut.out, 'final.part.mp4')
    cmd = ['ffmpeg', '-hide_banner', '-nostats', '-v', 'warning', '-y', *inputs, '-filter_complex_script', 'compose.filter',
           '-map', vout, *amap, *final_args(), '-g', str(gop), *col, '-fps_mode', 'cfr', *acodec, '-movflags', '+faststart', tmp]
    nbl = len(redact.blurs(doc))
    say(cut, f'composing: {len(ws)} overlay windows, {len(zooms)} zooms, {"captions, " if ass else ""}{sfx_info["cues"]} sound cues' + (f', {nbl} blur boxes' if nbl else ''))
    secs = run_ffmpeg(cut, cmd, cut.work, 'the compose pass')
    try:
        os.replace(tmp, out)
    except PermissionError:          # Windows: the old final is open in a player; renaming it aside still works
        aside = out[:-4] + '.old-' + time.strftime('%H%M%S') + '.mp4'
        os.rename(out, aside)
        os.replace(tmp, out)
        say(cut, f'the old final was open elsewhere; moved it aside to {os.path.basename(aside)}')
    return secs, sfx_info


def proof_windows(doc, ws, rough_sha, caption_samples=6):
    """The stretches to look at in a proof: every overlay window, every zoom, and a few caption blocks; touching ones merge."""
    fps, dur = doc['fps'], doc['duration']
    iv = [(w['start'], w['end']) for w in ws]
    iv += [(max(0, z['at'] - PAD), min(dur, z['end'] + PAD)) for z in video_zooms(doc)]
    iv += [(max(0, b['at'] - PAD), min(dur, b['end'] + PAD)) for b in redact.blurs(doc)]
    caps = [e for e in doc['events'] if e['kind'] == 'caption' and e.get('render') is not False]
    if caps:
        step_ = max(1, len(caps) // caption_samples)
        iv += [(max(0, c['at'] - 1), min(dur, c['end'] + 1)) for c in caps[::step_][:caption_samples]]
    iv.sort()
    merged = []
    for a, b in iv:
        if merged and a <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    out = []
    for a, b in merged:
        a = int(a * fps) - int(a * fps) % PROOF_NTH
        b = min(round(dur * fps), int(-(-b * fps // 1)))
        out.append({'a': a, 'b': b, 'start': a / fps, 'end': b / fps})
    return out


def compose_proof(cut, doc, ws):
    """Each proof window as its own clip (cached by what is in it), then all joined into proof.mp4, plus a contact sheet."""
    rj = read_json(cut.rough_json)
    fps = doc['fps']
    pw = proof_windows(doc, ws, rj['rough_sha256'])
    pdir = os.path.join(cut.work, 'proof')
    os.makedirs(pdir, exist_ok=True)
    zooms_all = video_zooms(doc)
    sfx_info = sfxmod.build(cut, doc)
    made = 0
    clips = []
    W, H = int(doc['width'] * PROOF_SCALE), int(doc['height'] * PROOF_SCALE)
    for p in pw:
        S, D = p['start'], p['end'] - p['start']
        inside = [w for w in ws if w['start'] >= S - 1e-3 and w['end'] <= p['end'] + 2e-3]     # window ends are rounded to 3 decimals, proof ends are b/fps
        zs = [z for z in zooms_all if z['end'] > S and z['at'] < p['end']]
        cs = [e for e in doc['events'] if e['kind'] == 'caption' and e['end'] > S and e['at'] < p['end'] and e.get('render') is not False]
        key = {'rough': rj['rough_sha256'], 'a': p['a'], 'b': p['b'], 'ov': [w['hash'] for w in inside], 'z': zs, 'c': cs,
               'sfx': [c for c in sfxmod.cues(doc) if S <= c['t'] < p['end']], 'cap': (doc.get('captions') or {}), 'bed': doc.get('bed'), 'v': 5}
        bl = redact.overlapping(doc, S, p['end'])
        if bl:
            key['bl'] = bl
        h = sha_short(key)
        clip = os.path.join(pdir, h + '.mp4')
        clips.append(clip)
        if os.path.isfile(clip):
            continue
        ids = [e['id'] for e in doc['events'] if e['end'] > S and e['at'] < p['end']]
        with open(os.path.join(pdir, h + '.txt'), 'w', encoding='utf-8') as f:
            f.write(f"{S:.1f}-{p['end']:.1f}s  " + ' '.join(ids)[:90])
        inputs = ['-ss', f'{S:.3f}', '-t', f'{D:.3f}', '-i', cut.rough]
        graph = []
        fo = int(round(S * fps))
        ass = None
        nfr = int(round(D * fps))
        if cs:
            sub = dict(doc); sub['events'] = [dict(e, at=e['at'] - S, end=e['end'] - S, words=[[w[0] - S, w[1] - S, *w[2:]] for w in e['words']]) for e in cs]
            text = captions.build(sub)
            with open(os.path.join(pdir, h + '.ass'), 'w', encoding='utf-8-sig') as f:
                f.write(text)
            ass = f"ass='{h}.ass':fontsdir='{captions.ff_path(captions.fonts_dir(cut))}'"
        lab = f"drawtext={label_font()}textfile='{h}.txt':fontsize=18:fontcolor=white:box=1:boxcolor=black@0.7:x=6:y=6"
        # captions are sized for the full frame: burn them at full size, then scale down
        graph += redact.prepend(redact.blur_lines(bl, '[0:v]', '[rb]', doc['width'], doc['height'], t_off=S), zoom_graph(doc, zs, '[zz]', fo=fo, nframes=nfr), '[rb]')
        on_top = bool((doc.get('captions') or {}).get('on_top'))
        graph.append(f"[zz]format=yuv420p,{ass + ',' if ass and not on_top else ''}scale={W}:{H}:flags=bicubic,fps={fps / PROOF_NTH:g}[b0]")
        for i, w in enumerate(inside, 1):
            inputs += ['-i', w['file']]
            graph.append(f"[{i}:v]setpts=PTS+({w['start']}-{S}-{BIAS})/TB[w{i}]")
            graph.append(f"[b{i - 1}][w{i}]overlay=eof_action=pass:repeatlast=0:format=auto[b{i}]")
        graph.append(f"[b{len(inside)}]{ass + ',' if ass and on_top else ''}{lab}[vout]")
        nin = len(inside) + 1
        if sfx_info['file']:
            inputs += ['-ss', f'{S:.3f}', '-t', f'{D:.3f}', '-f', 'f32le', '-ar', str(sfxmod.SR), '-ac', '2', '-i', sfx_info['file']]
        ach, amap, _ = audio_args(sfx_info, nin)
        amap = ['-map', '0:a:0'] if not ach else ['-map', '[aout]']
        if ach:
            graph.append(ach)
        script = os.path.join(pdir, h + '.filter')
        with open(script, 'w', encoding='utf-8') as f:
            f.write(';\n'.join(graph) + '\n')
        cmd = ['ffmpeg', '-hide_banner', '-nostats', '-v', 'warning', '-y', *inputs, '-filter_complex_script', h + '.filter', '-map', '[vout]', *amap,
               *encoders.args('proof'), '-g', '60', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
               h + '.part.mp4']
        run_ffmpeg(cut, cmd, pdir, f'the proof clip {S:.1f}-{p["end"]:.1f}')
        os.replace(os.path.join(pdir, h + '.part.mp4'), clip)
        made += 1
    lst = os.path.join(pdir, 'list.txt')
    with open(lst, 'w', encoding='utf-8') as f:
        f.write(''.join(f"file '{os.path.basename(c)}'\n" for c in clips))
    run_ffmpeg(cut, ['ffmpeg', '-hide_banner', '-nostats', '-v', 'warning', '-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', os.path.join(cut.out, 'proof.mp4')], pdir, 'joining the proof clips')
    return {'windows': len(pw), 'made': made}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument('--final', action='store_true'); g.add_argument('--proof', action='store_true')
    ap.add_argument('--video')
    ap.add_argument('--single', action='store_true', help='one ffmpeg pass over the whole video (the way before chunks)')
    ap.add_argument('--chunk-seconds', type=float, default=None, help='chunk length in seconds (default 15; 10 for a Short)')
    ap.add_argument('--jobs', type=int, default=int(env('COMPOSE_JOBS', '3')), help='chunks encoded at a time (GPU sessions)')
    ap.add_argument('--force', action='store_true', help='re-encode every chunk')
    ap.add_argument('--prune', action='store_true', help='delete cached chunks the current cut does not use')
    a = ap.parse_args(argv)
    cut = Cut(a.video)
    doc = user_edits.load(cut)
    bad = evmod.validate(doc, cut)
    if bad:
        fail(cut, 'events.json is not valid:\n  ' + '\n  '.join(bad))
    ws = plan(doc, code_hash(cut), a.proof)
    for w in ws:
        w['file'] = mov_path(cut, w, a.proof)
        if not os.path.isfile(w['file']):
            fail(cut, f'window {w["hash"]} ({w["start"]}-{w["end"]} s) is not rendered: run render_windows.py{" --proof" if a.proof else ""} first.')
    with step(cut, 'compose-proof' if a.proof else 'compose-final', windows=len(ws)) as d:
        if a.proof:
            d.update(compose_proof(cut, doc, ws))
        elif a.single:
            secs, s = compose_final(cut, doc, ws)
            d.update(seconds=round(secs, 1), sfx_cues=s['cues'], mix_peak=round(s['peak'], 3), limiter=s['limit'],
                     size_mb=round(os.path.getsize(cut.final) / 1e6, 1), chunks=1, encoded=1)
        else:
            import compose_chunks
            r, s = compose_chunks.compose_final_chunked(cut, doc, ws, seconds=a.chunk_seconds, jobs=a.jobs, force=a.force, prune=a.prune)
            d.update(r, sfx_cues=s['cues'], mix_peak=round(s['peak'], 3), limiter=s['limit'], seconds=round(r['seconds'], 1), size_mb=round(os.path.getsize(cut.final) / 1e6, 1))
    return 0


if __name__ == '__main__':
    sys.exit(main())
