import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newQuiet, quietStep, lastLine, quietText } from './fires.js';

const MIN = 60e3;

test('a stage whose task writes nothing for the limit is reported once; output again clears it', () => {
  const g = newQuiet(0);
  // the OCR case: a task that starts with an empty log and never writes
  let r = quietStep(g, { now: 5 * MIN, sizes: { t1: 0 }, activity: 0, limitMs: 15 * MIN });
  assert.equal(r.report, null);
  assert.equal(r.quietMs, 5 * MIN);
  r = quietStep(g, { now: 15 * MIN, sizes: { t1: 0 }, activity: 0, limitMs: 15 * MIN });
  assert.deepEqual(r.report, { quietMs: 15 * MIN, since: 0 });
  r = quietStep(g, { now: 20 * MIN, sizes: { t1: 0 }, activity: 0, limitMs: 15 * MIN });
  assert.equal(r.report, null); // once
  r = quietStep(g, { now: 21 * MIN, sizes: { t1: 120 }, activity: 0, limitMs: 15 * MIN });
  assert.equal(r.cleared, true);
  assert.equal(r.quietMs, 0);
});

test('a growing log or the agent at work is output; 0 means never report', () => {
  const g = newQuiet(0);
  for (let m = 1; m <= 40; m++) assert.equal(quietStep(g, { now: m * MIN, sizes: { t1: m * 10 }, activity: 0, limitMs: 15 * MIN }).report, null);
  const h = newQuiet(0);
  assert.equal(quietStep(h, { now: 20 * MIN, sizes: {}, activity: 19 * MIN, limitMs: 15 * MIN }).report, null);
  const z = newQuiet(0);
  assert.equal(quietStep(z, { now: 99 * MIN, sizes: { t: 0 }, activity: 0, limitMs: 0 }).report, null);
  // a task that came with output already counts from when it was seen
  const k = newQuiet(0);
  quietStep(k, { now: 10 * MIN, sizes: { t: 50 }, activity: 0, limitMs: 15 * MIN });
  assert.equal(quietStep(k, { now: 20 * MIN, sizes: { t: 50 }, activity: 0, limitMs: 15 * MIN }).report, null);
  assert.ok(quietStep(k, { now: 25 * MIN, sizes: { t: 50 }, activity: 0, limitMs: 15 * MIN }).report);
});

test('the last line of a log: progress bars give their newest state', () => {
  assert.equal(lastLine('a\nb\n\n'), 'b');
  assert.equal(lastLine('frame 1\rframe 2\rframe 3\n'), 'frame 3');
  assert.equal(lastLine('\x1b[32mdone\x1b[0m'), 'done');
  assert.equal(lastLine(''), '');
  assert.equal(lastLine('x'.repeat(300)).length, 200);
  assert.equal(quietText({ stage: 'Visuals', quietMs: 15 * MIN, what: 'OCR the frames', last: '' }),
    'Visuals: nothing new for 15 min from OCR the frames (its log is empty). It may be stuck: Stop it, or let it run.');
});
