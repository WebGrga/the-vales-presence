// The agent: one warm Claude Agent SDK session per project, on the user's own Claude login.
// cwd = the project folder; settingSources user + project; Claude Code's own system prompt plus craft/CLAUDE.md;
// the unattended permission mode ('auto'; settings may say 'acceptEdits'); the model and effort from data/settings.json.
// Everything it does goes out live as { type: 'agent', project, event, ... }; background renders as { type: 'fire' }.
// Cost per turn = the difference of the SDK's running total_cost_usd. The session id is kept in .presence/session.json,
// so a restart resumes the conversation.
import { snapshot, killTaskTree } from './task-kill.js';
import fs from 'node:fs';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import * as Fires from './fires.js';
import { writeJsonAtomic } from './projects.js';

import { MODELS, EFFORTS, MODES, ALLOW, cleanSettings, trimInput, resultText, answersFrom, inbox, createRecent } from './agent-util.js';
export { MODELS, EFFORTS, MODES, DEFAULTS, cleanSettings, trimInput, resultText, answersFrom } from './agent-util.js';

const IDLE_MS = 55 * 60e3;   // a warm session closes after this long without a turn (the prompt cache lives about an hour)
const TICK_MS = 10e3;        // a working or sleeping stage sends its progress (elapsed, the last log line) this often

