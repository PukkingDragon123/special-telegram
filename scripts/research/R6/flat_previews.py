#!/usr/bin/env python3
"""R6-pbr: fetch FLAT colour previews for candidate materials and build contact sheets.

Usage: python3 -I flat_previews.py <cache_dir> <groups.json> [cols]
 - ph:<id>   -> Poly Haven 1k diffuse JPG (via api.polyhaven.com/files/<id>)
 - acg:<id>  -> ambientCG surface-preview <id>_SQ_Color.jpg
All downloads are image data only; they are decoded with Pillow, never executed.
"""
import io
import json
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import requests
from PIL import Image

UA = "HiaPhatGameDev/0.1 (https://github.com/PukkingDragon123/special-telegram)"
S = requests.Session()
S.headers["User-Agent"] = UA


def ph_files(cache, aid):
    fdir = os.path.join(cache, "catalog", "files")
    os.makedirs(fdir, exist_ok=True)
    fn = os.path.join(fdir, aid + ".json")
    if os.path.exists(fn):
        return json.load(open(fn))
    r = S.get(f"https://api.polyhaven.com/files/{aid}", timeout=60)
    r.raise_for_status()
    open(fn, "w").write(r.text)
    return r.json()


def fetch(cache, key):
    src, aid = key.split(":", 1)
    out = os.path.join(cache, "thumbs_flat", key.replace(":", "__") + ".jpg")
    if os.path.exists(out):
        return key, out
    try:
        if src == "ph":
            files = ph_files(cache, aid)
            url = files["Diffuse"]["1k"]["jpg"]["url"]
        else:
            url = f"https://acg-media.struffelproductions.com/file/ambientCG-Web/media/surface-preview/{aid}/{aid}_SQ_Color.jpg"
        r = S.get(url, timeout=120)
        r.raise_for_status()
        im = Image.open(io.BytesIO(r.content)).convert("RGB")
        im.thumbnail((320, 320), Image.LANCZOS)
        im.save(out, quality=90)
        return key, out
    except Exception as e:  # noqa
        print("FAIL", key, e)
        return key, None


def main():
    cache, groups_path = sys.argv[1], sys.argv[2]
    cols = sys.argv[3] if len(sys.argv) > 3 else "8"
    os.makedirs(os.path.join(cache, "thumbs_flat"), exist_ok=True)
    groups = json.load(open(groups_path))
    for sheet, keys in groups.items():
        with ThreadPoolExecutor(6) as ex:
            res = list(ex.map(lambda k: fetch(cache, k), keys))
        args = ["montage"]
        for key, fn in res:
            if fn:
                args += ["-label", key.split(":", 1)[1][:28], fn]
        out = os.path.join(cache, f"flat_{sheet}.jpg")
        args += ["-pointsize", "12", "-geometry", "200x200+3+3", "-tile", f"{cols}x", "-background", "#ccc", out]
        subprocess.run(args, check=True)
        print("wrote", out)
        time.sleep(0.2)


if __name__ == "__main__":
    main()
