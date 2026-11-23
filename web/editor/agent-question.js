// One card for the agent's questions: every question with its options (several where it allows), an own-answer box
// each, and one Send for the whole set. What you pick and type is kept as a draft (this browser at once, the server
// too) so it survives a redraw and a reload. Once answered, or once the agent stops waiting, the card is read-only.
// The rules are in agent-ask.js.
import { h, icon, button } from '../shell/dom.js';
import { createDraft } from '../shell/drafts.js';
import { mediaUrl } from '../shell/api.js';
import { questionMedia } from './agent-media.js';
import { questionKey, toggle, setOwn, answersOf, sendLabel, progress, labelOf, isMulti } from './agent-ask.js';

// createQuestionCard({ app, projectId, questions, open }) -> { el, key, close(word), focus() }
export function createQuestionCard({ app, projectId, questions, open = true }) {
  const stamp = Date.now(); // a proof is made again under the same name: the browser must not show the old one
  const enc = encodeURIComponent;
  const key = questionKey(questions);
  const draft = createDraft(projectId, 'ask:' + key);
  const read = (t) => { try { const v = JSON.parse(t || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
  let state = read(draft.get());
  let live = open;
  const save = () => draft.set(JSON.stringify(state));

  const head = h('div.ag-q-head', icon('question', true), h('b', questions.length > 1 ? `The agent asks you ${questions.length} things` : 'The agent asks you'));
  const status = h('p.ag-q-status', { hidden: true, role: 'status' });
  const sendBtn = button('send', sendLabel(questions, state), 'Send every answer at once', () => send(), 'go');
  const foot = h('div.ag-q-foot', sendBtn, h('span.dim.ag-q-hint', 'Pick, or write your own; nothing goes until you press Send.'));
  const parts = questions.map((q, i) => part(q, i));
  const el = h('div.ag-question', { 'data-key': key }, head, ...parts.map((p) => p.el), foot, status);
  if (!questions.length) el.append(h('p', 'The agent asked something: answer in the box below.'));

  // the example the question points at (a video or a picture of the project): shown right under the question
  function media(q) {
    const items = questionMedia(q, projectId);
    if (!items.length) return null;
    return h('div.ag-q-media', ...items.map((m) => {
      const src = `${mediaUrl(projectId, m.path)}?v=${stamp}`;
      const gone = () => fig.replaceWith(h('p.dim.ag-q-gone', `${m.path} is not there (yet).`));
      const node = m.kind === 'video'
        ? h('video', { src, controls: true, preload: 'metadata', playsInline: true, title: m.path })
        : h('a', { href: src, target: '_blank', rel: 'noopener', title: `${m.path} (open it full size)` }, h('img', { src, alt: m.path }));
      (m.kind === 'video' ? node : node.firstChild).addEventListener('error', () => gone());
      const fig = h('figure.ag-q-fig', node, h('figcaption.dim', m.path));
      return fig;
    }));
  }

  function part(q, i) {
    const multi = isMulti(q);
    const opts = (q.options || []).map((o) => {
      const label = labelOf(o);
      const b = h('button.ag-opt', { type: 'button', role: multi ? 'checkbox' : 'radio', 'aria-checked': 'false', title: o?.description || label },
        h('span.ag-opt-box', { 'aria-hidden': 'true' }), h('span.ag-opt-t', h('b', label), o?.description ? h('small', o.description) : null));
      b.addEventListener('click', () => { if (!live) return; state = toggle(state, i, label, multi); save(); paint(); });
      return { b, label };
    });
    const own = h('textarea.ag-own', { rows: 1, placeholder: opts.length ? 'Or in your own words…' : 'Your answer…', 'aria-label': `Your own answer: ${q.question || ''}` });
    own.value = state.own?.[i] || '';
    own.addEventListener('input', () => { state = setOwn(state, i, own.value); save(); paintSend(); grow(own); });
    own.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
    const el = h('fieldset.ag-q-part', h('legend', h('span.ag-q-n', `${i + 1}`), h('span', q.header ? `${q.header}: ` : '', q.question || '')),
      media(q),
      multi ? h('p.dim.ag-q-multi', 'Pick any that fit') : null,
      opts.length ? h('div.ag-options' + (multi ? '.multi' : ''), { role: multi ? 'group' : 'radiogroup' }, ...opts.map((o) => o.b)) : null, own);
    return { el, opts, own, i };
  }
  const grow = (ta) => { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight + 4) + 'px'; };

  function paintSend() {
    sendBtn.querySelector('span').textContent = sendLabel(questions, state);
    sendBtn.disabled = !live || !progress(questions, state).any;
    parts.forEach((p) => p.el.classList.toggle('done', !!((state.picks?.[p.i] || []).length || String(state.own?.[p.i] || '').trim())));
  }
  function paint() {
    for (const p of parts) for (const o of p.opts) {
      const on = (state.picks?.[p.i] || []).includes(o.label);
      o.b.classList.toggle('on', on); o.b.setAttribute('aria-checked', String(on));
    }
    paintSend();
  }

  async function send() {
    if (!live || !progress(questions, state).any) return;
    sendBtn.disabled = true;
    const answers = answersOf(questions, state);
    try {
      await app.api(`/api/projects/${enc(projectId)}/answer`, { answers });
      close('Answered. The agent carries on with your answers.', true);
    } catch (e) {
      if (e.status === 409) {
        close('The agent is no longer waiting for these answers (it went on, or the stage stopped).', false);
        const text = Object.entries(answers).map(([q, a]) => `${q}\n${a}`).join('\n\n');
        status.append(' ', button('send', 'Send them as a message', 'Tell the agent these answers as a new message', async (ev) => {
          ev.currentTarget.disabled = true;
          try { await app.api(`/api/projects/${enc(projectId)}/say`, { text }); draft.clear(); } catch (er) { app.toast('The agent did not get it: ' + er.message, 'error'); ev.currentTarget.disabled = false; }
        }, 'small calm'));
      } else { app.toast('Could not send your answers: ' + e.message + ' (they are kept here)', 'error'); sendBtn.disabled = false; }
    }
  }

  // read-only from now on; `sent` clears the draft (your words reached the agent)
  function close(word, sent) {
    if (!live && !word) return;
    live = false;
    el.classList.add('closed'); el.classList.toggle('sent', !!sent);
    for (const p of parts) { p.own.readOnly = true; for (const o of p.opts) o.b.disabled = true; if (!p.own.value) p.own.hidden = true; }
    foot.hidden = true;
    if (word) { status.textContent = word; status.hidden = false; }
    if (sent) draft.clear();
    el.dispatchEvent(new CustomEvent('ask-closed', { bubbles: true, detail: { sent: !!sent } }));
  }

  paint();
  if (!open) close('The agent is no longer waiting for this.', false);
  else draft.fromServer().then((t) => { if (t && live && !progress(questions, state).any) { state = read(t); for (const p of parts) p.own.value = state.own?.[p.i] || ''; paint(); } });
  return {
    el, key,
    get live() { return live; },
    close,
    focus() {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const first = parts.find((p) => !p.el.classList.contains('done')) || parts[0];
      (first?.opts[0]?.b || first?.own)?.focus({ preventScroll: true });
      el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    },
  };
}
