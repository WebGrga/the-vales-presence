import test from 'node:test';
import assert from 'node:assert/strict';
import { chips, totals, actions, fmtMs, fmtCost, title, recipeOf, elapsed, fmtClock, shortTitle, chipMode, isLocked, pendingOf, pendingFrom, plainChoices, sentBack, behindOf } from './stages.js';

const recipe = { stages: [
  { id: 'ask', kind: 'ask' }, { id: 'rough', kind: 'make', heavy: true },
  { id: 'rough-review', kind: 'gate', lock: ['video/out/edl.json'] }, { id: 'visuals', kind: 'make' },
] };

test('chips carry state, time and cost', () => {
  const p = { at: 'rough-review', stages: { ask: { status: 'done', ms: 4000, cost: 0.1 }, rough: { status: 'done', ms: 60000, cost: 0.5 }, 'rough-review': { status: 'waiting' } } };
  const cs = chips(p, recipe);
  assert.deepEqual(cs.map((c) => c.state), ['done', 'done', 'you', 'todo']);
  assert.equal(cs[2].lock, true); assert.equal(cs[0].title, 'Ask');
  assert.deepEqual(totals(cs), { ms: 64000, cost: 0.6 });
  const a = actions(p, cs);
  assert.equal(a.approve, true); assert.equal(a.sendback, true); assert.equal(a.go, false); assert.equal(a.approveLabel, 'Approve & lock');
});

test('running, halted and ready stages', () => {
  const run = { at: 'rough', stages: { rough: { status: 'running' } } };
  const a = actions(run, chips(run, recipe));
  assert.equal(a.stop, true); assert.equal(a.go, false);
  const ready = { at: 'visuals', stages: {} };
  const cs = chips(ready, recipe);
  assert.equal(cs[3].state, 'ready'); assert.equal(actions(ready, cs).go, true);
  const halt = { at: 'visuals', halted: 'a locked file changed', stages: {} };
  const h = actions(halt, chips(halt, recipe));
  assert.equal(h.halted, true); assert.equal(h.go, false);
});

test('without a recipe the project stages are the chips', () => {
  const cs = chips({ at: 'x', stages: { x: { status: 'running' } } }, null);
  assert.deepEqual(cs.map((c) => [c.id, c.state]), [['x', 'now']]);
});

test('formats', () => {
  assert.equal(fmtMs(0), ''); assert.equal(fmtMs(4200), '4 s'); assert.equal(fmtMs(190000), '3 min 10 s'); assert.equal(fmtMs(3720000), '1 h 2 min');
  assert.equal(fmtCost(0), ''); assert.equal(fmtCost(0.004), '<$0.01'); assert.equal(fmtCost(1.234), '$1.23');
  assert.equal(title('rough-review'), 'Rough review');
});

test('the server actions win, and its recipe is recipeDef', () => {
  const p = { at: 'rough', recipe: 'edit', recipeDef: recipe, stages: { rough: { status: 'halted' } }, halted: 'a locked file changed', view: { actions: ['resume', 'sendback'] } };
  assert.equal(recipeOf(p), recipe); assert.equal(recipeOf({ recipe: 'edit' }), null);
  const a = actions(p, chips(p, recipeOf(p)));
  assert.equal(a.resume, true); assert.equal(a.sendback, true); assert.equal(a.go, false); assert.equal(a.halted, true);
});

test('the agent waiting for your answer: the chip asks, Stop and Go hide, Answer shows', () => {
  const p = { at: 'ask', stages: { ask: { status: 'running', started: 1000 } } };
  const r = { stages: [{ id: 'ask', kind: 'ask', title: 'Brief' }, { id: 'rough', kind: 'make' }] };
  const cs = chips(p, r, { asking: true });
  assert.equal(cs[0].state, 'ask');
  const a = actions(p, cs);
  assert.equal(a.answer, true); assert.equal(a.stop, false); assert.equal(a.go, false);
  const sv = actions({ ...p, view: { actions: ['stop'] } }, cs);
  assert.equal(sv.stop, false); assert.equal(sv.answer, true);
  // an agent stage that ended its turn with a question in words is also waiting for you
  const w = { at: 'ask', stages: { ask: { status: 'waiting' } } };
  assert.equal(chips(w, r)[0].state, 'ask');
  // working: Stop shows
  const run = chips(p, r);
  assert.equal(run[0].state, 'now'); assert.equal(actions(p, run).stop, true);
});

test('queued: waiting in line behind another project', () => {
  const r = { stages: [{ id: 'rough', kind: 'make' }] };
  const p = { at: 'rough', stages: { rough: { status: 'todo', note: 'Queued: another project is rendering.' } } };
  const cs = chips(p, r);
  assert.equal(cs[0].state, 'queued'); assert.equal(cs[0].behind, null);
  const a = actions(p, cs);
  assert.equal(a.go, false); assert.equal(a.stop, true);
  const q = { at: 'rough', stages: { rough: { status: 'todo', queued: { since: 1 } } }, view: { queued: { stage: 'rough', behind: [{ title: 'Other video', stageTitle: 'Visuals' }] } } };
  assert.equal(chips(q, r)[0].state, 'queued');
  assert.equal(chips(q, r)[0].behind, 'Other video (Visuals)');
  const n = { at: 'rough', stages: { rough: { status: 'todo', note: 'Waiting in line: another project is rendering.' } } };
  assert.equal(chips(n, r)[0].state, 'queued');
  assert.equal(behindOf([{ project: 'a' }, { project: 'b' }]), 'a and 1 more'); assert.equal(behindOf(null), null);
});

