import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proxyPlan, fresh, reducePeaks, peakFolder, encoderArgs, ENCODERS } from './media.js';

test('proxyPlan: edl sources first, then the rest of the footage, nothing outside the workshop', () => {
  const edl = { sources: { r1: { file: 'footage/rec1.mkv', track: 2 }, vo: { file: 'out/work/vo.wav' }, bad: { file: '../x.mp4' }, abs: { file: '/etc/x.mp4' } } };
  const p = proxyPlan(edl, ['rec1.mkv', 'rec 2.MP4', 'notes.txt']);
  assert.deepEqual(p, [
    { src: 'r1', file: 'footage/rec1.mkv', track: 2, audioOnly: false },
    { src: 'vo', file: 'out/work/vo.wav', track: 0, audioOnly: true },
    { src: 'rec-2', file: 'footage/rec 2.MP4', track: 0, audioOnly: false },
  ]);
  assert.deepEqual(proxyPlan(null, ['a.mkv']).map((x) => x.src), ['a']);
});

test('fresh', () => {
  assert.ok(fresh({ mtimeMs: 1, size: 9 }, { mtimeMs: 2, size: 5 }));
  assert.ok(!fresh({ mtimeMs: 3 }, { mtimeMs: 2, size: 5 }));
  assert.ok(!fresh({ mtimeMs: 1 }, { mtimeMs: 2, size: 0 }));
  assert.ok(!fresh(null, { mtimeMs: 2, size: 5 }));
});

test('peaks: the loudest sample per bin, the streaming fold equals the plain one', () => {
  const s = Int16Array.from([0, 100, -16384, 5, 32767, 0, -32768]);
  assert.deepEqual(reducePeaks(s, 3), [0.5, 1, 1]);
  const buf = Buffer.from(s.buffer);
  for (const cut of [1, 3, 5]) {
    const f = peakFolder(3);
    f.push(buf.subarray(0, cut)); f.push(buf.subarray(cut));
    assert.deepEqual(f.end(), [0.5, 1, 1], `split at ${cut}`);
  }
});

test('every encoder has arguments, libx264 last', () => {
  for (const e of ENCODERS) assert.ok(encoderArgs(e).includes(e));
  assert.equal(ENCODERS.at(-1), 'libx264');
});
