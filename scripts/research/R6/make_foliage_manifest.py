#!/usr/bin/env python3
"""R6-pbr: write public/assets/textures/foliage/manifest.json from the build manifest + files on disk.
Usage: python3 -I make_foliage_manifest.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image  # noqa: E402

import foliage_lib as F  # noqa: E402

ORDER = ["type", "albedo", "normal", "pixelSize", "widthMeters", "heightMeters", "pivot", "alphaTest", "regions", "tags",
         "source", "sourceUrl", "author", "license", "note"]


def main():
    man = F.load_manifest()
    out = {}
    for cid in sorted(man):
        d = os.path.join(F.FOL_OUT, cid)
        if not os.path.isdir(d):
            continue
        e = man[cid]
        e.setdefault("type", "card")
        for k in ("albedo", "normal"):
            p = os.path.join(F.FOL_OUT, e[k])
            assert os.path.exists(p), p
        im = Image.open(os.path.join(F.FOL_OUT, e["albedo"]))
        assert im.mode == "RGBA", (cid, im.mode)
        e["pixelSize"] = list(im.size)
        out[cid] = {k: e[k] for k in ORDER if k in e and e[k] is not None}
    json.dump(out, open(os.path.join(F.FOL_OUT, "manifest.json"), "w"), indent=1, ensure_ascii=False)
    print("foliage cards:", len(out))


if __name__ == "__main__":
    main()
