// The Projects home's decisions (pure, no DOM; tested in home-logic.test.js): the status badge of a project, sorting,
// searching and filtering, the Pinned and Recent rows, "3 hours ago", and the same-name warning.

export const STATUS = {
  waiting: { label: 'Waiting for you', tone: 'ask', order: 0 },
  working: { label: 'Agent working', tone: 'work', order: 1 },
  queued: { label: 'Queued', tone: 'queue', order: 2 },
  stopped: { label: 'Stopped', tone: 'stop', order: 3 },
  ready: { label: 'Ready', tone: 'ready', order: 4 },
  finished: { label: 'Finished', tone: 'done', order: 5 },
};

// the project (from GET /api/projects, with its `view`) -> 'waiting' | 'working' | 'queued' | 'stopped' | 'ready' | 'finished'
export function statusOf(p) {
  const v = p?.view || {};
  if (v.halted || p?.halted) return 'stopped';
  if (v.done || p?.done) return 'finished';
  if (v.running) return 'working';
  if (v.queued) return 'queued';
  if (v.waiting) return 'waiting';
  return 'ready';
}
export const statusWords = (p) => STATUS[statusOf(p)].label;

const time = (s) => { const t = Date.parse(s); return Number.isFinite(t) ? t : 0; };
// the last time the project was opened or changed (ms)
export const touched = (p) => Math.max(time(p?.opened), time(p?.updated), time(p?.created));
const byName = (a, b) => String(a.title || a.id).localeCompare(String(b.title || b.id), undefined, { sensitivity: 'base', numeric: true });

export const SORTS = [['recent', 'Recent'], ['name', 'Name'], ['recipe', 'Recipe'], ['status', 'Status']];
// a new sorted list; pinned projects are not lifted here (the Pinned row shows them)
export function sortProjects(list, by = 'recent', recipeName = (id) => id) {
  const out = [...list];
  if (by === 'name') return out.sort(byName);
  if (by === 'recipe') return out.sort((a, b) => String(recipeName(a.recipe)).localeCompare(String(recipeName(b.recipe))) || byName(a, b));
  if (by === 'status') return out.sort((a, b) => STATUS[statusOf(a)].order - STATUS[statusOf(b)].order || touched(b) - touched(a) || byName(a, b));
  return out.sort((a, b) => touched(b) - touched(a) || byName(a, b));
}
// search words (every word must appear in the title, id or recipe name) and a recipe id ('' = all)
export function filterProjects(list, { q = '', recipe = '' } = {}, recipeName = (id) => id) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter((p) => {
    if (recipe && p.recipe !== recipe) return false;
    const hay = `${p.title || ''} ${p.id} ${recipeName(p.recipe)}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
// the Pinned row (all pinned, in name order) and the Recent row (opened projects that are not pinned, newest first, at most n)
export function rows(list, n = 5) {
  const pinned = list.filter((p) => p.pinned).sort(byName);
  const recent = list.filter((p) => !p.pinned && p.opened).sort((a, b) => time(b.opened) - time(a.opened)).slice(0, n);
  return { pinned, recent };
}

// "just now", "5 min ago", "3 h ago", "2 days ago", then a date
export function ago(iso, now = Date.now()) {
  const t = time(iso);
  if (!t) return '';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 14) { const d = Math.floor(s / 86400); return d === 1 ? '1 day ago' : `${d} days ago`; }
  return new Date(t).toISOString().slice(0, 10);
}
// another project already has this title (spaces and case ignored) -> it | null
export function sameTitle(list, title, selfId) {
  const k = (x) => String(x || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return k(title) ? (list || []).find((p) => p.id !== selfId && k(p.title) === k(title)) || null : null;
}
