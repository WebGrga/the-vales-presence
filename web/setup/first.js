// Should the app open on the Setup tab? Yes when a required check fails (GET /api/doctor answers ok: false).
// For web/app.js at boot:  if (await needsSetup(app.api)) tabs.show('setup')
export async function needsSetup(api) {
  try { const d = await api('/api/doctor'); return d?.ok === false; } catch { return false; }
}

// one stylesheet per tab, added once: ensureCss(new URL('./mine.css', import.meta.url))
export function ensureCss(href) {
  const url = String(href);
  if ([...document.querySelectorAll('link[rel=stylesheet]')].some((l) => l.href === url)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = url;
  document.head.append(l);
}
