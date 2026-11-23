// The Settings that are not the agent's: notifications and the size of the screen (kept in this browser, they apply at
// once), the default skill set (the Context tab's own, applies at once) and the data folder (read-only, with Open).
import { h } from '../shell/dom.js';
import { SIZES, uiSize, setUiSize } from '../shell/prefs.js';
import { getPref, setPref } from '../shell/notify.js';
import { soundOn, setSound, chime } from '../shell/stage-done.js';

const row = (label, control, help) => h('div.set-row', h('div.set-head', h('label.set-label.pixel', label), control), help ? (typeof help === 'string' ? h('p.set-help', help) : help) : null);

export function mountLocal(el, app) {
  el.replaceChildren(h('h3.set-sub', 'This computer'));
  const note = (text) => h('span.set-note.dim', text);

  // notifications: on only when the browser allows them
  const supported = typeof Notification !== 'undefined';
  const nBox = h('input', { type: 'checkbox', id: 'set-notify' });
  const nWord = h('span');
  const nSay = h('p.set-help');
  function paintNotify() {
    const on = getPref() === 'on' && supported && Notification.permission === 'granted';
    nBox.checked = on; nWord.textContent = on ? 'On' : 'Off';
    nBox.disabled = !supported;
    nSay.textContent = !supported ? 'This browser has no desktop notifications. The tab title still shows when something needs you.'
      : Notification.permission === 'denied' ? 'The browser has blocked notifications for this page. Allow them in its site settings, then turn this on.'
        : 'Tells you, with a note on your desktop and a number in the tab title, when the agent asks you something or a stage ends while you are in another window. Applies at once.';
  }
  nBox.addEventListener('change', async () => {
    if (!nBox.checked) { setPref('off'); app.toast('Notifications are off.', 'ok'); return paintNotify(); }
    let p = Notification.permission;
    if (p === 'default') { try { p = await Notification.requestPermission(); } catch { p = 'denied'; } }
    if (p === 'granted') { setPref('on'); app.toast('Notifications are on.', 'ok'); } else { setPref('off'); app.toast('The browser did not allow notifications.', 'info'); }
    paintNotify();
  });
  el.append(row('Notifications', h('span.set-toggle', nBox, nWord), nSay));
  paintNotify();

  const sBox = h('input', { type: 'checkbox', id: 'set-sound', checked: soundOn() });
  const sWord = h('span', soundOn() ? 'On' : 'Off');
  sBox.addEventListener('change', () => { setSound(sBox.checked); sWord.textContent = sBox.checked ? 'On' : 'Off'; if (sBox.checked) chime(); });
  el.append(row('Sound when a stage is done', h('span.set-toggle', sBox, sWord), 'A short soft sound when a stage ends, with the “watch it” note. Applies at once.'));

  const size = h('select', { id: 'set-size', title: 'The size of the whole screen' }, ...SIZES.map((s) => h('option', { value: s.value }, s.label)));
  size.value = uiSize();
  size.addEventListener('change', () => { setUiSize(size.value); app.toast('Screen size changed.', 'ok'); });
  el.append(row('Screen size', size, 'Makes everything larger or smaller in this browser. Applies at once.'));

  const sets = h('select', { id: 'set-skillset', title: 'The skill set new projects use' });
  const setSay = note('');
  el.append(row('Default skill set', h('span.set-num', sets, setSay), 'The skills a project reads unless you give it a set of its own in the Context tab. Applies at once.'));
  async function loadSets() {
    try {
      const m = await app.api('/api/context' + (app.project() ? `?project=${encodeURIComponent(app.project().id)}` : ''));
      sets.replaceChildren(...(m.sets || []).map((x) => h('option', { value: x.id }, x.name + (x.builtin ? ' (shipped)' : ''))));
      sets.value = (m.sets || []).find((x) => x.isDefault)?.id || (m.sets || [])[0]?.id || '';
      sets.disabled = false;
    } catch (e) { sets.disabled = true; setSay.textContent = `Not read: ${e.message}`; }
  }
  sets.addEventListener('change', async () => {
    try { await app.api('/api/context/set-default', { set: sets.value }); setSay.textContent = ''; app.toast('That is your default skill set now.', 'ok'); }
    catch (e) { app.toast(e.message, 'error'); loadSets(); }
  });
  loadSets();
  app.on('context', () => { if (!el.closest('[hidden]')) loadSets(); });

  const path = h('code.set-path', 'reading…');
  const open = h('button.calm.small', { type: 'button', title: 'Show the folder in your file manager', on: { click: async () => { try { await app.api('/api/data-folder/open', {}); } catch (e) { app.toast(e.message, 'error'); } } } }, 'Open');
  el.append(row('Data folder', h('span.set-folder', path, open), 'Where your projects, skill sets and settings live. It is set when the app starts (PRESENCE_DATA), so it is shown here and not changed here.'));
  app.api('/api/data-folder').then((d) => { path.textContent = d.path; path.title = `${d.projects} project${d.projects === 1 ? '' : 's'}`; }).catch(() => { path.textContent = 'not known'; });
}
