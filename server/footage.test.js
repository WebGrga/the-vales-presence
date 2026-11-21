import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultMode, BIG, cleanPath, resolveIn, renameInEdl, binRows, addByPath, listFootage, resolveFootage, renameFootage, removeFootage, replaceFootage, relink, dependents } from './footage.js';

const abs = (...p) => path.join(path.parse(process.cwd()).root, ...p);

test('defaultMode: link above 200 MB, copy below', () => {
  assert.equal(defaultMode(BIG + 1), 'link');
  assert.equal(defaultMode(1000), 'copy');
});

test('cleanPath: absolute, media only, quotes off', () => {
  assert.equal(cleanPath(`"${abs('x', 'a.mkv')}"`).path, abs('x', 'a.mkv'));
  assert.ok(cleanPath('rec.mp4').error);
  assert.ok(cleanPath(abs('x', 'notes.txt')).error);
});

test('resolveIn: a linked footage name goes to the real file', () => {
  const links = { 'a.mkv': abs('real', 'a.mkv') };
  const v = abs('p', 'video');
  assert.equal(resolveIn(v, 'footage/a.mkv', links), abs('real', 'a.mkv'));
  assert.equal(resolveIn(v, 'footage/b.mkv', links), path.join(v, 'footage', 'b.mkv'));
  assert.equal(resolveIn(v, 'out/rough.mp4', links), path.join(v, 'out', 'rough.mp4'));
});

test('renameInEdl and binRows', () => {
  const r = renameInEdl({ sources: { r1: { file: 'footage/a.mkv' }, r2: 'footage/b.mkv' } }, 'a.mkv', 'c.mkv');
  assert.equal(r.changed, 1);
  assert.equal(r.edl.sources.r1.file, 'footage/c.mkv');
  const rows = binRows(['c.mp4'], { 'gone.mkv': abs('x', 'gone.mkv') }, (t, n) => (n === 'gone.mkv' ? null : { size: 5, targetOk: true }));
  assert.deepEqual(rows.map((x) => [x.name, x.missing]), [['c.mp4', false], ['gone.mkv', true]]);
});

test('link, rename, replace, remove: the real file is never touched', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'footage-')), away = fs.mkdtempSync(path.join(os.tmpdir(), 'away-'));
  try {
    fs.mkdirSync(path.join(dir, 'video', 'out'), { recursive: true });
    const real = path.join(away, 'a.mkv'); fs.writeFileSync(real, 'one');
    const { name } = addByPath(dir, real, { mode: 'link' });
    assert.equal(resolveFootage(dir, 'footage/' + name), real);
    fs.writeFileSync(path.join(dir, 'video', 'out', 'edl.json'), JSON.stringify({ sources: { r1: { file: 'footage/' + name } } }));
    fs.writeFileSync(path.join(dir, 'video', 'out', 'rough.mp4'), 'r');
    assert.deepEqual(dependents(dir, name), { keys: ['r1'], rough: true });
    renameFootage(dir, name, 'main.mkv');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'video', 'out', 'edl.json'), 'utf8')).sources.r1.file, 'footage/main.mkv');
    const b = path.join(away, 'b.mkv'); fs.writeFileSync(b, 'two');
    replaceFootage(dir, 'main.mkv', { path: b, mode: 'copy' });
    assert.equal(fs.readFileSync(path.join(dir, 'video', 'footage', 'main.mkv'), 'utf8'), 'two');
    const l = addByPath(dir, real, { mode: 'link' });
    removeFootage(dir, l.name);
    assert.ok(fs.existsSync(real));
    fs.rmSync(real);
    const m = addByPath(dir, b, { mode: 'link' });
    fs.rmSync(b); fs.rmSync(path.join(dir, 'video', 'footage', m.name), { force: true });
    assert.equal(listFootage(dir).find((x) => x.name === m.name).missing, true);
    fs.writeFileSync(path.join(away, 'c.mkv'), 'x');
    relink(dir, m.name, path.join(away, 'c.mkv'));
    assert.equal(listFootage(dir).find((x) => x.name === m.name).missing, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(away, { recursive: true, force: true }); }
});
