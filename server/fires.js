// Fires: agents sleep while rendering. A stage that starts a long background task (a render) ends its turn, but the
// stage stays running; when the task ends, the stage's next turn is its result. This file is pure: the fire list kept
// from the SDK's task messages, and the wait machine. agent.js owns the timers, the SDK and the broadcasts.
//
// What the SDK does (streaming input): when a background task ends it emits task_updated / task_notification /
// background_tasks_changed, then usually starts a NEW turn on its own. So the wake message we send is only the fallback
// when no turn starts within WAKE_MS.

export const WAKE_MS = 5000;             // after the last fire ended, wait this long for the SDK's own turn, then wake it
export const HOLD_MAX_MS = 3 * 3600e3;   // a held stage whose fire never ends is handed back as an error after this long

// Servers and watchers are meant to keep burning: they never hold a stage.
const LONG_RUNNING = /\b(serve|server|serving|watch|watcher|dev server|http\.server|live-server|vite|npm (run )?(dev|start)|tail -f)\b/i;
export const holdable = (fires) => (fires || []).filter((f) => !LONG_RUNNING.test(`${f.cmd || ''} ${f.kind || ''}`));

// ------------------------------------------------------------------ the fire list
// F = { fires: { id: { id, kind, cmd, start, out, tool } }, taskTool: { toolUseId: taskId }, outOf: { toolUseId: file } }
export const newFires = () => ({ fires: {}, taskTool: {}, outOf: {} });
export const list = (F) => Object.values(F.fires).map(({ id, kind, cmd, start, out }) => ({ id, kind, cmd, start, out: out || null }));
export const burning = (F) => Object.keys(F.fires).length;

// One SDK message. -> { handled, events: [{ id, state: 'burning'|'done', cmd, out }] }
export function onMessage(F, msg, now = Date.now()) {
  const ev = [];
  if (msg?.type !== 'system') return { handled: false, events: ev };
  const add = (id, kind, cmd, tool) => {
    if (!id || F.fires[id]) return;
    F.fires[id] = { id, kind: kind || 'shell', cmd: String(cmd || 'background work').slice(0, 300), start: now, tool: tool || null, out: (tool && F.outOf[tool]) || null };
    ev.push({ id, state: 'burning', cmd: F.fires[id].cmd, out: F.fires[id].out });
  };
  const drop = (id) => { const f = F.fires[id]; if (!f) return; delete F.fires[id]; ev.push({ id, state: 'done', cmd: f.cmd, out: f.out }); };
  const st = msg.subtype;
  if (st === 'task_started') {
    if (msg.tool_use_id) F.taskTool[msg.tool_use_id] = msg.task_id;
    if (msg.is_backgrounded && !msg.ambient) add(msg.task_id, msg.task_type, msg.description, msg.tool_use_id);
  } else if (st === 'task_updated') {
    if (msg.patch?.is_backgrounded) add(msg.task_id, '', msg.patch.description || 'background work', null);
    if (msg.patch?.status && !['running', 'pending', 'paused'].includes(msg.patch.status)) drop(msg.task_id);
  } else if (st === 'task_notification') {
    drop(msg.task_id);
  } else if (st === 'background_tasks_changed') {
    const live = new Set();
    for (const t of msg.tasks || []) { if (t.ambient) continue; live.add(t.task_id); add(t.task_id, t.task_type, t.description, null); }
    for (const id of Object.keys(F.fires)) if (!live.has(id)) drop(id);
  } else return { handled: false, events: ev };
  return { handled: true, events: ev };
}

// A tool result that put a command in the background names its output file. -> the fire that got its file, or null
export function onResult(F, toolUseId, text) {
  const out = outputPathOf(text);
  if (!out) return null;
  F.outOf[toolUseId] = out;
  const id = F.taskTool[toolUseId];
  const fire = (id && F.fires[id]) || Object.values(F.fires).find((x) => x.tool === toolUseId) || Object.values(F.fires).find((x) => text.includes(x.id));
  if (fire && !fire.out) { fire.out = out; return fire; }
  return null;
}

