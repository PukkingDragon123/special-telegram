"""Kitchen & stall prop textures for เฮียผัด! from real photos (web product photos, any licence, per client
instruction 2026-10-19) and CC0 ambientCG scans, edited together.
Usage: python3 -I make_props.py [name ...]   (no args = all); writes public/assets/textures/props/manifest.json
"""
import json
import math
import os
import random
import sys

sys.path.insert(0, "/home/user/special-telegram/scripts/research/R2")
import cv2  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image, ImageDraw, ImageFont  # noqa: E402

import flatten as FL  # noqa: E402
import texkit as T  # noqa: E402

RAW = "/home/user/special-telegram/references/food/_raw"
RP = RAW + "/realprod"
PS = RAW + "/propsrc"
ACG = RAW + "/acg"
OUT = "/home/user/special-telegram/public/assets/textures/props"
FONTS = "/home/user/special-telegram/scripts/_cache/fonts/"
JOBS = {}


def job(name, purpose, alpha, notes, sources):
    def deco(fn):
        JOBS[name] = dict(fn=fn, purpose=purpose, alpha=alpha, notes=notes, sources=sources)
        return fn
    return deco


def acg(asset, kind):
    return T.load(f"{ACG}/{asset}/{asset}_1K-JPG_{kind}.jpg")


