# Customising

What the agents know lives in plain files: recipes, skills, house rules and overlay templates. You can change any of them without touching the app's code. Your own versions go in `data/craft/` and win over the shipped ones in `craft/`, so a `git pull` never overwrites them.

- [The house rules](#the-house-rules)
- [A skill](#a-skill)
- [A recipe](#a-recipe)
- [The standing instructions](#the-standing-instructions)
- [An overlay template](#an-overlay-template)
- [Sounds and fonts](#sounds-and-fonts)

Anything in `data/craft/` can also be changed from the Context tab, which backs up the day's first version of a file before it changes it ([using.md](using.md#the-context-tab)). Changes count from the next stage the agent runs.

## The house rules

The house rules are a book of markdown the agent reads before every stage. Where a rule and a skill disagree, the rule wins.

- **Edit it** in the Context tab (click **House rules**, change it, **Save**), or edit `data/craft/house-rules.md` yourself. If that file does not exist yet, the app uses the shipped `craft/house-rules.md`, and the first save copies it to `data/craft/`. **Reset to default** brings the shipped book back.
- **How we cut** is yours: one rule per list item, in your own words ("a pause before a reveal is never cut"). Empty means the skills decide.
- **Tools we use** is what works on this computer. The agent adds a line when it finds something, with the date.
- **Lessons** is written by the agent from your corrections, as one list item with its date, its evidence, and two counts:

  ```
  - Keep a beat of air before a reveal: the viewer needs it to land. _(2026-11-20; evidence: you restored three tightened pauses before reveals; kept 0, against 0)_
  ```

  `kept` goes up when you approve work that followed the lesson, `against` when a correction goes against it. A lesson with more `against` than `kept` (and at least 2) is marked "up for review" in the Context tab. Edit or delete a lesson as you like.

## A skill

A skill is a folder with one file, `SKILL.md`: a short header, then the steps in your own words. The agent reads the skills switched on for a stage before it starts that stage.

```
data/craft/skills/cut-my-way/SKILL.md
```

```markdown
---
name: cut-my-way
description: Tighten my talking-head videos the way I like: what to keep, what to cut. Use at the rough cut.
---

# How I like it cut

- Keep my jokes even when a pause follows.
- ...
```

- The name is 3 to 64 lower-case letters, digits and dashes, and matches the folder name. The `description` line is what the agent reads first, so say what it is for and when to use it.
- The easy way is **New skill** in the Context tab: it writes the file and can switch it on for a stage straight away.
- Skills are **per stage**. Which skills a stage reads is the list in `craft/stage-skills.json`; your changes are kept in `data/craft/stage-skills.json`. A key is a stage id (every recipe) or `<recipe>/<stage>` (that recipe only, which wins), and its list replaces the shipped list for that stage:

  ```json
  { "visuals": ["visuals-overlays", "cut-punch-in", "cut-my-way"] }
  ```

  In the Context tab you do this with "+ switch a skill on" and the **×** on a skill.
- A skill of yours with the same name as a shipped one replaces it. The shipped ones are in `craft/skills/`; read them for examples.

## A recipe

A recipe is a list of stages. The shipped ones are in `craft/recipes/` (`edit`, `video`, `short`, `shorts-from-long`). Add your own as `data/craft/recipes/<id>.json`; it shows in the project picker's **Recipe** menu. A recipe with the same `id` as a shipped one replaces it.

```json
{
  "id": "my-edit",
  "name": "My edit",
  "about": "One line the picker shows under the menu.",
  "format": "long",
  "stages": [
    { "id": "ask", "kind": "ask", "title": "Brief", "out": ["brief.md"],
      "focus": "What this stage is for, in a few sentences." },
    { "id": "rough", "kind": "make", "title": "Rough cut", "heavy": true,
      "out": ["video/out/edl.json", "video/out/rough.mp4", "video/out/cuts.json"],
      "focus": "..." },
    { "id": "rough-review", "kind": "gate", "title": "Rough review", "back": "rough",
      "lock": ["video/out/edl.json", "video/out/rough.mp4"], "focus": "..." }
  ]
}
```

| field | meaning |
|---|---|
| `id` | letters, digits, `.`, `_`, `-`; unique inside the recipe. Stage ids are also the keys in `stage-skills.json` |
| `kind` | what the stage does, one of the kinds in `craft/stages.json` (below) |
| `title` | the chip's name |
| `focus` | what this stage is for. It is added to the kind's general instruction in the agent's message. This is where you steer the agent |
| `out` | files the stage must leave. The stage is done when they exist |
| `heavy` | `true` for a long render: these run one at a time across projects (the `heavy` setting) |
| `back` | on a gate: the earlier stage **Send back** returns to |
| `lock` | on a gate: files hashed when you approve it. From then on a change to them halts the project |

The kinds, from `craft/stages.json`:

| kind | who | does |
|---|---|---|
| `ask` | agent | asks you what it needs and writes `brief.md` |
| `make` | agent | does the work and ends when its `out` files exist |
| `inspect` | agent | checks the work against a checklist and writes `inspect.md` |
| `gate` | you | approve or send back; may lock files |
| `record` | you | you record and drop the footage in |
| `options` | you | you pick from cards |
| `upload` | you | you press Upload |
| `export` | you | you export from the Export tab |

The general instruction for each kind is in `craft/stages.json`. You can change a kind's wording for all recipes by putting a key of the same name in `data/craft/stages.json`. The agent kinds are `ask`, `make` and `inspect`; the user kinds are the other five. The app treats a kind name you invent as neither, so use these eight.

The agent stage you write must be something the engine and the skills can do. The engine's commands are in [the engine README](../engine/README.md) and the agent's standing instructions in `craft/CLAUDE.md`. A recipe is only a list and some words: write what you want in `focus`, and put the how into a skill.

Which skills each stage of your recipe reads: add `my-edit/<stage>` keys to `data/craft/stage-skills.json`, or use the Context tab with your recipe selected.

A project keeps its recipe's id and reads the recipe each time, so changing a recipe changes the projects that use it (a stage you add is filled in for them).

## The standing instructions

`craft/CLAUDE.md` is what every agent session gets besides Claude Code's own prompt: where things are, how it works, the engine in one screen. To change it for yourself, edit it in the Context tab (**CLAUDE.md**) or copy it to `data/craft/CLAUDE.md` and edit that. Keep the rules about the lock and about never uploading.

## An overlay template

Overlays are React components rendered with Remotion. The kit has three starting points in `kit/templates/`: `shorts-bold`, `shorts-calm` (vertical) and `longform-clean` (16:9). Each folder holds:

| file | does |
|---|---|
| `components.tsx` | exports `COMPONENTS`, a map from names to React components that each draw one event (`ev.at` and `ev.end` in seconds of the rough, `ev.props`). Leave the background transparent |
| `make_overlays.py` | writes `video/out/events.json` (what is drawn when) with the engine's `Events` builder |
| `README.md` | what the template has and how to change it |

The agent copies a template into the project (`video/remotion/src/components.tsx`, `video/out/work/make_overlays.py`) and changes the text and times, so most of the time you only tell it what you want in the chat panel. To change the look of every video:

1. Copy a template folder to a new name, for example `kit/templates/my-look/`.
2. Edit `components.tsx` (the look) and `make_overlays.py` (the events). The template README of the one you copied lists the props and the knobs.
3. Type-check it: `python engine/typecheck.py kit/templates/my-look` (needs `npm install` in `engine/remotion`).
4. Tell the agent to use it ("use the my-look template from kit/templates for the visuals"), or put that line in your house rules under **How we cut**.
5. Run `npm test` before you share it. The kit test (`kit/kit.test.js`) lists the three shipped templates by name and checks each has a README starting `# <name>`, `COMPONENTS`, and the two engine hooks in `make_overlays.py`. Add your template's name to that list, or keep it out of `kit/` and give the agent a path instead.

How windows, holds and the chunk cache react to a template's code, and the contract a component must keep: [the engine README](../engine/README.md#the-template-contract-remotion).

## Sounds and fonts

Sound effects are `.wav` files in `kit/sounds/`, listed in `kit/sounds/sounds.json`; an overlay asks for one by its name (`pop`, `whoosh`, `marker`). Add your own to a project's `video/assets/` (it wins over the kit's) or to a folder named in `PRESENCE_SOUNDS` ([configuration.md](configuration.md#environment-variables)). Caption fonts: Montserrat Black ships in `kit/fonts/`; a font in `PRESENCE_FONTS` or installed on the system is found by name.
