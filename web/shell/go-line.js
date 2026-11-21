// Before Go: one small line under the stage bar naming the stage, how many skills it reads, and its usual time from past
// runs on this computer, with the prompt one click away (GET /api/projects/:id/go-info and /prompt). It shows only while
// Go is what the project offers.
import { h } from './dom.js';
import { ask } from './home-dialog.js';
import { fmtMs } from './stages.js';
import { roughWords } from './go-words.js';

export function mountGoLine(host, app) {
  const text = h('span.go-text');
  const see = h('button.small.calm.go-see', { type: 'button', on: { click: () => showPrompt() } }, 'See the prompt');
  const el = h('div.go-line', { hidden: true }, text, see);
  host.append(el);
  let key = '', seq = 0;

  async function refresh() {
    const p = app.project();
    const can = !!p && !p.halted && (p.view?.actions || []).includes('go') && !(app.waiting?.asking);
    if (!can) { el.hidden = true; key = ''; return; }
    const k = `${p.id}:${p.at}`;
    if (k === key && !el.hidden) return;
    key = k;
    const mine = ++seq;
    try {
      const { info } = await app.api(`/api/projects/${encodeURIComponent(p.id)}/go-info`);
      if (mine !== seq || !info) { if (mine === seq) el.hidden = true; return; }
      text.textContent = roughWords(info, fmtMs);
      el.title = info.names?.length ? `Skills it reads: ${info.names.join(', ')}` : 'No skills are switched on for this stage';
      el.hidden = false;
    } catch { el.hidden = true; }
  }

  async function showPrompt() {
    const p = app.project(); if (!p) return;
    let t = '';
    try { t = (await app.api(`/api/projects/${encodeURIComponent(p.id)}/prompt`)).prompt || ''; } catch (e) { t = `The prompt could not be read: ${e.message}`; }
    const pre = h('pre.go-prompt', t || '(nothing)');
    const closed = await ask({ title: 'What the agent will be told', body: [h('p.dim', 'This is the message the stage sends, with its skills, your house rules and your brief. Nothing is sent until you press Go.'), pre], ok: 'Close', cancel: 'Copy it' });
    if (!closed) { try { await navigator.clipboard.writeText(t); app.toast('Copied.', 'ok'); } catch { app.toast('Copy did not work: select the text instead.', 'error'); } }
  }

  let t = null;
  const soon = () => { clearTimeout(t); t = setTimeout(refresh, 120); };
  for (const type of ['project', 'project-view', 'select', 'waiting']) app.on(type, soon);
  return { refresh };
}
