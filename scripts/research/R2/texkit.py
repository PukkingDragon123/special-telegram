"""Texture helpers: light flattening, seamless tiling (histogram-preserving blend), alpha cutouts,
height->normal maps. Run with python3 -I (operates on downloaded photos)."""
import cv2
import numpy as np
from PIL import Image


def load(path):
    return np.asarray(Image.open(path).convert("RGB")).astype(np.float32)


def crop_n(img, box):
    H, W = img.shape[:2]
    x0, y0, x1, y1 = box
    return img[int(y0 * H):int(y1 * H), int(x0 * W):int(x1 * W)].copy()


def flatten_light(img, sigma_frac=0.18, strength=0.85):
    """Remove large-scale lighting gradients (keeps local detail and colour)."""
    f = img.astype(np.float32)
    lab = cv2.cvtColor(np.clip(f, 0, 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
    L = lab[..., 0]
    s = max(4, int(min(L.shape) * sigma_frac))
    blur = cv2.GaussianBlur(L, (0, 0), s)
    target = float(np.mean(L))
    lab[..., 0] = np.clip(L * ((target / np.maximum(blur, 1)) ** strength), 0, 255)
    return cv2.cvtColor(lab.astype(np.uint8), cv2.COLOR_LAB2RGB).astype(np.float32)


def _noise(h, w, scale, seed):
    rng = np.random.default_rng(seed)
    gh, gw = max(2, h // scale + 2), max(2, w // scale + 2)
    g = rng.random((gh, gw)).astype(np.float32)
    return cv2.resize(g, (w, h), interpolation=cv2.INTER_CUBIC)


def _hp_blend(a, b, wgt):
    """Variance-preserving (histogram-preserving) blend: avoids washed-out ghosting in overlaps."""
    mu = (a.reshape(-1, 3).mean(0) + b.reshape(-1, 3).mean(0)) / 2
    w = wgt[..., None]
    out = (a - mu) * w + (b - mu) * (1 - w)
    norm = np.sqrt(w ** 2 + (1 - w) ** 2)
    return out / np.maximum(norm, 1e-3) + mu


def make_tileable(img, out=1024, overlap=0.22, seed=0, noise_scale=40):
    """Seamless tile: crop to square, then blend opposite edges with a noise-perturbed variance-preserving mask."""
    h, w = img.shape[:2]
    s = min(h, w)
    sq = img[(h - s) // 2:(h - s) // 2 + s, (w - s) // 2:(w - s) // 2 + s]
    sq = cv2.resize(sq, (out, out), interpolation=cv2.INTER_AREA if s > out else cv2.INTER_CUBIC)
    o = int(out * overlap)
    n = out - o  # final tile size before resize back
    # horizontal wrap
    t = sq.copy()
    ramp = np.linspace(0, 1, o, dtype=np.float32)[None, :].repeat(out, 0)
    pert = (_noise(out, o, noise_scale, seed) - 0.5) * 0.6
    wgt = np.clip(ramp + pert, 0, 1)
    wgt = cv2.GaussianBlur(wgt, (0, 0), 2)
    left = t[:, :o]
    right = t[:, n:]
    blended = _hp_blend(left, right, wgt)  # at x=0: right side, at x=o: left side
    t2 = np.concatenate([blended, t[:, o:n]], axis=1)  # width n, wraps seamlessly
    # vertical wrap
    hh = t2.shape[0]
    ramp = np.linspace(0, 1, o, dtype=np.float32)[:, None].repeat(n, 1)
    pert = (_noise(o, n, noise_scale, seed + 1) - 0.5) * 0.6
    wgt = cv2.GaussianBlur(np.clip(ramp + pert, 0, 1), (0, 0), 2)
    top = t2[:o]
    bot = t2[hh - o:]
    blended = _hp_blend(top, bot, wgt)
    t3 = np.concatenate([blended, t2[o:hh - o]], axis=0)  # height n
    return cv2.resize(np.clip(t3, 0, 255), (out, out), interpolation=cv2.INTER_CUBIC)


def tile_check(tile, reps=2):
    return np.tile(tile, (reps, reps, 1))


def height_from(img, sigma=1.2, hp=24):
    L = cv2.cvtColor(np.clip(img, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
    p = int(hp * 3)
    Lp = np.pad(L, p, mode="wrap")
    Lp = cv2.GaussianBlur(Lp, (0, 0), sigma)
    low = cv2.GaussianBlur(Lp, (0, 0), hp)
    return np.clip((Lp - low) * 2.2 + 0.5, 0, 1)[p:-p, p:-p]


def normal_from(img, strength=3.0, sigma=1.2, hp=24, wrap=True):
    hgt = height_from(img, sigma, hp)
    if wrap:  # periodic finite differences (OpenCV Sobel has no BORDER_WRAP)
        dx = (np.roll(hgt, -1, 1) - np.roll(hgt, 1, 1)) * 0.5
        dy = (np.roll(hgt, -1, 0) - np.roll(hgt, 1, 0)) * 0.5
        dx, dy = dx * 4, dy * 4
    else:
        dx = cv2.Sobel(hgt, cv2.CV_32F, 1, 0, ksize=3, borderType=cv2.BORDER_REFLECT)
        dy = cv2.Sobel(hgt, cv2.CV_32F, 0, 1, ksize=3, borderType=cv2.BORDER_REFLECT)
    nx, ny, nz = -dx * strength, dy * strength, np.ones_like(hgt)  # OpenGL convention (+Y up)
    ln = np.sqrt(nx ** 2 + ny ** 2 + nz ** 2)
    n = np.dstack([nx / ln, ny / ln, nz / ln])
    return ((n * 0.5 + 0.5) * 255).astype(np.uint8)


# ------------------------------------------------------------------ cutouts
def mask_white_bg(img, thresh=232, sat_max=40, close=5, open_=3):
    """Foreground mask for products on (near) white backgrounds; flood fill from borders only."""
    u8 = np.clip(img, 0, 255).astype(np.uint8)
    hsv = cv2.cvtColor(u8, cv2.COLOR_RGB2HSV)
    bgish = ((u8.min(axis=2) >= thresh) | ((hsv[..., 2] >= thresh) & (hsv[..., 1] <= sat_max))).astype(np.uint8)
    h, w = bgish.shape
    ff = bgish.copy() * 255
    mask = np.zeros((h + 2, w + 2), np.uint8)
    for x, y in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)] + [(x, 0) for x in range(0, w, 37)] + \
            [(x, h - 1) for x in range(0, w, 37)] + [(0, y) for y in range(0, h, 37)] + \
            [(w - 1, y) for y in range(0, h, 37)]:
        if ff[y, x] == 255:
            cv2.floodFill(ff, mask, (x, y), 128)
    fg = (ff != 128).astype(np.uint8)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close, close))
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, k)
    if open_:
        fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (open_, open_)))
    return fg


