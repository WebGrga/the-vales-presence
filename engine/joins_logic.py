"""Join safety, the pure part: where the sound is (an energy envelope), what an edge of the cut does to it, and where an edge should move.
Used by joins.py (check, snap) and tested by test_joins.py with synthetic audio. Times are SOURCE seconds. No file or ffmpeg access here.

The envelope is the RMS of the source's audio in 10 ms windows every 5 ms, in dB. Word times can be loose (older whisper files), so the energy is the truth near an
edge; the words only say WHICH word the sound belongs to. The numbers are data below: 0.2 s of room after the last kept word, 0.05 s before the
next one, an edge inside the quiet (no sound within 20 ms of it), under 1.5 s between two cuts plays as a stutter, over 1 s of air at a join is dead air."""
import numpy as np

HOP = 0.005                  # envelope step (s)
WIN = 0.010                  # envelope window (s)
ROOM_AFTER = 0.20            # air wanted after the last kept sound before an edge that ends a piece
ROOM_BEFORE = 0.05           # air wanted before the first kept sound after an edge that starts a piece
NEAR = 0.020                 # "at the edge" = within 20 ms of it
STUTTER = 1.5                # a piece shorter than this between two cuts plays as a stutter
DEAD_AIR = 1.0               # the air left at both sides of one join, together
MAX_MOVE = 0.15              # snap never moves an edge further than this
SLIP = 0.03                  # an edge this close to a word's start or end is "between words", not inside the word
ROOM_SLACK = 0.01           # a frame of rounding is not a problem
TARGET = {'out': 0.22, 'in': 0.08}      # the room snap aims for after / before the sound (it keeps at least ROOM_AFTER / ROOM_BEFORE)


