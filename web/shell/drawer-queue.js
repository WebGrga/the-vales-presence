// The drawer's Queue: what runs now, what waits for you and what waits in line behind what, across every project
// (GET /api/queue). Click a project to open it.
import { h, icon } from './dom.js';
import { fmtClock } from './stages.js';

export function mount(host, app) {
  const box = h('div.dq');
  host.append(box);
  let timer = null;

  const open = (id) => { app.select(id); app.drawer?.close(); };
  function who(r, extra) {
    return h('button.dq-row.calm', { type: 'button', title: `Open ${r.title}`, on: { click: () => open(r.project) } },
      h('b', r.title), h('span.dim', r.stageTitle || r.stage || ''), h('div.grow'), extra);
  }
  function section(title, hint, rows) {
    return h('section.dq-sec', h('h3', title), hint ? h('p.dim.dq-hint', hint) : null, ...(rows.length ? rows : [h('p.dim.dq-none', 'None')]));
  }
  function draw(d) {
    if (d.empty) { box.replaceChildren(h('p.dim.dq-empty', 'Nothing runs and nothing waits. When a stage starts in any project, it shows here, and so does anything waiting in line behind it.')); return; }
    const now = Date.now();
    box.replaceChildren(...[
      section('Running now', `${d.slots.used} of ${d.slots.limit} render slot${d.slots.limit === 1 ? '' : 's'} used (Settings: Renders at once).`,
        d.running.map((r) => who(r, h('span.dq-meta', r.asking ? 'asking you' : r.stopAfter ? 'stops after this stage' : r.heavy ? 'render' : '', r.since ? ' ' + fmtClock(now - r.since) : '')))),
      d.inLine.length ? section('In line', 'A render waits until a slot is free.', d.inLine.map((r) => h('div.dq-line', who(r, h('span.dq-meta', `#${r.position}`)),
        h('p.dim.dq-why', icon('clock', true), r.behind.length ? `Waits behind ${r.behind.join(', then ')}.` : 'Next in line.')))) : null,
      section('Waiting for you', null, d.waitingForYou.map((r) => who(r, h('span.dq-meta', r.halted ? 'halted' : r.asking ? 'asking you' : 'your turn'))))].filter(Boolean));
  }
  async function refresh() {
    try { draw(await app.api('/api/queue')); } catch (e) { box.replaceChildren(h('p.dr-err', `The queue did not load: ${e.message}`)); }
  }
  const soon = () => { clearTimeout(timer); timer = setTimeout(() => { if (host.closest('.drawer.in') && !host.hidden) refresh(); }, 400); };
  app.on('queue', soon); app.on('live', soon); app.on('project', soon);
  setInterval(() => { if (host.closest('.drawer.in') && !host.hidden) refresh(); }, 5000);
  return { refresh };
}
