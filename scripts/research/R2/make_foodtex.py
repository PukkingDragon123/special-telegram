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
            post=None, fill=True, erode=1, feather=1.2, sat_max=40, square=True, crop_first=None):
    def fn():
        img = T.load(P(src))
        if crop_first:
            img = T.crop_n(img, crop_first)
        if method == "white":
            m = T.mask_white_bg(img, thresh=thresh, sat_max=sat_max)
        else:
            m = T.mask_grabcut(img, rect)
        m = T.keep_largest(m, n=n_keep)
        if fill:
            m = T.fill_holes(m)
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
tile_job("kaphrao_pork_tile", "pork_mince_tex/pork_mince_tex_01.jpg", (0.30, 0.30, 0.86, 0.80),
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
tile_job("fried_rice_tile", "friedrice_close/friedrice_close_01.jpg", (0.12, 0.33, 0.88, 0.86),
         "khao phat (fried rice with egg, kale bits)", "Plated fried rice close-up.")
tile_job("noodles_phat_si_io_tile", "noodles_wide/noodles_wide_05.jpg", (0.10, 0.12, 0.95, 0.88),
         "wide rice noodles stir-fried with dark soy (ผัดซีอิ๊ว), also usable under rad na gravy",
         "Glossy brown sen yai with kale and egg.")
tile_job("phak_bung_tile", "morning_glory/morning_glory_01.jpg", (0.16, 0.16, 0.86, 0.80),
         "stir-fried morning glory (ผัดผักบุ้งไฟแดง)", "Plated pad pak boong close-up.")
tile_job("long_beans_cut_tile", "longbean_cut/longbean_cut_01.jpg", (0.02, 0.02, 0.98, 0.98),
         "raw yard-long beans cut into short pieces (prep tray / pad prik kaeng)", "Fills frame.")
tile_job("oil_frying_tile", "oil_pan/oil_pan_05.jpg", (0.26, 0.20, 0.80, 0.82),
         "hot frying oil with bubbles in a black wok (deep-frying eggs / garlic)",
         "Use with additive blending/emissive tweak for sizzling oil.", out=512, flat=0.5)
tile_job("burnt_residue_tile", "char_wok/char_wok_03.jpg", (0.30, 0.30, 0.75, 0.75),
         "burnt / charred food residue (wok bottom, overcooked garlic or rice)",
         "Real scorched pan residue; multiply over food when burnt-ness is high.", out=512, flat=0.6)


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
    mapx = (S / 2 + (xx - S / 2) * (1 - k * (1 - z))).astype(np.float32)
    mapy = (S / 2 + (yy - S / 2) * (1 - k * (1 - z))).astype(np.float32)
    warped = cv2.remap(tile.astype(np.float32), mapx, mapy, cv2.INTER_CUBIC, borderMode=cv2.BORDER_WRAP)
    nx = (xx - S / 2) / (S * 0.47)
    ny = (yy - S / 2) / (S * 0.47)
    light = np.clip(0.80 + 0.22 * z - 0.10 * nx - 0.12 * ny, 0.55, 1.08)
    ao = np.clip(0.55 + 0.45 * z ** 0.6, 0, 1)
    rgb = warped * (light * ao)[..., None]
    rgba = np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8)
    T.save_rgba(rgba, os.path.join(OUT, "rice_mound_top.png"))
    return ["rice_mound_top.png"], S, S


job("rice_mound_top", _rice_mound, "top view of a scooped rice dome on a plate (alpha)", True,
    "Built from rice_cooked_tile with spherical warp, dome lighting and rim AO; irregular outline.",
    ["rice_mound/rice_mound_04.jpg"])

# ------------------------------------------------------------------ cutouts (alpha)
cut_job("egg_fried_runny", "egg_top/egg_top_01.jpg", "ไข่ดาว sunny-side-up, runny glossy yolk, light golden edge",
        "Top view, white background removed.", thresh=226)
