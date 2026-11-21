"""Render the overlay windows with Remotion: no base video, transparent, PNG frames in a lossless alpha .mov, only the windows whose hash is not cached.

    python render_windows.py [--video <video/>] [--proof] [--force] [--parallel 5] [--concurrency 4] [--prune] [--no-holds]

--proof renders at 540p (half size) and 30 fps into overlays-proof/ (cheap to look at); without it, full size and the rough's fps into overlays/.
Rendered files are named by the hash of the window (events + template code + fps + size), so an unchanged window is never rendered twice.
Still stretches of a window (a ring held 10 s) are drawn once and held (holds.py: planned from the events, verified by pixels, packed with real timestamps);
--no-holds renders every frame as before. The shared Remotion files (pipeline/remotion/*.ts, *.tsx) are copied to <video>/remotion/src/pipeline/ first; the template provides
remotion/src/components.tsx exporting COMPONENTS = {Name: React.FC<{ev}>}.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import events as ev
import user_edits
from pipelib import Cut, PIPE, fail, read_json, say, step, write_json
from windows import CODEC, ENCODERS, PROOF_NTH, PROOF_SCALE, code_hash, mov_path, overlay_dir, plan, visual


def sync_shared(cut):
    dst = os.path.join(cut.remotion, 'src', 'pipeline')
    os.makedirs(dst, exist_ok=True)
    src = os.path.join(PIPE, 'remotion')
    for n in os.listdir(src):
        if n.endswith(('.ts', '.tsx')):
            a, b = os.path.join(src, n), os.path.join(dst, n)
            if not os.path.isfile(b) or open(a, 'rb').read() != open(b, 'rb').read():
                shutil.copy2(a, b)
    if not os.path.isfile(os.path.join(cut.remotion, 'src', 'components.tsx')):
        fail(cut, f'{cut.remotion}/src/components.tsx is missing: the template must export COMPONENTS (see README.md).')


def ensure_bundle(cut, code):
    out = os.path.join(cut.work, 'bundle', code)
    if os.path.isfile(os.path.join(out, 'index.html')):
        return out
    shutil.rmtree(os.path.join(cut.work, 'bundle'), ignore_errors=True)   # an old code hash is no use
    os.makedirs(out, exist_ok=True)
    say(cut, 'bundling the Remotion project (once per code change)')
    r = subprocess.run(['node', os.path.join(PIPE, 'remotion', 'render.mjs'), 'bundle', cut.remotion, out], capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode or not os.path.isfile(os.path.join(out, 'index.html')):
        fail(cut, 'the Remotion bundle failed (is the code in remotion/src valid TypeScript?):\n' + (r.stdout + r.stderr)[-2500:])
    return out


def render(cut, proof=False, force=False, parallel=5, concurrency=4, prune=False, hold=True):
    """Returns the plan with a 'file' on every window. `hold`: draw the still stretches once (holds.py)."""
    doc = user_edits.load(cut)
    bad = ev.validate(doc, cut)
    if bad:
        fail(cut, 'events.json is not valid:\n  ' + '\n  '.join(bad))
    sync_shared(cut)
    code = code_hash(cut)
    ws = plan(doc, code, proof)
    for w in ws:
        w['file'] = mov_path(cut, w, proof)
    todo = [w for w in ws if force or not os.path.isfile(w['file'])]
    frames_all = sum(w['frames'] for w in ws)
    frames_todo = sum(w['frames'] for w in todo)
    with step(cut, 'render-windows-proof' if proof else 'render-windows', windows=len(ws), to_render=len(todo), cached=len(ws) - len(todo),
              frames_total=frames_all, frames_rendered=frames_todo) as d:
        write_json(os.path.join(cut.work, 'windows.json'), {'proof': proof, 'code': code, 'windows': ws})
        if prune:
            keep = {os.path.basename(w['file']) for w in ws}
            for n in os.listdir(overlay_dir(cut, proof)):
                if (n.endswith('.mov') and n not in keep) or (n.endswith('.holds.json') and n[:-11] + '.mov' not in keep):
                    os.remove(os.path.join(overlay_dir(cut, proof), n))
        if not todo:
            say(cut, f'all {len(ws)} windows are cached: nothing to render')
            return ws
        serve = ensure_bundle(cut, code)
        if hold and CODEC != 'prores':
            import render_holds
            return render_holds.render_held(cut, doc, ws, todo, serve, proof, parallel, concurrency, d)
        meta = {'fps': doc['fps'], 'width': doc['width'], 'height': doc['height'], 'duration': doc['duration']}
        byid = {e['id']: e for e in doc['events']}
        jobs = [{'hash': w['hash'], 'out': w['file'], 'a': w['a'], 'b': w['b'], 'scale': PROOF_SCALE if proof else 1, 'nth': PROOF_NTH if proof else 1,
                 'props': {'meta': meta, 'events': [visual(byid[i]) for i in w['events']]}} for w in todo]
        # longest windows first: the pool ends sooner
        jobs.sort(key=lambda j: -(j['b'] - j['a']))
        spec = os.path.join(cut.work, 'render-jobs.json')
        write_json(spec, {'mode': 'prores' if CODEC == 'prores' else 'frames', 'fps': doc['fps'], 'encode': ENCODERS.get(CODEC, []), 'remotionDir': cut.remotion, 'serveUrl': serve, 'parallel': min(parallel, len(jobs)), 'concurrency': concurrency, 'jobs': jobs}, indent=None)
        say(cut, f'rendering {len(todo)} of {len(ws)} windows ({frames_todo} frames) with {min(parallel, len(jobs))} windows at a time x {concurrency} tabs')
        t0 = time.time()
        p = subprocess.Popen(['node', os.path.join(PIPE, 'remotion', 'render.mjs'), 'render', spec], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                             text=True, encoding='utf-8', errors='replace')
        failed, done = [], 0
        for line in p.stdout:
            line = line.strip()
            try:
                m = json.loads(line)
            except ValueError:
                if line:
                    with open(cut.log_file, 'a', encoding='utf-8') as f:
                        f.write('remotion: ' + line + '\n')
                continue
            if m['event'] == 'done':
                done += m['frames']
                say(cut, f"  window {m['hash']} done ({m['frames']} frames, {m['ms'] / 1000:.0f} s); {done}/{frames_todo} frames, {done / max(1, time.time() - t0):.1f} fps overall")
            elif m['event'] == 'progress':
                with open(cut.log_file, 'a', encoding='utf-8') as f:
                    f.write(f"{time.strftime('%H:%M:%S')}   window {m['hash']}: {m['rendered']}/{m['total']} frames\n")
            elif m['event'] == 'failed':
                failed.append(m)
                say(cut, f"  window {m.get('hash', '?')} FAILED: {m['error'][:600]}")
        p.wait()
        d['seconds'] = round(time.time() - t0, 1)
        if failed or p.returncode:
            d['failed'] = [m.get('hash') for m in failed]
            fail(cut, f'{len(failed)} window(s) failed to render: {[m.get("hash") for m in failed]}; the first error:\n{failed[0]["error"] if failed else "see pipeline.log"}')
        for w in todo:
            if not os.path.isfile(w['file']):
                fail(cut, f'window {w["hash"]} has no file after the render')
    return ws


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--video'); ap.add_argument('--proof', action='store_true'); ap.add_argument('--force', action='store_true')
    ap.add_argument('--parallel', type=int, default=5); ap.add_argument('--concurrency', type=int, default=4); ap.add_argument('--prune', action='store_true')
    ap.add_argument('--no-holds', action='store_true', help='draw every frame, as before the holds existed')
    a = ap.parse_args(argv)
    render(Cut(a.video), a.proof, a.force, a.parallel, a.concurrency, a.prune, hold=not a.no_holds)
    return 0


if __name__ == '__main__':
    sys.exit(main())
