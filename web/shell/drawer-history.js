// The drawer's History: every stage run and chat turn of the open project (GET /api/projects/:id/log), newest first,
// with its time, cost and outcome; a failure says what failed and why. "Only problems" hides the rest.
import { h, icon } from './dom.js';
import { fmtMs, fmtCost, recipeOf } from './stages.js';
import { rows, byDay, clock } from './history-rows.js';

const DOT = { ok: 'keep', failed: 'cross', halted: 'cross', stopped: 'stop', waiting: 'question', running: 'clock', info: 'flag' };

export function mount(host, app) {
  const only = h('input', { type: 'checkbox', id: 'dh-only' });
  const head = h('div.dh-head', h('label.dh-only', only, h('span', 'Only problems')), h('div.grow'), h('span.dim.dh-count'));
  const body = h('div.dh-body');
  host.append(head, body);
  let all = [];
  only.addEventListener('change', draw);

  function draw() {
    const list = only.checked ? all.filter((r) => ['failed', 'halted', 'stopped'].includes(r.outcome)) : all;
    head.querySelector('.dh-count').textContent = list.length ? `${list.length} entr${list.length === 1 ? 'y' : 'ies'}` : '';
    if (!list.length) { body.replaceChildren(h('p.dim.dh-empty', only.checked ? 'No problems in the history.' : 'Nothing has run in this project yet. Each stage and chat turn will be listed here.')); return; }
    body.replaceChildren(...byDay(list).map((g) => h('section.dh-day',
      h('h3', h('span', dayWords(g.day)), h('span.dim', fmtCost(g.cost))),
      ...g.rows.map(row))));
  }
  const dayWords = (d) => { const t = new Date(); const k = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; const y = new Date(t.getTime() - 864e5); return d === k(t) ? 'Today' : d === k(y) ? 'Yesterday' : d; };
  function row(r) {
    return h('div.dh-row.o-' + r.outcome,
      h('div.dh-main', icon(DOT[r.outcome] || 'flag', true), h('span.dh-time', clock(r.t)), h('b.dh-title', r.title || r.stage || ''), h('span.dh-label', r.label),
        h('div.grow'), h('span.dh-meta', [fmtMs(r.ms), fmtCost(r.cost)].filter(Boolean).join(' · '))),
      r.detail ? h('p.dh-detail', r.detail) : null);
  }

  async function refresh() {
    const p = app.project();
    if (!p) { all = []; draw(); return; }
    try {
      const d = await app.api(`/api/projects/${encodeURIComponent(p.id)}/log`);
      if (app.project()?.id !== p.id) return;
      const r = recipeOf(p);
      const names = Object.fromEntries((r?.stages || []).map((s) => [s.id, s.title || s.id]));
      all = rows(d.log || [], { titleOf: (id) => names[id] || id, running: p.view?.running?.stage || null, asking: p.view?.waiting?.for === 'question' || !!app.waiting?.asking });
      draw();
    } catch (e) { body.replaceChildren(h('p.dr-err', `The history did not load: ${e.message}`)); }
  }
  let t = null;
  const soon = () => { clearTimeout(t); t = setTimeout(() => { if (host.closest('.drawer.in') && !host.hidden) refresh(); }, 600); };
  app.on('project', soon); app.on('agent', (m) => { if (m.event === 'done') soon(); });
  return { refresh };
}
