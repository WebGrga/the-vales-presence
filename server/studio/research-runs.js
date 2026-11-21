// Research runs of one project, kept so no search overwrites another.
//   studio/research/runs/<id>.json   one run: { id, at, phrases, options, by, ms, cost, videos }
//   studio/research/state.json       { current: [run ids] }: the runs the other Studio pages read, merged
//   studio/research/marks.json       { starred: [ids], hidden: [ids] }: the user's marks, valid across runs
//   studio/research/videos.json      the current runs merged with the marks: the file the agent and the other pages read
// A project whose videos.json came before runs shows it as the first run ("first") without being touched;
// the first change of any kind keeps it as runs/first.json.
import fs from 'node:fs/promises';
import path from 'node:path';
import { readJson, writeJson, mtimeMs } from './files.js';
import { parseVideos, mergeVideos, patterns } from './research.js';
import { readTopic, proposePhrases } from './research-plan.js';

const RESEARCH = (dir) => path.join(dir, 'studio', 'research');
const RUNS = (dir) => path.join(RESEARCH(dir), 'runs');
const VIDEOS = (dir) => path.join(RESEARCH(dir), 'videos.json');
const STATE = (dir) => path.join(RESEARCH(dir), 'state.json');
const MARKS = (dir) => path.join(RESEARCH(dir), 'marks.json');
const RUN_ID = /^[\w-]{1,40}$/;
const OWN = new Set(['videos', 'models', 'runs', 'query', 'fetched']);

const ids = (xs) => [...new Set((Array.isArray(xs) ? xs : []).filter((x) => typeof x === 'string' && x))];

async function runFiles(dir) {
  try { return (await fs.readdir(RUNS(dir))).filter((f) => f.endsWith('.json') && RUN_ID.test(f.slice(0, -5))).map((f) => f.slice(0, -5)); } catch { return []; }
}

// the run that videos.json was before runs existed (null when there is none)
async function legacyRun(dir) {
  const doc = await readJson(VIDEOS(dir), null);
  const p = parseVideos(doc);
  if (!p.videos.length) return null;
  const at = p.fetched || new Date(await mtimeMs(VIDEOS(dir))).toISOString();
  const phrases = p.query ? p.query.split(/\s*[·|]\s*/).filter(Boolean) : [];
  return { id: 'first', at, phrases, options: {}, by: 'agent', ms: null, cost: null, videos: p.videos, legacy: true };
}

export async function loadRun(dir, id) {
  if (!RUN_ID.test(String(id))) return null;
  const r = await readJson(path.join(RUNS(dir), `${id}.json`), null);
  if (r && Array.isArray(r.videos)) return { ...r, id };
  if (id === 'first' && !(await runFiles(dir)).length) return legacyRun(dir);
  return null;
}

const summary = (r) => ({ id: r.id, at: r.at, phrases: r.phrases || [], options: r.options || {}, by: r.by || 'page', ms: r.ms ?? null, cost: r.cost ?? null, count: r.videos.length, partial: !!r.partial, legacy: !!r.legacy });

export async function listRuns(dir) {
  const files = await runFiles(dir);
  const runs = (await Promise.all(files.map((id) => loadRun(dir, id)))).filter(Boolean);
  if (!runs.length) { const l = await legacyRun(dir); if (l) runs.push(l); }
  return runs.sort((a, b) => String(a.at).localeCompare(String(b.at)) || a.id.localeCompare(b.id));
}

export async function readMarks(dir) {
  const m = await readJson(MARKS(dir), {});
  return { starred: ids(m?.starred), hidden: ids(m?.hidden) };
}

// which runs are current: the saved choice, else the newest one
export function pickCurrent(runs, saved) {
  const have = new Set(runs.map((r) => r.id));
  const keep = ids(saved).filter((i) => have.has(i));
  return keep.length ? keep : runs.length ? [runs[runs.length - 1].id] : [];
}

// the current runs merged (a later run's numbers win), with the user's marks and per-video notes laid over
export function mergeRuns(runs, current, marks, prevNotes = {}) {
  const chosen = current.map((i) => runs.find((r) => r.id === i)).filter(Boolean).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  let videos = [];
  for (const r of chosen) videos = mergeVideos(videos, r.videos);
  const star = new Set(marks.starred), hide = new Set(marks.hidden);
  // a model stays a model whichever run is current: starred videos of the other runs come along
  const have = new Set(videos.map((v) => v.id));
  const others = runs.filter((r) => !current.includes(r.id)).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  let rest = [];
  for (const r of others) rest = mergeVideos(rest, r.videos.filter((v) => star.has(v.id) && !have.has(v.id)));
  videos = [...videos, ...rest];
  videos = videos.map((v) => {
    const o = { ...v };
    delete o.starred; delete o.hidden;
    if (star.has(v.id)) o.starred = true;
    if (hide.has(v.id)) o.hidden = true;
    if (!o.note && prevNotes[v.id]) o.note = prevNotes[v.id];
    return o;
  });
  return { videos, chosen };
}

