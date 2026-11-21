import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from './stages.js';

const R = { id: 'r', name: 'R', stages: [
  { id: 'ask', kind: 'ask', out: ['brief.md'] },
  { id: 'make1', kind: 'make' },
  { id: 'gate1', kind: 'gate', lock: ['a.txt'] },
  { id: 'make2', kind: 'make' },
  { id: 'check', kind: 'inspect' },
  { id: 'gate2', kind: 'gate', back: 'make2' },
  { id: 'out', kind: 'export' },
] };
const fresh = () => ({ id: 'p', ...S.initStages(R) });

test('a new project starts on its first stage', () => {
  const p = fresh();
  assert.equal(p.at, 'ask');
  assert.equal(p.stages.ask.status, 'todo');
  assert.equal(p.stages.gate1.status, 'todo');
  const u = S.initStages({ stages: [{ id: 'rec', kind: 'record' }, { id: 'm', kind: 'make' }] });
  assert.equal(u.stages.rec.status, 'waiting');
});

test('go, a turn that ends without its files waits for you, an answer goes on', () => {
  let p = fresh();
  assert.ok(S.canGo(p, R).ok);
  p = S.begin(p, R, 1000).project;
  assert.equal(p.stages.ask.status, 'running');
  assert.equal(p.stages.ask.round, 1);
  assert.match(S.canGo(p, R).error, /already running/);
  let t = S.turnEnded(p, R, { ms: 500, cost: 0.1, ready: false, asked: true });
  assert.equal(t.outcome, 'waiting');
  assert.equal(t.project.stages.ask.status, 'waiting');
  assert.equal(t.project.at, 'ask');
  p = S.resumeAsked(t.project, R).project;
  assert.equal(p.stages.ask.status, 'running');
  t = S.turnEnded(p, R, { ms: 250, cost: 0.05, ready: true });
  assert.equal(t.outcome, 'done');
  assert.equal(t.project.stages.ask.status, 'done');
  assert.equal(t.project.stages.ask.ms, 750);
  assert.equal(t.project.stages.ask.cost, 0.15);
  assert.equal(t.project.at, 'make1');
  assert.equal(t.project.stages.make1.status, 'todo');
  assert.ok(S.shouldChain(t.project, R));
});

test('a stopped or failed stage is todo with a note and does not chain', () => {
  let p = S.begin(fresh(), R).project;
  let t = S.turnEnded(p, R, { stopped: true, ms: 10 });
  assert.equal(t.outcome, 'todo');
  assert.match(t.project.stages.ask.note, /Stopped/);
  assert.equal(S.shouldChain(t.project, R), false);
  p = S.begin(t.project, R).project;
  assert.equal(p.stages.ask.hold, undefined);
  t = S.turnEnded(p, R, { error: 'error_max_turns' });
  assert.match(t.project.stages.ask.note, /failed: error_max_turns/);
});

const toGate = () => {
  let p = fresh();
  p = S.turnEnded(S.begin(p, R).project, R, { ready: true }).project;
  p = S.turnEnded(S.begin(p, R).project, R, { ready: true }).project;
  return p;
};

