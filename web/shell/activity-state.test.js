import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idle, reduce, fromStatus, stripLine } from './activity-state.js';

const run = (msgs, now = 1000) => msgs.reduce((s, m) => reduce(s, m, { now, projectId: 'p' }), idle());
const agent = (event, extra = {}) => ({ type: 'agent', project: 'p', event, ...extra });

test('a stage starting, then a step in plain words', () => {
  const s = run([agent('text', { text: '', start: true, stage: 'rough' }), agent('tool', { tool: 'Bash', input: { command: 'python engine/rough.py --in a.mp4', description: 'Cut the rough from the transcript' }, stage: 'rough' })]);
  assert.equal(s.busy, true);
  assert.equal(s.stage, 'rough');
  assert.equal(s.since, 1000);
  assert.equal(s.step.title, 'Cut the rough from the transcript'); // the description, not the command
  assert.equal(stripLine(s, 'Rough cut').step, 'Cut the rough from the transcript');
});

test('a Bash step with no description falls back to the short command', () => {
  const s = run([agent('tool', { tool: 'Bash', input: { command: 'ffmpeg -i a.mp4 b.mp4' } })]);
  assert.match(s.step.title, /ffmpeg/);
});

test('a question stops the work; done ends it', () => {
  let s = run([agent('text', { start: true }), agent('question', { questions: [] })]);
  assert.equal(stripLine(s, 'Brief').kind, 'ask');
  s = reduce(s, agent('text', { text: 'ok' }), { now: 2000 });
  s = reduce(s, agent('done', {}), { now: 3000 });
  assert.equal(s.busy, false);
  assert.equal(stripLine(s, 'x').kind, null);
});

test('a stage that sleeps for its render says so', () => {
  const s = run([agent('text', { start: true }), agent('done', { asleep: true }), { type: 'progress', project: 'p', asleep: true, since: 500, fires: [{ last: 'frame 120/900' }] }]);
  assert.equal(stripLine(s, 'Visuals').kind, 'sleep');
  assert.match(stripLine(s, 'Visuals').step, /frame 120/);
});

test('another project\'s messages are ignored', () => {
  assert.equal(reduce(idle(), { type: 'agent', project: 'other', event: 'text', start: true }, { projectId: 'p' }).busy, false);
});

test('the live view brings the stop-after flag and the line', () => {
  let s = run([agent('text', { start: true, stage: 'rough' })]);
  s = reduce(s, { type: 'live', project: 'p', view: { running: { stage: 'rough', since: 400 }, stopAfter: true } }, { now: 2000 });
  assert.equal(s.stopAfter, true);
  assert.equal(s.since, 400);
  s = reduce(s, { type: 'live', project: 'p', view: { running: null, stopAfter: false } }, { now: 3000 });
  assert.equal(s.busy, false); // the stage ended: the strip goes
  s = reduce(idle(), { type: 'queue', project: 'p', text: 'Waiting behind B' });
  assert.equal(stripLine(s, 'Rough').kind, 'queue');
});

test('the status after a reload rebuilds the strip', () => {
  const s = fromStatus({ busy: true, stage: 'rough', turn: { start: 777 }, events: [agent('tool', { tool: 'Read', input: { file_path: 'C:/x/projects/p/brief.md' } })] }, null, { projectId: 'p', now: 1 });
  assert.equal(s.busy, true);
  assert.equal(s.since, 777);
  assert.match(s.step.title, /brief\.md/);
  assert.equal(fromStatus({ busy: false, events: [agent('tool', { tool: 'Read', input: {} })] }, null, { projectId: 'p' }).busy, false);
});

test('a background task keeps the strip after the turn ended, and ends with it', () => {
  let s = run([agent('text', { start: true }), agent('done', {})]);
  assert.equal(stripLine(s, '').kind, null);
  s = reduce(s, { type: 'fire', project: 'p', id: 'f1', state: 'burning', cmd: 'ffmpeg -i a b', start: 500 }, { now: 900, projectId: 'p' });
  const l = stripLine(s, '');
  assert.equal(l.kind, 'sleep');
  assert.match(l.step, /Rendering/);
  assert.equal(l.since, 500);
  s = reduce(s, { type: 'fire', project: 'p', id: 'f1', state: 'done' }, { projectId: 'p' });
  assert.equal(stripLine(s, '').kind, null);
});
