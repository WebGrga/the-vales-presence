// The History drawer's rows (pure, tested in history-rows.test.js): .presence/log.jsonl as one row per stage run, chat
// turn or decision, newest first, each with its time, cost and outcome, and for what went wrong, what and why.
// A stage's "started" line and its ending line (which carries the same `start`) become one row.

const pad = (n) => String(n).padStart(2, '0');
export const clock = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const dayOf = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// the words for an error the SDK or the runner gave
export function plainError(e) {
  const s = String(e || '').trim();
  if (!s) return '';
  if (/error_max_turns/i.test(s)) return 'The agent used up the steps it is allowed in one go.';
  if (/error_during_execution/i.test(s)) return 'Something went wrong while the agent was working.';
  if (/error_max_budget/i.test(s)) return 'The agent reached its spending limit for this turn.';
  if (/session closed mid-stage/i.test(s)) return 'The agent session closed in the middle of the stage (it may have been idle too long, or Claude Code stopped).';
  if (/^error$/i.test(s)) return 'The agent ended with an error and gave no reason.';
  if (/rate|limit|overloaded|529|429/i.test(s)) return `Claude was busy or you hit a usage limit: ${s.slice(0, 160)}`;
  if (/login|auth|credential|401|403/i.test(s)) return `Claude Code is not signed in or not allowed: ${s.slice(0, 160)}`;
  return s.slice(0, 240);
}

const STAGE_WORD = { done: 'Done', waiting: 'Waiting for you', approved: 'Approved', kept: 'Kept what was there', relocked: 'Approved the changed file', paused: 'Stopped after the stage, as you asked' };

// one line -> { kind, label, outcome ('ok'|'failed'|'stopped'|'waiting'|'halted'|'info'), detail }
function describe(e) {
  if (e.stage === 'chat' || e.kind === 'chat') return { kind: 'chat', label: e.error ? 'A turn that failed' : 'A turn with the agent', outcome: e.error ? 'failed' : 'ok', detail: e.error ? plainError(e.error) : '' };
  const st = String(e.status || '');
  if (st === 'halted') return { kind: 'stage', label: 'Halted', outcome: 'halted', detail: e.why || 'The project stopped.' };
  if (st === 'queued') return { kind: 'stage', label: 'Waited in line', outcome: 'info', detail: (e.behind || []).length ? `Behind ${(e.behind || []).join(', ')}.` : '' };
  if (st === 'quiet') return { kind: 'stage', label: 'Went quiet', outcome: 'failed', detail: `No output for ${Math.round((e.quietMs || 0) / 60000)} min${e.what ? ` while: ${e.what}` : ''}.` };
  if (st === 'sent back') return { kind: 'stage', label: `Sent back${e.to ? ' to ' + e.to : ''}`, outcome: 'info', detail: e.notes ? String(e.notes).slice(0, 240) : '' };
  if (st === 'todo') {
    if (e.stopped) return { kind: 'stage', label: 'Stopped', outcome: 'stopped', detail: 'You pressed Stop.' };
    return { kind: 'stage', label: 'Failed', outcome: 'failed', detail: [plainError(e.error), e.missing?.length ? `It ended without ${e.missing.join(', ')}.` : ''].filter(Boolean).join(' ') || 'It ended without finishing.' };
  }
  if (st === 'waiting') return { kind: 'stage', label: STAGE_WORD.waiting, outcome: 'waiting', detail: e.missing?.length ? `Ended without ${e.missing.join(', ')}: answer the agent.` : '' };
  if (STAGE_WORD[st]) return { kind: 'stage', label: STAGE_WORD[st], outcome: st === 'paused' ? 'info' : 'ok', detail: e.notes ? String(e.notes).slice(0, 240) : '' };
  return { kind: 'event', label: st ? st[0].toUpperCase() + st.slice(1) : 'Event', outcome: 'info', detail: '' };
}

// entries: log lines (oldest first); titleOf(stageId) -> words; running: the stage id running now, or null
export function rows(entries, { titleOf = (x) => x, running = null, asking = false } = {}) {
  const list = (entries || []).filter((e) => e && e.t);
  const out = [];
  const open = new Map(); // start iso -> index in out
  for (const e of list) {
    if (e.status === 'started') {
      out.push({ t: e.start || e.t, stage: e.stage, title: titleOf(e.stage), label: 'Running', outcome: running === e.stage ? 'running' : 'info', detail: '', ms: 0, cost: 0, chained: !!e.chained, key: e.start || e.t, openRow: true });
      open.set(e.start || e.t, out.length - 1);
      continue;
    }
    const d = describe(e);
    const at = e.start && open.has(e.start) ? open.get(e.start) : -1;
    const row = { t: e.start || e.t, ended: e.t, stage: e.stage, title: e.stage === 'chat' ? 'Chat' : titleOf(e.stage), ...d, ms: Number(e.ms) || 0, cost: Number(e.cost) || 0, plan: e.plan === true };
    if (at >= 0 && (d.kind === 'stage' || d.kind === 'chat') && e.ms !== undefined) { out[at] = row; open.delete(e.start); } else out.push(row);
  }
  // a start with no end: still running, or it was cut off (the server stopped)
  for (const r of out) if (r.openRow) { delete r.openRow; if (r.outcome !== 'running') { r.label = 'Did not finish'; r.detail = 'No ending was recorded: the server may have been stopped.'; r.outcome = 'failed'; } else { r.label = asking ? 'Waiting for your answer' : 'Running now'; if (asking) r.outcome = 'waiting'; } }
  return out.sort((a, b) => String(b.ended || b.t).localeCompare(String(a.ended || a.t)));
}

// the rows grouped by day, newest first -> [{ day, rows, cost }]
export function byDay(list) {
  const days = [];
  for (const r of list) {
    const d = dayOf(r.ended || r.t);
    let g = days.find((x) => x.day === d);
    if (!g) days.push(g = { day: d, rows: [], cost: 0 });
    g.rows.push(r); g.cost += r.cost || 0;
  }
  return days;
}
