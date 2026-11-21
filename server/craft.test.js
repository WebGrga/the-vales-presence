import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pickSkills, mergeMaps, cleanRecipe, describe, createCraft } from './craft.js';
import { stagePrompt, answerPrompt } from './prompt.js';

// every temp folder a test makes is removed when the file's tests end
const made = [];
const track = (d) => { made.push(d); return d; };
after(() => { for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

test('pickSkills: recipe/stage wins over stage; bad names dropped', () => {
  const m = { rough: ['a', 'b'], 'short/rough': ['c'], visuals: ['../x', 'd', 'd'] };
  assert.deepEqual(pickSkills(m, 'edit', 'rough'), ['a', 'b']);
  assert.deepEqual(pickSkills(m, 'short', 'rough'), ['c']);
  assert.deepEqual(pickSkills(m, 'edit', 'visuals'), ['d']);
  assert.deepEqual(pickSkills(m, 'edit', 'none'), []);
  assert.deepEqual(pickSkills(mergeMaps(m, { rough: [] }), 'edit', 'rough'), []);
});

test('cleanRecipe and describe', () => {
  const kinds = { make: {}, gate: {} };
  assert.ok(cleanRecipe({ id: 'r', stages: [{ id: 'a', kind: 'make' }] }, kinds));
  assert.equal(cleanRecipe({ id: 'r', stages: [{ id: 'a', kind: 'dance' }] }, kinds), null);
  assert.equal(cleanRecipe({ id: 'r', stages: [{ id: 'a', kind: 'make' }, { id: 'a', kind: 'gate' }] }, kinds), null);
  assert.equal(cleanRecipe({ id: '../r', stages: [{ id: 'a', kind: 'make' }] }, kinds), null);
  assert.equal(describe('---\nname: x\ndescription: "Cut the talk."\n---\n# X'), 'Cut the talk.');
  assert.equal(describe('# Title\n\ntext'), 'Title');
});

test('createCraft reads data/craft over craft/', () => {
  const root = track(fs.mkdtempSync(path.join(os.tmpdir(), 'presence-craft-'))), data = path.join(root, 'data');
  const w = (rel, text) => { const f = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  w('craft/stages.json', JSON.stringify({ make: { instruction: 'Do it.' }, gate: {} }));
  w('craft/recipes/r.json', JSON.stringify({ id: 'r', name: 'R', stages: [{ id: 'm', kind: 'make' }] }));
  w('data/craft/recipes/r2.json', JSON.stringify({ id: 'r2', stages: [{ id: 'g', kind: 'gate' }] }));
  w('craft/stage-skills.json', JSON.stringify({ m: ['s1', 's2', 'gone'] }));
  w('craft/skills/s1/SKILL.md', '---\ndescription: one\n---\n');
  w('craft/skills/s2/SKILL.md', 'two');
  w('data/craft/skills/s2/SKILL.md', '# mine');
  w('craft/house-rules.md', 'shipped rules');
  const c = createCraft({ root, dataDir: data });
  assert.deepEqual(Object.keys(c.recipes()).sort(), ['r', 'r2']);
  const s = c.skillsFor('r', 'm');
  assert.deepEqual(s.skills.map((x) => [x.name, x.about]), [['s1', 'one'], ['s2', 'mine']]);
  assert.ok(s.skills[1].file.includes(path.join('data', 'craft')));
  assert.deepEqual(s.missing, ['gone']);
  assert.equal(c.houseRules().text, 'shipped rules');
  w('data/craft/house-rules.md', 'my rules');
  assert.equal(c.houseRules().text, 'my rules');
  // the old single override file is migrated into the set "My set" on first read, and still counts
  w('data2/craft/stage-skills.json', JSON.stringify({ m: ['s1'] }));
  const c2 = createCraft({ root, dataDir: path.join(root, 'data2') });
  assert.deepEqual(c2.skillsFor('r', 'm').skills.map((x) => x.name), ['s1']);
  assert.deepEqual(c2.sets.all().map((x) => x.name), ['Default', 'My set']);
  assert.equal(c2.sets.defaultId(), 'my-set');
  assert.deepEqual(c.skillsFor('r', 'm').skills.map((x) => x.name), ['s1', 's2']); // another data folder: untouched
});

test('the stage prompt has every part it should', () => {
  const recipe = { id: 'edit', name: 'Edit', stages: [{ id: 'ask', kind: 'ask' }, { id: 'rough', kind: 'make', title: 'Rough cut', focus: 'Cut the rough.', out: ['video/out/edl.json'] }] };
  const p = stagePrompt({ recipe, stage: recipe.stages[1], index: 1, kind: { instruction: 'Make things.' }, projectDir: '/d/p', root: '/repo',
    skills: [{ name: 'cut-x', file: '/repo/craft/skills/cut-x/SKILL.md', about: 'cuts' }], missing: ['y'], houseRules: 'Rule one.', houseRulesFile: '/d/craft/house-rules.md',
    brief: 'A brief.', sentBack: 'tighter', approved: '', lock: 'Locked: a', footage: ['rec1.mkv'] });
  for (const s of ['Stage 2 of 2: Rough cut (make)', 'ask > [rough]', 'Make things.', 'Cut the rough.', 'Sent back to you', 'tighter', '/d/p/video', '/repo/engine/<script>.py', 'video/out/edl.json',
    'cut-x: /repo/craft/skills/cut-x/SKILL.md (cuts)', 'not found: y', 'Rule one.', '/d/craft/house-rules.md', 'A brief.', 'Locked: a', 'video/footage/rec1.mkv', 'run_in_background', 'Never upload']) assert.ok(p.includes(s), s);
  assert.ok(!p.includes('Notes the user left'));
  assert.match(answerPrompt(' yes '), /The user answers:\n\nyes\n\nContinue the stage\./);
});
