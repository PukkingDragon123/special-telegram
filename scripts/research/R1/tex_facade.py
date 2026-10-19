"""R1-streets: facade / wall / roofing materials for Thai shophouses.

Photo-derived (CC Flickr / Commons, see credits) + CC0 Poly Haven detail + procedural grime.
usage: python3 -I tex_facade.py [job ...]
"""
import json
import math
import os
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texlib import *  # noqa

FULL = RAW + "/full"
MAN = {}
N = 1024


def photo(cid):
    return load(f"{FULL}/{cid}.jpg")


def crop_sq(a, x0, y0, size):
    return a[y0:y0 + size, x0:x0 + size]


def detail_transfer(a, src="concrete_wall_006", amount=0.35, scale=1.0, seed=0):
    """Add CC0 scan high-frequency detail to an upscaled photo (keeps it crisp)."""
    h, w = a.shape[:2]
    d = ph(src, "diff", int(1024 * scale))
    d = tile_to(np.roll(d, seed * 131, (0, 1)), w, h)
    l = lum(d)
    hp = l - blur(l, 3)
    return np.clip(a + hp[..., None] * amount, 0, 1)


def photo_height(a, sigma=6, invert=False):
    l = lum(a)
    h = l - blur(l, sigma)
    h = (h - h.min()) / (h.max() - h.min() + 1e-6)
    return 1 - h if invert else h


def write_pbr(name, alb, hgt, rough, ao=None, metal=None, nstr=4.0, meta=None, wrap=True, q=88):
    nrm = height_to_normal(hgt, nstr, wrap=wrap)
    if ao is None:
        ao = np.clip(1 - (blur(hgt, 5, wrap) - hgt) * 3.0, 0.4, 1)
    if metal is None:
        metal = np.zeros_like(rough)
    save_jpg(alb, f"{OUT_TEX}/{name}_albedo.jpg", q)
    save_jpg(nrm, f"{OUT_TEX}/{name}_normal.jpg", 92)
    save_jpg(np.dstack([ao, rough, metal]), f"{OUT_TEX}/{name}_orm.jpg", 88)
    if meta:
        meta = dict(meta)
        meta.setdefault("maps", ["albedo", "normal", "orm"])
        meta.setdefault("size", f"{alb.shape[1]}x{alb.shape[0]}")
        MAN[name] = meta
    print("wrote", name)


def black_streaks(h, w, seed, density=0.5, length=0.6, strength=0.6):
    """Bangkok-style black mould / water streaks running down from ledges."""
    r = np.random.default_rng(seed)
    src = np.zeros((h, w), np.float32)
    # sources along a few 'ledges' (top edge + random heights)
    ledges = [0] + list(r.uniform(0.15, 0.7, 2) * h)
    for ly in ledges:
        ly = int(ly)
        row = smoothstep(1 - density, 1.0, fbm(1, w, 1.2, seed=int(r.integers(9999)))[0])
        src[ly:ly + 6, :] = np.maximum(src[ly:ly + 6, :], row[None, :])
    streak = motion_blur_v(src, int(h * length), wrap=False)
    streak = streak / (streak.max() + 1e-6)
    # break streaks up and add drips
    n = fbm(h, w, 1.6, seed=seed + 1)
    streak = np.clip(streak * (0.6 + 0.8 * n), 0, 1)
    # vertical fine variation
    vn = np.repeat(fbm(1, w, 0.8, seed=seed + 2), h, 0)
    streak *= 0.7 + 0.6 * vn
    return np.clip(streak * strength, 0, 1)


# ------------------------------------------------------------------ walls
def wall_from_photo(name, cid, box, purpose, tint=None, detail="concrete_wall_006", sat=0.95,
                    real=2.0, seamless=True, extra=None, src_lic=None):
    a = photo(cid)
    x0, y0, x1, y1 = box
    a = a[y0:y1, x0:x1]
    a = cv2.resize(a, (N, N), interpolation=cv2.INTER_LANCZOS4)
    a = np.clip(a, 0, 1)
    a = gray_world(a, 0.25)
    if seamless:
        a = make_seamless(a, 0.22)
    a = detail_transfer(a, detail, 0.25)
    if tint is not None:
        a = tint_fn(a, tint)
    a = saturation(a, sat)
    hgt = photo_height(a, 8)
    rough = np.clip(0.75 + (0.5 - lum(a)) * 0.3, 0.4, 1)
    if extra:
        a, hgt, rough = extra(a, hgt, rough)
    write_pbr(name, a, hgt, rough, nstr=3.0, meta={"purpose": purpose, "alpha": False, "tiling": True,
                                                    "real_world_m": [real, real], "source": cid})


