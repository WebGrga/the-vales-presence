#!/usr/bin/env node
// Find the top and outlier videos of a niche with yt-dlp (metadata only, nothing is downloaded but thumbnails).
// The agent runs this at the research stage (craft/skills/research-titles).
//   node server/studio/research-fetch.js --project <project folder> --query "claude code agents" [--n 20] [--channels 8]
//   node server/studio/research-fetch.js --project <dir> --add "https://www.youtube.com/watch?v=...,https://youtu.be/..."
// Writes <project>/studio/research/videos.json (merged with what is there) and research/thumbs/<id>.jpg.
// Outlier score = the video's views / the median views of its channel's last 30 uploads.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromYtDlp, channelMedian, outlierScore, mergeVideos, parseVideos, thumbUrls } from './research.js';
import { readJson, writeJson, exists } from './files.js';

const CANDIDATES = [['yt-dlp'], ['python', '-m', 'yt_dlp'], ['python3', '-m', 'yt_dlp'], ['py', '-m', 'yt_dlp'], ['uvx', 'yt-dlp']];

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

async function ytJson(args) {
  const r = await run(await findYtDlp(), ['-J', '--no-warnings', '--ignore-errors', ...args]);
  if (!r.out.trim()) throw new Error(`yt-dlp failed: ${r.err.trim().split('\n').slice(-2).join(' ')}`);
  return JSON.parse(r.out);
}

async function channelViews(channelId) {
  const j = await ytJson(['--flat-playlist', '--playlist-end', '30', `https://www.youtube.com/channel/${channelId}/videos`]);
  return { views: (j.entries || []).map((e) => Number(e.view_count)).filter(Number.isFinite), subscribers: Number(j.channel_follower_count) || undefined };
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

function args(argv) {
  const o = { n: 20, channels: 8 };
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i];
  return o;
}

export async function research({ project, query, add, n = 20, channels = 8, log = console.log }) {
  const dir = path.join(path.resolve(project), 'studio', 'research');
  await fs.mkdir(path.join(dir, 'thumbs'), { recursive: true });
  const file = path.join(dir, 'videos.json');
  const prev = await readJson(file, {});
  let found = [];
  if (query) {
    log(`searching "${query}" (${n} results)`);
    const j = await ytJson(['--flat-playlist', `ytsearch${Number(n) || 20}:${query}`]);
    found = (j.entries || []).map((e) => fromYtDlp(e, 'search')).filter(Boolean).filter((v) => !(v.duration > 0 && v.duration < 70));
  }
  for (const url of String(add || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    log(`adding ${url}`);
    try { const v = fromYtDlp(await ytJson(['--skip-download', url]), 'added'); if (v) found.push(v); } catch (e) { log(`  skipped: ${e.message}`); }
  }
  // channel medians for the most viewed channels first
  const ids = [...new Set(found.sort((a, b) => (b.views || 0) - (a.views || 0)).map((v) => v.channelId).filter(Boolean))].slice(0, Number(channels) || 8);
  const medians = new Map();
  for (const id of ids) {
    try { const c = await channelViews(id); medians.set(id, c); log(`channel ${id}: ${c.views.length} uploads`); } catch (e) { log(`channel ${id}: ${e.message}`); }
  }
  for (const v of found) {
    const c = medians.get(v.channelId);
    if (!c) continue;
    const m = channelMedian(c.views, v.views);
    if (m !== undefined) { v.channelMedian = Math.round(m); v.outlier = outlierScore(v.views, m); }
    if (c.subscribers) v.subscribers = c.subscribers;
  }
  for (const v of found) {
    const rel = path.posix.join('research', 'thumbs', `${v.id}.jpg`);
    const abs = path.join(dir, 'thumbs', `${v.id}.jpg`);
    if (await exists(abs)) { v.thumb = rel; continue; }
    for (const u of thumbUrls(v.id)) if (await download(u, abs)) { v.thumb = rel; break; }
  }
  const videos = mergeVideos(parseVideos(prev).videos, found);
  const doc = { ...(prev && typeof prev === 'object' ? prev : {}), query: query || prev?.query || '', fetched: new Date().toISOString(), videos: parseVideos({ videos }).videos };
  await writeJson(file, doc);
  log(`${doc.videos.length} videos in ${path.relative(process.cwd(), file) || file}; top outliers: ${doc.videos.slice(0, 3).map((v) => `${v.outlier ?? '?'}x ${v.title}`).join(' | ')}`);
  return doc;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = args(process.argv.slice(2));
  if (!a.project || (!a.query && !a.add)) { console.error('Use: --project <folder> --query "<words>" [--n 20] [--channels 8] | --add <url,url>'); process.exit(1); }
  research(a).catch((e) => { console.error(e.message); process.exit(1); });
}
