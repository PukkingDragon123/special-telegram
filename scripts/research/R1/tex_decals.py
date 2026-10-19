"""R1-streets: ground decals (manholes, drain covers, grates, puddles, oil, patches,
potholes, gum, litter).  All procedural / composited from CC0 scans.

usage: python3 -I tex_decals.py [job ...]
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texlib import *  # noqa

MAN = {}


def rgba_save(name, rgb, a, meta, normal=None, rough=None):
    save_png(np.dstack([np.clip(rgb, 0, 1), np.clip(a, 0, 1)]), f"{OUT_TEX}/{name}.png")
    maps = ["rgba"]
    if normal is not None:
        save_jpg(normal, f"{OUT_TEX}/{name}_normal.jpg", 92); maps.append("normal")
    if rough is not None:
        save_jpg(np.dstack([rough] * 3) if rough.ndim == 2 else rough, f"{OUT_TEX}/{name}_rough.jpg", 88)
        maps.append("rough")
    meta = dict(meta); meta["maps"] = maps; meta.setdefault("alpha", True)
    MAN[name] = meta
    print("wrote", name)


def radial(n):
    y, x = np.mgrid[0:n, 0:n].astype(np.float32) + 0.5
    cx = cy = n / 2
    dx, dy = x - cx, y - cy
    return np.sqrt(dx * dx + dy * dy), np.arctan2(dy, dx), x, y


# ------------------------------------------------------------------ manholes
def manhole(name, ring_text, centre_text, symbol=None, seed=0):
    n = 1024
    real = 0.85                       # texture spans 0.85 m; cover dia 0.62 m, frame to 0.72 m
    ppm = n / real
    r, ang, x, y = radial(n)
    R_cov, R_frame, R_patch = 0.31 * ppm, 0.36 * ppm, 0.415 * ppm
    cover = (r < R_cov).astype(np.float32)
    frame = ((r >= R_cov + 3) & (r < R_frame)).astype(np.float32)
    gap = ((r >= R_cov) & (r < R_cov + 3)).astype(np.float32)
    hgt = np.zeros((n, n), np.float32)
    # stud pattern: square grid of raised diamonds, clipped to cover; plain bands for text
    g = 0.04 * ppm
    u = (x % g) / g - 0.5
    v = (y % g) / g - 0.5
    stud = 1 - smoothstep(0.22, 0.3, np.abs(u) + np.abs(v))
    band = ((r > 0.205 * ppm) & (r < 0.275 * ppm)).astype(np.float32)    # ring text band
    centre = (r < 0.11 * ppm).astype(np.float32)
    hgt += stud * cover * (1 - band) * (1 - centre) * 0.5
    # raised rims
    for rr in (0.205, 0.275, 0.11, 0.3):
        hgt += (1 - smoothstep(2, 4, np.abs(r - rr * ppm))) * cover * 0.6
    # ring text: render shaped Thai text on a strip, then wrap it into the band (polar remap)
    import cv2
    R_in, R_out = 0.212 * ppm, 0.268 * ppm
    circ = int(2 * math.pi * (R_in + R_out) / 2)
    bandh = int(R_out - R_in)
    strip = Image.new("L", (circ, bandh), 0)
    fs = int(bandh * 0.78)
    f = font("Kanit-SemiBold.ttf" if os.path.exists(os.path.join(FONTS, "Kanit-SemiBold.ttf")) else "Kanit-Bold.ttf", fs)
    tmk = text_mask(ring_text, f, 0, pad=2)
    reps = max(1, circ // max(tmk.width, 1))
    sx = (circ - reps * tmk.width) // max(reps, 1)
    for k in range(reps):
        strip.paste(tmk.resize((tmk.width, min(tmk.height, bandh))), (k * (tmk.width + sx), max(0, (bandh - tmk.height) // 2)))
    st = np.asarray(strip).astype(np.float32) / 255
    th = (ang + math.pi / 2) % (2 * math.pi)
    mapx = (th / (2 * math.pi) * circ).astype(np.float32)
    mapy = ((R_out - r) / (R_out - R_in) * bandh).astype(np.float32)
    tmask = cv2.remap(st, mapx, mapy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    tmask *= ((r > R_in) & (r < R_out))
    # centre text
    cm2 = text_mask(centre_text, font("Kanit-Bold.ttf", int(0.05 * ppm)), 0, pad=4)
    cimg = Image.new("L", (n, n), 0)
    cimg.paste(cm2, (n // 2 - cm2.width // 2, n // 2 - cm2.height // 2))
    tmask = np.maximum(tmask, np.asarray(cimg).astype(np.float32) / 255)
    if symbol == "bolt":
        bolt = Image.new("L", (n, n), 0)
        d = ImageDraw.Draw(bolt)
        s = 0.06 * ppm
        cxy = (n / 2, n / 2 - 0.16 * ppm)
        pts = [(0.1, -1), (-0.5, 0.15), (-0.05, 0.15), (-0.2, 1), (0.5, -0.2), (0.05, -0.2), (0.3, -1)]
        d.polygon([(cxy[0] + px * s, cxy[1] + py * s) for px, py in pts], fill=255)
        tmask = np.maximum(tmask, np.asarray(bolt).astype(np.float32) / 255)
        hgt *= 1 - (np.asarray(bolt) > 0) * 0.0
    hgt += tmask * cover * 0.7
    hgt = blur(hgt, 0.8, wrap=False)
    hgt += frame * 0.35 + (fbm(n, n, 1.4, seed=seed) - 0.5) * 0.06
    hgt -= gap * 0.6
    # materials
    iron = hex2rgb("#3b3936")
    rust = hex2rgb("#5c3b26")
    polish = hex2rgb("#77736c")
    n1 = fbm(n, n, 2.0, seed=seed + 1)
    recess = smoothstep(0.35, 0.05, hgt)          # low areas collect rust/dirt
    alb = iron * (0.85 + 0.3 * n1)[..., None]
    alb = lerp(alb, rust * (0.8 + 0.4 * n1)[..., None], np.clip(recess * 0.45 + smoothstep(0.65, 0.9, n1) * 0.3, 0, 1) * cover)
    top = smoothstep(0.35, 0.6, hgt)
    alb = lerp(alb, polish, top * cover * 0.65)        # traffic-polished raised studs/letters
    alb = lerp(alb, hex2rgb("#2a2826"), gap)
    # frame: rusty steel ring with dirt
    alb = lerp(alb, lerp(iron, rust, 0.15 + 0.35 * n1[..., None]) * 0.9, frame)
    # asphalt seam/patch ring around the frame
    asp = ph("asphalt_02", "diff", n)
    la = lum(asp) / lum(asp).mean()
    ring = ((r >= R_frame) & (r < R_patch)).astype(np.float32)
    alb = lerp(alb, hex2rgb("#2e2c29") * (0.6 + 0.4 * la)[..., None], ring)
    hgt -= ring * 0.05
    a = 1 - smoothstep(R_patch - 12, R_patch, r + (fbm(n, n, 3.2, seed=seed + 3) - 0.5) * 30)
    # dirt film & grime
    alb = alb * (0.8 + 0.3 * fbm(n, n, 2.4, seed=seed + 4))[..., None]
    sand = smoothstep(0.62, 0.85, fbm(n, n, 1.8, seed=seed + 5)) * recess * cover
    alb = lerp(alb, hex2rgb("#7a6e5c"), sand * 0.5)
    rough = np.clip(0.75 - top * cover * 0.35 + ring * 0.15, 0.2, 1)
    metal = (cover + frame) * (0.25 + top * 0.5) * (1 - sand)
    nrm = height_to_normal(hgt, 3.0, wrap=False)
    out = Image.fromarray((np.dstack([np.clip(alb, 0, 1), a]) * 255).astype(np.uint8), "RGBA").resize((512, 512), Image.LANCZOS)
    out.save(f"{OUT_TEX}/{name}.png", optimize=True)
    save_jpg(np.asarray(Image.fromarray((nrm * 255).astype(np.uint8)).resize((512, 512), Image.LANCZOS)) / 255.0,
             f"{OUT_TEX}/{name}_normal.jpg", 92)
    orm = np.dstack([np.clip(1 - recess * 0.4 - gap, 0.2, 1), rough, np.clip(metal, 0, 1)])
    save_jpg(np.asarray(Image.fromarray((orm * 255).astype(np.uint8)).resize((512, 512), Image.LANCZOS)) / 255.0,
             f"{OUT_TEX}/{name}_orm.jpg", 88)
    print("wrote", name)
    return real


def manholes():
    real = manhole("manhole_round_drain", "ท่อระบายน้ำ • ห้ามทิ้งขยะ • ท่อระบายน้ำ • ห้ามทิ้งขยะ • ",
                   "ระบายน้ำ", seed=3)
    MAN["manhole_round_drain"] = {"purpose": "Round cast-iron drain manhole in road/footpath (generic, embossed "
                                  "'ท่อระบายน้ำ • ห้ามทิ้งขยะ'), diamond studs, traffic-polished tops, rust in "
                                  "recesses, asphalt seam ring (alpha fades out at the ring).",
                                  "size": "512x512", "alpha": True, "tiling": False,
                                  "real_world_m": [real, real], "maps": ["rgba", "normal", "orm"]}
    real = manhole("manhole_round_electric", "ไฟฟ้าแรงสูง • อันตราย • ไฟฟ้าแรงสูง • อันตราย • ",
                   "ไฟฟ้า", symbol="bolt", seed=7)
    MAN["manhole_round_electric"] = {"purpose": "Round cast-iron utility manhole for underground power cable "
                                     "('ไฟฟ้าแรงสูง • อันตราย' + bolt; generic, no agency logo).",
                                     "size": "512x512", "alpha": True, "tiling": False,
                                     "real_world_m": [real, real], "maps": ["rgba", "normal", "orm"]}


def drain_cover_concrete():
    """Precast concrete footpath drain cover with rows of holes and a rusty steel angle frame."""
    n = 1024
    real = 0.6
    ppm = n / real
    y, x = np.mgrid[0:n, 0:n].astype(np.float32) + 0.5
    fr = 0.03 * ppm
    edge_d = np.minimum(np.minimum(x, n - x), np.minimum(y, n - y))
    frame = (edge_d < fr).astype(np.float32)
    a0, h0, r0 = None, None, None
    c = ph("concrete_floor_worn_001", "diff", n)
    hc = ph("concrete_floor_worn_001", "disp", n)
    l = lum(c) / lum(c).mean()
    alb = hex2rgb("#8a867e") * (0.6 + 0.4 * l)[..., None]
    hgt = 0.5 + (hc - 0.5) * 0.2
    # holes: 5 rows x 7, 28 mm diameter
    holes = np.zeros((n, n), np.float32)
    rows, cols = 6, 6
    for i in range(rows):
        for j in range(cols):
            cx = (0.13 + j * (0.74 / (cols - 1))) * n
            cy = (0.13 + i * (0.74 / (rows - 1))) * n
            d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)
            holes = np.maximum(holes, 1 - smoothstep(0.016 * ppm, 0.016 * ppm + 2, d))
    rim = np.clip(blur(holes, 6, wrap=False) - holes, 0, 1)
    # broken corner
    rr = np.sqrt((x - n * 0.9) ** 2 + (y - n * 0.12) ** 2) + (fbm(n, n, 2.0, seed=3) - 0.5) * 60
    broken = (1 - smoothstep(0.1 * n, 0.105 * n, rr)) * (1 - frame)
    hgt -= holes * 0.8 + broken * 0.25
    alb = lerp(alb, hex2rgb("#0d0c0b"), holes)
    alb = lerp(alb, hex2rgb("#3a342d"), np.clip(rim * 1.6, 0, 1) * 0.7)
    alb = lerp(alb, hex2rgb("#5a5047") * (0.6 + 0.4 * l)[..., None], broken)
    iron = lerp(hex2rgb("#3d3530"), hex2rgb("#6a4630"), fbm(n, n, 1.6, seed=5))
    alb = lerp(alb, iron * (0.7 + 0.4 * l)[..., None], frame)
    hgt += frame * 0.05
    gap = (np.abs(edge_d - fr) < 2.0).astype(np.float32)
    alb = lerp(alb, hex2rgb("#1e1c1a"), gap)
    st, gum = (smoothstep(0.6, 0.9, fbm(n, n, 2.5, seed=8)), None)
    clog = holes * smoothstep(0.55, 0.7, fbm(n, n, 2.6, seed=11))
    alb = lerp(alb, hex2rgb("#4a3f30") * (0.7 + 0.5 * fbm(n, n, 1.0, seed=12))[..., None], clog)
    film = 0.2 + 0.3 * smoothstep(0.3, 0.9, fbm(n, n, 2.2, seed=13))
    alb = lerp(alb, hex2rgb("#6a6156") * (0.7 + 0.3 * l)[..., None], film * (1 - holes))
    alb = alb * (1 - st[..., None] * 0.35)
    alb = alb * (0.8 + 0.3 * fbm(n, n, 2.3, seed=9))[..., None]
    rough = np.clip(0.85 - frame * 0.25, 0, 1)
    ao = np.clip(1 - rim * 0.6 - holes - gap * 0.5, 0.05, 1)
    metal = frame * 0.5
    nrm = height_to_normal(hgt, 5, wrap=False)
    for arr, nm, q in ((alb, "albedo", 88), (nrm, "normal", 92), (np.dstack([ao, rough, metal]), "orm", 88)):
        img = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8)).resize((512, 512), Image.LANCZOS)
        img.save(f"{OUT_TEX}/drain_cover_concrete_holes_{nm}.jpg", quality=q)
    MAN["drain_cover_concrete_holes"] = {"purpose": "Precast concrete footpath drain cover (ฝาท่อระบายน้ำ คสล.) with "
                                         "6x6 holes, rusty steel angle frame, one broken corner. Drop into the "
                                         "footpath every 6-10 m over the drain line.", "size": "512x512",
                                         "alpha": False, "tiling": False, "real_world_m": [0.6, 0.6],
                                         "maps": ["albedo", "normal", "orm"]}
    print("wrote drain cover")


def trench_grate():
    """Steel bar trench grate at the kerb (ref 3a05f646): 1.0 x 0.3 m, tiles along U."""
    W, H = 1024, 320
    ppm = W / 1.0
    y, x = np.mgrid[0:H, 0:W].astype(np.float32) + 0.5
    pitch = 0.033 * ppm
    bar_w = 0.008 * ppm
    xb = x % pitch
    bars = 1 - smoothstep(bar_w / 2, bar_w / 2 + 1.2, np.abs(xb - pitch / 2))
    cross = np.zeros_like(x)
    for cyf in (0.33, 0.66):
        cross = np.maximum(cross, 1 - smoothstep(2.5, 4, np.abs(y - cyf * H)))
    border = (np.minimum(y, H - y) < 0.025 * ppm).astype(np.float32)
    steel = np.clip(bars + cross * 0.9 + border, 0, 1)
    # void underneath: dark, with litter and muddy water glints
    void = hex2rgb("#0c0b0a") * (0.6 + 0.8 * fbm(H, W, 2.0, seed=2))[..., None]
    lit = smoothstep(0.72, 0.85, fbm(H, W, 1.6, seed=3))
    void = lerp(void, hex2rgb("#5a5246"), lit * 0.5)
    rust = lerp(hex2rgb("#2b2522"), hex2rgb("#6b4128"), smoothstep(0.4, 0.8, fbm(H, W, 1.5, seed=4)))
    alb = lerp(void, rust * (0.85 + 0.3 * fbm(H, W, 1.0, seed=5))[..., None], steel)
    top_polish = bars * smoothstep(0.5, 0.8, fbm(H, W, 2.2, seed=6))
    alb = lerp(alb, hex2rgb("#6c6964"), top_polish * 0.4)
    hgt = steel * 0.8
    nrm = height_to_normal(blur(hgt, 0.6), 4)
    rough = np.clip(0.7 - top_polish * 0.3 + (1 - steel) * 0.2, 0, 1)
    metal = steel * (0.3 + top_polish * 0.5)
    ao = np.clip(0.25 + steel * 0.75, 0, 1)
    save_jpg(alb, f"{OUT_TEX}/trench_grate_steel_albedo.jpg", 88)
    save_jpg(nrm, f"{OUT_TEX}/trench_grate_steel_normal.jpg", 92)
    save_jpg(np.dstack([ao, rough, metal]), f"{OUT_TEX}/trench_grate_steel_orm.jpg", 88)
    MAN["trench_grate_steel"] = {"purpose": "Steel bar trench/kerb-inlet grate over a dark drain with litter "
                                 "(lay along the gutter or across shop entrances).", "size": "1024x320",
                                 "alpha": False, "tiling": "U only", "real_world_m": [1.0, 0.3125],
                                 "maps": ["albedo", "normal", "orm"]}
    print("wrote trench grate")


# ------------------------------------------------------------------ puddles, oil, patches
def blob_mask(n, cx, cy, rx, ry, seed, rough=0.35, beta=2.0):
    y, x = np.mgrid[0:n, 0:n].astype(np.float32) + 0.5
    nn = 0.92 * fbm(n, n, beta + 1.3, seed=seed) + 0.08 * fbm(n, n, beta + 0.6, seed=seed + 1)
    d = np.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2)
    return d + (nn - 0.5) * rough * 2


def puddles():
    n = 1024
    q = n // 2
    rgb = np.zeros((n, n, 3), np.float32)
    a = np.zeros((n, n), np.float32)
    rough = np.ones((n, n), np.float32)
    specs = [(q * 0.5, q * 0.5, q * 0.42, q * 0.3, 1), (q * 1.5, q * 0.5, q * 0.4, q * 0.38, 2),
             (q * 0.5, q * 1.5, q * 0.46, q * 0.14, 3), (q * 1.5, q * 1.5, q * 0.3, q * 0.25, 4)]
    for cx, cy, rx, ry, sd in specs:
        d = blob_mask(n, cx, cy, rx, ry, sd * 13, 0.22)
        water = 1 - smoothstep(0.85, 0.95, d)
        wet = 1 - smoothstep(0.95, 1.12, d)
        if sd == 4:   # cluster of small puddles
            d2 = blob_mask(n, cx + q * 0.25, cy + q * 0.22, q * 0.12, q * 0.1, 77, 0.25)
            water = np.maximum(water, 1 - smoothstep(0.85, 0.95, d2))
            wet = np.maximum(wet, 1 - smoothstep(0.95, 1.12, d2))
        # only inside its quadrant
        y, x = np.mgrid[0:n, 0:n]
        quad = ((x // q) == int(cx // q)) & ((y // q) == int(cy // q))
        water *= quad; wet *= quad
        wcol = hex2rgb("#24221e") * (0.8 + 0.4 * fbm(n, n, 2.0, seed=sd))[..., None]
        silt = smoothstep(0.75, 0.95, d) * water
        wcol = lerp(wcol, hex2rgb("#4b4237"), silt * 0.6)
        rgb = np.where(quad[..., None], lerp(hex2rgb("#2f2c28") * np.ones_like(rgb), wcol, water), rgb)
        a = np.maximum(a, np.maximum(water * 0.92, wet * 0.45))
        rough = np.minimum(rough, np.where(quad, 1 - water * 0.95 - (wet - water).clip(0) * 0.45, 1))
    rgba_save("decal_puddles", rgb, a, {
        "purpose": "Puddle decal atlas 2x2 (large, round, tyre-rut, small cluster). RGB = muddy water film, "
                   "alpha = water (0.9) + darkened wet rim (0.45). Use with decal_puddles_rough "
                   "(water ~0.05) and a strong env map so puddles mirror the sky/neon.",
        "size": "1024x1024", "tiling": False, "real_world_m": [3.0, 3.0],
        "atlas": "2x2 cells, each 1.5 m"}, rough=np.clip(rough, 0.03, 1))


def oil_stains():
    n = 1024
    q = n // 2
    rgb = np.ones((n, n, 3), np.float32) * hex2rgb("#151311")
    a = np.zeros((n, n), np.float32)
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    # cell 0: car oil stain (big soft blob with darker core)
    d = blob_mask(n, q * 0.5, q * 0.5, q * 0.35, q * 0.28, 5, 0.4)
    a = np.maximum(a, (1 - smoothstep(0.2, 1.0, d)) * 0.75)
    # cell 1: motorbike drip cluster (many small round drips)
    r = np.random.default_rng(9)
    for _ in range(40):
        cx, cy = r.normal(q * 1.5, q * 0.12), r.normal(q * 0.5, q * 0.1)
        rad = r.uniform(3, 16)
        dd = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)
        a = np.maximum(a, (1 - smoothstep(rad * 0.6, rad, dd)) * r.uniform(0.4, 0.85))
    # cell 2: long drag stain (parking bay)
    d = blob_mask(n, q * 0.5, q * 1.5, q * 0.42, q * 0.12, 15, 0.5)
    a = np.maximum(a, (1 - smoothstep(0.3, 1.0, d)) * 0.6)
    # cell 3: food-stall grease patch with splatters
    d = blob_mask(n, q * 1.5, q * 1.5, q * 0.3, q * 0.3, 25, 0.55, beta=1.6)
    a = np.maximum(a, (1 - smoothstep(0.4, 1.0, d)) * 0.5)
    for _ in range(60):
        cx, cy = r.normal(q * 1.5, q * 0.2), r.normal(q * 1.5, q * 0.2)
        rad = r.uniform(2, 7)
        dd = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)
        a = np.maximum(a, (1 - smoothstep(rad * 0.5, rad, dd)) * 0.55)
    a *= 0.75 + 0.35 * fbm(n, n, 1.5, seed=3)
    rgb = rgb * (0.8 + 0.6 * fbm(n, n, 1.8, seed=4))[..., None]
    rough = 1 - a * 0.55
    rgba_save("decal_oil_stains", rgb, a, {
        "purpose": "Oil / grease stain atlas 2x2: car oil blob, motorbike drip cluster, parking drag stain, "
                   "food-stall grease with splatter. Multiply-dark with slightly lower roughness.",
        "size": "1024x1024", "tiling": False, "real_world_m": [2.4, 2.4], "atlas": "2x2 cells, 1.2 m each"},
        rough=rough)


def asphalt_patches():
    """2x2 atlas: saw-cut patch, lumpy blob patch, dry pothole, wet pothole (with normal)."""
    n = 1024
    q = n // 2
    asp_new = ph("asphalt_02", "diff", n)
    asp_old = ph("worn_asphalt", "diff", n)
    ln = lum(asp_new) / lum(asp_new).mean()
    lo = lum(asp_old) / lum(asp_old).mean()
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    rgb = np.zeros((n, n, 3), np.float32)
    a = np.zeros((n, n), np.float32)
    hgt = np.zeros((n, n), np.float32)
    # 0 saw-cut rectangle
    m0 = ((np.abs(x - q * 0.5) < q * 0.38) & (np.abs(y - q * 0.5) < q * 0.28)).astype(np.float32)
    m0 = blur(m0, 1.0, wrap=False)
    rgb += m0[..., None] * hex2rgb("#2f2d2a") * (0.6 + 0.4 * ln)[..., None]
    a = np.maximum(a, m0 * 0.95)
    hgt += m0 * 0.05
    # 1 lumpy blob patch (cold-mix shovelled in)
    d = blob_mask(n, q * 1.5, q * 0.5, q * 0.36, q * 0.3, 31, 0.35)
    m1 = 1 - smoothstep(0.92, 1.0, d)
    lump = fbm(n, n, 2.2, seed=32)
    rgb += (m1 * (1 - m0))[..., None] * hex2rgb("#2b2927") * (0.55 + 0.45 * ln)[..., None] * (0.9 + 0.2 * lump)[..., None]
    a = np.maximum(a, m1 * 0.95)
    hgt += m1 * (0.08 + lump * 0.1)
    # 2/3 potholes
    for cx, cy, sd, wet in ((q * 0.5, q * 1.5, 41, False), (q * 1.5, q * 1.5, 51, True)):
        d = blob_mask(n, cx, cy, q * 0.33, q * 0.26, sd, 0.5, beta=1.8)
        hole = 1 - smoothstep(0.85, 0.95, d)
        rim = (1 - smoothstep(0.95, 1.25, d)) * (1 - hole)
        depth = np.clip(1 - d, 0, 1)
        gravel = fbm(n, n, 0.8, seed=sd + 1)
        hc = lerp(hex2rgb("#3d3832") * np.ones((n, n, 3)), hex2rgb("#7b705f") * np.ones((n, n, 3)),
                  smoothstep(0.5, 0.8, gravel))
        hc = hc * (0.5 + 0.5 * (1 - depth))[..., None]
        if wet:
            water = 1 - smoothstep(0.5, 0.62, d + (fbm(n, n, 2.0, seed=sd + 2) - 0.5) * 0.2)
            hc = lerp(hc, hex2rgb("#1d1c19"), water * 0.9)
        rimc = hex2rgb("#353331") * (0.6 + 0.4 * lo)[..., None]
        rgb += hole[..., None] * hc + rim[..., None] * rimc
        a = np.maximum(a, np.maximum(hole, rim * 0.85))
        hgt += -depth * hole * 0.6 + rim * (fbm(n, n, 1.4, seed=sd + 3) - 0.5) * 0.2 - rim * 0.05
        hgt += hole * (gravel - 0.5) * 0.15
    nrm = height_to_normal(blur(hgt, 1.0, wrap=False), 6, wrap=False)
    rough = np.clip(0.85 - a * 0.05, 0, 1)
    # water in wet pothole
    d = blob_mask(n, q * 1.5, q * 1.5, q * 0.33, q * 0.26, 51, 0.5, beta=1.8)
    water = 1 - smoothstep(0.5, 0.62, d + (fbm(n, n, 2.0, seed=53) - 0.5) * 0.2)
    rough = np.where(water > 0.5, 0.05, rough)
    rgba_save("decal_asphalt_patches", rgb, a, {
        "purpose": "Road damage atlas 2x2: saw-cut repair patch, lumpy cold-mix patch, dry pothole with gravel, "
                   "wet pothole with muddy water. Use the normal map for depth (potholes ~5-8 cm).",
        "size": "1024x1024", "tiling": False, "real_world_m": [3.0, 3.0], "atlas": "2x2 cells, 1.5 m each"},
        normal=nrm, rough=rough)


def gum_spots():
    n = 512
    rgb = np.zeros((n, n, 3), np.float32)
    a = np.zeros((n, n), np.float32)
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    r = np.random.default_rng(4)
    cells = 6
    c = n / cells
    for i in range(cells):
        for j in range(cells):
            cx, cy = (j + 0.5) * c + r.normal(0, 4), (i + 0.5) * c + r.normal(0, 4)
            rx, ry = r.uniform(0.12, 0.33) * c, r.uniform(0.1, 0.3) * c
            d = blob_mask(n, cx, cy, rx, ry, int(r.integers(1, 9999)), 0.25, beta=2.2)
            m = 1 - smoothstep(0.8, 1.0, d)
            tone = r.choice([0.13, 0.18, 0.25, 0.32, 0.4])
            col = np.array([tone, tone * 0.97, tone * 0.93], np.float32)
            ring = smoothstep(0.55, 0.95, d) * m
            rgb += m[..., None] * col * (0.85 + 0.3 * ring)[..., None]
            a = np.maximum(a, m * r.uniform(0.75, 0.95))
    rgb = rgb * (0.85 + 0.3 * fbm(n, n, 1.2, seed=6))[..., None]
    rgba_save("decal_gum_spots", rgb, a, {
        "purpose": "Flattened chewing-gum spots atlas (6x6 = 36 spots) for footpaths near shops & bus stops.",
        "size": "512x512", "tiling": False, "real_world_m": [0.6, 0.6], "atlas": "6x6 cells, 10 cm each"})


def save_manifest_part():
    p = os.path.join(RAW, "manifest_decals.json")
    old = json.load(open(p)) if os.path.exists(p) else {}
    old.update(MAN)
    json.dump(old, open(p, "w"), ensure_ascii=False, indent=1)


JOBS = {"manholes": manholes, "drain": drain_cover_concrete, "grate": trench_grate, "puddles": puddles,
        "oil": oil_stains, "patches": asphalt_patches, "gum": gum_spots}

if __name__ == "__main__":
    for nm in (sys.argv[1:] or list(JOBS)):
        JOBS[nm]()
    save_manifest_part()
