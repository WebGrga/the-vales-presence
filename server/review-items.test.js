import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { seconds, timesIn, cleanItem, fromInspect, gather, applyMark, itemId, readItems, writeMarks } from './review-items.js';

const made = [];
after(() => { for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

test('times in seconds and in text', () => {
  assert.equal(seconds('1:16'), 76);
  assert.equal(seconds('0:28.5'), 28.5);
  assert.equal(seconds('1:02:03'), 3723);
  assert.equal(seconds(12.3456), 12.346);
  assert.equal(seconds('soon'), null);
  assert.equal(seconds(-1), null);
  assert.deepEqual(timesIn('from 0:28–0:49 and at 1:16'), [{ at: 28, to: 49 }, { at: 76, to: null }]);
  assert.deepEqual(timesIn('most of 1:56–3:30: the window'), [{ at: 116, to: 210 }]);
  assert.deepEqual(timesIn('a clock 10:30:45 is not a time on the video'), []);
});

test('an item as it may be kept: text needed, known kinds, a stable id', () => {
  assert.equal(cleanItem({ at: 3 }), null);
  const a = cleanItem({ at: '1:16', kind: 'listen', text: 'the join', source: 'rough' });
  assert.deepEqual({ ...a, id: undefined }, { at: 76, to: null, kind: 'listen', text: 'the join', source: 'rough', on: null, id: undefined });
  assert.equal(a.id, itemId(a));
  assert.equal(cleanItem({ text: 'x', kind: 'weird' }).kind, 'other');
  assert.equal(cleanItem({ text: 'x', at: 5, to: 2 }).to, null);
  assert.equal(cleanItem({ text: 'x', id: 'mine-1' }).id, 'mine-1');
});

const MD = `# Inspect

## For you

- **Private info on screen.** Say which to hide.
  - The header reads "CTR 0.8%" (0:28, before the zoom).
  - Local paths (0:19–0:26).
- **Length is 3:45.7,** 15 s over the brief.
- **One quiet stretch left: 0:28–0:49** with the cards held still.
- Nothing timed here, just a thought.

## Checks

- Length | pass | 1:00
`;

test("Inspect's For you becomes items: sub-points with times, lengths without a time, nothing from other sections", () => {
  const items = fromInspect(MD);
  assert.equal(items.length, 5);
  assert.deepEqual(items.map((x) => [x.at, x.to, x.kind]), [[28, null, 'private'], [19, 26, 'private'], [null, null, 'length'], [28, 49, 'pace'], [null, null, 'look']]);
  assert.match(items[0].text, /^Private info on screen: The header/);
  assert.ok(items.every((x) => x.source === 'inspect' && x.on === 'final'));
  assert.deepEqual(fromInspect('# no section'), []);
});

test('gather: the file first, inspect.md only when the file has no inspect items, your marks on top, by time', () => {
  const doc = { items: [{ at: 76, kind: 'listen', text: 'the 1:16 join', source: 'rough' }, { text: 'bad' }] };
  let g = gather(doc, MD, {});
  assert.equal(g.length, 7);
  assert.equal(g[0].at, 19);
  assert.equal(g.at(-1).at, null);
  const withInspect = { items: [...doc.items, { at: 28, text: 'blur it', source: 'inspect', kind: 'private' }] };
  g = gather(withInspect, MD, {});
  assert.equal(g.length, 3);
  const id = g.find((x) => x.source === 'rough').id;
  g = gather(withInspect, MD, { [id]: { done: true, note: 'fine' } });
  assert.equal(g.find((x) => x.id === id).done, true);
  assert.equal(g.find((x) => x.id === id).mark, 'fine');
});

test('marks: set, clear, refuse; on disk they survive the agent rewriting its file', () => {
  assert.match(applyMark({}, ['a'], 'b', { done: true }).error, /no such/);
  assert.match(applyMark({}, ['a'], 'a', { done: 'yes' }).error, /true or false/);
  let m = applyMark({}, ['a'], 'a', { done: true }, 't').marks;
  assert.deepEqual(m, { a: { done: true, at: 't' } });
  m = applyMark(m, ['a'], 'a', { done: false }, 't').marks;
  assert.deepEqual(m, {});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'presence-ri-')); made.push(dir);
  fs.mkdirSync(path.join(dir, 'video', 'out'), { recursive: true });
  const file = path.join(dir, 'video', 'out', 'review-items.json');
  fs.writeFileSync(file, JSON.stringify({ items: [{ at: 1, text: 'one', source: 'rough' }] }));
  const r = readItems(dir);
  writeMarks(dir, applyMark(r.marks, r.items.map((x) => x.id), r.items[0].id, { done: true }).marks);
  fs.writeFileSync(file, JSON.stringify({ items: [{ at: 1, text: 'one', source: 'rough' }, { at: 2, text: 'two', source: 'visuals' }] }));
  const again = readItems(dir).items;
  assert.equal(again.length, 2);
  assert.equal(again[0].done, true);
  assert.equal(again[1].done, false);
});
