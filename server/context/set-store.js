// The Context room's writes for skill sets, duplicated skills and import/export (set-store.test.js). Same rules as
// store.js: ids through the scan, the day's first backup, plain-words errors, user changes only in data/craft/.
import fs from 'node:fs';
import path from 'node:path';
import { scan } from './scan.js';
import { backup, writeFileAtomic } from './store.js';
import { checkName, checkText } from './text.js';
import { setProjectSet, listDiff } from './sets.js';
import { skillBundle, setBundle, renameSkillText, renameIn, validateBundle, clashes } from './bundle.js';

const same = (a, b) => String(a).replace(/\r\n/g, '\n') === String(b).replace(/\r\n/g, '\n');

// a stage of the open recipe, or the Studio's own turns
export const hasStage = (recipe, stage) => stage === 'studio' || !!recipe?.stages.some((x) => x.id === stage);

// change the lists of the set the open project uses. The shipped Default is never written: the first change makes
// "My set" from it, and the project (when it picked a set itself) or else the user's default moves to it.
// fn(lists) -> new lists. -> { ok, forked: { id, name } | null } or { error }
export function editSet(o, s, fn) {
  let id = s.skillSet.id, forked = null;
  if (s.skillSet.builtin) {
    const made = s.sets.create('My set', {});
    id = made.id; forked = { id: made.id, name: made.name };
    if (s.skillSet.own) setProjectSet(s.P.projects, s.project.id, id);
    else s.sets.setDefault(id);
  }
  const no = backup(s.P, s.sets.fileOf(id), o.now?.());
  if (no) return { error: no };
  const r = s.sets.save(id, fn(s.sets.read(id).lists));
  return r.error ? r : { ok: true, forked };
}

export function newSet(o, { name, from }) {
  const s = scan(o), src = from ? s.sets.read(String(from)) : s.sets.read(s.skillSet.id);
  if (!src) return { error: 'there is no such set to start from' };
  const nm = String(name ?? '').trim();
  if (nm && s.sets.all().some((x) => x.name.toLowerCase() === nm.toLowerCase())) return { error: `there is already a set called ${nm}: pick another name` };
  const made = s.sets.create(name || (src.builtin ? 'My set' : src.name + ' copy'), src.lists);
  return { ok: true, set: made.id };
}
export function duplicateSet(o, { set }) {
  const src = scan(o).sets.read(String(set ?? ''));
  return src ? newSet(o, { name: src.name + ' copy', from: src.id }) : { error: 'there is no such set' };
}
export const renameSet = (o, { set, name }) => scan(o).sets.rename(String(set ?? ''), name);
export function deleteSet(o, { set }) {
  const s = scan(o), x = s.sets.read(String(set ?? ''));
  if (!x) return { error: 'there is no such set' };
  const no = backup(s.P, s.sets.fileOf(x.id), o.now?.());
  if (no) return { error: no };
  return s.sets.remove(x.id);
}
export const defaultSet = (o, { set }) => scan(o).sets.setDefault(String(set ?? ''));
// a project picks a set (null = the user's default)
export function useSet(o, { project, set }) {
  const s = scan(o);
  if (!s.project || s.project.id !== String(project)) return { error: 'that project is not here' };
  if (set && !s.sets.read(String(set))) return { error: 'there is no such set' };
  return setProjectSet(s.P.projects, s.project.id, set || null) ? { ok: true } : { error: 'the project could not be changed' };
}
// back to the shipped mapping: the set's own lists are all removed (a backup is kept)
export function resetSet(o, { set }) {
  const s = scan(o), x = s.sets.read(String(set ?? s.skillSet.id));
  if (!x || x.builtin) return { error: 'the Default set is already the shipped one' };
  const no = backup(s.P, s.sets.fileOf(x.id), o.now?.());
  if (no) return { error: no };
  return s.sets.save(x.id, {});
}
// every change against the shipped craft: the set's lists, and the skills and files changed or added
export function differs(o, setId) {
  const s = scan(o), x = s.sets.read(String(setId ?? '')) || s.sets.read(s.skillSet.id);
  const items = Object.values(s.items).filter((it) => it.state === 'changed' || (it.state === 'yours' && it.kind === 'skill'))
    .map((it) => ({ id: it.id, label: it.label, kind: it.kind, state: it.state }));
  return { ok: true, set: { id: x.id, name: x.name, builtin: x.builtin }, lists: listDiff(s.shippedSkills, x.lists), items };
}

