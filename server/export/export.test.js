import test from 'node:test';
import assert from 'node:assert/strict';
import { frameDuration, timelineOf, pieceOf, sourceLengths, slug } from './timeline.js';
import { toFcpxml, fcpTime, esc } from './fcpxml.js';
import { toOtio, trackLength } from './otio.js';
import { srtTime, fromWords, fromCaptionEvents, toSrt, captionsSrt, coverage, isFiller } from './srt.js';

// a small fake edit list: two stretches of one recording, a sped wait, a held still, a blank card, and a voice-over line over a picture
const EDL = {
  version: 2, fps: 60, width: 1920, height: 1080, total: 14.5,
  sources: { r1: { file: 'footage/take one.mkv' }, vo: { file: 'out/work/vo/all.wav' } },
  items: [
    { kind: 'S', beat: 1, at: 0, len: 2.5, src: 'r1', src_in: 10, src_out: 12.5, pic_in: 10 },
    { kind: 'S', beat: 1, at: 2.5, len: 3, src: 'r1', src_in: 20, src_out: 23, pic_in: 20, cut_before: { kind: 'filler', why: 'x', flag: false, ask: '' } },
    { kind: 'W', beat: 2, at: 5.5, len: 3, pic_src: 'r1', pic_in: 30, pic_out: 42, speed: 4 },
    { kind: 'H', beat: 2, at: 8.5, len: 1, pic_src: 'r1', pic_in: 42 },
    { kind: 'E', beat: 3, at: 9.5, len: 2, color: 'black' },
    { kind: 'V', beat: 3, at: 11.5, len: 3, src: 'vo', src_in: 4, src_out: 7, pic_src: 'r1', pic_in: 50 },
  ],
};
const SOURCES = {
  r1: { url: 'file:///media/take%20one.mkv', name: 'take one.mkv', hasVideo: true, hasAudio: true, duration: 120, channels: 2, rate: 48000 },
  vo: { url: 'file:///media/all.wav', name: 'all.wav', hasVideo: false, hasAudio: true, duration: 30, channels: 1, rate: 48000 },
};

test('frame durations', () => {
  assert.deepEqual(frameDuration(60), { n: 1, d: 60, fps: 60 });
  assert.equal(frameDuration(29.97).n, 1001);
  assert.equal(frameDuration(29.97).d, 30000);
  assert.equal(frameDuration(59.94).d, 60000);
  assert.equal(frameDuration(25).d, 25);
});

test('pieces: what plays where, in whole frames, back to back', () => {
  const tl = timelineOf(EDL, SOURCES);
  assert.equal(tl.pieces.length, 6);
  assert.equal(tl.length, 870);
  let pos = 0;
  for (const p of tl.pieces) { assert.equal(p.offset, pos); pos += p.dur; }
  const [a, b, w, h, e, v] = tl.pieces;
  assert.deepEqual(a.audio, { src: 'r1', start: 600 });
  assert.deepEqual(a.video, { src: 'r1', start: 600 });
  assert.equal(b.offset, 150);
  assert.equal(w.audio, null);
  assert.deepEqual(w.video, { src: 'r1', start: 1800, speed: 4 });
  assert.equal(h.video.freeze, true);
  assert.ok(e.gap);
  assert.deepEqual(v.audio, { src: 'vo', start: 240 });
  assert.deepEqual(v.video, { src: 'r1', start: 3000 });
  assert.deepEqual(tl.used.sort(), ['r1', 'vo']);
});

test('a hole becomes a gap, an overlap is trimmed', () => {
  const tl = timelineOf({ fps: 30, items: [{ at: 0, len: 1, src: 'r1', src_in: 0 }, { at: 2, len: 1, src: 'r1', src_in: 5 }, { at: 2.5, len: 1, src: 'r1', src_in: 9 }] });
  assert.deepEqual(tl.pieces.map((p) => [p.offset, p.dur, !!p.gap]), [[0, 30, false], [30, 30, true], [60, 30, false], [90, 15, false]]);
  assert.equal(tl.pieces[3].audio.start, 9 * 30 + 15);
});

test('a source with no picture gives no video', () => {
  const p = pieceOf({ at: 0, len: 1, src: 'vo', src_in: 1 }, 60, { vo: { hasVideo: false } });
  assert.equal(p.video, null);
  assert.deepEqual(p.audio, { src: 'vo', start: 60 });
});

