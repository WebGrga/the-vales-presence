// What the Projects home does to a project: rename, duplicate, free space, open the folder, export, pin, Bin.
// Each takes (app, project, done) and talks to the server; `done()` asks the page to read the list again.
import { h } from './dom.js';
import { ask } from './home-dialog.js';
import { sameTitle } from './home-logic.js';

const bytesWords = (n) => { n = Number(n) || 0; if (n < 1024) return `${n} B`; const u = ['KB', 'MB', 'GB', 'TB']; let i = -1; do { n /= 1024; i++; } while (n >= 1024 && i < 3); return `${n >= 100 ? Math.round(n) : n.toFixed(1)} ${u[i]}`; };
export { bytesWords };
const enc = encodeURIComponent;

export async function rename(app, p, list, done) {
  const input = h('input', { type: 'text', value: p.title || p.id, maxlength: 200, 'aria-label': 'Project title' });
  const twin = h('p.muted.small-note');
  input.addEventListener('input', () => { const t = sameTitle(list(), input.value, p.id); twin.textContent = t ? `Another project is already called “${t.title}”. That is allowed.` : ''; });
  const yes = await ask({ title: 'Rename project', body: [h('p.muted', 'Only the title changes. Its folder and files stay where they are.'), input, twin], ok: 'Rename', focus: input, check: () => (input.value.trim() ? null : 'A project needs a title.') });
  if (!yes) return;
  try { await app.api(`/api/projects/${enc(p.id)}/rename`, { title: input.value }); app.toast('Renamed.', 'ok'); done(); } catch (e) { app.toast('Could not rename it: ' + e.message, 'error'); }
}

export async function duplicate(app, p, done, open) {
  const choice = (value, label, hint, on) => h('label.home-choice', h('input', { type: 'radio', name: 'dupfoot', value, checked: !!on }), h('span', h('b', label), h('small', hint)));
  const body = [h('p.muted', 'The copy gets the same recipe, settings and brief. It starts again from the first stage: nothing the agent made is copied.'),
    choice('link', 'Share the footage', 'No extra space: both projects point at the same recordings.', true),
    choice('copy', 'Copy the footage', 'Uses as much space as the recordings do.'),
    choice('none', 'No footage', 'Start with an empty media bin.')];
  const yes = await ask({ title: `Duplicate “${p.title || p.id}”`, body, ok: 'Duplicate' });
  if (!yes) return;
  const footage = document.querySelector('input[name=dupfoot]:checked')?.value || 'link';
  try {
    const r = await app.api(`/api/projects/${enc(p.id)}/duplicate`, { footage });
    app.toast(`Made “${r.title}”.`, 'ok'); done(); open?.(r.id);
  } catch (e) { app.toast('Could not duplicate it: ' + e.message, 'error'); }
}

export async function freeSpace(app, p, done) {
  let plan;
  try { plan = await app.api(`/api/projects/${enc(p.id)}/free`); } catch (e) { return app.toast('Could not look: ' + e.message, 'error'); }
  if (!plan.files.length) return void (await ask({ title: 'Free space', body: [h('p', 'Nothing to free: this project has no previews or copies that can be made again.')], ok: 'OK', cancel: 'Close' }));
  const groups = new Map();
  for (const f of plan.files) { const d = f.rel.split('/').slice(0, -1).join('/'); const g = groups.get(d) || { n: 0, bytes: 0, names: [] }; g.n++; g.bytes += f.size; g.names.push(f.rel.split('/').pop()); groups.set(d, g); }
  const body = [h('p', `This deletes ${plan.files.length} file${plan.files.length === 1 ? '' : 's'} (${plan.words}). The app makes them again when it needs them.`),
    h('ul.home-free', ...[...groups].map(([d, g]) => h('li', h('details', h('summary', h('code', d + '/'), ` ${g.n} file${g.n === 1 ? '' : 's'}, ${bytesWords(g.bytes)}`), h('div.home-free-names', g.names.join('\n')))))),
    h('p.muted', 'Never touched: your recordings, final.mp4, rough.mp4, the Studio files and the brief.')];
  if (!(await ask({ title: `Free space in “${p.title || p.id}”`, body, ok: `Delete ${plan.words}`, danger: true }))) return;
  try { const r = await app.api(`/api/projects/${enc(p.id)}/free`, {}); app.toast(`Freed ${r.words}.`, 'ok'); done(); } catch (e) { app.toast('Could not free the space: ' + e.message, 'error'); }
}

export async function reveal(app, p) {
  try { await app.api(`/api/projects/${enc(p.id)}/reveal`, {}); app.toast('Opened the folder.', 'ok'); } catch (e) { app.toast('Could not open the folder: ' + e.message, 'error'); }
}

export async function exportZip(app, p) {
  const box = h('input', { type: 'checkbox', checked: true, id: 'exp-foot' });
  const body = [h('p.muted', 'One zip file with the project: settings, brief, Studio files and the edit. Previews that the app makes again are left out.'),
    h('label.home-choice', box, h('span', h('b', 'Include the footage'), h('small', 'Needed to open it on another computer.')))];
  if (!(await ask({ title: `Export “${p.title || p.id}”`, body, ok: 'Export' }))) return;
  const a = h('a', { href: `/api/projects/${enc(p.id)}/export.zip${box.checked ? '' : '?footage=0'}`, download: `${p.id}.zip` });
  document.body.append(a); a.click(); a.remove();
  app.toast('Making the zip: the download starts when it is ready.', 'info');
}

export async function pin(app, p, done) {
  try { await app.api(`/api/projects/${enc(p.id)}/pin`, { pinned: !p.pinned }); done(); } catch (e) { app.toast('Could not pin it: ' + e.message, 'error'); }
}

export async function toBin(app, ps, done) {
  let n = 0, fail = null;
  for (const p of ps) { try { await app.api(`/api/projects/${enc(p.id)}/bin`, {}); n++; } catch (e) { fail = `${p.title || p.id}: ${e.message}`; } }
  if (n) app.toast(n === 1 ? 'Moved to the Bin. You can restore it below.' : `Moved ${n} projects to the Bin. You can restore them below.`, 'ok');
  if (fail) app.toast('Not moved: ' + fail, 'error');
  done(n);
}

export async function importZip(app, file, done) {
  app.toast(`Importing ${file.name}…`, 'info');
  try {
    const res = await fetch('/api/projects/import', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: file });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    app.toast(`Imported “${data.title}”.`, 'ok'); done(data.id);
  } catch (e) { app.toast('Could not import it: ' + e.message, 'error', 9000); }
}