def mask_grabcut(img, rect_n, iters=6, fg_hint=None, bg_hint=None):
    u8 = np.clip(img, 0, 255).astype(np.uint8)
    H, W = u8.shape[:2]
    x0, y0, x1, y1 = rect_n
    rect = (int(x0 * W), int(y0 * H), int((x1 - x0) * W), int((y1 - y0) * H))
    mask = np.zeros((H, W), np.uint8)
    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    cv2.grabCut(u8, mask, rect, bgd, fgd, iters, cv2.GC_INIT_WITH_RECT)
    if fg_hint is not None or bg_hint is not None:
        if fg_hint is not None:
            mask[fg_hint > 0] = cv2.GC_FGD
        if bg_hint is not None:
            mask[bg_hint > 0] = cv2.GC_BGD
        cv2.grabCut(u8, mask, None, bgd, fgd, 3, cv2.GC_INIT_WITH_MASK)
    return np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 1, 0).astype(np.uint8)


def keep_largest(mask, n=1, min_frac=0.002):
    cnt, lab, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8))
    if cnt <= 1:
        return mask
    areas = stats[1:, cv2.CC_STAT_AREA]
    order = np.argsort(-areas)
    out = np.zeros_like(mask)
    total = mask.size
    for i in order[:n]:
        if areas[i] >= total * min_frac:
            out[lab == i + 1] = 1
    return out


