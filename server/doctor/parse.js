// The doctor's decisions, pure: what a tool's output says, and whether that is enough.
// Each judge returns { status: 'ok'|'warn'|'fail', found, why? }. Tested in parse.test.js.

// 'win' | 'mac' | 'linux' from process.platform
export function osOf(platform) {
  if (platform === 'win32') return 'win';
  if (platform === 'darwin') return 'mac';
  return 'linux';
}

// "22.11.0" -> [22, 11, 0]; anything unreadable -> null
export function semver(s) {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(s || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] || 0)] : null;
}

export function atLeast(v, min) {
  if (!v) return false;
  for (let i = 0; i < 3; i++) {
    if ((v[i] || 0) > (min[i] || 0)) return true;
    if ((v[i] || 0) < (min[i] || 0)) return false;
  }
  return true;
}

export function judgeNode(version, min = 22) {
  const v = semver(version);
  if (!v) return { status: 'fail', found: 'unknown', why: 'could not read the Node version' };
  return atLeast(v, [min, 0, 0])
    ? { status: 'ok', found: `Node ${v.join('.')}` }
    : { status: 'fail', found: `Node ${v.join('.')}`, why: `Node ${min} or newer is needed` };
}

// first line of `ffmpeg -version` / `ffprobe -version`: "ffmpeg version 7.1-full_build-www.gyan.dev Copyright ..." or "ffmpeg version n6.1.1 ..."
export function ffVersion(out) {
  const m = /^(ffmpeg|ffprobe) version (\S+)/m.exec(String(out || ''));
  return m ? m[2] : null;
}

export function judgeFf(ffmpegOut, ffprobeOut) {
  const a = ffVersion(ffmpegOut), b = ffVersion(ffprobeOut);
  if (a && b) return { status: 'ok', found: `ffmpeg ${a}, ffprobe ${b}` };
  const missing = [!a && 'ffmpeg', !b && 'ffprobe'].filter(Boolean).join(' and ');
  return { status: 'fail', found: a ? `ffmpeg ${a}` : b ? `ffprobe ${b}` : 'not found', why: `${missing} not found on PATH` };
}

// `uv --version` -> "uv 0.5.11 (c4d0caaee 2024-12-19)"
export function judgeUv(out) {
  const m = /^uv (\S+)/m.exec(String(out || ''));
  return m ? { status: 'ok', found: `uv ${m[1]}` } : { status: 'fail', found: 'not found', why: 'uv runs the speech-to-text scripts (faster-whisper)' };
}

// the line our probe prints: "PY 3.12.4 NUMPY 2.1.0 PIL 11.0.0" (a missing module prints "-")
export const PY_PROBE = "import sys\ntry:\n import numpy; n=numpy.__version__\nexcept Exception: n='-'\ntry:\n import PIL; p=PIL.__version__\nexcept Exception: p='-'\nprint('PY', sys.version.split()[0], 'NUMPY', n, 'PIL', p)";

export function parsePython(out) {
  const m = /PY (\S+) NUMPY (\S+) PIL (\S+)/.exec(String(out || ''));
  if (!m) return null;
  const v = (x) => (x === '-' ? null : x);
  return { python: m[1], numpy: v(m[2]), pil: v(m[3]) };
}

export function judgePython(found, cmd) {
  if (!found) return { status: 'fail', found: 'not found', why: 'Python 3.10 or newer with numpy and Pillow runs the engine' };
  const v = semver(found.python);
  const label = `${cmd || 'python'} ${found.python}`;
  if (!atLeast(v, [3, 10, 0])) return { status: 'fail', found: label, why: 'Python 3.10 or newer is needed' };
  const missing = [!found.numpy && 'numpy', !found.pil && 'Pillow'].filter(Boolean);
  if (missing.length) return { status: 'fail', found: label, why: `${missing.join(' and ')} not installed for this Python` };
  return { status: 'ok', found: `${label}, numpy ${found.numpy}, Pillow ${found.pil}` };
}

// `nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader` -> [{ name, memory, driver }]
export function parseNvidiaSmi(out) {
  return String(out || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [name, memory, driver] = l.split(',').map((x) => x.trim());
    return { name, memory, driver };
  }).filter((g) => g.name && !/^(NVIDIA-SMI has failed|No devices)/i.test(g.name));
}

