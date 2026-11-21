import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describe, lineText } from './queue-view.js';

const row = (o) => ({ id: 'x', title: 'X', stage: 's', stageTitle: 'S', status: 'todo', busy: false, heavy: false, position: 0, behind: [], ...o });

test('running, waiting for you and in line are told apart', () => {
  const d = describe([
    row({ id: 'a', busy: true, status: 'running', heavy: true, since: 100 }),
    row({ id: 'b', status: 'queued', position: 1, behind: ['A (Rough)'] }),
    row({ id: 'c', status: 'waiting' }),
    row({ id: 'd', status: 'todo' }),
    row({ id: 'e', halted: true, status: 'halted' }),
  ], { limit: 1 });
  assert.deepEqual(d.running.map((r) => r.project), ['a']);
  assert.deepEqual(d.inLine.map((r) => r.project), ['b']);
  assert.deepEqual(d.waitingForYou.map((r) => r.project), ['c', 'e']);
  assert.deepEqual(d.slots, { used: 1, limit: 1 });
  assert.equal(d.empty, false);
});

test('nothing at all is empty', () => {
  assert.equal(describe([row({})]).empty, true);
  assert.equal(describe(null).empty, true);
});

test('a line says what it waits behind', () => {
  assert.equal(lineText({ title: 'B', behind: ['A (Rough)', 'C'] }), 'B waits behind A (Rough) and 1 more.');
  assert.equal(lineText({ title: 'B', behind: [] }), 'B is next in line.');
});
