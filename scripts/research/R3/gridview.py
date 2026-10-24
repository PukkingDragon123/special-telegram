#!/usr/bin/env python3
"""Render images with a labelled pixel grid (for choosing crop boxes). R3 helper.
Usage: python3 -I gridview.py <out.jpg> <tile_px> <img> [<img> ...]"""
import sys
from PIL import Image, ImageDraw
out, tile = sys.argv[1], int(sys.argv[2])
ims = []
for p in sys.argv[3:]:
    im = Image.open(p).convert("RGB")
    W, H = im.size
    s = tile / max(W, H)
    im2 = im.resize((max(1, int(W * s)), max(1, int(H * s))))
    d = ImageDraw.Draw(im2)
    step = 100 if max(W, H) <= 1400 else 200
    for v in range(0, max(W, H), step):
        c = (255, 0, 0)
        d.line([(v * s, 0), (v * s, im2.size[1])], fill=c, width=1)
        d.line([(0, v * s), (im2.size[0], v * s)], fill=c, width=1)
        d.text((v * s + 2, 2), str(v), fill=(255, 255, 0))
        d.text((2, v * s + 2), str(v), fill=(255, 255, 0))
    d.text((4, im2.size[1] - 12), p.split("/")[-2] + "/" + p.split("/")[-1] + f" {W}x{H}", fill=(0, 255, 255))
    ims.append(im2)
cols = 2
rows = (len(ims) + cols - 1) // cols
sheet = Image.new("RGB", (cols * tile, rows * tile), (30, 30, 30))
for i, im in enumerate(ims):
    sheet.paste(im, ((i % cols) * tile, (i // cols) * tile))
sheet.save(out, quality=88)
