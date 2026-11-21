import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameOf, failWords } from './viewer-fail.js';

const files = [{ name: 'talk.mp4', missing: true }, { name: 'b-roll.mp4' }];

test('the file name comes from the media address', () => {
  assert.equal(nameOf('http://x/api/media/p/video/footage/my%20talk.mp4?v=1'), 'my talk.mp4');
  assert.equal(nameOf(''), '');
});
test('a missing linked recording is named', () => {
  assert.match(failWords('http://x/api/media/p/video/footage/talk.mp4', files), /“talk\.mp4” is missing/);
});
test('another failing file still names the missing recordings', () => {
  const t = failWords('http://x/api/media/p/video/out/proxy/x.mp4', files);
  assert.match(t, /“talk\.mp4” is missing/);
  assert.match(t, /“x\.mp4”/);
});
test('nothing missing: a plain note', () => {
  assert.match(failWords('http://x/a/b.mp4', [{ name: 'b.mp4' }]), /could not play here/);
});
