// The agent panel: what the project's agent says and does, live ('agent' messages): its text as markdown (timecodes
// play from there), each tool as one line in the agent's own words (paths relative to the project; the details fold
// out), its questions as one card answered as a set (agent-question.js), each turn's time and cost, background tasks
// ('fire') as one row each, and a box to talk to it (Enter sends, Shift+Enter a new line; the text is kept as a draft).
// While it waits for you the panel says so in orange; Stop shows only while it works.
import { h, icon, button } from '../shell/dom.js';
import { createDraft, bindDraft } from '../shell/drafts.js';
import { fmtMs, fmtCost } from '../shell/stages.js';
import { markdown } from '../shell/markdown.js';
import { toolLine, fireLabel, shortCommand } from './agent-lines.js';
import { createQuestionCard } from './agent-question.js';
import { questionKey } from './agent-ask.js';

const MAX_ITEMS = 400;

export function createAgentPanel(app, projectId) {
  const enc = encodeURIComponent;
  const state = h('span.ag-state', { role: 'status' });
  const log = h('div.ag-log', { 'aria-live': 'polite' });
  const draft = createDraft(projectId, 'agent-say');
  const box = bindDraft(h('textarea.ag-box', { rows: 2, placeholder: 'Talk to the agent… (Enter sends, Shift+Enter a new line)' }), draft);
  const send = button('send', '', 'Send (Enter)', () => say(), 'go');
  const stopBtn = button('stop', 'Stop', 'Stop the agent', () => stop(), 'warn small');
  const head = h('div.ag-head', state, h('div.grow'), stopBtn);
  const el = h('div.agent', head, log, h('div.ag-say', box, send));
  let text = null, busy = false, asking = false, asleep = false;
  const tools = new Map(), fires = new Map(), bashDesc = new Map(), cards = [];
  let askToolId = null;

  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); say(); } });

  // the state line and Stop move up into the panel's own head once the panel is placed (one row less)
  requestAnimationFrame(() => {
    const panel = el.closest('.panel'), ph = panel?.querySelector('.panel-head');
    if (ph) { ph.append(state, stopBtn); head.hidden = true; panel.classList.add('ag-panel'); paintState(); }
  });

  function paintState() {
    state.textContent = asking ? 'Waiting for your answer' : asleep ? 'Asleep while its task runs' : busy ? 'Working…' : 'Idle';
    state.className = 'ag-state ' + (asking ? 'ask' : busy ? 'busy' : asleep ? 'asleep' : '');
    stopBtn.hidden = !(busy || asleep) || asking;
    el.classList.toggle('asking', asking);
    el.closest('.panel')?.classList.toggle('asking', asking);
  }
  function setBusy(b, sleeping) { busy = b; asleep = !!sleeping; paintState(); }
  function add(node) {
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    log.append(node);
    while (log.children.length > MAX_ITEMS) log.firstElementChild.remove();
    if (stick) log.scrollTop = log.scrollHeight;
    return node;
  }
  // a text block: its markdown drawn again at most once a frame while it streams
  function paintText(node) {
    if (node._queued) return;
    node._queued = true;
    requestAnimationFrame(() => {
      node._queued = false;
      const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
      node.innerHTML = markdown(node._raw);
      if (stick) log.scrollTop = log.scrollHeight;
    });
  }
  function closeCards(word) { for (const c of cards) if (c.live) c.close(word || 'The agent went on without waiting for more.', false); }

  function show(m, live) {
    const moves = m.event !== 'question' && (m.event !== 'text' || m.text || m.start) && !(m.event === 'tool' && m.tool === 'AskUserQuestion');
    if (moves) { if (asking && live) { asking = false; paintState(); } closeCards(); }
    switch (m.event) {
      case 'text': {
        if (m.start || !text) { text = add(h('div.ag-text.md')); text._raw = ''; if (live) setBusy(true); }
        if (m.text) { text._raw += m.text; paintText(text); }
        break;
      }
      case 'tool': {
        text = null;
        const input = m.input && typeof m.input === 'object' ? m.input : {};
        if (m.tool === 'AskUserQuestion') { askToolId = m.id || null; break; } // the question card shows it
        const line = toolLine(m.tool, input, projectId);
        if ((m.tool === 'Bash' || m.tool === 'PowerShell') && input.command) bashDesc.set(String(input.command).trim(), input.description || '');
        const detail = Object.entries(input).filter(([k]) => k !== 'description')
          .map(([k, v]) => `${k}: ${typeof v === 'string' ? shortCommand(v, projectId) : JSON.stringify(v)}`).join('\n');
        const d = h('details.ag-tool' + (m.refused ? '.refused' : ''),
          h('summary', { title: `${m.tool || 'tool'}: ${line.title}` }, h('span.ag-tool-name', m.tool || 'tool'), h('span.ag-tool-t', line.title), line.detail ? h('span.ag-tool-d', line.detail) : null),
          h('pre', detail.slice(0, 4000) || '(nothing)'));
        if (m.refused) d.querySelector('summary').append(h('span.ag-tool-r', 'not allowed here'));
        if (m.id) tools.set(m.id, d);
        add(d);
        if (live) setBusy(true);
        break;
      }
      case 'tool_result': {
        if (m.id && m.id === askToolId) { const c = cards[cards.length - 1]; if (c) c.close(m.isError ? 'Not answered.' : 'Answered.', !m.isError); break; }
        const d = tools.get(m.id);
        if (d) { d.append(h('pre.ag-result' + (m.isError ? '.err' : ''), shortCommand(String(m.text || ''), projectId).slice(0, 4000) || '(no output)')); if (m.isError) d.classList.add('err'); }
        break;
      }
      case 'question': {
        text = null;
        const qs = Array.isArray(m.questions) && m.questions.length ? m.questions : [{ question: m.text || 'The agent asks something' }];
        closeCards('A newer question came.');
        const card = createQuestionCard({ app, projectId, questions: qs, open: live || m._open === true });
        cards.push(card);
        add(card.el);
        if (live) { asking = true; setBusy(false); card.focus(); }
        break;
      }
      case 'done': {
        text = null;
        const bits = [fmtMs(m.ms), fmtCost(m.cost)].filter(Boolean).join(' · '); // the same count as the stage chips
        add(h('div.ag-done' + (m.error ? '.err' : ''), icon(m.asleep ? 'clock' : m.error ? 'cross' : 'keep', true),
          h('span', m.asleep ? 'Asleep while its task runs' : m.error ? 'Stopped' : 'Done'), bits ? h('span.dim', bits) : null, m.note ? h('span.dim', m.note) : null));
        if (live) setBusy(false, m.asleep);
        break;
      }
      case 'error': {
        text = null;
        add(h('div.ag-error', icon('cross', true), h('span', m.text || 'Something went wrong')));
        if (live) setBusy(false);
        break;
      }
      default: break;
    }
  }

  // a background task: one row, which says "finished" when it ends
  function fire(m) {
    text = null;
    const label = fireLabel(m.cmd, bashDesc.get(String(m.cmd || '').trim()));
    let row = m.id ? fires.get(m.id) : null;
    if (!row) {
      row = add(h('div.ag-fire', { title: shortCommand(m.cmd, projectId) }, icon('film', true), h('span.ag-fire-t'), h('code', shortCommand(m.cmd, projectId).slice(0, 160))));
      if (m.id) fires.set(m.id, row);
    }
    const done = m.state === 'done';
    row.classList.toggle('done', done);
    row.querySelector('img').src = `/icons/${done ? 'keep' : 'film'}.png`;
    row.querySelector('.ag-fire-t').textContent = done ? `${label}: finished` : `${label} in the background; the agent sleeps until it ends`;
  }

  // a question card that closed (answered, or the agent no longer waits): the panel stops asking; the shell checks again
  log.addEventListener('ask-closed', () => {
    if (cards.some((c) => c.live) || !asking) return;
    asking = false; paintState();
    app.waiting?.recheck?.();
  });

  // a timecode in the agent's text plays the edit from there
  log.addEventListener('click', (e) => {
    const tc = e.target.closest('.tc'); if (!tc) return;
    const t = Number(tc.dataset.t);
    const ui = window.presence?.editor?.ui;
    if (ui?.seek && Number.isFinite(t)) ui.seek(t, { play: true });
    else app.emit('seek', { type: 'seek', t });
  });

  async function say() {
    const t = box.value.trim(); if (!t) return;
    send.disabled = true;
    add(h('div.ag-you', h('b', 'You'), h('span', t)));
    try {
      const r = await app.api(`/api/projects/${enc(projectId)}/say`, { text: t });
      box.value = ''; draft.clear(); setBusy(true);
      if (r?.queued) add(h('p.dim.ag-note', 'It is working: it reads this between its steps.'));
    } catch (e) { app.toast('The agent did not get it: ' + e.message, 'error'); }
    send.disabled = false;
  }
  async function stop() {
    try { await app.api(`/api/projects/${enc(projectId)}/stop`, {}); } catch (e) { app.toast('Stop: ' + e.message, 'error'); }
  }

  // what was said before this page opened, then live. It is read again when the link comes back after a break (the server
  // restarted, the page slept): what the agent said meanwhile is in the server's record, and the panel's own state (working,
  // waiting for an answer) is the server's, not what this page last heard. Live messages that come while it reads are
  // left out: the record has them.
  let loading = false, loadedAt = 0;
  async function loadHistory() {
    if (loading) return;
    loading = true;
    try {
      const s = await app.api(`/api/projects/${enc(projectId)}/agent`);
      log.replaceChildren(); text = null; tools.clear(); fires.clear(); bashDesc.clear(); cards.length = 0; askToolId = null; asking = false;
      const openKey = s?.question ? questionKey(s.question.questions || []) : null;
      const events = s?.events || [];
      const lastQ = events.map((m) => m.event).lastIndexOf('question');
      events.forEach((m, i) => show(i === lastQ && openKey && questionKey(m.questions || []) === openKey ? { ...m, _open: true } : m, false));
      asking = !!s?.question;
      if (asking && !cards.some((c) => c.live)) { const c = createQuestionCard({ app, projectId, questions: s.question.questions || [], open: true }); cards.push(c); add(c.el); }
      setBusy(!!s?.busy && !asking, !!s?.asleep);
      log.scrollTop = log.scrollHeight;
      loadedAt = Date.now();
    } catch { if (!loadedAt) setBusy(false); }
    loading = false;
    if (!log.children.length) add(h('p.dim.ag-empty', 'The agent’s work shows here as it happens. Ask it anything below.'));
  }
  loadHistory();
  const offs = [
    app.on('agent', (m) => { if (m.project === projectId && !loading) { log.querySelector('.ag-empty')?.remove(); show(m, true); } }),
    app.on('fire', (m) => { if (m.project === projectId && !loading) fire(m); }),
    app.on('socket', (m) => { if (m.up && m.again) loadHistory(); }),
    app.on('focus-question', () => { const c = [...cards].reverse().find((x) => x.live); setTimeout(() => (c ? c.focus() : box.focus()), 80); }),
  ];
  paintState();
  return { el, dispose() { offs.forEach((o) => o()); draft.flush(); }, get busy() { return busy; }, get asking() { return asking; } };
}
