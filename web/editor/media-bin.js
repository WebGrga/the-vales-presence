// The media bin: the project's footage (GET .../footage), which recordings the edit uses, the rough; drop files on it
// (or on the whole editor) to add footage: each file goes up as its own raw body with an x-name header and a progress
// bar. Click a recording to play it from the start in Before.
import { h, icon, button } from '../shell/dom.js';

const VIDEO = /\.(mp4|mkv|mov|webm|m4v|avi|mts|m2ts)$/i, AUDIO = /\.(wav|mp3|m4a|aac|flac|ogg)$/i;
const size = (n) => (n > 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n > 1e6 ? Math.round(n / 1e6) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB');

export function createMediaBin(app, store, ui) {
  const S = store.S, pid = store.S.id, enc = encodeURIComponent;
  const list = h('div.bin-list');
  const input = h('input', { type: 'file', multiple: true, accept: 'video/*,audio/*', hidden: true });
  const add = button('upload', 'Add footage', 'Add recordings to this project (or drop them here)', () => input.click(), 'small');
  const el = h('div.bin', list, h('div.bin-foot', add, input, h('span.dim', 'or drop files here')));
  let files = [];

  input.addEventListener('change', () => { upload([...input.files]); input.value = ''; });

  async function refresh() {
    try { files = (await app.api(`/api/projects/${enc(pid)}/footage`))?.files || []; } catch { files = []; }
    render();
  }
  function render() {
    const used = new Map(Object.values(S.sources || {}).map((s) => [String(s.file || '').replace(/^video\//, ''), s.key]));
    const rows = [];
    for (const f of files) {
      const key = used.get(String(f.path || '').replace(/^video\//, '')) || used.get('footage/' + f.name);
      const row = h('button.bin-item.calm', { type: 'button', title: key ? `Play ${f.name} as recorded (Before)` : `${f.name} is not in the edit yet` },
        icon(AUDIO.test(f.name) ? 'music' : 'film', true), h('span.bin-name', f.name), h('span.dim', size(f.size || 0)),
        key ? h('span.bin-tag.pixel', key) : h('span.bin-tag.off.pixel', 'new'));
      if (key) row.addEventListener('click', () => ui.seekSource(key, 0));
      rows.push(row);
    }
    if (S.edl) rows.push(h('div.bin-item.static', icon('scissors', true), h('span.bin-name', 'Edit list'), h('span.dim', `${S.ps.length} pieces · ${S.cuts.length} cuts`)));
    if (!rows.length) rows.push(h('p.dim.bin-empty', 'No footage yet. Drop your recordings here.'));
    list.replaceChildren(...rows);
  }

  function upload(list) {
    const ok = list.filter((f) => VIDEO.test(f.name) || AUDIO.test(f.name));
    if (ok.length < list.length) app.toast('Only video and sound files go into the footage.', 'warn');
    for (const f of ok) one(f);
  }
  function one(f) {
    const bar = h('div.bin-bar', h('div'));
    const row = h('div.bin-item.static.uploading', icon('upload', true), h('span.bin-name', f.name), bar);
    list.prepend(row);
    const x = new XMLHttpRequest();
    x.open('POST', `/api/projects/${enc(pid)}/footage`);
    x.setRequestHeader('x-name', /^[ -~]+$/.test(f.name) ? f.name : encodeURIComponent(f.name)); // a header is ASCII: other names go URI-encoded
    x.setRequestHeader('content-type', f.type || 'application/octet-stream');
    x.upload.onprogress = (e) => { if (e.lengthComputable) bar.firstChild.style.width = `${(e.loaded / e.total) * 100}%`; };
    x.onload = () => {
      row.remove();
      if (x.status >= 200 && x.status < 300) { app.toast(`${f.name} is in the footage.`, 'ok'); refresh(); }
      else { let m = x.statusText; try { m = JSON.parse(x.responseText).error || m; } catch {} app.toast(`${f.name} did not go up: ${m}`, 'error'); }
    };
    x.onerror = () => { row.remove(); app.toast(`${f.name} did not go up: the server could not be reached.`, 'error'); };
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
