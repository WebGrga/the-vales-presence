// What the agents cost, per day and per month, from every project's log (.presence/log.jsonl): a stage's end and a
// chat turn each carry their cost. Pure: entries in, sums out (tested in spend.test.js). The cost is what Claude Code
// counts for each turn; on a subscription login nothing of it is billed per use, so the screen says that (plan).
// An optional limit (settings warnDay / warnMonth, dollars; 0 = off) is checked here too.

const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const round = (x) => Math.round(x * 1e4) / 1e4;

// does this log line count as spend? (a start, a queue line or an approval has no cost)
export const counts = (e) => e && Number(e.cost) > 0 && !['started', 'queued'].includes(String(e.status || ''));

// entries: [{ t, cost, ms, project, plan?, stage }] -> { today, month, days[31 newest first], months[12 newest first], projects[], plan }
export function summarise(entries, now = new Date()) {
  const days = new Map(), months = new Map(), byProject = new Map();
  let plan = null;
  for (const e of entries || []) {
    if (!counts(e)) continue;
    const at = new Date(e.t);
    if (Number.isNaN(at.getTime())) continue;
    const c = Number(e.cost);
    const add = (m, k) => { const v = m.get(k) || { cost: 0, ms: 0, n: 0 }; v.cost += c; v.ms += Number(e.ms) || 0; v.n += 1; m.set(k, v); };
    add(days, dayKey(at)); add(months, monthKey(at));
    if (e.project) { const v = byProject.get(e.project) || { project: e.project, cost: 0 }; v.cost += c; byProject.set(e.project, v); }
    if (e.plan === true) plan = true; else if (e.plan === false && plan === null) plan = false;
  }
  const lastDays = [];
  for (let i = 0; i < 31; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const v = days.get(dayKey(d)) || { cost: 0, ms: 0, n: 0 };
    lastDays.push({ day: dayKey(d), cost: round(v.cost), ms: v.ms, n: v.n });
  }
  const lastMonths = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const v = months.get(monthKey(d)) || { cost: 0, ms: 0, n: 0 };
    lastMonths.push({ month: monthKey(d), cost: round(v.cost), ms: v.ms, n: v.n });
  }
  return {
    today: lastDays[0].cost, month: lastMonths[0].cost, days: lastDays, months: lastMonths, plan,
    projects: [...byProject.values()].map((x) => ({ ...x, cost: round(x.cost) })).sort((a, b) => b.cost - a.cost).slice(0, 10),
  };
}

// the limits that are passed -> [{ per: 'day'|'month', limit, spent }]
export function over(sum, { warnDay = 0, warnMonth = 0 } = {}) {
  const out = [];
  if (warnDay > 0 && sum.today > warnDay) out.push({ per: 'day', limit: warnDay, spent: sum.today });
  if (warnMonth > 0 && sum.month > warnMonth) out.push({ per: 'month', limit: warnMonth, spent: sum.month });
  return out;
}

export const money = (x) => `$${Number(x || 0).toFixed(2)}`;

// the words of a warning
export function warnText(o, plan) {
  const per = o.per === 'day' ? 'today' : 'this month';
  return `Spend ${per} is ${money(o.spent)}, above your ${money(o.limit)} limit.${plan ? ' (On a subscription this is usage valued at API prices, not a bill.)' : ''}`;
}
