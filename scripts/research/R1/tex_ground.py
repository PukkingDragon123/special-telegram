"""R1-streets: tileable Thai ground materials (sidewalk pavers, concrete, asphalt, curbs).

Each material is written as <name>_albedo.jpg, <name>_normal.jpg (OpenGL +Y),
<name>_orm.jpg (R=AO, G=roughness, B=metalness) into public/assets/textures/world/.
Base micro-detail comes from CC0 Poly Haven scans; layouts/patterns are procedural and
modelled on Thai sidewalks seen in references (see references/streets/NOTES.md).

usage: python3 -I tex_ground.py [name ...]
"""
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texlib import *  # noqa

N = 1024
MAN = {}


def write_material(name, alb, hgt, rough, ao=None, metal=None, nstrength=6.0, extra_normal=None,
                   meta=None):
    nrm = height_to_normal(hgt, nstrength)
    if extra_normal is not None:
        nrm = blend_normals(nrm, extra_normal)
    if ao is None:
        ao = np.clip(1 - (blur(hgt, 6) - hgt) * 3.0, 0.35, 1)
    if metal is None:
        metal = np.zeros_like(rough)
    orm = np.stack([ao, rough, metal], -1)
    save_jpg(alb, f"{OUT_TEX}/{name}_albedo.jpg", 88)
    save_jpg(nrm, f"{OUT_TEX}/{name}_normal.jpg", 92)
    save_jpg(orm, f"{OUT_TEX}/{name}_orm.jpg", 88)
    if meta:
        MAN[name] = meta
    print("wrote", name)


def base_concrete(src="concrete_floor_worn_001", scale=1.0, seed=0, n=N):
    """Tileable concrete micro detail (albedo, height, rough) from a Poly Haven scan."""
    s = int(n * scale)
    a = ph(src, "diff", s)
    h = ph(src, "disp", s)
    r = ph(src, "rough", s)
    if s != n:
        a, h, r = tile_to(a, n, n), tile_to(h, n, n), tile_to(r, n, n)
    sh = (seed * 397) % n, (seed * 211) % n
    a = np.roll(a, sh, (0, 1)); h = np.roll(h, sh, (0, 1)); r = np.roll(r, sh, (0, 1))
    return a, h, r


def grid_coords(n, tiles):
    """Per-pixel tile index and local coords for a square grid of `tiles` x `tiles`."""
    y, x = np.mgrid[0:n, 0:n].astype(np.float32) + 0.5
    t = n / tiles
    tx, ty = np.floor(x / t).astype(int), np.floor(y / t).astype(int)
    u, v = (x - tx * t) / t, (y - ty * t) / t
    return tx, ty, u, v, t


def per_tile(tx, ty, tiles, vals):
    return vals[(ty % tiles), (tx % tiles)]


def joint_mask(u, v, t, width_px):
    d = np.minimum(np.minimum(u, 1 - u), np.minimum(v, 1 - v)) * t
    return 1 - smoothstep(width_px * 0.5, width_px * 0.5 + 1.2, d)


def tile_inside(u, v, t, tx, ty, tiles, width_px, seed, corner_px=None, jitter_px=1.6):
    """Signed distance (px) inside a rounded tile whose 4 sides are randomly inset."""
    r = np.random.default_rng(seed)
    ins = r.uniform(0, jitter_px, (tiles, tiles, 4)).astype(np.float32) + width_px * 0.5
    i = ins[ty % tiles, tx % tiles]
    x, y = u * t, v * t
    dl, dr = x - i[..., 0], (t - x) - i[..., 1]
    dt, db = y - i[..., 2], (t - y) - i[..., 3]
    cr = corner_px if corner_px is not None else max(2.0, t * 0.04)
    # rounded corners: distance to inner rect corner circles
    ax = np.minimum(dl, dr)
    ay = np.minimum(dt, db)
    inside = np.minimum(ax, ay)
    cx = np.clip(cr - ax, 0, None)
    cy = np.clip(cr - ay, 0, None)
    corner = cr - np.sqrt(cx * cx + cy * cy)
    return np.where((ax < cr) & (ay < cr), corner, inside)


def groove(dist_px, width_px):
    return 1 - smoothstep(width_px * 0.5, width_px * 0.5 + 1.3, dist_px)


