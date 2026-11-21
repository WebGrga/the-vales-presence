// A copy of a recording as .mp4 for programs that do not import .mkv (and other containers): the same streams, no re-encode
// (`-c copy`, every picture and sound track kept), into <project>/export/media/<name>.mp4. FCPXML and OTIO then link the copy.
// The pure parts (needsRemux, remuxedPath, remuxArgs) are tested in export.test.js.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const OK = new Set(['.mp4', '.mov', '.m4v', '.wav', '.m4a', '.aac', '.mp3']);

export const needsRemux = (file) => !OK.has(path.extname(String(file || '')).toLowerCase());

// <project>/export/media/<recording name>.mp4
export const remuxedPath = (dir, file) => path.join(dir, 'export', 'media', path.basename(file, path.extname(file)) + '.mp4');

export function remuxArgs(input, output) {
  return ['-hide_banner', '-v', 'error', '-y', '-i', input, '-map', '0:v?', '-map', '0:a?', '-c', 'copy', '-movflags', '+faststart', output];
}

// a copy that is there and not older than its recording
export function freshCopy(dir, file) {
  const out = remuxedPath(dir, file);
  try { return fs.statSync(out).mtimeMs >= fs.statSync(file).mtimeMs ? out : null; } catch { return null; }
}

function ffmpeg(args) {
  return new Promise((done) => {
    let err = '';
    let p;
    try { p = spawn('ffmpeg', args, { windowsHide: true }); } catch (e) { return done({ code: -1, err: e.message }); }
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => done({ code: -1, err: e.message }));
    p.on('close', (code) => done({ code, err }));
  });
}

// files: absolute paths of the recordings -> [{ file, out, made|kept|failed, size, error? }]
export async function remuxAll(dir, files) {
  const out = [];
  for (const file of files) {
    if (!needsRemux(file) || !fs.existsSync(file)) continue;
    const target = remuxedPath(dir, file);
    if (freshCopy(dir, file)) { out.push({ file, out: target, state: 'kept', size: fs.statSync(target).size }); continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = target.replace(/\.mp4$/, '.part.mp4');
    const r = await ffmpeg(remuxArgs(file, tmp));
    if (r.code !== 0) { fs.rmSync(tmp, { force: true }); out.push({ file, out: target, state: 'failed', error: r.err.trim().split('\n').slice(-1)[0] || 'ffmpeg failed' }); continue; }
    fs.renameSync(tmp, target);
    out.push({ file, out: target, state: 'made', size: fs.statSync(target).size });
  }
  return out;
}
