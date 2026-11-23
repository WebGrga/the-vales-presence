import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchStep, WATCH } from './socket-watch.js';

test('a link that was heard lately is fine', () => {
  assert.equal(watchStep({ now: 10000, lastHeard: 9000 }), 'ok');
  assert.equal(watchStep({ now: WATCH.quiet, lastHeard: 0 }), 'ok');
});
test('a quiet link is asked with a ping', () => {
  assert.equal(watchStep({ now: WATCH.quiet + 1, lastHeard: 0 }), 'ping');
});
test('a ping that gets no answer in time means the link is dead', () => {
  assert.equal(watchStep({ now: 40000, lastHeard: 0, pingAt: 35000 }), 'ok');
  assert.equal(watchStep({ now: 35000 + WATCH.grace + 1, lastHeard: 0, pingAt: 35000 }), 'dead');
});
test('coming back to the page asks sooner', () => {
  assert.equal(watchStep({ now: 5000, lastHeard: 0 }, { quiet: 3000 }), 'ping');
  assert.equal(watchStep({ now: 2000, lastHeard: 0 }, { quiet: 3000 }), 'ok');
});
