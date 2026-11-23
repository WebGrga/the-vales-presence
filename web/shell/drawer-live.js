// The drawer's Live log: the agent's last steps in plain words (the Bash description, not the raw command), newest at
// the bottom, kept up to date from the live messages. The whole conversation, with its questions and your answers,
// is in the Edit tab's Agent panel: a button goes there.
import { h, icon } from './dom.js';
import { toolLine } from '../editor/agent-lines.js';
import { fmtMs, fmtCost } from './stages.js';

const MAX = 150;
const clock = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`; };

export function mount(host, app) {
  const list = h('div.dl-list', { 'aria-live': 'polite' });
  const empty = h('p.dim.dl-empty');
  const open = h('button.small.calm', { type: 'button', title: 'The whole conversation, with its questions', on: { click: () => { app.openTab('edit'); app.drawer?.close(); } } }, icon('agent', true), h('span', 'Open the full conversation (Edit tab)'));
  host.append(h('div.dl-top', open), empty, list);
  let pid = null, text = null;
  const said = () => { const s = app.activity?.state?.(); empty.textContent = s?.busy ? 'The agent is working: its first step shows here in a moment.' : s?.asleep ? 'The agent is waiting for its background task to end.' : 'The agent is not doing anything right now. When it works, each step shows here.'; };

  function add(m, t) {
    if (m.event === 'tool') {
      if (m.tool === 'AskUserQuestion') return line('question', 'Asked you something', '', t);
      const l = toolLine(m.tool, m.input, pid);
      text = null;
      return line(m.refused ? 'cross' : 'film', l.title, l.detail, t, m.refused ? 'not allowed here' : '');
    }
    if (m.event === 'text') {
      if (!m.text && !m.start) return;
      if (m.start) { text = null; if (!m.text) return; }
      if (!text) text = line('agent', '', '', t);
      text._raw = (text._raw || '') + (m.text || '');
      text.querySelector('.dl-t').textContent = `Says: ${text._raw.replace(/\s+/g, ' ').trim().slice(-220)}`;
      return;
    }
    text = null;
    if (m.event === 'done') return line(m.error ? 'cross' : 'keep', m.asleep ? 'Asleep while its task runs' : m.error ? 'Stopped' : 'Done', [fmtMs(m.ms), fmtCost(m.cost)].filter(Boolean).join(' · '), t);
    if (m.event === 'error') return line('cross', m.text || 'Something went wrong', '', t, 'error');
    if (m.event === 'question') return line('question', 'Asks you something', '', t);
  }
  function line(ic, title, detail, t, tag) {
    const row = h('div.dl-row' + (tag ? '.bad' : ''), icon(ic, true), h('span.dl-time', clock(t || Date.now())), h('span.dl-t', title), detail ? h('span.dl-d', detail) : null, tag ? h('span.dl-tag', tag) : null);
    const stick = list.scrollTop + list.clientHeight >= list.scrollHeight - 40;
    list.append(row); empty.hidden = true;
    while (list.children.length > MAX) list.firstElementChild.remove();
    if (stick) list.scrollTop = list.scrollHeight;
    return row;
  }

  async function refresh() {
    const p = app.project();
    if (!p) { list.replaceChildren(); said(); empty.hidden = false; pid = null; return; }
    pid = p.id; text = null;
    try {
      const s = await app.api(`/api/projects/${encodeURIComponent(p.id)}/agent`);
      if (app.project()?.id !== p.id) return;
      list.replaceChildren(); said(); empty.hidden = false;
      for (const e of (s.events || []).slice(-MAX)) add(e, e.t);
      list.scrollTop = list.scrollHeight;
    } catch (e) { list.replaceChildren(); empty.textContent = `The log did not load: ${e.message}`; empty.hidden = false; }
  }
  app.on('agent', (m) => { if (m.project === pid) add(m, Date.now()); });
  app.on('socket', (m) => { if (m.up && m.again && pid) refresh(); }); // the link came back: what it missed is in the record
  return { refresh };
}
