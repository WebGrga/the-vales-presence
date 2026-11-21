import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanAnswers, NO_ANSWER } from './agent.js';

const qs = [{ question: 'How long?' }, { question: 'What must stay?' }, { question: 'Captions?' }];

test('answers as one set: every waiting question gets a string', () => {
  assert.deepEqual(cleanAnswers({ 'How long?': ' Short ', 'What must stay?': ['Intro', ' Demo', ''], 'Other?': 'x' }, qs),
    { answers: { 'How long?': 'Short', 'What must stay?': 'Intro, Demo', 'Captions?': NO_ANSWER } });
});

test('nothing answered, or not an object, is refused', () => {
  assert.ok(cleanAnswers({}, qs).error);
  assert.ok(cleanAnswers({ 'How long?': '  ' }, qs).error);
  assert.ok(cleanAnswers(null, qs).error);
  assert.ok(cleanAnswers(['a'], qs).error);
});

test('without the questions, the answers given are kept', () => {
  assert.deepEqual(cleanAnswers({ a: 'b', c: '' }, null), { answers: { a: 'b' } });
  assert.equal(cleanAnswers({ 'How long?': 'x'.repeat(5000) }, qs).answers['How long?'].length, 4000);
});
