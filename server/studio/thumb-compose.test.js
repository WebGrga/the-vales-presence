// The thumbnail composer runs on a tiny spec (skipped when python with Pillow is not there).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// every temp folder a test makes is removed when the file's tests end
const made = [];
const track = (d) => { made.push(d); return d; };
test.after(() => { for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

const here = path.dirname(fileURLToPath(import.meta.url));
const py = ['python', 'python3'].find((p) => spawnSync(p, ['-c', 'import PIL'], { windowsHide: true }).status === 0);

test('the composer draws a gradient, a picture, words and shapes at 1280x720', { skip: !py && 'python with Pillow not found' }, () => {
  const dir = track(fs.mkdtempSync(path.join(os.tmpdir(), 'thumb-')));
  execFileSync(py, ['-c', `from PIL import Image; Image.new('RGBA', (40, 60), (200, 50, 50, 255)).save(r'${path.join(dir, 'p.png')}')`]);
  fs.writeFileSync(path.join(dir, 's.json'), JSON.stringify({
    background: { gradient: ['#102030', '#302010'] },
    tint: { color: '#000000', opacity: 0.2 },
    layers: [
      { type: 'image', src: 'p.png', x: 0.6, y: 0.1, h: 0.8, outline: { color: '#ffffff', width: 4 }, shadow: true },
      { type: 'text', text: 'a long line of words that must wrap', upper: true, x: 0.05, y: 0.1, size: 0.2, maxWidth: 0.5, stroke: { color: '#000', width: 0.08 }, box: { color: '#d62828' } },
      { type: 'rect', x: 0.1, y: 0.7, w: 0.2, h: 0.1, color: '#00ff00' },
      { type: 'circle', x: 0.5, y: 0.5, r: 0.1, outline: { color: '#ff0000', width: 6 } },
      { type: 'arrow', from: [0.3, 0.8], to: [0.5, 0.6] },
    ],
  }));
  const out = path.join(dir, 'o.png');
  execFileSync(py, [path.join(here, 'thumb_compose.py'), path.join(dir, 's.json'), out, '--small'], { windowsHide: true });
  const png = fs.readFileSync(out);
  assert.equal(png.readUInt32BE(16), 1280);
  assert.equal(png.readUInt32BE(20), 720);
  assert.equal(fs.readFileSync(path.join(dir, 'o-small.png')).readUInt32BE(16), 320);
});

test('an unknown layer type stops with a plain message', { skip: !py && 'python with Pillow not found' }, () => {
  const dir = track(fs.mkdtempSync(path.join(os.tmpdir(), 'thumb-')));
  fs.writeFileSync(path.join(dir, 's.json'), JSON.stringify({ layers: [{ type: 'sparkle' }] }));
  const r = spawnSync(py, [path.join(here, 'thumb_compose.py'), path.join(dir, 's.json'), path.join(dir, 'o.png')], { encoding: 'utf8', windowsHide: true });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Unknown layer type/);
});
