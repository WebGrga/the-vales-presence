# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = [
#   "faster-whisper>=1.1",
#   "av<16",
#   "nvidia-cublas-cu12; sys_platform != 'darwin'",
#   "nvidia-cudnn-cu12>=9,<10; sys_platform != 'darwin'",
# ]
# ///
"""Word-timed transcript: uv run transcribe.py <audio-or-video> <out.tsv> [--model large-v3-turbo] [--short] [--clean] [--no-align]
One line per word: start<TAB>end<TAB>word.
Used ONCE per recording (a plan's words) and by check_cut --words; never on a rough cut to find overlay times.
Verbatim by default: whisper is primed with "Umm, let me think, uh, like, hmm.", which makes it write the fillers that were said (um, uh, er, ah, hmm) as
words, so the cut sees them. --clean turns that off (a transcript for reading: whisper tidies the fillers away).
Aligned by default: whisper's word times run 100-300 ms off, so after the transcript, align.py (a wav2vec2 forced alignment, on the GPU when there is one, its own uv
environment, run as a step) moves every word's edges to where the sound is, and writes <out>.align.json beside it (score per word, never a 4th column).
--no-align keeps whisper's own times. If the alignment fails the whisper times are kept and a WARNING says so.
--short: for a short clip (a Short's part, under a minute): no batching and no voice-activity filter, which drops quiet little words ("it", "we")
at the head and tail of a part; beam 5.
Audio is extracted to 16 kHz mono by ffmpeg first, so any file works.
Device: an NVIDIA GPU (CUDA, float16) when there is one, else the CPU (int8: slower, the same words within whisper's own noise). $PRESENCE_WHISPER_DEVICE=cpu
forces the CPU. If the GPU run fails (a missing CUDA library), it runs again on the CPU and says so."""
import ctypes
import gc
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
VERBATIM = "Umm, let me think, uh, like, hmm. So, um, I was, er, ah, trying to, uh, see if it works."


def dlls():
    """Make the CUDA libraries of the nvidia-* wheels findable (Windows: their bin/ folders; Linux: load their lib/*.so with global symbols)."""
    try:
        import nvidia
    except ImportError:
        return
    for base in nvidia.__path__:
        for sub in ("cublas", "cudnn"):
            b = Path(base) / sub / "bin"
            if b.is_dir() and hasattr(os, "add_dll_directory"):
                os.environ["PATH"] = str(b) + os.pathsep + os.environ["PATH"]
                os.add_dll_directory(str(b))
            lib = Path(base) / sub / "lib"
            if lib.is_dir() and sys.platform.startswith("linux"):
                for so in sorted(lib.glob("lib*.so*")):
                    try:
                        ctypes.CDLL(str(so), mode=ctypes.RTLD_GLOBAL)
                    except OSError:
                        pass


def device():
    """('cuda', 'float16') when CUDA works here, else ('cpu', 'int8')."""
    want = (os.environ.get("PRESENCE_WHISPER_DEVICE") or "").lower()
    if want == "cpu":
        return "cpu", "int8"
    try:
        import ctranslate2
        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda", "float16"
    except Exception:
        pass
    return "cpu", "int8"


def whisper(model, wav, raw, short, prompt, dev, compute):
    """Write whisper's words of `wav` to `raw` (start, end, word per line)."""
    from faster_whisper import WhisperModel, BatchedInferencePipeline
    m = WhisperModel(model, device=dev, compute_type=compute)
    if short:
        segs, info = m.transcribe(wav, language="en", word_timestamps=True, vad_filter=False, beam_size=5, condition_on_previous_text=False, initial_prompt=prompt)
    else:
        p = BatchedInferencePipeline(model=m)
        segs, info = p.transcribe(wav, language="en", word_timestamps=True, batch_size=8, initial_prompt=prompt)
    with open(raw, "w", encoding="utf-8") as f:
        for s in segs:
            for w in s.words:
                f.write(f"{w.start:.2f}\t{w.end:.2f}\t{w.word.strip()}\n")
            f.flush()
            print(f"{s.end:.0f}", file=sys.stderr, flush=True)
    del segs, info, m
    gc.collect()


def flag(args, name):
    if name in args:
        args.remove(name)
        return True
    return False


def main():
    args = [a for a in sys.argv[1:]]
    model = "large-v3-turbo"
    if "--model" in args:
        i = args.index("--model")
        model = args[i + 1]
        del args[i:i + 2]
    short = flag(args, "--short")
    clean = flag(args, "--clean")
    no_align = flag(args, "--no-align")
    src, out = args[0], args[1]
    dlls()
    dev, compute = device()
    prompt = None if clean else VERBATIM
    t0 = time.time()
    with tempfile.TemporaryDirectory() as td:
        wav = os.path.join(td, "a.wav")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vn", "-ac", "1", "-ar", "16000", wav], check=True)
        raw = out if no_align else os.path.join(td, "whisper.tsv")
        if os.path.isfile(out + ".align.json"):
            os.remove(out + ".align.json")        # an old sidecar would describe other times
        # the aligner's model needs no words: it runs on the audio now, beside whisper, so the alignment after whisper is only the cheap half
        odds = os.path.join(td, "odds.npy")
        early = None if no_align else subprocess.Popen(["uv", "run", str(HERE / "align.py"), wav, "--emit", odds])
        t1 = t0
        try:
            try:
                whisper(model, wav, raw, short, prompt, dev, compute)
            except Exception as e:
                if dev == "cpu":
                    raise
                print(f"WARNING: whisper on the GPU failed ({type(e).__name__}: {str(e)[:200]}); running it on the CPU", file=sys.stderr)
                dev, compute = "cpu", "int8"
                whisper(model, wav, raw, short, prompt, dev, compute)
            t1 = time.time()
            if not no_align:
                ready = early.wait() == 0 and os.path.isfile(odds)
                r = subprocess.run(["uv", "run", str(HERE / "align.py"), wav, raw, "--out", out] + (["--emissions", odds] if ready else []))
                if r.returncode != 0 or not os.path.isfile(out):
                    print("WARNING: alignment failed, whisper's own word times are kept (no .align.json)", file=sys.stderr)
                    with open(raw, encoding="utf-8") as a, open(out, "w", encoding="utf-8") as b:
                        b.write(a.read())
        finally:
            if early and early.poll() is None:
                early.kill()
    print(f"transcribe: whisper ({dev} {compute}) {t1 - t0:.1f} s" + ("" if no_align else f", then alignment {time.time() - t1:.1f} s more") + f", {time.time() - t0:.1f} s in all", file=sys.stderr)
    print("DONE", file=sys.stderr)


if __name__ == "__main__":
    main()
