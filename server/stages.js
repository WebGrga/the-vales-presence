// The stage machine over a recipe (pure: every function takes a project and returns a new one, nothing is written here).
// A project stands on one stage (`at`). Stage statuses:
//   todo     not run yet (an agent stage ready for Go)
//   running  an agent stage whose turn is going (or is asleep while its background render burns)
//   waiting  waiting for you: a user stage (gate, record, options, upload, export), or an agent stage that asked you something
//   done     finished
//   halted   the project is halted on this stage (project.halted says why)
// Agent stages (ask, make, inspect) chain on by themselves when the one before them ends; user stages wait for a click.

export const AGENT_KINDS = ['ask', 'make', 'inspect'];
export const USER_KINDS = ['gate', 'record', 'options', 'upload', 'export'];
export const isAgent = (kind) => AGENT_KINDS.includes(kind);
export const isUser = (kind) => USER_KINDS.includes(kind);
export const SENDBACK_KINDS = ['gate', 'options', 'upload', 'export']; // stages you can send back from

const clone = (p) => JSON.parse(JSON.stringify(p));
export const indexOf = (recipe, id) => (recipe?.stages || []).findIndex((s) => s.id === id);
export const stageOf = (recipe, id) => (recipe?.stages || []).find((s) => s.id === id) || null;
const firstStatus = (st) => (isAgent(st.kind) ? 'todo' : 'waiting');

// A new project's stages: every stage todo, the first one current
export function initStages(recipe) {
  const list = recipe?.stages || [];
  const stages = {};
  for (const s of list) stages[s.id] = { status: 'todo', ms: 0, cost: 0 };
  if (list[0]) stages[list[0].id].status = firstStatus(list[0]);
  return { at: list[0]?.id || null, stages };
}

// A project read from disk may miss stages (an older project, a recipe that grew): fill them in, keep what is there
export function normalize(project, recipe) {
  const p = clone(project || {});
  p.stages ||= {};
  for (const s of recipe?.stages || []) p.stages[s.id] = { status: 'todo', ms: 0, cost: 0, ...(p.stages[s.id] || {}) };
  if (!p.at || indexOf(recipe, p.at) < 0) p.at = recipe?.stages?.find((s) => p.stages[s.id].status !== 'done')?.id || recipe?.stages?.[0]?.id || null;
  return p;
}

export const current = (project, recipe) => stageOf(recipe, project?.at);
export const statusOf = (project, id) => project?.stages?.[id]?.status || 'todo';

// Can Go run the current stage? -> { ok: true, stage } | { error }
export function canGo(project, recipe) {
  const st = current(project, recipe);
  if (!st) return { error: project?.done ? 'every stage is done' : 'no stage here' };
  if (project.halted) return { error: 'the project is halted: ' + project.halted };
  if (!isAgent(st.kind)) return { error: `${st.title || st.id} waits for you, not the agent` };
  const s = statusOf(project, st.id);
  if (s === 'running') return { error: `${st.title || st.id} is already running` };
  if (s === 'done') return { error: `${st.title || st.id} is done` };
  return { ok: true, stage: st };
}

// The current agent stage starts (Go, or a chain from the stage before)
export function begin(project, recipe, now = Date.now()) {
  const g = canGo(project, recipe);
  if (g.error) return g;
  const p = clone(project);
  const s = p.stages[g.stage.id];
  s.round = (s.round || 0) + 1;
  s.status = 'running'; s.started = now; delete s.hold; delete s.queued;
  if (/^Waiting in line/.test(s.note || '')) delete s.note;
  delete p.done;
  return { project: p, stage: g.stage };
}

// An answer to an agent stage that waited for you: it runs again (the same round)
export function resumeAsked(project, recipe, now = Date.now()) {
  const st = current(project, recipe);
  if (!st || !isAgent(st.kind) || statusOf(project, st.id) !== 'waiting' || project.halted) return { error: 'no stage is waiting for an answer' };
  const p = clone(project);
  p.stages[st.id].status = 'running'; p.stages[st.id].started ||= now; delete p.stages[st.id].note;
  return { project: p, stage: st };
}

// Move past the current stage: it is done, the next one becomes current (todo for the agent, waiting for you)
export function advance(project, recipe, now = Date.now()) {
  const p = clone(project);
  const i = indexOf(recipe, p.at);
  if (i < 0) return p;
  const s = p.stages[p.at];
  s.status = 'done'; s.ended = now;
  const next = recipe.stages[i + 1];
  if (!next) { p.done = true; p.finished = now; return p; }
  p.at = next.id;
  p.stages[next.id] = { status: 'todo', ms: 0, cost: 0, ...(p.stages[next.id] || {}) };
  p.stages[next.id].status = firstStatus(next);
  return p;
}

