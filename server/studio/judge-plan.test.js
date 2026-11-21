import test from 'node:test';
import assert from 'node:assert/strict';
import { realWinners, buildTiles, parseReply, pool, passes } from './judge-plan.js';

const vids = Array.from({ length: 16 }, (_, i) => ({ id: 'v' + i, title: 'Video ' + i, thumb: `research/thumbs/v${i}.jpg`, outlier: 20 - i, views: 1000 * i }));

test('real winners: strongest first, capped, only with a picture', () => {
  const r = realWinners([...vids, { id: 'x', title: 'no pic', outlier: 99 }]);
  assert.equal(r.length, 12);
  assert.equal(r[0].id, 'v0');
  assert.ok(!realWinners([{ ...vids[0], hidden: true }, vids[1]]).some((v) => v.id === 'v0'));
});

test('tiles: numbered from 1, the same seed gives the same order, no counts in them', () => {
  const ours = [{ key: 't1+a', title: 'Mine', file: 'a.png' }];
  const a = buildTiles(ours, realWinners(vids), 5), b = buildTiles(ours, realWinners(vids), 5), c = buildTiles(ours, realWinners(vids), 6);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.map((t) => t.key), c.map((t) => t.key));
  assert.deepEqual(a.map((t) => t.n), Array.from({ length: 13 }, (_, i) => i + 1));
  assert.equal(a.filter((t) => t.kind === 'ours').length, 1);
  assert.ok(!JSON.stringify(a).includes('views'));
});

test('a reply: fenced or bare JSON, scores in range, too few scores is an error', () => {
  const ok = parseReply('Here:\n```json\n{"scores": {"1": 7, "2": 4.25, "3": 6, "4": 5, "5": 11}, "why": {"1": "clear"}}\n```', 5);
  assert.equal(ok.error, undefined);
  assert.equal(ok.scores[1], 7);
  assert.equal(ok.scores[5], undefined);
  assert.equal(parseReply('{"scores": {"1": 5}}', 10).error, 'the judge scored too few tiles');
  assert.ok(parseReply('no idea', 3).error);
});

test('pooling: the mean of the judges, the bar is the 3rd-best real tile, passing is at or above it', () => {
  const tiles = [
    { n: 1, kind: 'real', key: 'a' }, { n: 2, kind: 'real', key: 'b' }, { n: 3, kind: 'real', key: 'c' }, { n: 4, kind: 'real', key: 'd' },
    { n: 5, kind: 'ours', key: 'o1' }, { n: 6, kind: 'ours', key: 'o2' },
  ];
  const mk = (s) => ({ scores: Object.fromEntries(s.map((v, i) => [i + 1, v])), why: {} });
  const r = pool(tiles, [mk([9, 8, 7, 3, 7, 4]), mk([9, 8, 7, 3, 7, 5]), mk([8, 8, 7, 3, 8, 3]), { error: 'x' }]);
  assert.equal(r.judges, 3);
  assert.equal(r.bar, 7);
  const o1 = r.tiles.find((t) => t.key === 'o1'), o2 = r.tiles.find((t) => t.key === 'o2');
  assert.equal(o1.score, 7.3);
  assert.equal(passes(o1, r.bar), true);
  assert.equal(passes(o2, r.bar), false);
  assert.equal(passes(o1, null), null);
  assert.equal(o1.rank, 3);
  assert.equal(pool(tiles.slice(0, 2).concat(tiles.slice(4)), [mk([9, 8, 7, 3])]).bar, null);
});
