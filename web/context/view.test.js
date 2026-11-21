import test from 'node:test';
import assert from 'node:assert/strict';
import { stateBadge, writersWords, readersWords, words, addable, linePath, lines, startText, lessonCounts } from './view.js';

const columns = [
  { id: 'ask', title: 'Ask', agent: true, skills: [], links: [{ to: 'claude', how: 'reads' }, { to: 'brief', how: 'writes' }] },
  { id: 'rough', title: 'Rough cut', agent: true, skills: [{ id: 'skill:a' }], links: [{ to: 'claude', how: 'reads' }, { to: 'brief', how: 'reads' }, { to: 'stage:rough', how: 'reads' }] },
  { id: 'review', title: 'Review', agent: false, skills: [], links: [] },
];

test('badges and writers in plain words', () => {
  assert.deepEqual(stateBadge({ state: 'changed' }), ['your version', 'mine']);
  assert.deepEqual(stateBadge({ state: 'yours', kind: 'skill' }), ['your skill', 'mine']);
  assert.deepEqual(stateBadge({ state: 'missing', kind: 'brief' }), ['not written yet', 'missing']);
  assert.deepEqual(stateBadge({ state: 'shipped' }), ['shipped', 'shipped']);
  assert.equal(writersWords({ kind: 'skill', state: 'shipped', writers: ['shipped'] }), 'shipped with the app');
  assert.equal(writersWords({ kind: 'skill', state: 'changed', writers: ['you'] }), 'you (changed from the shipped version)');
  assert.match(writersWords({ kind: 'brief' }), /the agent, at the ask stage/);
});

test('readers in recipe order, "every agent stage" when all read it', () => {
  assert.equal(readersWords({ readers: ['rough', 'ask'] }, columns), 'every agent stage');
  assert.equal(readersWords({ readers: ['rough'], writes: ['ask'] }, columns), 'written at Ask; read by Rough cut');
  assert.equal(readersWords({ kind: 'skill', readers: [] }, columns), 'no stage of this recipe (switched off everywhere)');
});

test('sizes are words, never tokens', () => {
  assert.equal(words(1), '1 word');
  assert.equal(words(1234), '1,234 words');
  assert.equal(words(undefined), '0 words');
});

test('a column can add the skills it does not have yet', () => {
  const nodes = { 'skill:a': { label: 'a' }, 'skill:b': { label: 'b', description: 'B' } };
  assert.deepEqual(addable(columns[1], ['skill:a', 'skill:b'], nodes), [{ id: 'skill:b', name: 'b', description: 'B' }]);
});

test('lines go from columns to the shared things only', () => {
  assert.deepEqual(lines(columns, ['claude', 'brief']), [
    { from: 'ask', to: 'claude', how: 'reads' }, { from: 'ask', to: 'brief', how: 'writes' },
    { from: 'rough', to: 'claude', how: 'reads' }, { from: 'rough', to: 'brief', how: 'reads' },
  ]);
  assert.equal(linePath({ x: 0, y: 0, w: 100, h: 20 }, { x: 200, y: 220, w: 50, h: 20 }), 'M50,20 C50,120 225,120 225,220');
});

test('the newer unsaved draft is restored over the file', () => {
  const node = { text: 'file', mtime: 5 };
  assert.deepEqual(startText(node, null, null), { text: 'file', restored: false });
  assert.deepEqual(startText(node, { text: 'server', at: 2, baseMtime: 5 }, { text: 'local', at: 3, baseMtime: 5 }), { text: 'local', restored: true, stale: false });
  assert.equal(startText(node, { text: 'old', at: 1, baseMtime: 4 }, null).stale, true);
  assert.equal(startText(node, { text: 'file', at: 9 }, null).restored, false);
});

test('lesson counts', () => {
  assert.equal(lessonCounts({ kept: 2, against: 0 }), 'held up 2×, went against 0×');
  assert.match(lessonCounts({ kept: 0, against: 3, review: true }), /up for review/);
});
