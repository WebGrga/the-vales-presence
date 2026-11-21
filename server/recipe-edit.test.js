import test from 'node:test';
import assert from 'node:assert/strict';
import { recipeId, buildStages, validate } from './recipe-edit.js';
import { stageStats, estimate, roughTime, roughCost } from './recipe-card.js';

const kinds = { ask: {}, make: {}, gate: {}, record: {}, export: {}, upload: {}, options: {}, inspect: {} };
const pool = [
  { id: 'ask', kind: 'ask', title: 'Brief', out: ['brief.md'] },
  { id: 'rough', kind: 'make', title: 'Rough', out: ['video/out/rough.mp4'] },
  { id: 'rough-review', kind: 'gate', title: 'Rough review', back: 'rough', lock: ['video/out/rough.mp4'] },
  { id: 'visuals', kind: 'make', title: 'Visuals', out: ['video/out/final.mp4'] },
  { id: 'final-review', kind: 'gate', title: 'Final review', back: 'visuals' },
  { id: 'export', kind: 'export', title: 'Export' },
];
const ids = (a) => a.map((id) => ({ id }));
const bad = (list) => validate({ name: 'Mine', stages: buildStages(ids(list), pool) }, kinds);

test('ids from names', () => {
  assert.equal(recipeId('My Quick Edit!'), 'my-quick-edit');
  assert.equal(recipeId('Edit', ['edit']), 'edit-2');
  assert.equal(recipeId('???'), 'my-recipe');
});

test('a dropped stage fixes its review back-link, a bad order is refused in plain words', () => {
  assert.deepEqual(bad(['ask', 'rough', 'rough-review', 'visuals', 'final-review', 'export']), []);
  assert.deepEqual(bad(['rough', 'visuals', 'final-review', 'export']), []); // back: visuals still earlier
  const s = buildStages(ids(['rough', 'final-review']), pool);
  assert.equal(s[1].back, undefined); // visuals was dropped
  assert.match(bad(['rough-review', 'rough'])[0], /agent has to come before|stage of the agent/);
  assert.match(bad(['ask', 'rough-review'])[0], /locks video\/out\/rough.mp4, but no stage before it makes that file/);
  assert.match(bad(['ask', 'ask'])[0], /twice/);
  assert.match(bad([])[0], /at least one stage/);
  assert.match(validate({ name: '', stages: buildStages(ids(['ask']), pool) }, kinds)[0], /name/);
  assert.match(bad(['nope'])[0], /unknown kind/);
});

test('times and costs are medians of stages that really ran, never invented', () => {
  const ps = [
    { recipe: 'edit', stages: { rough: { status: 'done', ms: 600000, cost: 1.5 }, ask: { status: 'done', ms: 70000, cost: 0.4 } } },
    { recipe: 'edit', stages: { rough: { status: 'done', ms: 800000, cost: 2.5 }, visuals: { status: 'todo', ms: 0, cost: 0 } } },
    { recipe: 'edit', stages: { rough: { status: 'done', ms: 5, cost: 0 } } }, // a test run: no evidence
  ];
  const st = stageStats(ps);
  assert.equal(st['edit/rough'].n, 2);
  assert.equal(st['edit/rough'].ms, 700000);
  const e = estimate({ id: 'mine', from: 'edit', stages: [{ id: 'ask', kind: 'ask' }, { id: 'rough', kind: 'make' }, { id: 'visuals', kind: 'make', title: 'Visuals' }, { id: 'rv', kind: 'gate' }] }, st);
  assert.equal(e.measured, 2); assert.equal(e.total, 3); assert.deepEqual(e.missing, ['Visuals']);
  assert.equal(roughTime(4500000), 'about 1 h 15 min');
  assert.equal(roughTime(1000), 'about a minute');
  assert.equal(roughCost(0.43), 'about $0.50');
  assert.equal(roughCost(2.04), 'about $2');
  assert.equal(roughCost(7.4), 'about $7');
});
