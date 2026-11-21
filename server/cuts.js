// The Cuts list: video/out/cuts.json (every cut of the rough, written by the engine's handover) and your choices on
// each, kept in video/out/cuts-review.json as you click and type:
//   { "c3": { "keep": false, "note": "..." } }   keep true = Keep the cut, false = Restore the words, absent = undecided
// Also the screen's working copy of the edit list: video/out/edl.working.json (Keep/Restore and struck words play at once).
// The pure parts (cleanReview, applyChoice, merge, reviewSummary, cleanWorking) are tested in cuts.test.js.
import fs from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic } from './projects.js';

export const REVIEW = 'cuts-review.json';
export const WORKING = 'edl.working.json';
const NOTE_MAX = 4000;

// pure: the review as it may be kept: only known ids, keep a boolean, a note a string of a sane length
export function cleanReview(review, ids) {
  const out = {}, known = new Set(ids);
  for (const [id, r] of Object.entries(review && typeof review === 'object' ? review : {})) {
    if (!known.has(id) || !r || typeof r !== 'object') continue;
    const e = {};
    if (typeof r.keep === 'boolean') e.keep = r.keep;
    if (typeof r.note === 'string' && r.note.trim()) e.note = r.note.slice(0, NOTE_MAX);
    if (r.at) e.at = String(r.at).slice(0, 40);
    if ('keep' in e || 'note' in e) out[id] = e;
  }
  return out;
}

// pure: one choice applied. patch: { keep: true|false|null (null clears it), note: string (empty clears it) }
export function applyChoice(review, ids, id, patch, now = new Date().toISOString()) {
  if (!ids.includes(id)) return { error: 'no such cut' };
  const e = { ...(review?.[id] || {}) }, p = patch || {};
  if ('keep' in p) { if (typeof p.keep === 'boolean') e.keep = p.keep; else if (p.keep == null) delete e.keep; else return { error: 'keep is true, false or null' }; }
  if ('note' in p) { if (p.note != null && typeof p.note !== 'string') return { error: 'note is text' }; if (String(p.note || '').trim()) e.note = String(p.note).slice(0, NOTE_MAX); else delete e.note; }
  e.at = now;
  const next = { ...(review || {}) };
  next[id] = e;
  return { review: cleanReview(next, ids) };
}

// pure: cuts.json and the review as the screen reads them. urlOf(rel to video/) -> a media URL
export function merge(data, review, urlOf = (x) => x) {
  const cuts = (Array.isArray(data?.cuts) ? data.cuts : []).filter((c) => c && typeof c.id === 'string' && c.id);
  const ids = cuts.map((c) => c.id);
  const rv = cleanReview(review, ids);
  const list = cuts.map((c) => {
    const r = rv[c.id] || {};
    const urls = {};
    for (const [k, v] of Object.entries(c.clips || {})) if (typeof v === 'string') urls[k] = urlOf(v);
    return { ...c, keep: 'keep' in r ? r.keep : null, note: r.note || '', urls };
  });
  // flagged first, then in cut order (the screen may sort again)
  const order = [...list].sort((a, b) => (b.flag === true) - (a.flag === true) || ids.indexOf(a.id) - ids.indexOf(b.id)).map((c) => c.id);
  return { ...data, cuts: list, order, review: rv, decided: Object.values(rv).filter((x) => 'keep' in x).length, count: list.length };
}

// pure: your choices as words for the agent (what goes with a send-back)
export function reviewSummary(cuts, review) {
  const byId = Object.fromEntries((cuts || []).map((c) => [c.id, c]));
  const lines = [];
  for (const [id, r] of Object.entries(review || {})) {
    const c = byId[id];
    if (!c) continue;
    const what = c.removed ? ` "${String(c.removed).slice(0, 120)}"` : '';
    const at = typeof c.at === 'number' ? ` at ${c.at.toFixed(2)} s` : '';
    if (r.keep === false) lines.push(`- ${id}${at} (${c.kind || 'cut'}): RESTORE the removed words${what}${r.note ? `. Note: ${r.note}` : ''}`);
    else if (r.keep === true) lines.push(`- ${id}${at}: keep the cut${r.note ? `. Note: ${r.note}` : ''}`);
    else if (r.note) lines.push(`- ${id}${at}: note: ${r.note}`);
  }
  return lines.length ? `Your choices on the cuts of the rough (from video/out/cuts-review.json):\n${lines.join('\n')}` : '';
}

