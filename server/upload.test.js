import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { safeName, freeName, boundaryOf, partName, multipartSplitter, receive } from './upload.js';

// every temp folder a test makes is removed when the file's tests end
const made = [];
const track = (d) => { made.push(d); return d; };
after(() => { for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

test('safeName and freeName', () => {
  assert.equal(safeName('../../etc/passwd'), 'passwd');
  assert.equal(safeName('C:\\Users\\x\\rec 1.mkv'), 'rec 1.mkv');
  assert.equal(safeName('.hidden'), 'hidden');
  assert.equal(safeName('a<b>:c?.mp4'), 'abc.mp4');
  assert.equal(safeName('con.mp4'), '_con.mp4');
  assert.equal(safeName(''), 'footage');
  assert.equal(freeName('rec.mkv', ['REC.mkv', 'rec-2.mkv']), 'rec-3.mkv');
  assert.equal(freeName('new.mkv', ['rec.mkv']), 'new.mkv');
});

test('boundaryOf and partName', () => {
  assert.equal(boundaryOf('multipart/form-data; boundary=----abc'), '----abc');
  assert.equal(boundaryOf('multipart/form-data; boundary="q r"'), 'q r');
  assert.equal(boundaryOf('video/mp4'), null);
  assert.equal(partName('Content-Disposition: form-data; name="f"; filename="a b.mp4"\r\nContent-Type: video/mp4'), 'a b.mp4');
  assert.equal(partName('Content-Disposition: form-data; name="f"; filename*=UTF-8\'\'%C5%A1.mp4'), 'š.mp4');
  assert.equal(partName('Content-Disposition: form-data; name="title"'), null);
});

const form = (b, parts) => Buffer.concat(parts.flatMap(([h, body]) => [Buffer.from(`--${b}\r\n${h}\r\n\r\n`), body, Buffer.from('\r\n')]).concat([Buffer.from(`--${b}--\r\n`)]));

test('the multipart splitter finds every part across any chunk edges', () => {
  const b = 'XyZ123';
  const one = Buffer.from('first file\r\n--XyZ12 not a boundary\r\nend');
  const two = Buffer.alloc(5000, 7);
  const body = form(b, [['Content-Disposition: form-data; name="t"', Buffer.from('a field')], ['Content-Disposition: form-data; name="f"; filename="one.txt"', one], ['Content-Disposition: form-data; name="g"; filename="two.bin"', two]]);
  for (const size of [1, 3, 7, 64, 100000]) {
    const got = {};
    let cur = null;
    const sp = multipartSplitter(b, { start(h) { const n = partName(h) || 'field'; got[n] = []; cur = got[n]; return { write: (x) => cur.push(Buffer.from(x)), end() {} }; } });
    for (let i = 0; i < body.length; i += size) sp.push(body.subarray(i, i + size));
    assert.ok(sp.finished(), `finished at chunk size ${size}`);
    assert.equal(Buffer.concat(got['one.txt']).toString(), one.toString(), `chunk ${size}`);
    assert.ok(Buffer.concat(got['two.bin']).equals(two));
    assert.equal(Buffer.concat(got.field).toString(), 'a field');
  }
});

function fakeReq(headers, chunks) {
  const r = Readable.from(chunks.map((c) => Buffer.from(c)));
  r.headers = headers;
  return r;
}

test('receive: a raw body with x-name, and multipart, written whole and renamed', async () => {
  const d = track(fs.mkdtempSync(path.join(os.tmpdir(), 'presence-up-')));
  const raw = await receive(fakeReq({ 'x-name': 'clip.mp4' }, ['abc', 'def']), d);
  assert.deepEqual(raw.files, [{ name: 'clip.mp4', size: 6 }]);
  assert.equal(fs.readFileSync(path.join(d, 'clip.mp4'), 'utf8'), 'abcdef');
  const again = await receive(fakeReq({ 'x-name': 'clip.mp4' }, ['x']), d);
  assert.equal(again.files[0].name, 'clip-2.mp4');
  const b = 'BB';
  const body = form(b, [['Content-Disposition: form-data; name="f"; filename="m.mkv"', Buffer.from('mkvdata')]]);
  const mp = await receive(fakeReq({ 'content-type': `multipart/form-data; boundary=${b}` }, [body.subarray(0, 10), body.subarray(10)]), d);
  assert.deepEqual(mp.files, [{ name: 'm.mkv', size: 7 }]);
  assert.equal(fs.readFileSync(path.join(d, 'm.mkv'), 'utf8'), 'mkvdata');
  assert.deepEqual(fs.readdirSync(d).filter((f) => f.endsWith('.part')), []);
  await assert.rejects(receive(fakeReq({}, ['x']), d), /x-name/);
});

test('headerName: an encoded x-name is decoded, a broken one kept', async () => {
  const { headerName } = await import('./upload.js');
  assert.equal(headerName('caf%C3%A9%20take.mp4'), 'café take.mp4');
  assert.equal(headerName('plain.mp4'), 'plain.mp4');
  assert.equal(headerName('100%.mp4'), '100%.mp4');
});
