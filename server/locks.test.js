import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import * as L from './locks.js';

// every temp folder a test makes is removed when the file's tests end
const made = [];
const track = (d) => { made.push(d); return d; };
after(() => { for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

const tmp = () => track(fs.mkdtempSync(path.join(os.tmpdir(), 'presence-locks-')));

test('safeRel keeps paths inside the project', () => {
  assert.equal(L.safeRel('video/out/edl.json'), 'video/out/edl.json');
  assert.equal(L.safeRel('video\\out\\rough.mp4'), 'video/out/rough.mp4');
  assert.equal(L.safeRel('./a'), 'a');
  assert.equal(L.safeRel('../a'), null);
  assert.equal(L.safeRel('/etc/x'), null);
  assert.equal(L.safeRel('C:/x'), null);
  assert.equal(L.safeRel(''), null);
});

test('hashFile streams a sha256', async () => {
  const d = tmp(), f = path.join(d, 'x.bin');
  const buf = crypto.randomBytes(300000);
  fs.writeFileSync(f, buf);
  const h = await L.hashFile(f);
  assert.equal(h.sha256, crypto.createHash('sha256').update(buf).digest('hex'));
  assert.equal(h.size, 300000);
});

test('lock, check, change, missing', async () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'video', 'out'), { recursive: true });
  fs.writeFileSync(path.join(d, 'video', 'out', 'edl.json'), '{"items":[]}');
  fs.writeFileSync(path.join(d, 'video', 'out', 'rough.mp4'), 'rough');
  const miss = await L.lockFiles(d, ['video/out/edl.json', 'video/out/none.mp4'], 'gate');
  assert.deepEqual(miss.missing, ['video/out/none.mp4']);
  const { locks } = await L.lockFiles(d, ['video/out/edl.json', 'video/out/rough.mp4'], 'gate', 7);
  assert.equal(locks['video/out/edl.json'].stage, 'gate');
  assert.equal(locks['video/out/edl.json'].at, 7);
  L.writeLocks(d, locks);
  assert.deepEqual(L.readLocks(d), locks);
  assert.deepEqual(await L.checkLocks(d, locks), []);
  fs.writeFileSync(path.join(d, 'video', 'out', 'rough.mp4'), 'ROUGH'); // same size, other bytes
  assert.deepEqual(await L.checkLocks(d, locks), [{ file: 'video/out/rough.mp4', why: 'changed' }]);
  fs.writeFileSync(path.join(d, 'video', 'out', 'edl.json'), '{"items":[1]}');
  fs.rmSync(path.join(d, 'video', 'out', 'rough.mp4'));
  assert.deepEqual(await L.checkLocks(d, locks), [{ file: 'video/out/edl.json', why: 'changed' }, { file: 'video/out/rough.mp4', why: 'missing' }]);
  L.writeLocks(d, {});
  assert.equal(fs.existsSync(path.join(d, '.presence', 'locks.json')), false);
});

test('messages and the locking gate', () => {
  const R = { stages: [{ id: 'g1' }, { id: 'm' }, { id: 'g2' }] };
  const locks = { a: { stage: 'g2' }, b: { stage: 'g1' } };
  assert.equal(L.gateOf([{ file: 'a' }, { file: 'b' }], locks, R), 'g1');
  assert.match(L.lockMessage([{ file: 'a', why: 'missing' }], { gateName: 'Rough review' }), /A locked file changed after you approved Rough review \(a \(gone\)\)/);
  assert.match(L.lockMessage([{ file: 'a' }, { file: 'b' }], { when: 'before' }), /did not start/);
  assert.equal(L.lockSentence({}), '');
  assert.match(L.lockSentence({ 'video/out/edl.json': {} }), /never change these\): video\/out\/edl.json/);
  assert.ok(L.needsCheck('make', { a: {} }));
  assert.ok(!L.needsCheck('gate', { a: {} }));
  assert.ok(!L.needsCheck('make', {}));
});
