import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as F from './fires.js';

test('the fire list follows the task messages', () => {
  const f = F.newFires();
  let r = F.onMessage(f, { type: 'system', subtype: 'task_started', task_id: 't1', tool_use_id: 'u1', is_backgrounded: true, task_type: 'local_bash', description: 'python run.py --final' }, 5);
  assert.ok(r.handled);
  assert.deepEqual(r.events, [{ id: 't1', state: 'burning', cmd: 'python run.py --final', out: null }]);
  assert.equal(F.burning(f), 1);
  const got = F.onResult(f, 'u1', 'Command running in background with ID: t1. Output is being written to: C:\\tmp\\tasks\\t1.output');
  assert.equal(got.out, 'C:\\tmp\\tasks\\t1.output');
  r = F.onMessage(f, { type: 'system', subtype: 'task_notification', task_id: 't1', status: 'completed' });
  assert.equal(r.events[0].state, 'done');
  assert.equal(r.events[0].out, 'C:\\tmp\\tasks\\t1.output');
  assert.equal(F.burning(f), 0);
  // foreground tasks are not fires; a later move to the background is
  F.onMessage(f, { type: 'system', subtype: 'task_started', task_id: 't2', is_backgrounded: false });
  assert.equal(F.burning(f), 0);
  F.onMessage(f, { type: 'system', subtype: 'task_updated', task_id: 't2', patch: { is_backgrounded: true, description: 'encode' } });
  assert.equal(F.burning(f), 1);
  // the level signal replaces the set
  r = F.onMessage(f, { type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 't3', description: 'x' }, { task_id: 'amb', ambient: true }] });
  assert.deepEqual(F.list(f).map((x) => x.id), ['t3']);
  assert.ok(!F.onMessage(f, { type: 'assistant' }).handled);
});

test('outputPathOf finds the output file', () => {
  assert.equal(F.outputPathOf('written to: /tmp/claude/abc.output now'), '/tmp/claude/abc.output');
  assert.equal(F.outputPathOf('nothing here'), null);
});

test('servers never hold a stage', () => {
  assert.deepEqual(F.holdable([{ cmd: 'npm run dev' }, { cmd: 'python -m http.server' }, { cmd: 'python run.py --final' }]).map((x) => x.cmd), ['python run.py --final']);
});

test('a stage sleeps while its fire burns, is woken once, and delivers everything', () => {
  const W = F.newWait();
  const h = F.turnEnded(W, { stage: true, fires: [{ cmd: 'render', out: '/o.log' }], text: 'started the render', cost: 0.2, ms: 1000, now: 10 });
  assert.equal(h.do, 'hold');
  assert.ok(W.waiting);
  assert.deepEqual(F.firesChanged(W, 1), null);
  assert.deepEqual(F.firesChanged(W, 0), { do: 'arm', ms: F.WAKE_MS });
  assert.equal(F.firesChanged(W, 0), null, 'armed once');
  assert.equal(F.wakeDue(W, { busy: true, n: 0 }), null, 'not while a turn runs');
  const w = F.wakeDue(W, { busy: false, n: 0, tail: 'frames: 600\nOK' });
  assert.equal(w.do, 'wake');
  assert.match(w.text, /background task finished \(render\)/);
  assert.match(w.text, /\/o\.log/);
  assert.match(w.text, /OK/);
  assert.match(w.text, /Continue the stage/);
  assert.equal(F.wakeDue(W, { busy: false, n: 0 }), null, 'exactly one wake');
  const d = F.turnEnded(W, { stage: true, fires: [], text: 'final is done', cost: 0.1, ms: 500 });
  assert.equal(d.do, 'deliver');
  assert.equal(d.text, 'started the render\n\nfinal is done');
  assert.ok(Math.abs(d.cost - 0.3) < 1e-9);
  assert.equal(d.ms, 1500);
  assert.equal(W.waiting, false);
});

test('a turn the SDK starts itself disarms the wake; a chat turn is never held', () => {
  const W = F.newWait();
  F.turnEnded(W, { stage: true, fires: [{ cmd: 'x' }], text: 'a' });
  F.firesChanged(W, 0);
  assert.deepEqual(F.turnStarted(W), { do: 'disarm' });
  assert.equal(F.wakeDue(W, { busy: false, n: 0 }), null);
  const W2 = F.newWait();
  assert.equal(F.turnEnded(W2, { stage: false, fires: [{ cmd: 'x' }], text: 'hi' }).do, 'deliver');
  assert.equal(F.turnEnded(F.newWait(), { stage: true, fires: [{ cmd: 'x' }], error: 'boom' }).do, 'deliver');
});

test('a fire that burns too long, or a session that closes, hands the stage back', () => {
  const W = F.newWait();
  F.turnEnded(W, { stage: true, fires: [{ cmd: 'x' }], text: 'a', cost: 1, now: 1 });
  assert.equal(F.expired(W, 10, 100), null);
  const e = F.expired(W, 101, 100);
  assert.equal(e.error, 'a background task ran for too long');
  assert.equal(e.cost, 1);
  const W2 = F.newWait();
  assert.equal(F.closed(W2), null);
  F.turnEnded(W2, { stage: true, fires: [{ cmd: 'x' }], text: 'a', now: 0 });
  assert.equal(F.closed(W2, 'b').text, 'a\n\nb');
  assert.equal(F.closed(W2), null, 'once');
});
