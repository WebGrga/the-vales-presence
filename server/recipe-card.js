// What a recipe card says about time and cost (pure). Nothing is invented: the numbers are the median of the stages
// that really ran in this installation's projects (project.json: stages.<id>.ms and .cost, stages marked done). A stage
// no project has run yet is listed as "not measured" and left out of the sums, so the card says "about" and what is missing.
import { isAgent } from './stages.js';

const MIN_MS = 30000; // a stage under 30 s is a test or a skipped one: not evidence

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };

// projects: [{ recipe, stages: { id: { status, ms, cost } } }] -> { byRecipe: { 'recipe/stage': { n, ms, cost } }, byStage: { stage: {n, ms, cost} } }
export function stageStats(projects) {
  const rows = new Map(); // key -> [{ ms, cost }]
  const add = (k, v) => { if (!rows.has(k)) rows.set(k, []); rows.get(k).push(v); };
  for (const p of projects || []) {
    for (const [id, s] of Object.entries(p?.stages || {})) {
      if (s?.status !== 'done' || !(s.ms >= MIN_MS)) continue;
      const v = { ms: s.ms, cost: Number(s.cost) || 0 };
      add(`${p.recipe}/${id}`, v); add(id, v);
    }
  }
  const out = {};
  for (const [k, list] of rows) out[k] = { n: list.length, ms: median(list.map((x) => x.ms)), cost: median(list.map((x) => x.cost)) };
  return out;
}

// the recipe's agent stages with a measurement (its own recipe's first, else the same stage of any recipe) and the rest
export function estimate(recipe, stats) {
  let ms = 0, cost = 0, measured = 0;
  const missing = [];
  const agent = (recipe?.stages || []).filter((s) => isAgent(s.kind));
  for (const s of agent) {
    const m = stats?.[`${recipe.id}/${s.id}`] || stats?.[`${recipe.from}/${s.id}`] || stats?.[s.id];
    if (m) { ms += m.ms; cost += m.cost; measured++; } else missing.push(s.title || s.id);
  }
  return { ms: Math.round(ms), cost: Math.round(cost * 100) / 100, measured, total: agent.length, missing };
}

// pure: "about 1 h 15 min", rounded so it never looks measured to the second
export function roughTime(ms) {
  const m = Math.round(ms / 60000);
  if (m < 2) return 'about a minute';
  if (m < 10) return `about ${m} min`;
  if (m < 60) return `about ${Math.round(m / 5) * 5} min`;
  const t = Math.round(m / 5) * 5, h = Math.floor(t / 60), r = t % 60;
  return `about ${h} h${r ? ` ${r} min` : ''}`;
}
// pure: "about $2", "about $0.50"
export function roughCost(c) {
  if (c < 0.25) return 'under $0.25';
  if (c >= 5) return `about $${Math.round(c)}`;
  const v = Math.round(c * 2) / 2;
  return `about $${Number.isInteger(v) ? v : v.toFixed(2)}`;
}
