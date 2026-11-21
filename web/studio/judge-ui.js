// The Judge button on the Feed page (E44) and what it found: every one of your options' pooled score against the bar
// (the 3rd-best real winner in the same feed). The judging itself is server/studio/judge-run.js; this only starts it,
// follows it and draws the result.
import { h } from '../shell/dom.js';
import { fileUrl } from './format.js';

const STEPS = { starting: 'Starting…', drawing: 'Drawing the numbered feed…', judging: 'Three judges are looking…', done: 'Done.' };

// ctx; getData() -> the studio data; getPairs() -> [{ title: option, thumb: option }]
export function judgeControl(ctx, getData, getPairs) {
  const btn = h('button.small', { type: 'button', title: 'Three fresh judges score every tile 0 to 10 at 168 px, without view counts', on: { click: start } }, 'Judge');
  const status = h('span.dim.st-judge-status', { 'aria-live': 'polite' });
  const el = h('span.st-judge', btn, status);
  let timer = null, wasRunning = false;

  async function start() {
    const pairs = getPairs();
    if (!pairs.length) { ctx.toast('Star at least one title and one thumbnail first.', 'error'); return; }
    const real = (getData()?.research?.videos || []).filter((v) => v.thumb).length;
    if (real < 3) { ctx.toast('The bar needs at least 3 real videos with pictures: run Research first.', 'error'); return; }
    if (!confirm(`Run the judge panel?\n\nThree fresh judges look at one picture: your ${pairs.length} option${pairs.length === 1 ? '' : 's'} among up to 12 real winners, numbered, at 168 px, with no view counts. They score every tile 0 to 10.\n\nThis uses your Claude subscription (a few minutes, a few cents).`)) return;
    btn.disabled = true; status.textContent = STEPS.starting;
    try { await ctx.api(`/api/studio/${ctx.id}/judge`, { pairs: pairs.map((p) => ({ title: p.title.id, thumb: p.thumb.id })) }); } catch (e) { btn.disabled = false; status.textContent = ''; ctx.toast(e.message || String(e), 'error'); return; }
    follow();
  }

  // the server keeps the state: a reload in the middle picks it up again
  async function follow() {
    clearTimeout(timer);
    let s;
    try { s = await ctx.api(`/api/studio/${ctx.id}/judge-status`); } catch { s = null; }
    if (s?.running) { wasRunning = true; btn.disabled = true; status.textContent = STEPS[s.state?.status] || 'Working…'; timer = setTimeout(follow, 2000); return; }
    btn.disabled = false;
    status.textContent = wasRunning || !s?.state ? '' : s?.state?.status === 'error' ? `The judges could not finish: ${s.state.error}` : '';
    if (wasRunning) { wasRunning = false; ctx.reload(); }
  }
  return { el, resume: follow, stop: () => clearTimeout(timer) };
}

// pure: a pair's judged result from the saved judge, or null
export const resultFor = (judge, key) => judge?.tiles?.find((t) => t.kind === 'ours' && t.key === key) || null;

// the result panel: a bar chart of your options against the bar
export function judgePanel(ctx, judge, pairs) {
  if (!judge) return h('p.dim.st-judge-none', 'Not judged yet. The Judge button asks three fresh judges to score your options among the real winners.');
  const ours = judge.tiles.filter((t) => t.kind === 'ours' && t.score !== null).sort((a, b) => b.score - a.score);
  const keys = new Set(pairs.map((p) => p.key));
  const stale = !pairs.every((p) => (judge.keys || []).includes(p.key)) || !(judge.keys || []).every((k) => keys.has(k));
  const hasBar = Number.isFinite(judge.bar);
  const row = (t) => {
    const pass = hasBar && t.score >= judge.bar;
    return h('div.st-jrow' + (pass ? '.pass' : ''),
      h('span.st-jname', t.title),
      h('div.st-jtrack', h('div.st-jfill', { style: `width:${t.score * 10}%` }), hasBar ? h('div.st-jbar', { style: `left:${judge.bar * 10}%`, title: `The bar: ${judge.bar}` }) : null),
      h('span.st-jnum', `${t.score}`),
      h('span.st-jverdict', !hasBar ? '' : pass ? 'at or above the bar' : `${Math.round((judge.bar - t.score) * 10) / 10} below the bar`),
      h('span.dim.st-jwhy', t.why || ''));
  };
  return h('div.st-judge-panel',
    h('p', h('b', hasBar ? `The bar is ${judge.bar}` : 'No bar'), hasBar ? ` (the 3rd-best of ${judge.barFrom} real winners in this feed). ` : ' (fewer than 3 real winners were scored). ',
      `${judge.judges} judge${judge.judges === 1 ? '' : 's'} · ${new Date(judge.at).toLocaleString()} · $${(judge.cost || 0).toFixed(2)} · `,
      h('a', { href: fileUrl(ctx.id, judge.sheet, Date.parse(judge.at)), target: '_blank', rel: 'noopener' }, 'what the judges saw')),
    stale ? h('p.st-note', 'The options in the feed changed since the judges looked. Press Judge again to score them.') : null,
    h('p.dim', 'A judge is not real click-through: the final test is the upload against your own median. Option scores are the mean of the judges (0 to 10).'),
    ...ours.map(row));
}
