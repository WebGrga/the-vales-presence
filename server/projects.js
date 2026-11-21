// Projects on disk: data/projects/<id>/project.json (written atomically), the folders a project has, its log.
// Every change goes through save() or update(), which broadcast { type: 'project', project: id, data: project.json }.
import fs from 'node:fs';
import path from 'node:path';
import { initStages, normalize } from './stages.js';
import { createCraft } from './craft.js';
import { topicText, TOPIC_FILE } from './project-brief.js';

export const FOLDERS = ['video/footage', 'video/out', 'studio', '.presence'];

// pure: a project id from a title
export function slugify(title) {
  const s = String(title || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
  return s || 'project';
}
// pure: the id not taken yet
export function uniqueId(base, taken) {
  const t = new Set(taken);
  if (!t.has(base)) return base;
  for (let n = 2; ; n++) if (!t.has(`${base}-${n}`)) return `${base}-${n}`;
}
// pure: a new project.json
export function newProject({ id, title, recipe, now = Date.now() }) {
  const { at, stages } = initStages(recipe);
  return { id, title: String(title || id).slice(0, 200), recipe: recipe.id, created: new Date(now).toISOString(), at, stages };
}

// write a file atomically (a temp file renamed over it; Windows may refuse a rename while a reader has it open: retried)
export function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  fs.writeFileSync(tmp, text);
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      if (i >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { try { fs.rmSync(tmp, { force: true }); } catch {} throw e; }
      const until = Date.now() + 15 * (i + 1); while (Date.now() < until) { /* a short wait */ }
    }
  }
}
export const writeJsonAtomic = (file, val) => writeAtomic(file, JSON.stringify(val, null, 1) + '\n');

export function createProjects(ctx) {
  const craft = ctx.craft || (ctx.craft = createCraft(ctx));
  const base = path.join(ctx.dataDir, 'projects');
  const dir = (id) => ctx.projectDir(id);
  const fileOf = (id) => path.join(dir(id), 'project.json');

  function read(id) {
    try { return JSON.parse(fs.readFileSync(fileOf(id), 'utf8')); } catch { return null; }
  }
  // the project as stored, with any stage the recipe has filled in
  function get(id) {
    let p;
    try { p = read(id); } catch { return null; }
    if (!p) return null;
    const r = craft.recipe(p.recipe);
    return r ? normalize({ ...p, id }, r) : { ...p, id };
  }
  function list() {
    let ids = [];
    try { ids = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch {}
    return ids.map((id) => { try { return get(id); } catch { return null; } }).filter(Boolean)
      .sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
  }
  function save(p) {
    if (!p?.id) throw new Error('a project needs an id');
    p.updated = new Date().toISOString();
    writeJsonAtomic(fileOf(p.id), p);
    ctx.broadcast({ type: 'project', project: p.id, data: p });
    return p;
  }
  // read, change, write in one go (sync: nothing else runs between). fn returns the new project (or changes it in place).
  function update(id, fn) {
    const p = get(id);
    if (!p) throw Object.assign(new Error('no such project'), { status: 404 });
    const next = fn(p) || p;
    return save(next);
  }
  function create({ title, recipe, id, topic } = {}) {
    const r = craft.recipe(String(recipe || ''));
    if (!r) throw Object.assign(new Error(`no recipe "${recipe}"`), { status: 400 });
    if (!String(title || '').trim()) throw Object.assign(new Error('a project needs a title'), { status: 400 });
    let taken = [];
    try { taken = fs.readdirSync(base); } catch {}
    const pid = uniqueId(id ? slugify(id) : slugify(title), taken);
    const d = dir(pid);
    for (const f of FOLDERS) fs.mkdirSync(path.join(d, ...f.split('/')), { recursive: true });
    const idea = topicText(topic);
    if (idea) fs.writeFileSync(path.join(d, ...TOPIC_FILE), idea);
    return save(newProject({ id: pid, title: String(title).trim(), recipe: r }));
  }
  // one line in .presence/log.jsonl
  function log(id, entry) {
    try {
      const f = path.join(dir(id), '.presence', 'log.jsonl');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.appendFileSync(f, JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n');
    } catch (e) { ctx.log?.('log.jsonl', e.message); }
  }
  function readLog(id, max = 500) {
    try { return fs.readFileSync(path.join(dir(id), '.presence', 'log.jsonl'), 'utf8').split('\n').filter(Boolean).slice(-max).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
  }
  const exists = (id) => { try { return fs.existsSync(fileOf(id)); } catch { return false; } };
  const recipeOf = (p) => craft.recipe(p?.recipe);

  return { dir, get, list, save, update, create, log, readLog, exists, recipeOf, recipes: () => craft.recipes(), recipe: (id) => craft.recipe(id), craft };
}
