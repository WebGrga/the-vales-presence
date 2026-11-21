import test from 'node:test';
import assert from 'node:assert/strict';
import { pieces } from './edl-map.js';
import { joinsOf, joinNear, limits, checkEdge, snapPoints, snapTo, moveEdge, bladeAt, rippleChecks, onFrame } from './edl-trim.js';

const edl = {
  fps: 30, sources: { a: {} },
  items: [
    { src: 'a', src_in: 10, src_out: 12, len: 2 },
    { src: 'a', src_in: 15, src_out: 18, len: 3 },
    { pic_src: 'a', pic_in: 40, pic_out: 52, speed: 4, len: 3 },
    { src: 'a', src_in: 30, src_out: 34, len: 4 },
  ],
};
const ps = pieces(edl);
const words = [{ s: 10.2, e: 10.8, w: 'one' }, { s: 11.0, e: 11.7, w: 'two' }, { s: 15.1, e: 15.5, w: 'three' }, { s: 16.0, e: 17.6, w: 'four' }];

test('joins and which sides can be trimmed', () => {
  const j = joinsOf(ps);
  assert.equal(j.length, 3);
  assert.deepEqual(j[0], { k: 1, t: 2, out: { src: 'a', at: 12 }, in: { src: 'a', at: 15 } });
  assert.equal(j[1].in, null); // a wait has no trimmable start
  assert.equal(j[2].out, null);
  assert.equal(joinNear(ps, 2.05, 0.1).k, 1);
  assert.equal(joinNear(ps, 3, 0.1), null);
});

test('an edge stays clear of the other side when both play the source in order', () => {
  assert.deepEqual(limits(ps, 1, 'out'), [10.04, 15]);
  assert.deepEqual(limits(ps, 1, 'in'), [12, 17.96]);
  assert.deepEqual(limits(ps, 3, 'in'), [0, 33.96]);
  assert.deepEqual(limits(ps, 1, 'out', 14), [10.04, 14]);
});

test('the words say when an edge clips a word or leaves too little room', () => {
  assert.equal(checkEdge(words, 11.3, 'out').level, 'clip');
  assert.match(checkEdge(words, 11.3, 'out').text, /two/);
  assert.equal(checkEdge(words, 11.8, 'out').level, 'tight');
  assert.equal(checkEdge(words, 11.95, 'out').level, null);
  assert.equal(checkEdge(words, 15.08, 'in').level, 'tight');
  assert.equal(checkEdge(words, 15.0, 'in').level, null);
  assert.equal(checkEdge([], 3, 'in').level, null);
});

test('snapping goes to the room after a word, before a word, or the middle of a pause', () => {
  const out = snapPoints(words, 'out', 10, 15);
  assert.ok(out.includes(11.9));
  assert.ok(out.includes(13.4));
  assert.deepEqual(snapTo(11.93, out, 0.05), { t: 11.9, snapped: true });
  assert.equal(snapTo(12.5, out, 0.05).snapped, false);
  assert.ok(snapPoints(words, 'in', 14, 16).includes(15.05));
});

test('moving an edge: on a frame, inside its limits', () => {
  assert.deepEqual(moveEdge(ps, 1, 'out', 1 / 30, 30), { src: 'a', at: 12, side: 'out', to: 12.033, clamped: false });
  const far = moveEdge(ps, 1, 'out', 5, 30);
  assert.equal(far.to, 15); assert.equal(far.clamped, true);
  assert.equal(moveEdge(ps, 2, 'in', 1, 30), null);
  assert.equal(onFrame(1.01, 30), 1);
});

test('the blade and the ripple delete checks', () => {
  assert.deepEqual(bladeAt(ps, 3), { src: 'a', t: 16 });
  assert.match(bladeAt(ps, 6).why, /wait/);
  assert.match(bladeAt(ps, 2.01).why, /join/);
  assert.match(bladeAt(ps, 99).why, /end/);
  const c = rippleChecks(ps, 0.6, 3.2, () => words);
  assert.equal(c.length, 2);
  assert.equal(c[0].level, 'clip');
  assert.deepEqual(rippleChecks(ps, 1.85, 2.9, () => words).map((x) => x.level), ['tight']);
});
