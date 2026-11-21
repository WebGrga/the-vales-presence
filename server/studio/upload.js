// Upload final.mp4 to YouTube with the picked title, description and thumbnail, through the YouTube Data API v3
// with the user's own OAuth client. Runs ONLY from the Upload button (POST /api/studio/:id/upload); never from an agent.
// Resumable: 8 MB chunks, retries with backoff, and a restart resumes the same session for up to six days.
// Dry run (the button's "Dry run", or PRESENCE_UPLOAD_DRY=1): a fake Google answers; nothing leaves the computer.
// Tokens: <data>/youtube-token.json (gitignored with data/). Client: <data>/youtube-client.json or YOUTUBE_CLIENT_ID/SECRET.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { readJson, writeJson, studioPath } from './files.js';
import { entryOf, addUpload } from './upload-history.js';
import { readOptions, readUpload, updateUpload } from './store.js';
import {
  buildMeta, clientFrom, pkce, authUrl, redirectFor, storeToken, tokenFresh, TOKEN_URL, UPLOAD_URL, THUMB_URL,
  contentRange, nextOffset, chunkAt, retryable, backoffMs, THUMB_MAX,
} from './upload-plan.js';

export const ytFiles = (dataDir) => ({ client: path.join(dataDir, 'youtube-client.json'), token: path.join(dataDir, 'youtube-token.json') });

export async function ytStatus(dataDir, env = process.env) {
  const f = ytFiles(dataDir);
  const client = clientFrom(await readJson(f.client, null), env);
  const token = await readJson(f.token, null);
  return { client: !!client, connected: !!token?.refresh_token, dryOnly: env.PRESENCE_UPLOAD_DRY === '1' };
}

const pending = new Map(); // state -> { verifier, redirect, at }

export async function startConnect(dataDir, hostHeader, env = process.env) {
  const client = clientFrom(await readJson(ytFiles(dataDir).client, null), env);
  if (!client) return { error: 'No OAuth client yet. Put the client file you downloaded from Google Cloud at data/youtube-client.json (docs/youtube-upload.md).' };
  const redirect = redirectFor(hostHeader);
  if (!redirect) return { error: 'Open the studio at 127.0.0.1 or localhost to connect YouTube.' };
  const p = pkce();
  for (const [k, v] of pending) if (Date.now() - v.at > 15 * 60_000) pending.delete(k);
  pending.set(p.state, { verifier: p.verifier, redirect, at: Date.now() });
  return { url: authUrl({ clientId: client.id, redirectUri: redirect, state: p.state, challenge: p.challenge }) };
}

