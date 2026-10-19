"""Refined colour sampling of ref4 with k-means clusters per region.
Usage: python3 -I sample_album2.py <ref4.jpg>"""
import sys
import numpy as np
from PIL import Image

im = np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(np.float32)

def hexc(c):
    return "#%02X%02X%02X" % tuple(int(round(v)) for v in np.clip(c, 0, 255))

def kmeans(px, k, iters=25, seed=1):
    rng = np.random.default_rng(seed)
    c = px[rng.choice(len(px), k, replace=False)]
    for _ in range(iters):
        d = ((px[:, None, :] - c[None]) ** 2).sum(-1)
        lab = d.argmin(1)
        for j in range(k):
            if (lab == j).any():
                c[j] = px[lab == j].mean(0)
    cnt = np.bincount(lab, minlength=k)
    order = np.argsort(-cnt)
    return [(hexc(c[j]), round(100 * cnt[j] / len(px), 1)) for j in order]

def region(name, x0, y0, x1, y1, k):
    px = im[y0:y1, x0:x1].reshape(-1, 3)
    print(f"{name:28s} ({x0},{y0})-({x1},{y1}): " + "  ".join(f"{h} {p}%" for h, p in kmeans(px, k)))

def pt(name, x, y, r=1):
    p = im[y - r:y + r + 1, x - r:x + r + 1].reshape(-1, 3)
    print(f"  pt {name:30s} ({x},{y}) {hexc(np.median(p, 0))}")

print("== backdrop points (pure backdrop, avoiding people) ==")
for name, x, y in [("TL corner", 5, 5), ("top-left 60,40", 60, 40), ("top 120,15", 120, 15), ("top 250,10", 250, 10),
                   ("top 330,20", 330, 20), ("TR 495,5", 494, 5), ("right 470,60", 470, 60), ("right 480,110", 480, 110),
                   ("right 490,140", 490, 140), ("between g2-g3 260,110", 260, 110), ("260,150", 260, 150), ("270,200", 270, 200),
                   ("250,230", 250, 230), ("300,120", 300, 120), ("330,150", 330, 150), ("350,110", 350, 110),
                   ("left 8,110", 8, 110), ("left 8,150", 8, 150), ("left 30,90", 30, 90), ("100,60", 100, 60),
                   ("80,100 (near g1 hair)", 105, 95), ("glow 240,120", 240, 120), ("glow 290,80", 290, 80),
                   ("glow 230,60", 232, 40), ("glow 315,60", 315, 60), ("glow 380,60", 380, 60), ("glow 420,80", 420, 80), ("glow 445,110", 445, 110)]:
    pt(name, x, y, 2)
print("== floor beyond rug / backdrop floor ==")
for name, x, y in [("left floor 15,355", 15, 355), ("left floor 30,370", 30, 370), ("right floor 480,345", 480, 345), ("right floor 470,365", 470, 365)]:
    pt(name, x, y, 2)
print("== rug ==")
region("rug left", 0, 400, 60, 440, 4)
region("rug front centre", 150, 470, 380, 500, 4)
region("rug right", 420, 410, 500, 455, 4)
region("rug far strip", 40, 380, 140, 400, 4)
print("== jenga tower ==")
region("jenga", 240, 248, 268, 312, 8)
print("== chairs / furniture ==")
region("blue chair shell", 0, 250, 80, 330, 3)
region("blue chair leg/foot", 70, 400, 150, 485, 3)
region("orange chair shell", 360, 250, 440, 380, 4)
region("orange chair legs", 440, 370, 500, 450, 4)
region("sofa", 265, 245, 300, 275, 4)
region("sofa left arm", 95, 255, 125, 290, 3)
region("table top", 200, 312, 350, 330, 4)
print("== people ==")
region("g1 shirt", 0, 160, 70, 245, 4)
region("g1 trousers", 90, 285, 190, 330, 4)
region("g1 sneaker", 250, 430, 300, 460, 5)
region("g1 hair", 25, 85, 100, 160, 3)
region("g1 face", 85, 115, 105, 160, 3)
region("g2 shirt", 120, 100, 170, 230, 5)
region("g2 shirt R", 205, 100, 235, 230, 5)
region("g2 tee", 175, 120, 210, 220, 2)
region("g2 jeans", 140, 230, 225, 320, 3)
region("g2 hair", 150, 30, 235, 90, 3)
region("g2 face", 180, 70, 215, 115, 3)
region("g2 glasses", 183, 62, 213, 78, 3)
region("g3 tee", 300, 185, 375, 240, 4)
region("g3 jeans", 280, 270, 370, 315, 4)
region("g3 face", 300, 160, 335, 200, 3)
region("g4 shirt", 390, 150, 500, 290, 5)
region("g4 trousers", 420, 300, 495, 430, 3)
region("g4 sneaker", 365, 445, 445, 490, 4)
region("g4 face", 370, 110, 410, 160, 3)
print("== title ==")
region("title T", 92, 315, 170, 360, 4)
region("title Colour", 150, 380, 420, 440, 4)
region("subtitle", 190, 458, 325, 492, 4)
