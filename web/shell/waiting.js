// "The agent is waiting for you": whether the open project's agent waits on a question of yours right now, told to
// every part of the screen (the stage chip, the agent panel, a toast, the tab title) as a local 'waiting' message
// { type: 'waiting', project, asking, since }. The rule is pure (askingAfter, tested in waiting.test.js).

// after an agent event, is a question still open? A question opens it; anything the agent does next closes it
// (the tool call that asked is waiting, so nothing else arrives until it is answered or given up).
export function askingAfter(asking, m) {
  if (!m || !m.event) return asking;
  if (m.event === 'question') return true;
  if (['text', 'tool', 'tool_result', 'done', 'error'].includes(m.event)) {
    if (m.event === 'text' && !m.text && !m.start) return asking;
    return false;
  }
  return asking;
}

// the server's view.waiting ({ for: 'question' | 'answer' | 'approve' | 'halt' } or null) -> asking?
export const askingFromView = (w) => w?.for === 'question';

// the agent's status (GET /api/projects/:id/agent) -> asking?
export const askingFromStatus = (s) => !!s?.question;

// the tab title: a mark in front while the agent waits for you
export function pageTitle(project, asking, base = 'The Vale’s Presence') {
  if (!project) return base;
  const name = `${project.title || project.id} · ${base}`;
  return asking ? `(!) Your answer · ${name}` : name;
}

// the tracker: on(project change) reads the agent's status, 'agent' messages keep it current
export function createWaiting(app) {
  let pid = null, asking = false, since = 0;
  const set = (v, live) => {
    if (v === asking) return;
    asking = v; since = v ? Date.now() : 0;
    app.emit('waiting', { type: 'waiting', project: pid, asking, since, live: !!live });
  };
  async function select(id) {
    pid = id || null;
    if (asking) { asking = false; app.emit('waiting', { type: 'waiting', project: pid, asking: false, since: 0 }); }
    if (!pid) return;
    try {
      const s = await app.api(`/api/projects/${encodeURIComponent(pid)}/agent`);
      if (pid === id) set(askingFromStatus(s), false);
    } catch {}
  }
  app.on('agent', (m) => { if (m.project && m.project !== pid) return; set(askingAfter(asking, m), true); });
  // the server's view says it too (view.waiting.for === 'question') once the project is read again
  app.on('project-view', () => { const p = app.project?.(); if (p?.id === pid && p.view && 'waiting' in p.view) set(askingFromView(p.view.waiting), false); });
  return { select, get asking() { return asking; }, get since() { return since; }, recheck: () => select(pid) };
}
