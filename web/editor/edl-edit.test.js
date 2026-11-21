import test from 'node:test';
import assert from 'node:assert/strict';
import { boundaryOf, restoreCuts, strikeItems, retime, workingEdl, cleanStrikes, unstrike, strikeRange, restorable, editRangeStrikes } from './edl-edit.js';

const base = {
  version: 2, fps: 30, total: 9,
  sources: { a: { file: 'footage/a.mkv' } },
  items: [
    { kind: 'S', src: 'a', src_in: 10, src_out: 12, pic_in: 10, len: 2, at: 0 },
    { kind: 'S', src: 'a', src_in: 15, src_out: 18, pic_in: 15, len: 3, at: 2, cut_before: { kind: 'retake' } },
    { kind: 'S', src: 'a', src_in: 30, src_out: 34, pic_in: 30, len: 4, at: 5, cut_before: { kind: 'pause' } },
  ],
};
const cuts = [
  { id: 'c1', at: 2, src: 'a', from: 12, to: 15 },
  { id: 'c2', at: 5, src: 'a', from: 18, to: 30 },
  { id: 'c3', at: 5, src: 'b', from: 1, to: 2, jump: 'source' },
];

test('a cut is found by its source edges', () => {
  assert.equal(boundaryOf(base.items, cuts[0]), 1);
  assert.equal(boundaryOf(base.items, cuts[1]), 2);
  assert.equal(boundaryOf(base.items, cuts[2]), -1);
  assert.equal(restorable(base.items, { id: 'x', src: 'a', from: 11, to: 15 }), false);
});

test('restoring joins the two pieces', () => {
  const items = restoreCuts(base.items, cuts, ['c1']);
  assert.equal(items.length, 2);
  assert.deepEqual([items[0].src_in, items[0].src_out, items[0].len], [10, 18, 8]);
  const both = restoreCuts(base.items, cuts, ['c1', 'c2']);
  assert.equal(both.length, 1); assert.equal(both[0].src_out, 34); assert.equal(both[0].len, 24);
});

test('a strike splits a piece and marks the new cut as yours', () => {
  const items = strikeItems(base.items, 'a', 16, 17);
  assert.equal(items.length, 4);
  assert.deepEqual([items[1].src_in, items[1].src_out], [15, 16]);
  assert.deepEqual([items[2].src_in, items[2].src_out, items[2].pic_in], [17, 18, 17]);
  assert.equal(items[2].cut_before.by, 'you');
  assert.equal(strikeItems(base.items, 'a', 9, 13).length, 2); // the whole first piece goes
  assert.equal(strikeItems(base.items, 'b', 9, 13).length, 3);
});

test('retime puts the pieces back to back', () => {
  const t = retime([{ len: 1.5 }, { len: 2 }]);
  assert.deepEqual(t.items.map((x) => x.at), [0, 1.5]); assert.equal(t.total, 3.5);
});

test('the working list keeps its choices to read back', () => {
  const w = workingEdl(base, cuts, { restored: ['c1', 'nope'], strikes: [['a', 31, 32]] });
  assert.deepEqual(w.working.restored, ['c1']);
  assert.deepEqual(w.working.strikes, [['a', 31, 32]]);
  assert.equal(w.items.length, 3);
  assert.equal(w.total, 8 + 1 + 2);
  assert.equal(w.sources.a.file, 'footage/a.mkv');
  assert.equal(base.items.length, 3); // the base is untouched
});

test('strikes merge, and unstrike gives words back', () => {
  assert.deepEqual(cleanStrikes([['a', 5, 6], ['a', 1, 2], ['a', 1.5, 3], ['b', 0, 1], ['a', 4, 3], 'x']), [['a', 1, 3], ['a', 5, 6], ['b', 0, 1]]);
  assert.deepEqual(unstrike([['a', 1, 5]], 'a', 2, 3), [['a', 1, 2], ['a', 3, 5]]);
  assert.deepEqual(unstrike([['a', 1, 5]], 'a', 0, 9), []);
});

test('a strike range runs from just before the words to just before the next word', () => {
  const words = [{ s: 1, e: 1.4 }, { s: 1.5, e: 2 }, { s: 2.1, e: 2.5 }, { s: 3.5, e: 4 }];
  assert.deepEqual(strikeRange(words, 1, 2), [1.47, 3.44]);
  assert.deepEqual(strikeRange(words, 3, 3), [3.47, 4.05]);
  assert.deepEqual(strikeRange(words, 0, 0), [0.97, 1.45]);
});

test('In to Out becomes the source stretches it plays', async () => {
  const { pieces } = await import('./edl-map.js');
  const ps = pieces(base);
  assert.deepEqual(editRangeStrikes(ps, 1, 3), [['a', 11, 12], ['a', 15, 16]]);
  assert.deepEqual(editRangeStrikes(ps, 3, 1), [['a', 11, 12], ['a', 15, 16]]);
  assert.deepEqual(editRangeStrikes(ps, 1.99, 2.0), []);
});

test('a blade splits a piece without removing anything', async () => {
  const { bladeItems, cleanBlades } = await import('./edl-edit.js');
  const items = bladeItems(base.items, 'a', 16.5);
  assert.equal(items.length, 4);
  assert.deepEqual([items[1].src_out, items[2].src_in, items[2].pic_in, items[2].cut_before.why], [16.5, 16.5, 16.5, 'blade']);
  assert.equal(items[1].len + items[2].len, 3);
  assert.equal(bladeItems(base.items, 'a', 15.01).length, 3); // too near an edge
  assert.deepEqual(cleanBlades([['a', 2], ['a', 2], ['a', 1], ['x'], ['b', 'z']]), [['a', 1], ['a', 2]]);
  const w = workingEdl(base, cuts, { blades: [['a', 16.5]] });
  assert.equal(w.total, 9);
  assert.deepEqual(w.working.blades, [['a', 16.5]]);
  assert.equal('trims' in w.working, false);
});

test('a trim moves one side of a join, and moving it again updates the same trim', async () => {
  const { trimItems, setTrim } = await import('./edl-edit.js');
  const out = trimItems(base.items, { src: 'a', at: 12, side: 'out', to: 12.5 });
  assert.deepEqual([out[0].src_out, out[0].len], [12.5, 2.5]);
  assert.equal(out[1].cut_before.trimmed, true);
  const inn = trimItems(base.items, { src: 'a', at: 15, side: 'in', to: 15.25 });
  assert.deepEqual([inn[1].src_in, inn[1].pic_in, inn[1].len], [15.25, 15.25, 2.75]);
  assert.equal(trimItems(base.items, { src: 'a', at: 15, side: 'in', to: 18 }), base.items); // would leave nothing
  assert.equal(trimItems(base.items, { src: 'a', at: 99, side: 'in', to: 1 }), base.items);
  let t = setTrim([], { src: 'a', at: 12, side: 'out', to: 12.1 });
  t = setTrim(t, { src: 'a', at: 12.1, side: 'out', to: 12.2 });
  assert.deepEqual(t, [{ src: 'a', at: 12, side: 'out', to: 12.2 }]);
  assert.deepEqual(setTrim(t, { src: 'a', at: 12.2, side: 'out', to: 12 }), []);
  const w = workingEdl(base, cuts, { trims: t, blades: [['a', 31]] });
  assert.equal(w.total, 9.2);
  assert.deepEqual(w.working.trims, t);
});

test('a list with no blades or trims is the same as before', () => {
  const w = workingEdl(base, cuts, { restored: ['c1'], strikes: [] });
  assert.deepEqual(Object.keys(w.working), ['base', 'restored', 'strikes']);
});
