"""Dominant colours (k-means) for groups of reference photos. Usage: python3 -I palette.py"""
import glob
import numpy as np
from PIL import Image

WEB = "/home/user/special-telegram/references/food/web/"
GROUPS = {
    "kaphrao plates": "dish_kaphrao_*.jpg", "fried eggs": "dish_kaidao_*.jpg", "omelette": "dish_kaijiao_*.jpg",
    "carts": "cart_*.jpg", "market": "market_*.jpg", "furniture/stools": "furniture_*.jpg",
    "seasoning bottles": "season_*.jpg", "dishware": "dishware_*.jpg",
}


def kmeans(px, k=7, it=12, seed=0):
    rng = np.random.default_rng(seed)
    c = px[rng.choice(len(px), k, replace=False)]
    for _ in range(it):
        d = ((px[:, None, :] - c[None]) ** 2).sum(-1)
        lab = d.argmin(1)
        for i in range(k):
            m = lab == i
            if m.any():
                c[i] = px[m].mean(0)
    counts = np.bincount(lab, minlength=k)
    return c, counts


for g, pat in GROUPS.items():
    px = []
    for f in sorted(glob.glob(WEB + pat)):
        im = Image.open(f).convert("RGB").resize((64, 64))
        px.append(np.asarray(im).reshape(-1, 3))
    px = np.concatenate(px).astype(np.float32)
    c, n = kmeans(px, 8)
    order = np.argsort(-n)
    print(g + ": " + "  ".join("#%02x%02x%02x(%d%%)" % (*c[i].astype(int), round(100 * n[i] / n.sum())) for i in order))
