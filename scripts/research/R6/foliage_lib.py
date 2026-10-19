"""R6-pbr foliage toolkit: atlas sprite extraction, orientation normalisation, halo-free
compositing of leaf sprites (colour + OpenGL normals), edge bleeding and card export.

Conventions
- Sprites are stored "base at bottom, tip up" after normalisation.
- Normals: OpenGL tangent space (+X right, +Y up in the texture). When a sprite is rotated by
  `a` degrees counter-clockwise (PIL convention), its normal XY is rotated by the same angle.
- Canvas works in premultiplied colour.
"""
import json
import math
import os

import cv2
import numpy as np
from PIL import Image

import r6lib as L

FOL_OUT = os.path.join(L.ROOT, "public/assets/textures/foliage")


# ----------------------------------------------------------------------------- basics
def bleed(rgb, a, thr=0.5, blur=2.0):
    """Fill RGB under transparent pixels with the nearest opaque colour (no halos when mipmapped)."""
    rgb = rgb.astype(np.float32)
    holes = (a < thr).astype(np.uint8)
    if holes.sum() == 0 or holes.sum() == holes.size:
        return rgb
    dist, labels = cv2.distanceTransformWithLabels(holes, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    ys, xs = np.nonzero(holes == 0)
    idx = np.clip(labels - 1, 0, len(ys) - 1)
    filled = rgb[ys[idx], xs[idx]]
    out = np.where(holes[..., None] == 1, filled, rgb)
    if blur > 0:
        bl = cv2.GaussianBlur(out, (0, 0), blur)
        far = np.clip(dist / 6.0, 0, 1)[..., None] * holes[..., None]
        out = out * (1 - far) + bl * far
    return out


def decode_n(n8):
    n = n8.astype(np.float32) / 255.0 * 2 - 1
    return n


def encode_n(n):
    l = np.sqrt((n ** 2).sum(-1, keepdims=True)) + 1e-8
    return np.clip((n / l * 0.5 + 0.5) * 255 + 0.5, 0, 255).astype(np.uint8)


def rot_normals(n, deg):
    t = math.radians(deg)
    c, s = math.cos(t), math.sin(t)
    x, y = n[..., 0].copy(), n[..., 1].copy()
    n[..., 0] = x * c - y * s
    n[..., 1] = x * s + y * c
    return n


# ----------------------------------------------------------------------------- atlas loading
def load_atlas(key, res_key="2k"):
    """key 'ph:<model>' or 'acg:<AssetId>' -> rgb (H,W,3 u8), alpha (H,W f32 0..1), normal (H,W,3 u8)."""
    kind, aid = key.split(":", 1)
    if kind == "ph":
        d = os.path.join(L.RAW, f"phm_{aid}_{res_key}")
        files = {os.path.splitext(f)[0]: os.path.join(d, f) for f in os.listdir(d)}
        rgb = L.load_img(files["diff"], "RGB")
        a = L.load_img(files["alpha"], "L").astype(np.float32) / 255.0
        n = L.load_img(files["nor"], "RGB")
    else:
        p = L.fetch_acg(aid, "2K")
        rgb = L.load_img(p["Color"], "RGB")
        a = L.load_img(p["Opacity"], "L").astype(np.float32) / 255.0 if "Opacity" in p else np.ones(rgb.shape[:2], np.float32)
        n = L.load_img(p["NormalGL"], "RGB")
    H, W = rgb.shape[:2]
    if a.shape != (H, W):
        a = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).resize((W, H), Image.LANCZOS)).astype(np.float32) / 255
    if n.shape[:2] != (H, W):
        n = np.asarray(Image.fromarray(n).resize((W, H), Image.LANCZOS))
    return rgb, a, n


