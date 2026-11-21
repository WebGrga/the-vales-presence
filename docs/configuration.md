# Configuration

Everything you can set, and where your data lives. To change how the agents work (skills, rules, recipes, overlay templates), see [customising.md](customising.md).

- [Start the app](#start-the-app)
- [Settings](#settings)
- [Environment variables](#environment-variables)
- [The engine config file](#the-engine-config-file-presencelocaljson)
- [Image models](#image-models)
- [Where your data lives](#where-your-data-lives)
- [What's in a project folder](#whats-in-a-project-folder)

## Start the app

```bash
npm start                 # opens http://localhost:4848 in your browser
npm start -- --no-open    # the same, without opening a browser
```

The server listens on 127.0.0.1 only. Stop it with Ctrl+C in the terminal where it runs; the agents' sessions close with it, and a stage that was running is marked as not run when you start again.

## Settings

The agent settings are in `data/settings.json`. The **Settings** tab of the app (see [using.md](using.md#settings)) changes every one of them and saves to that file; the file still works too, with any text editor, and so does the running server:

```bash
curl -X POST http://localhost:4848/api/agent/settings -H "content-type: application/json" -d '{"effort":"high"}'
```

`GET /api/agent/settings` shows the current values and the allowed ones. A key that is missing or invalid in the file falls back to its default; unknown keys in the file are left alone and ignored. A save through the server (the Settings tab or `POST`) is checked first: an unknown key or a value that is not allowed answers 400 with the reason and nothing is saved. The file is created the first time a setting is saved.

| key | default | allowed | what it does |
|---|---|---|---|
| `model` | `claude-opus-5-5` | `claude-opus-5-5` (Opus 5.5, the best editor) or `claude-sonnet-5-5` (Sonnet 5.5, cheaper, for simpler stages); any other model id of 2 to 60 letters, digits, `.`, `-`, `[` and `]` is accepted | the Claude model every agent stage and chat uses |
| `effort` | `medium` | `low`, `medium`, `high`, `xhigh`, `max` | how hard the model thinks. Higher is slower and costs more |
| `permissionMode` | `auto` | `auto`, `acceptEdits` | how the unattended agent is allowed to use tools. `auto` lets Claude Code's own auto mode decide what is safe; with `acceptEdits` the agent may use only Bash, Read, Write, Edit, Glob, Grep, WebSearch and WebFetch. In both, a tool that would need your permission is refused with a reason, because no one is there to click. The agent can always ask you a question |
| `chain` | `true` | `true`, `false` | agent stages run on by themselves, one after another, until a stage needs you. `false`: you press **Go** on every agent stage |
| `heavy` | `1` | a whole number from 1 to 8 | how many render stages (the rough cut, the visuals, cutting Shorts) run at the same time across all projects. The others wait in line ("in line behind ...") |
| `quietMinutes` | `15` | 0 to 240 | a stage that shows no output for this many minutes is reported to you once as possibly stuck, and keeps running. `0` never reports |

When a change takes effect:

- `model` and `effort` are applied to a session that is open the next time you give it work.
- `permissionMode` is read when a session starts: a session closes after about 55 minutes without a turn, or when you start a fresh conversation, and the next one uses the new mode.
- `chain`, `heavy` and `quietMinutes` are read every time they are needed.

The agents run on your own Claude Code login, so these settings change your subscription's usage and nothing else. The cost of every stage is shown on its chip.

## Environment variables

Set them before `npm start` (PowerShell: `$env:NAME = "value"; npm start`).

| variable | default | what |
|---|---|---|
| `PRESENCE_PORT` | `4848` | the port the server listens on |
| `PRESENCE_DATA` | `<repo>/data` | the folder for your projects and settings. Point it at another drive when the project drive is small |
| `PRESENCE_NO_OPEN` | not set | `1` is the same as `--no-open` |
| `PRESENCE_PYTHON` | the first of `python`, `python3`, `py -3` that has numpy and Pillow | the Python for `npm run test:engine` only. The app and the agent run `python` from your PATH |
| `PRESENCE_UPLOAD_DRY` | not set | `1` makes every upload a dry run against a fake YouTube: nothing leaves your computer |
| `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` | not set | your Google OAuth client, as an alternative to `data/youtube-client.json`. See [youtube-upload.md](youtube-upload.md) |
| `PRESENCE_ENCODER` | probed (the first one that works) | force the video encoder: `h264_nvenc`, `h264_qsv`, `h264_amf`, `h264_videotoolbox`, `libx264`, or `cpu` |
| `PRESENCE_WHISPER_DEVICE` | CUDA when there is a GPU | `cpu` forces speech-to-text onto the CPU |
| `PRESENCE_COMPOSE_JOBS` | `3` | how many chunks of the final are encoded at a time |
| `PRESENCE_OVERLAY_CODEC` | `png` | how a rendered overlay window is stored: `png`, `utvideo`, `qtrle`, `prores` |
| `PRESENCE_SOUNDS`, `PRESENCE_FONTS` | not set | extra folders for sound effects and caption fonts (separated by `;` on Windows, `:` elsewhere) |
| `PRESENCE_REMOTION_MODULES` | `engine/remotion/node_modules` | the `node_modules` the template type-checker uses |
| `PRESENCE_CONFIG` | `<repo>/presence.local.json` | another path for the engine config file |
| `COMFYUI_URL`, `HF_TOKEN`, `REPLICATE_API_TOKEN`, `FAL_KEY`, `OPENAI_API_KEY` | not set | keys and addresses for AI image models, see [thumbnails-ai-images.md](thumbnails-ai-images.md) |

The engine reads `PRESENCE_ENCODER`, `PRESENCE_COMPOSE_JOBS`, `PRESENCE_OVERLAY_CODEC`, `PRESENCE_SOUNDS`, `PRESENCE_FONTS` and `PRESENCE_REMOTION_MODULES` itself, in any program that runs it, so you can also set them in the file in the next section. The full list for the engine, with its defaults, is in [engine/README.md](../engine/README.md#the-config-pipelibpy).

The app sets these for the agent's sessions; you do not set them: `PRESENCE_ENGINE` (the `engine/` folder), `PRESENCE_ROOT` (the repository), `PRESENCE_PROJECT` (the project id), `PRESENCE_VIDEO` (the project's `video/` folder) and `PRESENCE_LOCKS` (the project's lock file).

## The engine config file: `presence.local.json`

An optional file in the repository root, never committed (it is in `.gitignore`). It is for a machine that runs the engine from programs that cannot pass environment variables. Each key is an environment variable's name in lower case without the `PRESENCE_` prefix, and the environment always wins over the file:

```json
{
  "sounds": "~/my-sounds",
  "fonts": "~/my-fonts",
  "encoder": "libx264"
}
```

The keys the engine reads from it: `video`, `locks`, `sounds`, `fonts`, `encoder`, `compose_jobs`, `overlay_codec` and `remotion_modules`. `~` stands for your home folder. A relative `locks` path is taken from the workshop (the folder that holds `video/`). `PRESENCE_WHISPER_DEVICE` and `PRESENCE_CONFIG` itself are read from the environment only. You almost never need this file.

## Image models

AI backgrounds for thumbnails are off until you turn a model on. Your choice goes in `data/craft/image-models.json`, laid over the shipped list in `craft/image-models.json` by `id`:

```json
{ "models": [ { "id": "flux-schnell-local", "enabled": true } ] }
```

Which models exist, what each needs (a GPU, an API key), their prices and how to set up a local model are in [thumbnails-ai-images.md](thumbnails-ai-images.md). The research stage also needs `yt-dlp` on your computer (`uv tool install yt-dlp` or `pip install yt-dlp`); it reads only video details and thumbnails and downloads no video.

## Where your data lives

Everything you make is in one folder, `data/` in the repository (or `PRESENCE_DATA`). It is never committed.

| path | what |
|---|---|
| `data/projects/<id>/` | one folder per project, see below. `<id>` is made from the project's name |
| `data/settings.json` | the [settings](#settings) |
| `data/craft/` | your own versions of what the agent knows: house rules, skills, recipes, instructions. They win over the shipped files in `craft/`. See [customising.md](customising.md) |
| `data/backups/<day>/` | the day's first copy of any file you changed in the Context tab |
| `data/context/` | drafts of Context-tab edits you have not saved |
| `data/youtube-client.json`, `data/youtube-token.json` | your Google OAuth client and the connection. Delete the token file or press **Disconnect** to disconnect |

To move or back up your work, copy `data/`. To start fresh, delete a project's folder.

## What's in a project folder

```
data/projects/<id>/
  project.json         the recipe, the current stage, each stage's status, time and cost
  brief.md             what you want (the agent writes it at the Brief stage)
  inspect.md           the Inspect stage's checklist
  video/
    footage/           your recordings
    out/               everything the engine makes
      edl.json           the edit list: which stretch of which recording plays when
      edl.working.json   your strikes, restores and trims, before they are built
      rough.mp4          the rough cut; rough.json and rough-words.json describe it
      cuts.json          every cut, with its Before/After clips; cuts-review.json holds your Keep / Restore / Note
      events.json        the overlays, zooms, captions and sounds, in seconds of the rough
      event-edits.json   your changes from the overlay inspector
      redactions.json    your blur boxes
      review-items.json  what the agent asks you to look at
      proof.mp4, final.mp4
      steps.jsonl        the engine's step log with times
      work/              caches (proxies, chunks, overlay windows). Safe to delete when the project is finished
    remotion/          the overlay components for this project
  studio/              plan.md, script.md, research/, titles.json, thumbs/, upload.json, shorts/picks.json, shorts-review.json
  shorts/<id>/video/   a workshop for each cut Short
  export/              what the Export tab made: subtitles, edit lists, chapters, and media/ (the .mp4 copies of recordings)
  .presence/           locks.json, session.json (the agent's saved session), log.jsonl (the stage log), drafts.json (what you typed and did not send)
```

A cache in `video/out/work/` can take 20 GB or more for a long video. Deleting a finished project's `work/` folder is safe; the next render rebuilds what it needs.
