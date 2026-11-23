import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { formatOf, formatsOf, canChoose, recipeFor, skillRecipe, parseFormatFile } from './format.js';
import { tabsFor } from './recipe-tabs.js';
import { stagePrompt } from '../../server/prompt.js';
import { skillsForFormat } from '../../server/context/stage-skills.js';
import { whyNotFormat } from '../../server/project-format.js';

const video = JSON.parse(fs.readFileSync(new URL('../../craft/recipes/video.json', import.meta.url), 'utf8'));
const edit = { id: 'edit', format: 'long', stages: [{ id: 'rough', kind: 'make', focus: 'x' }] };

test('a project format wins when the recipe can be either, else the recipe format', () => {
  assert.equal(formatOf({}, video), 'long');
  assert.equal(formatOf({ format: 'short' }, video), 'short');
  assert.equal(formatOf({ format: 'short' }, edit), 'long'); // a one-format recipe ignores it
  assert.equal(formatOf({ format: 'weird' }, video), 'long');
  assert.deepEqual(formatsOf(video), ['long', 'short']);
  assert.ok(canChoose(video) && !canChoose(edit));
});

test('a Short of the idea recipe gets the Short stage lines, a long video keeps its own', () => {
  const s = recipeFor(video, { format: 'short' }), l = recipeFor(video, {});
  const f = (r, id) => r.stages.find((x) => x.id === id).focus;
  assert.equal(s.format, 'short');
  assert.match(f(s, 'rough'), /1080x1920/); assert.match(f(s, 'visuals'), /Events\.for_cut\(cut, "short"\)/); assert.match(f(s, 'visuals'), /captions/i);
  assert.match(f(s, 'plan'), /60 seconds/);
  assert.match(f(l, 'rough'), /studio\/plan\.md/); assert.doesNotMatch(f(l, 'rough'), /1080x1920/);
  assert.equal(l.format, 'long');
  assert.equal(recipeFor(edit, {}).stages[0].focus, 'x');
});

test('the ask stage tells the agent to state the format', () => {
  assert.match(video.stages[0].focus, /\.presence\/format/);
});

test('tabs follow the project format: a Short has no Shorts-from-this-edit tab', () => {
  assert.ok(tabsFor(recipeFor(video, {})).has('shorts'));
  assert.ok(!tabsFor(recipeFor(video, { format: 'short' })).has('shorts'));
});

test('the stage prompt says the format and carries the stage focus for it', () => {
  const kind = { title: 'Make', instruction: 'do' };
  const mk = (p) => { const r = recipeFor(video, p); const st = r.stages.find((x) => x.id === 'rough'); return stagePrompt({ recipe: r, stage: st, index: 5, kind, projectDir: 'C:\p', root: 'C:\r', skills: [] }); };
  const s = mk({ format: 'short' }), l = mk({});
  assert.match(s, /Format of this project: a YouTube Short, vertical 9:16, 1080x1920/); assert.match(s, /9:16 rough cut/);
  assert.match(l, /long video, horizontal 16:9/); assert.match(l, /no captions/); assert.doesNotMatch(l, /9:16 rough cut/);
});

test('skills: a Short of a two-format recipe reads <recipe>-short first, else the recipe, else the stage', () => {
  const shipped = JSON.parse(fs.readFileSync(new URL('../../craft/stage-skills.json', import.meta.url), 'utf8'));
  const sr = skillRecipe(recipeFor(video, { format: 'short' })), lr = skillRecipe(recipeFor(video, {}));
  assert.equal(sr, 'video-short'); assert.equal(lr, 'video'); assert.equal(skillRecipe(edit), 'edit');
  assert.ok(skillsForFormat(shipped, {}, sr, 'rough', 'video').skills.includes('shorts-reframe-captions'));
  assert.ok(skillsForFormat(shipped, {}, sr, 'plan', 'video').skills.includes('plan-video'));
  assert.ok(!skillsForFormat(shipped, {}, lr, 'rough', 'video').skills.includes('shorts-reframe-captions'));
  assert.deepEqual(skillsForFormat(shipped, { 'video-short/rough': ['mine'] }, sr, 'rough', 'video').skills, ['mine']);
});

test('the file the agent writes', () => {
  assert.equal(parseFormatFile('format: short\n'), 'short');
  assert.equal(parseFormatFile('Format = Long'), 'long');
  assert.equal(parseFormatFile('short'), 'short');
  assert.equal(parseFormatFile('maybe short?'), null);
  assert.equal(parseFormatFile(''), null);
});

test('the format cannot change for a one-format recipe or once the rough is locked', () => {
  assert.equal(whyNotFormat({ stages: {} }, video, {}, 'short'), '');
  assert.match(whyNotFormat({ stages: {} }, edit, {}, 'short'), /always a long video/);
  assert.match(whyNotFormat({ stages: {} }, video, { 'video/out/edl.json': {} }, 'short'), /locked/);
  assert.match(whyNotFormat({ stages: { 'rough-review': { status: 'done' } } }, video, {}, 'short'), /locked/);
  assert.match(whyNotFormat({ stages: {} }, video, {}, 'wide'), /long" or "short/);
});
