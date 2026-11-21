import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isFreeable, kindOf, sumFiles, formatBytes, freeSpace, freeablePlan, FREEABLE_DIRS } from './project-space.js';

test('Free space deletes only the five re-makeable folders', () => {
  for (const f of ['video/out/work/proxy/a.mp4', 'video/out/work/peaks/a.json', 'video/out/work/rough-seg/s1.mp4', 'video/out/work/cuts/c1-after.mp4', 'export/media/take.mp4', 'export\\media\\take.mp4']) assert.equal(isFreeable(f), true, f);
  for (const f of ['video/footage/take.mkv', 'video/out/final.mp4', 'video/out/rough.mp4', 'video/out/edl.json', 'video/out/work/make_edl.py', 'video/out/work/rough-cat.mp4', 'studio/thumbs/a.png', 'project.json', 'brief.md', 'export/final.fcpxml', 'video/out/work/proxy']) assert.equal(isFreeable(f), false, f);
  assert.equal(FREEABLE_DIRS.length, 5);
});

test('files are told apart: footage, renders, cache, other', () => {
  assert.equal(kindOf('video/footage/a.mkv'), 'footage');
  assert.equal(kindOf('video/out/final.mp4'), 'renders');
  assert.equal(kindOf('export/final.fcpxml'), 'renders');
  assert.equal(kindOf('video/out/work/proxy/a.mp4'), 'cache');
  assert.equal(kindOf('video/out/work/scan.json'), 'cache');
  assert.equal(kindOf('studio/plan.md'), 'other');
  assert.equal(kindOf('project.json'), 'other');
});

test('sizes add up by kind, and freeable is a part of them', () => {
  const s = sumFiles([{ rel: 'video/footage/a.mkv', size: 1000 }, { rel: 'video/out/final.mp4', size: 300 }, { rel: 'video/out/work/proxy/a.mp4', size: 50 }, { rel: 'video/out/work/scan.json', size: 5 }, { rel: 'project.json', size: 2 }]);
  assert.deepEqual(s, { footage: 1000, renders: 300, cache: 55, other: 2, total: 1357, freeable: 50 });
});

test('bytes in plain words', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(5 * 1024 ** 3), '5.0 GB');
  assert.equal(formatBytes(300 * 1024 ** 2), '300 MB');
});

test('freeSpace deletes exactly the plan and leaves everything else', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'space-'));
  const put = (rel, text) => { const f = path.join(d, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  put('video/footage/a.mkv', 'rec'); put('video/out/final.mp4', 'final'); put('video/out/rough.mp4', 'rough'); put('project.json', '{}');
  put('video/out/work/proxy/a.mp4', 'xxxx'); put('video/out/work/peaks/a.json', 'yy'); put('export/media/a.mp4', 'zzz'); put('video/out/work/keep.txt', 'k');
  const plan = await freeablePlan(d);
  assert.deepEqual(plan.files.map((f) => f.rel), ['export/media/a.mp4', 'video/out/work/peaks/a.json', 'video/out/work/proxy/a.mp4']);
  const r = await freeSpace(d);
  assert.equal(r.bytes, 9);
  assert.equal(r.deleted.length, 3);
  for (const rel of ['video/footage/a.mkv', 'video/out/final.mp4', 'video/out/rough.mp4', 'project.json', 'video/out/work/keep.txt']) assert.ok(fs.existsSync(path.join(d, ...rel.split('/'))), rel);
  assert.equal(fs.existsSync(path.join(d, 'video/out/work/proxy/a.mp4')), false);
  fs.rmSync(d, { recursive: true, force: true });
});