def tint_fn(a, t):
    return a * np.array(t, np.float32)


def walls():
    wall_from_photo("wall_peeling_paint_orange", "c4b0adb7", (150, 0, 833, 683),
                    "Orange-terracotta painted render flaking off in crusts (old shophouse side walls, "
                    "temple-area lanes). Tileable.", real=1.5)
    wall_from_photo("wall_peeling_paint_teal", "2952c113", (240, 60, 960, 780),
                    "Teal painted wall with paint flaking to bare plaster and a faint marker tag; typical "
                    "Thai mint/teal shophouse paint gone tired.", real=1.5)

    def red_extra(a, h, r):
        return a, h, r
    wall_from_photo("wall_peeling_paint_red_over_cream", "4985c871", (0, 120, 683, 803),
                    "Dark red paint peeling over cream base coat (old shopfront pillars, school walls).",
                    real=1.2)


def stained_concrete():
    """Grey render with heavy black water/mould streaks (iconic tropical concrete)."""
    n = N
    a = ph("concrete_wall_006", "diff", n)
    h = ph("concrete_wall_006", "disp", n)
    r = ph("concrete_wall_006", "rough", n)
    b = photo("d8e3ee84")
    b = cv2.resize(b[0:768, 128:896], (n, n), interpolation=cv2.INTER_LANCZOS4)
    b = make_seamless(np.clip(b, 0, 1), 0.2)
    base = lerp(a, b, 0.5)
    base = match_mean(base, hex2rgb("#a29d93"), 0.8)
    st = black_streaks(n, n, 5, density=0.55, length=0.7, strength=0.85)
    # make periodic in y by blending with a shifted copy
    st = np.maximum(st, np.roll(st, n // 2, 0) * 0.5)
    mould = hex2rgb("#2e302a")
    alb = lerp(base, mould * (0.8 + 0.4 * lum(base))[..., None], st * 0.85)
    # greenish algae tint in the streaks + brown rust drips from a bracket
    alb = lerp(alb, alb * np.array([0.9, 1.0, 0.85]), st * 0.5)
    grime = fbm(n, n, 2.2, seed=9)
    alb = alb * (0.85 + 0.25 * grime)[..., None]
    rough = np.clip(r * 0.6 + 0.35 - st * 0.1, 0.3, 1)
    write_pbr("wall_concrete_black_streaks", saturation(alb, 0.85), h * 0.5 + st * 0.02, rough, nstr=3.0,
              meta={"purpose": "Grey cement render with heavy black water/mould streaks running down from "
                               "ledges — side walls, back walls, upper floors, water tanks. Tileable "
                               "(streaks are periodic in V).", "alpha": False, "tiling": True,
                    "real_world_m": [2.0, 2.0], "source": "Poly Haven concrete_wall_006 (CC0) + d8e3ee84"})


def plaster_cream():
    """Neutral dirty painted render (cream) to tint per building."""
    n = N
    a = ph("worn_plaster_wall", "diff", n)
    h = ph("worn_plaster_wall", "disp", n)
    r = ph("worn_plaster_wall", "rough", n)
    l = lum(a) / lum(a).mean()
    base = hex2rgb("#d8cdb4") * (0.7 + 0.3 * l)[..., None]
    base = lerp(base, a, 0.25)
    st = black_streaks(n, n, 11, density=0.35, length=0.45, strength=0.5)
    st = np.maximum(st, np.roll(st, n // 2, 0) * 0.4)
    alb = lerp(base, hex2rgb("#4a463e"), st * 0.6)
    dirt = smoothstep(0.4, 0.9, fbm(n, n, 2.0, seed=12))
    alb = alb * (1 - dirt[..., None] * 0.18)
    alb = alb * (0.88 + 0.2 * fbm(n, n, 2.6, seed=13))[..., None]
    write_pbr("wall_plaster_cream_dirty", alb, h, np.clip(r * 0.5 + 0.45, 0, 1), nstr=2.5,
              meta={"purpose": "Generic shophouse painted render, cream, with dirt and light streaks. "
                               "Multiply-tint for mint/pink/sky-blue/yellow buildings. Tileable.",
                    "alpha": False, "tiling": True, "real_world_m": [2.0, 2.0],
                    "source": "Poly Haven worn_plaster_wall (CC0), recoloured"})


def wall_base_moss():
    """Wall bottom strip: damp rising stain + moss + splash dirt, tiles along U (2 m x 1 m)."""
    W, H = 1024, 512
    a = ph("worn_plaster_wall", "diff", 1024)[:H]
    h = ph("worn_plaster_wall", "disp", 1024)[:H]
    l = lum(a) / lum(a).mean()
    base = hex2rgb("#cfc4ad") * (0.7 + 0.3 * l)[..., None]
    y = np.mgrid[0:H, 0:W][0].astype(np.float32) / H        # 0 top -> 1 bottom (ground)
    edge = (fbm(H, W, 2.6, seed=3) - 0.5) * 0.25
    damp = smoothstep(0.35, 0.75, y + edge)
    moss_n = fbm(H, W, 1.8, seed=4)
    moss = smoothstep(0.62, 0.95, y + edge * 0.6) * smoothstep(0.35, 0.65, moss_n)
    # photo moss colour from 5a5be81e
    mp = photo("5a5be81e")
    mp = cv2.resize(mp[380:640, 0:1024], (W, H), interpolation=cv2.INTER_LANCZOS4)
    mossc = lerp(hex2rgb("#4b5a27") * np.ones((H, W, 3), np.float32), mp, 0.5)
    alb = lerp(base, base * np.array([0.62, 0.6, 0.52]), damp)
    alb = lerp(alb, mossc * (0.7 + 0.5 * moss_n)[..., None], moss * 0.85)
    splash = smoothstep(0.85, 1.0, y) * smoothstep(0.4, 0.7, fbm(H, W, 1.2, seed=5))
    alb = lerp(alb, hex2rgb("#4a4237"), splash * 0.7)
    # rising salt line (whitish tide mark)
    tide = np.exp(-((y + edge - 0.36) / 0.015) ** 2) * 0.35
    alb = lerp(alb, hex2rgb("#e2ddd0"), tide * smoothstep(0.4, 0.6, fbm(H, W, 2.0, seed=6)))
    alb = alb * (0.88 + 0.2 * fbm(H, W, 2.4, seed=7))[..., None]
    rough = np.clip(0.85 - damp * 0.15 - moss * 0.05, 0.3, 1)
    hgt = h * 0.5 + moss * moss_n * 0.15
    write_pbr("wall_base_damp_moss", alb, hgt, rough, nstr=3.0, meta={
        "purpose": "Bottom 1 m of a wall: rising damp, salt tide-line, moss and splash dirt at ground "
                   "level (V=1 is the ground). Tiles along U; blend into the wall material above or use "
                   "as a skirting band.", "alpha": False, "tiling": "U only",
        "real_world_m": [2.0, 1.0], "source": "Poly Haven worn_plaster_wall (CC0) + moss colour from 5a5be81e"})


# ------------------------------------------------------------------ corrugated sheets
def corrugated():
    n = N
    # CC0 geometry (normal/height) from Poly Haven rusty_corrugated_iron; albedo from photos
    hph = ph("rusty_corrugated_iron", "disp", n)
    nph = ph("rusty_corrugated_iron", "nor_gl", n)
    aph = ph("rusty_corrugated_iron", "diff", n)
    # photo albedo 2e4aaa82 (vertical corrugations, rust streaks)
    p = photo("2e4aaa82")[0:720, 100:820]
    p = cv2.resize(p, (n, n), interpolation=cv2.INTER_LANCZOS4)
    p = make_seamless(np.clip(p, 0, 1), 0.2)
    # align: PH texture corrugations — detect orientation by gradient energy
    gx = np.abs(np.diff(hph, axis=1)).mean(); gy = np.abs(np.diff(hph, axis=0)).mean()
    if gy > gx:   # corrugations horizontal in PH map -> rotate maps to vertical
        hph = np.rot90(hph).copy(); aph = np.rot90(aph).copy()
        nph = np.rot90(nph).copy()
        nph = np.stack([nph[..., 1], 1 - nph[..., 0], nph[..., 2]], -1)
    # corrugation shading from geometry, rust/colour from photo
    shade = 0.75 + 0.5 * (hph - hph.mean())
    alb = np.clip(lerp(p, aph, 0.3) * shade[..., None], 0, 1)
    alb = saturation(alb, 0.9)
    l = lum(alb)
    rough = np.clip(0.55 + (0.5 - l) * 0.6, 0.25, 1)
    rust = np.clip((alb[..., 0] - alb[..., 2]) * 3, 0, 1)
    metal = np.clip(0.6 - rust * 0.6, 0, 1)
    save_jpg(alb, f"{OUT_TEX}/corrugated_zinc_rusty_albedo.jpg", 88)
    save_jpg(nph, f"{OUT_TEX}/corrugated_zinc_rusty_normal.jpg", 92)
    save_jpg(np.dstack([np.ones_like(l) * 0.9, rough, metal]), f"{OUT_TEX}/corrugated_zinc_rusty_orm.jpg", 88)
    MAN["corrugated_zinc_rusty"] = {"purpose": "Rusty galvanised corrugated sheet (สังกะสี): back-alley walls, "
                                    "lean-to roofs, market stall roofs, fences around empty lots. "
                                    "Corrugations run along V.", "size": "1024x1024", "alpha": False,
                                    "tiling": True, "real_world_m": [1.5, 1.5],
                                    "maps": ["albedo", "normal", "orm"],
                                    "source": "albedo 2e4aaa82 (CC BY john shortland) + Poly Haven "
                                              "rusty_corrugated_iron normal (CC0)"}
    print("wrote corrugated_zinc_rusty")
    # second variant: less rust, dusty galvanised + red-painted patches (from 88699e03)
    p2 = photo("88699e03")[0:683, 300:983]
    p2 = cv2.resize(p2, (n, n), interpolation=cv2.INTER_LANCZOS4)
    p2 = make_seamless(np.clip(p2, 0, 1), 0.2)
    alb2 = np.clip(p2 * shade[..., None], 0, 1)
    l2 = lum(alb2)
    rust2 = np.clip((alb2[..., 0] - alb2[..., 2]) * 3, 0, 1)
    save_jpg(saturation(alb2, 0.9), f"{OUT_TEX}/corrugated_zinc_streaked_albedo.jpg", 88)
    save_jpg(nph, f"{OUT_TEX}/corrugated_zinc_streaked_normal.jpg", 92)
    save_jpg(np.dstack([np.ones_like(l2) * 0.9, np.clip(0.5 + (0.5 - l2) * 0.6, 0.25, 1),
                        np.clip(0.7 - rust2 * 0.7, 0, 1)]), f"{OUT_TEX}/corrugated_zinc_streaked_orm.jpg", 88)
    MAN["corrugated_zinc_streaked"] = {"purpose": "Galvanised corrugated sheet with rust streaks and bare "
                                       "zinc panels (newer patch sheets next to old ones).", "size": "1024x1024",
                                       "alpha": False, "tiling": True, "real_world_m": [1.5, 1.5],
                                       "maps": ["albedo", "normal", "orm"],
                                       "source": "albedo 88699e03 (CC BY Mertie) + Poly Haven normal (CC0)"}
    print("wrote corrugated_zinc_streaked")


# ------------------------------------------------------------------ tarp & awning canvas
def woven(h, w, cell=6, seed=0):
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    wx = np.sin(x / cell * math.pi) ** 2
    wy = np.sin(y / cell * math.pi) ** 2
    chk = ((np.floor(x / cell) + np.floor(y / cell)) % 2)
    return (wx * chk + wy * (1 - chk)) * 0.5 + 0.25


def tarp_blue():
    n = N
    wv = woven(n, n, 4)
    crease_src = fbm(n, n, 3.2, seed=21)
    creases = np.abs(cv2.Laplacian(blur(crease_src, 6), cv2.CV_32F)) * 400
    creases = np.clip(creases, 0, 1)
    folds = smoothstep(0.45, 0.55, fbm(n, n, 3.4, seed=22))
    base = hex2rgb("#1f5fae")
    bleach = smoothstep(0.3, 0.9, fbm(n, n, 2.6, seed=23))
    col = lerp(base * np.ones((n, n, 3), np.float32), hex2rgb("#6f9bc9"), bleach * 0.5)
    col = col * (0.85 + 0.25 * wv)[..., None]
    col = col * (1 - creases[..., None] * 0.25)
    dirt = smoothstep(0.55, 0.9, fbm(n, n, 2.0, seed=24))
    col = lerp(col, hex2rgb("#3d3a33"), dirt * 0.35)
    hgt = wv * 0.15 + blur(crease_src, 4) * 0.9
    write_pbr("tarp_blue_woven", saturation(col, 0.95), hgt, np.clip(0.55 - wv * 0.1 + dirt * 0.2, 0, 1),
              nstr=6.0, meta={"purpose": "Blue woven HDPE tarpaulin (ผ้าใบฟ้า): stall roofs, rain covers over "
                                         "carts, roofs patched with tarps, tied with rope. Sun-bleached, "
                                         "creased, dirty.", "alpha": False, "tiling": True,
                              "real_world_m": [1.2, 1.2]})


def awning(name, c1, c2, stripe_m=0.18, purpose=""):
    n = N
    real = 2.0
    ppm = n / real
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    stripe = (np.floor(x / (stripe_m * ppm)) % 2).astype(np.float32)
    stripe = blur(stripe, 0.8)
    a = lerp(hex2rgb(c1) * np.ones((n, n, 3), np.float32), hex2rgb(c2) * np.ones((n, n, 3), np.float32), stripe)
    weave = woven(n, n, 2.5)
    a = a * (0.9 + 0.15 * weave)[..., None]
    # sun fading stronger at top (exposed), dirt & mould spots, rain streaks
    fade = smoothstep(0.0, 1.0, 1 - y / n) * 0.35 + 0.15 * fbm(n, n, 2.4, seed=31)
    a = lerp(a, a * 0.75 + hex2rgb("#cfc6b6") * 0.25, fade)
    spots = smoothstep(0.7, 0.9, fbm(n, n, 1.3, seed=32))
    a = a * (1 - spots[..., None] * 0.35)
    st = motion_blur_v(smoothstep(0.6, 0.8, fbm(n, n, 1.5, seed=33)), 200)
    a = a * (1 - st[..., None] * 0.3)
    hgt = weave * 0.1 + fbm(n, n, 3.3, seed=34) * 0.5
    write_pbr(name, saturation(a, 0.9), hgt, np.clip(0.75 + spots * 0.1, 0, 1), nstr=3,
              meta={"purpose": purpose, "alpha": False, "tiling": True, "real_world_m": [real, real]})


def awnings():
    awning("awning_canvas_red_white", "#b8312b", "#e9e3d6", purpose="Striped canvas shop awning (ผ้าใบกันสาด), "
           "red/white 18 cm stripes along V; faded at top, mould spots, rain streaks. Tileable.")
    awning("awning_canvas_green_white", "#2f7d4a", "#e6e2d4", purpose="Striped canvas shop awning, green/white.")
    awning("awning_canvas_blue_white", "#2a5aa3", "#e6e2d4", purpose="Striped canvas shop awning, blue/white.")


def save_manifest_part():
    p = os.path.join(RAW, "manifest_facade.json")
    old = json.load(open(p)) if os.path.exists(p) else {}
    old.update(MAN)
    json.dump(old, open(p, "w"), ensure_ascii=False, indent=1)


JOBS = {"walls": walls, "streaks": stained_concrete, "plaster": plaster_cream, "base": wall_base_moss,
        "corrugated": corrugated, "tarp": tarp_blue, "awnings": awnings}

if __name__ == "__main__":
    for nm in (sys.argv[1:] or list(JOBS)):
        JOBS[nm]()
    save_manifest_part()
