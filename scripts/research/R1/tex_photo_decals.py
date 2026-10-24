"""R1-streets: ground / wall decals cut from REAL photos (client rule: no hand-made art).

usage: python3 -I tex_photo_decals.py [job ...]
Sources: references/streets/_raw/full/<id>.jpg (see credits/R1-streets.md for URLs).
"""
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from photodecal import *  # noqa

OUT = "/home/user/special-telegram/public/assets/textures/world"
RAW = "/home/user/special-telegram/references/streets/_raw"
MAN = {}


def src(cid):
    return load_any(cid)[0][..., :3]


def crop(a, x0, y0, x1, y1):
    return a[y0:y1, x0:x1]


def rs(a, w, h):
    interp = cv2.INTER_AREA if w * h < a.shape[0] * a.shape[1] else cv2.INTER_CUBIC
    return cv2.resize(a, (w, h), interpolation=interp)


def meta(name, purpose, size, alpha, tiling, real, sources, maps, **kw):
    m = {"purpose": purpose, "size": size, "alpha": alpha, "tiling": tiling, "real_world_m": real,
         "maps": maps, "source_ids": sources}
    m.update(kw)
    MAN[name] = m


def write_tile(name, rgb, hgt=None, rough=None, metal=None, nstr=3.0, wrap=False, q=88):
    if hgt is None:
        hgt = height_from_lum(rgb, 3)
    if rough is None:
        rough = np.clip(0.85 - (lum(rgb) - 0.4) * 0.3, 0.3, 1)
    if metal is None:
        metal = np.zeros_like(rough)
    ao = np.clip(0.55 + hgt * 0.6, 0.3, 1)
    save_rgb(rgb, f"{OUT}/{name}_albedo.jpg", q)
    save_rgb(normal_from_height(hgt, nstr, wrap), f"{OUT}/{name}_normal.jpg", 92)
    save_rgb(np.dstack([ao, rough, metal]), f"{OUT}/{name}_orm.jpg", 88)


# ------------------------------------------------------------------ manholes / covers
def manholes():
    # square BMA cast-iron cover with fish relief, in its concrete surround (Bangkok footpath)
    a = src("32b70427_1920")
    c = even_light(crop(a, 190, 95, 990, 765), 0.35, 0.5)
    c = rs(c, 1024, 858)
    iron = np.zeros(c.shape[:2], np.float32)
    s = 1024 / 800
    x0, y0, x1, y1 = int((365 - 190) * s), int((146 - 95) * s), int((954 - 190) * s), int((695 - 95) * s)
    iron[y0:y1, x0:x1] = 1
    iron = feather(iron, 2)
    rough = np.clip(0.8 - iron * 0.25 - (lum(c) - 0.35) * iron * 0.5, 0.25, 1)
    write_tile("manhole_square_bma", c, rough=rough, metal=iron * 0.55, nstr=4)
    meta("manhole_square_bma", "Real Bangkok (BMA) square cast-iron footpath manhole with fish relief, in its "
         "concrete surround; drop-in footpath tile (photo, top-down, lighting evened).", "1024x858", False,
         False, [0.80, 0.67], ["32b70427"], ["albedo", "normal", "orm"])
    # double Pattaya cover
    a = src("2faac9e7_1920")
    c = even_light(crop(a, 111, 149, 1894, 2377), 0.35, 0.5)
    c = rs(c, 818, 1024)
    write_tile("manhole_double_drain_cover", c, nstr=4,
               metal=np.clip((0.45 - lum(c)) * 2, 0, 0.5))
    meta("manhole_double_drain_cover", "Real double cast-iron drain cover (Pattaya City, fish relief, drain "
         "slots) in concrete surround - kerbside drain inlet / footpath.", "818x1024", False, False,
         [0.80, 1.00], ["2faac9e7"], ["albedo", "normal", "orm"])
    # round star-pattern cover with alpha
    a = src("77e86905")
    cx, cy, r = 372, 382, 352
    c = crop(a, cx - r - 10, cy - r - 10, cx + r + 10, cy + r + 10)
    c = rs(c, 512, 512)
    h, w = c.shape[:2]
    m = ellipse_mask(h, w, w / 2, h / 2, w / 2 - 4, h / 2 - 4, noise=0.0, soft=0.02)
    save_rgba(decontaminate(np.dstack([c, m])), f"{OUT}/manhole_round_iron.png")
    hgt = height_from_lum(c, 2)
    save_rgb(normal_from_height(hgt, 4, False), f"{OUT}/manhole_round_iron_normal.jpg", 92)
    meta("manhole_round_iron", "Real round cast-iron manhole cover (diamond studs, lifting slots), top-down "
         "photo, circular alpha. Diameter ~0.75 m incl. frame.", "512x512", True, False, [0.76, 0.76],
         ["77e86905"], ["rgba", "normal"])


