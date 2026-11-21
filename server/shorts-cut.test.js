import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cutOf, withCuts, strayCuts, applyCutChoice, reviewPlan, cutAction, linkPlan, readCuts, linkOrCopy } from './shorts-cut.js';

const made = [];
after(() => { for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

const R = { stages: [{ id: 'pick', kind: 'make' }, { id: 'pick-review', kind: 'options' }, { id: 'cut', kind: 'make', out: ['shorts/'] }, { id: 'review', kind: 'gate' }, { id: 'export', kind: 'export' }] };
const at = (id, status) => ({ at: id, stages: { [id]: { status } } });

test('a cut Short: its final when there is one, else its rough', () => {
  assert.equal(cutOf('s3', {}), null);
  const c = cutOf('s3', { final: true, rough: true, words: true, len: 23.893, passed: true });
  assert.equal(c.video, 'shorts/s3/video/out/final.mp4');
  assert.equal(c.which, 'final');
  assert.equal(c.len, 23.9);
  assert.equal(c.words, 'shorts/s3/video/out/rough-words.json');
  assert.equal(cutOf('s1', { rough: true }).video, 'shorts/s1/video/out/rough.mp4');
});

test('picks carry their cut and your review; a cut no pick names still shows', () => {
  const picks = [{ id: 's1' }, { id: 's3' }];
  const cuts = { s3: cutOf('s3', { final: true }), s9: cutOf('s9', { final: true }) };
  const l = withCuts(picks, cuts, { s3: { status: 'redo', note: 'tighter' }, s1: { status: 'bogus' } });
  assert.equal(l[0].cut, null);
  assert.equal(l[0].cutStatus, null);
  assert.equal(l[1].cutStatus, 'redo');
  assert.equal(l[1].cutNote, 'tighter');
  assert.deepEqual(strayCuts(picks, cuts).map((x) => x.id), ['s9']);
});

test('review choices: ok, redo, a note, cleared; only cut Shorts', () => {
  assert.match(applyCutChoice({}, ['s3'], { short: 's1', status: 'ok' }).error, /no cut Short/);
  assert.match(applyCutChoice({}, ['s3'], { short: 's3', status: 'keep' }).error, /ok, redo or null/);
  let r = applyCutChoice({}, ['s3'], { short: 's3', status: 'redo', note: 'start later' }, 't').review;
  assert.deepEqual(r, { s3: { status: 'redo', note: 'start later', at: 't' } });
  r = applyCutChoice(r, ['s3'], { short: 's3', status: null, note: '' }, 't').review;
  assert.deepEqual(r, {});
});

test('the Review stage: a redo sends back naming only those; else approve naming what you passed', () => {
  assert.match(reviewPlan([{ id: 's1' }]).error, /No Short is cut/);
  const c = cutOf('x', { final: true });
  const list = [{ id: 's1', title: 'One', cut: c, cutStatus: 'ok' }, { id: 's2', cut: c, cutStatus: 'redo', cutNote: 'open on the number' }, { id: 's3', cut: c }];
  const back = reviewPlan(list);
  assert.equal(back.action, 'sendback');
  assert.deepEqual(back.redo, ['s2']);
  assert.match(back.notes, /- s2: open on the number/);
  assert.match(back.notes, /Leave these as they are: s1\./);
  const ok = reviewPlan([list[0], list[2]]);
  assert.equal(ok.action, 'approve');
  assert.equal(ok.notes, 'Approved: s1 ("One"). Not marked (approved as they are): s3.');
});

test('"Cut these": approve the picks, or start the cut, or say why not', () => {
  assert.equal(cutAction(at('pick-review', 'waiting'), R).do, 'approve');
  assert.equal(cutAction(at('cut', 'todo'), R).do, 'go');
  assert.match(cutAction(at('cut', 'running'), R).why, /being cut/);
  assert.match(cutAction(at('review', 'waiting'), R).why, /review them/);
  assert.match(cutAction(at('pick', 'running'), R).why, /not ready/);
  assert.match(cutAction({ ...at('pick-review', 'waiting'), halted: 'x' }, R).why, /halted/);
  assert.match(cutAction(at('visuals', 'todo'), { stages: [{ id: 'rough', kind: 'make' }, { id: 'visuals', kind: 'make' }] }).why, /no pick stage/);
});

test('Shorts from an edit: the rough (or final) and its words are needed; what is there is linked', () => {
  assert.match(linkPlan([]).error, /no rough or final/);
  assert.match(linkPlan(['final.mp4']).error, /no words/);
  const pl = linkPlan(['rough.mp4', 'rough-words.json', 'final.mp4', 'edl.json']);
  assert.deepEqual(pl.files, ['rough.mp4', 'final.mp4', 'rough-words.json']);
  assert.deepEqual(pl.link, ['rough.mp4', 'final.mp4']);
  assert.deepEqual(pl.copy, ['rough-words.json']);
});

test('reading the cut Shorts on disk, and a hard link (or a copy) of a file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'presence-shorts-')); made.push(dir);
  const out = path.join(dir, 'shorts', 's3', 'video', 'out');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'final.mp4'), 'v');
  fs.writeFileSync(path.join(out, 'check.json'), JSON.stringify({ length: { final: 23.89 }, passed: true }));
  fs.mkdirSync(path.join(dir, 'shorts', 'empty', 'video', 'out'), { recursive: true });
  const c = readCuts(dir);
  assert.deepEqual(Object.keys(c), ['s3']);
  assert.equal(c.s3.len, 23.9);
  assert.equal(c.s3.passed, true);
  assert.deepEqual(readCuts(path.join(dir, 'nothing')), {});
  const to = path.join(dir, 'b', 'final.mp4');
  assert.ok(['link', 'copy'].includes(linkOrCopy(path.join(out, 'final.mp4'), to)));
  assert.equal(fs.readFileSync(to, 'utf8'), 'v');
});