test('a user stage waits; Go refuses it; approve moves on and names the files to lock', () => {
  const p = toGate();
  assert.equal(p.at, 'gate1');
  assert.equal(p.stages.gate1.status, 'waiting');
  assert.match(S.canGo(p, R).error, /waits for you/);
  const a = S.approve(p, R, { notes: 'good' });
  assert.deepEqual(a.lock, ['a.txt']);
  assert.equal(a.project.at, 'make2');
  assert.equal(a.project.stages.gate1.status, 'done');
  assert.equal(a.project.stages.gate1.note, 'Approved: good');
  assert.match(S.approve(a.project, R).error, /agent's stage/);
});

test('send back goes to the make stage before (or to back), needs notes, resets the stages between', () => {
  const p = toGate();
  assert.match(S.sendback(p, R, {}).error, /needs notes/);
  const s = S.sendback(p, R, { notes: 'tighter', now: 5 });
  assert.equal(s.target.id, 'make1');
  assert.equal(s.project.at, 'make1');
  assert.equal(s.project.stages.make1.status, 'todo');
  assert.equal(s.project.stages.make1.note, 'Sent back: tighter');
  assert.equal(s.project.stages.gate1.status, 'todo');
  assert.ok(S.shouldChain(s.project, R), 'a send-back runs the target at once');
  assert.equal(S.sendbackTarget(R, 'gate2').id, 'make2');
  assert.equal(S.sendbackTarget(R, 'out').id, 'make2');
  assert.equal(S.sendbackTarget(R, 'ask'), null);
});

test('locks: which bind a stage, which a send-back drops', () => {
  const locks = { 'a.txt': { sha256: 'x', stage: 'gate1' }, 'b.txt': { sha256: 'y', stage: 'gate2' } };
  assert.deepEqual(Object.keys(S.activeLocks(locks, R, 'make2')), ['a.txt']);
  assert.deepEqual(Object.keys(S.activeLocks(locks, R, 'make1')), []);
  assert.deepEqual(Object.keys(S.activeLocks(locks, R, 'out')), ['a.txt', 'b.txt']);
  assert.deepEqual(Object.keys(S.dropLocks(locks, R, S.indexOf(R, 'make1'))), []);
  assert.deepEqual(Object.keys(S.dropLocks(locks, R, S.indexOf(R, 'make2'))), ['a.txt']);
});

test('a lock halt: approve the new version moves on (after) or reopens (before); send back goes before the locking gate', () => {
  let p = S.approve(toGate(), R).project;            // at make2, a.txt locked by gate1
  p = S.begin(p, R).project;
  const h = S.halt(p, R, 'changed', { lockBroken: { files: [{ file: 'a.txt', why: 'changed' }], gate: 'gate1', when: 'after' } });
  assert.equal(h.stages.make2.status, 'halted');
  assert.match(S.canGo(h, R).error, /halted/);
  assert.deepEqual(S.view(h, R).actions, ['approve', 'sendback']);
  const done = S.unhalt(h, R, { done: true });
  assert.equal(done.at, 'check');
  assert.equal(done.halted, undefined);
  const again = S.unhalt(h, R);
  assert.equal(again.at, 'make2');
  assert.equal(again.stages.make2.status, 'todo');
  const s = S.sendback(h, R, { notes: 'redo the rough' });
  assert.equal(s.target.id, 'make1');
  assert.equal(s.project.halted, undefined);
  assert.equal(s.project.stages.make2.status, 'todo');
});

test('view: chips, totals and the buttons that apply', () => {
  let p = fresh();
  assert.deepEqual(S.view(p, R).actions, ['go']);
  p = S.begin(p, R).project;
  assert.deepEqual(S.view(p, R).actions, ['stop']);
  p = S.turnEnded(p, R, { ms: 100, cost: 0.25, ready: true }).project;
  const v = S.view(p, R);
  assert.equal(v.total.ms, 100);
  assert.equal(v.total.cost, 0.25);
  assert.equal(v.chips[0].status, 'done');
  assert.equal(v.chips[1].now, true);
  assert.equal(v.chips[1].who, 'agent');
  const g = S.view(toGate(), R);
  assert.deepEqual(g.actions, ['approve', 'sendback']);
  assert.equal(g.chips[2].forYou, true);
});

test('the last stage done ends the project; a restart makes running stages todo', () => {
  const r = { id: 'x', stages: [{ id: 'm', kind: 'make' }] };
  let p = { ...S.initStages(r) };
  p = S.turnEnded(S.begin(p, r).project, r, { ready: true }).project;
  assert.equal(p.done, true);
  assert.match(S.canGo(p, r).error, /is done/);
  const q = S.begin({ ...S.initStages(r) }, r).project;
  const i = S.interrupted(q);
  assert.equal(i.stages.m.status, 'todo');
  assert.equal(S.interrupted(p), null);
});

test('normalize fills stages a recipe gained', () => {
  const p = S.normalize({ id: 'p', at: 'make1', stages: { ask: { status: 'done' } } }, R);
  assert.equal(p.stages.make2.status, 'todo');
  assert.equal(p.stages.ask.status, 'done');
  assert.equal(p.at, 'make1');
  assert.equal(S.normalize({ stages: { ask: { status: 'done' } } }, R).at, 'make1');
});
