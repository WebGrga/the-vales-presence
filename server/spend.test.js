import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarise, over, counts, warnText } from './spend.js';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();

test('only lines with a cost count, never a start or a queue line', () => {
  assert.equal(counts({ cost: 0.5, status: 'done' }), true);
  assert.equal(counts({ cost: 0.5, status: 'started' }), false);
  assert.equal(counts({ cost: 0, status: 'done' }), false);
  assert.equal(counts({ stage: 'chat', cost: 0.1 }), true);
});

test('days and months add up in local time, empty days are zero', () => {
  const now = new Date(2026, 10, 21, 15);
  const s = summarise([
    { t: at(2026, 11, 21), cost: 0.5, ms: 1000, project: 'a', status: 'done' },
    { t: at(2026, 11, 21), cost: 0.25, project: 'b', stage: 'chat' },
    { t: at(2026, 11, 3), cost: 1, project: 'a', status: 'done' },
    { t: at(2026, 10, 30), cost: 2, project: 'a', status: 'done' },
    { t: at(2026, 11, 21), cost: 9, status: 'started' },
  ], now);
  assert.equal(s.today, 0.75);
  assert.equal(s.month, 1.75);
  assert.equal(s.months[1].cost, 2);
  assert.equal(s.days.length, 31);
  assert.equal(s.days[1].cost, 0); // 20 Nov
  assert.equal(s.projects[0].project, 'a');
  assert.equal(s.plan, null);
});

test('a plan login is remembered from any line that says so', () => {
  assert.equal(summarise([{ t: at(2026, 11, 1), cost: 1, plan: true, status: 'done' }], new Date(2026, 10, 2)).plan, true);
});

test('limits warn only when passed, 0 is off', () => {
  const s = { today: 3, month: 20 };
  assert.deepEqual(over(s, { warnDay: 0, warnMonth: 0 }), []);
  assert.deepEqual(over(s, { warnDay: 2, warnMonth: 50 }).map((x) => x.per), ['day']);
  assert.deepEqual(over(s, { warnDay: 2, warnMonth: 10 }).map((x) => x.per), ['day', 'month']);
  assert.match(warnText({ per: 'day', limit: 2, spent: 3 }, true), /not a bill/);
});