// pure: choices the rough does not carry yet (restored cuts, struck words in the working list). Locking the rough
// with any of them would lock it without them, so a locking approve refuses until they are applied or cleared.
// The same rule as the screen (web/editor/store.js): a working list counts only when it was made from the edl.json that
// is there now; one made from an older rough is stale and binds nothing (edl: the current edl.json, when known).
export function pendingChoices(review, working, edl) {
  const restored = Object.entries(review || {}).filter(([, r]) => r && r.keep === false).map(([id]) => id);
  const fresh = !working || edl === undefined || !isStale(working, edl);
  const w = fresh && working && typeof working === 'object' ? working.working || {} : {};
  const strikes = Array.isArray(w.strikes) ? w.strikes.length : 0;
  // joins moved on the timeline are not in the rough until it is rebuilt; blades change nothing you hear
  const trims = Array.isArray(w.trims) ? w.trims.length : 0;
  if (!restored.length && !strikes && !trims) return null;
  const parts = [restored.length ? `you restored ${restored.join(', ')}` : '', strikes ? `you struck ${strikes} stretch${strikes > 1 ? 'es' : ''} of words` : '', trims ? `you moved ${trims} join${trims > 1 ? 's' : ''}` : ''].filter(Boolean);
  const what = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return { restored, strikes, trims, message: `Not locked: ${what}, and the rough does not have ${restored.length + strikes + trims > 1 ? 'them' : 'it'} yet. Send it back so the agent builds the rough with your choices (they go with the notes), or set those cuts back to Keep, then approve.` };
}

// pure: an edit list's own mark (the same as web/editor/edl-edit.js baseMark: its total and its number of items)
export const baseMark = (edl) => `${edl?.total ?? ''}:${(edl?.items || []).length}`;
// pure: a working list made from another edit list than this one
export const isStale = (working, edl) => !!working?.working && working.working.base !== baseMark(edl);

// pure: what a send-back puts aside with your choices, so the next rough starts clean. A send-back to the stage that
// makes cuts.json (or before it) archives the review and the working list together; later send-backs keep both.
// -> [file names in video/out] to rename to <name>.sent-<time>.json
export function sendbackArchive({ targetIndex, makerIndex, hasReview, hasWorking }) {
  if (makerIndex >= 0 && targetIndex > makerIndex) return [];
  return [hasReview ? REVIEW : null, hasWorking ? WORKING : null].filter(Boolean);
}
export const archivedName = (name, now = Date.now()) => name.replace(/\.json$/, `.sent-${now}.json`);

// pure: a working edit list as it may be saved -> { edl } | { error }
export function cleanWorking(edl) {
  if (!edl || typeof edl !== 'object' || Array.isArray(edl)) return { error: 'send the edit list as an object' };
  if (!Array.isArray(edl.items)) return { error: 'the edit list needs items' };
  if (edl.items.length > 20000) return { error: 'too many items' };
  for (const it of edl.items) if (!it || typeof it !== 'object') return { error: 'every item is an object' };
  return { edl };
}

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

// the cuts of a project folder: { data, cuts, ids, review, reviewFile, file } or null when there is no cuts.json
export function readCuts(dir) {
  const out = path.join(dir, 'video', 'out');
  const file = path.join(out, 'cuts.json');
  const data = readJson(file, null);
  if (!data || !Array.isArray(data.cuts)) return null;
  const cuts = data.cuts.filter((c) => c && typeof c.id === 'string' && c.id);
  const ids = cuts.map((c) => c.id);
  const reviewFile = path.join(out, REVIEW);
  return { file, data, cuts, ids, reviewFile, review: cleanReview(readJson(reviewFile, {}), ids) };
}
export const writeReview = (c, review) => writeJsonAtomic(c.reviewFile, review);
export const workingFile = (dir) => path.join(dir, 'video', 'out', WORKING);
