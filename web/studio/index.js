// The Studio tab: plan and script, research, titles, thumbnails, the feed preview and the upload (part D).
// mount(el, app) per web/app.js; each page is built once and kept (hidden when not shown), so nothing typed is lost.
// Live: reloads on { type: 'studio', project } (the agent wrote a studio file) and on project changes.
import { h, icon } from '../shell/dom.js';
import { textSection } from './text.js';
import { researchSection } from './research.js';
import { titlesSection } from './titles.js';
import { thumbsSection } from './thumbs.js';
import { feedSection } from './feed.js';
import { uploadSection } from './upload.js';
import { flushNotes } from './cards.js';
import { usesLine } from '../context/uses.js';

const PAGES = [
  { id: 'plan', label: 'Plan', icon: 'book', make: (c) => textSection(c, 'plan') },
  { id: 'script', label: 'Script', icon: 'text', make: (c) => textSection(c, 'script') },
  { id: 'research', label: 'Research', icon: 'eye', make: researchSection },
  { id: 'titles', label: 'Titles', icon: 'note', make: titlesSection },
  { id: 'thumbs', label: 'Thumbnails', icon: 'snap', make: thumbsSection },
  { id: 'feed', label: 'Feed', icon: 'phone', make: feedSection },
  { id: 'upload', label: 'Upload', icon: 'upload', make: uploadSection },
];
// a recipe stage -> the page that shows it
const STAGE_PAGE = { research: 'research', plan: 'plan', 'plan-review': 'plan', script: 'script', titles: 'titles', thumbnails: 'thumbs', feed: 'feed', upload: 'upload' };

function css(href) {
  if (document.querySelector(`link[data-studio="${href}"]`)) return;
  document.head.append(h('link', { rel: 'stylesheet', href: new URL(href, import.meta.url).href, 'data-studio': href }));
}

const typing = (root) => { const a = document.activeElement; return a && root.contains(a) && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); };