// A turn of the current agent stage ended.
// r: { ms, cost, error, stopped, ready (the stage's `out` files exist), asked (it ended on a question), note, now }
// -> { project, outcome: 'done' | 'waiting' | 'todo' }
export function turnEnded(project, recipe, r = {}) {
  const st = current(project, recipe);
  if (!st || !isAgent(st.kind)) return { project, outcome: 'none' };
  let p = clone(project);
  const s = p.stages[st.id];
  s.ms = (s.ms || 0) + Math.max(0, r.ms || 0);
  s.cost = round6((s.cost || 0) + Math.max(0, r.cost || 0));
  if (r.stopped) { s.status = 'todo'; s.hold = true; s.note = 'Stopped. Press Go to run it again.'; return { project: p, outcome: 'todo' }; }
  if (r.error) { s.status = 'todo'; s.hold = true; s.note = 'The stage failed: ' + String(r.error).slice(0, 500); return { project: p, outcome: 'todo' }; }
  if (r.ready === false || r.asked) {
    s.status = 'waiting';
    s.note = r.asked ? 'The agent asked you something: answer in the agent panel.' : (r.note || 'The stage ended before its files were there: answer the agent, or press Go to run it again.');
    return { project: p, outcome: 'waiting' };
  }
  delete s.note;
  if (p.backFrom?.target === st.id) delete p.backFrom; // the send-back ran: there is no older version to go back to
  p = advance(p, recipe, r.now);
  return { project: p, outcome: 'done' };
}

// You approve the current user stage. -> { project, stage, lock: [paths to hash] } | { error }
// (the caller hashes `lock` first and refuses the approval when a file is missing)
export function approve(project, recipe, { notes = '', now = Date.now() } = {}) {
  const st = current(project, recipe);
  if (!st) return { error: 'no stage here' };
  if (project.halted) return { error: 'the project is halted: ' + project.halted };
  if (!isUser(st.kind)) return { error: `${st.title || st.id} is the agent's stage: there is nothing to approve` };
  if (statusOf(project, st.id) !== 'waiting') return { error: `${st.title || st.id} is not waiting for you` };
  let p = clone(project);
  const s = p.stages[st.id];
  if (s.started == null) s.started = now;
  if (String(notes || '').trim()) s.note = 'Approved: ' + String(notes).trim().slice(0, 4000); else delete s.note;
  p = advance(p, recipe, now);
  return { project: p, stage: st, lock: Array.isArray(st.lock) ? st.lock : [] };
}

// Where a send-back goes: the stage's own `back`, else the nearest agent `make` stage before it
export function sendbackTarget(recipe, id) {
  const i = indexOf(recipe, id);
  const st = recipe?.stages?.[i];
  if (!st) return null;
  if (st.back) { const j = indexOf(recipe, st.back); return j >= 0 && j < i ? recipe.stages[j] : null; }
  for (let j = i - 1; j >= 0; j--) if (recipe.stages[j].kind === 'make') return recipe.stages[j];
  for (let j = i - 1; j >= 0; j--) if (isAgent(recipe.stages[j].kind)) return recipe.stages[j];
  return null;
}

// You send the current stage back with notes. -> { project, target, from } | { error }
// Every stage from the target up to this one is todo again; the target carries the notes. Locks made by gates at or
// after the target are no longer binding (the caller drops them: dropLocks).
export function sendback(project, recipe, { notes = '', now = Date.now() } = {}) {
  const st = current(project, recipe);
  if (!st) return { error: 'no stage here' };
  const lockHalt = project.halted && project.lockBroken;
  if (project.halted && !lockHalt) return { error: 'the project is halted: ' + project.halted };
  if (!lockHalt && (!SENDBACK_KINDS.includes(st.kind) || statusOf(project, st.id) !== 'waiting')) return { error: `${st.title || st.id} cannot be sent back now` };
  if (!String(notes || '').trim()) return { error: 'say what to change: sending back needs notes' };
  // a lock halt goes back to the make stage before the gate that locked the changed files
  const from = lockHalt ? stageOf(recipe, project.lockBroken.gate) || st : st;
  const target = sendbackTarget(recipe, from.id);
  if (!target) return { error: `there is no stage before ${from.title || from.id} to send it back to` };
  const p = clone(project);
  const a = indexOf(recipe, target.id), b = Math.max(indexOf(recipe, from.id), indexOf(recipe, st.id));
  // what was there before, so "go on with what exists" can come back to it without running the stage again
  // (stage-keep.js); a lock halt has no version to come back to
  if (lockHalt) delete p.backFrom;
  else {
    const before = {};
    for (let k = a; k <= b; k++) { const id = recipe.stages[k].id; before[id] = clone(p.stages[id] || {}); }
    p.backFrom = { from: st.id, target: target.id, at: now, stages: before };
  }
  for (let k = a; k <= b; k++) {
    const id = recipe.stages[k].id;
    const s = p.stages[id] ||= { ms: 0, cost: 0 };
    s.status = 'todo'; delete s.note; delete s.ended;
  }
  p.stages[target.id].note = 'Sent back: ' + String(notes).trim().slice(0, 4000);
  p.stages[target.id].sentBack = now;
  p.at = target.id;
  delete p.halted; delete p.lockBroken; delete p.done;
  return { project: p, target, from };
}

