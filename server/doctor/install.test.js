import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDir, installYtDlp } from './install.js';

test('a folder is put on PATH once', () => {
  assert.equal(withDir('/a:/b', '/c', ':', false), '/c:/a:/b');
  assert.equal(withDir('/a:/b', '/b/', ':', false), '/a:/b');
  assert.equal(withDir('C:\\A;C:\\B', 'c:\\b', ';', true), 'C:\\A;C:\\B');
});

const fake = (script) => async (cmd, args) => script[`${cmd} ${args.join(' ')}`] || { code: null, out: '', err: 'no such program' };

test('without uv nothing is run and the words say why', async () => {
  const r = await installYtDlp(fake({}), { PATH: '/a' });
  assert.match(r.error, /uv is not installed/);
});

test('a failed install shows the last lines', async () => {
  const r = await installYtDlp(fake({ 'uv --version': { code: 0, out: 'uv 0.5', err: '' }, 'uv tool install yt-dlp': { code: 2, out: '', err: 'network is down' } }), { PATH: '/a' });
  assert.match(r.error, /could not install yt-dlp/);
  assert.match(r.error, /network is down/);
});

test('an install adds the tool folder to PATH', async () => {
  const env = { PATH: '/a' };
  const r = await installYtDlp(fake({
    'uv --version': { code: 0, out: 'uv 0.5', err: '' },
    'uv tool install yt-dlp': { code: 0, out: 'Installed 1 executable: yt-dlp', err: '' },
    'uv tool dir --bin': { code: 0, out: '/home/u/.local/bin\n', err: '' },
  }), env);
  assert.equal(r.ok, true);
  assert.match(env.PATH, /^\/home\/u\/\.local\/bin/);
});
