// The Export tab's small decisions, pure (tested in view.test.js).

export function sizeText(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

// the newest file of a kind (the video: the final before the rough)
export function latest(files, kind) {
  const of = (files || []).filter((f) => f.kind === kind);
  if (kind === 'mp4') return of.find((f) => f.which === 'final') || of.find((f) => f.which === 'rough') || null;
  return of.sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)))[0] || null;
}

// can this format be made now? any one of its needs is enough
export function ready(format, has) {
  return (format.needs || []).some((k) => has?.[k]);
}

// the line shown on a format that cannot be made yet: its own, plus the server's reason when it has one (has.why is `why` of GET /api/export)
export function offText(format, why) {
  const extra = why?.[format.kind];
  return extra ? `${format.missing} (${extra})` : format.missing || '';
}

// a chapters file's text -> its non-empty lines (what the card shows)
export const textLines = (text) => String(text || '').split(/\r?\n/).filter((l) => l.trim());

// the files a card shows: every copy for a list format (remux), else the newest one
export function shownFiles(format, files) {
  if (format.list) return (files || []).filter((f) => f.kind === format.kind).sort((a, b) => a.file.localeCompare(b.file));
  const one = latest(files, format.kind);
  return one ? [one] : [];
}
