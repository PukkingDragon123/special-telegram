"""Contact sheets with the first N candidates per tag (labelled tag:id).
usage: python3 -I sheet_tags.py <out_prefix> <N> <per_page> <harvest_dir>[,dir2] tag1 tag2 ..."""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont
FONT = "/home/user/special-telegram/scripts/_cache/fonts/Sarabun-Bold.ttf"
prefix, N, per = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
dirs = sys.argv[4].split(",")
tags = sys.argv[5:]
items = []
for t in tags:
    got = 0
    for d in dirs:
        mp = os.path.join(d, "meta.jsonl")
        if not os.path.exists(mp):
            continue
        for l in open(mp, encoding="utf-8"):
            c = json.loads(l)
            if c["tag"] == t and got < N:
                c["_dir"] = d; items.append(c); got += 1
cell, cols = 170, 8
f = ImageFont.truetype(FONT, 13)
for pi in range(0, len(items), per):
    page = items[pi:pi + per]
    rows = (len(page) + cols - 1) // cols
    sh = Image.new("RGB", (cols * cell, rows * (cell + 18)), (28, 28, 28))
    d = ImageDraw.Draw(sh)
    for k, c in enumerate(page):
        try:
            im = Image.open(os.path.join(c["_dir"], "thumbs", c["id"] + ".jpg")).convert("RGB")
        except Exception:
            continue
        im.thumbnail((cell - 4, cell - 4))
        x, y = (k % cols) * cell, (k // cols) * (cell + 18)
        sh.paste(im, (x + (cell - im.width) // 2, y + (cell - im.height) // 2))
        d.text((x + 2, y + cell), f"{c['tag'][:9]}:{c['id']}", fill=(255, 225, 80), font=f)
    out = f"{prefix}_{pi // per:02d}.jpg"
    sh.save(out, quality=80); print(out, len(page))
