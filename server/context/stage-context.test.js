import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { stageContext, houseRulesFile, claudeMd, promptText } from './stage-context.js';
import { toggleSkill } from './store.js';
import { fixture } from './fixture.js';

test('a stage gets its skills, the house rules it writes into, and the brief', (t) => {
  const f = fixture(); t.after(f.done);
  const c = stageContext({ ...f.o, recipe: 'edit', stage: 'rough' });
  assert.deepEqual(c.skills.map((s) => s.name), ['alpha-skill']);
  assert.equal(c.skills[0].file, path.join(f.root, 'craft', 'skills', 'alpha-skill', 'SKILL.md'));
  assert.deepEqual(c.missing, ['gone-skill']);
  assert.equal(c.houseRules.file, path.join(f.dataDir, 'craft', 'house-rules.md'));
  assert.ok(fs.existsSync(c.houseRules.file)); // made from the shipped starter
  assert.equal(c.brief, path.join(f.dataDir, 'projects', 'p1', 'brief.md'));
  assert.match(c.text, /## Your skills for this stage/);
  assert.match(c.text, /Keep air before a reveal/);
  assert.match(c.claudeMd.text, /Measure then decide/);
});

test("the user's switches and versions are what the stage reads", (t) => {
  const f = fixture(); t.after(f.done);
  toggleSkill(f.o, { stage: 'rough', skill: 'beta-skill', on: true });
  f.put('craft/skills/beta-skill/SKILL.md', '---\nname: beta-skill\ndescription: Mine.\n---\n', f.dataDir);
  f.put('craft/CLAUDE.md', '# My orders\n', f.dataDir);
  const c = stageContext({ ...f.o, recipe: 'edit', stage: 'rough' });
  assert.deepEqual(c.skills.map((s) => [s.name, s.description]), [['alpha-skill', 'The first fake skill.'], ['beta-skill', 'Mine.']]);
  assert.equal(c.skills[1].file, path.join(f.dataDir, 'craft', 'skills', 'beta-skill', 'SKILL.md'));
  assert.equal(claudeMd(f.o).text, '# My orders\n');
});

test('the preview does not make the house rules file; the stage does, once', (t) => {
  const f = fixture(); t.after(f.done);
  const file = path.join(f.dataDir, 'craft', 'house-rules.md');
  stageContext({ ...f.o, recipe: 'edit', stage: 'rough', create: false });
  assert.equal(fs.existsSync(file), false);
  assert.equal(houseRulesFile(f.o), file);
  fs.writeFileSync(file, 'mine');
  houseRulesFile(f.o);
  assert.equal(fs.readFileSync(file, 'utf8'), 'mine'); // never overwritten
});

test('prompt text without skills or brief', () => {
  const t = promptText({ skills: [], rules: { file: 'r.md', text: '' }, brief: null });
  assert.doesNotMatch(t, /skills/);
  assert.match(t, /\(empty\)/);
});

// the agent's side (server/craft.js, part B) and the Context room must agree on what a stage reads
test('the Context room and the agent read the same skills and the same CLAUDE.md', async (t) => {
  let craft;
  try { craft = await import('../craft.js'); } catch { t.skip('server/craft.js is not there'); return; }
  const f = fixture(); t.after(f.done);
  toggleSkill(f.o, { stage: 'visuals', skill: 'alpha-skill', on: true });
  f.put('craft/CLAUDE.md', '# My orders\n', f.dataDir);
  const agent = craft.createCraft({ root: f.root, dataDir: f.dataDir });
  for (const [recipe, stage] of [['edit', 'rough'], ['edit', 'visuals'], ['short', 'rough'], ['edit', 'ask']]) {
    const mine = stageContext({ ...f.o, recipe, stage, create: false });
    const theirs = agent.skillsFor(recipe, stage);
    assert.deepEqual(theirs.skills.map((s) => [s.name, s.file]), mine.skills.map((s) => [s.name, s.file]), `${recipe}/${stage}`);
    assert.deepEqual(theirs.missing, mine.missing);
  }
  assert.equal(agent.claudeMd().text, claudeMd(f.o).text);
});
