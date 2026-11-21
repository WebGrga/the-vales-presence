"""The H.264 encoder of this machine, found once, and the settings each kind of encode uses with it.

    python encoders.py [--json]     prints the encoder found and the settings of every profile (--json: one JSON object, for a setup check)

The probe tries, in order: h264_nvenc (NVIDIA), h264_qsv (Intel Quick Sync), h264_amf (AMD), h264_videotoolbox (Apple), then libx264 (any CPU).
An encoder counts when ffmpeg really encodes three small frames with it (an ffmpeg build lists encoders the machine has no hardware for).
$PRESENCE_ENCODER skips the probe: a name from ORDER, or `cpu` for libx264.

Profiles (the same picture quality aimed at on every encoder; the NVENC settings are the ones the engine was measured with):
  final   the finished video (compose.py, compose_chunks.py): high quality, B-frames
  rough   the pieces of the rough (build_rough.py): near-lossless, no B-frames, a 2 s GOP at 60 fps, every piece starts on a keyframe
  proof   the 540p proof clips (compose.py --proof)
  clip    the small Before/After clips of the cut review (cuts_clips.py)
The NVENC lists are byte for byte the ones the cache keys of rough pieces and final chunks were made with, so caches made before stay valid there.
A cache key holds the encoder's argument list, so a piece made with one encoder is never taken for one made with another.
"""
import functools
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pipelib import env

ORDER = ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_videotoolbox', 'libx264']

PROFILES = {
    'final': {
        'h264_nvenc': ['-c:v', 'h264_nvenc', '-preset', 'p6', '-tune', 'hq', '-rc', 'vbr', '-cq', '19', '-b:v', '0', '-spatial-aq', '1', '-temporal-aq', '1',
                       '-rc-lookahead', '32', '-bf', '3', '-profile:v', 'high', '-pix_fmt', 'yuv420p'],
        'h264_qsv': ['-c:v', 'h264_qsv', '-preset', 'slow', '-global_quality', '19', '-bf', '3', '-profile:v', 'high', '-pix_fmt', 'nv12'],
        'h264_amf': ['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '19', '-qp_p', '19', '-qp_b', '21', '-profile:v', 'high', '-pix_fmt', 'yuv420p'],
        'h264_videotoolbox': ['-c:v', 'h264_videotoolbox', '-b:v', '16M', '-maxrate', '24M', '-bufsize', '32M', '-profile:v', 'high', '-pix_fmt', 'yuv420p'],
        'libx264': ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-bf', '3', '-profile:v', 'high', '-pix_fmt', 'yuv420p'],
    },
    'rough': {
        'h264_nvenc': ['-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'hq', '-rc', 'vbr', '-cq', '22', '-b:v', '0', '-bf', '0', '-g', '120', '-forced-idr', '1'],
        'h264_qsv': ['-c:v', 'h264_qsv', '-preset', 'medium', '-global_quality', '20', '-bf', '0', '-g', '120', '-pix_fmt', 'nv12'],
        'h264_amf': ['-c:v', 'h264_amf', '-quality', 'balanced', '-rc', 'cqp', '-qp_i', '18', '-qp_p', '18', '-bf', '0', '-g', '120'],
        'h264_videotoolbox': ['-c:v', 'h264_videotoolbox', '-b:v', '30M', '-bf', '0', '-g', '120'],
        'libx264': ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-bf', '0', '-g', '120'],
    },
    'proof': {
        'h264_nvenc': ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '24', '-b:v', '0', '-pix_fmt', 'yuv420p'],
        'h264_qsv': ['-c:v', 'h264_qsv', '-preset', 'faster', '-global_quality', '25', '-pix_fmt', 'nv12'],
        'h264_amf': ['-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'cqp', '-qp_i', '24', '-qp_p', '24', '-pix_fmt', 'yuv420p'],
        'h264_videotoolbox': ['-c:v', 'h264_videotoolbox', '-b:v', '3M', '-pix_fmt', 'yuv420p'],
        'libx264': ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p'],
    },
    'clip': {
        'h264_nvenc': ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '31', '-b:v', '0', '-pix_fmt', 'yuv420p'],
        'h264_qsv': ['-c:v', 'h264_qsv', '-preset', 'medium', '-global_quality', '31', '-pix_fmt', 'nv12'],
        'h264_amf': ['-c:v', 'h264_amf', '-quality', 'balanced', '-rc', 'cqp', '-qp_i', '30', '-qp_p', '30', '-pix_fmt', 'yuv420p'],
        'h264_videotoolbox': ['-c:v', 'h264_videotoolbox', '-b:v', '1200k', '-pix_fmt', 'yuv420p'],
        'libx264': ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p'],
    },
}

# how each encoder's output is decoded fastest on the same machine (None = the CPU)
HWACCEL = {'h264_nvenc': 'cuda', 'h264_qsv': 'qsv', 'h264_amf': 'd3d11va' if sys.platform == 'win32' else None, 'h264_videotoolbox': 'videotoolbox', 'libx264': None}


def works(name):
    """True when ffmpeg encodes three frames with this encoder here."""
    try:
        r = subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=256x144:r=30', '-frames:v', '3', '-c:v', name,
                            *(['-pix_fmt', 'nv12'] if name == 'h264_qsv' else []), '-f', 'null', '-'], capture_output=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return r.returncode == 0


@functools.lru_cache(maxsize=None)
def best(cpu=False):
    """The encoder to use: libx264 when `cpu`, the one $PRESENCE_ENCODER names, else the first of ORDER that works."""
    if cpu:
        return 'libx264'
    forced = (env('ENCODER') or '').strip()
    if forced:
        if forced.lower() == 'cpu':
            return 'libx264'
        if forced not in ORDER:
            raise SystemExit(f'PRESENCE_ENCODER={forced} is not one of: {", ".join(ORDER)}, cpu')
        return forced
    for name in ORDER[:-1]:
        if works(name):
            return name
    return 'libx264'


def args(profile, name=None, cpu=False):
    """The ffmpeg output arguments of a profile ('final', 'rough', 'proof', 'clip') for an encoder (default: best())."""
    return list(PROFILES[profile][name or best(cpu)])


def closed_gop(name=None):
    """Arguments that make every keyframe an IDR in a closed group of pictures (chunks joined with -c copy need it)."""
    return (['-forced-idr', '1'] if (name or best()) == 'h264_nvenc' else []) + ['-flags', '+cgop']


def hwaccel(name=None):
    """['-hwaccel', x] for decoding on the encoder's hardware, or [] (the CPU)."""
    h = HWACCEL.get(name or best())
    return ['-hwaccel', h] if h else []


def main():
    name = best()
    if '--json' in sys.argv[1:]:
        import json
        print(json.dumps({'encoder': name, 'forced': bool(env('ENCODER')), 'hwaccel': HWACCEL.get(name), 'works': {n: works(n) for n in ORDER},
                          'profiles': {p: args(p, name) for p in PROFILES}}))
        return 0
    print(f'encoder: {name}' + (' (from PRESENCE_ENCODER)' if env('ENCODER') else ''))
    for p in PROFILES:
        print(f'  {p:6} {" ".join(args(p, name))}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
