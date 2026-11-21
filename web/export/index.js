// The Export tab: the video, subtitles and the edit list for other programs (POST /api/export/:id {kind}), with download
// links and the time each took; and each cut Short of the project the same way (POST {kind, short}).
import { h, icon } from '../shell/dom.js';
import { ensureCss } from '../setup/first.js';
import { sizeText, ago, latest, ready } from './view.js';

let FORMATS = null;
async function formats() {
  if (!FORMATS) FORMATS = (await (await fetch(new URL('./formats.json', import.meta.url), { cache: 'no-cache' })).json()).formats;
  return FORMATS;
}
// what a Short offers: its video and its subtitles first, the edit lists after
const SHORT_KINDS = ['mp4', 'srt', 'fcpxml', 'otio'];

export async function mount(el, app) {
  ensureCss(new URL('./export.css', import.meta.url));
  const root = h('div.export');
  el.append(root);
  const p = app.project();
  if (!p) { root.append(h('h2', 'Export'), h('p.muted', 'Open a project first.')); return { unmount() {} }; }
  const id = encodeURIComponent(p.id);
  const fmts = await formats();
  let state = { files: [], has: {}, shorts: [] };
  const last = {}; // short:kind -> the answer of the last export in this session (ms, note)
  const busy = new Set();

  const list = h('div.export-list');
  const shortsBox = h('div.export-shorts');
  root.append(
    h('div.export-head', h('h2', 'Export'), h('p.muted', 'Everything here is made on this machine from the approved edit. Nothing is uploaded.')),
    list, shortsBox);

  async function refresh() {
    try { state = await app.api(`/api/export/${id}`); } catch (e) { state = { files: [], has: {}, shorts: [], error: e.message }; }
    draw();
  }

  function draw() {
    const main = { short: '', has: state.has, files: state.files };
    // a Shorts project has no video of its own: its Shorts are what it exports
    const own = fmts.some((f) => ready(f, state.has)) || !state.shorts?.length;
    list.replaceChildren(...(own ? fmts.map((f) => card(f, main)) : []));
    list.hidden = !own;
    const shorts = state.shorts || [];
    shortsBox.replaceChildren(...(shorts.length ? [
      h('h3.export-sub', `Shorts (${shorts.length})`),
      ...shorts.map((s) => h('div.export-short',
        h('div.export-name.pixel', s.title && s.title !== s.id ? `${s.id}: ${s.title}` : s.id),
        h('div.export-list', ...fmts.filter((f) => SHORT_KINDS.includes(f.kind)).map((f) => card(f, { short: s.id, has: s.has, files: s.files }, true))))),
    ] : []));
  }

  function card(f, t, small = false) {
    const key = `${t.short}:${f.kind}`;
    const ok = ready(f, t.has);
    const file = latest(t.files, f.kind);
    const done = last[key];
    const working = busy.has(key);
    const btn = h('button', { type: 'button', class: ok ? 'go' : 'calm', disabled: !ok || working, on: { click: () => run(f, t) } },
      icon(working ? 'clock' : 'export', true), h('span', working ? 'Working…' : f.button));
    const result = file
      ? h('div.export-file',
        h('a.export-dl', { href: file.url, download: file.file.split('/').pop() }, icon('export', true), h('span', file.file.split('/').pop())),
        h('span.dim', `${sizeText(file.size)} · ${ago(file.mtime)}${f.kind === 'mp4' && file.which === 'rough' ? ' · the rough (no final yet)' : ''}`),
        done ? h('span.export-time', `made in ${done.ms < 1000 ? `${done.ms} ms` : `${(done.ms / 1000).toFixed(1)} s`}`) : null)
      : null;
    return h('div.export-card', { class: [ok ? '' : 'is-off', small ? 'is-small' : ''].join(' ') },
      small ? null : h('img.icon', { src: `/icons/${f.icon}.png`, alt: '' }),
      h('div.export-body',
        h('div.export-name.pixel', f.name),
        small ? null : h('p', f.what),
        small ? null : h('p.export-opens', h('span.pixel', 'Opens in: '), f.opens),
        ok ? null : h('p.export-need', needText(f, t.short)),
        done?.note ? h('p.dim', done.note) : null,
        result),
      h('div.export-act', btn));
  }

  function needText(f, short) {
    const what = short ? 'This Short' : 'There';
    if (f.kind === 'mp4') return short ? 'This Short has no video yet.' : 'There is no video yet: the rough cut makes one.';
    if (f.kind === 'srt') return short ? 'This Short has no words yet.' : 'There are no words yet: they come when the rough is handed over.';
    return short ? `${what} has no edit list yet.` : 'There is no edit list yet: the rough cut writes it.';
  }

  async function run(f, t) {
    const key = `${t.short}:${f.kind}`;
    busy.add(key); draw();
    try {
      const r = await app.api(`/api/export/${id}`, t.short ? { kind: f.kind, short: t.short } : { kind: f.kind });
      last[key] = r;
      if (f.kind === 'mp4') { const a = h('a', { href: r.url, download: r.file.split('/').pop() }); document.body.append(a); a.click(); a.remove(); }
      app.toast(`${t.short ? `${t.short}: ` : ''}${f.name}: ${r.file.split('/').pop()}`);
    } catch (e) { app.toast(`${f.name} did not export: ${e.message}`, 'error'); }
    busy.delete(key);
    await refresh();
  }

  const offs = [
    app.on('files', (m) => { if (!m.project || m.project === p.id) refresh(); }),
    app.on('project', () => refresh()),
  ];
  draw();
  await refresh();
  return { unmount() { for (const off of offs) try { off?.(); } catch {} } };
}
