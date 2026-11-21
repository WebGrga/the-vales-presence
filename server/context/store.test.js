import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scan } from './scan.js';
import { readNode, saveNode, resetNode, newSkill, toggleSkill, resetStageSkills, countLesson, saveDraft, readDraft } from './store.js';
import { fixture } from './fixture.js';

const read = (f) => fs.readFileSync(f, 'utf8');

test('saving a shipped item writes the user copy in data/craft and never touches craft/', (t) => {
  const f = fixture(); t.after(f.done);
  const shipped = path.join(f.root, 'craft', 'CLAUDE.md'), before = read(shipped);
  const n = readNode(f.o, 'claude').node;
  const r = saveNode(f.o, { id: 'claude', text: '# Mine now\n', baseMtime: n.mtime });
  assert.equal(r.ok, true);
  assert.equal(r.node.state, 'changed');
  assert.equal(read(path.join(f.dataDir, 'craft', 'CLAUDE.md')), '# Mine now\n');
  assert.equal(read(shipped), before);
});

test('a save against an older file time is a conflict, unless forced', (t) => {
  const f = fixture(); t.after(f.done);
  const r = saveNode(f.o, { id: 'claude', text: 'x', baseMtime: 1 });
  assert.equal(r.conflict, true);
  assert.ok(r.text.includes('Measure'));
  assert.equal(saveNode(f.o, { id: 'claude', text: 'x', baseMtime: 1, force: true }).ok, true);
});

test("the day's first version is backed up once", (t) => {
  const f = fixture(); t.after(f.done);
  const o = { ...f.o, now: () => new Date('2026-11-20T10:00:00').getTime() };
  let m = readNode(o, 'brief').node.mtime;
  m = saveNode(o, { id: 'brief', text: 'second', baseMtime: m }).node.mtime;
  saveNode(o, { id: 'brief', text: 'third', baseMtime: m });
  const dir = path.join(f.dataDir, 'backups', '2026-11-20'), files = fs.readdirSync(dir);
  assert.equal(files.length, 1);
  assert.equal(read(path.join(dir, files[0])), 'A fake brief of six words.\n');
  assert.equal(read(path.join(f.dataDir, 'projects', 'p1', 'brief.md')), 'third');
});

test('ids, never paths: an unknown id or a read-only item is refused', (t) => {
  const f = fixture(); t.after(f.done);
  assert.ok(saveNode(f.o, { id: '../../etc/passwd', text: 'x' }).error);
  assert.ok(saveNode(f.o, { id: 'home', text: 'x' }).error);
  assert.ok(saveNode(f.o, { id: 'stage:rough', text: 'x' }).error);
  assert.ok(saveNode(f.o, { id: 'skill:alpha-skill', text: 'no header', baseMtime: readNode(f.o, 'skill:alpha-skill').node.mtime }).error);
  assert.ok(readNode(f.o, 'nope').error);
});

test('reset to default removes the user copy (backed up) and the shipped text is read again', (t) => {
  const f = fixture(); t.after(f.done);
  saveNode(f.o, { id: 'skill:alpha-skill', text: '---\nname: alpha-skill\ndescription: changed\n---\nnew', force: true });
  assert.equal(scan(f.o).items['skill:alpha-skill'].state, 'changed');
  assert.equal(resetNode(f.o, { id: 'skill:alpha-skill' }).ok, true);
  const it = scan(f.o).items['skill:alpha-skill'];
  assert.equal(it.state, 'shipped');
  assert.equal(it.description, 'The first fake skill.');
  assert.ok(resetNode(f.o, { id: 'skill:alpha-skill' }).error); // already shipped
  assert.ok(fs.readdirSync(path.join(f.dataDir, 'backups')).length);
});

test('a new skill is the user own, can be switched on for a stage, and removing it takes it off', (t) => {
  const f = fixture(); t.after(f.done);
  const r = newSkill(f.o, { name: 'My Way', description: 'How I like my cuts made.', text: 'Steps.', stage: 'rough' });
  assert.equal(r.id, 'skill:my-way');
  assert.ok(newSkill(f.o, { name: 'alpha-skill', description: 'A skill that already exists.' }).error);
  assert.ok(newSkill(f.o, { name: 'other-way', description: 'A stage that is not there.', stage: 'nope' }).error);
  let s = scan(f.o);
  assert.equal(s.items['skill:my-way'].state, 'yours');
  assert.deepEqual(s.mineSkills['edit/rough'], ['alpha-skill', 'gone-skill', 'my-way']);
  assert.equal(resetNode(f.o, { id: 'skill:my-way' }).removed, true);
  s = scan(f.o);
  assert.equal(s.items['skill:my-way'], undefined);
  assert.deepEqual(s.mineSkills['edit/rough'], ['alpha-skill', 'gone-skill']);
});

test('switching skills on and off per stage, and back to the shipped list', (t) => {
  const f = fixture(); t.after(f.done);
  assert.equal(toggleSkill(f.o, { stage: 'rough', skill: 'beta-skill', on: true }).ok, true);
  assert.equal(toggleSkill(f.o, { stage: 'rough', skill: 'gone-skill', on: false }).ok, true); // a missing one can go off
  assert.ok(toggleSkill(f.o, { stage: 'rough', skill: 'nope', on: true }).error);
  assert.ok(toggleSkill(f.o, { stage: 'nope', skill: 'beta-skill', on: true }).error);
  assert.deepEqual(scan(f.o).mineSkills, { 'edit/rough': ['alpha-skill', 'beta-skill'] });
  assert.equal(read(path.join(f.root, 'craft', 'stage-skills.json')).includes('beta-skill'), true); // shipped file unchanged
  assert.equal(resetStageSkills(f.o, { stage: 'rough' }).ok, true);
  assert.deepEqual(scan(f.o).mineSkills, {});
});

test('a lesson counted kept or against goes into the user copy of the book', (t) => {
  const f = fixture(); t.after(f.done);
  const r = countLesson(f.o, { lesson: 'L1', field: 'against' });
  assert.equal(r.lesson.against, 1);
  assert.match(read(path.join(f.dataDir, 'craft', 'house-rules.md')), /kept 1, against 1\)_/);
  assert.doesNotMatch(read(path.join(f.root, 'craft', 'house-rules.md')), /against 1/);
  assert.ok(countLesson(f.o, { lesson: 'L7', field: 'kept' }).error);
});

test('a draft is kept until the save, per project for the brief', (t) => {
  const f = fixture(); t.after(f.done);
  assert.equal(saveDraft(f.o, { id: 'brief', text: 'half typed', baseMtime: 5 }).ok, true);
  assert.equal(readNode(f.o, 'brief').draft.text, 'half typed');
  assert.equal(readNode({ ...f.o, projectId: null }, 'brief').draft, null);
  saveNode(f.o, { id: 'brief', text: 'done', force: true });
  assert.equal(readNode(f.o, 'brief').draft, null);
  assert.ok(saveDraft(f.o, { id: 'home', text: 'x' }).error);
});

test('the new-skill form is kept as a draft until the skill is made', (t) => {
  const f = fixture(); t.after(f.done);
  assert.equal(saveDraft(f.o, { id: 'new-skill', text: '{"name":"half"}' }).ok, true);
  assert.equal(readDraft(f.o, 'new-skill').draft.text, '{"name":"half"}');
  newSkill(f.o, { name: 'half-made', description: 'A skill from a kept form.' });
  assert.equal(readDraft(f.o, 'new-skill').draft, null);
});
