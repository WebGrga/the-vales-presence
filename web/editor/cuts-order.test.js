import test from 'node:test';
import assert from 'node:assert/strict';
import { groupCuts, listOrder, stepCut, countLine, choicesText, notesWithChoices, restoredIds, cutAtSource } from './cuts-order.js';

const cuts = [
  { id: 'c3', at: 30, kind: 'pause', src: 'a', from: 50, to: 51 },
  { id: 'c1', at: 5, kind: 'filler', removed: 'well   you know', src: 'a', from: 8, to: 9 },
  { id: 'c2', at: 12, kind: 'retake', flag: true, src: 'a', from: 20, to: 25 },
  { id: 'c4', at: 40, kind: 'other', src: 'a', from: 60, to: 61, jump: 'back' },
];

test('flagged first, then the others, small pauses last, each in time order', () => {
  const g = groupCuts(cuts);
  assert.deepEqual(g.flagged.map((c) => c.id), ['c2']);
  assert.deepEqual(g.others.map((c) => c.id), ['c1', 'c4']);
  assert.deepEqual(g.pauses.map((c) => c.id), ['c3']);
  assert.deepEqual(listOrder(g).map((c) => c.id), ['c2', 'c1', 'c4', 'c3']);
  assert.deepEqual(groupCuts(null), { flagged: [], others: [], pauses: [] });
});

test('stepping through the list', () => {
  const o = listOrder(groupCuts(cuts));
  assert.equal(stepCut(o, null, 1).id, 'c2');
  assert.equal(stepCut(o, null, -1).id, 'c3');
  assert.equal(stepCut(o, 'c2', 1).id, 'c1');
  assert.equal(stepCut(o, 'c3', 1).id, 'c3');
  assert.equal(stepCut([], 'c3', 1), null);
});

test('the count line and the notes', () => {
  const review = { c1: { keep: false, note: 'say it' }, c2: { keep: true }, c3: { note: ' keep the breath ' } };
  assert.equal(countLine(cuts, review), '4 cuts · 1 flagged · 1 kept · 1 to restore · 2 noted');
  assert.equal(countLine([], {}), '0 cuts');
  assert.equal(choicesText(cuts, review), 'Restore c1 ("well you know"): say it; c3: keep the breath');
  assert.deepEqual(restoredIds(cuts, review), ['c1']);
  assert.equal(notesWithChoices('  tighter please ', cuts, {}, []), 'tighter please');
  assert.equal(notesWithChoices('', cuts, review, [['a', 1, 2]]), 'On the cuts: Restore c1 ("well you know"): say it; c3: keep the breath.\n\nI struck 1 more stretch in the transcript (in video/out/edl.working.json).');
});

test('the cut that removed a source time', () => {
  assert.equal(cutAtSource(cuts, 'a', 22).id, 'c2');
  assert.equal(cutAtSource(cuts, 'a', 60.5), null); // a jump removes nothing
  assert.equal(cutAtSource(cuts, 'b', 22), null);
});
