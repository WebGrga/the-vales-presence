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

| what | how |
|---|---|
| another port | `PRESENCE_PORT=4900 npm start` (PowerShell: `$env:PRESENCE_PORT=4900; npm start`) |
| projects on another drive | `PRESENCE_DATA=D:\presence-data npm start` |
| do not open a browser | `npm start -- --no-open` |
| a specific Python for the engine tests | `PRESENCE_PYTHON=/path/to/python` |
| the model | Claude Opus by default, at medium effort; Sonnet is the cheaper choice (`data/settings.json`) |

The server listens on 127.0.0.1 only: nothing on your network can reach it.

## When something goes wrong

- **The Setup tab shows a cross after installing.** Programs installed while a terminal is open are not on that terminal's PATH. Close it, open a new one, and start the app again.
- **"python" opens the Microsoft Store.** Windows ships a stand-in named python. Install Python as above, or turn the stand-in off in Settings, Apps, Advanced app settings, App execution aliases.
- **Claude Code login.** Run `claude` in a terminal and log in there; the app uses the same login. The Setup tab shows the plan you are logged in with, never your email.
- **No GPU encoder.** The GPU check says which encoder works. "CPU (libx264)" is fine, only slower. Updating the graphics driver is the usual fix for a GPU that is there but not used.
- **Little disk space.** A long video's render cache can take 20 GB or more. The `video/out/work` folder of a finished project is a cache and can be deleted.
