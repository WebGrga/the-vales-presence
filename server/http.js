// Small http helpers: JSON in and out, files with Range (so a player can seek), MIME types, safe paths.
// The pure parts (byteRange, mimeOf, safeJoin, matchRoute) are tested in http.test.js.
import fs from 'node:fs';
import path from 'node:path';

export const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json', '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.tsv': 'text/tab-separated-values; charset=utf-8', '.log': 'text/plain; charset=utf-8', '.jsonl': 'text/plain; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8', '.vtt': 'text/vtt; charset=utf-8', '.ass': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.fcpxml': 'application/xml', '.otio': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.wasm': 'application/wasm',
};
export const mimeOf = (file) => MIME[path.extname(String(file)).toLowerCase()] || 'application/octet-stream';

const BODY_MAX = 8 * 1024 * 1024; // a JSON body; footage never comes this way

// A request's JSON body ({} when empty). A bad body throws an error with status 400.
export function readJson(req) {
  return new Promise((ok, fail) => {
    const parts = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > BODY_MAX) { fail(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); } else parts.push(c); });
    req.on('error', fail);
    req.on('end', () => {
      const s = Buffer.concat(parts).toString('utf8').trim();
      if (!s) return ok({});
      try { ok(JSON.parse(s)); } catch { fail(Object.assign(new Error('the body is not JSON'), { status: 400 })); }
    });
  });
}

export function send(res, status, obj) {
  if (res.headersSent) { try { res.end(); } catch {} return; }
  const body = JSON.stringify(obj ?? null);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

// pure: a Range header against a size -> { start, end } | { bad: true } | null (no range: the whole file)
export function byteRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m || (!m[1] && !m[2])) return null;
  if (!m[1]) { const n = Number(m[2]); if (!n) return { bad: true }; return { start: Math.max(0, size - n), end: size - 1 }; }
  const start = Number(m[1]);
  const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return start > end || start >= size ? { bad: true } : { start, end };
}

// A file with Range support, no-cache. 404 when it is not a file. opts: { type } to force a MIME type.
export function sendFile(req, res, file, opts = {}) {
  let st;
  try { st = fs.statSync(file); } catch { return send(res, 404, { error: 'not found' }); }
  if (!st.isFile()) return send(res, 404, { error: 'not found' });
  const size = st.size, type = opts.type || mimeOf(file);
  const head = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-cache', 'last-modified': st.mtime.toUTCString() };
  const r = byteRange(req.headers.range, size);
  const pipe = (s) => { s.on('error', () => { try { res.destroy(); } catch {} }); res.on('close', () => s.destroy()); s.pipe(res); };
  if (r?.bad) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }
  if (!r) {
    res.writeHead(200, { ...head, 'content-length': size });
    if (req.method === 'HEAD') return res.end();
    return pipe(fs.createReadStream(file));
  }
  res.writeHead(206, { ...head, 'content-length': r.end - r.start + 1, 'content-range': `bytes ${r.start}-${r.end}/${size}` });
  if (req.method === 'HEAD') return res.end();
  return pipe(fs.createReadStream(file, { start: r.start, end: r.end }));
}

// pure: a relative path (forward or back slashes, maybe URL-encoded) joined inside base; null when it would leave base
export function safeJoin(base, rel) {
  let p;
  try { p = decodeURIComponent(String(rel ?? '')); } catch { return null; }
  p = p.replace(/\\/g, '/').replace(/^\/+/, '');
  if (p.includes('\0')) return null;
  const parts = p.split('/').filter((x) => x && x !== '.');
  if (parts.some((x) => x === '..' || /^[a-z]:$/i.test(x))) return null;
  const out = path.resolve(base, ...parts);
  const root = path.resolve(base);
  const rootSep = root.endsWith(path.sep) ? root : root + path.sep;
  return out === root || out.startsWith(rootSep) ? out : null;
}

// pure: find the route for a method and pathname. Exact string paths win over RegExp paths; RegExps in load order.
// -> { route, params } | null. params: the RegExp's named groups, else its numbered groups as an array.
export function matchRoute(routes, method, pathname) {
  const m = method === 'HEAD' ? 'GET' : method;
  for (const r of routes) if (typeof r.path === 'string' && r.path === pathname && r.method === m) return { route: r, params: {} };
  for (const r of routes) {
    if (!(r.path instanceof RegExp) || r.method !== m) continue;
    r.path.lastIndex = 0;
    const x = r.path.exec(pathname);
    if (x) return { route: r, params: x.groups ? { ...x.groups } : x.slice(1) };
  }
  return null;
}
