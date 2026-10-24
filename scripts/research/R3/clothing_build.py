#!/usr/bin/env python3
"""Build clothing textures from REAL photos (R3-people).

Usage: python3 -I clothing_build.py <cand_root> <polyhaven_dir> <out_dir> [name ...]
Every texture records its photo source (web image + page URL from the candidate index, or the
Poly Haven asset) in manifest.json.  Photos are only cropped, rectified, de-lit, made seamless
(Moisan periodic decomposition), recoloured or composited with other real photos.
"""
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import phototex as P  # noqa: E402
import texlib as T  # noqa: E402

CAND, PH, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
ONLY = set(sys.argv[4:])
MAN_PATH = os.path.join(OUT, "manifest.json")
MAN = json.load(open(MAN_PATH)) if os.path.exists(MAN_PATH) else {"textures": {}}


def src_info(rel):
    """rel = 'job/NN.jpg' -> provenance from that job's index.json"""
    job, fn = rel.split("/")
    idx = json.load(open(os.path.join(CAND, job, "index.json")))
    for e in idx:
        if e["file"] == fn:
            return {"type": "web photo", "image": e["image"], "page": e["page"], "title": e["title"][:120],
                    "licence": "unknown / all rights reserved by the owner (client-approved web use, see credits)"}
    return {"type": "web photo", "image": "?", "page": "?"}


def ph_info(asset):
    return {"type": "photo scan", "image": f"https://polyhaven.com/a/{asset}", "page": f"https://polyhaven.com/a/{asset}",
            "author": "Poly Haven", "licence": "CC0"}


def cand(rel):
    return P.load(os.path.join(CAND, rel))


def ph(asset, m="Diffuse"):
    for ext in ("jpg", "png"):
        p = os.path.join(PH, f"{asset}__{m}.{ext}")
        if os.path.exists(p):
            return P.load(p)
    raise FileNotFoundError(asset + m)


def save(name, img, size, desc, sources, kind="tileable", normal=None, extra=None, quality=88):
    os.makedirs(OUT, exist_ok=True)
    img = P.finish(img, size)
    T.save(os.path.join(OUT, name + ".jpg"), img, quality=quality)
    rec = {"file": name + ".jpg", "size": size, "kind": kind, "desc": desc, "sources": sources}
    if normal is not None:
        n = P.finish(normal, min(size, 1024))
        T.save(os.path.join(OUT, name + "_normal.jpg"), n, quality=90)
        rec["normal"] = name + "_normal.jpg"
    if extra:
        rec.update(extra)
    lin = T.srgb_to_lin(img)
    rec["avgRGB"] = T.rgb2hex(T.lin_to_srgb(lin.reshape(-1, 3).mean(0)))
    MAN["textures"][name] = rec
    print(name, size, rec["avgRGB"])


def want(n):
    return not ONLY or n in ONLY


def plaid(img, box, period, nx, ny, n_out, flatten=0.15):
    x0, y0 = int(box[0]), int(box[1])
    c = P.tile_crop(img, period, period, nx, ny, x0, y0)
    c = P.flatten_light(c, flatten, 0.8)
    c = P.periodic(c)
    tx = max(1, int(round(n_out / nx)))
    ty = max(1, int(round(n_out / ny)))
    t = np.tile(c, (ty, tx, 1))
    return t


def tile_square(c, n_rep_min=1):
    """Tile an aligned crop to a ~square canvas (keeps pattern phase)."""
    h, w = c.shape[:2]
    tx = max(n_rep_min, round(max(h, w) / w))
    ty = max(n_rep_min, round(max(h, w) / h))
    return np.tile(c, (ty, tx, 1))


def photo_tile(img, box, flatten=0.15, strength=0.8, deskew=False, frac=0.98):
    reg = P.crop(img, box)
    if deskew:
        reg, _ = P.deskew(reg)
        m = int(min(reg.shape[:2]) * 0.06)
        reg = reg[m:-m, m:-m]
    c, info = P.aligned_crop(reg, (0, 0, reg.shape[1], reg.shape[0]), frac)
    c = P.periodic(P.flatten_light(c, flatten, strength))
    return tile_square(c), info


def ph_normal(asset):
    try:
        return ph(asset, "nor_gl")
    except FileNotFoundError:
        return None


