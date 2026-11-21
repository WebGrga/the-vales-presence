// A small fake app folder for the Context room's tests: craft/ with two skills, a recipe and stage kinds, a data/
// folder with one project, and a home folder. Only fake words: never real footage text.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'presence-context-'));
  const root = path.join(base, 'app'), dataDir = path.join(root, 'data'), home = path.join(base, 'home');
  const put = (rel, text, at = root) => { const f = path.join(at, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
  put('craft/CLAUDE.md', '# You are the editor\n\nMeasure then decide.\n');
  put('craft/house-rules.md', '# House rules\n\n## How we cut\n\n## Tools we use\n\n## Lessons\n\n- Keep air before a reveal. _(2026-11-02; evidence: pauses restored; kept 1, against 0)_\n');
  put('craft/skills/alpha-skill/SKILL.md', '---\nname: alpha-skill\ndescription: The first fake skill.\n---\n\none two three four\n');
  put('craft/skills/beta-skill/SKILL.md', '---\nname: beta-skill\ndescription: The second fake skill.\n---\n\nfive six\n');
  put('craft/stage-skills.json', JSON.stringify({ about: 'fake', rough: ['alpha-skill', 'gone-skill'], visuals: ['beta-skill'] }));
  put('craft/stages.json', JSON.stringify({ kinds: { ask: 'Ask what you need.', make: 'Make the files.', gate: 'The user decides.' } }));
  put('craft/recipes/edit.json', JSON.stringify({ id: 'edit', name: 'Edit', stages: [
    { id: 'ask', kind: 'ask', title: 'Ask' }, { id: 'rough', kind: 'make', title: 'Rough cut', focus: 'Cut the talk.' },
    { id: 'rough-review', kind: 'gate', title: 'Rough review' }, { id: 'visuals', kind: 'make', title: 'Visuals' },
  ] }));
  put('craft/recipes/short.json', JSON.stringify({ id: 'short', name: 'Short', stages: [{ id: 'rough', kind: 'make', title: 'Rough' }] }));
  put('projects/p1/project.json', JSON.stringify({ id: 'p1', title: 'Fake project', recipe: 'edit', at: 'rough' }), dataDir);
  put('projects/p1/brief.md', 'A fake brief of six words.\n', dataDir);
  put('.claude/CLAUDE.md', 'My own setup.\n', home);
  return { base, root, dataDir, home, put, o: { root, dataDir, home, projectId: 'p1' }, done: () => fs.rmSync(base, { recursive: true, force: true }) };
}
