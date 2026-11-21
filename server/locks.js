// Locked files. A gate with "lock": ["video/out/edl.json", "video/out/rough.mp4"] (paths in the project folder) hashes
// those files when you approve it (sha256, streamed: a rough can be hundreds of MB) into <project>/.presence/locks.json,
// which the engine reads too. Before and after every later make or inspect stage the files are hashed again; a change
// halts the project. The decisions are pure; the hashing streams, so the event loop is never held.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const CHECKED_KINDS = ['make', 'inspect'];
const MAX_LOCKS = 20;
export const LOCKS_FILE = path.join('.presence', 'locks.json');

// pure: a locked path stays inside the project: relative, forward slashes, no .. (null when it does not)
export function safeRel(rel) {
  const p = String(rel || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!p || p.startsWith('/') || /^[a-z]:/i.test(p) || p.split('/').includes('..')) return null;
  return p;
}
const abs = (base, rel) => path.join(base, ...rel.split('/'));
const isFile = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };

// sha256 of a file by streaming it: { sha256, size }
export function hashFile(file) {
  return new Promise((ok, fail) => {
    const h = crypto.createHash('sha256'); let size = 0;
    fs.createReadStream(file).on('data', (b) => { size += b.length; h.update(b); }).on('error', fail).on('end', () => ok({ sha256: h.digest('hex'), size }));
  });
}

// Hash every file of a gate's lock list. -> { locks: { rel: { sha256, size, at, stage } } } | { missing: [rel] }
export async function lockFiles(base, rels, stage, now = Date.now()) {
  const list = [...new Set((rels || []).map(safeRel).filter(Boolean))].slice(0, MAX_LOCKS);
  const missing = (rels || []).filter((r) => { const s = safeRel(r); return !s || !isFile(abs(base, s)); });
  if (missing.length) return { missing };
  const locks = {};
  for (const rel of list) locks[rel] = { ...(await hashFile(abs(base, rel))), at: now, stage };
  return { locks };
}

// Hash the locked files again. -> [{ file, why: 'changed' | 'missing' }] (empty: all as approved)
export async function checkLocks(base, locks) {
  const changed = [];
  for (const [rel, l] of Object.entries(locks || {})) {
    const s = safeRel(rel), f = s && abs(base, s);
    if (!f || !isFile(f)) { changed.push({ file: rel, why: 'missing' }); continue; }
    // a file whose size differs changed; no need to read it all
    try { if (l.size != null && fs.statSync(f).size !== l.size) { changed.push({ file: rel, why: 'changed' }); continue; } } catch {}
    try { const h = await hashFile(f); if (h.sha256 !== l.sha256) changed.push({ file: rel, why: 'changed' }); } catch { changed.push({ file: rel, why: 'missing' }); }
  }
  return changed;
}

export function readLocks(base) {
  try { const j = JSON.parse(fs.readFileSync(path.join(base, LOCKS_FILE), 'utf8')); return j && typeof j.locks === 'object' && j.locks ? j.locks : {}; } catch { return {}; }
}
// .presence/locks.json: what the engine, the agents and the screen read. An empty set removes the file.
export function writeLocks(base, locks) {
  const file = path.join(base, LOCKS_FILE);
  if (!Object.keys(locks || {}).length) { fs.rmSync(file, { force: true }); return; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ note: 'Locked by your approval. Do not change these files; check them with sha256.', locks }, null, 1) + '\n');
  fs.renameSync(tmp, file);
}

// pure: does a stage of this kind check the locks?
export const needsCheck = (kind, active) => CHECKED_KINDS.includes(kind) && Object.keys(active || {}).length > 0;

// pure: the sentence a stage after the gate is told
export function lockSentence(active) {
  const files = Object.keys(active || {});
  return files.length ? `Locked by your approval (never change these): ${files.join(', ')} (sha256 in .presence/locks.json). A changed locked file halts the project.` : '';
}

// pure: the gate that locked the changed files (the earliest one)
export function gateOf(changed, locks, recipe) {
  const ids = changed.map((c) => locks?.[c.file]?.stage).filter(Boolean);
  const order = (id) => (recipe?.stages || []).findIndex((s) => s.id === id);
  return ids.sort((a, b) => order(a) - order(b))[0] || null;
}

// pure: what you read when a locked file changed
export function lockMessage(changed, { stageName = 'This stage', gateName = 'the gate', when = 'after' } = {}) {
  const what = changed.map((c) => `${c.file}${c.why === 'missing' ? ' (gone)' : ''}`).join(', ');
  const lead = `${changed.length === 1 ? 'A locked file' : 'Locked files'} changed after you approved ${gateName} (${what}).`;
  return when === 'before'
    ? `${lead} ${stageName} did not start. Approve the new version, or send it back with notes.`
    : `${lead} ${stageName} must not change what you approved. Approve the new version, or send it back with notes.`;
}
