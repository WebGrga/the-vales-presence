# The engine

The editing engine of The Vale's Presence: Python scripts plus a small Remotion side that turn recordings into a rough cut, measure every cut on the sound, and dress the approved rough with overlays, zooms, captions and sound effects. One pipeline serves every cut: long-form (1920x1080) and Shorts (1080x1920).

The idea in one line: **the rough is locked and never re-made by the visuals; only the stretches that carry a visual are rendered (transparent, with Remotion), once each, cached by a hash; one ffmpeg pass puts them, the zooms and the captions on the rough; the voice is never re-levelled.** Changing one label re-renders one window. Two speed-ups keep a fix cheap: **still stretches of an overlay are drawn once and held** (a ring held for 10 s is a few frames in Chrome, not 600), and **the final is composed in cached chunks** joined with `-c copy` (a changed label re-encodes only the one or two chunks it is in).

```
ROUGH CUT STAGE  transcribe.py, scan.py   -> words and measurements of every recording
                 (the agent) edl.py       -> out/edl.json, the edit list
                 joins.py check / snap    -> every join measured on the sound
                 build_rough.py           -> out/rough.mp4 (the voice levelled ONCE)
                 handover.py              -> out/rough.json, rough-words.json, rough-scenes.json, cuts.json   (then you approve; the files are locked)
VISUALS STAGE    (the agent) a make_overlays.py with the Events builder -> out/events.json + out/timeline.json   (times only from rough-words.json / tmap)
                 (you, in the editor) out/redactions.json (blur boxes) + out/event-edits.json (overlay inspector)  -> applied over events.json on every load
                 run.py --proof           -> out/proof.mp4 + proof-sheet.jpg   (changed windows only, 540p 30 fps)
                 run.py --final           -> render changed windows (stills held) -> compose in cached chunks -> out/final.mp4 -> check_cut.py -> out/frames.jpg
```

