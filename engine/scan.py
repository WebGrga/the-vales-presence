"""Measurements of a recording, for the rough cut: `python scan.py [--video <video/>] [--src r1] [--file <recording> --words <tsv>] [--out <dir>]`

It measures and decides nothing. The agent that plans the rough cut reads scan.md (short) or scan.json (everything) and cuts from the
numbers, not from the look of the transcript. Per source recording of out/edl.json (or the one given with --file/--words) it writes
video/out/work/scan.json and scan.md (a source scanned again replaces only its own part; --out DIR writes somewhere else).

  floor_db    the room tone: the 10th percentile of the level (RMS, 20 ms frames) where nobody is talking, digital silence left out
  silences    [s, e] stretches over 0.4 s whose level stays under silence_db = max(floor + 6 dB, speech - 30 dB): from the sound, not from the word gaps
  fillers     {s, e, w}: um, uh, er, ah, hmm, erm and their stretched spellings, from the word file
  retakes     a line said again: {first: [s, e], again: [s, e], words, why}. Two phrases (cut at pauses over 0.5 s, a full stop or a silence in the
              sound) within 30 s that start with the same 3+ words (4+ when they are small words) or share most of their words, or a line that
              restarts itself (the same 3+ words twice within a few words)
  asides      {s, e, db, words, over_floor}: phrases 10+ dB quieter than the phrases around them (a note to the editor); db is how far under
              them (negative), over_floor how far over the room tone (a few dB: may be no speech at all)
  dead_air    [s, e]: no words and no speech-level sound (a click or a cough does not break it) for 2 s or more
  waits       {s, e, screen, speed, moving}: no words for 4 s or more, with the picture measured (2 samples a second, 320x180 grey; a wait over
              20 s in 4 windows of 5 s): screen "busy" when the picture keeps changing (a log, text streaming in, a page loading: over 0.2% of
              the pixels moving in over 40% of the sample pairs; moving = that share), else "still"; a camera strip in a corner that moves far
              more than the rest is left out first and named in `inset`; speed = what plays it in about 3 s, clamped 2..20
Extra keys (all optional to read): speech_db, silence_db, duration, n_words, file, words_file, notes (say what to doubt: no fillers in
the word file, a gated mic, no words).

Times are seconds of the source and come from the word file: an older word file is off by up to a second at the edges of a word (alignment,
transcribe.py, fixes that); the sound-based numbers (silences, dead air, levels) do not depend on it. Audio is decoded once (16 kHz mono,
first audio track, the one transcribe.py reads). Pure parts (frames to stretches, fillers, retakes, asides, the picture verdict, the md)
are tested by test_scan.py.

The jobs are split: scan.py (this: the command, scan.json and the merge), scan_sound.py (levels, room tone, stretches, asides),
scan_words.py (word file, fillers, phrases, retakes), scan_picture.py (waits and how the screen moves), scan_md.py (scan.md).
"""
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pipelib
from scan_md import write_md
from scan_picture import find_waits, has_video, measure_waits
from scan_sound import (DEAD_AIR_MIN, LIVE_BLIP, SILENCE_BELOW_SPEECH, SILENCE_MARGIN, SILENCE_MIN, DIGITAL_DB, SR, STEP, decode_audio,
                        drop_blips, find_asides, frame_db, phrase_levels, room_floor, runs, speech_level, word_mask)
from scan_words import find_fillers, find_retakes, phrases, read_words

VERSION = 1


def analyse(db, words, duration, step=STEP):
    """Everything that comes from the level and the words (no picture): the source's part of scan.json, waits as bare [s, e] in `wait_spans`."""
    n = len(db)
    talk = word_mask(words, n, step, pad=0.15)
    floor = room_floor(db, talk)
    speech = speech_level(db, words, step)
    notes = []
    if not words:
        notes.append('the word file has no words: retakes, fillers and asides are empty')
    elif not find_fillers(words):
        notes.append('no um/uh/er/ah/hmm in the word file: either none were said or this transcript dropped them (older word files do); fillers can not be counted')
    gated = float((db <= DIGITAL_DB).mean()) if n else 0.0
    if gated >= 0.1:
        notes.append(f'{gated * 100:.0f}% of the frames are digital silence (a noise gate on the mic): the room tone is measured on the rest')
    quiet_db = floor + SILENCE_MARGIN
    if speech is not None:
        quiet_db = max(quiet_db, speech - SILENCE_BELOW_SPEECH)
    silences = runs(db < quiet_db, step, SILENCE_MIN, merge_gap=0.04)
    phs = phrases(words, silences)
    levels = phrase_levels(db, words, phs, step)
    dead = []
    if speech is not None:
        live_db = max(floor + 10.0, speech - 20.0)
        live = drop_blips(db > live_db, step)
        dead = runs(~live & ~word_mask(words, n, step, pad=0.1), step, DEAD_AIR_MIN, merge_gap=LIVE_BLIP)
    return {
        'floor_db': round(floor, 1), 'speech_db': None if speech is None else round(speech, 1), 'silence_db': round(quiet_db, 1),
        'duration': round(duration, 3), 'n_words': len(words),
        'silences': silences, 'fillers': find_fillers(words), 'retakes': find_retakes(words, silences),
        'asides': find_asides(words, phs, levels, floor) if speech is not None else [],
        'dead_air': dead, 'wait_spans': find_waits(words, duration), 'notes': notes,
    }

