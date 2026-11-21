// The drawer's Spend: what the agents cost today, this month, per day and per month, from every project's log, and an
// optional "warn me above $X" per day and per month (Settings keeps the same two numbers). Honest about plans: on a
// subscription login these amounts are usage valued at API prices, not a bill.
import { h } from './dom.js';

const money = (x) => `$${Number(x || 0).toFixed(2)}`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function mount(host, app) {
  const box = h('div.ds');
  host.append(box);

  function bars(items, label, max) {
    return h('div.ds-bars', ...items.map((x) => h('div.ds-bar', { title: `${label(x)}: ${money(x.cost)}` },
      h('span.ds-fill', { style: `height:${max ? Math.max(x.cost ? 3 : 0, Math.round((x.cost / max) * 100)) : 0}%` }), h('span.ds-l', label(x).slice(-2)))));
  }
  function limitField(key, label, value) {
    const input = h('input', { type: 'number', min: 0, step: 1, value: value || '', placeholder: 'off', 'aria-label': label });
    const save = async () => {
      const n = input.value.trim() === '' ? 0 : Number(input.value);
      if (!Number.isFinite(n) || n < 0) { app.toast('Use an amount in dollars, or leave it empty to turn the warning off.', 'error'); return; }
      try { await app.api('/api/agent/settings', { [key]: n }); app.toast(n ? `You will be warned above ${money(n)}.` : 'That warning is off.', 'ok'); refresh(); } catch (e) { app.toast(e.message, 'error'); }
    };
    input.addEventListener('change', save);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    return h('label.ds-limit', h('span', label), h('span.ds-in', '$', input));
  }
  function draw(d) {
    const days = d.days.slice(0, 14).reverse(), months = d.months.slice(0, 6);
    const max = Math.max(0, ...days.map((x) => x.cost));
    box.replaceChildren(...[
      h('div.ds-big', h('div', h('span.dim', 'Today'), h('b', money(d.today))), h('div', h('span.dim', 'This month'), h('b', money(d.month)))),
      d.over.length ? h('p.ds-over', d.over.map((o) => `${o.per === 'day' ? 'Today' : 'This month'}: ${money(o.spent)} is above your ${money(o.limit)} warning.`).join(' ')) : null,
      h('p.dim.ds-note', d.plan ? 'You are signed in with a subscription. These amounts are what Claude Code counts for each turn, at API prices: your plan is not billed per use, so read them as how much of it you use.'
        : d.plan === false ? 'These amounts are what each turn cost through your API key.' : 'These amounts are what Claude Code counts for each turn. On a subscription login they are usage valued at API prices, not a bill.'),
      h('h3', 'Last 14 days'), bars(days, (x) => x.day.slice(5), max),
      h('h3', 'Months'), h('div.ds-months', ...months.map((m) => h('div.ds-m', h('span', `${MON[Number(m.month.slice(5)) - 1]} ${m.month.slice(0, 4)}`), h('b', money(m.cost)), h('span.dim', `${m.n} turn${m.n === 1 ? '' : 's'}`)))),
      d.projects.length ? h('div', h('h3', 'Most spent in (projects you still have)'), ...d.projects.slice(0, 5).map((p) => h('div.ds-p', h('span', p.project), h('b', money(p.cost))))) : null,
      h('h3', 'Warn me above'), h('div.ds-limits', limitField('warnDay', 'in a day', d.limits.warnDay), limitField('warnMonth', 'in a month', d.limits.warnMonth)),
      h('p.dim.ds-note', 'Spend of projects you moved to the Bin is not counted. A warning shows once a day (or month) when you pass it.')].filter(Boolean));
  }
  async function refresh() {
    try { draw(await app.api('/api/spend')); } catch (e) { box.replaceChildren(h('p.dr-err', `The spend did not load: ${e.message}`)); }
  }
  app.on('agent', (m) => { if (m.event === 'done' && host.closest('.drawer.in') && !host.hidden) setTimeout(refresh, 800); });
  return { refresh };
}
