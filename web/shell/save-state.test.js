import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf, editorState, summary, createSaveState } from './save-state.js';

test('only saves count, not commands', () => {
  assert.equal(sourceOf('POST', '/api/projects/a/drafts'), 'drafts');
  assert.equal(sourceOf('POST', '/api/studio/a/options'), 'Studio');
  assert.equal(sourceOf('POST', '/api/context/save'), 'Context');
  assert.equal(sourceOf('POST', '/api/projects/a/go'), null);
  assert.equal(sourceOf('POST', '/api/studio/a/upload'), null);
  assert.equal(sourceOf('GET', '/api/studio/a/options'), null);
});

test('the editor words become a state', () => {
  assert.equal(editorState('saving'), 'saving');
  assert.equal(editorState('saved'), 'saved');
  assert.equal(editorState('not saved yet, trying again'), 'failed');
  assert.equal(editorState('kept in this browser only: the server has no cuts route yet'), 'failed');
  assert.equal(editorState('', undefined), null);
});

test('one failure outranks saving, saving outranks saved', () => {
  const m = new Map([['a', { state: 'saved' }], ['b', { state: 'saving' }]]);
  assert.equal(summary(m).state, 'saving');
  m.set('c', { state: 'failed', msg: 'x' });
  assert.equal(summary(m).state, 'failed');
  assert.deepEqual(summary(m).failed, [{ name: 'c', msg: 'x' }]);
  assert.equal(summary(new Map()).state, 'saved');
});

test('requests in flight keep the chip on Saving until the last one ends; a failure stays until a save works', () => {
  const seen = [];
  const s = createSaveState((x) => seen.push(x.state));
  s.start('Studio'); s.start('Studio');
  s.end('Studio', true);
  assert.equal(seen.at(-1), 'saving');
  s.end('Studio', true);
  assert.equal(seen.at(-1), 'saved');
  s.start('Context'); s.end('Context', false, 'server said 500');
  assert.equal(seen.at(-1), 'failed');
  s.start('Context'); s.end('Context', true);
  assert.equal(seen.at(-1), 'saved');
});
