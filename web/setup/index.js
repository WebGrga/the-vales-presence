// The Setup tab: what this machine has and lacks (GET /api/doctor), a pixel tick or cross per check, and the plain fix for this OS.
import { h, icon } from '../shell/dom.js';
import { ensureCss } from './first.js';

const OS = { win: 'Windows', mac: 'macOS', linux: 'Linux' };
const MARK = { ok: 'keep', fail: 'cross', warn: 'flag' };

export function mount(el, app) {
  ensureCss(new URL('./setup.css', import.meta.url));
  const head = h('div.setup-head');
  const list = h('div.setup-list');
  el.append(h('div.setup', head, list));
  let busy = false, uvOk = false;

  async function load(fresh) {
    if (busy) return;
    busy = true;
    head.replaceChildren(h('h2', 'Setup'), h('p.muted', fresh ? 'Checking again…' : 'Checking what this machine has…'));
    if (!list.children.length) list.append(h('p.dim.setup-wait', 'Node, ffmpeg, Python, uv, the Claude login, Remotion, the GPU and the disk.'));
    try {
      const d = await app.api('/api/doctor' + (fresh ? '?fresh=1' : ''));
      render(d);
    } catch (e) {
      head.replaceChildren(h('h2', 'Setup'), h('p.setup-bad', `The check did not run: ${e.message}`), h('div.setup-row-tools', again(), reportBtn()));
    } finally { busy = false; }
  }

  function again() {
    return h('button.calm.small', { type: 'button', on: { click: () => load(true) } }, icon('redo', true), h('span', 'Check again'));
  }

  // the versions and the checks as plain text, the home folder written as ~, to paste into a help request
  function reportBtn() {
    return h('button.calm.small', { type: 'button', title: 'Copy the versions and checks as text. No personal paths: your home folder is written as ~.', on: { click: (e) => copyReport(e.currentTarget) } }, icon('note', true), h('span', 'Copy a report'));
  }
  async function copyReport(btn) {
    const label = btn.querySelector('span');
    try {
      const { text } = await app.api('/api/doctor/report');
      try { await navigator.clipboard.writeText(text); label.textContent = 'Copied'; app.toast('The report is on your clipboard: paste it where you ask for help. It has no personal paths.', 'ok'); }
      catch { showText(text); }
    } catch (e) { app.toast(`The report could not be made: ${e.message}`, 'error'); }
    setTimeout(() => { label.textContent = 'Copy a report'; }, 2000);
  }
  // the clipboard may be closed to this page: show the text to select instead
  function showText(text) {
    const ta = h('textarea.setup-report', { readOnly: true, rows: 12 }, text);
    head.append(h('div.setup-report-box', h('p.muted', 'Copying was not allowed here: select this text and copy it.'), ta));
    ta.focus(); ta.select();
  }

  function render(d) {
    uvOk = (d.checks.find((c) => c.id === 'uv') || {}).status === 'ok';
    const missing = d.checks.filter((c) => c.required && c.status === 'fail');
    const warn = d.checks.filter((c) => c.status === 'warn' || (!c.required && c.status === 'fail'));
    const say = missing.length
      ? `${missing.length === 1 ? 'One thing is' : `${missing.length} things are`} missing before the studio can work: ${missing.map((c) => c.title).join(', ')}.`
      : warn.length ? `Ready. ${warn.length === 1 ? 'One note' : `${warn.length} notes`} below.` : 'Ready: everything the studio needs is here.';
    head.replaceChildren(
      h('div.setup-title', h('h2', 'Setup'), h('span.setup-os.pixel', OS[d.os] || d.os)),
      h('p', { class: missing.length ? 'setup-bad' : 'setup-good' }, say),
      h('div.setup-row-tools', again(), reportBtn(), h('span.dim', `checked in ${(d.ms / 1000).toFixed(1)} s, ${new Date(d.at).toLocaleTimeString()}`)),
    );
    list.replaceChildren(...d.checks.map(row));
  }

  function row(c) {
    const kids = [
      h('img.icon.setup-mark', { src: `/icons/${MARK[c.status] || 'question'}.png`, alt: c.status === 'ok' ? 'ok' : c.status === 'fail' ? 'missing' : 'note' }),
      h('div.setup-body',
        h('div.setup-name', h('span.pixel', c.title), c.required ? null : h('span.setup-opt', 'optional')),
        h('div.setup-found', c.found || ''),
        c.why && c.status !== 'ok' ? h('div.setup-why', c.why) : null,
        c.fix ? fix(c.fix) : null,
        c.id === 'ytdlp' && c.status !== 'ok' ? installYtDlp() : null),
    ];
    return h('div.setup-check', { class: `is-${c.status}` }, kids);
  }

  // yt-dlp through uv: one click, no terminal
  function installYtDlp() {
    if (!uvOk) return h('p.dim.setup-install-note', 'To install it from here, uv has to be installed first (see the uv check).');
    const say = h('span.dim.setup-install-say');
    const b = h('button.go.small', { type: 'button', title: 'Runs: uv tool install yt-dlp', on: { click: async () => {
      b.disabled = true; say.textContent = 'Installing with uv… this takes about a minute.';
      try { const r = await app.api('/api/doctor/install-ytdlp', {}); app.toast(`yt-dlp is installed. ${r.text || ''}`.trim(), 'ok'); load(true); }
      catch (e) { say.textContent = ''; b.disabled = false; app.toast(`Could not install yt-dlp: ${e.message}`, 'error'); showErr(e.message); }
    } } }, icon('go', true), h('span', 'Install yt-dlp with uv'));
    const err = h('pre.setup-install-err', { hidden: true });
    const showErr = (m) => { err.textContent = m; err.hidden = false; };
    return h('div.setup-install', b, say, err);
  }

  function fix(f) {
    return h('div.setup-fix',
      f.text ? h('p', f.text) : null,
      ...(f.cmds || []).map((cmd) => h('div.setup-cmd',
        h('code', cmd),
        h('button.calm.small', { type: 'button', title: 'Copy the command', on: { click: (e) => copy(cmd, e.currentTarget) } }, 'Copy'))),
      f.link ? h('a', { href: f.link, target: '_blank', rel: 'noopener' }, 'More help') : null);
  }

  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy'; }, 1500); } catch { app.toast('Copy did not work: select the command instead'); }
  }

  load(false);
  return { unmount() {} };
}
