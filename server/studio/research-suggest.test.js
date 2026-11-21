// The prompt and reply reading of the agent's phrase suggestions (no agent is called here).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readSuggestion, suggestPrompt } from './research-suggest.js';
import { proposePhrases } from './research-plan.js';

test('reads a JSON array out of a reply, with or without a fence', () => {
  assert.deepEqual(readSuggestion('```json\n["a b", "c d", "a b"]\n```'), ['a b', 'c d']);
  assert.deepEqual(readSuggestion('Here: ["x"] done'), ['x']);
  assert.deepEqual(readSuggestion('nothing'), []);
  assert.deepEqual(readSuggestion('[1, 2]'), []);
});

test('the prompt asks for short, different phrases and names the topic', () => {
  assert.match(suggestPrompt('cats'), /"cats"/);
  assert.match(suggestPrompt('cats'), /different/);
});

test('the free phrases are varied, not the topic plus a suffix', () => {
  const p = proposePhrases('how to edit youtube videos with an AI agent');
  assert.ok(p.length >= 4 && p.every((x) => x.split(' ').length <= 7));
  assert.ok(p.some((x) => /^can /.test(x)) && p.some((x) => /agent for /i.test(x)));
  assert.ok(!p.some((x) => /tutorial|for beginners|explained/.test(x)));
});
