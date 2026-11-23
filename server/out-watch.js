// Live outputs: while a stage runs, the agent writes its files (events.json, proof.mp4, final.mp4 ...) with its own
// tools, so nothing told the windows until the stage ended. This polls the stat (size + mtime) of the project's
// video/out output files every ~2 s, and says { type: 'files', project, paths } for a file once it has stayed the same
// for two polls in a row (a render still being written must not be loaded half-done). fs.watchFile-style polling
// with fs.statSync, never fs.watch: on Windows a directory watcher holds the folder open and blocks moving it to the Bin.
// The decision (step) is pure and tested in out-watch.test.js; createOutWatch reads the disk and keeps the timer.
import fs from 'node:fs';
import path from 'node:path';

export const WATCHED = ['events.json', 'edl.json', 'rough-words.json', 'cuts.json', 'proof.mp4', 'proof-sheet.jpg', 'final.mp4', 'rough.mp4', 'visual-plan.md', 'review-items.json'];
export const POLL_MS = 2000, GRACE_MS = 10000, SETTLE = 2;

const keyOf = (s) => (s ? `${s.size}:${Math.round(s.mtimeMs)}` : '');

// pure: the state of the last polls and the stats now -> { state, ready: [names] }.
// state: { [name]: { key, same (polls in a row with this key), sent (the key already announced) } }
// stats: { [name]: { size, mtimeMs } | null }. The first poll only takes a baseline: what was there already is not news.
export function step(state, stats, { settle = SETTLE, first = false } = {}) {
  const next = {}, ready = [];
  for (const name of Object.keys(stats)) {
    const key = keyOf(stats[name]);
    const was = state?.[name];
    if (!key) { next[name] = { key: '', same: 0, sent: '' }; continue; }
    if (first && !was) { next[name] = { key, same: settle, sent: key }; continue; }
    const same = was && was.key === key ? was.same + 1 : 0;
    let sent = was?.sent || '';
    if (same >= settle && sent !== key && stats[name].size > 0) { ready.push(name); sent = key; }
    next[name] = { key, same, sent };
  }
  return { state: next, ready };
}

export function createOutWatch({ dirOf, broadcast, names = WATCHED, pollMs = POLL_MS, graceMs = GRACE_MS, settle = SETTLE, busy = () => false, log = () => {} }) {
  const jobs = new Map(); // project id -> { state, first, until, timer }
  const statAll = (id) => {
    const out = path.join(dirOf(id), 'video', 'out');
    const stats = {};
    for (const n of names) { try { const s = fs.statSync(path.join(out, n)); stats[n] = s.isFile() ? { size: s.size, mtimeMs: s.mtimeMs } : null; } catch { stats[n] = null; } }
    return stats;
  };
  function poll(id) {
    const j = jobs.get(id);
    if (!j) return;
    try {
      const r = step(j.state, statAll(id), { settle, first: j.first });
      j.state = r.state; j.first = false;
      if (r.ready.length) broadcast({ type: 'files', project: id, paths: r.ready.map((n) => `video/out/${n}`), live: true });
    } catch (e) { log('out watch', id, e.message); }
    if (j.until && busy(id)) j.until = Date.now() + graceMs; // another stage began meanwhile
    if (j.until && Date.now() >= j.until) { clearInterval(j.timer); jobs.delete(id); }
  }
  return {
    // a stage began: poll until stop()
    start(id) {
      const j = jobs.get(id);
      if (j) { j.until = 0; return; }
      const job = { state: {}, first: true, until: 0, timer: null };
      jobs.set(id, job);
      poll(id); // the baseline
      job.timer = setInterval(() => poll(id), pollMs);
      job.timer.unref?.();
    },
    // the stage ended: keep polling a little longer for what the last render finishes
    stop(id) { const j = jobs.get(id); if (j) j.until = Date.now() + graceMs; },
    running: (id) => jobs.has(id),
    dispose() { for (const j of jobs.values()) clearInterval(j.timer); jobs.clear(); },
  };
}
