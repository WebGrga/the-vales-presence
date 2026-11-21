// The package's own files: the feed marks (studio/feed-marks.json) and the bet (studio/bet.json), with the lesson a
// "Missed why" mark leaves in the user's house rules. The decisions are pure and tested in package-data.test.js.
//   marks: { "<tile key>": { kind: 'ours'|'real', title, like?: true, why?: 'got'|'missed', words?, lesson? } }
//   bet:   { metric, direction, median, note, madeAt, result: { text, at } | null }
import { readJson, writeJson } from './files.js';
import path from 'node:path';
import { readUploads } from './upload-history.js';
import { readJudge } from './judge-run.js';

const str = (v, n = 300) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, n) : '');
const KEY = /^[A-Za-z0-9_+.\-]{1,120}$/;
export const METRICS = [['ctr', 'Click-through rate'], ['views48', 'Views in the first 48 hours'], ['retention', 'Average view duration'], ['subs', 'New subscribers']];
export const DIRECTIONS = [['above', 'above'], ['below', 'below']];
export const WEEK = 7 * 24 * 3600e3;

// ------------------------------------------------------------------ marks
export function cleanMarks(raw) {
  const out = {};
  const src = raw && typeof raw === 'object' && raw.marks && typeof raw.marks === 'object' ? raw.marks : {};
  for (const [k, m] of Object.entries(src)) {
    if (!KEY.test(k) || !m || typeof m !== 'object') continue;
    const o = { kind: m.kind === 'real' ? 'real' : 'ours', title: str(m.title, 200) };
    if (m.like === true) o.like = true;
    if (m.why === 'got' || m.why === 'missed') o.why = m.why;
    if (str(m.words, 600)) o.words = str(m.words, 600);
    if (str(m.lesson, 800)) o.lesson = str(m.lesson, 800);
    if (o.like || o.why) out[k] = o;
  }
  return out;
}

// a change { key, kind, title, like?: bool, why?: 'got'|'missed'|null, words?: string } -> { marks, lessonOut?, lessonIn? }
// lessonOut: a lesson line this change takes back; lessonIn: the one it writes (only for Missed why with the user's words)
export function applyMark(marks, c) {
  if (!KEY.test(String(c?.key || ''))) return { error: 'No such tile.' };
  const cur = { ...(marks[c.key] || {}) };
  const m = { kind: c.kind === 'real' ? 'real' : cur.kind || 'ours', title: str(c.title, 200) || cur.title || '', ...cur };
  m.kind = c.kind === 'real' ? 'real' : c.kind === 'ours' ? 'ours' : m.kind;
  if (str(c.title, 200)) m.title = str(c.title, 200);
  if (c.like === true) m.like = true; else if (c.like === false) delete m.like;
  if (c.why === null) { delete m.why; delete m.words; } else if (c.why === 'got' || c.why === 'missed') m.why = c.why;
  if (typeof c.words === 'string') { if (str(c.words, 600)) m.words = str(c.words, 600); else delete m.words; }
  const out = { ...marks };
  let lessonOut, lessonIn;
  const wants = m.why === 'missed' && m.words ? lessonFor(m) : null;
  if (m.lesson && m.lesson !== wants) { lessonOut = m.lesson; delete m.lesson; }
  if (wants && m.lesson !== wants) { lessonIn = wants; m.lesson = wants; }
  if (m.like || m.why) out[c.key] = m; else delete out[c.key];
  return { marks: out, lessonOut, lessonIn };
}

// the lesson a Missed why leaves, in the user's own words; the date and counts are added by lessonLine
export function lessonFor(m) {
  const w = str(m.words, 400).replace(/\s+/g, ' ');
  const t = str(m.title, 120).replace(/\s+/g, ' ');
  if (!w) return null;
  return m.kind === 'real'
    ? `Study why a real winner works before copying its look: a viewer did not see why “${t}” works, and said “${w}”.`
    : `Check an option as a stranger would before showing it: a viewer missed why “${t}” is worth a click, and said “${w}”.`;
}
export const lessonLine = (text, date) => `- ${text} _(${date}; evidence: a Missed why mark in the feed; kept 0, against 0)_`;

