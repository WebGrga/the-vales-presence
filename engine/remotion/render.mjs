// Remotion side of the pipeline (called by render_windows.py). Packages come from the workshop's remotion/node_modules when it has them, else from
// engine/remotion/node_modules (resolve.mjs).
//   node render.mjs bundle <remotionDir> <outDir>
//   node render.mjs render <jobs.json>       jobs.json = {remotionDir, serveUrl, parallel, concurrency, jobs: [{hash, out, a, b, props, scale, nth}]}
// Renders each window with a transparent background, frames a..b-1 of the Overlay composition. spec.mode:
//   "frames" (default): Chrome renders PNG frames (alpha), ffmpeg encodes them with spec.encode (a fast alpha codec such as utvideo)
//   "prores": Remotion's own ProRes 4444 encoder (much slower: its ffmpeg is the bottleneck)
// Progress and results are JSON lines on stdout: {"event":"progress"|"done"|"failed", ...}.
import path from "node:path";
import fs from "node:fs";
import { load, withEngineModules } from "./resolve.mjs";
import { spawn } from "node:child_process";

const [, , cmd, arg1, arg2] = process.argv;
const say = (o) => console.log(JSON.stringify(o));

async function main() {
  if (cmd === "bundle") {
    const { bundle } = load(arg1, "@remotion/bundler");
    const override = withEngineModules(arg1);
    const dir = await bundle({
      entryPoint: path.join(arg1, "src", "pipeline", "index.ts"),
      outDir: arg2,
      publicDir: path.join(arg1, "public"),
      rspack: true,
      enableCaching: true,
      webpackOverride: override,
      rspackOverride: override,
    });
    say({ event: "bundled", dir });
    return;
  }
  const spec = JSON.parse(fs.readFileSync(arg1, "utf8"));
  const { renderMedia, renderFrames, selectComposition, openBrowser } = load(spec.remotionDir, "@remotion/renderer");
  const queue = [...spec.jobs];
  let failed = 0;
  // one browser per worker: tabs of one browser share its GPU and compositor process, which caps the frame rate long before the CPU is busy
  async function worker() {
    const browser = await openBrowser("chrome", { chromiumOptions: {}, logLevel: "error" });
    for (;;) {
      const job = queue.shift();
      if (!job) { await browser.close({ silent: true }).catch(() => {}); return; }
      const t0 = Date.now();
      try {
        const inputProps = job.props;
        const composition = await selectComposition({ serveUrl: spec.serveUrl, id: "Overlay", inputProps, puppeteerInstance: browser, logLevel: "error" });
        const total = Math.ceil((job.b - job.a) / job.nth);
        let last = -1;
        const report = (n) => { const pct = Math.floor((n / total) * 10); if (pct !== last) { last = pct; say({ event: "progress", hash: job.hash, rendered: n, total }); } };
        if (spec.mode === "prores") {
          await renderMedia({
            composition, serveUrl: spec.serveUrl, inputProps, puppeteerInstance: browser,
            codec: "prores", proResProfile: "4444", imageFormat: "png", pixelFormat: "yuva444p10le", colorSpace: "bt709",
            frameRange: [job.a, job.b - 1], everyNthFrame: job.nth, scale: job.scale, muted: true,
            concurrency: spec.concurrency, outputLocation: job.out + ".part.mov", overwrite: true, logLevel: "error",
            onProgress: (p) => report(p.renderedFrames),
          });
        } else {
          const dir = job.out + ".frames";
          fs.rmSync(dir, { recursive: true, force: true });
          fs.mkdirSync(dir, { recursive: true });
          await renderFrames({
            composition, serveUrl: spec.serveUrl, inputProps, puppeteerInstance: browser, outputDir: dir,
            imageFormat: "png", frameRange: [job.a, job.b - 1], everyNthFrame: job.nth, scale: job.scale, concurrency: spec.concurrency,
            logLevel: "error", onStart: () => {}, onFrameUpdate: (n) => report(n),
          });
          const files = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
          if (files.length !== total) throw new Error(`rendered ${files.length} frames, expected ${total}`);
          files.forEach((f, i) => fs.renameSync(path.join(dir, f), path.join(dir, `f${String(i).padStart(6, "0")}.png`)));
          await new Promise((ok, fail) => {
            const args = ["-v", "error", "-y", "-framerate", String(spec.fps / job.nth), "-i", path.join(dir, "f%06d.png"), ...spec.encode, job.out + ".part.mov"];
            const p = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
            let err = "";
            p.stderr.on("data", (d) => (err += d));
            p.on("close", (c) => (c ? fail(new Error("ffmpeg: " + err.slice(-800))) : ok()));
          });
          fs.rmSync(dir, { recursive: true, force: true });
        }
        fs.renameSync(job.out + ".part.mov", job.out);
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