def yellowing(img, amount, seed):
    """Age a white fabric photo: warm/yellow cast + mottled low-frequency yellowing."""
    h, w = img.shape[:2]
    n = T.fbm(h, w, beta=2.4, seed=seed)
    m = np.clip(0.55 + 0.35 * n, 0, 1)[..., None] * amount
    lin = T.srgb_to_lin(img)
    tint = T.srgb_to_lin(np.float32([0.93, 0.86, 0.66]))
    out = lin * (1 - m) + lin * tint * m / tint.max()
    return T.lin_to_srgb(out * (1 - 0.06 * amount))


def stain_mask_from(img):
    """Yellow-stain alpha from a photo of a stain on white fabric (b* excess over the cloth)."""
    lab = cv2.cvtColor(img.astype(np.float32), cv2.COLOR_RGB2LAB)
    b = lab[..., 2]
    base = np.median(b)
    a = np.clip((b - base - 4) / 28.0, 0, 1)
    return cv2.GaussianBlur(a, (0, 0), 1.5)


def apply_stain(base, mask, col=(0.80, 0.66, 0.30), strength=0.8):
    lin = T.srgb_to_lin(base)
    c = T.srgb_to_lin(np.float32(col))
    m = (mask * strength)[..., None]
    out = lin * (1 - m) + lin * (c / c.max()) * m
    return T.lin_to_srgb(out)


# ------------------------------------------------------------------------------ textures
if want("singlet_rib_white"):
    src = "singlet_rib/02.jpg"
    im = cand(src)
    h, w = im.shape[:2]
    c, _ = photo_tile(im, (w * 0.1, h * 0.1, w * 0.9, h * 0.9), 0.12, 1.0)
    # neutral warm white (photo is slightly blue-grey)
    c = np.clip(c * np.float32([1.02, 1.0, 0.97]) * 1.04, 0, 1)
    save("singlet_rib_white", c, 1024, "white 1x1 rib-knit cotton singlet (เสื้อกล้าม), clean; ribs run along V",
         [src_info(src)], normal=P.normal_from(c, 3.0))
    yel = yellowing(c, 0.75, 11)
    save("singlet_rib_yellowed", yel, 1024, "same singlet, old: yellowed, mottled, washed-out",
         [src_info(src)], normal=P.normal_from(c, 3.0))
    # sweaty: real stain shapes scattered (tile-safe via wrap)
    st_src = ["sweat_stain/03.jpg", "sweat_stain/05.jpg", "sweat_stain/04.jpg"]
    masks = []
    for s in st_src:
        sm = stain_mask_from(cand(s))
        masks.append(sm)
    acc = np.zeros(yel.shape[:2], np.float32)
    H, W = acc.shape
    rng = np.random.default_rng(5)
    for k in range(4):
        m = masks[k % len(masks)]
        sc = rng.uniform(0.25, 0.45) * W / max(m.shape)
        mm = cv2.resize(m, (max(8, int(m.shape[1] * sc)), max(8, int(m.shape[0] * sc))))
        ox, oy = rng.integers(0, W), rng.integers(0, H)
        big = np.zeros_like(acc)
        hh, ww = mm.shape
        big[:hh, :ww] = mm
        big = np.roll(np.roll(big, oy, 0), ox, 1)
        acc = np.maximum(acc, big)
    stained = apply_stain(yel, acc, strength=0.85)
    save("singlet_rib_sweaty", stained, 1024, "old singlet with yellow sweat stains (real stain photos composited)",
         [src_info(src)] + [src_info(s) for s in st_src], normal=P.normal_from(c, 3.0))
    # armpit / collar decal with alpha
    dm = stain_mask_from(cand("sweat_stain/03.jpg"))
    ys, xs = np.nonzero(dm > 0.05)
    dm = dm[max(0, ys.min() - 10):ys.max() + 10, max(0, xs.min() - 10):xs.max() + 10]
    dm = cv2.resize(dm, (512, 512))
    col = np.ones((512, 512, 3), np.float32) * np.float32([0.78, 0.63, 0.28])
    rgba = np.dstack([col, np.clip(dm * 0.9, 0, 1)])
    T.save(os.path.join(OUT, "sweat_stain_decal.png"), rgba)
    MAN["textures"]["sweat_stain_decal"] = {"file": "sweat_stain_decal.png", "size": 512, "kind": "decal (RGBA)",
                                            "desc": "yellow sweat stain decal for armpits/collar/back (multiply-blend)",
                                            "sources": [src_info("sweat_stain/03.jpg")]}

