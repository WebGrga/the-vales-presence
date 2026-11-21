// The Shorts of a long project, pure (used by the Shorts tab and by server/routes/shorts.js; tested in list.test.js).
//
// The moments come from the agent's pick stage: `studio/shorts/picks.json` ({ picks: [{ id, src, from, to, title, hook, why, len?, trim? }] },
// src = a file relative to video/, or "rough", or a source key of the edit list). Older shapes are read too: `studio/shorts.json`
// ([...] or { shorts: [...] }) and `video/out/shorts/picks.json` ({ source, picks }). The user's Keep / Drop / Note live in
// `studio/shorts-review.json` ({ <id>: { status, note } }), so the agent can revise its list without losing a click, and are mirrored into
// the picks file as `chosen: true|false` (and `note`), which is what the cutting stage reads.

export const FILES = { picks: 'studio/shorts/picks.json', list: 'studio/shorts.json', oldPicks: 'video/out/shorts/picks.json', review: 'studio/shorts-review.json' };
export const SOURCES = [FILES.picks, FILES.list, FILES.oldPicks];
export const STATUSES = ['keep', 'drop'];

const num = (x) => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));

// any of the shapes -> { source, list: [{ id, from, to, len, title, hook, why, trim, src, status (the agent's), ... }] }
export function readMoments(doc) {
  if (!doc) return { source: null, list: [] };
  const arr = Array.isArray(doc) ? doc : doc.shorts || doc.picks || [];
  const source = Array.isArray(doc) ? null : doc.source || null;
  const list = [];
  const seen = new Set();
  arr.forEach((m, i) => {
    if (!m || typeof m !== 'object') return;
    let id = String(m.id ?? `s${i + 1}`);
    while (seen.has(id)) id += '-b';
    seen.add(id);
    const from = num(m.from), to = num(m.to);
    list.push({
      ...m, id, from, to,
      len: num(m.len) ?? (from != null && to != null ? Math.round((to - from) * 100) / 100 : null),
      title: String(m.title || ''), hook: String(m.hook || ''), why: String(m.why || ''), trim: m.trim ? String(m.trim) : '',
      src: m.src || m.source || source || null,
    });
  });
  return { source, list };
}

// the moments with the user's choices on top: status = the user's keep/drop, else the file's own (status keep/drop, or chosen true), else null
export function merge(list, review = {}) {
  return list.map((m) => {
    const r = review?.[m.id] || {};
    const own = STATUSES.includes(m.status) ? m.status : m.chosen === true ? 'keep' : null;
    return { ...m, agentStatus: m.status ?? null, status: r.status !== undefined ? r.status : own, note: r.note ?? m.note ?? '' };
  });
}

// one click or note -> the new review object. choice = { short, status?: 'keep'|'drop'|null, note?: string }
export function applyChoice(review, list, choice) {
  const id = String(choice?.short ?? '');
  if (!list.some((m) => m.id === id)) throw Object.assign(new Error(`no Short "${id}"`), { status: 404 });
  const next = { ...(review || {}) };
  const cur = { ...(next[id] || {}) };
  if ('status' in choice) {
    if (choice.status !== null && !STATUSES.includes(choice.status)) throw Object.assign(new Error('status is keep, drop or null'), { status: 400 });
    cur.status = choice.status;
  }
  if ('note' in choice) cur.note = String(choice.note ?? '').slice(0, 4000);
  if (cur.status == null && !cur.note) delete next[id];
  else next[id] = { ...cur, at: choice.at || cur.at || null };
  return next;
}

