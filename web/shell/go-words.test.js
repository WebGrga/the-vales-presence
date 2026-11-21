import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roughWords } from './go-words.js';

test('the line names the stage, the skills and the usual time', () => {
  assert.equal(roughWords({ title: 'Rough cut', skills: 4, usualMs: 6 * 60000, runs: 3 }), 'Rough cut · reads 4 skills · usually about 6 min (3 past runs)');
});
test('it says when there is no past run, no skills, a missing skill, a render', () => {
  const t = roughWords({ title: 'Visuals', skills: 0, missing: ['x'], heavy: true, usualMs: null });
  assert.match(t, /reads no skills/); assert.match(t, /1 switched on but missing/); assert.match(t, /no past run/); assert.match(t, /may wait in line/);
});
test('one skill and one run are singular, a short stage is about a minute', () => {
  assert.match(roughWords({ title: 'A', skills: 1, usualMs: 70000, runs: 1 }), /reads 1 skill · usually about a minute \(1 past run\)/);
});
test('nothing for no info', () => assert.equal(roughWords(null), ''));
