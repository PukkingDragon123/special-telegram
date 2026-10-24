"""Expression variants for static face textures (R3-people).

All functions work on the aligned 1024 canvas produced by face_build.py, with
MediaPipe 478-point landmarks `lm` (pixel coords on that canvas).
Variants: dumb_thinking, drunk, sleep, shock, scream.
Each returns (rgb_float, zero_tint_mask, new_landmarks).
"""
import math

import cv2
import numpy as np
from scipy.interpolate import RBFInterpolator

import texlib as T

UP_R = [246, 161, 160, 159, 158, 157, 173]     # image-left eye, upper lid (outer -> inner)
LO_R = [7, 163, 144, 145, 153, 154, 155]
COR_R = (33, 133)
UP_L = [466, 388, 387, 386, 385, 384, 398]     # image-right eye, upper lid (outer -> inner)
LO_L = [249, 390, 373, 374, 380, 381, 382]
COR_L = (263, 362)
IRIS_R = (468, [469, 470, 471, 472])
IRIS_L = (473, [474, 475, 476, 477])
BROW_R = [70, 63, 105, 66, 107, 46, 53, 52, 65, 55]
BROW_L = [300, 293, 334, 296, 336, 276, 283, 282, 295, 285]
LIP_UP_OUT = [185, 40, 39, 37, 0, 267, 269, 270, 409]
LIP_LO_OUT = [375, 321, 405, 314, 17, 84, 181, 91, 146]
LIP_UP_IN = [191, 80, 81, 82, 13, 312, 311, 310, 415]
LIP_LO_IN = [324, 318, 402, 317, 14, 87, 178, 88, 95]
MOUTH_COR = (61, 291)
MOUTH_COR_IN = (78, 308)
CHIN = [152, 148, 176, 377, 400, 149, 378, 150, 379, 136, 365, 199, 175, 200, 18, 83, 313, 201, 421,
        208, 428, 32, 262, 171, 396, 140, 369]
EYE_R_ALL = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7]
EYE_L_ALL = [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249]
LIPS_IN_ALL = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95]


# ----------------------------------------------------------------------------- warp core
def tps_warp(img, lm, moves, free_radius=0.0, step=8, smoothing=0.5):
    """moves: dict idx -> (dx, dy) displacement of that landmark (dest = src + d).
    Every other landmark further than free_radius from a moved one is pinned.
    Returns warped image and moved landmarks."""
    h, w = img.shape[:2]
    idx = np.array(sorted(moves.keys()))
    d = np.array([moves[i] for i in idx], np.float32)
    src_m = lm[idx]
    dst_m = src_m + d
    pinned = []
    iod = float(np.linalg.norm(lm[263] - lm[33]))
    for i in range(len(lm)):
        if i in moves:
            continue
        dmin = float(np.min(np.linalg.norm(src_m - lm[i], axis=1)))
        if free_radius > 0 and dmin < free_radius:
            continue
        # keep all pins near the moved region, a sparse subset elsewhere (speed)
        if dmin < iod * 0.9 or i % 6 == 0:
            pinned.append(i)
    pins = lm[pinned]
    # border pins
    b = np.linspace(0, w - 1, 9)
    border = np.array([[x, 0] for x in b] + [[x, h - 1] for x in b] + [[0, y] for y in b[1:-1]] +
                      [[w - 1, y] for y in b[1:-1]], np.float32)
    ctrl = np.vstack([dst_m, pins, border])
    vals = np.vstack([src_m - dst_m, np.zeros((len(pins) + len(border), 2), np.float32)])
    rbf = RBFInterpolator(ctrl, vals, kernel="thin_plate_spline", smoothing=smoothing)
    gy, gx = np.mgrid[0:h + step:step, 0:w + step:step].astype(np.float32)
    grid = np.stack([gx.ravel(), gy.ravel()], 1)
    disp = rbf(grid).reshape(gx.shape[0], gx.shape[1], 2).astype(np.float32)
    # grid node k sits at pixel k*step -> sample the coarse field at (x/step, y/step)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dx = cv2.remap(np.ascontiguousarray(disp[..., 0]), xx / step, yy / step, cv2.INTER_CUBIC)
    dy = cv2.remap(np.ascontiguousarray(disp[..., 1]), xx / step, yy / step, cv2.INTER_CUBIC)
    out = cv2.remap(img, xx + dx, yy + dy, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT101)
    lm2 = lm.copy()
    lm2[idx] = dst_m
    return np.clip(out, 0, 1), lm2


def poly(pts, shape, blur=0.0, dilate=0):
    m = np.zeros(shape[:2], np.uint8)
    cv2.fillPoly(m, [np.round(pts).astype(np.int32)], 255)
    if dilate:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * abs(dilate) + 1,) * 2)
        m = cv2.dilate(m, k) if dilate > 0 else cv2.erode(m, k)
    m = m.astype(np.float32) / 255
    if blur > 0:
        m = cv2.GaussianBlur(m, (0, 0), blur)
    return m


def resample(pts, n=32):
    pts = np.asarray(pts, np.float32)
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    t = np.concatenate([[0], np.cumsum(seg)])
    t /= t[-1]
    u = np.linspace(0, 1, n)
    return np.stack([np.interp(u, t, pts[:, 0]), np.interp(u, t, pts[:, 1])], 1).astype(np.float32)


def eye_def(side):
    if side == "R":
        return UP_R, LO_R, COR_R, IRIS_R, BROW_R
    return UP_L, LO_L, COR_L, IRIS_L, BROW_L


