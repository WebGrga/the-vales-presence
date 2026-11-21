// Footage at creation. The New project box takes recordings (drop or choose) and holds them until Create; the uploads then
// start at once, into the new project, with a progress panel that stays while you work (it is on the page, not in a tab).
// A recording that the app window gives with its own path is added by path (Copy or Link, Link above 200 MB, as in the
// media bin: POST .../footage/add); a file from a browser is uploaded as a copy (POST .../footage).
// "By path" adds a recording that stays where it is (a big one on another drive): Copy, Link, or Auto (Link above 200 MB).
//   footagePicker() -> { el, items(), clear(), hasFiles(), onChange(fn) }
//   uploadFootage(app, projectId, title, items)
import { h, icon } from './dom.js';
import { bytesWords } from './home-actions.js';

const MEDIA = /\.(mp4|mkv|mov|webm|m4v|avi|mts|m2ts|wav|mp3|m4a|aac|flac|ogg)$/i;
export const BIG = 200 * 1024 * 1024;
const ownPath = (f) => (f.path && /^([a-z]:[\\/]|\/)/i.test(f.path) ? f.path : null);
const enc = encodeURIComponent;

export function footagePicker() {
  let items = [], change = () => {};
  const input = h('input', { type: 'file', multiple: true, hidden: true, accept: 'video/*,audio/*,.mkv,.mts,.m2ts' });
  const list = h('div.nf-list');
  const note = h('p.nf-note.dim', { role: 'status' });
  const choose = h('button.calm.small', { type: 'button', on: { click: () => input.click() } }, icon('upload', true), h('span', 'Choose recordings'));
  const byPath = h('button.calm.small', { type: 'button', title: 'Add a recording that stays where it is, by its path', on: { click: () => askPath() } }, icon('folder', true), h('span', 'By path'));
  const zone = h('div.nf-zone', { role: 'group', 'aria-label': 'Footage' },
    h('span.nf-hint', 'Drop your recordings here, or '), choose, byPath, h('span.nf-hint.dim', 'Optional: you can add them later in the media bin.'), input);
  const pathRow = h('div.nf-path', { hidden: true });
  function askPath() {
    const box = h('input', { type: 'text', spellcheck: false, placeholder: 'C:\\Videos\\recording.mkv', 'aria-label': 'Path of the recording' });
    const err = h('span.nf-err');
    const go = () => {
      const p = box.value.trim().replace(/^"(.*)"$/, '$1');
      if (!ownPath({ path: p })) { err.textContent = 'Give the whole path, from the drive or the root folder.'; return; }
      if (!MEDIA.test(p)) { err.textContent = 'Only video and sound files can be added.'; return; }
      const name = p.split(/[\\/]/).pop();
      if (!items.some((x) => x.file.path === p)) items.push({ file: { name, size: 0, path: p }, mode: 'auto' });
      pathRow.hidden = true; draw(); change();
    };
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } else if (e.key === 'Escape') { e.stopPropagation(); pathRow.hidden = true; } });
    pathRow.replaceChildren(h('span.nf-hint', 'Where it is:'), box, h('button.calm.small', { type: 'button', on: { click: go } }, 'Add'), err);
    pathRow.hidden = false; box.focus();
  }

  function add(files) {
    const ok = [...files].filter((f) => MEDIA.test(f.name));
    note.textContent = ok.length < files.length ? 'Only video and sound files go into the footage; the others were left out.' : '';
    for (const f of ok) {
      if (items.some((x) => x.file.name === f.name && x.file.size === f.size)) continue;
      items.push({ file: f, mode: ownPath(f) ? (f.size > BIG ? 'link' : 'copy') : null });
    }
    draw(); change();
  }
  function modeSelect(it) {
    const s = h('select', { 'aria-label': `How to add ${it.file.name}` }, it.mode === 'auto' ? h('option', { value: 'auto' }, 'Link if over 200 MB') : null, h('option', { value: 'copy' }, 'Copy it in'), h('option', { value: 'link' }, 'Link it (stays where it is)'));
    s.value = it.mode; s.addEventListener('change', () => { it.mode = s.value; });
    return s;
  }
  function draw() {
    list.replaceChildren(...items.map((it, i) => h('div.nf-row', icon('film', true), h('span.nf-name', { title: it.file.name }, it.file.name), h('span.dim', it.file.size ? bytesWords(it.file.size) : 'by path'),
      it.mode ? modeSelect(it) : null,
      h('button.calm.small.icon-only', { type: 'button', title: 'Take it out of the list', 'aria-label': `Remove ${it.file.name}`, on: { click: () => { items.splice(i, 1); draw(); change(); } } }, '✕'))));
  }
  input.addEventListener('change', () => { add(input.files); input.value = ''; });
  let depth = 0;
  const has = (e) => e.dataTransfer?.types?.includes('Files');
  zone.addEventListener('dragenter', (e) => { if (has(e)) { depth++; zone.classList.add('dropping'); e.preventDefault(); } });
  zone.addEventListener('dragover', (e) => { if (has(e)) e.preventDefault(); });
  zone.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) zone.classList.remove('dropping'); });
  zone.addEventListener('drop', (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); depth = 0; zone.classList.remove('dropping'); add(e.dataTransfer.files); });
  const el = h('div.nf', zone, pathRow, list, note);
  return { el, items: () => items, clear: () => { items = []; draw(); change(); }, hasFiles: () => items.length > 0, onChange: (fn) => { change = fn; }, add };
}

