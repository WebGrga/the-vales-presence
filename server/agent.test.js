import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSettings, trimInput, resultText, answersFrom, DEFAULTS } from './agent.js';
import { slugify, uniqueId, newProject } from './projects.js';

test('settings: defaults, and only known values kept', () => {
  assert.deepEqual(cleanSettings(null), DEFAULTS);
  assert.equal(DEFAULTS.model, 'claude-opus-5-5');
  assert.equal(DEFAULTS.effort, 'medium');
  const s = cleanSettings({ model: 'claude-sonnet-5-5', effort: 'loud', permissionMode: 'bypassPermissions', chain: false, heavy: 2 });
  assert.equal(s.model, 'claude-sonnet-5-5');
  assert.equal(s.effort, 'medium');
  assert.equal(s.permissionMode, 'auto');
  assert.equal(s.chain, false);
  assert.equal(s.heavy, 2);
  assert.equal(cleanSettings({ model: 'rm -rf /' }).model, DEFAULTS.model);
});

test('tool inputs and results are trimmed for the screen', () => {
  assert.deepEqual(trimInput({ a: 1 }), { a: 1 });
  const big = trimInput({ content: 'x'.repeat(10000), file_path: 'a.md' });
  assert.equal(big.file_path, 'a.md');
  assert.ok(big.content.length < 700);
  assert.equal(resultText({ content: [{ type: 'text', text: 'hi' }, { type: 'image' }] }), 'hi\n[image]');
  assert.ok(resultText({ content: 'y'.repeat(9000) }).length < 4100);
});

test('one typed reply answers every question', () => {
  assert.deepEqual(answersFrom([{ question: 'Length?' }, { question: 'Look?' }], '8 min'), { 'Length?': '8 min', 'Look?': '8 min' });
});

test('project ids', () => {
  assert.equal(slugify('Café: the "Big" One!'), 'cafe-the-big-one');
  assert.equal(slugify('***'), 'project');
  assert.equal(uniqueId('a', ['a', 'a-2']), 'a-3');
  const p = newProject({ id: 'a', title: 'A', recipe: { id: 'r', stages: [{ id: 's', kind: 'record' }] }, now: 0 });
  assert.equal(p.at, 's');
  assert.equal(p.stages.s.status, 'waiting');
  assert.equal(p.created, '1970-01-01T00:00:00.000Z');
});

test('drafts: set, clear, refuse', async () => {
  const { applyDraft } = await import('./routes/projects.js');
  let d = applyDraft({}, 'agent-box', 'half a thought', 't1').drafts;
  assert.deepEqual(d, { 'agent-box': { text: 'half a thought', at: 't1' } });
  d = applyDraft(d, 'agent-box', '').drafts;
  assert.deepEqual(d, {});
  assert.match(applyDraft({}, '', 'x').error, /key/);
  assert.match(applyDraft({}, 'k', 5).error, /text/);
});
