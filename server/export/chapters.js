// YouTube chapters for the description: "0:00 Title" lines. Pure (tested in chapters.test.js); chaptersFor(dir) in index.js reads the files.
// From video/out/chapters.json when the agent or you wrote one ({ chapters: [{ at, title }] }, rough seconds), else drafted from the words:
// boundaries at sentence starts after a pause (a picture scene change near one counts for more), titles from the first words of that sentence.
// YouTube's rules are kept: the first chapter at 0:00, at least three, each at least 10 s long.

export const MIN_LEN = 10;
export const MIN_COUNT = 3;
const FILLER = new Set(['so', 'um', 'uh', 'er', 'ah', 'hmm', 'okay', 'ok', 'yeah', 'and', 'but', 'well', 'like', 'right', 'now', 'alright']);

// 75 -> "1:15", 3725 -> "1:02:05"
export function stamp(sec) {
  const t = Math.max(0, Math.floor(Number(sec) || 0)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}

const clean = (w) => String(w || '').replace(/^[^\p{L}\p{N}$#@]+|[^\p{L}\p{N}%$+]+$/gu, '');
const ends = (w) => /[.?!]["')\]]*$/.test(String(w || ''));

// the first words of the sentence that starts at word i, as a title: fillers off the front, at most `max` words, the first letter capital
export function titleFrom(words, i, max = 6) {
  const out = [];
  let k = i;
  while (k < words.length && out.length === 0 && FILLER.has(clean(words[k][2]).toLowerCase())) k++;
  for (; k < words.length && out.length < max; k++) {
    const w = clean(words[k][2]);
    if (w) out.push(w);
    if (ends(words[k][2])) break;
  }
  const t = out.join(' ');
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

// where a sentence starts after a pause: [{ at, i, score }]
export function candidates(words, scenes = []) {
  const out = [];
  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1], w = words[i];
    const gap = Number(w[0]) - Number(prev[1]);
    if (!ends(prev[2]) || gap < 0.25) continue;
    const near = scenes.some((s) => Math.abs(s - Number(w[0])) < 1.5);
    out.push({ at: Number(w[0]), i, score: Math.min(gap, 3) + (near ? 1.5 : 0) });
  }
  return out;
}

// how many chapters a video of this length gets: one per about a minute and a half, 3 to 12 (none under 30 s)
export const countFor = (duration) => (duration < MIN_LEN * MIN_COUNT ? 0 : Math.max(MIN_COUNT, Math.min(12, Math.round(duration / 90))));

// a drafted list from the words: [{ at, title }]
export function draft({ duration, words = [], scenes = [] }) {
  const n = countFor(duration);
  if (!n || !words.length) return [];
  const cands = candidates(words, scenes);
  const list = [{ at: 0, title: titleFrom(words, 0) || 'Intro' }];
  const span = duration / n;
  for (let k = 1; k < n; k++) {
    const ideal = k * span, prev = list[list.length - 1].at;
    const ok = cands.filter((c) => Math.abs(c.at - ideal) <= span * 0.4 && c.at - prev >= MIN_LEN && duration - c.at >= MIN_LEN);
    if (!ok.length) continue;
    const best = ok.reduce((a, c) => (c.score - Math.abs(c.at - ideal) / span > a.score - Math.abs(a.at - ideal) / span ? c : a));
    list.push({ at: best.at, title: titleFrom(words, best.i) || `Part ${list.length + 1}` });
  }
  return list;
}

// any list made right for YouTube: sorted, the first at 0:00, each at least 10 s, titles one line -> { chapters, problems }
export function tidy(list, duration) {
  const problems = [];
  const xs = (Array.isArray(list) ? list : [])
    .map((c) => ({ at: Number(c?.at), title: String(c?.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 100) }))
    .filter((c) => Number.isFinite(c.at) && c.at >= 0 && c.at < duration && c.title)
    .sort((a, b) => a.at - b.at);
  if (xs.length && xs[0].at > 0) { xs[0].at = 0; }
  const out = [];
  for (const c of xs) {
    if (out.length && Math.floor(c.at) - Math.floor(out[out.length - 1].at) < MIN_LEN) { problems.push(`"${c.title}" at ${stamp(c.at)} is under ${MIN_LEN} s after the one before: left out`); continue; }
    out.push(c);
  }
  if (out.length && duration - out[out.length - 1].at < MIN_LEN) { const c = out.pop(); problems.push(`"${c.title}" at ${stamp(c.at)} is under ${MIN_LEN} s before the end: left out`); }
  if (out.length < MIN_COUNT) problems.push(`YouTube shows chapters only when there are at least ${MIN_COUNT}, each ${MIN_LEN} s or longer`);
  return { chapters: out.length >= MIN_COUNT ? out : [], problems };
}

// everything: { chapters, lines, text, from: 'chapters.json'|'words'|null, problems }
export function chapters({ duration, words = [], scenes = [], given = null }) {
  const from = Array.isArray(given) && given.length ? 'chapters.json' : words.length ? 'words' : null;
  const raw = from === 'chapters.json' ? given : draft({ duration, words, scenes });
  const t = tidy(raw, duration);
  const lines = t.chapters.map((c) => `${stamp(c.at)} ${c.title}`);
  return { chapters: t.chapters, lines, text: lines.join('\n'), from, problems: from ? t.problems : ['there are no words yet: chapters are drafted from video/out/rough-words.json'] };
}
