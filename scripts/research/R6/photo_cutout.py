"""R6-pbr: photo cutout helpers for real plant photos (Wikimedia Commons).

- sky_key(): plants photographed against sky -> soft alpha + decontaminated colour
- green_key(): green leaf on a brown/neutral background (mulch, soil, paper)
- guided_filter(), largest_components(), luminance-derived normal map for photo cards
All inputs are image data decoded with Pillow/OpenCV; nothing downloaded is executed.
"""
import cv2
import numpy as np
from PIL import Image


def load_rgb(path, max_side=None):
    im = Image.open(path).convert("RGB")
    if max_side and max(im.size) > max_side:
        s = max_side / max(im.size)
        im = im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS)
    return np.asarray(im).astype(np.float32) / 255.0


def box(x, r):
    return cv2.boxFilter(x, -1, (2 * r + 1, 2 * r + 1), borderType=cv2.BORDER_REFLECT)


def guided_filter(I, p, r=4, eps=1e-3):
    mI, mp = box(I, r), box(p, r)
    vI = box(I * I, r) - mI * mI
    cIp = box(I * p, r) - mI * mp
    a = cIp / (vI + eps)
    b = mp - a * mI
    return np.clip(box(a, r) * I + box(b, r), 0, 1)


def largest_components(mask, keep=1, min_frac=0.0):
    m = (mask > 0.5).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    if n <= 1:
        return mask
    order = np.argsort(-st[1:, cv2.CC_STAT_AREA]) + 1
    tot = st[1:, cv2.CC_STAT_AREA].sum()
    keepm = np.zeros_like(m)
    for i in order[:keep]:
        if st[i, cv2.CC_STAT_AREA] >= min_frac * tot:
            keepm[lab == i] = 1
    return mask * keepm


def remove_small(mask, min_area):
    m = (mask > 0.5).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    keep = np.zeros(n, bool)
    keep[1:] = st[1:, cv2.CC_STAT_AREA] >= min_area
    return mask * keep[lab]


def fit_poly_bg(img, sel, deg=2):
    """Least-squares 2D polynomial fit of background colour over selected pixels -> full-res field."""
    H, W = sel.shape
    ys, xs = np.nonzero(sel)
    if len(xs) > 60000:
        idx = np.random.default_rng(0).choice(len(xs), 60000, replace=False)
        ys, xs = ys[idx], xs[idx]
    u, v = xs / W, ys / H
    terms = lambda u, v: [np.ones_like(u), u, v, u * u, u * v, v * v] if deg == 2 else [np.ones_like(u), u, v]
    A = np.stack(terms(u, v), 1)
    coef = np.linalg.lstsq(A, img[ys, xs], rcond=None)[0]
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    T = np.stack(terms(xx / W, yy / H), -1)
    return T @ coef


def sky_key(img, t0=0.10, t1=0.22, cloud=True, refine_r=3, eps=4e-4):
    """Return (alpha, fg_rgb, bg_rgb) for a subject against (blue) sky."""
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    mx = img.max(-1)
    mn = img.min(-1)
    sat = (mx - mn) / (mx + 1e-6)
    blue_sky = (b > r + 0.12) & (b > g + 0.02) & (mx > 0.35)
    white_sky = (mx > 0.82) & (sat < 0.12) if cloud else np.zeros_like(blue_sky)
    seed = blue_sky | white_sky
    bg = fit_poly_bg(img, blue_sky)
    d = np.sqrt(((img - bg) ** 2).sum(-1))
    # blueness of the pixel relative to the local sky helps on dark-blue sky corners
    alpha = np.clip((d - t0) / (t1 - t0), 0, 1)
    if cloud:
        alpha = np.where(white_sky, np.minimum(alpha, 0.0), alpha)
    alpha = np.where(blue_sky & (d < t0 * 1.5), 0.0, alpha)
    gray = img @ np.array([0.299, 0.587, 0.114], np.float32)
    alpha = guided_filter(gray.astype(np.float32), alpha.astype(np.float32), refine_r, eps)
    alpha = np.clip((alpha - 0.08) / 0.84, 0, 1)
    bgc = np.where(white_sky[..., None], img, bg)
    fg = decontaminate(img, alpha, bgc)
    return alpha.astype(np.float32), fg, bgc


