#!/usr/bin/env node
// Make one AI image with an enabled model from craft/image-models.json (the agent runs this; nothing else does).
//   node server/studio/image-gen.js --list
//   node server/studio/image-gen.js --model flux-schnell-local --prompt "an empty workbench, warm rim light" --out studio/thumbs/bg-1.png
// Options: --width 1344 --height 768 (the model's default), --seed N. Exits 0 with the file written, else 1 with why.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModels, fillCommand, pickModel, publicList } from './image-models.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = process.env.PRESENCE_DATA ? path.resolve(process.env.PRESENCE_DATA) : path.join(APP, 'data');

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return null; } };
export const models = () => loadModels(readJson(path.join(APP, 'craft', 'image-models.json')), readJson(path.join(DATA, 'craft', 'image-models.json')));

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') o.list = true;
    else if (a.startsWith('--')) o[a.slice(2)] = argv[++i];
  }
  return o;
}

function main() {
  const a = args(process.argv.slice(2));
  const ms = models();
  if (a.list) { console.log(JSON.stringify(publicList(ms, process.env), null, 2)); return; }
  if (!a.model || !a.prompt || !a.out) { console.error('Use: --model <id> --prompt "<text>" --out <file.png> [--width W --height H --seed N] | --list'); process.exit(1); }
  const r = pickModel(ms, a.model, process.env);
  if (r.error) { console.error(r.error); process.exit(1); }
  const out = path.resolve(a.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const seed = Number.isFinite(Number(a.seed)) && a.seed !== undefined ? Number(a.seed) : Math.floor(Math.random() * 2 ** 31);
  const cmd = fillCommand(r.model, { prompt: a.prompt, out, width: a.width || r.model.width, height: a.height || r.model.height, seed, app: APP });
  if (!cmd) { console.error(`The image model "${a.model}" has no command.`); process.exit(1); }
  const t0 = Date.now();
  const child = spawn(cmd[0], cmd.slice(1), { cwd: APP, stdio: 'inherit', env: process.env, windowsHide: true });
  const timer = setTimeout(() => { console.error('Timed out after 20 minutes.'); child.kill(); }, 20 * 60 * 1000);
  child.on('error', (e) => { clearTimeout(timer); console.error(`Could not start ${cmd[0]}: ${e.message}`); process.exit(1); });
  child.on('exit', (code) => {
    clearTimeout(timer);
    if (code === 0 && fs.existsSync(out)) { console.log(`${out}  model ${a.model}  seed ${seed}  ${Math.round((Date.now() - t0) / 1000)} s`); process.exit(0); }
    console.error(`The image model "${a.model}" failed (exit ${code}).`); process.exit(1);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
