#!/usr/bin/env python3
"""R6-pbr: build labelled thumbnail contact sheets for candidate materials.

Usage: python3 -I thumb_sheets.py <cache_dir> <groups.json>
groups.json = {"sheet_name": ["ph:<id>" | "acg:<AssetId>", ...], ...}
Thumbnails are downloaded (data only, never executed) into <cache_dir>/thumbs/.
"""
import json
import os
import subprocess
import sys
import time

import requests

UA = "HiaPhatGameDev/0.1 (https://github.com/PukkingDragon123/special-telegram)"


def load_catalogs(cache):
    cat = os.path.join(cache, "catalog")
    ph = json.load(open(os.path.join(cat, "ph_textures.json")))
    acg = {}
    for fn in ("acg_Material.jsonl", "acg_Atlas.jsonl", "acg_Decal.jsonl"):
        p = os.path.join(cat, fn)
        if os.path.exists(p):
            for line in open(p):
                r = json.loads(line)
                acg[r["assetId"]] = r
    return ph, acg


def thumb_url(key, ph, acg):
    src, aid = key.split(":", 1)
    if src == "ph":
        return f"https://cdn.polyhaven.com/asset_img/thumbs/{aid}.png?width=256&height=256&format=png"
    r = acg.get(aid)
    if not r:
        return None
    return (r.get("previewImage") or {}).get("256-PNG")


def main():
    cache, groups_path = sys.argv[1], sys.argv[2]
    ph, acg = load_catalogs(cache)
    groups = json.load(open(groups_path))
    tdir = os.path.join(cache, "thumbs")
    os.makedirs(tdir, exist_ok=True)
    s = requests.Session()
    s.headers["User-Agent"] = UA
    for sheet, keys in groups.items():
        files = []
        for key in keys:
            fn = os.path.join(tdir, key.replace(":", "__") + ".png")
            if not os.path.exists(fn):
                url = thumb_url(key, ph, acg)
                if not url:
                    print("no url", key)
                    continue
                try:
                    r = s.get(url, timeout=60)
                    r.raise_for_status()
                    open(fn, "wb").write(r.content)
                except Exception as e:  # noqa
                    print("fail", key, e)
                    continue
                time.sleep(0.05)
            files.append((key, fn))
        if not files:
            continue
        out = os.path.join(cache, f"sheet_{sheet}.jpg")
        args = ["montage"]
        for key, fn in files:
            args += ["-label", key.split(":", 1)[1][:26], fn]
        args += ["-pointsize", "12", "-geometry", "180x180+3+3", "-tile", "8x", "-background", "#ddd", out]
        subprocess.run(args, check=True)
        print("wrote", out, len(files))


if __name__ == "__main__":
    main()
