import test from 'node:test';
import assert from 'node:assert/strict';
import { stageTab, tabsFor, startFor, currentStage } from './recipe-tabs.js';

const edit = { format: 'long', stages: [{ id: 'ask', kind: 'ask' }, { id: 'rough', kind: 'make' }, { id: 'export', kind: 'export' }] };
const short = { format: 'short', stages: [{ id: 'ask', kind: 'ask' }, { id: 'rough', kind: 'make' }, { id: 'export', kind: 'export' }] };
const sfl = { format: 'short', stages: [{ id: 'pick', kind: 'make' }, { id: 'cut', kind: 'make' }] };

test('a stage wants the tab it works in', () => {
  assert.equal(stageTab({ id: 'titles', kind: 'make' }), 'studio');
  assert.equal(stageTab({ id: 'pick-review', kind: 'options' }), 'shorts');
  assert.equal(stageTab({ id: 'export', kind: 'export' }), 'export');
  assert.equal(stageTab({ id: 'visuals', kind: 'make' }), 'edit');
  assert.equal(stageTab({ id: 'visuals', kind: 'make', tab: 'context' }), 'context');
});

test('tabs a recipe does not use are left out, Shorts stays for an edit that can offer Shorts from it', () => {
  assert.ok(tabsFor(edit).has('shorts') && tabsFor(edit).has('studio'));
  assert.ok(!tabsFor(short).has('shorts') && !tabsFor(short).has('studio'));
  assert.ok(tabsFor(sfl).has('shorts') && !tabsFor(sfl).has('studio'));
  assert.equal(tabsFor(null), null);
  assert.ok(tabsFor({ ...short, tabs: ['studio'] }).has('studio'));
});

test('the start tab and the Next line', () => {
  const r = { stages: [{ id: 'pick', kind: 'make' }], card: { start: { tab: 'shorts', tabNoFootage: 'edit', hint: 'Next: add the video.', withFootage: { hint: 'Next: Go.' } } } };
  assert.deepEqual(startFor(r, { footage: false }), { tab: 'edit', hint: 'Next: add the video.' });
  assert.deepEqual(startFor(r, { footage: true }), { tab: 'shorts', hint: 'Next: Go.' });
  assert.equal(startFor({ stages: [{ id: 'titles', kind: 'make', title: 'Titles' }] }).tab, 'studio');
  assert.match(startFor({ stages: [{ id: 'titles', kind: 'make', title: 'Titles' }] }).hint, /^Next: press Go/);
});

test('the current stage of a project', () => {
  assert.equal(currentStage({ at: 'rough' }, edit).id, 'rough');
  assert.equal(currentStage({ at: 'rough', done: true }, edit), null);
});
