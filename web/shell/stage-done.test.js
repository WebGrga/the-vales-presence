import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doneWords } from './stage-done.js';

test('a finished stage says it is done; failures, questions and limits are not "done"', () => {
  assert.equal(doneWords({ kind: 'ended', stageTitle: 'Visuals' }), 'Visuals is done: watch it');
  assert.equal(doneWords({ kind: 'yours', stage: 'rough' }), 'rough is done: watch it');
  assert.equal(doneWords({ kind: 'finished' }), 'The stage is done: watch it');
  for (const kind of ['failed', 'stopped', 'ask', 'spend']) assert.equal(doneWords({ kind }), null);
});
