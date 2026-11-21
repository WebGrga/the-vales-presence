import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, pickStep } from './tour.js';

test('the tour has five steps, each with words', () => {
  assert.equal(STEPS.length, 5);
  for (const s of STEPS) { assert.ok(s.sel && s.title && s.text.length > 40); }
});

test('a part that is not on screen is skipped in both directions', () => {
  const ok = new Set([0, 2, 4]);
  const vis = (s) => ok.has(STEPS.indexOf(s));
  assert.equal(pickStep(STEPS, 0, 1, vis), 0);
  assert.equal(pickStep(STEPS, 1, 1, vis), 2);
  assert.equal(pickStep(STEPS, 3, -1, vis), 2);
  assert.equal(pickStep(STEPS, 5, 1, vis), -1);
  assert.equal(pickStep(STEPS, -1, -1, vis), -1);
});
