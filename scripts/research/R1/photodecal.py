"""R1-streets: real-photo cutout / decal toolkit (numpy + OpenCV).  Run callers with -I.

All functions work on float32 arrays in [0,1]; RGBA = (H,W,4).
"""
import os

import cv2
import numpy as np
from PIL import Image

FULL = "/home/user/special-telegram/references/streets/_raw/full"


def load_any(name_or_path):
    p = name_or_path if os.path.sep in name_or_path else os.path.join(FULL, name_or_path + ".jpg")
    im = Image.open(p)
    has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
    im = im.convert("RGBA")
    a = np.asarray(im).astype(np.float32) / 255
    if not has_alpha:
        a[..., 3] = 1.0
    return a, has_alpha


def lum(a):
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0 + 1e-8), 0, 1)
    return t * t * (3 - 2 * t)


def feather(alpha, px):
    if px <= 0:
        return alpha
    k = int(px * 3) * 2 + 1
    return cv2.GaussianBlur(alpha.astype(np.float32), (k, k), px)


def key_background(rgba, tol=0.10, feather_px=1.2, erode=1):
    """Remove a near-uniform background (white / light grey / baked checkerboard) that touches
    the image border, by flood-filling from all border pixels in a smoothed copy."""
    rgb = (np.clip(rgba[..., :3], 0, 1) * 255).astype(np.uint8)
    sm = cv2.medianBlur(rgb, 5)
    h, w = sm.shape[:2]
    mask = np.zeros((h + 2, w + 2), np.uint8)
    t = int(tol * 255)
    flags = 4 | cv2.FLOODFILL_MASK_ONLY | cv2.FLOODFILL_FIXED_RANGE | (255 << 8)
    pts = [(x, 0) for x in range(0, w, 7)] + [(x, h - 1) for x in range(0, w, 7)] + \
          [(0, y) for y in range(0, h, 7)] + [(w - 1, y) for y in range(0, h, 7)]
    for (x, y) in pts:
        if mask[y + 1, x + 1]:
            continue
        c = sm[y, x].astype(int)
        if c.mean() < 150:        # only light backgrounds
            continue
        cv2.floodFill(sm, mask, (x, y), 0, (t, t, t), (t, t, t), flags)
    bg = mask[1:-1, 1:-1] > 0
    fg = (~bg).astype(np.uint8)
    if erode:
        fg = cv2.erode(fg, np.ones((3, 3), np.uint8), iterations=erode)
    # keep largest components only (drop specks)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(fg, 8)
    if n > 1:
        keep = np.zeros(n, bool)
        areas = stats[1:, cv2.CC_STAT_AREA]
        big = areas.max()
        keep[1:] = areas > big * 0.02
        fg = keep[lab].astype(np.uint8)
    a = feather(fg.astype(np.float32), feather_px)
    out = rgba.copy()
    out[..., 3] = np.minimum(rgba[..., 3], a)
    return out


