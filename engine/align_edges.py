"""Putting the times back (align.py's third job): the loudness of the recording, sound islands, fillers placed on the sound, the merge of aligned and kept
times, and the last pass that moves an edge out to the edge of the sound it sits in. Plain numpy; tested by test_align.py."""
import numpy as np

from align_text import is_filler, word_readings

MIN_SCORE = 0.2                # mean letter probability under this = not heard: the word keeps its old time
SNAP_REACH = 0.12             # seconds: how far an edge may be moved out to the edge of the sound it sits in


def rms_db(audio, hop=160):
    """Loudness in dB of every 10 ms of the audio."""
    n = len(audio) // hop
    if not n:
        return np.zeros(0)
    x = audio[:n * hop].reshape(n, hop).astype(np.float64)
    return 20 * np.log10(np.sqrt((x ** 2).mean(axis=1)) + 1e-6)


def sound_islands(db, lo, hi, over=12.0, hop=0.01, min_len=0.04, bridge=0.05):
    """Where there is sound between lo and hi seconds: [(start, end)] of the runs of 10 ms frames louder than the room's floor + `over` dB
    (the floor = the quietest tenth of the 6 s around), dips under `bridge` s joined, runs under `min_len` s dropped."""
    a, b = max(0, int(lo / hop)), min(len(db), int(hi / hop) + 1)
    if b <= a:
        return []
    mid = (a + b) // 2
    floor = float(np.percentile(db[max(0, mid - 300):mid + 300], 10))
    loud = db[a:b] > floor + over
    runs, i = [], 0
    while i < len(loud):
        if not loud[i]:
            i += 1
            continue
        j = i
        while j < len(loud) and loud[j]:
            j += 1
        if runs and (i - runs[-1][1]) * hop <= bridge:
            runs[-1][1] = j
        else:
            runs.append([i, j])
        i = j
    return [((a + i) * hop, (a + j) * hop) for i, j in runs if (j - i) * hop >= min_len]


def keep_on_sound(run, spoken, islands, lo, reach=0.3):
    """Put a run of words the aligner could not place (fillers: it cannot hear "uh" as letters) on the sound between its placed neighbours.
    Each spoken word goes with the island of sound its estimate covers most, or the nearest within `reach`, never one before the island of the word before it.
    The first word on an island starts where the sound starts, the last ends where it ends. A word near no sound was not heard: zero length, right after the word before."""
    heard, floor = [], 0
    for t, sp in zip(run, spoken):
        if not sp or not islands:
            heard.append(None)
            continue
        over = lambda k: min(islands[k][1], t[1]) - max(islands[k][0], t[0])
        dist = lambda k: max(islands[k][0] - t[1], t[0] - islands[k][1], 0.0)
        best = None
        for k in range(floor, len(islands)):
            if over(k) > 0 and (best is None or over(k) > over(best)):
                best = k
        if best is None:
            for k in range(floor, len(islands)):
                if dist(k) <= reach and (best is None or dist(k) < dist(best)):
                    best = k
        heard.append(best)
        if best is not None:
            floor = best
    previous = lo
    for i, (t, sp) in enumerate(zip(run, spoken)):
        k = heard[i]
        if not sp:
            t[0] = max(t[0], previous)
            t[1] = max(t[1], t[0])
        elif k is None:
            t[0] = t[1] = previous
        else:
            first, last = heard.index(k) == i, len(heard) - 1 - heard[::-1].index(k) == i
            length = t[1] - t[0]
            t[0] = max(previous, islands[k][0] if first else min(max(t[0], islands[k][0]), islands[k][1]))
            t[1] = max(t[0], islands[k][1] if last else min(islands[k][1], max(t[1], t[0] + length)))
        previous = t[1]