class Sprite:
    def __init__(self, rgb, a, n, src):
        self.rgb = rgb.astype(np.float32)   # bled, un-premultiplied
        self.a = a.astype(np.float32)
        self.n = n.astype(np.float32)       # decoded -1..1
        self.src = src

    @property
    def h(self):
        return self.a.shape[0]

    @property
    def w(self):
        return self.a.shape[1]

    def transformed(self, scale=1.0, angle=0.0, flip=False):
        """Return (rgb_premult, a, n) arrays after scale -> flip -> rotate(CCW deg), expanded canvas."""
        rgb, a, n = self.rgb, self.a, self.n
        if flip:
            rgb, a, n = rgb[:, ::-1], a[:, ::-1], n[:, ::-1].copy()
            n[..., 0] *= -1
        nw, nh = max(1, int(round(self.w * scale))), max(1, int(round(self.h * scale)))
        rs = cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC
        rgb = cv2.resize(np.ascontiguousarray(rgb), (nw, nh), interpolation=rs)
        a = np.clip(cv2.resize(np.ascontiguousarray(a), (nw, nh), interpolation=rs), 0, 1)
        n = cv2.resize(np.ascontiguousarray(n), (nw, nh), interpolation=rs)
        if abs(angle) > 1e-3:
            M = cv2.getRotationMatrix2D((nw / 2, nh / 2), angle, 1.0)  # CCW, same as PIL
            cos, sin = abs(M[0, 0]), abs(M[0, 1])
            bw, bh = int(nh * sin + nw * cos) + 2, int(nh * cos + nw * sin) + 2
            M[0, 2] += bw / 2 - nw / 2
            M[1, 2] += bh / 2 - nh / 2
            pm = rgb * a[..., None]
            pm = cv2.warpAffine(pm, M, (bw, bh), flags=cv2.INTER_LINEAR, borderValue=0)
            a = cv2.warpAffine(a, M, (bw, bh), flags=cv2.INTER_LINEAR, borderValue=0)
            n = cv2.warpAffine(n, M, (bw, bh), flags=cv2.INTER_LINEAR, borderValue=(0, 0, 1))
            n = rot_normals(n, angle)
            return pm, a, n
        return rgb * a[..., None], a, n


