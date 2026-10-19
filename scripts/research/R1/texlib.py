"""R1-streets texture toolkit (numpy/PIL/OpenCV).  Run callers with python3 -I.

Conventions: images are float32 numpy arrays in [0,1], shape (H,W,3) or (H,W,4).
All noise is periodic (tileable) unless stated otherwise.
"""
import math
import os

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

RAW = "/home/user/special-telegram/references/streets/_raw"
CC0 = RAW + "/cc0"
OUT_TEX = "/home/user/special-telegram/public/assets/textures/world"
OUT_SIGN = "/home/user/special-telegram/public/assets/img/signs"
FONTS = "/home/user/special-telegram/scripts/_cache/fonts"

rng = np.random.default_rng(1234)


# ------------------------------------------------------------------ io
def load(path, size=None, mode="RGB"):
    im = Image.open(path)
    im = im.convert(mode)
    if size:
        if isinstance(size, int):
            size = (size, size)
        im = im.resize(size, Image.LANCZOS)
    return np.asarray(im).astype(np.float32) / 255.0


def load_gray(path, size=None):
    im = Image.open(path)
    if im.mode in ("I;16", "I", "I;16B"):
        a = np.asarray(im).astype(np.float32)
        a = a / max(a.max(), 1)
        im = Image.fromarray((a * 255).astype(np.uint8))
    im = im.convert("L")
    if size:
        if isinstance(size, int):
            size = (size, size)
        im = im.resize(size, Image.LANCZOS)
    return np.asarray(im).astype(np.float32) / 255.0


def to_img(a):
    a = np.clip(a, 0, 1)
    a8 = (a * 255 + 0.5).astype(np.uint8)
    if a8.ndim == 2:
        return Image.fromarray(a8, "L")
    return Image.fromarray(a8, "RGBA" if a8.shape[2] == 4 else "RGB")


def save_jpg(a, path, q=86):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im = to_img(a)
    if im.mode == "RGBA":
        im = im.convert("RGB")
    im.save(path, quality=q, optimize=True, progressive=True, subsampling=0 if q >= 90 else 2)
    return path


def save_png(a, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im = to_img(a)
    im.save(path, optimize=True)
    return path


def ph(aid, kind="diff", size=None):
    """Poly Haven map loader: kind in diff, nor_gl, rough, ao, disp."""
    d = os.path.join(CC0, "polyhaven", aid)
    for f in os.listdir(d):
        if f.startswith(f"{aid}_{kind}."):
            p = os.path.join(d, f)
            return load_gray(p, size) if kind in ("rough", "ao", "disp") else load(p, size)
    raise FileNotFoundError(aid + " " + kind)


def acg(aid, kind="Color", size=None):
    d = os.path.join(CC0, "ambientcg", aid)
    for f in sorted(os.listdir(d)):
        if f.startswith(aid) and f"_{kind}." in f:
            p = os.path.join(d, f)
            if kind in ("Roughness", "Displacement", "Opacity", "AmbientOcclusion", "Metalness"):
                return load_gray(p, size)
            return load(p, size)
    raise FileNotFoundError(aid + " " + kind)


# ------------------------------------------------------------------ noise
def fbm(h, w, beta=2.0, seed=None, lo=None):
    """Periodic fractal noise via spectral synthesis, normalised to [0,1].
    beta ~1 = fine/rough, 2 = natural, 3 = smooth blobs. lo = cut lowest freq (px period)."""
    r = np.random.default_rng(seed)
    white = r.standard_normal((h, w))
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    f = np.sqrt(fx * fx + fy * fy)
    f[0, 0] = 1.0
    amp = 1.0 / np.power(f, beta / 2.0)
    amp[0, 0] = 0
    if lo:
        amp[f < 1.0 / lo] = 0
    n = np.real(np.fft.ifft2(np.fft.fft2(white) * amp))
    n -= n.min()
    n /= max(n.max(), 1e-8)
    return n.astype(np.float32)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0 + 1e-8), 0, 1)
    return t * t * (3 - 2 * t)


def _wrap(a, pad, fn):
    """Apply fn on a wrap-padded copy (OpenCV lacks BORDER_WRAP for most filters)."""
    pw = ((pad, pad), (pad, pad)) + ((0, 0),) * (a.ndim - 2)
    b = np.pad(a, pw, mode="wrap")
    r = fn(b)
    return r[pad:-pad, pad:-pad]


