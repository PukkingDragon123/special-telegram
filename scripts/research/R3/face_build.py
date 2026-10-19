#!/usr/bin/env python3
"""Build game-ready, projection-aligned face textures from synthetic (CC0) face photos.

R3-people.  Run with the venv python (cv2 + numpy + scipy), isolated:
  python -I face_build.py <analysis.json> <selection.json> <out_dir> [--only id,id] [--debug dir]

selection.json: [{"id": "m01", "src": "SFHQ_pt4_00098472.jpg", "sex": "m", "ageGroup": "young",
                  "label": "...", "variants": ["dumb_thinking", ...]}, ...]

Pipeline (work canvas 1024, output 512):
 1. exact 3-point affine: eye centres (corner midpoints) -> (0.36,0.44),(0.64,0.44),
    mouth centre -> (0.50,0.73)
 2. skin model (Lab Mahalanobis from cheek/forehead patches) -> hair / non-skin removal above
    the eyes and along the temples, refilled by normalised-convolution extrapolation +
    the face's own skin micro-detail
 3. lighting: remove the asymmetric part of the low-frequency shading, keep ~45% of the
    symmetric form shading; gentle exposure / white-balance clamp
 4. de-shine: compress local luminance peaks on skin and restore their chroma
 5. outside the face oval: feather into the face's own average skin colour (+ faint
    zero-mean pore noise)
 6. expression variants by landmark-driven warps + painting (see expressions.py)
 7. detail map  D = lin2srgb( clamp( K * srgb2lin(face) / srgb2lin(avgSkin), 0, 1) ), K=0.2158
    and a tint mask (255 = skin, 0 = eyes/teeth/mouth interior).
"""
import json
import zlib
import math
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import texlib as T  # noqa: E402
import expressions as X  # noqa: E402

N = 1024
OUT = 512
K_DETAIL = 0.2158  # linear value of sRGB 128: neutral skin -> mid grey
TGT = np.float32([[0.36 * N, 0.44 * N], [0.64 * N, 0.44 * N], [0.50 * N, 0.73 * N]])

FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400,
             377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
EYE_R = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7]
EYE_L = [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249]
BROW_R = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46]
BROW_L = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276]
LIPS_OUT = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146]
LIPS_IN = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95]
NOSE_LOW = [129, 98, 97, 2, 326, 327, 358, 279, 360, 344, 438, 457, 274, 1, 44, 237, 218, 115, 131, 49]
SKIN_SAMPLES = [50, 280, 117, 346, 187, 411, 205, 425, 151, 9, 108, 337, 6, 199, 36, 266]
CHEEKS = [50, 280, 205, 425, 117, 346]


# ----------------------------------------------------------------------------- helpers
def poly_mask(pts, shape, dilate=0, blur=0):
    m = np.zeros(shape[:2], np.uint8)
    cv2.fillPoly(m, [np.round(pts).astype(np.int32)], 255)
    if dilate > 0:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * dilate + 1, 2 * dilate + 1))
        m = cv2.dilate(m, k)
    elif dilate < 0:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (-2 * dilate + 1, -2 * dilate + 1))
        m = cv2.erode(m, k)
    m = m.astype(np.float32) / 255.0
    if blur > 0:
        m = cv2.GaussianBlur(m, (0, 0), blur)
    return m


def gblur(a, s):
    return cv2.GaussianBlur(a, (0, 0), s)


def norm_conv(img, w, s):
    """Normalised convolution: weighted blur that extrapolates into w==0 regions."""
    if img.ndim == 3:
        num = gblur(img * w[..., None], s)
        den = gblur(w, s)[..., None]
    else:
        num = gblur(img * w, s)
        den = gblur(w, s)
    return num / np.maximum(den, 1e-5)


