// Small pure formatters for the Studio: views, durations, ages, outlier labels, title lengths.

export function views(n, word = true) {
  if (!Number.isFinite(n)) return '';
  const f = (x, s) => (x >= 10 ? Math.floor(x) : Math.floor(x * 10) / 10) + s;
  const s = n >= 1e9 ? f(n / 1e9, 'B') : n >= 1e6 ? f(n / 1e6, 'M') : n >= 1e3 ? f(n / 1e3, 'K') : String(Math.round(n));
  return word ? `${s} view${n === 1 ? '' : 's'}` : s;
}

export function duration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '';
  const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const two = (x) => String(x).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}

// 'YYYYMMDD' or an ISO date -> "3 weeks ago"
export function ago(published, now = Date.now()) {
  const p = String(published || '');
  const t = /^\d{8}$/.test(p) ? Date.UTC(+p.slice(0, 4), +p.slice(4, 6) - 1, +p.slice(6, 8)) : Date.parse(p);
  if (!Number.isFinite(t)) return '';
  const d = Math.max(0, (now - t) / 1000);
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [u, s] of units) if (d >= s) { const n = Math.floor(d / s); return `${n} ${u}${n === 1 ? '' : 's'} ago`; }
  return 'just now';
}

// how far above its channel's usual a video did
export function outlierLabel(x) {
  if (!Number.isFinite(x)) return { text: '?', level: 'none' };
  const text = `${x >= 10 ? Math.round(x) : Math.round(x * 10) / 10}×`;
  return { text, level: x >= 5 ? 'big' : x >= 2 ? 'high' : x >= 1 ? 'normal' : 'low' };
}

// title length against what a feed shows: the hook should land in ~45 characters, the whole under ~70
export function titleLength(title) {
  const n = [...String(title || '')].length;
  return { n, level: n > 70 ? 'long' : n > 55 ? 'edge' : 'ok' };
}

export const words = (text) => (String(text || '').match(/[\p{L}\p{N}'’-]+/gu) || []).length;

// spoken minutes at about 150 words a minute
export const readMinutes = (text) => Math.round((words(text) / 150) * 10) / 10;

// a file inside the project's studio/ as a URL; ?v= busts the browser cache when the file changed
export const fileUrl = (project, rel, mtime) => `/api/studio/${encodeURIComponent(project)}/file/${String(rel).split('/').map(encodeURIComponent).join('/')}${mtime ? `?v=${Math.round(mtime)}` : ''}`;
