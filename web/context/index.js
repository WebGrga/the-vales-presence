// The Context tab (part E): the agent's whole context as a map. A column per stage of the recipe with the skills
// switched on for it and what else it reads; the shared things (CLAUDE.md, your Claude Code, the house rules, the
// brief) once, below, with a line from every column that reads them; the lessons with their counts; every skill.
// Click anything to read it, edit it in place or switch it on and off (panel.js). No tokens and no prices, ever.
import { h, icon } from '../shell/dom.js';
import { KIND, stateBadge, words, addable, lines, linePath, lessonCounts } from './view.js';
import { createPanel } from './panel.js';
import { setsBar } from './sets-bar.js';
import { listView } from './list-view.js';

const RECIPE_KEY = 'presence.context.recipe';

function styles() {
  if (document.querySelector('link[data-cx]')) return;
  document.head.append(h('link', { rel: 'stylesheet', href: '/context/context.css', 'data-cx': '' }));
}

export function mount(el, app) {
  styles();
  const st = { map: null, recipe: null, open: null, hover: null };
  const q = () => {
    const p = new URLSearchParams();
    const pid = app.project()?.id;
    if (pid) p.set('project', pid);
    if (st.recipe) p.set('recipe', st.recipe);
    return p.toString();
  };

  const recipeSel = h('select.cx-recipe', { title: 'Which recipe to show', on: { change: () => { st.recipe = recipeSel.value; try { localStorage.setItem(RECIPE_KEY, st.recipe); } catch {} load(); } } });
  const newBtn = h('button.small.go', { type: 'button', title: 'Write a new skill of your own', on: { click: () => panel.newSkill() } }, icon('plus', true), h('span', 'New skill'));
  const legend = h('div.cx-legend',
    h('span.cx-key.shipped', 'shipped'), h('span.cx-key.mine', 'yours'), h('span.cx-key.agent', "the agent's"), h('span.cx-key.missing', 'missing'));
  const sub = h('p.cx-sub.muted');
  const bar = h('header.cx-bar', h('div.cx-title', icon('book'), h('h2.display', 'Context')), h('label.cx-for', h('span.muted', 'Recipe'), recipeSel), sub, h('div.grow'), legend, newBtn);
  const cols = h('div.cx-cols');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('cx-lines');
  const shared = h('div.cx-shared');
  const lessons = h('section.cx-lessons');
  const library = h('section.cx-library');
  const canvas = h('div.cx-canvas', svg, cols, shared);
  const mapEl = h('div.cx-map', canvas, lessons, library);
  const side = h('aside.cx-side');
  const lister = listView({ panel: { open: (id) => panel.open(id), stage: (id) => panel.stage(id) }, getMap: () => st.map });
  const body = h('div.cx-body', mapEl, lister.el, side);
  const head = h('div.cx-head', bar);
  el.append(h('div.cx', head, body));

  const panel = createPanel(side, app, {
    map: () => st.map, query: q, reload: () => load(),
    opened: (id) => { st.open = id; mark(); },
  });

  const sets = setsBar({ app, ctx: panel.ctx, host: panel.ctx.host, onView: (v) => { mapEl.hidden = v === 'list'; lister.el.hidden = v !== 'list'; try { localStorage.setItem('presence.context.view', v); } catch {} if (v === 'list') lister.draw(); else requestAnimationFrame(drawLines); } });
  head.append(sets.el);

  // ---------------------------------------------------------------- load and draw
  async function load() {
    let m;
    try { m = await app.api('/api/context?' + q()); } catch (e) { sub.textContent = 'The context could not be read: ' + e.message; return; }
    st.map = m;
    if (!st.recipe) st.recipe = m.recipe?.id || null;
    draw();
    sets.draw(m);
    lister.draw();
    panel.refresh();
    openAsked();
  }
  // a stage chip asked for something to read (the brief, or what a stage reads): open it once the map is there
  function openAsked() {
    const m = app.hooks?.contextOpen;
    if (!m || !st.map) return;
    app.hooks.contextOpen = null;
    if (m.id && st.map.nodes?.[m.id]) panel.open(m.id);
    else if (m.stage && st.map.columns?.some((c) => c.id === m.stage)) panel.stage(m.stage);
  }

  function draw() {
    const m = st.map;
    recipeSel.replaceChildren(...m.recipes.map((r) => h('option', { value: r.id, selected: r.id === m.recipe?.id }, r.name)));
    recipeSel.disabled = m.recipes.length < 2;
    const proj = m.project ? `“${m.project.title}”` : 'no project open';
    sub.textContent = m.recipe ? `What each stage of ${m.recipe.name} reads, for ${proj}${m.project && m.project.recipe !== m.recipe.id ? ' (another recipe than the project’s)' : ''}.` : 'There are no recipes yet.';
    cols.replaceChildren(...m.columns.map(column));
    shared.replaceChildren(...m.shared.map((id) => sharedCard(m.nodes[id])));
    drawLessons(m);
    drawLibrary(m);
    mark();
    requestAnimationFrame(drawLines);
  }

  const nodeBtn = (n, cls, extra = []) => {
    const [badge, bcls] = stateBadge(n);
    return h('button.cx-node' + (cls ? '.' + cls : ''), { type: 'button', 'data-id': n.id, title: `${n.description || n.label}${n.words ? ` (${words(n.words)})` : ''}`, on: { click: () => panel.open(n.id) } },
      icon(KIND[n.kind]?.icon || 'note', true), h('span.cx-name', n.label), h('span.cx-words', words(n.words)), h('span.cx-dot.' + bcls, { title: badge }), ...extra);
  };

  function column(c) {
    const m = st.map;
    if (!c.agent) {
      return h('div.cx-col.user', { 'data-col': c.id },
        h('div.cx-col-head', h('span.cx-col-t', c.title), h('span.cx-kind', 'you')),
        h('p.cx-user', 'You decide here. The agent does not work at this stage.'));
    }
    const skills = c.skills.map((s) => {
      const n = m.nodes[s.id];
      const off = h('button.cx-off', { type: 'button', title: `Switch ${s.name} off for ${c.title}`, on: { click: (e) => { e.stopPropagation(); panel.toggle(c.id, s.name, false); } } }, '×');
      if (!n) return h('div.cx-node.cx-skill.missing', { title: `${s.name} is switched on but there is no such skill` }, icon('sparkle', true), h('span.cx-name', s.name), h('span.cx-words', 'missing'), off);
      return nodeBtn(n, 'cx-skill', [off]);
    });
    const can = addable(c, m.library, m.nodes);
    const add = h('select.cx-add', { title: 'Switch a skill on for this stage', on: { change: (e) => { if (e.target.value) panel.toggle(c.id, e.target.value, true); } } },
      h('option', { value: '' }, can.length ? '+ switch a skill on' : 'every skill is on'),
      ...can.map((s) => h('option', { value: s.name, title: s.description }, s.name)));
    add.disabled = !can.length;
    const reads = c.links.filter((l) => !m.shared.includes(l.to)).map((l) => nodeBtn(m.nodes[l.to], 'cx-own'));
    const refs = c.links.filter((l) => m.shared.includes(l.to)).map((l) => {
      const n = m.nodes[l.to];
      return h('button.cx-ref' + (l.how === 'writes' ? '.writes' : ''), { type: 'button', 'data-ref': `${c.id}>${l.to}`, title: `${c.title} ${l.how === 'writes' ? 'writes' : 'reads'} ${n.label}`, on: { click: () => panel.open(l.to) } },
        l.how === 'writes' ? '✎ ' : '', KIND[n.kind]?.name || n.label);
    });
    return h('div.cx-col', { 'data-col': c.id },
      h('button.cx-col-head', { type: 'button', title: `What ${c.title} reads`, on: { click: () => panel.stage(c.id) } },
        h('span.cx-col-t', c.title), h('span.cx-kind', c.kind), h('span.cx-words', words(c.words))),
      h('div.cx-label', 'Skills', c.from === 'yours' ? h('span.cx-mine-tag', { title: 'You changed the skills of this stage' }, 'your choice') : null),
      h('div.cx-list', ...(skills.length ? skills : [h('p.cx-none.dim', 'No skills switched on.')])),
      add,
      h('div.cx-label', 'Also reads'),
      h('div.cx-list', ...reads),
      h('div.cx-refs', ...refs));
  }

  function sharedCard(n) {
    const [badge, bcls] = stateBadge(n);
    const extra = n.kind === 'rules' && st.map.lessons.length
      ? h('span.cx-sub2', `${st.map.lessons.length} lesson${st.map.lessons.length === 1 ? '' : 's'}${st.map.lessons.some((l) => l.review) ? ', some up for review' : ''}`) : null;
    return h('button.cx-card', { type: 'button', 'data-id': n.id, title: n.description, on: { click: () => panel.open(n.id), mouseenter: () => hover(n.id), mouseleave: () => hover(null) } },
      h('div.cx-card-t', icon(KIND[n.kind]?.icon || 'note', true), h('span', n.label)),
      h('div.cx-card-m', h('span.cx-words', words(n.words)), h('span.cx-badge.' + bcls, badge)),
      h('div.cx-card-k.dim', n.kept), extra);
  }

  function drawLessons(m) {
    const l = m.lessons;
    lessons.replaceChildren(
      h('h3', icon('book', true), ' Lessons', h('span.dim', l.length ? ` from the house rules, ${l.length}` : '')),
      l.length
        ? h('ol.cx-lesson-list', ...l.map((x) => h('li' + (x.review ? '.review' : ''),
          h('button.cx-lesson', { type: 'button', title: 'Open the house rules', on: { click: () => panel.open('rules') } }, x.text),
          h('span.cx-counts', h('b.kept', `kept ${x.kept}`), ' · ', h('b.against', `against ${x.against}`)),
          h('span.dim', [x.date, x.evidence].filter(Boolean).join(': ')),
          x.review ? h('span.cx-review', { title: lessonCounts(x) }, 'up for review') : null)))
        : h('p.dim', 'None yet. The agent writes one when a correction of yours shows a way of working that would go wrong again; it lands here with its date, the evidence, and how often it held up.'));
  }

  function drawLibrary(m) {
    const all = m.library.map((id) => m.nodes[id]);
    library.replaceChildren(
      h('h3', icon('sparkle', true), ' Every skill', h('span.dim', ` ${all.length}`)),
      h('div.cx-lib', ...all.map((n) => nodeBtn(n, 'cx-skill', [h('span.cx-in.dim', n.readers.length ? `${n.readers.length} stage${n.readers.length === 1 ? '' : 's'}` : 'off')]))));
  }

  // ---------------------------------------------------------------- lines and highlights
  function drawLines() {
    const m = st.map;
    if (!m) return;
    const base = canvas.getBoundingClientRect();
    const rect = (e) => { const r = e.getBoundingClientRect(); return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height }; };
    svg.setAttribute('width', canvas.scrollWidth);
    svg.setAttribute('height', canvas.scrollHeight);
    const paths = [];
    for (const l of lines(m.columns, m.shared)) {
      const a = cols.querySelector(`[data-ref="${CSS.escape(`${l.from}>${l.to}`)}"]`), b = shared.querySelector(`[data-id="${CSS.escape(l.to)}"]`);
      if (!a || !b) continue;
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', linePath(rect(a), rect(b)));
      p.setAttribute('class', `cx-line to-${l.to.replace(/[^a-z0-9-]/gi, '')} ${l.how}`);
      p.dataset.from = l.from; p.dataset.to = l.to;
      paths.push(p);
    }
    svg.replaceChildren(...paths);
    mark();
  }
  function hover(id) { st.hover = id; mark(); }
  function mark() {
    const on = st.hover || st.open;
    for (const p of svg.querySelectorAll('path')) p.classList.toggle('lit', !!on && (p.dataset.to === on));
    canvas.classList.toggle('lit', !!st.hover);
    for (const b of el.querySelectorAll('[data-id]')) b.classList.toggle('open', b.dataset.id === st.open);
    for (const c of cols.querySelectorAll('.cx-col')) {
      const col = st.map?.columns.find((x) => x.id === c.dataset.col);
      const reads = !!on && !!col && (col.skills.some((s) => s.id === on) || col.links.some((l) => l.to === on));
      c.classList.toggle('reads', reads);
    }
  }

  // drag the map's empty ground to pan when it is wider or taller than its room
  mapEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, select, a, input, textarea, summary')) return;
    if (mapEl.scrollWidth <= mapEl.clientWidth && mapEl.scrollHeight <= mapEl.clientHeight) return;
    const x0 = e.clientX, y0 = e.clientY, l0 = mapEl.scrollLeft, t0 = mapEl.scrollTop;
    mapEl.setPointerCapture(e.pointerId); mapEl.classList.add('panning');
    const move = (ev) => { mapEl.scrollLeft = l0 - (ev.clientX - x0); mapEl.scrollTop = t0 - (ev.clientY - y0); };
    const up = () => { mapEl.classList.remove('panning'); mapEl.removeEventListener('pointermove', move); mapEl.removeEventListener('pointerup', up); mapEl.removeEventListener('pointercancel', up); };
    mapEl.addEventListener('pointermove', move); mapEl.addEventListener('pointerup', up); mapEl.addEventListener('pointercancel', up);
  });

  const ro = new ResizeObserver(() => requestAnimationFrame(() => { drawLines(); mapEl.classList.toggle('pannable', mapEl.scrollWidth > mapEl.clientWidth + 2); }));
  ro.observe(canvas);

  // ---------------------------------------------------------------- live
  try { const v = localStorage.getItem('presence.context.view'); if (v === 'list') sets.setView('list'); } catch {}
  try { st.recipe = app.project()?.recipe || localStorage.getItem(RECIPE_KEY) || null; } catch {}
  app.on('open-context', () => openAsked());
  app.on('context', () => load());
  app.on('project', () => load()); // the brief is written at the ask stage
  app.on('files', (m) => { if ((m.paths || []).some((p) => /brief\.md$|house-rules\.md$/.test(String(p)))) load(); });
  load();

  return { unmount() { ro.disconnect(); panel.close(); } };
}
