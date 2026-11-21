// The Context room's writes. Every write finds its file through the scan (an id, never a path from a request), keeps
// the day's first version of a file in data/backups/<day>/ before it changes it, and answers { ok, ... } or
// { error: 'plain words' } (or { conflict, mtime } when the file changed since it was read). The user's changes go to
// data/craft/; craft/ is the shipped default and is never written. store.test.js runs it on a temporary folder.
import fs from 'node:fs';
import path from 'node:path';
import { scan, shown, readJson } from './scan.js';
import { checkText, newSkillText, wordCount } from './text.js';
import { toggle, resetStage, dropSkill } from './stage-skills.js';
import { bump } from './lessons.js';

const day = (t) => new Date(t).toLocaleDateString('sv-SE'); // YYYY-MM-DD, local

export function writeFileAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
const writeJson = (file, obj) => writeFileAtomic(file, JSON.stringify(obj, null, 2) + '\n');

// the day's first version of a file; later saves that day leave it. null = fine, else why nothing may be written
export function backup(P, file, now = Date.now()) {
  try {
    if (!fs.existsSync(file)) return null;
    const name = shown(file, P).replace(/^~\//, 'home/').replace(/[^A-Za-z0-9._-]+/g, '__').slice(-180);
    const dest = path.join(P.backups, day(now), name);
    if (fs.existsSync(dest)) return null;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file, dest, fs.constants.COPYFILE_EXCL);
    return null;
  } catch (e) { return 'a backup could not be made, so nothing was written (' + e.message + ')'; }
}

const NOT_HERE = 'that item is not in the context any more: reload the tab';

// GET a node with its text (and the user's unsaved draft, if any)
export function readNode(o, id) {
  const s = scan(o), it = s.items[String(id)];
  if (!it) return { error: NOT_HERE };
  const draft = readJson(s.P.drafts, {})[draftKey(id, s.project?.id)] || null;
  const { file, target, shipped, mine, ...rest } = it;
  return { ok: true, node: { ...rest, words: wordCount(it.text) }, draft: draft && draft.text !== it.text ? draft : null };
}

// POST save: the whole text of one item
export function saveNode(o, { id, text, baseMtime, force }) {
  const s = scan(o), it = s.items[String(id)];
  if (!it) return { error: NOT_HERE };
  if (!it.editable || !it.target) return { error: it.why || 'this cannot be changed here' };
  const bad = checkText(it.kind, text);
  if (bad) return { error: bad };
  if (it.mtime != null && it.mtime !== baseMtime && force !== true) return { conflict: true, mtime: it.mtime, text: it.text };
  if (it.kind === 'brief' && !fs.existsSync(path.dirname(it.target))) return { error: 'the project folder is gone' };
  const no = backup(s.P, it.target, o.now?.());
  if (no) return { error: no };
  writeFileAtomic(it.target, text);
  clearDraft(s.P, draftKey(id, s.project?.id));
  const after = readNode(o, id);
  return { ok: true, node: after.node };
}

// POST reset: the user's version goes (backed up), the shipped one is read again
export function resetNode(o, { id }) {
  const s = scan(o), it = s.items[String(id)];
  if (!it) return { error: NOT_HERE };
  if (!it.mine) return { error: 'this is already the shipped version' };
  if (!it.shipped && it.kind !== 'skill') return { error: 'there is no shipped version to go back to' };
  const no = backup(s.P, it.mine, o.now?.());
  if (no) return { error: no };
  fs.rmSync(it.mine);
  try { fs.rmdirSync(path.dirname(it.mine)); } catch {} // a skill folder left empty
  if (!it.shipped && it.kind === 'skill') { // the user's own skill is removed: it comes off their stage lists too
    writeJson(path.join(s.P.mine, 'stage-skills.json'), dropSkill(s.mineSkills, it.name));
  }
  clearDraft(s.P, draftKey(id, s.project?.id));
  return { ok: true, removed: !it.shipped };
}

