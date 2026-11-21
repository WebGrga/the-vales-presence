"""scan.py's part for the sound: levels, the room tone, stretches, quiet asides, decoding."""
import subprocess

import numpy as np

import scan_words as words_mod

SR = 16000
FRAME = 320                    # 20 ms
STEP = FRAME / SR
SILENCE_MIN = 0.4              # s under silence_db
SILENCE_MARGIN = 6.0           # dB over the room tone
DEAD_AIR_MIN = 2.0
ASIDE_DB = 10.0                # dB under the phrases around
ASIDE_NEIGHBOURS = 3           # phrases each side
ASIDE_REACH = 60.0             # s: neighbours further away than this do not count
ASIDE_MIN_WORDS = 3
LIVE_BLIP = 0.4                # a sound shorter than this does not break dead air
DIGITAL_DB = -85.0             # frames under this are digital silence (a gated mic), not room tone
SILENCE_BELOW_SPEECH = 30.0    # dB: a level this far under the speech is quiet whatever the room tone (a gated mic has a floor of digital zero)


def frame_db(samples, frame=FRAME):
    """Level of each frame in dB (RMS against 16-bit full scale, floor -100). `samples` int16 or float in -32768..32767."""
    n = len(samples) // frame
    out = np.empty(n, dtype=np.float32)
    block = 50000
    for i in range(0, n, block):
        j = min(n, i + block)
        x = samples[i * frame:j * frame].astype(np.float32).reshape(j - i, frame)
        ms = (x * x).mean(axis=1) / (32768.0 ** 2)
        out[i:j] = 10.0 * np.log10(ms + 1e-10)
    return out


def runs(mask, step=STEP, min_len=0.0, merge_gap=0.0):
    """[s, e] seconds of the True stretches of a boolean frame mask; stretches closer than merge_gap join, shorter than min_len go."""
    m = np.asarray(mask, dtype=np.int8)
    if not len(m):
        return []
    d = np.diff(np.concatenate(([0], m, [0])))
    starts, ends = np.flatnonzero(d == 1), np.flatnonzero(d == -1)
    out = []
    for a, b in zip(starts, ends):
        a, b = a * step, b * step
        if out and a - out[-1][1] <= merge_gap + 1e-9:
            out[-1][1] = b
        else:
            out.append([a, b])
    return [[round(float(a), 3), round(float(b), 3)] for a, b in out if b - a >= min_len - 1e-9]


def word_mask(words, n, step=STEP, pad=0.0):
    """Boolean frame mask: frames inside a word (grown by pad seconds each side)."""
    m = np.zeros(n, dtype=bool)
    for s, e, _ in words:
        a = max(0, int((s - pad) / step))
        b = min(n, int(np.ceil((e + pad) / step)))
        if b > a:
            m[a:b] = True
    return m


def room_floor(db, talk_mask):
    """The room tone: the 10th percentile of the level where nobody talks, leaving out frames under DIGITAL_DB (digital silence and the
    fade of a noise gate are no room). All frames' 5th percentile when almost every frame is talk."""
    quiet = db[~talk_mask]
    room = quiet[quiet > DIGITAL_DB]
    if len(room) >= 100:
        return float(np.percentile(room, 10))
    if len(quiet) >= 100:
        return float(np.percentile(quiet, 10))
    return float(np.percentile(db, 5)) if len(db) else -90.0


def drop_blips(live, step=STEP, blip=LIVE_BLIP):
    """Live frames in runs shorter than `blip` seconds become not live (a click, a key press)."""
    out = np.array(live, dtype=bool)
    for a, b in runs(live, step):
        if b - a < blip:
            out[int(round(a / step)):int(round(b / step))] = False
    return out

def smooth_db(db, n=5):
    """The level over n frames (100 ms) in power, in dB: the dips between syllables and a late or early word edge do not show."""
    if len(db) < n:
        return np.asarray(db, dtype=np.float32)
    p = np.power(10.0, np.asarray(db, dtype=np.float64) / 10.0)
    k = np.convolve(p, np.ones(n) / n, mode='same')
    return (10.0 * np.log10(k + 1e-10)).astype(np.float32)


def phrase_levels(db, words, phs, step=STEP):
    """Level of each phrase: the 90th percentile of the 100 ms level over its words (a pause inside it or a word time that is a little
    off does not pull it down). Pass the frames' dB; None for a phrase with no frames."""
    sm = smooth_db(db)
    out = []
    for p in phs:
        a, b = int(words[p['i0']][0] / step), int(np.ceil(max(words[k][1] for k in range(p['i0'], p['i1'] + 1)) / step))
        x = sm[max(0, a):max(a + 1, b)]
        out.append(float(np.percentile(x, 90)) if len(x) else None)
    return out


def speech_level(db, words, step=STEP):
    """The speech level: the middle of the words' own levels (each the 90th percentile of the 100 ms level inside the word); None without words."""
    sm = smooth_db(db)
    xs = []
    for s, e, _ in words:
        a = int(s / step)
        x = sm[max(0, a):max(a + 1, int(np.ceil(e / step)))]
        if len(x):
            xs.append(float(np.percentile(x, 90)))
    return float(np.median(xs)) if xs else None


def find_asides(words, phs, levels, floor):
    """Phrases much quieter than the phrases around them. {s, e, db (negative: under the neighbours), words, over_floor}."""
    out = []
    for i, p in enumerate(phs):
        if levels[i] is None:
            continue
        n_words = len(words_mod.phrase_tokens(words, p))
        if n_words < ASIDE_MIN_WORDS or p['e'] - p['s'] < 0.8:
            continue
        near = []
        for j in list(range(max(0, i - ASIDE_NEIGHBOURS), i)) + list(range(i + 1, min(len(phs), i + 1 + ASIDE_NEIGHBOURS))):
            if levels[j] is None:
                continue
            far = p['s'] - phs[j]['e'] if j < i else phs[j]['s'] - p['e']
            if far <= ASIDE_REACH:
                near.append(levels[j])
        if len(near) < 3:
            continue
        ref = float(np.median(near))
        if levels[i] <= ref - ASIDE_DB:
            out.append({'s': round(p['s'], 3), 'e': round(p['e'], 3), 'db': round(levels[i] - ref, 1),
                        'words': ' '.join(words[k][2] for k in range(p['i0'], p['i1'] + 1)),
                        'over_floor': round(levels[i] - floor, 1)})
    return out

def decode_audio(path):
    """The first audio track as 16 kHz mono int16."""
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-map', '0:a:0', '-vn', '-sn', '-ac', '1', '-ar', str(SR), '-f', 's16le', '-'],
                       capture_output=True)
    if r.returncode or not r.stdout:
        raise RuntimeError(f'ffmpeg could not decode the audio of {path}: {r.stderr.decode("utf-8", "replace")[-300:]}')
    return np.frombuffer(r.stdout, dtype=np.int16)
