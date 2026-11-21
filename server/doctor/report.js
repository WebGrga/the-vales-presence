// "Copy a report" on the Setup tab: the versions and the checks as plain text to paste into a help request. Nothing
// personal goes in: the home folder becomes ~, the app and data folders become <app> and <data>, and the user name
// is hidden wherever it still shows. Pure (tested in report.test.js).

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// text with the home folder (either slash style, any case) as ~, other known folders as <name>, the user name as <user>
export function scrub(text, { home = '', user = '', folders = {} } = {}) {
  let s = String(text ?? '');
  const forms = (p) => { const a = String(p || '').replace(/[\\/]+$/, ''); return a ? [...new Set([a, a.replace(/\\/g, '/'), a.replace(/\//g, '\\'), a.replace(/\\/g, '\\\\')])] : []; };
  // the longest folders first, so the app inside the home folder is <app>, not ~/…/presence
  for (const [name, dir] of Object.entries(folders).sort((a, b) => String(b[1]).length - String(a[1]).length)) {
    for (const f of forms(dir)) s = s.replace(new RegExp(esc(f), 'gi'), `<${name}>`);
  }
  for (const f of forms(home)) s = s.replace(new RegExp(esc(f), 'gi'), '~');
  if (user && user.length > 2) s = s.replace(new RegExp(`\\b${esc(user)}\\b`, 'gi'), '<user>');
  return s.replace(/<(app|data)>[\\/]+/g, (m, n) => `<${n}>/`);
}

const MARK = { ok: 'OK  ', warn: 'NOTE', fail: 'MISS' };

// doctor: the result of /api/doctor; env: { app, node, platform, arch, home, user, folders }
export function reportText(doctor, env = {}) {
  const lines = [];
  lines.push(`The Vale's Presence: setup report${env.app ? ` (app ${env.app})` : ''}`);
  lines.push(`System: ${doctor?.os || env.platform || '?'}${env.arch ? ' ' + env.arch : ''}, Node ${env.node || '?'}`);
  lines.push(`Checked: ${doctor?.at || new Date().toISOString()}`);
  lines.push('');
  for (const c of doctor?.checks || []) {
    lines.push(`[${MARK[c.status] || '?   '}] ${c.title}${c.required ? '' : ' (optional)'}: ${c.found || ''}`);
    if (c.status !== 'ok' && c.why) lines.push(`        ${c.why}`);
  }
  return scrub(lines.join('\n') + '\n', env);
}