// POST new skill: data/craft/skills/<name>/SKILL.md, optionally switched on for one stage
export function newSkill(o, { name, description, text, stage }) {
  const r = newSkillText({ name, description, text });
  if (r.error) return r;
  const s = scan(o);
  if (s.items['skill:' + r.name]) return { error: `there is already a skill called ${r.name}` };
  if (stage && !(s.recipe?.stages || []).some((x) => x.id === stage)) return { error: 'that stage is not in this recipe' };
  const file = path.join(s.P.mine, 'skills', r.name, 'SKILL.md');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, r.text, { flag: 'wx' });
  } catch (e) { return { error: 'the skill could not be made: ' + e.message }; }
  if (stage) writeJson(path.join(s.P.mine, 'stage-skills.json'), toggle(s.shippedSkills, s.mineSkills, s.recipe.id, stage, r.name, true));
  clearDraft(s.P, NEW_SKILL);
  return { ok: true, id: 'skill:' + r.name };
}

// POST toggle: one skill on or off for one stage of the open recipe
export function toggleSkill(o, { stage, skill, on }) {
  const s = scan(o);
  if (!s.recipe) return { error: 'there is no recipe to change' };
  if (!s.recipe.stages.some((x) => x.id === stage)) return { error: 'that stage is not in this recipe' };
  const name = String(skill ?? '');
  if (on && !s.items['skill:' + name]) return { error: `there is no skill called ${name}` };
  const f = path.join(s.P.mine, 'stage-skills.json');
  const no = backup(s.P, f, o.now?.());
  if (no) return { error: no };
  writeJson(f, toggle(s.shippedSkills, s.mineSkills, s.recipe.id, stage, name, !!on));
  return { ok: true };
}

// POST reset a stage's skills to the shipped list
export function resetStageSkills(o, { stage }) {
  const s = scan(o);
  if (!s.recipe?.stages.some((x) => x.id === stage)) return { error: 'that stage is not in this recipe' };
  const f = path.join(s.P.mine, 'stage-skills.json');
  const no = backup(s.P, f, o.now?.());
  if (no) return { error: no };
  writeJson(f, resetStage(s.mineSkills, s.recipe.id, stage));
  return { ok: true };
}

// POST a lesson held up (kept) or was wrong (against): the book is written to the user's copy
export function countLesson(o, { lesson, field }) {
  const s = scan(o), it = s.items.rules;
  const r = bump(it.text, String(lesson ?? ''), field);
  if (r.error) return r;
  const no = backup(s.P, it.target, o.now?.());
  if (no) return { error: no };
  writeFileAtomic(it.target, r.md);
  return { ok: true, lesson: r.lesson };
}

// ---- drafts: typed text is kept on the server at once, so a reload never loses it ----
export const draftKey = (id, projectId) => (id === 'brief' ? `brief:${projectId || ''}` : String(id));
function clearDraft(P, key) {
  const all = readJson(P.drafts, {});
  if (!(key in all)) return;
  delete all[key];
  writeJson(P.drafts, all);
}
// 'new-skill' is the new-skill form (its text is the form as JSON), kept the same way
export const NEW_SKILL = 'new-skill';
export function saveDraft(o, { id, text, baseMtime }) {
  const s = scan(o), it = id === NEW_SKILL ? { editable: true, text: '' } : s.items[String(id)];
  if (!it || !it.editable) return { error: NOT_HERE };
  const key = draftKey(id, s.project?.id), all = readJson(s.P.drafts, {});
  if (text == null || text === it.text) delete all[key];
  else {
    if (typeof text !== 'string' || text.length > 200_000) return { error: 'the draft is too long' };
    all[key] = { text, baseMtime: baseMtime ?? null, at: Date.now() };
  }
  writeJson(s.P.drafts, all);
  return { ok: true };
}

export function readDraft(o, id) {
  const s = scan(o);
  return { ok: true, draft: readJson(s.P.drafts, {})[draftKey(String(id ?? ''), s.project?.id)] || null };
}
