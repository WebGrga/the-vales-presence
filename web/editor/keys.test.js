import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { comboOf, actionFor, ownsKeys, keyLabel, keysOf, keyList, cutsHint, clashes } from './keys.js';

const keys = JSON.parse(fs.readFileSync(new URL('./keys.json', import.meta.url), 'utf8'));

test('key names', () => {
  assert.equal(comboOf({ key: ' ' }), 'space');
  assert.equal(comboOf({ key: 'Z', ctrlKey: true, shiftKey: true }), 'ctrl+shift+z');
  assert.equal(comboOf({ key: 'z', metaKey: true }), 'ctrl+z');
  assert.equal(comboOf({ key: '+', shiftKey: true }), '+');
  assert.equal(comboOf({ key: 'ArrowLeft', shiftKey: true }), 'shift+left');
  assert.equal(comboOf({ key: 'Shift', shiftKey: true }), '');
});

test('K pauses everywhere; C keeps a cut, R restores its words, in every panel', () => {
  assert.equal(actionFor(keys, 'k', 'editor'), 'pause');
  assert.equal(actionFor(keys, 'k', 'cuts'), 'pause');
  assert.equal(actionFor(keys, 'c', 'cuts'), 'keep');
  assert.equal(actionFor(keys, 'c', 'editor'), 'keep');
  assert.equal(actionFor(keys, 'r', 'cuts'), 'restore');
  assert.equal(actionFor(keys, 'x', 'editor'), null); // X is no longer Clear In/Out
  assert.equal(actionFor(keys, 'ctrl+shift+x', 'editor'), 'clearMarks');
  assert.equal(actionFor(keys, 'space', 'cuts'), 'playPause');
  assert.equal(actionFor(keys, 'ctrl+z', null), 'undo');
  assert.equal(actionFor(keys, 'q', 'editor'), null);
});

test('every key the brief names is there', () => {
  const ed = keys.scopes.editor;
  for (const k of ['space', 'j', 'k', 'l', 'i', 'o', 'left', 'right', 'up', 'down', 'r', 'ctrl+z']) assert.ok(ed[k], k);
});

test('a key means one thing everywhere', () => {
  assert.deepEqual(clashes(keys), []);
  assert.deepEqual(clashes({ scopes: { editor: { k: 'pause' }, cuts: { k: 'keep' } } }), [{ combo: 'k', scope: 'cuts', a: 'pause', b: 'keep' }]);
});

test('the ? overlay and the hints come from keys.json', () => {
  assert.equal(keyLabel('ctrl+shift+z'), 'Ctrl+Shift+Z'); assert.equal(keyLabel('left'), '←'); assert.equal(keyLabel('space'), 'Space');
  assert.equal(keyLabel('+'), '+'); assert.equal(keyLabel('?'), '?'); assert.equal(keyLabel(','), ',');
  assert.deepEqual(keysOf(keys, 'zoomIn'), ['=', '+']);
  const list = keyList(keys);
  assert.ok(list.length >= 4);
  const all = list.flatMap((g) => g.rows);
  for (const r of all) assert.ok(keys.labels[r.action], 'words for ' + r.action);
  // every action a key names has words in the overlay
  for (const map of Object.values(keys.scopes)) for (const a of Object.values(map)) assert.ok(all.some((r) => r.action === a), 'listed: ' + a);
  assert.equal(cutsHint(keys), '↑↓ move · C keep cut · R restore words');
});

test('text boxes keep their keys', () => {
  assert.equal(ownsKeys({ tagName: 'TEXTAREA' }), true);
  assert.equal(ownsKeys({ tagName: 'INPUT', type: 'text' }), true);
  assert.equal(ownsKeys({ tagName: 'INPUT', type: 'range' }), false);
  assert.equal(ownsKeys({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(ownsKeys({ tagName: 'BUTTON' }), false);
  assert.equal(ownsKeys(null), false);
});
