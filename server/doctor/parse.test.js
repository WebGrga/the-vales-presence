import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as P from './parse.js';

test('os names', () => {
  assert.equal(P.osOf('win32'), 'win');
  assert.equal(P.osOf('darwin'), 'mac');
  assert.equal(P.osOf('linux'), 'linux');
});

test('node 22 or newer', () => {
  assert.equal(P.judgeNode('22.0.0').status, 'ok');
  assert.equal(P.judgeNode('v24.1.3').status, 'ok');
  assert.equal(P.judgeNode('20.18.1').status, 'fail');
  assert.equal(P.judgeNode('').status, 'fail');
});

test('ffmpeg and ffprobe versions', () => {
  assert.equal(P.ffVersion('ffmpeg version 7.1-full_build-www.example Copyright (c) 2000-2024'), '7.1-full_build-www.example');
  assert.equal(P.ffVersion('ffprobe version n6.1.1 Copyright'), 'n6.1.1');
  assert.equal(P.judgeFf('ffmpeg version 7.1 x', 'ffprobe version 7.1 x').status, 'ok');
  const j = P.judgeFf('ffmpeg version 7.1 x', '');
  assert.equal(j.status, 'fail');
  assert.match(j.why, /ffprobe/);
});

test('uv', () => {
  assert.equal(P.judgeUv('uv 0.5.11 (c4d0caaee 2024-12-19)').found, 'uv 0.5.11');
  assert.equal(P.judgeUv('').status, 'fail');
});

test('python with numpy and Pillow', () => {
  assert.deepEqual(P.parsePython('PY 3.12.4 NUMPY 2.1.0 PIL 11.0.0\n'), { python: '3.12.4', numpy: '2.1.0', pil: '11.0.0' });
  assert.equal(P.parsePython('Python was not found; run without arguments to install from the Microsoft Store'), null);
  assert.equal(P.judgePython(P.parsePython('PY 3.12.4 NUMPY 2.1.0 PIL 11.0.0'), 'python').status, 'ok');
  const noPil = P.judgePython(P.parsePython('PY 3.12.4 NUMPY 2.1.0 PIL -'), 'python3');
  assert.equal(noPil.status, 'fail');
  assert.match(noPil.why, /Pillow/);
  assert.equal(P.judgePython(P.parsePython('PY 3.8.10 NUMPY 1.2 PIL 9'), 'python').status, 'fail');
  assert.equal(P.judgePython(null).status, 'fail');
});