def pull_push_fill(img, w):
    """Fill w~0 regions with a smooth extrapolation from w~1 pixels (multi-scale)."""
    out = norm_conv(img, w, 2.0)
    acc_w = np.clip(gblur(w, 2.0) * 4, 0, 1)
    res = out.copy()
    filled = acc_w.copy()
    for s in (6, 14, 30, 60, 120, 240):
        est = norm_conv(img, w, s)
        a = (1 - filled)
        res = res * (1 - a[..., None]) + est * a[..., None] if img.ndim == 3 else res * (1 - a) + est * a
        filled = np.clip(filled + np.clip(gblur(w, s) * 3, 0, 1) * (1 - filled), 0, 1)
    return res


def to_lab(rgb):
    return cv2.cvtColor(np.clip(rgb, 0, 1).astype(np.float32), cv2.COLOR_RGB2LAB)


def from_lab(lab):
    return np.clip(cv2.cvtColor(lab.astype(np.float32), cv2.COLOR_LAB2RGB), 0, 1)


def lum(lin):
    return lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722


def patch_mask(lm, idxs, rad, shape):
    m = np.zeros(shape[:2], np.float32)
    for i in idxs:
        cv2.circle(m, (int(lm[i][0]), int(lm[i][1])), int(rad), 1.0, -1)
    return m


# ----------------------------------------------------------------------------- stages
def align(img, lm):
    eR = (lm[33] + lm[133]) / 2
    eL = (lm[362] + lm[263]) / 2
    mo = (lm[61] + lm[291] + lm[13] + lm[14]) / 4
    src = np.float32([eR, eL, mo])
    A = cv2.getAffineTransform(src, TGT)
    sv = np.linalg.svd(A[:, :2], compute_uv=False)
    out = cv2.warpAffine(img, A, (N, N), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT101)
    lm2 = np.hstack([lm, np.ones((len(lm), 1), np.float32)]) @ A.T
    return np.clip(out, 0, 1), lm2.astype(np.float32), float(sv[0] / sv[1])


def skin_model(lab, lm, rad):
    m = patch_mask(lm, SKIN_SAMPLES, rad, lab.shape)
    px = lab[m > 0.5].reshape(-1, 3)
    # robust: drop extreme L (shadows/highlights) then iterate once
    med = np.median(px, 0)
    d = np.abs(px - med)
    keep = (d[:, 0] < 2.5 * (np.median(d[:, 0]) + 1)) & (d[:, 1] < 3 * (np.median(d[:, 1]) + .5)) \
        & (d[:, 2] < 3 * (np.median(d[:, 2]) + .5))
    px = px[keep]
    mu = px.mean(0)
    cov = np.cov(px.T) + np.diag([4.0, 1.0, 1.0])
    return mu, np.linalg.inv(cov)


def skin_likelihood(lab, mu, icov, scale=1.0):
    d = lab - mu
    d2 = np.einsum("...i,ij,...j->...", d, icov, d)
    return np.exp(-0.5 * d2 / (scale * 9.0)).astype(np.float32)


def feature_masks(lm, shape):
    eyes = np.maximum(poly_mask(lm[EYE_R], shape, 6), poly_mask(lm[EYE_L], shape, 6))
    brows = np.maximum(poly_mask(lm[BROW_R], shape, 4), poly_mask(lm[BROW_L], shape, 4))
    lips = poly_mask(lm[LIPS_OUT], shape, 6)
    nose = poly_mask(lm[NOSE_LOW], shape, 4)
    return eyes, brows, lips, nose


_SEG = None


def get_seg():
    global _SEG
    if _SEG is None:
        from face_segment import Segmenter
        _SEG = Segmenter(os.environ.get("R3_SEG_MODEL", "models/selfie_multiclass.tflite"))
    return _SEG


