// The poster of a project (the picture on its card). Pure: which file it comes from (choosePoster). Then one small
// jpeg (480 wide) made with ffmpeg and kept in <project>/.presence/poster.jpg, remade only when its source changed.
// Order: the picked thumbnail, a frame of final.mp4, a frame of rough.mp4, the first recording (video or picture).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const VIDEO = /\.(mp4|mov|mkv|webm|m4v|avi)$/i;
const IMAGE = /\.(png|jpe?g|webp|gif)$/i;

// pure: have = { thumb: 'studio/thumbs/a.png'|null, final: bool, rough: bool, footage: [names] } -> { kind, rel } | { kind: 'none' }
export function choosePoster(have = {}) {
  if (have.thumb) return { kind: 'thumbnail', rel: have.thumb };
  if (have.final) return { kind: 'final', rel: 'video/out/final.mp4' };
  if (have.rough) return { kind: 'rough', rel: 'video/out/rough.mp4' };
  const names = (have.footage || []).filter((n) => VIDEO.test(n) || IMAGE.test(n)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const first = names.find((n) => VIDEO.test(n)) || names[0];
  return first ? { kind: 'footage', rel: `video/footage/${first}` } : { kind: 'none' };
}

const has = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
// reads the folder: what choosePoster needs
export function findPosterInputs(dir) {
  let thumb = null;
  try {
    const o = JSON.parse(fs.readFileSync(path.join(dir, 'studio', 'thumbs', 'options.json'), 'utf8'));
    const pick = (o.options || []).find((x) => x.id === o.picked && typeof x.file === 'string');
    if (pick && !/[\\/]/.test(pick.file) && has(path.join(dir, 'studio', 'thumbs', pick.file))) thumb = `studio/thumbs/${pick.file}`;
  } catch {}
  let footage = [];
  try { footage = fs.readdirSync(path.join(dir, 'video', 'footage')).filter((n) => !n.startsWith('.') && !n.endsWith('.part')); } catch {}
  return { thumb, final: has(path.join(dir, 'video', 'out', 'final.mp4')), rough: has(path.join(dir, 'video', 'out', 'rough.mp4')), footage };
}

function ffmpeg(args) {
  return new Promise((done) => {
    let p; let fin = false;
    const end = (ok) => { if (!fin) { fin = true; clearTimeout(t); done(ok); } };
    try { p = spawn('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { windowsHide: true, stdio: 'ignore' }); } catch { return done(false); }
    const t = setTimeout(() => { try { p.kill(); } catch {} end(false); }, 30000);
    p.on('error', () => end(false));
    p.on('close', (code) => end(code === 0));
  });
}

let busy = 0; const waiting = [];
const slot = () => new Promise((go) => { const t = () => { busy++; go(); }; if (busy < 2) t(); else waiting.push(t); });
const release = () => { busy--; waiting.shift()?.(); };

// the poster's file for a project: { file } (the cached jpeg) or { none: true }. Never throws.
export async function posterFile(dir) {
  const pick = choosePoster(findPosterInputs(dir));
  const cache = path.join(dir, '.presence', 'poster.jpg'), meta = path.join(dir, '.presence', 'poster.json');
  if (pick.kind === 'none') return { none: true };
  const src = path.join(dir, ...pick.rel.split('/'));
  let st; try { st = fs.statSync(src); } catch { return { none: true }; }
  const stamp = { rel: pick.rel, mtime: Math.round(st.mtimeMs), size: st.size };
  try { const m = JSON.parse(fs.readFileSync(meta, 'utf8')); if (m.rel === stamp.rel && m.mtime === stamp.mtime && m.size === stamp.size) return m.failed ? { none: true } : has(cache) ? { file: cache } : { none: true }; } catch {}
  await slot();
  try {
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    const scale = ['-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', cache];
    let ok;
    if (IMAGE.test(src)) ok = await ffmpeg(['-i', src, ...scale]);
    else ok = (await ffmpeg(['-ss', '1', '-i', src, ...scale])) && has(cache) || (await ffmpeg(['-i', src, ...scale]));
    ok = ok && has(cache);
    fs.writeFileSync(meta, JSON.stringify({ ...stamp, failed: !ok }));
    return ok ? { file: cache } : { none: true };
  } finally { release(); }
}
