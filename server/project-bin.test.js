import test from 'node:test';
import assert from 'node:assert/strict';
import { stamp, binName, parseBinName, binNote, cleanTitle, sameTitle, copyTitle, copyProject } from './project-bin.js';

test('a binned folder is named <id>-<stamp>, and the name reads back', () => {
  const now = Date.UTC(2026, 10, 21, 9, 30, 5);
  assert.equal(stamp(now), '20261121-093005');
  assert.equal(binName('my-video', now), 'my-video-20261121-093005');
  assert.equal(binName('my-video', now, ['my-video-20261121-093005']), 'my-video-20261121-093005-2');
  assert.deepEqual(parseBinName('my-video-20261121-093005'), { id: 'my-video', stamp: '20261121-093005' });
  assert.deepEqual(parseBinName('a-20261121-093005-2'), { id: 'a', stamp: '20261121-093005' });
  assert.equal(parseBinName('nonsense'), null);
  assert.deepEqual(binNote({ id: 'a', title: 'A', recipe: 'edit' }, now), { id: 'a', title: 'A', recipe: 'edit', binned: '2026-11-21T09:30:05.000Z' });
});

test('titles: clean, same-name warning, copy name', () => {
  assert.deepEqual(cleanTitle('  My   video '), { title: 'My video' });
  assert.ok(cleanTitle('   ').error);
  const list = [{ id: 'a', title: 'My video' }, { id: 'b', title: 'Other' }];
  assert.equal(sameTitle(list, ' my  VIDEO')?.id, 'a');
  assert.equal(sameTitle(list, 'my video', 'a'), null);
  assert.equal(copyTitle('My video', ['My video']), 'My video (copy)');
  assert.equal(copyTitle('My video (copy)', ['My video', 'My video (copy)']), 'My video (copy 2)');
});

test('a copy keeps the settings and starts every stage again', () => {
  const init = (r) => ({ at: r.stages[0].id, stages: { [r.stages[0].id]: { status: 'todo' } } });
  const c = copyProject({ id: 'a', title: 'A', recipe: 'edit', created: 'x', at: 'rough', stages: { rough: { status: 'done' } }, chat: { cost: 3 }, halted: 'why', format: '9:16', topic: 't' },
    { id: 'a-2', title: 'A (copy)', recipe: { id: 'edit', stages: [{ id: 'ask' }] }, initStages: init, now: 0 });
  assert.deepEqual(c, { recipe: 'edit', format: '9:16', topic: 't', id: 'a-2', title: 'A (copy)', created: '1970-01-01T00:00:00.000Z', at: 'ask', stages: { ask: { status: 'todo' } } });
});