def acg_gray(asset, kind):
    return cv2.imread(f"{ACG}/{asset}/{asset}_1K-JPG_{kind}.jpg", cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255


def save(arr, name, rgba=False):
    p = os.path.join(OUT, name)
    if rgba:
        T.save_rgba(np.clip(arr, 0, 255).astype(np.uint8), p)
    else:
        T.save_rgb(arr, p, q=90)
    return name


def rect_ellipse(img, cx, cy, rx, ry, out=1024, inset=1.0, feather=2.0):
    """Ellipse (pixels) -> circle-in-square (RGBA). inset<1 samples a slightly smaller ellipse."""
    yy, xx = np.mgrid[0:out, 0:out].astype(np.float32)
    u = (xx + 0.5) / out * 2 - 1
    v = (yy + 0.5) / out * 2 - 1
    mx = (cx + u * rx * inset).astype(np.float32)
    my = (cy + v * ry * inset).astype(np.float32)
    rgb = cv2.remap(img.astype(np.float32), mx, my, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    r = np.sqrt(u ** 2 + v ** 2)
    a = np.clip((1 - r) * out / (2 * feather), 0, 1)
    return np.dstack([np.clip(rgb, 0, 255), a * 255])


def polar(disc_rgb, out_w=1024, out_h=256, r0=0.0, r1=1.0):
    """Circle-in-square -> strip: x = angle (0..360 deg), y = radius r0..r1 (top=centre)."""
    S = disc_rgb.shape[0]
    th = np.linspace(0, 2 * np.pi, out_w, endpoint=False).astype(np.float32)
    rr = np.linspace(r0, r1, out_h).astype(np.float32)
    R = S / 2 * 0.995
    mx = (S / 2 + rr[:, None] * R * np.cos(th)[None, :]).astype(np.float32)
    my = (S / 2 + rr[:, None] * R * np.sin(th)[None, :]).astype(np.float32)
    return cv2.remap(disc_rgb[..., :3].astype(np.float32), mx, my, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def decode_n(n_rgb):
    n = n_rgb.astype(np.float32) / 255 * 2 - 1
    return n


def encode_n(n):
    ln = np.sqrt((n ** 2).sum(axis=2, keepdims=True))
    n = n / np.maximum(ln, 1e-6)
    return np.clip((n * 0.5 + 0.5) * 255, 0, 255)


def tint(gray_like, rgb, keep=0.35):
    """Recolour a scan: luminance variation of `gray_like` modulates the target colour."""
    g = gray_like.mean(axis=2, keepdims=True) if gray_like.ndim == 3 else gray_like[..., None]
    g = g / max(1e-3, float(g.mean()))
    col = np.array(rgb, np.float32)[None, None, :]
    return np.clip(col * (1 - keep + keep * g), 0, 255)


def noise(h, w, scale, seed):
    rng = np.random.default_rng(seed)
    g = rng.random((max(2, h // scale + 2), max(2, w // scale + 2))).astype(np.float32)
    return cv2.resize(g, (w, h), interpolation=cv2.INTER_CUBIC)


def fbm(h, w, scale, seed, octaves=4):
    out = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        out += noise(h, w, max(1, scale >> o), seed + o) * amp
        tot += amp
        amp *= 0.5
    return out / tot


# =========================================================================================== WOK
@job("wok_carbon_interior", "seasoned carbon-steel wok interior: top-view disc + polar strip + patina tile", False,
     "Real used carbon-steel wok (bronze/blue heat tint, dark seasoned centre). *_top.jpg: rim ellipse rectified to "
     "a circle (planar/disc UV). *_polar.jpg: u = angle 0-360 deg, v = radius (top row = centre, bottom = rim) — "
     "matches THREE.LatheGeometry UVs. *_tile.jpg: seamless patina. *_n.jpg normal maps (OpenGL).",
     ["realprod/wok_inside/wok_inside_02.jpg"])
def wok_interior():
    img = T.load(f"{RP}/wok_inside/wok_inside_02.jpg")
    H, W = img.shape[:2]
    disc = rect_ellipse(img, 0.505 * W, 0.50 * H, 0.478 * W, 0.474 * H, out=1024, inset=0.985)
    rgb = T.grade(disc[..., :3], sat=1.05, contrast=1.04)
    a = disc[..., 3:4] / 255
    top = rgb * a + rgb.mean(axis=(0, 1)) * 0.0 * (1 - a)
    files = [save(top, "wok_carbon_interior_top.jpg")]
    files.append(save(T.normal_from(top, strength=2.0, wrap=False), "wok_carbon_interior_top_n.jpg"))
    files.append(save(polar(np.dstack([rgb, disc[..., 3]]), 1024, 256), "wok_carbon_interior_polar.jpg"))
    c = T.crop_n(rgb, (0.22, 0.22, 0.78, 0.78))
    tile = T.make_tileable(T.flatten_light(c, strength=0.7), out=1024, seed=3)
    files.append(save(tile, "wok_carbon_patina_tile.jpg"))
    files.append(save(T.normal_from(tile, strength=1.8), "wok_carbon_patina_tile_n.jpg"))
    return files, 1024, 1024


@job("wok_black_exterior", "black pre-seasoned wok exterior (smooth carbonised steel)", False,
     "Seamless tile from a real black carbon-steel wok product photo; lighting flattened.",
     ["realprod/wok_inside/wok_inside_07.jpg"])
def wok_exterior():
    img = T.load(f"{RP}/wok_inside/wok_inside_07.jpg")
    c = T.crop_n(img, (0.30, 0.455, 0.70, 0.595))
    c = T.flatten_light(c, strength=0.95, sigma_frac=0.25)
    tile = T.make_tileable(c, out=512, seed=5)
    grime = acg_gray("SurfaceImperfections003", "Opacity")
    grime = cv2.resize(grime, (512, 512))[..., None]
    tile = tile * (1 - 0.25 * grime) + np.array([40, 30, 22]) * 0.25 * grime
    return [save(tile, "wok_black_exterior_tile.jpg"), save(T.normal_from(tile, strength=1.5),
                                                              "wok_black_exterior_tile_n.jpg")], 512, 512


# ======================================================================================= STAINLESS
def dents_height(S, seed, n=9):
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    h = np.zeros((S, S), np.float32)
    for _ in range(n):
        cx, cy = rng.uniform(0, S, 2)
        r = rng.uniform(S * 0.03, S * 0.10)
        sx = rng.uniform(0.6, 1.4)
        for ox in (-S, 0, S):  # periodic
            for oy in (-S, 0, S):
                d2 = ((xx - cx - ox) * sx) ** 2 + (yy - cy - oy) ** 2 / sx
                h -= rng.uniform(0.4, 1.0) * np.exp(-d2 / (2 * r * r))
    # a couple of creases
    for _ in range(2):
        y0 = rng.uniform(0, S)
        ang = rng.uniform(-0.3, 0.3)
        d = np.abs((yy - y0) * np.cos(ang) - xx * np.sin(ang))
        h -= 0.35 * np.exp(-(d ** 2) / (2 * (S * 0.006) ** 2)) * (0.5 + 0.5 * np.sin(xx / S * 6.28 + y0))
    return h


@job("stainless_brushed_dented", "brushed stainless steel with dents, scratches & grease (cart body, table top)",
     False, "Base: ambientCG Metal009 (CC0 brushed-metal scan) + procedural dents/creases in the normal map + CC0 "
            "fingerprint/surface-imperfection grime. _n = OpenGL normal, _r = roughness. *_grimy = dirtier variant "
            "for the old cart (grease, water stains towards the bottom).",
     ["acg/Metal009", "acg/Fingerprints002", "acg/SurfaceImperfections015", "acg/Smear002"])
def stainless():
    S = 1024
    col = acg("Metal009", "Color")
    n = decode_n(acg("Metal009", "NormalGL"))
    rough = acg_gray("Metal009", "Roughness")
    h = dents_height(S, 7)
    gy, gx = np.gradient(h)
    n[..., 0] += -gx * 18
    n[..., 1] += gy * 18
    fp = cv2.resize(acg_gray("Fingerprints002", "Opacity"), (S, S))
    si = cv2.resize(acg_gray("SurfaceImperfections015", "Opacity"), (S, S))
    lum = (col.mean(axis=2, keepdims=True))
    base = np.clip(col * 1.04 + 6, 0, 255)
    # dents catch light differently: slight darkening in the dent bowls
    base = base * (1 + 0.08 * np.clip(h, -1, 0)[..., None])
    clean = base * (1 - 0.10 * fp[..., None]) + np.array([150, 145, 135]) * 0.10 * fp[..., None]
    clean = clean * (1 - 0.12 * si[..., None]) + np.array([120, 110, 95]) * 0.12 * si[..., None]
    r_clean = np.clip(rough * 0.85 + 0.25 * fp + 0.2 * si, 0, 1)
    files = [save(clean, "stainless_brushed_dented.jpg"), save(encode_n(n), "stainless_brushed_dented_n.jpg"),
             save(r_clean * 255, "stainless_brushed_dented_r.jpg")]
    # grimy variant
    sm = cv2.resize(acg_gray("Smear002", "Roughness"), (S, S))
    yy = np.mgrid[0:S, 0:S][0].astype(np.float32) / S
    stain = np.clip(fbm(S, S, 256, 11) * 1.6 - 0.55 + yy * 0.5, 0, 1)
    dirty = clean * (1 - 0.35 * stain[..., None]) + np.array([92, 78, 55]) * 0.35 * stain[..., None]
    drips = np.zeros((S, S), np.float32)
    rng = np.random.default_rng(3)
    for _ in range(40):
        x = rng.uniform(0, S)
        y0 = rng.uniform(0, S * 0.7)
        L = rng.uniform(40, 260)
        w = rng.uniform(1.5, 4.5)
        cv2.line(drips, (int(x), int(y0)), (int(x + rng.uniform(-6, 6)), int(y0 + L)), 1.0, int(w))
    drips = cv2.GaussianBlur(drips, (0, 0), 2.0)
    dirty = dirty * (1 - 0.25 * drips[..., None]) + np.array([200, 190, 170]) * 0.12 * drips[..., None]
    r_dirty = np.clip(r_clean + 0.25 * stain - 0.15 * drips + 0.1 * (sm - 0.5), 0, 1)
    files += [save(dirty, "stainless_grimy.jpg"), save(r_dirty * 255, "stainless_grimy_r.jpg")]
    return files, S, S


# ======================================================================================= BOARD
@job("tamarind_board", "thick round tamarind-wood chopping board (เขียงไม้มะขาม): end-grain top (clean + used), side",
     False, "Top: real tamarind board end grain (growth rings, off-centre pith) rectified to a circle, handle "
            "rivets inpainted. *_used: + knife scars, chop dents, damp dark centre, meat/chili stains (edited). "
            "Side: CC0 ambientCG Wood049 tinted to the tamarind sapwood colour (seamless).",
     ["propsrc/board_used_top/board_used_top_04.jpg", "acg/Wood049"])
def tamarind_board():
    img = T.load(f"{PS}/board_used_top/board_used_top_04.jpg")
    H, W = img.shape[:2]
    disc = rect_ellipse(img, 0.483 * W, 0.566 * H, 0.4225 * W, 0.236 * H, out=1024, inset=0.93)
    rgb = disc[..., :3].copy()
    S = 1024
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    rr = np.sqrt((xx - S / 2) ** 2 + (yy - S / 2) ** 2) / (S / 2)
    u8 = np.clip(rgb, 0, 255).astype(np.uint8)
    hsv = cv2.cvtColor(u8, cv2.COLOR_RGB2HSV)
    dark = ((hsv[..., 2] < 120) | (hsv[..., 1] < 70)) & (yy < S * 0.42) & (rr > 0.45)
    m = cv2.dilate(dark.astype(np.uint8) * 255, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
    rgb = cv2.inpaint(u8, m, 9, cv2.INPAINT_TELEA).astype(np.float32)
    rgb = T.grade(rgb, sat=0.92, contrast=1.02)
    # outside the circle: extend edge colour (texture is used on a disc)
    files = [save(rgb, "tamarind_board_top.jpg")]
    files.append(save(T.normal_from(rgb, strength=1.4, wrap=False), "tamarind_board_top_n.jpg"))
    # ---- used variant
    used = rgb.copy()
    rng = np.random.default_rng(21)
    scar = np.zeros((S, S), np.float32)
    hl = np.zeros((S, S), np.float32)
    for _ in range(3200):
        r = abs(rng.normal(0, 0.30))
        a = rng.uniform(0, 2 * np.pi)
        cx, cy = S / 2 + r * S / 2 * np.cos(a), S / 2 + r * S / 2 * np.sin(a)
        ang = rng.normal(0.6, 0.5) if rng.random() < 0.7 else rng.uniform(0, np.pi)
        L = rng.uniform(6, 34)
        dx, dy = np.cos(ang) * L / 2, np.sin(ang) * L / 2
        p0, p1 = (int(cx - dx), int(cy - dy)), (int(cx + dx), int(cy + dy))
        cv2.line(scar, p0, p1, float(rng.uniform(0.10, 0.35)), 1, cv2.LINE_AA)
        cv2.line(hl, (p0[0] + 1, p0[1] + 1), (p1[0] + 1, p1[1] + 1), float(rng.uniform(0.3, 0.8)), 1, cv2.LINE_AA)
    for _ in range(60):  # cleaver chop dents
        r = abs(rng.normal(0, 0.28))
        a = rng.uniform(0, 2 * np.pi)
        cx, cy = S / 2 + r * S / 2 * np.cos(a), S / 2 + r * S / 2 * np.sin(a)
        e_ang = float(rng.uniform(0, 180))
        ax = (int(rng.uniform(5, 14)), 1)
        cv2.ellipse(scar, (int(cx), int(cy)), ax, e_ang, 0, 360, 0.35, -1, cv2.LINE_AA)
        cv2.ellipse(hl, (int(cx) + 1, int(cy) + 1), ax, e_ang, 0, 360, 0.6, 1, cv2.LINE_AA)
    scar = cv2.GaussianBlur(scar, (0, 0), 0.7)
    damp = np.clip((1 - rr) * 1.25, 0, 1) ** 1.5 * (0.55 + 0.45 * fbm(S, S, 128, 5))
    grey = used.mean(axis=2, keepdims=True)
    used = used * (1 - 0.25 * damp[..., None]) + (grey * 0.75 + np.array([40, 25, 10])) * 0.25 * damp[..., None]
    fuzz = cv2.GaussianBlur(hl, (0, 0), 2.5)
    used = used + (np.array([250, 238, 215]) - used) * np.clip(0.22 * fuzz, 0, 0.35)[..., None]  # whitish fibres
    used = used * (1 - 0.22 * scar[..., None])
    hlc = np.clip(hl, 0, 1)[..., None]
    used = used + (np.array([255, 244, 222]) - used) * 0.30 * hlc
    stains = np.clip(fbm(S, S, 64, 9) * 2.2 - 1.25, 0, 1) * np.clip(1.1 - rr, 0, 1)
    used = used * (1 - 0.35 * stains[..., None]) + np.array([120, 40, 25]) * 0.35 * stains[..., None]
    files.append(save(used, "tamarind_board_top_used.jpg"))
    hgt = -scar * 0.6 - damp * 0.05
    gy, gx = np.gradient(cv2.GaussianBlur(hgt, (0, 0), 1.0))
    nb = decode_n(T.normal_from(rgb, strength=1.4, wrap=False).astype(np.float32))
    nb[..., 0] += -gx * 6
    nb[..., 1] += gy * 6
    files.append(save(encode_n(nb), "tamarind_board_top_used_n.jpg"))
    # ---- side (sapwood, axial grain)
    side = acg("Wood049", "Color")
    side = tint(side, (205, 160, 95), keep=0.9)
    side = T.grade(side, sat=1.1)
    files.append(save(side, "tamarind_board_side_tile.jpg"))
    files.append(save(acg("Wood049", "NormalGL"), "tamarind_board_side_tile_n.jpg"))
    return files, S, S


# ====================================================================================== DISHWARE
def plate_disc(src, cx, cy, rx, ry, inset=1.0, wb=True):
    img = T.load(src)
    H, W = img.shape[:2]
    d = rect_ellipse(img, cx * W, cy * H, rx * W, ry * H, out=1024, inset=inset, feather=2.5)
    rgb = d[..., :3]
    if wb:
        rgb = FL.white_balance(rgb, pct=95, target=244, max_gain=1.15)
    rgb = T.grade(rgb, contrast=1.03)
    return np.dstack([rgb, d[..., 3]])


@job("melamine_plates", "melamine / ceramic plates (top view, alpha): rooster + green vine rim, floral rim, blue & white, "
     "plain white chipped", True,
     "Real Thai plate photos rectified to circles. plate_white_chipped adds rim chips, cutlery scratches and curry "
     "stains (edited). Map planar onto the plate top; the rim fades to transparent outside the plate.",
     ["propsrc/melamine_green_rim/melamine_green_rim_06.jpg", "realprod/melamine_leaf/melamine_leaf_01.jpg",
      "realprod/melamine_blue/melamine_blue_01.jpg", "realprod/melamine_white/melamine_white_05.jpg"])
def plates():
    files = []
    p = plate_disc(f"{PS}/melamine_green_rim/melamine_green_rim_06.jpg", 0.298, 0.474, 0.226, 0.222, inset=0.985)
    files.append(save(p, "plate_rooster_green_rim.png", rgba=True))
    p = plate_disc(f"{RP}/melamine_leaf/melamine_leaf_01.jpg", 0.497, 0.5155, 0.383, 0.3825, inset=0.99)
    files.append(save(p, "plate_floral_rim.png", rgba=True))
    p = plate_disc(f"{RP}/melamine_blue/melamine_blue_01.jpg", 0.510, 0.449, 0.347, 0.342, inset=0.99)
    files.append(save(p, "plate_blue_white.png", rgba=True))
    p = plate_disc(f"{RP}/melamine_white/melamine_white_05.jpg", 0.500, 0.496, 0.328, 0.329, inset=0.985)
    S = 1024
    rgb, a = p[..., :3].copy(), p[..., 3].copy()
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    rr = np.sqrt((xx - S / 2) ** 2 + (yy - S / 2) ** 2) / (S / 2)
    ang = np.arctan2(yy - S / 2, xx - S / 2)
    rng = np.random.default_rng(4)
    for _ in range(5):  # rim chips
        a0 = rng.uniform(-np.pi, np.pi)
        w = rng.uniform(0.03, 0.08)
        depth = rng.uniform(0.02, 0.05)
        dang = np.angle(np.exp(1j * (ang - a0)))
        prof = np.clip(1 - (dang / w) ** 2, 0, 1) * depth * (0.7 + 0.3 * noise(S, S, 6, int(a0 * 100) % 999))
        chip = rr > (0.995 - prof)
        a[chip] = 0
        edge = (rr > (0.975 - prof)) & ~chip & (np.abs(dang) < w)
        rgb[edge] = rgb[edge] * 0.82 + np.array([170, 160, 140]) * 0.18
    sc = np.zeros((S, S), np.float32)
    for _ in range(160):
        r = rng.uniform(0.05, 0.75)
        t = rng.uniform(0, 2 * np.pi)
        cx, cy = S / 2 + r * S / 2 * np.cos(t), S / 2 + r * S / 2 * np.sin(t)
        L = rng.uniform(10, 70)
        g = rng.uniform(0, np.pi)
        cv2.line(sc, (int(cx), int(cy)), (int(cx + L * np.cos(g)), int(cy + L * np.sin(g))),
                 float(rng.uniform(0.3, 1)), 1, cv2.LINE_AA)
    rgb = rgb * (1 - 0.18 * sc[..., None])
    st = np.clip(fbm(S, S, 96, 2) * 2.0 - 1.15, 0, 1) * (rr < 0.8)
    rgb = rgb * (1 - 0.22 * st[..., None]) + np.array([200, 140, 60]) * 0.22 * st[..., None]
    files.append(save(np.dstack([rgb, a]), "plate_white_chipped.png", rgba=True))
    return files, 1024, 1024


@job("bowl_rooster_side", "ชามตราไก่ rooster bowl: exterior side band (u = angle, v = rim->foot)", False,
     "Conical (frustum) unwrap of a real rooster-bowl photo; covers ~130 deg — mirror/repeat for the back, or keep "
     "the rooster on the front. Inside of the bowl: plain white with a red rim line.",
     ["realprod/rooster_bowl/rooster_bowl_08.jpg"])
def bowl():
    img = T.load(f"{RP}/rooster_bowl/rooster_bowl_08.jpg")
    H, W = img.shape[:2]
    y0, y1 = 0.383 * H, 0.618 * H
    l0, r0, l1, r1 = 0.102 * W, 0.873 * W, 0.300 * W, 0.690 * W
    lim = np.radians(66)
    rmean = ((r0 - l0) + (r1 - l1)) / 4
    out_w, out_h = int(rmean * 2 * lim), int(y1 - y0)
    th = np.linspace(-lim, lim, out_w)
    ys = np.linspace(y0, y1, out_h)
    t = (ys - y0) / (y1 - y0)
    rad = (r0 - l0) / 2 + ((r1 - l1) / 2 - (r0 - l0) / 2) * t
    cxs = (l0 + r0) / 2 + ((l1 + r1) / 2 - (l0 + r0) / 2) * t
    bow = (0.010 + 0.030 * t) * H
    mx = (cxs[:, None] + rad[:, None] * np.sin(th)[None, :]).astype(np.float32)
    my = (ys[:, None] + bow[:, None] * np.cos(th)[None, :]).astype(np.float32)
    out = cv2.remap(img.astype(np.float32), mx, my, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    out = FL.white_balance(out, pct=90, target=240)
    out = FL.deshade(out, strength=0.5)
    out = cv2.resize(out, (1024, int(1024 * out_h / out_w)), interpolation=cv2.INTER_CUBIC)
    return [save(out, "bowl_rooster_side.jpg")], out.shape[1], out.shape[0]


# ======================================================================================= PLASTICS
@job("plastic_stool", "red / blue PP plastic (stools, tables, tubs) + real stool embossed band & logo", False,
     "Colour from real Thai plastic stools; micro-surface from CC0 ambientCG Plastic010 (normal/roughness). "
     "stool_band_floral_*: cylindrical unwrap of a real stool's embossed floral band (red = hue-shifted). "
     "stool_logo_esqube.png: real moulded-in logo label (alpha).",
     ["realprod/stool_blue/stool_blue_04.jpg", "acg/Plastic010"])
def plastic():
    files = []
    base = acg("Plastic010", "Color")
    nrm = acg("Plastic010", "NormalGL")
    rough = acg_gray("Plastic010", "Roughness")
    S = base.shape[0]
    wear = cv2.resize(acg_gray("SurfaceImperfections015", "Opacity"), (S, S))
    for name, colr in (("blue", (52, 112, 196)), ("red", (196, 32, 38))):
        c = tint(base, colr, keep=0.5)
        c = c * (1 - 0.12 * wear[..., None]) + np.array([235, 230, 220]) * 0.12 * wear[..., None]
        files.append(save(c, f"plastic_pp_{name}.jpg"))
    files.append(save(nrm, "plastic_pp_n.jpg"))
    files.append(save(np.clip(rough * 0.6 + 0.25 + 0.25 * wear, 0, 1) * 255, "plastic_pp_r.jpg"))
    img = T.load(f"{RP}/stool_blue/stool_blue_04.jpg")
    H, W = img.shape[:2]
    band = FL.cyl_unwrap(img, 0.185 * H, 0.292 * H, cx=0.50 * W, radius=0.43 * W, max_deg=62)
    band = FL.deshade(band, strength=0.6)
    files.append(save(band, "stool_band_floral_blue.jpg"))
    hsv = cv2.cvtColor(np.clip(band, 0, 255).astype(np.uint8), cv2.COLOR_RGB2HSV)
    hsv[..., 0] = ((hsv[..., 0].astype(np.int32) + 75) % 180).astype(np.uint8)  # blue (~108) -> red (~3)
    hsv[..., 1] = np.clip(hsv[..., 1].astype(np.int32) * 1.15, 0, 255).astype(np.uint8)
    red = cv2.cvtColor(hsv, cv2.COLOR_HSV2RGB)
    files.append(save(red, "stool_band_floral_red.jpg"))
    logo = T.crop_n(img, (0.352, 0.312, 0.632, 0.408))
    h, w = logo.shape[:2]
    m = np.zeros((h, w), np.uint8)
    cv2.ellipse(m, (w // 2, h // 2), (int(w * 0.48), int(h * 0.44)), 0, 0, 360, 1, -1)
    lg = T.rgba_from(logo, m, feather=1.2, erode=0, decontam=False)
    files.append(save(lg, "stool_logo_esqube.png", rgba=True))
    return files, S, S


# ======================================================================================= SACK / FILM
@job("pp_woven_sack", "woven polypropylene sack fabric (rice / fertiliser sacks), white and natural", False,
     "Seamless tile from a real woven-PP fabric macro photo (flat region, watermark excluded); *_natural = "
     "beige-green recycled-PP tint (fertiliser / market sacks).", ["propsrc/pp_woven_macro/pp_woven_macro_06.jpg"])
def pp_sack():
    img = T.load(f"{PS}/pp_woven_macro/pp_woven_macro_06.jpg")
    c = T.crop_n(img, (0.62, 0.36, 0.98, 0.76))
    c = T.flatten_light(c, strength=0.9, sigma_frac=0.25)
    tile = T.make_tileable(c, out=512, seed=8, overlap=0.2)
    tile = T.grade(tile, contrast=1.15)
    files = [save(tile, "pp_woven_sack_white_tile.jpg"),
             save(T.normal_from(tile, strength=2.5), "pp_woven_sack_tile_n.jpg")]
    g = tile.mean(axis=2, keepdims=True) / 255
    nat = np.clip(g * np.array([205, 200, 165]) + np.array([10, 10, 0]), 0, 255)
    files.append(save(nat, "pp_woven_sack_natural_tile.jpg"))
    return files, 512, 512


@job("plastic_film_clear", "clear PE/PP plastic bag film (ถุงแกง / ถุงร้อน, ice bags): crinkle highlights", True,
     "From a real photo of clear plastic bags. PNG alpha = highlight/crinkle opacity (use with a transparent "
     "material, low opacity base); *_n = crinkle normal map.", ["propsrc/plastic_crumpled/plastic_crumpled_01.jpg"])
def film():
    img = T.load(f"{PS}/plastic_crumpled/plastic_crumpled_01.jpg")
    c = T.crop_n(img, (0.12, 0.20, 0.44, 0.44))
    c = T.flatten_light(c, strength=0.9, sigma_frac=0.2)
    tile = T.make_tileable(c, out=512, seed=12)
    L = tile.mean(axis=2)
    a = np.clip((L - np.percentile(L, 35)) / (np.percentile(L, 99.5) - np.percentile(L, 35) + 1e-3), 0, 1)
    a = 0.10 + 0.75 * a ** 1.4
    rgba = np.dstack([np.full_like(L, 250), np.full_like(L, 250), np.full_like(L, 252), a * 255])
    return [save(rgba, "plastic_film_clear.png", rgba=True),
            save(T.normal_from(tile, strength=3.0), "plastic_film_clear_n.jpg")], 512, 512


# ======================================================================================= LPG / HOSE
@job("lpg_paint", "LPG cylinder painted steel (scratched enamel): red and World-Gas blue", False,
     "CC0 ambientCG PaintedMetal004 (scratched red paint, silver scratches) and a hue-shifted blue; pair with "
     "img/labels/lpg_cylinder_world_gas.png for the logo band.", ["acg/PaintedMetal004"])
def lpg():
    col = acg("PaintedMetal004", "Color")
    files = [save(T.grade(col, sat=0.85, gamma=0.95), "lpg_paint_red_tile.jpg")]
    hsv = cv2.cvtColor(np.clip(col, 0, 255).astype(np.uint8), cv2.COLOR_RGB2HSV)
    hsv[..., 0] = ((hsv[..., 0].astype(np.int32) + 106) % 180).astype(np.uint8)
    hsv[..., 2] = np.clip(hsv[..., 2].astype(np.int32) * 0.85, 0, 255).astype(np.uint8)
    files.append(save(cv2.cvtColor(hsv, cv2.COLOR_HSV2RGB), "lpg_paint_blue_tile.jpg"))
    files.append(save(acg("PaintedMetal004", "NormalGL"), "lpg_paint_tile_n.jpg"))
    files.append(save(acg("PaintedMetal004", "Roughness"), "lpg_paint_tile_r.jpg"))
    return files, 1024, 1024


@job("rubber_hose_orange", "orange LPG rubber hose", False,
     "CC0 ambientCG Rubber004 surface recoloured to the orange of Thai low-pressure LPG hoses.",
     ["acg/Rubber004"])
def hose():
    col = cv2.GaussianBlur(acg("Rubber004", "Color"), (0, 0), 1.6)
    c = tint(col, (226, 96, 30), keep=0.28)
    return [save(c, "rubber_hose_orange_tile.jpg"), save(acg("Rubber004", "NormalGL"), "rubber_hose_tile_n.jpg"),
            save(acg("Rubber004", "Roughness"), "rubber_hose_tile_r.jpg")], 1024, 1024


# ======================================================================================= FOAM / CARDBOARD
@job("styrofoam", "styrofoam (EPS) for food boxes, ice boxes, foam sheets", False,
     "CC0 ambientCG Styrofoam004 (bead texture), slightly warmed.", ["acg/Styrofoam004"])
def foam():
    col = T.grade(acg("Styrofoam004", "Color"), warm=0.01)
    return [save(col, "styrofoam_tile.jpg"), save(acg("Styrofoam004", "NormalGL"), "styrofoam_tile_n.jpg")], 1024, 1024


@job("rice_cooker_body", "big commercial rice cooker body (white enamel, logo + switch)", False,
     "Cylindrical unwrap (~130 deg front) of a real Sharp KSH-D1010 10 L commercial rice cooker.",
     ["realprod/rice_cooker_big/rice_cooker_big_03.jpg"])
def rice_cooker():
    img = T.load(f"{RP}/rice_cooker_big/rice_cooker_big_03.jpg")
    H, W = img.shape[:2]
    out = FL.cyl_unwrap(img, 0.37 * H, 0.645 * H, cx=0.559 * W, radius=0.336 * W, max_deg=56)
    out = FL.deshade(out, strength=0.5)
    out = FL.white_balance(out, pct=90, target=238)
    out = cv2.resize(out, (1024, int(1024 * out.shape[0] / out.shape[1])), interpolation=cv2.INTER_CUBIC)
    return [save(out, "rice_cooker_body_sharp.jpg")], out.shape[1], out.shape[0]


@job("glass_grime", "grime overlay for the cart's glass display box (dust, fingerprints, grease smears, drips)", True,
     "RGBA overlay built from CC0 ambientCG Fingerprints002, Smear002 and SurfaceImperfections003/015 masks; "
     "put on a second plane / decal over the glass. Alpha = grime amount.",
     ["acg/Fingerprints002", "acg/Smear002", "acg/SurfaceImperfections003", "acg/SurfaceImperfections015"])
def glass():
    S = 1024
    fp = cv2.resize(acg_gray("Fingerprints002", "Opacity"), (S, S))
    s3 = cv2.resize(acg_gray("SurfaceImperfections003", "Opacity"), (S, S))
    s15 = cv2.resize(acg_gray("SurfaceImperfections015", "Opacity"), (S, S))
    sm = cv2.resize(acg_gray("Smear002", "Roughness"), (S, S))
    yy = np.mgrid[0:S, 0:S][0].astype(np.float32) / S
    a = np.clip(0.55 * fp + 0.35 * s15 + 0.25 * s3 * (0.4 + yy) + 0.25 * np.clip(sm - 0.45, 0, 1) * 2, 0, 1)
    a = np.clip(a * 0.85, 0, 0.9)
    col = np.dstack([np.full((S, S), 186.0), np.full((S, S), 176.0), np.full((S, S), 150.0)])
    col = col * (0.85 + 0.3 * fbm(S, S, 128, 4))[..., None]
    return [save(np.dstack([col, a * 255]), "glass_grime_overlay.png", rgba=True)], S, S


def corrugated(S=1024):
    c = acg("Cardboard003", "Color")
    return cv2.resize(c, (S, S))


def crease_and_dirt(img, seed, folds=((0.5, None),), footprints=0, marker=None, arrow=None, rings=3, dirt_amt=0.45):
    S = img.shape[0]
    rng = np.random.default_rng(seed)
    out = img.copy()
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    for pos, _ in folds:  # fold creases (vertical) with a dark core + light ridge
        x0 = pos * S + rng.uniform(-6, 6)
        d = xx - x0 - 4 * np.sin(yy / S * 9 + seed)
        out *= (1 - 0.35 * np.exp(-(d ** 2) / (2 * 2.2 ** 2)))[..., None]
        out += (18 * np.exp(-((d - 5) ** 2) / (2 * 3.0 ** 2)))[..., None]
    dirt = np.clip(fbm(S, S, 256, seed) * 1.8 - 0.6, 0, 1) * 0.55 + np.clip(fbm(S, S, 32, seed + 1) - 0.55, 0, 1) * 0.6
    out = out * (1 - dirt_amt * dirt[..., None]) + np.array([70, 55, 40]) * dirt_amt * dirt[..., None]
    for _ in range(rings):  # water / grease rings
        cx, cy, r = rng.uniform(0.15, 0.85) * S, rng.uniform(0.15, 0.85) * S, rng.uniform(40, 120)
        ring = np.abs(np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) - r)
        out *= (1 - 0.18 * np.exp(-(ring ** 2) / (2 * 4.0 ** 2)))[..., None]
        inside = (np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) < r).astype(np.float32)
        out *= (1 - 0.07 * inside)[..., None]
    for _ in range(footprints):  # flip-flop sole prints
        cx, cy = rng.uniform(0.25, 0.75) * S, rng.uniform(0.25, 0.75) * S
        ang = rng.uniform(0, 180)
        fpm = np.zeros((S, S), np.float32)
        cv2.ellipse(fpm, (int(cx), int(cy)), (int(S * 0.045), int(S * 0.11)), ang, 0, 360, 1, -1)
        fpm *= np.clip(fbm(S, S, 8, seed + 7) * 1.6 - 0.4, 0, 1)
        out = out * (1 - 0.35 * fpm[..., None]) + np.array([60, 45, 35]) * 0.35 * fpm[..., None]
    if marker:
        im = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
        d = ImageDraw.Draw(im)
        for text, (x, y), size, rot in marker:
            f = ImageFont.truetype(FONTS + "Sriracha-Regular.ttf", int(size), layout_engine=ImageFont.Layout.RAQM)
            lay = Image.new("RGBA", im.size, (0, 0, 0, 0))
            ImageDraw.Draw(lay).text((x * S, y * S), text, font=f, fill=(25, 25, 35, 215), anchor="mm")
            lay = lay.rotate(rot, center=(x * S, y * S), resample=Image.BICUBIC)
            im.paste(lay, (0, 0), lay)
        if arrow:
            ax, ay = arrow[0] * S, arrow[1] * S
            pts = [(ax, ay - 70), (ax - 32, ay - 20), (ax - 10, ay - 20), (ax - 10, ay + 18), (ax + 10, ay + 18),
                   (ax + 10, ay - 20), (ax + 32, ay - 20)]
            d.line(pts + [pts[0]], fill=(25, 25, 35, 215), width=7, joint="curve")
        out = np.asarray(im).astype(np.float32)
    return np.clip(out, 0, 255)


def print_on_cardboard(face, S=1024, keep=0.88):
    base = corrugated(S)
    f = cv2.resize(face, (S, S), interpolation=cv2.INTER_AREA)
    flute = base.mean(axis=2, keepdims=True) / max(1.0, float(base.mean()))
    printed = f * (keep + (1 - keep) * flute)
    # ink sits on kraft: whites become kraft-tinted
    white = np.clip((f.min(axis=2, keepdims=True) - 200) / 55, 0, 1)
    return printed * (1 - 0.55 * white) + base * 0.55 * white


@job("cardboard", "corrugated cardboard + flattened brand cartons to sleep on (Mama noodles, Chang beer, plain)", False,
     "cardboard_corrugated_tile: CC0 ambientCG Cardboard003. Sleeping mats: real carton prints (Mama, Chang) "
     "perspective-flattened from product photos, multiplied onto corrugated kraft, plus fold creases, dirt, grease "
     "rings and flip-flop prints (edited). cardboard_mat_plain has marker scribbles (Thai, looped handwriting font "
     "Sriracha). foam_mat_dirty: dirty styrofoam sheet.",
     ["acg/Cardboard003", "realprod/mama_carton/mama_carton_07.jpg", "realprod/beer_carton_brown/beer_carton_brown_01.jpg",
      "acg/Styrofoam004"])
def cardboard():
    S = 1024
    files = [save(corrugated(S), "cardboard_corrugated_tile.jpg"),
             save(acg("Cardboard003", "NormalGL"), "cardboard_corrugated_tile_n.jpg")]
    mama = T.load(f"{RP}/mama_carton/mama_carton_07.jpg")
    H, W = mama.shape[:2]
    mf = FL.persp(mama, [(0.065 * W, 0.075 * H), (0.795 * W, 0.02 * H), (0.825 * W, 0.862 * H), (0.025 * W, 0.885 * H)],
                  1100, 1196).astype(np.float32)
    mat = crease_and_dirt(print_on_cardboard(mf, S), 31, folds=((0.5, None),), footprints=2)
    files.append(save(mat, "cardboard_mat_mama.jpg"))
    ch = T.load(f"{RP}/beer_carton_brown/beer_carton_brown_01.jpg")
    H, W = ch.shape[:2]
    cf = FL.persp(ch, [(0.662 * W, 0.497 * H), (0.886 * W, 0.393 * H), (0.886 * W, 0.806 * H), (0.662 * W, 0.907 * H)],
                  740, 1000).astype(np.float32)
    files.append(save(cf, "carton_chang_side_face.jpg"))
    two = np.concatenate([cv2.resize(cf, (S // 2, S)), cv2.resize(cf * 0.96, (S // 2, S))], axis=1)
    mat = crease_and_dirt(print_on_cardboard(two, S), 32, folds=((0.5, None),), footprints=3)
    files.append(save(mat, "cardboard_mat_chang.jpg"))
    plain = crease_and_dirt(corrugated(S) * 1.0, 33, folds=((0.36, None), (0.71, None)), footprints=2,
                            marker=[("ของเฮีย ห้ามนอน!", (0.5, 0.30), 92, 4), ("ลังเปล่า", (0.24, 0.72), 70, -8),
                                    ("ด้านบน", (0.80, 0.86), 58, 0)], arrow=(0.80, 0.80))
    files.append(save(plain, "cardboard_mat_plain.jpg"))
    fo = T.grade(acg("Styrofoam004", "Color"), warm=0.02)
    fo = crease_and_dirt(fo, 34, folds=(), footprints=0, rings=1, dirt_amt=0.25)
    files.append(save(fo, "foam_mat_dirty.jpg"))
    return files, S, S


# ======================================================================================= MAIN
def main():
    os.makedirs(OUT, exist_ok=True)
    names = sys.argv[1:] or list(JOBS)
    man_path = os.path.join(OUT, "manifest.json")
    man = {}
    if os.path.exists(man_path):
        man = {e["name"]: e for e in json.load(open(man_path, encoding="utf-8"))["textures"]}
    logs = {}
    for lp in (RP + "/_log.jsonl", PS + "/_log.jsonl"):
        if os.path.exists(lp):
            for line in open(lp, encoding="utf-8"):
                d = json.loads(line)
                logs[d["file"]] = d
    for n in names:
        j = JOBS[n]
        files, w, h = j["fn"]()
        srcs = []
        for s in j["sources"]:
            if s.startswith("acg/"):
                a = s.split("/")[1]
                srcs.append({"asset": a, "url": f"https://ambientcg.com/view?id={a}", "licence": "CC0 1.0"})
            else:
                key = s.split("/", 1)[1]
                d = logs.get(key, {})
                srcs.append({"file": s, "image_url": d.get("image", ""), "page_url": d.get("page", ""),
                             "licence": "unknown (web photo, client instruction 2026-10-19)"})
        man[n] = {"name": n, "files": files, "purpose": j["purpose"], "alpha": j["alpha"], "size": [w, h],
                  "notes": j["notes"], "sources": srcs}
        print("made", n, files, flush=True)
    data = {"note": "Prop textures (real photos + CC0 scans). *_n = OpenGL normal map, *_r = roughness. Tiles are "
                    "seamless unless noted.", "textures": [man[k] for k in sorted(man)]}
    json.dump(data, open(man_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
