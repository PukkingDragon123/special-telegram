"""R6-pbr shared helpers: safe downloading of CC0 texture sources, map loading, ORM packing,
periodic (tile-safe) filtering, normal-map convention checks and JPEG writing.

All downloaded files are treated as untrusted DATA: they are only decoded as images with
Pillow / extracted member-by-member from zips (no path traversal, images only). Nothing
downloaded is ever executed. Run every script that imports this with `python3 -I`.
"""
import io
import json
import os
import re
import time
import zipfile

import numpy as np
import requests
from PIL import Image

Image.MAX_IMAGE_PIXELS = 20000 * 20000

UA = "HiaPhatGameDev/0.1 (https://github.com/PukkingDragon123/special-telegram)"
ROOT = "/home/user/special-telegram"
CACHE = os.path.join(ROOT, "scripts/_cache/pbr_dl")
RAW = os.path.join(CACHE, "raw")
PBR_OUT = os.path.join(ROOT, "public/assets/textures/pbr")

_S = requests.Session()
_S.headers["User-Agent"] = UA


def http_get(url, retries=4, timeout=180):
    last = None
    for i in range(retries):
        try:
            r = _S.get(url, timeout=timeout, allow_redirects=True)
            if r.status_code == 429:
                time.sleep(5 * (i + 1))
                continue
            r.raise_for_status()
            return r.content
        except Exception as e:  # noqa
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"GET failed {url}: {last}")


# ----------------------------------------------------------------------------- catalogs
_PH_CAT = None
_ACG_CAT = None


def ph_catalog():
    global _PH_CAT
    if _PH_CAT is None:
        _PH_CAT = json.load(open(os.path.join(CACHE, "catalog/ph_textures.json")))
    return _PH_CAT


def acg_catalog():
    global _ACG_CAT
    if _ACG_CAT is None:
        _ACG_CAT = {}
        for fn in ("acg_Material.jsonl", "acg_Atlas.jsonl", "acg_Decal.jsonl"):
            p = os.path.join(CACHE, "catalog", fn)
            if os.path.exists(p):
                for line in open(p):
                    r = json.loads(line)
                    _ACG_CAT[r["assetId"]] = r
    return _ACG_CAT


def ph_files(aid):
    fdir = os.path.join(CACHE, "catalog", "files")
    os.makedirs(fdir, exist_ok=True)
    fn = os.path.join(fdir, aid + ".json")
    if not os.path.exists(fn):
        data = http_get(f"https://api.polyhaven.com/files/{aid}")
        json.loads(data)  # validate
        open(fn, "wb").write(data)
    return json.load(open(fn))


def source_info(src):
    """Return dict(url, author, license, name, tile_m) for 'ph:<id>' or 'acg:<id>'."""
    kind, aid = src.split(":", 1)
    if kind == "ph":
        c = ph_catalog().get(aid, {})
        authors = ", ".join((c.get("authors") or {}).keys()) or "Poly Haven"
        dims = c.get("dimensions") or [0, 0]
        tile = round(dims[0] / 1000.0, 3) if dims and dims[0] else None
        return dict(url=f"https://polyhaven.com/a/{aid}", author=authors, license="CC0",
                    name=c.get("name", aid), tile_m=tile, site="Poly Haven")
    c = acg_catalog().get(aid, {})
    dx = c.get("dimensionX") or 0
    tile = round(dx / 100.0, 3) if dx else None
    return dict(url=f"https://ambientcg.com/a/{aid}", author="ambientCG (Lennart Demes)",
                license="CC0", name=c.get("displayName", aid), tile_m=tile, site="ambientCG")


# ----------------------------------------------------------------------------- image io
def load_img(path_or_bytes, mode=None):
    if isinstance(path_or_bytes, (bytes, bytearray)):
        im = Image.open(io.BytesIO(path_or_bytes))
    else:
        im = Image.open(path_or_bytes)
    im.load()
    if mode:
        if mode == "F":
            if im.mode in ("I;16", "I;16B", "I"):
                a = np.asarray(im, dtype=np.float32)
                mx = 65535.0 if a.max() > 255 else 255.0
                return a / mx
            im = im.convert("L")
            return np.asarray(im, dtype=np.float32) / 255.0
        im = im.convert(mode)
    return np.asarray(im)


def resize_arr(a, size, is_float=False):
    if a.shape[0] == size and a.shape[1] == size:
        return a
    if is_float:
        im = Image.fromarray(a.astype(np.float32), mode="F")
        return np.asarray(im.resize((size, size), Image.LANCZOS), dtype=np.float32)
    im = Image.fromarray(a)
    return np.asarray(im.resize((size, size), Image.LANCZOS))