def scan_source(path, words, log=print):
    """One recording: {..the contract's keys..}."""
    t0 = time.time()
    audio = decode_audio(path)
    duration = len(audio) / SR
    log(f'  audio decoded: {duration:.0f} s in {time.time() - t0:.1f} s')
    t1 = time.time()
    db = frame_db(audio)
    del audio
    d = analyse(db, words, duration)
    log(f'  levels, words and stretches: {time.time() - t1:.1f} s')
    t2 = time.time()
    spans = d.pop('wait_spans')
    d['waits'] = measure_waits(path, spans, has_video(path))
    log(f'  picture of {len(spans)} waits ({sum(e - s for s, e in spans):.0f} s): {time.time() - t2:.1f} s')
    return d


def source_list(cut, args):
    """[(id, file path, words path or None, words file as written, file as written)]."""
    if args.file:
        sid = args.src or 'r1'
        return [(sid, os.path.abspath(args.file), os.path.abspath(args.words) if args.words else None, args.words or '', args.file)]
    e = pipelib.read_json(cut.edl)
    out = []
    for sid, s in e['sources'].items():
        if args.src and sid != args.src:
            continue

        def res(rel):
            if not rel:
                return None
            for base in (cut.video, cut.out):
                p = rel if os.path.isabs(rel) else os.path.join(base, *rel.replace('\\', '/').split('/'))
                if os.path.isfile(p):
                    return p
            return os.path.join(cut.video, *rel.replace('\\', '/').split('/'))
        out.append((sid, res(s.get('file')), res(s.get('words')), s.get('words', ''), s.get('file', '')))
    if args.src and not out:
        raise SystemExit(f'No source "{args.src}" in {cut.edl} (it has: {", ".join(e["sources"])}).')
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description='Measure a recording for the rough cut (writes work/scan.json and scan.md).')
    ap.add_argument('--video', help='the workshop video/ folder (default: found from the current folder)')
    ap.add_argument('--src', help='only this source of edl.json (with --file: the id to give it, default r1)')
    ap.add_argument('--file', help='a recording, instead of the sources of edl.json')
    ap.add_argument('--words', help='its word file (start<TAB>end<TAB>word), with --file')
    ap.add_argument('--out', help='write scan.json and scan.md here (default: video/out/work)')
    args = ap.parse_args(argv)
    cut = None
    if args.file:                                      # no edit list needed; a workshop only says where to write
        if args.video or not args.out:
            try:
                cut = pipelib.Cut(args.video)
            except SystemExit:
                if args.video:
                    raise
    else:
        cut = pipelib.Cut(args.video)
    out_dir = os.path.abspath(args.out) if args.out else (cut.work if cut else os.getcwd())
    os.makedirs(out_dir, exist_ok=True)
    srcs = source_list(cut, args)
    log = (lambda m: pipelib.say(cut, m)) if cut is not None and not args.out else print
    jpath, mpath = os.path.join(out_dir, 'scan.json'), os.path.join(out_dir, 'scan.md')
    doc = {'version': VERSION, 'sources': {}}
    if os.path.isfile(jpath):
        try:
            old = pipelib.read_json(jpath)
            if old.get('version') == VERSION:
                doc = old
        except (OSError, ValueError):
            pass
    words_by = {}
    t_all = time.time()
    for sid, path, wpath, wrel, frel in srcs:
        if not path or not os.path.isfile(path):
            log(f'scan {sid}: the recording is missing ({path}), skipped')
            continue
        words = read_words(wpath) if wpath and os.path.isfile(wpath) else []
        log(f'scan {sid}: {path} ({len(words)} words)')
        d = scan_source(path, words, log)
        if not (wpath and os.path.isfile(wpath)):
            d['notes'].insert(0, f'no word file for this source ({wrel or "none named"}): transcribe it first (handover.py --transcribe)')
        d['file'] = frel
        d['words_file'] = wrel
        doc['sources'][sid] = d
        words_by[sid] = words
    for sid, d in doc['sources'].items():             # sources kept from an earlier run: their words for the md
        if sid not in words_by:
            p = d.get('words_file')
            if p and cut is not None:
                for base in (cut.video, cut.out):
                    q = p if os.path.isabs(p) else os.path.join(base, *p.split('/'))
                    if os.path.isfile(q):
                        words_by[sid] = read_words(q)
                        break
            elif p and os.path.isfile(p):
                words_by[sid] = read_words(p)
    pipelib.write_json(jpath, doc)
    with open(mpath, 'w', encoding='utf-8') as f:
        f.write(write_md(doc, words_by))
    log(f'scan done in {time.time() - t_all:.1f} s: {jpath}, {mpath}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