def blur(a, sigma, wrap=True):
    if sigma <= 0:
        return a
    k = int(sigma * 3) * 2 + 1
    a = np.ascontiguousarray(a, np.float32)
    if wrap:
        pad = min(k, min(a.shape[:2]) - 1)
        return _wrap(a, pad, lambda b: cv2.GaussianBlur(b, (k, k), sigma, borderType=cv2.BORDER_REFLECT))
    return cv2.GaussianBlur(a, (k, k), sigma, borderType=cv2.BORDER_REFLECT)


def motion_blur_v(a, length, wrap=True):
    """Vertical streak blur (downwards smear)."""
    k = np.zeros((length, 1), np.float32)
    k[:, 0] = np.linspace(1, 0.2, length)
    k /= k.sum()
    a = np.ascontiguousarray(a, np.float32)
    f = lambda b: cv2.filter2D(b, -1, k, anchor=(0, length - 1), borderType=cv2.BORDER_REFLECT)
    # anchor at bottom of kernel so streaks run downward from their source
    if wrap:
        return _wrap(a, min(length + 2, min(a.shape[:2]) - 1), f)
    return f(a)


# ------------------------------------------------------------------ colour
def lum(a):
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def gray_world(a, strength=1.0):
    m = a.reshape(-1, 3).mean(0)
    g = m.mean() / np.maximum(m, 1e-4)
    g = 1 + (g - 1) * strength
    return np.clip(a * g, 0, 1)


def levels(a, lo=0.0, hi=1.0, gamma=1.0):
    return np.clip((a - lo) / (hi - lo), 0, 1) ** (1.0 / gamma)


def auto_levels(a, p_lo=0.5, p_hi=99.5, keep=0.0):
    lo = np.percentile(a, p_lo)
    hi = np.percentile(a, p_hi)
    b = np.clip((a - lo) / max(hi - lo, 1e-4), 0, 1)
    return b * (1 - keep) + a * keep


def saturation(a, s):
    l = lum(a)[..., None]
    return np.clip(l + (a - l) * s, 0, 1)


def tint(a, rgb, amount):
    rgb = np.array(rgb, np.float32)
    return a * (1 - amount) + a * rgb * amount


def hex2rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)


def multiply(a, m):
    return a * (m[..., None] if m.ndim == 2 else m)


def lerp(a, b, t):
    if np.ndim(t) == 2 and (np.ndim(a) in (1, 3) or np.ndim(b) in (1, 3)):
        t = t[..., None]
    return a * (1 - t) + b * t


def match_mean(a, target_rgb, strength=1.0):
    m = a.reshape(-1, 3).mean(0)
    g = np.array(target_rgb, np.float32) / np.maximum(m, 1e-4)
    g = 1 + (g - 1) * strength
    return np.clip(a * g, 0, 1)


