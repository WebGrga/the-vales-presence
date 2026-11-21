import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readStudio, saveTextFile, changeOptions, readOptions, saveFeed, updateUpload, serial } from './store.js';
import { studioPath } from './files.js';

// every temp folder a test makes is removed when the file's tests end
const made = [];
const track = (d) => { made.push(d); return d; };
test.after(async () => { for (const d of made) { try { await fs.rm(d, { recursive: true, force: true }); } catch {} } });

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'studio-store-')).then(track);

test('studio paths stay inside studio/', () => {
  const dir = path.resolve('/p');
  assert.equal(studioPath(dir, 'thumbs/a.png'), path.join(dir, 'studio', 'thumbs', 'a.png'));
  for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'C:/x', 'c:\\x', '', 'a\0b', '..\\x']) assert.equal(studioPath(dir, bad), null, bad);
});

test('an empty project reads as empty, not as an error', async () => {
  const s = await readStudio(await tmp());
  assert.equal(s.plan.text, '');
  assert.deepEqual(s.titles.options, []);
  assert.equal(s.research.patterns, null);
  assert.equal(s.upload.fields.privacy, 'private');
  assert.equal(s.upload.video, null);
});

test('typing saves; a version the agent wrote meanwhile is kept in .history', async () => {
  const dir = await tmp();
  const a = await saveTextFile(dir, 'plan', 'mine 1');
  assert.equal(a.saved, true);
  await new Promise((r) => setTimeout(r, 20));
  await fs.writeFile(path.join(dir, 'studio', 'plan.md'), 'agent wrote this');
  const b = await saveTextFile(dir, 'plan', 'mine 2', a.mtime);
  assert.equal(b.conflict, true);
  assert.equal(await fs.readFile(path.join(dir, 'studio', 'plan.md'), 'utf8'), 'mine 2');
  assert.equal(await fs.readFile(path.join(dir, 'studio', ...b.backup.split('/')), 'utf8'), 'agent wrote this');
  await assert.rejects(saveTextFile(dir, 'secrets', 'x'), /No studio text/);
});

test('options keep the user\'s pick when the agent rewrites the file', async () => {
  const dir = await tmp();
  await fs.mkdir(path.join(dir, 'studio'), { recursive: true });
  await fs.writeFile(path.join(dir, 'studio', 'titles.json'), JSON.stringify({ options: [{ id: 't1', title: 'One' }, { id: 't2', title: 'Two' }] }));
  await changeOptions(dir, 'titles', { op: 'pick', id: 't2' });
  await changeOptions(dir, 'titles', { op: 'edit', id: 't2', text: 'Two, mine' });
  await fs.writeFile(path.join(dir, 'studio', 'titles.json'), JSON.stringify({ options: [{ id: 't1', title: 'One' }, { id: 't2', title: 'Two' }, { id: 't3', title: 'Three' }] }));
  const t = await readOptions(dir, 'titles');
  assert.equal(t.picked, 't2');
  assert.equal(t.options[1].title, 'Two, mine');
  assert.equal(t.options.length, 3);
  assert.ok((await changeOptions(dir, 'titles', { op: 'pick', id: 'zz' })).error);
});

test('concurrent writes to one project all land', async () => {
  const dir = await tmp();
  await Promise.all([
    updateUpload(dir, () => ({ fields: { description: 'd' } })),
    updateUpload(dir, () => ({ state: { status: 'uploading' } })),
    saveFeed(dir, { theme: 'dark' }),
  ]);
  const s = await readStudio(dir);
  assert.equal(s.upload.fields.description, 'd');
  assert.equal(s.upload.state.status, 'uploading');
  assert.equal(s.feed.theme, 'dark');
  const order = [];
  await Promise.all([serial('k', async () => { await new Promise((r) => setTimeout(r, 20)); order.push(1); }), serial('k', async () => order.push(2))]);
  assert.deepEqual(order, [1, 2]);
});
