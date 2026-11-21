// Remotion side of the "hold the still stretches" renderer (called by render_windows.py; packages from the workshop's remotion/node_modules, else the engine's: resolve.mjs).
//   node render_frames.mjs <spec.json>
//   spec = {remotionDir, serveUrl, parallel, concurrency, jobs: [{hash, dir, scale, props, calls: [{a, b, nth}]}]}
// For each job (one overlay window) renders exactly the frames its calls ask for, transparent, as PNG files `<dir>/f<frame>.png` where <frame> is the
// frame number in the rough (a call renders frames a, a+nth, ... < b of the one long Overlay composition). Packing into a .mov is Python's job
// (holds.py: it compares the sampled frames of a still stretch before it trusts the hold). Progress and results are JSON lines on stdout:
//   {"event":"done","hash","frames","ms"} | {"event":"failed","hash","error"}
import path from "node:path";
import fs from "node:fs";
import { load } from "./resolve.mjs";

const [, , specFile] = process.argv;
const say = (o) => console.log(JSON.stringify(o));

async function main() {
  const spec = JSON.parse(fs.readFileSync(specFile, "utf8"));
  const { renderFrames, selectComposition, openBrowser } = load(spec.remotionDir, "@remotion/renderer");
  const queue = [...spec.jobs];
  let failed = 0;
  async function worker() {
    const browser = await openBrowser("chrome", { chromiumOptions: {}, logLevel: "error" });
    for (;;) {
      const job = queue.shift();
      if (!job) { await browser.close({ silent: true }).catch(() => {}); return; }
      const t0 = Date.now();
      let total = 0;
      try {
        const composition = await selectComposition({ serveUrl: spec.serveUrl, id: "Overlay", inputProps: job.props, puppeteerInstance: browser, logLevel: "error" });
        fs.mkdirSync(job.dir, { recursive: true });
        let n = 0;
        for (const c of job.calls) {
          const nth = c.nth || 1;
          const tmp = path.join(job.dir, `_call${n++}`);
          fs.rmSync(tmp, { recursive: true, force: true });
          fs.mkdirSync(tmp, { recursive: true });
          await renderFrames({
            composition, serveUrl: spec.serveUrl, inputProps: job.props, puppeteerInstance: browser, outputDir: tmp,
            imageFormat: "png", frameRange: [c.a, c.b - 1], everyNthFrame: nth, scale: job.scale, concurrency: Math.min(spec.concurrency, Math.max(1, Math.ceil((c.b - c.a) / nth))),
            logLevel: "error", onStart: () => {}, onFrameUpdate: () => {},
          });
          const files = fs.readdirSync(tmp).filter((f) => f.endsWith(".png")).sort();
          const want = Math.ceil((c.b - c.a) / nth);
          if (files.length !== want) throw new Error(`call ${c.a}..${c.b}/${nth}: rendered ${files.length} frames, expected ${want}`);
          files.forEach((f, i) => fs.renameSync(path.join(tmp, f), path.join(job.dir, `f${c.a + i * nth}.png`)));
          fs.rmSync(tmp, { recursive: true, force: true });
          total += files.length;
        }
        say({ event: "done", hash: job.hash, frames: total, ms: Date.now() - t0 });
      } catch (e) {
        failed++;
        say({ event: "failed", hash: job.hash, error: String(e && e.stack ? e.stack : e).slice(0, 1500) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, spec.parallel) }, worker));
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { say({ event: "failed", error: String(e && e.stack ? e.stack : e).slice(0, 2000) }); process.exit(1); });
