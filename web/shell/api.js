// The server, seen from the page: JSON calls to /api, the WebSocket at /ws (reconnects by itself), and file urls.

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

// the live channel: on(type, fn) -> off; '*' hears everything; 'socket' hears { up: true|false }
export function createSocket() {
  const fns = new Map();
  let ws = null, wait = 500, up = false;
  const emit = (type, msg) => {
    for (const fn of [...(fns.get(type) || []), ...(fns.get('*') || [])]) { try { fn(msg); } catch (e) { console.error(e); } }
  };
  function open() {
    try { ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`); } catch { return retry(); }
    ws.onopen = () => { wait = 500; up = true; emit('socket', { type: 'socket', up: true }); };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } if (m && m.type) emit(m.type, m); };
    ws.onclose = () => { if (up) emit('socket', { type: 'socket', up: false }); up = false; retry(); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  function retry() { setTimeout(open, wait); wait = Math.min(wait * 2, 8000); }
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