Every script finds its workshop (a project's `video/` folder) from `--video <path to video/>`, `$PRESENCE_VIDEO`, or the current folder (`video/` or anything under it). None asks a question; progress goes to `video/out/work/pipeline.log`; `video/out/steps.jsonl` has `{step, start, ms, detail}` for every step; the exit code is honest.

## Requirements

| what | why |
|---|---|
| **ffmpeg and ffprobe** on PATH (a build with libass and the H.264 encoders) | every cut, encode and measurement |
| **Python 3.10+** with **numpy** and **Pillow** (`python -m pip install numpy pillow`) | every script runs on the plain `python` |
| **uv** (https://docs.astral.sh/uv/) | `transcribe.py` (faster-whisper) and `align.py` (wav2vec2) run in their own environments through `uv run`; uv installs Python 3.12 and the packages itself on first use |
| **Node 22** and `npm install` in `engine/remotion` | the overlay render (Remotion and Chrome); only the visuals stage needs it |
| **opencv-python** (optional) | `faces.py` (face tracking for punch-ins and 9:16 reframes) |
| a GPU (optional) | NVIDIA (NVENC, CUDA), Intel (Quick Sync), AMD (AMF) or Apple (VideoToolbox) encode faster; whisper and the aligner use CUDA when there is one. Without one everything runs on the CPU (libx264, whisper int8) |

```bash
cd engine/remotion && npm install      # once: Remotion 4.0.535, React 19, zod, TypeScript (node_modules is not committed)
python engine/encoders.py              # which H.264 encoder this machine uses, and its settings
npm run test:engine                    # every engine/test_*.py (needs no GPU, no model and no recording)
```

## Commands

All commands run from the repository root; `V` is a project's workshop, e.g. `V=data/projects/<id>/video`.

```bash
# the rough cut stage
uv run engine/transcribe.py $V/footage/rec1.mkv $V/out/work/words-r1.tsv    # verbatim and aligned words (once per recording)
python engine/scan.py --video $V              # measure: out/work/scan.json and scan.md (silences, fillers, retakes, asides, dead air, waits)
# ... the agent writes out/edl.json (edl.py helpers), with cut_before on each cut
python engine/joins.py check --video $V       # every join; exit 1 on a clipped word
python engine/joins.py snap --video $V        # move edges a little into the quiet, then check again
python engine/build_rough.py --video $V       # out/rough.mp4
python engine/handover.py --video $V          # rough.json, rough-words.json, rough-scenes.json, and out/cuts.json for the review

# the visuals stage
python engine/events.py check --video $V      # validate events.json, write timeline.json, list the windows' gaps
python engine/windows.py --video $V [--proof] # what would be rendered, what is cached
python engine/run.py --proof --video $V       # cheap look: only changed windows, 540p 30 fps
python engine/run.py --final --video $V [--words]   # the real one, once, at the end of a round (--force: re-render every window and
                                                    # re-encode every chunk; --prune: delete cache files no window or chunk uses)
python engine/check_cut.py --video $V [--words]     # the cut check alone
python engine/seams.py --video $V [--against other-final.mp4] [--stills 12]   # the seam checks of a chunked final
python engine/sheet.py --video $V             # contact sheet out/frames.jpg
```

Speed-up flags (both on by default): `run.py` / `render_windows.py --no-holds` draws every frame of every window; `compose.py` / `run.py --single` is one ffmpeg pass over the whole video; `--chunk-seconds N` (default 15, a Short 10), `--jobs N` (chunks encoded at a time, default 3, or `$PRESENCE_COMPOSE_JOBS`).

Long steps (a render, a final) are best started in the background; read `video/out/work/pipeline.log` when they end.

## Files

| file | job |
|---|---|
| `pipelib.py` | the config (below), paths of a workshop (`Cut`), the step log, hashes, ffprobe, `asset()` (a sound by name), `find_font()` |
| `encoders.py` | the H.264 encoder of this machine (probed once) and the settings of each kind of encode (below) |
| `edl.py` | the edit list format (below): `new`, `add`, `add_piece`, `add_wait`, `cut_before`, `write`, `validate`, `migrate`; `python engine/edl.py check` |
| `tmap.py` | source time to rough time through the edit list, source words mapped into the rough, beats (`load()`) |
| `transcribe.py` | `uv run` faster-whisper word file (start, end, word per line); once per recording, and by `check_cut --words`. Verbatim by default, `--clean` turns that off; aligned by default (`align.py`), `--no-align` keeps whisper's times |
| `align.py` (+ `align_text.py`, `align_ctc.py`, `align_edges.py`) | `uv run engine/align.py <audio-or-video> <words.tsv> [--out]`: moves every word's start and end to where its sound is (wav2vec2 forced alignment), writes `<out>.align.json` |
| `scan.py` (+ `scan_sound.py`, `scan_words.py`, `scan_picture.py`, `scan_md.py`) | measurements before the rough cut: silences, fillers, retakes, asides, dead air, waits (`out/work/scan.json`, `scan.md`) |
| `joins.py` (+ `joins_logic.py`) | every join of the edit list measured on the source sound: `check` (a clipped word exits 1), `snap` (moves edges a little into the quiet) |
| `build_rough.py` (+ `rough_audio.py`) | the default rough builder for any edl.json: cached pieces, 12 ms crossfades, sped waits, then `level.py` once |
| `level.py` | the ONE loudness pass of a rough: two-pass loudnorm to -14 LUFS, limiter 0.70, AAC muxed with the picture copied |
| `cuts.py` (+ `cuts_clips.py`) | `out/cuts.json` and Before/After clips: every cut of the rough, for your review (run by `handover.py`) |
| `faces.py` (+ `faces_data.py`, `faces_frame.py`, `faces_track.py`), `focus.py`, `models/` | where the speaker's face is (punch-ins, 9:16 reframes) and which part of a screen changes (zooms) |
| `handover.py` | end of the rough cut stage: `rough.json`, `rough-words.json`, `rough-scenes.json`, `cuts.json` |
| `events.py` | the `Events` builder for a make_overlays.py, `events.json` validation, `timeline.json`, the gap pass |
| `redact.py` | blur boxes (kind `blur`): validation, the ffmpeg filter lines (blur, pixelate, fill) put before the zoom in every compose, the boxes of `out/redactions.json` |
| `user_edits.py` | `load(cut)`: events.json with `out/event-edits.json` and `out/redactions.json` applied; every script that reads the events uses it |
| `windows.py` | which stretches need Remotion, their hashes, the cache folder |
| `render_windows.py` + `remotion/render.mjs` | render the missing windows (Chrome PNG frames with alpha, packed by ffmpeg into a lossless alpha .mov), five windows at a time, one browser each |
| `holds.py` + `render_holds.py` + `remotion/render_frames.mjs` | the default render: which stretches of a window sit still, draw only the moving frames and a few samples of each hold, check the samples by pixels, pack a variable-frame-rate .mov |
| `remotion/stills.json`, `stills-short.json` | how long the engine's components take to settle; a workshop's own `remotion/stills.json` overrides them per component |
| `remotion/{index.ts,Root.tsx,Layer.tsx,types.ts}` | the ONE Remotion entry (composition `Overlay`, no base video, transparent); copied to `<video>/remotion/src/pipeline/` |
| `remotion/shorts.tsx` | the Shorts kit (below) |
| `remotion/resolve.mjs`, `remotion/package.json` | which node_modules the Remotion side loads (the workshop's own when it has them, else `engine/remotion/node_modules`) |
| `captions.py` | captions as ASS subtitles (below) |
| `shortcaps.py` | caption blocks for Shorts from `rough-words.json` |
| `sfx.py` | the sound-effects layer and the music bed |
| `compose.py` (+ `compose_chunks.py`) | `--final`: chunked by default, `--single` = one ffmpeg pass; `--proof`: one 540p clip per changed window, joined |
| `seams.py` | the seam checks of a chunked final (frame count, timestamps, keyframes at the joins, picture across a join, against another final) |
| `check_cut.py` | length, frames, locked files, voice (and `--words`) |
| `sheet.py` | contact sheet `frames.jpg` in one ffmpeg call |
| `run.py` | `--proof` / `--final`: all of the visuals stage in one command |
| `split_edl.py`, `adopt_rough.py` | an edit list for a rough built by a shell script, or for an existing rough that has none |
| `typecheck.py` | `python engine/typecheck.py <template dir>`: `tsc --noEmit` on a template's components with the shared files, in a scratch project |
| `test_*.py` | `test_pipeline.py`, `test_holds.py`, `test_shorts.py`, `test_align.py`, `test_scan.py`, `test_joins.py`, `test_cuts.py`, `test_faces.py`, `test_redact.py`: all must pass (plain `python`, no GPU, no model) |

## The config (`pipelib.py`)

Nothing in the engine names a folder outside the repository and the workshop.

| what | where |
|---|---|
| the engine | `HOME` = this folder (from `__file__`); every script puts its own folder on `sys.path`, so they run from anywhere and with `python -I` |
| the workshop | `--video <path to video/>`, else `$PRESENCE_VIDEO`, else the nearest folder up from the current one with `out/` and `footage/` or `remotion/` |
| sounds (`asset(cut, name)`, `.wav` added when there is no extension) | the workshop's `video/assets/` and `video/public/` first (a project's own sound wins), then the folders in `$PRESENCE_SOUNDS`, then `<repo>/kit/sounds/` |
| fonts (`find_font(name)`) | the folders in `$PRESENCE_FONTS`, then `<repo>/kit/fonts/`, then the system's fonts (Windows: `%WINDIR%\Fonts` and the user's fonts; macOS: `/System/Library/Fonts`, `/Library/Fonts`, `~/Library/Fonts`; Linux: `~/.local/share/fonts`, `~/.fonts`, `/usr/local/share/fonts`, `/usr/share/fonts`) |
| the lock file | `$PRESENCE_LOCKS` (a relative path is taken from the workshop), else `<workshop>/.presence/locks.json` (the workshop is the folder that holds `video/`) |

Environment variables:

| variable | default | what |
|---|---|---|
| `PRESENCE_VIDEO` | the current folder | the workshop's `video/` folder |
| `PRESENCE_LOCKS` | `<workshop>/.presence/locks.json` | the lock file |
| `PRESENCE_SOUNDS`, `PRESENCE_FONTS` | none | extra folders for sounds and fonts (separated by `;` on Windows, `:` elsewhere) |
| `PRESENCE_CONFIG` | `<repo>/presence.local.json` | the optional config file (below) |
| `PRESENCE_ENCODER` | the probe | force an encoder: `h264_nvenc`, `h264_qsv`, `h264_amf`, `h264_videotoolbox`, `libx264`, or `cpu` |
| `PRESENCE_WHISPER_DEVICE` | CUDA when present | `cpu` forces whisper onto the CPU |
| `PRESENCE_COMPOSE_JOBS` | 3 | chunks encoded at a time |
| `PRESENCE_OVERLAY_CODEC` | `png` | how a rendered window is stored (`png`, `utvideo`, `qtrle`, `prores`; part of every window's hash) |
| `PRESENCE_REMOTION_MODULES` | `engine/remotion/node_modules` | the node_modules `typecheck.py` links |

Every name above except `PRESENCE_CONFIG` and `PRESENCE_WHISPER_DEVICE` (the environment only) can also be set in `presence.local.json` in the repository root (not committed), as the lower-case name without the prefix: `{"sounds": "~/my-sounds", "locks": ".other/locks.json"}`. The environment wins over the file. Use it when the engine is started by something that cannot pass environment variables.

## Hardware

**Encoder.** `encoders.py` probes once per run, in order: `h264_nvenc` (NVIDIA), `h264_qsv` (Intel Quick Sync), `h264_amf` (AMD), `h264_videotoolbox` (Apple), else `libx264`. An encoder counts only when ffmpeg really encodes three frames with it. Every encode uses it with the settings of its kind:

| profile | used by | NVENC | libx264 |
|---|---|---|---|
| `final` | `compose.py`, `compose_chunks.py` | p6, hq, VBR cq 19, spatial and temporal AQ, lookahead 32, 3 B-frames | medium, crf 18, 3 B-frames |
| `rough` | `build_rough.py` | p4, hq, VBR cq 22, no B-frames, GOP 120, forced IDR | veryfast, crf 17, no B-frames, GOP 120 |
| `proof` | `compose.py --proof` | p4, cq 24 | veryfast, crf 23 |
| `clip` | `cuts_clips.py` (Before/After clips) | p5, VBR cq 31 | veryfast, crf 28 |

QSV, AMF and VideoToolbox get matching constant-quality (or, on VideoToolbox, bitrate) settings: see `python engine/encoders.py`. `build_rough.py --cpu` forces libx264. Decoding for the contact sheet uses the same hardware (`-hwaccel cuda|qsv|d3d11va|videotoolbox`) and falls back to the CPU.

**Caches and the encoder.** The cache key of a rough piece (`out/work/rough-seg/`) and of a final chunk (`out/work/chunks/`) holds the encoder's argument list. The NVENC lists are exactly the settings the engine has always used, so caches made on an NVIDIA machine stay valid; a cache made with one encoder is never mistaken for another's (a different encoder simply encodes again). The Before/After clips and proof clips are keyed by their content only: they are made once, by whichever encoder is there.

**Whisper and the aligner.** `transcribe.py` runs faster-whisper on CUDA in float16 when an NVIDIA GPU is there, else on the CPU in int8 (slower; the words are the same within whisper's own noise); a GPU run that fails (a missing CUDA library) runs again on the CPU and says so. `align.py` uses CUDA in half precision when it can, else the CPU. On Windows and Linux, uv installs the CUDA builds of PyTorch and the cuBLAS/cuDNN wheels; on macOS the plain ones.

## Measured cuts: the rough cut stage

### Exact words (`transcribe.py`, `align.py`)

Whisper's word times run 100-300 ms off (its ends often clip the tail of a word) and, told nothing, it tidies the fillers away. So a transcript is made in two steps: **verbatim** (whisper is primed with "Umm, let me think, uh, like, hmm...", so the fillers that were said are words; the output is capitalised and punctuated, stutters kept: "I, I, I") and **aligned** (`align.py`: wav2vec2-base-960h gives the odds of each letter every 20 ms, a forced alignment lays the words on them, in the same order; a word it cannot place keeps its time). Fillers a letter model cannot hear go on the stretch of sound between their neighbours; a last pass moves an edge that sits inside a stretch of sound out to its edge (at most 0.12 s, never past a neighbour).

The word file stays `start<TAB>end<TAB>word` (three decimals); **confidence is only in the sidecar** `<file>.align.json` `{"model", "words": [[start, end, word, score]], "ms"}`, score 0 = not placed by the model. `uv run engine/transcribe.py in out.tsv [--clean] [--no-align] [--short] [--model ..]`: the aligner's model starts on the audio while whisper runs, so the alignment after whisper is the cheap half. `uv run engine/align.py audio words.tsv --out new.tsv` realigns any old word file. If alignment fails, whisper's times are kept and a WARNING says so. **Captions do not show fillers**: `shortcaps.blocks(..., drop={'uh','um','er','ah','hmm'})`; `align.is_filler(word)` finds them.

### Measurements before the rough cut (`scan.py`)

`python engine/scan.py [--video V] [--src r1] [--file <recording> --words <tsv>] [--out <dir>]` measures every source of `out/edl.json` (or the one given) and writes `out/work/scan.json` and `scan.md`. It measures and decides nothing: the agent planning the rough reads `scan.md` (grouped and capped; it says what it left out) and cuts from the numbers. A source scanned again replaces only its own part.

| key | what it is |
|---|---|
| `floor_db`, `speech_db`, `silence_db` | the room tone (digital silence of a gated mic left out), the middle speech level, and the line a silence stays under: max(floor + 6, speech - 30 dB) |
| `silences` | `[s, e]` over 0.4 s under `silence_db`, from the sound |
| `fillers` | `{s, e, w}`: um, uh, er, ah, hmm, erm, from the word file (an old file may have dropped them: `notes` says so) |
| `retakes` | `{first, again, words, why}`: two phrases within 30 s with the same first 3+ words or most words alike, or a line that restarts. `again` is the one usually kept. Parallel phrasing also matches, so not every one is a real retake |
| `asides` | `{s, e, db, words, over_floor}`: phrases 10+ dB under the ones around them (usually a note to the editor) |
| `dead_air` | `[s, e]`: no words and no speech-level sound for 2 s or more |
| `waits` | `{s, e, screen, speed, moving}`: no words for 4 s or more; `busy` = the picture keeps changing (a corner cam strip left out first: `inset`), else `still`; `speed` plays it in about 3 s. Typing in a box counts as busy |

### Measured joins and the default rough (`joins.py`, `build_rough.py`)

An edge cut in a word is the one thing a rough must never do. `joins.py` measures every join on the SOURCE sound (the energy near an edge is the truth; the words only say whose sound it is):

- `check [--json]`: a kept word clipped (exit 1), a piece of a removed word left in, a cut in continuous speech, under 0.2 s of room after the last kept word or 0.05 s before the next, an edge not in the quiet (sound within 20 ms), dead air at the join (over 1 s together), two cuts under 1.5 s apart (a stutter).
- `snap [--dry] [--reach 0.15]`: moves an edge with a problem at most 0.15 s to the quietest point, keeping the room, never into sound or across a word; rewrites edl.json (whole frames, back to back; the first version kept in `out/work/edl.before-snap.json`, so snapping twice cannot walk an edge away). Exit 2 and nothing changed once the rough is handed over. Edges it cannot fix are listed with where the sound runs: fix them by hand or with a larger `--reach`.

`python engine/build_rough.py [--video V] [--out file] [--jobs 3] [--cpu] [--no-level] [--force]` builds any edl.json: a stretch of a source (`src`, `src_in`, `src_out`; picture from `pic_src`/`pic_in`, `vf` = a picture filter), a sped wait (kind "W", `pic_src`, `pic_in`, `pic_out`, `speed` > 1, no `src`: muted), a held still (`pic_src` + `pic_in`), a blank card (`color`). Each piece is encoded once (cached in `out/work/rough-seg/`), joined with `-c copy`; the sound is joined with 12 ms equal-power crossfades; `out/work/rough-cat.mp4` goes through `level.py` ONCE to `out/rough.mp4`. A source may say `"track": N`. A rough rebuilt from its edl.json is equal to the frame, with the recording's own voice at 0 ms lag. Holds and waits are digital silence. Once the rough is handed over (a lock file or `out/rough.json` exists) it is not rebuilt in place: `--out <file>` builds somewhere else.

### Cuts for review (`cuts.py`, written at the handover)

`handover.py` ends by writing `out/cuts.json`: every cut of the rough, listed for your review (the flagged ones first, the removed words struck through, Before/After, Keep / Restore / Note; your choices go in `out/cuts-review.json` and in the send-back notes). `python engine/cuts.py [--no-clips]` runs alone; `handover.py --no-cuts` skips it; a failure there is a warning, never a failed handover.

A cut is every place where the sound jumps inside one source and every source change (`jump: "source"|"back"`, `len` 0). Per cut: `at`, `src`, `from`, `to`, `len`, `kind`/`why`/`flag`/`ask` from the item's `cut_before` (else "other"; a gap under 0.15 s with no word is "pause"), `before`/`after` (about 8 kept words each side), `removed` (`removed_n` the count) and two clips in `out/work/cuts/`: `cN-before.mp4` = the source 3 s each side of the removal (over 20 s: its first and last 6 s with 0.3 s of black), `cN-after.mp4` = the rough 3 s each side of `at`. 540p, made once (`work/cuts/keys.json`). Ids are c1, c2... in cut order.

### Faces and screen focus (`faces.py`, `focus.py`)

Two measuring helpers for dressing a cut. They measure; the agent decides what to show.

```bash
python engine/faces.py track r1 --video $V                       # once per recording: out/work/faces-r1.json (--region x,y,w,h|none, --from/--to)
python engine/faces.py punch 23.4 31.0 --scale 1.1 --src r1     # -> E.zoom('P1', 23.4, 31.0, x=.., y=.., zoom=.., ease=0)
python engine/faces.py reframe 0 26 --src r1 [--bounds x,y,w,h] [--zoom 1.0]    # 9:16 crops of the source, one per run between cuts
python engine/focus.py r1 83.2 96.0 --rough --cam r1 [--mask x,y,w,h] [--max-zoom 2] [--draw still.png]    # -> E.zoom('F1', ..., x=.., y=.., zoom=.., mask=..)
```

`faces.py track` finds the face 4 times a second with YuNet (OpenCV, `models/`, MIT): box, eyes, mouth, `look` (head turn) and confidence, gaps filled and smoothed; with a cam inset it finds the face in the first 12 s and then looks only there. `punch(t0, t1, scale)` takes ROUGH times and gives one box for the whole stretch: eyes about a third down, more room where the head turns, chin and mouth in, never past the frame; `fits: false` when the stretch moves too much (the zoom is lowered). A SPLIT's cam band says how it is placed: `--place scale,ox,oy` and `--frame W,H`. `reframe()` gives `crop=w:h:x:y` per unbroken run, moving only on cuts. A punch-in on a screen recording with a cam inset means something on a cam band, a cam source or `--src rough`, not on the full screen.

`focus.py` counts where the pixels change in a stretch (dense areas only: a clock, a caret or the pointer drop out), pads the box, widens it to the output's shape and limits the zoom to 2. When almost nothing or almost everything changes (an animated map) it says so and gives zoom 1. `--cam r1` guesses the inset from the face (measure only); check with `--draw` before using a box.

## edl.json (the edit list; `edl.py` has the helpers)

```json
{ "version": 2, "fps": 60, "width": 1920, "height": 1080, "total": 591.533,
  "sources": { "r1": { "file": "footage/rec1.mkv", "words": "out/work/words-r1.tsv" } },
  "items": [ { "kind": "S", "beat": 1, "at": 0.0, "len": 7.35, "src": "r1", "src_in": 27.82, "src_out": 35.17 } ] }
```

`sources` are the recordings (paths relative to `video/`); `words` is the word file of that recording (`start<TAB>end<TAB>word`; `handover.py --transcribe` makes a missing one once). `items` are back to back in cut order: `at` and `len` in rough seconds. An item whose **sound** is a stretch of a source has `src`, `src_in`, `src_out` (speed 1): its words map into the rough. Everything else (`kind` letter, `pic_in`, `crop`, `speed`, a voice-over `id`) passes through. A ramp, hold or end card has no `src` (use `pic_*` for a picture range). A voice-over line is a source too (`"vo": {"file": "out/work/vo/all.wav", "words": "out/work/vo/all-words.tsv"}`, the slot has `src: "vo"` and `src_in` = where the line starts in that file). `python engine/edl.py check` validates it; `python engine/edl.py migrate` upgrades an old file.

Optional fields (still version 2; everything passes them through):

- `cut_before` `{"kind": "pause|filler|retake|aside|wait|other", "why": "...", "flag": false, "ask": "..."}`: the cut between the item before and this one, written by the rough cut stage; `flag` true = a judgment call for you, `ask` what to decide.
- a sped wait: kind "W", no `src`, `pic_src`, `pic_in`, `pic_out`, `speed` > 1, `len` = (pic_out - pic_in) / speed.

## events.json (written by a make_overlays.py with the `Events` builder)

```python
import sys; sys.path.insert(0, ENGINE)                 # ENGINE = the path of this engine/ folder
from pipelib import Cut; from tmap import load; from events import Events, gaps
cut = Cut(); T = load(cut.edl)                       # T.m('r1', 59.8) = rough time of that source second; T.beat(4, True) = end of beat 4
E = Events.for_cut(cut, 'long')                       # 'long' or 'short': the pace numbers
E.add('L1', 'text', T.m('r1', 40.87), T.m('r1', 44.07), comp='Label', props={'text': 'ONE REQUEST'}, what='label L1', sfx={'file': 'pop', 'vol': 0.16})
E.zoom('P1', 23.4, 49.5, x=0, y=30, zoom=1.5, what='three title picks')           # ffmpeg crop+scale, eased 0.4 s in and out
E.caption('K1', [[1.0, 1.3, 'Hello'], [1.3, 1.7, 'there']])                      # ASS, not Remotion
E.sfx(12.0, 'whoosh', 0.1)
doc = E.write(cut)                                    # validates, writes events.json and timeline.json
print(gaps(cut, doc))                                  # stretches over 10 s with nothing changing
```

An event is `{id, kind, at, end}` plus: `comp` + `props` (which Remotion component draws it), or `zoom/x/y/ease/mask` (kind `zoom`, drawn by ffmpeg), or `words` (kind `caption`, drawn by ASS); `text`, `what`, `pace` (for the pace check only); `render: false` (it is already in the rough: counted by the pace check, drawn by nobody); `sfx` (a sound at `at`). `kind` is the pace check's word: `text` (a made text block), `card` (chapter/title/end card), `effect` (a made animation or mark with no readable words), `caption`, `zoom`. The full field list is the docstring of `events.py`. **Ids are stable**: do not renumber on every edit. `timeline.json` is `{"format": "long"|"short", "events": [{at, end, kind, zoom?, text?, what?}]}`. A diagram built in steps is one event (one window) whose `pace` list holds one entry per step.

## The template contract (Remotion)

A workshop's `video/remotion/` folder has `src/components.tsx` exporting `COMPONENTS: Record<string, React.FC<{ev: Ev}>>` and **nothing else of its own**: no `Root.tsx`, `index.ts`, no base video. `render_windows.py` copies the engine's shared files (`remotion/*.ts`, `*.tsx`) into `src/pipeline/` before every render. `ev.at`/`ev.end` are seconds of the rough, `ev.props` is the event's props; use `useCurrentFrame()` as usual (frame numbers are absolute: a window renders frames a..b of one long composition, so times in props are rough times). Leave the background transparent. A component draws only while `at <= t < end` (the Layer filters). Fonts: `@remotion/google-fonts`. Images and other files go in `remotion/public/`.

The packages come from the workshop's own `remotion/node_modules` when it has them, else from `engine/remotion/node_modules` (`resolve.mjs`; the bundler then also resolves the template's imports there). `render_windows.py` bundles once per code change (cached in `work/bundle/`) and renders windows 5 at a time with 4 tabs each, every worker with its own browser (tabs of one browser share its GPU process and stop scaling early) (`--parallel`, `--concurrency`).

## Windows, the cache, holds

`windows.py` takes the events a component draws (zoom and captions never), merges those less than 1 s apart, pads 0.5 s each side, clamps to the video. Each window's hash covers its events' picture settings (id, comp, at, end, props: not `what`, `text` or sound), its frame range, fps, size, and the **code hash** (everything in `remotion/src` and `remotion/public`, and the Remotion version). The result is `video/out/work/overlays/<hash>.mov` (proof: `overlays-proof/`): lossless PNG frames with alpha in a .mov (`PRESENCE_OVERLAY_CODEC=prores` uses Remotion's own ProRes 4444 encoder instead; the codec is part of the hash). Editing one label changes one window's hash; the other files stay. Editing a component, an image in `public/` or the shared files re-renders all. Delete stale files with `render_windows.py --prune`.

**Still stretches are held, not rendered** (`holds.py`, `render_holds.py`, `remotion/render_frames.mjs`; `--no-holds` turns it off). Rings, finished diagram steps and the empty gaps between events sit still for seconds, so a window is cut into *busy* stretches (every frame drawn) and *holds* (a few frames drawn, one held). The window's hash and file name do not change: a held .mov and a fully rendered one are the same picture. How a hold is found: **planned from the events, checked by pixels.** An event's picture can only change near its start (`head`, 2.4 s: a spring pop-in takes up to 2.2 s to settle to the last pixel), near its end (`tail`, 0.5 s: the fade) and after each moment its props name (a float, or a number under `at`/`t`/`time`/`start`/`end`/`press`, that falls between `at` and `end` is a moment; a number under `after`/`delay` is seconds after `at`; `settle` seconds after a moment the step has landed). The rest is a hold candidate (at least 0.8 s). Chrome draws the hold's first frame, one 0.25 s later, one every 1.5 s and its last; a worker thread compares them with the held frame (premultiplied, max channel difference 2), and **a hold whose samples differ is drawn in full**: a wrong guess costs time, never a wrong picture. The frames go into the .mov with their real timestamps (variable frame rate: ffmpeg's overlay shows a frame until the next one's timestamp, so a held frame costs nothing at compose time either).

Say more in events.json when the plan needs it: `"still": false` (never hold: a looping or pulsing animation), `"still": {"from": t, "to": t}` or a list of those (declared still), `"settle": s` (this event settles in s seconds). A template gives whole components their numbers in `<video>/remotion/stills.json` (`{"Ring": {"head": 0.5, "tail": 0.3}, "Band": {"rel": ["after"]}}`; the engine's own `remotion/stills-short.json` does this for the Shorts kit, whose animations all settle in under half a second).

Known limits: a hold is checked at samples (first, +0.25 s, every 1.5 s, last), so an animation that comes and goes between two samples and is not named by the event is missed (`still: false`); the first run on a new template may draw a hold in full when its guess was too short, and says so in the log.

## Captions

Captions run through most of a video, so as Remotion windows they would merge into one render nearly as long as the video, and one changed word would re-render it. They are drawn as **ASS subtitles burned by ffmpeg in the same pass** (`captions.py`): a rounded dark box, white words, the word being said in gold, the rest dimmed, a short fade per block. No render at all, seconds to change. Set `captions: {style: {...}}` in events.json for font, size, position, colours, box. The long-form style uses Arial Black where the system has it, else the bundled Montserrat Black; the Shorts style (`mode: word`) uses Montserrat Black from `kit/fonts/` (OFL): words dim until said then white (accent words yellow), the word being said pops to 1.06 and settles over 0.12 s, every word its own positioned event so a pop never moves its neighbours, font size from the block's length (50/56/64), two rows when too wide. A caption event may carry its own `y`, `x`, `size`. The libass font size is `size / k` with `k = em / (usWinAscent + usWinDescent)` read from the font file, so the em is the size the style says. Style keys `current` (the colour of only the word being said), `outline` / `outline_color` (a stroke), `box_alpha: 0` (no box); `captions: {"on_top": true}` burns the captions after the overlay windows.

## Zoom

`kind: zoom` events are done in the compose pass with ffmpeg's `perspective` filter evaluated per frame: the crop window (`width/zoom` x `height/zoom` at x, y) eased in and out (inOutCubic over `ease` seconds), scaled up with cubic interpolation. Only the zoom stretches go through that filter (the stream is split, each zoom trimmed out by frame, zoomed, and concatenated back, still one ffmpeg call). They never touch Remotion, so a punch-in costs no render. A `mask` rectangle (rough pixels, painted while the zoom is fully in) hides things like a webcam strip. Zooms may not overlap. `E.push(id, at, end, zoom=1.0, to=1.08, ox=, oy=)` is a slow sine-eased push about a point that cuts back at `end`; `region=[x, y, w, h]` on either kind zooms only that part of the frame; `E.framing(id, at, end, zoom, what)` records a crop baked into the rough as a `render: false` zoom event. In a chunked final a zoom that runs across a chunk boundary is computed in the rough's absolute frame time, so both chunks draw the same crop at the same frame.

## Blur boxes and your edits

A **blur box** hides a part of the picture over a time range: private text, a key, a number, a face. It is an event of kind `blur` with `box: [x, y, w, h]` in the rough's pixels and `mode` `blur` (a box blur), `pixelate` (blocks) or `fill` (a solid box, `color`); `strength` is the radius or the block size (default a fifth of the box's short side). `E.blur(id, at, end, box, mode=)` writes one. ffmpeg draws it in the compose pass, **before the zoom** (a zoom over it scales the blur with the picture) and under the overlay windows (the visuals' own labels stay sharp): split, crop the box, blur it, overlay it back while `at <= t < end`. Boxes go to even pixels inside the frame. A blur never makes a window and never touches Remotion; the pace check leaves it out. The cost of adding one is the chunks of the final it overlaps (a chunk's cache key gains the boxes on it; a chunk without a box keeps the key it always had, so an edit list with no boxes composes byte for byte as before).

**Your edits sit beside events.json and win** (`user_edits.py`; the visuals stage's `make_overlays.py` may write events.json again without losing them):

- `out/redactions.json` `{"version": 1, "boxes": [{"id": "R1", "at", "end", "x", "y", "w", "h", "mode", "note"?}]}`: the boxes drawn in the viewer, as blur events with the id `user-R1`.
- `out/event-edits.json` `{"version": 1, "edits": {"L3": {"at"?, "end"?, "text"?, "props"?, "hide"?}}}`: the overlay inspector. `props` merge over the event's own; `hide: true` leaves the event out; an id that is gone is skipped and said so.

`events.py check`, `windows.py`, `render_windows.py`, `compose.py`, `sfx.py`, `check_cut.py` and `run.py` all read the events through `user_edits.load(cut)`, so a changed label in the inspector re-renders that one window, and a box re-encodes only its chunks. With neither file, `load` is exactly events.json.

## Sound

`events.json` `sfx` cues (top level and per event) become one layer (`sfx.py`; names resolve as in the config above) mixed over the rough's own audio with `amix normalize=0` at the cues' fixed levels. `E.bed('music', vol=0.08)` (or `env=[[t, level], ...]`) is a music bed under the whole cut. No loudnorm and no re-levelling of the voice. A safety limiter (0.95) is added only when the summed peak would clip; with no cues the rough's audio stream is copied.

## The chunked final (`compose_chunks.py`)

`compose.py --final` cuts the timeline into chunks of about 15 s (a Short: 10 s), encodes each with its own ffmpeg (closed GOP, a keyframe at its first frame, three at a time) and joins them with the concat demuxer and `-c copy`. A chunk is cached in `video/out/work/chunks/<key>.mp4` by the hash of **everything that touches its frames**: the rough's sha256 and the chunk's frame range, every Remotion event on screen in it, every zoom and caption event overlapping it, the caption style, size, fps, colour tags, the encoder settings, the ffmpeg version and the code's version. Boundaries are on a fixed grid, each moved at most a quarter of a chunk to the calmest nearby frame (no window, no zoom), so one edit moves no far boundary. A chunk reads the rough from the keyframe before it, `setpts=N/(fps*TB)` numbers the frames, `-frames:v` stops it, and a chunk with the wrong frame count is refused. **The sound is never cut:** the rough's voice (plus the effects layer) is mixed once into `work/audio-<key>.m4a` and muxed at the join, so no AAC priming can click at a seam. `seams.py` checks the result; `check_cut.py` runs its length, frames and voice checks on the joined file.

## Proof, then final

`run.py --proof`: renders only windows whose hash changed, at 540p/30 fps, then makes one clip per proof stretch (every overlay window, every zoom, six caption samples; touching ones merge) with the zoom, captions, overlays and sound, a burned-in label of the time and event ids, and joins them into `out/proof.mp4` plus `proof-sheet.jpg`. Clips are cached by what is in them. Look at the sheet and the clips, fix events, run `--proof` again. When it is right, `run.py --final` once.

## The cut check (`check_cut.py`, exit 1 on failure, plain words)

1. **length**: final = rough within 1 s (and the same size and fps); **frames**: the final has as many picture frames as the rough, within 8.
2. **locked**: `edl.json` and `rough.mp4` hash to `rough.json` and to the lock file.
3. **voice**: both audio tracks decoded to 16 kHz mono and compared second by second (normalised correlation at the one global lag, bar 0.9, 0.75 where an effect plays; the effects layer is taken off the final first). The final's voice *is* the rough's voice, so an exact comparison is more honest than a speech recogniser: a dropped, shifted or doubled word shows as a second where the correlation falls, with no GPU and no model.
4. `--words` (slow): faster-whisper "small" on final and rough with identical settings, words compared one for one (the rough's transcript cached by sha256).

The lock file is `{"locks": {"video/out/edl.json": {"sha256": "..."}, "video/out/rough.mp4": {"sha256": "..."}}}`, paths relative to the workshop (the folder that holds `video/`).

## Shorts (1080x1920, 60 fps)

| file | job |
|---|---|
| `remotion/shorts.tsx` | the **Shorts kit**: `KIT = {Band, Label, Pops, EndText, Box, Marker, Underline, Tag, Chips, Scrim, Flash}` (top-band hook/gloss/end text, label pill, kinetic title, end text over a dim, self-drawing box and ring with a click squeeze, marker sweep, underline, corner tag, chips, scrim, flash), plus `FONT`, `COL`, `useClock`, `easeIn`, `fadeOut`. A template's `components.tsx` does `import { KIT } from "./pipeline/shorts"; export const COMPONENTS = { ...KIT, Mine }`. Props are in each component's doc comment. |
| `shortcaps.py` | caption blocks from `rough-words.json`: `words_of(cut)`, `blocks(...)`, `add_captions(E, words, fix=, accent=, skip=, breaks=, max_words=)` (at most 5 words and 26 characters, breaks at sentence ends, commas, pauses, a change of part, `breaks` words; a lone short word joins the next block), `find(words, 'because', after=)` (anchor an overlay on a spoken word; fails loudly), `patch(words, [('see', 'it', 1)])` (put back small words whisper dropped). |
| `split_edl.py` | the edit list of a shell-built Short in a few lines: `--source key=file[,words]`, `--item "S 2 s_b2.mp4 p3 2.80 +"` (segment lengths are measured; `+` = src_in plus the segment's length). |

Shorts use `Events.for_cut(cut, 'short')`; text starts at y 120 or lower (the Shorts icons sit above); captions stay in x 60-900 (`captions: {style: {x: 480, y: 1300, maxw: 840}}`). `level.py` tags every frame BT.709 limited range without re-encoding, and `handover.py` refuses a rough with mixed frame properties and says so (ffmpeg would re-configure its filters mid-stream and lose frames).

Gotchas: windows need `at < end` and components must not draw outside `[at, end)`; do not give two zooms overlapping times (chain them back to back instead, or merge into one); a held frame belongs to the rough cut stage, not to visuals; keep times in rough seconds, never in source seconds.

## Licences

- The engine is part of The Vale's Presence (MIT, see the repository's `LICENSE`).
- **Remotion** is not open source in the usual sense: it is free for individuals and for companies up to a small size, and larger companies need a company licence. Read https://www.remotion.dev/license before you use the overlay render commercially.
- `models/face_detection_yunet_2023mar.onnx`: YuNet by Shiqi Yu et al., MIT (see `models/README.txt`).
- Montserrat (in `kit/fonts/`) is under the SIL Open Font License.
