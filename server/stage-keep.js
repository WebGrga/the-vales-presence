// "Go on with what exists" (pure): after Stop, or a stage that failed, the work already on disk is often fine (the
// final of the round before a send-back, a rough whose report never came). This goes on from it without running the
// stage again, so it costs nothing. Tested in stage-keep.test.js.
//
//   back  the stage was sent back and its files are as they were then: back to the stage you sent it back from, as it
//         was (the send-back is dropped, with its notes kept in the log)
//   done  its files are there (newer, or no send-back to go back to): the stage counts as done and the next one is current
import { current, statusOf, isAgent, advance, indexOf } from './stages.js';

const clone = (x) => JSON.parse(JSON.stringify(x));

// pure: which `out` files changed since a time. mtimeOf(rel) -> ms or null
export function changedSince(out, mtimeOf, since) {
  if (!since) return [];
  return (out || []).filter((rel) => { const t = mtimeOf(rel); return t != null && t > since; });
}

// When does it apply? f: { ready (every `out` file exists), changed ([out files changed since the send-back]), busy }
// -> null | { mode: 'back' | 'done', stage, title, to, toTitle, text }
export function keepOption(project, recipe, f = {}) {
  const st = current(project, recipe);
  if (!st || project?.done || project?.halted || f.busy) return null;
  if (!isAgent(st.kind) || !(st.out || []).length) return null;
  const s = project.stages?.[st.id] || {};
  if (!['todo', 'waiting'].includes(statusOf(project, st.id)) || s.queued) return null;
  if (!f.ready) return null;
  const title = st.title || st.id;
  const b = project.backFrom;
  if (b && b.target === st.id && indexOf(recipe, b.from) > indexOf(recipe, st.id) && !(f.changed || []).length) {
    const to = recipe.stages[indexOf(recipe, b.from)];
    return { mode: 'back', stage: st.id, title, to: to.id, toTitle: to.title || to.id,
      text: `Back to ${to.title || to.id} with what you had before the send-back: ${title} does not run again.` };
  }
  // a stage that never ran has nothing of its own to keep
  if (!(s.round > 0)) return null;
  const next = recipe.stages[indexOf(recipe, st.id) + 1];
  return { mode: 'done', stage: st.id, title, to: next?.id || null, toTitle: next ? next.title || next.id : null,
    text: `${title}: its files are there, so it counts as done${next ? ` and ${next.title || next.id} comes next` : ''}. Nothing runs again for it.` };
}

// Do it. -> { project, mode, relock (the locks dropped by the send-back, to put back), unarchive ([{ from, to }]) } | { error }
export function keepExisting(project, recipe, f = {}, now = Date.now()) {
  const k = keepOption(project, recipe, f);
  if (!k) return { error: 'There is nothing to go on with here: the stage has no finished files, or it is running.' };
  let p = clone(project);
  if (k.mode === 'back') {
    const b = p.backFrom;
    for (const [id, was] of Object.entries(b.stages || {})) {
      const cost = p.stages[id]?.cost || 0, ms = p.stages[id]?.ms || 0, round = p.stages[id]?.round;
      // the stopped round's time and cost still count
      p.stages[id] = { ...was, ms: Math.max(ms, was.ms || 0), cost: Math.max(cost, was.cost || 0), ...(round != null ? { round } : {}) };
      delete p.stages[id].hold; delete p.stages[id].queued;
    }
    p.stages[k.stage].note = `Kept what was there: the send-back was not run (${new Date(now).toISOString().slice(0, 16).replace('T', ' ')}).`;
    p.at = k.to;
    const relock = b.locks || null, unarchive = b.archived || [];
    delete p.backFrom;
    return { project: p, mode: 'back', relock, unarchive, keep: k };
  }
  const s = p.stages[k.stage];
  delete s.hold; delete s.queued;
  s.note = 'Kept what was there: its files were already made.';
  p = advance(p, recipe, now);
  delete p.backFrom;
  return { project: p, mode: 'done', relock: null, unarchive: [], keep: k };
}

// A project sent back before send-backs were recorded (no backFrom): the same record from its log, when the log's last
// send-back went to the stage it stands on and every stage between ran before. -> the project with backFrom, or itself
export function withBackFrom(project, recipe, log = []) {
  const st = current(project, recipe);
  if (!st || project.backFrom || !project.stages?.[st.id]?.sentBack) return project;
  const e = [...(log || [])].reverse().find((x) => x?.status === 'sent back');
  if (!e || e.to !== st.id) return project;
  const a = indexOf(recipe, st.id), b = indexOf(recipe, e.stage);
  if (a < 0 || b <= a) return project;
  const stages = {};
  for (let k = a; k <= b; k++) {
    const s = recipe.stages[k], cur = project.stages[s.id] || {};
    if (k < b && isAgent(s.kind) && !(cur.round > 0)) return project; // a stage between never ran: nothing to go back to
    stages[s.id] = { ...cur, status: k === b ? 'waiting' : 'done' };
    delete stages[s.id].note; delete stages[s.id].hold;
  }
  return { ...project, backFrom: { from: e.stage, target: st.id, at: project.stages[st.id].sentBack, stages, fromLog: true } };
}
