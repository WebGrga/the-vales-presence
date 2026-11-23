// The stage runner: Go, approve, send back, answer, stop, resume, keep. The decisions are in stages.js, stage-keep.js and
// stage-view.js (pure); this reads and writes the project, builds the stage prompt (prompt.js), runs the agent
// (agent.js), checks the locks (locks.js) and logs every stage to .presence/log.jsonl and project.json. Agent stages
// chain on by themselves until a stage waits for you; heavy stages (renders) run one at a time across projects
// (settings.heavy, default 1): one in line says what it waits behind (run-live.js).
import fs from 'node:fs';
import path from 'node:path';
import * as St from './stages.js';
import { lockFiles, checkLocks, readLocks, writeLocks, needsCheck, lockSentence, gateOf, lockMessage, safeRel } from './locks.js';
import { stagePrompt, answerPrompt, studioNote, STUDIO_STAGES } from './prompt.js';
import { createCraft } from './craft.js';
import { listFootage } from './footage.js';
import { reviewSummary, readCuts, pendingChoices, workingFile, sendbackArchive, archivedName } from './cuts.js';
import { keepExisting } from './stage-keep.js';
import { createLive, outState, withBack } from './run-live.js';
import { ITEMS_FILE } from './review-items.js';
import { createExtras } from './run-extra.js';
import { addedRules, rulesNotice } from './context/rules-diff.js';

const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const readJsonOr = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

// pure: which `out` files are missing (a path ending in / must be a folder with something in it)
export function missingOut(out, exists) {
  return (out || []).filter((rel) => { const s = safeRel(rel); return !s || !exists(s); });
}

