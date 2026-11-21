// Review items: the things the agent wants you to look at or listen to, at a time on the video (a tight join, a word it
// was unsure of, private text on screen, a quiet stretch), gathered in one file the Cuts list and the timeline show.
//
//   video/out/review-items.json          { "items": [ { at, to?, kind, text, source, on? } ] }   written by the agent
//   video/out/review-items-review.json   { <id>: { done, note, at } }                            your marks, kept apart
//
// at / to: seconds on the video the stage made (the rough for a rough stage; the final after the lock, which has the
// same timeline). kind: one of KINDS. source: the stage that wrote it (rough, visuals, inspect, cut...). on: rough|final.
// Inspect's "For you" in inspect.md is read too when the agent left no inspect items in the file, so nothing it said
// is lost. A Short's own items are in shorts/<id>/video/out/. The pure parts are tested in review-items.test.js.
import fs from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic } from './projects.js';

export const ITEMS_FILE = 'video/out/review-items.json';
export const MARKS_FILE = 'video/out/review-items-review.json';
export const KINDS = ['listen', 'look', 'private', 'length', 'pace', 'words', 'flag', 'other'];
const TEXT_MAX = 1000, MAX_ITEMS = 500;

// pure: a short stable id from what an item is
export function itemId(it) {
  const key = `${it.source || ''}|${it.at ?? ''}|${String(it.text || '').slice(0, 80)}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return 'ri-' + (h >>> 0).toString(36);
}

const num = (x) => (x == null || x === '' || !Number.isFinite(Number(x)) || Number(x) < 0 ? null : Math.round(Number(x) * 1000) / 1000);

// pure: "1:16", "0:28.5", "1:02:03", "76.2" -> seconds (or null)
export function seconds(x) {
  if (typeof x === 'number') return num(x);
  const s = String(x ?? '').trim();
  if (/^\d+(\.\d+)?$/.test(s)) return num(s);
  const m = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)$/);
  if (!m) return null;
  return num((Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]));
}

// pure: one item as it may be kept, or null
export function cleanItem(it, defaults = {}) {
  if (!it || typeof it !== 'object') return null;
  const text = String(it.text ?? it.title ?? it.note ?? it.what ?? '').trim().slice(0, TEXT_MAX);
  if (!text) return null;
  const at = seconds(it.at ?? it.time ?? it.from), to = seconds(it.to ?? it.end);
  const kind = KINDS.includes(it.kind) ? it.kind : 'other';
  const source = String(it.source || defaults.source || 'agent').replace(/[^\w.-]/g, '').slice(0, 40) || 'agent';
  const on = ['rough', 'final'].includes(it.on) ? it.on : defaults.on || null;
  const out = { at, to: to != null && at != null && to > at ? to : null, kind, text, source, on };
  out.id = typeof it.id === 'string' && /^[\w.-]{1,60}$/.test(it.id) ? it.id : itemId(out);
  return out;
}

// pure: the times in a line of text ("0:28–0:49", "at 1:16", "1:22-1:49") -> [{ at, to }]
export function timesIn(line) {
  const re = /(?<![\d:.])(\d{1,2}:\d{2}(?:\.\d+)?)(?:\s*(?:–|—|-|to)\s*(\d{1,2}:\d{2}(?:\.\d+)?))?(?!\d|:\d)/g;
  const out = [];
  for (const m of String(line).matchAll(re)) out.push({ at: seconds(m[1]), to: m[2] ? seconds(m[2]) : null });
  return out;
}

const guessKind = (t) => /privat|blur|personal|password|e-?mail|path|\bid\b/i.test(t) ? 'private'
  : /\blength|over the brief|too long|seconds? over|\bs over\b/i.test(t) ? 'length'
    : /quiet|still|nothing chang|pace|dead air/i.test(t) ? 'pace'
      : /listen|join|clip|breath|sound/i.test(t) ? 'listen'
        : /caption|word|spell/i.test(t) ? 'words' : 'look';
const plain = (t) => String(t).replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();

// pure: inspect.md's "For you" section as items (one per bullet; a bullet's own sub-bullets with times become items
// of their own, each with the parent's lead words)
export function fromInspect(md) {
  const lines = String(md || '').split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,4}\s*for you\b/i.test(l.trim()));
  if (start < 0) return [];
  const groups = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{1,4}\s/.test(l.trim())) break;
    const m = l.match(/^(\s*)[-*]\s+(.*)$/);
    if (!m) continue;
    if (m[1].length < 2 || !groups.length) groups.push({ top: m[2], kids: [] });
    else groups[groups.length - 1].kids.push(m[2]);
  }
  const items = [];
  for (const g of groups) {
    const top = plain(g.top);
    const lead = ((top.match(/^(.{3,90}?[.:])(\s|$)/) || [null, top.slice(0, 90)])[1] || '').replace(/[.:]$/, '');
    const made = [];
    const t = timesIn(g.top);
    if (t.length) made.push({ at: t[0].at, to: t[0].to, text: top });
    for (const k of g.kids) {
      const kt = timesIn(k);
      if (kt.length) made.push({ at: kt[0].at, to: kt[0].to, text: `${lead}: ${plain(k)}` });
    }
    if (!made.length) made.push({ at: null, to: null, text: top });
    // a length is not a point on the timeline ("Length is 3:45.7")
    for (const x of made) { const kind = guessKind(x.text); items.push(kind === 'length' ? { ...x, at: null, to: null, kind } : { ...x, kind }); }
  }
  return items.map((x) => cleanItem({ ...x, source: 'inspect', on: 'final' })).filter(Boolean);
}

// pure: the file's items, inspect.md's when the file has none from inspect, and your marks -> sorted by time
export function gather(doc, inspectMd, marks = {}) {
  const raw = Array.isArray(doc) ? doc : Array.isArray(doc?.items) ? doc.items : [];
  const items = raw.slice(0, MAX_ITEMS).map((x) => cleanItem(x)).filter(Boolean);
  if (inspectMd && !items.some((x) => x.source === 'inspect')) items.push(...fromInspect(inspectMd));
  const seen = new Set();
  const out = [];
  for (const it of items) { if (seen.has(it.id)) continue; seen.add(it.id); const m = marks?.[it.id] || {}; out.push({ ...it, done: !!m.done, mark: m.note || '' }); }
  return out.sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity) || a.source.localeCompare(b.source));
}

// pure: one mark set. patch: { done?, note? }
export function applyMark(marks, ids, id, patch = {}, now = new Date().toISOString()) {
  if (!ids.includes(id)) return { error: 'no such review item' };
  const next = { ...(marks || {}) };
  const e = { ...(next[id] || {}) };
  if ('done' in patch) { if (typeof patch.done !== 'boolean') return { error: 'done is true or false' }; e.done = patch.done; }
  if ('note' in patch) { const n = String(patch.note ?? '').slice(0, 4000); if (n.trim()) e.note = n; else delete e.note; }
  e.at = now;
  if (!e.done && !e.note) delete next[id]; else next[id] = e;
  return { marks: next };
}

// ------------------------------------------------------------------ on disk
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const at = (dir, rel) => path.join(dir, ...rel.split('/'));
// base: the project folder, or a Short's folder (shorts/<id>), where video/out lives; inspect.md sits in the project
export function readItems(base, { inspect = true } = {}) {
  const doc = readJson(at(base, ITEMS_FILE), null);
  const md = inspect ? (() => { try { return fs.readFileSync(path.join(base, 'inspect.md'), 'utf8'); } catch { return ''; } })() : '';
  const marks = readJson(at(base, MARKS_FILE), {}) || {};
  return { items: gather(doc, md, marks), marks };
}
export function writeMarks(base, marks) { writeJsonAtomic(at(base, MARKS_FILE), marks); }
