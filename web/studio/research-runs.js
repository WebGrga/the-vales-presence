// Research history: every search is kept as a run with its phrases and date. The ticked runs are the current
// ones, which the other Studio pages read; tick several to merge them, or use "Only this" to switch.
import { h } from '../shell/dom.js';
import { duration, costText } from './research-bar.js';

const when = (iso) => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'earlier';
};

export function runsPanel(ctx, onReuse) {
  const list = h('div.st-runlist');
  const note = h('p.dim.st-runs-note');
  const el = h('details.px-frame.st-runs', h('summary', h('b', 'Runs'), h('span.dim.st-runs-count')), note, list);
  const count = el.querySelector('.st-runs-count');
  let data = null, cur = [], chain = Promise.resolve();

  // every click counts, in order: the ticked ids are tracked here and sent one after another
  function use(ids) {
    if (!ids.length) { ctx.toast('At least one run has to be showing.', 'error'); render(data); return; }
    cur = ids;
    chain = chain.then(() => ctx.api(`/api/studio/${ctx.id}/research/use`, { ids })).then(() => ctx.reload()).catch((e) => { ctx.toast(e.message || String(e), 'error'); ctx.reload(); });
  }

  function row(r) {
    const on = data.current.includes(r.id);
    const tick = h('input', { type: 'checkbox', checked: on, 'aria-label': `Use the run of ${when(r.at)}` });
    tick.addEventListener('change', () => use(tick.checked ? [...cur, r.id] : cur.filter((x) => x !== r.id)));
    const how = r.legacy ? 'found by the agent before runs were kept' : r.by === 'agent' ? 'run by the agent' : `${duration(r.ms)}, ${costText(r)}`;
    return h('div.st-run' + (on ? '.on' : ''),
      h('label', tick, h('span.st-run-when', when(r.at))),
      h('span.st-run-body',
        h('span.st-run-phrases', r.phrases.length ? r.phrases.map((p) => `“${p}”`).join(' ') : 'no phrases saved'),
        h('span.dim', `${r.count} videos · ${how}${r.partial ? ' · stopped early' : ''}`)),
      h('span.st-run-acts',
        data.runs.length > 1 && !(on && data.current.length === 1) ? h('button.small.calm', { type: 'button', on: { click: () => use([r.id]) } }, 'Only this') : null,
        r.phrases.length ? h('button.small.calm', { type: 'button', title: 'Put this run’s phrases and options in the search bar', on: { click: () => onReuse(r) } }, 'Use phrases') : null));
  }

  function render(r) {
    data = r; cur = [...r.current];
    el.hidden = !r.runs.length;
    count.textContent = r.runs.length ? ` ${r.runs.length} · showing ${r.current.length === 1 ? '1 run' : `${r.current.length} merged`}` : '';
    if (r.runs.length > 1 && !el.dataset.seen) { el.open = true; el.dataset.seen = '1'; }
    note.textContent = r.runs.length > 1 ? 'Tick runs to merge them, or switch to one. The ticked runs are what the other pages (Titles, Thumbnails, Feed) and the agent read. Nothing is overwritten.' : 'Every search is kept here.';
    list.replaceChildren(...[...r.runs].reverse().map(row));
  }

  return { el, render };
}
