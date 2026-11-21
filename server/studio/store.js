// The studio files of one project, read and written: texts, research, options with the user's choices laid over,
// the feed pick and the upload settings. Writes to one project go one after another (no lost updates).
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { STUDIO, TEXTS, FILES, studioPath, readText, readJson, writeJson, writeAtomic, mtimeMs } from './files.js';
import { saveDecision, backupName, MAX_TEXT } from './text-save.js';
import { parseOptions, applyOp, choicesOf, withChoices } from './options.js';
import { parseVideos, patterns } from './research.js';
import { uploadFields } from './upload-plan.js';

const queues = new Map();
// run fn after every earlier write to the same project
export function serial(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(key, next);
  next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => {});
  return next;
}

const file = (dir, rel) => path.join(dir, STUDIO, rel);
const CHOICES = 'choices.json';

export async function readTextFile(dir, name) {
  const rel = TEXTS[name];
  if (!rel) throw new Error(`No studio text "${name}".`);
  const f = file(dir, rel);
  return { text: (await readText(f)) ?? '', mtime: await mtimeMs(f) };
}

// -> { saved, mtime, conflict, backup? }
export function saveTextFile(dir, name, text, base) {
  return serial(dir, async () => {
    const rel = TEXTS[name];
    if (!rel) throw new Error(`No studio text "${name}".`);
    if (typeof text !== 'string' || text.length > MAX_TEXT) throw new Error('The text is missing or too long.');
    const f = file(dir, rel);
    const diskText = await readText(f), diskMtime = await mtimeMs(f);
    const d = saveDecision({ diskText, diskMtime, base: Number(base), text });
    let backup;
    if (d.backup) {
      backup = path.posix.join('.history', backupName(rel));
      await writeAtomic(file(dir, backup), diskText);
    }
    if (d.write) await writeAtomic(f, text);
    return { saved: d.write, mtime: await mtimeMs(f), conflict: d.conflict, backup };
  });
}

const KIND_FILE = { titles: FILES.titles, thumbs: FILES.thumbs };

export async function readOptions(dir, kind) {
  const raw = await readJson(file(dir, KIND_FILE[kind]), null);
  const ch = (await readJson(file(dir, CHOICES), {}))?.[kind];
  return withChoices(raw, ch, kind);
}

export function changeOptions(dir, kind, op) {
  return serial(dir, async () => {
    if (!KIND_FILE[kind]) throw new Error(`No options "${kind}".`);
    const cur = await readOptions(dir, kind);
    const r = applyOp(cur, op, kind);
    if (r.error) return r;
    const raw = (await readJson(file(dir, KIND_FILE[kind]), null)) || {};
    // keep the agent's own extra keys; replace what the user changed
    await writeJson(file(dir, KIND_FILE[kind]), { ...(Array.isArray(raw) ? {} : raw), ...r.doc });
    const all = (await readJson(file(dir, CHOICES), {})) || {};
    all[kind] = choicesOf(r.doc, kind);
    await writeJson(file(dir, CHOICES), all);
    return { doc: r.doc, id: r.id };
  });
}

export async function readFeed(dir) {
  const f = (await readJson(file(dir, FILES.feed), {})) || {};
  return {
    picked: f.picked && typeof f.picked === 'object' ? { title: String(f.picked.title || ''), thumb: String(f.picked.thumb || '') } : null,
    seed: Number.isFinite(f.seed) ? f.seed : 1,
    theme: f.theme === 'dark' ? 'dark' : 'light',
    width: f.width === 'phone' ? 'phone' : 'desktop',
    channel: typeof f.channel === 'string' ? f.channel.slice(0, 80) : '',
    notes: typeof f.notes === 'string' ? f.notes.slice(0, 4000) : '',
  };
}

export function saveFeed(dir, patch) {
  return serial(dir, async () => {
    const cur = await readFeed(dir);
    const next = { ...cur };
    for (const k of ['seed', 'theme', 'width', 'channel', 'notes']) if (patch[k] !== undefined) next[k] = patch[k];
    if (patch.picked !== undefined) next.picked = patch.picked;
    await writeJson(file(dir, FILES.feed), next);
    return readFeed(dir);
  });
}

export async function readUpload(dir) {
  const u = (await readJson(file(dir, FILES.upload), {})) || {};
  return { fields: uploadFields(u), state: u.state && typeof u.state === 'object' ? u.state : { status: 'idle' } };
}

// fn(current) -> { fields?, state? } patch; the user's fields and the server's state share studio/upload.json
export function updateUpload(dir, fn) {
  return serial(dir, async () => {
    const raw = (await readJson(file(dir, FILES.upload), {})) || {};
    const patch = await fn({ fields: uploadFields(raw), state: raw.state || { status: 'idle' } });
    const next = { ...raw, ...(patch?.fields || {}), state: { ...(raw.state || {}), ...(patch?.state || {}) } };
    await writeJson(file(dir, FILES.upload), next);
    return { fields: uploadFields(next), state: next.state };
  });
}

// the thumbnails' pictures, newest file times so the browser reloads changed ones
async function stampFiles(dir, options) {
  for (const o of options) {
    const abs = studioPath(dir, path.posix.join('thumbs', o.file));
    o.mtime = abs ? Math.round(await mtimeMs(abs)) : 0;
  }
  return options;
}

// the final video's length through ffprobe, remembered per file time (the feed shows it on our tiles)
const durations = new Map();
function probeDuration(file, mtime) {
  const key = `${file}|${mtime}`;
  if (durations.has(key)) return Promise.resolve(durations.get(key));
  return new Promise((resolve) => {
    execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { timeout: 10000, windowsHide: true }, (err, out) => {
      const d = err ? undefined : Number(String(out).trim()) || undefined;
      if (durations.size > 100) durations.clear();
      durations.set(key, d);
      resolve(d);
    });
  });
}

// everything the Studio tab shows, in one read
export async function readStudio(dir) {
  const [plan, script, titles, thumbs, feed, upload, videosRaw] = await Promise.all([
    readTextFile(dir, 'plan'), readTextFile(dir, 'script'), readOptions(dir, 'titles'), readOptions(dir, 'thumbs'),
    readFeed(dir), readUpload(dir), readJson(file(dir, FILES.videos), null),
  ]);
  const research = parseVideos(videosRaw);
  await stampFiles(dir, thumbs.options);
  const finalVideo = upload.fields.video;
  let video = null;
  try {
    const abs = path.join(dir, ...finalVideo.split(/[\\/]/));
    const st = await fs.stat(abs);
    video = { path: finalVideo, bytes: st.size, mtime: Math.round(st.mtimeMs), duration: await probeDuration(abs, st.mtimeMs) };
  } catch {}
  return { plan, script, research: { ...research, patterns: patterns(research.videos) }, titles, thumbs, feed, upload: { ...upload, video } };
}

export { parseOptions };
