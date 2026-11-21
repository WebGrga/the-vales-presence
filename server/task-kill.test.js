// The rules that find and end a background task's whole process tree (no process is started or killed here).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRows, needleOf, shellsFor, treeOf } from './task-kill.js';

const rows = [
  { pid: 1, ppid: 0, name: 'node.exe', cmd: 'node server/index.js' },
  { pid: 2, ppid: 1, name: 'claude.exe', cmd: 'claude.exe --output-format stream-json' },
  { pid: 3, ppid: 2, name: 'bash.exe', cmd: 'bash.exe -c "source snap.sh && eval \'sleep 300\' < /dev/null"' },
  { pid: 4, ppid: 3, name: 'bash.exe', cmd: 'bash.exe -c "source snap.sh && eval \'sleep 300\' < /dev/null"' },
  { pid: 5, ppid: 99, name: 'sleep.exe', cmd: 'sleep 300' },
  { pid: 6, ppid: 4, name: 'ffmpeg.exe', cmd: 'ffmpeg -i a.mp4' },
  { pid: 7, ppid: 2, name: 'bash.exe', cmd: 'bash.exe -c "eval \'other thing\'"' },
];

test('the needle is a quote-free piece of the first line', () => {
  assert.equal(needleOf('sleep 300'), 'sleep 300');
  assert.equal(needleOf("echo 'a'"), '');
  assert.equal(needleOf('ping -n 90 127.0.0.1\nnext'), 'ping -n 90 127.0.0.1');
  assert.equal(needleOf('ls'), '');
});

test('shells are found by the command they were given, never the asking process', () => {
  assert.deepEqual(shellsFor(rows, 'sleep 300'), [3, 4]);
  assert.deepEqual(shellsFor(rows, 'sleep 300', [3]), [4]);
  assert.deepEqual(shellsFor(rows, 'nothing here at all'), []);
});

test('the tree goes from the bottom up and holds only what is below the roots', () => {
  const t = treeOf(rows, [3]);
  assert.deepEqual(t, [6, 4, 3]);
});

test('Windows rows come from PowerShell JSON, one row or many', () => {
  const one = parseRows('{"ProcessId":4,"ParentProcessId":1,"Name":"a.exe","CommandLine":null}', true);
  assert.deepEqual(one, [{ pid: 4, ppid: 1, name: 'a.exe', cmd: '', born: 0 }]);
  assert.equal(parseRows('[{"ProcessId":1},{"ProcessId":2}]', true).length, 2);
  assert.deepEqual(parseRows('  12   1 /bin/bash -c x\n', false)[0], { pid: 12, ppid: 1, name: 'bash', cmd: '/bin/bash -c x', born: 0 });
});

test('an orphan with the same command, born after the task started, is found; others are not', async () => {
  const { orphansFor, plainCmd } = await import('./task-kill.js');
  assert.equal(plainCmd('"C:/Program Files/Git/usr/bin/sleep.exe" 300'), 'sleep 300');
  const rs = [
    { pid: 1, ppid: 0, name: 'node.exe', cmd: 'node', born: 1000 },
    { pid: 9, ppid: 77, name: 'sleep.exe', cmd: '"C:/Program Files/Git/usr/bin/sleep.exe" 300', born: 5000 }, // orphan, after the start
    { pid: 8, ppid: 77, name: 'sleep.exe', cmd: '"C:/Program Files/Git/usr/bin/sleep.exe" 300', born: 100 }, // orphan, older
    { pid: 7, ppid: 1, name: 'sleep.exe', cmd: 'sleep 300', born: 5000 }, // has a parent
  ];
  assert.deepEqual(orphansFor(rs, 'sleep 300', 4000), [9]);
  assert.deepEqual(orphansFor(rs, 'sleep 300', 0), []);
});
