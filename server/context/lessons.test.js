import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLessons, bump, toReview, lessonsText } from './lessons.js';

const BOOK = [
  '# House rules', '', '## How we cut', '', '- Not a lesson.', '',
  '## Lessons', '', '*How lessons are written (an explanation, not a lesson).*', '',
  '- Keep air before a reveal. _(2026-11-02; evidence: three pauses restored; kept 3, against 1)_',
  '  - a sub point, not a lesson',
  '- **Never** zoom on a face mid-word. _(2026-11-05; evidence: a zoom cut a word; kept 0, against 2)_',
  '- A lesson with no meta yet',
  '', '## After', '- not a lesson either',
].join('\n');

test('lessons are the top-level items of the Lessons section, with date, evidence and counts', () => {
  const l = parseLessons(BOOK);
  assert.equal(l.length, 3);
  assert.deepEqual(l.map((x) => x.id), ['L1', 'L2', 'L3']);
  assert.equal(l[0].text, 'Keep air before a reveal.');
  assert.equal(l[0].date, '2026-11-02');
  assert.equal(l[0].evidence, 'three pauses restored');
  assert.deepEqual([l[0].kept, l[0].against], [3, 1]);
  assert.equal(l[1].text, 'Never zoom on a face mid-word.');
  assert.equal(l[1].review, true);
  assert.deepEqual([l[2].kept, l[2].against, l[2].date], [0, 0, '']);
  assert.deepEqual(parseLessons('# nothing'), []);
});

test('the shipped starter book has no lessons yet', async () => {
  const fs = await import('node:fs');
  const md = fs.readFileSync(new URL('../../craft/house-rules.md', import.meta.url), 'utf8');
  assert.deepEqual(parseLessons(md), []);
  for (const h of ['## How we cut', '## Tools we use', '## Lessons']) assert.ok(md.includes(h), h);
});

test('bump adds one to a count and leaves every other byte', () => {
  const r = bump(BOOK, 'L1', 'kept');
  assert.equal(r.lesson.kept, 4);
  const a = BOOK.split('\n'), b = r.md.split('\n');
  assert.equal(b.length, a.length);
  assert.equal(b[10], '- Keep air before a reveal. _(2026-11-02; evidence: three pauses restored; kept 4, against 1)_');
  for (let i = 0; i < a.length; i++) if (i !== 10) assert.equal(b[i], a[i]);
});

test('bump on a lesson with no meta gives it a date and counts', () => {
  const r = bump(BOOK, 'L3', 'against');
  assert.match(r.md.split('\n')[13], /^- A lesson with no meta yet _\(\d{4}-\d{2}-\d{2}; kept 0, against 1\)_$/);
});

test('bump keeps CRLF files CRLF and refuses unknown lessons or fields', () => {
  const crlf = BOOK.replace(/\n/g, '\r\n');
  assert.ok(bump(crlf, 'L2', 'kept').md.includes('\r\n'));
  assert.ok(bump(BOOK, 'L9', 'kept').error);
  assert.ok(bump(BOOK, 'L1', 'liked').error);
});

test('lessons judged wrong twice and more than kept are up for review', () => {
  assert.deepEqual(toReview(parseLessons(BOOK)).map((l) => l.id), ['L2']);
  assert.match(lessonsText(parseLessons(BOOK)), /L1: Keep air before a reveal\. \(2026-11-02\) \[kept 3, against 1\]/);
});
