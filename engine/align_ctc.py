"""The forced alignment (align.py's second job): windows for the model, groups of words, the CTC Viterbi and the word times it gives.
Plain numpy; no model, tested by test_align.py."""
import numpy as np

from align_text import WILD, group_tokens, word_readings

SR = 16000
FRAME = 320                    # samples per model frame (20 ms)
FRAME_S = FRAME / SR
RECEPTIVE = 400                # samples one frame sees
NEG = -1e30
ONSET_LEAD = 0.04              # a letter is emitted a little after its sound starts: starts are put this much earlier (measured, see README)
END_PAD = 0.04                 # seconds added to a word end, as far as the next word start allows (measured: word ends otherwise clip their last sound)
MAX_TAIL = 15                  # frames (300 ms): the most a word's end reaches past its last letter
MAX_GAP = 25                   # frames: letters of one word further apart than this were found in noise
GROUP_S = 25.0                 # words are aligned in groups of about this many seconds


def plan_groups(words, max_s=GROUP_S, min_gap=0.3):
    """Words (start, end, text) cut into runs of about max_s seconds, each cut at the longest pause in the run's last third. [(first, last)] inclusive."""
    n = len(words)
    groups, i = [], 0
    while i < n:
        j = i
        while j + 1 < n and words[j + 1][1] - words[i][0] <= max_s:
            j += 1
        if j + 1 < n and j > i:
            lo = max(i, j - max(1, (j - i) // 3))
            best, at = min_gap, None
            for k in range(lo, j + 1):
                gap = words[k + 1][0] - words[k][1]
                if gap >= best:
                    best, at = gap, k
            if at is not None:
                j = at
        groups.append((i, j))
        i = j + 1
    return groups


def frames_for(samples):
    return 0 if samples < RECEPTIVE else (samples - RECEPTIVE) // FRAME + 1


def plan_chunks(samples, size=30 * SR, overlap=2 * SR):
    """Windows of at most `size` samples for the model, overlapping by about `overlap`. Starts sit on frame boundaries so frames line up globally;
    each frame is kept from the window it is nearest the middle of: keep = [first, last) in global frames."""
    total = frames_for(samples)
    chunks = []
    if not total:
        return chunks
    stride = max(FRAME, (size - overlap) // FRAME * FRAME)
    start = 0
    while True:
        last = start + size >= samples
        if last:
            start = max(0, -(-(samples - size) // FRAME) * FRAME)
        length = min(size, samples - start)
        first = start // FRAME
        keep = first
        if chunks:
            prev = chunks[-1]
            keep = (first + prev["start"] // FRAME + frames_for(prev["length"])) // 2
            prev["keep"][1] = keep
        chunks.append({"start": start, "length": length, "keep": [keep, first + frames_for(length)]})
        if last:
            break
        start += stride
    return chunks


def stitch(chunks, outputs):
    """The windows' outputs (frames x classes each) as one (frames x classes) matrix."""
    frames = chunks[-1]["keep"][1] if chunks else 0
    out = np.zeros((frames, outputs[0].shape[1]), dtype=np.float32) if outputs else np.zeros((0, 1), dtype=np.float32)
    for c, o in zip(chunks, outputs):
        first = c["start"] // FRAME
        a, b = c["keep"]
        out[a:b] = o[a - first:b - first]
    return out

def ctc_path(lp, tokens, needed=None, wild_cols=()):
    """Viterbi through the CTC topology (optional blanks around every label, a blank required between repeated labels) over the frames of lp (T x classes, log odds).
    The first `needed` tokens must all be placed; tokens after them are optional context (the path may stop after any of them) and are not returned.
    Returns (spans, score): spans[k] = (first frame, last frame) of token k; None when the frames cannot hold the tokens."""
    T, C = lp.shape
    L = len(tokens)
    if not L:
        return None
    needed = L if needed is None else min(max(1, needed), L)
    required = needed + sum(1 for k in range(1, needed) if tokens[k] == tokens[k - 1] and tokens[k] != WILD)
    S = 2 * L + 1
    if T < required or T * S > 80e6:
        return None
    cols = list(tokens)
    if WILD in tokens:
        wild = lp[:, list(wild_cols)].max(axis=1, keepdims=True) if len(wild_cols) else np.full((T, 1), -5.0, dtype=lp.dtype)
        lp = np.concatenate([lp, wild], axis=1)
        cols = [C if t == WILD else t for t in tokens]
    idx = np.zeros(S, dtype=np.int64)
    idx[1::2] = cols
    E = lp[:, idx].astype(np.float32)
    skip = np.zeros(S, dtype=bool)
    for s in range(3, S, 2):
        a, b = tokens[(s - 1) // 2], tokens[(s - 3) // 2]
        skip[s] = a != b or a == WILD
    back = np.zeros((T, S), dtype=np.uint8)
    prev = np.full(S, NEG, dtype=np.float32)
    prev[0], prev[1] = E[0, 0], E[0, 1]
    pen = np.where(skip, 0.0, NEG).astype(np.float32)          # a label may be entered from two states back only when it differs from the label before
    cand = np.full((3, S), NEG, dtype=np.float32)                # stay, step from the state before, skip a blank
    here = np.arange(S)
    for t in range(1, T):
        cand[0] = prev
        cand[1, 1:] = prev[:-1]
        np.add(prev[:-2], pen[2:], out=cand[2, 2:])
        arg = cand.argmax(axis=0)
        back[t] = arg
        prev = cand[arg, here] + E[t]
    finish = 2 * needed + 1
    s = S - 1
    for e in range(S - 2, finish - 3, -1):
        if prev[e] > prev[s]:
            s = e
    if prev[s] < NEG / 2:
        return None
    score = float(prev[s])
    first, last = [None] * L, [None] * L
    for t in range(T - 1, -1, -1):
        if s % 2:
            k = (s - 1) // 2
            first[k] = t
            if last[k] is None:
                last[k] = t
        if t:
            s -= int(back[t, s])
    spans = [(first[k], last[k]) for k in range(needed)]
    return spans, score


def peak(lp, token, span):
    return float(np.exp(lp[span[0]:span[1] + 1, token].max()))


def align_run(lp, words, frame_a, frame_b, alpha, context=(), wild_cols=(), prev_end=0.0, origin=0.0, variants=False):
    """Align one run of words inside frames [frame_a, frame_b) of lp (the whole recording, frames x classes). `context` = the words after the run, read as optional.
    With `variants`, every other way a number may be said is tried too, and the one that explains the sound best is kept.
    Returns [(start, end, score) or None] for each word, seconds."""
    reading = [0] * len(words)
    best = _align_reading(lp, words, frame_a, frame_b, alpha, context, wild_cols, prev_end, origin, reading)
    for i, w in enumerate(words if variants else ()):
        ways = word_readings(w, alpha)
        for r in range(1, len(ways) if ways else 0):
            tried_reading = reading[:i] + [r] + reading[i + 1:]
            tried = _align_reading(lp, words, frame_a, frame_b, alpha, context, wild_cols, prev_end, origin, tried_reading)
            if tried[1] > best[1]:
                reading, best = tried_reading, tried
    return best[0]


def _align_reading(lp, words, frame_a, frame_b, alpha, context, wild_cols, prev_end, origin, reading):
    out = [None] * len(words)
    none = (out, -float("inf"))
    tokens, owner, spoken, spelled = group_tokens(words, alpha, reading)
    if not spelled or spelled < 0.6 * spoken:
        return none
    ctx = group_tokens(list(context), alpha)[0]
    window = lp[frame_a:frame_b]
    found = ctc_path(window, tokens + ctx, needed=len(tokens), wild_cols=wild_cols)
    if not found:
        return none
    spans, score = found
    spans = [(a + frame_a, b + frame_a) for a, b in spans]
    sep = alpha["sep"]
    t_of = lambda f: origin + f * FRAME_S
    k, previous_end = 0, prev_end
    while k < len(tokens):
        w = owner[k]
        if w < 0:
            k += 1
            continue
        first = k
        total, letters, spread = 0.0, 0, False
        while k < len(tokens) and owner[k] == w:
            if tokens[k] != WILD:
                total += peak(lp, tokens[k], spans[k])
                letters += 1
            if (k > first and tokens[k] != WILD and tokens[k - 1] != WILD and tokens[k] != sep and tokens[k - 1] != sep
                    and spans[k][0] - spans[k - 1][1] - 1 > MAX_GAP):
                spread = True
            k += 1
        if not letters:
            continue
        start = max(0.0, previous_end, t_of(spans[first][0]) - ONSET_LEAD)
        end_frame = spans[k - 1][1] + 1
        if sep is not None and k < len(tokens) and tokens[k] == sep:
            end_frame = min(spans[k][1] + 1, end_frame + MAX_TAIL)
        end = max(start, t_of(end_frame))
        out[w] = (start, end, 0.0 if spread else total / letters)
        previous_end = end
    got = [i for i, t in enumerate(out) if t]
    for n, i in enumerate(got):
        s0, e0, c0 = out[i]
        room = out[got[n + 1]][0] if n + 1 < len(got) else e0 + END_PAD
        out[i] = (s0, max(e0, min(e0 + END_PAD, room)), c0)
    return out, score
