// What the agent is doing now, for the strip on every tab (pure, tested in activity-state.test.js). A reducer over the
// live messages the server sends ('agent', 'progress', 'live', 'queue') -> { busy, asleep, asking, stage, since, step,
// queued, stopAfter, fires, stalled, error }. `step` is the last thing it did in plain words (the Bash description,
// not the raw command): { title, detail }.
import { toolLine, fireLabel } from '../editor/agent-lines.js';

export const idle = () => ({ busy: false, asleep: false, asking: false, stage: null, since: 0, step: null, queued: null, stopAfter: false, fires: [], stalled: null, error: null });

export function reduce(s, m, { now = Date.now(), projectId = null } = {}) {
  if (!m) return s;
  if (m.project && projectId && m.project !== projectId) return s;
  switch (m.type) {
    case 'agent': {
      if (m.event === 'text') {
        if (m.start || (m.text && !s.busy)) return { ...s, busy: true, asleep: false, asking: false, error: null, stage: m.stage || s.stage, since: s.busy ? s.since : now, step: s.step || { title: 'Thinking…', detail: '' }, queued: null };
        return s.busy ? { ...s, stage: m.stage || s.stage } : s;
      }
      if (m.event === 'tool') {
        if (m.tool === 'AskUserQuestion') return s;
        const l = toolLine(m.tool, m.input, projectId);
        return { ...s, busy: true, asleep: false, error: null, stage: m.stage || s.stage, since: s.busy ? s.since : now, step: { title: l.title, detail: l.detail || '', background: !!l.background } };
      }
      if (m.event === 'question') return { ...s, asking: true, busy: false, step: null };
      if (m.event === 'done') return { ...s, busy: false, asking: false, asleep: !!m.asleep, step: m.asleep ? s.step : null, error: m.error ? String(m.error) : null, stage: m.asleep ? s.stage : null, since: m.asleep ? s.since : 0 };
      if (m.event === 'error') return { ...s, busy: false, step: null, error: m.text || 'Something went wrong' };
      if (m.event === 'stalled') return { ...s, stalled: m.cleared ? null : { quietMs: m.quietMs, what: m.what || '' } };
      return s;
    }
    case 'fire': {
      // a background task of the agent (a render, a transcription): burning until it says done
      const rest = (s.fires || []).filter((f) => f.id !== m.id);
      return { ...s, fires: m.state === 'done' ? rest : [...rest, { id: m.id, cmd: m.cmd, start: m.start || now, last: m.last || '' }] };
    }
    case 'progress':
      return { ...s, since: m.since || s.since, asleep: !!m.asleep, stage: m.stage || s.stage, fires: m.fires || [], stalled: m.stalled || null, busy: s.busy || !!m.asleep || !!m.since };
    case 'live': {
      const v = m.view || {};
      const r = v.running;
      const next = { ...s, stopAfter: !!v.stopAfter, queued: v.queued ? (v.queued.text || 'Waiting in line') : null, stalled: r?.stalled || s.stalled };
      if (r) return { ...next, busy: true, stage: r.stage, since: r.since || s.since || now, asleep: !!r.asleep, fires: r.fires || [] };
      // no stage runs any more: a stage's work that we still think goes on has ended (a chat turn has no stage and goes on)
      const ended = s.busy && s.stage && !s.asleep;
      return { ...next, busy: ended ? false : s.busy, step: ended ? null : s.step, stage: ended ? null : s.stage, since: ended ? 0 : s.since, asking: v.waiting?.for === 'question' };
    }
    case 'queue':
      return { ...s, queued: m.left || m.started ? null : (m.text || 'Waiting in line') };
    default: return s;
  }
}

// the status of GET /api/projects/:id/agent and its recent events -> a state
export function fromStatus(st, view, opts = {}) {
  let s = idle();
  const now = opts.now || Date.now();
  if (st?.busy || st?.asleep) s = { ...s, busy: !!st.busy || !!st.asleep, asleep: !!st.asleep, stage: st.stage || null, since: st.turn?.start || st.asleepSince || now };
  for (const e of st?.events || []) s = reduce(s, e, { now, projectId: opts.projectId });
  if (!(st?.busy || st?.asleep)) { s = { ...s, busy: false, step: null }; }
  if (st?.question) s = { ...s, asking: true };
  if ((st?.fires || []).length) s = { ...s, fires: st.fires.map((f) => ({ id: f.id, cmd: f.cmd, start: f.start, last: f.last || '' })) };
  if (view) s = reduce(s, { type: 'live', view }, { now });
  return s;
}

// the strip's words. -> { kind: 'work'|'sleep'|'ask'|'queue'|'stalled'|null, what, step }
export function stripLine(s, stageTitle) {
  const stage = stageTitle || '';
  if (s.asking) return { kind: 'ask', what: stage ? `${stage}: waiting for your answer` : 'The agent is waiting for your answer', step: '' };
  if (s.queued && !s.busy) return { kind: 'queue', what: stage || 'Waiting', step: s.queued };
  if (s.asleep) {
    const f = (s.fires || [])[0];
    return { kind: 'sleep', what: stage || 'The agent', step: f?.last ? `Rendering: ${f.last}` : 'Waiting for its background task to end' };
  }
  if (!s.busy && (s.fires || []).length) {
    const f = s.fires[0];
    // a command is told by what it does (Rendering, Transcribing); words the agent wrote as the description are kept as they are
    let label = fireLabel(f.cmd);
    if (label === 'Working in the background' && /^[\w ,.'’-]{3,80}$/.test(String(f.cmd || '')) && !/ -{1,2}\w/.test(String(f.cmd))) label = String(f.cmd);
    return { kind: 'sleep', what: stage || 'Background task', step: `${label}${f.last ? `: ${f.last}` : ''}${label === 'Working in the background' ? '' : ' (in the background)'}`, since: f.start, bg: true };
  }
  if (s.stalled && s.busy) return { kind: 'stalled', what: stage || 'The agent', step: 'No output for a while' };
  if (s.busy) return { kind: 'work', what: stage || 'Working on your message', step: s.step?.title || 'Working…' };
  return { kind: null, what: '', step: '' };
}
