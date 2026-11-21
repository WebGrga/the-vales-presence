import test from 'node:test';
import assert from 'node:assert/strict';
import { stamp, titleFrom, candidates, draft, tidy, chapters, countFor } from './chapters.js';

// a fake talk: a sentence every 6 s, a long pause before every fifth
function talk(seconds) {
  const words = [];
  for (let t = 0, n = 0; t < seconds - 5; t += 6, n++) {
    const s = t + (n % 5 === 0 && n ? 1.2 : 0);
    words.push([s, s + 0.3, 'So,'], [s + 0.4, s + 0.7, `topic${n}`], [s + 0.8, s + 1.1, 'is'], [s + 1.2, s + 1.6, 'here.']);
  }
  return words;
}

test('time stamps', () => {
  assert.equal(stamp(0), '0:00');
  assert.equal(stamp(75.9), '1:15');
  assert.equal(stamp(3725), '1:02:05');
});

test('a title from a sentence: no fillers in front, stops at the full stop', () => {
  const w = [[0, 1, 'So,'], [1, 2, 'um'], [2, 3, 'the'], [3, 4, 'map'], [4, 5, 'room.'], [5, 6, 'Next']];
  assert.equal(titleFrom(w, 0), 'The map room');
  assert.equal(titleFrom(w, 5), 'Next');
});

test('candidates are sentence starts after a pause', () => {
  const w = [[0, 1, 'One.'], [1.05, 2, 'two'], [2, 3, 'three.'], [3.6, 4, 'Four']];
  assert.deepEqual(candidates(w).map((c) => c.i), [3]);
  assert.ok(candidates(w, [3.7])[0].score > candidates(w)[0].score);
});

test('how many chapters', () => {
  assert.equal(countFor(20), 0);
  assert.equal(countFor(100), 3);
  assert.equal(countFor(600), 7);
  assert.equal(countFor(5 * 3600), 12);
});

test('a draft: starts at 0:00, at least 10 s apart, titled from the words', () => {
  const words = talk(300);
  const d = draft({ duration: 300, words });
  assert.equal(d[0].at, 0);
  assert.ok(d.length >= 3);
  for (let i = 1; i < d.length; i++) assert.ok(d[i].at - d[i - 1].at >= 10);
  assert.match(d[1].title, /^Topic\d+ is here$/);
});

test('tidy: sorted, first at 0, short ones dropped, too few means none', () => {
  const t = tidy([{ at: 40, title: 'B' }, { at: 3, title: 'A' }, { at: 45, title: 'too close' }, { at: 90, title: 'C' }, { at: 118, title: 'end' }], 120);
  assert.deepEqual(t.chapters.map((c) => [c.at, c.title]), [[0, 'A'], [40, 'B'], [90, 'C']]);
  assert.equal(t.problems.length, 2);
  assert.deepEqual(tidy([{ at: 0, title: 'A' }, { at: 20, title: 'B' }], 60).chapters, []);
});

test('chapters: from a given list first, else the words; lines ready for the description', () => {
  const given = chapters({ duration: 200, words: talk(200), given: [{ at: 0, title: 'Intro' }, { at: 61, title: 'The build' }, { at: 130.5, title: 'What next' }] });
  assert.equal(given.from, 'chapters.json');
  assert.equal(given.text, '0:00 Intro\n1:01 The build\n2:10 What next');
  const drafted = chapters({ duration: 300, words: talk(300) });
  assert.equal(drafted.from, 'words');
  assert.match(drafted.lines[0], /^0:00 /);
  const none = chapters({ duration: 300 });
  assert.equal(none.from, null);
  assert.equal(none.lines.length, 0);
});

test('chapters of a project folder, and the chapters export', async () => {
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const { chaptersFor, exportProject } = await import('./index.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chap-'));
  try {
    const out = path.join(dir, 'video', 'out');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'rough.json'), JSON.stringify({ duration: 300 }));
    fs.writeFileSync(path.join(out, 'rough-words.json'), JSON.stringify({ words: talk(300) }));
    const c = chaptersFor(dir);
    assert.equal(c.from, 'words');
    assert.ok(c.lines.length >= 3);
    const r = await exportProject(dir, 'chapters');
    assert.equal(fs.readFileSync(path.join(dir, r.file), 'utf8'), c.text + '\n');
    fs.writeFileSync(path.join(out, 'chapters.json'), JSON.stringify({ chapters: [{ at: 0, title: 'A' }, { at: 100, title: 'B' }, { at: 200, title: 'C' }] }));
    assert.equal(chaptersFor(dir).text, '0:00 A\n1:40 B\n3:20 C');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
