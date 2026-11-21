// The agent's markdown as safe HTML (pure, no DOM; tested in markdown.test.js). Everything is escaped first; then
// headings, lists, quotes, fenced code, simple tables, paragraphs, **bold**, *italic*, `code`, http(s) links and
// timecodes ("at 1:16", "0:01:16.5") as buttons that seek: <button class="tc" data-t="76">1:16</button>.
// Nothing else is let through: no raw HTML, no images, no other link schemes.

export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// "1:16" -> 76, "0:01:16.5" -> 76.5, "75" -> null
export function timeOf(tc) {
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(String(tc || '').trim());
  if (!m) return null;
  const [, h, mm, ss, frac] = m;
  if (Number(ss) >= 60 || (h != null && Number(mm) >= 60)) return null;
  return (Number(h) || 0) * 3600 + Number(mm) * 60 + Number(ss) + (frac ? Number('0.' + frac) : 0);
}

const TC = /(^|[\s(\[“"'–—-])((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)(?=$|[\s).,;:!?\]”"'–—-])/g;

// inline marks on one escaped line (code spans are cut out first so nothing inside them changes)
export function inline(text, opts = {}) {
  const codes = [];
  let s = escapeHtml(text).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  const links = [];
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => { links.push(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`); return `\u0001${links.length - 1}\u0001`; });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/__([^_]+)__/g, '<b>$1</b>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<i>$2</i>').replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<i>$2</i>');
  if (opts.timecodes !== false) {
    s = s.replace(TC, (all, pre, tc) => {
      const t = timeOf(tc);
      return t == null ? all : `${pre}<button type="button" class="tc" data-t="${t}" title="Play from ${tc}">${tc}</button>`;
    });
  }
  return s.replace(/\u0001(\d+)\u0001/g, (_, i) => links[i]).replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function markdown(src, opts = {}) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [], list = null; // list = { tag, items }
  const flushPara = () => { if (para.length) { out.push(`<p>${para.map((l) => inline(l, opts)).join('<br>')}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i, opts)}</li>`).join('')}</${list.tag}>`); list = null; } };
  const flush = () => { flushPara(); flushList(); };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*```/.test(line);
    if (fence) {
      flush();
      const body = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) body.push(lines[i]);
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    const head = /^(#{1,6})\s+(.*)$/.exec(line);
    if (head) { flush(); const n = Math.min(6, head[1].length + 2); out.push(`<h${n}>${inline(head[2], opts)}</h${n}>`); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push('<hr>'); continue; }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
      flush();
      const headCells = cells(line);
      const rows = [];
      for (i += 2; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) rows.push(cells(lines[i]));
      i--;
      out.push(`<table><thead><tr>${headCells.map((c) => `<th>${inline(c, opts)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c, opts)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) { flush(); out.push(`<blockquote>${inline(quote[1], opts)}</blockquote>`); continue; }
    const ul = /^\s*[-*+•]\s+(.*)$/.exec(line), ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const tag = ul ? 'ul' : 'ol';
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push((ul || ol)[1]);
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1] += ' ' + line.trim(); continue; }
    flushList();
    para.push(line);
  }
  flush();
  return out.join('');
}
