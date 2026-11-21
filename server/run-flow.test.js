// The runner on the audit's flows with a fake agent (no Claude call): a send-back of the rough clears the working list
// so Approve & lock works on the next rough; Stop on a send-back and go back to the final you had; a heavy stage in
// line says what it waits behind and starts when that one ends.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProjects } from './projects.js';
import { createRunner } from './run.js';

const made = [];
after(() => { for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

function world() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'presence-flow-')); made.push(root);
  const w = (rel, v) => { const f = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v)); };
  w('craft/stages.json', { make: { instruction: 'MAKE' }, gate: {}, inspect: { instruction: 'INSPECT' }, export: {} });
  w('craft/recipes/e.json', { id: 'e', name: 'E', stages: [
    { id: 'rough', kind: 'make', heavy: true, out: ['video/out/edl.json', 'video/out/rough.mp4', 'video/out/cuts.json'] },
    { id: 'rough-review', kind: 'gate', back: 'rough', lock: ['video/out/edl.json', 'video/out/rough.mp4'] },
    { id: 'visuals', kind: 'make', title: 'Visuals', heavy: true, out: ['video/out/final.mp4'] },
    { id: 'inspect', kind: 'inspect', out: ['inspect.md'] },
    { id: 'final-review', kind: 'gate', title: 'Final review', back: 'visuals' },
    { id: 'export', kind: 'export' },
  ] });
  const dataDir = path.join(root, 'data');
  const msgs = [];
  const gates = {}; // project id -> a promise the fake turn waits on (to keep a stage running)
  let script = () => ({});
  const agent = {
    busy: new Set(),
    isBusy(id) { return this.busy.has(id); },
    status: () => ({ question: null }),
    live: () => ({}),
    emit: (id, event, extra) => msgs.push({ type: 'agent', event, ...extra }),
    async turn(id, text, { stage }) {
      this.busy.add(id);
      try {
        if (gates[id]) await gates[id];
        const r = (await script(id, stage, text)) || {};
        return { text: 'ok', cost: 0.01, ms: 5, ...r };
      } finally { this.busy.delete(id); }
    },
    async say() { return { started: true }; },
    async stop(id) { return { stopped: true }; },
  };
  const ctx = { root, dataDir, projectDir: (id) => path.join(dataDir, 'projects', id), broadcast: (m) => msgs.push(m), log: () => {}, agent };
  ctx.projects = createProjects(ctx);
  ctx.runner = createRunner(ctx);
  const put = (id, rel, text = 'x') => { const f = path.join(ctx.projectDir(id), ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  const has = (id, rel) => fs.existsSync(path.join(ctx.projectDir(id), ...rel.split('/')));
  const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));
  // wait until the project stands on a stage with a status (the runner chains on in the background)
  const until = async (id, at, status) => {
    for (let i = 0; i < 200; i++) { const p = ctx.projects.get(id); if (p.at === at && (!status || p.stages[at]?.status === status)) return; await settle(10); }
    assert.fail(`${id} never reached ${at} ${status || ''} (it is at ${ctx.projects.get(id).at})`);
  };
  return { ctx, msgs, put, has, settle, until, gates, setScript: (f) => (script = f) };
}
const roughFiles = (W, id, n) => {
  W.put(id, 'video/out/edl.json', JSON.stringify({ total: 100 + n, items: Array.from({ length: n }, () => ({})) }));
  W.put(id, 'video/out/rough.mp4', 'rough' + n);
  W.put(id, 'video/out/cuts.json', JSON.stringify({ cuts: [{ id: 'c1' }, { id: 'c5' }] }));
};

test('audit B2: after a send-back of the rough, Approve & lock works on the new rough', async () => {
  const W = world(); const { ctx } = W;
  const p = ctx.projects.create({ title: 'B2', recipe: 'e' });
  let n = 3;
  W.setScript((id, stage) => { if (stage === 'rough') roughFiles(W, id, n); });
  await ctx.runner.go(p.id); await W.until(p.id, 'rough-review');
  // round 1: a restore and a strike on this rough
  W.put(p.id, 'video/out/cuts-review.json', JSON.stringify({ c5: { keep: false } }));
  W.put(p.id, 'video/out/edl.working.json', JSON.stringify({ items: [], working: { base: '103:3', strikes: [['r1', 1, 2]] } }));
  const refused = await ctx.runner.approve(p.id);
  assert.match(refused.error, /you restored c5 and you struck 1 stretch/);
  assert.equal(refused.suggest, 'sendback');
  assert.deepEqual(refused.pending, { restored: ['c5'], strikes: 1, trims: 0 });
  // send back: the review and the working list go aside together, and the rough runs again
  n = 4;
  const sb = await ctx.runner.sendback(p.id, { notes: 'apply my choices' });
  assert.equal(sb.archived.length, 2);
  assert.ok(!W.has(p.id, 'video/out/edl.working.json'));
  assert.ok(!W.has(p.id, 'video/out/cuts-review.json'));
  await W.until(p.id, 'rough-review');
  const ok = await ctx.runner.approve(p.id);
  assert.equal(ok.error, undefined);
  assert.ok(ok.ok);
  // and a stale working list left by an older screen binds nothing either
  const q = ctx.projects.create({ title: 'B2b', recipe: 'e' });
  await ctx.runner.go(q.id); await W.until(q.id, 'rough-review');
  W.put(q.id, 'video/out/edl.working.json', JSON.stringify({ items: [], working: { base: '999:9', strikes: [['r1', 1, 2]] } }));
  assert.ok((await ctx.runner.approve(q.id)).ok);
});

