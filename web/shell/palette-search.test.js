import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search } from './palette-search.js';

const items = [
  { id: 'a1', group: 'Actions', label: 'Open the history' },
  { id: 'a2', group: 'Actions', label: 'Stop the agent' },
  { id: 't1', group: 'Tabs', label: 'Go to Studio' },
  { id: 'p1', group: 'Projects', label: 'Open: Podcast episode' },
  { id: 'p2', group: 'Projects', label: 'Open: Hiking vlog' },
  { id: 's1', group: 'Skills', label: 'Skill: rough-cut' },
];

test('a word at the start of a label beats a match inside', () => {
  assert.equal(search(items, 'hist')[0].id, 'a1');
  assert.equal(search(items, 'studio')[0].id, 't1');
});
test('every typed word must match', () => {
  assert.deepEqual(search(items, 'open pod').map((i) => i.id), ['p1']);
  assert.deepEqual(search(items, 'zzz'), []);
});
test('skills and projects are found by their names', () => {
  assert.equal(search(items, 'rough')[0].id, 's1');
  assert.equal(search(items, 'vlog')[0].id, 'p2');
});
test('no query lists each group, actions first', () => {
  const r = search(items, '');
  assert.equal(r[0].group, 'Actions');
  assert.equal(r.length, items.length);
});
