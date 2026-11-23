import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { step, createOutWatch } from './out-watch.js';

const st = (size, mtimeMs = size) => ({ size, mtimeMs });

test('files there at the start are the baseline, not news', () => {
  const a = step({}, { 'final.mp4': st(10), 'events.json': null }, { first: true });
  assert.deepEqual(a.ready, []);
  const b = step(a.state, { 'final.mp4': st(10), 'events.json': null });
  assert.deepEqual(b.ready, []);
});

test('a file is told once it stayed the same for two polls, and once only', () => {
  let s = step({}, { 'proof.mp4': null }, { first: true }).state;
  const seen = [];
  for (const size of [100, 400, 400, 400, 400]) { const r = step(s, { 'proof.mp4': st(size) }); s = r.state; seen.push(r.ready.length); }
  assert.deepEqual(seen, [0, 0, 0, 1, 0]);
});

test('a growing file is never ready', () => {
  let s = step({}, { 'proof.mp4': null }, { first: true }).state;
  for (const size of [1, 2, 3, 4, 5, 6]) { const r = step(s, { 'proof.mp4': st(size) }); s = r.state; assert.deepEqual(r.ready, []); }
});

test('a rewrite after it was told is told again; an empty file is not', () => {
  let s = step({}, { 'edl.json': null }, { first: true }).state;
  const go = (stat) => { const r = step(s, { 'edl.json': stat }); s = r.state; return r.ready; };
  go(st(5)); go(st(5)); assert.deepEqual(go(st(5)), ['edl.json']);
  go(st(9)); go(st(9)); assert.deepEqual(go(st(9)), ['edl.json']);
  s = step({}, { 'edl.json': null }, { first: true }).state;
  go(st(0)); go(st(0)); assert.deepEqual(go(st(0)), []);
});

test('the watcher polls the disk, says the finished file, and stops after the grace time', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'presence-ow-'));
  const out = path.join(root, 'p1', 'video', 'out'); fs.mkdirSync(out, { recursive: true });
  const msgs = [];
  const w = createOutWatch({ dirOf: (id) => path.join(root, id), broadcast: (m) => msgs.push(m), pollMs: 15, graceMs: 80, settle: 2 });
  w.start('p1');
  fs.writeFileSync(path.join(out, 'proof.mp4'), 'abc');
  await new Promise((r) => setTimeout(r, 120));
  assert.deepEqual(msgs.map((m) => m.paths), [['video/out/proof.mp4']]);
  w.stop('p1');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(w.running('p1'), false);
  fs.writeFileSync(path.join(out, 'final.mp4'), 'zzz');
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(msgs.length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});
