// Which skills a stage reads, pure (stage-skills.test.js). `shipped` is craft/stage-skills.json, `mine` is
// data/craft/stage-skills.json; both are flat maps { "<stage>" | "<recipe>/<stage>": [skill names], "about"?: "..." }
// (the shape server/craft.js reads: the user's keys replace the shipped ones).
// Lookup: mine[recipe/stage], mine[stage], shipped[recipe/stage], shipped[stage], else none.
// The user's change to one stage of one recipe is written as mine[recipe/stage] (the whole list), so it touches
// nothing else; "reset" deletes that key.

const isObj = (d) => d && typeof d === 'object' && !Array.isArray(d);
// the lists of a doc (an older nested { stages: {...} } is read too)
export const listOf = (doc) => {
  const src = isObj(doc?.stages) ? doc.stages : isObj(doc) ? doc : {};
  return Object.fromEntries(Object.entries(src).filter(([, v]) => Array.isArray(v)));
};
const clean = (a) => [...new Set((Array.isArray(a) ? a : []).map(String).filter(Boolean))];
export const keyOf = (recipe, stage) => `${recipe}/${stage}`;
// the user's doc written back flat, keeping a note like "about"
const flat = (mine, lists) => ({ ...(isObj(mine) && typeof mine.about === 'string' ? { about: mine.about } : {}), ...lists });

// { skills, from: 'yours'|'shipped'|'none', key }
export function skillsFor(shipped, mine, recipe, stage) {
  const m = listOf(mine), s = listOf(shipped);
  for (const [doc, from] of [[m, 'yours'], [s, 'shipped']]) {
    for (const key of [keyOf(recipe, stage), stage]) {
      if (Array.isArray(doc[key])) return { skills: clean(doc[key]), from, key };
    }
  }
  return { skills: [], from: 'none', key: null };
}

// switch one skill on or off for one stage of one recipe -> the new `mine`
export function toggle(shipped, mine, recipe, stage, skill, on) {
  const cur = skillsFor(shipped, mine, recipe, stage).skills;
  const next = on ? (cur.includes(skill) ? cur : [...cur, skill]) : cur.filter((x) => x !== skill);
  return flat(mine, { ...listOf(mine), [keyOf(recipe, stage)]: next });
}

// back to the shipped list for this stage of this recipe
export function resetStage(mine, recipe, stage) {
  const st = listOf(mine);
  delete st[keyOf(recipe, stage)];
  return flat(mine, st);
}

// a skill that is gone (removed or reset away) comes off every list of the user's
export function dropSkill(mine, skill) {
  const st = {};
  for (const [k, v] of Object.entries(listOf(mine))) st[k] = clean(v).filter((x) => x !== skill);
  return flat(mine, st);
}

// the stages of a recipe that name a skill (for "who reads it")
export function stagesWithSkill(shipped, mine, recipe, stageIds, skill) {
  return stageIds.filter((st) => skillsFor(shipped, mine, recipe, st).skills.includes(skill));
}
