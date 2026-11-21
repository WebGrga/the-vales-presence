// The runner's live side: what the stage view needs beyond project.json (a question waiting, a sleeping stage, the
// background tasks, the quiet guard, "go on with what exists"), the heavy-stage line, and the throttled { type: 'live' }
// broadcast. The decisions are pure (stage-view.js, stage-keep.js, stages.js queue); this reads the disk and the agent.
import fs from 'node:fs';
import path from 'node:path';
import * as St from './stages.js';
import { keepOption, changedSince, withBackFrom } from './stage-keep.js';

const fileOf = (dir, rel) => path.join(dir, ...String(rel).replace(/\/+$/, '').split('/'));

// a stage's `out` files on disk: { ready (all there), changed (changed since `since`) }
export function outState(dir, st, since = 0) {
  const outs = st?.out || [];
  const exists = (rel) => {
    try { const s = fs.statSync(fileOf(dir, rel)); return rel.endsWith('/') ? s.isDirectory() && fs.readdirSync(fileOf(dir, rel)).length > 0 : true; } catch { return false; }
  };
  const mtimeOf = (rel) => { try { return fs.statSync(fileOf(dir, rel)).mtimeMs; } catch { return null; } };
  return { ready: outs.length > 0 && outs.every(exists), changed: changedSince(outs.filter((r) => !r.endsWith('/')), mtimeOf, since) };
}

// the project with its send-back record (from the log for a project sent back before it was kept)
export function withBack(ctx, id, p, r) {
  if (p.backFrom || !p.stages?.[p.at]?.sentBack) return p;
  try { return withBackFrom(p, r, ctx.projects?.readLog?.(id, 300) || []); } catch { return p; }
}

export function createLive(ctx, { load, heavyRunning, queue, stopAfter = new Set() }) {
  // the live part of one project's view
  function liveOf(id, p, r, dir) {
    const a = ctx.agent?.live?.(id) || {};
    const st = St.current(p, r);
    const busy = !!ctx.agent?.isBusy?.(id);
    let keep = null;
    if (st && St.isAgent(st.kind) && st.out?.length && !busy) {
      p = withBack(ctx, id, p, r);
      const since = p.backFrom?.target === st.id ? p.backFrom.at : 0;
      keep = keepOption(p, r, { ...outState(dir, st, since), busy });
    }
    return { question: a.question || null, asleep: a.asleep || null, fires: a.fires || [], stalled: a.stalled || null, keep };
  }
  function view(id) {
    const { p, r, dir } = load(id);
    return { ...St.view(p, r, liveOf(id, p, r, dir)), stopAfter: stopAfter.has(id) };
  }

  // what a queued project waits behind: the heavy stages running, then the projects ahead of it in line
  function behind(id) {
    const info = (pid) => {
      try { const { p, r } = load(pid); const st = St.current(p, r); return { project: pid, title: p.title || pid, stage: st?.id || null, stageTitle: st?.title || st?.id || null }; }
      catch { return { project: pid, title: pid }; }
    };
    const ahead = queue.indexOf(id) < 0 ? queue : queue.slice(0, queue.indexOf(id));
    return [...heavyRunning].filter((x) => x !== id).map(info).concat(ahead.filter((x) => x !== id).map(info));
  }

  // { type: 'live', project, view } at most every 250 ms per project
  const timers = new Map();
  function changed(id) {
    if (!id || timers.has(id)) return;
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      try { ctx.broadcast({ type: 'live', project: id, view: view(id) }); } catch {}
    }, 250));
  }
  return { liveOf, view, behind, changed };
}
