import test from 'node:test';
import assert from 'node:assert/strict';
import { listState, rowWords, popLeft } from './picker-view.js';

test('a failed call is an error, never "no projects yet"', () => {
  assert.deepEqual(listState({ ok: false, error: '500 Internal Server Error' }), { show: 'error', error: '500 Internal Server Error', projects: [] });
  assert.equal(listState(null).show, 'error');
  assert.equal(listState({ ok: true, projects: { nope: 1 } }).show, 'error');
  assert.equal(listState({ ok: true, projects: [] }).show, 'empty');
  assert.equal(listState({ ok: true, projects: { projects: [{ id: 'a' }] } }).show, 'list');
});

test('the words under a project use the recipe names', () => {
  const recipes = [{ id: 'edit', name: 'Edit a video', stages: [{ id: 'ask', title: 'Brief' }, { id: 'rough', title: 'Rough cut' }] }];
  assert.equal(rowWords({ recipe: 'edit', at: 'ask' }, recipes), 'Edit a video · 1 of 2: Brief');
  assert.equal(rowWords({ recipe: 'edit', at: 'rough', done: true }, recipes), 'Edit a video · finished');
  assert.equal(rowWords({ recipe: 'odd', at: 'pick-review' }, recipes), 'odd · pick review');
});

test('the popover stays inside the window', () => {
  assert.equal(popLeft(240, 440, 1280), 0);
  assert.equal(popLeft(240, 440, 600), 600 - 8 - 440 - 240);
  assert.equal(popLeft(100, 380, 390), 8 - 100); // narrower than the room: pinned to the left margin
});
