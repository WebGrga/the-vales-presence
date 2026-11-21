// What the screen shows of a project's stages (pure): the chips, the totals, the buttons that apply now, and who
// waits for whom. Re-exported by stages.js; tested in stage-view.test.js.
//
// live (from the runner, all optional):
//   question  { questions, at }        an AskUserQuestion waits for your answer
//   asleep    { since, note }          the stage sleeps while its background task runs
//   fires     [{ id, cmd, start, elapsedMs, last, quietMs }]   the background tasks burning now
//   stalled   { since, quietMs, what, last }                   no output for longer than the guard allows
//   keep      stage-keep.js keepOption(): "go on with what exists" applies
import { isAgent, current, statusOf, sendbackTarget, SENDBACK_KINDS, queueNote, round6 } from './stages.js';

export function view(project, recipe, live = {}) {
  const list = recipe?.stages || [];
  let ms = 0, cost = 0;
  const chips = list.map((st, i) => {
    const s = project?.stages?.[st.id] || {};
    ms += s.ms || 0; cost += s.cost || 0;
    const now = st.id === project?.at && !project?.done;
    const running = s.status === 'running';
    return { id: st.id, title: st.title || st.id, kind: st.kind, who: isAgent(st.kind) ? 'agent' : 'you', status: s.status || 'todo', now,
      forYou: now && (s.status === 'waiting' || s.status === 'halted'), ms: s.ms || 0, cost: round6(s.cost || 0), note: s.note || '', index: i, heavy: !!st.heavy, lock: st.lock || undefined,
      round: s.round || 0, since: running && s.started ? s.started : undefined, queued: s.queued || undefined };
  });
  const st = current(project, recipe);
  const s = st ? statusOf(project, st.id) : '';
  const actions = [];
  if (project?.halted) { actions.push(project.lockBroken ? 'approve' : 'resume'); if (project.lockBroken) actions.push('sendback'); }
  else if (st && !project.done) {
    if (isAgent(st.kind)) { if (s === 'running') actions.push('stop'); else if (s === 'todo' || s === 'waiting') actions.push('go'); if (s === 'waiting') actions.push('answer'); }
    else if (s === 'waiting') { actions.push('approve'); if (SENDBACK_KINDS.includes(st.kind) && sendbackTarget(recipe, st.id)) actions.push('sendback'); }
  }
  if (live.keep && !project?.halted && s !== 'running') actions.push('keep');
  // the totals count every turn: the stages and your own turns outside them (the agent panel, the Studio's asks)
  const chat = project?.chat || {};
  const total = {
    ms: ms + (chat.ms || 0), cost: round6(cost + (chat.cost || 0)),
    stages: { ms, cost: round6(cost) }, chat: { ms: chat.ms || 0, cost: round6(chat.cost || 0), turns: chat.turns || 0 },
  };
  const cur = st ? project.stages?.[st.id] || {} : {};
  return {
    at: project?.at || null, done: !!project?.done, halted: project?.halted || null, chips, total, actions,
    waiting: waitingFor(project, recipe, live),
    running: st && s === 'running'
      ? { stage: st.id, title: st.title || st.id, since: cur.started || null, msBefore: cur.ms || 0, round: cur.round || 0, asleep: live.asleep || null, fires: live.fires || [], stalled: live.stalled || null }
      : null,
    queued: st && cur.queued ? { stage: st.id, title: st.title || st.id, since: cur.queued.since, behind: cur.queued.behind || [], text: cur.note || queueNote(cur.queued.behind) } : null,
    keep: live.keep || null,
  };
}

// Is the project waiting for you, and for what? -> null | { for, stage, title, text, questions?, at?, kind? }
//   question  the agent asked with AskUserQuestion; its turn waits for the answer
//   answer    an agent stage ended its turn on a question (or without its files): answer in the agent panel, or Go
//   approve   a user stage (a review, a pick, record, upload, export) waits for your click
//   halt      the project is halted
export function waitingFor(project, recipe, live = {}) {
  const st = current(project, recipe);
  if (!st || project?.done) return null;
  const base = { stage: st.id, title: st.title || st.id };
  if (project.halted) return { for: 'halt', ...base, text: project.halted };
  if (live.question) {
    const qs = Array.isArray(live.question.questions) ? live.question.questions : [];
    const text = qs.map((q) => q?.question).filter(Boolean).join('\n') || live.question.text || 'The agent asks you something.';
    return { for: 'question', ...base, at: live.question.at || null, questions: qs, text };
  }
  const s = statusOf(project, st.id);
  if (s !== 'waiting') return null;
  if (isAgent(st.kind)) return { for: 'answer', ...base, text: project.stages[st.id]?.note || 'The agent is waiting for your answer.' };
  return { for: 'approve', ...base, kind: st.kind, text: `${st.title || st.id} is waiting for you.` };
}
