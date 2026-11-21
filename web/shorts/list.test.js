import test from 'node:test';
import assert from 'node:assert/strict';
import { readMoments, merge, applyChoice, choiceNotes, cutSteps, previewFile, playWindow, counts, span, withChoices } from './list.js';

const PICKS = { source: 'rough', picks: [
  { id: 'p1', title: 'A clear claim', hook: 'the first line', from: 12.4, to: 51, why: 'claim, proof, result' },
  { id: 'p2', title: 'A second point', from: 80, to: 110.5, why: 'a mistake and its fix', trim: 'the aside goes' },
  { id: 'p3', title: 'Third', from: 200, to: 230 },
] };

test('reads every shape', () => {
  const a = readMoments(PICKS);
  assert.equal(a.source, 'rough');
  assert.equal(a.list.length, 3);
  assert.equal(a.list[0].len, 38.6);
  assert.equal(a.list[0].src, 'rough');
  const b = readMoments([{ id: 's1', from: '3', to: 9, title: 'x', status: 'keep' }, { from: 1, to: 2 }, { id: 's1', from: 4, to: 5 }]);
  assert.deepEqual(b.list.map((m) => m.id), ['s1', 's2', 's1-b']);
  assert.equal(b.list[0].from, 3);
  assert.equal(readMoments({ shorts: [{ id: 'k', from: 0, to: 1, src: 'r1' }] }).list[0].src, 'r1');
  assert.deepEqual(readMoments(null).list, []);
});

test('the user\'s choice wins over the agent\'s status', () => {
  const { list } = readMoments([{ id: 'a', from: 0, to: 1, status: 'keep' }, { id: 'b', from: 0, to: 1, status: 'proposed' }, { id: 'c', from: 0, to: 1 }]);
  const m = merge(list, { a: { status: 'drop', note: 'too slow' }, c: { status: null, note: 'maybe' } });
  assert.deepEqual(m.map((x) => [x.id, x.status, x.note]), [['a', 'drop', 'too slow'], ['b', null, ''], ['c', null, 'maybe']]);
  assert.equal(m[1].agentStatus, 'proposed');
});

test('a click and a note are saved; clearing both removes the entry', () => {
  const { list } = readMoments(PICKS);
  let r = applyChoice({}, list, { short: 'p1', status: 'keep' });
  assert.equal(r.p1.status, 'keep');
  r = applyChoice(r, list, { short: 'p1', note: 'start on the second line' });
  assert.equal(r.p1.status, 'keep');
  assert.equal(r.p1.note, 'start on the second line');
  r = applyChoice(r, list, { short: 'p1', status: null, note: '' });
  assert.equal(r.p1, undefined);
  assert.throws(() => applyChoice({}, list, { short: 'nope', status: 'keep' }), /no Short/);
  assert.throws(() => applyChoice({}, list, { short: 'p1', status: 'maybe' }), /keep, drop or null/);
});

test('the notes the agent reads', () => {
  const { list } = readMoments(PICKS);
  const m = merge(list, { p1: { status: 'keep', note: 'tighten the start' }, p2: { status: 'drop', note: 'same point as p1' } });
  const n = choiceNotes(m);
  assert.match(n, /^Cut these Shorts: p1 \(0:12–0:51, "A clear claim"\): tighten the start\./);
  assert.match(n, /Leave out: p2\./);
  assert.match(n, /Not decided \(leave out\): p3\./);
  assert.match(n, /p2: same point as p1/);
  assert.equal(span({ from: 65.4, to: 125 }), '1:05–2:05');
});

