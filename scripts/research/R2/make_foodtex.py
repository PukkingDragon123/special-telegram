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
    hsv = cv2.cvtColor(np.clip(img, 0, 255).astype(np.uint8), cv2.COLOR_RGB2HSV)
    m = ((hsv[..., 0] >= 8) & (hsv[..., 0] <= 45) & (hsv[..., 1] >= 14) & (hsv[..., 2] >= 100)).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    return m

# ------------------------------------------------------------------ cutouts (alpha)
cut_job("egg_fried_runny", "egg_top/egg_top_01.jpg", "ไข่ดาว sunny-side-up, runny glossy yolk, light golden edge",
        "Top view; background removed with GrabCut.", method="grabcut", rect=(0.01, 0.14, 0.995, 0.895))
cut_job("egg_fried_crispy", "egg_crispy/egg_crispy_03.jpg", "ไข่ดาวกรอบ: crispy lacy brown edge, runny yolk",
        "Street-style deep-fried egg; GrabCut from plate.", method="grabcut", rect=(0.11, 0.08, 0.89, 0.985))


def _burn(rgba):
    """Overcooked egg: soft masks only (no thresholds) -> char the browned lace, singe the white, dull the yolk."""
    f = rgba.astype(np.float32)
    rgb = f[..., :3] / 255.0
    a = f[..., 3:4]
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1e-3)
    # browned = warm & saturated & not too bright (lace); yolk = very saturated orange-yellow & bright
    warm = np.clip((r - b) * 2.2, 0, 1)
    brown = np.clip(warm * np.clip((sat - 0.25) * 2.5, 0, 1) * np.clip((0.95 - mx) * 3.0, 0, 1), 0, 1)
    yolk = np.clip((sat - 0.55) * 3, 0, 1) * np.clip((mx - 0.75) * 4, 0, 1) * np.clip((g - b) * 2, 0, 1)
    brown = np.clip(brown - yolk, 0, 1)
    brown = cv2.GaussianBlur(brown, (0, 0), 1.5)[..., None]
    yolk = cv2.GaussianBlur(yolk, (0, 0), 2.0)[..., None]
    S = rgb.shape[0]
    rng = np.random.default_rng(3)
    n = cv2.GaussianBlur(rng.random((S, S)).astype(np.float32), (0, 0), 2.5)
    n = (n - n.min()) / (n.max() - n.min() + 1e-6)
    char_amt = np.clip(brown * (0.75 + 0.6 * (n[..., None] - 0.5)), 0, 1)
    char_col = np.array([0.10, 0.065, 0.04], np.float32)
    out = rgb * (1 - char_amt) + char_col * char_amt
    # singe the whole white a little (tan) + darker towards the rim
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    rim = np.clip((np.sqrt((xx - S / 2) ** 2 + (yy - S / 2) ** 2) / (S * 0.5) - 0.35) / 0.6, 0, 1)[..., None]
    tan = np.array([0.86, 0.74, 0.58], np.float32)
    out = out * (1 - 0.35 * rim) + out * tan * 0.35 * rim
    # yolk: matte, set (less specular, flatter, slightly paler)
    yl = out.mean(axis=2, keepdims=True)
    flat_yolk = np.clip(out * 0.88 + 0.06, 0, 1)
    flat_yolk = np.minimum(flat_yolk, yl * 0 + 0.86)
    out = out * (1 - yolk * 0.8) + flat_yolk * yolk * 0.8
    return np.dstack([np.clip(out * 255, 0, 255), a]).astype(np.uint8)


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
        "White background removed (incl. gaps between leaves).", thresh=228, kill_white=True)


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
cut_job("long_beans_bundle", "longbean_cut/longbean_cut_04.jpg", "raw yard-long beans bundle (ถั่วฝักยาว)",
        "White background removed.", thresh=226)
cut_job("onion_slices", "onion_rings/onion_rings_01.jpg", "sliced onion rounds (raw)", "GrabCut from wooden board.",
        method="grabcut", rect=(0.08, 0.17, 0.93, 0.80), size=768, kill_fn=_wood, n_keep=3)
cut_job("shallots_sliced", "shallot_sliced/shallot_sliced_03.jpg", "sliced shallots (หอมแดงซอย)",
        "GrabCut from wooden board.", method="grabcut", rect=(0.06, 0.40, 0.84, 0.92))
cut_job("kale_leaf", "kale_leaf/kale_leaf_02.jpg", "Chinese kale leaf (คะน้า) for phat si-io / rat na",
        "White background removed.", thresh=226)


