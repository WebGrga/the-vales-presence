// The shipped craft of part E is public: every skill has a valid header named like its folder, and no file holds a
// private path, an email, or a credit line borrowed from somewhere else.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { frontmatter } from './text.js';

const craft = new URL('../../craft/', import.meta.url);
const MINE = ['cut-dialogue-pass', 'cut-speed-waits', 'cut-fit-length', 'cut-punch-in', 'cut-frame-screen', 'edit-rough-handover', 'visuals-overlays', 'shorts-pick-moments', 'shorts-reframe-captions'];
const files = () => ['CLAUDE.md', 'house-rules.md', 'stage-skills.json', ...MINE.map((n) => `skills/${n}/SKILL.md`)];
const PRIVATE = /[A-Z]:[\\/]Users|\/home\/|\/Users\/|_props|\bVale\b|[\w.-]+@[\w-]+\.[a-z]{2,}|Adapted from|\(MIT\b/;

test('every shipped skill of part E has a header naming its folder and a description', () => {
  for (const n of MINE) {
    const { fields, body } = frontmatter(fs.readFileSync(new URL(`skills/${n}/SKILL.md`, craft), 'utf8'));
    assert.equal(fields.name, n);
    assert.ok(fields.description.length > 40, n);
    assert.ok(body.trim().length > 200, n);
  }
});

test('the craft holds no private path, email or borrowed credit', () => {
  for (const f of files()) assert.doesNotMatch(fs.readFileSync(new URL(f, craft), 'utf8'), PRIVATE, f);
});
