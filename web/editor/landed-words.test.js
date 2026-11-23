import { test } from 'node:test';
import assert from 'node:assert/strict';
import { landedWords } from './landed-words.js';

test('the newest render wins the words, and only live news is told', () => {
  assert.equal(landedWords(['video/out/events.json', 'video/out/final.mp4'], true), 'The final render is ready');
  assert.equal(landedWords(['video\\out\\proof.mp4'], true), 'The proof is ready');
  assert.equal(landedWords(['video/out/proof.mp4'], false), null);
  assert.equal(landedWords(['notes.md'], true), null);
});