def decontaminate(img, alpha, bg):
    a = np.maximum(alpha, 0.08)[..., None]
    fg = (img - (1 - a) * bg) / a
    fg = np.clip(fg, 0, 1)
    # where alpha is tiny the solve is unstable -> pull toward the nearest solid foreground colour
    solid = (alpha > 0.9).astype(np.uint8)
    if solid.any():
        holes = (1 - solid).astype(np.uint8)
        _, lab = cv2.distanceTransformWithLabels(holes, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
        ys, xs = np.nonzero(holes == 0)
        idx = np.clip(lab - 1, 0, len(ys) - 1)
        near = img[ys[idx], xs[idx]]
        w = np.clip((alpha - 0.25) / 0.6, 0, 1)[..., None]
        fg = fg * w + near * (1 - w)
    return fg


def green_key(img, hue_lo=22, hue_hi=48, sat_min=0.22, val_min=0.12):
    """Green/yellow-green leaf vs brown/neutral background. OpenCV hue units (0..180)."""
    hsv = cv2.cvtColor((img * 255).astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)
    h, s, v = hsv[..., 0], hsv[..., 1] / 255, hsv[..., 2] / 255
    exg = 2 * img[..., 1] - img[..., 0] - img[..., 2]        # excess green index
    m = ((h >= hue_lo) & (h <= hue_hi) & (s >= sat_min) & (v >= val_min)) | (exg > 0.16)
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    return m.astype(np.float32)


def grabcut_refine(img, mask, iters=5, band=12):
    m8 = (mask > 0.5).astype(np.uint8)
    gc = np.full(m8.shape, cv2.GC_BGD, np.uint8)
    dil = cv2.dilate(m8, np.ones((band * 2 + 1, band * 2 + 1), np.uint8))
    ero = cv2.erode(m8, np.ones((band * 2 + 1, band * 2 + 1), np.uint8))
    gc[dil == 1] = cv2.GC_PR_BGD
    gc[m8 == 1] = cv2.GC_PR_FGD
    gc[ero == 1] = cv2.GC_FGD
    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    im8 = (img * 255).astype(np.uint8)[..., ::-1].copy()
    cv2.grabCut(im8, gc, None, bgd, fgd, iters, cv2.GC_INIT_WITH_MASK)
    return ((gc == cv2.GC_FGD) | (gc == cv2.GC_PR_FGD)).astype(np.float32)


def soft_edge(img, mask, r=2, eps=2e-3):
    gray = (img @ np.array([0.299, 0.587, 0.114], np.float32)).astype(np.float32)
    a = guided_filter(gray, cv2.GaussianBlur(mask.astype(np.float32), (0, 0), 0.8), r, eps)
    return np.clip((a - 0.1) / 0.8, 0, 1)


def interior_bleed(img, alpha, erode_px=3):
    """Replace edge-band colours (background spill) with colours pulled from the leaf interior."""
    solid = cv2.erode((alpha > 0.6).astype(np.uint8), np.ones((erode_px * 2 + 1,) * 2, np.uint8))
    holes = (1 - solid).astype(np.uint8)
    if solid.sum() == 0:
        return img
    _, lab = cv2.distanceTransformWithLabels(holes, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    ys, xs = np.nonzero(holes == 0)
    idx = np.clip(lab - 1, 0, len(ys) - 1)
    near = img[ys[idx], xs[idx]]
    return np.where(holes[..., None] == 1, near, img)


def photo_normal(rgb, alpha, strength=2.0, blur=1.2):
    """Plausible OpenGL normal from photo luminance (veins/creases), flat outside the alpha."""
    l = (rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)).astype(np.float32)
    hp = l - cv2.GaussianBlur(l, (0, 0), 6)
    h = cv2.GaussianBlur(hp, (0, 0), blur)
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    n = np.stack([-dx * strength * 10, dy * strength * 10, np.ones_like(h)], -1)
    n /= np.sqrt((n ** 2).sum(-1, keepdims=True))
    k = np.clip(alpha * 2, 0, 1)[..., None]
    flat = np.zeros_like(n)
    flat[..., 2] = 1
    return n * k + flat * (1 - k)