export function mount(el, app) {
  css('./studio.css'); css('./feed.css');
  const nav = h('nav.st-nav');
  const strip = h('div.st-strip', { hidden: true });
  const body = h('div.st-body');
  const uses = usesLine(app, ['studio']); // which skills the project's set gives the Studio's turns
  const root = h('div.studio', h('div.st-top', nav, strip), uses.el, body);
  el.replaceChildren(root);

  let id = null, pages = [], data = null, current = app.sub?.get('studio') || localStorage.getItem('presence.studio.page') || 'plan', timer = null, offs = [];

  const ctx = {
    get id() { return id; },
    api: (p, b) => app.api(p, b),
    reload: () => { clearTimeout(timer); timer = setTimeout(load, 120); },
    toast: (t, k) => app.toast?.(t, k),
    select: (p) => show(p),
    say: async (text) => {
      if (!id) return;
      if (!confirm(`Ask the agent?\n\n“${text}”\n\nThis uses your Claude subscription.`)) return;
      try { await app.api(`/api/projects/${encodeURIComponent(id)}/say`, { text }); app.toast?.('Sent to the agent.'); } catch (e) { app.toast?.(e.message || String(e), 'error'); }
    },
  };

  function show(p) {
    current = PAGES.some((x) => x.id === p) ? p : 'plan';
    localStorage.setItem('presence.studio.page', current);
    app.sub?.set('studio', current); // the address names the page: a reload or a shared link lands here
    for (const b of nav.children) b.classList.toggle('on', b.dataset.page === current);
    for (const pg of pages) pg.el.hidden = pg.id !== current;
  }

  function build() {
    for (const pg of pages) pg.unmount?.();
    body.replaceChildren(); pages = []; data = null;
    if (!id) { body.append(h('div.st-empty.px-frame', h('p', 'Open or make a project to use the Studio.'))); nav.replaceChildren(); return; }
    nav.replaceChildren(...PAGES.map((p) => h('button.small.calm.st-navbtn', { type: 'button', 'data-page': p.id, on: { click: () => show(p.id) } }, icon(p.icon, true), h('span', p.label), h('span.st-badge'))));
    for (const p of PAGES) {
      const s = p.make(ctx);
      s.id = p.id;
      s.el.hidden = true;
      // a page you are typing in is not redrawn under your fingers; it catches up when you leave it
      s.el.addEventListener('focusout', () => setTimeout(() => { if (s.stale && !typing(s.el) && data) { s.stale = false; s.render(data); } }, 0));
      pages.push(s);
      body.append(s.el);
    }
    show(current);
  }

  function badges() {
    const n = (doc) => doc.options.filter((o) => !o.hidden).length;
    const val = { research: data.research.videos.length || '', titles: data.titles.picked ? '✓' : n(data.titles) || '', thumbs: data.thumbs.picked ? '✓' : n(data.thumbs) || '', feed: data.feed.picked ? '✓' : '', upload: data.pack?.betState?.phase === 'due' ? '!' : data.upload.state.status === 'done' && !data.upload.state.dry ? '✓' : '', plan: data.plan.text ? '•' : '', script: data.script.text ? '•' : '' };
    for (const b of nav.children) {
      const badge = b.querySelector('.st-badge');
      badge.textContent = val[b.dataset.page] ?? '';
      const due = b.dataset.page === 'upload' && val.upload === '!';
      badge.classList.toggle('due', due);
      badge.title = due ? 'A week has passed since the upload: check your bet' : '';
    }
  }

  // where the project is, when it is at a studio stage (the shell's stage bar has Approve and Send back)
  function paintStrip() {
    const p = app.project?.();
    const at = p?.at, st = at && p.stages?.[at];
    const page = STAGE_PAGE[at];
    if (!page || !st) { strip.hidden = true; return; }
    const stage = (p.recipeDef?.stages || p.recipe?.stages || []).find((s) => s.id === at) || { id: at, title: at };
    strip.hidden = false;
    strip.replaceChildren(
      h('span.st-stage', 'Now: ', h('b', stage.title || at), ` · ${st.status === 'waiting' ? 'waiting for you' : st.status || 'to come'}`),
      page !== current ? h('button.small.calm', { type: 'button', on: { click: () => show(page) } }, 'Show it') : '');
  }

  async function load() {
    if (!id) return;
    const want = id;
    try {
      const d = await app.api(`/api/studio/${encodeURIComponent(id)}`);
      if (want !== id) return;
      data = d;
      for (const s of pages) {
        if (!s.live && typing(s.el)) { s.stale = true; continue; }
        try { s.render(data); } catch (e) { console.error('studio page', s.id, e); }
      }
      badges();
    } catch (e) {
      body.querySelector('.st-loaderr')?.remove();
      body.prepend(h('div.st-note.st-loaderr', `Could not read the studio files: ${e.message || e}`));
    }
  }

  function select() {
    const p = app.project?.();
    const next = p?.id || null;
    if (next === id) { paintStrip(); return; }
    flush();
    id = next;
    uses.load();
    build();
    paintStrip();
    load();
  }

  function flush() { for (const s of pages) s.flush?.(); flushNotes(); }

  offs = [
    app.on('studio', (m) => {
      if (m.youtube) return ctx.reload();
      if (m.project !== id) return;
      if (m.upload) pages.find((s) => s.id === 'upload')?.onUpload?.(m.upload);
      else ctx.reload();
    }),
    app.on('project', () => { if (!id) select(); else paintStrip(); }),
    app.on('select', () => select()),
    app.on('sub', (m) => { if (m?.tab === 'studio' && m.sub && m.sub !== current && pages.length) show(m.sub); }),
    app.on('tab', (m) => { if (m?.tab === 'studio') { select(); load(); } }),
    app.on('files', (m) => { if ((m.paths || []).some((p) => String(p).replace(/\\/g, '/').includes('studio/'))) ctx.reload(); }),
  ].filter((f) => typeof f === 'function');

  const onHide = () => flush();
  window.addEventListener('pagehide', onHide);
  select();

  return {
    unmount() {
      flush();
      for (const off of offs) off();
      for (const pg of pages) pg.unmount?.();
      window.removeEventListener('pagehide', onHide);
    },
  };
}