// The locks that stop binding when a project goes back to stage index `to`: those made by gates at or after it
export function dropLocks(locks, recipe, to) {
  const out = {};
  for (const [rel, l] of Object.entries(locks || {})) { const k = indexOf(recipe, l.stage); if (k >= 0 && k < to) out[rel] = l; }
  return out;
}

// The locks binding the stage the project stands on: made by a gate earlier in the recipe
export function activeLocks(locks, recipe, at) {
  const i = indexOf(recipe, at);
  const out = {};
  for (const [rel, l] of Object.entries(locks || {})) { const k = indexOf(recipe, l.stage); if (k >= 0 && k < i) out[rel] = l; }
  return out;
}

// Halt on the current stage. extra: { lockBroken: { files, gate, when } }
export function halt(project, recipe, why, extra = {}) {
  const p = clone(project);
  p.halted = String(why || 'halted');
  if (extra.lockBroken) p.lockBroken = extra.lockBroken;
  if (p.at && p.stages[p.at]) { p.stages[p.at].status = 'halted'; p.stages[p.at].note = p.halted; }
  return p;
}

// Clear a halt: the stage is todo (agent) or waiting (you) again. done: true moves past it (a lock halt after the
// stage ran, approved as the new version).
export function unhalt(project, recipe, { done = false, now = Date.now() } = {}) {
  let p = clone(project);
  delete p.halted; delete p.lockBroken;
  const st = current(p, recipe);
  if (!st) return p;
  delete p.stages[st.id].note;
  if (done) return advance(p, recipe, now);
  p.stages[st.id].status = firstStatus(st);
  return p;
}

// The server restarted: a stage that was running is todo again, with a note. alive(pid): a stage another server
// process still runs (s.pid, set when it started) is left alone, so a second server on the same data never cuts it off.
export function interrupted(project, { alive = () => false } = {}) {
  let hit = false;
  const p = clone(project);
  for (const s of Object.values(p.stages || {})) {
    if ((s.status === 'running' || s.queued) && s.pid && alive(s.pid)) continue;
    if (s.status === 'running') { s.status = 'todo'; s.hold = true; s.note = 'The server stopped while this stage ran. Press Go to run it again.'; hit = true; }
    else if (s.queued) { delete s.queued; s.hold = true; s.note = 'The server restarted while this stage waited in line. Press Go to run it.'; hit = true; }
  }
  return hit ? p : null;
}

// The current heavy stage waits in line: behind = [{ project, title, stage, stageTitle }] (what runs now, then what
// waits ahead of it). It stays todo; begin() clears the mark when its turn comes.
export function queue(project, recipe, behind = [], now = Date.now()) {
  const st = current(project, recipe);
  if (!st) return project;
  const p = clone(project);
  const s = p.stages[st.id];
  s.queued = { since: s.queued?.since || now, behind: (behind || []).slice(0, 8) };
  s.note = queueNote(behind);
  return p;
}
export function unqueue(project, recipe) {
  const st = current(project, recipe);
  if (!st || !project.stages?.[st.id]?.queued) return project;
  const p = clone(project);
  delete p.stages[st.id].queued;
  if (/^Waiting in line/.test(p.stages[st.id].note || '')) delete p.stages[st.id].note;
  return p;
}
// pure: the words for a stage in line
export function queueNote(behind = []) {
  const name = (b) => `${b.title || b.project}${b.stageTitle || b.stage ? ` (${b.stageTitle || b.stage})` : ''}`;
  if (!behind?.length) return 'Waiting in line: another project is rendering. It starts when that one ends.';
  const [first, ...rest] = behind;
  return `Waiting in line behind ${name(first)}${rest.length ? ` and ${rest.length} more` : ''}. It starts by itself when ${rest.length ? 'they end' : 'that one ends'}.`;
}

// Should the runner start the current stage by itself? (an agent stage that is todo, after the one before it ended)
export const shouldChain = (project, recipe) => {
  const st = current(project, recipe);
  return !!st && !project.halted && !project.done && isAgent(st.kind) && statusOf(project, st.id) === 'todo' && !project.stages[st.id].hold;
};

// What the screen shows (the chips, totals, buttons, who waits for whom): stage-view.js
export { view, waitingFor } from './stage-view.js';
export const round6 = (x) => Math.round((x || 0) * 1e6) / 1e6;
