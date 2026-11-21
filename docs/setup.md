# Setup

The Vale's Presence runs on your own computer. You need Node.js, Claude Code (logged in), ffmpeg, Python with numpy and Pillow, and uv. A GPU makes renders faster but is not needed.

The app checks all of this for you: start it, and if something is missing it opens on the **Setup** tab with a tick or a cross per requirement and the command that fixes it. Press **Check again** after you install something. The same list is at `http://localhost:4848/api/doctor`.

- [Windows](#windows)
- [macOS](#macos)
- [Linux (Debian, Ubuntu)](#linux-debian-ubuntu)
- [Then, on every system](#then-on-every-system)
- [Settings](#settings)
- [When something goes wrong](#when-something-goes-wrong)

## Windows

Tested on Windows 11 with an NVIDIA GPU. Open **PowerShell** (not as administrator) and run:

1. **Node.js 22 or newer**
   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```
2. **ffmpeg and ffprobe.** The full build includes the GPU encoders (NVENC, Quick Sync, AMF).
   ```powershell
   winget install Gyan.FFmpeg
   ```
3. **Python 3 with numpy and Pillow.** If the installer asks, tick "Add python.exe to PATH".
   ```powershell
   winget install Python.Python.3.12
   python -m pip install numpy pillow
   ```
4. **uv**, which runs the speech-to-text scripts:
   ```powershell
   winget install astral-sh.uv
   ```
5. **Claude Code**, then run it once and log in with your Claude account:
   ```powershell
   irm https://claude.ai/install.ps1 | iex
   claude
   ```
6. **Close PowerShell and open a new one** so it sees the new programs on PATH.
7. **GPU (optional).** Keep your graphics driver up to date. An NVIDIA card is used for encoding (NVENC) and for speech-to-text (CUDA); Intel and AMD cards are used for encoding.

## macOS

Not yet tried on real footage; the app and the engine run. Install [Homebrew](https://brew.sh) first, then in Terminal:

1. **Node.js, ffmpeg, Python with numpy and Pillow, and uv**
   ```bash
   brew install node ffmpeg python numpy pillow uv
   ```
   Homebrew's ffmpeg includes Apple's VideoToolbox encoder, which the engine uses by itself.
2. **Claude Code**, then run it once and log in:
   ```bash
   curl -fsSL https://claude.ai/install.sh | bash
   claude
   ```
3. Speech-to-text runs on the CPU on a Mac. It is slower than on an NVIDIA GPU but needs nothing more.

## Linux (Debian, Ubuntu)

Not yet tried on real footage; the app and the engine run (the tests run on Ubuntu on every change).

1. **Node.js 22** from NodeSource:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt install -y nodejs
   ```
2. **ffmpeg, Python with numpy and Pillow**
   ```bash
   sudo apt install -y ffmpeg python3 python3-numpy python3-pil
   ```
3. **uv**
   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```
4. **Claude Code**, then run it once and log in:
   ```bash
   curl -fsSL https://claude.ai/install.sh | bash
   claude
   ```
5. **GPU (optional).** With an NVIDIA card, install its driver (`sudo ubuntu-drivers autoinstall`) and use an ffmpeg build with NVENC. Without one the CPU encodes, only slower.

## Then, on every system

```bash
git clone <this repository> the-vales-presence
cd the-vales-presence
npm install                              # the server's two dependencies
npm install --prefix engine/remotion     # the overlay renderer (Remotion); its first render also downloads a headless Chrome
npm start                                # opens http://localhost:4848
```

The first time a recording is transcribed, uv downloads the speech-to-text model and its packages (a few GB, once).

Check that everything works:

```bash
npm test               # the server and the screen's logic
npm run test:engine    # the engine (Python with numpy and Pillow, and ffmpeg)
```

## Settings

The port, the data folder, the model and the rest are in [configuration.md](configuration.md). The two you may need first: `PRESENCE_PORT=4900 npm start` for another port, and `npm start -- --no-open` to keep the browser from opening. The server listens on 127.0.0.1 only: nothing on your network can reach it.

## When something goes wrong

Each answer has one home. For how the screen behaves, see [using.md](using.md).

**Starting the app**

- **"port 4848 is in use: is the server already running?"** The app is already running (look for its tab at http://localhost:4848), or another program holds the port. Stop the other copy with Ctrl+C in its terminal, or start this one on another port: `PRESENCE_PORT=4900 npm start`.
- **The browser did not open.** Open http://localhost:4848 yourself. On a server with no browser, start with `npm start -- --no-open`.
- **"Cannot find package" when starting.** Run `npm install` in the repository folder. The overlay renderer needs its own: `npm install --prefix engine/remotion`.

**The Setup tab**

- **A cross after installing.** Programs installed while a terminal is open are not on that terminal's PATH. Close it, open a new one, start the app again, and press **Check again**.
- **"Python 3 with numpy and Pillow": "numpy and Pillow not installed for this Python".** The `python` on your PATH is a different one from where you installed the packages. Run `python -m pip install numpy pillow` with that same `python`, or put the Python that has them first on your PATH. (`PRESENCE_PYTHON` is only for the engine tests: [CONTRIBUTING.md](../CONTRIBUTING.md#tests).)
- **"python" opens the Microsoft Store.** Windows ships a stand-in named python. Install Python as above, or turn the stand-in off in Settings, Apps, Advanced app settings, App execution aliases.
- **"Claude Code login: not logged in".** Run `claude` in a terminal and log in there; the app uses the same login. The Setup tab shows the plan you are logged in with, never your email.
- **No GPU encoder.** The GPU check says which encoder works. "CPU (libx264)" is fine, only slower. Updating the graphics driver is the usual fix for a GPU that is there but not used. To force one: `PRESENCE_ENCODER` in [configuration.md](configuration.md#environment-variables).
- **"Remotion ... not installed".** Run `npm install --prefix engine/remotion`. The first overlay render also downloads a headless Chrome, so it needs the internet once.
- **Research says "yt-dlp was not found".** The research stage uses yt-dlp: an installed one, else `python -m yt_dlp`, else `uvx yt-dlp` through uv. The Setup tab checks it (an optional row that names the command that answered, or warns that only uvx would run it, which downloads yt-dlp on first use). This message means none of those ran: install it with `uv tool install yt-dlp` (or `pip install yt-dlp`).

**While a project runs**

- **The project is halted: "A locked file changed after you approved ...".** Something changed the approved rough or edit list. The bar under the chips names the file and the stage. Press **Approve** to accept the new version (it is hashed again), or **Send back** with notes. Why this exists: [how-it-works.md](how-it-works.md#the-lock).
- **The chip says "waiting for your answer" and nothing moves.** The agent asked you something and waits. Open the Edit tab: the question is in the agent panel (press **Answer**). Nothing runs until you press **Send**.
- **A stage shows "Stopped. Press Go to run it again", or "The stage failed: ...".** Press **Go** to run it again; the agent continues in the same conversation. The failure text is also in the agent panel.
- **"The server stopped while this stage ran."** You closed the app (or it crashed) in the middle of a stage. Press **Go**: it resumes the agent's conversation.
- **A stage is "in line behind ...".** Only a set number of renders run at once (the `heavy` setting). It starts by itself when the one in front ends.
- **"nothing new for N min ... It may be stuck".** A stage printed nothing for the time set in `quietMinutes`. A long render can be quiet; look at the agent panel, then **Stop** or let it run.
- **A stage fails and the error mentions a limit or usage.** The agents run on your Claude subscription's limits. When Claude refuses a turn the stage shows "The stage failed: ..." with the reason, and its files so far stay. Wait until the limit resets, then press **Go**. A lower `effort` or the Sonnet model ([configuration.md](configuration.md#settings)) uses less. The app does not retry by itself.
- **Little disk space.** A long video's render cache can take 20 GB or more. The Setup tab warns under 20 GB free and fails under 5 GB. Delete `video/out/work` of a finished project (it is only a cache), or move the data to a bigger drive with `PRESENCE_DATA`. A render that runs out of disk fails its step: free space and press **Go**. The engine keeps the pieces it finished, so it does not start over.
- **"Drop your footage in first (video/footage is empty)".** Add footage in the Media panel before approving the Record stage.
- **Approve & lock says the rough does not have your choices.** You struck words, restored cuts or moved joins since the rough was built. Press **Rebuild with my choices**; see [using.md](using.md#approve-lock-and-send-back).
- **A video does not play in the viewer.** The browser cannot play that format directly. The viewer says "This video could not play here. A proxy (made by the server) plays everywhere." The server makes a small 540p proxy of each recording in `video/out/work/proxy/`; if it is missing, open the Edit tab again.

**Uploading**

- **Upload to YouTube is greyed out.** The **Before it goes** list on the Upload page says what is missing. Connecting YouTube is a one-time setup: [youtube-upload.md](youtube-upload.md).

If it still fails, the terminal where you ran `npm start` and the project's `.presence/log.jsonl` show what happened. Include them when you [report a bug](../CONTRIBUTING.md#reporting-a-bug), without your footage or private paths.
