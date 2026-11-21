import test from 'node:test';
import assert from 'node:assert/strict';
import { patchFrom, valuesOf, optionsFor, changedKeys } from './form.js';

const saved = { model: 'claude-opus-5-5', effort: 'medium', permissionMode: 'auto', chain: true, heavy: 1, quietMinutes: 15 };

test('untouched values make no patch', () => {
  assert.deepEqual(patchFrom(valuesOf(saved), saved), {});
});
test('a change makes a patch with numbers as numbers', () => {
  const v = { ...valuesOf(saved), effort: 'high', heavy: '3', chain: false };
  assert.deepEqual(patchFrom(v, saved), { effort: 'high', heavy: 3, chain: false });
  assert.deepEqual(changedKeys(v, saved), ['effort', 'chain', 'heavy']);
});
test('an empty number is sent as wrong, never as 0', () => {
  const p = patchFrom({ ...valuesOf(saved), heavy: '' }, saved);
  assert.ok(Number.isNaN(p.heavy));
});
test('a model the file holds that is not listed stays choosable', () => {
  const meta = { models: [{ value: 'claude-opus-5-5', name: 'Opus 5.5', about: 'best' }], efforts: [], modes: [] };
  assert.equal(optionsFor('model', meta, 'my-model').at(-1).value, 'my-model');
  assert.equal(optionsFor('model', meta, 'claude-opus-5-5').length, 1);
});
