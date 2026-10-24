"""Build game-ready food textures from real food photos (client rule 2026-10-19: real photos, any licence).
Usage: python3 -I make_foodtex.py [name ...]   (no args = all); writes manifest.json.
"""
import json
import os
import sys

sys.path.insert(0, "/home/user/special-telegram/scripts/research/R2")
import cv2  # noqa: E402
import numpy as np  # noqa: E402

import texkit as T  # noqa: E402

SRC = "/home/user/special-telegram/references/food/_raw/foodtex"
CLEAN = "/home/user/special-telegram/references/food/_raw/clean"
OUT = "/home/user/special-telegram/public/assets/textures/food"
JOBS = {}


def job(name, fn, purpose, alpha, notes, sources):
    JOBS[name] = dict(fn=fn, purpose=purpose, alpha=alpha, notes=notes, sources=sources)


def P(rel):
    return os.path.join(SRC, rel)


def tile_job(name, src, box, purpose, notes, out=1024, flat=0.8, grade=None, normal=True, overlap=0.22):
    def fn():
        img = T.load(P(src))
        c = T.crop_n(img, box)
        if flat:
            c = T.flatten_light(c, strength=flat)
        if grade:
            c = T.grade(c, **grade)
        tile = T.make_tileable(c, out=out, overlap=overlap, seed=len(name))
        files = [name + ".jpg"]
        T.save_rgb(tile, os.path.join(OUT, name + ".jpg"))
        if normal:
            n = T.normal_from(tile, strength=2.5)
            T.save_rgb(n, os.path.join(OUT, name + "_n.jpg"))
            files.append(name + "_n.jpg")
        return files, tile.shape[1], tile.shape[0]
    job(name, fn, purpose, False, notes + " Seamless (wraps in U and V). *_n.jpg = OpenGL normal map.", [src])


def cut_job(name, src, purpose, notes, method="white", box=None, rect=None, thresh=232, size=1024, n_keep=1,
            post=None, fill=True, erode=1, feather=1.2, sat_max=40, square=True, crop_first=None, kill_white=False,
            kill_fn=None, mask_fn=None):
    def fn():
        img = T.load(P(src))
        if crop_first:
            img = T.crop_n(img, crop_first)
        if mask_fn:
            m = mask_fn(img)
        elif method == "white":
            m = T.mask_white_bg(img, thresh=thresh, sat_max=sat_max)
        else:
            m = T.mask_grabcut(img, rect)
        m = T.keep_largest(m, n=n_keep)
        if fill:
            m = T.fill_holes(m)
        if kill_white:
            u8 = np.clip(img, 0, 255).astype(np.uint8)
            hsv = cv2.cvtColor(u8, cv2.COLOR_RGB2HSV)
            white = ((u8.min(axis=2) > 222) & (hsv[..., 1] < 34)) | ((hsv[..., 1] < 50) & (hsv[..., 2] > 165))
            m = (m.astype(bool) & ~white).astype(np.uint8)
            m = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
        if kill_fn:
            m = (m.astype(bool) & ~kill_fn(img)).astype(np.uint8)
            m = T.keep_largest(cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(
                cv2.MORPH_ELLIPSE, (5, 5))), n=max(1, n_keep), min_frac=0.0005)
        rgba = T.rgba_from(img, m, feather=feather, erode=erode)
        if post:
            rgba = post(rgba)
        rgba = T.trim_square(rgba, size=size, pad=0.03, square=square)
        T.save_rgba(rgba, os.path.join(OUT, name + ".png"))
        return [name + ".png"], rgba.shape[1], rgba.shape[0]
    job(name, fn, purpose, True, notes, [src])


# ------------------------------------------------------------------ tileable surfaces
tile_job("rice_cooked_tile", "rice_mound/rice_mound_04.jpg", (0.24, 0.30, 0.70, 0.80),
         "cooked jasmine rice surface (plated rice, rice in pot / rice cooker)",
         "Real steamed Thai jasmine rice close-up, light flattened.", grade={"sat": 0.9, "contrast": 1.05})
tile_job("kaphrao_pork_tile", "pork_mince_tex/pork_mince_tex_01.jpg", (0.37, 0.36, 0.92, 0.82),
         "cooked minced pork in kaphrao sauce (glossy brown, chili bits, dark basil)",
         "Street-style dry kaphrao close-up; use on the stir-fry mass in the wok and on the plate.")
tile_job("kaphrao_full_tile", "kaphrao_close/kaphrao_close_03.jpg", (0.04, 0.06, 0.96, 0.94),
         "finished kaphrao surface with whole holy-basil leaves and long red chilies",
         "Top-down wok photo; brighter/greener than kaphrao_pork_tile (fresh basil just tossed in).")
