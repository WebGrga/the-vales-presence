# Contributing

Thanks for helping. This page is short on purpose.

## Run it

```bash
git clone <this repository> the-vales-presence && cd the-vales-presence
npm install && npm install --prefix engine/remotion
npm start
```

Setup for each system, and what to do when it fails: [docs/setup.md](docs/setup.md). How the parts fit together: [docs/how-it-works.md](docs/how-it-works.md). The folders are listed in the [README](README.md#folders).

## Tests

```bash
npm test               # the server, the screen's logic, the kit, and the engine suites
npm run test:engine    # only the engine's Python suites (engine/test_*.py)
```

- `npm test` is `node --test`: it runs every `*.test.js` next to the code, and `tools/test-engine.mjs`, which runs the engine suites. Run `npm run test:engine` on its own to see the engine's output apart.
- The engine suites need Python 3.10+ with numpy and Pillow, and ffmpeg on your PATH. The runner uses the first of `python`, `python3` or `py -3` that imports numpy and Pillow. To use a specific one, set `PRESENCE_PYTHON`:

  ```bash
  PRESENCE_PYTHON=/path/to/python npm test                          # macOS, Linux
  $env:PRESENCE_PYTHON = "C:\path\to\python.exe"; npm test          # Windows PowerShell
  ```
- The tests need no GPU, no Claude login, no YouTube account and no real footage: agents are faked and the media is tiny and generated. The same two commands run on every push (`.github/workflows/ci.yml`).
- A change comes with a test where the logic can be tested. Keep logic pure (data in, data out) in its own file so the test needs no browser and no server.

## Style

What the repository already does:

- **Plain ES modules, no build step.** The server is Node 22+ with `import`/`export`; the screen is native modules in `web/` served as they are. No bundler, no framework, no TypeScript outside the overlay templates. Keep dependencies to the two in `package.json`.
- **One job per file, and short files.** Each file starts with a comment that says what it is and what its pure parts are. Split a file that grows past a few hundred lines.
- **Pure decisions, thin wiring.** Rules (what a chip shows, which cuts come first, what an export writes) are pure functions with a `*.test.js` beside them; the DOM or the HTTP route only calls them.
- **Formatting.** Two-space indent, single quotes, semicolons, `const` by default. Match the file you are in.
- **Python** (the engine) uses numpy and Pillow, with a docstring on every module and `test_*.py` files using `unittest`. The speech-to-text scripts are uv scripts that list their own packages in a header. Every script finds its own folder, so it runs from anywhere.
- **Plain words on the screen.** Short sentences, the name the user already sees, no jargon. Every button label in [docs/using.md](docs/using.md) is the label in the code: if you rename one, change the doc.
- **Nothing outward without a click.** The app never uploads, publishes or sends anything unless the user presses the button for it, and nothing calls Claude without a stage, a chat message or a confirmed button.
- **No private data** in the repository: no personal paths, emails, tokens or footage. `kit/kit.test.js` checks the kit and the public docs for it.

## Changing the docs

The docs are in `docs/` and the README. Write in short, plain sentences and second person. Check every command and name against the code, and every relative link against the files. [docs/using.md](docs/using.md) lists each screen, button and key, [docs/configuration.md](docs/configuration.md) each setting and variable.

## Reporting a bug

Open an issue and say:

1. **What you did** and **what you expected**, in a few lines.
2. **What happened**: the message on the screen (copy it), and the last lines of the terminal where you ran `npm start`.
3. **Your system**: the operating system, Node version (`node -v`), whether you have an NVIDIA, Intel, AMD or Apple GPU, and the result of the Setup tab (it never shows your email).
4. If a project is involved: its recipe, the stage it was at, and the stage log, `data/projects/<id>/.presence/log.jsonl`.

Please leave out your footage, your Claude or Google credentials, and anything private on your screen. A screenshot is welcome if nothing private is in it. A sample that reproduces the bug on a short generated clip is the best report.
