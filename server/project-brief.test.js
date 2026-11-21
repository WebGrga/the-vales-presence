import test from 'node:test';
import assert from 'node:assert/strict';
import { topicText } from './project-brief.js';
import { stagePrompt } from './prompt.js';

test('a topic is kept as plain text, an empty one is nothing', () => {
  assert.equal(topicText('   '), '');
  assert.equal(topicText(undefined), '');
  assert.equal(topicText('How I cut my build time\r\nin half'), 'How I cut my build time\nin half\n');
});

test('every stage prompt carries the topic, and the brief file is not made for it', () => {
  const recipe = { name: 'R', stages: [{ id: 'ask', kind: 'ask', title: 'Brief' }, { id: 'research', kind: 'make', title: 'Research' }] };
  for (const [i, st] of recipe.stages.entries()) {
    const p = stagePrompt({ recipe, stage: st, index: i, kind: {}, projectDir: '/p', root: '/r', topic: 'Paper lists beat boards', brief: '' });
    assert.match(p, /Paper lists beat boards/);
    assert.doesNotMatch(p, /The brief \(brief\.md\)/);
  }
});
