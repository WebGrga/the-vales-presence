// What one stage of a recipe reads, for the agent's stage prompt (server/agent.js may call this; see
// the context room). It resolves every file through the scan: the user's version in
// data/craft/ first, the shipped one in craft/ second. The house rules book the agent writes lessons into is always the
// user's copy, data/craft/house-rules.md; it is made from the shipped starter the first time a stage asks for it, so the
// agent never writes into craft/. stage-context.test.js.
import fs from 'node:fs';
import path from 'node:path';
import { scan } from './scan.js';
import { skillsFor } from './stage-skills.js';

// the user's house rules file, made from the shipped starter if it is not there yet; returns its absolute path
export function houseRulesFile(o) {
  const s = scan(o), it = s.items.rules;
  if (!it.mine && it.shipped) {
    fs.mkdirSync(path.dirname(it.target), { recursive: true });
    try { fs.copyFileSync(it.shipped, it.target, fs.constants.COPYFILE_EXCL); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  return it.target;
}

// CLAUDE.md as the agent reads it: { file, text } (the user's version if they changed it)
export function claudeMd(o) {
  const it = scan(o).items.claude;
  return { file: it.file, text: it.text };
}

// o = { root, dataDir, home?, recipe, stage, projectId? }
// -> { skills: [{ name, description, file }], missing: [names], houseRules: { file, text }, claudeMd: { file, text }, brief, text }
// o.create === false: only look (the Context tab's preview); the house rules file is named but not made
export function stageContext(o) {
  const rulesFile = o.create === false ? scan(o).items.rules.target : houseRulesFile(o);
  const s = scan({ ...o, recipeId: o.recipe });
  const recipeId = s.recipe?.id || o.recipe;
  const names = skillsFor(s.shippedSkills, s.mineSkills, recipeId, o.stage).skills;
  const skills = [], missing = [];
  for (const n of names) {
    const it = s.items['skill:' + n];
    if (it) skills.push({ name: n, description: it.description, file: it.file });
    else missing.push(n);
  }
  const rules = { file: rulesFile, text: s.items.rules.text };
  const brief = s.items.brief?.file || null;
  return { skills, missing, houseRules: rules, claudeMd: { file: s.items.claude.file, text: s.items.claude.text }, brief, text: promptText({ skills, rules, brief }) };
}

// the stage prompt's context section, pure
export function promptText({ skills, rules, brief }) {
  const out = [];
  if (skills.length) {
    out.push('## Your skills for this stage\n\nRead each of these files before you start:\n' + skills.map((k) => `- ${k.name}: ${k.file}${k.description ? `\n  ${k.description}` : ''}`).join('\n'));
  }
  if (brief) out.push(`## The brief\n\n${brief}`);
  out.push(`## House rules\n\nThe book is ${rules.file}. Write lessons into that file (never into the app's craft folder). Its text now:\n\n${String(rules.text || '').trim() || '(empty)'}`);
  return out.join('\n\n');
}