def seg_dist(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    L = vx * vx + vy * vy + 1e-9
    t = np.clip((wx * vx + wy * vy) / L, 0, 1)
    dx, dy = wx - t * vx, wy - t * vy
    return np.sqrt(dx * dx + dy * dy)


def stains_layer(n, seed, amount=1.0):
    """Dark organic stains (spilled food/oil), gum spots and rust dots (tileable)."""
    r = np.random.default_rng(seed)
    big = fbm(n, n, 2.6, seed=seed)
    stain = smoothstep(0.62, 0.85, big) * 0.55 * amount
    mid = fbm(n, n, 2.0, seed=seed + 1)
    stain += smoothstep(0.7, 0.9, mid) * 0.25 * amount
    gum = np.zeros((n, n), np.float32)
    yy, xx = np.mgrid[0:n, 0:n]
    for _ in range(int(55 * amount)):
        cx, cy = r.uniform(0, n), r.uniform(0, n)
        rad = r.uniform(2.0, 5.5)
        dx = (xx - cx + n / 2) % n - n / 2
        dy = (yy - cy + n / 2) % n - n / 2
        e = np.sqrt((dx / rad) ** 2 + (dy / (rad * r.uniform(0.7, 1.2))) ** 2)
        gum = np.maximum(gum, 1 - smoothstep(0.75, 1.05, e))
    return np.clip(stain, 0, 1), gum


def crack_layer(n, seed, count=6, mask=None):
    """Fractal crack polylines drawn into a tileable mask."""
    from PIL import Image, ImageDraw
    r = np.random.default_rng(seed)
    S = n * 2
    im = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(im)
    for _ in range(count):
        x, y = r.uniform(0, S), r.uniform(0, S)
        ang = r.uniform(0, 2 * np.pi)
        L = r.uniform(0.08, 0.3) * S
        steps = int(L / 6)
        pts = [(x, y)]
        for i in range(steps):
            ang += r.normal(0, 0.35)
            x += math.cos(ang) * 6; y += math.sin(ang) * 6
            pts.append((x, y))
            if r.random() < 0.04:  # branch
                bx, by, ba = x, y, ang + r.choice([-1, 1]) * r.uniform(0.5, 1.2)
                bpts = [(bx, by)]
                for j in range(int(steps * 0.3)):
                    ba += r.normal(0, 0.4)
                    bx += math.cos(ba) * 6; by += math.sin(ba) * 6
                    bpts.append((bx, by))
                for ox in (-S, 0, S):
                    for oy in (-S, 0, S):
                        d.line([(p[0] + ox, p[1] + oy) for p in bpts], fill=150, width=2)
        for ox in (-S, 0, S):
            for oy in (-S, 0, S):
                d.line([(p[0] + ox, p[1] + oy) for p in pts], fill=255, width=3)
    a = np.asarray(im.resize((n, n), Image.LANCZOS)).astype(np.float32) / 255
    if mask is not None:
        a *= mask
    return a


def finish_paver(name, tiles, real_m, tile_colors, groove_m, joint_px, base_src, meta_notes,
                 seed=0, tilt=0.03, wear=0.5, broken=1, dirt_in_grooves=0.6, stain_amt=1.0,
                 crack_count=7, extra_height=None, color_jitter=0.06, base_scale=1.0):
    n = N
    tx, ty, u, v, t = grid_coords(n, tiles)
    r = np.random.default_rng(seed)
    a0, h0, r0 = base_concrete(base_src, base_scale, seed)
    # per tile colour from palette list + jitter, per tile UV offset of the base detail
    pal = np.array([hex2rgb(c) for c in tile_colors])
    tile_pal = r.integers(0, len(pal), (tiles, tiles))
    tile_jit = r.normal(0, color_jitter * 0.12, (tiles, tiles, 3)).astype(np.float32)
    tile_bri = r.normal(0, color_jitter, (tiles, tiles)).astype(np.float32)
    col = pal[tile_pal[ty % tiles, tx % tiles]] + tile_jit[ty % tiles, tx % tiles]
    col = col * (1 + tile_bri[ty % tiles, tx % tiles])[..., None]
    # base scan luminance as detail (keep its variation, use our colour)
    det = lum(a0)
    det = det / max(det.mean(), 1e-3)
    alb = np.clip(col * (0.55 + 0.45 * det)[..., None], 0, 1)
    # tilt per tile -> subtle height gradient (uneven laying)
    gx = r.normal(0, tilt, (tiles, tiles)).astype(np.float32)
    gy = r.normal(0, tilt, (tiles, tiles)).astype(np.float32)
    tilt_h = (u - 0.5) * gx[ty % tiles, tx % tiles] + (v - 0.5) * gy[ty % tiles, tx % tiles]
    dins = tile_inside(u, v, t, tx, ty, tiles, joint_px, seed + 77)
    jm = 1 - smoothstep(0.0, 1.2, dins)
    bevel = smoothstep(0.0, max(2.0, t * 0.025), dins)
    # chipped edges near joints
    chip = smoothstep(0.72, 0.9, fbm(n, n, 1.6, seed=seed + 5)) * (1 - smoothstep(0, 0.06, np.minimum(np.minimum(u, 1 - u), np.minimum(v, 1 - v))))
    jm = np.maximum(jm, chip * 0.9)
    gm = groove_m if groove_m is not None else np.zeros_like(u)
    # height
    hgt = 0.5 + (h0 - 0.5) * 0.18 + tilt_h
    hgt -= gm * 0.12
    hgt -= jm * 0.22
    hgt -= (1 - bevel) * 0.08
    if extra_height is not None:
        hgt += extra_height
    # broken / missing tile pieces -> sunken sandy hole
    hole = np.zeros_like(u)
    for _ in range(broken):
        bx, by = r.integers(0, tiles, 2)
        sel = ((tx % tiles) == bx) & ((ty % tiles) == by)
        n2 = fbm(n, n, 2.2, seed=seed + 9 + bx)
        cx, cy = r.uniform(0.2, 0.8, 2)
        rr = np.sqrt((u - cx) ** 2 + (v - cy) ** 2) + (n2 - 0.5) * 0.35
        hole = np.maximum(hole, sel * (1 - smoothstep(0.28, 0.33, rr)))
    sand = hex2rgb("#6f6250") * (0.75 + 0.5 * fbm(n, n, 1.2, seed=seed + 3))[..., None]
    alb = lerp(alb, sand, hole)
    hgt = hgt - hole * 0.3
    # dust film (Thai footpaths are dusty): desaturates & lightens in patches
    dust = smoothstep(0.3, 0.8, fbm(n, n, 2.2, seed=seed + 13)) * 0.35 + 0.12
    alb = lerp(alb, hex2rgb("#9b9286") * (0.8 + 0.4 * det)[..., None], dust)
    # dirt in joints & grooves (dark, slightly warm)
    dirt_col = hex2rgb("#37312a")
    alb = lerp(alb, dirt_col, np.clip(jm * 0.85 + gm * dirt_in_grooves, 0, 1))
    # walking wear: brighter, smoother, slightly polished patches
    wearm = smoothstep(0.35, 0.85, fbm(n, n, 3.0, seed=seed + 11)) * wear
    alb = alb * (1 + wearm[..., None] * 0.12)
    # general grime: low freq darkening + edge dirt (blurred joint mask)
    grime = fbm(n, n, 2.4, seed=seed + 12)
    alb = alb * (0.82 + 0.3 * grime)[..., None]
    edge_dirt = blur(jm + gm * 0.5, 5)
    alb = alb * (1 - np.clip(edge_dirt, 0, 1) * 0.35)[..., None]
    # stains, gum
    st, gum = stains_layer(n, seed + 20, stain_amt)
    alb = alb * (1 - st[..., None] * 0.55)
    alb = lerp(alb, hex2rgb("#262321"), gum * 0.85)
    hgt += gum * 0.03
    # cracks
    if crack_count:
        cr = crack_layer(n, seed + 30, crack_count)
        alb = alb * (1 - cr[..., None] * 0.7)
        hgt -= cr * 0.05
    # rough / ao
    rough = np.clip(0.86 + (r0 - r0.mean()) * 0.5 - wearm * 0.18 + jm * 0.1 - st * 0.12 - gum * 0.25, 0.3, 1)
    ao = np.clip(1 - jm * 0.55 - gm * 0.35 - hole * 0.4 - blur(jm, 3) * 0.3, 0.2, 1)
    alb = saturation(alb, 0.92)
    write_material(name, alb, hgt, rough, ao, nstrength=7.0, meta={
        "purpose": meta_notes, "size": f"{N}x{N}", "alpha": False, "tiling": True,
        "real_world_m": [real_m, real_m], "maps": ["albedo", "normal", "orm"]})


# ------------------------------------------------------------------ patterns
def pav_circles():
    """40x40 cm grey tiles with concentric quarter-arcs; 2x2 tiles form a circle
    (classic Bangkok footpath tile, ref 920316c6)."""
    tiles = 4
    n = N
    tx, ty, u, v, t = grid_coords(n, tiles)
    # corner the arcs are centred on: tiles mirrored so 2x2 meet at a shared corner
    cx = np.where(tx % 2 == 0, 1.0, 0.0)
    cy = np.where(ty % 2 == 0, 1.0, 0.0)
    d = np.sqrt((u - cx) ** 2 + (v - cy) ** 2) * t
    gw = 0.008 / 0.4 * t  # 8 mm grooves
    gm = np.zeros_like(u)
    for R in (0.13, 0.36, 0.6, 0.84):
        gm = np.maximum(gm, groove(np.abs(d - R * t), gw))
    # outer S-arc from the opposite corner (gives the S/yin-yang flow seen in the photo)
    d2 = np.sqrt((u - (1 - cx)) ** 2 + (v - (1 - cy)) ** 2) * t
    gm = np.maximum(gm, groove(np.abs(d2 - 0.36 * t), gw) * (d > 0.84 * t))
    finish_paver("sidewalk_tile_circles_grey", tiles, 1.6,
                 ["#8d8a84", "#97938b", "#85827c", "#9a958c"], gm, 3.0, "concrete_floor_worn_001",
                 "Bangkok footpath: 40x40 cm grey concrete tiles with concentric quarter-arc grooves "
                 "(4 tiles make one circle). Worn, gum spots, food stains, cracks, one broken tile.",
                 seed=11, wear=0.6, broken=1)


def pav_red_hex():
    """30x30 cm red/pink pressed tiles with polygon star grooves (ref 7a353dab)."""
    tiles = 4
    n = N
    tx, ty, u, v, t = grid_coords(n, tiles)
    gw = 0.007 / 0.3 * t
    # pattern in a tile: centre elongated hexagon + spokes to corners/edge midpoints,
    # rotated 90 deg on a checkerboard so neighbours interlock into stars.
    rot = ((tx + ty) % 2) == 1
    uu = np.where(rot, v, u)
    vv = np.where(rot, 1 - u, v)
    px, py = uu * t, vv * t
    hexv = [(0.5, 0.18), (0.72, 0.34), (0.72, 0.66), (0.5, 0.82), (0.28, 0.66), (0.28, 0.34)]
    segs = []
    for i in range(6):
        segs.append((hexv[i], hexv[(i + 1) % 6]))
    segs += [((0.5, 0.18), (0.5, 0.0)), ((0.5, 0.82), (0.5, 1.0)),
             ((0.72, 0.34), (1.0, 0.18)), ((0.72, 0.66), (1.0, 0.82)),
             ((0.28, 0.34), (0.0, 0.18)), ((0.28, 0.66), (0.0, 0.82))]
    dmin = np.full_like(u, 1e9)
    for (ax, ay), (bx, by) in segs:
        dmin = np.minimum(dmin, seg_dist(px, py, ax * t, ay * t, bx * t, by * t))
    gm = groove(dmin, gw)
    finish_paver("sidewalk_tile_red_hex", tiles, 1.2,
                 ["#9a5d52", "#a1655a", "#93584e"], gm, 2.6,
                 "concrete_floor_worn_001",
                 "Old-town Bangkok soi footpath: 30x30 cm red/pink pressed concrete tiles with "
                 "polygon-star grooves; faded, dirty, cigarette/gum spots.",
                 seed=23, wear=0.5, broken=1, color_jitter=0.06)


def pav_wave():
    """Grey 40x40 cm 'chain' tiles: coin + double racetrack over a small-square grid,
    alternate tiles rotated so tracks interlink (ref 3a05f646)."""
    tiles = 4
    n = N
    tx, ty, u, v, t = grid_coords(n, tiles)
    gw = 0.007 / 0.4 * t
    rot = ((tx + ty) % 2) == 1
    uu = np.where(rot, v, u)
    vv = np.where(rot, u, v)
    px, py = (uu - 0.5) * t, (vv - 0.5) * t

    def capsule_sd(x, y, hl, rs):
        yy = np.clip(y, -hl, hl)
        return np.sqrt(x * x + (y - yy) ** 2) - rs
    outer = capsule_sd(px, py, 0.2 * t, 0.36 * t)
    inner = capsule_sd(px, py, 0.2 * t, 0.26 * t)
    gm = np.maximum(groove(np.abs(outer), gw), groove(np.abs(inner), gw))
    dc = np.sqrt(px ** 2 + py ** 2)
    gm = np.maximum(gm, groove(np.abs(dc - 0.12 * t), gw))
    band = (outer < 0) & (inner > 0)
    k = 8
    fx = np.abs(((uu * k) % 1) - 0.5)
    fy = np.abs(((vv * k) % 1) - 0.5)
    dsq = np.minimum(0.5 - fx, 0.5 - fy) * t / k
    gsq = groove(dsq, gw * 0.85)
    gm = np.maximum(gm, gsq * (~band) * (dc > 0.13 * t))
    finish_paver("sidewalk_tile_chain_grey", tiles, 1.6,
                 ["#9a9893", "#a3a19b", "#8f8d88"], gm, 2.6, "brushed_concrete",
                 "Newer BMA footpath tile: 40x40 cm grey pressed concrete, coin + double racetrack "
                 "grooves over a small-square grid, alternate tiles rotated; dirt in grooves.",
                 seed=37, wear=0.4, broken=0, dirt_in_grooves=0.7)


def pav_small_grey():
    """10x10 cm grey setts with a 2-row faded-red accent band (ref 9f2eca90).
    Layout/detail from Poly Haven 'square_concrete_pavers' (CC0), recoloured."""
    import cv2
    n = N
    a = ph("square_concrete_pavers", "diff", n)
    hgt = ph("square_concrete_pavers", "disp", n)
    rough = ph("square_concrete_pavers", "rough", n)
    nrm0 = ph("square_concrete_pavers", "nor_gl", n)
    l = lum(a); l = l / l.mean()
    hb = blur(hgt, 1.5)
    j = (hb < np.percentile(hb, 12)).astype(np.uint8)
    tops = cv2.erode((hb > np.percentile(hb, 50)).astype(np.uint8), np.ones((5, 5), np.uint8))
    nm, markers = cv2.connectedComponents(tops, connectivity=4)
    markers = markers.astype(np.int32); markers[j > 0] = 0
    lab = cv2.watershed(np.dstack([(np.clip(1 - hb, 0, 1) * 255).astype(np.uint8)] * 3), markers.copy())
    lab[lab < 0] = 0
    r = np.random.default_rng(8)
    jit = r.normal(0, 0.06, lab.max() + 1)[lab]
    grey = hex2rgb("#8f8e8a")
    alb = grey * (0.5 + 0.5 * l)[..., None] * (1 + jit)[..., None]
    # red band: rows of pavers whose centroid falls in a horizontal strip
    yy = np.mgrid[0:n, 0:n][0].astype(np.float32)
    cent = np.zeros(lab.max() + 1, np.float32)
    cnt = np.bincount(lab.ravel(), minlength=lab.max() + 1).astype(np.float32)
    cent = np.bincount(lab.ravel(), weights=yy.ravel(), minlength=lab.max() + 1) / np.maximum(cnt, 1)
    yy2 = np.mgrid[0:n, 0:n][0]
    band = ((yy2 >= n // 3) & (yy2 < n // 2)).astype(np.float32)
    band = blur(band, 0.7, wrap=True)
    red = hex2rgb("#8a5047") * (0.55 + 0.45 * l)[..., None] * (1 + jit)[..., None]
    alb = lerp(alb, red, band)
    jm = blur(j.astype(np.float32), 0.8)
    alb = lerp(alb, hex2rgb("#3a342c"), jm * 0.7)
    dust = smoothstep(0.3, 0.8, fbm(n, n, 2.2, seed=81)) * 0.3 + 0.1
    alb = lerp(alb, hex2rgb("#9a948a") * (0.8 + 0.4 * l)[..., None], dust)
    grime = fbm(n, n, 2.3, seed=82)
    alb = alb * (0.8 + 0.3 * grime)[..., None]
    st, gum = stains_layer(n, 83, 0.7)
    alb = alb * (1 - st[..., None] * 0.4)
    alb = lerp(alb, hex2rgb("#262321"), gum * 0.85)
    rr = np.clip(rough * 0.85 + 0.1 - gum * 0.2, 0.25, 1)
    ao = np.clip(1 - jm * 0.5, 0.3, 1)
    save_jpg(saturation(alb, 0.9), f"{OUT_TEX}/sidewalk_tile_grid_grey_redband_albedo.jpg", 88)
    save_jpg(nrm0, f"{OUT_TEX}/sidewalk_tile_grid_grey_redband_normal.jpg", 92)
    save_jpg(np.stack([ao, rr, np.zeros_like(ao)], -1), f"{OUT_TEX}/sidewalk_tile_grid_grey_redband_orm.jpg", 88)
    MAN["sidewalk_tile_grid_grey_redband"] = {
        "purpose": "Common Thai footpath: 30x30 cm grey pressed-concrete tiles with a fine groove grid, "
                   "one row of faded-red tiles as an accent band (runs along U). Pair with "
                   "tactile_strip_yellow.", "size": f"{n}x{n}",
        "alpha": False, "tiling": True, "real_world_m": [1.8, 1.8], "maps": ["albedo", "normal", "orm"],
        "source": "layout+detail from Poly Haven 'square_concrete_pavers' (CC0), recoloured"}
    print("wrote sidewalk_tile_grid_grey_redband")


def tactile_strip():
    """Yellow tactile guide strip, 30 cm wide, tileable along V (2 tiles = 60 cm)."""
    n = N
    W, H = 512, 1024   # 0.3 m x 0.6 m
    y, x = np.mgrid[0:H, 0:W].astype(np.float32) + 0.5
    t = W  # one tile = 512 px = 30 cm
    v = (y % t) / t
    u = x / W
    # 4 raised bars per tile, running along V (directional guide)
    hgt = np.full((H, W), 0.45, np.float32)
    bars = np.zeros((H, W), np.float32)
    for cxu in (0.17, 0.39, 0.61, 0.83):
        dx = np.abs(u - cxu) * t
        dy = np.maximum(np.abs(v - 0.5) * t - 0.40 * t, 0)
        dd = np.sqrt(np.maximum(dx - 0.035 * t, 0) ** 2 + dy ** 2)
        bars = np.maximum(bars, 1 - smoothstep(0, 6, dd))
    hgt += bars * 0.25
    jm = 1 - smoothstep(1.5, 3.0, np.minimum(np.minimum(u, 1 - u) * W, np.minimum(v, 1 - v) * t))
    hgt -= jm * 0.25
    a0 = ph("brushed_concrete", "diff", 1024)[:H, :W]
    det = lum(a0) / lum(a0).mean()
    base = hex2rgb("#c9a43a")
    alb = base * (0.6 + 0.4 * det)[..., None]
    gr = fbm(H, W, 2.4, seed=8)
    gr2 = np.tile(fbm(512, 512, 2.0, seed=9), (2, 1))
    alb = alb * (0.75 + 0.35 * gr)[..., None]
    # dirt around bar bases & joints, worn paint on bar tops
    edge = blur(bars, 4) - bars
    alb = lerp(alb, hex2rgb("#3b352c"), np.clip(edge * 2.5 + jm, 0, 1))
    worn = smoothstep(0.55, 0.75, gr2) * bars
    alb = lerp(alb, hex2rgb("#8d877c"), worn * 0.6)
    st, gum = stains_layer(512, 77, 0.6)
    st = np.tile(st, (2, 1)); gum = np.tile(gum, (2, 1))
    alb = alb * (1 - st[..., None] * 0.4)
    alb = lerp(alb, hex2rgb("#2a2724"), gum * 0.8)
    rough = np.clip(0.7 + gr * 0.2 + jm * 0.1 - bars * 0.1, 0, 1)
    ao = np.clip(1 - jm * 0.5 - np.clip(edge, 0, 1) * 0.6, 0.3, 1)
    nrm = height_to_normal(hgt, 7)
    save_jpg(alb, f"{OUT_TEX}/tactile_strip_yellow_albedo.jpg", 88)
    save_jpg(nrm, f"{OUT_TEX}/tactile_strip_yellow_normal.jpg", 92)
    save_jpg(np.stack([ao, rough, np.zeros_like(ao)], -1), f"{OUT_TEX}/tactile_strip_yellow_orm.jpg", 88)
    MAN["tactile_strip_yellow"] = {"purpose": "Yellow tactile guide paving strip with raised bars; "
                                   "lay along the footpath, tiles along V.", "size": "512x1024",
                                   "alpha": False, "tiling": "V only (U = strip width)",
                                   "real_world_m": [0.3, 0.6], "maps": ["albedo", "normal", "orm"]}
    print("wrote tactile_strip_yellow")


def pav_interlock():
    """Dog-bone 'I' interlocking pavers (ตัวหนอน), grey + faded red mix, from CC0 scan layout."""
    n = N
    a = ph("concrete_pavers", "diff", n)
    hgt = ph("concrete_pavers", "disp", n)
    rough = ph("concrete_pavers", "rough", n)
    nrm0 = ph("concrete_pavers", "nor_gl", n)
    # identify individual pavers by joint mask -> label them, recolour a random subset red
    import cv2
    j = (hgt < np.percentile(hgt, 14)).astype(np.uint8)
    # watershed: paver tops as markers, so every paver gets its own label
    hb = blur(hgt, 2)
    tops = (hb > np.percentile(hb, 55)).astype(np.uint8)
    tops = cv2.erode(tops, np.ones((7, 7), np.uint8))
    nm, markers = cv2.connectedComponents(tops, connectivity=4)
    img8 = np.dstack([(np.clip(1 - hb, 0, 1) * 255).astype(np.uint8)] * 3)
    markers = markers.astype(np.int32)
    markers[j > 0] = 0
    lab = cv2.watershed(img8, markers.copy())
    lab[lab < 0] = 0
    lab_n = lab.max() + 1
    r = np.random.default_rng(3)
    choice = r.random(lab_n)
    l = lum(a)
    l = l / l.mean()
    grey = hex2rgb("#8f8b85")
    red = hex2rgb("#8c4f45")
    sel = (choice[lab] < 0.33).astype(np.float32)
    jit = (r.normal(0, 0.05, lab_n))[lab]
    col = lerp(np.broadcast_to(grey, a.shape), np.broadcast_to(red, a.shape), sel)
    alb = col * (0.55 + 0.45 * l)[..., None] * (1 + jit)[..., None]
    jm = blur(j.astype(np.float32), 1.0)
    alb = lerp(alb, hex2rgb("#3a332b"), jm * 0.75)
    dust = smoothstep(0.3, 0.8, fbm(n, n, 2.2, seed=55)) * 0.3 + 0.1
    alb = lerp(alb, hex2rgb("#9b9286") * (0.8 + 0.4 * l)[..., None], dust)
    grime = fbm(n, n, 2.3, seed=5)
    alb = alb * (0.78 + 0.34 * grime)[..., None]
    st, gum = stains_layer(n, 51, 0.6)
    alb = alb * (1 - st[..., None] * 0.35)
    alb = lerp(alb, hex2rgb("#262321"), gum * 0.85)
    # weeds/moss in some joints
    moss = smoothstep(0.6, 0.8, fbm(n, n, 2.2, seed=6)) * jm
    alb = lerp(alb, hex2rgb("#3f4a22"), moss * 0.7)
    oil = smoothstep(0.78, 0.95, fbm(n, n, 2.8, seed=61))
    alb = alb * (1 - oil[..., None] * 0.25)
    hh = hgt * 0.5 + gum * 0.02
    nrm = blend_normals(nrm0, height_to_normal(fbm(n, n, 1.2, seed=7) * 0.02, 4))
    rr = np.clip(rough * 0.9 + 0.08 - oil * 0.25 - gum * 0.2, 0.2, 1)
    ao = np.clip(1 - jm * 0.5, 0.3, 1)
    save_jpg(saturation(alb, 0.9), f"{OUT_TEX}/paver_interlock_I_albedo.jpg", 88)
    save_jpg(nrm, f"{OUT_TEX}/paver_interlock_I_normal.jpg", 92)
    save_jpg(np.stack([ao, rr, np.zeros_like(ao)], -1), f"{OUT_TEX}/paver_interlock_I_orm.jpg", 88)
    MAN["paver_interlock_I"] = {"purpose": "Interlocking dog-bone ('ตัวหนอน') concrete pavers, grey with "
                                "random faded-red ones: shop forecourts, soi parking, market lanes, petrol-"
                                "station edges. Oil stains, gum, moss in joints.", "size": f"{n}x{n}",
                                "alpha": False, "tiling": True, "real_world_m": [2.0, 2.0],
                                "maps": ["albedo", "normal", "orm"],
                                "source": "layout+detail from Poly Haven 'concrete_pavers' (CC0), recoloured"}
    print("wrote paver_interlock_I")


def concrete_slab():
    """Broom-finished concrete footpath/soi slab with sawn joints, cracks, patches."""
    n = N
    a0, h0, r0 = base_concrete("concrete_floor_worn_001", 1.0, 3)
    l = lum(a0) / lum(a0).mean()
    base = hex2rgb("#8d8a83")
    alb = base * (0.6 + 0.4 * l)[..., None]
    # broom lines across
    broom = fbm(n, n, 1.0, seed=13)
    broom = blur(broom, 0) * 0.0 + np.tile(np.mean(fbm(n, n, 1.4, seed=14), axis=1, keepdims=True), (1, n))
    alb = alb * (0.92 + 0.12 * broom)[..., None]
    # sawn joints every 1.0 m (texture = 2 m -> one joint in the middle and at edges)
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    dj = np.minimum(np.abs(x - n / 2), np.minimum(x, n - x))
    dj2 = np.minimum(np.abs(y - n / 2), np.minimum(y, n - y))
    jm = np.maximum(1 - smoothstep(1.0, 2.5, dj), 1 - smoothstep(1.0, 2.5, dj2))
    hgt = 0.5 + (h0 - 0.5) * 0.2 - jm * 0.15
    # patched area (newer darker concrete square) + asphalt patch
    patch = np.zeros((n, n), np.float32)
    px0, py0 = int(n * 0.58), int(n * 0.12)
    pw, phh = int(n * 0.28), int(n * 0.22)
    patch[py0:py0 + phh, px0:px0 + pw] = 1
    patch = blur(patch, 1.5)
    alb = lerp(alb, alb * np.array([0.78, 0.8, 0.83]), patch)
    hgt += patch * 0.02
    cr = crack_layer(n, 99, 9)
    alb = alb * (1 - cr[..., None] * 0.65)
    hgt -= cr * 0.05
    st, gum = stains_layer(n, 101, 1.3)
    alb = alb * (1 - st[..., None] * 0.55)
    alb = lerp(alb, hex2rgb("#252220"), gum * 0.85)
    alb = lerp(alb, hex2rgb("#2d2824"), jm * 0.8)
    grime = fbm(n, n, 2.5, seed=15)
    alb = alb * (0.8 + 0.3 * grime)[..., None]
    rough = np.clip(0.88 + (r0 - r0.mean()) * 0.4 - st * 0.15 - gum * 0.2, 0.3, 1)
    ao = np.clip(1 - jm * 0.4 - cr * 0.3, 0.3, 1)
    write_material("concrete_slab_footpath", saturation(alb, 0.9), hgt, rough, ao, nstrength=6, meta={
        "purpose": "Plain broom-finished concrete slab (provincial footpath, soi surface, shop forecourt, "
                   "market floor) with sawn joints every 1 m, cracks, a patch, stains, gum.",
        "size": f"{n}x{n}", "alpha": False, "tiling": True, "real_world_m": [2.0, 2.0],
        "maps": ["albedo", "normal", "orm"]})


def save_manifest_part():
    p = os.path.join(RAW, "manifest_ground.json")
    old = {}
    if os.path.exists(p):
        old = json.load(open(p))
    old.update(MAN)
    json.dump(old, open(p, "w"), ensure_ascii=False, indent=1)


JOBS = {"circles": pav_circles, "redhex": pav_red_hex, "wave": pav_wave, "setts": pav_small_grey,
        "tactile": tactile_strip, "interlock": pav_interlock, "slab": concrete_slab}

if __name__ == "__main__":
    names = sys.argv[1:] or list(JOBS)
    for nm in names:
        JOBS[nm]()
    save_manifest_part()
