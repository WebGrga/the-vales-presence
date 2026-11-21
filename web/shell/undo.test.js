import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickScope, parseHeader } from './undo.js';

test('Ctrl+Z means the stack of the tab you are on', () => {
  const e = [{ scope: 'a', at: 1 }, { scope: 'context', at: 2 }, { scope: 'b', at: 3 }];
  assert.equal(pickScope(e, 'context', 'a'), 'context');
  assert.equal(pickScope(e, 'studio', 'a'), 'a');
  assert.equal(pickScope(e, 'export', 'a'), 'context'); // the newest change that belongs here (b is another project)
  assert.equal(pickScope([], 'export', 'a'), null);
});

test('the header is read, a bad one is ignored', () => {
  const v = encodeURIComponent(JSON.stringify({ scope: 'a', label: 'Picked a title', at: 5 }));
  assert.deepEqual(parseHeader(v), { scope: 'a', label: 'Picked a title', at: 5 });
  assert.equal(parseHeader('%zz'), null);
  assert.equal(parseHeader(null), null);
});
