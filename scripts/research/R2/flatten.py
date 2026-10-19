"""Turn real product photos into flat, game-ready label textures.

- cyl_unwrap: inverse orthographic-cylinder projection (front photo of a bottle/can -> flat label strip)
- persp: 4-point perspective rectification (bags, boxes, cartons, stickers)
- deshade / despecular / white_balance / levels: photographic cleanup that keeps the photo look
Run with python3 -I (reads downloaded images).
"""
import cv2
import numpy as np
from PIL import Image


def load(path):
    im = Image.open(path).convert("RGB")
    return np.asarray(im).copy()


def save(arr, path, out_w=None, out_h=None):
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    if out_w or out_h:
        w, h = im.size
        if out_w and not out_h:
            out_h = int(round(h * out_w / w))
        if out_h and not out_w:
            out_w = int(round(w * out_h / h))
        im = im.resize((out_w, out_h), Image.LANCZOS)
    if path.endswith(".jpg"):
        im.save(path, quality=92, optimize=True)
    else:
        im.save(path, optimize=True)
    return im.size


def silhouette(img, thresh=238, close=9):
    """Mask of the product on a (near-)white background (largest blob)."""
    m = (img.min(axis=2) < thresh).astype(np.uint8)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close, close))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, k)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m)
    if n <= 1:
        return m
    big = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return (lab == big).astype(np.uint8)


def body_edges(img, y0, y1, thresh=238):
    m = silhouette(img, thresh)
    L, R = [], []
    for y in range(int(y0), int(y1)):
        xs = np.nonzero(m[y])[0]
        if len(xs) > 10:
            L.append(xs[0])
            R.append(xs[-1])
    return float(np.median(L)), float(np.median(R))


def cyl_unwrap(img, y0, y1, xl=None, xr=None, max_deg=70, cx=None, radius=None, out_h=None, thresh=238,
               top_curve=0.0):
    """Unwrap the band y0..y1 of a cylinder seen from the front.
    xl/xr: visible label edges in px (optional). top_curve: fraction of radius by which the label's
    top/bottom edges bow downwards at the centre (perspective ellipse), corrected by a vertical shift."""
    H, W = img.shape[:2]
    if cx is None or radius is None:
        L, R = body_edges(img, y0 + (y1 - y0) * 0.2, y1 - (y1 - y0) * 0.2, thresh)
        cx = (L + R) / 2 if cx is None else cx
        radius = (R - L) / 2 if radius is None else radius
    lim = np.radians(max_deg)
    th0 = -lim if xl is None else max(-lim, np.arcsin(np.clip((xl - cx) / radius, -1, 1)))
    th1 = lim if xr is None else min(lim, np.arcsin(np.clip((xr - cx) / radius, -1, 1)))
    out_w = int(radius * (th1 - th0))
    out_h = int(out_h or (y1 - y0))
    th = np.linspace(th0, th1, out_w)
    xs = cx + radius * np.sin(th)
    ys = np.linspace(y0, y1, out_h)
    map_x = np.tile(xs[None, :], (out_h, 1)).astype(np.float32)
    shift = top_curve * radius * np.cos(th)  # ellipse bow: centre columns sit lower
    map_y = (ys[:, None] + shift[None, :]).astype(np.float32)
    out = cv2.remap(img, map_x, map_y, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    return out


def persp(img, pts, out_w, out_h):
    """pts: 4 (x,y) px in order TL, TR, BR, BL."""
    src = np.array(pts, np.float32)
    dst = np.array([[0, 0], [out_w - 1, 0], [out_w - 1, out_h - 1], [0, out_h - 1]], np.float32)
    M = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(img, M, (int(out_w), int(out_h)), flags=cv2.INTER_CUBIC,
                               borderMode=cv2.BORDER_REPLICATE)


def lum(img):
    return cv2.cvtColor(img.astype(np.uint8), cv2.COLOR_RGB2LAB)[..., 0].astype(np.float32)


def deshade(img, strength=0.8, sigma_frac=0.10, axis="x", pct=65):
    """Remove broad cylindrical shading: divide by a smoothed per-column (or per-row) brightness profile."""
    f = img.astype(np.float32)
    L = lum(img)
    prof = np.percentile(L, pct, axis=0 if axis == "x" else 1)
    n = len(prof)
    sig = max(3, int(n * sigma_frac))
    k = cv2.getGaussianKernel(sig * 6 + 1, sig).ravel()
    pad = np.pad(prof, (sig * 3, sig * 3), mode="reflect")
    sm = np.convolve(pad, k, mode="same")[sig * 3: sig * 3 + n]
    target = np.percentile(sm, 80)
    gain = np.clip((target / np.maximum(sm, 1)) ** strength, 0.7, 1.9)
    if axis == "x":
        f *= gain[None, :, None]
    else:
        f *= gain[:, None, None]
    return np.clip(f, 0, 255)


def despecular(img, l_thresh=242, s_thresh=28, grow=3, radius=5, min_aspect=3.0, min_h_frac=0.25):
    """Inpaint glare streaks only: very bright, desaturated connected blobs that are tall & thin
    (vertical highlight bands on cylinders). White print (letters) is left alone."""
    u8 = img.astype(np.uint8)
    hsv = cv2.cvtColor(u8, cv2.COLOR_RGB2HSV)
    raw = ((hsv[..., 2] >= l_thresh) & (hsv[..., 1] <= s_thresh)).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(raw)
    H = img.shape[0]
    m = np.zeros_like(raw)
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if h >= H * min_h_frac and h / max(1, w) >= min_aspect:
            m[lab == i] = 1
    m = m * 255
    if grow:
        m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (grow * 2 + 1, grow * 2 + 1)))
    return cv2.inpaint(u8, m, radius, cv2.INPAINT_TELEA).astype(np.float32), m


