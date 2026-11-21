#!/usr/bin/env node
// Find the top, typical and flop videos of a niche with yt-dlp (metadata only, nothing is downloaded but thumbnails).
// The Research page runs it through server/studio/research-run.js; the agent can run it as a command (skill research-titles).
//   node server/studio/research-fetch.js --project <folder> --query "phrase one" --query "phrase two" [--n 20]
//        [--channel @handle ...] [--when week|month|year] [--lang de] [--add "https://youtu.be/..,.."]
// Each run is kept as studio/research/runs/<id>.json and made the current one (studio/research/videos.json);
// thumbnails go to research/thumbs/<id>.jpg. Outlier score = the video's views / the median views of its
// channel's last 30 uploads. A run also takes a few typical and flop videos of those channels, marked by tier,
// so a comparison sees the whole niche and not only its hits.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromYtDlp, channelMedian, outlierScore, sampleChannel, thumbUrls } from './research.js';
import { cleanPhrases, cleanOptions, channelUrl, WHEN } from './research-plan.js';
import { saveRun } from './research-runs.js';
import { exists } from './files.js';

// how yt-dlp can be started, in the order tried; the Setup tab's check (server/doctor/checks.js) reads this list too
export const CANDIDATES = [['yt-dlp'], ['python', '-m', 'yt_dlp'], ['python3', '-m', 'yt_dlp'], ['py', '-m', 'yt_dlp'], ['uvx', 'yt-dlp']];

function run(cmd, args, timeoutMs = 180000) {
  return new Promise((resolve) => {
    let out = '', err = '';
    let child;
    try { child = spawn(cmd[0], [...cmd.slice(1), ...args], { windowsHide: true }); } catch (e) { resolve({ code: -1, out, err: e.message }); return; }
    const t = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: e.message }); });
    child.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
  });
}

let ytdlp = null;
async function findYtDlp() {
  if (ytdlp) return ytdlp;
  for (const c of CANDIDATES) { const r = await run(c, ['--version'], 60000); if (r.code === 0) return (ytdlp = c); }
  throw new Error('yt-dlp was not found. Install it (uv tool install yt-dlp, or pip install yt-dlp) and try again.');
}

async function ytJson(args, language) {
  const lang = language ? ['--extractor-args', `youtube:lang=${language}`] : [];
  const r = await run(await findYtDlp(), ['-J', '--no-warnings', '--ignore-errors', ...lang, ...args]);
  if (!r.out.trim()) throw new Error(`yt-dlp failed: ${r.err.trim().split('\n').slice(-2).join(' ')}`);
  return JSON.parse(r.out);
}

// a channel's last 30 uploads (shorts left out): their views give its usual, the records give typical and flop samples
async function channelUploads(url, language) {
  const j = await ytJson(['--flat-playlist', '--playlist-end', '30', url], language);
  const entries = (j.entries || []).map((e) => fromYtDlp({ channel: j.channel, channel_id: j.channel_id, ...e }, 'sample')).filter(Boolean).filter((v) => !(v.duration > 0 && v.duration < 70));
  return { entries, views: (j.entries || []).map((e) => Number(e.view_count)).filter(Number.isFinite), subscribers: Number(j.channel_follower_count) || undefined, channelId: j.channel_id };
}

async function download(url, file) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return false;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 2000) return false; // YouTube's grey placeholder for a missing size
    await fs.writeFile(file, buf);
    return true;
  } catch { return false; }
}

// the search of a phrase: YouTube's own search, with its upload-date filter when one is chosen
const searchTarget = (phrase, when, n) => (WHEN[when]?.sp
  ? { url: `https://www.youtube.com/results?search_query=${encodeURIComponent(phrase)}&sp=${WHEN[when].sp}`, args: ['--playlist-end', String(n)] }
  : { url: `ytsearch${n}:${phrase}`, args: [] });