def fill_holes(mask):
    m = (mask > 0).astype(np.uint8) * 255
    h, w = m.shape
    ff = m.copy()
    fm = np.zeros((h + 2, w + 2), np.uint8)
    cv2.floodFill(ff, fm, (0, 0), 255)
    holes = cv2.bitwise_not(ff)
    return ((m | holes) > 0).astype(np.uint8)


def rgba_from(img, mask, feather=1.2, erode=1, decontam=True, bg=(255, 255, 255)):
    m = mask.astype(np.uint8)
    if erode:
        m = cv2.erode(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (erode * 2 + 1, erode * 2 + 1)))
    a = cv2.GaussianBlur(m.astype(np.float32), (0, 0), feather) if feather else m.astype(np.float32)
    a = np.clip((a - 0.5) * 1.6 + 0.5, 0, 1) if feather else a
    rgb = np.clip(img, 0, 255).astype(np.float32)
    if decontam:
        # replace edge colours with colours pulled from the interior (removes white/dark fringes)
        inner = cv2.erode(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
        src = rgb * inner[..., None]
        wsum = cv2.GaussianBlur(inner.astype(np.float32), (0, 0), 4)
        csum = cv2.GaussianBlur(src, (0, 0), 4)
        pulled = csum / np.maximum(wsum[..., None], 1e-3)
        edge = ((a > 0) & (inner == 0)).astype(np.float32)[..., None]
        rgb = rgb * (1 - edge) + pulled * edge
    out = np.dstack([np.clip(rgb, 0, 255), a * 255]).astype(np.uint8)
    return out


def trim_square(rgba, size=1024, pad=0.04, square=True):
    a = rgba[..., 3]
    ys, xs = np.nonzero(a > 8)
    if len(xs) == 0:
        return rgba
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    crop = rgba[y0:y1, x0:x1]
    h, w = crop.shape[:2]
    if square:
        s = int(max(h, w) * (1 + 2 * pad))
        canvas = np.zeros((s, s, 4), np.uint8)
        canvas[(s - h) // 2:(s - h) // 2 + h, (s - w) // 2:(s - w) // 2 + w] = crop
    else:
        ph, pw = int(h * pad), int(w * pad)
        canvas = np.zeros((h + 2 * ph, w + 2 * pw, 4), np.uint8)
        canvas[ph:ph + h, pw:pw + w] = crop
    im = Image.fromarray(canvas, "RGBA")
    if square:
        im = im.resize((size, size), Image.LANCZOS)
    else:
        sc = size / max(im.size)
        im = im.resize((max(1, int(im.width * sc)), max(1, int(im.height * sc))), Image.LANCZOS)
    return np.asarray(im)


def save_rgb(arr, path, q=90):
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).save(path, quality=q, optimize=True)


def save_rgba(arr, path):
    Image.fromarray(arr.astype(np.uint8), "RGBA").save(path, optimize=True)


def grade(img, sat=1.0, gamma=1.0, warm=0.0, contrast=1.0, lift=0.0):
    f = np.clip(img, 0, 255).astype(np.float32) / 255
    if gamma != 1.0:
        f = f ** (1 / gamma)
    if contrast != 1.0:
        f = (f - 0.5) * contrast + 0.5
    if lift:
        f = f * (1 - lift) + lift
    g = f.mean(axis=2, keepdims=True)
    f = g + (f - g) * sat
    if warm:
        f[..., 0] *= 1 + warm
        f[..., 2] *= 1 - warm
    return np.clip(f * 255, 0, 255)
