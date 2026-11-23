// The activity strip: under the stage bar on every tab, while the agent works it says what it is doing now (its last step
// in plain words), the stage, the time, and has Stop and "Stop after this stage". A click on the words opens the drawer's
// live log. The Activity button in the top bar opens the drawer on its own, with a dot when another project is working.
// The state is a reducer (activity-state.js); this draws it.
import { h, icon } from './dom.js';
import { idle, reduce, fromStatus, stripLine } from './activity-state.js';
import { fmtClock } from './stages.js';
import { recipeOf } from './stages.js';

export function mountActivity(host, app, topBar) {
  let st = idle();
  const dot = h('span.act-dot');
  const what = h('b.act-what');
  const step = h('span.act-step');
  const time = h('span.act-time');
  const body = h('button.act-body', { type: 'button', title: 'Open the live log', on: { click: () => app.drawer?.open('live') } }, dot, what, step, time);
  const after = h('button.small.calm.act-after', { type: 'button', on: { click: () => toggleAfter() } }, icon('pause', true), h('span'));
  const stop = h('button.small.warn.act-stop', { type: 'button', title: 'Stop the agent now', on: { click: () => stopNow() } }, icon('stop', true), h('span', 'Stop'));
  const strip = h('div.act-strip', { hidden: true, role: 'status' }, body, h('div.grow'), after, stop);
  host.append(strip);

  // the top bar button
  const badge = h('span.act-badge', { hidden: true });
  const btn = h('button.calm.act-btn', { type: 'button', title: 'Activity: live log, history, queue, spend (Ctrl+K, then type "history")', 'aria-label': 'Activity', on: { click: () => app.drawer?.toggle(app.drawer.isOpen() ? null : 'history') } }, icon('clock', true), h('span.act-btn-t', 'Activity'), badge);
  topBar.append(btn);

  const stageTitle = () => { const p = app.project(); const r = recipeOf(p); return (r?.stages || []).find((s) => s.id === st.stage)?.title || (st.stage ? st.stage : ''); };
  function draw() {
    const l = stripLine(st, stageTitle());
    const on = !!l.kind;
    strip.hidden = !on;
    strip.className = `act-strip ${l.kind || ''}`;
    strip.hidden = !on;
    if (!on) return;
    what.textContent = l.what;
    step.textContent = l.step ? ` · ${l.step}` : '';
    body.title = `${l.what}${l.step ? ': ' + l.step : ''}. Click for the live log.`;
    tick();
    const working = st.busy || st.asleep || l.kind === 'sleep';
    const known = !!st.stage && (st.busy || st.asleep);
    after.hidden = !known;
    after.querySelector('span').textContent = st.stopAfter ? 'Stops after this stage (undo)' : 'Stop after this stage';
    after.classList.toggle('on', st.stopAfter);
    after.title = st.stopAfter ? 'It will stop when this stage ends and wait for you. Click to let it carry on by itself.' : 'Let this stage finish, then wait for you instead of starting the next one by itself';
    // a background task of a plain chat turn gets its own Stop: it ends the task and everything it started
    stop.hidden = !(working || l.kind === 'queue' || l.bg);
    stop.querySelector('span').textContent = l.bg ? ((st.fires || []).length > 1 ? 'Stop tasks' : 'Stop task') : 'Stop';
    stop.title = l.bg ? 'End the background task and everything it started' : 'Stop the agent now';
  }
  function tick() {
    const l = stripLine(st, '');
    const from = l.since || ((st.busy || st.asleep) && !st.asking ? st.since : 0);
    time.textContent = from ? ` · ${fmtClock(Date.now() - from)}` : '';
  }
  setInterval(tick, 1000);

  const bgOnly = () => stripLine(st, '').bg === true;
  async function stopNow() {
    const p = app.project(); if (!p) return;
    stop.disabled = true;
    try { await app.api(`/api/projects/${encodeURIComponent(p.id)}/${bgOnly() ? 'fire/stop' : 'stop'}`, {}); } catch (e) { app.toast('Stop: ' + e.message, 'error'); }
    stop.disabled = false;
  }
  async function toggleAfter() {
    const p = app.project(); if (!p) return;
    after.disabled = true;
    try { const r = await app.api(`/api/projects/${encodeURIComponent(p.id)}/stop-after`, { on: !st.stopAfter }); st = { ...st, stopAfter: !!r.stopAfter }; draw(); } catch (e) { app.toast(e.message, 'error'); }
    after.disabled = false;
  }

  // other projects at work: a dot on the button
  const others = new Set();
  function paintBadge() { badge.hidden = !others.size; badge.textContent = others.size ? String(others.size) : ''; btn.classList.toggle('busy', others.size > 0 || st.busy); }

  async function load() {
    const p = app.project();
    st = idle();
    draw();
    if (!p) return;
    try {
      const s = await app.api(`/api/projects/${encodeURIComponent(p.id)}/agent`);
      if (app.project()?.id !== p.id) return;
      st = fromStatus(s, app.project()?.view || null, { projectId: p.id });
    } catch {}
    draw(); paintBadge();
  }
  const feed = (m) => {
    const id = app.project()?.id;
    if (m.type === 'live') { if (m.view?.running && m.project !== id) others.add(m.project); else others.delete(m.project); paintBadge(); }
    if (!id || (m.project && m.project !== id)) return;
    const next = reduce(st, m, { projectId: id });
    if (next !== st) { st = next; draw(); paintBadge(); }
  };
  for (const t of ['agent', 'progress', 'live', 'queue', 'fire']) app.on(t, feed);
  // the project's view was read again (the link came back, a stage changed): the strip takes what the server says now
  app.on('project-view', () => { const p = app.project(); if (p?.view) feed({ type: 'live', project: p.id, view: p.view }); });
  app.on('select', () => load());
  app.on('waiting', () => { st = { ...st, asking: !!app.waiting?.asking }; draw(); });
  app.on('socket', (m) => { if (m.up) load(); });
  load();
  return { state: () => st };
}
