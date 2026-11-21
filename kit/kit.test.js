// The kit is public and complete: every template has its README, components and overlay script; every sound is listed; the
// caption font has its licence; and no file of the kit or the public docs holds a private path, an email, or a borrowed credit line.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const kit = new URL('./', import.meta.url);
const root = new URL('../', import.meta.url);
const read = (u) => fs.readFileSync(u, 'utf8');
const PRIVATE = /[A-Z]:[\\/]Users|\/home\/\w|\/Users\/\w|_props|[\w.-]+@[\w-]+\.[a-z]{2,}/;

test('every template has a README, components.tsx exporting COMPONENTS, and make_overlays.py', () => {
  const names = fs.readdirSync(new URL('templates/', kit));
  assert.deepEqual(names.sort(), ['longform-clean', 'shorts-bold', 'shorts-calm']);
  for (const n of names) {
    const d = new URL(`templates/${n}/`, kit);
    assert.match(read(new URL('README.md', d)), new RegExp(`^# ${n}`), n);
    assert.match(read(new URL('components.tsx', d)), /export const COMPONENTS/, n);
    const py = read(new URL('make_overlays.py', d));
    assert.match(py, /def engine_dir\(\)/, n);
    assert.match(py, /E\.write\(cut\)/, n);
  }
});

test('every sound is listed, and every listed sound is there', () => {
  const files = fs.readdirSync(new URL('sounds/', kit)).filter((f) => f.endsWith('.wav')).map((f) => f.slice(0, -4)).sort();
  const listed = JSON.parse(read(new URL('sounds/sounds.json', kit))).sounds.map((s) => s.name).sort();
  assert.deepEqual(listed, files);
  for (const need of ['pop', 'whoosh', 'marker', 'hit', 'music']) assert.ok(files.includes(need), need);
});

test('the caption font comes with its licence', () => {
  assert.ok(fs.statSync(new URL('fonts/Montserrat-Black.ttf', kit)).size > 50000);
  const ofl = read(new URL('fonts/OFL.txt', kit));
  assert.match(ofl, /Montserrat Project Authors/);
  assert.match(ofl, /SIL OPEN FONT LICENSE Version 1\.1/);
});

test('no private paths or emails in the kit and the public docs', () => {
  const files = [];
  const walk = (u) => {
    for (const e of fs.readdirSync(u, { withFileTypes: true })) {
      const c = new URL(e.name + (e.isDirectory() ? '/' : ''), u);
      if (e.isDirectory()) walk(c);
      else if (/\.(md|json|tsx?|py|txt|js)$/.test(e.name) && !e.name.endsWith('.test.js')) files.push(c);
    }
  };
  walk(kit);
  for (const f of ['README.md', 'NOTICE', 'docs/setup.md', 'docs/how-it-works.md']) files.push(new URL(f, root));
  for (const f of files) assert.doesNotMatch(read(f), PRIVATE, f.pathname);
});
