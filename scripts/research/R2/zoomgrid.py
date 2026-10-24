"""Zoomed crop with normalised-coordinate grid. Usage: python3 -I zoomgrid.py <img> x0 y0 x1 y1 <out> [w]"""
import sys
from PIL import Image, ImageDraw
p, x0, y0, x1, y1, out = sys.argv[1], *map(float, sys.argv[2:6]), sys.argv[6]
W_ = int(sys.argv[7]) if len(sys.argv) > 7 else 900
im = Image.open(p).convert("RGB")
W, H = im.size
c = im.crop((int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H)))
s = W_ / c.width
c = c.resize((W_, int(c.height * s)))
d = ImageDraw.Draw(c)
for k in range(11):
    x = k * c.width / 10
    d.line([x, 0, x, c.height], fill=(255, 0, 0))
    d.text((x + 2, 2), "%.3f" % (x0 + (x1 - x0) * k / 10), fill=(255, 255, 0))
for k in range(11):
    y = k * c.height / 10
    d.line([0, y, c.width, y], fill=(0, 140, 255))
    d.text((2, y + 2), "%.3f" % (y0 + (y1 - y0) * k / 10), fill=(0, 255, 255))
c.save(out, quality=88)
