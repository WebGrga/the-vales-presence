// The scan: every file the agent's context is made of, found on disk. This is the only place a context item becomes
// a path: the routes take an id and look it up here, never a path from a request. Shipped defaults are in craft/,
// the user's own versions in data/craft/ (same relative path), the brief in the project, the user's personal
// Claude Code instructions in ~/.claude/CLAUDE.md (read only here). scan.test.js runs it on a temporary folder.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { wordCount, frontmatter, SKILL_NAME } from './text.js';
import { createSets } from './sets.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
export const USER_KINDS = ['gate', 'record', 'options', 'upload', 'export']; // stages the user does, when stages.json does not say `who`

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function readText(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return null;
    return { text: fs.readFileSync(file, 'utf8'), mtime: Math.round(st.mtimeMs) };
  } catch { return null; }
}
const exists = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
const dirs = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } };

// where a file is kept, as the user reads it: relative to the app, or ~ for the home folder; forward slashes
export function shown(file, { root, home }) {
  const rel = path.relative(root, file);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) return rel.split(path.sep).join('/');
  const h = path.relative(home, file);
  if (!h.startsWith('..') && !path.isAbsolute(h)) return '~/' + h.split(path.sep).join('/');
  return path.basename(file);
}

export function paths(o) {
  const root = o.root, dataDir = o.dataDir || path.join(root, 'data'), home = o.home || os.homedir();
  return {
    root, dataDir, home,
    craft: path.join(root, 'craft'), mine: path.join(dataDir, 'craft'),
    backups: path.join(dataDir, 'backups'), drafts: path.join(dataDir, 'context', 'drafts.json'),
    projects: path.join(dataDir, 'projects'),
  };
}

// recipes: craft/recipes/*.json, by id
export function recipes(P) {
  const out = {};
  const files = [];
  for (const dir of [P.craft, P.mine]) { // the user's recipes replace shipped ones with the same id
    try { for (const f of fs.readdirSync(path.join(dir, 'recipes')).filter((x) => x.endsWith('.json')).sort()) files.push(path.join(dir, 'recipes', f)); } catch {}
  }
  for (const file of files) {
    const f = path.basename(file), r = readJson(file, null);
    const id = r?.id || f.replace(/\.json$/, '');
    if (!r || !SAFE_ID.test(id) || !Array.isArray(r.stages)) continue;
    out[id] = { id, name: String(r.name || id), about: String(r.about || ''), stages: r.stages.filter((s) => s && SAFE_ID.test(String(s.id))).map((s) => ({ id: String(s.id), kind: String(s.kind || 'make'), title: String(s.title || s.id), focus: typeof s.focus === 'string' ? s.focus : '' })) };
  }
  return out;
}

// the generic instruction of a stage kind in craft/stages.json, whatever its exact shape
export function kindText(doc, kind) {
  const v = doc?.kinds?.[kind] ?? doc?.[kind];
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.join('\n');
  if (v && typeof v === 'object') return String(v.instruction ?? v.text ?? v.instructions ?? v.prompt ?? '');
  return '';
}

// a project by id, only one that is really in data/projects
export function project(P, id) {
  if (!id || !SAFE_ID.test(String(id))) return null;
  const dir = path.join(P.projects, String(id)), pj = readJson(path.join(dir, 'project.json'), null);
  return pj ? { id: String(id), dir, title: String(pj.title || id), recipe: String(pj.recipe || ''), skillSet: typeof pj.skillSet === 'string' ? pj.skillSet : null, at: pj.at || null, stages: pj.stages || {} } : null;
}

// one shipped-or-mine item: the shipped file, the user's file, which one the agent reads
function layered(P, rel, base) {
  const shippedF = path.join(P.craft, rel), mineF = path.join(P.mine, rel);
  const s = readText(shippedF), m = readText(mineF), eff = m || s;
  const same = !!(m && s && m.text.replace(/\r\n/g, '\n') === s.text.replace(/\r\n/g, '\n')); // a copy not changed yet
  return {
    ...base,
    shipped: s ? shippedF : null, mine: m ? mineF : null, file: m ? mineF : s ? shippedF : null,
    target: mineF, // where a save goes
    kept: shown(m ? mineF : shippedF, P), mtime: eff?.mtime ?? null, words: wordCount(eff?.text),
    text: eff?.text ?? '',
    state: same ? 'shipped' : m && s ? 'changed' : m ? 'yours' : s ? 'shipped' : 'missing',
    editable: true, canReset: !!(m && s && !same), canRemove: !!(m && !s),
  };
}

