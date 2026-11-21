// Studio files of a project: where they live, safe paths, atomic reads and writes.
// Every studio file sits in <project>/studio/. A request may name a path inside it, never outside.
import fs from 'node:fs/promises';
import path from 'node:path';

export const STUDIO = 'studio';
export const TEXTS = { plan: 'plan.md', script: 'script.md' };
export const FILES = {
  videos: path.join('research', 'videos.json'),
  titles: 'titles.json',
  thumbs: path.join('thumbs', 'options.json'),
  feed: 'feed.json',
  upload: 'upload.json',
};

// rel: a path inside studio/ written with / or \. Returns the absolute path, or null when it leaves studio/.
export function studioPath(projectDir, rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) return null;
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  if (!parts.length || parts.some((p) => p === '..' || p === '.' || /^[a-zA-Z]:$/.test(p))) return null;
  if (path.isAbsolute(rel) || /^[\\/]/.test(rel)) return null;
  const base = path.resolve(projectDir, STUDIO);
  const full = path.resolve(base, ...parts);
  return full.startsWith(base + path.sep) ? full : null;
}

export async function readText(file) {
  try { return await fs.readFile(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

export async function readJson(file, fallback = null) {
  const t = await readText(file);
  if (t === null || !t.trim()) return fallback;
  try { return JSON.parse(t.replace(/^﻿/, '')); } catch { return fallback; }
}

export async function mtimeMs(file) {
  try { return (await fs.stat(file)).mtimeMs; } catch { return 0; }
}

// write through a temporary file and rename, so a crash never leaves half a file
export async function writeAtomic(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data);
  try { await fs.rename(tmp, file); } catch (e) {
    // Windows may refuse a rename over a file another process holds open for a moment: retry once, then copy
    await new Promise((r) => setTimeout(r, 60));
    try { await fs.rename(tmp, file); } catch { await fs.copyFile(tmp, file); await fs.rm(tmp, { force: true }); }
  }
}

export const writeJson = (file, obj) => writeAtomic(file, JSON.stringify(obj, null, 2) + '\n');

export async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}
