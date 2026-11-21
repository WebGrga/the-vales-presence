// The rules of skill sets: the old override migrates, a project reads its own set, the shipped Default is never written,
// import never overwrites unasked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from './fixture.js';
import { scan } from './scan.js';
import { createSets, listDiff } from './sets.js';
import { toggleSkill } from './store.js';
import { newSet, deleteSet, importBundle, exportBundle, duplicateSkill, resetSet, useSet } from './set-store.js';
import { createCraft } from '../craft.js';
import { studioNote } from '../prompt.js';

const names = (c, set, recipe = 'edit', stage = 'rough') => c.skillsFor(recipe, stage, set).skills.map((s) => s.name);

test('the old single override file becomes the set "My set" and still counts', (t) => {
  const f = fixture(); t.after(f.done);
  const legacy = path.join(f.dataDir, 'craft', 'stage-skills.json');
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, JSON.stringify({ about: 'x', rough: ['beta-skill'] }));
  const c = createCraft({ root: f.root, dataDir: f.dataDir });
  assert.deepEqual(c.sets.all().map((s) => s.name), ['Default', 'My set']);
  assert.equal(c.sets.defaultId(), 'my-set');
  assert.deepEqual(names(c), ['beta-skill']);
  assert.deepEqual(names(c, 'default'), ['alpha-skill']);
  assert.ok(fs.existsSync(legacy), 'the old file is left where it was');
});

test('a project reads its own set; a gone set falls back to the default', (t) => {
  const f = fixture(); t.after(f.done);
  const sets = createSets({ ship: path.join(f.root, 'craft'), dataDir: f.dataDir });
  const mine = sets.create('Mine', { rough: ['beta-skill'] });
  const c = createCraft({ root: f.root, dataDir: f.dataDir });
  assert.deepEqual(names(c, mine.id), ['beta-skill']);
  assert.deepEqual(names(c, undefined), ['alpha-skill']);
  assert.deepEqual(names(c, 'vanished'), ['alpha-skill']);
  assert.deepEqual(names(c, mine.id, 'edit', 'studio'), []);
});

test('toggling on the shipped Default makes a set and never writes craft/', (t) => {
  const f = fixture(); t.after(f.done);
  const shipped = fs.readFileSync(path.join(f.root, 'craft', 'stage-skills.json'), 'utf8');
  const r = toggleSkill(f.o, { stage: 'rough', skill: 'beta-skill', on: true });
  assert.equal(r.ok, true);
  assert.equal(r.forked.name, 'My set');
  assert.equal(fs.readFileSync(path.join(f.root, 'craft', 'stage-skills.json'), 'utf8'), shipped);
  const s = scan(f.o);
  assert.equal(s.skillSet.id, 'my-set');
  assert.equal(s.skillSet.builtin, false);
  assert.deepEqual(s.mineSkills['edit/rough'], ['alpha-skill', 'gone-skill', 'beta-skill']);
  assert.equal(toggleSkill(f.o, { stage: 'rough', skill: 'beta-skill', on: false }).forked, null); // the next change goes into the same set
});

test('a project with its own set is changed alone; usage is counted; a deleted set falls back', (t) => {
  const f = fixture(); t.after(f.done);
  f.put('projects/p2/project.json', JSON.stringify({ id: 'p2', title: 'Two', recipe: 'edit' }), f.dataDir);
  const a = newSet(f.o, { name: 'Alpha' }).set;
  assert.equal(useSet(f.o, { project: 'p1', set: a }).ok, true);
  toggleSkill(f.o, { stage: 'visuals', skill: 'alpha-skill', on: true });
  const sets = createSets({ ship: path.join(f.root, 'craft'), dataDir: f.dataDir });
  assert.deepEqual(sets.read(a).lists['edit/visuals'], ['beta-skill', 'alpha-skill']);
  assert.equal(sets.usage()[a], 1);
  assert.equal(sets.usage().default, 1); // p2 follows the user's default, the shipped one
  assert.ok(newSet(f.o, { name: 'alpha' }).error, 'a taken name is refused');
  assert.equal(deleteSet(f.o, { set: a }).projects, 1);
  assert.equal(scan(f.o).skillSet.id, 'default');
  assert.ok(deleteSet(f.o, { set: 'default' }).error);
});

