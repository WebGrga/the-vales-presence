import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appAction } from './app-keys.js';

const ev = (key, o = {}) => ({ key, target: { tagName: 'DIV' }, ...o });

test('digits switch tabs, Ctrl+O/K/Enter do their jobs', () => {
  assert.deepEqual(appAction(ev('3'), { tab: 'edit' }), { action: 'tab', arg: 'studio' });
  assert.deepEqual(appAction(ev('7')), { action: 'tab', arg: 'settings' });
  assert.equal(appAction(ev('8')), null);
  assert.deepEqual(appAction(ev('o', { ctrlKey: true })), { action: 'projects' });
  assert.deepEqual(appAction(ev('k', { ctrlKey: true })), { action: 'palette' });
  assert.deepEqual(appAction(ev('Enter', { ctrlKey: true })), { action: 'go' });
});

test('nothing fires while typing, in a dialog, or with Alt', () => {
  assert.equal(appAction(ev('3', { target: { tagName: 'INPUT', type: 'text' } })), null);
  assert.equal(appAction(ev('k', { ctrlKey: true, target: { tagName: 'TEXTAREA' } })), null);
  assert.equal(appAction(ev('3'), { blocked: true }), null);
  assert.equal(appAction(ev('3', { altKey: true })), null);
});

test('Ctrl+Z is the app\'s only outside the Edit tab', () => {
  assert.deepEqual(appAction(ev('z', { ctrlKey: true }), { tab: 'studio' }), { action: 'undo' });
  assert.equal(appAction(ev('z', { ctrlKey: true }), { tab: 'edit' }), null);
});

test('the editor keys are left alone', () => {
  for (const k of ['j', 'k', 'l', 'i', 'o', 'c', 'r', 'b', ' ']) assert.equal(appAction(ev(k), { tab: 'edit' }), null);
});
