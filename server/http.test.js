import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { byteRange, mimeOf, safeJoin, matchRoute } from './http.js';

test('byteRange', () => {
  assert.equal(byteRange(undefined, 100), null);
  assert.deepEqual(byteRange('bytes=0-9', 100), { start: 0, end: 9 });
  assert.deepEqual(byteRange('bytes=90-', 100), { start: 90, end: 99 });
  assert.deepEqual(byteRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(byteRange('bytes=50-500', 100), { start: 50, end: 99 });
  assert.deepEqual(byteRange('bytes=100-', 100), { bad: true });
  assert.deepEqual(byteRange('bytes=9-1', 100), { bad: true });
  assert.equal(byteRange('items=1-2', 100), null);
});

test('mimeOf', () => {
  assert.equal(mimeOf('a/b.MP4'), 'video/mp4');
  assert.match(mimeOf('x.js'), /javascript/);
  assert.equal(mimeOf('x.woff2'), 'font/woff2');
  assert.equal(mimeOf('x.unknown'), 'application/octet-stream');
});

test('safeJoin stays inside the base', () => {
  const base = path.resolve('/tmp/proj');
  assert.equal(safeJoin(base, 'video/out/rough.mp4'), path.join(base, 'video', 'out', 'rough.mp4'));
  assert.equal(safeJoin(base, 'video%2Fout%2Fa%20b.mp4'), path.join(base, 'video', 'out', 'a b.mp4'));
  assert.equal(safeJoin(base, '../x'), null);
  assert.equal(safeJoin(base, 'video/../../x'), null);
  assert.equal(safeJoin(base, '%2e%2e/x'), null);
  assert.equal(safeJoin(base, 'video\\..\\..\\x'), null);
  assert.equal(safeJoin(base, 'C:/Windows'), null);
  assert.equal(safeJoin(base, 'a\0b'), null);
  assert.equal(safeJoin(base, '%E0%A4%A'), null);
  assert.equal(safeJoin(base, ''), base);
});

test('matchRoute: exact first, then RegExps with groups', () => {
  const h = () => {};
  const routes = [
    { method: 'GET', path: /^\/api\/projects\/([a-z]+)$/, handler: h, n: 1 },
    { method: 'GET', path: '/api/projects/new', handler: h, n: 2 },
    { method: 'POST', path: /^\/api\/x\/(?<id>\w+)\/go$/, handler: h, n: 3 },
  ];
  assert.equal(matchRoute(routes, 'GET', '/api/projects/new').route.n, 2);
  const m = matchRoute(routes, 'GET', '/api/projects/abc');
  assert.equal(m.route.n, 1);
  assert.deepEqual(m.params, ['abc']);
  assert.deepEqual(matchRoute(routes, 'POST', '/api/x/p1/go').params, { id: 'p1' });
  assert.equal(matchRoute(routes, 'GET', '/api/x/p1/go'), null);
  assert.equal(matchRoute(routes, 'HEAD', '/api/projects/new').route.n, 2);
});
