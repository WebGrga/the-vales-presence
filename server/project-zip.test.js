import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipCommand, unzipCommand, listCommand, unsafeEntries, entryNames, run } from './project-zip.js';

test('the command lines per system', () => {
  const z = zipCommand({ platform: 'win32', dir: 'D:\\p', out: 'o.zip', names: ['project.json', 'video'], env: { SystemRoot: 'C:\\Windows' } });
  assert.ok(z.cmd.endsWith('tar.exe'));
  assert.deepEqual(z.args.slice(0, 4), ['-a', '-c', '-f', 'o.zip']);
  assert.ok(z.args.includes('--exclude=video/out/work/proxy') && z.args.includes('--exclude=.presence'));
  assert.deepEqual(z.args.slice(-4), ['-C', 'D:\\p', 'project.json', 'video'].slice(-4));
  assert.equal(zipCommand({ platform: 'darwin', dir: '/p', out: 'o.zip', names: ['a'] }).cmd, 'tar');
  const l = zipCommand({ platform: 'linux', dir: '/p', out: 'o.zip', names: ['a'] });
  assert.equal(l.cmd, 'zip'); assert.equal(l.cwd, '/p');
  assert.equal(unzipCommand({ platform: 'linux', zip: 'a.zip', dest: '/d' }).cmd, 'unzip');
  assert.deepEqual(unzipCommand({ platform: 'darwin', zip: 'a.zip', dest: '/d' }).args, ['-x', '-f', 'a.zip', '-C', '/d']);
  assert.deepEqual(listCommand({ platform: 'linux', zip: 'a.zip' }).args, ['-Z1', 'a.zip']);
});

test('a zip with a path that leaves the folder is refused', () => {
  assert.deepEqual(unsafeEntries(['project.json', 'video/footage/a.mkv', 'studio/']), []);
  assert.deepEqual(unsafeEntries(['../x', '/etc/passwd', 'C:/x', 'a/../../b', 'a\\..\\b']).length, 5);
  assert.deepEqual(entryNames('./project.json\r\nvideo/\n\n'), ['project.json', 'video/']);
});

test('a project folder goes into a zip and comes out the same (system tar), without what the app makes again', async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-')); const src = path.join(d, 'src'), dest = path.join(d, 'dest');
  const put = (rel, text) => { const f = path.join(src, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  put('project.json', '{"id":"a"}'); put('video/footage/a.mkv', 'rec'); put('video/out/work/proxy/p.mp4', 'proxy'); put('studio/plan.md', 'plan'); put('.presence/log.jsonl', 'log');
  const zip = path.join(d, 'a.zip');
  try {
    await run(zipCommand({ dir: src, out: zip, names: ['project.json', 'video', 'studio'] }));
    const names = entryNames(await run(listCommand({ zip })));
    assert.deepEqual(unsafeEntries(names), []);
    fs.mkdirSync(dest);
    await run(unzipCommand({ zip, dest }));
    assert.equal(fs.readFileSync(path.join(dest, 'video', 'footage', 'a.mkv'), 'utf8'), 'rec');
    assert.equal(fs.readFileSync(path.join(dest, 'studio', 'plan.md'), 'utf8'), 'plan');
    assert.equal(fs.existsSync(path.join(dest, 'video', 'out', 'work', 'proxy', 'p.mp4')), false);
  } catch (e) { if (/not installed/.test(e.message)) t.skip(e.message); else throw e; }
  fs.rmSync(d, { recursive: true, force: true });
});