// pure: the house rules text with a lesson line added under "## Lessons" (at the end of that section), or one taken out.
// A taken-out line must still be unjudged (kept 0, against 0): a lesson the user already counted stays.
export function withLesson(md, text, date) {
  const eol = /\r\n/.test(md) ? '\r\n' : '\n', lines = String(md).split(/\r?\n/);
  const line = lessonLine(text, date);
  if (lines.some((l) => l.startsWith(`- ${text} _(`))) return md;
  let a = lines.findIndex((l) => /^##\s+lessons\b/i.test(l.trim()));
  if (a < 0) { lines.push('', '## Lessons', '', line); return lines.join(eol); }
  let z = lines.findIndex((l, i) => i > a && /^#{1,2}\s/.test(l.trim()));
  if (z < 0) z = lines.length;
  while (z > a + 1 && !lines[z - 1].trim()) z--;
  lines.splice(z, 0, line);
  return lines.join(eol);
}
export function withoutLesson(md, text) {
  const eol = /\r\n/.test(md) ? '\r\n' : '\n';
  const lines = String(md).split(/\r?\n/);
  const i = lines.findIndex((l) => l.startsWith(`- ${text} _(`) && /kept 0, against 0/.test(l));
  if (i < 0) return md;
  lines.splice(i, 1);
  return lines.join(eol);
}

export const MARKS_FILE = (dir) => path.join(dir, 'studio', 'feed-marks.json');
export async function readMarks(dir) { return cleanMarks(await readJson(MARKS_FILE(dir), null)); }
export async function writeMarks(dir, marks) { await writeJson(MARKS_FILE(dir), { marks }); }

// ------------------------------------------------------------------ the bet
export function cleanBet(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const b = {
    metric: METRICS.some(([k]) => k === raw.metric) ? raw.metric : 'ctr',
    direction: raw.direction === 'below' ? 'below' : 'above',
    median: str(raw.median, 60), note: str(raw.note, 600),
    madeAt: str(raw.madeAt, 40) || null,
    result: raw.result && typeof raw.result === 'object' && str(raw.result.text, 1000) ? { text: str(raw.result.text, 1000), at: str(raw.result.at, 40) || null } : null,
  };
  return b;
}
export const BET_FILE = (dir) => path.join(dir, 'studio', 'bet.json');
export async function readBet(dir) { return cleanBet(await readJson(BET_FILE(dir), null)); }

// the upload this bet is about: the last real (not dry) upload's time, or null before one
export function uploadedAt(history) {
  const real = (Array.isArray(history) ? history : []).filter((e) => e && !e.dry && e.at).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return real[0]?.at || null;
}
// 'none' (no upload yet), 'waiting' (a week not over), 'due' (a week or more and no result), 'done' (result written)
export function betState(bet, uploaded, now = Date.now()) {
  if (!bet) return { phase: 'none' };
  if (bet.result) return { phase: 'done' };
  if (!uploaded) return { phase: 'none' };
  const due = Date.parse(uploaded) + WEEK;
  if (!Number.isFinite(due)) return { phase: 'none' };
  return now >= due ? { phase: 'due', due: new Date(due).toISOString() } : { phase: 'waiting', due: new Date(due).toISOString(), days: Math.ceil((due - now) / 86400e3) };
}
export function applyBet(cur, patch, now = new Date()) {
  const b = cleanBet({ ...(cur || {}), ...(patch || {}) }) || cleanBet({});
  if (!b.madeAt) b.madeAt = now.toISOString();
  if (patch && 'result' in patch) b.result = patch.result && str(patch.result.text ?? patch.result, 1000) ? { text: str(patch.result.text ?? patch.result, 1000), at: now.toISOString() } : null;
  return b;
}

// everything the Feed page needs besides the options: { marks, judge, bet, betState }
export async function readPackage(dir, uploadState) {
  const [marks, judge, bet, uploads] = await Promise.all([readMarks(dir), readJudge(dir), readBet(dir), readUploads(dir, uploadState)]);
  return { marks, judge, bet, betState: betState(bet, uploadedAt(uploads)) };
}
