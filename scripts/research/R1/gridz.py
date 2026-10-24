"""Gridded zoom panels for picking corners. Labels are ORIGINAL pixel coords.
usage: python3 -I gridz.py out.jpg panel [panel ...]
panel = path@x0,y0,x1,y1@step   (region in orig px; 'all' for whole image)
Panels are scaled to fit 700x700 and tiled 2 per row."""
import sys
from PIL import Image, ImageDraw, ImageFont
F = ImageFont.truetype("/home/user/special-telegram/scripts/_cache/fonts/Sarabun-Bold.ttf", 15)
out = sys.argv[1]
panels = []
for spec in sys.argv[2:]:
    path, reg, step = spec.split("@")
    im = Image.open(path).convert("RGB")
    if reg == "all":
        x0, y0, x1, y1 = 0, 0, im.width, im.height
    else:
        x0, y0, x1, y1 = map(int, reg.split(","))
    step = int(step)
    cr = im.crop((x0, y0, x1, y1))
    s = min(700 / cr.width, 700 / cr.height)
    cr = cr.resize((max(1, int(cr.width * s)), max(1, int(cr.height * s))), Image.LANCZOS)
    d = ImageDraw.Draw(cr)
    gx = (x0 // step + 1) * step
    while gx < x1:
        X = (gx - x0) * s
        d.line([(X, 0), (X, cr.height)], fill=(255, 0, 255), width=1)
        d.text((X + 2, 2), str(gx), fill=(255, 255, 0), font=F, stroke_width=2, stroke_fill=(0, 0, 0))
        gx += step
    gy = (y0 // step + 1) * step
    while gy < y1:
        Y = (gy - y0) * s
        d.line([(0, Y), (cr.width, Y)], fill=(0, 255, 255), width=1)
        d.text((2, Y + 2), str(gy), fill=(255, 255, 0), font=F, stroke_width=2, stroke_fill=(0, 0, 0))
        gy += step
    lab = path.split("/")[-1]
    d.text((cr.width - 8 * len(lab) - 10, cr.height - 22), lab, fill=(80, 255, 80), font=F, stroke_width=2, stroke_fill=(0, 0, 0))
    panels.append(cr)
cols = 2 if len(panels) > 1 else 1
rows = (len(panels) + cols - 1) // cols
W = 704 * cols
H = 704 * rows
sheet = Image.new("RGB", (W, H), (20, 20, 20))
for i, p in enumerate(panels):
    sheet.paste(p, ((i % cols) * 704, (i // cols) * 704))
sheet.save(out, quality=88)
print(out)
