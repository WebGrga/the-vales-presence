import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { uploadProject, ytStatus, startConnect, finishConnect } from './upload.js';
import { TOKEN_URL, UPLOAD_URL } from './upload-plan.js';

// every temp folder a test makes is removed when the file's tests end
const made = [];
const track = (d) => { made.push(d); return d; };
test.after(async () => { for (const d of made) { try { await fs.rm(d, { recursive: true, force: true }); } catch {} } });

async function project({ title = true } = {}) {
  const dir = track(await fs.mkdtemp(path.join(os.tmpdir(), 'studio-up-')));
  await fs.mkdir(path.join(dir, 'studio', 'thumbs'), { recursive: true });
  await fs.mkdir(path.join(dir, 'video', 'out'), { recursive: true });
  await fs.writeFile(path.join(dir, 'video', 'out', 'final.mp4'), Buffer.alloc(2500, 7));
  await fs.writeFile(path.join(dir, 'studio', 'thumbs', 'a.png'), Buffer.from('png'));
  await fs.writeFile(path.join(dir, 'studio', 'titles.json'), JSON.stringify({ options: [{ id: 't1', title: 'A fine title' }], picked: title ? 't1' : null }));
  await fs.writeFile(path.join(dir, 'studio', 'thumbs', 'options.json'), JSON.stringify({ options: [{ id: 'a', file: 'a.png' }], picked: 'a' }));
  await fs.writeFile(path.join(dir, 'studio', 'upload.json'), JSON.stringify({ description: 'About it', tags: ['x'] }));
  return dir;
}

test('a dry run sends the whole file in chunks and the thumbnail, and nothing leaves', async () => {
  const dir = await project();
  const states = [];
  const s = await uploadProject({ projectDir: dir, dataDir: dir, dry: true, chunk: 1000, fetchImpl: () => { throw new Error('no network in a dry run'); }, onState: (x) => states.push(x.status) });
  assert.equal(s.status, 'done');
  assert.equal(s.videoId, 'DRY_RUN');
  assert.equal(s.dry, true);
  const dryLog = JSON.parse(await fs.readFile(path.join(dir, 'studio', 'upload-dry.json'), 'utf8'));
  assert.deepEqual(dryLog.requests.map((r) => r.method), ['POST', 'PUT', 'PUT', 'PUT', 'POST']);
  assert.deepEqual(dryLog.requests.slice(1, 4).map((r) => r.headers['content-range']), ['bytes 0-999/2500', 'bytes 1000-1999/2500', 'bytes 2000-2499/2500']);
  assert.equal(dryLog.body.status.privacyStatus, 'private');
  assert.equal(dryLog.body.snippet.title, 'A fine title');
  assert.ok(states.includes('uploading'));
  const saved = JSON.parse(await fs.readFile(path.join(dir, 'studio', 'upload.json'), 'utf8'));
  assert.equal(saved.description, 'About it');
  assert.equal(saved.state.status, 'done');
});

test('without a picked title nothing is sent', async () => {
  const dir = await project({ title: false });
  let calls = 0;
  await assert.rejects(uploadProject({ projectDir: dir, dataDir: dir, dry: true, onState: () => calls++ }), /Pick a title/);
  const saved = JSON.parse(await fs.readFile(path.join(dir, 'studio', 'upload.json'), 'utf8'));
  assert.equal(saved.state.status, 'error');
});

test('a real upload refreshes the token, retries a 503 and resumes from what Google has', async () => {
  const dir = await project();
  await fs.writeFile(path.join(dir, 'youtube-client.json'), JSON.stringify({ installed: { client_id: 'cid', client_secret: 'sec' } }));
  await fs.writeFile(path.join(dir, 'youtube-token.json'), JSON.stringify({ access_token: 'old', refresh_token: 'r', expires_at: 1 }));
  const seen = [];
  let failed = false, got = 0;
  const fake = async (url, o = {}) => {
    const h = o.headers || {};
    seen.push(`${o.method} ${String(url).split('?')[0]} ${h['content-range'] || ''}`.trim());
    if (url === TOKEN_URL) { assert.match(o.body, /grant_type=refresh_token/); return Response.json({ access_token: 'new', expires_in: 3600 }); }
    if (url === UPLOAD_URL) { assert.equal(h.authorization, 'Bearer new'); return new Response(null, { status: 200, headers: { location: 'https://up.test/s1' } }); }
    if (url === 'https://up.test/s1') {
      if (h['content-range'] === 'bytes */2500') return new Response(null, { status: 308, headers: { range: `bytes=0-${got - 1}` } });
      if (!failed && h['content-range'] === 'bytes 1000-1999/2500') { failed = true; return new Response(null, { status: 503 }); }
      const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(h['content-range']);
      got = Number(m[2]) + 1;
      return got >= 2500 ? Response.json({ id: 'VID123' }) : new Response(null, { status: 308, headers: { range: `bytes=0-${got - 1}` } });
    }
    if (String(url).includes('thumbnails/set')) return Response.json({});
    throw new Error('unexpected ' + url);
  };
  const s = await uploadProject({ projectDir: dir, dataDir: dir, chunk: 1000, fetchImpl: fake, env: {} });
  assert.equal(s.status, 'done');
  assert.equal(s.url, 'https://youtu.be/VID123');
  assert.deepEqual(seen.filter((x) => x.startsWith('PUT')), ['PUT https://up.test/s1 bytes 0-999/2500', 'PUT https://up.test/s1 bytes 1000-1999/2500', 'PUT https://up.test/s1 bytes */2500', 'PUT https://up.test/s1 bytes 1000-1999/2500', 'PUT https://up.test/s1 bytes 2000-2499/2500']);
  const tok = JSON.parse(await fs.readFile(path.join(dir, 'youtube-token.json'), 'utf8'));
  assert.equal(tok.access_token, 'new');
  assert.equal(tok.refresh_token, 'r');
});

test('connecting: the client file, the consent link, the code exchange', async () => {
  const dir = track(await fs.mkdtemp(path.join(os.tmpdir(), 'studio-yt-')));
  assert.deepEqual(await ytStatus(dir, {}), { client: false, connected: false, dryOnly: false });
  assert.match((await startConnect(dir, '127.0.0.1:4850', {})).error, /youtube-client\.json/);
  await fs.writeFile(path.join(dir, 'youtube-client.json'), JSON.stringify({ installed: { client_id: 'cid', client_secret: 'sec' } }));
  const { url } = await startConnect(dir, '127.0.0.1:4850', {});
  const state = new URL(url).searchParams.get('state');
  const r = await finishConnect(dir, { code: 'c0de', state }, async (u, o) => { assert.match(o.body, /code_verifier=/); return Response.json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }); }, {});
  assert.deepEqual(r, { ok: true });
  assert.equal((await ytStatus(dir, {})).connected, true);
  assert.match((await finishConnect(dir, { code: 'c', state }, null, {})).error, /expired/);
});

test('an expired connection says to connect again and forgets the dead token', async () => {
  const dir = await project();
  await fs.writeFile(path.join(dir, 'youtube-client.json'), JSON.stringify({ installed: { client_id: 'cid', client_secret: 'sec' } }));
  await fs.writeFile(path.join(dir, 'youtube-token.json'), JSON.stringify({ access_token: 'old', refresh_token: 'r', expires_at: 1 }));
  const fake = async () => Response.json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, { status: 400 });
  await assert.rejects(uploadProject({ projectDir: dir, dataDir: dir, fetchImpl: fake, env: {} }), /Connect YouTube again/);
  assert.equal((await ytStatus(dir, {})).connected, false);
});
