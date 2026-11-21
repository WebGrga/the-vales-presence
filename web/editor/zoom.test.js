import test from 'node:test';
import assert from 'node:assert/strict';
import { timeToX, xToTime, fitView, clampView, zoomAround, follow, snapTime, tickStep, ticks, fmtTime, fmtTC, tickLabel, MAX_PPS } from './zoom.js';

test('time and pixels', () => {
  const v = { start: 10, pps: 20 };
  assert.equal(timeToX(15, v), 100); assert.equal(xToTime(100, v), 15);
});

test('fit, clamp and zoom around the pointer', () => {
  const f = fitView(100, 1020); assert.equal(f.start, 0); assert.ok(Math.abs(f.pps - 10) < 1e-9);
  assert.equal(clampView({ start: -5, pps: 10 }, 100, 1000).start, 0);
  assert.equal(clampView({ start: 500, pps: 10 }, 100, 500).start, 55);
  const z = zoomAround({ start: 0, pps: 10 }, 2, 300, 100, 1000);
  assert.equal(z.pps, 20); assert.ok(Math.abs(xToTime(300, z) - 30) < 1e-9);
  assert.equal(zoomAround({ start: 0, pps: MAX_PPS }, 4, 0, 100, 1000).pps, MAX_PPS);
});

test('follow the playhead', () => {
  const v = { start: 0, pps: 10 };
  assert.equal(follow(v, 50, 1000), v);
  assert.equal(follow(v, 95, 1000).start, 85);
  assert.equal(follow({ start: 50, pps: 10 }, 10, 1000).start, 0);
});

test('snapping', () => {
  assert.deepEqual(snapTime(10.3, [5, 10, 20], 20), { t: 10, snapped: true });
  assert.deepEqual(snapTime(10.6, [5, 10, 20], 20), { t: 10.6, snapped: false });
});

test('ticks and labels', () => {
  assert.equal(tickStep(10), 10); assert.equal(tickStep(1000), 0.1);
  assert.deepEqual(ticks({ start: 3, pps: 10 }, 300), [10, 20, 30]);
  assert.equal(fmtTime(75.9), '1:15'); assert.equal(fmtTime(3725), '1:02:05');
  assert.equal(fmtTC(61.5, 30), '00:01:01:15'); assert.equal(fmtTC(3600, 25), '01:00:00:00');
  assert.equal(tickLabel(2, 1), '0:02'); assert.equal(tickLabel(2.5, 0.5, 30), '00:00:02:15');
});