// ---- duplicate a skill ----
export function duplicateSkill(o, { skill, name }) {
  const s = scan(o), it = s.items['skill:' + String(skill ?? '')];
  if (!it || it.kind !== 'skill') return { error: 'there is no such skill' };
  const n = checkName(name);
  if (n.error) return n;
  if (s.items['skill:' + n.name]) return { error: `there is already a skill called ${n.name}` };
  const text = renameSkillText(it.text, n.name), bad = checkText('skill', text);
  if (bad) return { error: bad };
  const file = path.join(s.P.mine, 'skills', n.name, 'SKILL.md');
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text, { flag: 'wx' }); } catch (e) { return { error: 'the copy could not be made: ' + e.message }; }
  return { ok: true, id: 'skill:' + n.name };
}

// ---- export and import ----
export function exportBundle(o, { kind, id }) {
  const s = scan(o);
  if (kind === 'skill') {
    const it = s.items['skill:' + String(id ?? '')];
    return it?.kind === 'skill' ? { ok: true, name: it.name, bundle: skillBundle([{ name: it.name, text: it.text }]) } : { error: 'there is no such skill' };
  }
  const x = s.sets.read(String(id ?? ''));
  if (!x) return { error: 'there is no such set' };
  const names = new Set(Object.values({ ...s.sets.shippedLists(), ...x.lists }).flat());
  const skills = [...names].map((n) => s.items['skill:' + n]).filter((it) => it && (it.state === 'yours' || it.state === 'changed')).map((it) => ({ name: it.name, text: it.text }));
  return { ok: true, name: x.name, bundle: setBundle({ name: x.name, lists: x.lists }, skills) };
}

// mode: none = ask when something would be overwritten; 'replace' = overwrite; 'keep' = keep both (the new ones get another name)
export function importBundle(o, { bundle, mode }) {
  const v = validateBundle(bundle);
  if (v.error) return v;
  if (mode && mode !== 'replace' && mode !== 'keep') return { error: 'unknown way to import' };
  const s = scan(o);
  const clash = clashes(v, (n) => s.items['skill:' + n]?.text ?? null, s.sets.all().map((x) => x.name));
  if ((clash.skills.length || clash.set) && !mode) return { conflict: true, skills: clash.skills, set: clash.set ? v.set.name : null };
  const rename = {};
  if (mode === 'keep') {
    for (const name of clash.skills) {
      let n = 2;
      while (s.items[`skill:${name}-${n}`] || v.skills.some((q) => q.name === `${name}-${n}`)) n++;
      rename[name] = `${name}-${n}`;
    }
  }
  let written = 0;
  for (const sk of v.skills) {
    const name = rename[sk.name] || sk.name, have = s.items['skill:' + name];
    if (have && same(have.text, sk.text)) continue;
    const file = path.join(s.P.mine, 'skills', name, 'SKILL.md');
    const no = backup(s.P, file, o.now?.());
    if (no) return { error: no };
    writeFileAtomic(file, rename[sk.name] ? renameSkillText(sk.text, name) : sk.text);
    written++;
  }
  let setId = null;
  if (v.kind === 'set') {
    let lists = v.set.lists;
    for (const [from, to] of Object.entries(rename)) lists = renameIn(lists, from, to);
    const old = s.sets.all().find((x) => x.name.toLowerCase() === v.set.name.toLowerCase() && !x.builtin);
    if (old && mode === 'replace') {
      const no = backup(s.P, s.sets.fileOf(old.id), o.now?.());
      if (no) return { error: no };
      s.sets.save(old.id, lists); setId = old.id;
    } else setId = s.sets.create(v.set.name, lists).id; // a free name is kept; a taken one gets "2"
  }
  return { ok: true, kind: v.kind, skills: written, set: setId, renamed: rename };
}
