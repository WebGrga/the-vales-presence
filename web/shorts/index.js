// The Shorts tab: the moments the agent picked from a long video, each a 9:16 card that plays its stretch, with Keep / Drop / Note
// saved at once (GET/POST /api/shorts/:id), and "Cut these", which approves the pick review with the choices and starts the cutting
// (POST /api/shorts/:id/cut: it says when it waits in line). Once a pick is cut its card turns into the cut Short (cut-card.js):
// watch it, Good / Redo with a note, and "Approve the Shorts" / "Send back the Redo ones" for the Review stage. In an edit project
// the tab offers Shorts from this edit: a new Shorts project with this rough and its words linked in (POST .../from-edit).
import { h, icon, debounce } from '../shell/dom.js';
import { ensureCss } from '../setup/first.js';
import { span, previewFile, playWindow, counts } from './list.js';
import { cutCard } from './cut-card.js';
import { usesLine } from '../context/uses.js';

export async function mount(el, app) {
  ensureCss(new URL('./shorts.css', import.meta.url));
  const root = h('div.shorts');
  el.append(root);
  const p = app.project();
  if (!p) { root.append(h('h2', 'Shorts'), h('p.muted', 'Open a project first.')); return { unmount() {} }; }
  const id = encodeURIComponent(p.id);
  let data = { shorts: [], counts: { all: 0, keep: 0, drop: 0 } };
  let proxies = null, edl = null, busy = false;
  const cards = new Map(); // short id -> { el, note, save, video, kind: 'pick'|'cut' }
  const head = h('div.shorts-head');
  const fromBox = h('div.shorts-from');
  const grid = h('div.shorts-grid');
  const foot = h('div.shorts-foot');
  const uses = usesLine(app, ['pick', 'cut', 'rough', 'visuals']); // the skills the project's set gives these stages
  root.append(head, uses.el, fromBox, grid, foot);

  async function load() {
    try { data = await app.api(`/api/shorts/${id}`); } catch (e) { data = { shorts: [], counts: { all: 0 }, error: e.message }; }
    // a browser plays .mp4 itself; a recording in another container (.mkv, .mov) plays from its proxy, asked for once
    if (!edl && data.shorts.some((m) => m.src && m.src !== 'rough' && !m.cut)) {
      try { edl = await (await fetch(app.media('video/out/edl.json'), { cache: 'no-cache' })).json(); } catch { edl = {}; }
    }
    draw();
    // making a proxy can take a while: the cards show at once and their pictures switch to the proxies when they are ready
    if (!proxies && data.shorts.some((m) => !m.cut && !/\.mp4$/i.test(previewFile(m, { edl, hasRough: data.hasRough }) || '.mp4'))) {
      proxies = {};
      app.api(`/api/projects/${id}/proxy`).then((x) => { proxies = x || {}; repoint(); }).catch(() => {});
    }
  }
  const take = (r) => { if (r?.shorts) { data = { ...data, shorts: r.shorts, review: r.review || data.review }; draw(); } };

  function repoint() {
    for (const c of cards.values()) {
      if (c.kind !== 'pick') continue;
      const file = previewFile(c.m, { proxies, edl, hasRough: data.hasRough });
      if (file && file !== c.file && c.video) { c.file = file; c.video.src = app.media(file) + `#t=${c.m.from ?? 0}`; }
    }
  }

  function drawHead() {
    const c = counts(data.shorts);
    const cutNow = data.cut?.do && data.cut.do !== 'none';
    const why = !c.keep ? 'Keep at least one Short first.' : !cutNow ? data.cut?.why || '' : '';
    const go = cutNow || !data.shorts.some((m) => m.cut)
      ? h('button.go', { type: 'button', disabled: !!why || busy, title: why || 'Approve your picks and start cutting them', on: { click: cutThese } },
        icon('scissors', true), h('span', busy ? 'Starting…' : c.keep ? `Cut these (${c.keep})` : 'Cut these'))
      : null;
    const made = data.shorts.filter((m) => m.cut).length;
    head.replaceChildren(
      h('div.shorts-title', h('h2', 'Shorts'),
        data.shorts.length ? h('span.shorts-count.pixel', `${c.all} picked · ${c.keep} kept · ${c.drop} dropped${made ? ` · ${made} cut` : ''}`) : null),
      h('div.shorts-tools', why && data.shorts.length && go ? h('span.dim', why) : null, go));
  }

  // Shorts from this edit (an edit project), or where this Shorts project came from
  function drawFrom() {
    const parts = [];
    if (data.madeFrom) parts.push(h('p.dim', 'Made from the edit of ', h('a', { href: `#/${encodeURIComponent(data.madeFrom.project)}/edit` }, data.madeFrom.title), ': its rough and words, nothing uploaded or transcribed again.'));
    if (data.fromEdit && !data.madeFrom) {
      const ok = !data.fromEdit.error;
      parts.push(h('div.shorts-fromedit',
        h('div', h('div.shorts-name.pixel', 'Shorts from this edit'),
          h('p.muted', ok ? 'The agent picks the moments from this project’s rough (its words are already there), you keep or drop each, it cuts the ones you kept. A new Shorts project is made beside this one; nothing is uploaded or transcribed again.' : data.fromEdit.error)),
        ok ? h('button.go', { type: 'button', disabled: busy, on: { click: fromEdit } }, icon('phone', true), h('span', 'Pick Shorts from this edit')) : null));
    }
    if (data.made?.length) parts.push(h('p.dim', 'Shorts projects made from this one: ', ...data.made.flatMap((m, i) => [i ? ', ' : '', h('a', { href: `#/${encodeURIComponent(m.id)}/shorts` }, m.title)])));
    fromBox.replaceChildren(...parts);
    fromBox.hidden = !parts.length;
  }

  function drawFoot() {
    const plan = data.review;
    const cur = app.project();
    const st = cur?.recipeDef?.stages?.find((s) => s.id === cur.at);
    const atReview = st?.kind === 'gate' && cur?.stages?.[cur.at]?.status === 'waiting';
    if (!data.shorts.some((m) => m.cut) || !plan || plan.error) { foot.replaceChildren(); return; }
    const back = plan.action === 'sendback';
    const b = h(back ? 'button.calm' : 'button.go', { type: 'button', disabled: !atReview || busy, title: atReview ? plan.notes : 'The Shorts are reviewed at the Review stage', on: { click: review } },
      icon(back ? 'send' : 'keep', true), h('span', back ? `Send back ${plan.redo.join(', ')} to cut again` : 'Approve the Shorts'));
    foot.replaceChildren(h('p.dim', back ? 'Only the Shorts marked Redo are cut again, with your notes.' : plan.open?.length ? `Not marked yet: ${plan.open.join(', ')} (Approve passes them as they are).` : 'Every Short is marked Good.'), b);
  }

  function draw() {
    drawHead(); drawFrom(); drawFoot();
    if (data.error) { grid.replaceChildren(h('p.shorts-empty', `The Shorts did not load: ${data.error}`)); return; }
    if (!data.shorts.length) {
      grid.replaceChildren(h('div.shorts-empty',
        h('img.icon', { src: '/icons/phone.png', alt: '' }),
        h('p', 'No Shorts picked yet.'),
        h('p.muted', 'The agent reads the whole video and picks the moments that stand alone: a strong first line, one point, a payoff, under a minute. They show up here as cards to keep or drop.')));
      for (const c of cards.values()) c.save.flush();
      cards.clear();
      return;
    }
    const keepIds = new Set(data.shorts.map((m) => `${m.id}:${m.cut ? 'cut' : 'pick'}`));
    for (const [k, c] of cards) if (!keepIds.has(k)) { c.save.flush(); c.video?.pause(); cards.delete(k); }
    // the cut Shorts first, then the picks still to cut
    const ordered = [...data.shorts.filter((m) => m.cut), ...data.shorts.filter((m) => !m.cut)];
    const els = ordered.map((m) => {
      const key = `${m.id}:${m.cut ? 'cut' : 'pick'}`;
      let c = cards.get(key);
      if (!c) { c = m.cut ? cutCard(m, { app, id, onData: take }) : card(m); cards.set(key, c); } else (c.kind === 'cut' ? c.update(m) : update(c, m));
      return c.el;
    });
    // move nothing that is already in place: a moved video stops and a moved note box loses the caret
    const same = els.length === grid.children.length && els.every((e, i) => grid.children[i] === e);
    if (!same) grid.replaceChildren(...els);
  }

  function card(m) {
    const file = previewFile(m, { proxies, edl, hasRough: data.hasRough });
    const video = file ? h('video', { src: app.media(file) + `#t=${m.from ?? 0}`, preload: 'metadata', muted: false, playsInline: true }) : null;
    const play = h('button.shorts-play.icon-only', { type: 'button', title: 'Play this moment' }, icon('play'));
    const frame = h('div.shorts-frame', video || h('div.shorts-novideo.dim', 'No preview yet'), video ? play : null, h('span.shorts-len.pixel', m.len != null ? `${Math.round(m.len)} s` : ''));
    if (video) {
      const win = () => playWindow(m, video.duration);
      const toggle = () => {
        if (video.paused) { const w = win(); if (video.currentTime < w.from || video.currentTime >= w.to - 0.05) video.currentTime = w.from; video.play().catch(() => {}); }
        else video.pause();
      };
      play.addEventListener('click', toggle);
      video.addEventListener('click', toggle);
      video.addEventListener('play', () => frame.classList.add('playing'));
      video.addEventListener('pause', () => frame.classList.remove('playing'));
      video.addEventListener('timeupdate', () => { const w = win(); if (video.currentTime >= w.to) { video.pause(); video.currentTime = w.from; } });
    }
    const keep = h('button', { type: 'button', on: { click: () => choose(m.id, 'keep') } }, icon('keep', true), h('span', 'Keep'));
    const drop = h('button', { type: 'button', on: { click: () => choose(m.id, 'drop') } }, icon('cross', true), h('span', 'Drop'));
    const note = h('textarea.shorts-note', { rows: 2, placeholder: 'A note for the agent (where to start, what to cut, a title idea)…' });
    note.value = m.note || '';
    const saved = h('span.shorts-saved.dim');
    const save = debounce(async (text) => {
      try { const r = await app.api(`/api/shorts/${id}`, { short: m.id, note: text }); data = { ...data, ...r }; saved.textContent = 'saved'; setTimeout(() => { saved.textContent = ''; }, 1200); drawHead(); }
      catch (e) { saved.textContent = 'not saved'; app.toast(`The note was not saved: ${e.message}`, 'error'); }
    }, 400);
    note.addEventListener('input', () => { saved.textContent = '…'; save(note.value); });
    note.addEventListener('blur', () => save.flush());
    const info = h('div.shorts-info');
    const el = h('article.shorts-card', frame, info, h('div.seg.shorts-choice', keep, drop), note, saved);
    const c = { el, note, save, video, keep, drop, info, m, file, kind: 'pick' };
    update(c, m);
    return c;
  }

  function update(c, m) {
    c.m = m;
    c.el.classList.toggle('is-keep', m.status === 'keep');
    c.el.classList.toggle('is-drop', m.status === 'drop');
    c.keep.classList.toggle('on', m.status === 'keep');
    c.drop.classList.toggle('on', m.status === 'drop');
    // the server's note only replaces the box when the user is not typing in it
    if (document.activeElement !== c.note && !c.save.pending() && c.note.value !== (m.note || '')) c.note.value = m.note || '';
    c.info.replaceChildren(...[
      h('div.shorts-name.pixel', m.title || m.id),
      h('div.shorts-span.dim', `${span(m)}${m.src && m.src !== 'rough' ? ` · ${m.src}` : ''}`),
      m.hook ? h('p.shorts-hook', `“${m.hook}”`) : null,
      m.why ? h('p.shorts-why', m.why) : null,
      m.trim ? h('p.shorts-trim.dim', `Trim: ${m.trim}`) : null,
    ].filter(Boolean));
  }

  async function choose(short, status) {
    const cur = data.shorts.find((m) => m.id === short);
    const next = cur?.status === status ? null : status; // a second click clears it
    try { const r = await app.api(`/api/shorts/${id}`, { short, status: next }); data = { ...data, ...r }; drawHead(); for (const c of cards.values()) if (c.kind === 'pick') { const n = r.shorts.find((x) => x.id === c.m.id); if (n) update(c, { ...c.m, ...n }); } }
    catch (e) { app.toast(`Not saved: ${e.message}`, 'error'); }
  }

  async function step(fn) {
    for (const c of cards.values()) c.save.flush();
    busy = true; draw();
    try { await fn(); } catch (e) { app.toast(e.message, 'error'); }
    busy = false; await load();
  }
  const cutThese = () => step(async () => { const r = await app.api(`/api/shorts/${id}/cut`, {}); app.toast(r.text, r.error ? 'error' : r.queued ? 'info' : 'ok'); });
  const review = () => step(async () => {
    const r = await app.api(`/api/shorts/${id}/review`, {});
    app.toast(r.action === 'sendback' ? 'Sent back: the agent cuts those Shorts again.' : 'The Shorts are approved.', 'ok');
  });
  const fromEdit = () => step(async () => {
    const r = await app.api(`/api/shorts/${id}/from-edit`, { go: true });
    app.toast(r.next?.queued ? `A Shorts project is made: ${r.next.text}` : 'A Shorts project is made from this edit: the agent is picking the moments.', 'ok');
    location.hash = `#/${encodeURIComponent(r.project.id)}/shorts`;
  });

  const reload = debounce(() => load(), 300);
  const offs = [
    app.on('files', (msg) => {
      if (msg.project && msg.project !== p.id) return;
      if ((msg.paths || []).some((x) => /shorts|picks|review-items/.test(String(x)))) reload();
    }),
    app.on('project', (msg) => { if (!msg.project || msg.project === p.id || msg.data?.id === p.id) reload(); }),
    app.on('review-items', (msg) => { if (msg.project === p.id && msg.short) cards.get(`${msg.short}:cut`)?.loadItems(); }),
  ];
  await load();
  return { unmount() { for (const c of cards.values()) { c.save.flush(); c.video?.pause(); } for (const off of offs) try { off?.(); } catch {} } };
}