// a GPU's name from the OS when nvidia-smi has none: PowerShell's Win32_VideoController names, system_profiler, lspci
export function otherGpuName(os, out) {
  const lines = String(out || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (os === 'win') return lines.filter((l) => !/basic display|remote display|virtual/i.test(l)).join(', ');
  if (os === 'mac') return lines.map((l) => /Chipset Model:\s*(.+)/.exec(l)?.[1]).filter(Boolean).join(', ');
  return lines.filter((l) => /VGA|3D controller|Display controller/i.test(l)).map((l) => l.replace(/^.*?(VGA compatible controller|3D controller|Display controller):\s*/i, '')).join(', ');
}

// `claude --version` -> "2.0.14" from "2.0.14 (Claude Code)"
export function claudeVersion(out) {
  const m = /(\d+\.\d+\.\d+)/.exec(String(out || ''));
  return m ? m[1] : null;
}

// hardware encoders in the order the engine prefers them, then the CPU
export const ENCODERS = ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_videotoolbox'];
export const ENCODER_NAME = { h264_nvenc: 'NVIDIA NVENC', h264_qsv: 'Intel Quick Sync', h264_amf: 'AMD AMF', h264_videotoolbox: 'Apple VideoToolbox', libx264: 'CPU (libx264)' };

// `ffmpeg -hide_banner -encoders` -> the names it lists (" V....D h264_nvenc   NVIDIA NVENC H.264 encoder")
export function listedEncoders(out) {
  const names = new Set();
  for (const l of String(out || '').split(/\r?\n/)) {
    const m = /^\s*[VAS][.A-Z]{5}\s+([\w-]+)(\s|$)/.exec(l);
    if (m) names.add(m[1]);
  }
  return names;
}

// which hardware encoders to try (listed ones, in order)
export function encoderCandidates(listed) {
  return ENCODERS.filter((e) => listed.has(e));
}

// gpus: [{name}] from nvidia-smi (or [] ), other: a GPU name from the OS (or ''), encoder: the first that encoded a test clip (or null), cpu264: libx264 listed
export function judgeGpu({ gpus = [], other = '', encoder = null, cpu264 = true }) {
  const gpu = gpus[0] ? `${gpus[0].name}${gpus[0].memory ? ` (${gpus[0].memory})` : ''}` : other || 'no GPU found';
  if (encoder) {
    const cuda = gpus.length ? ', speech-to-text on CUDA' : ', speech-to-text on the CPU';
    return { status: 'ok', found: `${gpu}; encoder ${ENCODER_NAME[encoder] || encoder}${cuda}`, encoder };
  }
  if (cpu264) return { status: 'warn', found: `${gpu}; encoder ${ENCODER_NAME.libx264}`, encoder: 'libx264', why: 'no hardware encoder worked: renders run on the CPU, several times slower' };
  return { status: 'fail', found: gpu, encoder: null, why: 'ffmpeg has no H.264 encoder (neither a hardware one nor libx264)' };
}

// yt-dlp prints a date version: "2025.01.15". how = the command that answered (null: none did); uvx = `uvx` itself runs.
export const ytDlpVersion = (out) => (/^\s*(\d{4}\.\d{1,2}\.\d{1,2}\S*)/m.exec(String(out || '')) || [])[1] || null;

export function judgeYtDlp({ how = null, version = null, uvx = false }) {
  if (how) return { status: 'ok', found: `yt-dlp${version ? ` ${version}` : ''} (${how})` };
  if (uvx) return { status: 'warn', found: 'not installed; uvx can run it', why: 'the research stage will run it through uvx, which downloads yt-dlp the first time it is used (a short wait). Install it once to skip that', fixId: 'ytdlp' };
  return { status: 'warn', found: 'not found', why: 'only the research stage needs it (it reads video details and thumbnails; nothing is downloaded). Everything else works without it', fixId: 'ytdlp' };
}

// the SDK's accountInfo() -> logged in or not. Never returns the email.
export function judgeAccount(info, cliVersion) {
  const cli = cliVersion ? `; claude ${cliVersion} on PATH` : '';
  if (!info) return { status: 'fail', found: `not logged in${cli}`, why: 'the Claude Agent SDK could not start a session' };
  const none = (x) => !x || x === 'none';
  const third = info.apiProvider && info.apiProvider !== 'firstParty';
  const ok = info.subscriptionType || info.email || !none(info.tokenSource) || !none(info.apiKeySource) || third;
  if (!ok) return { status: 'fail', found: `not logged in${cli}`, why: 'Claude Code is not logged in' };
  const how = info.subscriptionType ? `logged in (${info.subscriptionType})`
    : third ? `logged in through ${info.apiProvider}`
    : !none(info.apiKeySource) ? 'logged in with an API key' : 'logged in';
  return { status: 'ok', found: how + cli };
}

const GB = 1024 ** 3;
export function judgeDisk(freeBytes, { fail = 5, warn = 20 } = {}) {
  if (freeBytes == null || !Number.isFinite(freeBytes)) return { status: 'warn', found: 'unknown', why: 'could not read the free space' };
  const gb = freeBytes / GB;
  const found = `${gb >= 100 ? Math.round(gb) : gb.toFixed(1)} GB free`;
  if (gb < fail) return { status: 'fail', found, why: `renders need at least ${fail} GB free (a long video's cache can take 20 GB or more)` };
  if (gb < warn) return { status: 'warn', found, why: `under ${warn} GB free: a long video's render cache may fill it` };
  return { status: 'ok', found };
}

// engine/remotion: the version package.json asks for and the one installed (null = not installed)
export function judgeRemotion({ wanted, installed, hasPackage }) {
  if (!hasPackage) return { status: 'fail', found: 'engine/remotion/package.json is missing', why: 'the overlay renderer is not set up' };
  if (!installed) return { status: 'fail', found: 'not installed', why: wanted ? `Remotion ${wanted} is not installed in engine/remotion` : 'Remotion is not installed in engine/remotion' };
  const exact = /^=?(\d+\.\d+\.\d+)$/.exec(String(wanted || ''));
  if (exact && exact[1] !== installed) return { status: 'warn', found: `Remotion ${installed}`, why: `package.json asks for ${exact[1]}: run npm install there again` };
  return { status: 'ok', found: `Remotion ${installed}` };
}

// all checks -> the summary the Setup tab and the app's first screen read
export function summarise(checks) {
  const missing = checks.filter((c) => c.required && c.status === 'fail').map((c) => c.id);
  const warnings = checks.filter((c) => c.status === 'warn' || (!c.required && c.status === 'fail')).map((c) => c.id);
  return { ok: missing.length === 0, missing, warnings };
}

// a fix from fixes.json for one OS: { text, cmds } (cmds may be empty); `all` falls back when the OS has none
export function fixFor(fixes, id, os) {
  const f = fixes?.[id];
  if (!f) return null;
  const pick = f[os] || f.all || null;
  if (!pick) return null;
  return { text: pick.text || '', cmds: pick.cmds || [], link: pick.link || f.link || null };
}