def remove_hair(rgb, lm, dbg=None):
    """Hair / non-face pixels inside the face oval are replaced by extrapolated skin.
    Masks come from MediaPipe's multiclass selfie segmenter (face_skin vs hair)."""
    h, w = rgb.shape[:2]
    probs = get_seg()(rgb)
    hair = probs[..., 1]
    face = probs[..., 3]
    iod = float(np.linalg.norm(((lm[362] + lm[263]) - (lm[33] + lm[133])) / 2))
    oval = poly_mask(lm[FACE_OVAL], (h, w), 0)
    eyes, brows, lips, nose = feature_masks(lm, (h, w))
    protect = np.clip(eyes + lips + nose, 0, 1)
    keep = np.clip((face - hair) * 1.6, 0, 1)
    keep = np.maximum(keep, protect)
    keep = keep * oval
    kb = (keep > 0.5).astype(np.uint8) * 255
    kb = cv2.morphologyEx(kb, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    kb = cv2.morphologyEx(kb, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))
    n, cc, stats, _ = cv2.connectedComponentsWithStats((kb > 0).astype(np.uint8), 8)
    if n > 1:
        main = cc[int(lm[6][1]), int(lm[6][0])]
        if main > 0:
            kb = (cc == main).astype(np.uint8) * 255
    kb = cv2.erode(kb, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    keep = gblur(kb.astype(np.float32) / 255.0, 5.0)
    lin = T.srgb_to_lin(rgb)
    sk_w = (keep > 0.97).astype(np.float32) * (1 - np.clip(eyes + brows + lips, 0, 1))
    sk_w = cv2.erode(sk_w, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    fill = pull_push_fill(lin, sk_w + 1e-5)
    # clamp fill brightness to the forehead/cheek skin range (no glare carried in from edges)
    Yk = lum(lin)[sk_w > 0.5]
    lo_y, hi_y = np.percentile(Yk, [12, 70]) if Yk.size > 100 else (0.1, 0.5)
    Yf = lum(fill)
    scale = np.clip(Yf, lo_y, hi_y) / np.maximum(Yf, 1e-4)
    fill = fill * scale[..., None]
    detail = skin_micro_detail(lin, lm, iod, (h, w))
    fill = fill * detail[..., None]
    out_lin = lin * keep[..., None] + fill * (1 - keep[..., None])
    if dbg is not None:
        dbg["hair"] = hair
        dbg["keep"] = keep
    return T.lin_to_srgb(out_lin), keep, None


def smoothstep_np(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0 + 1e-8), 0, 1)
    return t * t * (3 - 2 * t)


def skin_micro_detail(lin, lm, iod, shape):
    """Tile a high-passed cheek/forehead patch into a full-size multiplicative detail map."""
    y = lum(lin)
    best = None
    for idx in (151, 50, 280):
        cx, cy = lm[idx]
        r = int(iod * 0.16)
        x0, y0 = int(cx - r), int(cy - r)
        if x0 < 0 or y0 < 0 or x0 + 2 * r > shape[1] or y0 + 2 * r > shape[0]:
            continue
        p = y[y0:y0 + 2 * r, x0:x0 + 2 * r]
        hp = p / (gblur(p, 6) + 1e-4)
        v = float(np.std(hp))
        if best is None or abs(v - 0.06) < abs(best[0] - 0.06):
            best = (v, hp)
    if best is None:
        return np.ones(shape[:2], np.float32)
    hp = T.make_tileable(best[1].astype(np.float32), 0.3)
    reps = (shape[0] // hp.shape[0] + 2, shape[1] // hp.shape[1] + 2)
    tile = np.tile(hp, reps)[:shape[0], :shape[1]]
    tile = 1 + np.clip(tile - 1, -0.12, 0.12) * 0.8
    return tile.astype(np.float32)


def relight(rgb, lm, keep, dbg=None, flatten=0.55):
    h, w = rgb.shape[:2]
    lin = T.srgb_to_lin(rgb)
    Y = lum(lin)
    eyes, brows, lips, nose = feature_masks(lm, (h, w))
    oval_full = poly_mask(lm[FACE_OVAL], (h, w), 0)
    oval = poly_mask(lm[FACE_OVAL], (h, w), -int(0.012 * N))
    W = oval * (1 - np.clip(eyes + brows + lips, 0, 1)) + 1e-4
    sig = 0.05 * N
    L_low = norm_conv(Y, W, sig)
    L_mir = L_low[:, ::-1]
    W_mir = W[:, ::-1]
    # mirror about x = N/2 (faces are centred there after alignment)
    L_sym = (L_low * W_s(W, sig) + L_mir * W_s(W_mir, sig)) / (W_s(W, sig) + W_s(W_mir, sig) + 1e-5)
    ref = float(np.median(L_low[(oval > 0.5)]))
    # flatten more towards the oval edge so the rim melts into the flat surround
    din = cv2.distanceTransform((oval_full > 0.5).astype(np.uint8), cv2.DIST_L2, 5)
    din = din / max(float(din.max()), 1.0)
    fl = flatten + (1 - flatten) * (1 - smoothstep_np(0.10, 0.45, din))
    fl = gblur(fl.astype(np.float32), 0.02 * N)
    tgt = np.exp((1 - fl) * np.log(np.maximum(L_sym, 1e-4)) + fl * math.log(ref))
    G = np.clip(tgt / np.maximum(L_low, 1e-4), 0.55, 2.2)
    G = gblur(G, 0.015 * N)
    lin = lin * G[..., None]
    if dbg is not None:
        dbg["gain"] = G / 2.8
    return T.lin_to_srgb(lin)


def W_s(W, s):
    return gblur(W, s)


def exposure_wb(rgb, lm):
    lin = T.srgb_to_lin(rgb)
    iod = float(np.linalg.norm(lm[263] - lm[33]))
    m = patch_mask(lm, CHEEKS + [151], iod * 0.07, rgb.shape)
    c = lin[m > 0.5].reshape(-1, 3).mean(0)
    Yc = float(c @ np.float32([0.2126, 0.7152, 0.0722]))
    # exposure clamp to a plausible skin range
    lo, hi = 0.10, 0.48
    if Yc < lo:
        lin *= (lo / Yc) ** 0.8
    elif Yc > hi:
        lin *= (hi / Yc) ** 0.8
    rgb = T.lin_to_srgb(lin)
    lab = to_lab(rgb)
    sk = lab[m > 0.5].reshape(-1, 3).mean(0)
    a, b = float(sk[1]), float(sk[2])
    hue = math.degrees(math.atan2(b, a))
    chroma = math.hypot(a, b)
    th = min(max(hue, 42.0), 68.0)
    tc = min(max(chroma, 12.0), 30.0)
    if abs(th - hue) > 1 or abs(tc - chroma) > 1:
        na, nb = tc * math.cos(math.radians(th)), tc * math.sin(math.radians(th))
        lab[..., 1] += (na - a) * 0.85
        lab[..., 2] += (nb - b) * 0.85
        rgb = from_lab(lab)
    return rgb


def deshine(rgb, lm, keep):
    h, w = rgb.shape[:2]
    lab = to_lab(rgb)
    L = lab[..., 0]
    eyes, brows, lips, nose = feature_masks(lm, (h, w))
    W = keep * (1 - eyes)
    L_loc = norm_conv(L, W, 0.012 * N)
    L_mid = norm_conv(L, W, 0.05 * N)
    H1 = smoothstep_np(3.0, 11.0, L - L_loc)
    H2 = smoothstep_np(4.0, 14.0, L - L_mid) * 0.7
    H = np.clip(np.maximum(H1, H2), 0, 1) * W
    H = gblur(H, 1.2)
    a_loc = norm_conv(lab[..., 1], W, 0.02 * N)
    b_loc = norm_conv(lab[..., 2], W, 0.02 * N)
    target = np.minimum(L, np.minimum(L_loc, L_mid) + 1.5)
    lab[..., 0] = L - H * (L - target) * 0.85
    lab[..., 1] += H * (a_loc - lab[..., 1]) * 0.6
    lab[..., 2] += H * (b_loc - lab[..., 2]) * 0.6
    return from_lab(lab)


def avg_skin(rgb, lm, keep=None):
    """Robust mean skin colour (linear) over the whole visible skin, features excluded."""
    lin = T.srgb_to_lin(rgb)
    h, w = rgb.shape[:2]
    oval = poly_mask(lm[FACE_OVAL], (h, w), -int(0.03 * N))
    eyes, brows, lips, nose = feature_masks(lm, (h, w))
    m = oval * (1 - np.clip(eyes + brows + lips + nose, 0, 1))
    if keep is not None:
        m = m * (keep > 0.9)
    px = lin[m > 0.5].reshape(-1, 3)
    Y = px @ np.float32([0.2126, 0.7152, 0.0722])
    lo, hi = np.percentile(Y, [20, 85])
    px = px[(Y >= lo) & (Y <= hi)]
    return px.mean(0)


def outer_feather(rgb, lm, avg_lin, seed=0, keep=None):
    """Low-frequency colour transfer: inside the face the photo is untouched; towards the oval
    edge its low-frequency colour converges to avg_lin while its micro detail fades out, so the
    texture ends in the flat average skin colour without any visible rim."""
    h, w = rgb.shape[:2]
    pts = lm[FACE_OVAL].copy()
    top = pts[:, 1] < lm[9][1]
    pts[top, 1] -= (lm[9][1] - pts[top, 1]) * 0.25 + 0.02 * N
    O = poly_mask(pts, (h, w), 0)
    din = cv2.distanceTransform((O > 0.5).astype(np.uint8), cv2.DIST_L2, 5).astype(np.float32)
    lin = T.srgb_to_lin(rgb)
    eyes, brows, lips, nose = feature_masks(lm, (h, w))
    Wc = (din > 0.02 * N).astype(np.float32) * (1 - np.clip(eyes + brows + lips, 0, 1))
    if keep is not None:
        Wc = Wc * np.clip(keep * 1.2, 0, 1) + 1e-4
    C_low = pull_push_fill(lin, Wc)
    C_low = gblur(C_low, 0.03 * N)
    D = np.clip(lin / np.maximum(C_low, 1e-4), 0.05, 4.0)
    m_col = smoothstep_np(0.0, 0.11 * N, din)[..., None]
    m_det = smoothstep_np(0.004 * N, 0.04 * N, din)[..., None]
    n = T.fbm(h, w, beta=1.2, seed=seed, hi=h / 3)[..., None]
    col = avg_lin[None, None, :] + (C_low - avg_lin[None, None, :]) * m_col
    det = 1 + (D - 1) * m_det
    out = col * det * (1 + 0.018 * n * (1 - m_det))
    return T.lin_to_srgb(out), m_det[..., 0]


def tint_mask(lm, shape, extra_zero=None):
    eyes = np.maximum(poly_mask(lm[EYE_R], shape, 1, 1.5), poly_mask(lm[EYE_L], shape, 1, 1.5))
    lips = poly_mask(lm[LIPS_OUT], shape, 0, 2.0)
    m = 1.0 - eyes
    m = m * (1 - 0.25 * lips)
    if extra_zero is not None:
        m = m * (1 - extra_zero)
    return np.clip(m, 0, 1)


def detail_map(rgb, avg_lin):
    lin = T.srgb_to_lin(rgb)
    d = np.clip(K_DETAIL * lin / avg_lin[None, None, :], 0, 1)
    return T.lin_to_srgb(d)


# ----------------------------------------------------------------------------- main
def build_one(entry, rec, src_dir_root, out_dir, dbg_dir=None):
    path = rec["path"]
    if not os.path.isabs(path):
        path = os.path.join(src_dir_root, path)
    bgr = cv2.imread(path, cv2.IMREAD_COLOR)
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    lm = np.float32(rec["lm"])
    if rgb.shape[0] != N:
        s = N / rgb.shape[0]
        rgb = cv2.resize(rgb, (N, N), interpolation=cv2.INTER_CUBIC)
        lm = lm * s
    al, lm2, aniso = align(rgb, lm)
    dbg = {} if dbg_dir else None
    exp = exposure_wb(al, lm2)
    nh, keep, _ = remove_hair(exp, lm2, dbg)
    rl = relight(nh, lm2, keep, dbg, flatten=entry.get("flatten", 0.55))
    ds = deshine(rl, lm2, keep)
    avg = avg_skin(ds, lm2, keep)
    base, faceA = outer_feather(ds, lm2, avg, seed=zlib.crc32(entry["id"].encode()) % 1000, keep=keep)
    results = {"base": (base, None)}
    for v in entry.get("variants", []):
        img_v, zero_v, lm_v = X.make_variant(v, base, lm2, avg, seed=len(v))
        # keep surround identical to the base so swaps never pop at the seam
        img_v = img_v * faceA[..., None] + base * (1 - faceA[..., None])
        results[v] = (img_v, (zero_v, lm_v))
    files = {}
    for key, (img, extra) in results.items():
        stem = entry["id"] if key == "base" else f"{entry['id']}_{key}"
        small = cv2.resize(img, (OUT, OUT), interpolation=cv2.INTER_AREA)
        T.save(os.path.join(out_dir, stem + ".jpg"), small, quality=90)
        det = cv2.resize(detail_map(img, avg), (OUT, OUT), interpolation=cv2.INTER_AREA)
        T.save(os.path.join(out_dir, stem + "_detail.jpg"), det, quality=90)
        if extra is None:
            tm = tint_mask(lm2, (N, N))
        else:
            tm = tint_mask(extra[1], (N, N), extra[0])
        tm = cv2.resize(tm, (256, 256), interpolation=cv2.INTER_AREA)
        T.save(os.path.join(out_dir, stem + "_mask.png"), tm)
        files[key] = stem
    if dbg_dir:
        os.makedirs(dbg_dir, exist_ok=True)
        for k, v in dbg.items():
            T.save(os.path.join(dbg_dir, f"{entry['id']}_{k}.jpg"), np.clip(v, 0, 1))
        T.save(os.path.join(dbg_dir, f"{entry['id']}_aligned.jpg"), al)
    # quality metrics on the final base
    lin = T.srgb_to_lin(base)
    Yv = lum(lin)
    iod = float(np.linalg.norm(lm2[263] - lm2[33]))
    lc = Yv[patch_mask(lm2, [50, 205], iod * 0.07, base.shape) > 0.5].mean()
    rc = Yv[patch_mask(lm2, [280, 425], iod * 0.07, base.shape) > 0.5].mean()
    avg_srgb = T.lin_to_srgb(avg)
    return {
        "files": files, "aniso": round(aniso, 3),
        "avgSkinRGB": [int(round(c * 255)) for c in avg_srgb],
        "avgSkinHex": T.rgb2hex(avg_srgb),
        "light_ratio_LR": round(float(lc / rc), 3),
        "chinY": round(float(lm2[152][1] / N), 3),
        "lm_out": (lm2 / N).round(4).tolist(),
    }


def main():
    analysis, selection, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]
    only = None
    dbg_dir = None
    args = sys.argv[4:]
    if "--only" in args:
        only = set(args[args.index("--only") + 1].split(","))
    if "--debug" in args:
        dbg_dir = args[args.index("--debug") + 1]
    with open(analysis) as f:
        A = json.load(f)
    with open(selection) as f:
        sel = json.load(f)
    root = os.path.dirname(os.path.dirname(os.path.abspath(analysis)))
    os.makedirs(out_dir, exist_ok=True)
    meta_path = os.path.join(out_dir, "_build_meta.json")
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    for e in sel:
        if only and e["id"] not in only:
            continue
        rec = A[e["src"]]
        r = build_one(e, rec, root, out_dir, dbg_dir)
        meta[e["id"]] = r
        print(e["id"], r["avgSkinHex"], "aniso", r["aniso"], "LR", r["light_ratio_LR"],
              "chin", r["chinY"])
    with open(meta_path, "w") as f:
        json.dump(meta, f)


if __name__ == "__main__":
    main()
