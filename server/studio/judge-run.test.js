import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runJudge, oursFrom } from './judge-run.js';

const havePillow = (() => { try { execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', 'import PIL'], { stdio: 'ignore' }); return true; } catch { return false; } })();

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  fs.mkdirSync(path.join(dir, 'studio', 'research', 'thumbs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'studio', 'thumbs'), { recursive: true });
  const videos = Array.from({ length: 5 }, (_, i) => ({ id: 'v' + i, title: 'Real ' + i, thumb: `research/thumbs/v${i}.png`, outlier: 10 - i, views: 100 }));
  for (const v of videos) fs.writeFileSync(path.join(dir, 'studio', v.thumb), png);
  fs.writeFileSync(path.join(dir, 'studio', 'thumbs', 'a.png'), png);
  fs.writeFileSync(path.join(dir, 'studio', 'research', 'videos.json'), JSON.stringify({ videos }));
  return dir;
}
const titles = { options: [{ id: 't1', title: 'Mine' }] }, thumbs = { options: [{ id: 'a', file: 'a.png', title: 't1' }] };

test('pairs are taken from what the page shows, unknown ids are dropped', () => {
  assert.deepEqual(oursFrom(titles, thumbs, [{ title: 't1', thumb: 'a' }, { title: 'zz', thumb: 'a' }, { title: 't1', thumb: 'a' }]), [{ key: 't1+a', title: 'Mine', file: 'a.png' }]);
});

test('the panel: a numbered picture, three judges that see only the picture, a saved pooled result', { skip: !havePillow }, async () => {
  const dir = project();
  const seen = [];
  const run = async ({ image, count }) => { seen.push([typeof image, count]); return { text: JSON.stringify({ scores: Object.fromEntries(Array.from({ length: count }, (_, i) => [i + 1, 5 + (i % 3)])) }), cost: 0.01 }; };
  const r = await runJudge({ dir, skill: 'skill', titles, thumbs, pairs: [{ title: 't1', thumb: 'a' }], run });
  assert.equal(seen.length, 3);
  assert.deepEqual(seen[0], ['string', 6]);
  assert.equal(r.judges, 3);
  assert.equal(r.tiles.length, 6);
  assert.deepEqual(r.keys, ['t1+a']);
  assert.ok(fs.existsSync(path.join(dir, 'studio', 'judge', 'feed.png')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'studio', 'judge.json'), 'utf8')).bar, r.bar);
  assert.ok(r.cost > 0.02);
});

test('fewer than two judges answering keeps nothing, and fewer than 3 real winners is refused', { skip: !havePillow }, async () => {
  const dir = project();
  const bad = async () => ({ text: 'no json here', cost: 0 });
  await assert.rejects(runJudge({ dir, skill: 's', titles, thumbs, pairs: [{ title: 't1', thumb: 'a' }], run: bad }), /Fewer than two judges/);
  assert.ok(!fs.existsSync(path.join(dir, 'studio', 'judge.json')));
  fs.writeFileSync(path.join(dir, 'studio', 'research', 'videos.json'), JSON.stringify({ videos: [] }));
  await assert.rejects(runJudge({ dir, skill: 's', titles, thumbs, pairs: [{ title: 't1', thumb: 'a' }], run: bad }), /at least 3 real winners/);
  await assert.rejects(runJudge({ dir, skill: 's', titles, thumbs, pairs: [], run: bad }), /Star a title/);
});
