// What the agent knows, read from craft/ (shipped) with the user's own data/craft/ on top:
// recipes, the stage kinds (stages.json), which skills each stage reads (stage-skills.json), the skills, the house rules
// and CLAUDE.md. Read fresh on every call (small files), so edits in the context room count at the next stage.
import fs from 'node:fs';
import path from 'node:path';
import { createSets } from './context/sets.js';
import { skillsForFormat as pickFor } from './context/stage-skills.js';

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const NAME = /^[a-z0-9][a-z0-9._-]{0,79}$/i;

// pure: a map with the user's keys replacing the shipped ones
export const mergeMaps = (base, over) => ({ ...(base && typeof base === 'object' ? base : {}), ...(over && typeof over === 'object' ? over : {}) });

// pure: the skill names switched on for a stage: "<recipe>/<stage>" wins over "<stage>"
export function pickSkills(map, recipeId, stageId) {
  const m = map || {};
  const list = m[`${recipeId}/${stageId}`] ?? m[stageId] ?? [];
  return [...new Set((Array.isArray(list) ? list : []).filter((n) => typeof n === 'string' && NAME.test(n)))];
}

// pure: a recipe as it may be used (id, name, stages with id and kind), or null
export function cleanRecipe(r, kinds) {
  if (!r || typeof r !== 'object' || !NAME.test(String(r.id || '')) || !Array.isArray(r.stages) || !r.stages.length) return null;
  const seen = new Set();
  for (const s of r.stages) {
    if (!s || !NAME.test(String(s.id || '')) || seen.has(s.id) || (kinds && !kinds[s.kind])) return null;
    seen.add(s.id);
  }
  return { ...r, name: r.name || r.id };
}

export function createCraft({ root, dataDir }) {
  const ship = path.join(root, 'craft'), mine = path.join(dataDir, 'craft');
  const sets = createSets({ ship, dataDir });

  function kinds() { return mergeMaps(readJson(path.join(ship, 'stages.json'), {}), readJson(path.join(mine, 'stages.json'), {})); }

  function recipes() {
    const k = kinds(), out = {};
    for (const dir of [ship, mine]) {
      let files = [];
      try { files = fs.readdirSync(path.join(dir, 'recipes')).filter((f) => f.endsWith('.json')); } catch {}
      for (const f of files) { const r = cleanRecipe(readJson(path.join(dir, 'recipes', f), null), Object.keys(k).length ? k : null); if (r) out[r.id] = r; }
    }
    return out;
  }
  const recipe = (id) => recipes()[id] || null;

  // the lists of a skill set (a project's `skillSet`; none or gone = the user's default set): the shipped mapping with the set's own on top
  function stageSkillMap(setId) { return sets.effective(sets.resolve(setId)); }

  // a skill's SKILL.md: the user's own first
  function skillFile(name) {
    if (!NAME.test(String(name || ''))) return null;
    for (const dir of [mine, ship]) { const f = path.join(dir, 'skills', name, 'SKILL.md'); if (fs.existsSync(f)) return f; }
    return null;
  }

  // the skills a stage reads: [{ name, file, about }] (a name with no SKILL.md is left out, with missing listed)
  function skillsFor(recipeId, stageId, setId, baseId) {
    const names = pickFor(sets.shippedLists(), sets.read(sets.resolve(setId))?.lists || {}, recipeId, stageId, baseId).skills.filter((n) => NAME.test(n));
    const skills = [], missing = [];
    for (const name of names) {
      const file = skillFile(name);
      if (!file) { missing.push(name); continue; }
      skills.push({ name, file, about: describe(readText(file) || '') });
    }
    return { skills, missing };
  }

  const firstText = (...files) => { for (const f of files) { const t = readText(f); if (t != null) return { text: t, file: f }; } return { text: '', file: null }; };
  const houseRules = () => firstText(path.join(mine, 'house-rules.md'), path.join(ship, 'house-rules.md'));
  const claudeMd = () => firstText(path.join(mine, 'CLAUDE.md'), path.join(ship, 'CLAUDE.md'));

  return { kinds, recipes, recipe, sets, stageSkillMap, skillFile, skillsFor, houseRules, claudeMd, ship, mine };
}

// pure: a skill's description from its frontmatter, else its first line of text
export function describe(md) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  const d = fm && /^description:\s*(.+)$/m.exec(fm[1]);
  if (d) return d[1].trim().replace(/^["']|["']$/g, '').slice(0, 300);
  const body = fm ? md.slice(fm[0].length) : md;
  return (body.split(/\r?\n/).map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean) || '').slice(0, 300);
}
