# Thumbnails and AI images

The Studio's thumbnails are **composed in code**: a frame of your video, your own photo, big words and a few shapes, drawn by `server/studio/thumb_compose.py` (Python + Pillow) from a small JSON spec the agent writes. That needs nothing else and costs nothing.

An **AI image model** can add what you can't film: a background, a scene, a prop. It is optional, off by default, and never used for your face or for the words.

## Good practice

- **Backgrounds and props from the model; faces and words in code.** A model's version of you is not you, and its letters are unreliable. Your face comes from your own photos or a frame of your footage; every word is set by the composer.
- **Ask for empty space.** Say where the face and words will go ("lots of empty space on the left") and add "no text, no letters, no people". Models still slip in fake writing sometimes (on signs, screens, sticky notes): look at the picture and blur, crop or regenerate.
- **One bright thing.** Ask for a dark or plain scene with one lit subject, so the face and words stay the brightest things in the frame.
- **Make it at 16:9.** 1344×768 is a good size for FLUX (multiples of 16); the composer crops to 1280×720.
- **Keep the prompt** in `studio/thumbs/options.json` (`prompt`, `model`) so a good one can be made again.
- **Say so when it matters.** An AI background in a thumbnail is ordinary; if the video itself shows realistic AI-made people, places or events, tick "Altered or synthetic content" on the Upload page.

## Turning a model on

The models are listed in `craft/image-models.json`, all with `"enabled": false`. Your own settings go in **`data/craft/image-models.json`** (not committed), laid over it by `id`:

```json
{ "models": [ { "id": "flux-schnell-local", "enabled": true } ] }
```

You can change any field there, for example the command, or add your own model:

```json
{ "models": [ {
  "id": "my-comfy",
  "name": "FLUX dev GGUF on my ComfyUI",
  "kind": "local",
  "enabled": true,
  "command": "python \"{app}/server/studio/image/flux_comfy.py\" {prompt} --out {out} --width {width} --height {height} --seed {seed} --gguf flux1-dev-Q4_K_S.gguf",
  "env": []
} ] }
```

- `command` runs **without a shell**, from the app folder. Placeholders: `{prompt}` `{out}` `{width}` `{height}` `{seed}` `{app}`. Each fills exactly one argument, so a prompt with quotes or semicolons stays one harmless argument.
- `env`: environment variables the model needs (API keys). The model counts as ready only when they are set.
- Check what is on: `node server/studio/image-gen.js --list`. The Thumbnails page shows it too.
- The agent makes a picture with `node server/studio/image-gen.js --model <id> --prompt "…" --out studio/thumbs/bg-1.png`.

## Local: FLUX on your own GPU (free)

FLUX.1 by Black Forest Labs is the best open model for this. Two variants:

| | FLUX.1 schnell | FLUX.1 dev |
|---|---|---|
| steps | 4 | 20 to 30 |
| quality | good backgrounds | sharper, better light |
| licence | Apache 2.0 | non-commercial for the weights (read it; outputs are yours under its terms) |
| download | open | accept the licence on its Hugging Face page, set `HF_TOKEN` |

**What you need.** An NVIDIA GPU is the practical choice:

- 24 GB VRAM: the full model runs on the card.
- 12 to 16 GB: works with parts moved to the CPU (diffusers' model offload) or with a quantized GGUF model in ComfyUI (Q4 to Q6 fits in 12 GB).
- 8 GB: diffusers' sequential offload or a Q4 GGUF; slow.
- Apple Silicon: runs on MPS with 32 GB or more of unified memory; slow.
- No GPU: possible on the CPU, but minutes to hours per picture. Use an API instead.

Also 35 GB or more of free disk for the weights, and 32 GB of system RAM is comfortable.

Tested here (an RTX 3060 12 GB, ComfyUI with FLUX.1 dev Q4_K_S GGUF): about 2 minutes for one 1344×768 picture at 20 steps, model loading included.

### Option A: diffusers (one script, no other app)

`server/studio/image/flux_diffusers.py` is a self-contained [uv](https://docs.astral.sh/uv/) script: uv installs Python, PyTorch (with CUDA on Windows) and diffusers on first run.

```bash
# install uv once: https://docs.astral.sh/uv/getting-started/installation/
uv run --script server/studio/image/flux_diffusers.py "an empty workbench under a single warm lamp, no text, no people" --out bg.png
uv run --script server/studio/image/flux_diffusers.py "..." --model dev --offload model --seed 7   # dev: HF_TOKEN set, licence accepted
```

It picks CUDA, then MPS, then the CPU, and below 20 GB of VRAM moves parts to the CPU by itself (`--offload model`; `--offload sequential` for 8 GB cards). Enable it with `{"id": "flux-schnell-local", "enabled": true}` (or `flux-dev-local`).

### Option B: ComfyUI (a node app; GGUF models for smaller cards)

1. Install ComfyUI (<https://github.com/comfyanonymous/ComfyUI>, or its desktop app). With uv:
   ```bash
   git clone https://github.com/comfyanonymous/ComfyUI && cd ComfyUI
   uv venv && uv pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu126
   uv pip install -r requirements.txt
   ```
2. The simplest model: the all-in-one **flux1-schnell-fp8.safetensors** checkpoint (from Comfy-Org on Hugging Face) into `ComfyUI/models/checkpoints/`.
   For 12 GB cards, a **GGUF** model works well instead: install the ComfyUI-GGUF custom node into `custom_nodes/`, put e.g. `flux1-dev-Q4_K_S.gguf` in `models/unet/`, `clip_l.safetensors` and `t5xxl_fp8_e4m3fn.safetensors` in `models/text_encoders/`, and `ae.safetensors` in `models/vae/`.
3. Start it (keep it running while the agent makes thumbnails):
   ```bash
   uv run python main.py --listen 127.0.0.1 --port 8188 --disable-auto-launch
   ```
4. `server/studio/image/flux_comfy.py` (standard library only) sends a FLUX workflow to ComfyUI's HTTP API, saves the picture and then asks ComfyUI to free the GPU for your renders:
   ```bash
   python server/studio/image/flux_comfy.py "a prompt" --out bg.png                          # flux1-schnell-fp8 checkpoint
   python server/studio/image/flux_comfy.py "a prompt" --out bg.png --gguf flux1-dev-Q4_K_S.gguf
   ```
   Another address: `COMFYUI_URL=http://127.0.0.1:8189`. Enable it as `flux-comfyui` (add `--gguf …` to its command in your overrides if you use GGUF).

The GPU is shared with the video engine: the scripts unload the model after each picture so a render that follows has the card.

## APIs (paid, no GPU needed)

`server/studio/image/api_image.py` (standard library only) talks to four services. Each picture costs money; the prices below are rough, from late 2026, and change: check the provider's page.

| id in image-models.json | service | key (environment) | rough price |
|---|---|---|---|
| `replicate-flux-schnell` | Replicate, FLUX.1 schnell | `REPLICATE_API_TOKEN` | about $0.003 per image |
| `replicate-flux-dev` | Replicate, FLUX.1 dev | `REPLICATE_API_TOKEN` | about $0.025 per image |
| `fal-flux-schnell` | fal, FLUX.1 schnell | `FAL_KEY` | about $0.003 per megapixel |
| `fal-flux-dev` | fal, FLUX.1 dev | `FAL_KEY` | about $0.025 per megapixel |
| `openai-gpt-image` | OpenAI gpt-image-1 | `OPENAI_API_KEY` | about $0.02 (low) to $0.25 (high) per 1536×1024 image |
| `google-imagen` | Google Imagen via the Gemini API | `GEMINI_API_KEY` | about $0.02 to $0.06 per image |

To use one: make an account and a key on the service, set the key in the environment before `npm start` (for example in your shell profile; never in a file inside the repo), and enable the model in `data/craft/image-models.json`. A thumbnail usually needs one background per option, so a video costs cents.

Other services work the same way: add an entry whose `command` runs any program that takes a prompt and writes a PNG to `{out}`.

## The composer

`python server/studio/thumb_compose.py <spec.json> <out.png> [--small]` draws a thumbnail from a JSON spec: a background (`frame` of a video at a time, `image`, `gradient`, `color`), an optional tint, then layers (`image` with outline and shadow, `text` with stroke, box and wrapping, `rect`, `circle`, `arrow`). Positions are fractions of the canvas. `--small` also writes a 320×180 copy to check that the words still read at phone size. The full spec is in `craft/skills/thumbnail-options/SKILL.md`. Fonts: a bold display font from `kit/fonts`, else the system's (Anton, Bebas Neue, Montserrat Black, Arial Black, Impact, DejaVu Sans Bold…), else Pillow's default.
