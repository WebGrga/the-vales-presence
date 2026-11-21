// The cut Shorts of a project: each pick cut in its own workshop shorts/<pick id>/video/ (out/final.mp4, the rough,
// its words), your review of each (studio/shorts-cut-review.json: { <id>: { status: 'ok'|'redo', note, at } }), what
// the Review stage's Approve or Send back says, and a Shorts project made from an edit (its rough, final and words
// linked in, nothing uploaded or transcribed again). The pure parts are tested in shorts-cut.test.js.
import fs from 'node:fs';
import path from 'node:path';

export const CUT_REVIEW = 'studio/shorts-cut-review.json';
export const CUT_STATUSES = ['ok', 'redo'];
const SHORT_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/i;

// ------------------------------------------------------------------ pure
// one Short's workshop as the screen reads it. f: { final, rough, words, srt (file names that exist), len, made }
export function cutOf(id, f = {}) {
  if (!f.final && !f.rough) return null;
  const base = `shorts/${id}/video/out/`;
  return {
    video: base + (f.final ? 'final.mp4' : 'rough.mp4'), which: f.final ? 'final' : 'rough',
    final: f.final ? base + 'final.mp4' : null, rough: f.rough ? base + 'rough.mp4' : null,
    words: f.words ? base + 'rough-words.json' : null, events: f.events ? base + 'events.json' : null,
    len: Number.isFinite(f.len) ? Math.round(f.len * 10) / 10 : null, passed: f.passed ?? null, made: f.made || null,
  };
}

// the picks with their cut and your review of it
export function withCuts(picks, cuts = {}, review = {}) {
  return (picks || []).map((m) => {
    const r = review?.[m.id] || {};
    return { ...m, cut: cuts[m.id] || null, cutStatus: CUT_STATUSES.includes(r.status) ? r.status : null, cutNote: r.note || '' };
  });
}
// Shorts cut that no pick names (a pick removed after the cut): they are shown too
export function strayCuts(picks, cuts = {}) {
  const ids = new Set((picks || []).map((m) => m.id));
  return Object.keys(cuts).filter((k) => !ids.has(k) && cuts[k]).map((k) => ({ id: k, title: k, stray: true }));
}

// one review click or note
export function applyCutChoice(review, ids, choice = {}, now = new Date().toISOString()) {
  const id = String(choice.short ?? '');
  if (!ids.includes(id)) return { error: `no cut Short "${id}"` };
  const next = { ...(review || {}) };
  const e = { ...(next[id] || {}) };
  if ('status' in choice) {
    if (choice.status !== null && !CUT_STATUSES.includes(choice.status)) return { error: 'status is ok, redo or null' };
    if (choice.status === null) delete e.status; else e.status = choice.status;
  }
  if ('note' in choice) { const n = String(choice.note ?? '').slice(0, 4000); if (n.trim()) e.note = n; else delete e.note; }
  e.at = now;
  if (!e.status && !e.note) delete next[id]; else next[id] = e;
  return { review: next };
}

// What the Review stage does with your choices: any Short marked redo (or with a note on one not yet ok) sends the
// stage back with notes naming each; otherwise it approves, naming the ones you passed.
// -> { action: 'approve'|'sendback', notes, redo: [ids], ok: [ids], open: [ids] } | { error }
export function reviewPlan(list) {
  const cut = (list || []).filter((m) => m.cut);
  if (!cut.length) return { error: 'No Short is cut yet.' };
  const ok = cut.filter((m) => m.cutStatus === 'ok'), redo = cut.filter((m) => m.cutStatus === 'redo');
  const open = cut.filter((m) => !m.cutStatus);
  const name = (m) => `${m.id}${m.title ? ` ("${m.title}")` : ''}`;
  if (redo.length) {
    const lines = redo.map((m) => `- ${name(m)}: ${m.cutNote || 'cut it again'}`);
    const keepLines = ok.length ? [`Leave these as they are: ${ok.map((m) => m.id).join(', ')}.`] : [];
    return { action: 'sendback', notes: [`Cut these Shorts again (only these, change nothing else):`, ...lines, ...keepLines].join('\n'), redo: redo.map((m) => m.id), ok: ok.map((m) => m.id), open: open.map((m) => m.id) };
  }
  const notes = [ok.length ? `Approved: ${ok.map(name).join(', ')}.` : '', open.length ? `Not marked (approved as they are): ${open.map((m) => m.id).join(', ')}.` : '',
    ...cut.filter((m) => m.cutNote && m.cutStatus !== 'redo').map((m) => `${m.id}: ${m.cutNote}`)].filter(Boolean).join(' ');
  return { action: 'approve', notes, redo: [], ok: ok.map((m) => m.id), open: open.map((m) => m.id) };
}

