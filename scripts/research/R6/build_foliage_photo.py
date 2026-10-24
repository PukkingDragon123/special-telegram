#!/usr/bin/env python3
"""R6-pbr: alpha-cutout foliage cards cut from REAL photos (Wikimedia Commons / Flickr via Openverse).

Usage: python3 -I build_foliage_photo.py [card_id ...]
Output: public/assets/textures/foliage/<id>/{albedo.png,normal.jpg}; entries in out/foliage_manifest_build.json
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cv2  # noqa: E402
import numpy as np  # noqa: E402

import foliage_lib as F  # noqa: E402
import photo_cutout as PC  # noqa: E402
import r6lib as L  # noqa: E402

CM = os.path.join(L.CACHE, "commons")
OV = os.path.join(L.CACHE, "openverse")


def meta_commons(set_name, idx):
    sel = json.load(open(os.path.join(CM, f"{set_name}_selected.json")))
    r = sel[str(idx)]
    return dict(file=r["file"], url=r["descurl"], author=r.get("artist") or "unknown", license=r["license"], title=r["title"])


def meta_ov(set_name, idx):
    sel = json.load(open(os.path.join(OV, f"{set_name}_selected.json")))
    r = sel[str(idx)]
    lic = {"by": "CC BY", "by-sa": "CC BY-SA", "pdm": "Public Domain Mark", "cc0": "CC0"}.get(r["license"], r["license"])
    if r["license"] in ("by", "by-sa"):
        lic += " " + str(r.get("license_version") or "")
    return dict(file=r["file"], url=r["landing"], author=r.get("creator") or "unknown", license=lic.strip(), title=r.get("title") or "")


def fit_canvas(rgb, a, out_w, out_h, margin=0.03, anchor="bottom"):
    """Scale cutout to fit the output canvas keeping aspect; place by anchor."""
    h, w = a.shape
    s = min(out_w * (1 - 2 * margin) / w, out_h * (1 - 2 * margin) / h)
    nw, nh = max(1, int(w * s)), max(1, int(h * s))
    rgb = cv2.resize(rgb.astype(np.float32), (nw, nh), interpolation=cv2.INTER_AREA)
    a = np.clip(cv2.resize(a.astype(np.float32), (nw, nh), interpolation=cv2.INTER_AREA), 0, 1)
    C = np.zeros((out_h, out_w, 3), np.float32)
    A = np.zeros((out_h, out_w), np.float32)
    x0 = (out_w - nw) // 2
    if anchor == "bottom":
        y0 = out_h - nh - int(out_h * margin * 0.3)
    elif anchor == "top":
        y0 = int(out_h * margin * 0.3)
    else:
        y0 = (out_h - nh) // 2
    if anchor == "left":
        x0, y0 = int(out_w * margin * 0.3), (out_h - nh) // 2
    if anchor == "right":
        x0, y0 = out_w - nw - int(out_w * margin * 0.3), (out_h - nh) // 2
    C[y0:y0 + nh, x0:x0 + nw] = rgb
    A[y0:y0 + nh, x0:x0 + nw] = a
    return C, A


def finish(cid, img01, alpha, meta, man, out=(1024, 1024), anchor="bottom", pivot=(0.5, 0.0), size_m=(1, 1), tags=(), note="",
           keep=1, min_frac=0.02, crop=None, rot90=0, normal_strength=1.6, greenfix=False):
    a = alpha.astype(np.float32)
    rgb = img01.astype(np.float32) * 255.0
    if greenfix:   # remove blue sky cast from green foliage (white-balance edit of the photo)
        r_, g_, b_ = rgb[..., 0], rgb[..., 1], rgb[..., 2]
        rgb[..., 2] = np.where(b_ > g_ * 0.92, g_ * 0.92, b_)
        rgb[..., 0] = np.where(r_ > g_ * 1.05, r_, np.maximum(r_, g_ * 0.75 * (b_ > g_)))
    if crop:
        H, W = a.shape
        x0, y0, x1, y1 = crop
        sl = (slice(int(y0 * H), int(y1 * H)), slice(int(x0 * W), int(x1 * W)))
        a, rgb = a[sl], rgb[sl]
    if keep:
        a = PC.largest_components(a, keep, min_frac)
    a = PC.remove_small(a, 40)
    for _ in range(rot90 % 4):
        a, rgb = np.rot90(a), np.rot90(rgb)
    a, rgb = np.ascontiguousarray(a), np.ascontiguousarray(rgb)
    ys, xs = np.nonzero(a > 0.05)
    pad = 6
    y0, y1 = max(0, ys.min() - pad), min(a.shape[0], ys.max() + pad)
    x0, x1 = max(0, xs.min() - pad), min(a.shape[1], xs.max() + pad)
    a, rgb = a[y0:y1, x0:x1], rgb[y0:y1, x0:x1]
    rgb = PC.interior_bleed(rgb, a, 2)
    C, A = fit_canvas(rgb, a, out[0], out[1], anchor=anchor)
    C = F.bleed(np.clip(C, 0, 255), A)
    n = PC.photo_normal(C / 255.0, A, normal_strength)
    e = dict(widthMeters=size_m[0], heightMeters=size_m[1], pivot=list(pivot), alphaTest=0.5, tags=list(tags),
             source=f"photo: '{meta['title']}'", sourceUrl=meta["url"], author=meta["author"], license=meta["license"],
             note=(note + " Cut out from a real photo; normal map derived from photo luminance.").strip())
    F.save_card(cid, C, A, n, e, man)
    print("card", cid, out, flush=True)


# ----------------------------------------------------------------------------- keys
def key_sky(path, max_side=1600, t0=0.10, t1=0.22):
    img = PC.load_rgb(path, max_side)
    a, fg, _ = PC.sky_key(img, t0, t1)
    return fg, a


def key_white(path, max_side=1600):
    img = PC.load_rgb(path, max_side)
    mx = img.max(-1)
    mn = img.min(-1)
    sat = (mx - mn) / (mx + 1e-6)
    d = np.clip((0.93 - mx) / 0.18, 0, 1) + np.clip((sat - 0.10) / 0.2, 0, 1)
    a = np.clip(d, 0, 1)
    gray = (img @ np.array([0.299, 0.587, 0.114], np.float32)).astype(np.float32)
    a = PC.guided_filter(gray, a.astype(np.float32), 2, 1e-3)
    a = np.clip((a - 0.1) / 0.8, 0, 1)
    fg = PC.decontaminate(img, a, np.ones_like(img))
    return fg, a


def key_green(path, max_side=1920, close_vertical=0, hue=(18, 50), sat_min=0.2, refine=True):
    img = PC.load_rgb(path, max_side)
    m = PC.green_key(img, hue[0], hue[1], sat_min)
    if close_vertical:
        k = cv2.getStructuringElement(cv2.MORPH_RECT, (1, close_vertical))
        m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, k).astype(np.float32)
    if refine:
        m = PC.grabcut_refine(img, m, 4, 10)
    a = PC.soft_edge(img, m, 2, 2e-3)
    return img, a


def key_not_brick(path, max_side=1600):
    """Morning glory / vine on a red brick wall: seed FG by green/blue hues, BG by brick-red hue, refine with GrabCut."""
    img = PC.load_rgb(path, max_side)
    hsv = cv2.cvtColor((img * 255).astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)
    h, s, v = hsv[..., 0], hsv[..., 1] / 255, hsv[..., 2] / 255
    green = (h > 25) & (h < 95) & (s > 0.25) & (v > 0.15)
    bluef = (h > 95) & (h < 150) & (s > 0.12) & (v > 0.35)
    brick = ((h < 14) | (h > 165)) & (s > 0.35)
    gc = np.full(img.shape[:2], cv2.GC_PR_BGD, np.uint8)
    gc[brick] = cv2.GC_BGD
    fg = cv2.erode((green | bluef).astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    gc[fg] = cv2.GC_FGD
    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    cv2.grabCut((img * 255).astype(np.uint8)[..., ::-1].copy(), gc, None, bgd, fgd, 5, cv2.GC_INIT_WITH_MASK)
    m = ((gc == cv2.GC_FGD) | (gc == cv2.GC_PR_FGD)).astype(np.float32)
    a = PC.soft_edge(img, m, 2, 2e-3)
    return img, a


# ----------------------------------------------------------------------------- cards
def banana_whole(man):
    m = meta_commons("banana", 27)
    img, a = key_green(m["file"], 1920, close_vertical=31, hue=(20, 48), sat_min=0.25)
    # the photo shows a hand holding the leaf at the bottom: cut it off below the leaf edge
    finish("banana_leaf_whole", img, a, m, man, out=(1024, 512), anchor="left", pivot=(0.0, 0.5), size_m=(2.2, 1.1),
           tags=["banana", "leaf", "tropical", "whole", "card"], note="Leaf base at the left edge (attach to petiole/pseudostem).",
           keep=1)


def banana_torn(man):
    m = meta_commons("banana", 44)
    fg, a = key_sky(m["file"], 1920, 0.12, 0.24)
    finish("banana_leaf_torn", fg, a, m, man, out=(1024, 1024), anchor="center", pivot=(0.85, 0.15), size_m=(1.8, 1.8),
           tags=["banana", "leaf", "torn", "tattered", "backlit", "tropical", "card"],
           note="Wind-shredded banana leaf seen from below; midrib runs to the lower right.", keep=1, crop=(0.0, 0.0, 0.79, 0.86))


def bamboo_sky(man):
    m = meta_ov("ov_bamboo", 39)
    fg, a = key_sky(m["file"])
    finish("bamboo_leaves_branch", fg, a, m, man, out=(1024, 1024), anchor="right", pivot=(1.0, 0.75), size_m=(1.6, 1.6),
           tags=["bamboo", "leaves", "branch", "rural", "canal", "card"], note="Branch enters from the right edge.", keep=3, min_frac=0.01, greenfix=True)


def bamboo_white(man):
    m = meta_ov("ov_bamboo", 25)
    fg, a = key_white(m["file"])
    finish("bamboo_leaves_spray", fg, a, m, man, out=(1024, 1024), anchor="bottom", pivot=(0.5, 0.0), size_m=(1.4, 1.2),
           tags=["bamboo", "leaves", "spray", "bush", "card"], keep=6, min_frac=0.002)


def coconut_frond(man):
    m = meta_commons("coconut", 41)
    fg, a = key_sky(m["file"], 1920, 0.09, 0.2)
    finish("coconut_frond", fg, a, m, man, out=(1024, 1024), anchor="top", pivot=(0.2, 1.0), size_m=(3.0, 3.0),
           tags=["coconut", "palm", "frond", "leaflets", "tropical", "card"], keep=4, min_frac=0.005,
           note="Hanging coconut frond leaflets against the sky (frond enters from the top-left).", greenfix=True)


def coconut_crown(man):
    m = meta_ov("ov_coconut", 12)
    fg, a = key_sky(m["file"], 1600, 0.13, 0.27)
    fg = np.clip(fg * 1.15, 0, 1)   # mild exposure lift (backlit photo)
    finish("coconut_palm_crown", fg, a, m, man, out=(1024, 1024), anchor="bottom", pivot=(0.5, 0.02), size_m=(7.0, 7.0),
           tags=["coconut", "palm", "tree", "crown", "distant", "billboard", "tropical"],
           note="Complete coconut palm crown (Malaysian roadside palm); pivot = top of trunk, pair with a trunk mesh using polyhaven palm_bark.",
           keep=1, crop=(0.22, 0.0, 1.0, 0.47), greenfix=True)


def bougainvillea_a(man):
    m = meta_commons("bougainvillea", 71)
    fg, a = key_sky(m["file"], 1600, 0.10, 0.22)
    finish("bougainvillea_branch", fg, a, m, man, out=(1024, 1024), anchor="top", pivot=(0.1, 1.0), size_m=(1.0, 1.0),
           tags=["bougainvillea", "flowers", "magenta", "pink", "branch", "wall-top", "card"], keep=3, min_frac=0.01,
           note="Magenta bougainvillea spray hanging from the top-left.")


def bougainvillea_cluster(man):
    m = meta_commons("bougainvillea", 61)
    fg, a = key_sky(m["file"], 1600, 0.10, 0.22)
    finish("bougainvillea_cluster", fg, a, m, man, out=(1024, 1024), anchor="left", pivot=(0.0, 0.5), size_m=(1.6, 1.6),
           tags=["bougainvillea", "flowers", "magenta", "bush", "dense", "card"], keep=6, min_frac=0.002)


def bougainvillea_red(man):
    m = meta_commons("bougainvillea", 69)
    fg, a = key_sky(m["file"], 1600, 0.10, 0.22)
    finish("bougainvillea_red", fg, a, m, man, out=(1024, 1024), anchor="bottom", pivot=(0.5, 0.0), size_m=(1.4, 1.4),
           tags=["bougainvillea", "flowers", "red", "bush", "card"], keep=8, min_frac=0.002)


def morning_glory(man):
    m = meta_ov("ov_morningglory", 20)
    img, a = key_not_brick(m["file"])
    finish("morning_glory_vine", img, a, m, man, out=(1024, 512), anchor="center", pivot=(0.5, 0.5), size_m=(1.0, 0.5),
           tags=["morning-glory", "ipomoea", "vine", "flower", "blue", "fence", "chain-link", "card"], keep=2, min_frac=0.02,
           note="Morning glory twining on a rusty chain-link fence (wire included).")


def vines_ivy(man):
    m = meta_ov("ov_vines", 11)
    img, a = key_green(m["file"], 1600, 0, hue=(25, 95), sat_min=0.18)
    finish("hanging_vines_ivy", img, a, m, man, out=(1024, 1024), anchor="top", pivot=(0.5, 1.0), size_m=(1.5, 1.5),
           tags=["vines", "ivy", "hanging", "wall", "gate", "card"], keep=0, crop=(0.35, 0.0, 1.0, 1.0),
           note="Ivy curtain hanging from a wall top (pivot = top centre).")


def vines_cascade(man):
    m = meta_ov("ov_vines", 12)
    img, a = key_green(m["file"], 1600, 0, hue=(22, 80), sat_min=0.22)
    finish("hanging_vines_cascade", img, a, m, man, out=(512, 1024), anchor="top", pivot=(0.5, 1.0), size_m=(0.6, 1.2),
           tags=["vines", "hanging", "cascade", "wall", "balcony", "card"], keep=1, crop=(0.0, 0.36, 1.0, 1.0),
           note="Creeper cascading down a wall from a planter (pivot = top centre).")


CARDS = {
    "banana_leaf_whole": banana_whole,
    "banana_leaf_torn": banana_torn,
    "bamboo_leaves_branch": bamboo_sky,
    "bamboo_leaves_spray": bamboo_white,
    "coconut_frond": coconut_frond,
    "coconut_palm_crown": coconut_crown,
    "bougainvillea_branch": bougainvillea_a,
    "bougainvillea_cluster": bougainvillea_cluster,
    "bougainvillea_red": bougainvillea_red,
    "morning_glory_vine": morning_glory,
    "hanging_vines_ivy": vines_ivy,
    "hanging_vines_cascade": vines_cascade,
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
