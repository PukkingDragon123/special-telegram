"""R1-streets: contact sheets of harvested candidates.

usage: python3 -I sheet.py <harvest_dir> <out_prefix> [tag ...] [--per 30] [--cell 260]
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

FONT = "/home/user/special-telegram/scripts/_cache/fonts/Sarabun-Bold.ttf"


def main():
    args = sys.argv[1:]
    per, cell = 30, 260
    if "--per" in args:
        i = args.index("--per"); per = int(args[i + 1]); del args[i:i + 2]
    if "--cell" in args:
        i = args.index("--cell"); cell = int(args[i + 1]); del args[i:i + 2]
    hdir, prefix, tags = args[0], args[1], set(args[2:])
    items = [json.loads(l) for l in open(os.path.join(hdir, "meta.jsonl"), encoding="utf-8")]
    if tags:
        items = [c for c in items if c["tag"] in tags]
    font = ImageFont.truetype(FONT, 15)
    cols = 8 if cell <= 200 else 6
    pages = [items[i:i + per] for i in range(0, len(items), per)]
    for pi, page in enumerate(pages):
        rows = (len(page) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * cell, rows * (cell + 22)), (30, 30, 30))
        d = ImageDraw.Draw(sheet)
        for k, c in enumerate(page):
            p = os.path.join(hdir, "thumbs", c["id"] + ".jpg")
            try:
                im = Image.open(p).convert("RGB")
            except Exception:
                continue
            im.thumbnail((cell - 6, cell - 6))
            x, y = (k % cols) * cell, (k // cols) * (cell + 22)
            sheet.paste(im, (x + (cell - im.width) // 2, y + (cell - im.height) // 2))
            lab = f"{c['id']} {c.get('w') or ''}"
            d.text((x + 4, y + cell), lab, fill=(255, 230, 90), font=font)
        out = f"{prefix}_{pi:02d}.jpg"
        sheet.save(out, quality=80)
        print(out, len(page))


if __name__ == "__main__":
    main()