// Where "Cut these" stands: approve the picks and start the cutting, start it, or nothing to do
// project: project.json; recipe: its stages. -> { do: 'approve'|'go'|'none', why? }
export function cutAction(project, recipe) {
  const stages = recipe?.stages || [];
  const at = stages.findIndex((s) => s.id === project?.at);
  const pickReview = stages.findIndex((s) => s.kind === 'options');
  const cut = stages.findIndex((s, i) => i > pickReview && s.kind === 'make');
  const st = project?.stages?.[project?.at]?.status;
  if (pickReview < 0 || cut < 0) return { do: 'none', why: 'This project has no pick stage: use “Pick Shorts from this edit”.' };
  if (project?.halted) return { do: 'none', why: `The project is halted: ${project.halted}` };
  if (at === pickReview && st === 'waiting') return { do: 'approve' };
  if (at === cut && (st === 'todo' || st === 'waiting')) return { do: 'go' };
  if (at === cut && st === 'running') return { do: 'none', why: 'The Shorts are being cut now.' };
  if (at > cut) return { do: 'none', why: 'The Shorts are cut: review them below.' };
  return { do: 'none', why: 'The picks are not ready yet.' };
}

// The files a Shorts project made from an edit takes (rel to video/out), from what the edit has. The videos are hard
// links (no copy of a big file); the small files are copies, so nothing written in the new project can touch the
// edit's own (a hard link shares its bytes, and the edit's rough is locked).
export const LINKABLE = ['rough.mp4', 'final.mp4', 'rough-words.json', 'rough.json', 'rough-scenes.json', 'events.json'];
export const BIG = ['rough.mp4', 'final.mp4'];
export function linkPlan(has) {
  const set = new Set(has || []);
  if (!set.has('rough.mp4') && !set.has('final.mp4')) return { error: 'This project has no rough or final yet: make the rough cut first.' };
  if (!set.has('rough-words.json')) return { error: 'This project has no words for its rough yet (video/out/rough-words.json comes with the rough).' };
  const files = LINKABLE.filter((f) => set.has(f));
  return { files, link: files.filter((f) => BIG.includes(f)), copy: files.filter((f) => !BIG.includes(f)) };
}

// ------------------------------------------------------------------ disk
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
export function readCuts(dir) {
  const out = {};
  let ids = [];
  try { ids = fs.readdirSync(path.join(dir, 'shorts'), { withFileTypes: true }).filter((d) => d.isDirectory() && SHORT_ID.test(d.name)).map((d) => d.name); } catch {}
  for (const id of ids) {
    const o = path.join(dir, 'shorts', id, 'video', 'out');
    const is = (f) => { try { return fs.statSync(path.join(o, f)).isFile(); } catch { return false; } };
    const rough = readJson(path.join(o, 'rough.json'), {}), check = readJson(path.join(o, 'check.json'), null);
    let made = null; try { made = fs.statSync(path.join(o, is('final.mp4') ? 'final.mp4' : 'rough.mp4')).mtime.toISOString(); } catch {}
    const c = cutOf(id, { final: is('final.mp4'), rough: is('rough.mp4'), words: is('rough-words.json'), events: is('events.json'),
      len: Number(check?.length?.final ?? rough?.duration ?? readJson(path.join(o, 'edl.json'), {})?.total), passed: check ? !!check.passed : null, made });
    if (c) out[id] = c;
  }
  return out;
}
export const readCutReview = (dir) => readJson(path.join(dir, ...CUT_REVIEW.split('/')), {}) || {};

// link (hard link, else copy) a file; -> 'link' | 'copy'
export function linkOrCopy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try { fs.rmSync(to, { force: true }); fs.linkSync(from, to); return 'link'; } catch { fs.copyFileSync(from, to); return 'copy'; }
}
