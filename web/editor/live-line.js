// The Edit tab's "now" line: while a stage runs it says what the agent does right now (its last step in plain words, a
// background render's last line), when a file lands it says so ("Proof is ready"), and it holds the Plan button that
// opens video/out/visual-plan.md. The words are decided by activity-state.js (pure, shared with the strip under the
// stage bar) and landed-words.js (pure, tested).
import { h, icon } from '../shell/dom.js';
import { idle, reduce, fromStatus, stripLine } from '../shell/activity-state.js';
import { markdown } from '../shell/markdown.js';
import { landedWords } from './landed-words.js';
import { recipeOf } from '../shell/stages.js';

export function createLiveLine(app, id) {
  let st = idle(), news = null, hasPlan = false;
  const dot = h('span.ll-dot');
  const what = h('b.ll-what');
  const step = h('span.ll-step');
  const plan = h('button.small.calm.ll-plan', { type: 'button', hidden: true, title: 'The visual plan the agent wrote: what goes on screen at each beat', on: { click: () => openPlan() } }, icon('text', true), h('span', 'Plan'));
  const el = h('div.ed-live', { role: 'status', 'aria-live': 'polite', hidden: true }, dot, what, step, h('div.grow'), plan);
  const stageTitle = () => (recipeOf(app.project())?.stages || []).find((s) => s.id === st.stage)?.title || st.stage || '';
  let newsTimer = 0;

  function draw() {
    const l = stripLine(st, stageTitle());
    const working = !!l.kind;
    el.hidden = !(working || news || hasPlan);
    el.className = `ed-live ${working ? l.kind : news ? 'news' : ''}`;
    if (working) { what.textContent = l.what; step.textContent = l.step ? ` · ${l.step}` : ''; }
    else if (news) { what.textContent = news.text; step.textContent = ''; }
    else { what.textContent = ''; step.textContent = ''; }
    plan.hidden = !hasPlan;
  }
  function say(text) { news = { text }; clearTimeout(newsTimer); newsTimer = setTimeout(() => { news = null; draw(); }, 60000); draw(); }

  async function checkPlan() {
    try { const r = await fetch(app.media('video/out/visual-plan.md'), { method: 'HEAD', cache: 'no-cache' }); hasPlan = r.ok; } catch { hasPlan = false; }
    draw();
  }
  async function openPlan() {
    let text = '';
    try { text = await (await fetch(app.media('video/out/visual-plan.md'), { cache: 'no-cache' })).text(); } catch {}
    const body = h('div.plan-body');
    body.innerHTML = markdown(text || 'The plan is not there yet.');
    const close = () => { layer.classList.remove('in'); setTimeout(() => layer.remove(), 250); removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const layer = h('div.plan-layer', { on: { click: (e) => { if (e.target === layer) close(); } } },
      h('div.plan-box.px-frame', { role: 'dialog', 'aria-label': 'The visual plan' }, h('header', h('h3', 'Visual plan'), h('div.grow'), h('button.small.calm', { type: 'button', on: { click: close } }, 'Close')), body));
    body.addEventListener('click', (e) => { const b = e.target.closest?.('button.tc'); if (b) { close(); window.presence?.editor?.viewer?.seek(Number(b.dataset.t)); } });
    document.body.append(layer);
    addEventListener('keydown', onKey, true);
    requestAnimationFrame(() => layer.classList.add('in'));
  }

  const feed = (m) => {
    if (m.project && m.project !== id) return;
    const next = reduce(st, m, { projectId: id });
    if (next !== st) { st = next; draw(); }
  };
  const offs = ['agent', 'progress', 'live', 'queue', 'fire'].map((t) => app.on(t, feed));
  offs.push(app.on('project-view', () => { const p = app.project(); if (p?.view) feed({ type: 'live', project: id, view: p.view }); }));
  offs.push(app.on('files', (m) => {
    if (m.project && m.project !== id) return;
    const paths = (m.paths || []).map((p) => String(p).replace(/\\/g, '/'));
    if (paths.some((p) => /visual-plan\.md$/.test(p))) checkPlan();
    const w = landedWords(paths, !!m.live);
    if (w) say(w);
  }));
  app.api(`/api/projects/${encodeURIComponent(id)}/agent`).then((s) => { st = fromStatus(s, app.project()?.view || null, { projectId: id }); draw(); }).catch(() => {});
  checkPlan();
  return { el, say, dispose() { clearTimeout(newsTimer); offs.forEach((o) => o?.()); } };
}
