import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, wordsOf, badged } from './notify.js';

const base = { pref: 'on', permission: 'granted', visible: false, focused: false, supported: true };

test('nothing happens while it is off or while you are looking', () => {
  assert.deepEqual(decide({ ...base, pref: 'off' }), { desktop: false, badge: false });
  assert.deepEqual(decide({ ...base, visible: true, focused: true, pref: null }), { desktop: false, badge: false });
  assert.deepEqual(decide({ ...base, visible: true, focused: true }), { desktop: false, badge: false });
});

test('not asked yet: the tab title badge only, no desktop note', () => {
  assert.deepEqual(decide({ ...base, pref: null }), { desktop: false, badge: true });
});

test('away: a note and a badge; without permission only the badge', () => {
  assert.deepEqual(decide(base), { desktop: true, badge: true });
  assert.deepEqual(decide({ ...base, permission: 'denied' }), { desktop: false, badge: true });
  assert.deepEqual(decide({ ...base, visible: true, focused: false }), { desktop: true, badge: true });
});

test('words name the project and what happened', () => {
  assert.equal(wordsOf({ kind: 'ask', projectTitle: 'My video' }).title, 'My video: the agent asks you something');
  assert.match(wordsOf({ kind: 'failed', projectTitle: 'V', text: 'x failed' }).title, /failed/);
  assert.equal(wordsOf({ kind: 'spend', text: 't' }).title, 'Spend limit passed');
});

test('the badge sits in front of the title', () => {
  assert.equal(badged('A', 0), 'A');
  assert.equal(badged('A', 3), '(3) A');
});
