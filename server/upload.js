// Footage upload, streamed to disk (a recording can be many GB: nothing is held in memory).
// Either a raw body with an `x-name` header (the browser's fetch(file) with the name), or multipart/form-data with one
// or more file parts. Each file is written to <name>.part and renamed when it is complete; a taken name gets -2, -3...
import fs from 'node:fs';
import path from 'node:path';

// pure: a file name that is safe on every OS (no folders, no leading dots, no reserved names)
export function safeName(name) {
  let n = String(name || '').replace(/\\/g, '/').split('/').pop();
  try { n = decodeURIComponent(n); } catch {}
  n = n.normalize('NFC').replace(/[\u0000-\u001f<>:"|?*]+/g, '').replace(/^[.\s]+|[.\s]+$/g, '').replace(/\s+/g, ' ').slice(0, 120);
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(n)) n = '_' + n;
  return n || 'footage';
}
// pure: the name not taken yet in a folder listing
export function freeName(name, taken) {
  const t = new Set([...taken].map((x) => x.toLowerCase()));
  if (!t.has(name.toLowerCase())) return name;
  const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
  for (let n = 2; ; n++) { const c = `${stem}-${n}${ext}`; if (!t.has(c.toLowerCase())) return c; }
}

// pure: the boundary of a multipart content type, or null
export function boundaryOf(type) {
  const m = /multipart\/form-data;.*boundary=(?:"([^"]+)"|([^;]+))/i.exec(String(type || ''));
  return m ? (m[1] || m[2]).trim() : null;
}
// pure: the file name of a part's headers, or null (a plain field)
export function partName(headers) {
  const d = /content-disposition:[^\r\n]*/i.exec(headers)?.[0] || '';
  const star = /filename\*=(?:UTF-8'')?([^;\r\n]+)/i.exec(d);
  if (star) { try { return decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')); } catch {} }
  const m = /filename="([^"]*)"/i.exec(d) || /filename=([^;\r\n]+)/i.exec(d);
  return m ? m[1].trim() : null;
}

// A streaming multipart splitter. sink: { start(headers) -> writable-ish { write(buf), end() } | null, done() }.
// Feed it chunks with push(); it holds back only enough bytes to find a boundary across chunk edges.
export function multipartSplitter(boundary, sink) {
  const delim = Buffer.from('\r\n--' + boundary);
  let buf = Buffer.from('\r\n'); // so the first boundary looks like the others
  let mode = 'preamble', part = null, finished = false;
  function push(chunk) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (finished) return;
      if (mode === 'preamble' || mode === 'body') {
        const i = buf.indexOf(delim);
        if (i < 0) {
          const keep = delim.length + 1;
          if (mode === 'body' && buf.length > keep) { part?.write(buf.subarray(0, buf.length - keep)); buf = buf.subarray(buf.length - keep); }
          else if (mode === 'preamble' && buf.length > keep) buf = buf.subarray(buf.length - keep);
          return;
        }
        if (mode === 'body') { if (i) part?.write(buf.subarray(0, i)); part?.end(); part = null; }
        buf = buf.subarray(i + delim.length);
        mode = 'after';
      }
      if (mode === 'after') {
        if (buf.length < 2) return;
        if (buf[0] === 45 && buf[1] === 45) { finished = true; sink.done?.(); return; } // "--": the end
        const j = buf.indexOf('\r\n');
        if (j < 0) return;
        buf = buf.subarray(j + 2); mode = 'headers';
      }
      if (mode === 'headers') {
        const k = buf.indexOf('\r\n\r\n');
        if (k < 0) { if (buf.length > 16384) throw new Error('part headers too long'); return; }
        const headers = buf.subarray(0, k).toString('utf8');
        buf = buf.subarray(k + 4);
        part = sink.start(headers);
        mode = 'body';
      }
    }
  }
  return { push, finished: () => finished };
}

// write one stream of bytes to dir/<name> through a .part file. -> Promise<{ name, size }>
function fileWriter(dir, name) {
  const taken = (() => { try { return fs.readdirSync(dir); } catch { return []; } })();
  const final = freeName(safeName(name), taken);
  const tmp = path.join(dir, final + '.part');
  const ws = fs.createWriteStream(tmp);
  let size = 0, failed = null;
  ws.on('error', (e) => { failed = e; });
  return {
    name: final, ws,
    write(b) { size += b.length; return ws.write(b); },
    finish() {
      return new Promise((ok, fail) => {
        ws.end(() => {
          if (failed) { fs.rm(tmp, { force: true }, () => fail(failed)); return; }
          try { fs.renameSync(tmp, path.join(dir, final)); ok({ name: final, size }); } catch (e) { fail(e); }
        });
      });
    },
    abort() { ws.destroy(); fs.rm(tmp, { force: true }, () => {}); },
  };
}

// The screen sends a name that is not plain ASCII encodeURIComponent-ed (a header holds ASCII only); a name that
// does not decode is taken as it is.
export function headerName(name) {
  try { return decodeURIComponent(name); } catch { return name; }
}

// Save the request's file(s) into dir. -> Promise<{ files: [{ name, size }] }>
export function receive(req, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const b = boundaryOf(req.headers['content-type']);
  if (!b) {
    const name = req.headers['x-name'] || req.headers['x-file-name'];
    if (!name) return Promise.reject(Object.assign(new Error('send the file with an x-name header, or as multipart/form-data'), { status: 400 }));
    const w = fileWriter(dir, headerName(String(name)));
    return new Promise((ok, fail) => {
      req.on('data', (c) => { if (!w.write(c)) { req.pause(); w.ws.once('drain', () => req.resume()); } });
      req.on('aborted', () => { w.abort(); fail(Object.assign(new Error('the upload was cut off'), { status: 400 })); });
      req.on('error', (e) => { w.abort(); fail(e); });
      req.on('end', () => w.finish().then((f) => ok({ files: [f] }), fail));
    });
  }
  return new Promise((ok, fail) => {
    const writers = [], done = [];
    let cur = null;
    const sp = multipartSplitter(b, {
      start(headers) {
        const name = partName(headers);
        if (!name) return null; // a plain field: ignored
        cur = fileWriter(dir, name); writers.push(cur);
        const me = cur;
        return { write: (x) => { if (!me.write(x)) { req.pause(); me.ws.once('drain', () => req.resume()); } }, end: () => done.push(me.finish()) };
      },
      done() {},
    });
    req.on('data', (c) => { try { sp.push(c); } catch (e) { req.destroy(); writers.forEach((w) => w.abort()); fail(Object.assign(e, { status: 400 })); } });
    req.on('aborted', () => { writers.forEach((w) => w.abort()); fail(Object.assign(new Error('the upload was cut off'), { status: 400 })); });
    req.on('end', () => {
      if (!sp.finished()) { writers.forEach((w) => w.abort()); return fail(Object.assign(new Error('the form data ended early'), { status: 400 })); }
      Promise.all(done).then((files) => ok({ files }), fail);
    });
  });
}
