"""Full-res review sheets (2 columns of 1024-px-wide images) for watermark hunting.
usage: python3 -I wmreview.py out_prefix file ..."""
import sys
from PIL import Image, ImageDraw, ImageFont
F = ImageFont.truetype("/home/user/special-telegram/scripts/_cache/fonts/Sarabun-Bold.ttf", 18)
prefix, files = sys.argv[1], sys.argv[2:]
pages, cur, h_used = [], [], 0
for f in files:
    im = Image.open(f).convert("RGBA")
    bg = Image.new("RGBA", im.size, (110, 120, 100, 255)); bg.alpha_composite(im)
    im = bg.convert("RGB")
    if im.width > 1000:
        im = im.resize((1000, int(im.height * 1000 / im.width)))
    if im.height > 1000:
        im = im.resize((int(im.width * 1000 / im.height), 1000))
    cur.append((f.split("/")[-1], im))
    if len(cur) == 4:
        pages.append(cur); cur = []
if cur:
    pages.append(cur)
for pi, pg in enumerate(pages):
    sh = Image.new("RGB", (2010, 2040), (20, 20, 20))
    d = ImageDraw.Draw(sh)
    for i, (n, im) in enumerate(pg):
        x, y = (i % 2) * 1010, (i // 2) * 1020
        sh.paste(im, (x, y + 18))
        d.text((x + 4, y), n, fill=(255, 220, 60), font=F)
    sh.save(f"{prefix}_{pi:02d}.jpg", quality=88)
    print(f"{prefix}_{pi:02d}.jpg")