tile_job("pork_minced_raw_tile", "pork_raw/pork_raw_03.jpg", (0.07, 0.58, 0.61, 0.96),
         "raw minced pork (market bag / tray / before cooking)",
         "Raw ground pork with fat flecks (from a butcher's ad photo, text-free region).", out=512)
tile_job("omelette_tile", "omelette/omelette_06.jpg", (0.10, 0.10, 0.90, 0.90),
         "Thai omelette (ไข่เจียว) fluffy surface with browned spots",
         "Omelette frying in a pan; for kai jiao top surface.")
tile_job("fried_rice_tile", "friedrice_top/friedrice_top_05.jpg", (0.02, 0.10, 0.98, 0.90),
         "khao phat (fried rice with egg, pork, kale, spring onion)", "Full-frame fried rice close-up.")
tile_job("noodles_phat_si_io_tile", "noodles_wide/noodles_wide_05.jpg", (0.10, 0.12, 0.95, 0.88),
         "wide rice noodles stir-fried with dark soy (ผัดซีอิ๊ว), also usable under rad na gravy",
         "Glossy brown sen yai with kale and egg.")
tile_job("phak_bung_tile", "morning_glory/morning_glory_01.jpg", (0.16, 0.16, 0.86, 0.80),
         "stir-fried morning glory (ผัดผักบุ้งไฟแดง)", "Plated pad pak boong close-up.")
tile_job("long_beans_cut_tile", "longbean_cut/longbean_cut_01.jpg", (0.02, 0.02, 0.98, 0.98),
         "raw yard-long beans cut into short pieces (prep tray / pad prik kaeng)", "Fills frame.")
tile_job("oil_frying_tile", "oil_bubbles/oil_bubbles_01.jpg", (0.03, 0.26, 0.33, 0.86),
         "hot frying oil with bubbles in a wok (deep-frying eggs / garlic)",
         "Use with additive blending / slight emissive for sizzling oil.", out=512, flat=0.5)
tile_job("rat_na_tile", "radna_top/radna_top_04.jpg", (0.10, 0.12, 0.90, 0.90),
         "rat na: wide noodles under glossy translucent gravy with kale/broccoli/carrot and pork",
         "Top view of rat na gravy surface.")
tile_job("garlic_cloves_tile", "garlic_clove_iso/garlic_clove_iso_01.jpg", (0.09, 0.04, 0.92, 0.74),
         "unpeeled Thai garlic cloves heap (market basket / prep tray)", "Thai small purple-skinned cloves.")
tile_job("cucumber_slices_tile", "cucumber_slices/cucumber_slices_05.jpg", (0.26, 0.02, 1.0, 0.47),
         "overlapping fresh cucumber slices (side garnish heap)", "Real cucumber slices.", out=768)


def _rice_mound():
    tile = T.load(os.path.join(OUT, "rice_cooked_tile.jpg"))
    S = 1024
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    r = np.sqrt((xx - S / 2) ** 2 + (yy - S / 2) ** 2) / (S * 0.47)
    # irregular outline
    ang = np.arctan2(yy - S / 2, xx - S / 2)
    rng = np.random.default_rng(5)
    wob = sum(rng.uniform(0.01, 0.03) * np.sin(k * ang + rng.uniform(0, 6)) for k in (3, 5, 7, 11, 17))
    rr = r * (1 + wob)
    alpha = np.clip((1.0 - rr) * 40, 0, 1)
    # dome shading: brighter top-left, AO towards rim, grains slightly compressed (spherical warp)
    z = np.sqrt(np.clip(1 - np.clip(rr, 0, 1) ** 2, 0, 1))
    k = 0.35
    sc = 1.7
    mapx = ((S / 2 + (xx - S / 2) * (1 - k * (1 - z))) * sc % S).astype(np.float32)
    mapy = ((S / 2 + (yy - S / 2) * (1 - k * (1 - z))) * sc % S).astype(np.float32)
    warped = cv2.remap(tile.astype(np.float32), mapx, mapy, cv2.INTER_CUBIC, borderMode=cv2.BORDER_WRAP)
    nx = (xx - S / 2) / (S * 0.47)
    ny = (yy - S / 2) / (S * 0.47)
    light = np.clip(0.78 + 0.26 * z - 0.14 * nx - 0.16 * ny, 0.5, 1.1)
    ao = np.clip(0.62 + 0.38 * z ** 0.7, 0, 1)
    rgb = warped * (light * ao)[..., None]
    rgba = np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8)
    T.save_rgba(rgba, os.path.join(OUT, "rice_mound_top.png"))
    return ["rice_mound_top.png"], S, S