test('Back to defaults empties a set; the diff names what changed', (t) => {
  const f = fixture(); t.after(f.done);
  toggleSkill(f.o, { stage: 'rough', skill: 'alpha-skill', on: false });
  const s = scan(f.o);
  assert.deepEqual(listDiff(s.shippedSkills, s.mineSkills).map((d) => [d.key, d.removed]), [['edit/rough', ['alpha-skill']]]);
  assert.equal(resetSet(f.o, {}).ok, true);
  assert.deepEqual(listDiff(scan(f.o).shippedSkills, scan(f.o).mineSkills), []);
  assert.ok(resetSet(f.o, { set: 'default' }).error);
});

test('duplicate a skill leaves the original; import never overwrites unasked', (t) => {
  const f = fixture(); t.after(f.done);
  assert.equal(duplicateSkill(f.o, { skill: 'alpha-skill', name: 'alpha-two' }).ok, true);
  assert.match(scan(f.o).items['skill:alpha-two'].text, /name: alpha-two/);
  assert.equal(scan(f.o).items['skill:alpha-skill'].state, 'shipped');
  assert.ok(duplicateSkill(f.o, { skill: 'alpha-skill', name: 'alpha-two' }).error);
  assert.ok(duplicateSkill(f.o, { skill: 'alpha-skill', name: 'x' }).error);

  const ex = exportBundle(f.o, { kind: 'skill', id: 'alpha-two' });
  assert.equal(importBundle(f.o, { bundle: ex.bundle }).ok, true); // identical: nothing to ask, nothing written
  const changed = JSON.parse(JSON.stringify(ex.bundle));
  changed.skills[0].text += '\nmore\n';
  const ask = importBundle(f.o, { bundle: changed });
  assert.deepEqual([ask.conflict, ask.skills], [true, ['alpha-two']]);
  assert.doesNotMatch(scan(f.o).items['skill:alpha-two'].text, /more/);
  const keep = importBundle(f.o, { bundle: changed, mode: 'keep' });
  assert.deepEqual(keep.renamed, { 'alpha-two': 'alpha-two-2' });
  assert.match(scan(f.o).items['skill:alpha-two-2'].text, /name: alpha-two-2/);
  assert.equal(importBundle(f.o, { bundle: changed, mode: 'replace' }).ok, true);
  assert.match(scan(f.o).items['skill:alpha-two'].text, /more/);
});

test('a set travels with its own skills; bad files are refused in words', (t) => {
  const f = fixture(); t.after(f.done);
  duplicateSkill(f.o, { skill: 'alpha-skill', name: 'alpha-two' });
  toggleSkill(f.o, { stage: 'visuals', skill: 'alpha-two', on: true });
  const ex = exportBundle(f.o, { kind: 'set', id: 'my-set' });
  assert.deepEqual(ex.bundle.skills.map((s) => s.name), ['alpha-two']);
  const g = fixture(); t.after(g.done);
  assert.equal(importBundle(g.o, { bundle: ex.bundle }).ok, true);
  assert.ok(scan(g.o).items['skill:alpha-two']);
  assert.equal(importBundle(g.o, { bundle: ex.bundle }).conflict, true); // the set name is taken: asked first
  const head = { format: 'presence-craft', version: 1, kind: 'skill' };
  for (const bad of [null, [], { format: 'nope' }, { ...head, skills: [{ name: '../x', text: 'a' }] }, { ...head, skills: [{ name: 'abc', text: 'no header' }] }]) {
    assert.ok(importBundle(g.o, { bundle: bad }).error);
  }
});

test('a plain turn at a Studio stage names the Studio skills', () => {
  assert.equal(studioNote([]), '');
  assert.match(studioNote([{ name: 'title-options', file: '/x/SKILL.md' }]), /title-options: \/x\/SKILL.md/);
});
