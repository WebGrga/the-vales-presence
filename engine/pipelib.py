"""Shared helpers of the engine (see README.md): the config, paths of a workshop, the step log (video/out/steps.jsonl), hashes, ffprobe, running tools.

Every script adds its own folder to sys.path, so they run with or without `python -I`, from any folder.

The config (all of it here; nothing else in the engine names a folder outside the workshop):
  HOME        this engine folder (from __file__); `PIPE` is the old name of the same thing
  KIT         <repo>/kit: kit/sounds (named sound effects) and kit/fonts (caption fonts) bundled with the app
  sounds      sound_dirs(cut): the workshop's video/assets and video/public first (its own sound wins), then $PRESENCE_SOUNDS, then kit/sounds
  fonts       font_dirs(): $PRESENCE_FONTS, kit/fonts, then the system's font folders (Windows, macOS, Linux)
  workshop    --video <path to video/>, $PRESENCE_VIDEO, or the nearest folder up from the current one
  locks       $PRESENCE_LOCKS, else <workshop>/.presence/locks.json
Every setting is read through env(): $PRESENCE_<name>, else the key <name> (lower case) of the optional file presence.local.json in the repository
root (not committed; $PRESENCE_CONFIG names another file). That file is for a machine that runs the engine from agents that cannot pass environment variables, e.g.
{"sounds": "D:/props/audio", "locks": ".other/locks.json"}; a relative `locks` is taken from the workshop.
"""
import contextlib
import datetime
import hashlib
import json
import os
import subprocess
import sys
import time

HOME = os.path.dirname(os.path.realpath(__file__))          # real path: the engine may be reached through a link (a junction from another app's folder)
PIPE = HOME
REPO = os.path.dirname(HOME)
KIT = os.path.join(REPO, 'kit')


def _local_config():
    try:
        with open(os.environ.get('PRESENCE_CONFIG') or os.path.join(REPO, 'presence.local.json'), encoding='utf-8') as f:
            j = json.load(f)
        return j if isinstance(j, dict) else {}
    except (OSError, ValueError):
        return {}


def env(name, default=None):
    """$PRESENCE_<name>, else the key <name> (lower case) of presence.local.json, else `default`."""
    v = os.environ.get('PRESENCE_' + name)
    if v:
        return v
    v = _local_config().get(name.lower())
    return v if isinstance(v, str) and v else default


def _env_dirs(name):
    return [os.path.expanduser(d) for d in (env(name) or '').split(os.pathsep) if d]


def system_font_dirs():
    """The operating system's font folders that exist (user folders included)."""
    home = os.path.expanduser('~')
    if sys.platform == 'win32':
        cands = [os.path.join(os.environ.get('WINDIR', 'C:' + os.sep + 'Windows'), 'Fonts')]
        if os.environ.get('LOCALAPPDATA'):
            cands.append(os.path.join(os.environ['LOCALAPPDATA'], 'Microsoft', 'Windows', 'Fonts'))
    elif sys.platform == 'darwin':
        cands = ['/System/Library/Fonts', '/System/Library/Fonts/Supplemental', '/Library/Fonts', os.path.join(home, 'Library', 'Fonts')]
    else:
        cands = [os.path.join(home, '.local', 'share', 'fonts'), os.path.join(home, '.fonts'), '/usr/local/share/fonts', '/usr/share/fonts']
    return [d for d in cands if os.path.isdir(d)]


def font_dirs():
    """Where fonts are looked for, in order: $PRESENCE_FONTS (folders, os.pathsep-separated), kit/fonts, the system's font folders."""
    return [*_env_dirs('FONTS'), os.path.join(KIT, 'fonts'), *system_font_dirs()]


def find_font(name):
    """The path of a font file by its file name (case-insensitive, nested folders searched: Linux keeps fonts in subfolders), or None."""
    low = name.lower()
    for d in font_dirs():
        p = os.path.join(d, name)
        if os.path.isfile(p):
            return p
    for d in font_dirs():
        for root, dirs, files in os.walk(d):
            dirs.sort()
            for f in files:
                if f.lower() == low:
                    return os.path.join(root, f)
    return None


