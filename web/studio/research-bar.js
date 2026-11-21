// The Research page's query bar: the topic, the search phrases as chips you edit, add and remove, the optional
// inputs (competitor channels, when it was posted, language), "Search", and how far a search is.
// A search runs on the server with no agent (so it costs nothing); every edit is kept at once, so a reload loses nothing.
import { h, icon } from '../shell/dom.js';
import { keepDraft, takeDraft } from './persist.js';

const WHEN = [['any', 'Any time'], ['week', 'Past week'], ['month', 'Past month'], ['year', 'Past year']];
const FROM = { brief: 'from the brief', plan: 'from the plan', topic: 'from the topic you gave when you made the project', title: 'from the project title, there is no brief yet' };
const SPAN = { search: [0, 40], channels: [40, 80], pictures: [80, 100] }; // how much of the bar each part of a search fills
const NAME = 'research.query';
const SUGGEST = 'Suggest phrases (agent, under 1¢)';

export const duration = (ms) => {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};
export const costText = (r) => (r.cost === 0 ? 'no agent used, cost $0' : r.cost == null ? 'run by the agent, its cost is in the stage' : `$${Number(r.cost).toFixed(2)}`);

export function queryBar(ctx) {
  let plan = null, last = null, q = null, timer = null, shown = false;
  const topic = h('input', { type: 'text', 'aria-label': 'Topic', placeholder: 'What is the video about?' });
  const topicNote = h('span.dim.st-topic-from');
  const chips = h('div.st-chips');
  const add = h('input.st-chip-add', { type: 'text', 'aria-label': 'Add a search phrase', placeholder: 'Add a phrase, then Enter' });
  const suggest = h('button.small.calm', { type: 'button', title: 'Asks the agent once for six phrases a viewer would type. Replaces the phrases below. Uses the subscription: under a cent.' }, SUGGEST);
  const channels = h('input', { type: 'text', 'aria-label': 'Competitor channels', placeholder: '@handle or channel link, separated by commas' });
  const when = h('select', { 'aria-label': 'Posted' }, ...WHEN.map(([k, v]) => h('option', { value: k }, v)));
  const language = h('input', { type: 'text', 'aria-label': 'Language', placeholder: 'en, de, fr…', maxlength: 8, size: 8 });
  const go = h('button.go', { type: 'button' }, icon('eye', true), h('span', 'Search'));
  const stop = h('button.small.calm', { type: 'button', hidden: true }, 'Stop');
  const warn = h('p.st-note', { hidden: true });
  const bar = h('i'), prog = h('div.st-progress', { hidden: true }, bar);
  const line = h('p.st-runline', { hidden: true });
  const intro = h('p.st-intro');
  const opts = h('details.st-qopts', h('summary', 'Options: competitor channels, when, language'),
    h('div.st-qopts-grid',
      h('label.st-field', h('span', 'Competitor channels'), channels, h('span.dim', 'Their best, typical and weakest videos are added, up to 6 channels.')),
      h('label.st-field', h('span', 'Posted'), when),
      h('label.st-field', h('span', 'Language'), language, h('span.dim', 'Prefers results in that language.'))));
  const el = h('div.px-frame.st-qbar',
    intro,
    h('label.st-field', h('span', 'Topic'), h('span.st-topic-row', topic, suggest), topicNote),
    h('div.st-field', h('span', 'Search phrases'), chips, h('span.dim', 'What a viewer would type. Click a phrase to edit it, x to remove it.')),
    opts, warn,
    h('div.st-qgo', go, stop, h('span.dim.st-qhelp', 'Searching reads YouTube with yt-dlp: no agent, no cost.')),
    prog, line);

  const save = () => keepDraft(ctx.id, NAME, q);
  const ask = () => plan?.asks && !last && !plan?.hadRuns; // no brief and no plan: the title is not a topic, so the field starts empty
  const fresh = () => ({ topic: ask() ? '' : plan?.topic || '', phrases: [...(last?.phrases?.length ? last.phrases : ask() ? [] : plan?.phrases || [])], channels: (last?.options?.channels || []).join(', '), when: last?.options?.when || 'any', language: last?.options?.language || '', touched: false });

  function drawChips() {
    chips.replaceChildren(...q.phrases.map((p, i) => {
      const inp = h('input', { type: 'text', value: p, 'aria-label': `Search phrase ${i + 1}`, maxlength: 120 });
      const fit = () => { inp.style.width = `${Math.max(6, [...inp.value].length + 2)}ch`; };
      fit();
      inp.addEventListener('input', () => { q.phrases[i] = inp.value; q.touched = true; fit(); save(); });
      inp.addEventListener('blur', () => { if (!inp.value.trim()) { q.phrases.splice(i, 1); drawChips(); save(); } });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
      return h('span.st-chip', inp, h('button', { type: 'button', title: 'Remove this phrase', 'aria-label': `Remove “${p}”`, on: { click: () => { q.phrases.splice(i, 1); q.touched = true; drawChips(); save(); } } }, '×'));
    }), add);
  }

  function put() {
    topic.value = q.topic; channels.value = q.channels; when.value = q.when; language.value = q.language;
    drawChips();
    meta();
  }
  // the words around the fields: safe to redraw while the user types
  function meta() {
    topic.placeholder = plan?.asks && plan.topic ? `What is the video about? (this project is called “${plan.topic}”)` : 'What is the video about?';
    topicNote.textContent = plan ? (plan.asks ? (q.topic ? 'No brief or plan yet: the phrases come from what you wrote here.' : 'There is no brief or plan to read the topic from, so say it in a few words.') : FROM[plan.from] || '') : '';
    const first = !(last || plan?.hadRuns);
    intro.hidden = !first;
    intro.textContent = q.topic ? `No research yet. Search will look on YouTube for what already wins on “${q.topic}”, with the phrases below. Change anything first.` : 'No research yet. Say what the video is about, check the phrases, then search.';
    go.querySelector('span').textContent = first ? 'Search' : 'Search again';
  }

  const add1 = () => {
    const t = add.value.replace(/\s+/g, ' ').trim();
    if (!t) return;
    if (!q.phrases.some((p) => p.toLowerCase() === t.toLowerCase())) q.phrases.push(t);
    add.value = ''; q.touched = true; drawChips(); save();
  };
  add.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add1(); add.focus(); } });
  add.addEventListener('blur', add1);
  topic.addEventListener('input', () => { q.topic = topic.value; save(); clearTimeout(topic._t); if (!q.touched) topic._t = setTimeout(propose, 500); meta(); });
  channels.addEventListener('input', () => { q.channels = channels.value; save(); });
  when.addEventListener('change', () => { q.when = when.value; save(); });
  language.addEventListener('input', () => { q.language = language.value.trim(); save(); });

  async function propose(force) {
    const r = await ctx.api(`/api/studio/${ctx.id}/research/propose?topic=${encodeURIComponent(q.topic)}`).catch(() => null);
    if (!r || (!force && q.touched)) return;
    q.phrases = r.phrases; if (force) q.touched = false; drawChips(); save();
  }
  suggest.addEventListener('click', async () => {
    if (!q.topic.trim()) { topic.focus(); return; }
    suggest.disabled = true; suggest.textContent = 'Asking the agent…';
    const r = await ctx.api(`/api/studio/${ctx.id}/research/suggest`, { topic: q.topic }).catch(() => null);
    suggest.disabled = false; suggest.textContent = SUGGEST;
    if (!r) { warn.hidden = false; warn.textContent = 'Could not ask the agent. The free phrases stay.'; return; }
    warn.hidden = !r.error; warn.textContent = r.error ? `The agent could not be reached (${r.error}). These are the free phrases.` : '';
    q.phrases = r.phrases; q.touched = false; drawChips(); save();
  });

  async function run() {
    add1();
    warn.hidden = true;
    const phrases = q.phrases.map((p) => p.trim()).filter(Boolean);
    const chans = q.channels.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
    if (!phrases.length && !chans.length) { warn.hidden = false; warn.textContent = 'Write at least one search phrase (or a competitor channel) first.'; add.focus(); return; }
    save();
    try {
      await ctx.api(`/api/studio/${ctx.id}/research/run`, { phrases, options: { channels: chans, when: q.when, language: q.language } });
    } catch (e) { warn.hidden = false; warn.textContent = e.message || String(e); return; }
    watch();
  }
  go.addEventListener('click', run);
  stop.addEventListener('click', () => { stop.disabled = true; ctx.api(`/api/studio/${ctx.id}/research/stop`, {}).catch(() => {}); });

  // how far a search is: asked every second while one runs (also after a reload, the search goes on in the server)
  function paint(st) {
    const on = !!st.running;
    go.disabled = on; stop.hidden = !on; stop.disabled = !!st.stopping; prog.hidden = !on;
    for (const e of [topic, add, channels, when, language, suggest]) e.disabled = on;
    for (const b of chips.querySelectorAll('input, button')) b.disabled = on;
    if (on) {
      const [a, b] = SPAN[st.phase] || [0, 100];
      bar.style.width = `${a + (st.total ? (st.done / st.total) * (b - a) : 0)}%`;
      line.hidden = false;
      line.textContent = `${st.text || 'Working…'}${st.videos ? ` · ${st.videos} videos so far` : ''} · ${duration(Date.now() - st.startedAt)}`;
    }
  }
  async function watch() {
    clearTimeout(timer);
    const st = await ctx.api(`/api/studio/${ctx.id}/research/status`).catch(() => null);
    if (!st) { timer = setTimeout(watch, 2000); return; }
    paint(st);
    if (st.running) { shown = true; timer = setTimeout(watch, 800); return; }
    const recent = Date.now() - ((st.startedAt || 0) + (st.ms || 0)) < 120000; // a search that ended while this page was open or just before
    if (shown || ((st.run || st.error) && recent)) finish(st);
    shown = false;
  }
  function finish(st) {
    paint(st);
    line.hidden = false; line.dataset.live = '1';
    line.classList.toggle('bad', !!st.error);
    if (st.error) line.textContent = st.error;
    else {
      const r = st.run;
      line.textContent = `Found ${r.count} videos in ${duration(st.ms)}${r.partial ? ' (stopped early)' : ''}. ${costText(r)[0].toUpperCase()}${costText(r).slice(1)}.${st.failed?.length ? ` ${st.failed.length} part${st.failed.length === 1 ? '' : 's'} failed: ${st.failed[0]}` : ''}`;
    }
    ctx.reload();
  }

  // after a reload the last search's time and cost are still said
  function lastLine() {
    if (!last || !prog.hidden || line.dataset.live) return;
    line.hidden = false; line.classList.remove('bad');
    line.textContent = last.by === 'agent' || last.legacy ? `Last run: ${last.count} videos, ${last.legacy ? 'found by the agent' : 'run by the agent'}.` : `Last search: ${last.count} videos in ${duration(last.ms)}${last.partial ? ' (stopped early)' : ''}. ${costText(last)[0].toUpperCase()}${costText(last).slice(1)}.`;
  }

  return {
    el,
    // r = the Research part of the studio payload
    setData(r) {
      plan = { ...r.plan, hadRuns: r.runs.length > 0 }; last = r.lastRun;
      setTimeout(lastLine, 0);
      if (!q) {
        const d = takeDraft(ctx.id, NAME);
        q = d?.value && Array.isArray(d.value.phrases) ? { ...fresh(), ...d.value } : fresh();
        put();
        watch();
      } else {
        // nothing the user typed is replaced; only what they have not touched follows the server
        if (!q.topic && plan.topic && !ask()) { q.topic = plan.topic; topic.value = q.topic; }
        if (!q.touched && !q.phrases.length) { q.phrases = fresh().phrases; drawChips(); }
        meta();
      }
    },
    usePhrases(run) {
      q.phrases = [...run.phrases]; q.channels = (run.options?.channels || []).join(', '); q.when = run.options?.when || 'any'; q.language = run.options?.language || ''; q.touched = true;
      put(); save(); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
    unmount() { clearTimeout(timer); },
  };
}
