import test from 'node:test';
import assert from 'node:assert/strict';
import routes from './context.js';
import { fixture } from '../context/fixture.js';

// a fake ctx and request, the shape server/index.js hands to every route
function call(f, method, url, body) {
  const r = routes.find((x) => x.method === method && (x.path instanceof RegExp ? x.path.test(url) : x.path === url));
  if (!r) return Promise.resolve({ status: 404 });
  const out = { sent: [] };
  const ctx = {
    root: f.root, dataDir: f.dataDir, home: f.home,
    readJson: async () => body,
    send: (res, status, obj) => { out.status = status; out.body = obj; },
    broadcast: (m) => out.sent.push(m),
  };
  return r.handler({ url, method }, {}, ctx).then(() => out);
}

test('routes match with or without a query, and only their own path', () => {
  const get = routes.filter((r) => r.method === 'GET');
  assert.ok(get[0].path.test('/api/context'));
  assert.ok(get[0].path.test('/api/context?project=p1'));
  assert.ok(!get[0].path.test('/api/context/node'));
  assert.ok(!get[0].path.test('/api/contexts'));
});

test('GET the map and a node, POST a save that broadcasts', async (t) => {
  const f = fixture(); t.after(f.done);
  const map = await call(f, 'GET', '/api/context?project=p1');
  assert.equal(map.status, 200);
  assert.deepEqual(map.body.columns.map((c) => c.id), ['ask', 'rough', 'rough-review', 'visuals', 'studio']);
  const node = await call(f, 'GET', '/api/context/node?id=brief&project=p1');
  assert.equal(node.body.node.text, 'A fake brief of six words.\n');
  const save = await call(f, 'POST', '/api/context/save', { id: 'brief', project: 'p1', text: 'new brief', baseMtime: node.body.node.mtime });
  assert.equal(save.body.ok, true);
  assert.deepEqual(save.sent, [{ type: 'context' }]);
  const bad = await call(f, 'POST', '/api/context/save', { id: 'nope', text: 'x' });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.sent, []);
});

test('the stage preview names the skills and the instructions', async (t) => {
  const f = fixture(); t.after(f.done);
  const r = await call(f, 'GET', '/api/context/stage?project=p1&stage=rough');
  assert.equal(r.body.instructions, 'Make the files.\n\nCut the talk.');
  assert.match(r.body.text, /alpha-skill/);
  assert.deepEqual(r.body.missing, ['gone-skill']);
  assert.equal((await call(f, 'GET', '/api/context/stage?project=p1&stage=nope')).status, 400);
});
