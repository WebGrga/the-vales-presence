// The runner end to end with a fake agent: Go, an ask stage that waits for an answer, chaining, approve & lock,
// a lock halt after a make stage, approving the new version, send back with notes. No Claude call.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProjects } from './projects.js';
import { createRunner, missingOut } from './run.js';
import { readLocks } from './locks.js';

// every temp folder a test makes is removed when the file's tests end
const made = [];
const track = (d) => { made.push(d); return d; };
after(() => { for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

test('missingOut', () => {
  const have = new Set(['a.txt', 'dir/']);
  assert.deepEqual(missingOut(['a.txt', 'b.txt', '../x', 'dir/'], (r) => have.has(r) || have.has(r + '/')), ['b.txt', '../x']);
});

function world() {
  const root = track(fs.mkdtempSync(path.join(os.tmpdir(), 'presence-run-')));
  const w = (rel, v) => { const f = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v)); };
  w('craft/stages.json', { ask: { instruction: 'ASK' }, make: { instruction: 'MAKE' }, gate: {}, inspect: { instruction: 'INSPECT' }, export: {} });
  w('craft/recipes/t.json', { id: 't', name: 'T', stages: [
    { id: 'ask', kind: 'ask', out: ['brief.md'] },
    { id: 'rough', kind: 'make', out: ['video/out/rough.mp4'], heavy: true },
    { id: 'review', kind: 'gate', lock: ['video/out/rough.mp4'] },
    { id: 'visuals', kind: 'make', out: ['video/out/final.mp4'] },
    { id: 'final', kind: 'gate', back: 'visuals' },
  ] });
  const dataDir = path.join(root, 'data');
  const msgs = [];
  const turns = [];
  let script = () => ({});
  const agent = {
    busy: false,
    isBusy() { return this.busy; },
    status: () => ({ question: null }),
    emit: (id, event, extra) => msgs.push({ type: 'agent', event, ...extra }),
    async turn(id, text, { stage }) { turns.push({ stage, text }); const r = (await script(stage, text, dir(id))) || {}; return { text: r.text || 'ok', cost: r.cost ?? 0.01, ms: r.ms ?? 5, ...r }; },
    async say(id, text) { return { started: true }; },
    async stop() { return { stopped: true }; },
  };
  const ctx = { root, dataDir, projectDir: (id) => path.join(dataDir, 'projects', id), broadcast: (m) => msgs.push(m), log: () => {}, agent };
  ctx.projects = createProjects(ctx);
  ctx.runner = createRunner(ctx);
  const dir = (id) => ctx.projectDir(id);
  const put = (id, rel, text = 'x') => { const f = path.join(dir(id), ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  const settle = () => new Promise((r) => setTimeout(r, 80)); // the runner chains on in the background; a loaded machine needs a moment
  return { ctx, msgs, turns, put, settle, setScript: (f) => (script = f), dir };
}

test('a project runs through its stages', async () => {
  const W = world();
  const { ctx, put, settle } = W;
  const p = ctx.projects.create({ title: 'My First Video!', recipe: 't' });
  assert.equal(p.id, 'my-first-video');
  assert.ok(fs.existsSync(path.join(W.dir(p.id), 'video', 'footage')));
  const id = p.id;

  // the ask stage asks first (no brief yet): it waits, and the last text goes out as a question
  W.setScript((stage) => (stage === 'ask' ? { text: 'Who is it for?' } : {}));
  assert.deepEqual(await ctx.runner.go(id), { ok: true, stage: 'ask' });
  await settle();
  let q = ctx.projects.get(id);
  assert.equal(q.stages.ask.status, 'waiting');
  assert.ok(W.msgs.some((m) => m.event === 'question' && m.text === 'Who is it for?'));
  assert.match(W.turns[0].text, /ASK/);

  // the answer continues the stage; it writes brief.md; the rough chains on and makes its file
  W.setScript((stage, text, d) => {
    if (stage === 'ask') { assert.match(text, /The user answers:\n\nbeginners/); put(id, 'brief.md', 'For beginners.'); }
    if (stage === 'rough') { assert.match(text, /For beginners\./); put(id, 'video/out/rough.mp4', 'v1'); return { cost: 0.5, ms: 100 }; }
    return {};
  });
  assert.equal((await ctx.runner.say(id, 'beginners')).resumed, 'ask');
  await settle();
  q = ctx.projects.get(id);
  assert.equal(q.stages.ask.status, 'done');
  assert.equal(q.stages.rough.status, 'done');
  assert.equal(q.stages.rough.cost, 0.5);
  assert.equal(q.at, 'review');
  assert.equal(q.stages.review.status, 'waiting');
  const log = ctx.projects.readLog(id);
  assert.ok(log.some((l) => l.stage === 'rough' && l.status === 'done' && l.ms === 100 && l.cost === 0.5));

  // approve & lock hashes the rough; visuals chains on and (wrongly) changes the locked file: the project halts
  W.setScript((stage) => { if (stage === 'visuals') { put(id, 'video/out/rough.mp4', 'v2'); put(id, 'video/out/final.mp4'); } return {}; });
  assert.deepEqual((await ctx.runner.approve(id, { notes: 'nice' })).locked, ['video/out/rough.mp4']);
  await settle();
  assert.equal(readLocks(W.dir(id))['video/out/rough.mp4'].stage, 'review');
  assert.match(W.turns.at(-1).text, /Locked by your approval/);
  q = ctx.projects.get(id);
  assert.match(q.halted, /A locked file changed after you approved review \(video\/out\/rough.mp4\)/);
  assert.equal(q.lockBroken.when, 'after');
  assert.equal(q.stages.visuals.status, 'halted');
  assert.equal((await ctx.runner.go(id)).error.startsWith('the project is halted'), true);

  // approving the new version re-locks it and moves on
  const a = await ctx.runner.approve(id, {});
  assert.deepEqual(a.relocked, ['video/out/rough.mp4']);
  q = ctx.projects.get(id);
  assert.equal(q.halted, undefined);
  assert.equal(q.at, 'final');

  // send back from the final review goes to visuals with the notes; it runs at once
  W.setScript((stage, text) => { if (stage === 'visuals') assert.match(text, /Sent back to you[\s\S]*bigger captions/); return {}; });
  assert.equal((await ctx.runner.sendback(id, { notes: 'bigger captions' })).to, 'visuals');
  await settle();
  q = ctx.projects.get(id);
  assert.equal(q.at, 'final');
  assert.equal(q.stages.visuals.round, 2);
  assert.ok(readLocks(W.dir(id))['video/out/rough.mp4'], 'the rough stays locked: the gate is before visuals');
  assert.deepEqual((await ctx.runner.approve(id, {})).ok, true);
  assert.equal(ctx.projects.get(id).done, true);
});

test('a send-back to before the locking gate drops its locks; a stage that fails holds', async () => {
  const W = world();
  const { ctx, put, settle } = W;
  const id = ctx.projects.create({ title: 'x', recipe: 't' }).id;
  W.setScript((stage) => { if (stage === 'ask') put(id, 'brief.md'); if (stage === 'rough') put(id, 'video/out/rough.mp4'); if (stage === 'visuals') return { error: 'error_during_execution' }; return {}; });
  await ctx.runner.go(id); await settle();
  await ctx.runner.approve(id, {}); await settle();
  let q = ctx.projects.get(id);
  assert.equal(q.at, 'visuals');
  assert.equal(q.stages.visuals.status, 'todo');
  assert.match(q.stages.visuals.note, /failed/);
  // a refusal answers with an error, nothing changes
  assert.match((await ctx.runner.approve(id, {})).error, /agent's stage/);
  // the agent is busy: Go refuses
  ctx.agent.busy = true;
  assert.match((await ctx.runner.go(id)).error, /busy/);
  ctx.agent.busy = false;
  W.setScript((stage) => { if (stage === 'visuals') put(id, 'video/out/final.mp4'); return {}; });
  await ctx.runner.go(id); await settle();
  assert.equal(ctx.projects.get(id).at, 'final');
  W.setScript(() => ({}));
  // final's back is visuals; the review gate before it keeps its lock
  const s = await ctx.runner.sendback(id, { notes: 'n' });
  assert.equal(s.to, 'visuals');
  await settle();
  assert.ok(Object.keys(readLocks(W.dir(id))).length === 1);
});

test('the server restarting marks running stages todo', () => {
  const W = world();
  const { ctx } = W;
  const id = ctx.projects.create({ title: 'y', recipe: 't' }).id;
  ctx.projects.update(id, (p) => { p.stages.ask.status = 'running'; return p; });
  ctx.runner.boot();
  const q = ctx.projects.get(id);
  assert.equal(q.stages.ask.status, 'todo');
  assert.match(q.stages.ask.note, /server stopped/);
});
