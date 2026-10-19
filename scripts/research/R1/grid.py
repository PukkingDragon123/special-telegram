"""Overlay a labelled pixel grid on an image (for picking rectification corners).
usage: python3 -I grid.py <img> <out> [step=100] [crop x0,y0,x1,y1]"""
import sys
from PIL import Image, ImageDraw, ImageFont
im = Image.open(sys.argv[1]).convert("RGB")
step = int(sys.argv[3]) if len(sys.argv) > 3 else 100
if len(sys.argv) > 4:
    x0, y0, x1, y1 = map(int, sys.argv[4].split(","))
    im = im.crop((x0, y0, x1, y1)); ox, oy = x0, y0
else:
    ox = oy = 0
d = ImageDraw.Draw(im)
f = ImageFont.truetype("/home/user/special-telegram/scripts/_cache/fonts/Sarabun-Bold.ttf", 14)
for x in range(((ox // step) + 1) * step - ox, im.width, step):
    d.line([(x, 0), (x, im.height)], fill=(255, 0, 255), width=1)
    d.text((x + 2, 2), str(x + ox), fill=(255, 255, 0), font=f)
for y in range(((oy // step) + 1) * step - oy, im.height, step):
    d.line([(0, y), (im.width, y)], fill=(0, 255, 255), width=1)
    d.text((2, y + 2), str(y + oy), fill=(255, 255, 0), font=f)
im.save(sys.argv[2], quality=88)