cut_job("egg_fried_crispy", "egg_crispy/egg_crispy_03.jpg", "ไข่ดาวกรอบ: crispy lacy brown edge, runny yolk",
        "Street-style deep-fried egg; GrabCut from plate.", method="grabcut", rect=(0.11, 0.08, 0.89, 0.985))


def _burn(rgba):
    f = rgba.astype(np.float32)
    rgb = f[..., :3]
    a = f[..., 3:4]
    hsv = cv2.cvtColor(np.clip(rgb, 0, 255).astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)
    lum = rgb.mean(axis=2, keepdims=True)
    brownish = ((hsv[..., 0] < 25) & (hsv[..., 1] > 60)).astype(np.float32)[..., None]
    # char the brown lace hard, singe everything a bit, add black speckles near the rim
    S = rgb.shape[0]
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    rim = np.clip((np.sqrt((xx - S / 2) ** 2 + (yy - S / 2) ** 2) / (S * 0.5) - 0.45) / 0.5, 0, 1)[..., None]
    rng = np.random.default_rng(3)
    spk = (cv2.GaussianBlur(rng.random((S, S)).astype(np.float32), (0, 0), 3) > 0.53).astype(np.float32)[..., None]
    char = np.array([28, 18, 12], np.float32)
    burnt = rgb * (1 - 0.85 * brownish) + char * 0.85 * brownish
    burnt = burnt * (1 - 0.55 * rim * spk) + char * 0.55 * rim * spk
    burnt = burnt * np.array([0.93, 0.86, 0.78]) * (0.92 + 0.08 * (lum / 255))
    # overcooked yolk: matte, paler, hard
    yolk = ((hsv[..., 0] > 10) & (hsv[..., 0] < 30) & (hsv[..., 1] > 150)).astype(np.float32)[..., None]
    pale = np.array([238, 170, 60], np.float32)
    burnt = burnt * (1 - 0.45 * yolk) + pale * 0.45 * yolk
    return np.dstack([np.clip(burnt, 0, 255), a]).astype(np.uint8)


job("egg_fried_burnt", lambda: _derive("egg_fried_crispy", "egg_fried_burnt", _burn),
    "burnt ไข่ดาว (overcooked: charred black lace, hard pale yolk)", True,
    "Derived from egg_fried_crispy by charring the browned regions and drying the yolk.",
    ["egg_crispy/egg_crispy_03.jpg"])


def _derive(src_name, name, fn):
    from PIL import Image
    im = np.asarray(Image.open(os.path.join(OUT, src_name + ".png")).convert("RGBA"))
    out = fn(im)
    T.save_rgba(out, os.path.join(OUT, name + ".png"))
    return [name + ".png"], out.shape[1], out.shape[0]


cut_job("omelette_whole", "omelette/omelette_01.jpg", "whole crispy Thai omelette (ไข่เจียว) disc, top view",
        "GrabCut from a floral plate.", method="grabcut", rect=(0.04, 0.17, 0.985, 0.955))
cut_job("basil_sprig_fresh", "basil_leaf/basil_leaf_02.jpg", "fresh holy basil sprig with flower spike",
        "White background removed.", thresh=228)
cut_job("basil_bunch_fresh", "basil_leaf/basil_leaf_01.jpg", "fresh holy basil bunch (market กำ)",
        "White background removed.", thresh=228)


