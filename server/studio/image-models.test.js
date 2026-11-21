import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModels, tokenize, fillCommand, pickModel, publicList } from './image-models.js';

const base = { models: [
  { id: 'local-a', kind: 'local', command: 'uv run --script "{app}/a b.py" {prompt} --out {out} --w {width} --h {height}' },
  { id: 'api-b', kind: 'api', env: ['B_KEY'], command: ['python', 'api.py', '{prompt}', '{out}'] },
] };

test('the user overlay turns a model on by id', () => {
  const ms = loadModels(base, { models: [{ id: 'local-a', enabled: true }, { id: 'mine', command: 'x {out}' }] });
  assert.deepEqual(ms.map((m) => [m.id, m.enabled]), [['local-a', true], ['api-b', false], ['mine', false]]);
  assert.equal(ms[0].command, base.models[0].command);
});

test('tokenize respects quotes', () => {
  assert.deepEqual(tokenize(`a "b c" 'd' "" e`), ['a', 'b c', 'd', '', 'e']);
});

test('a prompt with spaces and quotes stays one argument', () => {
  const [m] = loadModels(base);
  const args = fillCommand(m, { prompt: 'a "red" desk; rm -rf', out: 'o.png', width: 1344, height: 768, app: '/app' });
  assert.deepEqual(args, ['uv', 'run', '--script', '/app/a b.py', 'a "red" desk; rm -rf', '--out', 'o.png', '--w', '1344', '--h', '768']);
  assert.deepEqual(fillCommand(loadModels(base)[1], { prompt: 'p', out: 'o' }), ['python', 'api.py', 'p', 'o']);
  assert.equal(fillCommand({ command: '' }, {}), null);
});

test('a model runs only when enabled and its keys exist', () => {
  const ms = loadModels(base, { models: [{ id: 'api-b', enabled: true }] });
  assert.match(pickModel(ms, 'local-a', {}).error, /not enabled/);
  assert.match(pickModel(ms, 'api-b', {}).error, /B_KEY/);
  assert.equal(pickModel(ms, 'api-b', { B_KEY: 'k' }).model.id, 'api-b');
  assert.match(pickModel(ms, 'zzz', {}).error, /No image model/);
  assert.deepEqual(publicList(ms, { B_KEY: 'k' }).map((m) => m.ready), [false, true]);
  assert.equal('command' in publicList(ms, {})[0], false);
});
