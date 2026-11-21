# How it works

The Vale's Presence is a small local server (`server/`), a screen in your browser (`web/`), an editing engine (`engine/`: Python, ffmpeg and Remotion) and what the agent knows (`craft/`). The agent is Claude Code itself, run through the Claude Agent SDK on your own login. This page explains the parts that make it different: the stages, the lock, overlay windows and chunk caching, the agent sleeping while it renders, and the context room.

## Stages

A project follows a **recipe** (`craft/recipes/*.json`): a list of stages, each of one kind.

| kind | who | what happens |
|---|---|---|
| `ask` | agent | asks you what it needs and writes `brief.md` |
| `make` | agent | does the work and ends when its files exist (the rough, the visuals, the picks) |
| `gate` | you | you approve, or send it back with notes; a gate can lock files when you approve |
| `inspect` | agent | checks the result against a checklist and writes `inspect.md` |
| `record` | you | you record and drop the footage in |
| `options` | you | you pick from options shown as cards (titles, thumbnails, the Shorts to cut) |
| `upload` | you | you press Upload; nothing is published without that click |

`craft/stages.json` holds the general instruction for each kind; a recipe's `focus` adds what this stage is for. One warm agent session runs per project, so the agent remembers the whole project from stage to stage, and the session id is stored so a restart resumes it.

Every stage logs its start, time and cost to `.presence/log.jsonl` and `project.json`. The cost is the difference of the SDK's running total between turns, so each stage shows what it really cost; the stage bar adds them up.

A project on disk:

```
data/projects/<id>/
  project.json        stages, their status, time and cost, the current stage
  brief.md            what you want
  video/              footage/, out/ (edl.json, rough.mp4, events.json, final.mp4), remotion/
  studio/             plan, script, research, titles, thumbnails, the Shorts and your choices
  .presence/          locks.json, the agent's session, the stage log
  export/             what the Export tab made
```

## The rough cut, measured

The rough cut stage transcribes every word (faster-whisper, verbatim so fillers stay visible, then aligned to the sound), measures silences, fillers, retakes, asides, dead air and long waits, and writes the cut as an **edit list** (`video/out/edl.json`): which stretch of which recording plays when. Every join is then measured on the source sound: a join that clips a word fails the check, and edges are moved a little into the quiet. The rough is built from the edit list in cached pieces with short crossfades, and the voice is levelled once.

At the handover the engine lists every cut (`video/out/cuts.json`) with what was removed, why, whether it is a judgment call, and two short clips: the source around the removal (Before) and the rough around the join (After). That is the Cuts list you go through with Keep, Restore and Note.

## The lock

The rough review is a gate with a lock. When you press **Approve & lock**, the server hashes the approved files (`video/out/edl.json` and `video/out/rough.mp4`, sha256) into `.presence/locks.json`.

From then on, before and after every agent stage the server hashes them again. If either changed, the project **halts** with a message that says which file changed and at which stage. The engine reads the same lock file: it never rebuilds a locked rough, and its final check compares the final's voice with the rough's second by second. So once you approve the talk, nothing later (visuals, fixes, a confused agent) can change a word of it. To change the talk you send the project back to the rough, which makes a new rough you approve again.

## Overlay windows and chunk caching

Visuals are **events** (`video/out/events.json`): a label from 12.4 s to 15.4 s, a zoom, a caption block, a sound. They are written in seconds of the locked rough, by a template's `make_overlays.py` (`kit/templates/`).

- **Zooms and punch-ins** are crops eased in and out by ffmpeg. Nothing is rendered.
- **Captions** are subtitles burned in by ffmpeg in the same pass. Changing a word takes seconds.
- **Everything else** is drawn by Remotion, but only where it is on screen. Events close together are merged into a **window**; each window is rendered once, transparent, and cached under a hash of its events, its frames, the size, and the template's code. Changing one label changes one window's hash: that window is drawn again, every other one is read from the cache.
- **Still stretches are held.** A ring that sits still for 10 seconds is not 600 frames. The engine plans from the events which stretches cannot move, draws a few sample frames of each, checks them pixel by pixel, and holds one frame. A wrong guess costs a second render of that stretch, never a wrong picture.
- **The final is composed in chunks** of about 15 seconds (10 for a Short), each cached under its own key (its frames, the windows, zooms and captions in it, the sound). The chunks are joined without re-encoding. A changed label re-encodes the one or two chunks it is in.

Measured on a 10-minute 1080p60 video: the first visuals round took 6.7 minutes of machine time instead of 70, and fixing one label in the finished video took 36 seconds (one window of 253 frames drawn, one of 39 chunks re-encoded, the join, the check).

## The agent sleeps while rendering

Renders are long, and an agent waiting on one would spend time and money watching a progress bar. So a long render is started as a **background task**: the agent starts it, ends its turn, and the stage stays **running**. The server keeps a list of these background tasks (the stage bar shows them burning). When the task ends, the SDK starts the agent's next turn with the result, or the server wakes it with "Your background task finished" and the tail of its log. The agent then reads the log and carries on. Nothing polls, and the time the render takes costs nothing.

## The context room

The **Context** tab shows what the agent reads at each stage, as a map: one column per stage of the recipe, with the skills switched on for it, the standing instructions (`craft/CLAUDE.md`), the house rules (`craft/house-rules.md`) and the brief, each with its size in words and a line to every stage that reads it.

- Everything is readable and editable in place. Your changes are kept in `data/craft/` and win over the shipped files; "Reset to default" brings the shipped version back.
- Skills (`craft/skills/<name>/SKILL.md`) are switched on and off per stage (`craft/stage-skills.json`, your overrides in `data/craft/stage-skills.json`). A stage's prompt names only the skills switched on for it, so the agent reads what that stage needs and nothing else.
- The house rules have a **Lessons** section that learns: when one of your corrections shows a way of working that would go wrong again, the agent writes a lesson with its date and evidence, and each lesson keeps a count of how often it held up.

## Shorts from a long video

The pick stage reads the whole talk and writes the moments that stand alone (a strong first line, one point, a payoff, under a minute) to `video/out/shorts/picks.json` (or `studio/shorts.json`). The **Shorts** tab shows each as a 9:16 card that plays its stretch, with Keep, Drop and a note, saved at once to `studio/shorts-review.json` so the agent can revise its list without losing your clicks. **Cut these** approves the pick review with your choices in plain words and starts the cutting stage.

## Export

The **Export** tab makes, on your machine:

- **MP4**: the final, or the approved rough before the visuals exist.
- **SRT**: the video's own caption lines when they cover the talk, else every spoken word in short lines, fillers left out. Times are the rough's, which the final keeps.
- **FCPXML 1.10** and **OTIO**: the approved edit list as a timeline, one clip per kept stretch, linked to your original footage. Sped-up waits and held stills keep their timing. The overlays are not in these files.

The writers are pure functions (`server/export/`), tested with small fake edit lists.

## Setup checks

`GET /api/doctor` runs every check at once (`server/doctor/`): Node, ffmpeg and ffprobe, Python with numpy and Pillow, uv, the Claude Code login (the Agent SDK starts a session and reports the account without sending a prompt, so the check spends nothing), Remotion in `engine/remotion`, the GPU and which encoder really works (each candidate encodes a tiny test clip), and free disk space. Each failed check carries a fix for your system (`server/doctor/fixes.json`).
