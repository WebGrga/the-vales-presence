// The Vale's Presence server: web/ as static files, /api/* routes loaded from server/routes/*.js, a WebSocket at /ws.
// Binds to 127.0.0.1 only. PRESENCE_PORT (default 4848), PRESENCE_DATA (default <repo>/data), --no-open.
// A route file exports default [{ method, path: '/api/...' | RegExp, handler: async (req, res, ctx) }].
// A missing or broken route file (or core module) is logged and skipped: the server always starts.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import { readJson, send, sendFile, safeJoin, matchRoute } from './http.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const webDir = path.join(root, 'web');
const routesDir = path.join(here, 'routes');
const port = Number(process.env.PRESENCE_PORT) || 4848;
const host = '127.0.0.1';
const dataDir = path.resolve(process.env.PRESENCE_DATA || path.join(root, 'data'));
const noOpen = process.argv.includes('--no-open') || process.env.PRESENCE_NO_OPEN === '1';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
fs.mkdirSync(path.join(dataDir, 'projects'), { recursive: true });

// ------------------------------------------------------------------ WebSocket
const sockets = new Set();
function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const ws of sockets) if (ws.readyState === 1) { try { ws.send(s); } catch {} }
}

// ------------------------------------------------------------------ ctx
const ID = /^[a-z0-9][a-z0-9_-]{0,79}$/i;
function projectDir(id) {
  if (!ID.test(String(id || ''))) throw Object.assign(new Error('bad project id'), { status: 400 });
  return path.join(dataDir, 'projects', String(id));
}
const ctx = {
  root, dataDir, craftDir: path.join(root, 'craft'), userCraftDir: path.join(dataDir, 'craft'), webDir, port,
  projectDir, readJson, send, sendFile, broadcast, log,
  projects: null, agent: null, runner: null, media: null,
};

async function load(file, what) {
  try { return await import(pathToFileURL(file).href); } catch (e) {
    if (e?.code === 'ERR_MODULE_NOT_FOUND' && String(e.message).includes(path.basename(file))) log(`${what}: not there yet, skipped`);
    else log(`${what}: failed to load, skipped:`, e?.stack || e);
    return null;
  }
}

// the core modules, each optional so a half-built tree still serves
async function core() {
  const P = await load(path.join(here, 'projects.js'), 'projects.js');
  try { if (P?.createProjects) ctx.projects = P.createProjects(ctx); } catch (e) { log('projects.js:', e.message); }
  const A = await load(path.join(here, 'agent.js'), 'agent.js');
  try { if (A?.createAgent) ctx.agent = A.createAgent(ctx); } catch (e) { log('agent.js:', e.message); }
  const R = await load(path.join(here, 'run.js'), 'run.js');
  try { if (R?.createRunner) ctx.runner = R.createRunner(ctx); } catch (e) { log('run.js:', e.message); }
  const M = await load(path.join(here, 'media.js'), 'media.js');
  try { if (M?.createMedia) ctx.media = M.createMedia(ctx); } catch (e) { log('media.js:', e.message); }
  try { ctx.runner?.boot?.(); } catch (e) { log('runner boot:', e.message); }
}

// ------------------------------------------------------------------ routes
const routes = [];
async function loadRoutes() {
  let files = [];
  try { files = fs.readdirSync(routesDir).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js')).sort(); } catch {}
  for (const f of files) {
    const mod = await load(path.join(routesDir, f), 'routes/' + f);
    const list = mod?.default;
    if (!Array.isArray(list)) { if (mod) log(`routes/${f}: no default array, skipped`); continue; }
    let n = 0;
    for (const r of list) {
      if (!r || typeof r.handler !== 'function' || !(typeof r.path === 'string' || r.path instanceof RegExp)) { log(`routes/${f}: a bad route, skipped`); continue; }
      routes.push({ method: String(r.method || 'GET').toUpperCase(), path: r.path, handler: r.handler, file: f }); n++;
    }
    log(`routes/${f}: ${n} route${n === 1 ? '' : 's'}`);
  }
}

// ------------------------------------------------------------------ http
async function api(req, res, url) {
  const hit = matchRoute(routes, req.method, url.pathname);
  if (!hit) return send(res, 404, { error: `no route ${req.method} ${url.pathname}` });
  req.params = hit.params; req.query = url.searchParams; req.pathname = url.pathname;
  try {
    await hit.route.handler(req, res, { ...ctx, params: hit.params, query: url.searchParams, url });
    if (!res.headersSent && !res.writableEnded) send(res, 204, null);
  } catch (e) {
    const status = e?.status || 500;
    if (status >= 500) log(`${req.method} ${url.pathname} (${hit.route.file}):`, e?.stack || e);
    if (!res.headersSent) send(res, status, { error: String(e?.message || e) });
    else try { res.end(); } catch {}
  }
}

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });
  let rel = url.pathname === '/' ? 'index.html' : url.pathname;
  let file = safeJoin(webDir, rel);
  if (!file) return send(res, 400, { error: 'bad path' });
  try { if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html'); } catch {}
  if (!fs.existsSync(file) && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    return res.end('<!doctype html><meta charset="utf-8"><title>The Vale\'s Presence</title><p>The server runs. The screen (web/index.html) is not built yet.</p>');
  }
  return sendFile(req, res, file);
}

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, `http://${host}:${port}`); } catch { return send(res, 400, { error: 'bad url' }); }
  if (url.pathname.startsWith('/api/')) return void api(req, res, url);
  return serveStatic(req, res, url);
});
server.requestTimeout = 0; // footage uploads and long media streams
server.headersTimeout = 60e3;

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  let p = '';
  try { p = new URL(req.url, `http://${host}`).pathname; } catch {}
  if (p !== '/ws') return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    sockets.add(ws);
    ws.on('close', () => sockets.delete(ws));
    ws.on('error', () => sockets.delete(ws));
    ws.on('message', (raw) => { try { const m = JSON.parse(String(raw)); if (m?.type === 'ping') ws.send(JSON.stringify({ type: 'pong', t: m.t })); } catch {} });
    ws.send(JSON.stringify({ type: 'hello', port, version: 1 }));
  });
});

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { const p = spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore', windowsHide: true }); p.on('error', () => {}); p.unref(); } catch {}
}

await core();
await loadRoutes();
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') log(`port ${port} is in use: is the server already running? (set PRESENCE_PORT for another port)`);
  else log('server error:', e.message);
  process.exit(1);
});
server.listen(port, host, () => {
  const url = `http://localhost:${port}`;
  log(`The Vale's Presence on ${url} (data: ${dataDir})`);
  if (!noOpen) openBrowser(url);
});

async function shutdown() {
  log('stopping');
  try { await ctx.agent?.closeAll?.(); } catch {}
  for (const ws of sockets) try { ws.close(); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
