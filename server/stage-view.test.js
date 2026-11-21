import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from './stages.js';

const R = { id: 'r', name: 'R', stages: [
  { id: 'ask', kind: 'ask', title: 'Brief', out: ['brief.md'] },
  { id: 'rough', kind: 'make', title: 'Rough cut', heavy: true, out: ['rough.mp4'] },
  { id: 'review', kind: 'gate', title: 'Rough review', lock: ['rough.mp4'] },
] };
const fresh = () => ({ id: 'p', ...S.initStages(R) });

test('the totals count your own turns (the agent panel, the Studio) beside the stages', () => {
  const p = fresh();
  p.stages.ask.ms = 1000; p.stages.ask.cost = 0.5;
  p.chat = { ms: 3000, cost: 2.15, turns: 3 };
  const v = S.view(p, R);
  assert.equal(v.total.cost, 2.65);
  assert.equal(v.total.ms, 4000);
  assert.deepEqual(v.total.stages, { ms: 1000, cost: 0.5 });
  assert.deepEqual(v.total.chat, { ms: 3000, cost: 2.15, turns: 3 });
});

test('a running stage shows when it started and the time of its rounds before', () => {
  let p = fresh();
  p.stages.ask.ms = 5000;
  p = S.begin(p, R, 1234).project;
  const v = S.view(p, R);
  assert.equal(v.chips[0].since, 1234);
  assert.equal(v.running.since, 1234);
  assert.equal(v.running.msBefore, 5000);
  assert.equal(v.chips[1].since, undefined);
  assert.equal(S.view(p, R, { asleep: { since: 2000 } }).running.asleep.since, 2000);
});

test('who waits for whom: a live question, an agent stage that asked, a review, a halt', () => {
  let p = fresh();
  assert.equal(S.waitingFor(p, R), null);
  p = S.begin(p, R).project;
  const q = S.view(p, R, { question: { questions: [{ question: 'How long?' }, { question: 'Captions?' }], at: 9 } }).waiting;
  assert.equal(q.for, 'question');
  assert.equal(q.text, 'How long?\nCaptions?');
  assert.equal(q.at, 9);
  p = S.turnEnded(p, R, { ready: false, asked: true }).project;
  assert.equal(S.view(p, R).waiting.for, 'answer');
  p = S.resumeAsked(p, R).project;
  p = S.turnEnded(p, R, { ready: true }).project;
  p = S.begin(p, R).project;
  p = S.turnEnded(p, R, { ready: true }).project;
  const w = S.view(p, R).waiting;
  assert.equal(w.for, 'approve');
  assert.equal(w.title, 'Rough review');
  assert.equal(S.view(S.halt(p, R, 'a locked file changed'), R).waiting.for, 'halt');
});

test('a heavy stage in line says what it waits behind; starting clears it; a restart drops it', () => {
  let p = fresh();
  p = S.turnEnded(S.begin(p, R).project, R, { ready: true }).project; // at rough
  const behind = [{ project: 'other', title: 'Other video', stage: 'visuals', stageTitle: 'Visuals' }];
  p = S.queue(p, R, behind, 500);
  const v = S.view(p, R);
  assert.equal(v.queued.text, 'Waiting in line behind Other video (Visuals). It starts by itself when that one ends.');
  assert.equal(v.queued.since, 500);
  assert.equal(v.chips[1].queued.behind[0].project, 'other');
  assert.equal(v.chips[1].note, v.queued.text);
  assert.match(S.queueNote([...behind, { project: 'x' }]), /and 1 more/);
  assert.equal(S.queueNote([]), 'Waiting in line: another project is rendering. It starts when that one ends.');
  // the line moves: queued again keeps its first time
  assert.equal(S.queue(p, R, [], 900).stages.rough.queued.since, 500);
  const started = S.begin(p, R).project;
  assert.equal(started.stages.rough.queued, undefined);
  assert.equal(started.stages.rough.note, undefined);
  assert.equal(S.view(started, R).queued, null);
  const un = S.unqueue(p, R);
  assert.equal(un.stages.rough.queued, undefined);
  const r = S.interrupted(p);
  assert.equal(r.stages.rough.queued, undefined);
  assert.equal(r.stages.rough.hold, true);
});

test('Keep shows as an action only when it applies and nothing runs', () => {
  let p = fresh();
  p = S.begin(p, R).project;
  p = S.turnEnded(p, R, { stopped: true }).project;
  assert.ok(!S.view(p, R).actions.includes('keep'));
  assert.ok(S.view(p, R, { keep: { mode: 'done' } }).actions.includes('keep'));
  assert.deepEqual(S.view(p, R, { keep: { mode: 'done' } }).keep, { mode: 'done' });
  assert.ok(!S.view(S.begin(p, R).project, R, { keep: { mode: 'done' } }).actions.includes('keep'));
});

test("a restart leaves a stage another live server runs, and stops one whose server is gone", () => {
  let p = fresh();
  p = S.begin(p, R).project;
  p.stages.ask.pid = 4242;
  assert.equal(S.interrupted(p, { alive: (pid) => pid === 4242 }), null);
  assert.equal(S.interrupted(p, { alive: () => false }).stages.ask.status, 'todo');
  assert.equal(S.interrupted(p).stages.ask.status, 'todo');
});
