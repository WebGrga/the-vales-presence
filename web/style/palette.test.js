import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pal = JSON.parse(fs.readFileSync(new URL('./palette.json', import.meta.url), 'utf8')).colors;
const css = fs.readFileSync(new URL('./base.css', import.meta.url), 'utf8');

test('base.css mirrors every colour of palette.json', () => {
  for (const [name, hex] of Object.entries(pal)) {
    const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'));
    assert.ok(m, `--${name} is missing in base.css`);
    assert.equal(m[1].toLowerCase(), hex.toLowerCase(), `--${name}`);
  }
});

test('every icon the screen names was drawn', () => {
  const drawn = new Set(JSON.parse(fs.readFileSync(new URL('../icons/icons.json', import.meta.url), 'utf8')));
  const dirs = ['../editor/', '../shell/', '../'];
  for (const d of dirs) {
    const dir = new URL(d, import.meta.url);
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js') && !x.endsWith('.test.js'))) {
      const src = fs.readFileSync(new URL(f, dir), 'utf8');
      for (const m of src.matchAll(/\b(?:icon|button)\(\s*'([a-z]+)'/g)) assert.ok(drawn.has(m[1]), `${f} uses icon '${m[1]}' that gen_icons.py does not draw`);
    }
  }
});
