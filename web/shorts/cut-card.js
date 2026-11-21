// A cut Short in the Shorts tab: its 9:16 final (or rough) to watch whole, its length and check, Good / Redo and a note
// for the agent (saved at once: POST /api/shorts/:id/cut-review), and the agent's review items with their times
// (GET /api/projects/:id/review-items?short=<id>), a click on one plays from there.
import { h, icon, debounce } from '../shell/dom.js';
import { clock } from './list.js';

export function cutCard(m, { app, id, onData }) {
  const video = h('video', { src: app.media(m.cut.video), preload: 'metadata', playsInline: true, controls: true });
  const frame = h('div.shorts-frame.is-cut', video,
    h('span.shorts-len.pixel', m.cut.len != null ? `${m.cut.len} s` : ''),
    h('span.shorts-badge.pixel', m.cut.which === 'final' ? 'cut' : 'rough only'));
  const good = h('button', { type: 'button', title: 'This Short is ready', on: { click: () => choose('ok') } }, icon('keep', true), h('span', 'Good'));
  const redo = h('button', { type: 'button', title: 'Cut it again with your note', on: { click: () => choose('redo') } }, icon('redo', true), h('span', 'Redo'));
  const note = h('textarea.shorts-note', { rows: 2, placeholder: 'What to change in this Short (where to start, what to cut, the captions)…' });
  note.value = m.cutNote || '';
  const saved = h('span.shorts-saved.dim');
  const items = h('ul.shorts-items');
  const info = h('div.shorts-info');
  const el = h('article.shorts-card.is-cutshort', frame, info, items, h('div.seg.shorts-choice', good, redo), note, saved);

  const post = async (body) => {
    const r = await app.api(`/api/shorts/${id}/cut-review`, { short: m.id, ...body });
    onData?.(r);
    return r;
  };
  const save = debounce(async (text) => {
    try { await post({ note: text }); saved.textContent = 'saved'; setTimeout(() => { saved.textContent = ''; }, 1200); }
    catch (e) { saved.textContent = 'not saved'; app.toast(`The note was not saved: ${e.message}`, 'error'); }
  }, 400);
  note.addEventListener('input', () => { saved.textContent = '…'; save(note.value); });
  note.addEventListener('blur', () => save.flush());

  async function choose(status) {
    save.flush();
    const next = c.m.cutStatus === status ? null : status; // a second click clears it
    try { await post({ status: next }); } catch (e) { app.toast(`Not saved: ${e.message}`, 'error'); }
  }

  async function loadItems() {
    let list = [];
    try { list = (await app.api(`/api/projects/${id}/review-items?short=${encodeURIComponent(m.id)}`)).items || []; } catch {}
    items.replaceChildren(...list.map((it) => h('li', { class: it.done ? 'done' : '' },
      it.at != null ? h('button.shorts-at.calm', { type: 'button', title: 'Play from here', on: { click: () => { video.currentTime = it.at; video.play().catch(() => {}); } } }, clock(it.at)) : null,
      h('span', it.text))));
    items.hidden = !list.length;
  }

  const c = { el, note, save, video, m, kind: 'cut', update, loadItems };
  function update(n) {
    c.m = n;
    if (app.media(n.cut.video) !== video.getAttribute('src') && video.paused) video.src = app.media(n.cut.video);
    el.classList.toggle('is-keep', n.cutStatus === 'ok');
    el.classList.toggle('is-redo', n.cutStatus === 'redo');
    good.classList.toggle('on', n.cutStatus === 'ok');
    redo.classList.toggle('on', n.cutStatus === 'redo');
    if (document.activeElement !== note && !save.pending() && note.value !== (n.cutNote || '')) note.value = n.cutNote || '';
    info.replaceChildren(...[
      h('div.shorts-name.pixel', n.title || n.id),
      h('div.shorts-span.dim', [n.cut.len != null ? `${n.cut.len} s` : '', n.cut.passed === true ? 'check passed' : n.cut.passed === false ? 'check failed' : ''].filter(Boolean).join(' · ')),
      n.hook ? h('p.shorts-hook', `“${n.hook}”`) : null,
    ].filter(Boolean));
  }
  update(m);
  loadItems();
  return c;
}
