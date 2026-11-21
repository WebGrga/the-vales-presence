import test from 'node:test';
import assert from 'node:assert/strict';
import { pieces } from './edl-map.js';
import { applyEdits, boxEvents, windowsOf, reRenderNote, baseToWorking, workingToBase, editFor, setEdit, textOf, drawnBy } from './edl-overlays.js';

const EVENTS = [
  { id: 'L1', kind: 'text', at: 2, end: 4, comp: 'Label', props: { text: 'HELLO', side: 'right' } },
  { id: 'L2', kind: 'text', at: 4.6, end: 6, comp: 'Label', props: { text: 'NEXT' } },
  { id: 'L3', kind: 'text', at: 40, end: 42, comp: 'Label', props: { text: 'LATER' } },
  { id: 'Z1', kind: 'zoom', at: 20, end: 31, zoom: 1.5, x: 0, y: 0 },
  { id: 'C1', kind: 'caption', at: 50, end: 52, words: [] },
];

test('your edits over the events, the way the engine applies them', () => {
  const out = applyEdits(EVENTS, { edits: { L1: { at: 2.5, text: 'HI', props: { text: 'HI' } }, L3: { hide: true }, X: { at: 1 } } });
  assert.deepEqual(out.map((e) => e.id), ['L1', 'L2', 'Z1', 'C1']);
  assert.deepEqual([out[0].at, out[0].end, out[0].props, out[0].edited], [2.5, 4, { text: 'HI', side: 'right' }, true]);
  assert.equal(EVENTS[0].props.text, 'HELLO');
  assert.equal(applyEdits(EVENTS, null).length, 5);
});

test('blur boxes become events with the engine ids', () => {
  assert.deepEqual(boxEvents({ boxes: [{ id: 'R1', at: 1, end: 2, x: 0, y: 0, w: 9, h: 9 }] }).map((e) => [e.id, e.kind, e.box]), [['user-R1', 'blur', 'R1']]);
  assert.equal(drawnBy({ kind: 'blur' }), 'ffmpeg');
});

test('windows merge like the engine and the note says what renders again', () => {
  assert.deepEqual(windowsOf(EVENTS, 100), [{ start: 1.5, end: 6.5, ids: ['L1', 'L2'] }, { start: 39.5, end: 42.5, ids: ['L3'] }]);
  assert.match(reRenderNote(EVENTS, 'L3', 100), /39\.5–42\.5 s \(1 of 2\)/);
  assert.match(reRenderNote(EVENTS, 'L1', 100), /with L2/);
  assert.match(reRenderNote(EVENTS, 'Z1', 100), /2 chunks/);
  assert.equal(reRenderNote(EVENTS, 'nope'), '');
});

test('rough time to the working list and back', () => {
  const base = pieces({ items: [{ src: 'a', src_in: 0, src_out: 10, len: 10 }] });
  const work = pieces({ items: [{ src: 'a', src_in: 0, src_out: 4, len: 4 }, { src: 'a', src_in: 6, src_out: 10, len: 4 }] });
  assert.equal(baseToWorking(base, work, 7), 5);
  assert.equal(baseToWorking(base, work, 5), null);
  assert.equal(workingToBase(base, work, 5), 7);
});

test('an inspector edit holds only what changed', () => {
  const L1 = EVENTS[0];
  assert.equal(editFor(L1, { at: 2, end: 4, text: 'HELLO', props: { side: 'right' } }), null);
  assert.deepEqual(editFor(L1, { at: 2.25, end: 4, text: 'HEY', props: { side: 'left' } }), { at: 2.25, text: 'HEY', props: { side: 'left', text: 'HEY' } });
  assert.deepEqual(editFor({ id: 'E', at: 0, end: 1, text: 'x' }, { at: 0, end: 1, text: 'y' }), { text: 'y' });
  assert.deepEqual(editFor(L1, { at: 2, end: 4, text: 'HELLO', hide: true }), { hide: true });
  assert.equal(textOf(L1), 'HELLO');
  const e = setEdit(setEdit(null, 'L1', { text: 'a' }), 'L2', { at: 5 });
  assert.deepEqual(Object.keys(e.edits), ['L1', 'L2']);
  assert.deepEqual(Object.keys(setEdit(e, 'L1', null).edits), ['L2']);
});
