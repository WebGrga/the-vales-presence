// Title and thumbnail research, the pure half: yt-dlp entries into video records, a channel's usual views,
// the outlier score (views against the channel's median), and the patterns the top titles share.
// research-fetch.js runs yt-dlp and calls these; the Studio tab shows the result.

const str = (v, n = 300) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, n) : '');
const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean' ? undefined : (Number.isFinite(Number(v)) ? Number(v) : undefined));

export function median(xs) {
  const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  if (!a.length) return undefined;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// views against the channel's median views, one decimal; undefined when either is missing
export function outlierScore(views, channelMedian) {
  if (!Number.isFinite(views) || !Number.isFinite(channelMedian) || channelMedian <= 0) return undefined;
  return Math.round((views / channelMedian) * 10) / 10;
}

// where a video sits in its niche: a hit (2x its channel's usual or more), a flop (under half) or in between
export function tierOf(outlier) {
  if (!Number.isFinite(outlier)) return undefined;
  return outlier >= 2 ? 'top' : outlier < 0.5 ? 'flop' : 'typical';
}

// from one channel's recent videos (records with views): the best, a few typical ones and the real flops,
// so a comparison sees the whole channel and not only its hits. Shorts are not offered (the caller leaves them out).
export function sampleChannel(videos, { top = 0, typical = 2, flop = 2 } = {}) {
  const views = videos.map((v) => v.views).filter(Number.isFinite);
  const scored = videos.map((v) => {
    const m = channelMedian(views, v.views);
    return m === undefined ? { ...v } : { ...v, channelMedian: Math.round(m), outlier: outlierScore(v.views, m) };
  }).filter((v) => Number.isFinite(v.outlier));
  const by = (t) => scored.filter((v) => tierOf(v.outlier) === t);
  const best = by('top').sort((a, b) => b.outlier - a.outlier).slice(0, top);
  const flops = by('flop').sort((a, b) => a.outlier - b.outlier).slice(0, flop);
  const mid = by('typical').sort((a, b) => Math.abs(1 - a.outlier) - Math.abs(1 - b.outlier)).slice(0, typical);
  return [...best, ...mid, ...flops];
}

// a channel's usual views: the median of its recent videos, leaving out the one being scored
export function channelMedian(channelViews, exceptViews) {
  const xs = [...channelViews];
  if (Number.isFinite(exceptViews)) { const i = xs.indexOf(exceptViews); if (i >= 0) xs.splice(i, 1); }
  return xs.length >= 3 ? median(xs) : undefined;
}

// one yt-dlp entry (from --flat-playlist -J or --dump-json) into a video record
export function fromYtDlp(e, source = 'search') {
  if (!e || typeof e !== 'object') return null;
  const id = str(e.id, 20);
  if (!/^[\w-]{6,20}$/.test(id)) return null;
  const v = { id, url: `https://www.youtube.com/watch?v=${id}`, title: str(e.title, 200), source };
  const put = (k, x) => { if (x !== undefined && x !== '') v[k] = x; };
  put('channel', str(e.channel || e.uploader, 100));
  put('channelId', str(e.channel_id || e.uploader_id, 40));
  put('views', num(e.view_count));
  put('duration', num(e.duration));
  put('published', str(e.upload_date || e.release_date, 10) || (num(e.timestamp) ? new Date(num(e.timestamp) * 1000).toISOString().slice(0, 10).replace(/-/g, '') : ''));
  return v.title ? v : null;
}

// clean a videos.json the agent wrote: keep what parses, sort by outlier score then views
export function parseVideos(obj) {
  const list = Array.isArray(obj) ? obj : Array.isArray(obj?.videos) ? obj.videos : [];
  const seen = new Set(), out = [];
  for (const x of list) {
    if (!x || typeof x !== 'object') continue;
    const id = str(x.id, 40) || str(x.url, 300);
    const title = str(x.title, 200);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    const v = { id, title };
    for (const k of ['url', 'channel', 'channelId', 'thumb', 'source', 'note', 'published', 'avatar']) if (str(x[k])) v[k] = str(x[k], 600);
    for (const k of ['views', 'channelMedian', 'outlier', 'duration', 'subscribers']) if (num(x[k]) !== undefined) v[k] = num(x[k]);
    if (v.outlier === undefined) { const o = outlierScore(v.views, v.channelMedian); if (o !== undefined) v.outlier = o; }
    const t = tierOf(v.outlier); if (t) v.tier = t;
    if (x.starred === true) v.starred = true;
    if (x.hidden === true) v.hidden = true;
    out.push(v);
  }
  out.sort((a, b) => (b.outlier ?? -1) - (a.outlier ?? -1) || (b.views ?? -1) - (a.views ?? -1));
  return { query: str(obj?.query, 200), topic: str(obj?.topic, 200), fetched: str(obj?.fetched, 40), notes: str(Array.isArray(obj?.notes) ? obj.notes.map((n) => `- ${str(n, 600)}`).join(String.fromCharCode(10)) : obj?.notes, 4000), videos: out };
}

// title features, as data: key, label, test
export const FEATURES = [
  ['number', 'has a number', /\d/],
  ['money', 'names money', /[$€£]\s?\d|\d\s?(dollars|usd|eur)\b/i],
  ['time', 'a time frame', /\b\d+\s?(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\b|\b\d+h\b/i],
  ['caps', 'a word in CAPS', /\b[A-Z]{3,}\b/],
  ['question', 'a question', /\?/],
  ['brackets', '(brackets)', /[([]/],
  ['firstPerson', 'I / my / we', /\b(i|i'm|i've|i'd|my|me|we|our)\b/i],
  ['you', 'you / your', /\byou(r|'re)?\b/i],
  ['how', 'how / how to', /\bhow\b/i],
  ['versus', 'vs / versus', /\b(vs\.?|versus)\s/i],
  ['twoPart', 'two parts (: or |)', /\s[:|–—-]\s|:\s/],
  ['startsNumber', 'starts with a number', /^\d/],
];

export function features(title) {
  const t = String(title || '');
  const out = { chars: [...t].length, words: t.split(/\s+/).filter(Boolean).length };
  for (const [k, , re] of FEATURES) out[k] = re.test(t);
  return out;
}

const STOP = new Set('a an and are as at be but by for from has have i in is it its my of on or so that the this to was we with you your me how what why when just can will i\'m vs it\'s'.split(' '));

// the top videos (outlier >= 2, else the top third by outlier) against all of them
export function patterns(videos) {
  const all = videos.filter((v) => v && v.title);
  if (!all.length) return null;
  const scored = all.filter((v) => Number.isFinite(v.outlier)).sort((a, b) => b.outlier - a.outlier);
  let top = scored.filter((v) => v.outlier >= 2);
  if (top.length < 3) top = scored.slice(0, Math.max(1, Math.ceil(scored.length / 3)));
  if (!top.length) top = all.slice(0, Math.max(1, Math.ceil(all.length / 3)));
  const fa = all.map((v) => features(v.title)), ft = top.map((v) => features(v.title));
  const share = (fs, k) => Math.round((fs.filter((f) => f[k]).length / fs.length) * 100);
  const words = new Map();
  for (const v of top) for (const w of new Set(v.title.toLowerCase().match(/[\p{L}\p{N}']+/gu) || [])) {
    if (w.length > 1 && !STOP.has(w)) words.set(w, (words.get(w) || 0) + 1);
  }
  return {
    topCount: top.length, allCount: all.length,
    topRule: top.every((v) => v.outlier >= 2) && top.length >= 3 ? 'outlier ≥ 2×' : 'top third by outlier',
    chars: { top: median(ft.map((f) => f.chars)), all: median(fa.map((f) => f.chars)) },
    words: { top: median(ft.map((f) => f.words)), all: median(fa.map((f) => f.words)) },
    features: FEATURES.map(([key, label]) => ({ key, label, top: share(ft, key), all: share(fa, key) }))
      .sort((a, b) => (b.top - b.all) - (a.top - a.all)),
    common: [...words].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([word, n]) => ({ word, n })),
  };
}

// the agent fetched again: new numbers win, notes and sources the agent added by hand stay
export function mergeVideos(prev, next) {
  const byId = new Map();
  for (const v of prev || []) if (v?.id) byId.set(v.id, { ...v });
  for (const v of next || []) if (v?.id) byId.set(v.id, { ...(byId.get(v.id) || {}), ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) });
  return [...byId.values()];
}

export const thumbUrls = (id) => [`https://i.ytimg.com/vi/${id}/hq720.jpg`, `https://i.ytimg.com/vi/${id}/mqdefault.jpg`];