export const clock = (s) => {
  if (s == null) return '?';
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
export const span = (m) => `${clock(m.from)}–${clock(m.to)}`;

// the words the agent reads when the picks are approved: which to cut, which to leave, the notes
export function choiceNotes(merged) {
  const keep = merged.filter((m) => m.status === 'keep');
  const drop = merged.filter((m) => m.status === 'drop');
  const open = merged.filter((m) => m.status == null);
  const line = (m) => `${m.id} (${span(m)}${m.title ? `, "${m.title}"` : ''})${m.note ? `: ${m.note}` : ''}`;
  const out = [];
  if (keep.length) out.push(`Cut these Shorts: ${keep.map(line).join('; ')}.`);
  if (drop.length) out.push(`Leave out: ${drop.map((m) => m.id).join(', ')}.`);
  if (open.length) out.push(`Not decided (leave out): ${open.map((m) => m.id).join(', ')}.`);
  const otherNotes = [...drop, ...open].filter((m) => m.note);
  if (otherNotes.length) out.push(`Notes on the others: ${otherNotes.map((m) => `${m.id}: ${m.note}`).join('; ')}.`);
  return out.join(' ');
}

// what "Cut these" sends: approve the pick review (with the choices) when the project waits there, then run the stage
export function cutSteps(project, merged) {
  const keep = merged.filter((m) => m.status === 'keep');
  if (!keep.length) return { error: 'Keep at least one Short first.' };
  const at = project?.at;
  const st = at ? project?.stages?.[at]?.status : null;
  if (project?.halted) return { error: `The project is halted: ${project.halted}` };
  if (st === 'running') return { error: 'A stage is running; wait for it to finish.' };
  const notes = choiceNotes(merged);
  return { steps: st === 'waiting' ? ['approve', 'go'] : ['go'], notes, count: keep.length };
}

// which file plays a moment (a path inside the project): the rough, the proxy of a recording, else the file itself
// m.src: "rough", a file relative to video/ ("out/final.mp4", "footage/rec1.mkv"), or a source key of the edit list ("r1")
// proxies: the /api/projects/:id/proxy answer ({ sources: { key: { proxy } } } or { key: { proxy } }); edl: the edit list
const slashes = (s) => String(s).split(String.fromCharCode(92)).join('/').replace(/^\.?\//, '');
export function previewFile(m, { proxies, edl, hasRough } = {}) {
  const src = slashes(m.src || 'rough').replace(/^video\//, '');
  if (src === 'rough') return hasRough === false ? null : 'video/out/rough.mp4';
  const map = proxies?.sources || proxies || {};
  if (map[src]?.proxy) return map[src].proxy;
  const sources = edl?.sources || {};
  const fileOf = (k) => slashes(sources[k]?.file ?? sources[k] ?? '');
  const key = sources[src] ? src : Object.keys(sources).find((k) => fileOf(k) === src);
  if (key && map[key]?.proxy) return map[key].proxy;
  if (key) return `video/${fileOf(key)}`;
  return /[./]/.test(src) ? `video/${src}` : null;
}

// the picks file with the user's choices written in: chosen true for a kept one, false otherwise, and the note. null when nothing changes.
export function withChoices(doc, merged) {
  if (!doc || Array.isArray(doc) || !Array.isArray(doc.picks)) return null;
  const by = new Map(merged.map((m) => [m.id, m]));
  let changed = false;
  const picks = doc.picks.map((p, i) => {
    const m = by.get(String(p?.id ?? `s${i + 1}`));
    if (!m || !p || typeof p !== 'object') return p;
    const chosen = m.status === 'keep';
    const note = m.note || undefined;
    if (p.chosen === chosen && (p.note || undefined) === note) return p;
    changed = true;
    const out = { ...p, chosen };
    if (note) out.note = note; else delete out.note;
    return out;
  });
  return changed ? { ...doc, picks } : null;
}

// a moment's play window, clamped to the file: { from, to } in seconds
export function playWindow(m, duration) {
  const d = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  const from = Math.max(0, Math.min(m.from ?? 0, d));
  const to = Math.max(from + 0.1, Math.min(m.to ?? from + 30, d));
  return { from, to };
}

export function counts(merged) {
  return { all: merged.length, keep: merged.filter((m) => m.status === 'keep').length, drop: merged.filter((m) => m.status === 'drop').length };
}
