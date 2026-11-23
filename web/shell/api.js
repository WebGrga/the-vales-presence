// The server, seen from the page: JSON calls to /api, the WebSocket at /ws (reconnects by itself), and file urls.

import { watchStep, WATCH } from './socket-watch.js';

export async function api(path, body, opts = {}) {
  const init = body === undefined ? { method: opts.method || 'GET' } : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: !!opts.keepalive,
  };
  const res = await fetch(path, init);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { text }; }
  if (!res.ok) {
    const err = new Error(data?.error || `${res.status} ${res.statusText}`);
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}

// a project file through the media route (each path part encoded, slashes kept)
export function mediaUrl(id, rel) {
  if (!id || !rel) return null;
  const clean = String(rel).replace(/\\/g, '/').replace(/^\.?\//, '');
  return `/api/media/${encodeURIComponent(id)}/${clean.split('/').map(encodeURIComponent).join('/')}`;
}

// a file as text or JSON, or null when it is not there
export async function fetchText(url) {
  if (!url) return null;
  try { const r = await fetch(url, { cache: 'no-cache' }); return r.ok ? await r.text() : null; } catch { return null; }
}
export async function fetchJson(url) {
  const t = await fetchText(url);
  if (t == null) return null;
  try { return JSON.parse(t); } catch { return null; }
}

// the live channel: on(type, fn) -> off; '*' hears everything; 'socket' hears { up: true|false, again: true when this is a
// reconnect }. A page that missed messages (the link was down) reloads what it shows when it hears `again`. A link that
// went silent is found with a ping (socket-watch.js) and opened again; coming back to the page or the network checks it at once.
export function createSocket() {
  const fns = new Map();
  let ws = null, wait = 500, up = false, timer = null, lastHeard = 0, pingAt = 0, been = false;
  const emit = (type, msg) => {
    for (const fn of [...(fns.get(type) || []), ...(fns.get('*') || [])]) { try { fn(msg); } catch (e) { console.error(e); } }
  };
  function open() {
    clearTimeout(timer); timer = null;
    try { ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`); } catch { return retry(); }
    const mine = ws;
    mine.onopen = () => { if (mine !== ws) return; wait = 500; up = true; lastHeard = Date.now(); pingAt = 0; emit('socket', { type: 'socket', up: true, again: been }); been = true; };
    mine.onmessage = (e) => { if (mine !== ws) return; lastHeard = Date.now(); pingAt = 0; let m; try { m = JSON.parse(e.data); } catch { return; } if (m && m.type) emit(m.type, m); };
    mine.onclose = () => { if (mine !== ws) return; if (up) emit('socket', { type: 'socket', up: false }); up = false; retry(); };
    mine.onerror = () => { try { mine.close(); } catch {} };
  }
  function retry() { clearTimeout(timer); timer = setTimeout(open, wait); wait = Math.min(wait * 2, 8000); }
  // the link is dead: drop it and open a new one at once
  function reopen() {
    const old = ws; ws = null;
    try { old?.close(); } catch {}
    if (up) emit('socket', { type: 'socket', up: false });
    up = false; wait = 500; open();
  }
  function check(quiet) {
    if (!up) return;
    const r = watchStep({ now: Date.now(), lastHeard, pingAt }, quiet === undefined ? {} : { quiet });
    if (r === 'dead') return reopen();
    if (r === 'ping') { pingAt = Date.now(); try { ws.send(JSON.stringify({ type: 'ping', t: pingAt })); } catch {} }
  }
  // not connected and waiting out a pause: try now (the page came back to the front, the network is back)
  function wake() { if (!up && ws?.readyState !== 0) { wait = 500; open(); } else check(3000); }
  setInterval(() => check(), WATCH.every);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake(); });
  if (typeof addEventListener === 'function') addEventListener('online', wake);
  open();
  return {
    on(type, fn) {
      if (!fns.has(type)) fns.set(type, new Set());
      fns.get(type).add(fn);
      return () => fns.get(type)?.delete(fn);
    },
    emit,
    get up() { return up; },
  };
}
