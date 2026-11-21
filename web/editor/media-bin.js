// The media bin: the project's footage (GET .../footage), which recordings the edit uses, the rough; drop files on it
// (or on the whole editor) to add footage: each file goes up as its own raw body with an x-name header and a progress
// bar. Click a recording to play it from the start in Before. "By path" adds a recording where it is (Link, saves space) or as a copy;
// each row has Rename, Replace, Find again (a linked file that moved shows as missing) and Remove (media-bin-actions.js).
import { h, icon, button } from '../shell/dom.js';
import { binActions } from './media-bin-actions.js';
import { began, ended, lostFor, clear } from '../shell/upload-lost.js';

const VIDEO = /\.(mp4|mkv|mov|webm|m4v|avi|mts|m2ts)$/i, AUDIO = /\.(wav|mp3|m4a|aac|flac|ogg)$/i;
const size = (n) => (n > 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n > 1e6 ? Math.round(n / 1e6) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB');

export function createMediaBin(app, store, ui) {
  const S = store.S, pid = store.S.id, enc = encodeURIComponent;
  const list = h('div.bin-list');
  const input = h('input', { type: 'file', multiple: true, accept: 'video/*,audio/*', hidden: true });
  const add = button('upload', 'Add footage', 'Add recordings to this project (or drop them here)', () => input.click(), 'small');
  const byPath = button('folder', 'By path', 'Add a recording by its path: link it where it is (saves space), or copy it in', () => acts.addPath(), 'small');
  const lost = h('div.bin-lost', { hidden: true, role: 'status' });
  const el = h('div.bin', lost, list, h('div.bin-foot', add, byPath, input, h('span.dim', 'or drop files')));
  let files = [];
  const acts = binActions({ app, pid, refresh: () => refresh() });

  input.addEventListener('change', () => { upload([...input.files]); input.value = ''; });

  async function refresh() {
    try { files = (await app.api(`/api/projects/${enc(pid)}/footage`))?.files || []; } catch { files = []; }
    render();
    paintLost();
  }
  function render() {
    const used = new Map(Object.values(S.sources || {}).map((s) => [String(s.file || '').replace(/^video\//, ''), s.key]));
    const rows = [];
    for (const f of files) {
      const key = used.get(String(f.path || '').replace(/^video\//, '')) || used.get('footage/' + f.name);
      const play = h('button.bin-main.calm', { type: 'button', disabled: !!f.missing, title: f.missing ? `${f.name} cannot be found where it was linked` : key ? `Play ${f.name} as recorded (Before)` : `${f.name} is not in the edit yet` },
        icon(AUDIO.test(f.name) ? 'music' : 'film', true), h('span.bin-name', f.name), h('span.dim', f.missing ? '' : size(f.size || 0)),
        f.linked ? h('span.bin-tag.pixel', { title: f.target }, 'link') : null,
        f.missing ? h('span.bin-tag.miss.pixel', 'missing') : key ? h('span.bin-tag.pixel', key) : h('span.bin-tag.off.pixel', 'new'));
      if (key && !f.missing) play.addEventListener('click', () => ui.seekSource(key, 0));
      const act = (ic, label, fn) => { const b = h('button.bin-act.calm', { type: 'button', title: label, 'aria-label': label, on: { click: (e) => { e.stopPropagation(); fn(f); } } }, icon(ic, true)); return b; };
      rows.push(h('div.bin-item' + (f.missing ? '.is-missing' : ''), play,
        h('span.bin-acts', f.missing ? act('folder', `Find ${f.name} again`, (x) => acts.relink(x)) : null,
          act('note', `Rename ${f.name}`, (x) => acts.rename(x)), act('restore', `Replace ${f.name} with another recording`, (x) => acts.replace(x)),
          act('cross', `Remove ${f.name}`, (x) => acts.remove(x)))));
    }
    if (S.edl) rows.push(h('div.bin-item.static', icon('scissors', true), h('span.bin-name', 'Edit list'), h('span.dim', `${S.ps.length} pieces · ${S.cuts.length} cuts`)));
    if (!files.length) rows.unshift(h('p.dim.bin-empty', 'No footage yet. Drop your recordings here, or add one by its path.'));
    list.replaceChildren(...rows);
  }

  // a file that was going up when the page was reloaded or closed did not finish: say which, offer to add it again
  function paintLost() {
    for (const e of lostFor(pid)) if (files.some((f) => f.name === e.name)) clear(pid, e.name); // it arrived some other way
    const gone = lostFor(pid);
    lost.hidden = !gone.length;
    lost.replaceChildren(...gone.map((e) => h('div.bin-lost-row',
      h('span.bin-lost-t', { title: `${e.name} was going up when the page was reloaded or closed. Nothing of it was kept: add it again.` }, `${e.name} did not finish going up`),
      h('button.small.calm', { type: 'button', on: { click: () => { clear(pid, e.name); paintLost(); input.click(); } } }, 'Add it again'),
      h('button.small.calm', { type: 'button', title: 'Forget this note', on: { click: () => { clear(pid, e.name); paintLost(); } } }, 'Dismiss'))));
  }
  function upload(list) {
    const ok = list.filter((f) => VIDEO.test(f.name) || AUDIO.test(f.name));
    if (ok.length < list.length) app.toast('Only video and sound files go into the footage.', 'warn');
    // the app window gives a file's own path: then the choice (copy or link) is offered, link first above 200 MB
    const own = ok.filter((f) => f.path && /^([a-z]:[\\/]|\/)/i.test(f.path));
    if (own.length) { acts.addPath(own[0].path, own[0].size); ok.splice(0, ok.length, ...ok.filter((f) => !own.includes(f))); }
    for (const f of ok) one(f);
  }
  function one(f) {
    const bar = h('div.bin-bar', h('div'));
    const row = h('div.bin-item.static.uploading', icon('upload', true), h('span.bin-name', f.name), bar);
    list.prepend(row);
    const x = new XMLHttpRequest();
    began(pid, f.name, f.size);
    x.open('POST', `/api/projects/${enc(pid)}/footage`);
    x.setRequestHeader('x-name', /^[ -~]+$/.test(f.name) ? f.name : encodeURIComponent(f.name)); // a header is ASCII: other names go URI-encoded
    x.setRequestHeader('content-type', f.type || 'application/octet-stream');
    x.upload.onprogress = (e) => { if (e.lengthComputable) bar.firstChild.style.width = `${(e.loaded / e.total) * 100}%`; };
    x.onload = () => {
      ended(pid, f.name);
      row.remove();
      if (x.status >= 200 && x.status < 300) { app.toast(`${f.name} is in the footage.`, 'ok'); refresh(); }
      else { let m = x.statusText; try { m = JSON.parse(x.responseText).error || m; } catch {} app.toast(`${f.name} did not go up: ${m}`, 'error'); }
    };
    x.onerror = () => { ended(pid, f.name); row.remove(); app.toast(`${f.name} did not go up: the server could not be reached.`, 'error'); };
    x.send(f);
  }

  // drop anywhere on the given area
  function dropZone(area) {
    let depth = 0;
    const has = (e) => e.dataTransfer?.types?.includes('Files');
    const on = {
      dragenter: (e) => { if (has(e)) { depth++; area.classList.add('dropping'); e.preventDefault(); } },
      dragover: (e) => { if (has(e)) e.preventDefault(); },
      dragleave: () => { depth = Math.max(0, depth - 1); if (!depth) area.classList.remove('dropping'); },
      drop: (e) => {
        if (!e.dataTransfer?.files?.length) return;
        e.preventDefault(); e.stopPropagation(); depth = 0; area.classList.remove('dropping');
        upload([...e.dataTransfer.files]);
      },
    };
    for (const [k, fn] of Object.entries(on)) area.addEventListener(k, fn);
    const off = () => { for (const [k, fn] of Object.entries(on)) area.removeEventListener(k, fn); };
    zones.push(off);
    return off;
  }
  const zones = [];
  const off = app.on('files', (m) => { if (m.project === pid && (m.paths || []).some((p) => /footage\//.test(p))) refresh(); });

  dropZone(el);
  refresh();
  return { el, render, refresh, dropZone, upload, dispose() { off(); zones.splice(0).forEach((z) => z()); } };
}