def _chili_singles():
    """Separate single chilies from a row photo (light background) -> red & green singles + 2x2 atlas."""
    img = T.load(P("chili_green_white/chili_green_white_02.jpg"))
    img = T.crop_n(img, (0.0, 0.19, 1.0, 0.975))
    u8 = np.clip(img, 0, 255).astype(np.uint8)
    hsv = cv2.cvtColor(u8, cv2.COLOR_RGB2HSV)
    fg = ((hsv[..., 1] > 70) & (hsv[..., 2] > 40)).astype(np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    # split touching chilies: markers from strongly eroded bodies, then watershed on the mask
    dist = cv2.distanceTransform(fg, cv2.DIST_L2, 5)
    markers_m = (dist > 0.45 * dist.max()).astype(np.uint8)
    nm, markers = cv2.connectedComponents(markers_m)
    markers = markers + 1  # background -> 1 (sure background), chili cores -> 2..n
    markers[(fg == 1) & (markers_m == 0)] = 0  # unknown band, flooded by watershed
    ws = cv2.watershed(u8.copy(), markers.astype(np.int32))
    lab = np.where(ws > 1, ws - 1, 0).astype(np.int32)
    n = int(lab.max()) + 1
    stats = np.zeros((n, 5), np.int64)
    for i in range(1, n):
        ys, xs = np.nonzero(lab == i)
        if len(xs):
            stats[i] = [xs.min(), ys.min(), xs.max() - xs.min() + 1, ys.max() - ys.min() + 1, len(xs)]
    H, W = fg.shape
    cands = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area < H * W * 0.004 or x <= 1 or x + w >= W - 1 or h < H * 0.30:
            continue
        m = (lab == i).astype(np.uint8)
        hue = np.median(hsv[..., 0][m > 0])
        col = "red" if (hue < 12 or hue > 165) else "green"
        cands.append((col, area, x, y, w, h, m))
    out_files = []
    picks = {"red": [], "green": []}
    for col in ("red", "green"):
        cs = sorted([c for c in cands if c[0] == col], key=lambda c: c[4] / max(1, c[5]))[:2]  # narrowest first
        for k, (_, area, x, y, w, h, m) in enumerate(cs):
            rgba = T.rgba_from(img, m, feather=1.0, erode=0)
            rgba = rgba[max(0, y - 6):y + h + 6, max(0, x - 6):x + w + 6]
            rgba = T.trim_square(rgba, size=512, pad=0.04, square=True)
            picks[col].append(rgba)
    for col in ("red", "green"):
        if picks[col]:
            T.save_rgba(picks[col][0], os.path.join(OUT, f"chili_{col}_single.png"))
            out_files.append(f"chili_{col}_single.png")
    cells = picks["red"][:2] + picks["green"][:2]
    if len(cells) == 4:
        atlas = np.zeros((1024, 1024, 4), np.uint8)
        for i, c in enumerate(cells):
            atlas[(i // 2) * 512:(i // 2) * 512 + 512, (i % 2) * 512:(i % 2) * 512 + 512] = c
        T.save_rgba(atlas, os.path.join(OUT, "chili_singles_atlas.png"))
        out_files.append("chili_singles_atlas.png")
    return out_files, 512, 512


job("chili_singles", _chili_singles, "single bird's-eye chilies (red + green) and a 2x2 atlas (R,R / G,G)", True,
    "Individually separated from a row photo of fresh Thai chilies (stem up).",
    ["chili_green_white/chili_green_white_02.jpg"])


def _tomyum_top():
    img = T.load(P("tomyum_surface/tomyum_surface_02.jpg"))
    H, W = img.shape[:2]
    cx, cy, rx, ry = 0.555 * W, 0.565 * H, 0.300 * W, 0.262 * H
    m = np.zeros((H, W), np.uint8)
    cv2.ellipse(m, (int(cx), int(cy)), (int(rx), int(ry)), 0, 0, 360, 1, -1)
    rgba = T.rgba_from(img, m, feather=3.0, erode=2, decontam=False)
    crop = rgba[int(cy - ry):int(cy + ry), int(cx - rx):int(cx + rx)]
    from PIL import Image
    im = Image.fromarray(crop, "RGBA").resize((1024, 1024), Image.LANCZOS)
    arr = np.asarray(im)
    T.save_rgba(arr, os.path.join(OUT, "tomyum_bowl_top.png"))
    return ["tomyum_bowl_top.png"], 1024, 1024


job("tomyum_bowl_top", _tomyum_top, "tom yum (น้ำข้น-style, orange-red) soup surface with ingredients, circular (alpha)",
    True, "Inner circle of a real bowl photo, rescaled to a circle; place on the soup plane inside a bowl.",
    ["tomyum_surface/tomyum_surface_02.jpg"])


def _burnt_char():
    tile = T.load(os.path.join(OUT, "kaphrao_pork_tile.jpg"))
    g = tile.mean(axis=2, keepdims=True) / 255
    rng = np.random.default_rng(11)
    n = cv2.GaussianBlur(rng.random(tile.shape[:2]).astype(np.float32), (0, 0), 6)
    n = ((n - n.min()) / (n.max() - n.min()))[..., None]
    char = np.array([22, 14, 9], np.float32)
    ember = np.array([110, 52, 20], np.float32)
    out = char * (1 - g) + ember * g * 0.9
    out = out * (0.75 + 0.5 * n) + (g ** 3) * 60
    T.save_rgb(out, os.path.join(OUT, "burnt_char_tile.jpg"))
    nm = T.normal_from(out, strength=3.0)
    T.save_rgb(nm, os.path.join(OUT, "burnt_char_tile_n.jpg"))
    return ["burnt_char_tile.jpg", "burnt_char_tile_n.jpg"], tile.shape[1], tile.shape[0]


job("burnt_char_tile", _burnt_char, "charred / burnt stir-fry surface (blend over any food as burnt-ness rises)", False,
    "Derived from the real kaphrao_pork_tile (same grain structure) charred to black-brown with ember tones. Seamless.",
    ["pork_mince_tex/pork_mince_tex_01.jpg"])


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
