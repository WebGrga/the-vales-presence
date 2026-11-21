// The first-run tour: five short steps over the real screen (a ring around the real part, a card that says what it is).
// Skippable at any step (Skip, Esc), shown by itself only on a first run (no project yet, not seen in this browser), and
// replayable from the ? overlay or Ctrl+K. The steps are data; pickStep (pure, tested) finds a part that is on screen.
import { h } from './dom.js';

const SEEN = 'presence.tour';

export const STEPS = [
  { sel: '.brand', title: 'Your projects', text: 'Every video is a project. This tower opens the Projects page, where you start one, open one, rename it or bin it. Ctrl+O does the same.' },
  { sel: '#stagebar', title: 'The stages', text: 'A recipe is a row of stages. Blue ones are the agent’s, orange ones are yours. Go runs the next stage; its time and cost show right here, and the agent works until a stage needs you.' },
  { sel: '.tabs', title: 'The rooms', text: 'Edit your cuts, make Shorts, package the video in the Studio, see what the agent reads in Context, export, and check your setup. Keys 1 to 7 switch rooms.' },
  { sel: '.act-btn', title: 'What the agent is doing', text: 'While it works, a strip under the stages says what it is doing now, with Stop. This button opens the live log, the history of every run, the queue across projects and your spend.' },
  { sel: '.keys-btn', title: 'Keys and help', text: 'Press ? for every key. Ctrl+K finds any action, project, tab or skill. You can replay this tour from the keys list.' },
];

// pure: the first step at or after `from` (going `dir`) whose part exists and is shown -> index | -1
export function pickStep(steps, from, dir, visible) {
  for (let i = from; i >= 0 && i < steps.length; i += dir) if (visible(steps[i])) return i;
  return -1;
}

export const seen = () => { try { return localStorage.getItem(SEEN) === 'done'; } catch { return true; } };
const mark = () => { try { localStorage.setItem(SEEN, 'done'); } catch {} };

export function createTour(app) {
  let layer = null;
  const shown = (s) => { const e = document.querySelector(s.sel); if (!e || e.closest('[hidden]')) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

  function start() {
    if (layer) return;
    let i = pickStep(STEPS, 0, 1, shown);
    if (i < 0) return;
    const ring = h('div.tour-ring');
    const title = h('h3'), text = h('p'), count = h('span.dim.tour-n');
    const back = h('button.calm.small', { type: 'button', on: { click: () => go(-1) } }, 'Back');
    const next = h('button.go.small', { type: 'button', on: { click: () => go(1) } }, 'Next');
    const skip = h('button.calm.small.tour-skip', { type: 'button', on: { click: () => end() } }, 'Skip the tour');
    const card = h('div.tour-card.px-frame', { role: 'dialog', 'aria-label': 'Tour' }, count, title, text, h('div.tour-btns', skip, h('div.grow'), back, next));
    layer = h('div.tour-layer', ring, card);
    document.body.append(layer);
    requestAnimationFrame(() => layer?.classList.add('in'));

    function place() {
      const s = STEPS[i], e = document.querySelector(s.sel);
      if (!e) return;
      const r = e.getBoundingClientRect(), pad = 5;
      Object.assign(ring.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
      title.textContent = s.title; text.textContent = s.text;
      const total = STEPS.filter(shown).length, n = STEPS.slice(0, i + 1).filter(shown).length;
      count.textContent = `${n} of ${total}`;
      back.hidden = pickStep(STEPS, i - 1, -1, shown) < 0;
      next.textContent = pickStep(STEPS, i + 1, 1, shown) < 0 ? 'Done' : 'Next';
      const cw = Math.min(360, innerWidth - 24);
      card.style.width = `${cw}px`;
      const ch = card.offsetHeight || 190;
      const below = r.bottom + 14 + ch < innerHeight;
      card.style.top = `${below ? r.bottom + 14 : Math.max(8, r.top - 14 - ch)}px`;
      card.style.left = `${Math.max(8, Math.min(innerWidth - cw - 8, r.left + r.width / 2 - cw / 2))}px`;
    }
    function go(d) {
      const j = pickStep(STEPS, i + d, d, shown);
      if (j < 0) { if (d > 0) end(); return; }
      i = j; place(); next.focus();
    }
    function end() { mark(); removeEventListener('keydown', key, true); removeEventListener('resize', place); const l = layer; layer = null; l.classList.remove('in'); setTimeout(() => l.remove(), 350); }
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(); }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { if (e.target?.tagName !== 'BUTTON' || e.key === 'ArrowRight') { e.preventDefault(); go(1); } }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    };
    addEventListener('keydown', key, true);
    addEventListener('resize', place);
    place(); next.focus();
  }

  // a first run: nothing made yet in this installation, and the tour not seen in this browser
  async function maybe() {
    if (seen()) return;
    try { const d = await app.api('/api/projects'); if ((d.projects || []).length) { mark(); return; } } catch { return; }
    setTimeout(start, 700);
  }
  return { start, maybe, isOpen: () => !!layer };
}
