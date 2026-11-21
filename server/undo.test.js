import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ruleFor, labelFor, diffTrees, createUndo } from './undo.js';

test('only the Studio saves and the Context writes get an undo', () => {
  assert.equal(ruleFor('GET', '/api/studio/x/options'), null);
  assert.equal(ruleFor('POST', '/api/studio/x/upload'), null); // an upload is not undone
  assert.equal(ruleFor('POST', '/api/context/draft'), null);
  assert.deepEqual(ruleFor('POST', '/api/studio/x/options'), { scope: 'x', what: 'options', root: 'studio' });
  assert.equal(ruleFor('POST', '/api/context/save').scope, 'context');
});

test('the words name what happened', () => {
  assert.equal(labelFor({ what: 'options' }, { kind: 'titles', op: 'pick' }), 'Picked a title');
  assert.equal(labelFor({ what: 'options' }, { kind: 'thumbs', op: 'add' }), 'Added a thumbnail');
  assert.equal(labelFor({ what: 'toggle' }, {}), 'Switched a skill');
  assert.equal(labelFor({ what: 'text' }, { name: 'plan.md' }), 'Edited plan');
});

test('diffTrees tells changed, created and removed', () => {
  const a = new Map([['a', '1'], ['b', '2']]), b = new Map([['a', '1'], ['b', '3'], ['c', '4']]);
  assert.deepEqual(diffTrees(a, b), { changed: ['b'], created: ['c'], removed: [] });
  assert.deepEqual(diffTrees(b, a), { changed: ['b'], created: [], removed: ['c'] });
});

test('a change is undone: old text back, a new file gone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'undo-'));
  const proj = path.join(dir, 'p1'); fs.mkdirSync(path.join(proj, 'studio'), { recursive: true });
  const f = path.join(proj, 'studio', 'options.json');
  fs.writeFileSync(f, '{"picked":"a"}');
  const seen = [];
  const u = createUndo({ dataDir: dir, projectDir: () => proj, broadcast: (m) => seen.push(m) });
  const run = u.begin('POST', '/api/studio/p1/options');
  fs.writeFileSync(f, '{"picked":"b"}');
  fs.writeFileSync(path.join(proj, 'studio', 'new.json'), '{}');
  const made = run.finish({ kind: 'titles', op: 'pick' }, 200);
  assert.equal(made.label, 'Picked a title');
  assert.equal(u.list('p1').length, 1);
  assert.equal(u.undo('p1').ok, true);
  assert.equal(fs.readFileSync(f, 'utf8'), '{"picked":"a"}');
  assert.equal(fs.existsSync(path.join(proj, 'studio', 'new.json')), false);
  assert.equal(u.undo('p1').error, 'nothing to undo');
  assert.equal(seen[0].type, 'studio');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a request that changes nothing, or fails, leaves nothing to undo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'undo-'));
  fs.mkdirSync(path.join(dir, 'craft'), { recursive: true });
  const u = createUndo({ dataDir: dir, projectDir: () => dir });
  assert.equal(u.begin('POST', '/api/context/toggle').finish({}, 200), null);
  const run = u.begin('POST', '/api/context/toggle');
  fs.writeFileSync(path.join(dir, 'craft', 'x.json'), '1');
  assert.equal(run.finish({}, 500), null);
  fs.rmSync(dir, { recursive: true, force: true });
});
