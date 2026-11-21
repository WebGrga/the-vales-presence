import test from 'node:test';
import assert from 'node:assert/strict';
import { pieces, total, pieceAt, toSource, toEdit, edges, nextEdge, sourceFile, wordsFile } from './edl-map.js';

const edl = {
  sources: { a: { file: 'footage/a.mkv', words: 'out/work/words-a.tsv' } },
  items: [
    { kind: 'S', src: 'a', src_in: 10, src_out: 12, len: 2, at: 0 },
    { kind: 'S', src: 'a', src_in: 15, src_out: 18, len: 3, at: 2, cut_before: { kind: 'pause', flag: true } },
    { kind: 'W', pic_src: 'a', pic_in: 20, pic_out: 32, speed: 4, len: 3 },
    { kind: 'S', pic_src: 'a', pic_in: 40, len: 1 },
    { kind: 'S', color: '#000', len: 0.5 },
  ],
};

test('pieces are back to back with their types', () => {
  const ps = pieces(edl);
  assert.deepEqual(ps.map((p) => p.type), ['play', 'play', 'wait', 'hold', 'card']);
  assert.deepEqual(ps.map((p) => p.at), [0, 2, 5, 8, 9]);
  assert.equal(total(ps), 9.5);
  assert.equal(ps[2].rate, 4); assert.equal(ps[3].rate, 0); assert.equal(ps[1].cut.flag, true);
});

test('which piece plays at t, and the source time', () => {
  const ps = pieces(edl);
  assert.equal(pieceAt(ps, 0), 0); assert.equal(pieceAt(ps, 1.99), 0); assert.equal(pieceAt(ps, 2), 1); assert.equal(pieceAt(ps, 99), 4);
  assert.deepEqual(toSource(ps, 3), { i: 1, media: 'a', time: 16, type: 'play' });
  assert.equal(toSource(ps, 6).time, 24); // a wait at 4x
  assert.equal(toSource(ps, 8.7).time, 40); // a still holds
  assert.equal(pieceAt([], 1), -1); assert.equal(toSource([], 1), null);
});

test('source time back to edit time; left-out source is null', () => {
  const ps = pieces(edl);
  assert.equal(toEdit(ps, 'a', 11), 1);
  assert.equal(toEdit(ps, 'a', 16.5), 3.5);
  assert.equal(toEdit(ps, 'a', 13), null);
  assert.equal(toEdit(ps, 'a', 24), 6); // inside the sped wait
  assert.equal(toEdit(ps, 'b', 11), null);
});

test('edges and stepping between them', () => {
  const ps = pieces(edl), e = edges(ps);
  assert.deepEqual(e.map((x) => x.at), [2, 5, 8, 9]);
  assert.equal(e[0].cut.kind, 'pause');
  const at = e.map((x) => x.at);
  assert.equal(nextEdge(at, 2, 1), 5); assert.equal(nextEdge(at, 2, -1), null); assert.equal(nextEdge(at, 6, -1), 5); assert.equal(nextEdge(at, 9, 1), null);
});

test('files are relative to the project', () => {
  assert.equal(sourceFile(edl, 'a'), 'video/footage/a.mkv');
  assert.equal(wordsFile(edl, 'a'), 'video/out/work/words-a.tsv');
  assert.equal(sourceFile(edl, 'zz'), null);
});
