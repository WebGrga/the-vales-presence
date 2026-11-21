import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMark, lessonFor, withLesson, withoutLesson, betState, applyBet, cleanBet, uploadedAt, WEEK } from './package-data.js';

const book = '# House rules\n\n## Lessons\n\n- Old one. _(2026-01-01; evidence: x; kept 2, against 0)_\n\n## Tools we use\n\n- A tool.\n';

test('a Missed why with words leaves a lesson, without words it leaves none', () => {
  let r = applyMark({}, { key: 't1+a', kind: 'ours', title: 'My title', why: 'missed' });
  assert.equal(r.lessonIn, undefined);
  r = applyMark(r.marks, { key: 't1+a', words: 'I could not tell it was about editing' });
  assert.match(r.lessonIn, /could not tell it was about editing/);
  assert.equal(r.marks['t1+a'].lesson, r.lessonIn);
});

test('changing the words or the mark takes the old lesson back', () => {
  let r = applyMark({}, { key: 'k', kind: 'real', title: 'Big hit', why: 'missed', words: 'no idea' });
  const first = r.lessonIn;
  r = applyMark(r.marks, { key: 'k', words: 'the number meant nothing' });
  assert.equal(r.lessonOut, first);
  assert.match(r.lessonIn, /number meant nothing/);
  const second = r.lessonIn;
  r = applyMark(r.marks, { key: 'k', why: 'got' });
  assert.equal(r.lessonOut, second);
  assert.equal(r.lessonIn, undefined);
  r = applyMark(r.marks, { key: 'k', why: null, like: false });
  assert.deepEqual(r.marks, {});
});

test('like and why are separate, a mark with neither is gone', () => {
  let r = applyMark({}, { key: 'k', kind: 'ours', title: 'T', like: true });
  assert.equal(r.marks.k.like, true);
  r = applyMark(r.marks, { key: 'k', why: 'got' });
  assert.deepEqual([r.marks.k.like, r.marks.k.why], [true, 'got']);
  assert.ok(applyMark({}, { key: '../x' }).error);
});

test('the lesson goes at the end of the Lessons section, once, and comes out again only while unjudged', () => {
  const text = lessonFor({ kind: 'ours', title: 'T', words: 'unclear' });
  const a = withLesson(book, text, '2026-11-21');
  assert.ok(a.indexOf(text) > a.indexOf('Old one') && a.indexOf(text) < a.indexOf('## Tools'));
  assert.equal(withLesson(a, text, '2026-11-22'), a);
  assert.equal(withoutLesson(a, text), book);
  const counted = a.replace('kept 0, against 0', 'kept 1, against 0');
  assert.equal(withoutLesson(counted, text), counted);
  assert.match(withLesson('# R\n', text, '2026-11-21'), /## Lessons/);
});

test('the bet: a week after the last real upload, then a result', () => {
  const bet = applyBet(null, { metric: 'views48', direction: 'above', median: '1200' }, new Date('2026-11-01T10:00:00Z'));
  assert.equal(bet.madeAt, '2026-11-01T10:00:00.000Z');
  const up = uploadedAt([{ at: '2026-11-02T00:00:00Z', dry: true }, { at: '2026-11-03T00:00:00Z' }, { at: '2026-11-01T00:00:00Z' }]);
  assert.equal(up, '2026-11-03T00:00:00Z');
  const t = Date.parse(up);
  assert.equal(betState(bet, null).phase, 'none');
  assert.equal(betState(bet, up, t + 2 * 86400e3).phase, 'waiting');
  assert.equal(betState(bet, up, t + 2 * 86400e3).days, 5);
  assert.equal(betState(bet, up, t + WEEK).phase, 'due');
  const done = applyBet(bet, { result: { text: 'It reached 1500, above.' } }, new Date('2026-11-11T00:00:00Z'));
  assert.equal(betState(done, up, t + WEEK).phase, 'done');
  assert.equal(applyBet(done, { note: 'changed' }).result.text, 'It reached 1500, above.');
  assert.equal(cleanBet({ metric: 'bogus' }).metric, 'ctr');
  assert.equal(betState(null, up).phase, 'none');
});
