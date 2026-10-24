#!/usr/bin/env python3
"""R6-pbr: composite / photo-derived materials (all sources are real photos or photo-scans).

Usage: python3 -I build_special.py [id ...]
Writes into public/assets/textures/pbr/<id>/ and scripts/research/R6/out/special_manifest.json

Sources: Poly Haven scans (CC0), ambientCG Photogrammetry/Approximated/MultiAngle sets (CC0),
Flickr photos found via Openverse (CC BY / CC BY-SA / PDM, credited per material).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cv2  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

import r6lib as L  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
OV = os.path.join(L.CACHE, "openverse")
N = 1024
LUMW = np.array([0.2126, 0.7152, 0.0722], np.float32)


def lum(a):
    return a.astype(np.float32) @ LUMW


def acg(aid):
    return L.fetch_acg(aid, "1K")


def img(p, mode, w=None, h=None):
    a = L.load_img(p, mode)
    if w:
        src = a if mode != "F" else (np.clip(a, 0, 1) * 255).astype(np.uint8)
        a = np.asarray(Image.fromarray(src).resize((w, h or w), Image.LANCZOS))
        if mode == "F":
            a = a.astype(np.float32) / 255.0
    return a


def square_crop(a, cx=0.5, cy=0.5, frac=1.0):
    H, W = a.shape[:2]
    s = int(min(H, W) * frac)
    x0 = int(np.clip(cx * W - s / 2, 0, W - s))
    y0 = int(np.clip(cy * H - s / 2, 0, H - s))
    return a[y0:y0 + s, x0:x0 + s]


def resize(a, n):
    return cv2.resize(a.astype(np.float32), (n, n), interpolation=cv2.INTER_AREA if a.shape[0] > n else cv2.INTER_CUBIC)


def ov_meta(set_name, idx):
    sel = json.load(open(os.path.join(OV, f"{set_name}_selected.json")))
    r = sel[str(idx)]
    lic = {"by": "CC BY", "by-sa": "CC BY-SA", "pdm": "Public Domain Mark", "cc0": "CC0"}.get(r["license"], r["license"])
    if r["license"] in ("by", "by-sa"):
        lic += " " + str(r.get("license_version") or "")
    return dict(file=r["file"], url=r["landing"], author=r.get("creator") or "unknown", license=lic.strip(),
                title=r.get("title") or "")


def photo_material(photo_rgb, n=N, flat_sigma=None, crop=(0.5, 0.5, 1.0), seamless="crossfade"):
    a = square_crop(photo_rgb.astype(np.float32), *crop)
    if flat_sigma:
        a = L.flat_field(a, flat_sigma * a.shape[0] / 1000.0)
    if seamless == "mirror":
        a = L.mirror_tile(resize(a, n // 2))
    else:
        a = L.seamless_crossfade(resize(a, n))
    return np.clip(a, 0, 255)


def smear_mask(aid, n=N):
    """0..1 smudge/fingerprint mask from a photo-based ambientCG imperfection set (Opacity, else Roughness deviation)."""
    p = acg(aid)
    if "Opacity" in p:
        return img(p["Opacity"], "L", n).astype(np.float32) / 255.0
    r = img(p["Roughness"], "L", n).astype(np.float32)
    med = np.median(r)
    dev = np.abs(r - med)
    return np.clip(dev / (np.percentile(dev, 99.5) + 1e-6), 0, 1)


# ----------------------------------------------------------------------------- ground
def asphalt_patched():
    base = L.load_ph_material("asphalt_04", N)
    alb = base["albedo"].astype(np.float32)
    alb *= 0.36 * 255 / max(lum(alb).mean(), 1)
    nrm = L.normal_decode(base["normal"])
    orm = base["orm"].astype(np.float32)
    H = base["height"].astype(np.float32)

    def stamp(aid, comp_index, cx, cy, size_px, rot_k=0, darken=1.0):
        p = acg(aid)
        col = img(p["Color"], "RGB").astype(np.float32)
        op = img(p["Opacity"], "L").astype(np.float32) / 255.0
        dn = img(p["NormalGL"], "RGB")
        rg = img(p["Roughness"], "L").astype(np.float32) if "Roughness" in p else None
        m = (op > 0.5).astype(np.uint8)
        k, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
        order = np.argsort(-st[1:, cv2.CC_STAT_AREA]) + 1
        i = order[comp_index % len(order)]
        x, y, w, h, _ = st[i]
        pad = 8
        x0, y0, x1, y1 = max(0, x - pad), max(0, y - pad), min(1024, x + w + pad), min(1024, y + h + pad)
        sl = (slice(y0, y1), slice(x0, x1))
        a_ = op[sl] * cv2.dilate((lab[sl] == i).astype(np.uint8), np.ones((5, 5), np.uint8))
        c_, n_ = col[sl], L.normal_decode(dn[sl])
        r_ = rg[sl] if rg is not None else None
        sc = size_px / max(a_.shape)
        nw, nh = max(2, int(a_.shape[1] * sc)), max(2, int(a_.shape[0] * sc))
        a_ = cv2.resize(a_, (nw, nh), interpolation=cv2.INTER_AREA)
        c_ = cv2.resize(c_, (nw, nh), interpolation=cv2.INTER_AREA)
        n_ = cv2.resize(n_, (nw, nh), interpolation=cv2.INTER_AREA)
        r_ = cv2.resize(r_, (nw, nh), interpolation=cv2.INTER_AREA) if r_ is not None else None
        for _ in range(rot_k % 4):   # 90-degree turns keep normals exact
            a_, c_ = np.rot90(a_), np.rot90(c_)
            n_ = np.rot90(n_).copy()
            n_[..., 0], n_[..., 1] = -n_[..., 1].copy(), n_[..., 0].copy()
            r_ = np.rot90(r_) if r_ is not None else None
        # match decal brightness to the base around it, then stamp with wrap-around
        c_ = c_ * (lum(alb).mean() / max(lum(c_)[a_ > 0.5].mean(), 1)) * darken
        hh, ww = a_.shape
        ys = (np.arange(hh) + int(cy * N - hh / 2)) % N
        xs = (np.arange(ww) + int(cx * N - ww / 2)) % N
        Y, X = np.meshgrid(ys, xs, indexing="ij")
        A = a_[..., None]
        alb[Y, X] = alb[Y, X] * (1 - A) + c_ * A
        nrm[Y, X] = nrm[Y, X] * (1 - A) + n_ * A
        if r_ is not None:
            orm[Y, X, 1] = orm[Y, X, 1] * (1 - a_) + r_ * a_
        orm[Y, X, 0] = orm[Y, X, 0] * (1 - 0.25 * a_)
        H[Y, X] = H[Y, X] * (1 - a_) + (H[Y, X] - 0.08) * a_

    stamp("AsphaltDamage001", 0, 0.28, 0.30, 330, 0, 0.82)        # cut-and-filled square patch
    stamp("AsphaltDamage001", 0, 0.74, 0.78, 250, 1, 0.75)
    stamp("AsphaltDamageSet001", 0, 0.62, 0.20, 520, 0, 1.08)     # worn surface strips (aggregate showing)
    stamp("AsphaltDamageSet001", 2, 0.20, 0.80, 420, 0, 1.05)
    stamp("AsphaltDamageSet002", 0, 0.86, 0.45, 150, 0, 0.9)      # gravel-filled potholes
    stamp("AsphaltDamageSet002", 3, 0.47, 0.57, 120, 1, 0.9)
    mat = dict(albedo=alb, normal=L.normal_encode(nrm), orm=orm, height=H)
    files = L.write_material("asphalt_patched", mat, N, write_height=True)
    return files, dict(tileMeters=5.0, tint=False, tags=["ground", "road", "asphalt", "patched", "repairs", "potholes", "outdoor"],
                       source="polyhaven:asphalt_04 + ambientcg:AsphaltDamage001, AsphaltDamageSet001, AsphaltDamageSet002 (photogrammetry decals)",
                       sourceUrl="https://polyhaven.com/a/asphalt_04 ; https://ambientcg.com/a/AsphaltDamage001 ; https://ambientcg.com/a/AsphaltDamageSet001 ; https://ambientcg.com/a/AsphaltDamageSet002",
                       author="Poly Haven (Jenelle van Heerden, Sergej Majboroda) + ambientCG (Lennart Demes)", license="CC0",
                       note="Real scanned patches/worn strips/potholes composited (wrap-around) onto the main road asphalt.")


# ----------------------------------------------------------------------------- walls
def concrete_streaked():
    base = L.load_ph_material("concrete_wall_008", N)
    src = L.load_ph_material("red_plaster_weathered", N)   # real vertical rain-weathering streaks
    alb = base["albedo"].astype(np.float32)
    s_l = lum(src["albedo"])
    s_l = s_l / max(s_l.mean(), 1)
    hp = s_l / np.maximum(L.fft_blur(s_l.astype(np.float32), 90), 1e-3)   # keep streak structure, drop colour/lighting
    streak = np.clip(hp, 0.35, 1.6) ** 1.6
    moss = L.load_ph_material("worn_mossy_plasterwall", N)
    m_l = lum(moss["albedo"])
    m_l = m_l / max(m_l.mean(), 1)
    stain = np.clip(m_l / np.maximum(L.fft_blur(m_l.astype(np.float32), 60), 1e-3), 0.3, 1.4)
    k = streak * (0.55 + 0.45 * stain)
    tint = np.array([0.96, 0.99, 0.94], np.float32)                     # faint algae cast in the dark streaks
    out = alb * k[..., None]
    out = out * (tint + (1 - tint) * np.clip(k, 0, 1)[..., None])
    orm = base["orm"].astype(np.float32)
    orm[..., 0] = np.clip(orm[..., 0] * np.clip(0.75 + 0.25 * k, 0, 1), 0, 255)
    mat = dict(albedo=out, normal=base["normal"], orm=orm)
    files = L.write_material("concrete_streaked", mat, N)
    return files, dict(tileMeters=2.7, tint=False,
                       tags=["wall", "concrete", "water-streaks", "stained", "algae", "humid", "shophouse-side"],
                       source="polyhaven:concrete_wall_008 + streak/stain luminance from polyhaven:red_plaster_weathered and polyhaven:worn_mossy_plasterwall",
                       sourceUrl="https://polyhaven.com/a/concrete_wall_008 ; https://polyhaven.com/a/red_plaster_weathered ; https://polyhaven.com/a/worn_mossy_plasterwall",
                       author="Poly Haven (see credits)", license="CC0",
                       note="Concrete scan multiplied by the real weathering streaks and mould stains of two other scans.")


# ----------------------------------------------------------------------------- metals (real photos)
def _metal_from_photo(photo, crop, flat, base_srgb, rough_lo, rough_hi, n_strength, hp=6.0, invert_rough=False):
    a = photo_material(L.load_img(photo, "RGB"), N, flat, crop)
    l = lum(a) / 255.0
    det = l / max(l.mean(), 1e-3)
    alb = np.array(base_srgb, np.float32)[None, None] * np.clip(0.75 + 0.25 * det, 0.5, 1.3)[..., None]
    h = L.height_from_photo(a, hp, 0.7)
    t = np.clip((det - 0.6) / 0.8, 0, 1)
    if invert_rough:
        t = 1 - t
    rough = rough_lo + (rough_hi - rough_lo) * t
    ao = L.ao_from_height(h, 0.6, 4, 0.85)
    orm = np.stack([ao * 255, rough * 255, np.full_like(rough, 255)], -1)
    nrm = L.normal_from_height(h, n_strength)
    return alb, nrm, orm


def stainless_brushed():
    m = ov_meta("ov_metal", 16)
    alb, nrm, orm = _metal_from_photo(m["file"], (0.5, 0.5, 1.0), 60, (196, 197, 198), 0.22, 0.48, 1.6)
    files = L.write_material("stainless_brushed", dict(albedo=alb, normal=nrm, orm=orm), N)
    return files, dict(tileMeters=0.6, tint=False, tags=["metal", "stainless", "brushed", "scratched", "kitchen", "cart", "counter"],
                       source=f"photo: '{m['title']}' (Flickr via Openverse)", sourceUrl=m["url"], author=m["author"], license=m["license"],
                       note="Real photo of scratched/brushed steel: flat-fielded, made seamless; normal/roughness derived from the photo.")


def galvanized_steel():
    m = ov_meta("ov_metal", 30)
    alb, nrm, orm = _metal_from_photo(m["file"], (0.5, 0.5, 1.0), 80, (168, 170, 172), 0.32, 0.6, 0.9, hp=5.0, invert_rough=True)
    files = L.write_material("galvanized_steel", dict(albedo=alb, normal=nrm, orm=orm), N)
    return files, dict(tileMeters=0.7, tint=False, tags=["metal", "galvanized", "zinc", "spangle", "sheet", "pipe", "bucket"],
                       source=f"photo: '{m['title']}' (Flickr via Openverse)", sourceUrl=m["url"], author=m["author"], license=m["license"],
                       note="Real photo of zinc spangle: flat-fielded, made seamless; brighter crystals = smoother.")


def chrome():
    s5 = img(acg("Smear005")["Opacity"], "L", N).astype(np.float32) / 255.0
    s8 = img(acg("SurfaceImperfections008")["Opacity"], "L", N).astype(np.float32) / 255.0
    sm = np.clip(0.7 * s5 + 0.5 * L.smoothstep(0.3, 0.9, s8), 0, 1)
    alb = np.zeros((N, N, 3), np.float32) + np.array([200, 201, 203], np.float32)
    alb *= (1 - 0.06 * sm)[..., None]
    rough = 0.04 + 0.3 * sm
    orm = np.stack([np.full((N, N), 255.0), rough * 255, np.full((N, N), 255.0)], -1)
    nrm = L.normal_from_height(L.fft_blur(sm, 1.0), 0.6)
    files = L.write_material("chrome", dict(albedo=alb, normal=nrm, orm=orm), N)
    return files, dict(tileMeters=0.5, tint=False, tags=["metal", "chrome", "polished", "mirror", "smudged"],
                       source="ambientcg:Smear005 + ambientcg:SurfaceImperfections008 (photo-based smudge scans) over chrome reflectance",
                       sourceUrl="https://ambientcg.com/a/Smear005 ; https://ambientcg.com/a/SurfaceImperfections008",
                       author="ambientCG (Lennart Demes)", license="CC0",
                       note="Chrome is a near-uniform mirror; its detail is the real scanned smudges in roughness.")


def brass_gold():
    fp = np.clip(smear_mask("Smear002") + smear_mask("Smear004"), 0, 1)
    d = img(acg("SurfaceImperfections017")["Opacity"], "L", N).astype(np.float32) / 255.0
    tarnish = L.smoothstep(0.2, 0.9, L.fft_blur(d, 6))
    alb = np.zeros((N, N, 3), np.float32) + np.array([224, 188, 112], np.float32)
    alb *= (1 - 0.22 * tarnish)[..., None] * (1 - 0.08 * fp)[..., None]
    rough = 0.18 + 0.25 * fp + 0.2 * tarnish
    orm = np.stack([np.full((N, N), 255.0), np.clip(rough, 0, 1) * 255, np.full((N, N), 255.0)], -1)
    nrm = L.normal_from_height(L.fft_blur(fp, 0.8), 0.5)
    files = L.write_material("brass_gold", dict(albedo=alb, normal=nrm, orm=orm), N)
    return files, dict(tileMeters=0.4, tint=False, tags=["metal", "brass", "gold", "casino", "fingerprints", "tarnish"],
                       source="ambientcg:Smear002, Smear004 (photo fingerprints) + ambientcg:SurfaceImperfections017 (photo dirt) over brass reflectance",
                       sourceUrl="https://ambientcg.com/a/Smear002 ; https://ambientcg.com/a/Smear004 ; https://ambientcg.com/a/SurfaceImperfections017",
                       author="ambientCG (Lennart Demes)", license="CC0")


def stainless_dented_greasy():
    m = ov_meta("ov_metal", 16)
    alb, nrm, orm = _metal_from_photo(m["file"], (0.5, 0.5, 1.0), 60, (190, 190, 186), 0.26, 0.5, 1.4)
    dents = L.load_ph_material("rusty_metal_03", N)        # real scan of a warped sheet: keep only its low-frequency relief
    dh = L.fft_blur(dents["height"].astype(np.float32), 9)
    dh = (dh - dh.min()) / (dh.max() - dh.min() + 1e-9)
    nrm = L.blend_normals(nrm, L.normal_from_height(dh, 9.0), 1.0)
    g = acg("SurfaceImperfections008")
    grease = img(g["Opacity"], "L", N).astype(np.float32) / 255.0
    grease = L.smoothstep(0.25, 0.85, L.fft_blur(grease, 1.5))
    alb = alb * (1 - 0.25 * grease[..., None]) * np.array([0.99, 0.97, 0.93])
    orm[..., 1] = np.clip(orm[..., 1] / 255.0 * (1 - grease) + np.clip(orm[..., 1] / 255.0 + 0.25, 0, 0.8) * grease, 0, 1) * 255
    orm[..., 0] = orm[..., 0] * (0.9 + 0.1 * dh)
    files = L.write_material("stainless_dented_greasy", dict(albedo=alb, normal=nrm, orm=orm), N)
    return files, dict(tileMeters=0.6, tint=False, tags=["metal", "stainless", "dented", "greasy", "smudged", "cart", "kitchen", "counter"],
                       source=f"photo '{m['title']}' (Flickr via Openverse) + polyhaven:rusty_metal_03 (low-frequency dent relief) + ambientcg:SurfaceImperfections008 (grease)",
                       sourceUrl=f"{m['url']} ; https://polyhaven.com/a/rusty_metal_03 ; https://ambientcg.com/a/SurfaceImperfections008",
                       author=f"{m['author']} + Poly Haven + ambientCG", license=f"{m['license']} + CC0")


# ----------------------------------------------------------------------------- plastics
def _plastic(mid, rough_lo, rough_hi, smudge, tags, note):
    p = acg("Plastic001")                                   # real photographed plastic (scratches, micro-texture)
    col = img(p["Color"], "RGB", N).astype(np.float32)
    l = lum(col)
    det = l / max(l.mean(), 1e-3)
    det = L.fft_blur((1 + (det - 1) * 0.1).astype(np.float32), 1.5)
    alb = np.zeros((N, N, 3), np.float32) + 205
    alb *= np.clip(det, 0.92, 1.08)[..., None]
    r = img(p["Roughness"], "L", N).astype(np.float32) / 255.0
    r = (r - r.min()) / (r.max() - r.min() + 1e-6)
    rough = rough_lo + (rough_hi - rough_lo) * r
    if smudge:
        s = smear_mask("Smear004")
        rough = np.clip(rough + 0.2 * s, 0, 1)
    nrm = L.normal_decode(img(p["NormalGL"], "RGB", N))
    nrm[..., :2] *= 0.35
    orm = np.stack([np.full((N, N), 255.0), rough * 255, np.zeros((N, N))], -1)
    files = L.write_material(mid, dict(albedo=alb, normal=L.normal_encode(nrm), orm=orm), N)
    return files, dict(tileMeters=0.5, tint=True, tags=tags,
                       source="ambientcg:Plastic001 (photo-based) neutralised for tinting" + (" + ambientcg:Smear004" if smudge else ""),
                       sourceUrl="https://ambientcg.com/a/Plastic001" + (" ; https://ambientcg.com/a/Smear004" if smudge else ""),
                       author="ambientCG (Lennart Demes)", license="CC0", note=note)


def plastic_rough():
    return _plastic("plastic_rough", 0.55, 0.8, False, ["plastic", "rough", "chair", "stool", "basin", "crate"],
                    "Neutral light grey: multiply by the object colour (Thai red/blue plastic chairs, basins).")


def plastic_glossy():
    return _plastic("plastic_glossy", 0.1, 0.3, True, ["plastic", "glossy", "bottle", "bucket", "sign", "cooler"],
                    "Neutral light grey glossy plastic with real smudges; tint per object.")


# ----------------------------------------------------------------------------- textiles
def carpet_casino():
    m = ov_meta("ov_carpet", 10)
    ph = L.load_img(m["file"], "RGB").astype(np.float32)      # 1024x683, oblique view of a casino carpet
    Hh, Ww = ph.shape[:2]
    # keystone correction of the oblique shot (far edge = top), then take the near (sharpest) region
    src = np.float32([[0.12 * Ww, 0.30 * Hh], [0.88 * Ww, 0.30 * Hh], [1.0 * Ww, 1.0 * Hh], [0.0, 1.0 * Hh]])
    side = 900
    dst = np.float32([[0, 0], [side, 0], [side, side * 0.85], [0, side * 0.85]])
    M = cv2.getPerspectiveTransform(src, dst)
    rect = cv2.warpPerspective(ph, M, (side, int(side * 0.85)), flags=cv2.INTER_CUBIC)
    rect = square_crop(rect, 0.5, 0.55, 1.0)
    rect = L.flat_field(rect, 120)
    alb = L.mirror_tile(resize(rect, N // 2))                  # seamless symmetric repeat
    pile = acg("Carpet015")                                    # photogrammetry carpet pile (normal/rough/AO)
    nrm = np.tile(img(pile["NormalGL"], "RGB", N // 2), (2, 2, 1))
    rough = np.tile(img(pile["Roughness"], "L", N // 2), (2, 2)).astype(np.float32)
    ao = np.tile(img(pile["AmbientOcclusion"], "L", N // 2), (2, 2)).astype(np.float32)
    orm = np.stack([ao, np.clip(rough * 0.2 + 0.78 * 255, 0, 255), np.zeros_like(ao)], -1)
    files = L.write_material("carpet_casino", dict(albedo=alb, normal=nrm, orm=orm), N)
    return files, dict(tileMeters=1.2, tint=False, tags=["fabric", "carpet", "casino", "patterned", "red", "floral", "interior"],
                       source=f"photo '{m['title']}' (Flickr via Openverse) + ambientcg:Carpet015 pile maps",
                       sourceUrl=f"{m['url']} ; https://ambientcg.com/a/Carpet015", author=f"{m['author']} + ambientCG (Lennart Demes)",
                       license=f"{m['license']} (albedo) + CC0 (pile maps)",
                       note="Real casino carpet photo: keystone-corrected, flat-fielded and mirror-tiled into a seamless symmetric repeat.")


def felt_casino_green():
    p = acg("Fabric034")
    c = img(p["Color"], "RGB").astype(np.float32)
    l = lum(c)
    l = l / l.mean()
    green = np.array([28, 104, 58], np.float32)
    alb = green[None, None] * np.clip(0.75 + 0.25 * l, 0.5, 1.4)[..., None]
    r = img(p["Roughness"], "L").astype(np.float32)
    r = np.clip(r * 0.3 + 0.68 * 255, 0, 255)
    h = img(p["Displacement"], "F")
    ao = L.ao_from_height(h, strength=0.8, radius=4, floor=0.8) * 255
    nrm = img(p["NormalGL"], "RGB")
    orm = np.stack([ao, r, np.zeros_like(r)], -1)
    files = L.write_material("felt_casino_green", dict(albedo=alb, normal=nrm, orm=orm), N)
    return files, dict(tileMeters=0.4, tint=False, tags=["fabric", "felt", "baize", "green", "casino", "card-table"],
                       source="ambientcg:Fabric034 (photo-based felt, re-coloured casino green)", sourceUrl="https://ambientcg.com/a/Fabric034",
                       author="ambientCG (Lennart Demes)", license="CC0",
                       note="Baked casino green. For other colours use the luminance of albedo x your colour.")


# ----------------------------------------------------------------------------- glass
def glass_dirty():
    d17 = acg("SurfaceImperfections017")
    dirt = img(d17["Opacity"], "L", N).astype(np.float32) / 255.0
    spots = img(acg("SurfaceImperfections009")["Opacity"], "L", N).astype(np.float32) / 255.0
    smear = img(acg("Smear005")["Opacity"], "L", N).astype(np.float32) / 255.0
    fp = smear_mask("Smear004")
    big = L.fft_blur(dirt, 30)
    big = (big - big.min()) / (big.max() - big.min() + 1e-9)
    mask = np.clip(L.smoothstep(0.15, 0.9, dirt) * (0.3 + 0.7 * big) * 0.8 + spots * 0.35 + smear * 0.25 + fp * 0.3, 0, 1)
    c = img(d17["Color"], "RGB", N).astype(np.float32)
    dirt_col = np.array([150, 138, 118], np.float32)
    alb = dirt_col[None, None] * (0.75 + 0.25 * (lum(c) / max(lum(c).mean(), 1)))[..., None]
    rough = 0.04 + 0.8 * mask
    orm = np.stack([np.full((N, N), 255.0), rough * 255, np.zeros((N, N))], -1)
    nrm = L.normal_from_height(L.fft_blur(mask, 1.2), 3.0)
    files = L.write_material("glass_dirty", dict(albedo=alb, normal=nrm, orm=orm), N, extra={"mask": mask * 255})
    return files, dict(tileMeters=1.0, tint=False,
                       tags=["glass", "dirty", "dust", "smudges", "fingerprints", "water-spots", "window", "display-case", "overlay"],
                       source="ambientcg:SurfaceImperfections017, SurfaceImperfections009, Smear005, Smear004 (photo-based imperfection scans)",
                       sourceUrl="https://ambientcg.com/a/SurfaceImperfections017 ; https://ambientcg.com/a/SurfaceImperfections009 ; https://ambientcg.com/a/Smear005 ; https://ambientcg.com/a/Smear004",
                       author="ambientCG (Lennart Demes)", license="CC0",
                       note="Dirt layer for glass. mask.jpg = dirt amount (alphaMap on an overlay, or drive roughness/transmission). Clean glass roughness ~0.04.")


# ----------------------------------------------------------------------------- water (real photos -> normal maps)
def water(mid, set_idx, crop, hp, strength, tile_m, tags, note, flat=40):
    m = ov_meta("ov_water", set_idx)
    a = photo_material(L.load_img(m["file"], "RGB"), N, flat, crop)
    h = L.height_from_photo(a, hp, 0.6)
    nrm = L.normal_from_height(h, strength)
    d = os.path.join(L.PBR_OUT, mid)
    os.makedirs(d, exist_ok=True)
    L.save_jpg(nrm, os.path.join(d, "normal.jpg"), 85, 0)
    L.save_jpg(h * 255, os.path.join(d, "height.jpg"), 85, 0)
    files = dict(albedo=None, normal=f"{mid}/normal.jpg", orm=None, height=f"{mid}/height.jpg")
    return files, dict(tileMeters=tile_m, tint=False, tags=["water", "normal-only"] + tags,
                       source=f"photo '{m['title']}' (Flickr via Openverse)", sourceUrl=m["url"], author=m["author"], license=m["license"],
                       note=note + " Normal derived from the photo's luminance (made seamless).")


SPECIALS = {
    "asphalt_patched": asphalt_patched,
    "concrete_streaked": concrete_streaked,
    "stainless_brushed": stainless_brushed,
    "stainless_dented_greasy": stainless_dented_greasy,
    "galvanized_steel": galvanized_steel,
    "chrome": chrome,
    "brass_gold": brass_gold,
    "plastic_rough": plastic_rough,
    "plastic_glossy": plastic_glossy,
    "carpet_casino": carpet_casino,
    "felt_casino_green": felt_casino_green,
    "glass_dirty": glass_dirty,
    "water_ripples_puddle": lambda: water("water_ripples_puddle", 14, (0.5, 0.55, 1.0), 10, 2.0, 0.6, ["puddle", "rain", "ripples"],
                                          "Raindrop rings on a puddle; scroll/flip two copies for animated rain."),
    "water_canal_calm": lambda: water("water_canal_calm", 28, (0.5, 0.5, 1.0), 12, 2.2, 3.0, ["canal", "klong", "calm", "ripples"],
                                      "Fine wind ripples on still water; scroll slowly, blend two scales."),
    "water_wind_chop": lambda: water("water_wind_chop", 31, (0.5, 0.5, 1.0), 20, 2.8, 4.0, ["canal", "river", "waves", "chop"],
                                     "Larger wave undulation; blend under water_canal_calm at a different scale."),
}


def main():
    want = set(sys.argv[1:])
    os.makedirs(OUT, exist_ok=True)
    mp = os.path.join(OUT, "special_manifest.json")
    man = json.load(open(mp)) if os.path.exists(mp) else {}
    for mid, fn in SPECIALS.items():
        if want and mid not in want:
            continue
        try:
            files, meta = fn()
            e = dict(files)
            e.update(meta)
            e["resolution"] = N
            man[mid] = e
            print("ok", mid, flush=True)
        except Exception as ex:  # noqa
            import traceback
            traceback.print_exc()
            print("FAIL", mid, ex, flush=True)
        json.dump(man, open(mp, "w"), indent=1)


if __name__ == "__main__":
    main()