export function createRunner(ctx) {
  const craft = ctx.craft || (ctx.craft = createCraft(ctx));
  const P = () => { if (!ctx.projects) throw new Error('projects.js is not loaded'); return ctx.projects; };
  const A = () => { if (!ctx.agent) throw Object.assign(new Error('the agent is not available (agent.js did not load)'), { status: 503 }); return ctx.agent; };
  const toast = (text, kind = 'info', project) => ctx.broadcast({ type: 'toast', text, kind, project });
  const heavyRunning = new Set(), queue = [];
  const stopAfter = new Set(); // projects whose running stage is the last one to run by itself ("Stop after this stage")
  const warned = new Set();    // spend limits already told today / this month
  const limit = () => Number(readSettings().heavy) || 1;
  function readSettings() { try { return JSON.parse(fs.readFileSync(path.join(ctx.dataDir, 'settings.json'), 'utf8')) || {}; } catch { return {}; } }

  function load(id) {
    const p = P().get(id);
    if (!p) throw Object.assign(new Error('no such project'), { status: 404 });
    const r = craft.recipe(p.recipe);
    if (!r) throw Object.assign(new Error(`the recipe "${p.recipe}" is missing`), { status: 400 });
    return { p, r, dir: P().dir(id) };
  }
  const L = createLive(ctx, { load, heavyRunning, queue, stopAfter });
  ctx.liveChanged = L.changed; // agent.js calls it when a question, a fire or the quiet guard changes
  ctx.spendChanged = () => checkSpend(); // agent.js calls it when a chat turn ended
  const save = (p) => { const s = P().save(p); L.changed(p.id); return s; };
  const chainOn = () => readSettings().chain !== false;

  function exists(dir) {
    return (rel) => {
      const f = path.join(dir, ...rel.replace(/\/+$/, '').split('/'));
      try { const st = fs.statSync(f); return rel.endsWith('/') ? st.isDirectory() && fs.readdirSync(f).length > 0 : st.isFile() || st.isDirectory(); } catch { return false; }
    };
  }
  function footage(dir) { return listFootage(dir).filter((f) => !f.missing).map((f) => f.name); } // linked footage too

  // the words for one stage
  function promptFor(p, r, st, dir) {
    const i = St.indexOf(r, st.id);
    const kinds = craft.kinds();
    const { skills, missing } = craft.skillsFor(r.id, st.id, p.skillSet);
    const note = p.stages?.[st.id]?.note || '';
    const prev = r.stages[i - 1];
    const prevNote = prev ? p.stages?.[prev.id]?.note || '' : '';
    const active = St.activeLocks(readLocks(dir), r, st.id);
    return stagePrompt({
      recipe: r, stage: st, index: i, kind: kinds[st.kind], projectDir: dir, root: ctx.root, skills, missing,
      houseRules: craft.houseRules().text, houseRulesFile: path.join(ctx.dataDir, 'craft', 'house-rules.md'), houseRulesShipped: path.join(ctx.root, 'craft', 'house-rules.md'), brief: readText(path.join(dir, 'brief.md')), topic: readText(path.join(dir, '.presence', 'topic.md')),
      sentBack: note.startsWith('Sent back: ') ? note.slice(11) : '', approved: prevNote.startsWith('Approved: ') ? prevNote.slice(10) : '',
      lock: lockSentence(active), footage: footage(dir), source: p.from ? { project: p.from.project, title: p.from.title, files: p.from.files } : null,
    });
  }

  // a lock check before or after a make/inspect stage. -> the halted project, or null when all is as approved
  async function lockCheck(id, when) {
    const { p, r, dir } = load(id);
    const st = St.current(p, r);
    const locks = readLocks(dir), active = St.activeLocks(locks, r, p.at);
    if (!st || !needsCheck(st.kind, active)) return null;
    const changed = await checkLocks(dir, active);
    if (!changed.length) return null;
    const gate = gateOf(changed, locks, r);
    const why = lockMessage(changed, { stageName: st.title || st.id, gateName: St.stageOf(r, gate)?.title || gate || 'the gate', when });
    const q = load(id).p;
    const h = save(St.halt(q, r, why, { lockBroken: { files: changed, gate, when } }));
    P().log(id, { stage: st.id, kind: st.kind, status: 'halted', why });
    toast(why, 'error', id);
    return h;
  }

  // the user's house rules as a stage began: what the agent adds during the stage is told to the user when it ends
  const rulesAtStart = new Map();
  const rulesFile = () => path.join(ctx.dataDir, 'craft', 'house-rules.md');
  // the user's own house rules file, made from the shipped starter once (the context room's helper), so the agent's
  // first lesson goes there and never into craft/
  let rulesHelper;
  async function ensureHouseRules() {
    try {
      if (rulesHelper === undefined) rulesHelper = (await import('./context/stage-context.js')).houseRulesFile || null;
      rulesHelper?.({ root: ctx.root, dataDir: ctx.dataDir });
    } catch (e) { rulesHelper = null; ctx.log?.('house rules file:', e.message); }
  }

  // ---------------------------------------------------------------- the heavy line
  // every project still in line hears what it waits behind now
  function requeue() {
    for (const qid of queue) {
      try {
        const { p, r } = load(qid);
        const behind = L.behind(qid);
        save(St.queue(p, r, behind));
        ctx.broadcast({ type: 'queue', project: qid, stage: p.at, behind, position: queue.indexOf(qid) + 1, text: St.queueNote(behind) });
      } catch {}
    }
  }
  function leaveQueue(id) {
    const q = queue.indexOf(id);
    if (q < 0) return false;
    queue.splice(q, 1);
    try { const { p, r } = load(id); save(St.unqueue(p, r)); } catch {}
    ctx.broadcast({ type: 'queue', project: id, left: true });
    requeue();
    return true;
  }

  // ---------------------------------------------------------------- Go
  async function go(id, { chained = false } = {}) {
    const { p, r, dir } = load(id);
    const g = St.canGo(p, r);
    if (g.error) return { error: g.error };
    if (ctx.agent?.isBusy(id)) return { error: 'the agent is busy: wait for its turn to end, or press Stop' };
    stopAfter.delete(id);
    A();
    const st = g.stage;
    if (st.heavy && !heavyRunning.has(id) && heavyRunning.size >= limit()) {
      if (!queue.includes(id)) queue.push(id);
      const behind = L.behind(id), position = queue.indexOf(id) + 1, text = St.queueNote(behind);
      const qd = St.queue(p, r, behind); qd.stages[st.id].pid = process.pid;
      save(qd);
      P().log(id, { stage: st.id, kind: st.kind, status: 'queued', behind: behind.map((b) => b.project) });
      ctx.broadcast({ type: 'queue', project: id, stage: st.id, behind, position, text });
      toast(`${st.title || st.id}: ${text}`, 'info', id);
      return { queued: true, stage: st.id, behind, position, text };
    }
    if (await lockCheck(id, 'before')) return { halted: true };
    await ensureHouseRules();
    rulesAtStart.set(id, readText(rulesFile()));
    const fresh = load(id);
    const prompt = promptFor(fresh.p, r, st, dir);
    const b = St.begin(fresh.p, r);
    if (b.error) return { error: b.error };
    if (st.heavy) heavyRunning.add(id);
    const wasQueued = queue.indexOf(id) >= 0;
    if (wasQueued) queue.splice(queue.indexOf(id), 1);
    b.project.stages[st.id].pid = process.pid; // whose turn it is: another server's boot leaves it alone
    save(b.project);
    if (wasQueued) { ctx.broadcast({ type: 'queue', project: id, started: true, stage: st.id }); requeue(); }
    const started = Date.now();
    P().log(id, { stage: st.id, kind: st.kind, status: 'started', start: new Date(started).toISOString(), chained: chained || undefined });
    runTurn(id, st, prompt, started).catch((e) => ctx.log('stage', id, st.id, e?.stack || e));
    return { ok: true, stage: st.id };
  }

  // one turn of a stage, then what it means for the project
  async function runTurn(id, st, prompt, started) {
    let res;
    try { res = await A().turn(id, prompt, { stage: st.id, title: st.title || st.id }); } catch (e) { res = { error: String(e?.message || e), text: '', cost: 0, ms: 0 }; }
    const freed = heavyRunning.delete(id);
    try { await afterTurn(id, st, res, started); }
    finally {
      // a heavy slot came free: the next in line starts
      if (freed || heavyRunning.size < limit()) {
        const next = queue[0];
        if (next) go(next, { chained: true }).then((g) => { if (g?.error) leaveQueue(next); }).catch(() => leaveQueue(next));
      }
    }
  }

  async function afterTurn(id, st, res, started) {
    const { r, dir } = load(id);
    if (rulesAtStart.has(id)) { const note = rulesNotice(addedRules(rulesAtStart.get(id), readText(rulesFile()))); rulesAtStart.delete(id); if (note) toast(note, 'info', id); }
    // the turn's cost and time count even when a lock halts it
    let halted = null;
    if (!res.error && !res.stopped) halted = await lockCheck(id, 'after');
    const { p } = load(id);
    if (halted) {
      const s = p.stages[st.id];
      s.ms = (s.ms || 0) + (res.ms || 0); s.cost = Math.round(((s.cost || 0) + (res.cost || 0)) * 1e6) / 1e6;
      save(p);
      P().log(id, { stage: st.id, kind: st.kind, start: new Date(started).toISOString(), ms: res.ms || 0, cost: res.cost || 0, status: 'halted' });
      return;
    }
    if (p.at !== st.id) return; // it moved on meanwhile (sent back, or halted by hand)
    const miss = missingOut(st.out, exists(dir));
    const ready = miss.length === 0;
    const asked = !ready && !res.error && !res.stopped && st.kind === 'ask';
    const t = St.turnEnded(p, r, { ms: res.ms, cost: res.cost, error: res.error, stopped: res.stopped, ready, asked,
      note: miss.length ? `The stage ended without ${miss.join(', ')}: answer the agent, or press Go to run it again.` : '' });
    // a stopped or failed stage whose files are there can go on with them (Keep): say so
    if (t.outcome === 'todo') {
      const o = outState(dir, st, t.project.backFrom?.target === st.id ? t.project.backFrom.at : 0);
      if (o.ready) t.project.stages[st.id].note += t.project.backFrom?.target === st.id && !o.changed.length
        ? ' Or go back to what you had before the send-back (nothing runs again).'
        : ' Or go on with the files it made (nothing runs again).';
    }
    const saved = save(t.project);
    P().log(id, { plan: ctx.agent?.status?.(id)?.plan || undefined, stage: st.id, kind: st.kind, start: new Date(started).toISOString(), ms: res.ms || 0, workMs: res.workMs, sleepMs: res.sleepMs || undefined, cost: res.cost || 0, status: t.outcome, error: res.error || undefined, stopped: res.stopped || undefined, missing: miss.length ? miss : undefined });
    ctx.broadcast({ type: 'files', project: id, paths: [...(st.out || []), ITEMS_FILE] });
    if (asked || t.outcome === 'waiting') {
      ctx.agent?.emit(id, 'question', { text: String(res.text || '').trim().slice(-4000), fromText: true });
      toast(`${st.title || st.id}: the agent is waiting for your answer`, 'info', id);
    } else if (t.outcome === 'todo') {
      const w = res.stopped ? `${st.title || st.id} stopped` : `${st.title || st.id} failed: ${String(res.error || '').slice(0, 200)}`;
      toast(w, res.stopped ? 'info' : 'error', id);
      notify(id, res.stopped ? 'stopped' : 'failed', st, w);
    } else if (t.outcome === 'done') {
      const next = St.current(saved, r);
      const held = stopAfter.delete(id);
      if (saved.done) { toast('Every stage is done', 'ok', id); notify(id, 'finished', st, 'Every stage is done'); }
      else if (next && St.isUser(next.kind)) { toast(`${next.title || next.id} is waiting for you`, 'ok', id); notify(id, 'yours', st, `${next.title || next.id} is waiting for you`); }
      else notify(id, 'ended', st, `${st.title || st.id} is done`);
      if (held && St.shouldChain(saved, r) && chainOn()) {
        const w = `Stopped after “${st.title || st.id}”, as you asked. Press Go for “${next?.title || next?.id}”.`;
        P().log(id, { stage: st.id, status: 'paused', why: 'stop after this stage' });
        toast(w, 'info', id);
      } else if (St.shouldChain(saved, r) && chainOn()) await go(id, { chained: true });
    }
    stopAfter.delete(id);
    L.changed(id);
    checkSpend();
  }

  // notifications, the spend limits, "stop after this stage", the queue overview and what Go will do (run-extra.js)
  const X = createExtras(ctx, { P, load, L, craft, queue, stopAfter, warned, limit, readSettings });
  const { notify, summary, checkSpend, setStopAfter, overview, goInfo } = X;

  // ---------------------------------------------------------------- you
  // Talk: an agent stage that asked you something goes on with your answer; otherwise a plain turn
  async function say(id, text, opts = {}) {
    if (!String(text || '').trim() && !opts.answers) return { error: 'say something' };
    const { p, r } = load(id);
    const st = St.current(p, r);
    const ag = A();
    if (st && St.isAgent(st.kind) && St.statusOf(p, st.id) === 'waiting' && !ag.isBusy(id) && !p.halted && !ag.status(id).question) {
      const s = St.resumeAsked(p, r);
      if (s.error) return s;
      s.project.stages[st.id].pid = process.pid;
      save(s.project);
      const started = Date.now();
      runTurn(id, st, answerPrompt(text), started).catch((e) => ctx.log('stage', id, st.id, e?.stack || e));
      return { ok: true, resumed: st.id };
    }
    // a turn said at a Studio stage reads the Studio's skills of the project's set
    const note = st && STUDIO_STAGES.includes(st.id) ? studioNote(craft.skillsFor(r.id, 'studio', p.skillSet).skills) : '';
    return { ok: true, ...(await ag.say(id, String(text || '') + note, opts)) };
  }

  async function approve(id, { notes = '' } = {}) {
    const { p, r, dir } = load(id);
    // a lock halt: approve the new version (hash the changed files again)
    if (p.halted && p.lockBroken) {
      const files = (p.lockBroken.files || []).map((c) => c.file);
      const locks = readLocks(dir);
      const got = {};
      for (const f of files) {
        const stage = locks[f]?.stage || p.lockBroken.gate;
        const res = await lockFiles(dir, [f], stage);
        if (res.missing) return { error: `Cannot lock ${res.missing.join(', ')}: it is not there. Send it back with notes instead.` };
        Object.assign(got, res.locks);
      }
      writeLocks(dir, { ...locks, ...got });
      const q = load(id).p;
      const u = St.unhalt(q, r, { done: q.lockBroken?.when === 'after' });
      const saved = save(u);
      P().log(id, { stage: q.at, status: 'relocked', files });
      const next = St.shouldChain(saved, r) && chainOn() ? await go(id, { chained: true }) : undefined;
      return { ok: true, relocked: files, next };
    }
    const st = St.current(p, r);
    if (st?.kind === 'record' && !footage(dir).length) return { error: 'Drop your footage in first (video/footage is empty).' };
    const a = St.approve(p, r, { notes });
    if (a.error) return { error: a.error };
    if (a.lock.length) {
      const c = readCuts(dir);
      const working = readJsonOr(workingFile(dir));
      const edl = readJsonOr(path.join(dir, 'video', 'out', 'edl.json'));
      const pending = pendingChoices(c?.review, working, edl);
      // the screen can offer the send-back at once: the choices go with its notes
      if (pending) return { error: pending.message, pending: { restored: pending.restored, strikes: pending.strikes, trims: pending.trims }, suggest: 'sendback' };
      const res = await lockFiles(dir, a.lock, st.id);
      if (res.missing) return { error: `Cannot lock: ${res.missing.join(', ')} ${res.missing.length > 1 ? 'are' : 'is'} not there. Send it back with notes, or run the stage that makes ${res.missing.length > 1 ? 'them' : 'it'}.` };
      const again = load(id).p;
      if (again.at !== st.id || St.statusOf(again, st.id) !== 'waiting') return { error: 'it moved on while the files were being locked' };
      writeLocks(dir, { ...readLocks(dir), ...res.locks });
    }
    const saved = save(a.project);
    P().log(id, { stage: st.id, kind: st.kind, status: 'approved', locked: a.lock.length ? a.lock : undefined, notes: notes || undefined });
    if (a.lock.length) toast(`Approved and locked: ${a.lock.join(', ')}`, 'ok', id);
    const next = St.shouldChain(saved, r) && chainOn() ? await go(id, { chained: true }) : undefined;
    return { ok: true, locked: a.lock, next };
  }

  async function sendback(id, { notes = '' } = {}) {
    const { p, r, dir } = load(id);
    if (ctx.agent?.isBusy(id)) return { error: 'the agent is busy: press Stop first' };
    // your Keep/Restore choices on the cuts go with the notes; the next rough has new cuts
    let full = String(notes || '').trim();
    const cuts = readCuts(dir);
    const hasReview = !!(cuts?.review && Object.keys(cuts.review).length);
    if (hasReview && !/\bc\d+\b/.test(full)) { // the screen usually puts them in itself
      const sum = reviewSummary(cuts.cuts, cuts.review);
      if (sum) full += (full ? '\n\n' : '') + sum;
    }
    const s = St.sendback(p, r, { notes: full });
    if (s.error) return { error: s.error };
    const before = readLocks(dir);
    const kept = St.dropLocks(before, r, St.indexOf(r, s.target.id));
    writeLocks(dir, kept);
    // a send-back to the rough puts your choices and the working list aside together: the next rough starts clean
    const maker = r.stages.findIndex((x) => (x.out || []).includes('video/out/cuts.json'));
    const names = sendbackArchive({ targetIndex: St.indexOf(r, s.target.id), makerIndex: maker, hasReview, hasWorking: fs.existsSync(workingFile(dir)) });
    const archived = [];
    const now = Date.now();
    for (const name of names) {
      const from = path.join(dir, 'video', 'out', name), as = archivedName(name, now);
      try { fs.renameSync(from, path.join(dir, 'video', 'out', as)); archived.push({ name, as }); } catch (e) { ctx.log?.('sendback archive', name, e.message); }
    }
    if (archived.length) ctx.broadcast({ type: 'cuts', project: id });
    if (archived.some((a) => a.name.startsWith('edl.working'))) ctx.broadcast({ type: 'files', project: id, paths: ['video/out/edl.working.json'], working: true });
    const dropped = Object.fromEntries(Object.entries(before).filter(([k]) => !(k in kept)));
    if (s.project.backFrom) s.project.backFrom = { ...s.project.backFrom, archived, locks: Object.keys(dropped).length ? dropped : undefined };
    const saved = save(s.project);
    P().log(id, { stage: s.from.id, status: 'sent back', to: s.target.id, notes: full, archived: archived.length ? archived : undefined });
    toast(`Sent back to ${s.target.title || s.target.id}`, 'info', id);
    const next = St.shouldChain(saved, r) && chainOn() ? await go(id, { chained: true }) : undefined;
    return { ok: true, to: s.target.id, archived: archived.map((a) => a.as), next };
  }

  // Go on with what exists: after Stop (or a failed turn) whose files are there, without running the stage again
  async function keep(id) {
    const { p: p0, r, dir } = load(id);
    const p = withBack(ctx, id, p0, r);
    if (ctx.agent?.isBusy(id)) return { error: 'the agent is busy: press Stop first' };
    const st = St.current(p, r);
    if (!st) return { error: 'no stage here' };
    const o = outState(dir, st, p.backFrom?.target === st.id ? p.backFrom.at : 0);
    const k = keepExisting(p, r, { ...o, busy: false });
    if (k.error) return k;
    leaveQueue(id);
    if (k.relock) writeLocks(dir, { ...readLocks(dir), ...k.relock });
    const back = [];
    for (const a of k.unarchive || []) {
      const out = path.join(dir, 'video', 'out');
      try { if (!fs.existsSync(path.join(out, a.name))) { fs.renameSync(path.join(out, a.as), path.join(out, a.name)); back.push(a.name); } } catch {}
    }
    if (back.length) { ctx.broadcast({ type: 'cuts', project: id }); ctx.broadcast({ type: 'files', project: id, paths: back.map((n) => `video/out/${n}`), working: true }); }
    const saved = save(k.project);
    P().log(id, { stage: st.id, kind: st.kind, status: 'kept', mode: k.mode, to: saved.at, restored: back.length ? back : undefined });
    toast(k.keep.text, 'ok', id);
    const next = St.shouldChain(saved, r) && chainOn() ? await go(id, { chained: true }) : undefined;
    return { ok: true, mode: k.mode, at: saved.at, next };
  }

  async function stop(id) {
    const out = ctx.agent ? await ctx.agent.stop(id) : { stopped: false };
    const unqueued = leaveQueue(id);
    // a stage marked running with no live turn (nothing to interrupt): hand it back now
    const { p, r } = load(id);
    const st = St.current(p, r);
    if (st && St.statusOf(p, st.id) === 'running' && !ctx.agent?.isBusy(id)) {
      setTimeout(() => {
        try {
          const { p: q2 } = load(id);
          if (q2.at === st.id && St.statusOf(q2, st.id) === 'running' && !ctx.agent?.isBusy(id)) save(St.turnEnded(q2, r, { stopped: true }).project);
        } catch {}
      }, 1500);
    }
    return { ok: true, ...out, unqueued: unqueued || undefined };
  }

  function resume(id) {
    const { p, r } = load(id);
    if (!p.halted) return { error: 'the project is not halted' };
    if (p.lockBroken) return { error: 'a locked file changed: approve the new version, or send it back with notes' };
    save(St.unhalt(p, r));
    return { ok: true };
  }

  // the server started: stages that were running (or waiting in line) are todo again
  function boot() {
    if (!ctx.projects) return;
    const alive = (pid) => { if (!pid || pid === process.pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
    for (const p of ctx.projects.list()) { const q = St.interrupted(p, { alive }); if (q) { P().save(q); ctx.log('stage interrupted by the restart:', p.id); } }
  }

  return { setStopAfter, overview, goInfo, summary, go, say, approve, sendback, keep, stop, resume, view: L.view, boot, queued: () => [...queue], running: () => [...heavyRunning],
    promptFor: (id) => { const { p, r, dir } = load(id); const st = St.current(p, r); return st ? promptFor(p, r, st, dir) : ''; } };
}
