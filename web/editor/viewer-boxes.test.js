import test from 'node:test';
import assert from 'node:assert/strict';
import { fitRect, toFrame, toScreen, boxFrom, hit, drag, activeAt, nextId, timesFor, setTime, put } from './viewer-boxes.js';

test('the picture inside its element, and points both ways', () => {
  const f = fitRect(1000, 700, 1920, 1080);
  assert.equal(Math.round(f.w), 1000); assert.equal(Math.round(f.y * 100), Math.round(((700 - 562.5) / 2) * 100));
  const p = toFrame(500, 350, f);
  assert.deepEqual([Math.round(p.x), Math.round(p.y)], [960, 540]);
  const s = toScreen({ x: 960, y: 540, w: 192, h: 108 }, f);
  assert.deepEqual([Math.round(s.x), Math.round(s.w)], [500, 100]);
});

test('a box from a drag, clamped, and too small is nothing', () => {
  assert.deepEqual(boxFrom({ x: 300, y: 50 }, { x: 100, y: -20 }, 1920, 1080), { x: 100, y: 0, w: 200, h: 50 });
  assert.equal(boxFrom({ x: 1, y: 1 }, { x: 4, y: 40 }, 1920, 1080), null);
});

test('hits: corners first, then the inside; the top box wins', () => {
  const f = fitRect(1920, 1080, 1920, 1080);
  const boxes = [{ id: 'R1', x: 100, y: 100, w: 200, h: 100 }, { id: 'R2', x: 250, y: 150, w: 100, h: 100 }];
  assert.deepEqual(hit(boxes, 102, 98, f), { id: 'R1', part: 'nw' });
  assert.deepEqual(hit(boxes, 260, 160, f), { id: 'R2', part: 'move' });
  assert.deepEqual(hit(boxes, 150, 150, f), { id: 'R1', part: 'move' });
  assert.equal(hit(boxes, 10, 10, f), null);
});

test('dragging moves or resizes inside the frame', () => {
  const b = { id: 'R1', x: 100, y: 100, w: 200, h: 100 };
  assert.deepEqual(drag(b, 'move', 5000, -500, 1920, 1080), { ...b, x: 1720, y: 0 });
  assert.deepEqual(drag(b, 'se', 50, 20, 1920, 1080), { ...b, w: 250, h: 120 });
  assert.deepEqual(drag(b, 'nw', 500, 0, 1920, 1080), { ...b, x: 292, w: 8 });
});

test('times, ids and the list', () => {
  assert.equal(activeAt([{ at: 1, end: 2 }, { at: 3, end: 4 }], 1.5).length, 1);
  assert.equal(nextId([{ id: 'R2' }, { id: 'R7' }, { id: 'x' }]), 'R8');
  assert.equal(nextId([]), 'R1');
  assert.deepEqual(timesFor(10, { in: 12, out: 15 }, 100), { at: 12, end: 15 });
  assert.deepEqual(timesFor(10, { in: null, out: null }, 11), { at: 10, end: 11 });
  assert.deepEqual(timesFor(10, { in: 4, out: null }, 100), { at: 4, end: 7 });
  assert.deepEqual(setTime({ at: 1, end: 5 }, 'in', 9, 100), { at: 4.9, end: 5 });
  assert.deepEqual(setTime({ at: 1, end: 5 }, 'out', 200, 100), { at: 1, end: 100 });
  assert.deepEqual(put([{ id: 'R1', at: 5 }, { id: 'R2', at: 1 }], 'R1', { id: 'R1', at: 0 }).map((b) => b.id), ['R1', 'R2']);
  assert.deepEqual(put([{ id: 'R1', at: 5 }], 'R1', null), []);
});
