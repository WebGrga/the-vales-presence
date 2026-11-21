// Never lose a typed word: every edit is kept in localStorage at once and sent to the server soon after.
// The draft is dropped only when the server has the same text. A reload or a crash brings the draft back.
const KEY = (project, name) => `presence.studio.${project}.${name}`;

export function keepDraft(project, name, value, base) {
  try { localStorage.setItem(KEY(project, name), JSON.stringify({ value, base, at: Date.now() })); } catch {}
}

export function takeDraft(project, name) {
  try { const s = localStorage.getItem(KEY(project, name)); return s ? JSON.parse(s) : null; } catch { return null; }
}

// drop the draft when the server holds exactly this value
export function settleDraft(project, name, saved) {
  const d = takeDraft(project, name);
  if (d && JSON.stringify(d.value) === JSON.stringify(saved)) { try { localStorage.removeItem(KEY(project, name)); } catch {} }
}

export function dropDraft(project, name) { try { localStorage.removeItem(KEY(project, name)); } catch {} }

// a saver: send(value) after ms of quiet; flush() on hide; status(text) tells the user where the words are
export function saver({ send, ms = 450, status = () => {} }) {
  let timer = null, last = null, inflight = Promise.resolve();
  const run = () => {
    timer = null;
    const v = last;
    status('saving');
    inflight = inflight.then(() => send(v)).then(() => status('saved')).catch((e) => { status('error', e); timer = setTimeout(run, 3000); });
    return inflight;
  };
  return {
    push(v) { last = v; status('typing'); clearTimeout(timer); timer = setTimeout(run, ms); },
    flush() { if (timer) { clearTimeout(timer); return run(); } return inflight; },
    pending: () => !!timer,
  };
}

// a last chance when the page goes away: sendBeacon survives the unload where fetch may not
export function beacon(path, body) {
  try { return navigator.sendBeacon(path, new Blob([JSON.stringify(body)], { type: 'application/json' })); } catch { return false; }
}
