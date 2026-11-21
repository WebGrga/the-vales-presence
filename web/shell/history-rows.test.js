import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rows, plainError, byDay } from './history-rows.js';

const S = '2026-11-21T10:00:00.000Z';
const log = [
  { t: S, stage: 'rough', kind: 'make', status: 'started', start: S },
  { t: '2026-11-21T10:05:00.000Z', stage: 'rough', kind: 'make', start: S, ms: 300000, cost: 1.25, status: 'done' },
  { t: '2026-11-21T10:06:00.000Z', stage: 'chat', kind: 'chat', ms: 8000, cost: 0.05 },
  { t: '2026-11-21T10:10:00.000Z', stage: 'visuals', status: 'started', start: '2026-11-21T10:10:00.000Z' },
  { t: '2026-11-21T10:11:00.000Z', stage: 'visuals', start: '2026-11-21T10:10:00.000Z', ms: 60000, cost: 0.4, status: 'todo', error: 'error_max_turns' },
];
const titles = { rough: 'Rough cut', visuals: 'Visuals' };

test('a start and its end are one row; chat and failures are told apart', () => {
  const r = rows(log, { titleOf: (x) => titles[x] || x });
  assert.equal(r.length, 3);
  assert.equal(r[0].title, 'Visuals');
  assert.equal(r[0].outcome, 'failed');
  assert.match(r[0].detail, /steps it is allowed/);
  assert.equal(r[1].title, 'Chat');
  assert.equal(r[2].label, 'Done');
  assert.equal(r[2].cost, 1.25);
  assert.equal(r[2].ms, 300000);
});

test('a start that never ended is running, or did not finish', () => {
  const l = [{ t: S, stage: 'rough', status: 'started', start: S }];
  assert.equal(rows(l, { running: 'rough' })[0].label, 'Running now');
  const r = rows(l, { running: null })[0];
  assert.equal(r.label, 'Did not finish');
  assert.equal(r.outcome, 'failed');
});

test('stopped, halted, sent back and a stage that ended without its files', () => {
  const r = rows([
    { t: '2026-11-21T11:00:00.000Z', stage: 'a', status: 'todo', stopped: true, ms: 5 },
    { t: '2026-11-21T11:01:00.000Z', stage: 'b', status: 'halted', why: 'a locked file changed', ms: 1 },
    { t: '2026-11-21T11:02:00.000Z', stage: 'c', status: 'sent back', to: 'rough', notes: 'tighter' },
    { t: '2026-11-21T11:03:00.000Z', stage: 'd', status: 'todo', missing: ['x.json'] },
  ]);
  assert.deepEqual(r.map((x) => x.outcome).reverse(), ['stopped', 'halted', 'info', 'failed']);
  assert.match(r[0].detail, /without x\.json/);
});

test('errors are said in plain words, days group the rows', () => {
  assert.match(plainError('the session closed mid-stage'), /closed in the middle/);
  assert.equal(plainError(''), '');
  const days = byDay(rows(log));
  assert.equal(days.length >= 1, true);
  assert.equal(Math.round(days.reduce((a, d) => a + d.cost, 0) * 100) / 100, 1.7);
});
