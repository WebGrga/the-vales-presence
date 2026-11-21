// The upload history under the Upload page: every upload and dry run of this project, newest first: when, the title, the link, the
// thumbnail that was set. GET /api/studio/:id/uploads (server/routes/uploads.js). Read-only.
import { h } from '../shell/dom.js';
import { fileUrl } from './format.js';

const when = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' }); };
const mb = (n) => `${(n / 1048576).toFixed(n > 1048576 * 100 ? 0 : 1)} MB`;

export function uploadHistory(ctx) {
  const list = h('div.st-uphist-list');
  const el = h('div.px-frame.st-box.st-uphist', h('h3', 'Earlier uploads'), list);
  async function render() {
    let uploads = [];
    try { uploads = (await ctx.api(`/api/studio/${ctx.id}/uploads`)).uploads || []; } catch {}
    el.hidden = !uploads.length;
    list.replaceChildren(...uploads.map((u) => h('div.st-uphist-row',
      u.thumb ? h('img', { src: fileUrl(ctx.id, `thumbs/${u.thumb.file}`), alt: 'Thumbnail that was set', draggable: false }) : h('div.st-thumb-missing', 'no thumbnail'),
      h('div', h('div.st-pkgtitle', u.title || '(no title)'),
        h('div.dim', `${when(u.at)} · ${u.dry ? 'dry run, nothing left this computer' : u.privacy || ''}${u.bytes ? ` · ${mb(u.bytes)}` : ''}`),
        u.url ? h('div', h('a', { href: u.url, target: '_blank', rel: 'noopener' }, u.url), u.studio ? [' · ', h('a', { href: u.studio, target: '_blank', rel: 'noopener' }, 'YouTube Studio')] : null) : null,
        u.thumbNote ? h('div.dim', u.thumbNote) : null))));
  }
  return { el, render };
}
