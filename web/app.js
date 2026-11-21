// The Vale's Presence: the page's boot. The shell (top bar, project picker, stage bar, tabs) and the `app` every tab gets:
//   app = { api(path, body?), on(type, fn) -> off, project(), select(id), toast(text, kind?), media(path) -> url }
// plus, for the shell's own parts: emit, hooks (the editor's notes for a send-back), route.
// The address is #/<project>/<tab>[/<sub>] (the sub is the page inside a tab, such as the Studio's Titles: app.sub);
// the last project is remembered in this browser.
import { api, createSocket, mediaUrl } from './shell/api.js';
import { toast } from './shell/toast.js';
import { h, icon } from './shell/dom.js';
import { mountPicker } from './shell/picker.js';
import { mountHome } from './shell/home.js';
import { mountStageBar } from './shell/stagebar.js';
import { createTabs, TABS } from './shell/tabs.js';
import { needsSetup } from './setup/first.js';
import { createWaiting, pageTitle } from './shell/waiting.js';
import { mountHint } from './shell/next-hint.js';
import { toggleKeys, keysOpen, closeKeys } from './shell/keys-help.js';
import { comboOf, ownsKeys } from './editor/keys.js';
import { mountSaveChip } from './shell/save-state.js';
import { mountUndo } from './shell/undo.js';
import { mountActivity } from './shell/activity.js';
import { mountDrawer } from './shell/drawer.js';
import { mountGoLine } from './shell/go-line.js';
import { createNotify, badged } from './shell/notify.js';
import { appAction } from './shell/app-keys.js';
import { mountPalette } from './shell/palette.js';
import { createTour } from './shell/tour.js';
import { applyUiSize } from './shell/prefs.js';

applyUiSize();

const LAST = 'presence.lastProject';
const sock = createSocket();
let current = null;

const app = {
  api: (path, body) => api(path, body),
  on: (type, fn) => sock.on(type, fn),
  emit: (type, msg) => sock.emit(type, msg),
  project: () => current,
  select: (id, tab) => selectProject(id, tab),
  toast: (text, kind) => toast(text, kind),
  media: (rel) => mediaUrl(current?.id, rel),
  hooks: {},
  // the page inside a tab (the Studio's Titles): kept in the address. get(tab) -> name | undefined; set(tab, name)
  sub: {
    get: (tab) => subs[tab],
    set: (tab, name) => { if (subs[tab] === name) return; subs[tab] = name; app.route(); },
  },
  route: () => {
    const tab = tabs?.shown || 'edit';
    const want = `#/${current ? encodeURIComponent(current.id) : '-'}/${tab}${subs[tab] ? '/' + subs[tab] : ''}`;
    if (location.hash !== want) history.replaceState(null, '', want);
  },
};
const subs = {};
const HASH = /^#\/([^/]*)\/?([a-z]*)(?:\/([a-z0-9-]+))?/;
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
const brand = h('button.brand.calm', { type: 'button', title: 'All projects', 'aria-label': 'All projects', on: { click: () => app.home.open() } }, icon('tower'), h('span.display', 'The Vale’s Presence'));
const pickEl = h('div.picker');
const tabBar = h('nav.tabs', { 'aria-label': 'Rooms' });
const live = h('span.live', { title: 'Connecting…' });
const keysBtn = h('button.calm.icon-only.keys-btn', { type: 'button', title: 'Keyboard keys (?)', 'aria-label': 'Keyboard keys', on: { click: () => toggleKeys() } }, '?');
const saveSlot = h('span.save-slot'), actSlot = h('span.act-slot');
top.append(brand, pickEl, h('div.grow'), saveSlot, actSlot, tabBar, keysBtn, live);
app.save = mountSaveChip(saveSlot, app);
app.undo = mountUndo(app);
app.notify = createNotify(app);
app.drawer = mountDrawer(app);
app.palette = mountPalette(app);
app.tour = createTour(app);
app.shownTab = () => tabs?.shown;
app.home = mountHome(document.getElementById('rooms'), app);
app.openTab = (id) => { app.home.close(); tabs.show(id); };
app.hint = mountHint(document.getElementById('stagebar'), app);
const picker = mountPicker(pickEl, app);
mountStageBar(document.getElementById('stagebar'), app);
mountGoLine(document.getElementById('stagebar'), app);
app.activity = mountActivity(document.getElementById('stagebar'), app, actSlot);
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
  if (p) { app.home.close(); if (changed) api(`/api/projects/${encodeURIComponent(p.id)}/opened`, {}).catch(() => {}); }
  picker.update(p);
  sock.emit('select', { type: 'select', project: p });
  if (tab) tabs.show(tab); else if (changed) tabs.projectChanged();
  app.route();
  app.waiting.select(p?.id || null);
  paintTitle();
}

// the agent waiting for you: the tab title, a toast (once per question), and the Answer button's way to the question
function paintTitle() { document.title = badged(pageTitle(current, app.waiting.asking), app.notify.unseen); }
sock.on('badge', paintTitle);
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
  const blocked = !!document.querySelector('.home-dialog-layer, .pal-layer, .tour-layer, .keys-layer, .media-dialog-layer');
  const a = appAction(e, { tab: tabs?.shown, blocked });
  if (a) {
    e.preventDefault(); e.stopPropagation();
    if (a.action === 'tab') { if (tabBar.querySelector(`[data-tab="${a.arg}"]`)?.hidden) toast('This recipe does not use that tab.', 'info'); else app.openTab(a.arg); }
    else if (a.action === 'projects') app.home.open();
    else if (a.action === 'palette') app.palette.open();
    else if (a.action === 'go') { if (app.home.isOpen()) toast('Close the Projects page first: Go and Approve act on the open project.', 'info'); else app.keys?.go(); }
    else if (a.action === 'undo') app.undo.undoTab();
    return;
  }
  if (ownsKeys(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (comboOf(e) === '?') { e.preventDefault(); e.stopPropagation(); toggleKeys(); }
}, true);

async function boot() {
  const [, pid, tab, sub] = (location.hash.match(HASH) || []);
  if (tab && sub) subs[tab] = sub;
  // only a project you chose opens: the one in the address, or the one you had open last time; otherwise the Projects home
  let id = pid && pid !== '-' ? decodeURIComponent(pid) : null;
  if (!id) { try { id = localStorage.getItem(LAST); } catch {} }
  const setup = needsSetup(app.api); // asked at once; the first doctor run takes a few seconds
  await selectProject(id, TABS.some((t) => t.id === tab) ? tab : 'edit');
  app.tour.maybe();
  if (!current || tab === 'home') app.home.open(); // at once: the page never sits empty while the doctor runs
  if (await setup) {
    if (current && !app.home.isOpen()) { tabs.show('setup'); app.route(); }
    toast('Something the studio needs is missing: the Setup tab shows what and how to fix it.', 'error');
  }
}
addEventListener('hashchange', () => {
  const [, pid, tab, sub] = (location.hash.match(HASH) || []);
  const id = pid && pid !== '-' ? decodeURIComponent(pid) : null;
  if (tab === 'home') return;
  if (tab && sub && subs[tab] !== sub) { subs[tab] = sub; app.emit('sub', { type: 'sub', tab, sub }); }
  if (id && id !== current?.id) selectProject(id, tab || tabs.shown);
  else if (tab && tab !== tabs.shown) tabs.show(tab);
});
boot();
