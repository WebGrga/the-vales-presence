import test from 'node:test';
import assert from 'node:assert/strict';
import { median, outlierScore, channelMedian, fromYtDlp, parseVideos, features, patterns } from './research.js';

test('median of odd, even and empty lists', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), undefined);
  assert.equal(median([NaN, 5]), 5);
});

test('outlier score is views over the channel median', () => {
  assert.equal(outlierScore(50000, 10000), 5);
  assert.equal(outlierScore(12345, 10000), 1.2);
  assert.equal(outlierScore(100, 0), undefined);
  assert.equal(outlierScore(undefined, 10), undefined);
});

test('the channel median leaves out the scored video and needs three others', () => {
  assert.equal(channelMedian([100, 200, 300, 9000], 9000), 200);
  assert.equal(channelMedian([100, 9000], 9000), undefined);
});

test('yt-dlp entries become video records', () => {
  const v = fromYtDlp({ id: 'abcDEF12345', title: ' A title ', channel: 'Chan', channel_id: 'UC1', view_count: 1200, duration: 61, upload_date: '20260101' });
  assert.deepEqual(v, { id: 'abcDEF12345', url: 'https://www.youtube.com/watch?v=abcDEF12345', title: 'A title', source: 'search', channel: 'Chan', channelId: 'UC1', views: 1200, duration: 61, published: '20260101' });
  assert.equal(fromYtDlp({ id: '../x', title: 't' }), null);
  assert.equal(fromYtDlp({ id: 'abcDEF12345' }), null);
});

test('parseVideos cleans, scores and sorts', () => {
  const r = parseVideos({ query: 'q', videos: [
    { id: 'a', title: 'A', views: 100, channelMedian: 100 },
    { id: 'b', title: 'B', views: 900, channelMedian: 100 },
    { id: 'b', title: 'dup' },
    { id: 'c' },
    { id: 'd', title: 'D', views: 'lots' },
  ] });
  assert.deepEqual(r.videos.map((v) => v.id), ['b', 'a', 'd']);
  assert.equal(r.videos[0].outlier, 9);
  assert.equal(r.videos[2].views, undefined);
  assert.equal(r.query, 'q');
  assert.deepEqual(parseVideos(null).videos, []);
});

test('title features', () => {
  const f = features('I Built 3 Apps in 24 hours: HERE is How?');
  assert.equal(f.number, true); assert.equal(f.time, true); assert.equal(f.caps, true); assert.equal(f.question, true);
  assert.equal(f.firstPerson, true); assert.equal(f.how, true); assert.equal(f.twoPart, true); assert.equal(f.money, false);
  assert.equal(f.words, 10);
  assert.equal(features('$500 vs nothing').money, true);
  assert.equal(features('$500 vs nothing').versus, true);
});

test('patterns compare the top videos with all of them', () => {
  const vids = [
    { title: 'I tried 5 robots for 30 days', outlier: 6 },
    { title: 'I built 3 robots in a week', outlier: 4 },
    { title: 'My robots took over in 7 days', outlier: 3 },
    { title: 'robot review', outlier: 0.5 },
    { title: 'another robot review', outlier: 0.4 },
    { title: 'thoughts on robots', outlier: 0.8 },
  ];
  const p = patterns(vids);
  assert.equal(p.topCount, 3);
  assert.equal(p.topRule, 'outlier ≥ 2×');
  const num = p.features.find((f) => f.key === 'number');
  assert.deepEqual([num.top, num.all], [100, 50]);
  assert.equal(p.features[0].top - p.features[0].all >= num.top - num.all, true);
  assert.ok(p.common.some((w) => w.word === 'robots'));
  assert.equal(patterns([]), null);
});

test('patterns fall back to the top third without scores of 2', () => {
  const p = patterns([{ title: 'a b', outlier: 1.5 }, { title: 'c', outlier: 1 }, { title: 'd', outlier: 0.5 }]);
  assert.equal(p.topCount, 1);
  assert.equal(p.topRule, 'top third by outlier');
});

test('merging keeps hand-added notes and takes new numbers', async () => {
  const { mergeVideos } = await import('./research.js');
  const m = mergeVideos([{ id: 'a', title: 'A', views: 1, note: 'mine' }, { id: 'b', title: 'B' }], [{ id: 'a', title: 'A', views: 5, outlier: undefined }, { id: 'c', title: 'C' }]);
  assert.deepEqual(m, [{ id: 'a', title: 'A', views: 5, note: 'mine' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }]);
});
