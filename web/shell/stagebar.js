// The stage bar: the recipe's stages as pixel chips (done, working, waiting for your answer, in line, your turn,
// halted), each with its time and cost (a running one with its clock), the project's totals (Studio and talks
// included), and the current stage's buttons: Go, Answer, Approve (& lock), Send back with notes, Stop.
// Chips shrink to number + short name when the row is narrow (the full name on hover). The decisions are in
// stages.js; the notes a send-back carries get the editor's cut choices through app.hooks.notes.
import { h, icon, button } from './dom.js';
import { chips, totals, actions, fmtMs, fmtCost, fmtClock, elapsed, recipeOf, chipMode, pendingFrom, plainChoices } from './stages.js';
import { createDraft, bindDraft } from './drafts.js';
import { baseMark } from '../editor/edl-edit.js';

const KIND_ICON = { ask: 'question', make: 'agent', gate: 'flag', inspect: 'eye', record: 'mic', options: 'sparkle', upload: 'upload', export: 'export' };
const AGENT_KINDS = new Set(['ask', 'make', 'inspect']);
const STATE_WORD = { done: 'done', now: 'the agent is working', ask: 'the agent is waiting for your answer', queued: 'waiting in line', you: 'your turn', halted: 'halted', ready: 'ready: press Go', todo: 'later' };

