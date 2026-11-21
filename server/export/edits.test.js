import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanRedactions, cleanEventEdits, saveEdits, readEdits } from './edits.js';
import { needsRemux, remuxedPath, remuxArgs } from './remux.js';
import { toFcpxml } from './fcpxml.js';
import { toOtio } from './otio.js';

const FRAME = { width: 1920, height: 1080, duration: 100 };

test('redaction boxes: clamped to the frame and the video, sorted, bad ones refused', () => {
  const r = cleanRedactions({ boxes: [{ id: 'R2', at: 50, end: 120, x: 1800, y: -10, w: 300, h: 50, mode: 'pixelate' }, { id: 'R1', at: 1, end: 2, x: 0, y: 0, w: 10, h: 10, mode: 'swirl', note: ' key ' }] }, FRAME);
  assert.deepEqual(r.data.boxes.map((b) => b.id), ['R1', 'R2']);
  assert.deepEqual(r.data.boxes[1], { id: 'R2', at: 50, end: 100, x: 1800, y: 0, w: 120, h: 40, mode: 'pixelate' });
  assert.equal(r.data.boxes[0].mode, 'blur');
  assert.equal(r.data.boxes[0].note, 'key');
  assert.match(cleanRedactions({ boxes: [{ id: 'a b', at: 0, end: 1, x: 0, y: 0, w: 5, h: 5 }] }).error, /id/);
  assert.match(cleanRedactions({ boxes: [{ id: 'A', at: 2, end: 1, x: 0, y: 0, w: 5, h: 5 }] }).error, /ends before/);
  assert.match(cleanRedactions({ boxes: [{ id: 'A', at: 0, end: 1, x: 3000, y: 0, w: 5, h: 5 }] }, FRAME).error, /outside/);
  assert.match(cleanRedactions({ boxes: [{ id: 'A', at: 0, end: 1, x: 0, y: 0, w: 5, h: 5 }, { id: 'A', at: 0, end: 1, x: 0, y: 0, w: 5, h: 5 }] }).error, /twice/);
  assert.match(cleanRedactions({}).error, /boxes/);
});

test('event edits: only known events, sane times, empty edits dropped', () => {
  const r = cleanEventEdits({ edits: { L1: { at: 2.12345, end: 4, text: 'Hi', props: { text: 'Hi' } }, L2: {}, L3: { hide: true } } }, ['L1', 'L2', 'L3'], 100);
  assert.deepEqual(r.data.edits, { L1: { at: 2.123, end: 4, text: 'Hi', props: { text: 'Hi' } }, L3: { hide: true } });
  assert.match(cleanEventEdits({ edits: { X: { at: 1 } } }, ['L1']).error, /no event X/);
  assert.match(cleanEventEdits({ edits: { L1: { at: 3, end: 3.05 } } }, ['L1']).error, /0.1 s/);
});

test('saving writes the file, and an empty list removes it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edits-'));
  try {
    const out = path.join(dir, 'video', 'out');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'rough.json'), JSON.stringify(FRAME));
    fs.writeFileSync(path.join(out, 'events.json'), JSON.stringify({ events: [{ id: 'L1' }] }));
    const s = saveEdits(dir, 'redactions', { boxes: [{ id: 'R1', at: 1, end: 2, x: 10, y: 10, w: 20, h: 20 }] });
    assert.equal(s.file, 'video/out/redactions.json');
    assert.equal(readEdits(dir).redactions.boxes.length, 1);
    saveEdits(dir, 'event-edits', { edits: { L1: { text: 'x' } } });
    assert.equal(readEdits(dir).eventEdits.edits.L1.text, 'x');
    assert.throws(() => saveEdits(dir, 'event-edits', { edits: { L9: { text: 'x' } } }), /no event/);
    assert.throws(() => saveEdits(dir, 'secrets', {}), /file must be/);
    saveEdits(dir, 'redactions', { boxes: [] });
    assert.equal(fs.existsSync(path.join(out, 'redactions.json')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('remux: which containers, where the copy goes, a stream copy', () => {
  assert.equal(needsRemux('a/rec.mkv'), true);
  assert.equal(needsRemux('a/rec.MP4'), false);
  assert.equal(needsRemux('vo.wav'), false);
  assert.equal(remuxedPath(path.join('p'), path.join('p', 'video', 'footage', 'take one.mkv')), path.join('p', 'export', 'media', 'take one.mp4'));
  const a = remuxArgs('in.mkv', 'out.mp4');
  assert.deepEqual(a.slice(a.indexOf('-c'), a.indexOf('-c') + 2), ['-c', 'copy']);
  assert.ok(a.includes('0:a?'));
});

test('clips are named after their recording, not the edit list letter', () => {
  const edl = { fps: 30, width: 1920, height: 1080, total: 4, sources: { r1: { file: 'footage/take.mkv' } },
    items: [{ kind: 'S', at: 0, len: 2, src: 'r1', src_in: 1, src_out: 3 }, { kind: 'S', beat: 2, at: 2, len: 2, src: 'r1', src_in: 5, src_out: 7, name: 'The hook' }] };
  const sources = { r1: { url: 'file:///x/take.mkv', name: 'take.mkv', hasVideo: true, hasAudio: true, duration: 10 } };
  const x = toFcpxml(edl, { sources });
  assert.ok(!/name="S"/.test(x));
  assert.ok(x.includes('<asset-clip ref="r2" offset="0s" name="take.mkv"'));
  assert.ok(x.includes('name="The hook"'));
  const o = toOtio(edl, { sources });
  assert.deepEqual(o.tracks.children[0].children.map((c) => c.name), ['take.mkv', 'The hook']);
});