// pure: the output file a background command's result names (an absolute path ending .output, .log or .txt)
export function outputPathOf(text) {
  const m = String(text || '').match(/(?:[A-Za-z]:[\\/]|\/)[^\s"'<>|*?]+?\.(?:output|log|txt)\b/);
  return m ? m[0] : null;
}

// ------------------------------------------------------------------ the wait machine (one per session)
export const newWait = () => ({ waiting: false, held: '', cost: 0, ms: 0, tasks: [], since: 0, armed: false, woken: false });
const reset = (W) => Object.assign(W, newWait());
const join = (...parts) => parts.filter((p) => p && String(p).trim()).join('\n\n');
const whatOf = (tasks) => tasks.map((t) => t.cmd).filter(Boolean).join('; ').slice(0, 300) || 'a background task';

// A turn's result arrived. t: { stage (a stage turn), fires (holdable ones burning), text, cost, ms, error, now }
// -> { do: 'hold', note } (the stage sleeps) or { do: 'deliver', text, cost, ms } (the stage's result: this turn plus the held ones)
export function turnEnded(W, t) {
  if (t.stage && t.fires?.length && !t.error) {
    W.waiting = true; W.armed = false; W.woken = false; W.since ||= t.now || Date.now();
    W.held = join(W.held, t.text); W.cost += t.cost || 0; W.ms += t.ms || 0;
    W.tasks = t.fires.map((f) => ({ cmd: f.cmd, out: f.out || null }));
    return { do: 'hold', note: `Asleep while the background task runs: ${whatOf(W.tasks)}. The stage goes on when it finishes.` };
  }
  const out = { do: 'deliver', text: W.held ? join(W.held, t.text) : t.text, cost: (t.cost || 0) + W.cost, ms: (t.ms || 0) + W.ms };
  reset(W);
  return out;
}

// The holdable fires changed (n burning now). -> { do: 'arm', ms } when the last one ended while a stage sleeps; { do: 'disarm' } when one started again
export function firesChanged(W, n) {
  if (!W.waiting) return null;
  if (n > 0) { const was = W.armed; W.armed = false; return was ? { do: 'disarm' } : null; }
  if (W.armed) return null;
  W.armed = true; return { do: 'arm', ms: WAKE_MS };
}

// A turn started (the SDK's own, or one we sent): no wake is needed
export function turnStarted(W) { const was = W.armed; W.armed = false; return was ? { do: 'disarm' } : null; }

// The wake timer ran out. busy: a turn is running. n: holdable fires burning now. -> { do: 'wake', text } once, else null
export function wakeDue(W, { busy, n, tail = '' }) {
  if (!W.waiting || !W.armed || busy || n > 0) return null;
  W.armed = false; W.woken = true;
  const outs = W.tasks.filter((x) => x.out).map((x) => x.out);
  const t = String(tail || '').trim().slice(-2000);
  return { do: 'wake', text: `Your background task finished (${whatOf(W.tasks)}).${outs.length ? ` Its output: ${outs.join(', ')}.` : ''}${t ? `\nThe end of its log:\n${t}` : ''}\nContinue the stage: check the result and finish the stage in this reply. If the task failed, say so and fix it or report it.` };
}

// The hold timer ran out. -> { do: 'deliver', error } with everything held, or null
export function expired(W, now = Date.now(), max = HOLD_MAX_MS) {
  if (!W.waiting || now - W.since < max) return null;
  const out = { do: 'deliver', text: W.held, cost: W.cost, ms: W.ms, error: 'a background task ran for too long' };
  reset(W); return out;
}

// The session closed or died while a stage slept. -> { do: 'fail', text, cost, ms } once, else null
export function closed(W, turnText = '') {
  if (!W.waiting) return null;
  const out = { do: 'fail', text: join(W.held, turnText), cost: W.cost, ms: W.ms };
  reset(W); return out;
}

// ------------------------------------------------------------------ the quiet guard
// A stage that shows nothing for a long time (no message from the agent, no line in any background task's log) is
// reported to you once, instead of grinding on silently; it is not stopped. Output again clears the report.
// g = { lastOut, sizes: { fireId: bytes }, reported }. s = { now, sizes, activity (the last SDK message, ms), limitMs }
// -> { report: { quietMs, since } | null, cleared: boolean, quietMs }
export const newQuiet = (now = Date.now()) => ({ lastOut: now, sizes: {}, reported: false });
export function quietStep(g, s) {
  const now = s.now ?? Date.now();
  for (const [id, size] of Object.entries(s.sizes || {})) {
    if (size !== g.sizes[id]) { if (g.sizes[id] !== undefined || size > 0) g.lastOut = Math.max(g.lastOut, now); g.sizes[id] = size; }
  }
  for (const id of Object.keys(g.sizes)) if (!(id in (s.sizes || {}))) delete g.sizes[id];
  if (s.activity) g.lastOut = Math.max(g.lastOut, s.activity);
  const quietMs = Math.max(0, now - g.lastOut);
  const limit = s.limitMs > 0 ? s.limitMs : Infinity;
  if (quietMs >= limit && !g.reported) { g.reported = true; return { report: { quietMs, since: g.lastOut }, cleared: false, quietMs }; }
  if (quietMs < limit && g.reported) { g.reported = false; return { report: null, cleared: true, quietMs }; }
  return { report: null, cleared: false, quietMs };
}

// pure: the last line a log shows (a progress bar's carriage returns: the newest state), trimmed for the screen
export function lastLine(text, max = 200) {
  const lines = String(text || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split('\n').map((l) => l.split('\r').filter((x) => x.trim()).pop() || '').map((l) => l.trim()).filter(Boolean);
  const l = lines[lines.length - 1] || '';
  return l.length > max ? l.slice(0, max - 1) + '…' : l;
}

// pure: the words for the report
export function quietText({ stage, quietMs, what, last }) {
  const min = Math.round(quietMs / 60000);
  return `${stage || 'The stage'}: nothing new for ${min} min${what ? ` from ${what}` : ''}${last ? ` (last line: "${last}")` : ' (its log is empty)'}. It may be stuck: Stop it, or let it run.`;
}