def lid_curves(lm, side, n=32):
    up, lo, (c_out, c_in), _, _ = eye_def(side)
    U = resample([lm[c_out]] + [lm[i] for i in up] + [lm[c_in]], n)
    L = resample([lm[c_out]] + [lm[i] for i in lo] + [lm[c_in]], n)
    return U, L


def eye_metrics(lm, side):
    U, L = lid_curves(lm, side)
    height = float(np.max(L[:, 1] - U[:, 1]))
    _, _, (c_out, c_in), (ic, ring), _ = eye_def(side)
    width = float(np.linalg.norm(lm[c_out] - lm[c_in]))
    c = lm[ic]
    r = float(np.mean([np.linalg.norm(lm[i] - c) for i in ring]))
    return height, width, c, r


def sclera_color(img, lm, side):
    U, L = lid_curves(lm, side)
    E = poly(np.vstack([U, L[::-1]]), img.shape, dilate=-2)
    _, _, c, r = eye_metrics(lm, side)
    yy, xx = np.mgrid[0:img.shape[0], 0:img.shape[1]]
    iris = ((xx - c[0]) ** 2 + (yy - c[1]) ** 2) < (1.25 * r) ** 2
    m = (E > 0.5) & (~iris)
    px = img[m]
    if len(px) < 20:
        return np.float32([0.82, 0.78, 0.75])
    Y = px @ np.float32([0.3, 0.59, 0.11])
    hi = px[Y >= np.percentile(Y, 55)]
    return hi.mean(0)


