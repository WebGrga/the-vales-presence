import test from 'node:test';
import assert from 'node:assert/strict';
import { saveDecision, backupName } from './text-save.js';

test('a new file is written without a backup', () => {
  assert.deepEqual(saveDecision({ diskText: null, diskMtime: 0, base: 0, text: 'a' }), { write: true, backup: false, conflict: false });
});

test('the same text is not written again', () => {
  assert.equal(saveDecision({ diskText: 'a', diskMtime: 5, base: 1, text: 'a' }).write, false);
});

test('a plain edit is written over the version the user saw', () => {
  assert.deepEqual(saveDecision({ diskText: 'a', diskMtime: 100, base: 100, text: 'ab' }), { write: true, backup: false, conflict: false });
});

test('a file the agent changed since the user loaded it is kept as a backup', () => {
  assert.deepEqual(saveDecision({ diskText: 'agent', diskMtime: 200, base: 100, text: 'mine' }), { write: true, backup: true, conflict: true });
});

test('no base means no conflict check', () => {
  assert.equal(saveDecision({ diskText: 'x', diskMtime: 200, base: undefined, text: 'y' }).backup, false);
});

test('a non-string text writes nothing', () => {
  assert.equal(saveDecision({ diskText: 'x', diskMtime: 1, base: 1, text: 5 }).write, false);
});

test('backup names carry the time', () => {
  assert.equal(backupName('plan.md', new Date('2026-01-02T03:04:05Z')), 'plan-2026-01-02T03-04-05.md');
  assert.equal(backupName('notes', new Date('2026-01-02T03:04:05Z')), 'notes-2026-01-02T03-04-05');
});