// Run a research: every phrase, the competitor channels, each channel's usual, typical and flop samples, thumbnails.
// onProgress({ phase, done, total, videos, text }) tells how far it is; stop() returning true ends it early with what it has.
export async function collect({ dir, phrases = [], add = '', options = {}, onProgress = () => {}, stop = () => false, log = () => {} }) {
  const o = cleanOptions(options);
  const list = cleanPhrases(phrases);
  const L = o.language;
  await fs.mkdir(path.join(dir, 'thumbs'), { recursive: true });
  const found = new Map();
  const put = (v) => { if (v && !found.has(v.id)) found.set(v.id, v); };
  const tell = (phase, done, total, text) => onProgress({ phase, done, total, videos: found.size, text });
  const failed = [];

  for (let i = 0; i < list.length && !stop(); i++) {
    tell('search', i, list.length, `Searching “${list[i]}” (${i + 1} of ${list.length})`);
    try {
      const t = searchTarget(list[i], o.when, o.n);
      const j = await ytJson(['--flat-playlist', ...t.args, t.url], L);
      for (const e of j.entries || []) { const v = fromYtDlp(e, 'search'); if (v && !(v.duration > 0 && v.duration < 70)) put(v); }
    } catch (e) { failed.push(`“${list[i]}”: ${e.message}`); log(e.message); }
    tell('search', i + 1, list.length, `Searched ${i + 1} of ${list.length} phrase${list.length === 1 ? '' : 's'}`);
  }
  for (const url of String(add || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    try { put(fromYtDlp(await ytJson(['--skip-download', url], L), 'added')); } catch (e) { failed.push(`${url}: ${e.message}`); }
  }

  // competitor channels first, then the most viewed channels of the search: each gives its usual and a sample
  const competitors = o.channels.map(channelUrl).filter(Boolean);
  const byViews = [...found.values()].sort((a, b) => (b.views || 0) - (a.views || 0));
  const fromSearch = [...new Set(byViews.map((v) => v.channelId).filter(Boolean))].slice(0, 10).map((id) => `https://www.youtube.com/channel/${id}/videos`);
  const targets = [...new Set([...competitors, ...fromSearch])];
  const usual = new Map();
  for (let i = 0; i < targets.length && !stop(); i++) {
    tell('channels', i, targets.length, `Checking channel ${i + 1} of ${targets.length}`);
    try {
      const c = await channelUploads(targets[i], L);
      if (c.channelId) usual.set(c.channelId, c);
      const mine = competitors.includes(targets[i]);
      for (const v of sampleChannel(c.entries, mine ? { top: 6, typical: 3, flop: 3 } : { top: 0, typical: 2, flop: 2 })) put({ ...v, source: mine ? 'channel' : 'sample' });
    } catch (e) { failed.push(`${targets[i]}: ${e.message}`); log(e.message); }
    tell('channels', i + 1, targets.length, `Checked ${i + 1} of ${targets.length} channels`);
  }
  for (const v of found.values()) {
    const c = usual.get(v.channelId);
    if (!c) continue;
    if (v.outlier === undefined) { const m = channelMedian(c.views, v.views); if (m !== undefined) { v.channelMedian = Math.round(m); v.outlier = outlierScore(v.views, m); } }
    if (c.subscribers) v.subscribers = c.subscribers;
  }

  const all = [...found.values()];
  for (let i = 0; i < all.length; i++) {
    const v = all[i];
    if (i % 4 === 0) tell('pictures', i, all.length, `Saving pictures (${i} of ${all.length})`);
    const rel = path.posix.join('research', 'thumbs', `${v.id}.jpg`);
    const abs = path.join(dir, 'thumbs', `${v.id}.jpg`);
    if (await exists(abs)) { v.thumb = rel; continue; }
    for (const u of thumbUrls(v.id)) if (await download(u, abs)) { v.thumb = rel; break; }
  }
  return { videos: all, phrases: list, options: o, failed, stopped: stop() };
}

// the agent's way in: the same run, kept as a run of its own and made the current one
export async function research({ project, query, add, n = 20, channel, when, lang, log = console.log }) {
  const phrases = [].concat(query && query !== true ? query : []);
  const proj = path.resolve(project);
  const t0 = Date.now();
  const r = await collect({ dir: path.join(proj, 'studio', 'research'), phrases, add, options: { n, channels: [].concat(channel || []), when, language: lang }, log, onProgress: (p) => log(p.text) });
  if (!r.videos.length) throw new Error(`nothing found${r.failed.length ? `: ${r.failed[0]}` : ''}`);
  const saved = await saveRun(proj, { phrases: r.phrases, options: r.options, by: 'agent', ms: Date.now() - t0, cost: null, videos: r.videos }, { replace: r.phrases.length > 0 });
  log(`${saved.count} videos kept as run ${saved.id}, now the current one (studio/research/videos.json)`);
  return saved;
}

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2), v = argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[++i];
    o[k] = k === 'query' || k === 'channel' ? [...(o[k] || []), v] : v;
  }
  return o;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = args(process.argv.slice(2));
  if (!a.project || (!a.query && !a.add)) { console.error('Use: --project <folder> --query "<words>" [--query "<more>"] [--n 20] [--channel @handle] [--when week|month|year] [--lang de] | --add <url,url>'); process.exit(1); }
  research(a).catch((e) => { console.error(e.message); process.exit(1); });
}
