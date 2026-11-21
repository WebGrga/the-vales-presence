import test from 'node:test';
import assert from 'node:assert/strict';
import { readItems, markers, markerAt, tipOf } from './timeline-marks.js';

test('review items in any shape', () => {
  const a = readItems({ items: [{ at: 76, text: 'listen to the join', kind: 'rough' }, { t: 5, title: 'Private', note: 'a path on screen', end: 9 }, { text: 'no time' }, null] });
  assert.deepEqual(a.map((x) => [x.at, x.end, x.text, x.kind]), [[5, 9, 'Private: a path on screen', 'review'], [76, null, 'listen to the join', 'rough']]);
  assert.equal(readItems([{ at: 1 }])[0].text, 'Look here');
  assert.deepEqual(readItems(null), []);
});

test('markers: review items moved onto the working list, and flagged cuts', () => {
  const items = readItems([{ id: 'a', at: 10, text: 'x' }, { id: 'b', at: 20, text: 'gone' }, { id: 'c', at: 30, text: 'ok', done: true }]);
  const move = (t) => (t === 20 ? null : t - 1);
  const cuts = [{ id: 'c1', flag: true, kind: 'retake', ask: 'which take?' }, { id: 'c2', flag: false }];
  const m = markers(items, cuts, move, () => 15);
  assert.deepEqual(m.map((x) => [x.id, x.t, x.kind]), [['a', 9, 'review'], ['c1', 15, 'flag'], ['c', 29, 'done']]);
  assert.match(m[1].text, /which take/);
  assert.equal(markerAt(m, 152, (t) => t * 10).id, 'c1');
  assert.equal(markerAt(m, 120, (t) => t * 10), null);
  assert.equal(tipOf(m[0], (t) => `${t}s`), '9s · x');
});
