// The Bin, pure: names of binned folders and the small notes kept with them, and the rules for rename and duplicate.
// A binned project is the folder data/bin/<id>-<YYYYMMDD-HHMMSS>/ with data/bin/<id>-<stamp>.bin.json beside it
// ({ id, title, recipe, binned }). Restoring moves the folder back under its id, or the next free one.

const two = (n) => String(n).padStart(2, '0');
// pure: 20261121-093005 (UTC)
export function stamp(now = Date.now()) {
  const d = new Date(now);
  return `${d.getUTCFullYear()}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}-${two(d.getUTCHours())}${two(d.getUTCMinutes())}${two(d.getUTCSeconds())}`;
}
// pure: the folder a binned project goes to (a free name: a second bin in the same second gets -2)
export function binName(id, now = Date.now(), taken = []) {
  const base = `${id}-${stamp(now)}`, t = new Set(taken);
  if (!t.has(base)) return base;
  for (let n = 2; ; n++) if (!t.has(`${base}-${n}`)) return `${base}-${n}`;
}
// pure: 'my-video-20261121-093005' -> { id: 'my-video', stamp } | null
export function parseBinName(name) {
  const m = /^(.+?)-(\d{8}-\d{6})(?:-\d+)?$/.exec(String(name || ''));
  return m ? { id: m[1], stamp: m[2] } : null;
}
// pure: the note kept beside a binned folder
export const binNote = (p, now = Date.now()) => ({ id: p.id, title: p.title || p.id, recipe: p.recipe || '', binned: new Date(now).toISOString() });

// pure: a title for rename -> { title } | { error }
export function cleanTitle(t) {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return s ? { title: s } : { error: 'a project needs a title' };
}
// pure: another project (not `selfId`) already has this title (case and spacing ignored) -> that project | null
export function sameTitle(list, title, selfId) {
  const k = (x) => String(x || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return (list || []).find((p) => p.id !== selfId && k(p.title) === k(title)) || null;
}
// pure: the title of a copy: "X (copy)", then "X (copy 2)" ...
export function copyTitle(title, titles) {
  const t = new Set((titles || []).map((x) => String(x).toLowerCase()));
  const base = String(title || 'Project').replace(/ \(copy(?: \d+)?\)$/, '');
  let n = 1, c = `${base} (copy)`;
  while (t.has(c.toLowerCase())) c = `${base} (copy ${++n})`;
  return c;
}
// what a copy starts without: the progress and the running parts of the original
const PROGRESS = ['id', 'title', 'created', 'updated', 'at', 'stages', 'done', 'halted', 'lockBroken', 'chat', 'finished'];
// pure: the project.json of a copy: the same recipe and settings, every stage new
export function copyProject(p, { id, title, recipe, initStages, now = Date.now() }) {
  const keep = Object.fromEntries(Object.entries(p).filter(([k]) => !PROGRESS.includes(k)));
  const { at, stages } = initStages(recipe);
  return { ...keep, id, title, recipe: recipe.id, created: new Date(now).toISOString(), at, stages };
}
