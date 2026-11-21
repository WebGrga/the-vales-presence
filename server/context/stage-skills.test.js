import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { skillsFor, toggle, resetStage, dropSkill, stagesWithSkill } from './stage-skills.js';

const shipped = { about: 'x', rough: ['a', 'b'], 'short/rough': ['a', 'c'], visuals: ['v'] };

test('lookup order: mine recipe/stage, mine stage, shipped recipe/stage, shipped stage', () => {
  assert.deepEqual(skillsFor(shipped, {}, 'edit', 'rough'), { skills: ['a', 'b'], from: 'shipped', key: 'rough' });
  assert.deepEqual(skillsFor(shipped, {}, 'short', 'rough').skills, ['a', 'c']);
  assert.deepEqual(skillsFor(shipped, { rough: ['z'] }, 'short', 'rough'), { skills: ['z'], from: 'yours', key: 'rough' });
  assert.deepEqual(skillsFor(shipped, { 'edit/rough': [] }, 'edit', 'rough'), { skills: [], from: 'yours', key: 'edit/rough' });
  assert.deepEqual(skillsFor(shipped, null, 'edit', 'ask'), { skills: [], from: 'none', key: null });
});

test('toggle writes the whole list for that recipe and stage only', () => {
  const m1 = toggle(shipped, {}, 'edit', 'rough', 'x', true);
  assert.deepEqual(m1, { 'edit/rough': ['a', 'b', 'x'] });
  assert.deepEqual(skillsFor(shipped, { stages: { rough: ['old'] } }, 'edit', 'rough').skills, ['old']); // the nested shape is read too
  assert.deepEqual(skillsFor(shipped, m1, 'short', 'rough').skills, ['a', 'c']); // another recipe is untouched
  const m2 = toggle(shipped, m1, 'edit', 'rough', 'a', false);
  assert.deepEqual(m2['edit/rough'], ['b', 'x']);
  assert.deepEqual(toggle(shipped, { about: 'kept', ...m2 }, 'edit', 'rough', 'b', true), { about: 'kept', 'edit/rough': ['b', 'x'] }); // no doubles
});

test('reset and drop', () => {
  const m = toggle(shipped, {}, 'edit', 'rough', 'x', true);
  assert.deepEqual(resetStage(m, 'edit', 'rough'), {});
  assert.deepEqual(dropSkill(m, 'x'), { 'edit/rough': ['a', 'b'] });
  assert.deepEqual(stagesWithSkill(shipped, m, 'edit', ['ask', 'rough', 'visuals'], 'x'), ['rough']);
});

test('every skill the shipped stage-skills.json names is a shipped skill', () => {
  const doc = JSON.parse(fs.readFileSync(new URL('../../craft/stage-skills.json', import.meta.url), 'utf8'));
  for (const [stage, list] of Object.entries(doc).filter(([, v]) => Array.isArray(v))) {
    for (const name of list) assert.ok(fs.existsSync(new URL(`../../craft/skills/${name}/SKILL.md`, import.meta.url)), `${stage}: ${name}`);
  }
});

test('a copied recipe reads the skills of the stages it kept', async () => {
  const { withCopies } = await import('./stage-skills.js');
  const ship = { 'video/research': ['r'], 'video/plan': ['p'], studio: ['s'] };
  const lists = withCopies(ship, [{ id: 'mine', from: 'video', stages: [{ id: 'research' }, { id: 'extra' }] }]);
  assert.deepEqual(skillsFor(lists, {}, 'mine', 'research').skills, ['r']);
  assert.deepEqual(skillsFor(lists, {}, 'mine', 'extra').skills, []);
  assert.deepEqual(skillsFor(lists, {}, 'mine', 'plan').skills, []);
});
