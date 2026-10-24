import sys
from PIL import Image, ImageDraw
im = Image.open(sys.argv[1]).convert('RGB'); d = ImageDraw.Draw(im)
step = int(sys.argv[3]) if len(sys.argv) > 3 else 50
for x in range(0, im.width, step):
    d.line([(x, 0), (x, im.height)], fill=(255, 255, 0) if x % (step * 2) == 0 else (0, 255, 255), width=1); d.text((x + 2, 2), str(x), fill=(255, 0, 0))
for y in range(0, im.height, step):
    d.line([(0, y), (im.width, y)], fill=(255, 255, 0) if y % (step * 2) == 0 else (0, 255, 255), width=1); d.text((2, y + 2), str(y), fill=(255, 0, 0))
im.save(sys.argv[2], quality=88)