export function createAgent(ctx) {
  const settingsFile = path.join(ctx.dataDir, 'settings.json');
  const open = {}; // project id -> session
  const log = (...a) => ctx.log?.(...a);

  function settings() { try { return cleanSettings(JSON.parse(fs.readFileSync(settingsFile, 'utf8'))); } catch { return cleanSettings(null); } }
  function setSettings(patch) {
    let cur = {};
    try { cur = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) || {}; } catch {}
    const next = { ...cur, ...cleanSettings({ ...settings(), ...(patch || {}) }) };
    writeJsonAtomic(settingsFile, next);
    return cleanSettings(next);
  }

  const sessionFile = (id) => path.join(ctx.projectDir(id), '.presence', 'session.json');
  const readSaved = (id) => { try { return JSON.parse(fs.readFileSync(sessionFile(id), 'utf8')); } catch { return null; } };
  const writeSaved = (id, v) => { try { if (v) writeJsonAtomic(sessionFile(id), v); else fs.rmSync(sessionFile(id), { force: true }); } catch (e) { log('session.json', e.message); } };

  const recent = createRecent();
  const remember = recent.remember;
  const out = (m) => { remember(m); ctx.broadcast(m); };
  const emit = (S, event, extra = {}) => out({ type: 'agent', project: S.id, event, stage: S.stage || undefined, ...extra });
  const emitId = (id, event, extra = {}) => out({ type: 'agent', project: id, event, stage: open[id]?.stage || undefined, ...extra });

  function systemAppend() {
    const md = ctx.craft?.claudeMd?.().text || '';
    return [
      'You work inside The Vale\'s Presence: a YouTube studio run by agents. The user watches your work live and decides in a video editor screen.',
      'Each message from the studio is one stage of a recipe (plan, rough cut, visuals, Shorts, titles, thumbnails and so on); it says what the stage is, which files it must leave, the skills to read and the house rules.',
      md.trim(),
    ].filter(Boolean).join('\n\n');
  }

  function start(id, { fresh = false } = {}) {
    if (open[id] && !open[id].closing) return open[id];
    const dir = ctx.projectDir(id);
    if (!fs.existsSync(dir)) throw Object.assign(new Error('no such project'), { status: 404 });
    const cfg = settings();
    const saved = fresh ? null : readSaved(id);
    const input = inbox();
    const S = { id, dir, input, bg: {}, bgOut: {}, busy: false, turn: null, base: 0, F: Fires.newFires(), W: Fires.newWait(), stage: null, pending: null, question: null,
      activity: Date.now(), quiet: Fires.newQuiet(), stalled: null, progress: null,
      used: Date.now(), model: cfg.model, effort: cfg.effort, mode: cfg.permissionMode, resumed: saved?.id || null, inited: false, last: null, closing: false };
    const env = { ...process.env, PRESENCE_ENGINE: path.join(ctx.root, 'engine'), PRESENCE_PROJECT: id, PRESENCE_VIDEO: path.join(dir, 'video'), PRESENCE_LOCKS: path.join(dir, '.presence', 'locks.json'), PRESENCE_ROOT: ctx.root };
    S.q = query({
      prompt: input,
      options: {
        cwd: dir,
        resume: saved?.id || undefined,
        systemPrompt: { type: 'preset', preset: 'claude_code', append: systemAppend() },
        settingSources: ['user', 'project'],
        permissionMode: S.mode,
        allowedTools: S.mode === 'auto' ? undefined : ALLOW,
        model: S.model,
        effort: S.effort || undefined,
        includePartialMessages: true,
        additionalDirectories: [ctx.root],
        canUseTool: (tool, toolInput, opts) => permission(S, tool, toolInput, opts),
        env,
        stderr: (d) => { if (/error/i.test(d)) log('agent stderr', id, String(d).slice(0, 300)); },
      },
    });
    open[id] = S;
    consume(S).catch(() => {});
    log('agent session', id, saved?.id ? 'resumed ' + saved.id : 'fresh');
    return S;
  }

  // The agent may ask you (AskUserQuestion): the question goes to the screen, your answer back to the tool.
  // Anything else that needs a permission in an unattended stage is refused with a reason (auto mode asks only for risky things).
  async function permission(S, tool, input, { signal } = {}) {
    if (tool === 'AskUserQuestion') {
      const questions = Array.isArray(input?.questions) ? input.questions : [];
      emit(S, 'question', { questions, text: questions.map((q) => q.question).join('\n') });
      const answers = await new Promise((res) => {
        S.question = { questions, resolve: res, at: Date.now() };
        ctx.liveChanged?.(S.id);
        signal?.addEventListener?.('abort', () => res(null), { once: true });
      });
      if (S.pending && S.question) S.pending.waited += Date.now() - S.question.at; // time waiting for you is not the stage's time
      S.question = null; S.activity = Date.now();
      ctx.liveChanged?.(S.id);
      if (!answers) return { behavior: 'deny', message: 'The user did not answer. Go on with your best judgment, or end your turn with the question.' };
      return { behavior: 'allow', updatedInput: { ...input, answers } };
    }
    if (S.mode !== 'auto') return { behavior: 'allow', updatedInput: input };
    emit(S, 'tool', { tool, input: trimInput(input), refused: true });
    return { behavior: 'deny', message: `${tool} needs the user's permission here, and this stage runs unattended. Do it another way, or end your turn and say what you need the user to do.` };
  }

  async function consume(S) {
    let err = null;
    try { for await (const msg of S.q) handle(S, msg); } catch (e) { err = e; }
    clearTimeout(S.idle); clearTimeout(S.wakeTimer); clearTimeout(S.holdTimer);
    if (open[S.id] === S) delete open[S.id];
    const m = err ? String(err?.message || err) : '';
    // a saved session that cannot be resumed: start fresh once, with the message that was waiting
    if (err && S.resumed && !S.inited && !S.closing) {
      log('agent resume failed', S.id, m.slice(0, 200));
      writeSaved(S.id, null);
      const pending = S.pending, stage = S.stage, last = S.last;
      const T = start(S.id, { fresh: true });
      T.pending = pending; T.stage = stage;
      if (last) { T.busy = true; T.turn = newTurn(); T.input.push(last); }
      return;
    }
    if (err) { emit(S, 'error', { text: m.slice(0, 1000) }); log('agent session error', S.id, m.slice(0, 300)); }
    if (S.question) S.question.resolve(null);
    const lost = Fires.closed(S.W, S.turn?.text || '');
    if (S.pending) finishStage(S, { text: lost?.text || S.turn?.text || '', cost: lost?.cost || 0, ms: lost?.ms || 0, error: S.stopping ? undefined : (m || 'the session closed mid-stage'), stopped: !!S.stopping });
    if (S.busy && !S.pending) emit(S, 'done', { error: 'closed', text: S.turn?.text || '' });
    log('agent session closed', S.id);
  }

  const newTurn = () => ({ start: Date.now(), text: '', steps: 0, tools: 0 });

  function handle(S, msg) {
    const f = Fires.onMessage(S.F, msg);
    if (f.handled) { for (const e of f.events) fireEvent(S, e); if (f.events.length) { firesChanged(S); ctx.liveChanged?.(S.id); } return; }
    if (msg.type !== 'system') S.activity = Date.now(); // the quiet guard: the agent is doing something
    // a turn nobody sent: the SDK starts one itself when a background task ends
    if (!S.busy && !msg.parent_tool_use_id && (msg.type === 'stream_event' || msg.type === 'assistant')) {
      clearTimeout(S.wakeTimer); Fires.turnStarted(S.W); clearTimeout(S.idle);
      S.busy = true; S.turn = newTurn(); S.used = Date.now();
      emit(S, 'text', { text: '', start: true, unprompted: true });
    }
    if (msg.type === 'system' && msg.subtype === 'init') {
      S.inited = true; S.plan = msg.apiKeySource === 'none';
      writeSaved(S.id, { id: msg.session_id, at: new Date().toISOString(), model: msg.model });
      return;
    }
    if (msg.type === 'system' && msg.subtype === 'compact_boundary') { emit(S, 'text', { text: '\n[The conversation was compacted to make room.]\n', note: true }); return; }
    if (msg.type === 'stream_event' && !msg.parent_tool_use_id) {
      const e = msg.event;
      if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') { if (S.turn) S.turn.text += e.delta.text; emit(S, 'text', { text: e.delta.text }); }
      return;
    }
    if (msg.type === 'assistant') {
      const by = msg.parent_tool_use_id ? 'subagent' : undefined;
      for (const c of msg.message?.content || []) {
        if (c.type !== 'tool_use') continue;
        if (S.turn) S.turn.tools++;
        emit(S, 'tool', { id: c.id, tool: c.name, input: trimInput(c.input), by });
        if (c.name === 'Bash' && c.input?.run_in_background && c.input.command) S.bg[c.id] = String(c.input.command); // kept to find the task's shell when it must end
      }
      return;
    }
    if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
      for (const b of msg.message.content) {
        if (b.type !== 'tool_result') continue;
        const text = resultText(b);
        const got = Fires.onResult(S.F, b.tool_use_id, text);
        if (got && S.bg[b.tool_use_id]) S.bgOut[got.out] = S.bg[b.tool_use_id];
        if (got) ctx.broadcast({ type: 'fire', project: S.id, id: got.id, state: 'burning', cmd: got.cmd, out: got.out });
        emit(S, 'tool_result', { id: b.tool_use_id, text, isError: !!b.is_error, by: msg.parent_tool_use_id ? 'subagent' : undefined });
      }
      return;
    }
    if (msg.type === 'result') return result(S, msg);
  }

  function result(S, msg) {
    const total = msg.total_cost_usd || 0;
    const cost = Math.round(Math.max(0, total - S.base) * 1e6) / 1e6;
    S.base = total;
    const ms = S.turn ? Date.now() - S.turn.start : msg.duration_ms || 0;
    const text = S.turn?.text || (typeof msg.result === 'string' ? msg.result : '');
    const error = msg.is_error && !S.stopping ? (msg.subtype === 'success' ? 'error' : msg.subtype) : undefined;
    S.busy = false; S.turn = null; S.used = Date.now(); S.last = null;
    const saved = readSaved(S.id); if (saved) writeSaved(S.id, { ...saved, at: new Date().toISOString() });
    if (S.pending) {
      const w = Fires.turnEnded(S.W, { stage: true, fires: Fires.holdable(Fires.list(S.F)), text, cost, ms, error, now: Date.now() });
      if (w.do === 'hold') {
        emit(S, 'done', { cost, ms, text, asleep: true, note: w.note, plan: S.plan });
        ctx.liveChanged?.(S.id);
        holdTimer(S);
      } else {
        emit(S, 'done', { cost, ms, text, total: w.cost, plan: S.plan, error });
        finishStage(S, { text: w.text, cost: w.cost, ms: w.ms, error, stopped: !!S.stopping });
      }
    } else {
      emit(S, 'done', { cost, ms, text, plan: S.plan, error });
      chatEnded(S, { cost, ms, error });
    }
    S.stopping = false;
    arm(S);
  }

  // r.ms is the agent's working time; the stage's ms is the wall time of the turn(s), renders included, your answers not
  function finishStage(S, r) {
    const p = S.pending; S.pending = null; S.stage = null; S.stageTitle = null;
    if (S.stalled) { S.stalled = null; }
    setTimeout(() => ctx.liveChanged?.(S.id), 0);
    if (p) { const wall = Math.max(r.ms || 0, Date.now() - p.t0 - (p.waited || 0)); r = { ...r, workMs: r.ms || 0, sleepMs: Math.max(0, wall - (r.ms || 0)), ms: wall }; }
    clearTimeout(S.holdTimer); clearTimeout(S.wakeTimer);
    p?.resolve(r);
  }
  // a turn outside a stage (you talking to the agent): its time and cost still count, in the log and the project's chat total
  function chatEnded(S, { cost, ms, error }) {
    try {
      ctx.projects?.log(S.id, { stage: 'chat', kind: 'chat', ms, cost, error, plan: S.plan || undefined });
      ctx.projects?.update(S.id, (p) => { const c = p.chat || { ms: 0, cost: 0, turns: 0 }; p.chat = { ms: c.ms + ms, cost: Math.round((c.cost + cost) * 1e6) / 1e6, turns: c.turns + 1 }; return p; });
      ctx.spendChanged?.(); // the day's and month's limits (run.js)
    } catch (e) { log('chat total', e.message); }
  }

  // ---------------------------------------------------------------- fires and the sleeping stage
  function fireEvent(S, e) {
    const f = S.F.fires[e.id];
    const msg = { type: 'fire', project: S.id, id: e.id, state: e.state, cmd: e.cmd, out: e.out || undefined, start: f?.start, elapsedMs: f?.start ? Date.now() - f.start : undefined };
    if (e.state === 'done') { msg.log = tailOf(e.out); msg.last = Fires.lastLine(msg.log); }
    ctx.broadcast(msg);
  }
  function tailOf(file, n = 3000) {
    if (!file) return '';
    try {
      const size = fs.statSync(file).size, fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(Math.min(n, size));
      fs.readSync(fd, buf, 0, buf.length, Math.max(0, size - buf.length)); fs.closeSync(fd);
      return buf.toString('utf8').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
    } catch { return ''; }
  }
  const holdableN = (S) => Fires.holdable(Fires.list(S.F)).length;
  function firesChanged(S) {
    const a = Fires.firesChanged(S.W, holdableN(S));
    if (a?.do === 'disarm') clearTimeout(S.wakeTimer);
    if (a?.do === 'arm') { clearTimeout(S.wakeTimer); S.wakeTimer = setTimeout(() => wake(S), a.ms); }
  }
  function wake(S) {
    if (open[S.id] !== S || S.closing) return;
    const tail = S.W.tasks.map((t) => tailOf(t.out, 2000)).filter(Boolean).join('\n');
    const a = Fires.wakeDue(S.W, { busy: S.busy, n: holdableN(S), tail });
    if (!a) return;
    log('agent woken after its background task', S.id);
    push(S, a.text);
  }
  function holdTimer(S) {
    clearTimeout(S.holdTimer);
    S.holdTimer = setTimeout(() => {
      const a = Fires.expired(S.W);
      if (a) finishStage(S, { text: a.text, cost: a.cost, ms: a.ms, error: a.error });
    }, Math.max(1000, Fires.HOLD_MAX_MS - (Date.now() - S.W.since)));
  }

  // a warm session closes after an idle hour, never while a fire burns or a stage sleeps
  function arm(S) {
    clearTimeout(S.idle);
    S.idle = setTimeout(() => (S.busy || Fires.burning(S.F) || S.W.waiting || S.pending ? arm(S) : shut(S)), IDLE_MS);
  }
  function shut(S) { if (S.closing) return; S.closing = true; clearTimeout(S.idle); S.input.end(); }

  function push(S, text, priority) {
    const m = { type: 'user', message: { role: 'user', content: String(text) }, parent_tool_use_id: null, ...(priority ? { priority } : {}) };
    if (!S.busy) { S.busy = true; S.turn = newTurn(); S.used = Date.now(); clearTimeout(S.idle); Fires.turnStarted(S.W); clearTimeout(S.wakeTimer); S.last = m; S.activity = Date.now(); }
    S.input.push(m);
  }

  async function applySettings(S) {
    const cfg = settings();
    if (cfg.model !== S.model) { S.model = cfg.model; await S.q.setModel(cfg.model).catch((e) => log('setModel', e.message)); }
    if (cfg.effort !== S.effort) { S.effort = cfg.effort; await S.q.applyFlagSettings({ effortLevel: cfg.effort || null }).catch((e) => log('effort', e.message)); }
  }

  // ---------------------------------------------------------------- progress and the quiet guard
  // Every TICK_MS a working or sleeping session sends { type: 'progress' } (elapsed, asleep, each background task's
  // elapsed time and last log line) and its fires again with the same; a stage with no output for settings.quietMinutes
  // is reported once (a toast, an agent 'stalled' event, the live view), and keeps running.
  function tick(S) {
    const now = Date.now();
    const info = Fires.list(S.F).map((f) => {
      let size = 0; try { if (f.out) size = fs.statSync(f.out).size; } catch {}
      return { id: f.id, cmd: f.cmd, kind: f.kind, start: f.start, elapsedMs: now - f.start, out: f.out, size, last: f.out ? Fires.lastLine(tailOf(f.out, 1500)) : '' };
    });
    const sizes = Object.fromEntries(info.map((f) => [f.id, f.size]));
    const limitMs = (settings().quietMinutes || 0) * 60e3;
    const q = Fires.quietStep(S.quiet, { now, sizes, activity: S.question ? now : S.activity, limitMs });
    S.progress = { at: now, fires: info, quietMs: q.quietMs };
    for (const f of info) ctx.broadcast({ type: 'fire', project: S.id, id: f.id, state: 'burning', cmd: f.cmd, out: f.out || undefined, start: f.start, elapsedMs: f.elapsedMs, last: f.last, quietMs: q.quietMs, tick: true });
    const since = S.pending?.t0 || S.turn?.start || null;
    ctx.broadcast({ type: 'progress', project: S.id, stage: S.stage || undefined, since, elapsedMs: since ? now - since : 0, asleep: !!S.W.waiting, quietMs: q.quietMs, fires: info, stalled: S.stalled });
    if (q.report) {
      const what = info.map((f) => f.cmd).filter(Boolean).join('; ') || (S.busy ? "the agent's turn" : '');
      const last = info.map((f) => f.last).filter(Boolean).pop() || '';
      S.stalled = { since: q.report.since, quietMs: q.report.quietMs, what, last, stage: S.stage || null };
      const text = Fires.quietText({ stage: S.stageTitle || S.stage, quietMs: q.report.quietMs, what, last });
      emit(S, 'stalled', { text, ...S.stalled });
      ctx.broadcast({ type: 'toast', project: S.id, text, kind: 'error' });
      try { ctx.projects?.log(S.id, { stage: S.stage || 'chat', status: 'quiet', quietMs: q.report.quietMs, what, last }); } catch {}
      ctx.liveChanged?.(S.id);
    } else if (q.cleared) {
      S.stalled = null;
      emit(S, 'stalled', { cleared: true });
      ctx.liveChanged?.(S.id);
    }
  }
  const ticker = setInterval(() => {
    for (const S of Object.values(open)) {
      if (S.closing || !(S.busy || S.pending || Fires.burning(S.F))) continue;
      try { tick(S); } catch (e) { log('progress tick', S.id, e.message); }
    }
  }, TICK_MS);
  ticker.unref?.();

  // ---------------------------------------------------------------- what the runner and routes call
  // A stage turn: resolves when the stage's work is over (after any background render and the turn that follows it).
  // -> { text, cost, ms, error?, stopped? }
  async function turn(id, text, { stage, title } = {}) {
    const S = start(id);
    if (S.busy || S.pending) return { error: 'the agent is busy', busy: true };
    await applySettings(S);
    return new Promise((resolve) => {
      S.stage = stage || 'stage'; S.stageTitle = title || null; S.pending = { resolve, t0: Date.now(), waited: 0 };
      S.quiet = Fires.newQuiet(); S.stalled = null;
      push(S, text);
      emit(S, 'text', { text: '', start: true });
    });
  }
  // You talk to the agent. -> { answered } (a question was waiting) | { queued } (it is working: your words reach it between steps) | { started }
  async function say(id, text, { answers } = {}) {
    const S = start(id);
    if (S.question) { S.question.resolve(answers || answersFrom(S.question.questions, text)); return { answered: true }; }
    if (S.busy) { push(S, text, 'next'); return { queued: true }; }
    await applySettings(S);
    push(S, text);
    emit(S, 'text', { text: '', start: true });
    return { started: true };
  }
  function answer(id, answers) {
    const S = open[id];
    if (!S?.question) return { error: 'no question is waiting' };
    S.question.resolve(answers && typeof answers === 'object' ? answers : {});
    return { answered: true };
  }
  // End background tasks for good. The SDK's stopTask ends the shell but, on Windows, not what the shell started (a sleep,
  // a render): so the shells are found by their command first and their whole process tree is killed (task-kill.js).
  async function endFires(S, ids) {
    if (!ids.length) return;
    let rows = null;
    try { rows = await snapshot(); } catch {}
    for (const fid of ids) {
      const f = S.F.fires[fid];
      const command = (f && (S.bg[f.tool] || S.bgOut[f.out])) || '';
      if (command && rows) { try { await killTaskTree(command, { rows, since: f.start }); } catch (e) { log('kill tree', e.message); } }
      await S.q.stopTask(fid).catch(() => {});
    }
  }
  // Stop one background task (the activity strip's Stop for a task that runs on its own)
  async function stopFire(id, fid) {
    const S = open[id];
    if (!S || !S.F.fires[fid]) return { stopped: false };
    await endFires(S, [fid]);
    return { stopped: true };
  }
  // Stop: the turn is interrupted, its background tasks put out, a sleeping stage handed back as stopped
  async function stop(id) {
    const S = open[id];
    if (!S) return { stopped: false };
    S.stopping = true;
    if (S.question) S.question.resolve(null);
    await endFires(S, Object.keys(S.F.fires));
    if (S.busy) await S.q.interrupt().catch((e) => log('interrupt', e.message));
    if (!S.busy && S.pending) { const a = Fires.closed(S.W); finishStage(S, { text: a?.text || '', cost: a?.cost || 0, ms: a?.ms || 0, stopped: true }); S.stopping = false; }
    // an interrupt that never yields a result: hand the stage back anyway
    setTimeout(() => { if (S.pending && S.stopping) { S.busy = false; S.turn = null; finishStage(S, { text: '', cost: 0, ms: 0, stopped: true }); S.stopping = false; } }, 5000).unref?.();
    return { stopped: true };
  }
  function status(id) {
    const S = open[id];
    const saved = (() => { try { return readSaved(id); } catch { return null; } })();
    const events = recent.of(id);
    if (!S) return { open: false, busy: false, session: saved?.id || null, fires: [], question: null, events };
    return { open: true, busy: S.busy, stage: S.stage, asleep: S.W.waiting, asleepSince: S.W.waiting ? S.W.since || null : null, stalled: S.stalled, progress: S.progress, session: saved?.id || null, model: S.model, effort: S.effort, mode: S.mode, plan: !!S.plan,
      fires: Fires.list(S.F), question: S.question ? { questions: S.question.questions, at: S.question.at } : null, turn: S.turn ? { start: S.turn.start, tools: S.turn.tools } : null, events };
  }
  // forget the conversation: the next turn starts a fresh session
  // an idle session lets go of its project folder (the Bin moves it); the saved session id stays, so it resumes later
  function release(id) { const S = open[id]; if (!S || S.busy || S.pending) return false; shut(S); return true; }
  function forget(id) { const S = open[id]; if (S) shut(S); writeSaved(id, null); return { ok: true }; }
  // what the stage view needs, cheap enough for every project in the list
  function live(id) {
    const S = open[id];
    if (!S) return {};
    const by = Object.fromEntries((S.progress?.fires || []).map((f) => [f.id, f]));
    const now = Date.now();
    return {
      question: S.question ? { questions: S.question.questions, at: S.question.at } : null,
      asleep: S.W.waiting ? { since: S.W.since || null, what: (S.W.tasks || []).map((t) => t.cmd).filter(Boolean).join('; ') } : null,
      fires: Fires.list(S.F).map((f) => ({ id: f.id, cmd: f.cmd, start: f.start, elapsedMs: now - f.start, last: by[f.id]?.last || '' })),
      stalled: S.stalled || null,
    };
  }
  async function closeAll() { clearInterval(ticker); for (const S of Object.values(open)) { try { await endFires(S, Object.keys(S.F.fires)); } catch {} shut(S); } }
  const isBusy = (id) => !!(open[id]?.busy || open[id]?.pending);

  return { turn, say, answer, stop, stopFire, status, live, forget, release, closeAll, isBusy, settings, setSettings, emit: emitId, models: () => MODELS, efforts: () => EFFORTS, modes: () => MODES };
}