test('Cut these: approve the waiting pick review, then go', () => {
  const { list } = readMoments(PICKS);
  const none = merge(list, {});
  assert.match(cutSteps({ at: 'pick-review', stages: { 'pick-review': { status: 'waiting' } } }, none).error, /Keep at least one/);
  const one = merge(list, { p2: { status: 'keep' } });
  const w = cutSteps({ at: 'pick-review', stages: { 'pick-review': { status: 'waiting' } } }, one);
  assert.deepEqual(w.steps, ['approve', 'go']);
  assert.equal(w.count, 1);
  assert.match(w.notes, /p2/);
  assert.deepEqual(cutSteps({ at: 'cut', stages: { cut: { status: 'pending' } } }, one).steps, ['go']);
  assert.match(cutSteps({ at: 'cut', stages: { cut: { status: 'running' } } }, one).error, /running/);
  assert.match(cutSteps({ at: 'cut', halted: 'a locked file changed', stages: {} }, one).error, /halted/);
});

test('which file plays a moment', () => {
  assert.equal(previewFile({ src: 'rough' }, {}), 'video/out/rough.mp4');
  assert.equal(previewFile({ src: 'rough' }, { hasRough: false }), null);
  assert.equal(previewFile({ src: 'r1' }, { proxies: { sources: { r1: { proxy: 'video/out/work/proxy/r1.mp4' } } } }), 'video/out/work/proxy/r1.mp4');
  assert.equal(previewFile({ src: 'r1' }, { proxies: { r1: { proxy: 'p.mp4' } } }), 'p.mp4');
  assert.equal(previewFile({ src: 'r1' }, { edl: { sources: { r1: { file: 'footage/rec1.mkv' } } } }), 'video/footage/rec1.mkv');
  assert.equal(previewFile({ src: 'r9' }, {}), null);
});

test('play window and counts', () => {
  assert.deepEqual(playWindow({ from: 10, to: 40 }, 30), { from: 10, to: 30 });
  assert.deepEqual(playWindow({ from: 5, to: 8 }, NaN), { from: 5, to: 8 });
  assert.deepEqual(counts(merge(readMoments(PICKS).list, { p1: { status: 'keep' }, p3: { status: 'drop' } })), { all: 3, keep: 1, drop: 1 });
});

test('the pick stage\'s shape: src is a file of video/, chosen marks a kept one', () => {
  const doc = { picks: [{ id: 's1', src: 'out/rough.mp4', from: 1, to: 30, title: 'a' }, { id: 's2', src: 'footage/rec1.mkv', from: 40, to: 70, chosen: true }] };
  const { list } = readMoments(doc);
  assert.equal(previewFile(list[0], {}), 'video/out/rough.mp4');
  assert.equal(previewFile(list[1], {}), 'video/footage/rec1.mkv');
  const edl = { sources: { r1: { file: 'footage/rec1.mkv' } } };
  assert.equal(previewFile(list[1], { edl, proxies: { sources: { r1: { proxy: 'video/out/work/proxy/r1.mp4' } } } }), 'video/out/work/proxy/r1.mp4');
  assert.equal(previewFile({ src: 'r1' }, { edl }), 'video/footage/rec1.mkv');
  assert.equal(merge(list, {})[1].status, 'keep');
});

test('the choices go into the picks file as chosen and note, and only when something changes', () => {
  const doc = { about: 'x', picks: [{ id: 's1', from: 1, to: 30, why: 'w' }, { id: 's2', from: 40, to: 70 }] };
  const { list } = readMoments(doc);
  const next = withChoices(doc, merge(list, { s1: { status: 'keep', note: 'tight start' }, s2: { status: 'drop' } }));
  assert.deepEqual(next, { about: 'x', picks: [{ id: 's1', from: 1, to: 30, why: 'w', chosen: true, note: 'tight start' }, { id: 's2', from: 40, to: 70, chosen: false }] });
  assert.equal(withChoices(next, merge(readMoments(next).list, { s1: { status: 'keep', note: 'tight start' }, s2: { status: 'drop' } })), null);
  const cleared = withChoices(next, merge(readMoments(next).list, { s2: { status: 'drop' }, s1: { status: null } }));
  assert.equal(cleared.picks[0].chosen, false);
  assert.equal(cleared.picks[0].note, 'tight start'); // the file's own note stays when the review has none
  assert.equal(withChoices([{ id: 'a' }], []), null);
});