// every skill: shipped ones in craft/skills, the user's in data/craft/skills (same name = the user's version)
function skills(P) {
  const names = new Set([...dirs(path.join(P.craft, 'skills')), ...dirs(path.join(P.mine, 'skills'))].filter((n) => SKILL_NAME.test(n)));
  const out = {};
  for (const name of [...names].sort()) {
    const it = layered(P, path.join('skills', name, 'SKILL.md'), { id: 'skill:' + name, kind: 'skill', name, label: name });
    if (it.state === 'missing') continue;
    it.description = frontmatter(it.text).fields.description || '';
    out[it.id] = it;
  }
  return out;
}

// the whole scan for one recipe (and the open project, if any)
export function scan(o) {
  const P = paths(o), all = recipes(P), proj = project(P, o.projectId);
  const recipeId = all[o.recipeId] ? o.recipeId : all[proj?.recipe] ? proj.recipe : Object.keys(all)[0] || null;
  const recipe = recipeId ? all[recipeId] : null;
  const items = {};

  items.claude = layered(P, 'CLAUDE.md', { id: 'claude', kind: 'claude', label: 'CLAUDE.md', description: "The agent's standing instructions: who it is and how it works." });
  items.rules = layered(P, 'house-rules.md', { id: 'rules', kind: 'rules', label: 'House rules', description: 'How you cut, the tools that work here, and the lessons learned from your corrections.' });

  const homeF = path.join(P.home, '.claude', 'CLAUDE.md'), h = readText(homeF);
  if (h) items.home = { id: 'home', kind: 'home', label: 'Your Claude Code instructions', description: 'Your own CLAUDE.md, which Claude Code reads in every session on this computer.', file: homeF, kept: shown(homeF, P), mtime: h.mtime, words: wordCount(h.text), text: h.text, state: 'outside', editable: false, why: 'This file belongs to your Claude Code setup, not to this app. Change it in Claude Code or a text editor.' };

  if (proj) {
    const bf = path.join(proj.dir, 'brief.md'), b = readText(bf);
    items.brief = { id: 'brief', kind: 'brief', label: 'The brief', description: `What you want from "${proj.title}".`, file: b ? bf : null, target: bf, kept: shown(bf, P), mtime: b?.mtime ?? null, words: wordCount(b?.text), text: b?.text ?? '', state: b ? 'project' : 'missing', editable: true };
  } else {
    items.brief = { id: 'brief', kind: 'brief', label: 'The brief', description: 'Each project has its own brief, written at the ask stage. Open a project to see it.', file: null, kept: 'data/projects/<project>/brief.md', mtime: null, words: 0, text: '', state: 'missing', editable: false, why: 'Open a project to read its brief.' };
  }

  const stagesDoc = { ...readJson(path.join(P.craft, 'stages.json'), {}), ...readJson(path.join(P.mine, 'stages.json'), {}) };
  for (const st of recipe?.stages || []) {
    const who = (stagesDoc?.kinds?.[st.kind] ?? stagesDoc?.[st.kind])?.who;
    st.agent = who ? who === 'agent' : !USER_KINDS.includes(st.kind);
    const text = [kindText(stagesDoc, st.kind), st.focus].filter(Boolean).join('\n\n');
    items['stage:' + st.id] = { id: 'stage:' + st.id, kind: 'stage', label: `${st.title}: instructions`, description: `What the ${st.kind} stage is told, from the stage kinds and the recipe.`, file: null, kept: `craft/stages.json + craft/recipes/${recipeId}.json`, mtime: null, words: wordCount(text), text, state: 'shipped', editable: false, why: 'Stage instructions ship with the app. Put your own way of working in the house rules or a skill: the agent reads those at every stage.' };
  }

  Object.assign(items, skills(P));
  const sets = createSets({ ship: P.craft, dataDir: P.dataDir });
  const setId = sets.resolve(proj?.skillSet), cur = sets.read(setId), used = sets.usage();
  const skillSet = { id: setId, name: cur.name, builtin: cur.builtin, projects: used[setId] || 0, own: !!(proj?.skillSet && sets.read(proj.skillSet)), isDefault: setId === sets.defaultId() };
  return {
    sets, skillSet, setList: sets.all().map((x) => ({ id: x.id, name: x.name, builtin: x.builtin, projects: used[x.id] || 0, isDefault: x.id === sets.defaultId() })),
    P, recipe, recipes: Object.values(all).map((r) => ({ id: r.id, name: r.name })), project: proj ? { id: proj.id, title: proj.title, recipe: proj.recipe, at: proj.at, stages: proj.stages } : null,
    shippedSkills: readJson(path.join(P.craft, 'stage-skills.json'), {}),
    mineSkills: cur.lists,
    items,
  };
}

export const isFile = exists;