if want("phakhaoma"):
    src = "phakhaoma/10.jpg"
    im = cand(src)
    t, _ = photo_tile(im, (268, 20, 502, 1220), 0.2, 0.7)
    save("phakhaoma_blue_white", t, 1024, "ผ้าขาวม้า hand-woven cotton check: white / navy / teal / red (classic)",
         [src_info(src)], normal=P.normal_from(t, 1.5))
    t, _ = photo_tile(im, (752, 20, 1195, 1220), 0.2, 0.7)
    save("phakhaoma_red_yellow", t, 1024, "ผ้าขาวม้า red / black / yellow check", [src_info(src)],
         normal=P.normal_from(t, 1.5))
    t, _ = photo_tile(im, (5, 20, 252, 1220), 0.2, 0.7)
    save("phakhaoma_rainbow", t, 1024, "ผ้าขาวม้า multicolour red-yellow-blue stripes check", [src_info(src)],
         normal=P.normal_from(t, 1.5))
    t, _ = photo_tile(im, (520, 20, 735, 1220), 0.2, 0.7)
    save("sarong_red_purple", t, 1024, "red / purple / green check (sarong / ผ้าขาวม้า)", [src_info(src)],
         normal=P.normal_from(t, 1.5))
    src3 = "phakhaoma/03.jpg"
    t, _ = photo_tile(cand(src3), (1060, 340, 1610, 1120), 0.2, 0.7, deskew=True)
    save("phakhaoma_green_yellow", t, 1024, "ผ้าขาวม้า green / yellow / light-green check", [src_info(src3)],
         normal=P.normal_from(t, 1.5))

if want("khaki_twill"):
    src = "khaki_twill/01.jpg"
    im = cand(src)
    h, w = im.shape[:2]
    c, _ = photo_tile(im, (w * 0.08, h * 0.08, w * 0.92, h * 0.92), 0.15, 0.8)
    save("cotton_khaki_twill", c, 1024, "khaki / beige cotton twill (shorts, chinos, primary-school shorts)", [src_info(src)],
         normal=P.normal_from(c, 2.0))
if want("black_cotton"):
    src = "black_cotton/03.jpg"
    im = cand(src)
    h, w = im.shape[:2]
    c, _ = photo_tile(im, (w * 0.08, h * 0.08, w * 0.92, h * 0.92), 0.15, 0.8)
    c = np.clip(c * 1.0 + 0.02, 0, 1)
    save("cotton_black", c, 1024, "black cotton twill (shorts, trousers, school skirts)", [src_info(src)],
         normal=P.normal_from(c, 2.0))

