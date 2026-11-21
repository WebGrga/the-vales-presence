// The stage bar's model (pure, no DOM; tested in stages.test.js): the recipe's stages as chips with their state, time
// and cost, the project's totals, and which buttons the current stage offers.
// project = project.json ({ at, stages: { id: { status, ms, cost, note, started } }, halted?, chat? }, and from the
// server's GET the recipe's own stages as recipeDef and its `view` with the actions it allows); recipe = { stages: [{ id, kind, title, lock? }] }.

const USER_KINDS = new Set(['gate', 'record', 'options', 'upload', 'export']);

// the recipe of a project as the server sends it (recipeDef), or an object under recipe
export const recipeOf = (p) => p?.recipeDef || (p?.recipe && typeof p.recipe === 'object' ? p.recipe : null);

// Chip states: done, now (the agent works), ask (the agent waits for your answer), queued (waiting in line behind
// another project's render), you (your turn: approve, record, pick), ready (press Go), halted, todo.
// opts.asking: the agent waits on a question of yours right now (the current chip turns 'ask', whatever its status says)
export function chips(project, recipe, opts = {}) {
  const ps = project?.stages || {};
  const list = recipe?.stages?.length ? recipe.stages : Object.keys(ps).map((id) => ({ id, title: id }));
  const queue = project?.view?.queued || null; // the server's { stage, behind: [{ title, stageTitle }], text }
  return list.map((st, i) => {
    const s = ps[st.id] || {}, raw = String(s.status || '');
    const here = project?.at === st.id;
    let state = 'todo';
    if (raw === 'done' || raw === 'approved' || raw === 'skipped') state = 'done';
    else if (raw === 'halted' || (project?.halted && here)) state = 'halted';
    else if (here && opts.asking) state = 'ask';
    else if (raw === 'queued' || (here && raw !== 'running' && (s.queued || queue?.stage === st.id || /^(queued|waiting in line)\b/i.test(String(s.note || ''))))) state = 'queued';
    else if (raw === 'running' || raw === 'working') state = 'now';
    else if (raw === 'waiting') state = USER_KINDS.has(st.kind) ? 'you' : 'ask';
    else if (here) state = USER_KINDS.has(st.kind) ? 'you' : 'ready';
    const t = st.title || title(st.id);
    return {
      id: st.id, n: i + 1, title: t, short: st.short || shortTitle(t), kind: st.kind || '', state,
      ms: Number(s.ms) || 0, cost: Number(s.cost) || 0, started: Number(s.started) || 0,
      lock: Array.isArray(st.lock) && st.lock.length > 0, heavy: !!st.heavy, note: s.note || '',
      behind: here && state === 'queued' ? behindOf(queue?.behind || s.queued?.behind) : null,
    };
  });
}

// who a queued stage waits behind, in words: "Other video (Visuals)", or null
export function behindOf(list) {
  const b = Array.isArray(list) ? list[0] : list && typeof list === 'object' ? list : null;
  if (!b) return typeof list === 'string' ? list : null;
  const name = b.title || b.project || '';
  const stage = b.stageTitle || b.stage || '';
  const more = Array.isArray(list) && list.length > 1 ? ` and ${list.length - 1} more` : '';
  return name ? `${name}${stage ? ` (${stage})` : ''}${more}` : null;
}

export const title = (id) => String(id || '').replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

// a chip's short name: its first word that is not a small one ("A video from the idea" -> "Video"), at most 9 letters
export function shortTitle(t) {
  const w = String(t || '').split(/\s+/).filter(Boolean);
  const small = new Set(['a', 'an', 'the', 'your', 'my']);
  const pick = (w.find((x) => !small.has(x.toLowerCase())) || w[0] || '').replace(/^./, (c) => c.toUpperCase());
  return pick.length > 9 ? pick.slice(0, 8) + '.' : pick;
}

// how the chips fit: 'full' names, 'compact' (number + short name, the current one in full), or 'tiny' (numbers, the
// current one named). widths = { full, compact } the row needs, room = the px it has
export function chipMode(widths, room) {
  if (!room || widths.full <= room) return 'full';
  if (widths.compact <= room) return 'compact';
  return 'tiny';
}

// the running stage's time this round so far (ms), or 0
export const elapsed = (c, now = Date.now()) => (c && (c.state === 'now' || c.state === 'ask') && c.started ? Math.max(0, now - c.started) : 0);

// the stages' time and cost; with the project, plus the work outside the stage bar: Studio turns and talking to the
// agent (project.chat; project.studio when the server keeps Studio apart) -> { ms, cost, stages, extras: [{ label, ms, cost }] }
export function totals(cs, project) {
  const t = cs.reduce((a, c) => ({ ms: a.ms + c.ms, cost: a.cost + c.cost }), { ms: 0, cost: 0 });
  if (!project) return t;
  const extras = [];
  const add = (label, x) => { if (x && (Number(x.ms) || Number(x.cost))) extras.push({ label, ms: Number(x.ms) || 0, cost: Number(x.cost) || 0 }); };
  if (project.studio) { add('Studio', project.studio); add('Talking to the agent', project.chat); }
  else add('Studio and talking to the agent', project.chat);
  return { ms: extras.reduce((a, x) => a + x.ms, t.ms), cost: extras.reduce((a, x) => a + x.cost, t.cost), stages: t, extras };
}