test('the probe prints what parsePython reads', () => {
  assert.match(P.PY_PROBE, /print\('PY'/);
});

test('nvidia-smi lines', () => {
  assert.deepEqual(P.parseNvidiaSmi('NVIDIA GeForce RTX 3060, 12288 MiB, 560.94\n'), [{ name: 'NVIDIA GeForce RTX 3060', memory: '12288 MiB', driver: '560.94' }]);
  assert.deepEqual(P.parseNvidiaSmi('NVIDIA-SMI has failed because it could not communicate with the NVIDIA driver.'), []);
  assert.deepEqual(P.parseNvidiaSmi(''), []);
});

test('GPU names from the OS', () => {
  assert.equal(P.otherGpuName('win', 'Intel(R) UHD Graphics 620\r\nMicrosoft Basic Display Adapter\r\n'), 'Intel(R) UHD Graphics 620');
  assert.equal(P.otherGpuName('mac', 'Graphics/Displays:\n\n    Apple M2:\n\n      Chipset Model: Apple M2\n      Type: GPU\n'), 'Apple M2');
  assert.equal(P.otherGpuName('linux', '00:02.0 VGA compatible controller: Intel Corporation UHD Graphics 620 (rev 07)\n00:1f.3 Audio device: Intel'), 'Intel Corporation UHD Graphics 620 (rev 07)');
});

test('encoders: listed ones in the preferred order, then the judge', () => {
  const out = [
    'Encoders:', ' V..... = Video', ' ------',
    ' V....D libx264              libx264 H.264 / AVC',
    ' V....D h264_amf             AMD AMF H.264 Encoder',
    ' V....D h264_nvenc           NVIDIA NVENC H.264 encoder',
    ' A....D aac                  AAC (Advanced Audio Coding)',
  ].join('\n');
  const listed = P.listedEncoders(out);
  assert.ok(listed.has('libx264') && listed.has('aac'));
  assert.ok(!listed.has('='));
  assert.deepEqual(P.encoderCandidates(listed), ['h264_nvenc', 'h264_amf']);

  const nv = P.judgeGpu({ gpus: [{ name: 'NVIDIA GeForce RTX 3060', memory: '12288 MiB' }], encoder: 'h264_nvenc' });
  assert.equal(nv.status, 'ok');
  assert.match(nv.found, /NVENC/);
  assert.match(nv.found, /CUDA/);
  const cpu = P.judgeGpu({ gpus: [], other: 'Intel UHD', encoder: null, cpu264: true });
  assert.equal(cpu.status, 'warn');
  assert.equal(cpu.encoder, 'libx264');
  assert.equal(P.judgeGpu({ encoder: null, cpu264: false }).status, 'fail');
  assert.match(P.judgeGpu({ gpus: [], other: '', encoder: 'h264_videotoolbox' }).found, /VideoToolbox.*CPU/);
});

test('Claude login, never the email', () => {
  const sub = P.judgeAccount({ email: 'someone@example.com', subscriptionType: 'Claude Pro', apiProvider: 'firstParty' }, '2.0.1');
  assert.equal(sub.status, 'ok');
  assert.match(sub.found, /Claude Pro/);
  assert.doesNotMatch(JSON.stringify(sub), /example\.com/);
  assert.equal(P.judgeAccount({ apiKeySource: 'ANTHROPIC_API_KEY' }).status, 'ok');
  assert.equal(P.judgeAccount({ apiProvider: 'bedrock' }).status, 'ok');
  assert.equal(P.judgeAccount({ apiKeySource: 'none', tokenSource: 'none', apiProvider: 'firstParty' }).status, 'fail');
  assert.equal(P.judgeAccount(null).status, 'fail');
});

test('disk space', () => {
  const GB = 1024 ** 3;
  assert.equal(P.judgeDisk(200 * GB).status, 'ok');
  assert.equal(P.judgeDisk(12 * GB).status, 'warn');
  assert.equal(P.judgeDisk(2 * GB).status, 'fail');
  assert.equal(P.judgeDisk(null).status, 'warn');
});

test('remotion installed in engine/remotion', () => {
  assert.equal(P.judgeRemotion({ hasPackage: false }).status, 'fail');
  assert.equal(P.judgeRemotion({ hasPackage: true, wanted: '4.0.535', installed: null }).status, 'fail');
  assert.equal(P.judgeRemotion({ hasPackage: true, wanted: '4.0.535', installed: '4.0.535' }).status, 'ok');
  assert.equal(P.judgeRemotion({ hasPackage: true, wanted: '4.0.535', installed: '4.0.400' }).status, 'warn');
  assert.equal(P.judgeRemotion({ hasPackage: true, wanted: '^4.0.0', installed: '4.0.400' }).status, 'ok');
});

test('summary: only required failures block', () => {
  const s = P.summarise([
    { id: 'a', required: true, status: 'ok' },
    { id: 'b', required: true, status: 'fail' },
    { id: 'gpu', required: false, status: 'warn' },
  ]);
  assert.deepEqual(s, { ok: false, missing: ['b'], warnings: ['gpu'] });
  assert.equal(P.summarise([{ id: 'gpu', required: false, status: 'fail' }]).ok, true);
});

test('every check has a fix for every OS', () => {
  const fixes = JSON.parse(fs.readFileSync(new URL('./fixes.json', import.meta.url), 'utf8'));
  for (const id of ['node', 'ffmpeg', 'uv', 'python', 'gpu', 'claude', 'sdk', 'disk', 'remotion', 'ytdlp']) {
    for (const os of ['win', 'mac', 'linux']) {
      const f = P.fixFor(fixes, id, os);
      assert.ok(f && f.text, `${id} on ${os}`);
    }
  }
  assert.deepEqual(P.fixFor(fixes, 'ffmpeg', 'mac').cmds, ['brew install ffmpeg']);
  assert.equal(P.fixFor(fixes, 'nope', 'win'), null);
});

test('yt-dlp: optional, says which command answered', () => {
  assert.equal(P.ytDlpVersion('2025.01.15\n'), '2025.01.15');
  assert.equal(P.ytDlpVersion('No module named yt_dlp'), null);
  const ok = P.judgeYtDlp({ how: 'python -m yt_dlp', version: '2025.01.15' });
  assert.equal(ok.status, 'ok');
  assert.match(ok.found, /2025\.01\.15.*python -m yt_dlp/);
  const uvx = P.judgeYtDlp({ uvx: true });
  assert.equal(uvx.status, 'warn');
  assert.match(uvx.why, /downloads yt-dlp the first time/);
  const none = P.judgeYtDlp({});
  assert.equal(none.status, 'warn');
  assert.equal(none.fixId, 'ytdlp');
  // never required: its absence leaves the studio ok, and shows as a warning
  const s = P.summarise([{ id: 'ytdlp', required: false, status: 'warn' }]);
  assert.equal(s.ok, true);
  assert.deepEqual(s.warnings, ['ytdlp']);
});