def snap_to_sound(words, scores, db, min_score=MIN_SCORE, reach=SNAP_REACH, over=12.0, hop=0.01):
    """A letter model puts a word's start and end on the letters, not on the sound: a long vowel or a soft ending lies a little outside. Where the edge of a placed
    word sits INSIDE a stretch of sound that began (or goes on) at most `reach` s away, with quiet at the far end of that stretch, the edge goes out to the
    stretch's edge. Never past the word before or after, and a stretch that runs on without a quiet gap (connected speech) is left alone."""
    out = list(words)
    n = len(out)
    for i in range(n):
        s0, e0, w = out[i]
        if scores[i] < min_score or is_filler(w):
            continue
        f, g = int(s0 / hop), int(e0 / hop)
        if f >= len(db):
            continue
        mid = min(max(f, 0), len(db) - 1)
        thr = float(np.percentile(db[max(0, mid - 300):mid + 300], 10)) + over
        prev_end = out[i - 1][1] if i else 0.0
        next_start = out[i + 1][0] if i + 1 < n else float("inf")
        if db[f] > thr:                                   # the start is inside sound
            lo = max(int(max(prev_end, s0 - reach) / hop), 0)
            k = f
            while k > lo and db[k - 1] > thr:
                k -= 1
            if k > lo and k < f:
                s0 = k * hop
        if g < len(db) and db[g] > thr:                   # the end is inside sound
            hi = min(int(min(next_start, e0 + reach) / hop), len(db) - 1)
            k = g
            while k < hi and db[k + 1] > thr:
                k += 1
            if k < hi and k > g:
                e0 = (k + 1) * hop
        out[i] = (round(s0, 3), round(max(s0, e0), 3), w)
    return out


def merge_times(words, timings, min_score=MIN_SCORE, db=None, alpha=None):
    """The words with their new times. A word aligned with score >= min_score takes the aligned time; any other keeps its own, fitted in
    between the placed words around it (so the order holds and nothing overlaps the neighbours it sits between), and, when the loudness `db` and
    the alphabet are given, put on the sound there (keep_on_sound).
    words = [(start, end, text)], timings = [(start, end, score) or None]. Returns ([(start, end, text)], [score])."""
    n = len(words)
    # a filler is never placed by its letters: a letter model hears "uh" as a bit of an "ah", often the last bit of it. With the loudness known, it goes on the sound.
    by_sound = [db is not None and alpha is not None and is_filler(words[i][2]) for i in range(n)]
    placed = [bool(t and t[2] >= min_score and t[1] >= t[0]) and not by_sound[i] for i, t in enumerate(timings)]
    times = [[timings[i][0], timings[i][1]] if placed[i] else [words[i][0], words[i][1]] for i in range(n)]
    for i in range(n):
        if by_sound[i] and timings[i]:                        # the guide is both estimates together
            times[i] = [min(times[i][0], timings[i][0]), max(times[i][1], timings[i][1])]
    i = 0
    while i < n:
        if placed[i]:
            i += 1
            continue
        a = i
        while i < n and not placed[i]:
            i += 1
        lo = times[a - 1][1] if a > 0 else None
        hi = times[i][0] if i < n else None
        run = times[a:i]
        rs, re_ = min(t[0] for t in run), max(t[1] for t in run)
        if lo is not None and rs < lo and hi is None:
            shift = lo - rs
            for t in run:
                t[0] += shift
                t[1] += shift
        elif lo is not None and hi is not None and (rs < lo or re_ > hi):
            if hi <= lo:
                for t in run:
                    t[0] = t[1] = lo
            else:
                x, y = max(lo, rs), min(hi, re_)
                x, y = (x, y) if y > x else (lo, hi)
                scale = (y - x) / (re_ - rs) if re_ > rs else 0.0
                for t in run:
                    s0 = x + (t[0] - rs) * scale
                    t[1] = max(s0, x + (t[1] - rs) * scale)
                    t[0] = s0
        elif lo is None and hi is not None and re_ > hi:
            for t in run:
                t[0] = min(t[0], hi)
                t[1] = min(t[1], hi)
        if db is not None and alpha is not None and (lo is not None or hi is not None):
            gap_lo = lo if lo is not None else max(0.0, rs - 0.5)
            gap_hi = hi if hi is not None else re_ + 0.5
            if gap_hi > gap_lo:
                spoken = [bool(word_readings(words[a + k][2], alpha)) for k in range(len(run))]
                keep_on_sound(run, spoken, sound_islands(db, gap_lo, gap_hi), gap_lo)
    out = [(round(times[k][0], 3), round(max(times[k][0], times[k][1]), 3), words[k][2]) for k in range(n)]
    scores = [round(timings[k][2], 3) if placed[k] else 0.0 for k in range(n)]
    return out, scores
