// The Studio's routes (part D): plan and script, research, title and thumbnail options, the feed pick, the upload.
// Live: a watcher on <project>/studio/ broadcasts { type: 'studio', project, paths } when the agent writes there,
// and the upload broadcasts { type: 'studio', project, upload: state } as it goes.
import fs from 'node:fs';
import path from 'node:path';
import { readStudio, saveTextFile, changeOptions, saveFeed, updateUpload } from '../studio/store.js';
import { studioPath } from '../studio/files.js';
import { uploadFields } from '../studio/upload-plan.js';
import { uploadProject, ytStatus, startConnect, finishConnect, disconnect } from '../studio/upload.js';
import { models } from '../studio/image-gen.js';
import { publicList } from '../studio/image-models.js';

const ID = '(?<id>[a-z0-9][a-z0-9_-]{0,79})';
const P = (tail) => new RegExp(`^/api/studio/${ID}${tail}$`, 'i');

// ------------------------------------------------------------------ the watcher
const watchers = new Map();
function watch(ctx, id) {
  if (watchers.has(id) || watchers.size > 40) return;
  const dir = path.join(ctx.projectDir(id), 'studio');
  try {
    fs.mkdirSync(dir, { recursive: true });
    let timer = null; const paths = new Set();
    const w = fs.watch(dir, { recursive: true }, (_, name) => {
      const p = String(name || '').replace(/\\/g, '/');
      if (!p || p.startsWith('.history') || p.endsWith('.tmp') || p === 'choices.json') return;
      paths.add(p);
      clearTimeout(timer);
      timer = setTimeout(() => { ctx.broadcast({ type: 'studio', project: id, paths: [...paths] }); paths.clear(); }, 300);
    });
    w.on('error', () => { try { w.close(); } catch {} watchers.delete(id); });
    watchers.set(id, w);
  } catch { /* no recursive watch on this system: the tab still reloads on its own actions */ }
}

// the Bin moves a project folder: on Windows a watcher inside it holds it, so it lets go first
export function unwatch(id) { const w = watchers.get(id); if (!w) return false; try { w.close(); } catch {} watchers.delete(id); return true; }

