#!/usr/bin/env python3
"""R6-pbr: composite / procedural materials that need custom processing.

Usage: python3 -I build_special.py [id ...]
Writes into public/assets/textures/pbr/<id>/ and scripts/research/R6/out/special_manifest.json
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

import r6lib as L  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
N = 1024


def lum(a):
    a = a.astype(np.float32)
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def acg(aid):
    return L.fetch_acg(aid, "1K")


def img(p, mode, size=None, h=None):
    a = L.load_img(p, mode)
    if size:
        im = Image.fromarray(a if mode != "F" else (a * 255).astype(np.uint8))
        im = im.resize((size, h or size), Image.LANCZOS)
        a = np.asarray(im)
        if mode == "F":
            a = a.astype(np.float32) / 255.0
    return a


def hperiodic(a):
    """Make an image horizontally seamless by cross-fading with a half-width rolled copy."""
    W = a.shape[1]
    x = np.arange(W, dtype=np.float32) / (W - 1)
    w = 1.0 - np.abs(x * 2 - 1)          # 0 at edges, 1 in middle
    w = L.smoothstep(0.0, 0.6, w)
    shape = (1, W) + ((1,) if a.ndim == 3 else ())
    w = w.reshape(shape)
    r = np.roll(a, W // 2, axis=1)
    return a * w + r * (1 - w)


# ----------------------------------------------------------------------------- materials
def concrete_streaked():
    base = L.load_ph_material("concrete_wall_008", N)
    alb = base["albedo"].astype(np.float32)
    orm = base["orm"].astype(np.float32)
    nrm = L.normal_decode(base["normal"])
    total_a = np.zeros((N, N), np.float32)
    col_acc = np.zeros((N, N, 3), np.float32)
    # top-down streaks (two decals, offset horizontally, cover upper ~62% of the storey)
    for aid, shift, height_frac, k in (("Leaking004", 0, 0.62, 0.85), ("Leaking001", N // 3, 0.5, 0.6)):
        p = acg(aid)
        hpx = int(N * height_frac)
        c = img(p["Color"], "RGB", N, hpx).astype(np.float32)
        a = img(p["Opacity"], "L", N, hpx).astype(np.float32) / 255.0
        c, a = hperiodic(c), hperiodic(a)
        c, a = np.roll(c, shift, 1), np.roll(a, shift, 1)
        a *= k
        col_acc[:hpx] = col_acc[:hpx] * (1 - a[..., None]) + c * a[..., None]
        total_a[:hpx] = 1 - (1 - total_a[:hpx]) * (1 - a)
    # rising damp / rain splash band at the base (bottom ~22 %)
    p = acg("Leaking008")
    hpx = int(N * 0.22)
    c = hperiodic(img(p["Color"], "RGB", N, hpx).astype(np.float32))
    a = hperiodic(img(p["Opacity"], "L", N, hpx).astype(np.float32) / 255.0) * 0.8
    col_acc[N - hpx:] = col_acc[N - hpx:] * (1 - a[..., None]) + c * a[..., None]
    total_a[N - hpx:] = 1 - (1 - total_a[N - hpx:]) * (1 - a)
    # multiply-style stain keeping the algae hue
    stain = np.clip(col_acc / 255.0 * 2.2, 0, 1)
    out = alb * (1 - total_a[..., None]) + alb * stain * total_a[..., None]
    orm[..., 1] = np.clip(orm[..., 1] - total_a * 20, 0, 255)  # stains marginally smoother
    mat = dict(albedo=out, normal=L.normal_encode(nrm), orm=orm, height=base["height"])
    files = L.write_material("concrete_streaked", mat, N)
    return files, dict(tileMeters=3.0, tint=False,
                       tags=["wall", "concrete", "water-streaks", "algae", "rising-damp", "storey-height", "shophouse-side"],
                       source="polyhaven:concrete_wall_008 + ambientcg:Leaking004,Leaking001,Leaking008",
                       sourceUrl="https://polyhaven.com/a/concrete_wall_008 ; https://ambientcg.com/a/Leaking004 ; https://ambientcg.com/a/Leaking001 ; https://ambientcg.com/a/Leaking008",
                       author="Poly Haven (see credits) + ambientCG (Lennart Demes)", license="CC0",
                       note="One tile = one storey (3 m): dark algae streaks hang from the top edge, rain-splash band at the bottom. Tile horizontally; align V to the storey.")


def stainless_dented_greasy():
    b = acg("Metal049B")
    c = acg("Metal049C")
    g = acg("SurfaceImperfections008")
    alb = img(b["Color"], "RGB").astype(np.float32)
    rough_b = img(b["Roughness"], "L").astype(np.float32) / 255.0
    rough_c = img(c["Roughness"], "L").astype(np.float32) / 255.0
    metal = img(b["Metalness"], "L").astype(np.float32)
    nrm = L.normal_decode(img(c["NormalGL"], "RGB"))
    nrm[..., :2] *= 2.6  # make the dents read at game distances
    nrm = L.normal_encode(nrm)
    grease = img(g["Opacity"], "L").astype(np.float32) / 255.0
    grease = L.smoothstep(0.25, 0.85, L.fft_blur(grease, 1.5))
    alb = alb * (0.76 * 255 / max(lum(alb).mean(), 1))  # stainless steel base colour ~ sRGB 0.76
    alb = alb * (1 - 0.22 * grease[..., None])
    alb = alb * np.array([0.98, 0.97, 0.95])  # very slight warm tarnish
    r = np.clip(0.55 * rough_b + 0.45 * rough_c, 0, 1)
    r = r * (1 - grease) + np.clip(r + 0.25, 0, 0.75) * grease
    h = img(c["Displacement"], "F")
    ao = L.ao_from_height(h, strength=1.0, radius=8, floor=0.75)
    orm = np.stack([ao * 255, r * 255, metal], -1)
    mat = dict(albedo=alb, normal=nrm, orm=orm, height=None)
    files = L.write_material("stainless_dented_greasy", mat, N)
    return files, dict(tileMeters=0.5, tint=False,
                       tags=["metal", "stainless", "dented", "greasy", "smudged", "cart", "kitchen", "counter"],
                       source="ambientcg:Metal049C (dents/normal) + ambientcg:Metal049B (smears) + ambientcg:SurfaceImperfections008 (grease)",
                       sourceUrl="https://ambientcg.com/a/Metal049C ; https://ambientcg.com/a/Metal049B ; https://ambientcg.com/a/SurfaceImperfections008",
                       author="ambientCG (Lennart Demes)", license="CC0")


def casino_pattern(n=N):
    """Garish but plausible casino carpet ornament, periodic over the tile (2 medallions/tile)."""
    y, x = np.mgrid[0:n, 0:n].astype(np.float32) / n
    red = np.array([92, 10, 20], np.float32)
    dred = np.array([58, 5, 14], np.float32)
    gold = np.array([206, 160, 72], np.float32)
    dgold = np.array([150, 102, 38], np.float32)
    black = np.array([20, 10, 12], np.float32)
    teal = np.array([20, 96, 104], np.float32)
    blue = np.array([28, 44, 120], np.float32)

    def local(cx, cy, period=1.0):
        dx = (x - cx + 0.5 * period) % period - 0.5 * period
        dy = (y - cy + 0.5 * period) % period - 0.5 * period
        return dx, dy

    # damask background: low-contrast swirls (periodic sinusoid combo)
    t = 2 * np.pi
    dam = (np.sin(t * (2 * x + np.sin(t * y) * 0.15)) * np.sin(t * (2 * y + np.sin(t * x) * 0.15)))
    dam += 0.5 * np.sin(t * 4 * (x + y)) * np.sin(t * 4 * (x - y))
    dam = L.smoothstep(-0.2, 0.9, dam)
    col = red[None, None] * (1 - 0.35 * dam[..., None]) + dred[None, None] * (0.35 * dam[..., None])

    def paint(mask, c):
        nonlocal col
        m = np.clip(mask, 0, 1)[..., None]
        col = col * (1 - m) + c[None, None] * m

    def soft(d, w=0.0025):
        return L.smoothstep(w, -w, d)  # inside where d<0

    # diamond trellis (lines u+v and u-v at half-tile spacing)
    du =np.abs(((x + y) * 2 % 1.0) - 0.5)
    dv = np.abs(((x - y) * 2 % 1.0) - 0.5)
    line = np.minimum(0.5 - du, 0.5 - dv)  # distance-ish to the trellis lines
    paint(soft(line - 0.016), black)
    paint(soft(line - 0.009), dgold)
    paint(soft(line - 0.004), gold)

    for (cx, cy, big) in ((0.5, 0.5, True), (0.0, 0.0, True), (0.5, 0.0, False), (0.0, 0.5, False)):
        dx, dy = local(cx, cy)
        r = np.sqrt(dx * dx + dy * dy)
        th = np.arctan2(dy, dx)
        if big:
            petals = 0.5 + 0.5 * np.cos(8 * th)
            outer = 0.19 * (0.78 + 0.22 * petals)
            paint(soft(r - outer - 0.012), black)
            paint(soft(r - outer), dred)
            scroll = np.abs(np.sin(10 * th + 38 * r))
            ring = soft(r - 0.165) * soft(0.10 - r)
            paint(ring * soft(scroll - 0.35, 0.05), gold)
            paint(soft(np.abs(r - 0.098) - 0.007), black)
            paint(soft(np.abs(r - 0.098) - 0.004), gold)
            p2 = 0.5 + 0.5 * np.cos(6 * th + 0.3)
            paint(soft(r - 0.075 * (0.7 + 0.3 * p2)), teal)
            paint(soft(r - 0.045), gold)
            paint(soft(r - 0.022), black)
            paint(soft(r - 0.012), red)
        else:
            p4 = 0.5 + 0.5 * np.cos(4 * th)
            paint(soft(r - 0.07 * (0.55 + 0.45 * p4) - 0.008), black)
            paint(soft(r - 0.07 * (0.55 + 0.45 * p4)), gold)
            paint(soft(r - 0.03), blue)
            paint(soft(r - 0.012), gold)
    # small 4-point stars on quarter offsets
    for cx in (0.25, 0.75):
        for cy in (0.25, 0.75):
            dx, dy = local(cx, cy)
            star = np.abs(dx) * np.abs(dy) * 900 + (np.abs(dx) + np.abs(dy)) * 18
            paint(soft(star - 0.55, 0.06), gold)
            paint(soft(np.sqrt(dx * dx + dy * dy) - 0.008), teal)
    return col


def carpet_casino():
    p = acg("Carpet015")
    fib = img(p["Color"], "RGB", N // 2).astype(np.float32)
    fl = lum(fib)
    fl = fl / fl.mean()
    fl = np.tile(fl, (2, 2))
    nrm = np.tile(img(p["NormalGL"], "RGB", N // 2), (2, 2, 1))
    rough = np.tile(img(p["Roughness"], "L", N // 2), (2, 2)).astype(np.float32)
    ao = np.tile(img(p["AmbientOcclusion"], "L", N // 2), (2, 2)).astype(np.float32)
    pat = casino_pattern(N)
    # printed-on-pile softness + wear
    pat = np.stack([L.fft_blur(pat[..., i], 1.4) for i in range(3)], -1)
    wear = L.tile_noise(N, scale=3, beta=2.0, seed=7)
    grime = L.tile_noise(N, scale=12, beta=1.4, seed=8)
    alb = pat * np.clip(0.35 + 0.65 * fl, 0.3, 1.6)[..., None]
    alb = alb * (0.88 + 0.16 * wear[..., None]) * (0.94 + 0.1 * grime[..., None])
    orm = np.stack([ao, np.clip(rough * 0.2 + 0.78 * 255, 0, 255), np.zeros_like(ao)], -1)
    files = L.write_material("carpet_casino", dict(albedo=alb, normal=nrm, orm=orm), N)
    return files, dict(tileMeters=0.8, tint=False,
                       tags=["fabric", "carpet", "casino", "patterned", "red", "gold", "interior"],
                       source="procedural ornament (R6) printed over ambientcg:Carpet015 pile (colour detail, normal, roughness, AO)",
                       sourceUrl="https://ambientcg.com/a/Carpet015",
                       author="R6-pbr (pattern, CC0) + ambientCG (Lennart Demes)", license="CC0")


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
                       source="ambientcg:Fabric034 (re-coloured casino green)", sourceUrl="https://ambientcg.com/a/Fabric034",
                       author="ambientCG (Lennart Demes)", license="CC0",
                       note="Baked casino green. For other colours use the luminance of albedo x your colour.")


def glass_dirty():
    a = img(acg("SurfaceImperfections014")["Opacity"], "L").astype(np.float32) / 255.0
    f = img(acg("Fingerprints008")["Opacity"], "L").astype(np.float32) / 255.0
    s = img(acg("Smear005")["Opacity"], "L").astype(np.float32) / 255.0
    c = img(acg("SurfaceImperfections014")["Color"], "RGB").astype(np.float32)
    dust = L.smoothstep(0.30, 0.95, a)
    big = img(acg("SurfaceImperfections016")["Opacity"], "L").astype(np.float32) / 255.0  # real scan, large-scale variation
    big = L.fft_blur(big, 24)
    big = (big - big.min()) / (big.max() - big.min() + 1e-9)
    mask = np.clip(dust * (0.35 + 0.65 * big) * 0.85 + f * 0.3 + s * 0.22, 0, 1)
    dirt_col = np.array([150, 138, 118], np.float32)
    alb = dirt_col[None, None] * (0.75 + 0.25 * (lum(c) / max(lum(c).mean(), 1))[..., None])
    rough = 0.04 + 0.8 * mask
    orm = np.stack([np.full((N, N), 255.0), rough * 255, np.zeros((N, N))], -1)
    nrm = L.normal_from_height(L.fft_blur(mask, 1.2), strength=3.0)
    files = L.write_material("glass_dirty", dict(albedo=alb, normal=nrm, orm=orm), N,
                             extra={"mask": mask * 255})
    return files, dict(tileMeters=1.0, tint=False,
                       tags=["glass", "dirty", "dust", "smudges", "fingerprints", "window", "display-case", "overlay"],
                       source="ambientcg:SurfaceImperfections014 + ambientcg:SurfaceImperfections016 + ambientcg:Fingerprints008 + ambientcg:Smear005",
                       sourceUrl="https://ambientcg.com/a/SurfaceImperfections014 ; https://ambientcg.com/a/Fingerprints008 ; https://ambientcg.com/a/Smear005",
                       author="ambientCG (Lennart Demes)", license="CC0",
                       note="Dirt layer for glass. mask.jpg = dirt amount (use as alphaMap on an overlay mesh, or to mix roughness/transmission). Clean glass roughness ~0.04 in orm.G.")


def water_normal(mid, tile_m, kind, seed, strength, note):
    rng = np.random.default_rng(seed)
    n = N
    k1 = np.fft.fftfreq(n, d=tile_m / n) * 2 * np.pi  # rad/m
    kx = k1[None, :]
    ky = k1[:, None]
    k = np.sqrt(kx ** 2 + ky ** 2)
    k[0, 0] = 1e-6
    if kind == "ripples":
        lam = 0.035
        k0 = 2 * np.pi / lam
        P = np.exp(-((k - k0) / (0.45 * k0)) ** 2) + 0.25 * np.exp(-((k - 0.45 * k0) / (0.3 * k0)) ** 2)
    else:
        V = 3.0 if kind == "calm" else 7.0
        g = 9.81
        Lw = V * V / g
        wdir = np.array([np.cos(0.6), np.sin(0.6)])
        kd = (kx * wdir[0] + ky * wdir[1]) / k
        P = np.exp(-1.0 / (k * Lw) ** 2) / k ** 4 * (np.abs(kd) ** (2 if kind == "calm" else 3))
        small = 0.02 if kind == "calm" else 0.008
        P *= np.exp(-(k * small) ** 2)
        P += 0.0002 * np.exp(-(k * small * 3) ** 2) / np.maximum(k, 1) ** 3  # cross-sea filler
    P[0, 0] = 0
    H = (rng.standard_normal((n, n)) + 1j * rng.standard_normal((n, n))) * np.sqrt(P / 2)
    h = np.real(np.fft.ifft2(H)).astype(np.float32)
    h = (h - h.mean()) / (h.std() + 1e-9)
    nrm = L.normal_from_height(h, strength=strength)
    d = os.path.join(L.PBR_OUT, mid)
    os.makedirs(d, exist_ok=True)
    L.save_jpg(nrm, os.path.join(d, "normal.jpg"), 85, 0)
    hn = (h - h.min()) / (h.max() - h.min())
    L.save_jpg(hn * 255, os.path.join(d, "height.jpg"), 85, 0)
    files = dict(albedo=None, normal=f"{mid}/normal.jpg", orm=None, height=f"{mid}/height.jpg")
    return files, dict(tileMeters=tile_m, tint=False, tags=["water", "normal-only", kind] + (["puddle", "rain"] if kind == "ripples" else ["canal", "klong"]),
                       source="procedural (R6-pbr, FFT ocean/ripple spectrum)", sourceUrl="", author="R6-pbr (generated)", license="CC0",
                       note=note)


SPECIALS = {
    "concrete_streaked": concrete_streaked,
    "stainless_dented_greasy": stainless_dented_greasy,
    "carpet_casino": carpet_casino,
    "felt_casino_green": felt_casino_green,
    "glass_dirty": glass_dirty,
    "water_ripples_puddle": lambda: water_normal("water_ripples_puddle", 0.5, "ripples", 3, 2.2,
                                                 "Tileable capillary ripples for puddles; scroll two copies in opposite directions for motion."),
    "water_canal_calm": lambda: water_normal("water_canal_calm", 6.0, "calm", 5, 3.2,
                                             "Gentle wind-swell for a still canal (klong). Scroll slowly along the wind direction (~34 deg)."),
    "water_wind_chop": lambda: water_normal("water_wind_chop", 2.5, "chop", 9, 5.0,
                                            "Choppier wind waves / boat wake chop. Blend with water_canal_calm at a different scale."),
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