// a lock gate has been approved: the talk is locked, and Keep / Restore no longer change anything
export function isLocked(project, recipe) {
  return (recipe?.stages || []).some((st) => Array.isArray(st.lock) && st.lock.length
    && ['done', 'approved'].includes(String(project?.stages?.[st.id]?.status || '')));
}

// The choices the rough does not have yet (the server refuses to lock while there are any), from the cuts route's
// review and the working list -> { restored: [ids], strikes, trims, any, say }
export function pendingOf(review, working) {
  const num = (id) => parseInt(String(id).replace(/\D/g, ''), 10) || 0;
  const restored = Object.entries(review || {}).filter(([, r]) => r && r.keep === false).map(([id]) => id).sort((a, b) => num(a) - num(b));
  const w = working?.working && typeof working.working === 'object' ? working.working : working && typeof working === 'object' ? working : {};
  const strikes = Array.isArray(w.strikes) ? w.strikes.length : Number(w.strikes) || 0;
  const trims = Array.isArray(w.trims) ? w.trims.length : Number(w.trims) || 0;
  const parts = [];
  if (restored.length) parts.push(`you restored ${restored.length === 1 ? 'cut ' + restored[0] : `${restored.length} cuts (${restored.join(', ')})`}`);
  if (strikes) parts.push(`you struck ${strikes} stretch${strikes === 1 ? '' : 'es'} of words`);
  if (trims) parts.push(`you moved ${trims} join${trims === 1 ? '' : 's'}`);
  const n = restored.length + strikes + trims;
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] || '';
  const say = n ? `${list.replace(/^./, (c) => c.toUpperCase())}. The rough does not have ${n > 1 ? 'these' : 'this'} yet, so it cannot be locked as it is: the agent first rebuilds the rough with your choices, then you approve it.` : '';
  return { restored, strikes, trims, any: n > 0, say };
}

// the server's own count when its view has one (view.pending: { restored: [ids], strikes, trims } or null), else ours
export function pendingFrom(project, review, working) {
  const v = project?.view?.pending;
  if (v && typeof v === 'object') return pendingOf(Object.fromEntries((v.restored || []).map((id) => [id, { keep: false }])), { strikes: Number(v.strikes) || 0, trims: Number(v.trims) || 0 });
  if (v === null) return pendingOf(null, null);
  return pendingOf(review, working);
}

// the notes a send-back carries when the editor is not open to add its own: what was typed, then the choices
export function plainChoices(typed, pending) {
  const t = String(typed || '').trim(), parts = [];
  if (pending?.restored?.length) parts.push(`Restore ${pending.restored.join(', ')}.`);
  if (pending?.strikes) parts.push(`I struck ${pending.strikes} stretch${pending.strikes === 1 ? '' : 'es'} in the transcript (in video/out/edl.working.json).`);
  if (pending?.trims) parts.push(`I moved ${pending.trims} join${pending.trims === 1 ? '' : 's'} on the timeline (in video/out/edl.working.json).`);
  return [t, parts.join(' ')].filter(Boolean).join('\n\n');
}

// the current stage and what its buttons are: go (an agent stage not yet running), approve / sendback (a stage waiting
// for the user), approveLabel ("Approve & lock" when the gate locks files), answer (the agent waits for your answer).
// When the server's view lists its actions ('go', 'stop', 'answer', 'approve', 'sendback', 'resume', 'keep'), those win.
// Stop shows only while the agent works or waits in line, never while it waits for your answer.
export function actions(project, cs) {
  const cur = cs.find((c) => c.id === project?.at) || null;
  const halted = !!project?.halted || cur?.state === 'halted';
  const waiting = !!cur && cur.state === 'you';
  const asking = !!cur && cur.state === 'ask';
  const agentKind = cur && !USER_KINDS.has(cur.kind);
  const label = cur?.lock ? 'Approve & lock' : 'Approve';
  const server = project?.view?.actions;
  if (Array.isArray(server)) {
    const has = (a) => server.includes(a);
    return { cur, halted, asking, go: has('go') && !asking, approve: has('approve'), sendback: has('sendback'), stop: has('stop') && !asking, resume: has('resume'), keep: has('keep') && !asking, answer: asking, approveLabel: label };
  }
  return {
    cur,
    halted,
    asking,
    go: !!cur && !halted && !asking && !['now', 'done', 'queued'].includes(cur.state) && (agentKind || !cur.kind),
    approve: !!cur && !halted && waiting,
    sendback: !!cur && !halted && waiting,
    stop: !!cur && (cur.state === 'now' || cur.state === 'queued'),
    resume: false,
    answer: asking,
    approveLabel: label,
  };
}

// the stage a send-back reached and the notes it carried, while that stage has not finished:
// { stage, title, notes, at } or null (from the target stage's note "Sent back: ...")
export function sentBack(project, recipe) {
  for (const st of recipe?.stages || []) {
    const s = project?.stages?.[st.id];
    if (s && /^Sent back: /.test(String(s.note || '')) && !['done', 'approved'].includes(String(s.status))) {
      return { stage: st.id, title: st.title || title(st.id), notes: String(s.note).replace(/^Sent back: /, ''), at: Number(s.sentBack) || 0 };
    }
  }
  return null;
}

export function fmtMs(ms) {
  const s = Math.round((Number(ms) || 0) / 1000);
  if (!s) return '';
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return r ? `${m} min ${r} s` : `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

// a running clock: 0:42, 12:05, 1:02:07
export function fmtClock(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const pad = (x) => String(x).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

export function fmtCost(c) {
  const n = Number(c) || 0;
  if (!n) return '';
  return n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`;
}
