import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadFields, buildMeta, clientFrom, pkce, authUrl, redirectFor, storeToken, tokenFresh, contentRange, nextOffset, chunkAt, retryable } from './upload-plan.js';

test('defaults: private, not for kids, the final video', () => {
  const f = uploadFields({});
  assert.equal(f.privacy, 'private');
  assert.equal(f.madeForKids, false);
  assert.equal(f.video, 'video/out/final.mp4');
  assert.equal(uploadFields({ privacy: 'everyone' }).privacy, 'private');
  assert.equal(uploadFields({ video: '../../x.mp4' }).video, 'video/out/final.mp4');
  assert.equal(uploadFields({ video: 'C:/x.mp4' }).video, 'video/out/final.mp4');
  assert.equal(uploadFields({ video: 'video\\out\\a.mp4' }).video, 'video/out/a.mp4');
  assert.deepEqual(uploadFields({ tags: 'a, b ,,c' }).tags, ['a', 'b', 'c']);
});

test('the metadata body', () => {
  const { body, errors } = buildMeta({ description: 'd', tags: ['x'], privacy: 'unlisted', synthetic: true }, '  My title ');
  assert.deepEqual(errors, []);
  assert.deepEqual(body, { snippet: { title: 'My title', description: 'd', tags: ['x'], categoryId: '22' }, status: { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false, containsSyntheticMedia: true } });
});

test('the checks say what is wrong in plain words', () => {
  assert.match(buildMeta({}, '').errors[0], /Pick a title/);
  assert.match(buildMeta({}, 'x'.repeat(101)).errors[0], /100/);
  assert.match(buildMeta({ description: 'a <b>' }, 't').errors[0], /description/);
  assert.match(buildMeta({ tags: Array(60).fill('abcdefghij') }, 't').errors[0], /500/);
  assert.match(buildMeta({ privacy: 'public', publishAt: '2030-01-01T10:00:00Z' }, 't').errors[0], /private/);
  const ok = buildMeta({ publishAt: '2030-01-01T10:00:00Z' }, 't');
  assert.equal(ok.body.status.publishAt, '2030-01-01T10:00:00.000Z');
});

test('the OAuth client from the downloaded file or the environment', () => {
  assert.deepEqual(clientFrom({ installed: { client_id: 'i', client_secret: 's' } }), { id: 'i', secret: 's' });
  assert.deepEqual(clientFrom(null, { YOUTUBE_CLIENT_ID: 'e', YOUTUBE_CLIENT_SECRET: 'f' }), { id: 'e', secret: 'f' });
  assert.equal(clientFrom({}), null);
});

test('the consent URL asks only to upload, offline, with PKCE', () => {
  const p = pkce();
  const u = new URL(authUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:4848/api/studio/youtube/callback', state: p.state, challenge: p.challenge }));
  assert.equal(u.searchParams.get('scope'), 'https://www.googleapis.com/auth/youtube.upload');
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(p.challenge.length, 43);
});

test('the redirect is the loopback on our port, never another host', () => {
  assert.equal(redirectFor('127.0.0.1:4850'), 'http://127.0.0.1:4850/api/studio/youtube/callback');
  assert.equal(redirectFor('localhost:4848'), 'http://127.0.0.1:4848/api/studio/youtube/callback');
  assert.equal(redirectFor('evil.example:4848'), null);
});

test('tokens keep the refresh token and know when they expire', () => {
  const t = storeToken({ refresh_token: 'r' }, { access_token: 'a', expires_in: 3600 }, 1000);
  assert.deepEqual(t, { access_token: 'a', refresh_token: 'r', expires_at: 3601000, scope: 'https://www.googleapis.com/auth/youtube.upload' });
  assert.equal(tokenFresh(t, 1000), true);
  assert.equal(tokenFresh(t, 3600000), false);
  assert.equal(tokenFresh(null), false);
});

test('byte ranges of the resumable upload', () => {
  assert.equal(contentRange(0, 9, 100), 'bytes 0-9/100');
  assert.equal(nextOffset('bytes=0-1048575'), 1048576);
  assert.equal(nextOffset(undefined), 0);
  assert.deepEqual(chunkAt(0, 10, 4), { start: 0, end: 3, length: 4 });
  assert.deepEqual(chunkAt(8, 10, 4), { start: 8, end: 9, length: 2 });
  assert.equal(retryable(503), true); assert.equal(retryable(400), false); assert.equal(retryable(429), true);
});