test('source lengths: the probe, or what the pieces reach', () => {
  const tl = timelineOf(EDL, {});
  const lens = sourceLengths(tl, {});
  assert.equal(lens.r1, 3000 + 180);
  assert.equal(sourceLengths(tl, SOURCES).r1, 7200);
});

test('FCPXML times', () => {
  assert.equal(fcpTime(0, frameDuration(60)), '0s');
  assert.equal(fcpTime(150, frameDuration(60)), '5/2s');
  assert.equal(fcpTime(120, frameDuration(60)), '2s');
  assert.equal(fcpTime(7, frameDuration(60)), '7/60s');
  assert.equal(fcpTime(30, frameDuration(29.97)), '1001/1000s');
  assert.equal(esc(`a&b<"c">'`), 'a&amp;b&lt;&quot;c&quot;&gt;&apos;');
});

// a tiny XML reader for the tests: every tag opened is closed in order, and the elements as [name, attrs]
function elements(xml) {
  const stack = [], all = [];
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/, '').replace(/<!DOCTYPE[^>]*>\s*/, '');
  for (const m of body.matchAll(/<(\/?)([a-zA-Z-]+)((?:\s+[a-zA-Z-]+="[^"]*")*)\s*(\/?)>/g)) {
    const [, close, name, rawAttrs, self] = m;
    if (close) { assert.equal(stack.pop(), name, `</${name}> closes the open tag`); continue; }
    const attrs = Object.fromEntries([...rawAttrs.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    all.push([name, attrs, stack.length]);
    if (!self) stack.push(name);
  }
  assert.equal(stack.length, 0, 'every tag is closed');
  return all;
}

test('FCPXML: one sequence, an asset per recording, clips that add up', () => {
  const xml = toFcpxml(EDL, { title: 'Test & cut', sources: SOURCES });
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.10">/);
  const els = elements(xml);
  const by = (n) => els.filter((e) => e[0] === n);
  assert.equal(by('sequence').length, 1);
  assert.equal(by('format').length, 1);
  assert.equal(by('format')[0][1].frameDuration, '1/60s');
  assert.equal(by('format')[0][1].name, 'FFVideoFormat1080p60');
  const assets = by('asset');
  assert.equal(assets.length, 2);
  assert.equal(by('media-rep')[0][1].src, 'file:///media/take%20one.mkv');
  const vo = assets.find((a) => a[1].name === 'all.wav')[1];
  assert.equal(vo.hasVideo, '0');
  assert.equal(vo.format, undefined);
  assert.equal(by('project')[0][1].name, 'Test &amp; cut');
  assert.equal(by('sequence')[0][1].duration, '29/2s');
  // the spine's direct children (depth of spine + 1) are back to back and sum to the sequence
  const spineDepth = by('spine')[0][2];
  const top = els.filter((e) => e[2] === spineDepth + 1 && (e[0] === 'asset-clip' || e[0] === 'gap'));
  assert.equal(top.length, 6);
  const sec = (t) => { const m = /^(\d+)(?:\/(\d+))?s$/.exec(t); return Number(m[1]) / Number(m[2] || 1); };
  let pos = 0;
  for (const [, a] of top) { assert.equal(sec(a.offset), pos); pos += sec(a.duration); }
  assert.equal(pos, 14.5);
  assert.equal(top[0][1].start, '10s');
  assert.equal(top[2][1].srcEnable, 'video');
  assert.equal(by('timeMap').length, 2);
  assert.equal(top[4][0], 'gap');
  // the voice-over line: the sound is the spine clip, its picture is connected on lane 1 at the parent's start
  assert.equal(top[5][1].srcEnable, 'audio');
  const lane = els.find((e) => e[1].lane === '1')[1];
  assert.equal(lane.offset, '4s');
  assert.equal(lane.start, '50s');
  assert.equal(lane.srcEnable, 'video');
});

test('OTIO: one video and one audio track, clips with source ranges', () => {
  const t = toOtio(EDL, { title: 'Test', sources: SOURCES });
  assert.equal(t.OTIO_SCHEMA, 'Timeline.1');
  const [v, a] = t.tracks.children;
  assert.equal(v.kind, 'Video');
  assert.equal(a.kind, 'Audio');
  assert.equal(trackLength(v), 870);
  assert.equal(trackLength(a), 870);
  const first = v.children[0];
  assert.equal(first.OTIO_SCHEMA, 'Clip.2');
  assert.deepEqual(first.source_range.start_time, { OTIO_SCHEMA: 'RationalTime.1', rate: 60, value: 600 });
  assert.equal(first.source_range.duration.value, 150);
  assert.equal(first.media_references.DEFAULT_MEDIA.target_url, 'file:///media/take%20one.mkv');
  assert.equal(first.media_references.DEFAULT_MEDIA.available_range.duration.value, 7200);
  assert.equal(v.children[2].effects[0].OTIO_SCHEMA, 'LinearTimeWarp.1');
  assert.equal(v.children[2].effects[0].time_scalar, 4);
  assert.equal(v.children[3].effects[0].OTIO_SCHEMA, 'FreezeFrame.1');
  assert.equal(v.children[4].OTIO_SCHEMA, 'Gap.1');
  // audio: the wait, the still and the card are one gap of 6 s
  assert.deepEqual(a.children.map((c) => c.OTIO_SCHEMA), ['Clip.2', 'Clip.2', 'Gap.1', 'Clip.2']);
  assert.equal(a.children[2].source_range.duration.value, 360);
  assert.equal(a.children[3].media_references.DEFAULT_MEDIA.target_url, 'file:///media/all.wav');
  JSON.parse(JSON.stringify(t));
});

test('SRT times', () => {
  assert.equal(srtTime(0), '00:00:00,000');
  assert.equal(srtTime(3725.5), '01:02:05,500');
  assert.equal(srtTime(59.9996), '00:01:00,000');
});

const WORDS = [
  [0.1, 0.4, 'This'], [0.4, 0.6, 'is'], [0.6, 0.9, 'a'], [0.9, 1.3, 'test.'],
  [1.5, 1.7, 'um'], [1.8, 2.1, 'Then'], [2.1, 2.4, 'it'], [2.4, 2.8, 'goes'],
  [4.0, 4.3, 'after'], [4.3, 4.6, 'a'], [4.6, 5.0, 'pause'],
];

test('words into short lines: sentence ends, pauses, no fillers', () => {
  const b = fromWords(WORDS);
  assert.deepEqual(b.map((x) => x.text), ['This is a test.', 'Then it goes', 'after a pause']);
  assert.equal(b[0].at, 0.1);
  assert.ok(b[0].end <= b[1].at);
  assert.ok(isFiller('Um,'));
  const long = fromWords(Array.from({ length: 20 }, (_, i) => [i * 0.3, i * 0.3 + 0.25, 'word']), { maxWords: 5 });
  assert.equal(long.length, 4);
});

test('caption events into blocks', () => {
  const ev = [
    { id: 'L1', kind: 'text', at: 0, end: 2, text: 'A LABEL' },
    { id: 'K2', kind: 'caption', at: 1.8, end: 3, words: [[1.8, 2.1, 'Then'], [2.1, 2.4, 'it'], [2.4, 2.8, 'goes']] },
    { id: 'K1', kind: 'caption', at: 0.05, end: 1.4, words: [[0.1, 0.4, 'This'], [0.4, 0.6, 'is', 1], [0.6, 0.9, 'a'], [0.9, 1.3, 'test.']] },
  ];
  const b = fromCaptionEvents(ev);
  assert.deepEqual(b.map((x) => x.text), ['This is a test.', 'Then it goes']);
});

test('the .srt text: numbered, no overlaps', () => {
  const s = toSrt([{ at: 0, end: 2, text: 'one' }, { at: 1.5, end: 3, text: 'two' }]);
  assert.equal(s, '1\n00:00:00,000 --> 00:00:01,500\none\n\n2\n00:00:01,500 --> 00:00:03,000\ntwo\n');
});

test('captions when they cover the talk, else every word', () => {
  const full = [{ kind: 'caption', at: 0, end: 5.1, words: WORDS.map((w) => [...w]) }];
  assert.equal(coverage(fromCaptionEvents(full), WORDS), 1);
  assert.equal(captionsSrt({ events: full, words: WORDS }).from, 'captions');
  const part = [{ kind: 'caption', at: 3.9, end: 5.1, words: [[4.0, 4.3, 'after']] }];
  assert.equal(captionsSrt({ events: part, words: WORDS }).from, 'words');
  assert.equal(captionsSrt({ events: part, words: [] }).from, 'captions');
});

test('file names', () => {
  assert.equal(slug('Sample: a talk & screen recording!'), 'sample-a-talk-screen-recording');
  assert.equal(slug('Čšž'), 'csz');
  assert.equal(slug('***', 'proj'), 'proj');
});
