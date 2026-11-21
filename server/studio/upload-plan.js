// YouTube upload, the pure half: the video's metadata from the user's picks, its checks, the OAuth URLs and the
// resumable upload's byte ranges. upload.js does the talking; nothing here touches the network or disk.
import crypto from 'node:crypto';

export const SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
export const THUMB_URL = (id) => `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(id)}&uploadType=media`;
export const PRIVACY = ['private', 'unlisted', 'public'];
export const CHUNK = 8 * 1024 * 1024; // a multiple of 256 KiB, as the API asks
export const THUMB_MAX = 2 * 1024 * 1024;

// a path inside the project: no .., no drive, no leading slash
const safeRel = (p) => (typeof p === 'string' && p && !/^[\\/]|^[a-z]:/i.test(p) && !p.split(/[\\/]/).includes('..') ? p.replace(/\\/g, '/') : '');

// the fields the user edits in studio/upload.json, with defaults: private, not for kids, People & Blogs
export function uploadFields(u) {
  const o = u && typeof u === 'object' ? u : {};
  const tags = Array.isArray(o.tags) ? o.tags : typeof o.tags === 'string' ? o.tags.split(',') : [];
  return {
    description: typeof o.description === 'string' ? o.description : '',
    tags: tags.map((t) => String(t).trim()).filter(Boolean),
    privacy: PRIVACY.includes(o.privacy) ? o.privacy : 'private',
    category: /^\d{1,3}$/.test(String(o.category || '')) ? String(o.category) : '22',
    madeForKids: o.madeForKids === true,
    synthetic: o.synthetic === true,
    publishAt: typeof o.publishAt === 'string' && o.publishAt ? o.publishAt : '',
    video: safeRel(o.video) || 'video/out/final.mp4',
    language: typeof o.language === 'string' ? o.language.slice(0, 10) : '',
  };
}

// -> { body, errors: [plain words] }; title comes from the picked title, never from the agent alone
export function buildMeta(fields, title) {
  const f = uploadFields(fields), errors = [];
  const t = String(title || '').trim();
  if (!t) errors.push('Pick a title first (Titles).');
  if ([...t].length > 100) errors.push(`The title is ${[...t].length} characters; YouTube takes 100 at most.`);
  if (/[<>]/.test(t)) errors.push('YouTube does not allow < or > in a title.');
  if (Buffer.byteLength(f.description, 'utf8') > 5000) errors.push('The description is over 5000 bytes.');
  if (/[<>]/.test(f.description)) errors.push('YouTube does not allow < or > in a description.');
  const tagChars = f.tags.reduce((n, x) => n + x.length + (x.includes(' ') ? 2 : 0), 0) + Math.max(0, f.tags.length - 1);
  if (tagChars > 500) errors.push(`The tags come to ${tagChars} characters; YouTube takes 500.`);
  if (f.publishAt) {
    if (f.privacy !== 'private') errors.push('A scheduled video must be uploaded as private.');
    if (Number.isNaN(Date.parse(f.publishAt))) errors.push('The schedule time is not a date.');
  }
  const snippet = { title: t, description: f.description, tags: f.tags, categoryId: f.category };
  if (f.language) snippet.defaultLanguage = f.language;
  const status = { privacyStatus: f.privacy, selfDeclaredMadeForKids: f.madeForKids, containsSyntheticMedia: f.synthetic };
  if (f.publishAt && !errors.length) status.publishAt = new Date(f.publishAt).toISOString();
  return { body: { snippet, status }, errors };
}

// the downloaded OAuth client file ({ installed: {...} } or { web: {...} }) or env vars -> { id, secret } | null
export function clientFrom(json, env = {}) {
  const c = json?.installed || json?.web || json || {};
  const id = c.client_id || env.YOUTUBE_CLIENT_ID, secret = c.client_secret || env.YOUTUBE_CLIENT_SECRET;
  return id && secret ? { id: String(id), secret: String(secret) } : null;
}

export function pkce() {
  const verifier = crypto.randomBytes(48).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), state: crypto.randomBytes(16).toString('hex') };
}

export function authUrl({ clientId, redirectUri, state, challenge }) {
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state, code_challenge: challenge, code_challenge_method: 'S256',
  });
  return `${AUTH_URL}?${q}`;
}

// a loopback redirect on the server's own port: Google lets desktop clients use any port on 127.0.0.1
export function redirectFor(hostHeader) {
  const m = /^(?:127\.0\.0\.1|localhost|\[::1\]):(\d{2,5})$/.exec(String(hostHeader || ''));
  return m ? `http://127.0.0.1:${m[1]}/api/studio/youtube/callback` : null;
}

// a token response into what is stored; keeps the refresh token Google sends only the first time
export function storeToken(prev, res, now = Date.now()) {
  return {
    access_token: res.access_token,
    refresh_token: res.refresh_token || prev?.refresh_token,
    expires_at: now + (Number(res.expires_in) || 3600) * 1000,
    scope: res.scope || prev?.scope || SCOPE,
  };
}

export const tokenFresh = (t, now = Date.now()) => !!(t?.access_token && t.expires_at && t.expires_at - 60_000 > now);

// Content-Range of one chunk; end is inclusive
export const contentRange = (start, end, total) => `bytes ${start}-${end}/${total}`;

// after a 308 Resume Incomplete: the next byte to send ("bytes=0-1048575" -> 1048576; no Range -> 0)
export function nextOffset(rangeHeader) {
  const m = /bytes=(\d+)-(\d+)/.exec(String(rangeHeader || ''));
  return m ? Number(m[2]) + 1 : 0;
}

// the chunk to send from an offset
export function chunkAt(offset, total, size = CHUNK) {
  const end = Math.min(total, offset + size) - 1;
  return { start: offset, end, length: end - offset + 1 };
}

// which status codes are worth a retry (with backoff), per Google's resumable upload guide
export const retryable = (status) => status === 429 || (status >= 500 && status <= 504);
export const backoffMs = (attempt) => Math.min(60_000, 1000 * 2 ** attempt);