LABEL_FONTS = ['arialbd.ttf', 'Arial Bold.ttf', 'DejaVuSans-Bold.ttf', 'LiberationSans-Bold.ttf', 'Helvetica.ttc']


def ff_escape(p):
    """A path inside an ffmpeg filter argument: forward slashes, the colon escaped."""
    return p.replace(chr(92), '/').replace(':', chr(92) + ':')


def label_font():
    """`fontfile='...':` for ffmpeg's drawtext (the time labels of proofs and contact sheets): a bold sans the system has; '' lets drawtext pick one."""
    for n in LABEL_FONTS:
        p = find_font(n)
        if p:
            return f"fontfile='{ff_escape(p)}':"
    return ''


def sound_dirs(cut=None):
    """Where a named sound is looked for: the workshop's video/assets and video/public, then $PRESENCE_SOUNDS, then kit/sounds."""
    own = [os.path.join(cut.video, 'assets'), os.path.join(cut.video, 'public')] if cut else []
    return [*own, *_env_dirs('SOUNDS'), os.path.join(KIT, 'sounds')]


def find_video(arg=None):
    """The workshop's video folder: --video, $PRESENCE_VIDEO, or the nearest folder up from cwd that has out/ and footage/ or remotion/."""
    for c in (arg, env('VIDEO')):
        if c:
            return os.path.abspath(c)
    d = os.getcwd()
    while True:
        if os.path.isdir(os.path.join(d, 'out')) and (os.path.isdir(os.path.join(d, 'remotion')) or os.path.isdir(os.path.join(d, 'footage'))):
            return d
        if os.path.isdir(os.path.join(d, 'video', 'out')):
            return os.path.join(d, 'video')
        p = os.path.dirname(d)
        if p == d:
            raise SystemExit('Cannot find the workshop: run inside its video/ folder or pass --video <path to video/>.')
        d = p


def lock_paths(workshop):
    """(the lock file written and read first, [every lock file to read that exists]). $PRESENCE_LOCKS names it (relative: from the workshop); else <workshop>/.presence/locks.json."""
    main = os.path.normpath(os.path.join(workshop, env('LOCKS') or os.path.join('.presence', 'locks.json')))
    found = [main] if os.path.isfile(main) else []
    return main, found


class Cut:
    """All the paths of one cut. `video` is <workshop>/video."""

    def __init__(self, video=None):
        self.video = find_video(video)
        self.workshop = os.path.dirname(self.video)
        self.out = os.path.join(self.video, 'out')
        self.work = os.path.join(self.out, 'work')
        self.rough = os.path.join(self.out, 'rough.mp4')
        self.edl = os.path.join(self.out, 'edl.json')
        self.rough_json = os.path.join(self.out, 'rough.json')
        self.rough_words = os.path.join(self.out, 'rough-words.json')
        self.rough_scenes = os.path.join(self.out, 'rough-scenes.json')
        self.events = os.path.join(self.out, 'events.json')
        self.timeline = os.path.join(self.out, 'timeline.json')
        self.steps = os.path.join(self.out, 'steps.jsonl')
        self.final = os.path.join(self.out, 'final.mp4')
        self.proof = os.path.join(self.out, 'proof.mp4')
        self.sheet = os.path.join(self.out, 'frames.jpg')
        self.remotion = os.path.join(self.video, 'remotion')
        self.locks, self.lock_files = lock_paths(self.workshop)
        self.log_file = os.path.join(self.work, 'pipeline.log')
        os.makedirs(self.work, exist_ok=True)

    def p(self, rel):
        """A path relative to video/ (the way edl.json names sources)."""
        return os.path.join(self.video, *rel.replace('\\', '/').split('/'))


def now_iso():
    return datetime.datetime.now().astimezone().isoformat(timespec='seconds')