test('audit B7: Stop on a send-back, then go back to the final you had without running anything', async () => {
  const W = world(); const { ctx } = W;
  const p = ctx.projects.create({ title: 'B7', recipe: 'e' });
  W.setScript((id, stage) => {
    if (stage === 'rough') roughFiles(W, id, 3);
    if (stage === 'visuals') W.put(id, 'video/out/final.mp4', 'final1');
    if (stage === 'inspect') W.put(id, 'inspect.md', '# ok');
  });
  await ctx.runner.go(p.id); await W.until(p.id, 'rough-review');
  await ctx.runner.approve(p.id); await W.until(p.id, 'final-review');
  // send back, and the fix grinds until you press Stop
  let release; W.gates[p.id] = new Promise((r) => (release = r));
  W.setScript((id, stage) => (stage === 'visuals' ? { stopped: true, cost: 1.1 } : {}));
  await ctx.runner.sendback(p.id, { notes: 'blur the numbers' }); await W.until(p.id, 'visuals', 'running');
  assert.ok(!ctx.runner.view(p.id).actions.includes('keep'));
  release(); delete W.gates[p.id]; await W.until(p.id, 'visuals', 'todo');
  const v = ctx.runner.view(p.id);
  assert.equal(v.at, 'visuals');
  assert.ok(v.actions.includes('keep'));
  assert.equal(v.keep.mode, 'back');
  assert.match(ctx.projects.get(p.id).stages.visuals.note, /go back to what you had/);
  const k = await ctx.runner.keep(p.id);
  assert.equal(k.mode, 'back');
  const after2 = ctx.projects.get(p.id);
  assert.equal(after2.at, 'final-review');
  assert.equal(after2.stages['final-review'].status, 'waiting');
  assert.ok(ctx.runner.view(p.id).actions.includes('approve'));
  assert.ok(ctx.projects.readLog(p.id).some((l) => l.status === 'kept'));
});

test('audit C5: a heavy stage in line says what it waits behind, and starts when that one ends', async () => {
  const W = world(); const { ctx, msgs } = W;
  const a = ctx.projects.create({ title: 'Long one', recipe: 'e' });
  const b = ctx.projects.create({ title: 'Second', recipe: 'e' });
  let release; W.gates[a.id] = new Promise((r) => (release = r));
  W.setScript((id, stage) => { if (stage === 'rough') roughFiles(W, id, 3); });
  assert.ok((await ctx.runner.go(a.id)).ok);
  const q = await ctx.runner.go(b.id);
  assert.equal(q.queued, true);
  assert.equal(q.text, 'Waiting in line behind Long one (rough). It starts by itself when that one ends.');
  assert.equal(ctx.runner.view(b.id).queued.behind[0].project, a.id);
  assert.ok(msgs.some((m) => m.type === 'queue' && m.project === b.id && m.position === 1));
  assert.ok(msgs.some((m) => m.type === 'toast' && /Waiting in line behind Long one/.test(m.text)));
  release(); delete W.gates[a.id]; await W.until(b.id, 'rough-review');
  assert.equal(ctx.projects.get(b.id).stages.rough.queued, undefined);
  assert.ok(msgs.some((m) => m.type === 'queue' && m.project === b.id && m.started));
  // Stop takes a project out of the line
  const c = ctx.projects.create({ title: 'Third', recipe: 'e' });
  W.gates[a.id] = new Promise(() => {});
  await ctx.runner.sendback(a.id, { notes: 'again' });
  assert.equal((await ctx.runner.go(c.id)).queued, true);
  const s = await ctx.runner.stop(c.id);
  assert.equal(s.unqueued, true);
  assert.equal(ctx.runner.view(c.id).queued, null);
  assert.deepEqual(ctx.runner.queued(), []);
});
