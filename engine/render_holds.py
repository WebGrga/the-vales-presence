"""The windows of render_windows.py with their still stretches held (see holds.py): Chrome draws the busy stretches in full and a few sample frames of
every hold; a worker thread compares the samples as each window's frames land; a hold that fails the comparison is drawn in full (a second run of just
that stretch); then the frames are packed into the window's .mov with their real timestamps. Called by render_windows.render()."""
import concurrent.futures
import json
import os
import shutil
import subprocess
import time

import holds as holdmod
from pipelib import PIPE, fail, say, write_json
from windows import CODEC, ENCODERS, PROOF_NTH, PROOF_SCALE, visual


def run_frames(cut, spec_jobs, serve, parallel, concurrency, on_done, label):
    """One run of remotion/render_frames.mjs over `spec_jobs` ([{hash, dir, scale, props, calls}]); `on_done(hash)` is called as each window's frames are on disk."""
    spec = os.path.join(cut.work, 'render-frames.json')
    spec_jobs.sort(key=lambda j: -sum((c['b'] - c['a']) // max(1, c['nth']) + 1 for c in j['calls']))
    write_json(spec, {'remotionDir': cut.remotion, 'serveUrl': serve, 'parallel': min(parallel, len(spec_jobs)), 'concurrency': concurrency, 'jobs': spec_jobs}, indent=None)
    p = subprocess.Popen(['node', os.path.join(PIPE, 'remotion', 'render_frames.mjs'), spec], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         text=True, encoding='utf-8', errors='replace')
    failed, frames = [], 0
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
            frames += m['frames']
            say(cut, f"  window {m['hash']} {label}: {m['frames']} frames drawn in {m['ms'] / 1000:.0f} s")
            on_done(m['hash'])
        elif m['event'] == 'failed':
            failed.append(m)
            say(cut, f"  window {m.get('hash', '?')} FAILED: {m['error'][:600]}")
    p.wait()
    if failed or p.returncode:
        fail(cut, f'{len(failed)} window(s) failed to render: {[m.get("hash") for m in failed]}; the first error:\n{failed[0]["error"] if failed else "see pipeline.log"}')
    return frames


def render_held(cut, doc, ws, todo, serve, proof, parallel, concurrency, d):
    fps, nth = doc['fps'], PROOF_NTH if proof else 1
    table = holdmod.load_table(cut, doc.get('format'))
    byid = {e['id']: e for e in doc['events']}
    meta = {'fps': doc['fps'], 'width': doc['width'], 'height': doc['height'], 'duration': doc['duration']}
    encode = ENCODERS.get(CODEC, ENCODERS['png'])
    scale = PROOF_SCALE if proof else 1
    jobs, by = [], {}
    for w in todo:
        evs = [byid[i] for i in w['events']]
        w['stretches'] = holdmod.plan_window(evs, w['a'], w['b'], fps, nth, table)
        w['calls'] = holdmod.calls_for(w['stretches'], fps, nth, table)
        w['dir'] = w['file'][:-4] + '.frames'
        shutil.rmtree(w['dir'], ignore_errors=True)
        by[w['hash']] = w
        jobs.append({'hash': w['hash'], 'dir': w['dir'], 'scale': scale, 'props': {'meta': meta, 'events': [visual(e) for e in evs]}, 'calls': w['calls']})
    planned = sum(holdmod.frames_of(w['calls']) for w in todo)
    frames_todo = sum(w['frames'] for w in todo)
    nholds = sum(holdmod.summarize(w['stretches'], nth)['holds'] for w in todo)
    say(cut, f'rendering {len(todo)} of {len(ws)} windows with the still stretches held: {planned} of {frames_todo} frames to draw ({nholds} holds), '
             f'{min(parallel, len(jobs))} windows at a time x {concurrency} tabs')
    t0 = time.time()
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=4)
    futs = {}
    stats = {'bad': 0, 'max_diff': 0.0, 'fallback_frames': 0, 'entries': 0}

    def finish(h):
        w = by[h]
        return holdmod.finish_window(w['dir'], w, w['stretches'], fps, nth, encode, table)

    def on_done(h):
        futs[h] = pool.submit(finish, h)

    drawn = run_frames(cut, jobs, serve, parallel, concurrency, on_done, 'drawn')
    redo = []
    for h, fu in list(futs.items()):
        bad, st = fu.result()
        stats['max_diff'] = max(stats['max_diff'], st['max_diff'])
        if bad:
            redo.append((h, bad))
        else:
            stats['entries'] += st.get('entries', 0)
    if redo:
        rjobs = []
        for h, bad in redo:
            w = by[h]
            stats['bad'] += len(bad)
            for s in bad:
                s['failed'] = True
                stats['fallback_frames'] += (s['b'] - s['a'] + nth - 1) // nth
                say(cut, f"  window {h}: the hold {s['a'] / fps:.2f}-{s['b'] / fps:.2f} s changed by {s['diff']:.0f} between its samples: drawn in full")
            rjobs.append({'hash': h, 'dir': w['dir'], 'scale': scale, 'props': next(j['props'] for j in jobs if j['hash'] == h),
                          'calls': [{'a': s['a'], 'b': s['b'], 'nth': nth} for s in bad]})
        futs.clear()
        drawn += run_frames(cut, rjobs, serve, parallel, concurrency, on_done, 'drawn (a hold failed the check)')
        for h, fu in list(futs.items()):
            bad, st = fu.result()
            if bad:
                fail(cut, f'window {h}: a hold still fails after drawing it in full')
            stats['entries'] += st.get('entries', 0)
    pool.shutdown()
    held = 0
    for w in todo:
        if not os.path.isfile(w['file']):
            fail(cut, f'window {w["hash"]} has no file after the render')
        shutil.rmtree(w['dir'], ignore_errors=True)
        sm = holdmod.summarize(w['stretches'], nth)
        held += sm['held'] - sum((s['b'] - s['a'] + nth - 1) // nth for s in w['stretches'] if s.get('failed'))
        write_json(w['file'][:-4] + '.holds.json', {'version': holdmod.VERSION, 'frames': w['frames'], 'drawn_planned': holdmod.frames_of(w['calls']), **sm,
                                                     'failed': [s['a'] for s in w['stretches'] if s.get('failed')]})
    d.update(seconds=round(time.time() - t0, 1), holds=True, frames_rendered=drawn, frames_held=held, holds_planned=nholds, holds_failed=stats['bad'],
             max_diff=round(stats['max_diff'], 2), entries=stats['entries'])
    say(cut, f"windows done in {time.time() - t0:.0f} s: {drawn} of {frames_todo} frames drawn by Chrome ({100 * drawn / max(1, frames_todo):.0f}% of the windows'), "
             f"{stats['bad']} holds drawn in full after the check, widest difference between samples {stats['max_diff']:.1f}")
    return ws
