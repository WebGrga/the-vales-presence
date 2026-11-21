import test from 'node:test';
import assert from 'node:assert/strict';
import { statusOf, badgeOf, sortProjects, filterProjects, split, initials, ago, sameTitle } from './home-logic.js';

const P = (id, o = {}) => ({ id, title: id, recipe: 'edit', created: '2026-01-01T00:00:00Z', ...o });

test('the badge comes from the project view, stopped before everything', () => {
  assert.equal(statusOf(P('a', { view: { halted: 'why', running: {} } })), 'stopped');
  assert.equal(statusOf(P('a', { view: { done: true } })), 'finished');
  assert.equal(statusOf(P('a', { view: { running: { stage: 'x' } } })), 'working');
  assert.equal(statusOf(P('a', { view: { queued: { stage: 'x' } } })), 'queued');
  assert.equal(statusOf(P('a', { view: { waiting: { for: 'approve' } } })), 'waiting');
  assert.equal(statusOf(P('a', { view: {} })), 'ready');
  assert.equal(statusOf(P('a')), 'ready');
});

test('sort by recent, name, recipe and status', () => {
  const l = [P('b', { updated: '2026-02-01T00:00:00Z' }), P('a', { opened: '2026-03-01T00:00:00Z' }), P('c', { recipe: 'short', view: { waiting: {} } })];
  assert.deepEqual(sortProjects(l, 'recent').map((p) => p.id), ['a', 'b', 'c']);
  assert.deepEqual(sortProjects(l, 'name').map((p) => p.id), ['a', 'b', 'c']);
  assert.deepEqual(sortProjects(l, 'recipe', (r) => (r === 'edit' ? 'Edit a video' : 'Edit a Short')).map((p) => p.id), ['c', 'a', 'b']);
  assert.deepEqual(sortProjects(l, 'status').map((p) => p.id)[0], 'c');
});

test('search needs every word; the recipe filter is exact', () => {
  const l = [P('a', { title: 'Trip to Rome' }), P('b', { title: 'Rome trip, shorts', recipe: 'short' }), P('c', { title: 'Kitchen' })];
  assert.deepEqual(filterProjects(l, { q: 'rome trip' }).map((p) => p.id), ['a', 'b']);
  assert.deepEqual(filterProjects(l, { q: 'rome', recipe: 'short' }).map((p) => p.id), ['b']);
  assert.deepEqual(filterProjects(l, { q: 'xyz' }), []);
  assert.equal(filterProjects(l, {}).length, 3);
});

test('every project is in one group only: pinned first, then the rest', () => {
  const l = [P('a', { pinned: true }), P('b'), P('c', { pinned: true }), P('d')];
  const r = split(l);
  assert.deepEqual(r.pinned.map((p) => p.id), ['a', 'c']);
  assert.deepEqual(r.rest.map((p) => p.id), ['b', 'd']);
});

test('the badge names the stage and what it is doing', () => {
  const chips = (now, extra = {}) => [{ id: 'ask', title: 'Brief', who: 'agent', status: 'todo', ms: 0, now: now === 0, ...extra }, { id: 'rough-review', title: 'Rough review', who: 'you', status: 'todo', ms: 0, now: now === 1 }];
  const v = (o, n = 0, x) => P('a', { view: { chips: chips(n, x), ...o } });
  assert.equal(badgeOf(v({})).label, 'Brief: ready to start');
  assert.equal(badgeOf(v({ running: {} })).label, 'Brief: working');
  assert.equal(badgeOf(v({ waiting: { for: 'answer' } })).label, 'Brief: waiting for you');
  assert.equal(badgeOf(v({ waiting: { for: 'approve' } }, 1)).label, 'Rough review: waiting for you');
  assert.equal(badgeOf(v({ queued: {} })).label, 'Brief: in line');
  assert.equal(badgeOf(v({ halted: 'x' })).label, 'Brief: stopped');
  assert.equal(badgeOf(v({ done: true })).label, 'Finished');
  assert.equal(badgeOf(P('a')).label, 'Ready');
  assert.equal(badgeOf(v({}, 0, { status: 'todo', ms: 5000 })).label, 'Brief: press Go');
});

test('times in plain words, and the same-name warning', () => {
  const now = Date.parse('2026-11-21T12:00:00Z');
  assert.equal(ago('2026-11-21T11:59:30Z', now), 'just now');
  assert.equal(ago('2026-11-21T11:30:00Z', now), '30 min ago');
  assert.equal(ago('2026-11-21T09:00:00Z', now), '3 h ago');
  assert.equal(ago('2026-11-19T12:00:00Z', now), '2 days ago');
  assert.equal(ago('2026-11-20T10:00:00Z', now), '1 day ago');
  assert.equal(ago('2026-01-05T12:00:00Z', now), '2026-01-05');
  assert.equal(ago(null, now), '');
  assert.equal(sameTitle([P('a', { title: 'My Video' })], '  my   video ')?.id, 'a');
  assert.equal(sameTitle([P('a', { title: 'My Video' })], 'my video', 'a'), null);
  assert.equal(sameTitle([P('a', { title: 'x' })], ''), null);
});

test('a placeholder poster shows the first letters of the title', () => {
  assert.equal(initials('Trip to Rome'), 'TR');
  assert.equal(initials('qol-new bulk 27'), 'QN');
  assert.equal(initials('Ünder the sea'), 'ÜS');
  assert.equal(initials('Kitchen'), 'K');
  assert.equal(initials('  '), '?');
});
