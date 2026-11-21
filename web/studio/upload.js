// Upload: the package (picked title and thumbnail), the description and settings (saved as you type), the YouTube
// connection, and the Upload button. Only this button uploads; it asks once more. Private by default.
import { h } from '../shell/dom.js';
import { fileUrl, duration } from './format.js';
import { keepDraft, takeDraft, settleDraft, saver } from './persist.js';
import { uploadHistory } from './upload-history.js';
import { chaptersButton } from './upload-chapters.js';
import { betSection } from './bet.js';

const CATEGORIES = [['22', 'People & Blogs'], ['28', 'Science & Technology'], ['27', 'Education'], ['24', 'Entertainment'], ['20', 'Gaming'], ['26', 'Howto & Style'], ['10', 'Music'], ['25', 'News & Politics'], ['17', 'Sports'], ['19', 'Travel & Events'], ['2', 'Autos & Vehicles'], ['15', 'Pets & Animals'], ['23', 'Comedy'], ['1', 'Film & Animation'], ['29', 'Nonprofits & Activism']];
const PRIV = [['private', 'Private'], ['unlisted', 'Unlisted'], ['public', 'Public']];
const mb = (n) => `${(n / 1048576).toFixed(n > 1048576 * 100 ? 0 : 1)} MB`;

export function uploadSection(ctx) {
  let data = null, fields = null, first = true;
  const save = saver({ send: async (f) => { await ctx.api(`/api/studio/${ctx.id}/upload-fields`, { fields: f }); settleDraft(ctx.id, 'upload.fields', f); } });
  const change = (patch) => { fields = { ...fields, ...patch }; keepDraft(ctx.id, 'upload.fields', fields); save.push(fields); paintChecks(); };

  const pkg = h('div.st-pkg');
  const desc = h('textarea.st-desc', { rows: 10, placeholder: 'The description. The agent drafts it with the titles (skill upload-youtube); edit it here.', 'aria-label': 'Description' });
  const descN = h('span.dim');
  desc.addEventListener('input', () => { change({ description: desc.value }); descN.textContent = `${new Blob([desc.value]).size} / 5000 bytes`; });
  const tags = h('input', { type: 'text', placeholder: 'tags, separated, by commas', 'aria-label': 'Tags' });
  tags.addEventListener('input', () => change({ tags: tags.value.split(',').map((t) => t.trim()).filter(Boolean) }));
  const priv = h('div.seg', ...PRIV.map(([v, l]) => h('button.small', { type: 'button', 'data-v': v, on: { click: () => { change({ privacy: v }); paintPriv(); } } }, l)));
  const cat = h('select', { 'aria-label': 'Category' }, ...CATEGORIES.map(([v, l]) => h('option', { value: v }, l)));
  cat.addEventListener('change', () => change({ category: cat.value }));
  const kids = h('select', { 'aria-label': 'Made for kids' }, h('option', { value: 'no' }, 'No, it is not made for kids'), h('option', { value: 'yes' }, 'Yes, it is made for kids'));
  kids.addEventListener('change', () => change({ madeForKids: kids.value === 'yes' }));
  const synth = h('input', { type: 'checkbox', id: 'st-synth' });
  synth.addEventListener('change', () => change({ synthetic: synth.checked }));
  const when = h('input', { type: 'datetime-local', 'aria-label': 'Publish at (private videos only)' });
  when.addEventListener('change', () => change({ publishAt: when.value ? new Date(when.value).toISOString() : '' }));
  const hist = uploadHistory(ctx);
  const bet = betSection(ctx);
  const checks = h('ul.st-checks');
  const yt = h('div.st-yt');
  const bar = h('div.st-progress', h('i'));
  const status = h('div.st-upstatus');
  const dryBtn = h('button.calm', { type: 'button', title: 'Goes through every step against a fake YouTube: nothing leaves this computer', on: { click: () => start(true) } }, 'Dry run');
  const upBtn = h('button.go', { type: 'button', on: { click: () => start(false) } }, 'Upload to YouTube');
  const el = h('section.st-pane.st-upload',
    h('header.st-head', h('h2', 'Upload'), h('span.dim', 'only when you press the button · private unless you choose otherwise')),
    h('div.st-upcols',
      h('div.st-upleft', pkg,
        h('label.st-field', h('span', 'Description ', descN, ' ', chaptersButton(ctx, { get: () => desc.value, set: (v) => { desc.value = v; change({ description: v }); descN.textContent = `${new Blob([v]).size} / 5000 bytes`; } })), desc),
        h('label.st-field', h('span', 'Tags'), tags),
        h('div.st-field', h('span', 'Visibility'), priv),
        h('label.st-field', h('span', 'Schedule (private only; it goes public then)'), when),
        h('label.st-field', h('span', 'Category'), cat),
        h('label.st-field', h('span', 'Audience'), kids),
        h('label.st-field.st-row', synth, h('span', 'Altered or synthetic content that looks real (YouTube asks you to say so)'))),
      h('div.st-upright', h('div.px-frame.st-box', h('h3', 'YouTube'), yt), h('div.px-frame.st-box', h('h3', 'Before it goes'), checks), bet.el,
        h('div.px-frame.st-box', h('div.st-upbtns', dryBtn, upBtn), bar, status), hist.el)));

  function paintPriv() { for (const b of priv.children) b.classList.toggle('on', b.dataset.v === fields.privacy); when.disabled = fields.privacy !== 'private'; }

  const pickedTitle = () => data.titles.options.find((o) => o.id === data.titles.picked);
  const pickedThumb = () => data.thumbs.options.find((o) => o.id === data.thumbs.picked);

  function problems() {
    const out = [];
    const t = pickedTitle();
    if (!t) out.push(['Pick a title', 'titles']);
    else if ([...t.title].length > 100) out.push(['The title is over 100 characters', 'titles']);
    if (!pickedThumb()) out.push(['No thumbnail picked: YouTube would choose a frame', 'thumbs', true]);
    if (!data.upload.video) out.push([`No ${fields.video} yet: export the final video first`, null]);
    if (/[<>]/.test(fields.description)) out.push(['Remove < and > from the description', null]);
    if (!fields.description.trim()) out.push(['The description is empty', null, true]);
    if (!data.youtube.connected) out.push(['Connect YouTube (a dry run works without it)', null]);
    return out;
  }

  function paintChecks() {
    if (!data) return;
    const ps = problems();
    checks.replaceChildren(...(ps.length ? ps.map(([text, tab, soft]) => h('li' + (soft ? '.soft' : ''), text, tab ? h('button.small.calm', { type: 'button', on: { click: () => ctx.select(tab) } }, 'Go') : '')) : [h('li.ok', 'Ready.')]));
    const hard = ps.filter(([, , soft]) => !soft);
    const busy = data.uploading || data.upload.state.status === 'uploading';
    upBtn.disabled = busy || hard.length > 0;
    dryBtn.disabled = busy || hard.some(([text]) => !text.startsWith('Connect'));
  }

  async function start(dry) {
    await save.flush();
    const t = pickedTitle();
    if (!dry && !confirm(`Upload “${t.title}” to YouTube as ${fields.privacy}?`)) return;
    try { await ctx.api(`/api/studio/${ctx.id}/upload`, { dry }); data.uploading = true; paintChecks(); paintState({ status: 'uploading', bytes: 0, total: data.upload.video?.bytes, dry }); } catch (e) { ctx.toast(e.message || String(e), 'error'); }
  }

  function paintState(s) {
    const pct = s.total ? Math.round(((s.bytes || 0) / s.total) * 100) : 0;
    bar.firstChild.style.width = `${s.status === 'done' ? 100 : pct}%`;
    bar.hidden = !['uploading', 'done'].includes(s.status);
    const txt = {
      idle: 'Not uploaded yet.',
      uploading: `${s.dry ? 'Dry run: ' : ''}sending ${s.total ? `${mb(s.bytes || 0)} of ${mb(s.total)} (${pct}%)` : '…'}`,
      done: s.dry ? `Dry run done in ${Math.round((s.ms || 0) / 100) / 10} s: every request is listed in studio/upload-dry.json. Nothing left this computer.` : `Uploaded as ${s.privacy}${s.ms ? ` in ${Math.round(s.ms / 1000)} s` : ''}.`,
      error: `Stopped: ${s.error || 'unknown'}`,
    }[s.status] || '';
    status.replaceChildren(h('p', txt), s.thumbNote ? h('p.dim', s.thumbNote) : '',
      s.status === 'done' && s.url ? h('p', h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.url), ' · ', h('a', { href: s.studio, target: '_blank', rel: 'noopener' }, 'Open in YouTube Studio')) : '');
    status.dataset.s = s.status;
  }

  function paintYt(y) {
    yt.replaceChildren(
      y.connected ? h('p', '✓ Connected. Videos go to the channel you chose when you connected.') : y.client ? h('p', 'Your OAuth client is there. Connect to let this app upload for you (only when you press Upload).') : h('p', 'To upload, make your own OAuth client in Google Cloud and save it as data/youtube-client.json. Step by step: docs/youtube-upload.md.'),
      y.connected ? h('button.small.calm', { type: 'button', on: { click: async () => { await ctx.api('/api/studio/youtube/disconnect', {}); ctx.reload(); } } }, 'Disconnect')
        : h('button.small', { type: 'button', disabled: !y.client, on: { click: connect } }, 'Connect YouTube'));
  }

  async function connect() {
    try { const r = await ctx.api('/api/studio/youtube/connect', {}); window.open(r.url, '_blank', 'noopener'); } catch (e) { ctx.toast(e.message || String(e), 'error'); }
  }

  function render(dt) {
    data = dt;
    if (first) {
      first = false;
      const d = takeDraft(ctx.id, 'upload.fields');
      fields = d?.value && JSON.stringify(d.value) !== JSON.stringify(dt.upload.fields) ? { ...dt.upload.fields, ...d.value } : dt.upload.fields;
      if (d?.value && fields !== dt.upload.fields) save.push(fields);
      desc.value = fields.description; tags.value = fields.tags.join(', ');
      cat.value = fields.category; kids.value = fields.madeForKids ? 'yes' : 'no'; synth.checked = fields.synthetic;
      if (fields.publishAt) { const t = new Date(fields.publishAt); when.value = new Date(t - t.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
      descN.textContent = `${new Blob([desc.value]).size} / 5000 bytes`;
    } else if (!save.pending() && document.activeElement !== desc && dt.upload.fields.description !== desc.value && dt.upload.fields.description !== fields.description) {
      // the agent drafted a new description and you were not typing: show it
      fields = { ...fields, description: dt.upload.fields.description }; desc.value = fields.description;
    }
    paintPriv();
    const t = pickedTitle(), th = pickedThumb(), v = dt.upload.video;
    pkg.replaceChildren(h('div.st-pkgcard.px-frame',
      th ? h('img', { src: fileUrl(ctx.id, `thumbs/${th.file}`, th.mtime), alt: '', draggable: false }) : h('div.st-thumb-missing', 'no thumbnail picked'),
      h('div', h('div.st-pkgtitle', t ? t.title : 'No title picked yet'),
        h('div.dim', v ? `${v.path} · ${mb(v.bytes)}${v.duration ? ` · ${duration(v.duration)}` : ''}` : `${fields.video} is not there yet`))));
    paintYt(dt.youtube);
    paintState(dt.upload.state);
    paintChecks();
    bet.render(dt);
    hist.render();
  }

  function onUpload(state) { if (!data) return; data.upload.state = state; data.uploading = state.status === 'uploading'; paintState(state); paintChecks(); if (state.status === 'done') hist.render(); }

  return { el, render, onUpload, flush: () => Promise.all([save.flush(), bet.flush()]) };
}
