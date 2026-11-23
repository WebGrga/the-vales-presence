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

test('a step you write: id from the title, kept as it is, never one a shipped stage uses', async () => {
  const { customStage } = await import('./recipe-edit.js');
  const s = customStage({ title: 'Cut the sponsor read', kind: 'make', focus: ' Remove the ad. ', out: 'studio/a.md\r\n\nstudio\\b.md' }, ['ask']);
  assert.deepEqual(s, { id: 'cut-the-sponsor-read', kind: 'make', title: 'Cut the sponsor read', focus: 'Remove the ad.', custom: true, out: ['studio/a.md', 'studio/b.md'] });
  assert.equal(customStage({ title: 'Cut the sponsor read' }, ['cut-the-sponsor-read']).id, 'cut-the-sponsor-read-2');
  assert.equal(customStage({ id: 'cut-the-sponsor-read', title: 'Renamed' }, []).id, 'cut-the-sponsor-read'); // an existing step keeps its id
  assert.equal(customStage({ title: '???' }, []).id, 'my-step');
  const g = customStage({ title: 'Look', kind: 'gate', focus: 'x', out: 'a.md' }, []);
  assert.equal(g.kind, 'gate'); assert.equal(g.out, undefined); // a gate leaves no files
  assert.equal(customStage({ title: 'x', kind: 'upload', focus: 'y' }, []).kind, 'make'); // only make or gate
});

test('a new step is placed where you want and passes the same rules', () => {
  const list = [{ id: 'ask' }, { id: 'rough' }, { custom: true, title: 'Cut sponsor', kind: 'make', focus: 'Remove the ad.' }, { id: 'rough-review' }, { custom: true, title: 'Look at it', kind: 'gate', focus: 'Check the ad is gone.' }, { id: 'export' }];
  const stages = buildStages(list, pool, ['visuals']);
  assert.deepEqual(stages.map((s) => s.id), ['ask', 'rough', 'cut-sponsor', 'rough-review', 'look-at-it', 'export']);
  assert.equal(stages[2].focus, 'Remove the ad.');
  assert.deepEqual(validate({ name: 'Mine', stages }, kinds), []);
  // an id a shipped stage uses is never taken
  assert.equal(buildStages([{ custom: true, title: 'Visuals', focus: 'x' }], pool, ['visuals'])[0].id, 'visuals-2');
  // two steps with one title get two ids
  assert.deepEqual(buildStages([{ custom: true, title: 'Same', focus: 'x' }, { custom: true, title: 'Same', focus: 'y' }], pool).map((s) => s.id), ['same', 'same-2']);
  // a gate you wrote still needs an agent step before it; a step without words is refused
  assert.match(validate({ name: 'Mine', stages: buildStages([{ custom: true, title: 'Look', kind: 'gate', focus: 'x' }], pool) }, kinds)[0], /agent has to come before|stage of the agent/);
  assert.match(validate({ name: 'Mine', stages: buildStages([{ id: 'ask' }, { custom: true, title: 'Do', focus: '  ' }], pool) }, kinds)[0], /needs words for the agent/);
  assert.match(validate({ name: 'Mine', stages: buildStages([{ id: 'ask' }, { custom: true, title: '', focus: 'x' }], pool) }, kinds).join(' '), /needs a title/);
});

test('a step you wrote reaches the stage prompt as its focus', async () => {
  const { stagePrompt } = await import('./prompt.js');
  const stage = buildStages([{ custom: true, title: 'Cut sponsor', focus: 'Remove the ad.', out: 'studio/s.md' }], pool)[0];
  const p = stagePrompt({ recipe: { name: 'Mine', stages: [stage] }, stage, index: 0, kind: { instruction: 'Do it.' }, projectDir: '/p', root: '/r', houseRules: '- no captions' });
  assert.match(p, /## This stage\n\nRemove the ad\./);
  assert.match(p, /- studio\/s\.md/);
  assert.match(p, /House rules \(they win over a skill and over this stage's instructions\)/);
});

test('a step you saved before keeps its id when the recipe is changed again', () => {
  const list = [{ id: 'ask' }, { custom: true, id: 'cut-sponsor', title: 'Cut sponsor (renamed)', focus: 'x' }, { custom: true, title: 'Cut sponsor', focus: 'y' }];
  const pool2 = [...pool, { id: 'cut-sponsor', kind: 'make', title: 'Cut sponsor', focus: 'x', custom: true }];
  assert.deepEqual(buildStages(list, pool2, ['visuals']).map((s) => s.id), ['ask', 'cut-sponsor', 'cut-sponsor-2']);
});