// only the browser's own page may press Upload: a same-origin fetch, never a script or an agent's curl
function fromThePage(req) {
  const origin = req.headers.origin, host = req.headers.host;
  if (!origin || !host) return false;
  try { return new URL(origin).host === host && (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin'); } catch { return false; }
}

const running = new Set();
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

export default [
  {
    method: 'GET', path: '/api/studio/models',
    handler: async (req, res, ctx) => ctx.send(res, 200, { models: publicList(models(), process.env) }),
  },
  {
    method: 'GET', path: '/api/studio/youtube',
    handler: async (req, res, ctx) => ctx.send(res, 200, await ytStatus(ctx.dataDir)),
  },
  {
    method: 'POST', path: '/api/studio/youtube/connect',
    handler: async (req, res, ctx) => {
      if (!fromThePage(req)) throw bad('Connect YouTube from the Studio page.', 403);
      const r = await startConnect(ctx.dataDir, req.headers.host);
      ctx.send(res, r.error ? 400 : 200, r);
    },
  },
  {
    method: 'POST', path: '/api/studio/youtube/disconnect',
    handler: async (req, res, ctx) => { await disconnect(ctx.dataDir); ctx.send(res, 200, await ytStatus(ctx.dataDir)); },
  },
  {
    method: 'GET', path: '/api/studio/youtube/callback',
    handler: async (req, res, ctx) => {
      const q = ctx.query;
      let r;
      try { r = await finishConnect(ctx.dataDir, { code: q.get('code'), state: q.get('state'), error: q.get('error') }); } catch (e) { r = { error: e.message }; }
      const msg = r.ok ? 'YouTube is connected. You can close this tab and go back to the Studio.' : r.error;
      if (r.ok) ctx.broadcast({ type: 'studio', youtube: await ytStatus(ctx.dataDir) });
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      res.writeHead(r.ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(`<!doctype html><meta charset="utf-8"><title>YouTube</title><body style="font:16px system-ui;background:#222034;color:#f5efe0;display:grid;place-items:center;height:100vh;margin:0"><p>${esc(msg)}</p>`);
    },
  },
  {
    method: 'GET', path: P(''),
    handler: async (req, res, ctx) => {
      const id = ctx.params.id, dir = ctx.projectDir(id);
      watch(ctx, id);
      const [studio, youtube] = await Promise.all([readStudio(dir), ytStatus(ctx.dataDir)]);
      ctx.send(res, 200, { ...studio, youtube, models: publicList(models(), process.env), uploading: running.has(id) });
    },
  },
  {
    method: 'GET', path: P('/file/(?<rel>.+)'),
    handler: async (req, res, ctx) => {
      let rel;
      try { rel = decodeURIComponent(ctx.params.rel); } catch { throw bad('bad path'); }
      const f = studioPath(ctx.projectDir(ctx.params.id), rel);
      if (!f) throw bad('bad path');
      ctx.sendFile(req, res, f);
    },
  },
  {
    method: 'POST', path: P('/text'),
    handler: async (req, res, ctx) => {
      const b = await ctx.readJson(req);
      const r = await saveTextFile(ctx.projectDir(ctx.params.id), b.name, b.text, b.base).catch((e) => { throw bad(e.message); });
      ctx.send(res, 200, r);
    },
  },
  {
    method: 'POST', path: P('/options'),
    handler: async (req, res, ctx) => {
      const b = await ctx.readJson(req);
      if (!['titles', 'thumbs'].includes(b.kind)) throw bad('kind is titles or thumbs');
      const r = await changeOptions(ctx.projectDir(ctx.params.id), b.kind, { op: b.op, id: b.id, text: b.text });
      if (r.error) throw bad(r.error);
      ctx.send(res, 200, r);
    },
  },
  {
    method: 'POST', path: P('/feed'),
    handler: async (req, res, ctx) => {
      const dir = ctx.projectDir(ctx.params.id);
      const b = await ctx.readJson(req);
      const patch = {};
      if (b.theme === 'light' || b.theme === 'dark') patch.theme = b.theme;
      if (b.width === 'desktop' || b.width === 'phone') patch.width = b.width;
      if (Number.isFinite(b.seed)) patch.seed = Math.floor(b.seed);
      if (typeof b.channel === 'string') patch.channel = b.channel.slice(0, 80);
      if (typeof b.notes === 'string') patch.notes = b.notes.slice(0, 4000);
      if (b.picked === null) patch.picked = null;
      else if (b.picked && typeof b.picked === 'object') {
        // the feed pick is the package: it picks the title and the thumbnail too
        const t = await changeOptions(dir, 'titles', { op: 'pick', id: b.picked.title });
        if (t.error) throw bad(t.error);
        const th = await changeOptions(dir, 'thumbs', { op: 'pick', id: b.picked.thumb });
        if (th.error) throw bad(th.error);
        patch.picked = { title: b.picked.title, thumb: b.picked.thumb };
      }
      ctx.send(res, 200, await saveFeed(dir, patch));
    },
  },
  {
    method: 'POST', path: P('/upload-fields'),
    handler: async (req, res, ctx) => {
      const b = await ctx.readJson(req);
      const allowed = ['description', 'tags', 'privacy', 'category', 'madeForKids', 'synthetic', 'publishAt', 'language'];
      const fields = Object.fromEntries(Object.entries(b.fields || {}).filter(([k]) => allowed.includes(k)));
      const r = await updateUpload(ctx.projectDir(ctx.params.id), ({ fields: cur }) => ({ fields: uploadFields({ ...cur, ...fields }) }));
      ctx.send(res, 200, r);
    },
  },
  {
    method: 'POST', path: P('/upload'),
    handler: async (req, res, ctx) => {
      const id = ctx.params.id, dir = ctx.projectDir(id);
      if (!fromThePage(req)) throw bad('Upload only happens from the Upload button in the Studio.', 403);
      if (running.has(id)) throw bad('An upload is already running.', 409);
      const b = await ctx.readJson(req);
      running.add(id);
      const onState = (state) => ctx.broadcast({ type: 'studio', project: id, upload: state });
      uploadProject({ projectDir: dir, dataDir: ctx.dataDir, dry: b.dry === true, onState })
        .then((s) => ctx.broadcast({ type: 'toast', text: s.dry ? 'Dry run done: nothing left this computer.' : 'Uploaded to YouTube (private until you change it).', kind: 'ok' }))
        .catch((e) => ctx.broadcast({ type: 'toast', text: `Upload: ${e.message}`, kind: 'error' }))
        .finally(() => running.delete(id));
      ctx.send(res, 202, { started: true, dry: b.dry === true });
    },
  },
];

