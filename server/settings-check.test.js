import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSettings } from './settings-check.js';

test('a valid change passes with proper types', () => {
  assert.deepEqual(checkSettings({ model: 'claude-sonnet-5-5', effort: 'high', permissionMode: 'acceptEdits', chain: false, heavy: 2, quietMinutes: 0 }).patch,
    { model: 'claude-sonnet-5-5', effort: 'high', permissionMode: 'acceptEdits', chain: false, heavy: 2, quietMinutes: 0 });
  assert.deepEqual(checkSettings({ heavy: '3', quietMinutes: ' 30 ' }).patch, { heavy: 3, quietMinutes: 30 });
  assert.deepEqual(checkSettings({}).patch, {});
});
test('a model that is not an id is refused', () => {
  for (const m of ['rm -rf /', '', 'a', 5, null, 'x'.repeat(61)]) assert.match(checkSettings({ model: m }).error, /model/);
});
test('effort and permission mode must be a known value', () => {
  assert.match(checkSettings({ effort: 'loud' }).error, /"low", "medium"/);
  assert.match(checkSettings({ permissionMode: 'bypassPermissions' }).error, /"auto", "acceptEdits"/);
});
test('chain must be a real boolean', () => {
  assert.match(checkSettings({ chain: 'yes' }).error, /chain/);
  assert.equal(checkSettings({ chain: true }).patch.chain, true);
});
test('numbers: whole and inside their range', () => {
  for (const v of [0, 9, -1, 1.5, 'x', NaN, null]) assert.match(checkSettings({ heavy: v }).error, /heavy/);
  for (const v of [-1, 241, 2.5, 'x']) assert.match(checkSettings({ quietMinutes: v }).error, /quietMinutes/);
  assert.equal(checkSettings({ heavy: 8 }).patch.heavy, 8);
  assert.equal(checkSettings({ quietMinutes: 240 }).patch.quietMinutes, 240);
});
test('an unknown key or a non-object is refused and nothing is kept', () => {
  assert.match(checkSettings({ effort: 'low', colour: 'red' }).error, /Unknown setting: colour/);
  assert.ok(checkSettings([]).error); assert.ok(checkSettings(null).error); assert.ok(checkSettings('x').error);
});
