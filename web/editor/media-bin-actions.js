// The media bin's actions on a file: add by path (copy or link), rename, replace, relink, remove. Each asks first where it can lose something:
// removing footage the edit uses says so. All talk to /api/projects/:id/footage/<action> (server/routes/footage.js) and answer with the new list.
import { h } from '../shell/dom.js';
import { dialog } from './media-bin-dialog.js';

export const BIG = 200 * 1024 * 1024; // above this the default is Link (same rule as the server's defaultMode)
const MODE_KEY = 'presence.bin.mode';

const MODES = [
  ['copy', 'Copy into the project', 'A copy is kept in the project: it stays if the original moves.'],
  ['link', 'Link (saves space)', 'The recording stays where it is; the project remembers where. If you move or delete it, the bin shows it as missing.'],
];
const modeBox = (value) => h('div.bin-modes', ...MODES.map(([v, label, why]) => h('label.bin-mode',
  h('input', { type: 'radio', name: 'bin-mode', value: v, checked: v === value }), h('span', label), h('span.dim', why))));
const chosen = (box) => box.querySelector('input[name=bin-mode]:checked')?.value;
const press = (input) => input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.closest('.bin-dialog')?.querySelector('button.go, button.danger')?.click(); } });
const field = (label, props) => { const i = h('input', { type: 'text', spellcheck: false, ...props }); press(i); return { i, el: h('label.bin-field', h('span', label), i) }; };

export function binActions({ app, pid, refresh }) {
  const base = `/api/projects/${encodeURIComponent(pid)}/footage`;
  const post = (tail, body) => app.api(`${base}/${tail}`, body);

  // a path typed or given (the app window gives a file's own path): copy or link
  function addPath(preset = '', size = null) {
    const f = field('Where the recording is (the whole path)', { placeholder: 'C:\\Videos\\recording.mkv', value: preset, 'aria-label': 'Path of the recording' });
    const modes = modeBox(size != null && size > BIG ? 'link' : localStorage.getItem(MODE_KEY) || 'copy');
    const note = h('p.dim', 'Recordings over 200 MB are linked unless you choose to copy.');
    // once the path names a real file: its size, and the way to add it by default (link above 200 MB)
    let t = null;
    f.i.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        if (!f.i.value.trim()) { note.textContent = ''; return; }
        let r; try { r = await app.api(`${base}/probe?path=${encodeURIComponent(f.i.value)}`); } catch { return; }
        if (r.error) { note.textContent = r.error; return; }
        note.textContent = `${(r.size / 1048576).toFixed(r.size > 1.048576e8 ? 0 : 1)} MB: ${r.mode === 'link' ? 'big, so Link is chosen to save space' : 'small, so a copy is chosen'} (you can change it).`;
        const radio = modes.querySelector(`input[value=${r.mode}]`); if (radio) radio.checked = true;
      }, 300);
    });
    if (preset) f.i.dispatchEvent(new Event('input'));
    return dialog({ title: 'Add footage by path', ok: 'Add',
      body: [f.el, modes, note],
      onOk: async () => {
        const r = await post('add', { path: f.i.value, mode: chosen(modes) });
        localStorage.setItem(MODE_KEY, r.mode);
        await refresh();
        app.toast(`${r.name} is in the footage (${r.mode === 'link' ? 'linked, not copied' : 'copied'}).`, 'ok');
      } });
  }

  function rename(file) {
    const f = field('New name', { value: file.name, 'aria-label': 'New name' });
    dialog({ title: `Rename ${file.name}`, ok: 'Rename',
      body: [f.el, file.used?.length ? h('p.dim', 'The edit list follows the new name.') : null],
      onOk: async () => { await post('rename', { name: file.name, to: f.i.value }); await refresh(); app.toast('Renamed.', 'ok'); } });
    f.i.setSelectionRange(0, file.name.replace(/\.[^.]+$/, '').length);
  }

  async function remove(file) {
    let dep = { keys: [], rough: false };
    try { dep = await app.api(`${base}/check?name=${encodeURIComponent(file.name)}`); } catch {}
    const keys = dep.keys || [];
    const warn = keys.length ? h('p.bin-warn', dep.rough
      ? `The rough cut was made from this recording (${keys.join(', ')}). Removing it breaks the edit: it cannot be played, rebuilt or exported until you add the recording back under the same name.`
      : `The edit list uses this recording (${keys.join(', ')}). The edit will not play without it.`) : null;
    dialog({ title: `Remove ${file.name}?`, ok: 'Remove', danger: true,
      body: [warn, h('p', file.linked ? 'This only forgets the link. The recording itself stays where it is.' : 'The copy in the project is deleted. This cannot be undone.')],
      onOk: async () => { await post('remove', { name: file.name }); await refresh(); app.toast(`${file.name} is out of the footage.`, 'ok'); } });
  }

  function relink(file) {
    const f = field('Where the recording is now (the whole path)', { placeholder: file.target || '', value: '', 'aria-label': 'New path' });
    dialog({ title: `Find ${file.name}`, ok: 'Link again',
      body: [h('p.dim', file.target ? `It was at ${file.target}.` : 'It is not in the project.'), f.el],
      onOk: async () => { await post('relink', { name: file.name, path: f.i.value }); await refresh(); app.toast('Linked again.', 'ok'); } });
  }

  function replace(file) {
    const f = field('A recording to put in its place (the whole path)', { value: '', 'aria-label': 'Path of the new recording' });
    const modes = modeBox(localStorage.getItem(MODE_KEY) || 'copy');
    dialog({ title: `Replace ${file.name}`, ok: 'Replace',
      body: [h('p.dim', `It keeps the name, so the edit list still points at it. The picture and sound become the new recording, which must be a ${file.name.replace(/^.*(\.[^.]+)$/, '$1')} file like this one.`), f.el, modes],
      onOk: async () => { await post('replace', { name: file.name, path: f.i.value, mode: chosen(modes) }); await refresh(); app.toast(`${file.name} was replaced.`, 'ok'); } });
  }

  return { addPath, rename, remove, relink, replace };
}
