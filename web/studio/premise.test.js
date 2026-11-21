import test from 'node:test';
import assert from 'node:assert/strict';
import { rankLines } from './premise.js';

test('lines are ranked best first, the gate sits after the last line at or above it, unclear lines come last', () => {
  const r = rankLines([
    { title: 'low', score: 4 }, { title: 'high', score: 8 }, { title: 'edge', score: 6 },
    { title: 'bad', score: 9, clear: false, failed: 'insider' }, { title: 'mid', score: 7 },
  ], 6);
  assert.deepEqual(r.rows.map((l) => l.title), ['high', 'mid', 'edge', 'low', 'bad']);
  assert.equal(r.gateAt, 3);
  assert.equal(r.passed, 3);
  assert.equal(r.rows[4].passes, false);
});

test('no gate: no gate position, nothing passes', () => {
  const r = rankLines([{ title: 'a', score: 5 }], undefined);
  assert.equal(r.gateAt, -1);
  assert.equal(r.passed, 0);
});
