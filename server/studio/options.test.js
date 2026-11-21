import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOptions, applyOp, choicesOf, withChoices, visible } from './options.js';

const titles = { options: [{ id: 't1', title: 'First', family: 'result' }, { id: 't2', title: 'Second' }, { title: '' }, { id: 't1', title: 'dup' }] };

test('parse keeps good options and drops broken ones', () => {
  const d = parseOptions(titles, 'titles');
  assert.deepEqual(d.options.map((o) => o.id), ['t1', 't2']);
  assert.equal(d.picked, null);
});

test('thumbnail files never leave the folder', () => {
  const d = parseOptions({ options: [{ id: 'a', file: '../x.png' }, { id: 'b', file: 'b.png', how: 'ai' }, { id: 'c', file: 'C:/x.png' }, { id: 'd', file: 'd.png', how: 'paint' }] }, 'thumbs');
  assert.deepEqual(d.options.map((o) => [o.id, o.how]), [['b', 'ai'], ['d', 'code']]);
});

test('pick, star, note, hide', () => {
  let { doc } = applyOp(titles, { op: 'pick', id: 't2' }, 'titles');
  assert.equal(doc.picked, 't2');
  assert.deepEqual(doc.shortlist, ['t2']);
  ({ doc } = applyOp(doc, { op: 'star', id: 't1' }, 'titles'));
  assert.deepEqual(doc.shortlist, ['t2', 't1']);
  ({ doc } = applyOp(doc, { op: 'note', id: 't1', text: 'shorter?' }, 'titles'));
  assert.equal(doc.notes.t1, 'shorter?');
  ({ doc } = applyOp(doc, { op: 'hide', id: 't2' }, 'titles'));
  assert.equal(doc.picked, null);
  assert.deepEqual(visible(doc).map((o) => o.id), ['t1']);
  assert.ok(applyOp(doc, { op: 'pick', id: 'nope' }, 'titles').error);
  assert.ok(applyOp(doc, { op: 'fly' }, 'titles').error);
});

test('edits keep the original and add makes the user\'s own', () => {
  let { doc } = applyOp(titles, { op: 'edit', id: 't1', text: 'First, better' }, 'titles');
  assert.deepEqual(doc.options[0], { id: 't1', title: 'First, better', family: 'result', original: 'First' });
  ({ doc } = applyOp(doc, { op: 'edit', id: 't1', text: 'First' }, 'titles'));
  assert.equal(doc.options[0].original, undefined);
  const r = applyOp(doc, { op: 'add', text: 'Mine' }, 'titles');
  assert.equal(r.id, 'u1');
  assert.deepEqual(r.doc.options.at(-1), { id: 'u1', title: 'Mine', by: 'you' });
  assert.ok(applyOp(doc, { op: 'edit', id: 't1', text: ' ' }, 'titles').error);
  assert.ok(applyOp({ options: [{ id: 'a', file: 'a.png' }] }, { op: 'edit', id: 'a', text: 'x' }, 'thumbs').error);
});

test('the user\'s choices survive the agent rewriting the file', () => {
  let { doc } = applyOp(titles, { op: 'edit', id: 't1', text: 'My words' }, 'titles');
  ({ doc } = applyOp(doc, { op: 'pick', id: 't1' }, 'titles'));
  ({ doc } = applyOp(doc, { op: 'add', text: 'Own one' }, 'titles'));
  ({ doc } = applyOp(doc, { op: 'hide', id: 't2' }, 'titles'));
  ({ doc } = applyOp(doc, { op: 'note', id: 't1', text: 'love it' }, 'titles'));
  const ch = choicesOf(doc, 'titles');
  const agent = { options: [{ id: 't1', title: 'First' }, { id: 't2', title: 'Second' }, { id: 't3', title: 'Third' }] };
  const m = withChoices(agent, ch, 'titles');
  assert.equal(m.options.find((o) => o.id === 't1').title, 'My words');
  assert.equal(m.options.find((o) => o.id === 't1').original, 'First');
  assert.equal(m.options.find((o) => o.id === 't2').hidden, true);
  assert.ok(m.options.some((o) => o.id === 'u1' && o.by === 'you'));
  assert.equal(m.picked, 't1');
  assert.equal(m.notes.t1, 'love it');
  assert.deepEqual(visible(m).map((o) => o.id), ['t1', 't3', 'u1']);
});

test('choices over a missing file and no choices', () => {
  assert.deepEqual(withChoices(null, null, 'titles').options, []);
  assert.equal(withChoices(titles, null, 'titles').options.length, 2);
});
