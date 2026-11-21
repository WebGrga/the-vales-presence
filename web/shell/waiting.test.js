import test from 'node:test';
import assert from 'node:assert/strict';
import { askingAfter, askingFromStatus, askingFromView, pageTitle } from './waiting.js';

test('a question opens the wait, what the agent does next closes it', () => {
  let a = false;
  a = askingAfter(a, { event: 'text', text: 'Let me ask.' }); assert.equal(a, false);
  a = askingAfter(a, { event: 'question', questions: [] }); assert.equal(a, true);
  a = askingAfter(a, { event: 'text', text: '' }); assert.equal(a, true); // an empty keep-alive changes nothing
  a = askingAfter(a, { event: 'fire' }); assert.equal(a, true);
  a = askingAfter(a, { event: 'tool', tool: 'Write' }); assert.equal(a, false);
  assert.equal(askingAfter(true, { event: 'done' }), false);
  assert.equal(askingAfter(true, { event: 'text', text: '', start: true }), false);
  assert.equal(askingAfter(true, null), true);
});

test('status and the tab title', () => {
  assert.equal(askingFromStatus({ question: { questions: [] } }), true);
  assert.equal(askingFromStatus({ question: null }), false);
  assert.equal(askingFromView({ for: 'question', questions: [] }), true); assert.equal(askingFromView({ for: 'approve' }), false); assert.equal(askingFromView(null), false);
  assert.equal(pageTitle(null, true), 'The Vale’s Presence');
  assert.equal(pageTitle({ id: 'a', title: 'My video' }, false), 'My video · The Vale’s Presence');
  assert.equal(pageTitle({ id: 'a' }, true), '(!) Your answer · a · The Vale’s Presence');
});
