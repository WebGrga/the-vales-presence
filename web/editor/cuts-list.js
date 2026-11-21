// The Cuts list: what the agent asks you to look at ("From the agent", cuts-items.js), then every cut of the rough, the
// flagged ones first. A card shows the time (click = the viewer jumps a second before it), the kind and why, the
// question when the agent asks one, the kept words around the removed words (struck through), a Before/After player,
// and Keep cut / Restore words / Note. Every click and every typed note is saved at once by the store and read back
// after a reload. Once the talk is locked, Keep cut and Restore words are off (a line says why); while the rough is
// sent back, the notes it carried stay on top. The order and words are in cuts-order.js.
import { h, icon, button } from '../shell/dom.js';
import { fetchJson } from '../shell/api.js';
import { recipeOf, isLocked, sentBack } from '../shell/stages.js';
import { groupCuts, listOrder, countLine } from './cuts-order.js';
import { reviewItems, itemsSection } from './cuts-items.js';
import { cutsHint, keysOf, keyLabel } from './keys.js';
import { fmtTime } from './zoom.js';

const KIND_ICON = { pause: 'clock', filler: 'note', retake: 'restore', aside: 'question', wait: 'clock', other: 'scissors' };
const FOLD = 'presence.cutsFold';

export function createCutsList(store, ui) {
  const S = store.S;
  const shell = window.presence; // the app: the project (for the lock) and its live messages
  const count = h('b.cuts-count');
  const saved = h('span.cuts-saved');
  const banner = h('div.cuts-banner', { hidden: true });
  const list = h('div.cuts-list');
  const el = h('div.cuts', h('div.cuts-head', count, saved), banner, list);
  const cards = new Map(); // id -> card element
  let order = [], playing = null, items = [], locked = false, keys = null;
  let folded = (() => { try { return JSON.parse(localStorage.getItem(FOLD) || '{"pauses":true}'); } catch { return { pauses: true }; } })();
  const fold = (id, v) => { folded = { ...folded, [id]: v }; try { localStorage.setItem(FOLD, JSON.stringify(folded)); } catch {} };
  const key = (a) => (keys ? keysOf(keys, a).map(keyLabel)[0] : '') || '';

  el.addEventListener('pointerdown', (e) => { if (!e.target.closest('textarea')) ui.setScope('cuts'); });

  // the keys from keys.json, in the head's hint and the buttons' tips
  fetch('/editor/keys.json').then((r) => r.json()).then((k) => {
    keys = k;
    const hint = el.closest('.panel')?.querySelector('.cut-keys');
    if (hint) hint.textContent = cutsHint(k);
    render();
  }).catch(() => {});

  // the lock and a send-back come from the project
  function paintProject() {
    const p = shell?.project?.();
    const was = locked;
    locked = !!p && isLocked(p, recipeOf(p));
    const sent = p ? sentBack(p, recipeOf(p)) : null;
    banner.replaceChildren();
    if (sent) {
      banner.append(h('div.cuts-sent', h('div.cuts-sent-h', icon('back', true), h('b', `Sent back to ${sent.title}`), h('span.dim', 'the agent works on these notes; the new cuts come with the new rough')),
        h('pre.cuts-sent-notes', sent.notes)));
    } else if (locked) {
      banner.append(h('p.cuts-locked', icon('lock', true), h('span', 'The talk is locked: Keep cut and Restore words no longer change anything. Notes still reach the agent when you send the video back.')));
    }
    banner.hidden = !banner.children.length;
    if (was !== locked) paint();
  }
  const offs = shell?.on ? [shell.on('project', () => setTimeout(paintProject, 200)), shell.on('files', (m) => {
    if (m.project && m.project !== S.id) return;
    if ((m.paths || []).some((x) => /out\/review-items(-review)?\.json$|inspect\.md$/.test(String(x).replace(/\\/g, '/')))) loadItems();
  }), shell.on('review-items', (m) => { if (m.project === S.id && !m.short) loadItems(); })] : [];

  // the agent's review items through their route (with your marks), else the file itself
  async function loadItems() {
    let data = null;
    try { data = await shell.api(`/api/projects/${encodeURIComponent(S.id)}/review-items`); } catch { data = await fetchJson(store.media('video/out/review-items.json')); }
    items = reviewItems(data);
    render();
  }
  async function markItem(id, done) {
    try { const r = await shell.api(`/api/projects/${encodeURIComponent(S.id)}/review-items`, { id, done }); items = reviewItems(r); render(); }
    catch (e) { ui.toast('Not marked: ' + e.message, 'error'); }
  }

  function render() {
    cards.clear(); playing = null;
    paintProject();
    const g = groupCuts(S.cuts);
    order = listOrder(g);
    list.replaceChildren(...itemsSection(items, { seek: (t) => ui.seek(Math.max(0, t), { play: true }), folded: folded.agent, onFold: (f) => fold('agent', f), onDone: shell?.api ? markItem : null }));
    if (!S.cuts.length) { list.append(h('p.dim.cuts-none', S.loaded ? 'No cuts to review. They come with the rough cut.' : 'Reading the cuts…')); paintCount(); return; }
    section('flagged', 'For you', 'flag', g.flagged);
    section('others', 'The others', 'scissors', g.others);
    section('pauses', 'Small pauses', 'clock', g.pauses);
    paintCount();
    paintCurrent();
  }
  function section(id, title, ic, cuts) {
    if (!cuts.length) return;
    const head = h('button.cuts-sec.calm', { type: 'button' }, icon(ic, true), h('span', title), h('span.dim', String(cuts.length)), h('span.caret', folded[id] ? '▸' : '▾'));
    const body = h('div.cuts-sec-body', { hidden: !!folded[id] });
    head.addEventListener('click', () => {
      fold(id, !folded[id]); body.hidden = !!folded[id];
      head.querySelector('.caret').textContent = folded[id] ? '▸' : '▾';
    });
    for (const c of cuts) body.append(card(c));
    list.append(head, body);
  }

  function card(c) {
    const restorable = store.restorable(c.id);
    const gap = c.jump ? h('span.cut-gap', c.jump === 'back' ? 'jumps back in the recording' : 'jumps to another recording')
      : c.removed ? h('del', c.removed) : h('span.cut-gap', `${Number(c.len) ? Number(c.len).toFixed(1) + ' s of ' : ''}${c.kind === 'pause' ? 'silence' : 'nothing said'}`);
    const trim = (s, end) => String(s || '').replace(end ? /(\.{3}|…)\s*$/ : /^\s*(\.{3}|…)/, '').trim();
    const at = h('button.cut-at.small.calm', { type: 'button', title: 'Play from a second before this cut' }, fmtTime(c.at));
    const st = h('span.cut-state');
    const kk = key('keep'), rk = key('restore');
    const keep = button('keep', 'Keep cut', `The cut is right: it stays cut, the words stay out${kk ? ` (${kk})` : ''}`, () => choose(c, true), 'small');
    const back = button('restore', 'Restore words', restorable ? `Put the removed words back: it plays at once${rk ? ` (${rk})` : ''}` : `Put it back${rk ? ` (${rk})` : ''}. This one is not a simple join: the agent puts it back when the rough is rebuilt.`, () => choose(c, false), 'small');
    const noteBtn = button('note', 'Note', 'A note on this cut (N)', () => toggleNote(), 'small calm');
    const ba = button('ab', 'Before / After', 'Hear the cut: the recording with the words in, then the edit (Enter)', () => openPlayer('before'), 'small calm');
    const note = h('textarea.cut-note', { rows: 2, placeholder: 'Your note on this cut…', hidden: true });
    note.value = S.review[c.id]?.note || '';
    const vid = h('video', { controls: true, playsInline: true, preload: 'none' });
    const player = h('div.cut-player', { hidden: true },
      h('div.seg', ...['before', 'after'].map((w) => { const b = h('button.small', { type: 'button', 'data-w': w }, w === 'before' ? 'Before' : 'After'); b.addEventListener('click', () => openPlayer(w)); return b; })),
      vid, h('p.dim.cut-noclip', { hidden: true }, 'No clip was made for this cut.'));
    const el = h(`div.cut-card${c.flag ? '.flag' : ''}`, { 'data-id': c.id },
      h('div.cut-top', at, h('span.cut-kind', icon(KIND_ICON[c.kind] || 'scissors', true), h('span', c.kind || 'cut')), h('span.cut-id.dim', c.id), st),
      c.why ? h('div.cut-why', c.why) : null,
      c.ask ? h('div.cut-ask', icon('question', true), h('span', c.ask)) : null,
      h('div.cut-words', h('span.ctx', trim(c.before) ? '…' + trim(c.before) + ' ' : ''), gap, h('span.ctx', trim(c.after, true) ? ' ' + trim(c.after, true) + '…' : '')),
      player,
      h('div.cut-acts', keep, back, noteBtn, ba),
      note);
    if (!restorable && !c.jump) back.classList.add('soft');
    at.addEventListener('click', () => { ui.selectCut(c.id, { seek: true, lead: 1, play: true }); });
    el.addEventListener('click', (e) => { if (!e.target.closest('button, textarea, video')) ui.selectCut(c.id, { seek: true }); });
    note.addEventListener('input', () => { store.note(c.id, note.value); noteBtn.classList.toggle('on', !!note.value.trim()); });
    note.addEventListener('blur', () => store.flush());
    function toggleNote() { if (note.hidden) { note.hidden = false; note.focus(); } else if (!note.value.trim()) note.hidden = true; else note.focus(); }
    function openPlayer(which) {
      if (playing && playing !== el) closePlayer(playing);
      playing = el; player.hidden = false;
      for (const b of player.querySelectorAll('[data-w]')) b.classList.toggle('on', b.dataset.w === which);
      const rel = store.clipUrl(c, which);
      player.querySelector('.cut-noclip').hidden = !!rel; vid.hidden = !rel;
      if (rel) { vid.src = rel; vid.play().catch(() => {}); }
      ui.selectCut(c.id, { seek: false });
    }
    el._open = openPlayer; el._note = toggleNote; el._paint = () => paintCard(el, c);
    cards.set(c.id, el);
    paintCard(el, c);
    return el;
  }
  function closePlayer(card) { const v = card.querySelector('video'); v.pause(); v.removeAttribute('src'); v.load(); card.querySelector('.cut-player').hidden = true; }

  function paintCard(el, c) {
    const r = S.review[c.id] || {};
    el.classList.toggle('kept', r.keep === true); el.classList.toggle('restored', r.keep === false);
    el.classList.toggle('locked', locked);
    const [keep, back, noteBtn] = el.querySelectorAll('.cut-acts button');
    keep.classList.toggle('on', r.keep === true); back.classList.toggle('on', r.keep === false);
    keep.disabled = back.disabled = locked;
    if (locked) keep.title = back.title = 'The talk is locked: this no longer changes the video';
    noteBtn.classList.toggle('on', !!String(r.note || '').trim());
    el.querySelector('.cut-state').textContent = r.keep === true ? 'stays cut' : r.keep === false ? 'words come back' : '';
    // restored words are no longer struck in red: they are back in
    const del = el.querySelector('.cut-words del');
    if (del) del.classList.toggle('back', r.keep === false);
    const note = el.querySelector('.cut-note');
    if (r.note && note.hidden) note.hidden = false;
    if (document.activeElement !== note && (r.note || '') !== note.value) note.value = r.note || '';
  }
  function choose(c, keep) {
    if (locked) { ui.toast('The talk is locked: Keep cut and Restore words no longer change anything. Add a note instead.', 'warn'); return; }
    store.choose(c.id, keep);
    if (keep === false && S.review[c.id]?.keep === false && !store.restorable(c.id)) ui.toast(`${c.id} is not a simple join: it comes back when the agent rebuilds the rough.`, 'warn');
    ui.selectCut(c.id, { seek: false });
  }
  function paintCount() { count.textContent = countLine(S.cuts, S.review); }
  function paintCurrent() {
    const cur = ui.currentCut()?.id;
    for (const [id, el] of cards) el.classList.toggle('cur', id === cur);
  }
  function paint() { for (const [id, el] of cards) paintCard(el, S.cuts.find((c) => c.id === id)); paintCount(); }

  loadItems();
  return {
    el, render, paint, paintCurrent,
    saved(state) { saved.textContent = state === 'saved' ? '✓ saved' : state || ''; saved.className = 'cuts-saved ' + (state === 'saved' ? 'ok' : state ? 'busy' : ''); },
    reveal(id) {
      const el = cards.get(id); if (!el) return;
      const body = el.closest('.cuts-sec-body');
      if (body?.hidden) body.previousElementSibling.click();
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      paintCurrent();
    },
    order: () => order,
    keep(id) { const c = S.cuts.find((x) => x.id === id); if (c) choose(c, true); },
    restore(id) { const c = S.cuts.find((x) => x.id === id); if (c) choose(c, false); },
    note(id) { cards.get(id)?._note(); },
    play(id) { cards.get(id)?._open('before'); },
    dispose() { offs.forEach((o) => o?.()); },
  };
}