async function postForm(fetchImpl, url, form) {
  const r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google said ${r.status}: ${j.error_description || j.error || 'no reason given'}`);
  return j;
}

export async function finishConnect(dataDir, { code, state, error }, fetchImpl = fetch, env = process.env) {
  if (error) return { error: `Google did not connect: ${error}.` };
  const p = pending.get(state);
  if (!p || !code) return { error: 'This sign-in link expired. Press Connect YouTube again.' };
  pending.delete(state);
  const client = clientFrom(await readJson(ytFiles(dataDir).client, null), env);
  const res = await postForm(fetchImpl, TOKEN_URL, { code, client_id: client.id, client_secret: client.secret, redirect_uri: p.redirect, grant_type: 'authorization_code', code_verifier: p.verifier });
  await writeJson(ytFiles(dataDir).token, storeToken(null, res));
  return { ok: true };
}

export async function disconnect(dataDir) { await fs.rm(ytFiles(dataDir).token, { force: true }); }

async function accessToken(dataDir, fetchImpl, env) {
  const f = ytFiles(dataDir);
  const tok = await readJson(f.token, null);
  if (tokenFresh(tok)) return tok.access_token;
  if (!tok?.refresh_token) throw new Error('YouTube is not connected. Press Connect YouTube first.');
  const client = clientFrom(await readJson(f.client, null), env);
  if (!client) throw new Error('The OAuth client file is missing (data/youtube-client.json).');
  let res;
  try {
    res = await postForm(fetchImpl, TOKEN_URL, { refresh_token: tok.refresh_token, client_id: client.id, client_secret: client.secret, grant_type: 'refresh_token' });
  } catch (e) {
    if (!/invalid_grant|expired|revoked/i.test(e.message)) throw e;
    await fs.rm(f.token, { force: true }); // shows "not connected" so the button says what to do
    throw new Error('The YouTube connection expired or was removed (a Google app in Testing keeps it 7 days). Press Connect YouTube again.');
  }
  const next = storeToken(tok, res);
  await writeJson(f.token, next);
  return next.access_token;
}

// a fake Google for dry runs and tests: records what would be sent
export function dryGoogle(log) {
  let received = 0;
  return async (url, opts = {}) => {
    const h = opts.headers || {};
    log.push({ method: opts.method || 'GET', url: String(url).replace(/[?&]upload_id=[^&]+/, ''), headers: Object.fromEntries(Object.entries(h).filter(([k]) => k.toLowerCase() !== 'authorization')), bytes: opts.body?.length ?? (typeof opts.body === 'string' ? opts.body.length : 0) });
    const reply = (status, body, headers = {}) => new Response(body ? JSON.stringify(body) : null, { status, headers });
    if (String(url).startsWith(THUMB_URL(''))) return reply(200, { items: [{ default: { url: 'dry' } }] });
    if (opts.method === 'POST') return reply(200, null, { location: 'https://dry.invalid/upload?upload_id=dry' });
    const range = /bytes (\d+)-(\d+)\/(\d+)/.exec(h['content-range'] || '');
    if (range) {
      received = Number(range[2]) + 1;
      if (received >= Number(range[3])) return reply(200, { id: 'DRY_RUN', snippet: {}, status: {} });
      return reply(308, null, { range: `bytes=0-${received - 1}` });
    }
    return reply(308, received ? null : null, received ? { range: `bytes=0-${received - 1}` } : {});
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readChunk(fh, start, length) {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, start);
  return bytesRead === length ? buf : buf.subarray(0, bytesRead);
}

// a thumbnail over 2 MB becomes a JPEG (ffmpeg) before it is sent
async function thumbBytes(file) {
  const buf = await fs.readFile(file);
  if (buf.length <= THUMB_MAX) return { buf, type: /\.jpe?g$/i.test(file) ? 'image/jpeg' : 'image/png' };
  const out = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'thumb-')), 'thumb.jpg');
  await new Promise((res, rej) => { const c = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-q:v', '3', out], { windowsHide: true }); c.on('error', rej); c.on('close', (k) => (k === 0 ? res() : rej(new Error('ffmpeg could not shrink the thumbnail')))); });
  return { buf: await fs.readFile(out), type: 'image/jpeg' };
}

// -> the final state; progress through onState({ status, bytes, total, ... })
export async function uploadProject({ projectDir, dataDir, dry = false, fetchImpl = fetch, env = process.env, onState = () => {}, chunk = undefined }) {
  dry = dry || env.PRESENCE_UPLOAD_DRY === '1';
  const log = [];
  const http = dry ? dryGoogle(log) : fetchImpl;
  const set = async (state) => { const s = (await updateUpload(projectDir, () => ({ state }))).state; onState(s); return s; };
  const fail = async (msg) => { await set({ status: 'error', error: msg, at: new Date().toISOString() }); throw new Error(msg); };

  const [{ fields, state: prev }, titles, thumbs] = await Promise.all([readUpload(projectDir), readOptions(projectDir, 'titles'), readOptions(projectDir, 'thumbs')]);
  if (prev.status === 'uploading' && Date.now() - Date.parse(prev.beat || 0) < 60_000) throw new Error('An upload is already running.');
  const title = titles.options.find((o) => o.id === titles.picked)?.title || '';
  const { body, errors } = buildMeta(fields, title);
  if (errors.length) return fail(errors.join(' '));
  const videoFile = path.join(projectDir, ...fields.video.split('/'));
  let total;
  try { total = (await fs.stat(videoFile)).size; } catch { return fail(`There is no ${fields.video} yet. Export the final video first.`); }
  const thumbOpt = thumbs.options.find((o) => o.id === thumbs.picked);
  const thumbFile = thumbOpt ? studioPath(projectDir, path.posix.join('thumbs', thumbOpt.file)) : null;

  const token = dry ? 'dry' : await accessToken(dataDir, http, env).catch((e) => fail(e.message));
  const auth = { authorization: `Bearer ${token}` };
  const t0 = Date.now();
  // resume the same session when the same file was half sent less than six days ago
  let session = !dry && prev.session && prev.total === total && prev.status !== 'done' && Date.now() - Date.parse(prev.sessionAt || 0) < 6 * 864e5 ? prev.session : null;
  let offset = 0;
  if (session) {
    const r = await http(session, { method: 'PUT', headers: { ...auth, 'content-range': `bytes */${total}` } });
    if (r.status === 308) offset = nextOffset(r.headers.get('range'));
    else if (r.status === 200 || r.status === 201) { const j = await r.json(); return finish(j.id); }
    else session = null;
  }
  if (!session) {
    const r = await http(UPLOAD_URL, { method: 'POST', headers: { ...auth, 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-length': String(total), 'x-upload-content-type': 'video/*' }, body: JSON.stringify(body) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); return fail(`YouTube refused the upload (${r.status}): ${j.error?.message || 'no reason given'}`); }
    session = r.headers.get('location');
    await set({ status: 'uploading', dry, session: dry ? null : session, sessionAt: new Date().toISOString(), total, bytes: 0, title, privacy: fields.privacy, error: null, beat: new Date().toISOString() });
  }
  const fh = await fs.open(videoFile, 'r');
  let videoId = null, attempt = 0;
  try {
    while (!videoId) {
      const c = chunkAt(offset, total, chunk);
      const buf = await readChunk(fh, c.start, c.length);
      let r;
      try {
        r = await http(session, { method: 'PUT', headers: { ...auth, 'content-length': String(buf.length), 'content-range': contentRange(c.start, c.end, total) }, body: buf });
      } catch (e) { r = { status: 599, error: e }; }
      if (r.status === 308) { offset = nextOffset(r.headers.get('range')); attempt = 0; }
      else if (r.status === 200 || r.status === 201) { videoId = (await r.json()).id; offset = total; }
      else if (retryable(r.status) && attempt < 8) {
        await sleep(dry ? 0 : backoffMs(attempt++));
        const q = await http(session, { method: 'PUT', headers: { ...auth, 'content-range': `bytes */${total}` } }).catch(() => null);
        if (q?.status === 308) offset = nextOffset(q.headers.get('range'));
        else if (q && (q.status === 200 || q.status === 201)) { videoId = (await q.json()).id; offset = total; }
        continue;
      } else {
        const j = r.json ? await r.json().catch(() => ({})) : {};
        return fail(`The upload stopped (${r.status}): ${j.error?.message || r.error?.message || 'no reason given'}. Press Upload again to resume.`);
      }
      await set({ status: 'uploading', bytes: offset, total, beat: new Date().toISOString() });
    }
  } finally { await fh.close(); }
  return finish(videoId);

  async function finish(id) {
    let thumbNote = thumbFile ? null : 'No thumbnail was picked; YouTube chooses a frame.';
    if (thumbFile) {
      try {
        const { buf, type } = await thumbBytes(thumbFile);
        const r = await http(THUMB_URL(id), { method: 'POST', headers: { ...auth, 'content-type': type, 'content-length': String(buf.length) }, body: buf });
        if (!r.ok) { const j = await r.json().catch(() => ({})); thumbNote = `The video is up, but the thumbnail was refused (${r.status}): ${j.error?.message || ''} Custom thumbnails need a verified channel.`; }
      } catch (e) { thumbNote = `The video is up, but the thumbnail failed: ${e.message}`; }
    }
    if (dry) await writeJson(path.join(projectDir, 'studio', 'upload-dry.json'), { at: new Date().toISOString(), body, requests: log });
    const done = await set({
      status: 'done', dry, videoId: id, url: dry ? null : `https://youtu.be/${id}`, studio: dry ? null : `https://studio.youtube.com/video/${id}/edit`,
      bytes: total, total, ms: Date.now() - t0, at: new Date().toISOString(), thumbNote, session: null, error: null, title, privacy: fields.privacy,
    });
    try { await addUpload(projectDir, entryOf(done, thumbOpt)); } catch {} // the history never stops an upload that worked
    return done;
  }
}
