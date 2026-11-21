import test from 'node:test';
import assert from 'node:assert/strict';
import { markdown, inline, timeOf, escapeHtml } from './markdown.js';

test('everything is escaped: no html gets through', () => {
  assert.equal(markdown('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.equal(inline('[x](javascript:alert(1))'), '[x](javascript:alert(1))');
  assert.equal(escapeHtml('"a" & b'), '&quot;a&quot; &amp; b');
  assert.equal(markdown('<img src=x onerror=1>').includes('<img'), false);
});

test('bold, italic, code and links', () => {
  assert.equal(inline('**Locked files:** `video/out/edl.json`'), '<b>Locked files:</b> <code>video/out/edl.json</code>');
  assert.equal(inline('a *word* and snake_case_name'), 'a <i>word</i> and snake_case_name');
  assert.equal(inline('see [the docs](https://example.com/a)'), 'see <a href="https://example.com/a" target="_blank" rel="noopener noreferrer">the docs</a>');
  assert.equal(inline('`**not bold**`'), '<code>**not bold**</code>');
});

test('blocks: headings, lists, code, tables, paragraphs', () => {
  assert.equal(markdown('## Done\n\nCut 32 things.\nSecond line.'), '<h4>Done</h4><p>Cut 32 things.<br>Second line.</p>');
  assert.equal(markdown('- one\n- two\n\n1. first\n2. second'), '<ul><li>one</li><li>two</li></ul><ol><li>first</li><li>second</li></ol>');
  assert.equal(markdown('```\n<b>x</b> 1:16\n```'), '<pre><code>&lt;b&gt;x&lt;/b&gt; 1:16</code></pre>');
  assert.equal(markdown('| a | b |\n|---|---|\n| 1 | 2 |'), '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
  assert.equal(markdown('> heads up'), '<blockquote>heads up</blockquote>');
});

test('timecodes become buttons that seek', () => {
  assert.equal(timeOf('1:16'), 76); assert.equal(timeOf('0:01:16.5'), 76.5); assert.equal(timeOf('1:75'), null); assert.equal(timeOf('75'), null);
  assert.equal(inline('listen to the join at 1:16.'), 'listen to the join at <button type="button" class="tc" data-t="76" title="Play from 1:16">1:16</button>.');
  assert.equal(inline('(2:04–2:10)'), '(<button type="button" class="tc" data-t="124" title="Play from 2:04">2:04</button>–<button type="button" class="tc" data-t="130" title="Play from 2:10">2:10</button>)');
  assert.equal(inline('ratio 16:9 at 10:30am'), 'ratio 16:9 at 10:30am'); // 16:9 has one digit after the colon; 10:30am runs into letters
  assert.equal(inline('`at 1:16`'), '<code>at 1:16</code>');
  assert.equal(inline('at 1:16', { timecodes: false }), 'at 1:16');
});