def save_jpg(arr, path, quality=85, subsampling=2):
    """subsampling: 0 = 4:4:4 (data maps), 2 = 4:2:0 (albedo)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    a = np.clip(arr, 0, 255).astype(np.uint8)
    mode = "L" if a.ndim == 2 else "RGB"
    Image.fromarray(a, mode).save(path, quality=quality, subsampling=subsampling, optimize=True,
                                  progressive=False)


# ----------------------------------------------------------------------------- downloads
def safe_extract_images(zip_bytes, dest):
    os.makedirs(dest, exist_ok=True)
    out = {}
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        for info in z.infolist():
            name = info.filename
            base = os.path.basename(name)
            if not base or name.startswith("/") or ".." in name.replace("\\", "/").split("/"):
                continue
            if not re.search(r"\.(jpg|jpeg|png)$", base, re.I):
                continue
            if info.file_size > 200 * 1024 * 1024:
                continue
            data = z.read(info)
            p = os.path.join(dest, base)
            open(p, "wb").write(data)
            out[base] = p
    return out


def fetch_ph(aid, res_key, maps=("Diffuse", "nor_gl", "arm", "Displacement")):
    """Download selected Poly Haven maps (jpg, or png for Displacement) -> dict name->path."""
    files = ph_files(aid)
    d = os.path.join(RAW, f"ph_{aid}_{res_key}")
    os.makedirs(d, exist_ok=True)
    out = {}
    for m in maps:
        if m not in files:
            continue
        entry = files[m].get(res_key) or files[m].get("1k")
        if not entry:
            continue
        fmt = "png" if (m == "Displacement" and "png" in entry) else ("jpg" if "jpg" in entry else "png")
        url = entry[fmt]["url"]
        p = os.path.join(d, f"{m}.{fmt}")
        if not os.path.exists(p):
            open(p, "wb").write(http_get(url))
            time.sleep(0.1)
        out[m] = p
    return out


def fetch_acg(aid, res_key="1K"):
    d = os.path.join(RAW, f"acg_{aid}_{res_key}")
    marker = os.path.join(d, ".done")
    if not os.path.exists(marker):
        data = http_get(f"https://ambientcg.com/get?file={aid}_{res_key}-JPG.zip")
        if data[:2] != b"PK":
            raise RuntimeError(f"not a zip for {aid}")
        safe_extract_images(data, d)
        open(marker, "w").write("ok")
        time.sleep(0.3)
    out = {}
    for fn in os.listdir(d):
        m = re.search(r"_(Color|NormalGL|NormalDX|Roughness|AmbientOcclusion|Metalness|Displacement|Opacity|Scattering|Emission)\.(jpg|png)$", fn)
        if m:
            out[m.group(1)] = os.path.join(d, fn)
    return out


# ----------------------------------------------------------------------------- filters
def fft_blur(a, sigma):
    """Periodic gaussian blur (keeps textures tileable). a: 2D float array."""
    if sigma <= 0:
        return a.copy()
    h, w = a.shape
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    g = np.exp(-2 * (np.pi ** 2) * (sigma ** 2) * (fx ** 2 + fy ** 2))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g)).astype(np.float32)


def tile_noise(size, scale=8.0, beta=2.0, seed=0, octaves_cut=None):
    """Periodic fractal noise in [0,1]. scale ~ number of large blobs across the tile."""
    rng = np.random.default_rng(seed)
    wn = rng.standard_normal((size, size)).astype(np.float32)
    fy = np.fft.fftfreq(size)[:, None] * size
    fx = np.fft.fftfreq(size)[None, :] * size
    f = np.sqrt(fx ** 2 + fy ** 2)
    f[0, 0] = 1.0
    amp = 1.0 / np.power(np.maximum(f, scale), beta)
    if octaves_cut:
        amp *= np.exp(-(f / octaves_cut) ** 2)
    amp[0, 0] = 0
    n = np.real(np.fft.ifft2(np.fft.fft2(wn) * amp))
    n = (n - n.min()) / (n.max() - n.min() + 1e-9)
    return n.astype(np.float32)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0 + 1e-9), 0, 1)
    return t * t * (3 - 2 * t)


def ao_from_height(h, strength=1.6, radius=6.0, floor=0.55):
    """Cheap cavity AO from a 0..1 height map (periodic). Returns 0..1."""
    hb = fft_blur(h, radius)
    hb2 = fft_blur(h, radius * 3)
    cav = np.clip((hb - h) * strength * 4 + (hb2 - h) * strength * 2, 0, 1)
    return np.clip(1.0 - cav, floor, 1.0).astype(np.float32)


def normal_from_height(h, strength=4.0):
    """OpenGL (+Y up) tangent-space normal from height (periodic finite differences)."""
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    dy_down = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5  # derivative along image rows (down)
    nx = -dx * strength
    ny = dy_down * strength  # +Y up => n_y = -dh/dy_up = +dh/drow
    nz = np.ones_like(h)
    l = np.sqrt(nx ** 2 + ny ** 2 + nz ** 2)
    n = np.stack([nx / l, ny / l, nz / l], -1)
    return ((n * 0.5 + 0.5) * 255).astype(np.uint8)


def normal_decode(n8):
    n = n8.astype(np.float32) / 255.0 * 2 - 1
    return n


def normal_encode(n):
    l = np.sqrt((n ** 2).sum(-1, keepdims=True)) + 1e-9
    n = n / l
    return np.clip((n * 0.5 + 0.5) * 255 + 0.5, 0, 255).astype(np.uint8)


def check_normal_gl(normal8, height):
    """Correlate normal X/Y against height gradients. For OpenGL maps: corrY>0, corrX<0."""
    n = normal_decode(normal8)
    h = height.astype(np.float32)
    if h.shape != n.shape[:2]:
        h = resize_arr(h, n.shape[0], is_float=True)
    h = fft_blur(h, 1.0)
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1))
    dyr = (np.roll(h, -1, 0) - np.roll(h, 1, 0))

    def corr(a, b):
        a = a - a.mean()
        b = b - b.mean()
        return float((a * b).sum() / (np.sqrt((a * a).sum() * (b * b).sum()) + 1e-9))

    return corr(n[..., 0], dx), corr(n[..., 1], dyr)


# ----------------------------------------------------------------------------- loaders
def load_ph_material(aid, size, need_height=True):
    res_key = "2k" if size > 1024 else "1k"
    maps = ["Diffuse", "nor_gl", "arm"] + (["Displacement"] if need_height else [])
    p = fetch_ph(aid, res_key, maps)
    albedo = resize_arr(load_img(p["Diffuse"], "RGB"), size)
    normal = resize_arr(load_img(p["nor_gl"], "RGB"), size)
    arm = resize_arr(load_img(p["arm"], "RGB"), size)
    height = None
    if "Displacement" in p:
        height = resize_arr(load_img(p["Displacement"], "F"), size, is_float=True)
    return dict(albedo=albedo, normal=normal, orm=arm, height=height, opacity=None)


def load_acg_material(aid, size, ao_from_disp=True):
    res_key = "2K" if size > 1024 else "1K"
    p = fetch_acg(aid, res_key)
    if "Color" not in p or "NormalGL" not in p:
        raise RuntimeError(f"{aid}: missing Color/NormalGL in {list(p)}")
    albedo = resize_arr(load_img(p["Color"], "RGB"), size)
    normal = resize_arr(load_img(p["NormalGL"], "RGB"), size)
    rough = resize_arr(load_img(p["Roughness"], "L"), size) if "Roughness" in p else np.full((size, size), 200, np.uint8)
    metal = resize_arr(load_img(p["Metalness"], "L"), size) if "Metalness" in p else np.zeros((size, size), np.uint8)
    height = resize_arr(load_img(p["Displacement"], "F"), size, is_float=True) if "Displacement" in p else None
    if "AmbientOcclusion" in p:
        ao = resize_arr(load_img(p["AmbientOcclusion"], "L"), size)
    elif height is not None and ao_from_disp:
        ao = (ao_from_height(height) * 255).astype(np.uint8)
    else:
        ao = np.full((size, size), 255, np.uint8)
    orm = np.stack([ao, rough, metal], -1)
    opacity = resize_arr(load_img(p["Opacity"], "L"), size) if "Opacity" in p else None
    return dict(albedo=albedo, normal=normal, orm=orm, height=height, opacity=opacity)


def load_material(src, size, need_height=True):
    kind, aid = src.split(":", 1)
    if kind == "ph":
        return load_ph_material(aid, size, need_height)
    return load_acg_material(aid, size)


def write_material(mid, mat, size, write_height=False, extra=None, normal_q=85, data_size=None):
    data_size = data_size or size
    d = os.path.join(PBR_OUT, mid)
    os.makedirs(d, exist_ok=True)
    out = {}
    save_jpg(resize_arr(np.clip(mat["albedo"], 0, 255).astype(np.uint8), size), os.path.join(d, "albedo.jpg"), 85, 2)
    out["albedo"] = f"{mid}/albedo.jpg"
    save_jpg(resize_arr(mat["normal"], size), os.path.join(d, "normal.jpg"), normal_q, 0)
    out["normal"] = f"{mid}/normal.jpg"
    save_jpg(resize_arr(np.clip(mat["orm"], 0, 255).astype(np.uint8), data_size), os.path.join(d, "orm.jpg"), 85, 0)
    out["orm"] = f"{mid}/orm.jpg"
    if write_height and mat.get("height") is not None:
        h = mat["height"]
        h = (h - h.min()) / (h.max() - h.min() + 1e-9)
        save_jpg((resize_arr(h.astype(np.float32), data_size, True) * 255), os.path.join(d, "height.jpg"), 85, 0)
        out["height"] = f"{mid}/height.jpg"
    if mat.get("opacity") is not None:
        save_jpg(resize_arr(mat["opacity"], data_size), os.path.join(d, "opacity.jpg"), 85, 0)
        out["opacity"] = f"{mid}/opacity.jpg"
    for name, arr in (extra or {}).items():
        save_jpg(resize_arr(arr, data_size), os.path.join(d, f"{name}.jpg"), 85, 0)
        out[name] = f"{mid}/{name}.jpg"
    return out
