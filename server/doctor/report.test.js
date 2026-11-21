import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrub, reportText } from './report.js';

const env = { home: 'C:\\Users\\Sam Example', user: 'Sam Example', folders: { app: 'C:\\Users\\Sam Example\\code\\presence', data: 'D:\\vale-data' } };

test('the home folder becomes ~ in every slash style and the app and data folders are named', () => {
  assert.equal(scrub('ffmpeg at C:\\Users\\Sam Example\\bin\\ffmpeg.exe', env), 'ffmpeg at ~\\bin\\ffmpeg.exe');
  assert.equal(scrub('c:/users/sam example/bin/x', env), '~/bin/x');
  assert.equal(scrub('C:\\Users\\Sam Example\\code\\presence\\craft', env), '<app>/craft');
  assert.equal(scrub('D:\\vale-data\\projects', env), '<data>/projects');
});

test('the report lists versions and checks and leaks no path or name', () => {
  const doctor = { os: 'win', at: '2026-11-21T10:00:00Z', checks: [
    { title: 'Node', required: true, status: 'ok', found: 'v22.1 at C:\\Users\\Sam Example\\node.exe' },
    { title: 'yt-dlp (research only)', required: false, status: 'fail', found: 'not found', why: 'Run by Sam Example' },
  ] };
  const t = reportText(doctor, { ...env, node: '22.1.0', platform: 'win32', arch: 'x64' });
  assert.match(t, /\[OK  \] Node: v22\.1 at ~\\node\.exe/);
  assert.match(t, /\[MISS\] yt-dlp \(research only\) \(optional\): not found/);
  assert.doesNotMatch(t, /Sam|Example|Users/);
});
