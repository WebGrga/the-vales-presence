// The rules that keep the names of uploads a reload cut off (upload-lost.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { withEntry, withoutEntry, mergeLost } from './upload-lost.js';

test('one entry per project and name; taking it out leaves the rest', () => {
  let l = withEntry([], 'a', 'x.mp4', 10, 1);
  l = withEntry(l, 'a', 'y.mp4', 20, 2);
  l = withEntry(l, 'a', 'x.mp4', 30, 3);
  assert.deepEqual(l.map((e) => [e.name, e.size]), [['y.mp4', 20], ['x.mp4', 30]]);
  assert.deepEqual(withoutEntry(l, 'a', 'y.mp4').map((e) => e.name), ['x.mp4']);
  assert.equal(withoutEntry(l, 'b', 'y.mp4').length, 2);
});

test('what was in flight when the page went away is lost', () => {
  const lost = mergeLost([{ project: 'a', name: 'old.mp4', size: 1, at: 1 }], [{ project: 'a', name: 'new.mp4', size: 2, at: 2 }]);
  assert.deepEqual(lost.map((e) => e.name), ['old.mp4', 'new.mp4']);
});