const notesOf = (doc) => Object.fromEntries((Array.isArray(doc?.videos) ? doc.videos : []).filter((v) => v?.id && v.note).map((v) => [v.id, v.note]));

// write videos.json from the current runs and the marks; what the agent added at the top (notes, thumbs) stays
export async function rebuild(dir) {
  const runs = await listRuns(dir);
  const state = await readJson(STATE(dir), {});
  const current = pickCurrent(runs, state?.current);
  const prev = (await readJson(VIDEOS(dir), null)) || {};
  const { videos, chosen } = mergeRuns(runs, current, await readMarks(dir), notesOf(prev));
  const extras = Object.fromEntries(Object.entries(prev && typeof prev === 'object' && !Array.isArray(prev) ? prev : {}).filter(([k]) => !OWN.has(k)));
  const list = parseVideos({ videos }).videos;
  const models = list.filter((v) => v.starred && !v.hidden).map((v) => ({ id: v.id, title: v.title, channel: v.channel, url: v.url, views: v.views, outlier: v.outlier, thumb: v.thumb }));
  const phrases = [...new Set(chosen.flatMap((r) => r.phrases || []))];
  const doc = { ...extras, query: phrases.join(' · '), fetched: chosen.length ? chosen[chosen.length - 1].at : '', runs: current, models, videos: list };
  await writeJson(VIDEOS(dir), doc);
  return doc;
}

// before the first change: keep the old videos.json as the first run
async function adoptLegacy(dir) {
  if ((await runFiles(dir)).length) return;
  const l = await legacyRun(dir);
  if (!l) return;
  const { legacy, ...rest } = l;
  await writeJson(path.join(RUNS(dir), 'first.json'), rest);
  await writeJson(STATE(dir), { current: ['first'] });
}

// keep a finished run; replace = it becomes the current one alone, else it joins the current ones
export async function saveRun(dir, run, { replace = true } = {}) {
  await adoptLegacy(dir);
  const at = run.at || new Date().toISOString();
  const base = at.replace(/\D/g, '').slice(0, 14);
  const have = new Set(await runFiles(dir));
  let id = `r${base}`, n = 1;
  while (have.has(id)) id = `r${base}-${++n}`;
  const r = { id, at, phrases: run.phrases || [], options: run.options || {}, by: run.by || 'page', ms: run.ms ?? null, cost: run.cost ?? null, ...(run.partial ? { partial: true } : {}), videos: parseVideos({ videos: run.videos }).videos };
  await writeJson(path.join(RUNS(dir), `${id}.json`), r);
  const runs = await listRuns(dir);
  const state = await readJson(STATE(dir), {});
  const cur = replace ? [id] : [...pickCurrent(runs.filter((x) => x.id !== id), state?.current), id];
  await writeJson(STATE(dir), { current: cur });
  await rebuild(dir);
  return summary(r);
}

// switch to one run or merge several: ids of existing runs
export async function setCurrent(dir, want) {
  await adoptLegacy(dir);
  const have = new Set((await listRuns(dir)).map((r) => r.id));
  const cur = ids(want).filter((i) => have.has(i));
  if (!cur.length) throw Object.assign(new Error('Pick at least one run.'), { status: 400 });
  await writeJson(STATE(dir), { current: cur });
  await rebuild(dir);
  return cur;
}

// star or hide: { starred?, hidden? } as booleans for one video id
export async function setMark(dir, id, patch) {
  if (typeof id !== 'string' || !id || id.length > 60) throw Object.assign(new Error('Which video?'), { status: 400 });
  await adoptLegacy(dir);
  const m = await readMarks(dir);
  const flip = (list, on) => (on === undefined ? list : on ? [...new Set([...list, id])] : list.filter((x) => x !== id));
  const next = { starred: flip(m.starred, patch.starred), hidden: flip(m.hidden, patch.hidden) };
  if (patch.hidden === true) next.starred = next.starred.filter((x) => x !== id); // a hidden video is not a model
  await writeJson(MARKS(dir), next);
  await rebuild(dir);
  return next;
}

// what the page asks before anything has run: the topic and the phrases proposed for it
async function readPlan(dir) {
  const t = await readTopic(dir);
  return { ...t, phrases: proposePhrases(t.topic) };
}

// everything the Research page shows
export async function readResearch(dir) {
  const runs = await listRuns(dir);
  const state = await readJson(STATE(dir), {});
  const current = pickCurrent(runs, state?.current);
  const marks = await readMarks(dir);
  const doc = (await readJson(VIDEOS(dir), null)) || {};
  const cur = mergeRuns(runs, current, marks, notesOf(doc));
  // the runs give the videos; the file gives what the agent put there by hand (notes, the thumbs brief)
  const parsed = parseVideos({ ...doc, videos: runs.length ? cur.videos : doc.videos });
  const visible = parsed.videos.filter((v) => !v.hidden);
  const last = cur.chosen[cur.chosen.length - 1];
  return {
    ...parsed, videos: visible, hiddenVideos: parsed.videos.filter((v) => v.hidden), patterns: patterns(visible),
    runs: runs.map(summary), current, lastRun: last ? summary(last) : null,
    plan: await readPlan(dir),
  };
}
