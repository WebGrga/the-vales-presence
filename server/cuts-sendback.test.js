// The rules after a send-back of the rough: the working list goes with the review, and a stale one binds nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendingChoices, baseMark, isStale, sendbackArchive, archivedName } from './cuts.js';
import { baseMark as screenMark } from '../web/editor/edl-edit.js';

const edl1 = { total: 200.5, items: [{}, {}, {}] };
const edl2 = { total: 214.2, items: [{}, {}, {}, {}] };
const working = (edl, strikes) => ({ items: [], working: { base: baseMark(edl), restored: [], strikes } });

test('the server marks an edit list the same way as the screen', () => {
  assert.equal(baseMark(edl1), screenMark(edl1));
  assert.equal(baseMark({}), screenMark({}));
});

test('strikes made on an older rough do not block the lock; on this rough they do', () => {
  const w = working(edl1, [['r1', 10, 11]]);
  assert.equal(isStale(w, edl1), false);
  assert.equal(isStale(w, edl2), true);
  assert.equal(pendingChoices({}, w, edl2), null);
  assert.equal(pendingChoices({}, w, edl1).strikes, 1);
  // no edl given: as before, every strike counts
  assert.equal(pendingChoices({}, w).strikes, 1);
  // restores count whatever the working list
  assert.deepEqual(pendingChoices({ c5: { keep: false } }, w, edl2).restored, ['c5']);
  assert.equal(pendingChoices({ c5: { keep: true } }, null, edl2), null);
});

test('a send-back to the rough puts the review and the working list aside together; a later one keeps both', () => {
  assert.deepEqual(sendbackArchive({ targetIndex: 1, makerIndex: 1, hasReview: true, hasWorking: true }), ['cuts-review.json', 'edl.working.json']);
  assert.deepEqual(sendbackArchive({ targetIndex: 0, makerIndex: 1, hasReview: false, hasWorking: true }), ['edl.working.json']);
  assert.deepEqual(sendbackArchive({ targetIndex: 3, makerIndex: 1, hasReview: true, hasWorking: true }), []);
  assert.deepEqual(sendbackArchive({ targetIndex: 3, makerIndex: -1, hasReview: true, hasWorking: false }), ['cuts-review.json']);
  assert.equal(archivedName('edl.working.json', 42), 'edl.working.sent-42.json');
});

test('joins moved on the timeline block the lock like strikes; blades do not', () => {
  const w = { items: [], working: { base: baseMark(edl1), strikes: [], trims: [{ at: 1 }, { at: 2 }], blades: [{ at: 3 }] } };
  const p = pendingChoices({}, w, edl1);
  assert.equal(p.trims, 2);
  assert.match(p.message, /you moved 2 joins/);
  assert.equal(pendingChoices({}, { working: { base: baseMark(edl1), blades: [{ at: 3 }] } }, edl1), null);
  assert.match(pendingChoices({ c1: { keep: false } }, { working: { base: baseMark(edl1), strikes: [['a', 1, 2]], trims: [{}] } }, edl1).message, /you restored c1, you struck 1 stretch of words and you moved 1 join/);
});
