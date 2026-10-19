#!/usr/bin/env python3
"""R6-pbr: build alpha-cutout foliage cards (1K PNG + OpenGL normal JPG) from CC0 atlases.

Usage: python3 -I build_foliage.py [card_id ...]
Output: public/assets/textures/foliage/<id>/{albedo.png,normal.jpg}; build manifest in out/.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cv2  # noqa: E402
import numpy as np  # noqa: E402

import foliage_lib as F  # noqa: E402
import r6lib as L  # noqa: E402

_SPR = {}


def sprites(key, **kw):
    ck = (key, tuple(sorted(kw.items())))
    if ck not in _SPR:
        _SPR[ck] = F.extract_sprites(key, **kw)
    return _SPR[ck]


def recolor(sp, target, amount=1.0, keep=0.0):
    """Shift sprite colour toward target RGB keeping luminance detail."""
    rgb = sp.rgb
    l = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    m = l[sp.a > 0.5].mean() if (sp.a > 0.5).any() else l.mean()
    new = (l / max(m, 1e-3))[..., None] * np.array(target, np.float32)
    out = rgb * (1 - amount) + new * amount
    return F.Sprite(np.clip(out, 0, 255), sp.a, sp.n, sp.src)


def stroke(cv, pts, widths, colors, rng=None, noise=0.15, ss=1):
    """Render an anti-aliased tapered stroke (twig/rachis/stem) with cylinder normals onto canvas."""
    pts = np.asarray(pts, np.float32)
    widths = np.asarray(widths, np.float32)
    colors = np.asarray(colors, np.float32)
    H, W = cv.h, cv.w
    la = np.zeros((H, W), np.float32)
    lc = np.zeros((H, W, 3), np.float32)
    ln = np.zeros((H, W, 3), np.float32)
    ln[..., 2] = 1
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        wmax = max(widths[i], widths[i + 1]) / 2 + 2
        x0, x1 = int(max(0, min(a[0], b[0]) - wmax)), int(min(W, max(a[0], b[0]) + wmax + 1))
        y0, y1 = int(max(0, min(a[1], b[1]) - wmax)), int(min(H, max(a[1], b[1]) + wmax + 1))
        if x1 <= x0 or y1 <= y0:
            continue
        yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
        ab = b - a
        L2 = float(ab @ ab) + 1e-6
        t = np.clip(((xx - a[0]) * ab[0] + (yy - a[1]) * ab[1]) / L2, 0, 1)
        px, py = a[0] + t * ab[0], a[1] + t * ab[1]
        dx, dy = xx - px, yy - py
        d = np.sqrt(dx * dx + dy * dy)
        w = (widths[i] * (1 - t) + widths[i + 1] * t) / 2
        al = np.clip(w - d + 0.5, 0, 1)
        perp = np.array([-ab[1], ab[0]]) / math.sqrt(L2)
        s = np.clip((dx * perp[0] + dy * perp[1]) / np.maximum(w, 0.5), -1, 1)
        col = colors[i][None, None] * (1 - t[..., None]) + colors[i + 1][None, None] * t[..., None]
        shade = 0.75 + 0.25 * np.sqrt(np.clip(1 - s * s, 0, 1))
        col = col * shade[..., None]
        sub = la[y0:y1, x0:x1]
        upd = al > sub
        if not upd.any():
            continue
        nn = np.stack([perp[0] * s, -perp[1] * s, np.sqrt(np.clip(1 - s * s, 0.05, 1))], -1)
        lc[y0:y1, x0:x1][upd] = col[upd]
        ln[y0:y1, x0:x1][upd] = nn[upd]
        sub[upd] = al[upd]
    if noise and rng is not None:
        nz = L.tile_noise(max(H, W), scale=40, beta=1.2, seed=int(rng.integers(1e6)))[:H, :W]
        lc *= (1 - noise / 2 + noise * nz)[..., None]
    cv.c = lc * la[..., None] + cv.c * (1 - la[..., None])
    cv.n = ln * la[..., None] + cv.n * (1 - la[..., None])
    cv.a = la + cv.a * (1 - la)


def bezier(p0, p1, p2, p3, n=40):
    t = np.linspace(0, 1, n)[:, None]
    p0, p1, p2, p3 = map(lambda p: np.asarray(p, np.float32), (p0, p1, p2, p3))
    return ((1 - t) ** 3) * p0 + 3 * ((1 - t) ** 2) * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3


def finish(cid, cv, meta, man, out=(1024, 1024), dome=0.0):
    if dome:
        cv.dome(dome)
    rgb, a, n = cv.result(out[0], out[1])
    F.save_card(cid, rgb, a, n, meta, man)
    print("card", cid, out, flush=True)


PH = "https://polyhaven.com/a/"
ACG = "https://ambientcg.com/a/"


def src_meta(srcs):
    s, u, au = [], [], set()
    for k in srcs:
        kind, aid = k.split(":", 1)
        if kind == "ph":
            s.append("polyhaven:" + aid)
            u.append(PH + aid)
            cat = L.ph_files  # noqa (authors come from the models catalog below)
        else:
            s.append("ambientcg:" + aid)
            u.append(ACG + aid)
    return dict(source=" + ".join(s), sourceUrl=" ; ".join(u), license="CC0")


# ============================================================================= cards
def grass_clump_bermuda(man):
    rng = np.random.default_rng(1)
    sp = sprites("ph:grass_bermuda_01", min_area=2500, base="bottom")
    clumps = [s for s in sp if s.w > s.h * 0.6]
    blades = [s for s in sp if s.w <= s.h * 0.6] or sp
    cv = F.Canvas(2048, 1024)
    for k in range(70):
        s = blades[rng.integers(len(blades))] if rng.random() < 0.45 else clumps[rng.integers(len(clumps))]
        x = rng.uniform(120, 1928)
        sc = rng.uniform(0.8, 1.5) * (900 / max(s.h, 1)) * rng.uniform(0.35, 0.7)
        sh = rng.uniform(0.7, 1.05)
        tint = (rng.uniform(0.9, 1.08), rng.uniform(0.95, 1.08), rng.uniform(0.85, 1.0))
        cv.stamp(s, x, 1010 - rng.uniform(0, 25), sc, rng.uniform(-18, 18), rng.random() < 0.5, tint, sh)
    finish("grass_clump_low", cv, dict(widthMeters=0.9, heightMeters=0.45, pivot=[0.5, 0.0], alphaTest=0.45,
                                       tags=["grass", "clump", "bermuda", "lawn-edge", "roadside", "low"],
                                       **src_meta(["ph:grass_bermuda_01"]), author="Poly Haven (see credits)"),
           man, (1024, 512), dome=0.15)


def grass_tall_tuft(man):
    rng = np.random.default_rng(2)
    b1 = sprites("acg:Foliage001", min_area=4000, base="bottom")
    b2 = sprites("ph:grass_medium_02", min_area=3000, base="bottom")
    blades = b1 + b2
    cv = F.Canvas(2048, 2048)
    for k in range(95):
        s = blades[rng.integers(len(blades))]
        x = 1024 + rng.normal(0, 150)
        ang = rng.normal(0, 22) + (x - 1024) * -0.03
        sc = rng.uniform(0.75, 1.15) * 1750 / max(s.h, 1)
        g = rng.uniform(0.8, 1.05)
        dry = rng.random() < 0.18
        tint = (1.15, 1.0, 0.65) if dry else (rng.uniform(0.9, 1.05), 1.0, rng.uniform(0.85, 1.0))
        cv.stamp(s, x, 2040, sc, ang, rng.random() < 0.5, tint, g)
    finish("grass_tall_tuft", cv, dict(widthMeters=0.9, heightMeters=0.9, pivot=[0.5, 0.0], alphaTest=0.4,
                                       tags=["grass", "tall", "tuft", "empty-lot", "canal-bank", "rural"],
                                       **src_meta(["acg:Foliage001", "ph:grass_medium_02"]), author="ambientCG + Poly Haven"),
           man, (1024, 1024), dome=0.12)


def weeds_roadside(man):
    rng = np.random.default_rng(3)
    big = sprites("ph:weed_plant_02", min_area=8000, base="auto")
    nett = sprites("ph:nettle_plant", min_area=4000, base="auto")
    clover = [s for s in sprites("ph:shrub_sorrel_01", min_area=6000, base="bottom") if s.h < s.w * 1.6]
    blades = sprites("acg:Foliage006", min_area=3000, base="bottom")
    cv = F.Canvas(2048, 1024)
    for k in range(40):  # back: grass blades
        s = blades[rng.integers(len(blades))]
        cv.stamp(s, rng.uniform(100, 1950), 1015, rng.uniform(0.6, 1.0) * 800 / s.h, rng.normal(0, 25), rng.random() < .5,
                 (1, 1, 0.9), rng.uniform(0.7, 0.95))
    for k in range(22):
        pool = [big, nett, clover][rng.integers(3)]
        s = pool[rng.integers(len(pool))]
        sc = rng.uniform(0.5, 0.95) * 520 / max(s.h, s.w)
        cv.stamp(s, rng.uniform(150, 1900), 1015 - rng.uniform(0, 60), sc, rng.normal(0, 35), rng.random() < .5,
                 (rng.uniform(0.95, 1.1), 1, 0.9), rng.uniform(0.75, 1.0), tilt=(rng.normal(0, .15), rng.normal(0, .15)))
    finish("weeds_roadside", cv, dict(widthMeters=1.2, heightMeters=0.6, pivot=[0.5, 0.0], alphaTest=0.45,
                                      tags=["weeds", "roadside", "empty-lot", "pavement-crack", "mixed"],
                                      **src_meta(["ph:weed_plant_02", "ph:nettle_plant", "ph:shrub_sorrel_01", "acg:Foliage006"]),
                                      author="Poly Haven + ambientCG"), man, (1024, 512), dome=0.1)


def dry_grass_seedheads(man):
    rng = np.random.default_rng(4)
    pool = sprites("acg:Foliage003", min_area=2500, base="bottom") + sprites("acg:Foliage004", min_area=2000, base="bottom") \
        + sprites("acg:Foliage007", min_area=2000, base="bottom") + sprites("acg:Foliage002", min_area=4000, base="bottom")
    straw = [recolor(s, (196, 170, 112), 0.8) for s in pool]
    cv = F.Canvas(2048, 2048)
    for k in range(80):
        s = straw[rng.integers(len(straw))]
        x = 1024 + rng.normal(0, 260)
        cv.stamp(s, x, 2040, rng.uniform(0.7, 1.1) * 1800 / s.h, rng.normal(0, 18) + (x - 1024) * -0.02, rng.random() < .5,
                 (rng.uniform(0.9, 1.08), rng.uniform(0.92, 1.02), rng.uniform(0.85, 1.0)), rng.uniform(0.75, 1.05))
    finish("grass_dry_seedheads", cv, dict(widthMeters=1.0, heightMeters=1.0, pivot=[0.5, 0.0], alphaTest=0.35,
                                           tags=["grass", "dry", "seed-heads", "hot-season", "empty-lot", "rural"],
                                           **src_meta(["acg:Foliage002", "acg:Foliage003", "acg:Foliage004", "acg:Foliage007"]),
                                           author="ambientCG (Lennart Demes)", note="Re-coloured to sun-dried straw."),
           man, (1024, 1024))


def rice_clump(man, ripe):
    rng = np.random.default_rng(5 + int(ripe))
    blades = sprites("acg:Foliage001", min_area=4000, base="bottom") + sprites("acg:Foliage008", min_area=3000, base="left")
    pan = sprites("acg:Foliage002", min_area=4000, base="bottom")
    leaf_col = (150, 170, 70) if ripe else (96, 160, 62)
    blades = [recolor(s, leaf_col, 0.65) for s in blades]
    pan = [recolor(s, (205, 172, 92), 0.9) for s in pan]
    cv = F.Canvas(2048, 2048)
    for k in range(110):
        s = blades[rng.integers(len(blades))]
        x = 1024 + rng.normal(0, 70)
        ang = rng.normal(0, 16) + (x - 1024) * -0.08
        sc = rng.uniform(0.8, 1.1) * (1650 if not ripe else 1500) / s.h
        cv.stamp(s, x, 2045, sc, ang, rng.random() < .5,
                 (rng.uniform(0.92, 1.08), rng.uniform(0.95, 1.05), rng.uniform(0.85, 1.0)), rng.uniform(0.72, 1.05))
    if ripe:
        for k in range(26):  # drooping golden panicles
            s = pan[rng.integers(len(pan))]
            side = -1 if rng.random() < .5 else 1
            x = 1024 + side * rng.uniform(40, 340)
            y = rng.uniform(380, 900)
            ang = side * -rng.uniform(95, 150)
            cv.stamp(s, x, y, rng.uniform(0.35, 0.5) * 1800 / s.h, ang, rng.random() < .5,
                     (rng.uniform(0.95, 1.05), 1, rng.uniform(0.9, 1.0)), rng.uniform(0.85, 1.05))
    cid = "rice_clump_ripe" if ripe else "rice_clump_young"
    finish(cid, cv, dict(widthMeters=0.7, heightMeters=0.9 if ripe else 0.8, pivot=[0.5, 0.0], alphaTest=0.4,
                         tags=["rice", "paddy", "rural", "field"] + (["ripe", "golden", "harvest"] if ripe else ["young", "green"]),
                         **src_meta(["acg:Foliage001", "acg:Foliage008"] + (["acg:Foliage002"] if ripe else [])),
                         author="ambientCG (Lennart Demes)",
                         note="Composed rice clump: grass blades re-coloured" + (", grass panicles re-coloured gold and drooping." if ripe else ".")),
           man, (1024, 1024), dome=0.1)


def bamboo_leaf_spray(man):
    rng = np.random.default_rng(7)
    lv = sprites("acg:Foliage005", min_area=4000, base="left")
    lv = [recolor(s, (118, 150, 64), 0.5) for s in lv[:2]] + [recolor(lv[0], (150, 160, 80), 0.6)]
    cv = F.Canvas(2048, 2048)
    # main twig arching from bottom-left to the right
    main = bezier((150, 1950), (500, 1100), (1200, 700), (1900, 820), 60)
    stroke(cv, main, np.linspace(26, 8, len(main)), [(150, 140, 70)] * len(main), rng)
    for k in range(9):
        t = 0.22 + k * 0.085
        i = int(t * (len(main) - 1))
        p = main[i]
        d = main[min(i + 1, len(main) - 1)] - main[max(i - 1, 0)]
        base_ang = math.degrees(math.atan2(-d[1], d[0]))
        side = 1 if k % 2 == 0 else -1
        tw_ang = math.radians(base_ang + side * rng.uniform(35, 55))
        ln = rng.uniform(160, 280)
        q = p + np.array([math.cos(tw_ang), -math.sin(tw_ang)]) * ln
        stroke(cv, [p, (p + q) / 2 + rng.normal(0, 10, 2), q], [11, 8, 5], [(140, 132, 66)] * 3, rng)
        for j in range(rng.integers(4, 8)):  # fan of drooping leaves at the twig tip
            leaf_dir = base_ang + side * rng.uniform(20, 70) - rng.uniform(10, 60)
            s = lv[rng.integers(len(lv))]
            sc = rng.uniform(0.55, 0.8) * 520 / s.h
            cv.stamp(s, q[0], q[1], sc, leaf_dir - 90, rng.random() < .5,
                     (rng.uniform(0.92, 1.06), rng.uniform(0.95, 1.05), 0.95), rng.uniform(0.78, 1.05),
                     tilt=(rng.normal(0, .2), rng.normal(0, .2)))
    finish("bamboo_leaf_spray", cv, dict(widthMeters=1.2, heightMeters=1.2, pivot=[0.07, 0.03], alphaTest=0.45,
                                         tags=["bamboo", "leaves", "spray", "branch", "rural", "temple-garden"],
                                         **src_meta(["acg:Foliage005"]), author="ambientCG (Lennart Demes) + R6 twig strokes",
                                         note="Lanceolate blades arranged as bamboo leaf fans on a procedural twig. Pivot = twig base."),
           man, (1024, 1024))


def coconut_frond(man, variant):
    rng = np.random.default_rng(10 + variant)
    lf = sprites("acg:Foliage008", min_area=3000, base="left") + sprites("acg:Foliage001", min_area=4000, base="bottom")
    col = (112, 150, 58) if variant == 0 else (140, 150, 62)
    lf = [recolor(s, col, 0.55) for s in lf]
    W, H = 2048, 1024
    cv = F.Canvas(W, H)
    droop = 0.18 if variant == 0 else 0.32
    rach = bezier((40, 470), (700, 300), (1400, 360 + droop * 400), (2000, 560 + droop * 700), 80)
    n = len(rach)
    for side in (-1, 1):
        for i in range(6, n - 2):
            if rng.random() < 0.08:
                continue  # gaps
            t = i / (n - 1)
            p = rach[i]
            d = rach[min(i + 1, n - 1)] - rach[i - 1]
            ang = math.degrees(math.atan2(-d[1], d[0]))
            spread = (60 - 25 * t) * side + rng.normal(0, 6)
            hang = -(15 + 35 * t + droop * 40) if side > 0 else (15 + 35 * t + droop * 40) * 0.3
            leaf_ang = ang + spread + hang * 0.5
            s = lf[rng.integers(len(lf))]
            length = (380 + 120 * math.sin(math.pi * min(1, t * 1.15))) * rng.uniform(0.85, 1.1)
            sc = length / s.h
            sh = rng.uniform(0.75, 1.0) * (0.85 if side < 0 else 1.0)
            tint = (rng.uniform(0.95, 1.08), rng.uniform(0.95, 1.05), rng.uniform(0.85, 1.0))
            if variant == 1 and rng.random() < 0.15:
                tint = (1.25, 1.05, 0.6)  # yellowing leaflet
            cv.stamp(s, p[0], p[1], sc, leaf_ang - 90, rng.random() < .5, tint, sh,
                     tilt=(0.0, 0.25 * side))
    stroke(cv, rach, np.linspace(30, 6, n), np.linspace([170, 150, 80], [150, 160, 80], n), rng, noise=0.1)
    finish(f"coconut_frond_{'a' if variant == 0 else 'b'}", cv,
           dict(widthMeters=4.5, heightMeters=2.25, pivot=[0.02, 0.54], alphaTest=0.4,
                tags=["coconut", "palm", "frond", "tropical", "tree-card"] + (["fresh"] if variant == 0 else ["older", "drooping", "yellowing"]),
                **src_meta(["acg:Foliage008", "acg:Foliage001"]), author="ambientCG (Lennart Demes) + R6 rachis stroke",
                note="Frond runs left->right; pivot = rachis base (attach to crown). Use 10-20 rotated copies per palm."),
           man, (1024, 512))


def canopy(man, cid, keys, n_leaves, leaf_px, seed, base="bottom", tint_col=None, twigs=True, tags=(), note=""):
    rng = np.random.default_rng(seed)
    pool = []
    for k in keys:
        pool += sprites(k, min_area=3000, base=base)
    if tint_col:
        pool = [recolor(s, tint_col, 0.35) for s in pool]
    S = 2048
    cv = F.Canvas(S, S)
    # irregular canopy blob from a few overlapping ellipses
    blobs = [(S / 2 + rng.normal(0, 180), S / 2 + rng.normal(0, 120), rng.uniform(420, 650), rng.uniform(330, 520)) for _ in range(6)]

    def inside(x, y):
        return max(1 - ((x - cx) / rx) ** 2 - ((y - cy) / ry) ** 2 for cx, cy, rx, ry in blobs)

    if twigs:
        for k in range(14):
            a0 = rng.uniform(0, 2 * math.pi)
            p0 = np.array([S / 2, S * 0.62])
            p3 = p0 + np.array([math.cos(a0), -abs(math.sin(a0)) * 0.8]) * rng.uniform(350, 700)
            pts = bezier(p0, p0 + (p3 - p0) * 0.3 + rng.normal(0, 60, 2), p0 + (p3 - p0) * 0.7 + rng.normal(0, 60, 2), p3, 30)
            stroke(cv, pts, np.linspace(16, 4, 30), [(82, 66, 50)] * 30, rng)
    placed = 0
    tries = 0
    while placed < n_leaves and tries < n_leaves * 20:
        tries += 1
        x, y = rng.uniform(150, S - 150), rng.uniform(150, S - 150)
        v = inside(x, y)
        if v < -0.05 + rng.random() * 0.1:
            continue
        depth = placed / n_leaves  # later = front
        s = pool[rng.integers(len(pool))]
        cx, cy = S / 2, S / 2
        out_ang = math.degrees(math.atan2(-(y - cy), x - cx))
        ang = out_ang - 90 + rng.normal(0, 40)
        sc = leaf_px / max(s.h, 1) * rng.uniform(0.75, 1.2)
        shade = 0.45 + 0.6 * depth * (0.8 + 0.2 * rng.random())
        shade *= 1.0 + 0.15 * np.clip((cy - y) / 600, -1, 1)  # top a bit brighter
        tint = (rng.uniform(0.92, 1.08), rng.uniform(0.95, 1.05), rng.uniform(0.88, 1.02))
        r = math.radians(out_ang)
        cv.stamp(s, x, y, sc, ang, rng.random() < .5, tint, float(np.clip(shade, 0.35, 1.15)),
                 tilt=(0.35 * math.cos(r), 0.35 * math.sin(r)), anchor="base")
        placed += 1
    finish(cid, cv, dict(widthMeters=3.0, heightMeters=3.0, pivot=[0.5, 0.2], alphaTest=0.5,
                         tags=["tree", "canopy", "card", "tropical"] + list(tags), **src_meta(keys),
                         author="Poly Haven / ambientCG (see credits)", note=note),
           man, (1024, 1024), dome=0.45)


def potted_leaves_atlas(man):
    """Grid atlas of individual tropical pot-plant leaves; regions listed in the manifest."""
    picks = [("ph:potted_plant_02", 4, "bottom", "syngonium"), ("ph:anthurium_botany_01", 3, "auto", "anthurium"),
             ("ph:calathea_orbifolia_01", 2, "bottom", "calathea"), ("ph:pachira_aquatica_01", 2, "bottom", "pachira"),
             ("acg:LeafSet004", 1, "bottom", "heart-leaf")]
    leaves = []
    for key, k, base, name in picks:
        sp = sprites(key, min_area=20000, base=base)
        sp = [s for s in sp if s.h > 200][:k]
        leaves += [(name, key, s) for s in sp]
    cols, rows = 4, 3
    S = 2048
    cw, ch = S // cols, S // rows
    cv = F.Canvas(S, S)
    regions = []
    for i, (name, key, s) in enumerate(leaves[: cols * rows]):
        cx, cy = i % cols, i // cols
        sc = min((cw - 40) / s.w, (ch - 40) / s.h)
        x = cx * cw + cw / 2
        y = cy * ch + ch - 20
        cv.stamp(s, x, y, sc, 0, False)
        regions.append(dict(name=name, source=key, uv=[round(cx / cols, 4), round(1 - (cy + 1) / rows, 4), round((cx + 1) / cols, 4), round(1 - cy / rows, 4)],
                            leafBase="bottom-centre of cell"))
    finish("potted_leaves_atlas", cv, dict(type="atlas", widthMeters=None, heightMeters=None, pivot=None, alphaTest=0.5, regions=regions,
                                           tags=["potted-plant", "leaves", "atlas", "syngonium", "anthurium", "calathea", "pachira", "shop", "house"],
                                           **src_meta([p[0] for p in picks]), author="Poly Haven + ambientCG",
                                           note="One leaf per cell (uv = [u0,v0,u1,v1], v up). Leaf ~0.15-0.3 m. Build pot plants from rotated quads."),
           man, (1024, 1024))


def potted_syngonium_cluster(man):
    rng = np.random.default_rng(12)
    sp = [s for s in sprites("ph:potted_plant_02", min_area=20000, base="bottom") if s.h > 200]
    cv = F.Canvas(2048, 2048)
    base = np.array([1024, 1960])
    for k in range(34):
        s = sp[rng.integers(len(sp))]
        ang = rng.normal(0, 38)
        ln = rng.uniform(500, 1100)
        tip = base + np.array([math.sin(math.radians(-ang)), -math.cos(math.radians(ang))]) * ln * np.array([1, 1])
        tip[0] = base[0] - math.sin(math.radians(ang)) * ln
        stroke(cv, bezier(base, base + (tip - base) * 0.4 + rng.normal(0, 30, 2), tip - (tip - base) * 0.2, tip, 20),
               np.linspace(12, 7, 20), [(118, 140, 70)] * 20, rng)
        sc = rng.uniform(0.55, 0.85) * 700 / s.h
        depth = k / 34
        cv.stamp(s, tip[0], tip[1], sc, ang + rng.normal(0, 25), rng.random() < .5,
                 (1, 1, 1), 0.55 + 0.5 * depth, tilt=(rng.normal(0, .25), rng.normal(0.1, .2)))
    finish("potted_syngonium_cluster", cv, dict(widthMeters=0.7, heightMeters=0.7, pivot=[0.5, 0.04], alphaTest=0.5,
                                                tags=["potted-plant", "syngonium", "house-plant", "shop", "cluster"],
                                                **src_meta(["ph:potted_plant_02"]), author="Poly Haven (see credits)",
                                                note="Leaf cluster for a pot (pot not included; use the pot from Poly Haven potted_plant_02 or a model)."),
           man, (1024, 1024), dome=0.25)


def periwinkle_bush(man):
    rng = np.random.default_rng(13)
    sp = sprites("ph:periwinkle_plant", min_area=1500, base="auto")
    flowers = [s for s in sp if 0.75 < s.w / max(s.h, 1) < 1.33 and s.rgb[s.a > .5].mean(0)[0] > s.rgb[s.a > .5].mean(0)[1] + 20]
    leaves = [s for s in sp if s not in flowers and s.h < 900]
    cv = F.Canvas(2048, 2048)
    for k in range(150):
        s = leaves[rng.integers(len(leaves))]
        r = rng.uniform(0, 1) ** 0.6
        a0 = rng.uniform(math.pi * 0.05, math.pi * 0.95)
        x = 1024 + math.cos(a0) * r * 800
        y = 1900 - math.sin(a0) * r * 900
        sc = rng.uniform(0.6, 0.9) * 300 / s.h
        cv.stamp(s, x, y, sc, math.degrees(a0) - 90 + rng.normal(0, 40), rng.random() < .5,
                 (1, 1, 1), 0.55 + 0.5 * k / 150, tilt=(math.cos(a0) * .3, math.sin(a0) * .3))
    for k in range(30):
        s = flowers[rng.integers(len(flowers))]
        r = rng.uniform(0.2, 1) ** 0.5
        a0 = rng.uniform(math.pi * 0.08, math.pi * 0.92)
        x = 1024 + math.cos(a0) * r * 780
        y = 1880 - math.sin(a0) * r * 880
        cv.stamp(s, x, y, rng.uniform(0.75, 1.0) * 200 / s.h, rng.uniform(0, 360), rng.random() < .5,
                 (1, 1, 1), rng.uniform(0.9, 1.05), anchor="center")
    finish("periwinkle_bush", cv, dict(widthMeters=0.6, heightMeters=0.6, pivot=[0.5, 0.05], alphaTest=0.5,
                                       tags=["flowers", "periwinkle", "pink", "pot", "roadside", "garden", "shrub"],
                                       **src_meta(["ph:periwinkle_plant"]), author="Poly Haven (see credits)",
                                       note="Madagascar periwinkle (common Thai roadside / pot flower)."),
           man, (1024, 1024), dome=0.3)


def fern_rosette(man):
    rng = np.random.default_rng(14)
    sp = [s for s in sprites("ph:fern_02", min_area=20000, base="bottom") if s.h > 600]
    cv = F.Canvas(2048, 2048)
    for k in range(18):
        s = sp[rng.integers(len(sp))]
        ang = rng.uniform(-75, 75)
        cv.stamp(s, 1024 + rng.normal(0, 25), 1990, rng.uniform(0.8, 1.05) * 1700 / s.h, ang, rng.random() < .5,
                 (1, 1, 0.95), 0.6 + 0.45 * (1 - abs(ang) / 75) * rng.uniform(0.8, 1), tilt=(math.sin(math.radians(-ang)) * .3, .1))
    finish("fern_rosette", cv, dict(widthMeters=1.0, heightMeters=1.0, pivot=[0.5, 0.02], alphaTest=0.5,
                                    tags=["fern", "understory", "shade", "pot", "tropical"],
                                    **src_meta(["ph:fern_02"]), author="Poly Haven (see credits)"), man, (1024, 1024), dome=0.2)


def hanging_vines(man, cid, key, leaf_col, seed, tags, leaf_px=150):
    rng = np.random.default_rng(seed)
    sp = [s for s in sprites(key, min_area=8000, base="bottom")]
    if leaf_col:
        sp = [recolor(s, leaf_col, 0.3) for s in sp]
    cv = F.Canvas(2048, 2048)
    for strand in range(9):
        x0 = rng.uniform(150, 1900)
        length = rng.uniform(900, 1950)
        pts = [np.array([x0, 0.0])]
        x, sway = x0, rng.uniform(-60, 60)
        for i in range(1, 40):
            y = length * i / 39
            x = x0 + sway * math.sin(i / 39 * math.pi * rng.uniform(0.8, 1.6)) + rng.normal(0, 3)
            pts.append(np.array([x, y]))
        pts = np.array(pts)
        stroke(cv, pts, np.linspace(9, 4, len(pts)), [(92, 100, 52)] * len(pts), rng)
        n_leaf = int(length / 70)
        for j in range(n_leaf):
            t = (j + rng.uniform(0, 0.8)) / n_leaf
            i = int(t * (len(pts) - 1))
            p = pts[i]
            side = 1 if j % 2 == 0 else -1
            s = sp[rng.integers(len(sp))]
            sc = leaf_px * (1.15 - 0.45 * t) * rng.uniform(0.8, 1.15) / max(s.h, 1)
            ang = side * rng.uniform(60, 130) + 180 + rng.normal(0, 15)
            cv.stamp(s, p[0], p[1], sc, ang, rng.random() < .5, (1, 1, 1), rng.uniform(0.7, 1.05),
                     tilt=(side * 0.25, -0.1))
    finish(cid, cv, dict(widthMeters=1.5, heightMeters=1.5, pivot=[0.5, 1.0], alphaTest=0.5,
                         tags=["vines", "hanging", "wall", "balcony", "wires"] + tags, **src_meta([key]),
                         author="ambientCG (Lennart Demes) + R6 stem strokes", note="Hangs from the top edge (pivot = top centre)."),
           man, (1024, 1024))


def moss_patch(man, cid, seed):
    rng = np.random.default_rng(seed)
    p = L.fetch_acg("Moss002", "2K")
    col = L.load_img(p["Color"], "RGB").astype(np.float32)
    nrm = F.decode_n(L.load_img(p["NormalGL"], "RGB"))
    S = col.shape[0]
    n1 = L.tile_noise(S, scale=3, beta=2.2, seed=seed)
    n2 = L.tile_noise(S, scale=12, beta=1.8, seed=seed + 1)
    n3 = L.tile_noise(S, scale=60, beta=1.2, seed=seed + 2)
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32) / S
    rad = np.sqrt((xx - 0.5) ** 2 + (yy - 0.5) ** 2) * 2
    field = (1 - rad) * 0.9 + 0.55 * (n1 - 0.5) + 0.25 * (n2 - 0.5) + 0.12 * (n3 - 0.5)
    a = L.smoothstep(0.18, 0.26, field)
    sprigs = L.smoothstep(0.1, 0.2, field) * (n3 > 0.55)  # fuzzy edge tufts
    a = np.clip(np.maximum(a, sprigs * 0.9), 0, 1)
    shade = (0.75 + 0.35 * L.smoothstep(0.2, 0.6, field))[..., None]
    rgb = col * shade
    edge = (1 - L.smoothstep(0.2, 0.4, field))[..., None]
    rgb = rgb * (1 - 0.3 * edge) + np.array([120, 112, 60]) * 0.3 * edge  # browner, drier edges
    cv = F.Canvas(S, S)
    cv.c = rgb * a[..., None]
    cv.a = a.astype(np.float32)
    cv.n = nrm
    finish(cid, cv, dict(type="decal", widthMeters=0.8, heightMeters=0.8, pivot=[0.5, 0.5], alphaTest=0.3,
                         tags=["moss", "patch", "decal", "wall-base", "canal", "damp", "shade"],
                         **src_meta(["acg:Moss002"]), author="ambientCG (Lennart Demes)",
                         note="Alpha-cut moss patch for walls/ground (use as decal or polygon offset quad)."),
           man, (1024, 1024))


CARDS = {
    "grass_clump_low": grass_clump_bermuda,
    "grass_tall_tuft": grass_tall_tuft,
    "weeds_roadside": weeds_roadside,
    "grass_dry_seedheads": dry_grass_seedheads,
    "rice_clump_young": lambda m: rice_clump(m, False),
    "rice_clump_ripe": lambda m: rice_clump(m, True),
    "bamboo_leaf_spray": bamboo_leaf_spray,
    "coconut_frond_a": lambda m: coconut_frond(m, 0),
    "coconut_frond_b": lambda m: coconut_frond(m, 1),
    "canopy_broadleaf": lambda m: canopy(m, "canopy_broadleaf", ["ph:island_tree_01", "ph:island_tree_02"], 520, 150, 21,
                                         tags=["broadleaf", "street-tree"], note="Glossy broadleaf street tree canopy cluster."),
    "canopy_smallleaf": lambda m: canopy(m, "canopy_smallleaf", ["ph:tree_small_02"], 260, 330, 22, base="bottom",
                                         tags=["small-leaf", "shrub-tree"], note="Small-leaved tree / hedge-tree canopy cluster."),
    "canopy_feathery": lambda m: canopy(m, "canopy_feathery", ["ph:jacaranda_tree"], 150, 700, 23, base="left",
                                        tint_col=(110, 140, 60), tags=["feathery", "bipinnate", "rain-tree", "flame-tree", "tamarind"],
                                        note="Bipinnate foliage (reads as rain tree / flame tree / tamarind)."),
    "potted_leaves_atlas": potted_leaves_atlas,
    "potted_syngonium_cluster": potted_syngonium_cluster,
    "periwinkle_bush": periwinkle_bush,
    "fern_rosette": fern_rosette,
    "hanging_vines_heart": lambda m: hanging_vines(m, "hanging_vines_heart", "acg:LeafSet004", (70, 120, 50), 31,
                                                   ["heart-leaf", "pothos-like"], 170),
    "hanging_vines_ivy": lambda m: hanging_vines(m, "hanging_vines_ivy", "acg:LeafSet029", None, 32, ["ivy"], 150),
    "moss_patch_a": lambda m: moss_patch(m, "moss_patch_a", 41),
    "moss_patch_b": lambda m: moss_patch(m, "moss_patch_b", 42),
}


def main():
    want = set(sys.argv[1:])
    man = F.load_manifest()
    for cid, fn in CARDS.items():
        if want and cid not in want:
            continue
        try:
            fn(man)
        except Exception as e:  # noqa
            import traceback
            traceback.print_exc()
            print("FAIL", cid, e)
        F.store_manifest(man)


if __name__ == "__main__":
    main()
