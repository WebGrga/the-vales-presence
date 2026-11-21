import test from 'node:test';
import assert from 'node:assert/strict';
import { shortPath, shortCommand, toolLine, fireLabel } from './agent-lines.js';

const ID = 'my-video';
const HOME = 'C:/Users/someone/apps/presence/data/projects/my-video';

test('paths are shown relative to the project', () => {
  assert.equal(shortPath(`${HOME}/video/out/edl.json`, ID), 'video/out/edl.json');
  assert.equal(shortPath(HOME.replace(/\//g, '\\') + '\\brief.md', ID), 'brief.md');
  assert.equal(shortPath(HOME, ID), '.');
  assert.equal(shortPath('/home/someone/presence/engine/build_rough.py', ID), '…/presence/engine/build_rough.py');
  assert.equal(shortPath('video/out/rough.mp4', ID), 'video/out/rough.mp4');
});

test('commands lose their full paths', () => {
  assert.equal(shortCommand(`cd "${HOME}" && python "C:/Users/someone/apps/presence/engine/transcribe.py" --video "${HOME}/video"`, ID),
    'python "…/presence/engine/transcribe.py" --video "video"');
  assert.equal(shortCommand(`ls ${HOME}/video/out`, ID), 'ls video/out');
});

test('a tool row says what the agent meant', () => {
  assert.deepEqual(toolLine('Bash', { command: `cd "${HOME}" && python transcribe.py`, description: 'Transcribe the recording' }, ID),
    { title: 'Transcribe the recording', detail: 'python transcribe.py', background: false });
  assert.equal(toolLine('Bash', { command: 'ls video/out' }, ID).title, 'ls video/out');
  assert.equal(toolLine('Read', { file_path: `${HOME}/video/out/cuts.json` }, ID).title, 'Reads video/out/cuts.json');
  assert.equal(toolLine('Edit', { file_path: `${HOME}/brief.md` }, ID).title, 'Edits brief.md');
  assert.equal(toolLine('WebFetch', { url: 'https://example.com/a/b', prompt: 'p' }, ID).title, 'Reads example.com');
  assert.equal(toolLine('Grep', { pattern: 'um' }, ID).title, 'Searches for “um”');
  assert.equal(toolLine('Mystery', { description: 'Does a thing' }, ID).title, 'Does a thing');
  assert.equal(toolLine('Mystery', null, ID).title, 'Mystery');
});

test('background tasks are named', () => {
  assert.equal(fireLabel('python transcribe.py', ''), 'Transcribing');
  assert.equal(fireLabel('npx remotion render', ''), 'Rendering');
  assert.equal(fireLabel('python find_private.py', ''), 'Scanning the frames');
  assert.equal(fireLabel('sleep 5', ''), 'Working in the background');
  assert.equal(fireLabel('anything', 'Build the rough'), 'Build the rough');
});
