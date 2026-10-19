#!/usr/bin/env python3
"""R6-pbr: merge build outputs into public/assets/textures/pbr/manifest.json and validate.

Paths in the manifest are RELATIVE TO THE MANIFEST'S FOLDER (public/assets/textures/pbr/).
Conventions: albedo = sRGB; normal = OpenGL (+Y up), linear; orm = R:AO G:roughness B:metalness, linear.
Usage: python3 -I make_manifest.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

import r6lib as L  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")

WATER_COL = {  # small constant helper maps so every entry has albedo+normal+orm
    "water_ripples_puddle": ((42, 40, 36), 0.04),
    "water_canal_calm": ((62, 74, 54), 0.06),
    "water_wind_chop": ((62, 74, 54), 0.08),
}

ORDER = ["source", "license", "albedo", "normal", "orm", "height", "opacity", "wetmask", "mask", "tileMeters", "tint", "tags",
         "resolution", "dataMapResolution", "normalOnly", "note", "sourceUrl", "author"]


def ensure_water_helpers(man):
    for mid, (rgb, rough) in WATER_COL.items():
        if mid not in man:
            continue
        d = os.path.join(L.PBR_OUT, mid)
        a = np.zeros((128, 128, 3), np.uint8)
        a[:] = rgb
        L.save_jpg(a, os.path.join(d, "albedo.jpg"), 90, 2)
        o = np.zeros((128, 128, 3), np.uint8)
        o[..., 0] = 255
        o[..., 1] = int(rough * 255)
        L.save_jpg(o, os.path.join(d, "orm.jpg"), 90, 0)
        man[mid]["albedo"] = f"{mid}/albedo.jpg"
        man[mid]["orm"] = f"{mid}/orm.jpg"
        man[mid]["normalOnly"] = True
        man[mid]["note"] = man[mid].get("note", "") + " albedo/orm are tiny constant helpers (murky water colour, roughness)."


def main():
    std = json.load(open(os.path.join(OUT, "std_manifest.json")))
    spe = json.load(open(os.path.join(OUT, "special_manifest.json")))
    man = {}
    man.update(std)
    man.update(spe)
    ensure_water_helpers(man)
    final = {}
    problems = []
    for mid in sorted(man):
        e = man[mid]
        if not os.path.isdir(os.path.join(L.PBR_OUT, mid)):
            continue  # dropped material
        for k in ("albedo", "normal", "orm", "height", "opacity", "wetmask", "mask"):
            if e.get(k):
                p = os.path.join(L.PBR_OUT, e[k])
                if not os.path.exists(p):
                    problems.append(f"{mid}: missing {e[k]}")
                else:
                    w, h = Image.open(p).size
                    if w != h or (w & (w - 1)):
                        problems.append(f"{mid}: {k} not square power-of-two {w}x{h}")
            elif k in ("albedo", "normal", "orm"):
                problems.append(f"{mid}: no {k}")
        e = {k: e[k] for k in ORDER if k in e and e[k] is not None}
        final[mid] = e
    out = os.path.join(L.PBR_OUT, "manifest.json")
    json.dump(final, open(out, "w"), indent=1, ensure_ascii=False)
    print("materials:", len(final), "->", out)
    for p in problems:
        print("PROBLEM", p)


if __name__ == "__main__":
    main()