# ----------------------------------------------------------------------------- eyes
def close_eye(img, lm, side, amount=1.0, lash_strength=0.55):
    """amount 1 = closed (sleep), ~0.45 = heavy half lid (drunk)."""
    U, L = lid_curves(lm, side, 9)
    up, lo, (c_out, c_in), _, brow = eye_def(side)
    h_eye, w_eye, c, r = eye_metrics(lm, side)
    moves = {}
    frac = 0.70 if amount >= 1 else amount
    for k, i in enumerate(up):
        t = (k + 1) / (len(up) + 1)
        lo_pt = np.interp(t, np.linspace(0, 1, 9), L[:, 1])
        dy = (lo_pt - lm[i][1]) * frac
        moves[i] = (0.0, float(dy))
    if amount >= 1:
        for k, i in enumerate(lo):
            moves[i] = (0.0, float(-h_eye * 0.12 * math.sin(math.pi * (k + 1) / (len(lo) + 1))))
    # the lid skin above follows partly (upper lid crease region)
    crease = {"R": [56, 28, 27, 29, 30, 247, 225, 224, 223, 222, 221, 189],
              "L": [286, 258, 257, 259, 260, 467, 445, 444, 443, 442, 441, 413]}[side]
    for i in crease:
        moves.setdefault(i, (0.0, float(h_eye * frac * 0.18)))
    for i in (c_out, c_in):
        moves[i] = (0.0, 0.0)
    for i in brow:
        moves[i] = (0.0, 0.0)
    out, lm2 = tps_warp(img, lm, moves, free_radius=h_eye * 0.6)
    newU = resample([lm2[c_out]] + [lm2[i] for i in up] + [lm2[c_in]], 48)
    if amount >= 1:
        # remove any eyeball pixels left at the corners: inpaint the old opening except a
        # thin band along the new lid line, from the surrounding (warped) lid skin
        Uo, Lo = lid_curves(lm, side, 48)
        E0 = np.zeros(img.shape[:2], np.uint8)
        cv2.fillPoly(E0, [np.round(np.vstack([Uo, Lo[::-1]])).astype(np.int32)], 255)
        E0 = cv2.dilate(E0, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
        band = np.zeros(img.shape[:2], np.uint8)
        cv2.polylines(band, [np.round(newU).astype(np.int32)], False, 255, max(3, int(h_eye * 0.22)))
        hole = cv2.bitwise_and(E0, cv2.bitwise_not(band))
        u8 = np.clip(out * 255, 0, 255).astype(np.uint8)
        out = cv2.inpaint(u8, hole, max(4, int(h_eye * 0.25)), cv2.INPAINT_TELEA).astype(np.float32) / 255
        # blend the inpainted area softly
    # paint: soft lid shadow / lash emphasis along the new lid margin
    shade = np.zeros(img.shape[:2], np.float32)
    pts = np.round(newU).astype(np.int32)
    cv2.polylines(shade, [pts], False, 1.0, max(2, int(h_eye * 0.10)), cv2.LINE_AA)
    shade = cv2.GaussianBlur(shade, (0, 0), max(1.0, h_eye * 0.05))
    lash = np.zeros(img.shape[:2], np.float32)
    cv2.polylines(lash, [pts], False, 1.0, max(1, int(h_eye * 0.06)), cv2.LINE_AA)
    lash = cv2.GaussianBlur(lash, (0, 0), 0.8)
    # taper the lash line towards the corners
    taper = np.zeros(img.shape[:2], np.float32)
    mid = newU[len(newU) // 2]
    cv2.ellipse(taper, (int(mid[0]), int(mid[1])), (int(w_eye * 0.45), int(h_eye * 0.9)), 0, 0, 360, 1.0, -1)
    taper = cv2.GaussianBlur(taper, (0, 0), w_eye * 0.12)
    lash = lash * np.clip(taper * 1.3, 0, 1)
    out = out * (1 - 0.18 * shade[..., None])
    lash_col = np.float32([0.08, 0.06, 0.05])
    a = (lash * lash_strength)[..., None]
    out = out * (1 - a) + lash_col * a
    if amount < 1:
        # shadow cast by the heavy lid onto the visible eyeball below the margin
        below = np.zeros(img.shape[:2], np.float32)
        Lc = resample([lm2[c_out]] + [lm2[i] for i in lo] + [lm2[c_in]], 48)
        cv2.fillPoly(below, [np.round(np.vstack([newU, Lc[::-1]])).astype(np.int32)], 1.0)
        grad = np.zeros_like(below)
        for k in range(len(newU)):
            pass
        dist = cv2.distanceTransform((1 - (cv2.GaussianBlur(shade, (0, 0), 1) > 0.3)).astype(np.uint8),
                                     cv2.DIST_L2, 3)
        g = np.clip(1 - dist / (h_eye * 0.45), 0, 1) * below
        out = out * (1 - 0.35 * g[..., None])
    return np.clip(out, 0, 1), lm2


def iris_disk(img, lm, side, scale=1.15):
    """Return (patch, alpha, centre, radius) of a symmetrised complete iris."""
    h_eye, w_eye, c, r = eye_metrics(lm, side)
    U, L = lid_curves(lm, side)
    E = poly(np.vstack([U, L[::-1]]), img.shape, dilate=-1)
    R = int(math.ceil(r * scale)) + 2
    x0, y0 = int(c[0]) - R, int(c[1]) - R
    patch = img[y0:y0 + 2 * R, x0:x0 + 2 * R].copy()
    vis = E[y0:y0 + 2 * R, x0:x0 + 2 * R].copy()
    yy, xx = np.mgrid[0:2 * R, 0:2 * R].astype(np.float32)
    cx, cy = c[0] - x0, c[1] - y0
    # mirror vertically about the iris centre for occluded pixels
    my = np.clip(2 * cy - yy, 0, 2 * R - 1)
    mir = cv2.remap(patch, xx, my, cv2.INTER_LINEAR)
    mvis = cv2.remap(vis, xx, my, cv2.INTER_LINEAR)
    use_m = (vis < 0.5) & (mvis > 0.5)
    patch[use_m] = mir[use_m]
    vis2 = np.maximum(vis, mvis)
    # remaining holes: radial median fill
    hole = vis2 < 0.5
    if hole.any():
        good = patch[~hole].reshape(-1, 3)
        patch[hole] = np.median(good, 0) if len(good) else 0.2
    dist = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    alpha = np.clip((r * 1.04 - dist) / (r * 0.10), 0, 1)
    # darker limbal ring for realism
    ring = np.exp(-((dist - r * 0.95) / (r * 0.10)) ** 2)
    patch = patch * (1 - 0.25 * ring[..., None])
    return patch, alpha, (x0, y0), r


def remove_iris(img, lm, side):
    h_eye, w_eye, c, r = eye_metrics(lm, side)
    U, L = lid_curves(lm, side)
    E = poly(np.vstack([U, L[::-1]]), img.shape)
    scl = sclera_color(img, lm, side)
    yy, xx = np.mgrid[0:img.shape[0], 0:img.shape[1]].astype(np.float32)
    d = np.sqrt((xx - c[0]) ** 2 + (yy - c[1]) ** 2)
    hole = (d < r * 1.22).astype(np.uint8) * (E > 0.3).astype(np.uint8)
    u8 = np.clip(img * 255, 0, 255).astype(np.uint8)
    inp = cv2.inpaint(u8, hole * 255, max(3, int(r * 0.6)), cv2.INPAINT_TELEA).astype(np.float32) / 255
    # pull the inpainted area towards clean sclera with soft shading
    hm = cv2.GaussianBlur(hole.astype(np.float32), (0, 0), 2)
    xt = (xx - c[0]) / (w_eye * 0.5 + 1e-3)
    shade = np.clip(1 - 0.18 * xt ** 2, 0.75, 1)
    clean = scl[None, None, :] * shade[..., None]
    fill = inp * 0.45 + clean * 0.55
    out = img * (1 - hm[..., None]) + fill * hm[..., None]
    return out, E


def move_iris(img, lm, side, dx_r, dy_r):
    """Move iris by (dx_r, dy_r) * iris radius; positive dx = towards image right."""
    patch, alpha, (x0, y0), r = iris_disk(img, lm, side)
    base, E = remove_iris(img, lm, side)
    h, w = patch.shape[:2]
    nx, ny = x0 + dx_r * r, y0 + dy_r * r
    M = np.float32([[1, 0, nx], [0, 1, ny]])
    big_p = cv2.warpAffine(patch, M, (img.shape[1], img.shape[0]), flags=cv2.INTER_LINEAR)
    big_a = cv2.warpAffine(alpha, M, (img.shape[1], img.shape[0]), flags=cv2.INTER_LINEAR)
    Es = cv2.GaussianBlur(E, (0, 0), 0.8)
    a = (big_a * Es)[..., None]
    out = base * (1 - a) + big_p * a
    out = lid_shadow(out, lm, side)
    return out


def lid_shadow(img, lm, side, strength=0.28):
    U, L = lid_curves(lm, side, 48)
    h_eye = float(np.max(L[:, 1] - U[:, 1]))
    E = poly(np.vstack([U, L[::-1]]), img.shape)
    line = np.zeros(img.shape[:2], np.uint8)
    cv2.polylines(line, [np.round(U).astype(np.int32)], False, 255, 2)
    dist = cv2.distanceTransform(255 - line, cv2.DIST_L2, 3)
    g = np.clip(1 - dist / (h_eye * 0.55), 0, 1) ** 1.5 * E
    return img * (1 - strength * g[..., None])


def widen_eye(img, lm, side, up_f=0.45, down_f=0.12, brow_f=0.75):
    """Shock eyes: lids pulled apart, full round iris with sclera above/below."""
    h_eye, w_eye, c, r = eye_metrics(lm, side)
    up, lo, (c_out, c_in), _, brow = eye_def(side)
    # 1) eyeball layer: sclera canvas + original opening + complete iris
    scl = sclera_color(img, lm, side)
    U, L = lid_curves(lm, side)
    E = poly(np.vstack([U, L[::-1]]), img.shape, dilate=-1)
    yy, xx = np.mgrid[0:img.shape[0], 0:img.shape[1]].astype(np.float32)
    xt = (xx - (lm[c_out][0] + lm[c_in][0]) / 2) / (w_eye * 0.55)
    yt = (yy - c[1]) / (h_eye * 1.6)
    shade = np.clip(1 - 0.22 * xt ** 2 - 0.10 * yt ** 2, 0.6, 1)
    rng = np.random.default_rng(7)
    vein = T.fbm(img.shape[0], img.shape[1], beta=1.6, seed=int(c[0]) % 97, hi=img.shape[0] / 6)
    ball = scl[None, None, :] * shade[..., None]
    ball = ball * (1 + 0.025 * vein[..., None])
    ball[..., 0] += 0.02 * np.clip(vein, 0, None) * np.clip(np.abs(xt), 0, 1)  # faint redness at corners
    base_noir, _ = remove_iris(img, lm, side)
    Es = cv2.GaussianBlur(E, (0, 0), 2)
    ball = ball * (1 - Es[..., None]) + base_noir * Es[..., None]
    patch, alpha, (x0, y0), rr = iris_disk(img, lm, side)
    M = np.float32([[1, 0, x0], [0, 1, y0]])
    big_p = cv2.warpAffine(patch, M, (img.shape[1], img.shape[0]))
    big_a = cv2.warpAffine(alpha, M, (img.shape[1], img.shape[0]))[..., None]
    ball = ball * (1 - big_a) + big_p * big_a
    # 2) warp skin: lids apart, brows up
    moves = {}
    for k, i in enumerate(up):
        s = math.sin(math.pi * (k + 1) / (len(up) + 1))
        moves[i] = (0.0, float(-h_eye * up_f * (0.35 + 0.65 * s)))
    for k, i in enumerate(lo):
        s = math.sin(math.pi * (k + 1) / (len(lo) + 1))
        moves[i] = (0.0, float(h_eye * down_f * s))
    for i in brow:
        moves[i] = (0.0, float(-h_eye * brow_f))
    crease = {"R": [56, 28, 27, 29, 30, 247, 225, 224, 223, 222, 221, 189],
              "L": [286, 258, 257, 259, 260, 467, 445, 444, 443, 442, 441, 413]}[side]
    for i in crease:
        moves[i] = (0.0, float(-h_eye * (up_f + brow_f) * 0.5))
    for i in (c_out, c_in):
        moves[i] = (0.0, 0.0)
    warped, lm2 = tps_warp(img, lm, moves, free_radius=h_eye * 0.5)
    U2, L2 = lid_curves(lm2, side, 48)
    E2 = poly(np.vstack([U2, L2[::-1]]), img.shape, dilate=0, blur=0.9)
    ball = lid_shadow(ball, lm2, side, 0.30)
    out = warped * (1 - E2[..., None]) + ball * E2[..., None]
    # lash line on the new upper lid
    lash = np.zeros(img.shape[:2], np.float32)
    cv2.polylines(lash, [np.round(U2).astype(np.int32)], False, 1.0, max(1, int(h_eye * 0.07)), cv2.LINE_AA)
    lash = cv2.GaussianBlur(lash, (0, 0), 0.7)[..., None] * 0.6
    out = out * (1 - lash) + np.float32([0.07, 0.05, 0.05]) * lash
    return np.clip(out, 0, 1), lm2


# ----------------------------------------------------------------------------- mouth
def mouth_interior(shape, lm, open_px, kind, seed=0):
    """Paint mouth interior colour + alpha for the inner-lip polygon of lm."""
    up = [lm[MOUTH_COR_IN[0]]] + [lm[i] for i in LIP_UP_IN] + [lm[MOUTH_COR_IN[1]]]
    lo = [lm[MOUTH_COR_IN[1]]] + [lm[i] for i in LIP_LO_IN] + [lm[MOUTH_COR_IN[0]]]
    upc = resample(up, 64)
    loc = resample(lo, 64)
    polyp = np.vstack([upc, loc])
    m = poly(polyp, shape, blur=0.0)
    if m.sum() < 5:
        return None, None
    h, w = shape[:2]
    dist = cv2.distanceTransform((m > 0.5).astype(np.uint8), cv2.DIST_L2, 5)
    dmax = max(dist.max(), 1)
    t = np.clip(dist / dmax, 0, 1)
    dark = np.float32([0.045, 0.012, 0.012])
    edge = np.float32([0.26, 0.08, 0.08])
    col = edge[None, None, :] * (1 - t[..., None]) ** 1.3 + dark[None, None, :] * (1 - (1 - t[..., None]) ** 1.3)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    x_l, x_r = float(lm[MOUTH_COR_IN[0]][0]), float(lm[MOUTH_COR_IN[1]][0])
    mw = max(x_r - x_l, 1)
    xc = (x_l + x_r) / 2
    # upper inner lip y(x)
    uy = np.interp(xx[0], upc[:, 0], upc[:, 1]) if upc[0, 0] < upc[-1, 0] else np.interp(xx[0], upc[::-1, 0], upc[::-1, 1])
    ly = np.interp(xx[0], loc[::-1, 0], loc[::-1, 1]) if loc[0, 0] > loc[-1, 0] else np.interp(xx[0], loc[:, 0], loc[:, 1])
    uy = uy[None, :] * np.ones((h, 1), np.float32)
    ly = ly[None, :] * np.ones((h, 1), np.float32)
    xn = (xx - xc) / (mw / 2)
    gap = np.maximum(ly - uy, 1)
    rng = np.random.default_rng(seed)
    if kind in ("slight", "o", "scream", "shock"):
        th = {"slight": 0.42, "o": 0.30, "shock": 0.30, "scream": 0.24}[kind]
        tooth_h = np.minimum(gap * th, open_px * 0.9)
        in_teeth = (yy >= uy - 2) & (yy <= uy + tooth_h) & (np.abs(xn) < 0.78)
        tcol = np.float32([0.86, 0.82, 0.74])
        # tooth separation lines (perspective: narrower towards the corners)
        tooth_w = mw * 0.115
        u = np.arcsin(np.clip(xn / 0.85, -1, 1)) * (mw * 0.45)
        sep = np.abs(((u / tooth_w) % 1.0) - 0.5)
        sep_line = np.clip(1 - sep / 0.06, 0, 1) * 0.35
        vy = np.clip((yy - uy) / np.maximum(tooth_h, 1), 0, 1)
        tshade = (0.62 + 0.38 * np.sin(np.clip(vy, 0, 1) * math.pi * 0.9)) * np.clip(1 - np.abs(xn) ** 3, 0.25, 1)
        teeth = tcol[None, None, :] * tshade[..., None] * (1 - sep_line[..., None])
        # bottom edge softly darker (incisal edge translucency)
        teeth *= (1 - 0.25 * np.clip((vy - 0.8) / 0.2, 0, 1))[..., None]
        ta = in_teeth.astype(np.float32) * np.clip((0.78 - np.abs(xn)) / 0.12, 0, 1)
        ta = cv2.GaussianBlur(ta, (0, 0), 0.8)
        col = col * (1 - ta[..., None]) + teeth * ta[..., None]
    if kind in ("scream", "shock", "o"):
        # lower teeth hint
        lth = np.minimum(gap * 0.12, open_px * 0.25)
        in_lt = (yy <= ly + 1) & (yy >= ly - lth) & (np.abs(xn) < 0.55)
        la = in_lt.astype(np.float32) * np.clip((0.55 - np.abs(xn)) / 0.15, 0, 1) * 0.75
        la = cv2.GaussianBlur(la, (0, 0), 0.8)
        lcol = np.float32([0.70, 0.65, 0.58]) * 0.85
        col = col * (1 - la[..., None]) + lcol * la[..., None]
    if kind in ("scream", "shock", "o"):
        # tongue: blob resting at the bottom centre
        ty = ly - gap * 0.18
        tr = (((xx - xc) / (mw * 0.33)) ** 2 + ((yy - ty) / (gap * 0.30 + 1)) ** 2)
        ta2 = np.clip(1.15 - tr, 0, 1) * (yy > ty - gap * 0.1)
        ta2 = cv2.GaussianBlur(ta2.astype(np.float32), (0, 0), 1.5)
        tcol2 = np.float32([0.55, 0.18, 0.18])
        hl = np.clip(1 - tr * 1.4, 0, 1) * 0.12
        tongue = tcol2[None, None, :] * (0.75 + 0.25 * (1 - tr[..., None])) + hl[..., None]
        col = col * (1 - 0.85 * ta2[..., None]) + tongue * 0.85 * ta2[..., None]
    n = T.fbm(h, w, beta=1.4, seed=seed + 3, hi=h / 4)
    col = col * (1 + 0.05 * n[..., None])
    a = poly(polyp, shape, blur=1.0)
    return np.clip(col, 0, 1), a


def open_mouth(img, lm, open_f, widen_f=0.0, kind="slight", upper_lift=0.12, chin_f=0.35):
    """open_f: lip gap as fraction of inter-ocular distance."""
    iod = float(np.linalg.norm(lm[263] - lm[33]))
    gap = open_f * iod
    mw = float(np.linalg.norm(lm[61] - lm[291]))
    cx = float((lm[61][0] + lm[291][0]) / 2)
    moves = {}
    for grp, base_f in ((LIP_LO_IN, 1.0), (LIP_LO_OUT, 0.97)):
        for i in grp:
            xn = (lm[i][0] - cx) / (mw / 2)
            prof = 1.0 - 0.45 * xn ** 2 if kind != "scream" else 1.0 - 0.25 * xn ** 2
            moves[i] = (float(-xn * widen_f * mw * 0.10), float(gap * base_f * prof))
    for grp, base_f in ((LIP_UP_IN, 1.0), (LIP_UP_OUT, 0.9)):
        for i in grp:
            xn = (lm[i][0] - cx) / (mw / 2)
            moves[i] = (float(-xn * widen_f * mw * 0.06), float(-gap * upper_lift * base_f * (1 - 0.3 * xn ** 2)))
    for i, sgn in ((61, -1), (291, 1), (78, -1), (308, 1)):
        dx = sgn * widen_f * mw * 0.12
        dy = gap * (0.28 if kind == "scream" else 0.18)
        moves[i] = (float(dx), float(dy))
    y_lo = float(lm[17][1])
    y_ch = float(lm[152][1])
    x_l, x_r = float(lm[172][0]), float(lm[397][0])
    for i in range(len(lm)):
        if i in moves:
            continue
        x, y = float(lm[i][0]), float(lm[i][1])
        if y <= y_lo + 2 or x < x_l or x > x_r:
            continue
        t = min(max((y - y_lo) / max(y_ch - y_lo, 1.0), 0.0), 1.0)
        xn = abs(x - cx) / max((x_r - x_l) / 2, 1.0)
        side = max(0.0, 1.0 - xn ** 2)
        moves[i] = (0.0, float(gap * (1.0 - t * (1.0 - chin_f)) * (0.35 + 0.65 * side)))
    out, lm2 = tps_warp(img, lm, moves, free_radius=iod * 0.06, smoothing=1.0)
    col, a = mouth_interior(img.shape, lm2, gap, kind, seed=int(cx))
    donor = DONOR_FOR.get(kind)
    if donor is not None and _DONOR_LOADER is not None:
        dimg, dlm = _DONOR_LOADER(donor)
        if kind in ("scream", "o", "shock"):
            dcol = compose_donor_mouth(dimg, dlm, out, lm2)
        else:
            dcol = warp_donor_mouth(dimg, dlm, out, lm2)
        if dcol is not None:
            col = dcol
    if col is not None:
        out = out * (1 - a[..., None]) + col * a[..., None]
        # wet inner-lip highlight
        up = resample([lm2[78]] + [lm2[i] for i in LIP_UP_IN] + [lm2[308]], 48)
        lo = resample([lm2[308]] + [lm2[i] for i in LIP_LO_IN] + [lm2[78]], 48)
        hl = np.zeros(img.shape[:2], np.float32)
        cv2.polylines(hl, [np.round(lo).astype(np.int32)], False, 1.0, 2, cv2.LINE_AA)
        hl = cv2.GaussianBlur(hl, (0, 0), 1.2) * 0.10
        out = out + hl[..., None]
        sh = np.zeros(img.shape[:2], np.float32)
        cv2.polylines(sh, [np.round(up).astype(np.int32)], False, 1.0, 3, cv2.LINE_AA)
        sh = cv2.GaussianBlur(sh, (0, 0), 1.5) * 0.25
        out = out * (1 - sh[..., None])
    zero = a if a is not None else np.zeros(img.shape[:2], np.float32)
    return np.clip(out, 0, 1), zero, lm2


def lopsided_grin(img, lm, amt=0.035):
    iod = float(np.linalg.norm(lm[263] - lm[33]))
    moves = {61: (-iod * amt * 0.3, -iod * amt), 78: (-iod * amt * 0.2, -iod * amt * 0.8),
             291: (iod * 0.004, iod * amt * 0.25), 308: (0.0, iod * amt * 0.2)}
    return tps_warp(img, lm, moves, free_radius=iod * 0.12, smoothing=1.0)


def brows(img, lm, dy_inner_r, dy_outer_r, dy_inner_l, dy_outer_l):
    iod = float(np.linalg.norm(lm[263] - lm[33]))
    moves = {}
    for grp, di, do in ((BROW_R, dy_inner_r, dy_outer_r), (BROW_L, dy_inner_l, dy_outer_l)):
        xs = np.array([lm[i][0] for i in grp])
        xin = xs.max() if grp is BROW_R else xs.min()
        xout = xs.min() if grp is BROW_R else xs.max()
        for i in grp:
            t = (lm[i][0] - xout) / (xin - xout + 1e-3)
            moves[i] = (0.0, float(-(do + (di - do) * t) * iod))
    return tps_warp(img, lm, moves, free_radius=iod * 0.15, smoothing=1.0)


# ----------------------------------------------------------------------------- colour
def blush(img, lm, strength=0.5, nose=True):
    h, w = img.shape[:2]
    iod = float(np.linalg.norm(lm[263] - lm[33]))
    m = np.zeros((h, w), np.float32)
    for a, b in ((50, 205), (280, 425)):
        p = (lm[a] + lm[b]) / 2
        cv2.ellipse(m, (int(p[0]), int(p[1])), (int(iod * 0.24), int(iod * 0.17)), 0, 0, 360, 1.0, -1)
    if nose:
        cv2.circle(m, (int(lm[4][0]), int(lm[4][1])), int(iod * 0.10), 0.8, -1)
    for i in (145, 374):  # under-eye flush
        cv2.ellipse(m, (int(lm[i][0]), int(lm[i][1] + iod * 0.07)), (int(iod * 0.15), int(iod * 0.05)),
                    0, 0, 360, 0.5, -1)
    m = cv2.GaussianBlur(m, (0, 0), iod * 0.09)
    lin = T.srgb_to_lin(img)
    tint = np.float32([1.0, 0.50, 0.52])
    k = (m * strength)[..., None]
    lin = lin * (1 - k) + lin * tint * k
    lin[..., 0] = lin[..., 0] * (1 + 0.15 * k[..., 0])
    return T.lin_to_srgb(lin)


def pallor(img, lm, amount=0.18):
    lab = cv2.cvtColor(img.astype(np.float32), cv2.COLOR_RGB2LAB)
    lab[..., 1] *= (1 - amount)
    lab[..., 2] *= (1 - amount * 0.6)
    lab[..., 0] = lab[..., 0] * (1 - amount * 0.15) + 100 * amount * 0.15 * 0.6
    return np.clip(cv2.cvtColor(lab, cv2.COLOR_LAB2RGB), 0, 1)


# ----------------------------------------------------------------------------- variants
def make_variant(name, img, lm, avg_lin, seed=0):
    zero = np.zeros(img.shape[:2], np.float32)
    lm2 = lm.copy()
    out = img.copy()
    if name == "sleep":
        out, lm2 = close_eye(out, lm2, "R", 1.0, lash_strength=0.30)
        out, lm2 = close_eye(out, lm2, "L", 1.0, lash_strength=0.30)
        out, lm2 = brows(out, lm2, -0.012, 0.0, -0.012, 0.0)
        out, z, lm2 = open_mouth(out, lm2, 0.035, 0.0, "slight", upper_lift=0.0, chin_f=0.2)
        zero = np.maximum(zero, z)
    elif name == "drunk":
        out = blush(out, lm2, 0.75)
        out, lm2 = close_eye(out, lm2, "R", 0.46)
        out, lm2 = close_eye(out, lm2, "L", 0.40)
        out, lm2 = lopsided_grin(out, lm2, 0.04)
        out, lm2 = brows(out, lm2, 0.035, -0.01, 0.005, -0.015)
    elif name == "dumb_thinking":
        out = move_iris(out, lm2, "R", 0.38, -0.55)   # image-left eye looks up and to the nose
        out = move_iris(out, lm2, "L", -0.38, -0.55)
        out, lm2 = brows(out, lm2, 0.02, 0.06, 0.0, -0.005)
        out, z, lm2 = open_mouth(out, lm2, 0.085, -0.15, "slight", upper_lift=0.05, chin_f=0.4)
        zero = np.maximum(zero, z)
    elif name == "shock":
        out, lm2 = widen_eye(out, lm2, "R", 0.42, 0.12, 0.55)
        out, lm2 = widen_eye(out, lm2, "L", 0.42, 0.12, 0.55)
        out, z, lm2 = open_mouth(out, lm2, 0.26, -0.30, "o", upper_lift=0.10, chin_f=0.30)
        zero = np.maximum(zero, z)
        out = pallor(out, lm2, 0.12)
    elif name == "scream":
        out, lm2 = widen_eye(out, lm2, "R", 0.50, 0.15, 0.70)
        out, lm2 = widen_eye(out, lm2, "L", 0.50, 0.15, 0.70)
        out, lm2 = brows(out, lm2, 0.05, 0.0, 0.05, 0.0)
        out, z, lm2 = open_mouth(out, lm2, 0.34, 0.20, "scream", upper_lift=0.14, chin_f=0.30)
        zero = np.maximum(zero, z)
    else:
        raise ValueError(name)
    # eyes never take the skin tint either
    return np.clip(out, 0, 1), zero, lm2


# ----------------------------------------------------------------------------- donors
# Photographic parts transplanted from other synthetic (CC0, SFHQ) faces, aligned to the
# same canonical frame by face_build.align():  mouth interiors and closed eyelids.
DONOR_FOR = {"slight": "SFHQ_pt2_00078890.jpg", "o": "SFHQ_pt4_00047693.jpg",
             "scream": "SFHQ_pt4_00089594.jpg", "shock": "SFHQ_pt4_00047693.jpg"}
EYE_DONOR = "SFHQ_pt4_00097018.jpg"
_DONOR_LOADER = None


def set_donor_loader(fn):
    global _DONOR_LOADER
    _DONOR_LOADER = fn


def tps_backward(dst_pts, src_pts, shape, step=8):
    """Map each target pixel to donor coords via TPS through the given correspondences."""
    h, w = shape[:2]
    rbf = RBFInterpolator(np.float32(dst_pts), np.float32(src_pts) - np.float32(dst_pts),
                          kernel="thin_plate_spline", smoothing=0.5)
    gy, gx = np.mgrid[0:h + step:step, 0:w + step:step].astype(np.float32)
    disp = rbf(np.stack([gx.ravel(), gy.ravel()], 1)).reshape(gx.shape[0], gx.shape[1], 2).astype(np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dx = cv2.remap(np.ascontiguousarray(disp[..., 0]), xx / step, yy / step, cv2.INTER_CUBIC)
    dy = cv2.remap(np.ascontiguousarray(disp[..., 1]), xx / step, yy / step, cv2.INTER_CUBIC)
    return xx + dx, yy + dy


def ring(lm, idxs, scale):
    c = np.mean(lm[idxs], axis=0)
    return c + (lm[idxs] - c) * scale


def warp_donor_mouth(dimg, dlm, timg, tlm):
    """Donor mouth interior warped into the target's (parted) inner-lip polygon, with the
    donor's brightness matched to the target's lips."""
    shape = timg.shape
    lip_in = [78] + LIP_UP_IN + [308] + LIP_LO_IN
    lip_out = [61] + LIP_UP_OUT + [291] + LIP_LO_OUT
    dst = np.vstack([tlm[lip_in], tlm[lip_out], ring(tlm, lip_out, 1.9)])
    src = np.vstack([dlm[lip_in], dlm[lip_out], ring(dlm, lip_out, 1.9)])
    mx, my = tps_backward(dst, src, shape)
    warped = cv2.remap(dimg, mx, my, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT101)

    def lipY(img, lm):
        m = poly(lm[lip_out], img.shape) * (1 - poly(lm[lip_in], img.shape))
        px = img[m > 0.5]
        return float(np.median(px @ np.float32([0.3, 0.59, 0.11]))) if len(px) else 0.5

    k = float(np.clip((lipY(timg, tlm) / max(lipY(dimg, dlm), 1e-3)) ** 0.7, 0.75, 1.3))
    return np.clip(warped * k, 0, 1)


def compose_donor_mouth(dimg, dlm, timg, tlm, top_frac=0.62, bot_frac=0.45):
    """Real-photo mouth interior at natural scale for big openings: donor upper-teeth strip
    hangs from the target's upper inner lip, donor lower strip rests on the lower inner lip,
    the gap between is the donor's own darkest interior colour (vertical falloff)."""
    h, w = timg.shape[:2]
    up_t = resample([tlm[78]] + [tlm[i] for i in LIP_UP_IN] + [tlm[308]], 64)
    lo_t = resample([tlm[78]] + [tlm[i] for i in LIP_LO_IN[::-1]] + [tlm[308]], 64)
    up_d = resample([dlm[78]] + [dlm[i] for i in LIP_UP_IN] + [dlm[308]], 64)
    lo_d = resample([dlm[78]] + [dlm[i] for i in LIP_LO_IN[::-1]] + [dlm[308]], 64)
    xl_t, xr_t = float(tlm[78][0]), float(tlm[308][0])
    xl_d, xr_d = float(dlm[78][0]), float(dlm[308][0])
    sx = (xr_d - xl_d) / max(xr_t - xl_t, 1.0)
    gap_d = float(np.max(lo_d[:, 1] - up_d[:, 1]))
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    u = np.clip((xx - xl_t) / max(xr_t - xl_t, 1.0), 0, 1)
    xd = xl_d + u * (xr_d - xl_d)
    def curve(c, xq):
        order = np.argsort(c[:, 0])
        return np.interp(xq, c[order, 0], c[order, 1])
    Ut = curve(up_t, xx[0])[None, :] * np.ones((h, 1), np.float32)
    Lt = curve(lo_t, xx[0])[None, :] * np.ones((h, 1), np.float32)
    Ud = np.interp(xd, up_d[np.argsort(up_d[:, 0]), 0], up_d[np.argsort(up_d[:, 0]), 1])
    Ld = np.interp(xd, lo_d[np.argsort(lo_d[:, 0]), 0], lo_d[np.argsort(lo_d[:, 0]), 1])
    Ht = gap_d * top_frac / sx
    Hb = gap_d * bot_frac / sx
    dy_top = yy - Ut
    dy_bot = Lt - yy
    top = cv2.remap(dimg, xd.astype(np.float32), (Ud + dy_top * sx).astype(np.float32), cv2.INTER_CUBIC,
                    borderMode=cv2.BORDER_REFLECT101)
    bot = cv2.remap(dimg, xd.astype(np.float32), (Ld - dy_bot * sx).astype(np.float32), cv2.INTER_CUBIC,
                    borderMode=cv2.BORDER_REFLECT101)
    mi = poly(np.vstack([up_d, lo_d[::-1]]), dimg.shape)
    px = dimg[mi > 0.5]
    Y = px @ np.float32([0.3, 0.59, 0.11]) if len(px) else np.array([0.05])
    dark = px[Y <= np.percentile(Y, 8)].mean(0) if len(px) > 20 else np.float32([0.06, 0.02, 0.02])
    mid = np.clip((yy - Ut) / np.maximum(Lt - Ut, 1), 0, 1)
    fall = 0.55 + 0.45 * np.abs(mid - 0.45) / 0.55
    xn = np.abs(u - 0.5) * 2
    throat = dark[None, None, :] * (fall * (0.8 + 0.4 * xn))[..., None]
    wt = np.clip(1 - dy_top / np.maximum(Ht, 1), 0, 1) ** 0.6 * (dy_top > -2)
    wb = np.clip(1 - dy_bot / np.maximum(Hb, 1), 0, 1) ** 0.6 * (dy_bot > -2)
    wt = cv2.GaussianBlur(wt.astype(np.float32), (0, 0), 1.5)
    wb = cv2.GaussianBlur(wb.astype(np.float32), (0, 0), 1.5)
    out = throat * (1 - wt[..., None]) + top * wt[..., None]
    out = out * (1 - wb[..., None]) + bot * wb[..., None]
    k = 1.0
    return np.clip(out * k, 0, 1)


def close_eye_donor(img, lm, side, dimg, dlm):
    up, lo, (c_out, c_in), _, brow = eye_def(side)
    U, L = lid_curves(lm, side, 9)
    tgt_line = U + 0.70 * (L - U)
    Ud, Ld = lid_curves(dlm, side, 9)
    under = {"R": [111, 117, 118, 119, 120, 121, 128, 245, 193],
             "L": [340, 346, 347, 348, 349, 350, 357, 465, 417]}[side]
    brow_lo = {"R": [46, 53, 52, 65, 55], "L": [276, 283, 282, 295, 285]}[side]
    dst = np.vstack([tgt_line, (tgt_line + L) / 2, lm[brow], lm[under], lm[[c_out, c_in]]])
    src = np.vstack([Ld, Ld, dlm[brow], dlm[under], dlm[[c_out, c_in]]])
    mx, my = tps_backward(dst, src, img.shape)
    warped = cv2.remap(dimg, mx, my, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT101)
    region = np.vstack([lm[brow_lo] + np.float32([0, 4]), lm[under]])
    hull = cv2.convexHull(np.round(region).astype(np.int32))
    m = np.zeros(img.shape[:2], np.uint8)
    cv2.fillConvexPoly(m, hull, 255)
    m = cv2.erode(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    ys, xs = np.nonzero(m)
    if len(xs) < 50:
        return img
    center = (int((xs.min() + xs.max()) / 2), int((ys.min() + ys.max()) / 2))
    u8t = np.clip(img * 255, 0, 255).astype(np.uint8)
    u8d = np.clip(warped * 255, 0, 255).astype(np.uint8)
    out = cv2.seamlessClone(u8d, u8t, m, center, cv2.NORMAL_CLONE)
    return out.astype(np.float32) / 255.0
