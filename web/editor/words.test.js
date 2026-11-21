import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTsv, fromRoughWords, tokens, blocks, selectionActions, tokenAt } from './words.js';
import { pieces } from './edl-map.js';

const words = parseTsv('1.0\t1.4\tone\n1.5\t2.0\ttwo\r\n2.1\t2.5\tthree\nbad line\n3.5\t4.0\tfour\n5.0\t5.4\tfive\n');
const ps = pieces({ items: [{ src: 'a', src_in: 0.9, src_out: 2.6, len: 1.7 }, { src: 'a', src_in: 4.9, src_out: 6, len: 1.1 }] });
const cuts = [{ id: 'c1', src: 'a', from: 2.6, to: 4.9 }];

test('word files and rough words', () => {
  assert.equal(words.length, 5); assert.deepEqual(words[1], { s: 1.5, e: 2, w: 'two' });
  const r = fromRoughWords({ words: [[0, 0.4, 'x', 'a', 10], [1, 1.2, 'y', 'b', 3]] }, 'a');
  assert.deepEqual(r, [{ s: 10, e: 10.4, w: 'x' }]);
});

test('every word gets its state', () => {
  const t = tokens('a', words, ps, cuts, [['a', 1.45, 2.05]]);
  assert.deepEqual(t.map((x) => x.state), ['in', 'in', 'in', 'cut', 'in']);
  assert.equal(t[3].cut, 'c1'); assert.equal(t[4].t, 1.8);
  const ps2 = pieces({ items: [{ src: 'a', src_in: 0.9, src_out: 1.45, len: 0.55 }, { src: 'a', src_in: 2.05, src_out: 2.6, len: 0.55 }] });
  const t2 = tokens('a', words, ps2, cuts, [['a', 1.45, 2.05]]);
  assert.equal(t2[1].state, 'struck'); assert.equal(t2[4].state, 'out');
});

test('blocks fold long unused runs and break at pauses', () => {
  const toks = [...Array(5)].map((_, k) => ({ k, s: k, e: k + 0.5, state: k < 3 ? 'out' : 'in' }));
  const b = blocks(toks, { foldOver: 2, gap: 5 });
  assert.deepEqual(b.map((x) => x.type), ['fold', 'para']);
  assert.equal(b[0].tokens.length, 3);
  const c = blocks(toks.map((x) => ({ ...x, state: 'in' })), { gap: 0.4 });
  assert.equal(c.length, 5);
});

test('a selection becomes strikes, unstrikes and restores', () => {
  const t = tokens('a', words, ps, cuts, []);
  t[2] = { ...t[2], state: 'struck' };
  const a = selectionActions(t, words, [0, 1, 2, 3]);
  assert.deepEqual(a.strike, [['a', 0.97, 2.05]]);
  assert.deepEqual(a.unstrike, [['a', 2.07, 3.44]]);
  assert.deepEqual(a.restore, ['c1']);
});

test('the word playing now', () => {
  const t = tokens('a', words, ps, cuts, []);
  assert.equal(tokenAt(t, 0.7), 1); assert.equal(tokenAt(t, 0), -1); assert.equal(tokenAt(t, 99), 4);
});
