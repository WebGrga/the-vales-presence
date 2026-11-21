import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, presetArgs, scaleFilter, renderName, progressSeconds, fraction, cleanFolder, orderHistory } from './presets.js';
import { merge, entryOf } from '../studio/upload-history.js';

test('presets: sizes, and a small preview has a bitrate cap', () => {
  assert.deepEqual([PRESETS.youtube.w, PRESETS.youtube.h], [1920, 1080]);
  assert.deepEqual([PRESETS.shorts.w, PRESETS.shorts.h], [1080, 1920]);
  const a = presetArgs(PRESETS.preview, 'in.mp4', 'out.mp4');
  assert.ok(a.includes('-maxrate') && a.includes('1200k') && !a.includes('-crf'));
  assert.ok(presetArgs(PRESETS.youtube, 'in.mp4', 'out.mp4').includes('-crf'));
  assert.match(scaleFilter(PRESETS.shorts), /crop=1080:1920/);
  assert.match(scaleFilter(PRESETS.youtube), /pad=1920:1080/);
});

test('renderName never repeats a taken name; progress and folders', () => {
  const at = new Date(2026, 10, 21, 9, 5, 7);
  const first = renderName('My Video!', 'youtube', at);
  assert.equal(first, 'my-video-youtube-20261121-090507.mp4');
  assert.equal(renderName('My Video!', 'youtube', at, [first]), 'my-video-youtube-20261121-090507-2.mp4');
  assert.equal(progressSeconds('out_time_us=1000000\nfoo\nout_time_us=2500000\n'), 2.5);
  assert.equal(fraction(5, 10), 0.5);
  assert.equal(fraction(5, 0), 0);
  assert.ok(cleanFolder('exports').error);
  assert.ok(cleanFolder('').error);
  assert.ok(cleanFolder(process.platform === 'win32' ? 'C:/Exports' : '/exports').folder);
});

test('history is newest first and marks the older version of the same preset', () => {
  const h = orderHistory([{ at: '2026-01-01', preset: 'youtube', file: 'a' }, { at: '2026-03-01', preset: 'youtube', file: 'c' }, { at: '2026-02-01', preset: 'shorts', file: 'b' }]);
  assert.deepEqual(h.map((e) => [e.file, e.older]), [['c', false], ['b', false], ['a', true]]);
});

test('upload history: saved list plus the last state, newest first, nothing twice', () => {
  const last = { status: 'done', at: '2026-02-01T00:00:00Z', title: 'T', dry: true };
  const saved = [entryOf({ at: '2026-01-01T00:00:00Z', title: 'Old' }, { id: 'a', file: 'a.png' })];
  assert.deepEqual(merge(saved, last).map((e) => e.title), ['T', 'Old']);
  assert.equal(merge([entryOf(last, null), ...saved], last).length, 2);
  assert.deepEqual(merge(null, { status: 'uploading' }), []);
});