// ---------------------------------------------------------------- the uploads, one after the other, with a panel
let panel = null, active = 0;
addEventListener('beforeunload', (e) => { if (active) { e.preventDefault(); e.returnValue = ''; } });

function panelFor() {
  if (panel?.isConnected) return panel;
  panel = h('div.nu-panel.px-frame', { role: 'status', 'aria-live': 'polite' });
  document.body.append(panel);
  return panel;
}

export function uploadFootage(app, projectId, title, items) {
  if (!items.length) return;
  const box = panelFor();
  const group = h('div.nu-group', h('div.nu-title', icon('upload', true), h('b', `Footage going into “${title}”`)));
  box.append(group);
  box.classList.remove('out'); clearTimeout(box._t);
  const base = `/api/projects/${enc(projectId)}/footage`;
  const rows = items.map((it) => {
    const bar = h('div.nu-bar', h('div'));
    const state = h('span.nu-state.dim', 'waiting');
    const row = h('div.nu-row', h('span.nu-name', { title: it.file.name }, it.file.name), bar, state);
    group.append(row);
    return { it, bar, state, row };
  });
  active += rows.length;
  const finish = () => {
    if (active) return;
    box._t = setTimeout(() => {
      if (active || box.querySelector('.err')) return;
      box.classList.add('out');
      setTimeout(() => { if (box.classList.contains('out')) { box.remove(); panel = null; } }, 400);
    }, 5000);
  };
  (async () => {
    for (const r of rows) {
      let ok = await runOne(app, base, r);
      while (!ok) {
        const retry = await new Promise((res) => {
          r.state.append(' ', h('button.small.calm', { type: 'button', on: { click: () => res(true) } }, 'Try again'), ' ', h('button.small.calm', { type: 'button', on: { click: () => res(false) } }, 'Skip'));
        });
        if (!retry) { r.state.className = 'nu-state dim'; r.state.textContent = 'skipped'; break; }
        ok = await runOne(app, base, r);
      }
      active--;
    }
    finish(); // the server tells the screens (and toasts) as each file lands
  })();
}

// one file: by path (the app window) or streamed up -> true when it is in
function runOne(app, base, r) {
  const { it, bar, state } = r;
  state.className = 'nu-state'; state.textContent = 'starting';
  const done = (text) => { bar.firstChild.style.width = '100%'; state.className = 'nu-state ok'; state.textContent = text; r.row.classList.add('ok'); return true; };
  const path = ownPath(it.file);
  if (path) {
    return app.api(`${base}/add`, { path, mode: it.mode === 'auto' ? undefined : it.mode || undefined })
      .then((x) => done(x.mode === 'link' ? 'linked, not copied' : 'copied in'))
      .catch((e) => { state.className = 'nu-state err'; state.textContent = e.message; return false; });
  }
  return new Promise((ok) => {
    const x = new XMLHttpRequest();
    x.open('POST', base);
    x.setRequestHeader('x-name', /^[ -~]+$/.test(it.file.name) ? it.file.name : enc(it.file.name));
    x.setRequestHeader('content-type', it.file.type || 'application/octet-stream');
    x.upload.onprogress = (e) => { if (e.lengthComputable) { bar.firstChild.style.width = `${(e.loaded / e.total) * 100}%`; state.textContent = `${Math.floor((e.loaded / e.total) * 100)}%`; } };
    x.onload = () => {
      if (x.status >= 200 && x.status < 300) return ok(done('in'));
      let m = x.statusText; try { m = JSON.parse(x.responseText).error || m; } catch {}
      state.className = 'nu-state err'; state.textContent = m; ok(false);
    };
    x.onerror = () => { state.className = 'nu-state err'; state.textContent = 'the server could not be reached'; ok(false); };
    x.send(it.file);
  });
}
