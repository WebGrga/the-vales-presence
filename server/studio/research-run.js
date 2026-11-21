// A research run started from the Research page: it runs the fetch directly (yt-dlp, no agent, so it costs
// nothing), tells how far it is, and keeps the result as a run. One run per project at a time.
// The agent's notes and thumbnail brief are a separate step the user asks for afterwards.
import path from 'node:path';
import { collect } from './research-fetch.js';
import { saveRun } from './research-runs.js';
import { cleanPhrases, cleanOptions } from './research-plan.js';

const jobs = new Map(); // project id -> the state of its latest run: { running, text, phase, done, total, videos, ms, run, error }

export const status = (id) => jobs.get(id) || { running: false };

export function start({ id, dir, phrases, options, add = '' }) {
  if (jobs.get(id)?.running) throw Object.assign(new Error('A search is already running.'), { status: 409 });
  const list = cleanPhrases(phrases), o = cleanOptions(options);
  if (!list.length && !o.channels.length && !add) throw Object.assign(new Error('Write at least one search phrase.'), { status: 400 });
  const t0 = Date.now();
  const st = { running: true, stopping: false, phase: 'search', text: 'Starting…', done: 0, total: list.length, videos: 0, startedAt: t0, phrases: list };
  jobs.set(id, st);
  const stop = () => st.stopping;
  collect({ dir: path.join(dir, 'studio', 'research'), phrases: list, add, options: o, stop, onProgress: (p) => Object.assign(st, p, { ms: Date.now() - t0 }) })
    .then(async (r) => {
      if (!r.videos.length) throw new Error(r.failed[0] ? `Nothing found. ${r.failed[0]}` : 'Nothing found for these phrases.');
      st.text = 'Saving the run…';
      const ms = Date.now() - t0;
      st.run = await saveRun(dir, { phrases: r.phrases, options: r.options, by: 'page', ms, cost: 0, partial: r.stopped, videos: r.videos });
      st.failed = r.failed;
      st.text = `Found ${r.videos.length} videos`;
    })
    .catch((e) => { st.error = e.message || String(e); st.text = st.error; })
    .finally(() => { st.running = false; st.ms = Date.now() - t0; });
  return st;
}

export function stopRun(id) {
  const st = jobs.get(id);
  if (!st?.running) return false;
  st.stopping = true; st.text = 'Stopping…';
  return true;
}
