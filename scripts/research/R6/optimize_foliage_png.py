#!/usr/bin/env python3
"""R6-pbr: shrink foliage PNGs without touching visible pixels.
RGB under alpha==0 keeps the bled edge colour only within `band` px of the cutout (mip-safe),
beyond that it is a flat average colour (compresses well). Usage: python3 -I optimize_foliage_png.py [band]
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

D = "/home/user/special-telegram/public/assets/textures/foliage"


def main():
    band = int(sys.argv[1]) if len(sys.argv) > 1 else 32
    tot0 = tot1 = 0
    for cid in sorted(os.listdir(D)):
        p = os.path.join(D, cid, "albedo.png")
        if not os.path.exists(p):
            continue
        s0 = os.path.getsize(p)
        im = np.asarray(Image.open(p).convert("RGBA")).copy()
        a = im[..., 3]
        vis = (a > 0).astype(np.uint8)
        dist = cv2.distanceTransform((1 - vis).astype(np.uint8), cv2.DIST_L2, 5)
        mean = im[..., :3][a > 128].mean(0) if (a > 128).any() else np.array([80, 100, 60])
        far = dist > band
        rgb = im[..., :3].astype(np.float32)
        # smooth ramp between band and band+8 to avoid a hard step in low mips
        t = np.clip((dist - band) / 8.0, 0, 1)[..., None]
        rgb = rgb * (1 - t) + mean[None, None] * t
        rgb[far] = mean
        im[..., :3] = np.clip(rgb + 0.5, 0, 255).astype(np.uint8)
        Image.fromarray(im, "RGBA").save(p, optimize=True, compress_level=9)
        s1 = os.path.getsize(p)
        tot0 += s0
        tot1 += s1
        print(f"{cid:28s} {s0 // 1024:6d}K -> {s1 // 1024:6d}K")
    print("total", tot0 // 1024, "K ->", tot1 // 1024, "K")


if __name__ == "__main__":
    main()