def _wilt(rgba):
    f = rgba.astype(np.float32)
    rgb = f[..., :3]
    a = f[..., 3]
    hsv = cv2.cvtColor(np.clip(rgb, 0, 255).astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)
    hsv[..., 0] = np.clip(hsv[..., 0] * 0.92 + 2, 0, 179)  # slightly olive
    hsv[..., 1] = np.clip(hsv[..., 1] * 0.95, 0, 255)
    hsv[..., 2] = np.clip(hsv[..., 2] * 0.50, 0, 255)  # cooked basil goes dark
    rgb2 = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2RGB).astype(np.float32)
    # oily sheen + brown sauce stain at edges
    S = rgb.shape[0]
    rng = np.random.default_rng(7)
    sheen = cv2.GaussianBlur(rng.random((S, S)).astype(np.float32), (0, 0), 6)
    sheen = np.clip((sheen - 0.55) * 6, 0, 1)[..., None] * 60
    edge = cv2.GaussianBlur((a > 128).astype(np.float32), (0, 0), 6)
    stain = np.clip(1 - edge, 0, 1)[..., None] * (a[..., None] > 0)
    rgb2 = rgb2 + sheen
    rgb2 = rgb2 * (1 - 0.6 * stain) + np.array([90, 50, 20]) * 0.6 * stain
    # limp: shrink & droop with a gentle warp
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    mapx = xx + 6 * np.sin(yy / S * 6.0)
    mapy = yy - 10 * np.sin(xx / S * 3.0) - 0.04 * (yy - S / 2)
    out = np.dstack([np.clip(rgb2, 0, 255), a]).astype(np.float32)
    out = cv2.remap(out, mapx.astype(np.float32), mapy.astype(np.float32), cv2.INTER_LINEAR,
                    borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    return np.clip(out, 0, 255).astype(np.uint8)


job("basil_sprig_cooked", lambda: _derive("basil_sprig_fresh", "basil_sprig_cooked", _wilt),
    "wilted / stir-fried holy basil sprig (dark, glossy, limp)", True,
    "Derived from basil_sprig_fresh: darkened olive, oil sheen, sauce-stained edges, droop warp.",
    ["basil_leaf/basil_leaf_02.jpg"])
job("basil_bunch_cooked", lambda: _derive("basil_bunch_fresh", "basil_bunch_cooked", _wilt),
    "wilted basil mass (overcooked / soggy basil)", True, "Derived from basil_bunch_fresh like basil_sprig_cooked.",
    ["basil_leaf/basil_leaf_01.jpg"])
cut_job("chili_red_bunch", "chili_red/chili_red_04.jpg", "red bird's-eye chilies (handful, with stems)",
        "White background removed (advert caption area excluded).", crop_first=(0.0, 0.0, 1.0, 0.80), thresh=226)
cut_job("chili_green_pile", "chili_green_white/chili_green_white_01.jpg", "green bird's-eye chilies pile",
        "White background removed.", thresh=226)
cut_job("garlic_minced_pile", "garlic_chopped/garlic_chopped_05.jpg", "minced garlic heap (กระเทียมสับ)",
        "White background removed.", thresh=226, n_keep=1)
cut_job("garlic_crushed", "garlic_crushed/garlic_crushed_05.jpg", "crushed (smashed) peeled garlic cloves",
        "GrabCut from a plate.", method="grabcut", rect=(0.03, 0.02, 0.99, 0.98))
cut_job("long_beans_bundle", "longbean_cut/longbean_cut_04.jpg", "raw yard-long beans bundle (ถั่วฝักยาว)",
        "White background removed.", thresh=226)
cut_job("onion_slices", "onion_rings/onion_rings_01.jpg", "sliced onion rounds (raw)", "GrabCut from wooden board.",
        method="grabcut", rect=(0.08, 0.17, 0.93, 0.80), size=768)
cut_job("shallots_sliced", "shallot_sliced/shallot_sliced_03.jpg", "sliced shallots (หอมแดงซอย)",
        "GrabCut from wooden board.", method="grabcut", rect=(0.06, 0.40, 0.84, 0.92))
cut_job("kale_leaf", "kale_leaf/kale_leaf_02.jpg", "Chinese kale leaf (คะน้า) for phat si-io / rat na",
        "White background removed.", thresh=226)


def main():
    os.makedirs(OUT, exist_ok=True)
    names = sys.argv[1:] or list(JOBS)
    man_path = os.path.join(OUT, "manifest.json")
    man = {}
    if os.path.exists(man_path):
        man = {e["name"]: e for e in json.load(open(man_path, encoding="utf-8"))["textures"]}
    logs = {}
    for lp in [os.path.join(SRC, "_log.jsonl")]:
        if os.path.exists(lp):
            for line in open(lp, encoding="utf-8"):
                d = json.loads(line)
                logs[d["file"]] = d
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
