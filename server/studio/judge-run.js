// The Judge button on the Feed page: draw the numbered feed (our options among the real winners, light page, 168 px,
// no counts), send it to three fresh judges (one model call each, they see only the picture), pool their scores and
// keep the result in studio/judge.json. Nothing here touches your files but studio/judge/ and studio/judge.json.
// The pure parts (which tiles, reading a reply, the bar) are in judge-plan.js.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { studioPath, readJson, writeJson } from './files.js';
import { parseVideos } from './research.js';
import { realWinners, buildTiles, parseReply, pool, judgePrompt, JUDGES } from './judge-plan.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const JUDGE_FILE = (dir) => path.join(dir, 'studio', 'judge.json');
const MODEL = 'claude-sonnet-5-5';
const AUDIENCE = 'a person who watches videos on this topic and has never seen this channel';

export async function readJudge(dir) { return readJson(JUDGE_FILE(dir), null); }

function runPython(args) {
  const tries = process.platform === 'win32' ? [['python', []], ['py', ['-3']]] : [['python3', []], ['python', []]];
  return new Promise((resolve, reject) => {
    const next = (i, last) => {
      if (i >= tries.length) return reject(new Error('The judge picture needs Python with Pillow (see Setup). ' + (last || '')));
      execFile(tries[i][0], [...tries[i][1], ...args], { timeout: 60000, windowsHide: true }, (err, _o, e) => (err ? next(i + 1, String(e || err.message).slice(0, 200)) : resolve()));
    };
    next(0);
  });
}

// pairs: [{ title: option, thumb: option }] as the page shows them -> [{ key, title, file }]
export function oursFrom(titles, thumbs, pairs) {
  const out = [], seen = new Set();
  for (const p of Array.isArray(pairs) ? pairs : []) {
    const t = titles.options.find((o) => o.id === p?.title), h = thumbs.options.find((o) => o.id === p?.thumb);
    if (!t || !h) continue;
    const key = `${t.id}+${h.id}`;
    if (!seen.has(key)) { seen.add(key); out.push({ key, title: t.title, file: h.file }); }
  }
  return out;
}

// one fresh judge: one model call with the picture in the message itself (no tools, no files, no history, no settings),
// so it sees nothing but the numbered feed. (Reading the picture through a tool cost 150 times more in tests.)
async function oneJudge({ image, skill, count }) {
  let text = '', cost = 0;
  const content = [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: image } }, { type: 'text', text: judgePrompt({ skill, count, audience: AUDIENCE }) }];
  async function* input() { yield { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, session_id: '' }; }
  const q = query({
    prompt: input(),
    options: {
      model: MODEL, effort: 'low', settingSources: [], tools: [], permissionMode: 'dontAsk', maxTurns: 2,
      systemPrompt: 'You are one blind judge of a YouTube feed. You answer with the JSON asked for and nothing else.',
    },
  });
  for await (const m of q) {
    if (m.type === 'result') { cost = m.total_cost_usd || 0; if (m.subtype === 'success') text = m.result || text; else if (!text) throw new Error('A judge stopped early (' + m.subtype + ').'); }
    else if (m.type === 'assistant') { const t = (m.message?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''); if (t) text = t; }
  }
  return { text, cost };
}

// -> the saved result { at, bar, barFrom, judges, cost, ms, tiles: [{ n, kind, key, title, score, scores, rank, why }], keys: [pair keys] }
export async function runJudge({ dir, skill, titles, thumbs, pairs, seed = 1, onState = () => {}, run = oneJudge }) {
  const t0 = Date.now();
  const ours = oursFrom(titles, thumbs, pairs);
  if (!ours.length) throw Object.assign(new Error('Star a title and a thumbnail first: the judges need something of yours to score.'), { status: 400 });
  const videos = parseVideos(await readJson(path.join(dir, 'studio', 'research', 'videos.json'), null)).videos;
  const real = realWinners(videos);
  if (real.length < 3) throw Object.assign(new Error('The bar needs at least 3 real winners with pictures: run Research first.'), { status: 400 });
  const tiles = buildTiles(ours, real, seed);
  const work = path.join(dir, 'studio', 'judge');
  await fs.rm(work, { recursive: true, force: true });
  await fs.mkdir(work, { recursive: true });
  const specTiles = tiles.map((t) => ({ n: t.n, title: t.title, pic: studioPath(dir, t.pic) || '' }));
  await writeJson(path.join(work, 'sheet.json'), { tiles: specTiles, cols: 4 });
  onState({ status: 'drawing' });
  await runPython([path.join(here, 'judge_sheet.py'), path.join(work, 'sheet.json'), path.join(work, 'feed.png')]);
  // three fresh judges, side by side; none sees another's scores
  const image = (await fs.readFile(path.join(work, 'feed.png'))).toString('base64');
  const replies = [], costs = [];
  onState({ status: 'judging' });
  await Promise.all(Array.from({ length: JUDGES }, async (_, i) => {
    try {
      const r = await run({ image, skill, count: tiles.length });
      costs.push(r.cost || 0);
      replies[i] = parseReply(r.text, tiles.length);
    } catch (e) { replies[i] = { error: String(e.message || e).slice(0, 200) }; }
  }));
  const good = replies.filter((r) => r && r.scores);
  if (good.length < 2) throw Object.assign(new Error('Fewer than two judges answered: ' + (replies.find((r) => r?.error)?.error || 'no reply') + ' Nothing was kept.'), { status: 502 });
  const pooled = pool(tiles, replies);
  const result = {
    at: new Date().toISOString(), ...pooled, ms: Date.now() - t0, cost: Math.round(costs.reduce((a, b) => a + b, 0) * 1e4) / 1e4,
    keys: ours.map((o) => o.key), sheet: 'judge/feed.png',
  };
  await writeJson(JUDGE_FILE(dir), result);
  return result;
}