job("rice_mound_top", _rice_mound, "top view of a scooped rice dome on a plate (alpha)", True,
    "Built from rice_cooked_tile with spherical warp, dome lighting and rim AO; irregular outline.",
    ["rice_mound/rice_mound_04.jpg"])



def _wood(img):
    hsv = cv2.cvtColor(np.clip(img, 0, 255).astype(np.uint8), cv2.COLOR_RGB2HSV)
    return (hsv[..., 0] >= 4) & (hsv[..., 0] <= 26) & (hsv[..., 1] > 60) & (hsv[..., 2] < 200)


def _garlic_mask(img):
    u8 = np.clip(img, 0, 255).astype(np.uint8)
    hsv = cv2.cvtColor(u8, cv2.COLOR_RGB2HSV)
    lab = cv2.cvtColor(u8, cv2.COLOR_RGB2LAB).astype(np.int32)
    m0 = ((lab[..., 2] > 136) & (hsv[..., 2] > 95)).astype(np.uint8)  # warm cream cloves vs cool grey plate
    m0 = cv2.morphologyEx(m0, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    m0 = cv2.morphologyEx(m0, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    H, W = m0.shape
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13))
    core = cv2.erode(m0, k)  # break thin bridges to slivers / shadows
    n, labl, stats, cents = cv2.connectedComponentsWithStats(core)
    keep = np.zeros_like(m0)
    for i in range(1, n):
        comp = labl == i
        if stats[i, cv2.CC_STAT_AREA] < m0.size * 0.0012 or cents[i][0] < W * 0.36 or hsv[..., 2][comp].mean() < 140:
            continue
        keep[comp] = 1
    keep = cv2.dilate(keep, k) & m0  # reconstruct clove outlines inside the original mask
    return T.fill_holes(keep)


cut_job("garlic_crushed", "garlic_crushed/garlic_crushed_05.jpg", "smashed / crushed peeled garlic cloves (กระเทียมทุบ)",
        "Real smashed cloves, colour-keyed from a grey plate (warm cream cloves kept).", mask_fn=_garlic_mask,
        n_keep=30, fill=False, erode=1, feather=1.0)
cut_job("garlic_bulbs_bunch", "garlic_white/garlic_white_01.jpg", "Thai garlic bulbs tied in a bunch (กระเทียมจุก, market)",
        "Purple-skinned Thai garlic heads with bamboo tie; white background removed.", thresh=228, erode=3)
cut_job("shrimp_raw_pile", "shrimp_raw/shrimp_raw_01.jpg", "raw peeled shrimp (กุ้งขาว) pile, for tom yum / stir-fries",
        "White background removed (caption area excluded).", crop_first=(0.0, 0.0, 1.0, 0.80), thresh=226, erode=2)
tile_job("phat_phrik_kaeng_tile", "../cand/dish_phatphrikkaeng/dish_phatphrikkaeng_02.jpg", (0.12, 0.12, 0.88, 0.80),
         "red curry stir-fry ผัดพริกแกงหมู (pork, long beans, red chili, glossy red-brown paste)",
         "Real plated pad prik kaeng close-up.")


def main():
    os.makedirs(OUT, exist_ok=True)
    names = sys.argv[1:] or list(JOBS)
    man_path = os.path.join(OUT, "manifest.json")
    man = {}
    if os.path.exists(man_path):
        man = {e["name"]: e for e in json.load(open(man_path, encoding="utf-8"))["textures"]}
    logs = {}
    for lp, prefix in [(os.path.join(SRC, "_log.jsonl"), ""),
                       (os.path.join(os.path.dirname(SRC), "cand", "_log.jsonl"), "../cand/")]:
        if os.path.exists(lp):
            for line in open(lp, encoding="utf-8"):
                d = json.loads(line)
                logs[prefix + d["file"]] = d
    for n in names:
        j = JOBS[n]
        files, w, h = j["fn"]()
        man[n] = {"name": n, "files": files, "purpose": j["purpose"], "alpha": j["alpha"], "size": [w, h],
                  "notes": j["notes"],
                  "sources": [{"file": s, "image_url": logs.get(s, {}).get("image", ""),
                               "page_url": logs.get(s, {}).get("page", "")} for s in j["sources"]],
                  "licence": "unknown (web photo, used per client instruction 2026-10-19)"}
        print("made", n, files, w, h, flush=True)
    data = {"note": "Food textures from real food photos. Tiles are seamless; PNGs are alpha cut-outs (top views "
                    "unless noted). Sizes in px.", "textures": [man[k] for k in sorted(man)]}
    json.dump(data, open(man_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
