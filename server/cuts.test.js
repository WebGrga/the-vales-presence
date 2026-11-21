import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanReview, applyChoice, merge, reviewSummary, cleanWorking, readCuts, writeReview } from './cuts.js';

// every temp folder a test makes is removed when the file's tests end
const made = [];
const track = (d) => { made.push(d); return d; };
after(() => { for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

const DATA = { version: 1, rough: 'out/rough.mp4', cuts: [
  { id: 'c1', at: 1.5, kind: 'filler', removed: 'um so', flag: false, clips: { before: 'out/work/cuts/c1-before.mp4', after: 'out/work/cuts/c1-after.mp4' } },
  { id: 'c2', at: 4, kind: 'retake', removed: 'the first try', flag: true, ask: 'which take?' },
  { bad: true },
] };

test('cleanReview keeps known ids and sane values', () => {
  assert.deepEqual(cleanReview({ c1: { keep: true }, c9: { keep: false }, c2: { keep: 'yes', note: '  ' } }, ['c1', 'c2']), { c1: { keep: true } });
  assert.deepEqual(cleanReview(null, ['c1']), {});
});

test('applyChoice sets, clears and refuses', () => {
  const ids = ['c1', 'c2'];
  let r = applyChoice({}, ids, 'c1', { keep: false }, 't1').review;
  assert.deepEqual(r, { c1: { keep: false, at: 't1' } });
  r = applyChoice(r, ids, 'c1', { note: 'keep the breath' }, 't2').review;
  assert.deepEqual(r.c1, { keep: false, note: 'keep the breath', at: 't2' });
  r = applyChoice(r, ids, 'c1', { keep: null, note: '' }).review;
  assert.deepEqual(r, {});
  assert.equal(applyChoice({}, ids, 'c7', { keep: true }).error, 'no such cut');
  assert.match(applyChoice({}, ids, 'c1', { keep: 'x' }).error, /true, false or null/);
  assert.match(applyChoice({}, ids, 'c1', { note: 3 }).error, /text/);
});

test('merge puts the choices on the cuts, flagged first, with media urls', () => {
  const m = merge(DATA, { c2: { keep: false, note: 'n' } }, (rel) => '/m/' + rel);
  assert.equal(m.count, 2);
  assert.deepEqual(m.order, ['c2', 'c1']);
  assert.equal(m.cuts[0].keep, null);
  assert.equal(m.cuts[1].keep, false);
  assert.equal(m.cuts[1].note, 'n');
  assert.equal(m.cuts[0].urls.before, '/m/out/work/cuts/c1-before.mp4');
  assert.equal(m.decided, 1);
  assert.equal(m.rough, 'out/rough.mp4');
});

test('reviewSummary words the choices for the agent', () => {
  const s = reviewSummary(DATA.cuts, { c2: { keep: false, note: 'second take' }, c1: { keep: true } });
  assert.match(s, /c2 at 4\.00 s \(retake\): RESTORE the removed words "the first try"\. Note: second take/);
  assert.match(s, /c1 at 1\.50 s: keep the cut/);
  assert.equal(reviewSummary(DATA.cuts, {}), '');
});

test('cleanWorking', () => {
  assert.ok(cleanWorking({ items: [{ kind: 'S' }] }).edl);
  assert.ok(cleanWorking({ items: [] }, 'extra').edl);
  assert.match(cleanWorking([]).error, /object/);
  assert.match(cleanWorking({}).error, /items/);
  assert.match(cleanWorking({ items: [1] }).error, /object/);
});

test('readCuts and writeReview on disk', () => {
  const d = track(fs.mkdtempSync(path.join(os.tmpdir(), 'presence-cuts-')));
  assert.equal(readCuts(d), null);
  fs.mkdirSync(path.join(d, 'video', 'out'), { recursive: true });
  fs.writeFileSync(path.join(d, 'video', 'out', 'cuts.json'), JSON.stringify(DATA));
  const c = readCuts(d);
  assert.deepEqual(c.ids, ['c1', 'c2']);
  writeReview(c, { c1: { keep: true } });
  assert.deepEqual(readCuts(d).review, { c1: { keep: true } });
});

test('pendingChoices: restores and strikes block a lock, keeps and notes do not', async () => {
  const { pendingChoices } = await import('./cuts.js');
  assert.equal(pendingChoices({ c1: { keep: true, note: 'x' }, c2: { note: 'y' } }, null), null);
  const p = pendingChoices({ c1: { keep: true }, c2: { keep: false } }, null);
  assert.deepEqual(p.restored, ['c2']);
  assert.match(p.message, /restored c2/);
  const q = pendingChoices({}, { items: [], working: { strikes: [['r1', 1, 2], ['r1', 3, 4]] } });
  assert.equal(q.strikes, 2);
  assert.match(q.message, /2 stretches/);
  assert.equal(pendingChoices({}, { items: [], working: { strikes: [] } }), null);
});
