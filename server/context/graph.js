// The map the Context tab draws, pure (graph.test.js): from a scan to a column per stage of the recipe, the shared
// things each column reads (with a line to each), every item's size in words, who writes it, where it is kept and
// who reads it, and the lessons with their counts. No token counts and no prices, ever.
import { skillsFor } from './stage-skills.js';
import { parseLessons } from './lessons.js';
import { USER_KINDS } from './scan.js';

export const STUDIO = 'studio';
export const SHARED = ['claude', 'home', 'rules', 'brief']; // drawn once, under the columns

// who writes an item: 'you' | 'agent' | 'shipped', most active first
export function writersOf(it) {
  switch (it.kind) {
    case 'rules': return it.state === 'shipped' ? ['shipped', 'agent', 'you'] : ['agent', 'you'];
    case 'brief': return ['agent', 'you'];
    case 'home': return ['you'];
    case 'stage': return ['shipped'];
    default: return it.state === 'shipped' ? ['shipped'] : ['you'];
  }
}

// one column: the stage, its skills, and what else it reads (or writes)
function column(scan, st, firstAsk) {
  const agent = st.agent ?? !USER_KINDS.includes(st.kind);
  const col = { id: st.id, title: st.title, kind: st.kind, agent, skills: [], from: 'none', links: [], words: 0, ...(st.studio ? { studio: true } : {}) };
  if (!agent) return col;
  const pick = skillsFor(scan.shippedSkills, scan.mineSkills, scan.recipe.id, st.id);
  col.from = pick.from;
  col.skills = pick.skills.map((name) => {
    const it = scan.items['skill:' + name];
    return it ? { id: it.id, name, state: it.state, words: it.words } : { id: 'missing:' + name, name, state: 'missing', words: 0 };
  });
  const links = [['claude', 'reads'], ['home', 'reads'], ['rules', 'reads'], ['brief', st.kind === 'ask' && st.id === firstAsk ? 'writes' : 'reads'], ...(st.studio ? [] : [['stage:' + st.id, 'reads']])];
  col.links = links.filter(([id]) => scan.items[id]).map(([to, how]) => ({ to, how }));
  col.words = col.skills.reduce((a, s) => a + s.words, 0) + col.links.filter((l) => l.how === 'reads').reduce((a, l) => a + (scan.items[l.to].words || 0), 0);
  return col;
}

export function buildMap(scan) {
  const stages = scan.recipe?.stages || [];
  const firstAsk = stages.find((s) => s.kind === 'ask')?.id;
  // the Studio's own turns (plan, research, titles, thumbnails, upload) read skills in every recipe: one more column
  const studio = { id: STUDIO, title: 'Studio', kind: 'studio', agent: true, studio: true };
  const columns = scan.recipe ? [...stages.map((st) => column(scan, st, firstAsk)), column(scan, studio, firstAsk)] : [];
  const nodes = {};
  for (const it of Object.values(scan.items)) {
    nodes[it.id] = {
      id: it.id, kind: it.kind, label: it.label, description: it.description || '', words: it.words, kept: it.kept, state: it.state,
      editable: !!it.editable, canReset: !!it.canReset, canRemove: !!it.canRemove, why: it.why || '', mtime: it.mtime,
      writers: writersOf(it), readers: [], writes: [],
    };
  }
  for (const c of columns) {
    for (const s of c.skills) if (nodes[s.id]) nodes[s.id].readers.push(c.id);
    for (const l of c.links) nodes[l.to]?.[l.how === 'writes' ? 'writes' : 'readers'].push(c.id);
  }
  // a skill switched on nowhere in this recipe still shows in the library
  const library = Object.values(nodes).filter((n) => n.kind === 'skill').map((n) => n.id).sort();
  return {
    recipe: scan.recipe ? { id: scan.recipe.id, name: scan.recipe.name, about: scan.recipe.about } : null,
    recipes: scan.recipes, project: scan.project ? { id: scan.project.id, title: scan.project.title, recipe: scan.project.recipe, at: scan.project.at } : null,
    skillSet: scan.skillSet, sets: scan.setList,
    columns, shared: SHARED.filter((id) => nodes[id]), nodes, library,
    lessons: parseLessons(scan.items.rules?.text || ''),
  };
}
