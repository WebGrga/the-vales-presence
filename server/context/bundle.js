// Skills and skill sets as one JSON file to share (bundle.test.js), pure: build one, check one that came from outside,
// rename a skill inside its text. A file:
//   { format: 'presence-craft', version: 1, kind: 'skill', skills: [{ name, text }] }
//   { format: 'presence-craft', version: 1, kind: 'set', set: { name, lists }, skills: [{ name, text }] }
// Skill texts are included for every skill that is the user's own or changed; shipped, unchanged ones go by name only.
import { SKILL_NAME, MAX_TEXT, checkText, frontmatter, checkName } from './text.js';
import { cleanLists, cleanName } from './sets.js';

export const FORMAT = 'presence-craft';
export const MAX_SKILLS = 100;
export const MAX_FILE = 4_000_000; // characters of one import

export const skillBundle = (skills) => ({ format: FORMAT, version: 1, kind: 'skill', skills: skills.map(({ name, text }) => ({ name, text })) });
export const setBundle = (set, skills) => ({ format: FORMAT, version: 1, kind: 'set', set: { name: set.name, lists: set.lists }, skills: skills.map(({ name, text }) => ({ name, text })) });

// the text of a skill under another name (its header's name line)
export function renameSkillText(text, name) {
  const t = String(text ?? '').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---[ \t]*(\n|$)/.exec(t);
  if (!m) return t;
  const head = /^name:.*$/m.test(m[1]) ? m[1].replace(/^name:.*$/m, `name: ${name}`) : `name: ${name}\n${m[1]}`;
  return `---\n${head}\n---${m[2]}` + t.slice(m[0].length);
}
// a set's lists with one skill name changed to another
export const renameIn = (lists, from, to) => Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.map((x) => (x === from ? to : x))]));

// a file from outside -> { ok, kind, skills: [{name, text}], set?: {name, lists} } or { error } in plain words. Nothing is trusted.
export function validateBundle(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { error: 'this is not a skills file' };
  if (b.format !== FORMAT) return { error: 'this file is not a skill or skill set made by this app' };
  if (b.version !== 1) return { error: 'this file comes from a newer version of the app' };
  if (b.kind !== 'skill' && b.kind !== 'set') return { error: 'this file holds neither a skill nor a set' };
  if (!Array.isArray(b.skills) || b.skills.length > MAX_SKILLS) return { error: `a file holds at most ${MAX_SKILLS} skills` };
  const skills = [], seen = new Set();
  for (const s of b.skills) {
    if (!s || typeof s !== 'object') return { error: 'a skill in the file is not readable' };
    const n = checkName(s.name);
    if (n.error || String(s.name) !== n.name) return { error: `the skill name "${String(s.name).slice(0, 40)}" is not a valid name (3 to 64 letters, digits and dashes)` };
    if (seen.has(n.name)) return { error: `the skill ${n.name} is in the file twice` };
    seen.add(n.name);
    const bad = checkText('skill', s.text);
    if (bad) return { error: `${n.name}: ${bad}` };
    if (frontmatter(s.text).fields.name !== n.name) return { error: `${n.name}: the header name does not match` };
    skills.push({ name: n.name, text: s.text });
  }
  if (b.kind === 'skill') return skills.length === 1 ? { ok: true, kind: 'skill', skills } : { error: 'a skill file holds exactly one skill' };
  const name = cleanName(b.set?.name);
  if (!name) return { error: 'the set in the file has no name' };
  if (!b.set.lists || typeof b.set.lists !== 'object' || Array.isArray(b.set.lists)) return { error: 'the set in the file has no lists' };
  const lists = cleanLists(b.set.lists);
  if (JSON.stringify(b.set.lists).length > MAX_TEXT) return { error: 'the set is too large' };
  return { ok: true, kind: 'set', set: { name, lists }, skills };
}

// the parts of a file that clash with what is already here: skills whose text differs, and a set of the same name
export function clashes(v, haveSkill, haveSetNames) {
  const skills = v.skills.filter((s) => { const t = haveSkill(s.name); return t != null && t.replace(/\r\n/g, '\n') !== s.text.replace(/\r\n/g, '\n'); }).map((s) => s.name);
  const set = v.kind === 'set' && haveSetNames.some((n) => n.toLowerCase() === v.set.name.toLowerCase());
  return { skills, set };
}