def envelope(x, sr=16000):
    """dB RMS per HOP of a mono float array: frame k covers k*HOP .. k*HOP+WIN."""
    b = int(round(HOP * sr))
    n = len(x) // b
    if n < 2:
        return np.full(1, -180.0)
    e = np.empty(n)
    for a in range(0, n, 1 << 18):             # in chunks: a 45 minute recording is 170 MB of floats
        z = np.asarray(x[a * b:min(n, a + (1 << 18)) * b], dtype=np.float32)
        e[a:a + len(z) // b] = (z * z).reshape(-1, b).sum(1, dtype=np.float64)
    w = (e[:-1] + e[1:]) / (2 * b)
    return 10 * np.log10(w + 1e-18)


class Env:
    """An energy envelope with the numbers read from it: `floor` (room tone of the whole recording, clamped at -80 dB: a gated mic is digital silence), `loud` (speech),
    `thr` per frame (above it is sound: 10 dB over the quietest second nearby, and never under 24 dB below the speech, so music or a fan under the voice is not "sound"),
    `quiet` per frame (4 dB under that: the room)."""

    def __init__(self, db):
        self.db = np.asarray(db, dtype=np.float64)
        self.n = len(self.db)
        self.floor = max(float(np.percentile(self.db, 10)), -80.0)
        self.loud = float(np.percentile(self.db, 90))
        blk = int(round(1.0 / HOP))
        nb = -(-self.n // blk)
        lf = np.array([max(float(np.percentile(self.db[b * blk:(b + 1) * blk], 10)), -80.0) for b in range(nb)])
        lf = np.minimum(np.minimum(lf, np.concatenate([lf[:1], lf[:-1]])), np.concatenate([lf[1:], lf[-1:]]))      # the quietest of this second and its two neighbours
        self.thr = np.maximum(np.repeat(lf, blk)[:self.n] + 10.0, self.loud - 24.0)
        self.quiet = self.thr - 4.0
        self.mask = self.db >= self.thr
        self.gate = float(np.median(self.thr))

    def k(self, t):
        return min(self.n - 1, max(0, int(round((t - WIN / 2) / HOP))))

    def seconds(self):
        return self.n * HOP

    def peak(self, a, b):
        i, j = self.k(a), self.k(b)
        return float(self.db[i:j + 1].max())

    def loud_near(self, a, b):
        """True when the envelope rises over the room (4 dB under the sound threshold) anywhere in a..b."""
        i, j = self.k(a), self.k(b)
        return bool((self.db[i:j + 1] > self.quiet[i:j + 1]).any())

    def sound(self, a, b):
        i, j = self.k(a), self.k(b)
        return bool(self.mask[i:j + 1].any())

    def sound_end_before(self, t, floor_t):
        """End of the last sound before t (not before floor_t), or None."""
        i, j = self.k(floor_t), self.k(t)
        hit = np.nonzero(self.mask[i:j + 1])[0]
        return None if not len(hit) else (i + int(hit[-1])) * HOP + WIN

    def sound_start_after(self, t, ceil_t):
        """Start of the first sound after t (not after ceil_t), or None."""
        i, j = self.k(t), self.k(ceil_t)
        hit = np.nonzero(self.mask[i:j + 1])[0]
        return None if not len(hit) else (i + int(hit[0])) * HOP


def room_of(env, t, side, limit):
    """Air next to an edge on the kept side: seconds from the last sound to an out edge (back to `limit` = the piece's start), from an in edge to the first sound (up to `limit` = the piece's end).
    Nothing but air in the whole piece = the piece's length."""
    if side == 'out':
        s = env.sound_end_before(t, limit)
        return round(max(0.0, t - s), 3) if s is not None else round(max(0.0, t - limit), 3)
    s = env.sound_start_after(t, limit)
    return round(max(0.0, s - t), 3) if s is not None else round(max(0.0, limit - t), 3)


def word_at(words, t):
    """What the sound at t belongs to: ('inside', word) when t is inside a word by more than SLIP from both its ends, ('between', None) at a word boundary, (None, None) when no word is near."""
    best = None
    for w in words:
        if w[0] - 0.25 > t:
            break
        if w[1] + 0.25 < t:
            continue
        if w[0] + SLIP < t < w[1] - SLIP:
            if best is None or (w[1] - w[0]) < (best[1] - best[0]):
                best = w
    if best is not None:
        return 'inside', best
    near = [w for w in words if w[0] - SLIP <= t <= w[1] + SLIP]
    return ('between', near[0]) if near else (None, None)


def edge_state(env, words, t, side, limit):
    """What the edge at source time t does. side 'out' = the piece ends here (the kept sound is before t), 'in' = the piece starts here (kept after t).
    Returns {t, side, state, word, room, peak}: state is 'ok', 'clipped' (a kept word cut off), 'piece' (a bit of a removed word kept), 'speech' (cut inside continuous speech or a noise
    with no word to name), plus `issues` = every problem in plain codes: clipped, piece, speech, room, loud."""
    pk = env.peak(t - NEAR, t + NEAR)
    across = env.sound(t - NEAR, t - HOP) and env.sound(t + HOP, t + NEAR)
    room = room_of(env, t, side, limit)
    st = {'t': round(t, 3), 'side': side, 'state': 'ok', 'word': None, 'room': room, 'peak': round(pk, 1), 'quiet': round(float(env.quiet[env.k(t)]), 1), 'issues': []}
    if across:
        where, w = word_at(words, t)
        if where == 'inside':
            mid = (w[0] + w[1]) / 2
            kept = (mid < t) if side == 'out' else (mid > t)
            st['state'] = 'clipped' if kept else 'piece'
            st['word'] = w[2]
        else:
            st['state'] = 'speech'
            st['word'] = w[2] if w else None
        st['issues'].append(st['state'])
    else:
        if room < (ROOM_AFTER if side == 'out' else ROOM_BEFORE) - ROOM_SLACK:
            st['issues'].append('room')
        if env.loud_near(t - NEAR, t + NEAR):
            st['issues'].append('loud')
    return st


def _score(env, side, limit, p):
    """How good it is to put the edge at p: a tuple, smaller is better. (is there sound across p, room short, how loud near p in 3 dB steps, distance of the room from its target)"""
    if env.sound(p - NEAR, p + NEAR):          # never land inside sound (a kept word cut, or a removed one let in)
        return (2, 0, 0, 0.0)
    room = room_of(env, p, side, limit)
    need = ROOM_AFTER if side == 'out' else ROOM_BEFORE
    short = 1 if room < need - ROOM_SLACK else 0
    return (short, round(env.peak(p - NEAR, p + NEAR) / 3.0), abs(min(room, 3.0) - TARGET[side]) if not short else -room, 0.0)


def sound_run(env, t, bridge=0.02):
    """(start, end) of the stretch of sound around t, dips shorter than `bridge` s bridged: where a clipped word really starts and ends."""
    k = env.k(t)
    m, gap = env.mask, int(round(bridge / HOP))
    i = k
    miss = 0
    while i > 0 and miss <= gap:
        miss = 0 if m[i - 1] else miss + 1
        i -= 1
    j = k
    miss = 0
    while j < env.n - 1 and miss <= gap:
        miss = 0 if m[j + 1] else miss + 1
        j += 1
    while i < k and not m[i]:
        i += 1
    while j > k and not m[j]:
        j -= 1
    return i * HOP, j * HOP + WIN


def plan_edge(env, words, t, side, limit, lo, hi, reach=MAX_MOVE):
    """Where an edge at t should go: (new t, why) or (None, why not). The edge may move at most `reach` (MAX_MOVE) and stay in [lo, hi]; it never crosses a word's midpoint
    (so no kept word is cut and no removed word is let in), and never lands inside sound. Only an edge with a problem moves."""
    st = edge_state(env, words, t, side, limit)
    if not st['issues']:
        return None, 'fine'
    mids = [(w[0] + w[1]) / 2 for w in words]
    before = [m for m in mids if m < t]
    after = [m for m in mids if m >= t]
    a = max(lo, t - reach, (max(before) if before else -1e9) + 0.001)
    b = min(hi, t + reach, (min(after) if after else 1e9) - 0.001)
    cur = _score(env, side, limit, t)
    best, bs = None, cur
    p = a
    while p <= b + 1e-9:
        s = _score(env, side, limit, p)
        if s < bs:
            best, bs = p, s
        p += HOP
    if best is None or bs[0] >= 2:
        a0, b0 = sound_run(env, t)
        keep, drop = (b0 + 0.1, a0 - 0.1) if side == 'out' else (a0 - 0.1, b0 + 0.1)
        return None, ('no quiet place within %.2f s that keeps every word: the sound here runs from %.3f to %.3f; put the edge at %.3f to keep it or %.3f to drop it, by hand'
                      % (reach, a0, b0, keep, drop))
    return round(best, 3), ('moved %+.0f ms' % ((best - t) * 1000))


def contiguous(a, b, tol=0.004):
    """Two items of one source that play one stretch straight on (a split of the item, not a cut)."""
    return 'src' in a and a.get('src') == b.get('src') and 'src_out' in a and 'src_in' in b and abs(b['src_in'] - a['src_out']) < tol


def frames(seconds, fps):
    return max(1, int(round(seconds * fps)))
