# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["torch>=2.7,<2.9","torchaudio>=2.7,<2.9","numpy"]
# [tool.uv.sources]
# torch = [{ index = "pytorch-cu126", marker = "sys_platform != 'darwin'" }]
# torchaudio = [{ index = "pytorch-cu126", marker = "sys_platform != 'darwin'" }]
# [[tool.uv.index]]
# name = "pytorch-cu126"
# url = "https://download.pytorch.org/whl/cu126"
# explicit = true
# ///
"""Word edges where the sound really is: uv run align.py <audio-or-video> <words.tsv> [--out <tsv>] [--model w2v2|mms] [--fp32] [--min-score 0.2]
Takes a word file (start<TAB>end<TAB>word per line, from whisper or anywhere) and moves every word's start and end to where the model hears it:
a wav2vec2 CTC model on the GPU when there is one, else the CPU (default wav2vec2-base-960h, "w2v2"; torchaudio's MMS_FA with --model mms) gives, for every 20 ms, the odds of each letter;
a forced alignment (Viterbi over those odds) lays the word's letters on the sound in the order the transcript says. Whisper's own word times run
100-300 ms off, so a cut on them clips a word or leaves a breath; these sit on the sound.
Writes the same 3-column file (default <words stem>.aligned.tsv, or --out) and a sidecar <out>.align.json = {"model", "words": [[start, end, word, score]], "ms"}.
score = how well the letters were heard (0..1); 0 = the word was NOT placed by the model and keeps its old time, fitted between its placed neighbours
(a number or symbol it cannot spell, text the audio does not hold, a filler). Nothing is dropped or reordered: the same words come out, in the same order.
  - fillers (um, uh, er, ah, hmm): a letter model cannot hear them, so they are put on the stretch of sound between their neighbours (loudness in 10 ms steps);
    one with no sound there gets no length.
  - numbers and symbols are spoken: "429" is tried as "four hundred twenty nine" and "four twenty nine"; what cannot be spelled keeps its time.
  - last, an edge that sits inside a stretch of sound which started (or goes on) within 0.12 s, with quiet at its far end, goes out to that stretch's edge.
The recording runs through the model in 30 s windows (2 s overlap), the words are aligned in groups of about 25 s, so an hour fits in memory.
align.py <audio> --emit <odds.npy> does the model's half alone (it needs no words): transcribe.py starts it while whisper runs, then --emissions <odds.npy> finishes.
The parts that need no model (text to letters, numbers said in words, groups, windows, merging times back) are plain functions, tested by test_align.py."""
import json
import os
import subprocess
import sys
import time

import numpy as np

from align_ctc import FRAME_S, SR, align_run, plan_chunks, plan_groups, stitch
from align_edges import MIN_SCORE, merge_times, rms_db, snap_to_sound
from align_text import alpha_from_labels, is_filler, word_readings    # noqa: F401  is_filler: the one the other scripts import

PAD_BEFORE = 0.6               # the window starts this much before a group's first word (whisper's start runs early/late)
PAD_AFTER = 1.0                # ... and ends this much after its last word, so the next words can be read as optional context
CONTEXT_WORDS = 8


# ---------- word files ----------

def read_words(path):
    """[(start, end, word)] from a word file; lines without three columns are skipped."""
    out = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            p = line.rstrip("\n").split("\t")
            if len(p) >= 3 and p[2].strip():
                out.append((float(p[0]), float(p[1]), p[2].strip()))
    return out


def format_words(words):
    return "".join(f"{s:.3f}\t{e:.3f}\t{w}\n" for s, e, w in words)


def sidecar_doc(model, words, scores, ms):
    return {"model": model, "words": [[round(s, 3), round(e, 3), w, round(c, 3)] for (s, e, w), c in zip(words, scores)], "ms": int(ms)}

def align_words(lp, words, alpha, wild_cols=(), min_score=MIN_SCORE, db=None, log=None):
    """Align every word of the word list against the whole recording's emissions lp (frames x classes). Returns (new words, scores).
    First every group of about 25 s at once; then the numbers that were not heard are tried in their other spellings between their placed neighbours."""
    total = lp.shape[0]
    n = len(words)
    timings = [None] * n
    prev_end = 0.0
    for first, last in plan_groups(words):
        texts = [w[2] for w in words[first:last + 1]]
        a = max(words[first][0] - PAD_BEFORE, prev_end, 0.0)
        b = words[last][1] + PAD_AFTER
        fa = max(0, int(a / FRAME_S))
        fb = min(total, int(b / FRAME_S) + 1)
        context = [w[2] for w in words[last + 1:last + 1 + CONTEXT_WORDS] if w[0] < b + 1.0]
        if fb > fa:
            got = align_run(lp, texts, fa, fb, alpha, context, wild_cols, prev_end=a)
            for k, t in enumerate(got):
                timings[first + k] = t
            ends = [t[1] for t in got if t and t[2] >= min_score]
            if ends:
                prev_end = ends[-1]
        if log:
            log(words[last][1])
    ok = lambda k: bool(timings[k] and timings[k][2] >= min_score)
    i = 0
    while i < n:
        if ok(i):
            i += 1
            continue
        a = i
        while i < n and not ok(i):
            i += 1
        ways = [len(word_readings(words[k][2], alpha) or []) for k in range(a, i)]
        if max(ways) < 2:
            continue
        lo = timings[a - 1][1] if a > 0 and timings[a - 1] else words[a][0] - PAD_BEFORE
        hi = timings[i][0] if i < n and timings[i] else words[i - 1][1] + PAD_AFTER
        fa, fb = max(0, int(lo / FRAME_S)), min(total, int(hi / FRAME_S) + 1)
        if fb > fa:
            got = align_run(lp, [words[k][2] for k in range(a, i)], fa, fb, alpha, (), wild_cols, prev_end=lo, variants=True)
            for k, t in enumerate(got):
                if t and t[2] >= min_score and not ok(a + k):
                    timings[a + k] = t
    new, scores = merge_times(words, timings, min_score, db, alpha)
    if db is not None:
        new = snap_to_sound(new, scores, db, min_score)
    return new, scores


