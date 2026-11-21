// One project card of the Projects home, and the menu (right-click or the ⋯ button).
// card(p, ctx) -> element; ctx: { recipeName(id), recipeIcon(id), current, selecting, selected: Set, size(id), open(id), toggle(id), menu(p, x, y), pin(p) }
// No poster yet: a placeholder with the recipe's icon and the first letters of the title, in one of six calm colours picked from the id.
import { h, icon } from './dom.js';
import { badgeOf, ago, initials } from './home-logic.js';
import { bytesWords } from './home-actions.js';

const enc = encodeURIComponent;
// changed after it was opened (or made), by more than a minute
const changedLater = (p) => { const base = Date.parse(p.opened || p.created), up = Date.parse(p.updated); return Number.isFinite(up) && (!Number.isFinite(base) || up - base > 60000); };

const hue = (id) => { let n = 0; for (const ch of String(id)) n = (n * 31 + ch.charCodeAt(0)) >>> 0; return n % 6; };

export function card(p, c) {
  const words = badgeOf(p);
  const poster = h('div.home-poster');
  const holder = h('div.home-ph.ph-' + hue(p.id), icon(c.recipeIcon(p.recipe)), h('span.home-ph-l', initials(p.title || p.id)));
  const img = h('img', { src: `/api/projects/${enc(p.id)}/poster?v=${enc(p.updated || '')}`, alt: '', loading: 'lazy', draggable: false });
  img.addEventListener('error', () => { img.remove(); });
  poster.append(holder, img, h('span.home-badge.' + words.tone, { title: words.label }, words.label));
  const sz = c.size(p.id);
  const sel = c.selected.has(p.id);
  const pinBtn = h('button.icon-only.home-pin' + (p.pinned ? '.on' : ''), { type: 'button', title: p.pinned ? 'Unpin' : 'Pin to the top', 'aria-label': p.pinned ? 'Unpin' : 'Pin', 'aria-pressed': String(!!p.pinned), on: { click: (e) => { e.stopPropagation(); c.pin(p); } } }, icon('flag', true));
  const more = h('button.icon-only.home-more', { type: 'button', title: 'More', 'aria-label': 'More: ' + (p.title || p.id), on: { click: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); c.menu(p, r.left, r.bottom + 2); } } }, '⋯');
  const meta = [
    h('div.home-line', c.recipeName(p.recipe)),
    h('div.home-line.dim', p.opened ? `Opened ${ago(p.opened)}` : `Made ${ago(p.created) || 'earlier'}`, changedLater(p) ? ` · changed ${ago(p.updated)}` : ''),
    h('div.home-line.dim.home-size', sz ? bytesWords(sz.total) + (sz.freeable ? ` (${bytesWords(sz.freeable)} can be freed)` : '') : ' '),
  ];
  const el = h('article.home-card' + (c.current === p.id ? '.current' : '') + (sel ? '.selected' : ''), { tabindex: '0', role: 'button', 'data-id': p.id, 'aria-label': `${p.title || p.id}, ${words.label}` },
    c.selecting ? h('span.home-check', { 'aria-hidden': 'true' }, sel ? '✓' : '') : null, poster,
    h('div.home-body', h('div.home-title', h('b', { title: p.title || p.id }, p.title || p.id), pinBtn, more), ...meta));
  const act = () => (c.selecting ? c.toggle(p.id) : c.open(p.id));
  el.addEventListener('click', act);
  el.addEventListener('keydown', (e) => { if (e.target === el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); act(); } else if (e.target === el && e.key === 'ContextMenu') { const r = el.getBoundingClientRect(); c.menu(p, r.left + 20, r.top + 20); } });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); c.menu(p, e.clientX, e.clientY); });
  return el;
}

// a menu at x, y (kept inside the window); items: [{ label, run, danger?, line? }]; one open at a time
let openMenu = null;
export function showMenu(items, x, y) {
  closeMenu();
  const m = h('div.home-menu.px-frame', { role: 'menu' }, ...items.map((i) => i.line ? h('hr') : h('button.calm' + (i.danger ? '.danger' : ''), { type: 'button', role: 'menuitem', on: { click: () => { closeMenu(); i.run(); } } }, i.label)));
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  const off = (e) => { if (!m.contains(e.target)) closeMenu(); };
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); } };
  setTimeout(() => { document.addEventListener('pointerdown', off, true); addEventListener('keydown', esc, true); }, 0);
  openMenu = () => { m.remove(); document.removeEventListener('pointerdown', off, true); removeEventListener('keydown', esc, true); };
  m.querySelector('button')?.focus();
}
export function closeMenu() { openMenu?.(); openMenu = null; }
