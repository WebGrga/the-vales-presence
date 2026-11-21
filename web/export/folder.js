// "Export to a folder" on the Export tab: pick a preset (YouTube 1080p, Shorts, small preview), a folder (remembered), and Export; the
// progress and Cancel while it renders; "Export all kept Shorts"; and the history of every render with Show in folder.
// POST /api/export/:id/render | cancel | reveal (server/routes/export.js). The decisions are pure (view.js).
import { h, icon } from '../shell/dom.js';
import { sizeText, ago, jobText, historyLine } from './view.js';

const KEY = 'presence.export.folder', PRESET = 'presence.export.preset';

export function folderPanel({ app, id, refresh }) {
  let state = { presets: [], history: [], shorts: [], has: {} }, job = null, preset = localStorage.getItem(PRESET) || 'youtube', busy = false;
  const folder = h('input', { type: 'text', spellcheck: false, placeholder: 'C:\\Exports (the whole path of a folder)', 'aria-label': 'Folder to export to' });
  folder.addEventListener('input', () => localStorage.setItem(KEY, folder.value));
  const presets = h('div.export-presets');
  const bar = h('div.export-bar', h('i'));
  const status = h('p.export-status');
  const acts = h('div.export-actions');
  const history = h('div.export-history');
  const err = h('p.export-need', { hidden: true });
  const el = h('section.export-folder.px-frame',
    h('h3.export-sub', 'Export to a folder'),
    h('p.dim', 'Makes a new file in the folder you choose, named with the date and time, so an older version is never overwritten.'),
    h('label.export-field', h('span', 'Folder'), folder), presets, err, acts, bar, status, history);

  const own = () => ['final', 'rough'].some((k) => state.has?.[k]);
  const kept = () => (state.shorts || []).filter((s) => s.kept);
  const running = () => job?.state === 'running';

  async function start(all) {
    if (busy || running()) return;
    err.hidden = true; busy = true; draw();
    try {
      localStorage.setItem(KEY, folder.value); localStorage.setItem(PRESET, preset);
      const r = await app.api(`/api/export/${id}/render`, { preset, folder: folder.value, all: all || undefined });
      job = r.job; if (r.started) app.toast(`Exporting ${r.started} Short${r.started > 1 ? 's' : ''}, one after the other.`);
    } catch (e) { err.textContent = e.message; err.hidden = false; }
    busy = false; draw();
  }
  async function cancel() { try { await app.api(`/api/export/${id}/cancel`, { job: job.id }); } catch (e) { app.toast(e.message, 'error'); } }
  async function show(file) { try { await app.api(`/api/export/${id}/reveal`, { file }); } catch (e) { app.toast(e.message, 'error'); } }

  function draw() {
    // while one renders, the preset that renders is the selected one (whatever was chosen before), the others wait dimmed
    const chosen = running() && job.preset ? job.preset : preset;
    presets.replaceChildren(...(state.presets || []).map((p) => h('button.export-preset' + (p.id === chosen ? '.on' : '') + (running() && p.id === chosen ? '.rendering' : ''), { type: 'button', 'aria-pressed': p.id === chosen, disabled: running(), on: { click: () => { preset = p.id; draw(); } } },
      h('span.pixel', p.name), h('span.dim', p.about))));
    const n = kept().length;
    acts.replaceChildren(...[
      own() ? h('button.go', { type: 'button', disabled: busy || running(), on: { click: () => start(false) } }, icon('export', true), h('span', 'Export the video')) : null,
      n ? h(own() ? 'button.calm' : 'button.go', { type: 'button', disabled: busy || running(), title: 'Every cut Short that is not marked Redo', on: { click: () => start(true) } }, icon('phone', true), h('span', `Export all kept Shorts (${n})`)) : null,
      !own() && !n ? h('p.dim', 'There is no video to export yet: the rough cut makes one.') : null,
      running() ? h('button.calm', { type: 'button', on: { click: cancel } }, icon('stop', true), h('span', 'Cancel')) : null].filter(Boolean));
    bar.hidden = !running() && job?.state !== 'done';
    bar.firstChild.style.width = `${job ? job.pct || 0 : 0}%`;
    status.textContent = jobText(job);
    status.dataset.s = job?.state || '';
    history.replaceChildren(...(state.history?.length ? [h('h3.export-sub', 'Earlier exports'),
      ...state.history.map((e) => { const l = historyLine(e, state.shorts); return h('div.export-file' + (e.exists ? '' : '.is-gone'),
        h('span.pixel', l.title), h('span.dim', `${sizeText(e.size)} · ${ago(e.at)}${e.older ? ' · older version' : ''}`), h('span.dim.export-path', { title: e.file }, e.exists ? e.folder : 'moved or deleted'),
        e.exists ? h('button.small.calm', { type: 'button', on: { click: () => show(e.file) } }, icon('folder', true), h('span', 'Show in folder')) : null); })] : []));
  }

  function update(s) {
    state = s;
    if (!folder.value) folder.value = s.folder || localStorage.getItem(KEY) || '';
    if (!s.presets?.some((p) => p.id === preset)) preset = 'youtube';
    if (s.render && !job) job = s.render;
    draw();
  }
  const off = app.on('export', (m) => {
    if (m.project !== id && m.project !== decodeURIComponent(id)) return;
    const was = job?.state;
    job = m.job;
    if (job.state !== 'running' && was === 'running') {
      if (job.state === 'done') app.toast(`Exported ${job.name}${job.batch ? ` (${job.batch.n} of ${job.batch.of})` : ''}.`, 'ok');
      else if (job.state === 'error') { err.textContent = `The export stopped: ${job.error}`; err.hidden = false; }
      else app.toast('Export cancelled. Nothing was left behind.');
      refresh();
    }
    draw();
  });
  return { el, update, dispose: () => off?.() };
}
