// Desktop notifications and the tab-title badge: when the agent asks you something, or a stage ends, and you are not
// looking. The permission is asked at a sensible moment (the first time you press Go, in words first), never on load,
// and Settings can turn all of it off. The decisions are pure (tested in notify.test.js).
import { h } from './dom.js';

const KEY = 'presence.notify'; // 'on' | 'off' | absent (not asked yet)
const ASKED = 'presence.notify.asked';

export const getPref = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const setPref = (v) => { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch {} };

// pure: what to do with an event. state: { pref, permission, visible, focused, current (is it the open project), supported }
// -> { desktop: bool, badge: bool }
export function decide(state) {
  if (state.pref !== 'on') return { desktop: false, badge: false };
  const looking = state.visible && state.focused;
  if (looking) return { desktop: false, badge: false };
  return { desktop: !!state.supported && state.permission === 'granted', badge: true };
}

// pure: the words of an event -> { title, body } (the project's title is the user's own)
export function wordsOf(m) {
  const who = m.projectTitle || m.project || 'The Vale’s Presence';
  switch (m.kind) {
    case 'ask': return { title: `${who}: the agent asks you something`, body: m.text || 'Open the project to answer.' };
    case 'failed': return { title: `${who}: a stage failed`, body: m.text || '' };
    case 'stopped': return { title: `${who}: stopped`, body: m.text || '' };
    case 'finished': return { title: `${who}: finished`, body: 'Every stage is done.' };
    case 'yours': return { title: `${who}: your turn`, body: m.text || '' };
    case 'ended': return { title: `${who}: ${m.stageTitle || 'a stage'} ended`, body: m.text || '' };
    case 'spend': return { title: 'Spend limit passed', body: m.text || '' };
    default: return { title: who, body: m.text || '' };
  }
}

// pure: the tab title with the number of things you missed in front
export const badged = (title, n) => (n > 0 ? `(${n}) ${title}` : title);

export function createNotify(app) {
  let unseen = 0;
  const supported = typeof Notification !== 'undefined';
  const state = (m) => ({ pref: getPref(), permission: supported ? Notification.permission : 'denied', visible: document.visibilityState === 'visible', focused: document.hasFocus(), current: m.project === app.project()?.id, supported });
  const paint = () => app.emit('badge', { type: 'badge', n: unseen });

  function tell(m) {
    const d = decide(state(m));
    if (d.badge) { unseen += 1; paint(); }
    if (!d.desktop) return;
    const w = wordsOf(m);
    try {
      const n = new Notification(w.title, { body: w.body, tag: `presence-${m.project || 'app'}-${m.kind}`, icon: '/icons/tower.png' });
      n.onclick = () => { try { window.focus(); } catch {} if (m.project && m.project !== app.project()?.id) app.select(m.project); n.close(); };
    } catch {}
  }
  const seen = () => { if (unseen) { unseen = 0; paint(); } };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') seen(); });
  addEventListener('focus', seen);

  app.on('notify', (m) => tell(m));
  app.on('waiting', (m) => { if (m.asking && m.live) tell({ project: m.project, projectTitle: app.project()?.id === m.project ? app.project()?.title : '', kind: 'ask', text: '' }); });

  // the first Go: ask in words, then the browser (a click is needed for its own prompt)
  function offer(host) {
    if (!supported || getPref() || localStorage.getItem(ASKED)) return;
    if (Notification.permission === 'denied') return;
    try { localStorage.setItem(ASKED, '1'); } catch {}
    const close = () => { box.classList.remove('in'); setTimeout(() => box.remove(), 350); };
    const yes = h('button.go.small', { type: 'button', on: { click: async () => {
      let p = Notification.permission;
      if (p !== 'granted') { try { p = await Notification.requestPermission(); } catch { p = 'denied'; } }
      setPref(p === 'granted' ? 'on' : 'off');
      app.toast(p === 'granted' ? 'Done: you will be told when the agent asks something or a stage ends. Settings can turn this off.' : 'Notifications stay off: the browser did not allow them. You can allow them in its site settings.', p === 'granted' ? 'ok' : 'info');
      close();
    } } }, 'Yes, tell me');
    const no = h('button.calm.small', { type: 'button', on: { click: () => { setPref('off'); close(); } } }, 'No thanks');
    const box = h('div.notify-offer', { role: 'region', 'aria-label': 'Notifications' }, h('span', 'The agent can take a while. Tell you when it asks something or a stage ends, even if you are in another window?'), yes, no);
    host.append(box);
    requestAnimationFrame(() => box.classList.add('in'));
  }
  return { tell, offer, seen, get unseen() { return unseen; }, supported, pref: getPref, setPref };
}
