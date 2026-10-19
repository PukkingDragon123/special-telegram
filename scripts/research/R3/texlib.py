"""Shared helpers for R3 texture work (numpy / OpenCV / Pillow only).

Colour convention: arrays are float32 in [0,1].  `srgb_to_lin` / `lin_to_srgb` convert.
Periodic (tileable) noise is produced in the Fourier domain so every procedural map
wraps perfectly.
"""
import json
import math
import os

import numpy as np
from PIL import Image

try:
    import cv2
except ImportError:  # pragma: no cover
    cv2 = None


# ----------------------------------------------------------------------------- colour
def srgb_to_lin(c):
    c = np.asarray(c, dtype=np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def lin_to_srgb(c):
    c = np.clip(np.asarray(c, dtype=np.float32), 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055).astype(np.float32)


def hex2rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], dtype=np.float32)


def rgb2hex(c):
    c = np.clip(np.round(np.asarray(c) * 255), 0, 255).astype(int)
    return "#%02x%02x%02x" % tuple(c[:3])


def load(path, mode="RGB"):
    with Image.open(path) as im:
        return np.asarray(im.convert(mode), dtype=np.float32) / 255.0


def save(path, arr, quality=90):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    a = np.clip(np.round(np.asarray(arr) * 255.0), 0, 255).astype(np.uint8)
    if a.ndim == 2:
        im = Image.fromarray(a, "L")
    elif a.shape[2] == 4:
        im = Image.fromarray(a, "RGBA")
    else:
        im = Image.fromarray(a, "RGB")
    if path.lower().endswith((".jpg", ".jpeg")):
        im.convert("RGB" if im.mode == "RGBA" else im.mode).save(
            path, "JPEG", quality=quality, optimize=True, progressive=True, subsampling=0)
    else:
        im.save(path, optimize=True)


def resize(arr, w, h=None):
    h = h or w
    if cv2 is not None:
        interp = cv2.INTER_AREA if w < arr.shape[1] else cv2.INTER_CUBIC
        return cv2.resize(arr, (w, h), interpolation=interp)
    im = Image.fromarray(np.clip(arr * 255, 0, 255).astype(np.uint8))
    return np.asarray(im.resize((w, h), Image.LANCZOS), dtype=np.float32) / 255.0


# ----------------------------------------------------------------------------- noise
def _freq_grid(h, w):
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    return fx, fy


def fbm(h, w=None, beta=2.0, seed=0, lo=None, hi=None, aniso=(1.0, 1.0), angle=0.0):
    """Tileable 1/f^beta noise normalised to zero mean, unit std.
    lo/hi: optional band limits in cycles per image (approx).
    aniso: stretch factors (sx, sy) -> larger = longer features along that axis.
    """
    w = w or h
    rng = np.random.default_rng(seed)
    wn = rng.standard_normal((h, w)).astype(np.float32)
    F = np.fft.fft2(wn)
    fx, fy = _freq_grid(h, w)
    ca, sa = math.cos(angle), math.sin(angle)
    u = (fx * ca + fy * sa) * w * aniso[0]
    v = (-fx * sa + fy * ca) * h * aniso[1]
    r = np.sqrt(u * u + v * v)
    r[0, 0] = 1.0
    amp = 1.0 / np.power(r, beta / 2.0)
    if lo is not None:
        amp *= 1.0 / (1.0 + np.exp(-(r - lo) * 2.0))
    if hi is not None:
        amp *= np.exp(-(r / hi) ** 2)
    amp[0, 0] = 0
    out = np.real(np.fft.ifft2(F * amp)).astype(np.float32)
    out -= out.mean()
    out /= out.std() + 1e-8
    return out


def blur_wrap(a, sigma):
    """Gaussian blur with wrap-around (tile-safe), via FFT."""
    if sigma <= 0:
        return a
    h, w = a.shape[:2]
    fx, fy = _freq_grid(h, w)
    g = np.exp(-2 * (math.pi ** 2) * (sigma ** 2) * (fx ** 2 + fy ** 2)).astype(np.float32)
    if a.ndim == 2:
        return np.real(np.fft.ifft2(np.fft.fft2(a) * g)).astype(np.float32)
    return np.stack([np.real(np.fft.ifft2(np.fft.fft2(a[..., c]) * g)) for c in range(a.shape[2])],
                    -1).astype(np.float32)


def norm01(a):
    a = a - a.min()
    return a / (a.max() + 1e-8)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0 + 1e-8), 0, 1)
    return t * t * (3 - 2 * t)


def ridge(n):
    return 1.0 - np.abs(n)


# ----------------------------------------------------------------------------- normals
def height_to_normal(hgt, strength=2.0, wrap=True):
    """OpenGL-convention (+Y up) tangent-space normal map from a height field in [0,1]."""
    if wrap:
        dx = (np.roll(hgt, -1, 1) - np.roll(hgt, 1, 1)) * 0.5
        dy = (np.roll(hgt, -1, 0) - np.roll(hgt, 1, 0)) * 0.5
    else:
        dy, dx = np.gradient(hgt)
    nx = -dx * strength
    ny = dy * strength
    nz = np.ones_like(hgt)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    n = np.stack([nx / l, ny / l, nz / l], -1)
    return n * 0.5 + 0.5


def detail_from_photo(img, sigma=24.0):
    """High-pass luminance detail of a (tileable) photo texture, mean 1.0 (multiplicative)."""
    lum = img[..., 0] * 0.2126 + img[..., 1] * 0.7152 + img[..., 2] * 0.0722
    lum_l = srgb_to_lin(lum)
    low = blur_wrap(lum_l, sigma)
    d = lum_l / (low + 1e-4)
    return d.astype(np.float32)


def make_tileable(img, blend=0.25):
    """Make an arbitrary photo crop tileable by cross-fading with its half-offset copy."""
    h, w = img.shape[:2]
    off = np.roll(np.roll(img, h // 2, 0), w // 2, 1)
    yy = np.abs(np.linspace(-1, 1, h))[:, None]
    xx = np.abs(np.linspace(-1, 1, w))[None, :]
    m = np.maximum(yy, xx)
    a = smoothstep(1 - 2 * blend, 1.0, m)
    if img.ndim == 3:
        a = a[..., None]
    return (img * (1 - a) + off * a).astype(np.float32)


def write_manifest(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
