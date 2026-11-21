// The Vale's Presence: the page's boot. The shell (top bar, project picker, stage bar, tabs) and the `app` every tab gets:
//   app = { api(path, body?), on(type, fn) -> off, project(), select(id), toast(text, kind?), media(path) -> url }
// plus, for the shell's own parts: emit, hooks (the editor's notes for a send-back), route.
// The address is #/<project>/<tab>; the last project is remembered in this browser.
import { api, createSocket, mediaUrl } from './shell/api.js';
import { toast } from './shell/toast.js';
import { h, icon } from './shell/dom.js';
import { mountPicker } from './shell/picker.js';
import { mountStageBar } from './shell/stagebar.js';
import { createTabs, TABS } from './shell/tabs.js';
import { needsSetup } from './setup/first.js';
import { createWaiting, pageTitle } from './shell/waiting.js';
import { toggleKeys, keysOpen, closeKeys } from './shell/keys-help.js';
import { comboOf, ownsKeys } from './editor/keys.js';

const LAST = 'presence.lastProject';
const sock = createSocket();
let current = null;

const app = {
  api: (path, body) => api(path, body),
  on: (type, fn) => sock.on(type, fn),
  emit: (type, msg) => sock.emit(type, msg),
  project: () => current,
  select: (id) => selectProject(id),
  toast: (text, kind) => toast(text, kind),
  media: (rel) => mediaUrl(current?.id, rel),
  hooks: {},
  route: () => {
    const want = `#/${current ? encodeURIComponent(current.id) : '-'}/${tabs?.shown || 'edit'}`;
    if (location.hash !== want) history.replaceState(null, '', want);
  },
};
window.presence = app; // for the console
app.waiting = createWaiting(app);

// the project.json a 'project' message carries (the message itself, or under project / data)
function projectOf(msg) {
  if (msg?.project && typeof msg.project === 'object') return msg.project;
  if (msg?.data && typeof msg.data === 'object') return msg.data;
  return msg?.id ? msg : null;
}
// a project changed: take its json at once, then the server's full view (the actions it allows) a moment later
let again = null;
sock.on('project', (msg) => {
  const p = projectOf(msg);
  const pid = typeof msg.project === 'string' ? msg.project : p?.id;
  if (!p || !current || (pid && pid !== current.id)) return;
  current = { ...current, ...p, recipeDef: p.recipeDef || current.recipeDef, view: p.view || current.view };
  picker.update(current);
  clearTimeout(again); again = setTimeout(refresh, 150);
});
sock.on('toast', (msg) => toast(msg.text, msg.kind));
sock.on('socket', (m) => {
  live.classList.toggle('up', m.up);
  live.title = m.up ? 'Connected to the server' : 'Not connected: trying again';
  if (m.up && current) refresh(); // what changed while the link was down
});

// ------------------------------------------------------------------ the frame
const top = document.getElementById('top');
const brand = h('div.brand', icon('tower'), h('span.display', 'The Vale’s Presence'));
const pickEl = h('div.picker');
const tabBar = h('nav.tabs', { 'aria-label': 'Rooms' });
const live = h('span.live', { title: 'Connecting…' });
const keysBtn = h('button.calm.icon-only.keys-btn', { type: 'button', title: 'Keyboard keys (?)', 'aria-label': 'Keyboard keys', on: { click: () => toggleKeys() } }, '?');
top.append(brand, pickEl, h('div.grow'), tabBar, keysBtn, live);
const picker = mountPicker(pickEl, app);
mountStageBar(document.getElementById('stagebar'), app);
const tabs = createTabs(tabBar, document.getElementById('rooms'), app);
document.getElementById('foot').append(
  h('a.made', { href: 'https://vale.rokogrga.com', target: '_blank', rel: 'noopener' }, 'Made in The Vale'));

async function refresh() {
  if (!current) return;
  try {
    const p = await api(`/api/projects/${encodeURIComponent(current.id)}`);
    if (p?.id !== current?.id) return;
    current = { ...p, recipeDef: p.recipeDef || current.recipeDef };
    picker.update(current);
    sock.emit('project-view', { type: 'project-view', project: current.id });
  } catch {}
}

async function selectProject(id, tab) {
  let p = null;
  if (id) {
    try { p = await api(`/api/projects/${encodeURIComponent(id)}`); } catch (e) { if (e.status !== 404) toast('Could not open the project: ' + e.message, 'error'); }
  }
  const changed = (p?.id || null) !== (current?.id || null);
  current = p;
  try { if (p) localStorage.setItem(LAST, p.id); } catch {}
  picker.update(p);
  sock.emit('select', { type: 'select', project: p });
  if (tab) tabs.show(tab); else if (changed) tabs.projectChanged();
  app.route();
  app.waiting.select(p?.id || null);
  paintTitle();
}

// the agent waiting for you: the tab title, a toast (once per question), and the Answer button's way to the question
function paintTitle() { document.title = pageTitle(current, app.waiting.asking); }
sock.on('waiting', (m) => {
  paintTitle();
  document.body.classList.toggle('asking', !!m.asking);
  if (m.asking && m.live) toast('The agent is waiting for your answer: its questions are in the Agent panel.', 'ask', 9000);
});
sock.on('focus-question', () => { if (tabs.shown !== 'edit') tabs.show('edit'); });
sock.on('open-context', () => { if (tabs.shown !== 'context') tabs.show('context'); });
// the Edit tab gets its phone layout (one panel at a time under the viewer) once it is mounted
sock.on('mounted', (m) => { if (m.tab === 'edit') import('./editor/layout.js').then((L) => L.phoneLayout(m.el, app)).catch((e) => console.error(e)); });
// ? shows every key, in every tab (a text box keeps its own keys)
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && keysOpen()) { closeKeys(); e.preventDefault(); return; }
  if (ownsKeys(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (comboOf(e) === '?') { e.preventDefault(); e.stopPropagation(); toggleKeys(); }
}, true);

async function boot() {
  const [, pid, tab] = (location.hash.match(/^#\/([^/]*)\/?([a-z]*)/) || []);
  let id = pid && pid !== '-' ? decodeURIComponent(pid) : null;
  if (!id) { try { id = localStorage.getItem(LAST); } catch {} }
  if (!id) {
    try { const list = await api('/api/projects'); const arr = Array.isArray(list) ? list : list?.projects || []; id = arr[0]?.id || null; } catch {}
  }
  const setup = needsSetup(app.api); // asked at once; the first doctor run takes a few seconds
  await selectProject(id, TABS.some((t) => t.id === tab) ? tab : 'edit');
  if (await setup) { tabs.show('setup'); app.route(); toast('Something the studio needs is missing: the Setup tab shows what and how to fix it.', 'error'); }
  else if (!current) picker.open();
}
addEventListener('hashchange', () => {
  const [, pid, tab] = (location.hash.match(/^#\/([^/]*)\/?([a-z]*)/) || []);
  const id = pid && pid !== '-' ? decodeURIComponent(pid) : null;
  if (id && id !== current?.id) selectProject(id, tab || tabs.shown);
  else if (tab && tab !== tabs.shown) tabs.show(tab);
});
boot();
