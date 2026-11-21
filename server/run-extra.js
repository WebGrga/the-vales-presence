// What the runner offers beyond Go and Approve (the pieces of run.js that are about you watching it): the notification a
// stage's end or a limit sends to every window, the day's and month's spend limits, "Stop after this stage", the queue
// across projects, and what Go will do before it does it. Decisions are pure elsewhere (spend.js, queue-view.js, stages.js).
import * as St from './stages.js';
import { stageStats } from './recipe-card.js';
import { summarise, over, warnText } from './spend.js';

export function createExtras(ctx, { P, load, L, craft, queue, stopAfter, warned, limit, readSettings }) {
  // a stage ended or needs you: every window may tell its user (web/shell/notify.js decides how)
  function notify(id, kind, st, text) {
    let title = id; try { title = P().get(id)?.title || id; } catch {}
    ctx.broadcast({ type: 'notify', project: id, projectTitle: title, kind, stage: st?.id, stageTitle: st?.title || st?.id, text });
  }

  // the daily and monthly limits (settings warnDay, warnMonth), told once per day / month
  function summary() {
    const entries = [];
    for (const p of P().list()) for (const e of P().readLog(p.id, 5000)) entries.push({ ...e, project: p.id });
    return summarise(entries);
  }
  function checkSpend() {
    try {
      const cfg = readSettings();
      if (!(cfg.warnDay > 0) && !(cfg.warnMonth > 0)) return;
      const sum = summary();
      for (const o of over(sum, cfg)) {
        const key = `${o.per}:${o.per === 'day' ? sum.days[0].day : sum.months[0].month}:${o.limit}`;
        if (warned.has(key)) continue;
        warned.add(key);
        const text = warnText(o, sum.plan);
        ctx.broadcast({ type: 'toast', text, kind: 'warn' });
        ctx.broadcast({ type: 'notify', kind: 'spend', text });
      }
    } catch (e) { ctx.log?.('spend check', e.message); }
  }

  // "Stop after this stage": the running stage finishes, and the next one waits for Go
  function setStopAfter(id, on) {
    if (on && !ctx.agent?.isBusy(id)) return { error: 'the agent is not working on a stage right now' };
    const { p, r } = load(id);
    const st = St.current(p, r);
    if (on && !(st && St.statusOf(p, st.id) === 'running')) return { error: 'no stage is running here' };
    if (on) stopAfter.add(id); else stopAfter.delete(id);
    L.changed(id);
    return { ok: true, stopAfter: stopAfter.has(id) };
  }

  // every project's place in the work, for the queue view
  function overview() {
    const rows = [];
    for (const p0 of P().list()) {
      try {
        const { p, r } = load(p0.id);
        const st = St.current(p, r);
        if (!st || p.done) continue;
        const live = ctx.agent?.live?.(p.id) || {};
        const pos = queue.indexOf(p.id) + 1;
        const stageRuns = St.statusOf(p, st.id) === 'running';
        const burning = (live.fires || []).length > 0 || !!live.asleep;
        const busy = !!ctx.agent?.isBusy?.(p.id) || burning;
        rows.push({ id: p.id, title: p.title || p.id, stage: st.id, stageTitle: busy && !stageRuns ? (burning ? 'A background task' : 'A chat turn') : (st.title || st.id), status: St.statusOf(p, st.id), busy,
          heavy: !!st.heavy, since: p.stages?.[st.id]?.started || null, asking: !!live.question, position: pos, behind: pos ? L.behind(p.id).map((b) => `${b.title}${b.stageTitle ? ` (${b.stageTitle})` : ''}`) : [],
          halted: !!p.halted, stopAfter: stopAfter.has(p.id) });
      } catch {}
    }
    return { rows, limit: limit() };
  }

  // what Go will do, before it does it: the stage, how many skills it reads, the usual time from past runs
  function goInfo(id) {
    const { p, r } = load(id);
    const st = St.current(p, r);
    if (!st || p.done || !St.isAgent(st.kind)) return null;
    const { skills, missing } = craft.skillsFor(r.id, st.id, p.skillSet);
    const stats = stageStats(P().list());
    const m = stats[`${r.id}/${st.id}`] || stats[st.id] || null;
    return { stage: st.id, title: st.title || st.id, skills: skills.length, names: skills.map((x) => x.name || x), missing: missing || [], heavy: !!st.heavy, usualMs: m ? Math.round(m.ms) : null, usualCost: m ? m.cost : null, runs: m?.n || 0 };
  }

  return { notify, summary, checkSpend, setStopAfter, overview, goInfo };
}
