import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediaPaths, projectPath, questionMedia } from './agent-media.js';

test('a path of a video or a picture in the text is found', () => {
  assert.deepEqual(mediaPaths('Look at video/out/proof.mp4 first.', 'a'), [{ path: 'video/out/proof.mp4', kind: 'video' }]);
  assert.deepEqual(mediaPaths('the sheet is `video/out/proof-sheet.jpg`.', 'a'), [{ path: 'video/out/proof-sheet.jpg', kind: 'image' }]);
  assert.deepEqual(mediaPaths('("studio/thumbs/one.PNG")', 'a'), [{ path: 'studio/thumbs/one.PNG', kind: 'image' }]);
});
test('several paths come once each, in order', () => {
  const r = mediaPaths('video/out/proof.mp4, then video/out/proof-sheet.jpg and video/out/proof.mp4 again', 'a');
  assert.deepEqual(r.map((x) => x.path), ['video/out/proof.mp4', 'video/out/proof-sheet.jpg']);
  assert.equal(mediaPaths('a.png b.png c.png d.png e.png', 'a').length, 4);
});
test('windows paths and ./ become project paths', () => {
  assert.equal(mediaPaths('.\\video\\out\\proof.mp4', 'a')[0].path, 'video/out/proof.mp4');
});
test('an absolute path counts only inside this project', () => {
  assert.equal(projectPath('C:\\Users\\me\\data\\projects\\my-vid\\video\\out\\proof.mp4', 'my-vid'), 'video/out/proof.mp4');
  assert.equal(projectPath('C:\\Users\\me\\data\\projects\\other\\video\\out\\proof.mp4', 'my-vid'), null);
  assert.equal(projectPath('/etc/passwd.png', 'my-vid'), null);
  assert.equal(projectPath('~/pic.png', 'my-vid'), null);
});
test('a path that leaves the project, or a web address, is left alone', () => {
  assert.deepEqual(mediaPaths('../secret/a.png', 'a'), []);
  assert.deepEqual(mediaPaths('video/../../x.mp4', 'a'), []);
  assert.deepEqual(mediaPaths('see https://example.com/x/clip.mp4 online', 'a'), []);
});
test('other files and plain words are not media', () => {
  assert.deepEqual(mediaPaths('video/out/events.json and notes.md. Is this it?', 'a'), []);
  assert.deepEqual(mediaPaths('', 'a'), []);
  assert.deepEqual(mediaPaths(null, 'a'), []);
});
test('a question gives the media of its text and of its options', () => {
  const q = { header: 'Look', question: 'Is video/out/proof.mp4 the look you want?', options: [{ label: 'This is it' }, { label: 'Try a different way', description: 'like studio/ref/other.jpg' }] };
  assert.deepEqual(questionMedia(q, 'a').map((x) => x.path), ['video/out/proof.mp4', 'studio/ref/other.jpg']);
  assert.deepEqual(questionMedia({ question: 'Which?', options: ['A', 'B'] }, 'a'), []);
});
