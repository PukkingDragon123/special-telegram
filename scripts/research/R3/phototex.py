"""Turn real photos into game textures (R3-people).

* flatten_light  - divide out low-frequency lighting (vignette, folds, gradients)
* periodic       - Moisan periodic+smooth decomposition: removes the tiling seam while keeping
                   every pixel of photo detail (works for any crop)
* period_of      - repeat length of a woven/printed pattern via autocorrelation, so plaid /
                   stripe crops contain whole repeats and tile with the pattern aligned
* rectify        - perspective-correct a quadrilateral region of a photo
* normal_from    - tangent-space normal map from the luminance high-pass
"""
import math

import cv2
import numpy as np

import texlib as T


def load(path):
    bgr = cv2.imread(path, cv2.IMREAD_COLOR)
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0


def crop(img, box):
    x0, y0, x1, y1 = [int(round(v)) for v in box]
    return img[y0:y1, x0:x1].copy()


def rectify(img, quad, out_w, out_h):
    src = np.float32(quad)
    dst = np.float32([[0, 0], [out_w - 1, 0], [out_w - 1, out_h - 1], [0, out_h - 1]])
    M = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(img, M, (out_w, out_h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)


def flatten_light(img, sigma_frac=0.12, strength=1.0):
    """Remove low-frequency luminance variation (keeps colour & mean brightness)."""
    lin = T.srgb_to_lin(img)
    Y = lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722
    s = max(img.shape[:2]) * sigma_frac
    f = max(2, int(s / 3))
    h, w = Y.shape
    small = cv2.resize(Y, (max(4, w // f), max(4, h // f)), interpolation=cv2.INTER_AREA)
    small = cv2.GaussianBlur(small, (0, 0), s / f)
    low = cv2.resize(small, (w, h), interpolation=cv2.INTER_LINEAR)
    m = float(np.mean(Y))
    g = (m / np.maximum(low, 1e-4)) ** strength
    return T.lin_to_srgb(lin * g[..., None])


def periodic(img):
    """Moisan (2011) periodic component: seamless tiling without blending away detail."""
    u = img.astype(np.float64)
    if u.ndim == 2:
        u = u[..., None]
    H, W, C = u.shape
    out = np.empty_like(u)
    q = np.arange(W)[None, :]
    r = np.arange(H)[:, None]
    den = 2 * np.cos(2 * np.pi * q / W) + 2 * np.cos(2 * np.pi * r / H) - 4
    den[0, 0] = 1
    for c in range(C):
        a = u[..., c]
        v = np.zeros((H, W))
        v[0, :] += a[-1, :] - a[0, :]
        v[-1, :] += a[0, :] - a[-1, :]
        v[:, 0] += a[:, -1] - a[:, 0]
        v[:, -1] += a[:, 0] - a[:, -1]
        Vh = np.fft.fft2(v)
        Sh = Vh / den
        Sh[0, 0] = 0
        s = np.real(np.fft.ifft2(Sh))
        out[..., c] = a - s
    out = out.astype(np.float32)
    return np.clip(out[..., 0] if img.ndim == 2 else out, 0, 1)


def period_of(img, axis, lo=8, hi=None):
    """Dominant repeat length (pixels) along axis (1 = x, 0 = y) via autocorrelation."""
    Y = img.mean(axis=2) if img.ndim == 3 else img
    prof = Y.mean(axis=0 if axis == 1 else 1)
    prof = prof - prof.mean()
    n = len(prof)
    hi = hi or n // 2
    ac = np.correlate(prof, prof, mode="full")[n - 1:]
    ac /= ac[0] + 1e-9
    seg = ac[lo:hi]
    k = int(np.argmax(seg)) + lo
    return k, float(ac[k])


def tile_crop(img, px, py, nx=1, ny=1, x0=0, y0=0):
    """Crop exactly nx*px by ny*py pixels starting at (x0, y0)."""
    return img[y0:y0 + int(round(py * ny)), x0:x0 + int(round(px * nx))].copy()


def normal_from(img, strength=2.5, sigma=1.0):
    lin = T.srgb_to_lin(img)
    Y = lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722
    hp = Y - cv2.GaussianBlur(Y, (0, 0), max(img.shape[:2]) * 0.03)
    hp = cv2.GaussianBlur(hp, (0, 0), sigma)
    hp = (hp - hp.min()) / (hp.max() - hp.min() + 1e-6)
    return T.height_to_normal(hp.astype(np.float32), strength=strength * 10, wrap=True)


def finish(img, size, quality=88):
    """Resize (area) to a square power-of-two texture."""
    return cv2.resize(img, (size, size), interpolation=cv2.INTER_AREA if img.shape[0] > size else cv2.INTER_CUBIC)


def colorize(img, target_rgb, keep_detail=1.0):
    """Recolour a (neutral) photo fabric to a target sRGB colour, keeping its luminance detail."""
    lin = T.srgb_to_lin(img)
    Y = lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722
    Ym = float(np.mean(Y))
    d = (Y / max(Ym, 1e-4)) ** keep_detail
    tl = T.srgb_to_lin(np.float32(target_rgb))
    return T.lin_to_srgb(d[..., None] * tl[None, None, :])
