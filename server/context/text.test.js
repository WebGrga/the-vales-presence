import test from 'node:test';
import assert from 'node:assert/strict';
import { wordCount, frontmatter, checkName, newSkillText, checkText } from './text.js';

test('words are counted on whitespace, never tokens', () => {
  assert.equal(wordCount(''), 0);
  assert.equal(wordCount(null), 0);
  assert.equal(wordCount('one two\nthree\t four '), 4);
});

test('frontmatter is read with quotes taken off, and the body follows it', () => {
  const f = frontmatter('---\nname: a-skill\ndescription: "Does a thing: well"\n---\n\n# Body\n');
  assert.deepEqual(f.fields, { name: 'a-skill', description: 'Does a thing: well' });
  assert.equal(f.body.trim(), '# Body');
  assert.deepEqual(frontmatter('no header').fields, {});
});

test('a skill name is a short dashed slug', () => {
  assert.equal(checkName('My Cut Way').name, 'my-cut-way');
  assert.ok(checkName('').error);
  assert.ok(checkName('a').error);
  assert.ok(checkName('../evil').error);
  assert.ok(checkName('x'.repeat(70)).error);
});

test('a new skill gets a valid header and keeps its text', () => {
  const r = newSkillText({ name: 'tight-cuts', description: 'Cut tight: no breath over a third of a second.', text: '# Tight\n\nSteps.' });
  assert.equal(r.name, 'tight-cuts');
  const f = frontmatter(r.text);
  assert.equal(f.fields.name, 'tight-cuts');
  assert.equal(f.fields.description, 'Cut tight: no breath over a third of a second.');
  assert.match(f.body, /# Tight/);
});

test('a pasted skill has its own header replaced, and an empty text gets a starter', () => {
  const r = newSkillText({ name: 'pasted', description: 'A pasted skill with its own header.', text: '---\nname: other\ndescription: x\n---\nBody here' });
  assert.equal(frontmatter(r.text).fields.name, 'pasted');
  assert.equal(frontmatter(r.text).body.trim(), 'Body here');
  assert.match(newSkillText({ name: 'empty-one', description: 'Nothing written yet here.' }).text, /# empty-one/);
  assert.ok(newSkillText({ name: 'short-desc', description: 'tiny' }).error);
});

test('a saved skill must keep its header; other texts only have a size limit', () => {
  assert.ok(checkText('skill', '# no header'));
  assert.equal(checkText('skill', '---\nname: a\ndescription: b\n---\n'), null);
  assert.equal(checkText('rules', 'anything'), null);
  assert.ok(checkText('rules', 5));
  assert.ok(checkText('rules', 'x'.repeat(200_001)));
});
