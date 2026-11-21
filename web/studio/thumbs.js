// Thumbnails: the options in studio/thumbs/options.json with their pictures. Look at them big, at feed size and at
// phone size; pick one, star the ones for the feed test, note what to change. Pictures are never pixelated.
import { h } from '../shell/dom.js';
import { fileUrl } from './format.js';
import { actions, noteBox, hiddenToggle, empty, promiseLine } from './cards.js';
import { selectionBar } from './mix.js';

const SIZES = [['big', 'Big'], ['feed', 'Feed size'], ['phone', 'Phone size']];
const HOW = { code: 'Made in code', ai: 'AI picture', mixed: 'AI background + code' };

export function thumbsSection(ctx) {
  let size = localStorage.getItem('presence.studio.thumbsize') || 'feed', showHidden = false, data = null;
  const seg = h('div.seg', ...SIZES.map(([k, label]) => h('button.small' + (k === size ? '.on' : ''), { type: 'button', 'data-k': k, on: { click: () => { size = k; localStorage.setItem('presence.studio.thumbsize', k); render(data); } } }, label)));
  const grid = h('div.st-thumbs');
  const sheet = h('details.st-sheet', { open: true });
  const sel = selectionBar(ctx, 'thumbs', () => ({ doc: data?.thumbs, titles: data?.titles }));
  const models = h('details.st-models');
  const head = h('header.st-head', h('h2', 'Thumbnails'), h('span.dim.st-count'), h('span.st-grow'), seg);
  const el = h('section.st-pane', head, sheet, sel.el, grid, models);

  function card(dt, doc, o) {
    const title = dt.titles.options.find((t) => t.id === o.title);
    const src = fileUrl(ctx.id, `thumbs/${o.file}`, o.mtime);
    const img = h('img.st-thumb-img', { src, alt: o.text || o.file, loading: 'lazy', draggable: false });
    img.addEventListener('error', () => { img.replaceWith(h('div.st-thumb-missing', `missing: studio/thumbs/${o.file}`)); }, { once: true });
    const info = h('details.st-thumb-info', h('summary', 'How it was made'),
      o.model ? h('p', h('b', 'Model: '), o.model) : null,
      o.prompt ? h('p', h('b', 'Prompt: '), o.prompt) : null,
      o.spec ? h('p', h('b', 'Spec: '), h('code', `studio/thumbs/${o.spec}`)) : null,
      h('p', h('b', 'File: '), h('code', `studio/thumbs/${o.file}`)));
    return h('article.st-card.st-thumb' + (doc.picked === o.id ? '.picked' : '') + (o.hidden ? '.hidden' : ''), { 'data-id': o.id },
      h('a.st-thumb-frame', { href: src, target: '_blank', rel: 'noopener', title: 'Open full size' }, img),
      h('div.st-meta', h('span.st-tag', { 'data-how': o.how }, HOW[o.how] || o.how), title ? h('span.dim', `for “${title.title}”`) : null),
      promiseLine(o),
      o.clarity ? h('p.st-clarity' + (/^weak/i.test(o.clarity) ? '.weak' : ''), h('b', 'A stranger would get it? '), o.clarity.replace(/^(clear|weak):\s*/i, (m) => m.toLowerCase().startsWith('clear') ? 'Yes: ' : 'Not quite: ')) : null,
      o.sheet160 && o.sheet160 !== 'ok' ? h('p.st-warn', h('b', 'At 160×90: '), o.sheet160) : null,
      o.why ? h('p.st-why', o.why) : null,
      (o.model || o.prompt || o.spec) ? info : null,
      h('div.st-cardfoot', actions(ctx, 'thumbs', doc, o, title?.title), noteBox(ctx, 'thumbs', doc, o)));
  }

  // E46: every option at 160 x 90, the size a crowded feed gives it, side by side on a light and a dark page
  function renderSheet(doc) {
    const vis = doc.options.filter((o) => !o.hidden);
    if (!vis.length) { sheet.replaceChildren(); return; }
    const strip = (cls) => h('div.st-sheet-strip.' + cls, ...vis.map((o) => h('figure', h('img', { src: fileUrl(ctx.id, `thumbs/${o.file}`, o.mtime), alt: o.id, width: 160, height: 90, draggable: false }), h('figcaption', o.id))));
    sheet.replaceChildren(h('summary', `Contact sheet at 160×90 (${vis.length})`),
      h('p.dim', 'The smallest size a feed gives you. Check each one: is the topic clear, can you read the words, is one thing seen first? If not, ask the agent to fix it before you pick.'),
      strip('light'), strip('dark'));
  }

  function renderModels(list) {
    const on = list.filter((m) => m.ready);
    models.replaceChildren(
      h('summary', on.length ? `AI image models: ${on.map((m) => m.name).join(', ')}` : 'AI image models: none on (thumbnails are made in code)'),
      h('p.dim', 'AI models make backgrounds and props only; faces and words are set in code. Turn one on in data/craft/image-models.json — see docs/thumbnails-ai-images.md. Nothing paid runs unless you turn it on.'),
      h('p.st-honest', h('b', 'An honest note: '), 'in tests, a generated background behind a screen added nothing: it tied a flat colour or lost to it. Use a picture model only when the scene itself is the subject (a place, an object, a mood). Pictures take time, shown below.'),
      h('ul.st-modellist', ...list.map((m) => h('li', h('span.st-dot', { 'data-on': m.ready ? 'ready' : m.enabled ? 'needs' : 'off' }), h('b', m.name), ' ', h('span.dim', `${m.kind}${m.price ? ' · ' + m.price : ''}${m.time ? ' · ' + m.time : ''}${m.enabled && !m.ready ? ' · needs its key' : ''}`)))));
  }

  function render(dt) {
    data = dt;
    const doc = dt.thumbs;
    const vis = doc.options.filter((o) => !o.hidden), hid = doc.options.filter((o) => o.hidden);
    head.querySelector('.st-count').textContent = vis.length ? `${vis.length} option${vis.length === 1 ? '' : 's'}` : '';
    for (const b of seg.children) b.classList.toggle('on', b.dataset.k === size);
    grid.dataset.size = size;
    renderSheet(doc);
    sel.update();
    grid.replaceChildren(
      ...(vis.length ? vis.map((o) => card(dt, doc, o)) : [empty('No thumbnails yet. The agent makes them at the Thumbnails stage (skill thumbnail-options): composed in code from a frame of your video, your own photo and big words, with an AI background when you turned a model on.',
        h('button.small', { type: 'button', on: { click: () => ctx.say('Make thumbnail options for this video now (skill thumbnail-options), into studio/thumbs/.') } }, 'Ask the agent for thumbnails'))]));
    const extra = hiddenToggle(hid.length, showHidden, () => { showHidden = !showHidden; render(data); });
    if (extra) grid.append(extra);
    if (showHidden) grid.append(...hid.map((o) => card(dt, doc, o)));
    renderModels(dt.models || []);
  }

  return { el, render };
}
