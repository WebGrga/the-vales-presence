import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewItems } from './cuts-items.js';
import { phonePanel, PANELS } from './layout.js';

test('the agent’s review items, in time order', () => {
  const items = reviewItems({ items: [
    { at: 76, text: 'Listen to this join', kind: 'Listen', from: 'rough' },
    { text: 'The video is 15 s over the brief', kind: 'length' },
    { start: '12.5', end: 20, title: 'Private numbers on screen', text: 'Blur the CTR', id: 'p1' },
    { at: 3 }, null,
  ] });
  assert.deepEqual(items.map((x) => [x.id, x.at, x.end, x.kind]), [['p1', 12.5, 20, ''], ['r1', 76, null, 'listen'], ['r2', null, null, 'length']]);
  assert.equal(items[0].title, 'Private numbers on screen'); assert.equal(items[0].text, 'Blur the CTR');
  assert.deepEqual(reviewItems([{ at: 1, text: 'a' }]).map((x) => x.text), ['a']);
  assert.deepEqual(reviewItems(null), []);
  // the route's shape: to, source, done (looked-at ones go last)
  const r = reviewItems({ items: [{ id: 'a', at: 5, to: 9, text: 'x', source: 'inspect', done: true }, { id: 'b', at: 50, text: 'y' }] });
  assert.deepEqual(r.map((x) => [x.id, x.end, x.from, x.done]), [['b', null, '', false], ['a', 9, 'inspect', true]]);
});

test('the phone shows one panel, Cuts unless another was picked', () => {
  assert.equal(phonePanel(null), 'cuts'); assert.equal(phonePanel('agent'), 'agent'); assert.equal(phonePanel('nope'), 'cuts');
  assert.ok(PANELS.some((p) => p.id === 'tl'));
});