# ---------- the model ----------

MODELS = {"mms": "MMS_FA", "w2v2": "WAV2VEC2_ASR_BASE_960H"}
# the models' classes, as torchaudio lists them (checked against the bundle when the model runs), so the second half needs no torch
LABELS = {
    "w2v2": ("-", "|", "E", "T", "A", "O", "N", "I", "H", "S", "R", "D", "L", "U", "M", "W", "C", "F", "G", "Y", "P", "B", "V", "K", "'", "X", "J", "Q", "Z"),
    "mms": ("-", "a", "i", "e", "n", "o", "u", "t", "s", "r", "m", "k", "l", "d", "g", "h", "y", "b", "p", "w", "c", "v", "j", "z", "f", "'", "q", "x", "*"),
}


def load_audio(path):
    """16 kHz mono float32 samples of any audio or video file (ffmpeg)."""
    p = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], stdout=subprocess.PIPE, check=True)
    return np.frombuffer(p.stdout, dtype=np.float32)


def wild_columns(alpha):
    """The classes a wildcard may take the sound of: the letters."""
    return sorted(set(alpha["letters"].values()))


def emissions(audio, model_key="w2v2", half=True, log=None):
    """Log odds of every class for every 20 ms frame of the whole recording (frames x classes), run in overlapping 30 s windows on the GPU (CUDA, half precision) or the CPU.
    Needs the words of nobody, so transcribe.py starts it while whisper is still running."""
    import torch
    import torchaudio
    bundle = getattr(torchaudio.pipelines, MODELS[model_key])
    if tuple(bundle.get_labels()) != LABELS[model_key]:
        raise SystemExit(f"align: {MODELS[model_key]} lists other classes than this script knows")
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    half = half and dev == "cuda"
    model = bundle.get_model().to(dev).eval()
    if half:
        model = model.half()
    norm = bool(getattr(bundle, "_normalize_waveform", False))
    chunks = plan_chunks(len(audio))
    outs = []
    with torch.inference_mode():
        for n, c in enumerate(chunks):
            x = torch.from_numpy(audio[c["start"]:c["start"] + c["length"]].copy()).to(dev)[None]
            if norm:
                x = (x - x.mean()) / (x.std() + 1e-7)
            em, _ = model(x.half() if half else x)
            outs.append(torch.log_softmax(em.float(), dim=-1)[0].cpu().numpy())
            if log and n % 10 == 0:
                log((c["start"] + c["length"]) / SR)
    lp = stitch(chunks, outs)
    del model
    if dev == "cuda":
        torch.cuda.empty_cache()
    return lp


def run(src, tsv, out, model_key="w2v2", half=True, min_score=MIN_SCORE, emitted=None):
    """Align the word file `tsv` to the audio of `src`; write `out` and `out`.align.json. `emitted` = a .npy of emissions made earlier by --emit.
    Returns (aligned words, scores, ms)."""
    t0 = time.time()
    words = read_words(tsv)
    if not words:
        raise SystemExit(f"align: no words in {tsv}")
    say = lambda msg: print(msg, file=sys.stderr, flush=True)
    audio = load_audio(src)
    lp = np.load(emitted) if emitted else emissions(audio, model_key, half)
    say(f"align: {lp.shape[0]} frames of odds ready after {time.time() - t0:.1f} s" + (" (made while whisper ran)" if emitted else ""))
    alpha = alpha_from_labels(LABELS[model_key])
    if lp.shape[1] != len(LABELS[model_key]):
        raise SystemExit(f"align: {emitted} has {lp.shape[1]} classes, {model_key} has {len(LABELS[model_key])}")
    new, scores = align_words(lp, words, alpha, wild_columns(alpha), min_score, rms_db(audio))
    ms = (time.time() - t0) * 1000
    with open(out, "w", encoding="utf-8") as f:
        f.write(format_words(new))
    with open(out + ".align.json", "w", encoding="utf-8") as f:
        json.dump(sidecar_doc(MODELS[model_key], new, scores, ms), f, ensure_ascii=False)
    placed = sum(1 for c in scores if c >= min_score)
    say(f"align: {placed}/{len(new)} words placed, {len(new) - placed} kept their old time, {ms / 1000:.1f} s")
    return new, scores, ms


def main():
    args = sys.argv[1:]

    def opt(name, default=None, flag=False):
        if name in args:
            i = args.index(name)
            if flag:
                del args[i]
                return True
            v = args[i + 1]
            del args[i:i + 2]
            return v
        return default

    out = opt("--out")
    emit = opt("--emit")
    emitted = opt("--emissions")
    model_key = opt("--model", "w2v2")
    fp32 = opt("--fp32", flag=True)
    min_score = float(opt("--min-score", MIN_SCORE))
    if model_key not in MODELS or len(args) != (1 if emit else 2):
        raise SystemExit(__doc__.split("\n")[0] + "\n   or: align.py <audio-or-video> --emit <odds.npy> [--model ..]  (the model's part alone, to be run while whisper runs; later --emissions <odds.npy>)")
    if emit:
        np.save(emit, emissions(load_audio(args[0]), model_key, not fp32))
        print("DONE", file=sys.stderr)
        return
    src, tsv = args
    if out is None:
        out = os.path.splitext(tsv)[0] + ".aligned.tsv"
    run(src, tsv, out, model_key, not fp32, min_score, emitted)
    print("DONE", file=sys.stderr)


if __name__ == "__main__":
    main()
