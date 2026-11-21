import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from './stages.js';
import { keepOption, keepExisting, changedSince, withBackFrom } from './stage-keep.js';

const R = { id: 'edit', name: 'E', stages: [
  { id: 'rough', kind: 'make', out: ['rough.mp4'] },
  { id: 'rough-review', kind: 'gate', back: 'rough', lock: ['rough.mp4'] },
  { id: 'visuals', kind: 'make', title: 'Visuals', out: ['events.json', 'final.mp4'] },
  { id: 'inspect', kind: 'inspect', title: 'Inspect', out: ['inspect.md'] },
  { id: 'final-review', kind: 'gate', title: 'Final review', back: 'visuals' },
  { id: 'export', kind: 'export' },
] };
// a project at its final review, every stage before it done once
function atFinalReview() {
  let p = { id: 'p', ...S.initStages(R) };
  p = S.turnEnded(S.begin(p, R).project, R, { ready: true, ms: 10, cost: 1 }).project;
  p = S.approve(p, R).project;
  p = S.turnEnded(S.begin(p, R).project, R, { ready: true, ms: 20, cost: 2 }).project;
  p = S.turnEnded(S.begin(p, R).project, R, { ready: true, ms: 5, cost: 0.5 }).project;
  assert.equal(p.at, 'final-review');
  return p;
}

test('changedSince', () => {
  const t = { 'a.mp4': 100, 'b.json': 300 };
  assert.deepEqual(changedSince(['a.mp4', 'b.json', 'c'], (r) => t[r] ?? null, 200), ['b.json']);
  assert.deepEqual(changedSince(['a.mp4'], () => 999, 0), []);
});

test('after a send-back is stopped, Keep goes back to the final as it was, and the stopped round still counts', () => {
  let p = atFinalReview();
  p = S.sendback(p, R, { notes: 'blur the numbers', now: 1000 }).project;
  assert.equal(p.at, 'visuals');
  assert.equal(p.backFrom.target, 'visuals');
  assert.equal(p.backFrom.from, 'final-review');
  p = S.begin(p, R).project;
  p = S.turnEnded(p, R, { stopped: true, ms: 37 * 60e3, cost: 1.1 }).project;
  assert.equal(keepOption(p, R, { ready: false }), null);
  const k = keepOption(p, R, { ready: true, changed: [] });
  assert.equal(k.mode, 'back');
  assert.equal(k.to, 'final-review');
  assert.match(k.text, /Final review/);
  const r = keepExisting(p, R, { ready: true, changed: [] });
  assert.equal(r.mode, 'back');
  const q = r.project;
  assert.equal(q.at, 'final-review');
  assert.equal(q.stages['final-review'].status, 'waiting');
  assert.equal(q.stages.visuals.status, 'done');
  assert.equal(q.stages.inspect.status, 'done');
  assert.equal(q.stages.visuals.cost, 3.1); // round 1 and the stopped round 2
  assert.equal(q.stages.visuals.round, 2);
  assert.equal(q.stages.visuals.hold, undefined);
  assert.equal(q.backFrom, undefined);
  assert.ok(S.view(q, R).actions.includes('approve'));
});

test('files changed since the send-back: Keep counts the stage done and the next one runs on them', () => {
  let p = atFinalReview();
  p = S.sendback(p, R, { notes: 'x', now: 1000 }).project;
  p = S.turnEnded(S.begin(p, R).project, R, { stopped: true }).project;
  const k = keepOption(p, R, { ready: true, changed: ['final.mp4'] });
  assert.equal(k.mode, 'done');
  assert.equal(k.to, 'inspect');
  const q = keepExisting(p, R, { ready: true, changed: ['final.mp4'] }).project;
  assert.equal(q.at, 'inspect');
  assert.equal(q.stages.visuals.status, 'done');
  assert.ok(S.shouldChain(q, R));
});

test('Keep does not apply to a stage that never ran, is running, has no files, or is in line', () => {
  const p = { id: 'p', ...S.initStages(R) };
  assert.equal(keepOption(p, R, { ready: true }), null); // never ran
  const run = S.begin(p, R).project;
  assert.equal(keepOption(run, R, { ready: true }), null);
  const stopped = S.turnEnded(run, R, { stopped: true }).project;
  assert.equal(keepOption(stopped, R, { ready: true, busy: true }), null);
  assert.equal(keepOption(stopped, R, { ready: true }).mode, 'done');
  assert.equal(keepOption(S.queue(stopped, R, []), R, { ready: true }), null);
  assert.match(keepExisting(stopped, R, { ready: false }).error, /nothing to go on with/);
  // a gate is not the agent's: nothing to keep
  assert.equal(keepOption(atFinalReview(), R, { ready: true }), null);
});

test('a send-back that ran to the end leaves no way back', () => {
  let p = atFinalReview();
  p = S.sendback(p, R, { notes: 'x' }).project;
  p = S.turnEnded(S.begin(p, R).project, R, { ready: true }).project;
  assert.equal(p.backFrom, undefined);
  assert.equal(p.at, 'inspect');
});

test('a send-back from before backFrom was kept is read from the log', () => {
  let p = atFinalReview();
  p = S.sendback(p, R, { notes: 'x', now: 1000 }).project;
  p = S.turnEnded(S.begin(p, R).project, R, { stopped: true }).project;
  delete p.backFrom;
  const log = [{ status: 'sent back', stage: 'final-review', to: 'visuals' }, { stage: 'visuals', status: 'todo' }];
  const q = withBackFrom(p, R, log);
  assert.equal(q.backFrom.from, 'final-review');
  assert.equal(q.backFrom.at, 1000);
  assert.equal(keepOption(q, R, { ready: true, changed: [] }).mode, 'back');
  const r = keepExisting(q, R, { ready: true, changed: [] }).project;
  assert.equal(r.at, 'final-review');
  assert.equal(r.stages.inspect.status, 'done');
  assert.equal(withBackFrom(p, R, [{ status: 'sent back', stage: 'final-review', to: 'rough' }]), p);
  assert.equal(withBackFrom(p, R, []), p);
});