def local_bg(l, size):
    """Smooth estimate of background luminance (median of a downsampled copy)."""
    h, w = l.shape
    s = max(1, size // 8)
    small = cv2.resize(l, (max(4, w // s), max(4, h // s)), interpolation=cv2.INTER_AREA)
    k = 5
    small = cv2.medianBlur((small * 255).astype(np.uint8), k).astype(np.float32) / 255
    return cv2.resize(small, (w, h), interpolation=cv2.INTER_CUBIC)


def alpha_from_dark(rgb, bg_size=96, lo=0.04, hi=0.35, bg=None):
    """Dark marks on lighter ground (oil, gum, mould, streaks)."""
    l = lum(rgb)
    b = local_bg(l, bg_size) if bg is None else bg
    d = np.clip((b - l) / np.maximum(b, 0.05), 0, 1)
    return smoothstep(lo, hi, d)


def alpha_from_bright(rgb, bg_size=96, lo=0.05, hi=0.3, bg=None):
    """Light things on darker ground (butts, paper, paint)."""
    l = lum(rgb)
    b = local_bg(l, bg_size) if bg is None else bg
    d = np.clip(l - b, 0, 1)
    return smoothstep(lo, hi, d)


def sky_key(rgb, close=25, lo=0.10, hi=0.45):
    """Dark wires against bright sky: background = morphological closing (max filter)."""
    l = lum(rgb)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close, close))
    sky = cv2.morphologyEx(l, cv2.MORPH_CLOSE, k)
    sky = cv2.GaussianBlur(sky, (0, 0), close / 3)
    d = np.clip((sky - l) / np.maximum(sky, 0.1), 0, 1)
    return smoothstep(lo, hi, d), sky


def ellipse_mask(h, w, cx, cy, rx, ry, noise=0.12, seed=0, soft=0.12):
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    r = np.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2)
    rng = np.random.default_rng(seed)
    n = rng.standard_normal((max(2, h // 32), max(2, w // 32))).astype(np.float32)
    n = cv2.resize(n, (w, h), interpolation=cv2.INTER_CUBIC)
    n = cv2.GaussianBlur(n, (0, 0), 6)
    r = r + n * noise
    return 1 - smoothstep(1 - soft, 1.0, r)


def poly_mask(h, w, pts, feather_px=2.0):
    m = np.zeros((h, w), np.uint8)
    cv2.fillPoly(m, [np.array(pts, np.int32)], 1)
    return feather(m.astype(np.float32), feather_px)


def trim(rgba, pad=4, thr=0.02):
    a = rgba[..., 3]
    ys, xs = np.where(a > thr)
    if len(ys) == 0:
        return rgba
    y0, y1 = max(0, ys.min() - pad), min(a.shape[0], ys.max() + pad + 1)
    x0, x1 = max(0, xs.min() - pad), min(a.shape[1], xs.max() + pad + 1)
    return rgba[y0:y1, x0:x1]


def decontaminate(rgba, iters=12):
    """Bleed opaque colours outward under transparent pixels (prevents halos in mips)."""
    rgb = rgba[..., :3].copy()
    a = rgba[..., 3]
    known = (a > 0.6).astype(np.float32)
    acc = rgb * known[..., None]
    w = known.copy()
    for _ in range(iters):
        acc_b = cv2.blur(acc, (5, 5))
        w_b = cv2.blur(w, (5, 5))
        fill = (w < 0.5) & (w_b > 1e-4)
        acc[fill] = acc_b[fill]
        w[fill] = w_b[fill]
        acc = np.where(w[..., None] > 0, acc, acc)
    res = np.where(w[..., None] > 1e-4, acc / np.maximum(w[..., None], 1e-4), rgb)
    out = rgba.copy()
    soft = a < 0.98
    out[..., :3][soft] = res[soft]
    return out


def fit(rgba, box_w, box_h):
    h, w = rgba.shape[:2]
    s = min(box_w / w, box_h / h)
    nw, nh = max(1, int(w * s)), max(1, int(h * s))
    interp = cv2.INTER_AREA if s < 1 else cv2.INTER_CUBIC
    return cv2.resize(rgba, (nw, nh), interpolation=interp)


def pack_grid(items, cols, rows, cell, pad=6):
    """items: list of (name, rgba). Returns atlas RGBA and uv list [name,u0,v0,u1,v1] (v from top)."""
    W, H = cols * cell, rows * cell
    atlas = np.zeros((H, W, 4), np.float32)
    uvs = []
    for i, (name, im) in enumerate(items[:cols * rows]):
        cx, cy = (i % cols) * cell, (i // cols) * cell
        f = fit(im, cell - 2 * pad, cell - 2 * pad)
        h, w = f.shape[:2]
        ox, oy = cx + (cell - w) // 2, cy + (cell - h) // 2
        atlas[oy:oy + h, ox:ox + w] = f
        uvs.append([name, round(ox / W, 4), round(oy / H, 4), round((ox + w) / W, 4), round((oy + h) / H, 4)])
    return atlas, uvs


def save_rgba(rgba, path, size=None):
    im = Image.fromarray((np.clip(rgba, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")
    if size:
        im = im.resize(size, Image.LANCZOS)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, optimize=True)
    return path


def save_rgb(rgb, path, q=88, size=None):
    im = Image.fromarray((np.clip(rgb[..., :3], 0, 1) * 255 + 0.5).astype(np.uint8), "RGB")
    if size:
        im = im.resize(size, Image.LANCZOS)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, quality=q, optimize=True)
    return path


def rectify(img, quad, out_w, out_h):
    src = np.array(quad, np.float32)
    dst = np.array([[0, 0], [out_w - 1, 0], [out_w - 1, out_h - 1], [0, out_h - 1]], np.float32)
    M = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(img, M, (out_w, out_h), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REPLICATE)


def _noisy_ramp(n, m, border, seed):
    """mask (n x m) rising to 1 at both ends of axis 0 with a wobbly boundary."""
    t = np.abs(np.linspace(-1, 1, n))[:, None]
    rng = np.random.default_rng(seed)
    nz = rng.standard_normal((n // 24 + 2, m // 24 + 2)).astype(np.float32)
    nz = cv2.resize(nz, (m, n), interpolation=cv2.INTER_CUBIC)
    nz = cv2.GaussianBlur(nz, (0, 0), 3)
    return smoothstep(1 - border * 2, 1.0 - border * 0.4, t + nz * border * 0.35)


def make_seamless(a, border=0.2, seed=7):
    """Two-pass seam removal: blend with a Y-rolled copy near top/bottom, then with an
    X-rolled copy near left/right (single-axis rolls -> no cross-shaped seams)."""
    h, w = a.shape[:2]
    my = _noisy_ramp(h, w, border, seed)
    if a.ndim == 3:
        my = my[..., None]
    b = a * (1 - my) + np.roll(a, h // 2, 0) * my
    mx = _noisy_ramp(w, h, border, seed + 1).T
    if a.ndim == 3:
        mx = mx[..., None]
    return b * (1 - mx) + np.roll(b, w // 2, 1) * mx


def seamless_x(a, border=0.15):
    """Make tileable along X only (e.g. a cable strip, a curb, a line)."""
    h, w = a.shape[:2]
    off = np.roll(a, w // 2, 1)
    xx = np.abs(np.linspace(-1, 1, w))[None, :]
    m = smoothstep(1 - border * 2, 1.0, xx)
    m = np.broadcast_to(m, (h, w))
    if a.ndim == 3:
        m = m[..., None]
    return a * (1 - m) + off * m


def seamless_y(a, border=0.15):
    return np.swapaxes(seamless_x(np.swapaxes(a, 0, 1), border), 0, 1)


def height_from_lum(rgb, sigma=4):
    l = lum(np.ascontiguousarray(rgb, np.float32)).astype(np.float32)
    h = l - cv2.GaussianBlur(l, (0, 0), sigma * 4)
    h = cv2.GaussianBlur(h, (0, 0), 0.8)
    h = (h - h.min()) / max(h.max() - h.min(), 1e-6)
    return h


def normal_from_height(h, strength=3.0, wrap=True):
    h = np.ascontiguousarray(h, np.float32)
    if wrap:
        hp = np.pad(h, 2, mode="wrap")
    else:
        hp = np.pad(h, 2, mode="edge")
    gx = cv2.Sobel(hp, cv2.CV_32F, 1, 0, ksize=3)[2:-2, 2:-2]
    gy = cv2.Sobel(hp, cv2.CV_32F, 0, 1, ksize=3)[2:-2, 2:-2]
    nx, ny, nz = -gx * strength, gy * strength, np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / l, ny / l, nz / l], -1) * 0.5 + 0.5


def gray_world(rgb, strength=0.5):
    m = rgb.reshape(-1, 3).mean(0)
    g = m.mean() / np.maximum(m, 1e-4)
    g = 1 + (g - 1) * strength
    return np.clip(rgb * g, 0, 1)


def even_light(rgb, sigma_frac=0.25, strength=0.7):
    """Remove large-scale lighting gradients (keeps local detail)."""
    l = lum(np.ascontiguousarray(rgb, np.float32)).astype(np.float32)
    h, w = l.shape
    f = 128.0 / max(h, w)
    small = cv2.resize(l, (max(8, int(w * f)), max(8, int(h * f))), interpolation=cv2.INTER_AREA)
    s = max(1.0, min(small.shape) * sigma_frac)
    big = cv2.resize(cv2.GaussianBlur(small, (0, 0), s), (w, h), interpolation=cv2.INTER_CUBIC)
    gain = (big.mean() / np.maximum(big, 0.03)) ** strength
    return np.clip(rgb * gain[..., None], 0, 1)
