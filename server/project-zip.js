// A whole project as one zip, to move it to another machine. No dependency: it uses the system's own tool,
// tar (bsdtar reads and writes zip on Windows 10+ and macOS) and, on Linux, zip and unzip.
// The pure parts: the command lines (zipCommand, unzipCommand, listCommand), the names a zip may hold (unsafeEntries)
// and what an export leaves out (EXCLUDES).
import path from 'node:path';
import { spawn } from 'node:child_process';
import { FREEABLE_DIRS } from './project-space.js';

// an export carries the project, not what the app makes again: the previews, the waveforms, the poster
export const EXCLUDES = [...FREEABLE_DIRS, '.presence'];

const tarBin = (platform, env = process.env) => (platform === 'win32' ? path.join(env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar');

// pure: { cmd, args, cwd? } to make `out` from the `names` (top-level entries) inside `dir`
export function zipCommand({ platform = process.platform, dir, out, names, excludes = EXCLUDES, env }) {
  if (platform === 'linux') {
    const x = excludes.flatMap((e) => ['-x', `${e}/*`, '-x', e]);
    return { cmd: 'zip', args: ['-r', '-q', out, ...names, ...x], cwd: dir };
  }
  return { cmd: tarBin(platform, env), args: ['-a', '-c', '-f', out, ...excludes.map((e) => `--exclude=${e}`), '-C', dir, ...names] };
}
// pure: the command that unpacks `zip` into `dest`
export function unzipCommand({ platform = process.platform, zip, dest, env }) {
  return platform === 'linux' ? { cmd: 'unzip', args: ['-q', '-o', zip, '-d', dest] } : { cmd: tarBin(platform, env), args: ['-x', '-f', zip, '-C', dest] };
}
// pure: the command that lists the names in `zip`
export function listCommand({ platform = process.platform, zip, env }) {
  return platform === 'linux' ? { cmd: 'unzip', args: ['-Z1', zip] } : { cmd: tarBin(platform, env), args: ['-t', '-f', zip] };
}

// pure: names a project zip must not hold (absolute, a drive, "..", a backslash trick). -> [names]
export function unsafeEntries(names) {
  return names.filter((raw) => {
    const n = String(raw).replace(/\\/g, '/');
    return !n || n.startsWith('/') || /^[a-z]:/i.test(n) || n.includes('\0') || n.split('/').some((p) => p === '..');
  });
}
// pure: the lines tar/unzip print into entry names
export const entryNames = (text) => String(text).split(/\r?\n/).map((l) => l.trim().replace(/^\.\//, '')).filter(Boolean);

export function run({ cmd, args, cwd }, timeoutMs = 30 * 60 * 1000) {
  return new Promise((done, fail) => {
    let out = '', err = '', p;
    try { p = spawn(cmd, args, { cwd, windowsHide: true }); } catch (e) { return fail(new Error(`could not start ${cmd}: ${e.message}`)); }
    const t = setTimeout(() => { try { p.kill(); } catch {} fail(new Error(`${cmd} took too long`)); }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; if (out.length > 8e6) out = out.slice(-4e6); });
    p.stderr.on('data', (d) => { err += d; if (err.length > 2e5) err = err.slice(-1e5); });
    p.on('error', (e) => { clearTimeout(t); fail(new Error(e.code === 'ENOENT' ? `${cmd} is not installed: it is needed to make and read zip files` : e.message)); });
    p.on('close', (code) => { clearTimeout(t); if (code === 0) done(out); else fail(new Error(`${cmd} failed: ${err.trim().split('\n').slice(-2).join(' ') || 'code ' + code}`)); });
  });
}
