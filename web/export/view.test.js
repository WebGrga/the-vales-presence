import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sizeText, ago, latest, ready, offText, textLines, shownFiles } from './view.js';

test('sizes and times', () => {
  assert.equal(sizeText(512), '512 B');
  assert.equal(sizeText(5178), '5 KB');
  assert.equal(sizeText(3.5 * 1024 ** 2), '3.5 MB');
  assert.equal(sizeText(undefined), '');
  const now = Date.parse('2026-01-01T12:00:00Z');
  assert.equal(ago('2026-01-01T11:59:30Z', now), 'just now');
  assert.equal(ago('2026-01-01T11:50:00Z', now), '10 min ago');
  assert.equal(ago('2026-01-01T09:00:00Z', now), '3 h ago');
  assert.equal(ago('nonsense', now), '');
});

test('the newest file of a kind; the final before the rough', () => {
  const files = [
    { kind: 'srt', file: 'export/a.srt', mtime: '2026-01-01T10:00:00Z' },
    { kind: 'srt', file: 'export/b.srt', mtime: '2026-01-02T10:00:00Z' },
    { kind: 'mp4', which: 'rough', file: 'video/out/rough.mp4' },
    { kind: 'mp4', which: 'final', file: 'video/out/final.mp4' },
  ];
  assert.equal(latest(files, 'srt').file, 'export/b.srt');
  assert.equal(latest(files, 'mp4').which, 'final');
  assert.equal(latest(files.slice(0, 3), 'mp4').which, 'rough');
  assert.equal(latest(files, 'otio'), null);
});

test('a format is ready when any of its needs is there', () => {
  assert.equal(ready({ needs: ['final', 'rough'] }, { rough: true }), true);
  assert.equal(ready({ needs: ['edl'] }, { rough: true }), false);
  assert.equal(ready({ needs: ['edl'] }, undefined), false);
});

test('formats.json: every kind the server makes, each with what it is and what opens it', () => {
  const { formats } = JSON.parse(fs.readFileSync(new URL('./formats.json', import.meta.url), 'utf8'));
  assert.deepEqual(formats.map((f) => f.kind), ['mp4', 'srt', 'fcpxml', 'otio', 'chapters', 'remux']);
  for (const f of formats) assert.ok(f.name && f.what && f.opens && f.button && f.needs.length && f.icon && f.missing, f.kind);
});

test('why a format is off, the text lines, the files shown', () => {
  assert.equal(offText({ kind: 'srt', missing: 'No words.' }, {}), 'No words.');
  assert.equal(offText({ kind: 'chapters', missing: 'No words.' }, { chapters: 'too short' }), 'No words. (too short)');
  assert.deepEqual(textLines('0:00 A\r\n\n1:10 B\n'), ['0:00 A', '1:10 B']);
  assert.deepEqual(textLines(undefined), []);
  const files = [
    { kind: 'remux', file: 'export/media/b.mp4' }, { kind: 'remux', file: 'export/media/a.mp4' },
    { kind: 'srt', file: 'export/x.srt', mtime: '1' }, { kind: 'srt', file: 'export/y.srt', mtime: '2' },
  ];
  assert.deepEqual(shownFiles({ kind: 'remux', list: true }, files).map((f) => f.file), ['export/media/a.mp4', 'export/media/b.mp4']);
  assert.deepEqual(shownFiles({ kind: 'srt' }, files).map((f) => f.file), ['export/y.srt']);
  assert.deepEqual(shownFiles({ kind: 'otio' }, files), []);
});
