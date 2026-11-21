"""One command for a visuals round. Safe to start with run_in_background and end the turn: no prompts, progress in video/out/work/pipeline.log,
every step timed in video/out/steps.jsonl, the exit code is 0 only when everything passed.

    python run.py --proof [--video <video/>]            events check -> render changed windows at 540p 30 fps -> proof.mp4 + proof-sheet.jpg
    python run.py --final [--video <video/>] [--words] [--force] [--prune]  events check -> render changed windows (full quality) -> compose in chunks -> check_cut -> frames.jpg

Speed-ups (both on by default): still stretches of an overlay are drawn once and held (--no-holds draws every frame), and the final is composed in cached chunks joined
with -c copy (--single = one pass over the whole video; --chunk-seconds N; --jobs N chunks at a time). --force re-renders every window and re-encodes every chunk;
--prune deletes cache files the cut no longer uses. See README.md.

Needs video/out/rough.json (handover.py) and video/out/events.json (the template's make_overlays.py). Only windows whose hash changed are rendered.
"""
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_cut
import compose
import events as evmod
import render_windows
import sheet
import user_edits
from pipelib import Cut, fail, now_iso, read_json, say, step


def log_round(cut, name, start, t0, rc):
    import json
    with open(cut.steps, 'a', encoding='utf-8') as f:
        f.write(json.dumps({'step': name, 'start': start, 'ms': int((time.time() - t0) * 1000), 'detail': {'exit': rc, 'note': 'the whole round'}}) + '\n')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument('--proof', action='store_true'); g.add_argument('--final', action='store_true')
    ap.add_argument('--video'); ap.add_argument('--words', action='store_true'); ap.add_argument('--no-check', action='store_true'); ap.add_argument('--prune', action='store_true'); ap.add_argument('--force', action='store_true')
    ap.add_argument('--parallel', type=int, default=5); ap.add_argument('--concurrency', type=int, default=4)
    ap.add_argument('--no-holds', action='store_true'); ap.add_argument('--single', action='store_true')
    ap.add_argument('--chunk-seconds', type=float, default=None); ap.add_argument('--jobs', type=int, default=None)
    a = ap.parse_args(argv)
    cut = Cut(a.video)
    t0 = time.time()
    t_iso = now_iso()
    say(cut, f'=== {"proof" if a.proof else "final"} round started {t_iso} ===')
    if not os.path.isfile(cut.rough_json):
        fail(cut, 'no rough.json: run handover.py at the end of the rough cut stage.')
    if not os.path.isfile(cut.events):
        fail(cut, 'no events.json: the visuals step writes it (the template\'s make_overlays.py).')
    rc = evmod.main(['check', '--video', cut.video])
    if rc:
        return rc
    ws = render_windows.render(cut, proof=a.proof, parallel=a.parallel, concurrency=a.concurrency, prune=a.prune, force=a.force, hold=not a.no_holds)
    doc = user_edits.load(cut)
    if a.proof:
        rc = compose.main(['--proof', '--video', cut.video])
        if rc:
            return rc
        with step(cut, 'proof-sheet') as d:
            d['frames'] = sheet.make(cut, cut.proof, os.path.join(cut.out, 'proof-sheet.jpg'), every=2.0, width=320, cols=8)
        say(cut, f'=== proof done in {time.time() - t0:.0f} s: {cut.proof}, proof-sheet.jpg ===')
        log_round(cut, 'run-proof', t_iso, t0, 0)
        return 0
    cargs = ['--final', '--video', cut.video] + (['--single'] if a.single else []) + (['--force'] if a.force else []) + (['--prune'] if a.prune else []) \
        + (['--chunk-seconds', str(a.chunk_seconds)] if a.chunk_seconds else []) + (['--jobs', str(a.jobs)] if a.jobs else [])
    rc = compose.main(cargs)
    if rc:
        return rc
    rc = 0
    if not a.no_check:
        rc = check_cut.main(['--video', cut.video] + (['--words'] if a.words else []))
    sheet.main(['--video', cut.video])
    say(cut, f'=== final done in {time.time() - t0:.0f} s: {cut.final}{"" if not rc else " (THE CUT CHECK FAILED)"} ===')
    log_round(cut, 'run-final', t_iso, t0, rc)
    return rc


if __name__ == '__main__':
    sys.exit(main())
