"""Make one picture with FLUX through a running ComfyUI (its HTTP API). Standard library only.

For thumbnail backgrounds, scenes and props. Never a real person's face, never text: those are composed in code.

Start ComfyUI first (see docs/thumbnails-ai-images.md), then:
    python flux_comfy.py "an empty workbench under a single warm lamp" --out bg.png
    python flux_comfy.py "..." --ckpt flux1-schnell-fp8.safetensors          (an all-in-one checkpoint in models/checkpoints)
    python flux_comfy.py "..." --gguf flux1-dev-Q4_K_S.gguf --steps 20       (needs the ComfyUI-GGUF custom node,
                                                                            clip_l + t5xxl in models/text_encoders, ae in models/vae)
COMFYUI_URL picks another address (default http://127.0.0.1:8188).
"""
import argparse
import json
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HOST = os.environ.get("COMFYUI_URL", "http://127.0.0.1:8188").rstrip("/")


def workflow(a, seed):
    if a.gguf:
        loaders = {
            "unet": {"class_type": "UnetLoaderGGUF", "inputs": {"unet_name": a.gguf}},
            "clip": {"class_type": "DualCLIPLoader", "inputs": {"clip_name1": a.t5, "clip_name2": a.clip_l, "type": "flux"}},
            "vae": {"class_type": "VAELoader", "inputs": {"vae_name": a.vae}},
        }
        model, clip, vae = ["unet", 0], ["clip", 0], ["vae", 0]
    else:
        loaders = {"ckpt": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": a.ckpt}}}
        model, clip, vae = ["ckpt", 0], ["ckpt", 1], ["ckpt", 2]
    return {
        **loaders,
        "pos": {"class_type": "CLIPTextEncode", "inputs": {"text": a.prompt, "clip": clip}},
        "guide": {"class_type": "FluxGuidance", "inputs": {"guidance": a.guidance, "conditioning": ["pos", 0]}},
        "neg": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["pos", 0]}},
        "latent": {"class_type": "EmptySD3LatentImage", "inputs": {"width": a.width, "height": a.height, "batch_size": 1}},
        "sample": {"class_type": "KSampler", "inputs": {
            "model": model, "positive": ["guide", 0], "negative": ["neg", 0], "latent_image": ["latent", 0],
            "seed": seed, "steps": a.steps, "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
        "decode": {"class_type": "VAEDecode", "inputs": {"samples": ["sample", 0], "vae": vae}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["decode", 0], "filename_prefix": "presence"}},
    }


def call(path, data=None):
    req = urllib.request.Request(HOST + path, data=json.dumps(data).encode() if data is not None else None,
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("prompt")
    p.add_argument("--out", required=True)
    p.add_argument("--width", type=int, default=1344)
    p.add_argument("--height", type=int, default=768)
    p.add_argument("--seed", type=str, default="")
    p.add_argument("--ckpt", default="flux1-schnell-fp8.safetensors")
    p.add_argument("--gguf", default="", help="a .gguf in models/unet instead of --ckpt")
    p.add_argument("--t5", default="t5xxl_fp8_e4m3fn.safetensors")
    p.add_argument("--clip-l", dest="clip_l", default="clip_l.safetensors")
    p.add_argument("--vae", default="ae.safetensors")
    p.add_argument("--steps", type=int, default=0, help="default 4 for schnell, 20 otherwise")
    p.add_argument("--guidance", type=float, default=3.5)
    p.add_argument("--keep", action="store_true", help="keep the model loaded for the next call (holds the GPU memory)")
    a = p.parse_args()
    a.width, a.height = max(256, a.width // 16 * 16), max(256, a.height // 16 * 16)
    if not a.steps:
        a.steps = 4 if "schnell" in (a.gguf or a.ckpt).lower() else 20
    seed = int(a.seed) if a.seed.strip().lstrip("-").isdigit() else random.randrange(2**31)
    try:
        call("/system_stats")
    except Exception:
        sys.exit(f"ComfyUI is not answering on {HOST}; start it first (docs/thumbnails-ai-images.md)")
    try:
        pid = json.loads(call("/prompt", {"prompt": workflow(a, seed)}))["prompt_id"]
    except urllib.error.HTTPError as e:
        sys.exit("ComfyUI refused the workflow: " + e.read().decode("utf8", "replace")[:1500])
    t0 = time.time()
    while True:
        time.sleep(1)
        hist = json.loads(call("/history/" + pid))
        if pid in hist:
            entry = hist[pid]
            if entry.get("status", {}).get("status_str") == "error":
                sys.exit("ComfyUI error: " + json.dumps(entry["status"].get("messages", []))[:2000])
            imgs = [i for o in entry.get("outputs", {}).values() for i in o.get("images", [])]
            if imgs:
                q = urllib.parse.urlencode({k: imgs[0][k] for k in ("filename", "subfolder", "type")})
                os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
                with open(a.out, "wb") as f:
                    f.write(call("/view?" + q))
                print(f"{a.out}  seed {seed}  {time.time() - t0:.0f} s")
                break
        if time.time() - t0 > 900:
            sys.exit("timed out after 15 minutes")
    if not a.keep:  # give the GPU back for renders
        try:
            call("/free", {"unload_models": True, "free_memory": True})
        except Exception:
            pass


if __name__ == "__main__":
    main()