# ------------------------------------------------------------------ geometry
def rectify(img, corners, out_w, out_h):
    """corners: TL, TR, BR, BL in source pixels -> fronto-parallel out_w x out_h."""
    src = np.array(corners, np.float32)
    dst = np.array([[0, 0], [out_w - 1, 0], [out_w - 1, out_h - 1], [0, out_h - 1]], np.float32)
    M = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(img, M, (out_w, out_h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)


def resize(a, w, h, interp=cv2.INTER_AREA):
    return cv2.resize(a, (w, h), interpolation=interp)


def tile_to(a, w, h):
    reps_y = math.ceil(h / a.shape[0])
    reps_x = math.ceil(w / a.shape[1])
    t = np.tile(a, (reps_y, reps_x) + (1,) * (a.ndim - 2))
    return t[:h, :w]


def make_seamless(a, border=0.18):
    """Make a non-tiling photo crop tileable: blend with its half-offset copy using a
    feathered cross mask (keeps centre detail). Good for organic textures only."""
    h, w = a.shape[:2]
    off = np.roll(np.roll(a, h // 2, 0), w // 2, 1)
    yy = np.abs(np.linspace(-1, 1, h))[:, None]
    xx = np.abs(np.linspace(-1, 1, w))[None, :]
    m = np.maximum(smoothstep(1 - border * 2, 1.0, yy), smoothstep(1 - border * 2, 1.0, xx))
    # irregular mask edge to hide the blend
    n = fbm(h, w, 2.2, seed=7)
    m = np.clip(m * 1.4 + (n - 0.5) * 0.6, 0, 1)
    m = smoothstep(0.3, 0.7, m)
    if a.ndim == 3:
        m = m[..., None]
    return a * (1 - m) + off * m


def height_to_normal(hgt, strength=4.0, wrap=True):
    hgt = np.ascontiguousarray(hgt, np.float32)
    if wrap:
        gx = _wrap(hgt, 2, lambda b: cv2.Sobel(b, cv2.CV_32F, 1, 0, ksize=3))
        gy = _wrap(hgt, 2, lambda b: cv2.Sobel(b, cv2.CV_32F, 0, 1, ksize=3))
    else:
        gx = cv2.Sobel(hgt, cv2.CV_32F, 1, 0, ksize=3, borderType=cv2.BORDER_REFLECT)
        gy = cv2.Sobel(hgt, cv2.CV_32F, 0, 1, ksize=3, borderType=cv2.BORDER_REFLECT)
    nx = -gx * strength
    ny = gy * strength            # OpenGL convention (+Y up): image y grows downward
    nz = np.ones_like(hgt)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    n = np.stack([nx / l, ny / l, nz / l], -1)
    return n * 0.5 + 0.5


def blend_normals(n1, n2):
    """Whiteout blend of two tangent-space normal maps in [0,1] encoding."""
    a = n1 * 2 - 1
    b = n2 * 2 - 1
    r = np.stack([a[..., 0] + b[..., 0], a[..., 1] + b[..., 1], a[..., 2] * b[..., 2]], -1)
    r /= np.linalg.norm(r, axis=-1, keepdims=True) + 1e-6
    return r * 0.5 + 0.5


# ------------------------------------------------------------------ text helpers
def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size, layout_engine=ImageFont.Layout.RAQM)


def text_mask(text, fnt, stroke=0, pad=None, lang="th"):
    """Render text to an L mask tightly cropped (with padding)."""
    d = ImageDraw.Draw(Image.new("L", (10, 10)))
    bb = d.textbbox((0, 0), text, font=fnt, stroke_width=stroke, language=lang)
    pad = pad if pad is not None else stroke + 4
    w, h = bb[2] - bb[0] + pad * 2, bb[3] - bb[1] + pad * 2
    im = Image.new("L", (w, h), 0)
    ImageDraw.Draw(im).text((pad - bb[0], pad - bb[1]), text, font=fnt, fill=255,
                            stroke_width=stroke, stroke_fill=255, language=lang)
    return im


def fit_text(text, fontname, max_w, max_h, start=400, stroke_frac=0.0, lang="th"):
    size = start
    while size > 6:
        f = font(fontname, size)
        st = int(size * stroke_frac)
        m = text_mask(text, f, st, lang=lang)
        if m.width <= max_w and m.height <= max_h:
            return f, st, m
        size = int(size * 0.94)
    f = font(fontname, 6)
    return f, 0, text_mask(text, f, 0, lang=lang)


# ------------------------------------------------------------------ misc
def contact(paths, out, cols=4, cell=300, labels=True):
    ims = []
    fnt = font("Sarabun-Bold.ttf", 14)
    for p in paths:
        im = Image.open(p).convert("RGBA")
        bg = Image.new("RGBA", im.size, (70, 70, 70, 255))
        # checker for alpha
        ch = Image.new("RGBA", im.size, (110, 110, 110, 255))
        dd = ImageDraw.Draw(ch)
        s = max(8, im.width // 24)
        for y in range(0, im.height, s):
            for x in range(0, im.width, s):
                if (x // s + y // s) % 2:
                    dd.rectangle([x, y, x + s - 1, y + s - 1], fill=(150, 150, 150, 255))
        bg = Image.alpha_composite(ch, im)
        bg.thumbnail((cell, cell))
        ims.append((bg.convert("RGB"), os.path.basename(p)))
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rows * (cell + 20)), (25, 25, 25))
    d = ImageDraw.Draw(sheet)
    for i, (im, name) in enumerate(ims):
        x, y = (i % cols) * cell, (i // cols) * (cell + 20)
        sheet.paste(im, (x + (cell - im.width) // 2, y + (cell - im.height) // 2))
        if labels:
            d.text((x + 3, y + cell + 1), name[:40], fill=(255, 220, 80), font=fnt)
    sheet.save(out, quality=85)
    return out
