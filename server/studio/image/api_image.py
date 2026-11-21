"""Make one picture with a paid image API. Standard library only. Each call costs money: run it only when the
user turned the model on (craft/image-models.json overrides in data/craft/image-models.json).

    python api_image.py --provider replicate --model black-forest-labs/flux-schnell "a prompt" --out bg.png
    python api_image.py --provider fal --model fal-ai/flux/schnell "a prompt" --out bg.png
    python api_image.py --provider openai --model gpt-image-1 "a prompt" --out bg.png
    python api_image.py --provider imagen --model imagen-4.0-generate-001 "a prompt" --out bg.png

Keys from the environment: REPLICATE_API_TOKEN, FAL_KEY, OPENAI_API_KEY, GEMINI_API_KEY.
Backgrounds and props only: never a real person's face, never text in the picture.
"""
import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request


def post(url, body, headers, timeout=300):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"content-type": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        sys.exit(f"{url} answered {e.code}: {e.read().decode('utf8', 'replace')[:1500]}")


def get(url, headers=None):
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers or {}), timeout=300) as r:
        return r.read()


def key(name):
    v = os.environ.get(name)
    if not v:
        sys.exit(f"Set {name} first.")
    return v


def aspect(w, h):
    r = w / h
    for name, val in (("16:9", 16 / 9), ("3:2", 1.5), ("4:3", 4 / 3), ("1:1", 1.0), ("9:16", 9 / 16)):
        if abs(r - val) < 0.08:
            return name
    return "16:9"


def replicate(a):
    tok = key("REPLICATE_API_TOKEN")
    h = {"authorization": f"Bearer {tok}", "prefer": "wait"}
    j = post(f"https://api.replicate.com/v1/models/{a.model}/predictions",
             {"input": {"prompt": a.prompt, "aspect_ratio": aspect(a.width, a.height), "output_format": "png"}}, h)
    t0 = time.time()
    while j.get("status") not in ("succeeded", "failed", "canceled"):
        if time.time() - t0 > 600:
            sys.exit("Replicate timed out")
        time.sleep(2)
        j = json.loads(get(j["urls"]["get"], {"authorization": f"Bearer {tok}"}))
    if j.get("status") != "succeeded":
        sys.exit(f"Replicate: {j.get('status')} {j.get('error')}")
    out = j["output"]
    return get(out[0] if isinstance(out, list) else out)


def fal(a):
    j = post(f"https://fal.run/{a.model}", {"prompt": a.prompt, "image_size": {"width": a.width, "height": a.height},
                                            "num_images": 1, "enable_safety_checker": True},
             {"authorization": f"Key {key('FAL_KEY')}"})
    return get(j["images"][0]["url"])


def openai(a):
    size = "1536x1024" if a.width > a.height else "1024x1536" if a.height > a.width else "1024x1024"
    j = post("https://api.openai.com/v1/images/generations", {"model": a.model, "prompt": a.prompt, "size": size, "n": 1},
             {"authorization": f"Bearer {key('OPENAI_API_KEY')}"})
    d = j["data"][0]
    return base64.b64decode(d["b64_json"]) if d.get("b64_json") else get(d["url"])


def imagen(a):
    j = post(f"https://generativelanguage.googleapis.com/v1beta/models/{a.model}:predict",
             {"instances": [{"prompt": a.prompt}], "parameters": {"sampleCount": 1, "aspectRatio": aspect(a.width, a.height)}},
             {"x-goog-api-key": key("GEMINI_API_KEY")})
    preds = j.get("predictions") or []
    if not preds:
        sys.exit("Imagen returned no picture (it may have been filtered): " + json.dumps(j)[:500])
    return base64.b64decode(preds[0]["bytesBase64Encoded"])


PROVIDERS = {"replicate": replicate, "fal": fal, "openai": openai, "imagen": imagen}


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("prompt")
    p.add_argument("--provider", choices=sorted(PROVIDERS), required=True)
    p.add_argument("--model", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--width", type=int, default=1344)
    p.add_argument("--height", type=int, default=768)
    p.add_argument("--seed", default="")
    a = p.parse_args()
    t0 = time.time()
    data = PROVIDERS[a.provider](a)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "wb") as f:
        f.write(data)
    print(f"{a.out}  {a.provider} {a.model}  {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
