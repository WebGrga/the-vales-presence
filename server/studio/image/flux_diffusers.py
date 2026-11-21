# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "torch>=2.4",
#   "diffusers>=0.31",
#   "transformers>=4.44",
#   "accelerate>=0.34",
#   "sentencepiece",
#   "protobuf",
#   "pillow",
# ]
# [tool.uv.sources]
# torch = [{ index = "pytorch-cuda", marker = "sys_platform == 'win32'" }]
# [[tool.uv.index]]
# name = "pytorch-cuda"
# url = "https://download.pytorch.org/whl/cu126"
# explicit = true
# ///
"""Make one picture with FLUX.1 (schnell or dev) on this computer through Hugging Face diffusers.

For thumbnail backgrounds, scenes and props. Never a real person's face, never text: those are composed in code.

    uv run --script flux_diffusers.py "an empty workbench under a single warm lamp" --out bg.png
    uv run --script flux_diffusers.py "..." --model dev --steps 28 --seed 7      (dev needs HF_TOKEN and its licence accepted)

The first run downloads the weights into the Hugging Face cache (about 35 GB for either model).
GPU memory: 24 GB runs it all on the card; 12-16 GB moves parts to the CPU as needed (the default below 20 GB);
8 GB needs --offload sequential (slow). Without an NVIDIA GPU it uses Apple MPS, else the CPU (very slow).
"""
import argparse
import random
import sys
import time

MODELS = {
    "schnell": ("black-forest-labs/FLUX.1-schnell", 4, 0.0, 256),
    "dev": ("black-forest-labs/FLUX.1-dev", 28, 3.5, 512),
}


def device_and_memory(torch):
    if torch.cuda.is_available():
        return "cuda", torch.cuda.get_device_properties(0).total_memory / 2**30
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps", 0
    return "cpu", 0


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("prompt")
    p.add_argument("--out", required=True)
    p.add_argument("--model", choices=sorted(MODELS), default="schnell")
    p.add_argument("--width", type=int, default=1344)
    p.add_argument("--height", type=int, default=768)
    p.add_argument("--steps", type=int, default=0)
    p.add_argument("--guidance", type=float, default=-1)
    p.add_argument("--seed", type=str, default="")
    p.add_argument("--offload", choices=["auto", "none", "model", "sequential"], default="auto")
    a = p.parse_args()

    import torch
    from diffusers import FluxPipeline

    repo, steps, guidance, max_seq = MODELS[a.model]
    steps = a.steps or steps
    guidance = guidance if a.guidance < 0 else a.guidance
    width, height = max(256, a.width // 16 * 16), max(256, a.height // 16 * 16)
    seed = int(a.seed) if a.seed.strip().lstrip("-").isdigit() else random.randrange(2**31)

    dev, gb = device_and_memory(torch)
    dtype = torch.bfloat16 if dev != "cpu" else torch.float32
    t0 = time.time()
    pipe = FluxPipeline.from_pretrained(repo, torch_dtype=dtype)
    mode = a.offload
    if mode == "auto":
        mode = "none" if dev != "cuda" or gb >= 20 else "model"
    if dev == "cuda" and mode == "model":
        pipe.enable_model_cpu_offload()
    elif dev == "cuda" and mode == "sequential":
        pipe.enable_sequential_cpu_offload()
    else:
        pipe.to(dev)
    if dev == "cpu":
        print("No GPU found: running on the CPU, this takes a long time.", file=sys.stderr)

    gen = torch.Generator("cpu").manual_seed(seed)
    image = pipe(a.prompt, width=width, height=height, num_inference_steps=steps, guidance_scale=guidance,
                 max_sequence_length=max_seq, generator=gen).images[0]
    image.save(a.out)
    print(f"{a.out}  {a.model}  seed {seed}  {dev} {gb:.0f} GB  offload {mode}  {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
