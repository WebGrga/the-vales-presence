import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explain } from './tab-fail.js';

test('a file that cannot be fetched says the server may have stopped', () => {
  const e = explain('Studio', 'load', new TypeError('Failed to fetch dynamically imported module: http://x/studio/index.js'));
  assert.equal(e.title, 'Studio did not load');
  assert.match(e.why, /server/);
  assert.match(e.hint, /Retry/);
});
test('a mistake in the file and a throw while opening are told apart', () => {
  assert.match(explain('Export', 'load', new SyntaxError('Unexpected token }')).why, /mistake/);
  assert.match(explain('Export', 'mount', new Error('boom')).why, /stopped with: boom/);
  assert.equal(explain('Export', 'mount', new Error('boom')).title, 'Export could not open');
});
test('a module without mount() is not "coming soon"', () => {
  const e = explain('Shorts', 'shape');
  assert.doesNotMatch(JSON.stringify(e), /coming soon/i);
});