# ------------------------------------------------------------------ road paint
def yellowness(rgb):
    return np.clip((rgb[..., 0] + rgb[..., 1]) * 0.5 - rgb[..., 2], 0, 1)


def roadpaint():
    a = src("316744e3")                         # 600x600 top-down road, ~3.5 m wide
    # double yellow centre line
    c = crop(a, 258, 0, 342, 600)
    y = yellowness(c)
    al = smoothstep(0.10, 0.28, y)
    c2 = seamless_y(np.dstack([c, al]), 0.2)
    c2 = rs(c2, 128, 1024)
    c2[..., :3] = np.clip(c2[..., :3] * 1.05, 0, 1)
    save_rgba(decontaminate(c2), f"{OUT}/roadline_double_yellow_photo.png")
    meta("roadline_double_yellow_photo", "Double solid yellow centre line cut from a real top-down road photo "
         "(alpha = paint, asphalt removed). Tiles along V.", "128x1024", True, "V only", [0.45, 3.6],
         ["316744e3"], ["rgba"])
    # white edge line
    c = crop(a, 28, 0, 68, 600)
    al = alpha_from_bright(c, 32, 0.08, 0.35)
    c2 = seamless_y(np.dstack([c, al]), 0.2)
    c2 = rs(c2, 64, 1024)
    save_rgba(decontaminate(c2), f"{OUT}/roadline_white_edge_photo.png")
    meta("roadline_white_edge_photo", "Worn white edge line from a real road photo (alpha = paint). Tiles along V.",
         "64x1024", True, "V only", [0.22, 3.6], ["316744e3"], ["rgba"])
    # worn zebra crossing
    z = src("9a883694")                          # 1000x750
    al = alpha_from_bright(z, 160, 0.10, 0.40)
    al = cv2.morphologyEx(al, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    rgb = np.clip(z * 0.6 + np.array([0.86, 0.86, 0.84]) * 0.4, 0, 1)
    out = np.dstack([rgb, al])
    save_rgba(decontaminate(out), f"{OUT}/roadmark_zebra_worn_photo.png", size=(1024, 768))
    meta("roadmark_zebra_worn_photo", "Badly worn zebra-crossing bars cut from a real top-down photo (cracked, "
         "patchy paint; alpha = paint). Bars run along X.", "1024x768", True, False, [4.0, 3.0],
         ["9a883694"], ["rgba"])
    # dashed white lane line
    d = src("fcc3f0c6")
    al = alpha_from_bright(d, 64, 0.10, 0.4)
    save_rgba(decontaminate(np.dstack([d, al])), f"{OUT}/roadline_white_dashed_photo.png", size=(512, 512))
    meta("roadline_white_dashed_photo", "White dashed lane line from a real top-down photo (alpha = paint).",
         "512x512", True, False, [3.0, 3.0], ["fcc3f0c6"], ["rgba"])


# ------------------------------------------------------------------ stains, gum, butts
def oil():
    items = []
    for cid in ("2c5d9f55", "6d5a1a71", "a1f43e2a", "80f00dbd"):
        a = src(cid)
        al = alpha_from_dark(a, max(a.shape[:2]) // 3, 0.06, 0.45)
        # fade towards borders so nothing is cut hard
        h, w = al.shape
        al *= ellipse_mask(h, w, w / 2, h / 2, w * 0.52, h * 0.52, noise=0.08, soft=0.25)
        rgb = np.clip(a * 0.55, 0, 1)
        items.append((cid, trim(np.dstack([rgb, al]), 6, 0.03)))
    atlas, uvs = pack_grid(items, 2, 2, 512, pad=8)
    save_rgba(decontaminate(atlas), f"{OUT}/decal_oil_stains_photo.png")
    meta("decal_oil_stains_photo", "Oil / grease stains extracted from real photos of stained concrete "
         "(alpha = darkening). 2x2 atlas; multiply-dark, lower roughness under the stain.", "1024x1024",
         True, False, [2.4, 2.4], [u[0] for u in uvs], ["rgba"], atlas_uv=uvs)


def blob_filter(al, min_area, max_elong, min_fill):
    b = (al > 0.35).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(b, 8)
    keep = np.zeros(n, bool)
    for i in range(1, n):
        w, h, area = st[i, cv2.CC_STAT_WIDTH], st[i, cv2.CC_STAT_HEIGHT], st[i, cv2.CC_STAT_AREA]
        el = max(w, h) / max(1, min(w, h))
        fill = area / max(1, w * h)
        keep[i] = area >= min_area and el <= max_elong and fill >= min_fill and area < 6000
    m = keep[lab].astype(np.float32)
    m = cv2.dilate(m, np.ones((3, 3), np.uint8))
    return al * m


def gum():
    a = src("f7a2a5c7")
    h, w = a.shape[:2]
    c = crop(a, 0, int(h * 0.55), w, h)
    al = alpha_from_dark(c, 120, 0.12, 0.45)
    # remove thin joint lines: opening with a disc keeps blobs only
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    al = cv2.morphologyEx(al, cv2.MORPH_OPEN, k)
    al = blob_filter(al, 30, 2.6, 0.35)
    al = feather(al, 1.0)
    rgb = np.clip(c * 0.7, 0, 1)
    out = np.dstack([rgb, al])
    out = rs(out, 1024, int(1024 * out.shape[0] / out.shape[1]) // 4 * 4)
    save_rgba(decontaminate(out), f"{OUT}/decal_gum_spots_photo.png")
    meta("decal_gum_spots_photo", "Flattened chewing-gum spots extracted from a real pavement photo (joints "
         "removed). Scatter near shop doors, bus stops, 7-Eleven fronts.", f"1024x{out.shape[0]}", True,
         False, [3.0, round(3.0 * out.shape[0] / 1024, 2)], ["f7a2a5c7"], ["rgba"])


def butts():
    a = src("9ffd5db9")
    h, w = a.shape[:2]
    c = crop(a, 0, int(h * 0.36), w, int(h * 0.78))
    hsv = cv2.cvtColor((np.clip(c, 0, 1) * 255).astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)
    sat = hsv[..., 1] / 255
    l = lum(c)
    bg = local_bg(l, 200)
    orange = smoothstep(0.30, 0.55, sat) * smoothstep(0.25, 0.45, l)
    white = smoothstep(0.08, 0.25, l - bg) * (1 - smoothstep(0.25, 0.4, sat))
    al = np.clip(np.maximum(orange, white), 0, 1)
    al = cv2.morphologyEx(al, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    al = feather(al, 0.8)
    out = np.dstack([c, al])
    out = rs(out, 1024, int(1024 * out.shape[0] / out.shape[1]) // 4 * 4)
    save_rgba(decontaminate(out), f"{OUT}/decal_cigarette_butts_photo.png")
    meta("decal_cigarette_butts_photo", "Cigarette butts cut from a real photo of a gutter (alpha = butts). Use "
         "along kerbs, under the win-motosai bench, around shop steps.", f"1024x{out.shape[0]}", True, False,
         [1.6, round(1.6 * out.shape[0] / 1024, 2)], ["9ffd5db9"], ["rgba"])


# ------------------------------------------------------------------ puddles & potholes
def puddles():
    a = src("bb1e10c6")                       # real puddle reflecting clouds, top-down
    c = crop(a, 140, 0, a.shape[1], a.shape[0])
    l = lum(c)
    al = smoothstep(0.36, 0.48, l)
    al = cv2.morphologyEx(al, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31)))
    al = cv2.morphologyEx(al, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))
    b = (al > 0.5).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(b, 8)
    if n > 1:
        big = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
        al = al * (lab == big)
    al = feather(al, 3.0)
    rgb = np.clip(c * 0.35 + np.array([0.07, 0.065, 0.06]) * 0.65, 0, 1)
    out = trim(np.dstack([rgb, al]), 8, 0.02)
    out = rs(out, 1024, int(1024 * out.shape[0] / out.shape[1]) // 4 * 4)
    save_rgba(decontaminate(out), f"{OUT}/decal_puddles_photo.png")
    rough = np.clip(1 - out[..., 3] * 0.96, 0.04, 1)
    save_rgb(np.dstack([rough] * 3), f"{OUT}/decal_puddles_photo_rough.jpg", 90)
    meta("decal_puddles_photo", "Puddle shape extracted from a real top-down photo of a street puddle "
         "(alpha = standing water, RGB = dark muddy water so the renderer's env map / neon supplies the "
         "reflection). Pair with decal_puddles_photo_rough (water ~0.04).", f"1024x{out.shape[0]}", True,
         False, [2.2, round(2.2 * out.shape[0] / 1024, 2)], ["bb1e10c6"], ["rgba", "rough"])


def potholes():
    specs = [("e559b88f", 0.5, 0.52, 0.36, 0.42), ("22d7cbe6", 0.5, 0.55, 0.34, 0.40),
             ("42ce869c", 0.5, 0.5, 0.38, 0.42), ("10f8ad40", 0.5, 0.5, 0.36, 0.4)]
    items = []
    for i, (cid, fx, fy, rx, ry) in enumerate(specs):
        try:
            a = src(cid)
        except Exception:
            continue
        h, w = a.shape[:2]
        m = ellipse_mask(h, w, w * fx, h * fy, w * rx, h * ry, noise=0.12, seed=i, soft=0.35)
        items.append((cid, trim(np.dstack([a, m]), 4, 0.02)))
    atlas, uvs = pack_grid(items, 2, 2, 512, pad=6)
    save_rgba(decontaminate(atlas), f"{OUT}/decal_potholes_photo.png")
    hgt = height_from_lum(atlas[..., :3], 6) * atlas[..., 3]
    save_rgb(normal_from_height(hgt, 4, False), f"{OUT}/decal_potholes_photo_normal.jpg", 92)
    meta("decal_potholes_photo", "Potholes / broken asphalt cut from real photos with soft elliptical alpha "
         "(blend over asphalt). 2x2 atlas, some water-filled.", "1024x1024", True, False, [3.0, 3.0],
         [u[0] for u in uvs], ["rgba", "normal"], atlas_uv=uvs)


# ------------------------------------------------------------------ walls: streaks, moss, posters, flyers
def streaks():
    items = []
    for cid, box in (("711eded1", None), ("18f9f9f9", None), ("3cf395b4", None), ("795a47ea", None)):
        a = src(cid)
        if box:
            a = crop(a, *box)
        al = alpha_from_dark(a, max(a.shape[:2]) // 2, 0.10, 0.55)
        h, w = al.shape
        al *= ellipse_mask(h, w, w / 2, h / 2, w * 0.55, h * 0.56, noise=0.1, soft=0.3)
        rgb = np.clip(a * 0.6, 0, 1)
        items.append((cid, np.dstack([rgb, al])))
    atlas, uvs = pack_grid(items, 2, 2, 512, pad=4)
    save_rgba(decontaminate(atlas), f"{OUT}/decal_wall_grime_streaks_photo.png")
    meta("decal_wall_grime_streaks_photo", "Black water / mould streaks extracted from real photos of tropical "
         "concrete walls (alpha = darkening). Place under ledges, AC units, balconies, roof edges.",
         "1024x1024", True, False, [2.0, 2.0], [u[0] for u in uvs], ["rgba"], atlas_uv=uvs)


def moss():
    items = []
    for cid in ("dfb0c916", "2a300748", "1778ffbe", "ea6d964e"):
        try:
            a = src(cid)
        except Exception:
            continue
        g = np.clip(a[..., 1] - (a[..., 0] + a[..., 2]) * 0.5, 0, 1)
        al = smoothstep(0.02, 0.10, g)
        al = np.maximum(al, alpha_from_dark(a, max(a.shape[:2]) // 2, 0.15, 0.6) * 0.6)
        h, w = al.shape
        al *= ellipse_mask(h, w, w / 2, h / 2, w * 0.55, h * 0.55, noise=0.1, soft=0.3)
        items.append((cid, np.dstack([a, feather(al, 1.0)])))
    atlas, uvs = pack_grid(items, 2, 2, 512, pad=4)
    save_rgba(decontaminate(atlas), f"{OUT}/decal_moss_photo.png")
    meta("decal_moss_photo", "Moss / algae patches extracted from real photos of damp concrete (alpha = green "
         "growth + dark damp). Wall bases, canal walls, shaded corners, drain edges.", "1024x1024", True,
         False, [1.5, 1.5], [u[0] for u in uvs], ["rgba"], atlas_uv=uvs)


def posters():
    items = []
    for cid in ("8927c0fd", "a83167f6", "9962382a", "8927c0fd#b"):
        try:
            a = src(cid.split("#")[0])
        except Exception:
            continue
        if cid.endswith("#b"):
            a = a[a.shape[0] // 2:, :]
        h, w = a.shape[:2]
        m = np.ones((h, w), np.float32)
        rng = np.random.default_rng(len(items))
        n = cv2.resize(rng.standard_normal((h // 16 + 2, w // 16 + 2)).astype(np.float32), (w, h))
        edge = np.minimum(np.minimum(np.arange(w)[None, :], w - 1 - np.arange(w)[None, :]),
                          np.minimum(np.arange(h)[:, None], h - 1 - np.arange(h)[:, None])).astype(np.float32)
        m = smoothstep(4, 20, edge + n * 10)
        items.append((cid, np.dstack([a, m])))
    atlas, uvs = pack_grid(items, 2, 2, 512, pad=6)
    save_rgba(decontaminate(atlas), f"{OUT}/decal_torn_posters_photo.png")
    meta("decal_torn_posters_photo", "Layers of torn / peeled posters cut from real wall photos (ragged alpha "
         "edges). Pillars, poles, shutter boxes, walls near the market.", "1024x1024", True, False,
         [1.2, 1.2], [u[0] for u in uvs], ["rgba"], atlas_uv=uvs)


def flyers():
    a = src("5edb6400")
    c = crop(a, 180, 280, 880, 1000)
    al = smoothstep(0.31, 0.40, lum(c))
    al = cv2.morphologyEx(al, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17)))
    al = cv2.morphologyEx(al, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    al = feather(al, 1.0)
    rgb = np.clip((c - 0.08) * 1.35, 0, 1)
    rgb = rgb * np.array([1.0, 0.985, 0.95])           # photocopy paper warmth
    out = np.dstack([rgb, al])
    save_rgba(decontaminate(out), f"{OUT}/decal_flyers_loan_cluster_photo.png", size=(1000, 1024))
    meta("decal_flyers_loan_cluster_photo", "Cluster of photocopied 'เงินด่วน' loan flyers cut from a real B&W "
         "photo of a utility pole (alpha = paper). Wrap around concrete poles / walls at 1.2-2.0 m.",
         "1000x1024", True, False, [0.7, 0.72], ["5edb6400"], ["rgba"])


# ------------------------------------------------------------------ wires & cable
def wires():
    items = []
    for cid in ("d4263994", "3ad7ba59", "f04ea494", "56c4d34b"):
        try:
            a = src(cid)
        except Exception:
            continue
        al, sky = sky_key(a, 31, 0.12, 0.5)
        rgb = np.clip(a * 0.5, 0, 0.25) * 0 + np.array([0.06, 0.06, 0.065])
        rgb = rgb * (0.7 + 0.6 * lum(a))[..., None]
        items.append((cid, np.dstack([rgb, feather(al, 0.6)])))
    atlas, uvs = pack_grid(items, 2, 2, 1024, pad=2)
    save_rgba(atlas, f"{OUT}/wire_bundle_tangle_photo.png")
    meta("wire_bundle_tangle_photo", "Tangled overhead cable bundles keyed out of real photos taken against "
         "the sky (alpha = cables, colour = dark rubber). 2x2 atlas of 1024 cells - use on alpha-tested "
         "camera-facing or crossed quads at pole tops / between poles.", "2048x2048", True, False,
         [3.0, 3.0], [u[0] for u in uvs], ["rgba"], atlas_uv=uvs)


def cable():
    a = src("31b1811e")
    h, w = a.shape[:2]
    c = crop(a, int(w * 0.3), int(h * 0.1), int(w * 0.42), int(h * 0.9))   # vertical cables
    c = np.rot90(c).copy()                                                   # -> horizontal
    c = rs(c, 1024, 128)
    c = seamless_x(c, 0.25)
    c = np.clip((c - c.min()) * 1.2, 0, 1)
    rough = np.clip(0.45 - (lum(c) - 0.1) * 0.8, 0.2, 0.8)
    save_rgb(c, f"{OUT}/cable_black_rubber_photo_albedo.jpg", 90)
    save_rgb(normal_from_height(height_from_lum(c, 2), 3, True), f"{OUT}/cable_black_rubber_photo_normal.jpg", 92)
    save_rgb(np.dstack([np.ones_like(rough), rough, np.zeros_like(rough)]),
             f"{OUT}/cable_black_rubber_photo_orm.jpg", 88)
    meta("cable_black_rubber_photo", "Black rubber cable surface from a real close-up photo of power cables, "
         "rotated so cables run along U; tiles along U. Map onto tube geometry (U along the wire).",
         "1024x128", False, "U only", [1.0, 0.125], ["31b1811e"], ["albedo", "normal", "orm"])


def save_manifest_part():
    p = os.path.join(RAW, "manifest_photo_decals.json")
    old = json.load(open(p)) if os.path.exists(p) else {}
    old.update(MAN)
    json.dump(old, open(p, "w"), ensure_ascii=False, indent=1)


JOBS = {"manholes": manholes, "roadpaint": roadpaint, "oil": oil, "gum": gum, "butts": butts,
        "puddles": puddles, "potholes": potholes, "streaks": streaks, "moss": moss, "posters": posters,
        "flyers": flyers, "wires": wires, "cable": cable}

if __name__ == "__main__":
    for nm in (sys.argv[1:] or list(JOBS)):
        print("==", nm, flush=True)
        JOBS[nm]()
        save_manifest_part()
