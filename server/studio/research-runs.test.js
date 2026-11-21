import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { saveRun, setCurrent, setMark, readResearch, listRuns } from './research-runs.js';
import { proposePhrases, cleanPhrases, channelUrl, cleanOptions } from './research-plan.js';
import { tierOf, sampleChannel } from './research.js';

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'runs-'));
const v = (id, views, median = 1000) => ({ id, title: `Title ${id}`, views, channelMedian: median });

test('tiers: top at 2x, flop under half, typical between', () => {
  assert.deepEqual([3, 2, 1, 0.5, 0.4, undefined].map(tierOf), ['top', 'top', 'typical', 'typical', 'flop', undefined]);
});

test('a channel sample brings typical and flop videos, not only hits', () => {
  const vids = [9000, 5000, 1100, 1000, 900, 800, 300, 200, 100].map((n, i) => ({ id: `v${i}aaaaa`, title: `t${i}`, views: n }));
  const s = sampleChannel(vids, { typical: 2, flop: 2 });
  assert.equal(s.filter((x) => x.outlier < 0.5).length, 2);
  assert.equal(s.filter((x) => x.outlier >= 0.5 && x.outlier < 2).length, 2);
});

test('phrases: proposed from the topic, cleaned, capped and without doubles', () => {
  assert.equal(proposePhrases('')[0], undefined);
  assert.equal(proposePhrases('Brief: build a bot')[0], 'build a bot');
  assert.ok(proposePhrases('how to bake').every((p) => !p.startsWith('how to how')));
  assert.deepEqual(cleanPhrases([' a  b ', 'A B', '', 'c']), ['a b', 'c']);
  assert.equal(cleanPhrases(Array.from({ length: 20 }, (_, i) => `p${i}`)).length, 8);
});

test('channels: handles, links and ids become the page of videos; anything else is dropped', () => {
  assert.equal(channelUrl('@abc'), 'https://www.youtube.com/@abc/videos');
  assert.equal(channelUrl('https://www.youtube.com/@abc/videos'), 'https://www.youtube.com/@abc/videos');
  assert.equal(channelUrl('youtube.com/channel/UCabcdefghijklmnopqrstuv'), 'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv/videos');
  assert.equal(channelUrl('https://evil.example/@abc'), null);
  assert.deepEqual(cleanOptions({ channels: 'nonsense, @ok_one', when: 'decade', language: 'xx yy' }), { channels: ['@ok_one'], when: 'any', language: '', n: 20 });
});

test('runs are kept, switched, merged and marked; the current file follows; nothing is overwritten', async () => {
  const dir = await tmp();
  const a = await saveRun(dir, { phrases: ['one'], at: '2026-01-01T10:00:00Z', videos: [v('aaaaaa1', 5000), v('bbbbbb2', 100)] });
  const b = await saveRun(dir, { phrases: ['two'], at: '2026-01-02T10:00:00Z', videos: [v('cccccc3', 3000)] });
  assert.equal((await listRuns(dir)).length, 2);
  let r = await readResearch(dir);
  assert.deepEqual(r.current, [b.id]);
  assert.deepEqual(r.videos.map((x) => x.id), ['cccccc3']);
  await setCurrent(dir, [a.id, b.id]);
  r = await readResearch(dir);
  assert.deepEqual(r.videos.map((x) => x.id).sort(), ['aaaaaa1', 'bbbbbb2', 'cccccc3']);
  assert.equal(r.videos.find((x) => x.id === 'bbbbbb2').tier, 'flop');
  await setMark(dir, 'aaaaaa1', { starred: true });
  await setMark(dir, 'bbbbbb2', { hidden: true });
  const file = JSON.parse(await fs.readFile(path.join(dir, 'studio', 'research', 'videos.json'), 'utf8'));
  assert.deepEqual(file.models.map((x) => x.id), ['aaaaaa1']);
  assert.equal(file.videos.find((x) => x.id === 'bbbbbb2').hidden, true);
  r = await readResearch(dir);
  assert.deepEqual(r.hiddenVideos.map((x) => x.id), ['bbbbbb2']);
  assert.ok(!r.videos.some((x) => x.id === 'bbbbbb2'));
  await setCurrent(dir, [b.id]); // switching away keeps the marks for when the run comes back
  await setCurrent(dir, [a.id]);
  assert.equal((await readResearch(dir)).videos.find((x) => x.id === 'aaaaaa1').starred, true);
  await assert.rejects(setCurrent(dir, ['nope']), /at least one/);
  await fs.rm(dir, { recursive: true });
});

test('an old videos.json is the first run, untouched until the user changes something', async () => {
  const dir = await tmp();
  const f = path.join(dir, 'studio', 'research', 'videos.json');
  await fs.mkdir(path.dirname(f), { recursive: true });
  const old = JSON.stringify({ query: 'old phrase', notes: 'my notes', videos: [v('oooooo1', 4000)] });
  await fs.writeFile(f, old);
  const r = await readResearch(dir);
  assert.equal(r.runs.length, 1);
  assert.equal(r.runs[0].id, 'first');
  assert.deepEqual(r.runs[0].phrases, ['old phrase']);
  assert.equal(r.notes, 'my notes');
  assert.equal(await fs.readFile(f, 'utf8'), old);
  await saveRun(dir, { phrases: ['new'], videos: [v('nnnnnn2', 10)] });
  assert.equal((await listRuns(dir)).length, 2);
  const kept = JSON.parse(await fs.readFile(f, 'utf8'));
  assert.equal(kept.notes, 'my notes'); // what the agent wrote at the top stays
  await fs.rm(dir, { recursive: true });
});

test('a starred video stays a model when another run becomes the current one', async () => {
  const dir = await tmp();
  await saveRun(dir, { phrases: ['one'], at: '2026-01-01T10:00:00Z', videos: [v('aaaaaa1', 5000), v('bbbbbb2', 100)] });
  await setMark(dir, 'aaaaaa1', { starred: true });
  await saveRun(dir, { phrases: ['two'], at: '2026-01-02T10:00:00Z', videos: [v('cccccc3', 3000)] });
  const r = await readResearch(dir);
  assert.deepEqual(r.videos.map((x) => x.id).sort(), ['aaaaaa1', 'cccccc3']); // bbbbbb2 is not starred, so it is not carried over
  const file = JSON.parse(await fs.readFile(path.join(dir, 'studio', 'research', 'videos.json'), 'utf8'));
  assert.deepEqual(file.models.map((x) => x.id), ['aaaaaa1']);
  await fs.rm(dir, { recursive: true });
});