def extract_sprites(key, min_area=1500, base="bottom", pad=6, max_sprites=200, normalise=True, res_key="2k",
                    region=None):
    """Connected components of the atlas alpha -> list[Sprite] normalised base-down/tip-up.
    base: 'bottom'|'top'|'left'|'right'|'auto' (auto = thinner end is the base, e.g. a petiole).
    region: optional (x0,y0,x1,y1) fractions of the atlas to restrict the search."""
    rgb, a, n = load_atlas(key, res_key)
    H, W = a.shape
    rgbb = bleed(rgb, a)
    mask = (cv2.GaussianBlur(a, (0, 0), 1.0) > 0.35).astype(np.uint8)
    if region:
        x0, y0, x1, y1 = region
        sub = np.zeros_like(mask)
        sub[int(y0 * H):int(y1 * H), int(x0 * W):int(x1 * W)] = 1
        mask *= sub
    num, lab, stats, cent = cv2.connectedComponentsWithStats(mask, 8)
    out = []
    order = np.argsort(-stats[1:, cv2.CC_STAT_AREA]) + 1
    for i in order[:max_sprites]:
        x, y, w, h, area = stats[i]
        if area < min_area:
            continue
        x0, y0 = max(0, x - pad), max(0, y - pad)
        x1, y1 = min(W, x + w + pad), min(H, y + h + pad)
        comp = (lab[y0:y1, x0:x1] == i)
        comp = cv2.dilate(comp.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
        sa = a[y0:y1, x0:x1] * comp
        sp = Sprite(rgbb[y0:y1, x0:x1], sa, decode_n(n[y0:y1, x0:x1]), key)
        if normalise:
            sp = normalise_sprite(sp, base)
        out.append(sp)
    return out


def normalise_sprite(sp, base="bottom"):
    ys, xs = np.nonzero(sp.a > 0.5)
    if len(xs) < 10:
        return sp
    pts = np.stack([xs - xs.mean(), ys - ys.mean()], 1).astype(np.float32)
    cov = pts.T @ pts / len(pts)
    ev, evec = np.linalg.eigh(cov)
    axis = evec[:, np.argmax(ev)]          # image coords (x right, y down)
    proj = pts @ axis
    lo, hi = proj.min(), proj.max()
    end_lo = np.array([xs.mean(), ys.mean()]) + axis * lo
    end_hi = np.array([xs.mean(), ys.mean()]) + axis * hi
    if base == "bottom":
        base_is_lo = end_lo[1] > end_hi[1]
    elif base == "top":
        base_is_lo = end_lo[1] < end_hi[1]
    elif base == "left":
        base_is_lo = end_lo[0] < end_hi[0]
    elif base == "right":
        base_is_lo = end_lo[0] > end_hi[0]
    else:  # auto: thinner end = base
        perp = pts @ np.array([-axis[1], axis[0]])
        L_ = hi - lo
        near_lo = proj < lo + 0.12 * L_
        near_hi = proj > hi - 0.12 * L_
        w_lo = np.ptp(perp[near_lo]) if near_lo.any() else 0
        w_hi = np.ptp(perp[near_hi]) if near_hi.any() else 0
        base_is_lo = w_lo < w_hi
    b = end_lo if base_is_lo else end_hi
    t = end_hi if base_is_lo else end_lo
    v = t - b                                   # base -> tip, image coords
    ang_img = math.degrees(math.atan2(-v[1], v[0]))  # visual angle, CCW from +x
    rot = 90.0 - ang_img                        # rotate CCW so tip points up
    pm, a, n = sp.transformed(1.0, rot, False)
    rgb = np.where(a[..., None] > 1e-4, pm / np.maximum(a[..., None], 1e-4), 0)
    # crop to content
    ys2, xs2 = np.nonzero(a > 0.02)
    y0, y1, x0, x1 = ys2.min(), ys2.max() + 1, xs2.min(), xs2.max() + 1
    a = a[y0:y1, x0:x1]
    rgb = bleed(rgb[y0:y1, x0:x1], a)
    return Sprite(rgb, a, n[y0:y1, x0:x1], sp.src)


# ----------------------------------------------------------------------------- canvas
class Canvas:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.c = np.zeros((h, w, 3), np.float32)   # premultiplied colour
        self.a = np.zeros((h, w), np.float32)
        self.n = np.zeros((h, w, 3), np.float32)
        self.n[..., 2] = 1.0

    def stamp(self, sp, x, y, scale=1.0, angle=0.0, flip=False, tint=(1, 1, 1), shade=1.0, tilt=(0.0, 0.0),
              anchor="base", alpha_mul=1.0):
        """Place sprite so its anchor ('base' = bottom-centre, 'center') lands at canvas (x, y).
        angle: CCW degrees (0 = tip up). tilt: constant normal XY offset (fake leaf orientation)."""
        # anchor in sprite space before rotation
        sw, sh = sp.w * scale, sp.h * scale
        ax, ay = (sw / 2, sh) if anchor == "base" else (sw / 2, sh / 2)
        pm, a, n = sp.transformed(scale, angle, flip)
        bh, bw = a.shape
        # rotate anchor offset about sprite centre
        t = math.radians(angle)
        dx, dy = ax - sw / 2, ay - sh / 2
        rx = dx * math.cos(t) + dy * math.sin(t)
        ry = -dx * math.sin(t) + dy * math.cos(t)
        ox = int(round(x - (bw / 2 + rx)))
        oy = int(round(y - (bh / 2 + ry)))
        x0, y0 = max(0, ox), max(0, oy)
        x1, y1 = min(self.w, ox + bw), min(self.h, oy + bh)
        if x1 <= x0 or y1 <= y0:
            return
        sx0, sy0 = x0 - ox, y0 - oy
        sa = a[sy0:sy0 + (y1 - y0), sx0:sx0 + (x1 - x0)] * alpha_mul
        sc = pm[sy0:sy0 + (y1 - y0), sx0:sx0 + (x1 - x0)] * np.array(tint, np.float32) * shade * alpha_mul
        sn = n[sy0:sy0 + (y1 - y0), sx0:sx0 + (x1 - x0)].copy()
        if tilt != (0.0, 0.0):
            sn[..., 0] += tilt[0]
            sn[..., 1] += tilt[1]
        da = self.a[y0:y1, x0:x1]
        self.c[y0:y1, x0:x1] = sc + self.c[y0:y1, x0:x1] * (1 - sa[..., None])
        self.n[y0:y1, x0:x1] = sn * sa[..., None] + self.n[y0:y1, x0:x1] * (1 - sa[..., None])
        self.a[y0:y1, x0:x1] = sa + da * (1 - sa)

    def dome(self, strength=0.35, blur_frac=0.08):
        """Bend normals outward following the silhouette (fake volume for clumps / canopies)."""
        m = (self.a > 0.3).astype(np.float32)
        d = cv2.distanceTransform((m * 255).astype(np.uint8), cv2.DIST_L2, 5)
        d = cv2.GaussianBlur(d, (0, 0), max(1, self.w * blur_frac))
        gx = cv2.Sobel(d, cv2.CV_32F, 1, 0, ksize=5)
        gy = cv2.Sobel(d, cv2.CV_32F, 0, 1, ksize=5)
        mag = np.sqrt(gx ** 2 + gy ** 2) + 1e-6
        nx, ny = -gx / mag, gy / mag   # outward (away from the interior), GL +Y up
        fall = np.clip(1.0 - d / (d.max() + 1e-6), 0, 1) ** 1.5
        self.n[..., 0] += nx * strength * fall
        self.n[..., 1] += ny * strength * fall

    def result(self, out_w=None, out_h=None):
        a = self.a.copy()
        c = self.c.copy()
        n = self.n.copy()
        if out_w and (out_w != self.w or out_h != self.h):
            c = cv2.resize(c, (out_w, out_h), interpolation=cv2.INTER_AREA)
            a = cv2.resize(a, (out_w, out_h), interpolation=cv2.INTER_AREA)
            n = cv2.resize(n, (out_w, out_h), interpolation=cv2.INTER_AREA)
        rgb = np.where(a[..., None] > 1e-4, c / np.maximum(a[..., None], 1e-4), 0)
        rgb = bleed(np.clip(rgb, 0, 255), a)
        n = n / (np.sqrt((n ** 2).sum(-1, keepdims=True)) + 1e-8)
        # normals under transparency: flat, softly blended at the edge (for mip safety)
        flat = np.zeros_like(n)
        flat[..., 2] = 1
        k = np.clip(a * 2.5, 0, 1)[..., None]
        n = n * k + flat * (1 - k)
        return rgb, a, n


def save_card(cid, rgb, a, n, meta, manifest):
    d = os.path.join(FOL_OUT, cid)
    os.makedirs(d, exist_ok=True)
    rgba = np.dstack([np.clip(rgb, 0, 255), np.clip(a * 255, 0, 255)]).astype(np.uint8)
    Image.fromarray(rgba, "RGBA").save(os.path.join(d, "albedo.png"), optimize=True, compress_level=9)
    L.save_jpg(encode_n(n), os.path.join(d, "normal.jpg"), 88, 0)
    e = dict(albedo=f"{cid}/albedo.png", normal=f"{cid}/normal.jpg", pixelSize=[int(a.shape[1]), int(a.shape[0])])
    e.update(meta)
    manifest[cid] = e
    return e


def load_manifest():
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "foliage_manifest_build.json")
    return json.load(open(p)) if os.path.exists(p) else {}


def store_manifest(man):
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "foliage_manifest_build.json")
    json.dump(man, open(p, "w"), indent=1, ensure_ascii=False)
