// The Context tab's two forms in the side panel: a stage (what it reads, in order, with its instructions and the whole
// context section its prompt gets) and a new skill (name, description, text; kept as typed, like every other text).
import { h, icon, debounce } from '../shell/dom.js';
import { KIND, words } from './view.js';

// ---------------------------------------------------------------- a stage
export async function stageView(ctx, id) {
  const { app, host, side } = ctx;
  const m = host.map(), c = m?.columns.find((x) => x.id === id);
  if (!c) return ctx.empty();
  let r = null;
  try { r = await app.api(`/api/context/stage?stage=${encodeURIComponent(id)}&${host.query()}`); } catch (e) { app.toast(e.message, 'error'); }
  // the whole prompt, for the stage the project is at (the server builds it: GET /api/projects/:id/prompt)
  let whole = null;
  const p = app.project();
  if (p?.id && p.at === id && p.recipe === m.recipe?.id) {
    try { whole = (await app.api(`/api/projects/${encodeURIComponent(p.id)}/prompt`))?.prompt || null; } catch {}
  }
  ctx.set({ stage: id });
  host.opened(null);
  const row = (n, how) => h('li', h('button.cx-node.cx-flat', { type: 'button', on: { click: () => ctx.open(n.id) } },
    icon(KIND[n.kind]?.icon || 'note', true), h('span.cx-name', n.label), h('span.cx-words', how === 'writes' ? 'writes it' : words(n.words))));
  const reads = [
    ...c.links.filter((l) => l.to === 'claude' || l.to === 'home').map((l) => row(m.nodes[l.to], l.how)),
    ...c.links.filter((l) => l.to.startsWith('stage:')).map((l) => row(m.nodes[l.to], l.how)),
    ...c.skills.map((s) => (m.nodes[s.id] ? row(m.nodes[s.id]) : h('li.dim', `${s.name}: switched on, but there is no such skill`))),
    ...c.links.filter((l) => l.to === 'rules' || l.to === 'brief').map((l) => row(m.nodes[l.to], l.how)),
  ];
  const resetBtn = c.from === 'yours' ? h('button.small.warn', { type: 'button', title: 'Back to the skills this stage ships with', on: { click: async () => {
    try { await ctx.post('/api/context/stage-reset', { stage: id }); app.toast(`${c.title}: shipped skills again.`, 'ok'); } catch (e) { app.toast(e.message, 'error'); }
  } } }, icon('restore', true), h('span', 'Reset skills to default')) : null;
  side.replaceChildren(h('div.cx-panel',
    h('header.cx-p-head', icon('agent'), h('div', h('h3', c.title), h('span.cx-badge.shipped', `${c.kind} stage`)),
      h('button.icon-only.cx-close', { type: 'button', title: 'Close', on: { click: ctx.empty } }, icon('cross', true))),
    h('p.cx-desc', c.agent ? `In the order the agent gets them. ${words(c.words)} in all.` : 'You decide at this stage; the agent does not work here.'),
    c.agent ? h('ol.cx-reads', ...reads) : null,
    c.agent ? h('div.cx-acts', h('button.small.go', { type: 'button', on: { click: () => newSkillForm(ctx, id) } }, icon('plus', true), h('span', 'New skill for this stage')), resetBtn) : null,
    r?.missing?.length ? h('p.cx-note.warn', `Switched on but missing: ${r.missing.join(', ')}.`) : null,
    r ? h('details.cx-preview', h('summary', 'What the stage prompt says about its context'), h('pre', r.text)) : null,
    whole ? h('details.cx-preview', h('summary', 'The whole message this stage sends the agent now'), h('pre', whole)) : null));
}

// ---------------------------------------------------------------- a new skill
const DRAFT = 'new-skill';

export async function newSkillForm(ctx, stageId) {
  const { app, host, side } = ctx;
  const m = host.map();
  const agentCols = (m?.columns || []).filter((c) => c.agent);
  const name = h('input', { type: 'text', placeholder: 'cut-my-way', maxLength: 64, autocomplete: 'off' });
  const desc = h('textarea', { rows: 3, placeholder: 'What it is for and when to use it, in a sentence or two. The agent reads this first.' });
  const text = h('textarea.cx-text', { rows: 14, spellcheck: 'false', placeholder: '# How to do it\n\nThe steps, in your own words.' });
  const stage = h('select', h('option', { value: '' }, 'no stage yet'), ...agentCols.map((c) => h('option', { value: c.id, selected: c.id === stageId }, `switch it on for ${c.title}`)));
  const note = h('div.cx-note', { hidden: true });
  const make = h('button.go', { type: 'button' }, icon('plus', true), h('span', 'Make the skill'));

  // what is typed is kept: this browser at once, the server a moment later
  const pid = app.project()?.id || '';
  const form = () => ({ name: name.value, description: desc.value, text: text.value, stage: stage.value, at: Date.now() });
  const toServer = debounce((v) => ctx.post('/api/context/draft', { id: DRAFT, text: v ? JSON.stringify(v) : null }).catch(() => {}), 500);
  const keep = () => {
    const v = form(), blank = !v.name && !v.description && !v.text;
    ctx.setLocal(DRAFT, blank ? null : v);
    toServer(blank ? null : v);
  };
  const fill = (v) => { if (!v) return; name.value = v.name || ''; desc.value = v.description || ''; text.value = v.text || ''; if (v.stage && !stageId) stage.value = v.stage; };
  let server = null;
  try { const r = await app.api(`/api/context/draft?id=${DRAFT}&${host.query()}`); server = r.draft?.text ? { ...JSON.parse(r.draft.text), at: r.draft.at } : null; } catch {}
  const mine = ctx.local(DRAFT);
  fill([server, mine].filter(Boolean).sort((a, b) => (b.at || 0) - (a.at || 0))[0]);
  for (const e of [name, desc, text]) { e.addEventListener('input', keep); e.addEventListener('blur', () => toServer.flush()); }
  stage.addEventListener('change', keep);

  make.addEventListener('click', async () => {
    make.disabled = true;
    try {
      const r = await ctx.post('/api/context/skill', { name: name.value, description: desc.value, text: text.value, stage: stage.value || undefined });
      ctx.setLocal(DRAFT, null);
      app.toast(`${r.id.replace(/^skill:/, '')} made${stage.value ? ' and switched on' : ''}.`, 'ok');
      ctx.set(null);
      ctx.open(r.id);
    } catch (e) {
      make.disabled = false;
      note.hidden = false; note.className = 'cx-note error'; note.textContent = e.message;
    }
  });

  ctx.set({ form: true, id: DRAFT });
  host.opened(null);
  side.replaceChildren(h('div.cx-panel',
    h('header.cx-p-head', icon('sparkle'), h('div', h('h3', 'A new skill'), h('span.cx-badge.mine', 'yours')),
      h('button.icon-only.cx-close', { type: 'button', title: 'Close (what you typed is kept)', on: { click: () => { toServer.flush(); ctx.empty(); } } }, icon('cross', true))),
    h('p.cx-desc', `It is kept in your data folder (data/craft/skills/<name>/SKILL.md). ${pid ? '' : 'It is not tied to a project: every project can use it.'}`),
    h('label.cx-field', h('span', 'Name'), name),
    h('label.cx-field', h('span', 'Description'), desc),
    h('label.cx-field', h('span', 'Text'), text),
    h('label.cx-field', h('span', 'Stage'), stage),
    h('div.cx-acts', make),
    note));
}
