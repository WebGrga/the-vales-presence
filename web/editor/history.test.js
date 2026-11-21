import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyHistory, push, undo, redo } from './history.js';

test('undo and redo walk the snapshots', () => {
  let h = emptyHistory();
  h = push(h, 'a'); h = push(h, 'b'); // now 'c'
  let r = undo(h, 'c'); assert.equal(r.state, 'b'); h = r.h;
  r = undo(h, 'b'); assert.equal(r.state, 'a'); h = r.h;
  assert.equal(undo(h, 'a').state, null);
  r = redo(h, 'a'); assert.equal(r.state, 'b'); h = r.h;
  h = push(h, 'b'); assert.deepEqual(h.future, []);
  let big = emptyHistory(); for (let i = 0; i < 5; i++) big = push(big, i, 3);
  assert.deepEqual(big.past, [2, 3, 4]);
});
