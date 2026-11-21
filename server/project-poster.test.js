import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { choosePoster, findPosterInputs } from './project-poster.js';

test('the poster: thumbnail, then final, then rough, then the first recording', () => {
  assert.deepEqual(choosePoster({ thumb: 'studio/thumbs/a.png', final: true, rough: true, footage: ['a.mkv'] }), { kind: 'thumbnail', rel: 'studio/thumbs/a.png' });
  assert.deepEqual(choosePoster({ final: true, rough: true, footage: ['a.mkv'] }), { kind: 'final', rel: 'video/out/final.mp4' });
  assert.deepEqual(choosePoster({ rough: true, footage: ['a.mkv'] }), { kind: 'rough', rel: 'video/out/rough.mp4' });
  assert.deepEqual(choosePoster({ footage: ['notes.txt', 'take 10.mp4', 'take 2.mp4'] }), { kind: 'footage', rel: 'video/footage/take 2.mp4' });
  assert.deepEqual(choosePoster({ footage: ['b.png', 'voice.wav'] }), { kind: 'footage', rel: 'video/footage/b.png' });
  assert.deepEqual(choosePoster({ footage: ['voice.wav'] }), { kind: 'none' });
  assert.deepEqual(choosePoster({}), { kind: 'none' });
});

test('the picked thumbnail is found only when its file is there', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'poster-'));
  fs.mkdirSync(path.join(d, 'studio', 'thumbs'), { recursive: true });
  fs.writeFileSync(path.join(d, 'studio', 'thumbs', 'options.json'), JSON.stringify({ options: [{ id: 'a', file: 'a.png' }, { id: 'b', file: '../x.png' }], picked: 'a' }));
  assert.equal(findPosterInputs(d).thumb, null);
  fs.writeFileSync(path.join(d, 'studio', 'thumbs', 'a.png'), 'x');
  assert.equal(findPosterInputs(d).thumb, 'studio/thumbs/a.png');
  fs.rmSync(d, { recursive: true, force: true });
});
