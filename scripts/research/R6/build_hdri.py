#!/usr/bin/env python3
"""R6-pbr: download Poly Haven HDRIs (1k + 2k .hdr), make 512x256 JPG previews, write manifest.

Usage: python3 -I build_hdri.py
Output: public/assets/hdri/<name>_1k.hdr, <name>_2k.hdr, <name>_preview.jpg, manifest.json
Sun direction uses three.js equirect convention (EquirectangularReflectionMapping):
  u = atan2(dir.z, dir.x)/(2*pi) + 0.5 ; v = asin(dir.y)/pi + 0.5 (v=1 = top row of the image).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cv2  # noqa: E402
import numpy as np  # noqa: E402

import r6lib as L  # noqa: E402

OUT = os.path.join(L.ROOT, "public/assets/hdri")

PICKS = [
    # key, polyhaven id, mood, has_sun, notes
    ("day_hazy_street", "wide_street_01", "hazy bright urban day: hot high sun, pale washed-out sky, dusty light ground", True,
     "Default daytime street lighting. Sky near the horizon is milky; pair with warm-white fog for the hot hazy look."),
    ("overcast_day", "urban_courtyard_02", "overcast day (rainy-season grey sky), soft shadowless light", False,
     "Use for rainy/monsoon moments together with asphalt_wet / concrete_wet_puddles."),
    ("golden_hour_riverside", "shanghai_riverside", "golden hour / late-afternoon sunset over an Asian riverside city", True,
     "Low warm sun; long shadows. Good for evening rush-hour scenes and the canal edge."),
    ("dusk_blue_hour", "rooftop_night", "dusk / blue hour: purple-pink twilight sky, sodium lamps switching on", False,
     "Transition between day and night; lamps are visible as small warm hotspots."),
    ("night_street_sodium", "courtyard_night", "night city street lit by orange sodium lamps, purple night sky, palm silhouette", False,
     "Main night environment. Keep envMapIntensity modest and let practical lights (street lamps, shop signs) dominate."),
    ("interior_warm_casino", "pretville_cinema", "warm interior, red seats + gold ceiling lights (casino-like / lounge)", False,
     "Casino intro cutscene and warm interiors; red/gold reflections on chrome, glass, brass_gold, leather_red_quilted."),
    ("studio_neutral", "studio_small_09", "neutral photo studio with softboxes", False,
     "Main-menu album-cover scene, magazine/fashion renders, item turntables."),
]


def lum(img):
    return img[..., 0] * 0.2126 + img[..., 1] * 0.7152 + img[..., 2] * 0.0722


def read_hdr(path):
    bgr = cv2.imread(path, cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR)
    if bgr is None:
        raise RuntimeError("cannot read " + path)
    return bgr[..., ::-1].astype(np.float32)


def aces(x):
    a, b, c, d, e = 2.51, 0.03, 2.43, 0.59, 0.14
    return np.clip((x * (a * x + b)) / (x * (c * x + d) + e), 0, 1)


def preview(img, exposure, path):
    small = cv2.resize(img, (512, 256), interpolation=cv2.INTER_AREA)
    t = aces(small * exposure)
    srgb = np.where(t <= 0.0031308, 12.92 * t, 1.055 * np.power(t, 1 / 2.4) - 0.055)
    L.save_jpg(srgb * 255, path, 88, 2)


def analyse(img, has_sun):
    H, W = img.shape[:2]
    l = lum(img)
    rows = (np.arange(H) + 0.5) / H
    el = (0.5 - rows) * np.pi                       # +pi/2 at top row
    w = np.cos(el)[:, None] * np.ones((1, W))       # solid-angle weight
    logavg = float(np.exp((np.log(l + 1e-4) * w).sum() / w.sum()))
    mean = float((l * w).sum() / w.sum())
    upper = float((l[: H // 2] * w[: H // 2]).sum() / w[: H // 2].sum())
    info = dict(meanLuminance=round(mean, 4), logAvgLuminance=round(logavg, 4), upperHemisphereMean=round(upper, 4))
    # suggested three.js toneMappingExposure: map the solid-angle log-average luminance to ~0.18-0.25
    exp_ = float(np.clip(0.22 / max(logavg, 1e-4), 0.25, 8.0))
    info["recommendedExposure"] = round(exp_, 2)
    if has_sun:
        sm = cv2.GaussianBlur(l, (0, 0), 2)
        r, c = np.unravel_index(np.argmax(sm), sm.shape)
        u = (c + 0.5) / W
        v = 1.0 - (r + 0.5) / H
        phi = (u - 0.5) * 2 * np.pi
        elev = (v - 0.5) * np.pi
        d = [float(np.cos(elev) * np.cos(phi)), float(np.sin(elev)), float(np.cos(elev) * np.sin(phi))]
        info["sunDirection"] = [round(x, 4) for x in d]
        info["sunElevationDeg"] = round(float(np.degrees(elev)), 1)
        info["sunAzimuthDeg_threejs"] = round(float(np.degrees(phi)), 1)
        info["sunPixel_uv"] = [round(float(u), 4), round(float(v), 4)]
        info["sunPeakLuminance"] = round(float(l[r, c]), 1)
    return info


def main():
    os.makedirs(OUT, exist_ok=True)
    cat = json.load(open(os.path.join(L.CACHE, "catalog/ph_hdris.json")))
    man = {}
    for key, pid, mood, has_sun, note in PICKS:
        fdir = os.path.join(L.CACHE, "catalog", "files")
        fn = os.path.join(fdir, f"hdri_{pid}.json")
        if not os.path.exists(fn):
            open(fn, "wb").write(L.http_get(f"https://api.polyhaven.com/files/{pid}"))
        files = json.load(open(fn))
        entry = dict(mood=mood)
        for res in ("1k", "2k"):
            url = files["hdri"][res]["hdr"]["url"]
            dst = os.path.join(OUT, f"{key}_{res}.hdr")
            if not os.path.exists(dst):
                data = L.http_get(url)
                if not data.startswith(b"#?RADIANCE") and not data.startswith(b"#?RGBE"):
                    raise RuntimeError("not a Radiance HDR: " + url)
                open(dst, "wb").write(data)
            entry[f"file{res}"] = f"{key}_{res}.hdr"
        img = read_hdr(os.path.join(OUT, f"{key}_2k.hdr"))
        info = analyse(img, has_sun)
        preview(img, info["recommendedExposure"], os.path.join(OUT, f"{key}_preview.jpg"))
        c = cat.get(pid, {})
        entry.update(dict(
            preview=f"{key}_preview.jpg",
            recommendedExposure=info.pop("recommendedExposure"),
            envMapIntensity=1.0,
            sunDirection=info.pop("sunDirection", None),
            sunElevationDeg=info.pop("sunElevationDeg", None),
            sunAzimuthDeg_threejs=info.pop("sunAzimuthDeg_threejs", None),
            stats=info,
            note=note,
            source=f"polyhaven:{pid}",
            sourceUrl=f"https://polyhaven.com/a/{pid}",
            author=", ".join((c.get("authors") or {}).keys()),
            license="CC0",
            mapping="equirectangular (THREE.EquirectangularReflectionMapping); load with RGBELoader / HDRLoader",
        ))
        entry = {k: v for k, v in entry.items() if v is not None}
        man[key] = entry
        print(key, pid, entry["recommendedExposure"], entry.get("sunDirection"), entry.get("sunElevationDeg"))
    json.dump(man, open(os.path.join(OUT, "manifest.json"), "w"), indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main()