test('elapsed time of the running round, and the clock', () => {
  const [c] = chips({ at: 'x', stages: { x: { status: 'running', started: 10000 } } }, { stages: [{ id: 'x', kind: 'make' }] });
  assert.equal(elapsed(c, 75000), 65000);
  assert.equal(elapsed({ ...c, state: 'done' }, 75000), 0);
  assert.equal(fmtClock(65000), '1:05'); assert.equal(fmtClock(3725000), '1:02:05'); assert.equal(fmtClock(0), '0:00');
});

test('totals take Studio and talking to the agent in', () => {
  const cs = [{ ms: 1000, cost: 1 }, { ms: 2000, cost: 2 }];
  const t = totals(cs, { chat: { ms: 500, cost: 0.5 } });
  assert.equal(t.ms, 3500); assert.equal(t.cost, 3.5); assert.deepEqual(t.stages, { ms: 3000, cost: 3 });
  assert.equal(t.extras[0].label, 'Studio and talking to the agent');
  const s = totals(cs, { studio: { ms: 100, cost: 0.1 }, chat: { ms: 0, cost: 0 } });
  assert.deepEqual(s.extras.map((x) => x.label), ['Studio']);
  assert.deepEqual(totals(cs), { ms: 3000, cost: 3 });
});

test('short names and how the chips fit', () => {
  assert.equal(shortTitle('Rough review'), 'Rough'); assert.equal(shortTitle('A video'), 'Video'); assert.equal(shortTitle('Thumbnails'), 'Thumbnails');
  assert.equal(chipMode({ full: 800, compact: 500 }, 900), 'full');
  assert.equal(chipMode({ full: 1400, compact: 800 }, 900), 'compact');
  assert.equal(chipMode({ full: 1400, compact: 1000 }, 900), 'tiny');
  assert.equal(chipMode({ full: 1400, compact: 1000, smart: 800 }, 900), 'smart');
  assert.equal(chipMode({ full: 1400, compact: 1000, smart: 950 }, 900), 'tiny');
  const cs = chips({ at: 'a', stages: {} }, { stages: [{ id: 'a', title: 'Final review' }, { id: 'b', short: 'Feed' }] });
  assert.deepEqual(cs.map((c) => [c.n, c.short]), [[1, 'Final'], [2, 'Feed']]);
});

test('locked once a lock gate is approved', () => {
  assert.equal(isLocked({ stages: { 'rough-review': { status: 'done' } } }, recipe), true);
  assert.equal(isLocked({ stages: { 'rough-review': { status: 'waiting' } } }, recipe), false);
  assert.equal(isLocked({}, null), false);
});

test('what the rough does not have yet is said before Approve', () => {
  const p = pendingOf({ c5: { keep: false }, c3: { keep: true }, c12: { keep: false, note: 'x' } }, { working: { strikes: [['a', 1, 2]] } });
  assert.deepEqual(p.restored, ['c5', 'c12']); assert.equal(p.strikes, 1); assert.equal(p.any, true);
  assert.match(p.say, /^You restored 2 cuts \(c5, c12\) and you struck 1 stretch of words\. The rough does not have these yet/);
  assert.equal(pendingOf({ c1: { keep: true } }, null).any, false);
  assert.equal(pendingOf({}, { working: { trims: [1] } }).say.startsWith('You moved 1 join.'), true);
  // the server's own count wins when it gives one
  assert.equal(pendingFrom({ view: { pending: null } }, { c1: { keep: false } }, null).any, false);
  assert.deepEqual(pendingFrom({ view: { pending: { restored: ['c2'], strikes: 0 } } }, {}, null).restored, ['c2']);
  assert.equal(plainChoices(' tighter ', p), 'tighter\n\nRestore c5, c12. I struck 1 stretch in the transcript (in video/out/edl.working.json).');
  assert.equal(plainChoices('', pendingOf({}, null)), '');
});

test('the notes a send-back carried, while the stage it went to works', () => {
  const p = { stages: { rough: { status: 'running', note: 'Sent back: Restore c5.', sentBack: 9 } } };
  assert.deepEqual(sentBack(p, recipe), { stage: 'rough', title: 'Rough', notes: 'Restore c5.', at: 9 });
  assert.equal(sentBack({ stages: { rough: { status: 'done', note: 'Sent back: x' } } }, recipe), null);
});

test('stages that share a short name keep their whole titles, so two chips never read the same', () => {
  const cs = chips({ at: 'a', stages: {} }, { stages: [{ id: 'plan', title: 'Plan' }, { id: 'plan-review', title: 'Plan review' }, { id: 'rough', title: 'Rough cut' }] });
  assert.deepEqual(cs.map((c) => c.short), ['Plan', 'Plan review', 'Rough']);
});