# ---- Poly Haven photo scans (CC0), recoloured where needed
if want("ph"):
    d = ph("denim_fabric_06")
    save("denim_dark", P.periodic(P.flatten_light(d, 0.2, 0.7)), 1024, "dark worn indigo denim (jeans)", [ph_info("denim_fabric_06")],
         normal=ph_normal("denim_fabric_06"))
    d = ph("denim_fabric")
    save("denim_mid_seam", d, 1024, "mid-blue faded denim with a flat-felled seam and fades (jeans panel)",
         [ph_info("denim_fabric")], normal=ph_normal("denim_fabric"))
    w = ph("poly_wool_herringbone")
    save("suit_black_wool", P.colorize(w, (0.085, 0.085, 0.095), 0.9), 1024, "black poly-wool herringbone suiting (cheap suit, tux)",
         [ph_info("poly_wool_herringbone")], normal=ph_normal("poly_wool_herringbone"))
    save("suit_grey_wool", w, 1024, "grey herringbone wool (office trousers, cheap blazer)", [ph_info("poly_wool_herringbone")],
         normal=ph_normal("poly_wool_herringbone"))
    g = ph("crepe_satin")
    save("casino_gold_satin", P.colorize(g, (0.80, 0.62, 0.24), 1.25), 1024, "shiny gold crepe satin (casino suit) — use metalness 0.3, roughness 0.25",
         [ph_info("crepe_satin")], normal=ph_normal("crepe_satin"))
    v = ph("velour_velvet")
    save("casino_maroon_velvet", P.colorize(v, (0.37, 0.07, 0.12), 1.15), 1024, "maroon velvet (casino suit) — sheen via low roughness + fresnel",
         [ph_info("velour_velvet")], normal=ph_normal("velour_velvet"))
    q = ph("quatrefoil_jacquard_fabric")
    save("casino_maroon_jacquard", q, 1024, "burgundy quatrefoil jacquard (casino waistcoat / curtains)", [ph_info("quatrefoil_jacquard_fabric")],
         normal=ph_normal("quatrefoil_jacquard_fabric"))
    p = ph("stretch_poplin")
    save("shirt_white_poplin", P.colorize(p, (0.93, 0.93, 0.91), 0.8), 1024, "white cotton poplin (dress shirts, school shirts)",
         [ph_info("stretch_poplin")], normal=ph_normal("stretch_poplin"))
    save("school_navy_twill", P.colorize(ph("terlenka"), (0.10, 0.14, 0.26), 1.0), 1024, "navy blue polyester twill (secondary-school shorts / skirts)",
         [ph_info("terlenka")], normal=ph_normal("terlenka"))
    save("police_khaki_brown", P.colorize(ph("terlenka"), (0.43, 0.35, 0.23), 1.0), 1024, "Thai police khaki-brown (สีกากี) gabardine",
         [ph_info("terlenka")], normal=ph_normal("terlenka"))
    t = ph("terry_cloth")
    save("terry_white_headband", P.colorize(t, (0.94, 0.93, 0.91), 1.0), 1024, "white terry cloth (ref4 afro guy's headband, towels)",
         [ph_info("terry_cloth")], normal=ph_normal("terry_cloth"))
    pk = ph("waffle_pique_cotton")
    save("pique_white", P.colorize(pk, (0.92, 0.92, 0.90), 1.0), 1024, "white pique knit (polo shirts; recolour in shader)",
         [ph_info("waffle_pique_cotton")], normal=ph_normal("waffle_pique_cotton"))
    j = ph("cotton_jersey")
    save("jersey_grey", P.colorize(j, (0.45, 0.45, 0.46), 1.0), 1024, "grey cotton jersey (T-shirts; recolour in shader)",
         [ph_info("cotton_jersey")], normal=ph_normal("cotton_jersey"))
    l = ph("rough_linen")
    save("khakuay_indigo_cotton", P.colorize(l, (0.16, 0.20, 0.31), 1.0), 1024, "indigo rough cotton for กางเกงขาก๊วย (wide Chinese-style trousers)",
         [ph_info("rough_linen")], normal=ph_normal("rough_linen"))
    bs = ph("bi_stretch")
    save("vest_orange_poly", P.colorize(bs, (1.0, 0.42, 0.07), 1.0), 1024, "fluorescent orange polyester (moto-taxi vest body)",
         [ph_info("bi_stretch")], normal=ph_normal("bi_stretch"))
    save("rider_green_poly", P.colorize(bs, (0.0, 0.62, 0.30), 1.0), 1024, "green polyester softshell (delivery rider jacket body)",
         [ph_info("bi_stretch")], normal=ph_normal("bi_stretch"))
    save("rider_pink_poly", P.colorize(bs, (0.86, 0.10, 0.48), 1.0), 1024, "hot-pink polyester (delivery rider jacket body)",
         [ph_info("bi_stretch")], normal=ph_normal("bi_stretch"))
    lw = ph("leather_white")
    save("sneaker_white_leather", P.colorize(lw, (0.90, 0.89, 0.86), 1.1), 1024, "white sneaker leather, creased (shoe uppers)",
         [ph_info("leather_white")], normal=ph_normal("leather_white"))


