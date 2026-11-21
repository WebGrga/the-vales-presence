"""Level the voice of a joined rough ONCE and make rough.mp4: the end of a Short's (or any) rough cut stage.

    python level.py cat.mp4 ../rough.mp4 [--lufs -14] [--tp -1.5] [--limit 0.70] [--audio cat.wav]

Two-pass loudnorm (linear) to -14 LUFS with a limiter, written to a WAV first and only then encoded to AAC and muxed with the picture copied: a limiter chained
straight into the AAC encoder measured 3 dB hotter than the same chain through a wav (house rules, "Limiter before AAC"). If the result is more than 0.6 LU
from the target (a limiter eating the gain), the gain is nudged once and it is measured again. Prints integrated loudness and true peak of the file it made.
This is the ONE loudness pass of a cut: nothing after it re-levels the voice (the pipeline only adds sound effects as their own layer).
"""
import argparse
import json
import os
import re
import subprocess
import sys


# Every frame tagged BT.709 limited range, without re-encoding: segments joined from different sources (a png still, a screen grab) otherwise carry different
# colour tags, and ffmpeg then re-configures its filter graph in the middle of the stream and a trim + concat (the zoom pass) loses frames.
TAG = 'h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0'


def sh(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode:
        raise SystemExit(f'{cmd[0]} failed:\n{r.stderr[-1500:]}')
    return r.stderr


def measure(path):
    """(integrated LUFS, true peak dBTP) of a file's audio."""
    err = sh(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'])
    tail = err[err.rindex('Summary:'):]
    i = float(re.search(r'I:\s+(-?[\d.]+) LUFS', tail).group(1))
    p = float(re.search(r'Peak:\s+(-?[\d.]+) dBFS', tail).group(1))
    return i, p


def video_seconds(path):
    """Length of the picture: the stream's duration (or frames / fps), the container's when the format (.mkv) has no stream duration."""
    r = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration,nb_frames,r_frame_rate:format=duration', '-of', 'json', path],
                       capture_output=True, text=True)
    j = json.loads(r.stdout)
    st = (j.get('streams') or [{}])[0]
    try:
        return float(st['duration'])
    except (KeyError, ValueError):
        pass
    if str(st.get('nb_frames', '')).isdigit() and '/' in st.get('r_frame_rate', ''):
        n, m = st['r_frame_rate'].split('/')
        return int(st['nb_frames']) * float(m) / float(n)
    return float(j['format']['duration'])


def level(src, out, lufs=-14.0, tp=-1.5, limit=0.70, audio=None):
    audio = audio or src
    vdur = video_seconds(src)      # the audio is cut to the picture's length: the loudness filter and the AAC encoder both add a tail
    err = sh(['ffmpeg', '-hide_banner', '-nostats', '-i', audio, '-af', f'loudnorm=I={lufs}:TP={tp}:LRA=11:print_format=json', '-f', 'null', '-'])
    j = json.loads(err[err.rindex('{'):err.rindex('}') + 1])
    wav = os.path.splitext(out)[0] + '.levelled.wav'
    gain = 0.0
    for attempt in range(2):
        ln = (f"loudnorm=I={lufs}:TP={tp}:LRA=11:measured_I={j['input_i']}:measured_TP={j['input_tp']}:measured_LRA={j['input_lra']}:"
              f"measured_thresh={j['input_thresh']}:offset={j['target_offset']}:linear=true,aresample=48000" + (f',volume={gain:.2f}dB' if gain else '') + f',alimiter=limit={limit}:level=false')
        sh(['ffmpeg', '-v', 'error', '-y', '-i', audio, '-vn', '-af', ln, '-c:a', 'pcm_s16le', wav])
        sh(['ffmpeg', '-v', 'error', '-y', '-i', src, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-bsf:v', TAG, '-c:a', 'aac', '-b:a', '192k', '-t', f'{vdur:.3f}',
            '-movflags', '+faststart', out])
        i, p = measure(out)
        if abs(i - lufs) <= 0.6 or attempt:
            break
        gain += lufs - i
    os.remove(wav)
    print(f'{out}: {i:.1f} LUFS, true peak {p:.1f} dBTP')
    return i, p


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('src'); ap.add_argument('out')
    ap.add_argument('--lufs', type=float, default=-14.0); ap.add_argument('--tp', type=float, default=-1.5); ap.add_argument('--limit', type=float, default=0.70)
    ap.add_argument('--audio', help='measure and level this file instead (the picture still comes from src)')
    a = ap.parse_args()
    level(a.src, a.out, a.lufs, a.tp, a.limit, a.audio)
