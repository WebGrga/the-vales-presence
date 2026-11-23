import test from 'node:test';
import assert from 'node:assert/strict';
import { addedRules, rulesNotice } from './rules-diff.js';

const before = '## How we cut\n\n- Tight pauses.\n\n## Lessons\n\n- Old lesson. _(2026-11-01; evidence: x; kept 0, against 0)_\n';

test('only new list items are reported, without their lesson meta', () => {
  const after = before.replace('- Tight pauses.', '- Tight pauses.\n- No captions on long-form.') + '- New lesson. _(2026-11-23; evidence: y; kept 0, against 0)_\n';
  assert.deepEqual(addedRules(before, after), ['No captions on long-form.', 'New lesson.']);
  assert.deepEqual(addedRules(before, before), []);
  assert.deepEqual(addedRules(before, before.replace('Tight pauses.', 'Tighter pauses.')), ['Tighter pauses.']);
  assert.deepEqual(addedRules('', ''), []);
});

test('the notice is short and empty when nothing changed', () => {
  assert.equal(rulesNotice([]), '');
  assert.equal(rulesNotice(['a', 'b']), 'House rules updated: “a”; “b”');
  assert.equal(addedRules('', '- ' + 'x'.repeat(300))[0].length, 160);
  assert.equal(addedRules('', '- 1\n- 2\n- 3\n- 4\n- 5').length, 4);
});