def white_balance(img, pct=97, target=246, max_gain=1.25):
    """Scale channels so the brightest near-neutral pixels become neutral white."""
    f = img.astype(np.float32)
    L = f.mean(axis=2)
    sel = L >= np.percentile(L, pct)
    if sel.sum() < 50:
        return f
    means = f[sel].mean(axis=0)
    gains = np.clip(target / np.maximum(means, 1), 1 / max_gain, max_gain)
    return np.clip(f * gains[None, None, :], 0, 255)


def levels(img, lo=0.4, hi=99.6, sat=1.05):
    f = img.astype(np.float32)
    a, b = np.percentile(f, lo), np.percentile(f, hi)
    f = (f - a) * 255.0 / max(1.0, b - a)
    if sat != 1.0:
        g = f.mean(axis=2, keepdims=True)
        f = g + (f - g) * sat
    return np.clip(f, 0, 255)


def unsharp(img, amount=0.35, sigma=1.2):
    f = img.astype(np.float32)
    bl = cv2.GaussianBlur(f, (0, 0), sigma)
    return np.clip(f + (f - bl) * amount, 0, 255)


def grid_preview(path, out, step=0.05):
    """Draw a labelled normalised grid over an image (to pick crop coordinates by eye)."""
    im = load(path)
    H, W = im.shape[:2]
    s = 1000 / max(W, H)
    im = cv2.resize(im, (int(W * s), int(H * s)), interpolation=cv2.INTER_AREA)
    H, W = im.shape[:2]
    for i in range(1, int(1 / step)):
        t = i * step
        col = (255, 0, 0) if i % 2 == 0 else (0, 160, 255)
        cv2.line(im, (int(W * t), 0), (int(W * t), H), col, 1)
        cv2.line(im, (0, int(H * t)), (W, int(H * t)), col, 1)
        if i % 2 == 0:
            cv2.putText(im, f"{t:.1f}", (int(W * t) + 2, 12), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (255, 0, 0), 1)
            cv2.putText(im, f"{t:.1f}", (2, int(H * t) - 2), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (255, 0, 0), 1)
    Image.fromarray(im).save(out, quality=90)


def row_edges(img, y, thresh=238, band=3):
    m = silhouette(img, thresh)
    L, R = [], []
    for yy in range(max(0, int(y) - band), min(img.shape[0], int(y) + band + 1)):
        xs = np.nonzero(m[yy])[0]
        if len(xs) > 10:
            L.append(xs[0])
            R.append(xs[-1])
    return float(np.median(L)), float(np.median(R))


def frustum_unwrap(img, y0, y1, max_deg=68, thresh=238, inset=0.0, out_h=None):
    """Unwrap a conical cup (frustum) seen from the side: radius varies linearly from y0 to y1.
    Edges are measured from the white-background silhouette at y0 and y1."""
    l0, r0 = row_edges(img, y0, thresh)
    l1, r1 = row_edges(img, y1, thresh)
    c0, c1 = (l0 + r0) / 2, (l1 + r1) / 2
    rad0, rad1 = (r0 - l0) / 2 * (1 - inset), (r1 - l1) / 2 * (1 - inset)
    lim = np.radians(max_deg)
    rmean = (rad0 + rad1) / 2
    out_w = int(rmean * 2 * lim)
    out_h = int(out_h or (y1 - y0))
    th = np.linspace(-lim, lim, out_w)
    ys = np.linspace(y0, y1, out_h)
    t = (ys - y0) / max(1, (y1 - y0))
    rad = rad0 + (rad1 - rad0) * t
    cxs = c0 + (c1 - c0) * t
    map_x = (cxs[:, None] + rad[:, None] * np.sin(th)[None, :]).astype(np.float32)
    map_y = np.tile(ys[:, None], (1, out_w)).astype(np.float32)
    return cv2.remap(img, map_x, map_y, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
