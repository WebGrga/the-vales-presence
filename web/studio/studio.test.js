import test from 'node:test';
import assert from 'node:assert/strict';
import { views, duration, ago, outlierLabel, titleLength, words, readMinutes, fileUrl } from './format.js';
import { ourPairs, slotsFor, mixFeed } from './feed-mix.js';

test('views read like a feed', () => {
  assert.equal(views(940), '940 views');
  assert.equal(views(1), '1 view');
  assert.equal(views(12345), '12K views');
  assert.equal(views(1250000), '1.2M views');
  assert.equal(views(4634591, false), '4.6M');
  assert.equal(views(undefined), '');
});

test('durations and ages', () => {
  assert.equal(duration(65), '1:05');
  assert.equal(duration(3725), '1:02:05');
  assert.equal(duration(0), '');
  const now = Date.UTC(2026, 10, 20);
  assert.equal(ago('20261113', now), '1 week ago');
  assert.equal(ago('20250101', now), '1 year ago');
  assert.equal(ago('2026-11-20T00:00:00Z', now), 'just now');
  assert.equal(ago('', now), '');
});

test('outlier labels and title lengths', () => {
  assert.deepEqual(outlierLabel(93), { text: '93×', level: 'big' });
  assert.deepEqual(outlierLabel(2.34), { text: '2.3×', level: 'high' });
  assert.equal(outlierLabel(0.5).level, 'low');
  assert.equal(outlierLabel(undefined).text, '?');
  assert.equal(titleLength('x'.repeat(40)).level, 'ok');
  assert.equal(titleLength('x'.repeat(60)).level, 'edge');
  assert.equal(titleLength('x'.repeat(80)).level, 'long');
  assert.equal(words("It's a two-part test, ok"), 5);
  assert.equal(readMinutes('w '.repeat(300)), 2);
  assert.equal(fileUrl('p 1', 'thumbs/a b.png', 12.4), '/api/studio/p%201/file/thumbs/a%20b.png?v=12');
});

const T = { options: [{ id: 't1', title: 'One' }, { id: 't2', title: 'Two' }, { id: 't3', title: 'Three', hidden: true }], shortlist: [], picked: null };
const H = { options: [{ id: 'a', file: 'a.png' }, { id: 'b', file: 'b.png', title: 't2' }, { id: 'c', file: 'c.png' }], shortlist: [], picked: null };

test('our pairs: a thumbnail made for a title goes with it, the rest cross the shortlist', () => {
  const p = ourPairs(T, H);
  assert.deepEqual(p.map((x) => x.key), ['t2+b', 't1+a', 't1+c', 't2+a', 't2+c']);
  const q = ourPairs({ ...T, shortlist: ['t1'] }, { ...H, picked: 'a' });
  assert.deepEqual(q.map((x) => x.key), ['t1+a']);
  assert.deepEqual(ourPairs({ options: [] }, H), []);
  assert.equal(ourPairs(T, H, 2).length, 2);
});

test('slots spread ours out and leave the first tile real', () => {
  for (const seed of [1, 2, 3, 'x']) {
    const s = slotsFor(12, 3, seed);
    assert.equal(s.length, 3);
    assert.ok(s[0] >= 1);
    for (let i = 1; i < s.length; i++) assert.ok(s[i] - s[i - 1] >= 2, `${seed}: ${s}`);
  }
  assert.deepEqual(slotsFor(12, 3, 7), slotsFor(12, 3, 7));
  assert.deepEqual(slotsFor(2, 0, 1), []);
  assert.deepEqual(slotsFor(2, 5, 1), [0, 1]);
});

test('the feed mixes the strongest real videos with ours', () => {
  const real = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, title: `R${i}`, thumb: 'x.jpg', outlier: i }));
  real.push({ id: 'nopic', title: 'no picture', outlier: 99 });
  const ours = ourPairs(T, { ...H, shortlist: ['a', 'c'] });
  const f = mixFeed(real, ours, { total: 12, seed: 3 });
  assert.equal(f.length, 12);
  assert.equal(f.filter((t) => t.kind === 'ours').length, ours.length);
  assert.ok(!f.some((t) => t.video?.id === 'nopic'));
  const realIds = f.filter((t) => t.kind === 'real').map((t) => Number(t.video.id.slice(1)));
  assert.ok(realIds.every((n) => n >= 20 - realIds.length));
  assert.deepEqual(mixFeed(real, ours, { seed: 3 }), f);
  assert.equal(mixFeed([], ours).length, ours.length);
});