export function mountStageBar(el, app) {
  const row = h('div.stage-chips', { role: 'list', 'aria-label': 'Stages' });
  const sum = h('div.stage-sum');
  const btns = h('div.stage-btns');
  const halt = h('div.halt-bar', { hidden: true });
  const pop = h('div.popover.stage-pop.px-frame', { hidden: true, role: 'dialog' });
  el.append(h('div.stage-row', row, sum, btns), halt, pop);
  let busy = false, mode = 'full';
  const more = () => row.classList.toggle('more', row.scrollLeft + row.clientWidth < row.scrollWidth - 2);
  row.addEventListener('scroll', more, { passive: true });
  addEventListener('resize', () => fit());

  // the widths the chips need in each mode, then the mode that fits; the current chip scrolled into view
  function fit() {
    row.classList.remove('compact', 'tiny');
    const full = row.scrollWidth;
    row.classList.add('compact');
    const compact = row.scrollWidth;
    row.classList.remove('compact');
    mode = chipMode({ full, compact }, row.clientWidth);
    if (mode !== 'full') row.classList.add(mode);
    more();
    const cur = row.querySelector('.chip.cur');
    if (cur && row.scrollWidth > row.clientWidth) {
      const r = row.getBoundingClientRect(), c = cur.getBoundingClientRect();
      if (c.left < r.left || c.right > r.right) row.scrollTo({ left: row.scrollLeft + (c.left - r.left) - (r.width - c.width) / 2, behavior: 'smooth' });
    }
  }

  function chipMeta(c) {
    if (c.state === 'now') return h('span.chip-m', h('span.chip-live', { 'data-started': c.started || Date.now() }, fmtClock(elapsed(c))), c.cost ? ' · ' + fmtCost(c.cost) : '');
    if (c.state === 'ask') return h('span.chip-m', 'answer the agent');
    if (c.state === 'queued') return h('span.chip-m', c.behind ? `in line behind ${c.behind}` : 'in line');
    const meta = [fmtMs(c.ms), fmtCost(c.cost)].filter(Boolean).join(' · ');
    return meta ? h('span.chip-m', meta) : null;
  }

  function draw() {
    const p = app.project();
    el.classList.toggle('empty', !p);
    if (!p) { row.replaceChildren(h('span.dim', 'Pick or start a project')); sum.replaceChildren(); btns.replaceChildren(); halt.hidden = true; return; }
    const asking = !!app.waiting?.asking;
    const cs = chips(p, recipeOf(p), { asking });
    const a = actions(p, cs);
    row.replaceChildren(...cs.map((c, n) => {
      const isCur = c.id === p.at && !p.done;
      const tip = [`${c.n}. ${c.title}`, STATE_WORD[c.state] || '', c.lock ? 'approving locks the talk' : '', [fmtMs(c.ms), fmtCost(c.cost)].filter(Boolean).join(' · ')].filter(Boolean).join(' — ') + (c.note ? '\n' + c.note : '');
      const chip = h(`div.chip.${c.state}${isCur ? '.cur' : ''}`, { title: tip, role: 'listitem', 'aria-current': isCur ? 'step' : null },
        icon(c.state === 'done' ? 'keep' : c.state === 'halted' ? 'cross' : c.state === 'ask' ? 'question' : c.state === 'queued' ? 'clock' : (c.lock ? 'lock' : KIND_ICON[c.kind] || 'film'), true),
        h('span.chip-t', h('span.chip-n', `${c.n}`), h('span.chip-full', c.title), h('span.chip-s', c.short)),
        chipMeta(c));
      // a chip of the agent's opens what that stage reads in the Context tab; the brief's chip opens the brief
      if (AGENT_KINDS.has(c.kind) && (c.state !== 'todo' || c.kind === 'ask')) {
        chip.classList.add('link');
        chip.tabIndex = 0;
        chip.title += c.kind === 'ask' ? '\nClick to read the brief' : '\nClick to see what this stage reads';
        const go = () => { const m = { type: 'open-context', id: c.kind === 'ask' ? 'brief' : null, stage: c.id }; app.hooks.contextOpen = m; app.emit('open-context', m); };
        chip.addEventListener('click', go);
        chip.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      }
      return n ? [h('span.chip-join'), chip] : chip;
    }).flat());
    requestAnimationFrame(fit);

    const t = totals(cs, p);
    sum.replaceChildren(icon('clock', true), h('span', fmtMs(t.ms) || '0 s'), icon('coin', true), h('span', fmtCost(t.cost) || '$0.00'));
    sum.title = ['Time and cost so far (cost as your Claude subscription counts it):', `Stages: ${fmtMs(t.stages.ms) || '0 s'} · ${fmtCost(t.stages.cost) || '$0.00'}`,
      ...t.extras.map((x) => `${x.label}: ${fmtMs(x.ms) || '0 s'} · ${fmtCost(x.cost) || '$0.00'}`)].join('\n');

    const list = [];
    if (a.answer) list.push(button('question', 'Answer', 'The agent is waiting for your answer: open its questions', () => app.emit('focus-question', { type: 'focus-question' }), 'ask'));
    if (a.go) list.push(button('go', 'Go', `Run “${a.cur.title}”`, () => call('go'), 'go'));
    // after Stop or a failed stage: go on from the files already there (the last final, a finished rough) without paying for a new run
    if (a.keep && p.view?.keep) { const k = p.view.keep; list.push(button('keep', k.mode === 'back' ? 'Back to the last version' : 'Use what is there', k.text, () => call('keep'), 'calm')); }
    if (a.stop) list.push(button('stop', 'Stop', a.cur?.state === 'queued' ? 'Leave the line: do not run this stage' : 'Stop the agent', () => call('stop'), 'warn'));
    if (a.resume) list.push(button('go', 'Resume', 'Clear the halt and carry on', () => call('resume'), 'go'));
    if (a.approve) list.push(button(a.cur.lock ? 'lock' : 'keep', a.approveLabel, a.cur.lock ? 'Approve, and lock the talk: nothing after this can change a word of it' : 'Approve this stage', () => openPop('approve', a), 'go'));
    if (a.sendback) list.push(button('back', 'Send back', 'Send it back to the agent with your notes', () => openPop('sendback', a), 'calm'));
    btns.replaceChildren(...list);
    halt.hidden = !a.halted;
    if (a.halted) halt.replaceChildren(icon('cross', true), h('b', 'Halted: '), h('span', String(p.halted || a.cur?.note || 'the project stopped')));
  }

  // the running chip's clock, every second
  const ticker = setInterval(() => {
    for (const s of row.querySelectorAll('.chip-live')) s.textContent = fmtClock(Date.now() - Number(s.dataset.started || Date.now()));
  }, 1000);

  async function call(what, body) {
    const p = app.project(); if (!p || busy) return false;
    busy = true; btns.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      const r = await app.api(`/api/projects/${encodeURIComponent(p.id)}/${what}`, body || {});
      if (what === 'go' && r?.queued) app.toast('Waiting in line: another project is rendering. This stage starts by itself when that one ends.', 'warn');
      return true;
    } catch (e) { showError(what, e.message); return false; }
    finally { busy = false; draw(); }
  }
  // an error from a button: inside the open dialog when there is one (a toast under it fades unseen), else a toast
  function showError(what, msg) {
    const text = `${{ go: 'Go', approve: 'Approve', sendback: 'Send back', stop: 'Stop', resume: 'Resume' }[what] || what}: ${msg}`;
    const box = !pop.hidden && pop.querySelector('.pop-err');
    if (box) { box.textContent = text; box.hidden = false; } else app.toast(text, 'error');
  }

  // what the rough does not have yet: the server's count, else the cuts route's review and working list
  async function pendingNow(p) {
    let review = null, working = null;
    try { review = (await app.api(`/api/cuts/${encodeURIComponent(p.id)}`))?.review || {}; } catch {}
    try {
      const w = await app.api(`/api/cuts/${encodeURIComponent(p.id)}/working`);
      const base = w?.working?.working?.base;
      working = base && w.edl && base !== baseMark(w.edl) ? null : w?.working; // made on an older rough: it does not count
    } catch {}
    return pendingFrom(p, review, working);
  }

  async function openPop(kind, a) {
    const p = app.project();
    app.hooks.flush?.();
    // one draft for both dialogs: a note typed for Approve is still there when you choose Send back instead
    const draft = createDraft(p.id, `gate:${a.cur.id}`);
    const old = createDraft(p.id, `${kind}:${a.cur.id}`); // a draft from before the shared one
    if (!draft.get() && old.get()) { draft.set(old.get()); old.clear(); }
    const cutsHere = a.cur.lock; // the review where cut choices count (before the lock)
    const ta = bindDraft(h('textarea', { rows: 4, placeholder: kind === 'sendback' ? (cutsHere ? 'What should change? (your cut choices are added below)' : 'What should change?') : 'Anything to add? (optional)' }), draft);
    const preview = h('pre.notes-preview');
    const err = h('p.pop-err', { hidden: true, role: 'alert' });
    const say = h('div.pop-say', { hidden: true });
    let pending = null;
    const notes = () => {
      if (!cutsHere) return ta.value.trim();
      if (app.hooks.notes) return app.hooks.notes(ta.value);
      return pending ? plainChoices(ta.value, pending) : ta.value.trim();
    };
    const paint = () => { const extra = notes().slice(ta.value.trim().length).trim(); preview.textContent = extra ? 'Sent with it:\n' + extra : ''; preview.hidden = !extra; };
    ta.addEventListener('input', paint);
    const send = async (what) => {
      app.hooks.flush?.();
      const text = notes();
      if (!(await call(what, { notes: text }))) return;
      draft.clear(); pop.hidden = true; app.hooks.sent?.(what);
      app.toast(what === 'approve' ? (a.cur.lock ? 'Approved and locked.' : 'Approved.') : 'Sent back with your notes: the agent works on them now.', 'ok');
    };
    const btnRow = h('div.pop-btns');
    const cancel = button(null, 'Cancel', '', () => { pop.hidden = true; }, 'calm');
    const head = h('h3', kind === 'approve' ? a.approveLabel : 'Send back with notes');
    const lockSay = kind === 'approve' && a.cur.lock ? h('p.lock-say', icon('lock', true), h('span', 'This locks the talk: the edit list and the rough are hashed, and nothing after this can change a word. A changed locked file halts the project.')) : null;
    pop.replaceChildren(...[head, say, lockSay, ta, preview, err, btnRow].filter(Boolean));
    pop.hidden = false; ta.focus();
    const drawButtons = () => {
      if (kind === 'sendback') { btnRow.replaceChildren(button('back', 'Send back', '', () => send('sendback'), 'warn'), cancel); return; }
      if (pending?.any) {
        head.textContent = 'Your choices need a rebuild first';
        say.replaceChildren(icon('question', true), h('span', pending.say));
        say.hidden = false; if (lockSay) lockSay.hidden = true;
        ta.placeholder = 'Anything else for the agent? (optional; your choices go with it)';
        const lock = button('lock', a.approveLabel, 'Not yet: the rough does not have your choices', null, 'go');
        lock.disabled = true;
        btnRow.replaceChildren(button('restore', 'Rebuild with my choices', 'Send the rough back to the agent with your choices; it builds the rough again and you approve that', () => send('sendback'), 'go'), lock, cancel);
      } else {
        say.hidden = true; if (lockSay) lockSay.hidden = false;
        btnRow.replaceChildren(button(a.cur.lock ? 'lock' : 'keep', a.approveLabel, '', () => send('approve'), 'go'), cancel);
      }
    };
    if (cutsHere && (kind === 'approve' || !app.hooks.notes)) {
      btnRow.replaceChildren(h('span.dim', 'Checking your choices…'), cancel);
      pending = await pendingNow(p);
    }
    drawButtons(); paint();
  }
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target) && !btns.contains(e.target)) pop.hidden = true; });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) pop.hidden = true; });

  app.on('project', draw);
  app.on('project-view', draw);
  app.on('select', draw);
  app.on('waiting', draw);
  draw();
  return { draw, dispose() { clearInterval(ticker); } };
}
