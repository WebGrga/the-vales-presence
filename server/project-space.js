// Disk space of a project. The pure part says which kind a file is (footage / renders / cache / other) and which
// files "Free space" may delete; the walk reads the folder. Nothing here deletes a deliverable or a source.
//
// Free space deletes only what the app makes again by itself, and only these:
//   video/out/work/proxy/     the 540p previews of the recordings (made again when the editor opens)
//   video/out/work/peaks/     the waveforms (made again with the previews)
//   video/out/work/rough-seg/ the pieces the rough cut was joined from
//   video/out/work/cuts/      the before/after clips of the cut list
//   export/media/             the .mp4 copies of the recordings that an export links (made again by the next export)
// It never touches: video/footage (your recordings), final.mp4, rough.mp4, the Studio files, project.json, the brief.
import fs from 'node:fs';
import path from 'node:path';

export const FREEABLE_DIRS = ['video/out/work/proxy', 'video/out/work/peaks', 'video/out/work/rough-seg', 'video/out/work/cuts', 'export/media'];

const norm = (rel) => String(rel || '').replace(/\\/g, '/').replace(/^\.?\//, '');
const under = (rel, dir) => rel === dir || rel.startsWith(dir + '/');

// pure: is this file (relative to the project, forward slashes) one Free space deletes?
export function isFreeable(rel) {
  const r = norm(rel);
  return FREEABLE_DIRS.some((d) => r.startsWith(d + '/'));
}
// pure: 'footage' | 'renders' | 'cache' | 'other'
export function kindOf(rel) {
  const r = norm(rel);
  if (under(r, 'video/footage')) return 'footage';
  if (isFreeable(r) || under(r, 'video/out/work') || under(r, 'video/remotion') || under(r, '.presence/poster')) return 'cache';
  if (/^video\/out\/[^/]+\.(mp4|mov|mkv|webm|wav|mp3)$/i.test(r) || under(r, 'export')) return 'renders';
  return 'other';
}
// pure: [{ rel, size }] -> { footage, renders, cache, other, total, freeable }
export function sumFiles(files) {
  const s = { footage: 0, renders: 0, cache: 0, other: 0, total: 0, freeable: 0 };
  for (const f of files) {
    const n = Number(f.size) || 0;
    s[kindOf(f.rel)] += n; s.total += n;
    if (isFreeable(f.rel)) s.freeable += n;
  }
  return s;
}
// pure: bytes in plain words
export function formatBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB']; let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return `${n >= 100 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}

// every file under dir: [{ rel, size }] (links are not followed)
export async function walk(dir) {
  const out = [];
  async function go(abs, rel) {
    let ents;
    try { ents = await fs.promises.readdir(abs, { withFileTypes: true }); } catch { return; }
    await Promise.all(ents.map(async (e) => {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) return go(path.join(abs, e.name), r);
      if (!e.isFile()) return;
      try { out.push({ rel: r, size: (await fs.promises.stat(path.join(abs, e.name))).size }); } catch {}
    }));
  }
  await go(dir, '');
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}
export async function measure(dir) { return sumFiles(await walk(dir)); }

// the files Free space would delete: { files: [{ rel, size }], bytes } (nothing is deleted here)
export async function freeablePlan(dir) {
  const files = (await walk(dir)).filter((f) => isFreeable(f.rel));
  return { files, bytes: files.reduce((a, f) => a + f.size, 0) };
}
// delete exactly the plan; the emptied folders stay. -> { deleted: [rel], bytes }
export async function freeSpace(dir) {
  const plan = await freeablePlan(dir);
  const deleted = []; let bytes = 0;
  for (const f of plan.files) {
    try { await fs.promises.rm(path.join(dir, ...f.rel.split('/')), { force: true }); deleted.push(f.rel); bytes += f.size; } catch {}
  }
  return { deleted, bytes };
}