def read_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def write_json(path, data, indent=1):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=indent, ensure_ascii=False)
        f.write('\n')
    os.replace(tmp, path)


def canon(obj):
    return json.dumps(obj, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def sha256_file(path, chunk=1 << 22):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        while True:
            b = f.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def sha_short(obj, n=16):
    return hashlib.sha256(canon(obj).encode('utf-8')).hexdigest()[:n]


def say(cut, msg):
    """One progress line to stdout and to video/out/work/pipeline.log (flushed: it is read while a background run goes)."""
    line = f"{datetime.datetime.now().strftime('%H:%M:%S')} {msg}"
    print(line, flush=True)
    try:
        with open(cut.log_file, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except OSError:
        pass


@contextlib.contextmanager
def step(cut, name, **detail):
    """Times a step and appends {step, start, ms, detail} to video/out/steps.jsonl. The detail dict may be filled in inside the block."""
    start = now_iso()
    t0 = time.time()
    say(cut, f'[{name}] start')
    d = dict(detail)
    try:
        yield d
    except BaseException as e:
        d['error'] = f'{type(e).__name__}: {e}'[:300]
        raise
    finally:
        ms = int((time.time() - t0) * 1000)
        with open(cut.steps, 'a', encoding='utf-8') as f:
            f.write(json.dumps({'step': name, 'start': start, 'ms': ms, 'detail': d}, ensure_ascii=False) + '\n')
        say(cut, f'[{name}] {"FAILED" if "error" in d else "done"} in {ms / 1000:.1f} s')


def run(cmd, cwd=None, check=True, quiet=True, log=None):
    """Run a command, returning (returncode, stdout, stderr). Raises with the tail of stderr when `check` and it failed."""
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if log:
        with open(log, 'a', encoding='utf-8') as f:
            f.write(f"$ {' '.join(map(str, cmd))}\n{r.stderr[-4000:]}\n")
    if check and r.returncode:
        raise RuntimeError(f"{os.path.basename(str(cmd[0]))} failed (exit {r.returncode}): {' '.join(map(str, cmd))[:300]}\n{r.stderr[-1500:]}")
    return r.returncode, r.stdout, r.stderr


def probe(path):
    """{duration, fps, width, height, nb_frames, vcodec, acodec, color_space} of a media file."""
    _, out, _ = run(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', path])
    j = json.loads(out)
    v = next((s for s in j['streams'] if s['codec_type'] == 'video'), None)
    a = next((s for s in j['streams'] if s['codec_type'] == 'audio'), None)
    info = {'duration': float(j['format']['duration'])}
    if v:
        n, d = (v.get('r_frame_rate') or '0/1').split('/')
        info.update(fps=float(n) / float(d or 1), width=int(v['width']), height=int(v['height']), vcodec=v['codec_name'],
                    nb_frames=int(v['nb_frames']) if v.get('nb_frames', '').isdigit() else None,
                    color_space=v.get('color_space'), pix_fmt=v.get('pix_fmt'))
    if a:
        info.update(acodec=a['codec_name'], sample_rate=int(a['sample_rate']), channels=a['channels'])
    return info


def fail(cut, msg, code=1):
    """Plain-words failure: print and exit non-zero."""
    say(cut, 'FAILED: ' + msg)
    sys.exit(code)


def uv_script(script, *args, cwd=None):
    """Run a PEP 723 script with uv (faster-whisper lives there, not in the plain Python)."""
    return run(['uv', 'run', script, *map(str, args)], cwd=cwd, check=True)


def asset(cut, name):
    """A sound by name ('.wav' added when there is no extension): see sound_dirs() for where it is looked for."""
    n = name if os.path.splitext(name)[1] else name + '.wav'
    dirs = sound_dirs(cut)
    for d in dirs:
        f = os.path.join(d, n)
        if os.path.isfile(f):
            return f
    raise FileNotFoundError(f'sound "{name}" not found in ' + ', '.join(dirs))
