import test from 'node:test';
import assert from 'node:assert/strict';
import { scan, shown, kindText } from './scan.js';
import { buildMap, writersOf } from './graph.js';
import { fixture } from './fixture.js';

test('the scan finds shipped items, the brief, the home file and the stage instructions', (t) => {
  const f = fixture(); t.after(f.done);
  const s = scan(f.o);
  assert.equal(s.recipe.id, 'edit'); // from the project
  assert.deepEqual(s.recipes.map((r) => r.id), ['edit', 'short']);
  assert.equal(s.items.claude.state, 'shipped');
  assert.equal(s.items.claude.kept, 'craft/CLAUDE.md');
  assert.equal(s.items.brief.kept, 'data/projects/p1/brief.md');
  assert.equal(s.items.brief.words, 6);
  assert.equal(s.items.home.kept, '~/.claude/CLAUDE.md');
  assert.equal(s.items.home.editable, false);
  assert.equal(s.items['stage:rough'].text, 'Make the files.\n\nCut the talk.');
  assert.equal(s.items['skill:alpha-skill'].description, 'The first fake skill.');
  assert.equal(scan({ ...f.o, recipeId: 'short' }).recipe.id, 'short');
  assert.equal(scan({ ...f.o, recipeId: '../x' }).recipe.id, 'edit'); // an unknown recipe id falls back
  assert.equal(scan({ ...f.o, projectId: '../p1' }).project, null);
});

test("the user's version wins, and a copy equal to the shipped one is still 'shipped'", (t) => {
  const f = fixture(); t.after(f.done);
  f.put('craft/CLAUDE.md', '# You are the editor\n\nMeasure then decide.\n', f.dataDir);
  assert.equal(scan(f.o).items.claude.state, 'shipped');
  f.put('craft/CLAUDE.md', '# Mine\n', f.dataDir);
  const s = scan(f.o);
  assert.equal(s.items.claude.state, 'changed');
  assert.equal(s.items.claude.kept, 'data/craft/CLAUDE.md');
  assert.equal(s.items.claude.canReset, true);
  f.put('craft/skills/own-skill/SKILL.md', '---\nname: own-skill\ndescription: Mine only.\n---\n', f.dataDir);
  const own = scan(f.o).items['skill:own-skill'];
  assert.equal(own.state, 'yours');
  assert.equal(own.canRemove, true);
});

test('the map: a column per stage, user stages without context, lines to shared things', (t) => {
  const f = fixture(); t.after(f.done);
  const m = buildMap(scan(f.o));
  assert.deepEqual(m.columns.map((c) => [c.id, c.agent]), [['ask', true], ['rough', true], ['rough-review', false], ['visuals', true], ['studio', true]]);
  const rough = m.columns[1];
  assert.deepEqual(rough.skills.map((s) => [s.name, s.state]), [['alpha-skill', 'shipped'], ['gone-skill', 'missing']]);
  assert.deepEqual(rough.links.map((l) => `${l.how}:${l.to}`), ['reads:claude', 'reads:home', 'reads:rules', 'reads:brief', 'reads:stage:rough']);
  assert.deepEqual(m.columns[0].links.find((l) => l.to === 'brief'), { to: 'brief', how: 'writes' });
  assert.deepEqual(m.columns[2].links, []);
  assert.deepEqual(m.shared, ['claude', 'home', 'rules', 'brief']);
  assert.deepEqual(m.nodes.brief.writes, ['ask']);
  assert.deepEqual(m.nodes.brief.readers, ['rough', 'visuals', 'studio']);
  assert.deepEqual(m.nodes.claude.readers, ['ask', 'rough', 'visuals', 'studio']);
  assert.deepEqual(m.nodes['skill:beta-skill'].readers, ['visuals']);
  assert.deepEqual(m.library, ['skill:alpha-skill', 'skill:beta-skill']);
  assert.equal(m.lessons.length, 1);
  assert.equal(m.lessons[0].kept, 1);
  // sizes in words, and no text, tokens or prices in the map
  const w = (id) => m.nodes[id].words;
  assert.equal(rough.words, w('skill:alpha-skill') + w('claude') + w('home') + w('rules') + w('brief') + w('stage:rough'));
  assert.equal(w('brief'), 6);
  assert.equal(w('stage:rough'), 6);
  const flat = JSON.stringify(m);
  assert.ok(!/token|cost|price|\$/i.test(flat.replace(/"description":"[^"]*"/g, '')));
  assert.ok(!('text' in m.nodes.claude));
});

test('writers in words the screen can show', () => {
  assert.deepEqual(writersOf({ kind: 'skill', state: 'shipped' }), ['shipped']);
  assert.deepEqual(writersOf({ kind: 'skill', state: 'changed' }), ['you']);
  assert.deepEqual(writersOf({ kind: 'rules', state: 'changed' }), ['agent', 'you']);
  assert.deepEqual(writersOf({ kind: 'brief' }), ['agent', 'you']);
});

test('a missing recipe folder gives an empty map, not an error', (t) => {
  const f = fixture(); t.after(f.done);
  const m = buildMap(scan({ ...f.o, root: f.base, projectId: null }));
  assert.equal(m.recipe, null);
  assert.deepEqual(m.columns, []);
});

test('helpers', () => {
  assert.equal(kindText({ kinds: { make: { text: 'x' } } }, 'make'), 'x');
  assert.equal(kindText({ make: { title: 'Make', instruction: 'y' } }, 'make'), 'y');
  assert.equal(kindText({ make: ['a', 'b'] }, 'make'), 'a\nb');
  assert.equal(kindText({}, 'make'), '');
  assert.equal(shown('/elsewhere/f.md', { root: '/app', home: '/hm/u' }), 'f.md');
});

test("a stage kind's `who` in stages.json decides whether the agent works there", (t) => {
  const f = fixture(); t.after(f.done);
  f.put('craft/stages.json', JSON.stringify({ ask: { who: 'agent', instruction: 'Ask.' }, make: { who: 'agent', instruction: 'Make.' }, gate: { who: 'agent', instruction: 'Odd.' } }));
  const m = buildMap(scan(f.o));
  assert.equal(m.columns.find((c) => c.id === 'rough-review').agent, true);
  assert.equal(m.nodes['stage:rough'].words, 4); // "Make." + "Cut the talk."
});

test("the user's own recipe replaces the shipped one with the same id", (t) => {
  const f = fixture(); t.after(f.done);
  f.put('craft/recipes/edit.json', JSON.stringify({ id: 'edit', name: 'My edit', stages: [{ id: 'rough', kind: 'make', title: 'Rough' }] }), f.dataDir);
  const s = scan(f.o);
  assert.equal(s.recipe.name, 'My edit');
  assert.deepEqual(s.recipes.map((r) => r.id), ['edit', 'short']);
});
