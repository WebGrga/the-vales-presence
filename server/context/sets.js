// Named skill sets (sets.test.js). A set is which skills each stage reads, saved as its own file in
// data/craft/skill-sets/<id>.json: { name, lists: { "<stage>" | "<recipe>/<stage>": [skill names] } }. A set's lists lie
// over the shipped mapping (craft/stage-skills.json), which is the built-in set "Default" and is never written. A
// project picks one in its project.json (`skillSet`); none = the user's default set (data/craft/skill-sets.json).
// The old single override file data/craft/stage-skills.json is migrated into a set named "My set" the first time sets
// are read (the old file is left where it is, untouched).
import fs from 'node:fs';
import path from 'node:path';
import { listOf, skillsFor } from './stage-skills.js';

export const DEFAULT_ID = 'default';
export const SET_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}(\/[A-Za-z0-9][A-Za-z0-9._-]{0,79})?$/;

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, o) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(o, null, 2) + '\n');
  fs.renameSync(tmp, f);
};

// ---- pure ----
export const cleanName = (n) => String(n ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
export const slug = (name) => String(name ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'set';
export function uniqueId(base, taken) {
  const t = new Set(taken);
  if (!t.has(base) && base !== DEFAULT_ID) return base;
  for (let n = 2; ; n++) if (!t.has(`${base}-${n}`)) return `${base}-${n}`;
}
export function uniqueName(base, takenNames) {
  const t = new Set(takenNames.map((x) => x.toLowerCase()));
  if (!t.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!t.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}
// lists a set may hold: valid keys, arrays of strings
export function cleanLists(lists) {
  const out = {};
  for (const [k, v] of Object.entries(listOf(lists))) {
    if (!KEY.test(k)) continue;
    out[k] = [...new Set(v.map(String).filter((x) => /^[a-z0-9][a-z0-9._-]{0,79}$/i.test(x)))];
  }
  return out;
}

// every list of a set that is not what the shipped mapping gives for it -> [{ key, shipped, now, added, removed }]
export function listDiff(shipped, lists) {
  const out = [];
  for (const [key, now] of Object.entries(listOf(lists))) {
    const [a, b] = key.includes('/') ? key.split('/') : [null, key];
    const base = skillsFor(shipped, {}, a || '', b).skills;
    const n = [...new Set(now)];
    if (base.length === n.length && base.every((x, i) => x === n[i])) continue;
    out.push({ key, recipe: a, stage: b, shipped: base, now: n, added: n.filter((x) => !base.includes(x)), removed: base.filter((x) => !n.includes(x)) });
  }
  return out.sort((x, y) => x.key.localeCompare(y.key));
}

// ---- the files ----
export function createSets({ ship, dataDir }) {
  const mine = path.join(dataDir, 'craft');
  const dir = path.join(mine, 'skill-sets'), prefsFile = path.join(mine, 'skill-sets.json'), legacy = path.join(mine, 'stage-skills.json');
  const fileOf = (id) => path.join(dir, id + '.json');
  const shippedLists = () => listOf(readJson(path.join(ship, 'stage-skills.json'), {}));

  // first read: the old single override becomes the set "My set" (and the user's default, so nothing changes for them)
  function ensure() {
    if (fs.existsSync(dir)) return;
    if (fs.existsSync(legacy)) {
      const lists = cleanLists(readJson(legacy, {}));
      writeJson(fileOf('my-set'), { name: 'My set', lists, migrated: true });
      writeJson(prefsFile, { default: 'my-set' });
    } else fs.mkdirSync(dir, { recursive: true });
  }
  function ids() { ensure(); try { return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter((i) => SET_ID.test(i) && i !== DEFAULT_ID); } catch { return []; } }
  function read(id) {
    if (id === DEFAULT_ID) return { id, name: 'Default', builtin: true, lists: {} };
    if (!SET_ID.test(String(id)) || !ids().includes(id)) return null;
    const d = readJson(fileOf(id), null);
    return d ? { id, name: cleanName(d.name) || id, builtin: false, lists: cleanLists(d.lists) } : null;
  }
  const all = () => [read(DEFAULT_ID), ...ids().map(read).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name))];
  function defaultId() { ensure(); const d = readJson(prefsFile, {}).default; return d && read(d) ? d : DEFAULT_ID; }
  // the set a project uses: its own pick if that set exists, else the user's default
  const resolve = (pick) => (pick && read(pick) ? pick : defaultId());
  const effective = (id) => ({ ...shippedLists(), ...(read(id)?.lists || {}) });

  function usage() { // { setId: number of projects }
    const out = {}, base = path.join(dataDir, 'projects');
    let names = [];
    try { names = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch {}
    for (const n of names) {
      const pj = readJson(path.join(base, n, 'project.json'), null);
      if (!pj) continue;
      const id = resolve(pj.skillSet);
      out[id] = (out[id] || 0) + 1;
    }
    return out;
  }

  function create(name, lists) {
    const cur = all(), nm = uniqueName(cleanName(name) || 'New set', cur.map((s) => s.name));
    const id = uniqueId(slug(nm), cur.map((s) => s.id));
    writeJson(fileOf(id), { name: nm, lists: cleanLists(lists) });
    return read(id);
  }
  function save(id, lists) {
    const s = read(id);
    if (!s || s.builtin) return { error: 'the Default set is the shipped one: make your own set to change skills' };
    writeJson(fileOf(id), { name: s.name, lists: cleanLists(lists) });
    return { ok: true };
  }
  function rename(id, name) {
    const s = read(id), nm = cleanName(name);
    if (!s || s.builtin) return { error: 'the Default set keeps its name' };
    if (!nm) return { error: 'give the set a name' };
    if (all().some((x) => x.id !== id && x.name.toLowerCase() === nm.toLowerCase())) return { error: `there is already a set called ${nm}` };
    writeJson(fileOf(id), { name: nm, lists: s.lists });
    return { ok: true };
  }
  function remove(id) {
    const s = read(id);
    if (!s || s.builtin) return { error: 'the Default set cannot be deleted' };
    const used = usage()[id] || 0;
    fs.rmSync(fileOf(id), { force: true });
    if (readJson(prefsFile, {}).default === id) writeJson(prefsFile, { default: DEFAULT_ID });
    return { ok: true, projects: used };
  }
  function setDefault(id) {
    if (!read(id)) return { error: 'there is no such set' };
    writeJson(prefsFile, { default: id });
    return { ok: true };
  }
  return { ensure, read, all, defaultId, resolve, effective, usage, create, save, rename, remove, setDefault, fileOf, shippedLists, dir };
}

// the project's set pick, written to its project.json (a read-modify-write; null = the user's default)
export function setProjectSet(projectsDir, projectId, setId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(String(projectId))) return false;
  const f = path.join(projectsDir, String(projectId), 'project.json'), pj = readJson(f, null);
  if (!pj) return false;
  if (setId) pj.skillSet = setId; else delete pj.skillSet;
  writeJson(f, pj);
  return true;
}
