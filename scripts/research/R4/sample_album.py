"""Sample hex colours from the album-cover reference (ref4) for ALBUM_COVER_BREAKDOWN.md.
Usage: python3 -I sample_album.py <ref4.jpg>
Prints median colour of named patches (x0,y0,x1,y1 in the 500x500 image) and a radial
profile of the backdrop glow."""
import sys
import numpy as np
from PIL import Image

im = np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(np.float32)
H, W, _ = im.shape

def hexc(c):
    return "#%02X%02X%02X" % tuple(int(round(v)) for v in c)

def patch(name, x0, y0, x1, y1):
    p = im[y0:y1, x0:x1].reshape(-1, 3)
    med = np.median(p, axis=0)
    lo = np.percentile(p, 15, axis=0)
    hi = np.percentile(p, 85, axis=0)
    print(f"{name:34s} median {hexc(med)}  dark15 {hexc(lo)}  light85 {hexc(hi)}  ({x0},{y0})-({x1},{y1})")

P = [
 ("bg corner TL", 0, 0, 30, 30),
 ("bg corner TR", 470, 0, 500, 30),
 ("bg top centre", 230, 0, 270, 20),
 ("bg glow left of g2 (x80,y110)", 70, 100, 100, 130),
 ("bg glow behind table (x250,y180)", 240, 165, 270, 190),
 ("bg glow (x300,y110)", 290, 100, 320, 130),
 ("bg glow right (x350,y60)", 340, 50, 365, 75),
 ("bg glow far right (x470,y150)", 460, 140, 490, 170),
 ("bg right edge low (x485,y300)", 475, 280, 498, 320),
 ("bg left edge (x10,y150)", 0, 130, 20, 170),
 ("floor/wall seam left (x20,y350)", 5, 335, 40, 360),
 ("rug dark green (x60,y450)", 40, 440, 90, 470),
 ("rug mid (x250,y470)", 230, 460, 280, 480),
 ("rug stripe light (x330,y435)", 300, 430, 360, 438),
 ("rug right (x470,y430)", 450, 420, 495, 445),
 ("rug front bottom (x250,y495)", 200, 490, 300, 499),
 ("chair1 blue shell (x30,y280)", 10, 260, 60, 300),
 ("chair1 blue leg (x80,y450)", 75, 430, 100, 470),
 ("chair4 orange shell (x390,y260)", 375, 245, 405, 280),
 ("chair4 orange back lit (x400,y300)", 385, 290, 415, 320),
 ("sofa tan behind g3 (x280,y260)", 270, 250, 290, 270),
 ("table top orange (x300,y318)", 280, 314, 330, 322),
 ("table edge (x330,y324)", 320, 321, 345, 327),
 ("g1 white shirt (x20,y195)", 5, 185, 40, 205),
 ("g1 hair", 55, 95, 80, 120),
 ("g1 skin face", 70, 125, 85, 140),
 ("g1 khaki trousers (x120,y305)", 100, 295, 150, 315),
 ("g1 shoe (x270,y440)", 250, 432, 290, 448),
 ("g2 green shirt (x140,y130)", 128, 115, 150, 145),
 ("g2 green shirt dark (x220,y190)", 212, 175, 228, 205),
 ("g2 white tee (x190,y170)", 175, 150, 205, 200),
 ("g2 jeans (x190,y270)", 170, 255, 215, 290),
 ("g2 afro hair", 160, 40, 185, 60),
 ("g2 headband", 192, 50, 210, 56),
 ("g2 sunglasses lens", 188, 66, 196, 74),
 ("g2 skin arm", 125, 175, 135, 195),
 ("g3 tee white stripe", 360, 195, 372, 205),
 ("g3 tee green stripe", 345, 195, 352, 205),
 ("g3 jeans (x300,y295)", 285, 285, 320, 305),
 ("g3 hair", 300, 150, 320, 160),
 ("g4 shirt light (x430,y200)", 420, 190, 445, 215),
 ("g4 shirt blue pattern", 395, 205, 415, 225),
 ("g4 trousers (x450,y380)", 430, 360, 470, 400),
 ("g4 hair", 385, 100, 410, 112),
 ("g4 sneaker white", 370, 455, 420, 480),
 ("g4 watch", 330, 230, 338, 238),
 ("jenga block mix (x255,y260)", 240, 245, 268, 300),
 ("title fill white (T stem)", 120, 330, 130, 360),
 ("title outline green", 100, 318, 106, 330),
 ("subtitle fill", 205, 465, 215, 475),
]
for p in P:
    patch(*p)

# Radial profile of the glow (only backdrop pixels: top band, avoid people)
cx, cy = 245, 175
print("\nRadial glow samples along rays (dist px -> colour) from centre", (cx, cy))
for ang in [200, 225, 270, 315, 340]:
    a = np.deg2rad(ang)
    row = []
    for r in range(0, 400, 25):
        x = int(cx + r*np.cos(a)); y = int(cy + r*np.sin(a))
        if 0 <= x < W-3 and 0 <= y < H-3:
            row.append(f"{r}:{hexc(np.median(im[y:y+4, x:x+4].reshape(-1,3),axis=0))}")
    print(f" ray {ang:3d}deg: " + " ".join(row))
