import test from 'node:test';
import assert from 'node:assert/strict';
import { questionKey, toggle, setOwn, answered, progress, answersOf, sendLabel, isMulti, NO_ANSWER } from './agent-ask.js';

const qs = [
  { question: 'How long?', options: [{ label: 'Short' }, { label: 'Long' }] },
  { question: 'What must stay?', multiSelect: true, options: [{ label: 'Intro' }, { label: 'Swearing' }, { label: 'Demo' }] },
  { question: 'Captions?', options: [{ label: 'Yes' }, { label: 'No' }] },
];

test('one click answers one question, not all of them', () => {
  let s = {};
  s = toggle(s, 0, 'Short', false);
  assert.deepEqual(progress(qs, s), { n: 3, done: 1, all: false, any: true });
  assert.equal(sendLabel(qs, s), 'Send answers (1 of 3)');
  s = toggle(s, 0, 'Long', false); // a single choice swaps
  assert.deepEqual(s.picks[0], ['Long']);
  s = toggle(s, 0, 'Long', false); // a second click clears it
  assert.deepEqual(s.picks[0], []);
  assert.equal(answered(s, 0), false);
});

test('multi-select takes several, own words go with them, in the offered order', () => {
  assert.equal(isMulti(qs[1]), true); assert.equal(isMulti(qs[0]), false);
  let s = {};
  s = toggle(s, 1, 'Demo', true); s = toggle(s, 1, 'Intro', true); s = toggle(s, 1, 'Swearing', true); s = toggle(s, 1, 'Swearing', true);
  s = toggle(s, 0, 'Short', false);
  s = setOwn(s, 2, ' only on the demo ');
  assert.deepEqual(answersOf(qs, s), { 'How long?': 'Short', 'What must stay?': 'Intro, Demo', 'Captions?': 'only on the demo' });
  assert.equal(sendLabel(qs, s), 'Send answers');
});

test('an unanswered question says so; keys are stable', () => {
  assert.equal(answersOf(qs, { picks: { 0: ['Short'] } })['Captions?'], NO_ANSWER);
  assert.equal(questionKey(qs), questionKey(JSON.parse(JSON.stringify(qs))));
  assert.notEqual(questionKey(qs), questionKey(qs.slice(1)));
  assert.equal(sendLabel([qs[0]], {}), 'Send answer');
});
