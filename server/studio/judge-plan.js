// The judge panel, pure: which tiles go in the numbered feed, how the judges' replies are read and pooled, and where
// the bar is. The method is in craft/skills/judge-package: three fresh judges, a light page, tiles at 168 px, numbered,
// no view counts, every tile scored 0 to 10. The bar is the 3rd-best real winner in the same feed.
// Same inputs and seed, same feed; the order is shuffled so a tile's place says nothing about whose it is.

export const JUDGES = 3;
export const REAL_MAX = 12;
export const BAR_RANK = 3;

function rng(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  let a = h >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// the real winners: videos with a picture that you did not hide, strongest outlier first (then most views), at most `max`
export function realWinners(videos, max = REAL_MAX) {
  return (Array.isArray(videos) ? videos : [])
    .filter((v) => v && v.thumb && v.title && !v.hidden)
    .sort((a, b) => (b.outlier ?? 0) - (a.outlier ?? 0) || (b.views ?? 0) - (a.views ?? 0))
    .slice(0, max);
}

// ours: [{ key, title, file }] (file = a picture path inside studio/thumbs); real: [{ id, title, thumb }]
// -> [{ n, kind: 'ours'|'real', key, title, pic }], numbered from 1 in a seeded shuffle
export function buildTiles(ours, real, seed = 1) {
  const all = [
    ...ours.map((o) => ({ kind: 'ours', key: o.key, title: o.title, pic: `thumbs/${o.file}` })),
    ...real.map((v) => ({ kind: 'real', key: v.id, title: v.title, pic: v.thumb })),
  ];
  const r = rng(`${seed}:judge`);
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  return all.map((t, i) => ({ n: i + 1, ...t }));
}

// a judge's reply (text, or an already parsed object) -> { scores: { n: number }, why: { n: text } } or { error }
export function parseReply(reply, count) {
  let obj = reply;
  if (typeof reply === 'string') {
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(reply);
    const src = fence ? fence[1] : reply;
    const a = src.indexOf('{'), z = src.lastIndexOf('}');
    if (a < 0 || z < a) return { error: 'the judge sent no scores' };
    try { obj = JSON.parse(src.slice(a, z + 1)); } catch { return { error: 'the judge sent scores that could not be read' }; }
  }
  const raw = obj && typeof obj === 'object' ? (obj.scores && typeof obj.scores === 'object' ? obj.scores : obj) : null;
  if (!raw) return { error: 'the judge sent no scores' };
  const scores = {}, why = {};
  for (let n = 1; n <= count; n++) {
    const v = Number(raw[n] ?? raw[String(n)]);
    if (Number.isFinite(v) && v >= 0 && v <= 10) scores[n] = Math.round(v * 10) / 10;
  }
  if (obj.why && typeof obj.why === 'object') for (const [k, v] of Object.entries(obj.why)) if (typeof v === 'string') why[k] = v.slice(0, 300);
  if (Object.keys(scores).length < Math.ceil(count * 0.8)) return { error: 'the judge scored too few tiles' };
  return { scores, why };
}

const mean = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

// tiles + the judges' parsed replies -> { bar, barFrom, tiles: [{ n, kind, key, title, score, scores, rank }], judges }
// score = the mean of the judges that scored the tile; the bar = the BAR_RANK-th best real tile's score
export function pool(tiles, replies) {
  const ok = replies.filter((r) => r && r.scores);
  const out = tiles.map((t) => {
    const scores = ok.map((r) => r.scores[t.n]).filter((v) => v !== undefined);
    const whys = ok.map((r) => r.why?.[t.n]).filter(Boolean);
    return { ...t, score: mean(scores), scores, why: whys[0] || '' };
  });
  const real = out.filter((t) => t.kind === 'real' && t.score !== null).sort((a, b) => b.score - a.score);
  const bar = real.length >= BAR_RANK ? real[BAR_RANK - 1].score : null;
  const ranked = [...out].filter((t) => t.score !== null).sort((a, b) => b.score - a.score);
  for (const t of out) t.rank = t.score === null ? null : ranked.findIndex((x) => x.n === t.n) + 1;
  return { bar, barFrom: real.length, tiles: out, judges: ok.length };
}

// ours at or above the bar pass; null when there is no bar (fewer than three real winners)
export const passes = (t, bar) => (bar === null || t.score === null ? null : t.score >= bar);

// the prompt every judge gets (the skill text comes in as `skill`); the same for all three
export function judgePrompt({ skill, count, audience }) {
  return [
    String(skill || '').trim(),
    '',
    `The picture above is the feed. It has ${count} numbered tiles.`,
    audience ? `You are: ${audience}.` : '',
    'Score every tile from 0 to 10 and answer with only this JSON, nothing before or after:',
    '{"scores": {"1": 7, "2": 4}, "why": {"1": "one short reason", "2": "a reason"}}',
  ].filter((x) => x !== '').join('\n');
}