# ============================================================================== stage 2: prints
def print_tile(img, box, flatten=0.25, strength=0.6, deskew=False):
    """Non-repeating print photo -> seamless tile (crop, de-light, Moisan periodic component)."""
    reg = P.crop(img, box)
    if deskew:
        reg, _ = P.deskew(reg)
        m = int(min(reg.shape[:2]) * 0.06)
        reg = reg[m:-m, m:-m]
    h, w = reg.shape[:2]
    n = min(h, w)
    reg = reg[(h - n) // 2:(h - n) // 2 + n, (w - n) // 2:(w - n) // 2 + n]
    return P.periodic(P.flatten_light(reg, flatten, strength))


def mean_color(img, box):
    reg = P.crop(img, box)
    return T.lin_to_srgb(T.srgb_to_lin(reg).reshape(-1, 3).mean(0))


def saturate(img, k=1.3, hue_target=None):
    hsv = cv2.cvtColor(np.clip(img, 0, 1).astype(np.float32), cv2.COLOR_RGB2HSV)
    hsv[..., 1] = np.clip(hsv[..., 1] * k, 0, 1)
    return cv2.cvtColor(hsv, cv2.COLOR_HSV2RGB)


if want("plaid_boxer"):
    for name, src, box, desc in [
        ("boxer_plaid_navy_beige", "plaid_boxer/04.jpg", (650, 20, 1090, 520), "plaid boxer / sleep-shorts shirting: navy, beige, white, rust"),
        ("boxer_plaid_black_white", "plaid_boxer/05.jpg", (5, 5, 175, 560), "black / white / olive windowpane check (boxers, uncle shorts)"),
        ("boxer_plaid_navy_green", "plaid_boxer/12.jpg", (1350, 1450, 2040, 2040), "navy / green / yellow tartan check (boxers)"),
    ]:
        t, info = photo_tile(cand(src), box, 0.2, 0.7, deskew=True)
        save(name, t, 1024, desc, [src_info(src)], normal=P.normal_from(t, 1.5))

if want("hawaiian"):
    src = "hawaiian_green/08.jpg"
    im = cand(src)
    t = print_tile(im, (0, 0, 1280, 900))
    save("hawaiian_sage_hibiscus", t, 1024, "Hawaiian shirt print: sage green with white hibiscus & monstera (photo of fabric)", [src_info(src)])
    lime = saturate(P.colorize(t, (0.53, 0.68, 0.33), 1.0) * 0.55 + t * 0.45, 1.25)
    # keep the white leaves white, push the green ground to ref4 lime #86ad55
    lab = cv2.cvtColor(t.astype(np.float32), cv2.COLOR_RGB2LAB)
    leaf = np.clip((lab[..., 0] - 72) / 10.0, 0, 1)[..., None]
    ground = P.colorize(t, (0.50, 0.68, 0.31), 1.0)
    cream = np.clip(t * np.float32([1.02, 1.01, 0.86]), 0, 1)
    ref4 = ground * (1 - leaf) + cream * leaf
    save("hawaiian_green_leaf_ref4", ref4, 1024, "ref4 standing guy: lime-green Hawaiian shirt with cream leaves (real print, ground recoloured to #86ad55)", [src_info(src)])
    src = "hawaiian_green/06.jpg"
    t = print_tile(cand(src), (0, 0, 1900, 1680))
    save("hawaiian_palm_sage", t, 1024, "pale sage palm-leaf print (uncle shirt / auntie blouse)", [src_info(src)])
    src = "hawaiian_red/02.jpg"
    t = print_tile(cand(src), (30, 60, 950, 980))
    save("hawaiian_red_hibiscus", t, 1024, "classic red Hawaiian shirt: pink hibiscus, plumeria, monstera", [src_info(src)])
    src = "hawaiian_blue/01.jpg"
    im = cand(src)
    t, info = photo_tile(im, (0, 0, im.shape[1], im.shape[0]), 0.3, 0.3)
    save("hawaiian_blue_floral", t, 1024, "royal-blue tropical floral print (plumeria, palm)", [src_info(src)])
    src = "thai_floral_shirt/06.jpg"
    t = print_tile(cand(src), (190, 300, 390, 500), 0.3, 0.4)
    t = np.tile(t, (2, 2, 1))
    save("thai_songkran_floral", t, 1024, "Thai Songkran-style floral shirt (เสื้อลายดอก): coral flowers, teal & green leaves", [src_info(src)])

if want("stripes"):
    def stripe_tile(src, box, reps_y, flatten=0.2):
        reg = P.crop(cand(src), box)
        c, info = P.aligned_crop(reg, (0, 0, reg.shape[1], reg.shape[0]), 0.98)
        c = P.periodic(P.flatten_light(c, flatten, 0.8))
        # repeat to a square canvas with reps_y vertical repeats
        h, w = c.shape[:2]
        ty = reps_y
        tx = max(1, round(ty * h / w))
        return np.tile(c, (ty, tx, 1)), info
    src = "stripe_green/04.jpg"
    t, info = stripe_tile(src, (300, 560, 750, 860), 3)
    save("stripe_green_white_pique", t, 1024, "green / white horizontal stripe polo knit (flat-lay product photo)", [src_info(src)], normal=P.normal_from(t, 2.0))
    lab = cv2.cvtColor(t.astype(np.float32), cv2.COLOR_RGB2LAB)
    wmask = np.clip((lab[..., 0] - 70) / 12.0, 0, 1)[..., None]
    bottle = P.colorize(t, (0.16, 0.37, 0.28), 1.0)
    ref4 = bottle * (1 - wmask) + np.clip(t * np.float32([0.98, 0.97, 0.91]), 0, 1) * wmask
    save("stripe_green_white_ref4", ref4, 1024, "ref4 seated guy (centre-right): bottle-green #2a5e48 / off-white stripe polo", [src_info(src)], normal=P.normal_from(t, 2.0))
    src = "stripe_grey/05.jpg"
    reg = np.ascontiguousarray(np.rot90(P.crop(cand(src), (40, 20, 1350, 650)), 1))
    reg, ang = P.deskew(reg, 10)
    m = int(min(reg.shape[:2]) * 0.1)
    reg = P.flatten_light(reg[m:-m, m:-m], 0.15, 0.9)
    # stripe cross-section measured on the real fabric (median along the stripe direction)
    prof = np.median(reg[:, reg.shape[1] // 3: 2 * reg.shape[1] // 3], axis=1)
    per, _ = P.period_of(reg, 0, lo=8)
    per = P.best_lag(reg, 0, per * 4, window=per)[0]
    prof = prof[:per]
    reps = 4
    col = np.tile(prof, (reps, 1))
    col = cv2.resize(col[None, :, :].transpose(1, 0, 2), (1, 1024), interpolation=cv2.INTER_AREA).transpose(1, 0, 2)[0]
    t = np.repeat(col[:, None, :], 1024, axis=1)
    lab = cv2.cvtColor(t.astype(np.float32), cv2.COLOR_RGB2LAB)
    lab[..., 0] = np.clip(50 + (lab[..., 0] - 50) * 1.45 + 10, 0, 100)
    t = np.clip(cv2.cvtColor(lab, cv2.COLOR_LAB2RGB), 0, 1)
    knit = P.finish(ph("cotton_jersey"), 1024)
    kd = T.detail_from_photo(knit, 24.0)
    t = T.lin_to_srgb(T.srgb_to_lin(t) * np.clip(kd, 0.7, 1.3)[..., None])
    save("stripe_white_grey_thin", t, 1024, "white jersey with thin grey horizontal stripes (ref4 left guy's top): stripe profile measured from a real fabric photo x real cotton-jersey scan",
         [src_info(src), ph_info("cotton_jersey")], normal=ph_normal("cotton_jersey"))
    src = "stripe_grey/03.jpg"
    t, info = stripe_tile(src, (0, 0, 720, 640), 1)
    t = np.tile(t, (3, 3, 1))
    save("stripe_heather_wide", t, 1024, "heather-grey / oatmeal wide stripe jersey (casual tee)", [src_info(src)], normal=P.normal_from(t, 2.0))
    src = "stripe_blue/04.jpg"
    t, info = photo_tile(cand(src), (5, 5, 595, 590), 0.2, 0.7)
    save("stripe_blue_shirting", t, 1024, "fine blue / white pinstripe shirting (office shirt)", [src_info(src)], normal=P.normal_from(t, 1.5))
    src = "paisley_blue_white/02.jpg"
    t = print_tile(cand(src), (0, 0, 1200, 1100), 0.12, 0.95)
    save("paisley_blue_white", t, 1024, "ref4 right guy: white shirt with small periwinkle-blue paisley motifs", [src_info(src)])

if want("auntie"):
    src = "auntie_blouse/04.jpg"
    t = print_tile(cand(src), (0, 0, 1000, 1000), 0.25, 0.5)
    save("auntie_blouse_pink_ditsy", t, 1024, "เสื้อคุณแม่: pale pink rayon with small brown / blue / white flowers", [src_info(src)])
    src = "auntie_blouse/04.jpg"
    t = print_tile(cand(src), (0, 0, 1000, 1000), 0.25, 0.5)
    lab = cv2.cvtColor(t.astype(np.float32), cv2.COLOR_RGB2LAB)
    ground = np.clip(1 - np.abs(lab[..., 0] - np.median(lab[..., 0])) / 18.0, 0, 1) * np.clip(1 - (np.abs(lab[..., 1] - np.median(lab[..., 1])) + np.abs(lab[..., 2] - np.median(lab[..., 2]))) / 14.0, 0, 1)
    ground = cv2.GaussianBlur(ground, (0, 0), 1.0)[..., None]
    mint = P.colorize(t, (0.74, 0.87, 0.81), 1.0)
    t2 = t * (1 - ground) + mint * ground
    save("auntie_blouse_mint_ditsy", t2, 1024, "เสื้อคุณแม่ second colourway: mint ground, same real ditsy floral print", [src_info(src)])

if want("uniforms"):
    src = "maroon_velvet/02.jpg"
    t, info = photo_tile(cand(src), (0, 0, 2000, 2000), 0.2, 0.6)
    save("casino_maroon_velvet", t, 1024, "maroon velvet (casino suit) — real photo; low roughness + sheen", [src_info(src)], normal=P.normal_from(t, 1.0))
    src = "black_suit/03.jpg"
    t, info = photo_tile(cand(src), (0, 0, 1000, 1000), 0.2, 0.6)
    t = np.clip(t * 0.62, 0, 1)
    save("suit_black_wool", t, 1024, "black / charcoal suiting wool (cheap suit, casino tux)", [src_info(src)], normal=P.normal_from(t, 1.5))
    col = (0.43, 0.35, 0.23)  # khaki-brown measured on real uniform photos (police_brown/0x)
    save("police_khaki_brown", P.colorize(ph("terlenka"), tuple(col), 1.0), 1024,
         "Thai police khaki-brown (สีกากี): colour sampled from a real uniform photo, weave = Poly Haven terlenka scan",
         [src_info("police_brown/04.jpg"), ph_info("terlenka")], normal=ph_normal("terlenka"))
    src = "school_shorts/01.jpg"
    t = print_tile(cand(src), (200, 350, 560, 640), 0.25, 0.8)
    save("school_navy_twill", t, 1024, "navy school-shorts / skirt twill (real Thai school shorts photo)", [src_info(src)], normal=P.normal_from(t, 1.5))
    vest = cand("win_vest/08.jpg")
    vcol = (1.0, 0.40, 0.06)  # Bangkok วิน vests: fluorescent orange (see references/characters/web/win_moto_*)
    save("vest_orange_poly", P.colorize(ph("bi_stretch"), tuple(vcol), 1.0), 1024,
         "moto-taxi vest orange (colour sampled from a real Bangkok วิน vest photo; weave = Poly Haven scan)",
         [src_info("win_vest/08.jpg"), ph_info("bi_stretch")], normal=ph_normal("bi_stretch"))
    back = P.crop(vest, (75, 180, 950, 1015))
    back = cv2.resize(back, (512, 512), interpolation=cv2.INTER_AREA)
    T.save(os.path.join(OUT, "win_vest_back_505.jpg"), back, quality=90)
    MAN["textures"]["win_vest_back_505"] = {"file": "win_vest_back_505.jpg", "size": 512, "kind": "print / UV panel",
        "desc": "real back panel of a Bangkok motorcycle-taxi vest: reflective lime bands, yellow district patch (วินอนุสาวรีย์ สมุทรสงคราม), big number 505",
        "sources": [src_info("win_vest/08.jpg")]}
    rt = P.crop(cand("reflective_tape/03.jpg"), (150, 880, 1000, 1090))
    rt = P.periodic(rt)
    rt = np.tile(rt, (1, 1, 1))
    rt = cv2.resize(rt, (1024, 256), interpolation=cv2.INTER_AREA)
    T.save(os.path.join(OUT, "reflective_band.jpg"), rt, quality=88)
    MAN["textures"]["reflective_band"] = {"file": "reflective_band.jpg", "size": [1024, 256], "kind": "tileable strip (U)",
        "desc": "safety-vest band: orange edges with grey retro-reflective tape (riders, police at night, vests)",
        "sources": [src_info("reflective_tape/03.jpg")]}
    mesh = P.periodic(P.crop(cand("reflective_tape/03.jpg"), (641, 495, 1020, 845)))
    save("vest_mesh_yellow", mesh, 512, "fluorescent yellow-green safety-vest mesh", [src_info("reflective_tape/03.jpg")])

if want("apron"):
    src = "apron_stained/01.jpg"
    t = print_tile(cand(src), (280, 40, 880, 420), 0.25, 0.7)
    save("apron_stained", t, 1024, "street-cook canvas apron with chili / soy / oil stains (real photo)", [src_info(src)], normal=P.normal_from(t, 1.5))

json.dump(MAN, open(MAN_PATH, "w"), ensure_ascii=False, indent=1)
