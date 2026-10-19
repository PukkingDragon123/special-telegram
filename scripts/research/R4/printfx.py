"""printfx — shared "real printed paper" toolkit for the R4 2D UI kits (newspaper, magazine,
recipe book, posters, title art).

Everything here is procedural / own creation. Photos are only *read* (passed in as PIL images).

Main ideas
- Paper is a float RGB array in 0..1 (grain, fibres, mottling, yellowing, folds, stains).
- Printing goes through a `Press`: four ink plates (C, M, Y, K). Line art (text, rules, solid
  boxes) goes to the *solid* plates; photos / tints go to the *contone* plates which are AM
  halftoned at composite time (C15 M75 Y0 K45). Plates are misregistered, ink-spread, unevenly
  inked and multiplied onto the paper like real ink.
- Handwriting renders per Thai grapheme cluster with jitter (size / rotation / baseline / ink).
"""
from __future__ import annotations

import math
import os
import re
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage as ndi

FONT_DIR = "/home/user/special-telegram/scripts/_cache/fonts/"
f32 = np.float32


# ----------------------------------------------------------------------------------- fonts
# Client rule: LOOPED Thai fonts only (ไทยมีหัว). Loopless families are refused here on purpose.
LOOPLESS = ("Kanit", "Mitr", "Prompt", "ChakraPetch", "BaiJamjuree", "Athiti", "K2D")


@lru_cache(maxsize=512)
def F(name: str, size: int) -> ImageFont.FreeTypeFont:
    """Font loader. Variable fonts: 'NotoSansThaiLooped@900' (weight) or 'NotoSansThaiLooped@900w70' (+width)."""
    var = None
    if "@" in name:
        name, v = name.split("@", 1)
        if "w" in v:
            wg, wd = v.split("w")
            var = [float(wg), float(wd)]
        else:
            var = [float(v), 100.0]
    if any(name.startswith(b) for b in LOOPLESS):
        raise ValueError(f"loopless Thai font {name} is not allowed (client rule: looped fonts only)")
    fn = name if name.endswith(".ttf") else name + ".ttf"
    f = ImageFont.truetype(os.path.join(FONT_DIR, fn), int(size), layout_engine=ImageFont.Layout.RAQM)
    if var is not None:
        f.set_variation_by_axes(var)
    return f


def text_size(text, font, stroke=0):
    l, t, r, b = font.getbbox(text, stroke_width=stroke)
    return r - l, b - t, l, t


# ----------------------------------------------------------------------------------- noise
def spectral_noise(h, w, beta=1.0, seed=0, fmin=0.0, fmax=0.5):
    """Tileable 1/f^beta noise normalised to ~0..1."""
    rng = np.random.default_rng(seed)
    n = rng.standard_normal((h, w)).astype(f32)
    Fq = np.fft.rfft2(n)
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.rfftfreq(w)[None, :]
    f = np.sqrt(fx * fx + fy * fy)
    f[0, 0] = 1.0
    filt = 1.0 / np.power(f, beta)
    filt[(f < fmin) | (f > fmax)] = 0
    filt[0, 0] = 0
    out = np.fft.irfft2(Fq * filt, s=(h, w)).astype(f32)
    lo, hi = np.percentile(out, 0.5), np.percentile(out, 99.5)
    return np.clip((out - lo) / (hi - lo + 1e-9), 0, 1).astype(f32)


def fbm(h, w, scale=64.0, octaves=5, seed=0, persistence=0.5):
    """Fast value-noise fBm (not tileable) in 0..1. scale = size of the largest feature in px."""
    rng = np.random.default_rng(seed)
    acc = np.zeros((h, w), f32)
    amp, tot = 1.0, 0.0
    cell = float(scale)
    for _ in range(octaves):
        gh, gw = int(h / cell) + 3, int(w / cell) + 3
        g = rng.random((gh, gw)).astype(f32)
        im = Image.fromarray(g, "F").resize((max(2, int(gw * cell)), max(2, int(gh * cell))), Image.BICUBIC)
        a = np.asarray(im, f32)
        oy, ox = rng.integers(0, max(1, a.shape[0] - h)), rng.integers(0, max(1, a.shape[1] - w))
        acc += amp * a[oy:oy + h, ox:ox + w]
        tot += amp
        amp *= persistence
        cell = max(1.0, cell / 2)
    acc /= tot
    lo, hi = np.percentile(acc, 1), np.percentile(acc, 99)
    return np.clip((acc - lo) / (hi - lo + 1e-9), 0, 1).astype(f32)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0 + 1e-9), 0, 1)
    return t * t * (3 - 2 * t)


# ----------------------------------------------------------------------------------- conversions
def to_arr(im: Image.Image) -> np.ndarray:
    return np.asarray(im.convert("RGB"), f32) / 255.0


def to_img(a: np.ndarray) -> Image.Image:
    return Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))


def gray_of(a):
    return (a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114).astype(f32)


def blur(a, s):
    if s <= 0:
        return a
    if a.ndim == 3:
        return np.stack([ndi.gaussian_filter(a[..., i], s) for i in range(a.shape[2])], -1).astype(f32)
    return ndi.gaussian_filter(a, s).astype(f32)


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


# ----------------------------------------------------------------------------------- papers
def _fibres(h, w, n, seed, length=(6, 30), alpha=(0.04, 0.12), dark_ratio=0.5, width=1, tile=False):
    """Layer (h,w) in -1..1 of short curved paper fibres (light and dark)."""
    rng = np.random.default_rng(seed)
    lay = Image.new("F", (w, h), 0.0)
    d = ImageDraw.Draw(lay)
    for _ in range(n):
        x, y = rng.random() * w, rng.random() * h
        ang = rng.random() * math.pi
        L = rng.uniform(*length)
        bend = rng.normal(0, 0.6)
        pts = []
        for t in np.linspace(0, 1, 6):
            a = ang + bend * (t - 0.5)
            pts.append((x + math.cos(a) * L * (t - 0.5), y + math.sin(a) * L * (t - 0.5)))
        v = rng.uniform(*alpha) * (-1 if rng.random() < dark_ratio else 1)
        offs = [(0, 0)]
        if tile:
            offs = [(dx, dy) for dx in (-w, 0, w) for dy in (-h, 0, h)]
        for dx, dy in offs:
            d.line([(px + dx, py + dy) for px, py in pts], fill=v, width=width)
    return np.asarray(lay, f32)


def newsprint(h, w, seed=1, tileable=False, tone="#E4DFD0", yellow_edges=0.0):
    """Newsprint paper: grey-cream, coarse grain, fibres, mottling. Returns float RGB."""
    base = np.array(hexrgb(tone), f32)
    if tileable:
        mott = spectral_noise(h, w, beta=1.6, seed=seed, fmax=0.02)
        grain = spectral_noise(h, w, beta=0.3, seed=seed + 1)
        mid = spectral_noise(h, w, beta=1.0, seed=seed + 2, fmin=0.01, fmax=0.12)
    else:
        mott = fbm(h, w, scale=max(h, w) / 5, octaves=4, seed=seed)
        grain = np.random.default_rng(seed + 1).random((h, w)).astype(f32)
        grain = 0.6 * grain + 0.4 * blur(grain, 0.8) / max(1e-6, blur(grain, 0.8).max())
        mid = fbm(h, w, scale=40, octaves=3, seed=seed + 2)
    fib = _fibres(h, w, int(h * w / 900), seed + 3, tile=tileable)
    L = 1.0 + (mott - 0.5) * 0.06 + (mid - 0.5) * 0.035 + (grain - 0.5) * 0.06 + fib * 0.6
    out = base[None, None, :] * L[..., None]
    # faint chroma speckle (recycled-paper flecks)
    rng = np.random.default_rng(seed + 4)
    fleck = (rng.random((h, w)) > 0.9993).astype(f32)
    fleck = blur(fleck, 0.7) * 3
    out *= (1 - 0.35 * fleck[..., None] * np.array([0.6, 0.7, 0.9], f32))
    if yellow_edges > 0:
        yy, xx = np.mgrid[0:h, 0:w].astype(f32)
        dx = np.minimum(xx, w - 1 - xx) / w
        dy = np.minimum(yy, h - 1 - yy) / h
        de = np.minimum(dx, dy)
        yel = np.clip(1 - de / 0.08, 0, 1) ** 2 * yellow_edges
        yel *= 0.6 + 0.8 * fbm(h, w, scale=120, octaves=3, seed=seed + 5)
        out = out * (1 - yel[..., None] * np.array([0.02, 0.07, 0.20], f32))
    return np.clip(out, 0, 1).astype(f32)


def edge_yellow(h, w, seed=0, amount=1.0, width=0.08):
    """RGB multiplier: aged/yellowed paper towards the edges (blotchy)."""
    yy, xx = np.mgrid[0:h, 0:w].astype(f32)
    de = np.minimum(np.minimum(xx, w - 1 - xx) / w, np.minimum(yy, h - 1 - yy) / h)
    yel = np.clip(1 - de / width, 0, 1) ** 2 * amount
    yel *= 0.6 + 0.8 * fbm(h, w, scale=120, octaves=3, seed=seed + 5)
    return (1 - yel[..., None] * np.array([0.02, 0.07, 0.20], f32)).astype(f32)


def glossy_paper(h, w, seed=2, tone="#F6F5F1", tileable=True):
    base = np.array(hexrgb(tone), f32)
    g = spectral_noise(h, w, beta=0.8, seed=seed) if tileable else fbm(h, w, 20, 4, seed)
    m = spectral_noise(h, w, beta=1.8, seed=seed + 1, fmax=0.03) if tileable else fbm(h, w, h / 4, 3, seed + 1)
    L = 1 + (g - 0.5) * 0.012 + (m - 0.5) * 0.015
    return np.clip(base[None, None] * L[..., None], 0, 1).astype(f32)


def notebook_paper(h, w, seed=3, tone="#F3EEDD"):
    base = np.array(hexrgb(tone), f32)
    m = fbm(h, w, scale=h / 4, octaves=4, seed=seed)
    g = np.random.default_rng(seed).random((h, w)).astype(f32)
    fib = _fibres(h, w, int(h * w / 2500), seed + 1, alpha=(0.02, 0.06))
    L = 1 + (m - 0.5) * 0.05 + (g - 0.5) * 0.03 + fib * 0.5
    return np.clip(base[None, None] * L[..., None], 0, 1).astype(f32)


def cardboard(h, w, seed=4, tone="#B88A57", flutes=True):
    rng = np.random.default_rng(seed)
    base = np.array(hexrgb(tone), f32)
    m = fbm(h, w, scale=max(h, w) / 3, octaves=5, seed=seed)
    g = rng.random((h, w)).astype(f32)
    fib = _fibres(h, w, int(h * w / 250), seed + 1, length=(4, 18), alpha=(0.05, 0.16), dark_ratio=0.55)
    L = 1 + (m - 0.5) * 0.16 + (g - 0.5) * 0.06 + fib * 0.7
    if flutes:  # corrugation showing through the liner (vertical waves)
        xx = np.arange(w, dtype=f32)[None, :]
        per = rng.uniform(15, 19)
        wob = fbm(h, w, scale=300, octaves=2, seed=seed + 2) * 6
        L = L + 0.025 * np.sin((xx + wob) / per * 2 * math.pi)
    out = base[None, None] * L[..., None]
    # random darker kraft blotches
    bl = smoothstep(0.62, 0.9, fbm(h, w, scale=180, octaves=4, seed=seed + 3))
    out *= (1 - 0.12 * bl[..., None])
    return np.clip(out, 0, 1).astype(f32)


def chalkboard(h, w, seed=5, tone="#26302B"):
    base = np.array(hexrgb(tone), f32)
    m = fbm(h, w, scale=max(h, w) / 2.5, octaves=5, seed=seed)
    g = np.random.default_rng(seed).random((h, w)).astype(f32)
    out = base[None, None] * (1 + (m - 0.5) * 0.25 + (g - 0.5) * 0.10)[..., None]
    # old erased chalk smears (wide, low alpha, horizontal swipes)
    rng = np.random.default_rng(seed + 1)
    sm = Image.new("F", (w, h), 0)
    d = ImageDraw.Draw(sm)
    for _ in range(60):
        x, y = rng.random() * w, rng.random() * h
        L, th = rng.uniform(80, 400), rng.uniform(20, 70)
        a = rng.normal(0, 0.25)
        d.line([(x - L / 2 * math.cos(a), y - L / 2 * math.sin(a)), (x + L / 2 * math.cos(a), y + L / 2 * math.sin(a))],
               fill=rng.uniform(0.02, 0.08), width=int(th))
    sm = blur(np.asarray(sm, f32), 18) * (0.6 + 0.8 * fbm(h, w, 60, 4, seed + 2))
    out = out + sm[..., None] * np.array([0.85, 0.88, 0.85], f32)
    return np.clip(out, 0, 1).astype(f32)


# ----------------------------------------------------------------------------------- halftone
@lru_cache(maxsize=8)
def _spot_cdf(res=256):
    """Euclidean (round→square→inverted round) spot function equalised to a uniform threshold."""
    u = (np.arange(res) + 0.5) / res - 0.5
    fu, fv = np.meshgrid(u, u)
    au, av = np.abs(fu), np.abs(fv)
    s = np.where(au + av <= 0.5, (fu * fu + fv * fv), 0.5 - ((0.5 - au) ** 2 + (0.5 - av) ** 2))
    flat = np.sort(s.ravel())
    return flat


def halftone(cov, cell=4.0, angle=45.0, rough=0.0, seed=0, aa=0.9):
    """cov: 0..1 ink coverage (contone) -> 0..1 halftoned coverage (AM dots)."""
    h, w = cov.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(f32)
    a = math.radians(angle)
    u = (xx * math.cos(a) + yy * math.sin(a)) / cell
    v = (-xx * math.sin(a) + yy * math.cos(a)) / cell
    fu = u - np.floor(u) - 0.5
    fv = v - np.floor(v) - 0.5
    au, av = np.abs(fu), np.abs(fv)
    s = np.where(au + av <= 0.5, fu * fu + fv * fv, 0.5 - ((0.5 - au) ** 2 + (0.5 - av) ** 2)).astype(f32)
    flat = _spot_cdf()
    T = (np.searchsorted(flat, s.ravel()).reshape(h, w) / flat.size).astype(f32)
    if rough > 0:
        T = T + (np.random.default_rng(seed).random((h, w)).astype(f32) - 0.5) * rough
    e = aa / cell  # antialias width in threshold units
    T = e + T * (1 - 2 * e)  # keep 0 coverage = no ink, 1 = solid
    out = smoothstep(-e, e, cov - T)
    out[cov <= 0.002] = 0
    return out.astype(f32)


def rgb_to_cmyk(a, gcr=0.75):
    """float RGB 0..1 -> (4,h,w) coverage with grey component replacement."""
    c, m, y = 1 - a[..., 0], 1 - a[..., 1], 1 - a[..., 2]
    k = np.minimum(np.minimum(c, m), y) * gcr
    d = 1 - k + 1e-6
    return np.stack([(c - k) / d * (1 - k * 0.0), (m - k) / d, (y - k) / d, k]).clip(0, 1).astype(f32)


# Ink filter colours (colour of a 100 % ink film on white) for newsprint and coated stock.
INKS_NEWS = np.array([[0.13, 0.60, 0.84], [0.86, 0.17, 0.50], [0.97, 0.89, 0.16], [0.17, 0.16, 0.16]], f32)
INKS_GLOSS = np.array([[0.00, 0.62, 0.89], [0.90, 0.05, 0.50], [1.00, 0.92, 0.00], [0.08, 0.07, 0.08]], f32)

CMYK = {
    "K": (0, 0, 0, 1), "red": (0, 1, 1, 0), "deepred": (0.05, 1, 0.95, 0.12), "blue": (1, 0.72, 0, 0.05),
    "navy": (1, 0.85, 0.1, 0.35), "cyan": (1, 0, 0, 0), "green": (0.85, 0, 1, 0.05), "yellow": (0, 0.05, 1, 0),
    "orange": (0, 0.55, 1, 0), "magenta": (0, 1, 0, 0), "white": None, "grey": (0, 0, 0, 0.45),
    "richblack": (0.4, 0.3, 0.3, 1), "lightyellow": (0, 0.03, 0.35, 0), "lightblue": (0.25, 0.05, 0, 0),
    "pink": (0, 0.45, 0.08, 0), "gold": (0.05, 0.28, 0.95, 0.05),
}


class Press:
    """Four-plate printing simulator."""

    def __init__(self, w, h, seed=0):
        self.w, self.h, self.seed = w, h, seed
        self.solid = np.zeros((4, h, w), f32)
        self.cont = np.zeros((4, h, w), f32)

    # -- primitive: apply a mask with a CMYK spec
    def _apply(self, mask, cmyk, x0=0, y0=0, contone=False, overprint=False):
        mh, mw = mask.shape
        X0, Y0 = max(0, x0), max(0, y0)
        X1, Y1 = min(self.w, x0 + mw), min(self.h, y0 + mh)
        if X1 <= X0 or Y1 <= Y0:
            return
        m = mask[Y0 - y0:Y1 - y0, X0 - x0:X1 - x0]
        if cmyk is None or cmyk == "white":  # knockout
            for P in (self.solid, self.cont):
                P[:, Y0:Y1, X0:X1] *= (1 - m)[None]
            return
        if isinstance(cmyk, str):
            cmyk = CMYK[cmyk]
        for i, amt in enumerate(cmyk):
            tgt = self.cont if (contone or 0 < amt < 0.999) else self.solid
            other = self.solid if tgt is self.cont else self.cont
            if overprint:
                if amt > 0:
                    tgt[i, Y0:Y1, X0:X1] = 1 - (1 - tgt[i, Y0:Y1, X0:X1]) * (1 - m * amt)
            else:
                tgt[i, Y0:Y1, X0:X1] = tgt[i, Y0:Y1, X0:X1] * (1 - m) + m * amt
                other[i, Y0:Y1, X0:X1] *= (1 - m)

    def text_mask(self, text, font, stroke=0, scale_x=1.0, scale_y=1.0, tracking=0):
        """Mask in a consistent metric frame: (pad, pad) = left/ascender origin.
        Returns (mask, info) where info has pad, asc, desc, ink bbox (l,t,r,b) and advance (unscaled)."""
        asc, desc = font.getmetrics()
        pad = 4 + stroke + int(font.size * 0.08)
        if tracking:
            cl = thai_clusters(text)
            widths = [font.getlength(c) for c in cl]
            adv = sum(widths) + tracking * (len(cl) - 1)
        else:
            adv = font.getlength(text)
        l, t, r, b = font.getbbox(text, anchor="la", stroke_width=stroke)
        W = int(max(adv, r) + 2 * pad + stroke * 2)
        H = int(max(asc + desc, b) + 2 * pad)
        im = Image.new("L", (max(1, W), max(1, H)), 0)
        d = ImageDraw.Draw(im)
        if tracking:
            x = pad
            for c, cw in zip(cl, widths):
                d.text((x, pad), c, font=font, fill=255, anchor="la", stroke_width=stroke, stroke_fill=255)
                x += cw + tracking
            l, r = 0, adv
        else:
            d.text((pad, pad), text, font=font, fill=255, anchor="la", stroke_width=stroke, stroke_fill=255)
        if scale_x != 1.0 or scale_y != 1.0:
            im = im.resize((max(1, int(round(im.width * scale_x))), max(1, int(round(im.height * scale_y)))), Image.LANCZOS)
        info = dict(pad=pad, asc=asc, desc=desc, bbox=(l, t, r, b), adv=adv, sx=scale_x, sy=scale_y)
        return np.asarray(im, f32) / 255.0, info

    def place(self, xy, info, anchor="ls"):
        """Top-left of the mask for an anchor. x: l/m/r on the advance width; y: a(ascender) s(baseline)
        t/m/b on the ink bbox."""
        sx, sy = info["sx"], info["sy"]
        x, y = xy
        adv = info["adv"] * sx
        l, t, r, b = info["bbox"]
        if anchor[0] == "m":
            x -= adv / 2
        elif anchor[0] == "r":
            x -= adv
        ay = anchor[1]
        if ay == "s":
            top = y - info["asc"] * sy
        elif ay == "a":
            top = y
        elif ay == "t":
            top = y - t * sy
        elif ay == "b":
            top = y - b * sy
        else:  # 'm' ink middle
            top = y - (t + b) / 2 * sy
        return int(round(x - info["pad"] * sx)), int(round(top - info["pad"] * sy))

    def text(self, xy, text, font, cmyk="K", anchor="ls", stroke=0, scale_x=1.0, scale_y=1.0, tracking=0,
             overprint=False, contone=False, max_w=None):
        if max_w is not None:
            tw = self.measure(text, font, stroke, 1.0, tracking)[0]
            if tw * scale_x > max_w:
                scale_x = max_w / tw
        m, info = self.text_mask(text, font, stroke, scale_x, scale_y, tracking)
        x0, y0 = self.place(xy, info, anchor)
        self._apply(m, cmyk, x0, y0, contone=contone, overprint=overprint)
        l, t, r, b = info["bbox"]
        return info["adv"] * scale_x, (b - t) * scale_y

    def measure(self, text, font, stroke=0, scale_x=1.0, tracking=0):
        """(advance width * scale_x, ink height)"""
        if tracking:
            cl = thai_clusters(text)
            w = sum(font.getlength(c) for c in cl) + tracking * (len(cl) - 1)
        else:
            w = font.getlength(text)
        l, t, r, b = font.getbbox(text, anchor="la", stroke_width=stroke)
        return w * scale_x, b - t

    def rect(self, box, cmyk, contone=False, overprint=False, radius=0):
        x0, y0, x1, y1 = [int(round(v)) for v in box]
        if radius:
            im = Image.new("L", (x1 - x0, y1 - y0), 0)
            ImageDraw.Draw(im).rounded_rectangle((0, 0, x1 - x0 - 1, y1 - y0 - 1), radius=radius, fill=255)
            m = np.asarray(im, f32) / 255
        else:
            m = np.ones((y1 - y0, x1 - x0), f32)
        self._apply(m, cmyk, x0, y0, contone=contone, overprint=overprint)

    def mask(self, mask, xy, cmyk, contone=False, overprint=False):
        self._apply(mask.astype(f32), cmyk, int(xy[0]), int(xy[1]), contone=contone, overprint=overprint)

    def line(self, p0, p1, width, cmyk="K"):
        x0, y0 = min(p0[0], p1[0]) - width, min(p0[1], p1[1]) - width
        x1, y1 = max(p0[0], p1[0]) + width, max(p0[1], p1[1]) + width
        im = Image.new("L", (int(x1 - x0) + 2, int(y1 - y0) + 2), 0)
        ImageDraw.Draw(im).line([(p0[0] - x0, p0[1] - y0), (p1[0] - x0, p1[1] - y0)], fill=255, width=int(width))
        self._apply(np.asarray(im, f32) / 255, cmyk, int(x0), int(y0))

    def image(self, box, img: Image.Image, mode="cmyk", contrast=1.0, bright=0.0, gcr=0.8, fit="cover", focus=(0.5, 0.5)):
        """Place a photo (contone, will be halftoned). mode 'cmyk' or 'k' (greyscale)."""
        x0, y0, x1, y1 = [int(round(v)) for v in box]
        bw, bh = x1 - x0, y1 - y0
        im = fit_image(img, bw, bh, fit, focus)
        a = to_arr(im)
        a = np.clip((a - 0.5) * contrast + 0.5 + bright, 0, 1)
        if mode == "k":
            g = gray_of(a)
            cov = np.stack([np.zeros_like(g)] * 3 + [1 - g])
        else:
            cov = rgb_to_cmyk(a, gcr)
        sub = self.cont[:, y0:y1, x0:x1]
        hh, ww = sub.shape[1:]
        self.cont[:, y0:y1, x0:x1] = cov[:, :hh, :ww]
        self.solid[:, y0:y1, x0:x1] = 0

    def composite(self, paper, inks=INKS_NEWS, cell=4.0, misreg=((1.2, -0.6), (-0.9, 0.8), (0.5, 1.1), (0, 0)),
                  spread=0.55, density=(0.86, 1.0), voids=0.0, rough=0.08, angles=(15, 75, 0, 45), seed=None,
                  gain=0.12, max_k=0.94, return_cov=False):
        seed = self.seed if seed is None else seed
        h, w = self.h, self.w
        out = paper.copy()
        covs = []
        dens = fbm(h, w, scale=max(h, w) / 6, octaves=5, seed=seed + 11)
        for i in range(4):
            c = self.cont[i]
            if c.max() > 0.003:
                cg = np.clip(c + gain * c * (1 - c) * 4 * 0.5, 0, 1)
                ht = halftone(cg, cell=cell, angle=angles[i], rough=rough, seed=seed + i)
            else:
                ht = np.zeros_like(c)
            cov = 1 - (1 - self.solid[i]) * (1 - ht)
            dx, dy = misreg[i]
            if dx or dy:
                cov = ndi.shift(cov, (dy, dx), order=1, mode="constant")
            if spread > 0:
                cb = ndi.gaussian_filter(cov, spread)
                cov = np.clip(cb * 1.12, 0, 1)
            d = density[0] + (density[1] - density[0]) * dens
            if voids > 0:
                vr = np.random.default_rng(seed + 20 + i).random((h, w)).astype(f32)
                vv = ndi.gaussian_filter((vr > 1 - voids).astype(f32), 0.8) * 2.5
                d = d * (1 - np.clip(vv, 0, 0.8))
            cov = cov * d
            if i == 3:
                cov = cov * max_k
            covs.append(cov)
            out = out * (1 - cov[..., None] * (1 - inks[i][None, None]))
        if return_cov:
            return out, covs
        return out


# ----------------------------------------------------------------------------------- image helpers
def fit_image(img, bw, bh, fit="cover", focus=(0.5, 0.5)):
    iw, ih = img.size
    if fit == "cover":
        s = max(bw / iw, bh / ih)
    else:
        s = min(bw / iw, bh / ih)
    nw, nh = max(1, int(round(iw * s))), max(1, int(round(ih * s)))
    im = img.convert("RGB").resize((nw, nh), Image.LANCZOS)
    if fit == "cover":
        ox = int((nw - bw) * focus[0])
        oy = int((nh - bh) * focus[1])
        im = im.crop((ox, oy, ox + bw, oy + bh))
    else:
        canvas = Image.new("RGB", (bw, bh), (255, 255, 255))
        canvas.paste(im, ((bw - nw) // 2, (bh - nh) // 2))
        im = canvas
    return im


def paste_rgba(base_arr, rgba: Image.Image, xy, opacity=1.0, mode="normal"):
    """Composite an RGBA PIL image onto a float RGB array (in place) with normal or multiply blend."""
    x, y = int(xy[0]), int(xy[1])
    a = np.asarray(rgba.convert("RGBA"), f32) / 255.0
    h, w = a.shape[:2]
    H, W = base_arr.shape[:2]
    X0, Y0, X1, Y1 = max(0, x), max(0, y), min(W, x + w), min(H, y + h)
    if X1 <= X0 or Y1 <= Y0:
        return base_arr
    src = a[Y0 - y:Y1 - y, X0 - x:X1 - x]
    al = src[..., 3:4] * opacity
    dst = base_arr[Y0:Y1, X0:X1]
    if mode == "multiply":
        res = dst * (1 - al) + dst * src[..., :3] * al
    elif mode == "screen":
        res = dst * (1 - al) + (1 - (1 - dst) * (1 - src[..., :3])) * al
    else:
        res = dst * (1 - al) + src[..., :3] * al
    base_arr[Y0:Y1, X0:X1] = res
    return base_arr


# ----------------------------------------------------------------------------------- wear & stains
def coffee_ring(h, w, cx, cy, r, seed=0, strength=1.0, color="#7A4A22"):
    """Returns (alpha, rgb) — a coffee mug ring with darker rim + faint fill + drip."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(f32)
    ang = np.arctan2(yy - cy, xx - cx)
    wob = 1 + 0.03 * np.sin(ang * 3 + rng.random() * 6) + 0.02 * np.sin(ang * 7 + rng.random() * 6)
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / (r * wob)
    n = fbm(h, w, scale=r / 2, octaves=4, seed=seed)
    rim = np.exp(-((d - 1) / 0.035) ** 2) * (0.55 + 0.6 * n)
    gap = (rng.random() * 2 * math.pi)
    rim *= np.clip(0.35 + 0.65 * (0.5 + 0.5 * np.cos(ang - gap)) ** 0.5, 0, 1)
    fill = np.clip(1 - d, 0, 1) ** 0.3 * (d < 1) * 0.10 * (0.5 + n)
    inner = np.exp(-((d - 0.93) / 0.05) ** 2) * 0.2 * n
    al = np.clip((rim * 0.55 + fill + inner) * strength, 0, 0.8).astype(f32)
    return al, np.array(hexrgb(color), f32)


def stain_blob(h, w, cx, cy, r, seed=0, edge=0.6, fill=0.18, color="#8A6A2A"):
    """Grease / sauce blob: irregular shape, darker tide-line edge."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(f32)
    n = fbm(h, w, scale=r * 0.9, octaves=4, seed=seed)
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / r + (n - 0.5) * 0.9
    inside = smoothstep(1.02, 0.95, d)
    tide = np.exp(-((d - 0.97) / 0.03) ** 2)
    al = np.clip(inside * fill * (0.7 + 0.6 * n) + tide * edge * 0.25, 0, 0.9).astype(f32)
    return al, np.array(hexrgb(color), f32)


def apply_stain(arr, al, rgb, mode="multiply"):
    if mode == "multiply":
        tint = 1 - al[..., None] * (1 - rgb[None, None])
        arr *= tint
    else:
        arr[:] = arr * (1 - al[..., None]) + rgb[None, None] * al[..., None]
    return arr


def fold_field(h, w, folds, seed=0, sharp=2.5, wobble=3.0):
    """Height field + shading for folds. folds: list of ('h'|'v', pos_px, depth(+ valley / - ridge)).
    Returns (shade multiplier (h,w), height (h,w))."""
    yy, xx = np.mgrid[0:h, 0:w].astype(f32)
    shade = np.ones((h, w), f32)
    height = np.zeros((h, w), f32)
    for k, (ori, pos, depth) in enumerate(folds):
        wob = (fbm(h, w, scale=400, octaves=3, seed=seed + 31 + k) - 0.5) * wobble * 2
        if ori == "h":
            d = (yy - pos - wob)
            span = h
        else:
            d = (xx - pos - wob)
            span = w
        # ridge/valley: the two halves are tilted -> broad shading gradient + sharp crease line
        crease = np.exp(-(d / sharp) ** 2)
        side = np.tanh(d / (span * 0.15))
        height += depth * (np.abs(d) / span * -1.0) * 8 + depth * crease * 1.5
        shade *= 1 + depth * (0.035 * side - 0.10 * crease)
        # small bright highlight just beside the crease
        shade *= 1 + abs(depth) * 0.05 * np.exp(-((d - sharp * 2.2 * np.sign(depth)) / (sharp * 1.3)) ** 2)
    return shade.astype(f32), height.astype(f32)


def crease_field(h, w, n=14, seed=0, length=(80, 500), strength=0.05):
    """Random wrinkle lines (thin dark+light pairs) — returns (shade multiplier, height)."""
    rng = np.random.default_rng(seed)
    hl = Image.new("F", (w, h), 0)
    d = ImageDraw.Draw(hl)
    for _ in range(n):
        x, y = rng.random() * w, rng.random() * h
        a = rng.random() * math.pi
        L = rng.uniform(*length)
        pts = [(x, y)]
        for _s in range(8):
            a += rng.normal(0, 0.25)
            x += math.cos(a) * L / 8
            y += math.sin(a) * L / 8
            pts.append((x, y))
        d.line(pts, fill=float(rng.uniform(0.5, 1.0)), width=2)
        if rng.random() < 0.5:  # branch
            j = rng.integers(2, 6)
            bx, by = pts[j]
            ba = a + rng.choice([-1, 1]) * rng.uniform(0.5, 1.2)
            d.line([(bx, by), (bx + math.cos(ba) * L * 0.3, by + math.sin(ba) * L * 0.3)], fill=0.5, width=1)
    H = ndi.gaussian_filter(np.asarray(hl, f32), 1.4)
    gy, gx = np.gradient(H)
    shade = 1 + (gx * 0.7 + gy * -0.7) * strength * 12 - H * strength * 0.6
    return shade.astype(f32), H


def edge_wear(h, w, seed=0, amount=1.0, width=18):
    """Multiplier: darker / dirtier near the borders + random nicks."""
    yy, xx = np.mgrid[0:h, 0:w].astype(f32)
    de = np.minimum(np.minimum(xx, w - 1 - xx), np.minimum(yy, h - 1 - yy))
    n = fbm(h, w, scale=60, octaves=4, seed=seed)
    m = np.clip(1 - de / (width * (0.6 + 0.8 * n)), 0, 1) ** 1.6
    return (1 - 0.18 * amount * m).astype(f32)


def height_to_normal(height, strength=2.0):
    gy, gx = np.gradient(height.astype(f32))
    nx, ny, nz = -gx * strength, gy * strength, np.ones_like(height)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    n = np.stack([nx / l, ny / l, nz / l], -1)
    return to_img(n * 0.5 + 0.5)


def vignette(h, w, strength=0.25, power=2.2):
    yy, xx = np.mgrid[0:h, 0:w].astype(f32)
    d = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2) / math.sqrt(2)
    return (1 - strength * d ** power).astype(f32)


def tape_strip(w, h, seed=0, color=(0.93, 0.90, 0.78), alpha=0.55, torn=True):
    """Semi-transparent sticky tape RGBA with torn ends and a few wrinkles."""
    rng = np.random.default_rng(seed)
    a = np.ones((h, w), f32) * alpha
    if torn:
        for side in (0, 1):
            prof = np.cumsum(rng.normal(0, 1.4, h))
            prof = (prof - prof.min())
            prof = prof / (prof.max() + 1e-6) * rng.uniform(4, 10)
            for yy in range(h):
                k = int(prof[yy])
                if side == 0:
                    a[yy, :k] = 0
                else:
                    a[yy, w - k:] = 0
    n = fbm(h, w, scale=30, octaves=3, seed=seed)
    a *= 0.85 + 0.3 * n
    rgb = np.ones((h, w, 3), f32) * np.array(color, f32)
    rgb *= (0.95 + 0.1 * n)[..., None]
    wr = np.zeros((h, w), f32)
    for _ in range(rng.integers(2, 5)):
        x = rng.integers(5, w - 5)
        wr[:, max(0, x - 1):x + 1] += rng.uniform(0.1, 0.3)
    rgb += wr[..., None] * 0.3
    out = np.concatenate([np.clip(rgb, 0, 1), np.clip(a, 0, 1)[..., None]], -1)
    return Image.fromarray((out * 255).astype(np.uint8), "RGBA")


# ----------------------------------------------------------------------------------- Thai text
_COMBINING = set(chr(c) for c in [0x0E31] + list(range(0x0E34, 0x0E3B)) + list(range(0x0E47, 0x0E4F)) + [0x0E33])


def thai_clusters(s: str):
    """Split into display clusters: base char + following Thai combining marks (and SARA AM)."""
    out = []
    for ch in s:
        if out and ch in _COMBINING:
            out[-1] += ch
        else:
            out.append(ch)
    return out


_tok_cache = {}


def thai_words(s: str):
    """Word tokens (pythainlp newmm) keeping spaces as separate tokens."""
    if s in _tok_cache:
        return _tok_cache[s]
    try:
        from pythainlp.tokenize import word_tokenize
        toks = word_tokenize(s, engine="newmm", keep_whitespace=True)
    except Exception:  # fallback: break at spaces and between clusters
        toks = re.findall(r"\s+|[^\s]+", s)
    _tok_cache[s] = toks
    return toks


def wrap_thai(text, font, max_w, tracking=0):
    """Greedy wrap using Thai word segmentation. Returns list of lines (strings)."""
    lines, cur = [], ""
    for para in text.split("\n"):
        cur = ""
        for tok in thai_words(para):
            trial = cur + tok
            if font.getlength(trial) <= max_w or not cur.strip():
                cur = trial
            else:
                lines.append(cur.rstrip())
                cur = tok.lstrip()
        lines.append(cur.rstrip())
    return lines


def justify_tokens(line, font, max_w, last=False):
    """[(x, chunk)] for a justified Thai line: extra width goes into existing spaces only
    (Thai has no inter-word spaces); lines without spaces / last lines stay left-aligned."""
    chunks = [c for c in line.split(" ") if c != ""]
    if not chunks:
        return []
    widths = [font.getlength(c) for c in chunks]
    sp = font.getlength(" ")
    if last or len(chunks) == 1:
        pos, x = [], 0.0
        for c, cw in zip(chunks, widths):
            pos.append((x, c))
            x += cw + sp
        return pos
    gap = (max_w - sum(widths)) / (len(chunks) - 1)
    if gap > sp * 4:  # too loose -> natural spacing
        gap = sp
    pos, x = [], 0.0
    for c, cw in zip(chunks, widths):
        pos.append((x, c))
        x += cw + gap
    return pos


def wrap_paragraphs(text, font, max_w):
    """Wrap multi-paragraph Thai text. Returns list of (line, is_last_of_paragraph)."""
    out = []
    for para in text.split("\n"):
        ls = wrap_thai(para, font, max_w)
        for i, l in enumerate(ls):
            out.append((l, i == len(ls) - 1))
    return out


# ----------------------------------------------------------------------------------- handwriting
def ink_layer(h, w):
    return np.zeros((h, w), f32)


def _render_cluster(cl, font, angle):
    l, t, r, b = font.getbbox(cl)
    pad = int(font.size * 0.35)
    im = Image.new("L", (max(1, r - l) + pad * 2, max(1, b - t) + pad * 2 + int(font.size * 0.5)), 0)
    ImageDraw.Draw(im).text((pad - l, pad - t + int(font.size * 0.25)), cl, font=font, fill=255)
    if angle:
        im = im.rotate(angle, resample=Image.BICUBIC, expand=False)
    return im, pad - l, pad - t + int(font.size * 0.25)


def hand_text(layer: Image.Image, xy, text, font_name, size, seed=0, jitter=1.0, slant=0.0, baseline_wave=0.0,
              spacing=1.0, size_var=0.05, rot_var=3.0):
    """Draw handwriting into an 'L' layer (ink amount 0..255) cluster by cluster. Returns end x."""
    rng = np.random.default_rng(seed)
    x, y = xy
    d_base = F(font_name, size)
    asc = d_base.getbbox("ก")[1]
    x0 = x
    phase = rng.random() * 6
    for i, cl in enumerate(thai_clusters(text)):
        if cl == " ":
            x += d_base.getlength(" ") * spacing * rng.uniform(0.8, 1.3)
            continue
        s = int(max(6, size * (1 + rng.normal(0, size_var * jitter))))
        f = F(font_name, s)
        ang = rng.normal(0, rot_var * jitter) + slant
        im, ox, oy = _render_cluster(cl, f, ang)
        by = y + rng.normal(0, size * 0.03 * jitter) + math.sin((x - x0) / (size * 6) + phase) * baseline_wave * size
        _max_paste(layer, im, int(x - ox), int(by - oy + (asc - f.getbbox("ก")[1])))
        x += f.getlength(cl) * spacing * rng.uniform(0.93, 1.06)
    return x


def _max_paste(layer, im, x, y):
    """Lighten-composite (max) a cluster mask into the ink layer."""
    L = np.asarray(layer)
    m = np.asarray(im)
    H, W = L.shape
    h, w = m.shape
    X0, Y0, X1, Y1 = max(0, x), max(0, y), min(W, x + w), min(H, y + h)
    if X1 <= X0 or Y1 <= Y0:
        return
    sub = np.maximum(L[Y0:Y1, X0:X1], m[Y0 - y:Y1 - y, X0 - x:X1 - x])
    layer.paste(Image.fromarray(sub), (X0, Y0))


def catmull(points, n=12):
    pts = np.array(points, f32)
    if len(pts) < 3:
        return pts
    P = np.vstack([pts[0], pts, pts[-1]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for t in np.linspace(0, 1, n, endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-2])
    return np.array(out, f32)


def scribble(layer: Image.Image, points, width=3.0, seed=0, jitter=1.2, ink=255, press_var=0.35, closed=False, n=10):
    """Wobbly ballpoint/marker stroke through points into an 'L' layer (max-composite)."""
    rng = np.random.default_rng(seed)
    pts = [(px + rng.normal(0, jitter), py + rng.normal(0, jitter)) for px, py in points]
    if closed:
        pts = pts + [pts[0]]
    curve = catmull(pts, n)
    if len(curve) < 2:
        return
    xs, ys = curve[:, 0], curve[:, 1]
    x0, y0 = int(xs.min() - width * 3), int(ys.min() - width * 3)
    x1, y1 = int(xs.max() + width * 3), int(ys.max() + width * 3)
    S = 2
    im = Image.new("L", ((x1 - x0) * S + 2, (y1 - y0) * S + 2), 0)
    d = ImageDraw.Draw(im)
    m = len(curve)
    pr = 1 + press_var * (fbm(1, max(8, m), scale=max(4, m / 3), octaves=2, seed=seed)[0] - 0.5) * 2
    for i in range(m - 1):
        wv = max(1, width * pr[i] * S)
        val = int(np.clip(ink * (0.75 + 0.25 * pr[i]), 0, 255))
        d.line([((curve[i, 0] - x0) * S, (curve[i, 1] - y0) * S), ((curve[i + 1, 0] - x0) * S, (curve[i + 1, 1] - y0) * S)],
               fill=val, width=int(round(wv)))
        d.ellipse([((curve[i, 0] - x0) * S - wv / 2, (curve[i, 1] - y0) * S - wv / 2),
                   ((curve[i, 0] - x0) * S + wv / 2, (curve[i, 1] - y0) * S + wv / 2)], fill=val)
    im = im.resize(((x1 - x0) + 1, (y1 - y0) + 1), Image.LANCZOS)
    _max_paste(layer, im, x0, y0)


def ink_composite(paper, layer: Image.Image, color, kind="ballpoint", seed=0, opacity=1.0):
    """Multiply an ink layer (L) onto float paper. kind: ballpoint | pencil | marker | chalk."""
    a = np.asarray(layer, f32) / 255.0
    h, w = a.shape
    col = np.array(hexrgb(color) if isinstance(color, str) else color, f32)
    if kind == "ballpoint":
        n = fbm(h, w, scale=6, octaves=2, seed=seed)
        a = a * (0.78 + 0.3 * n)
        a = np.clip(ndi.gaussian_filter(a, 0.45) * 1.08, 0, 1)
        skip = np.random.default_rng(seed).random((h, w)) > 0.985
        a = a * np.where(skip, 0.55, 1.0)
    elif kind == "pencil":
        tooth = np.random.default_rng(seed).random((h, w)).astype(f32)
        tooth = ndi.gaussian_filter(tooth, 0.6)
        a = a * np.clip((tooth - 0.25) * 2.2, 0.15, 1) * 0.8
    elif kind == "marker":
        n = fbm(h, w, scale=40, octaves=3, seed=seed)
        a = np.clip(ndi.gaussian_filter(a, 0.8) * 1.1, 0, 1) * (0.86 + 0.14 * n)
        streak = fbm(h, w, scale=3, octaves=1, seed=seed + 1)
        a = a * (0.92 + 0.08 * streak)
    elif kind == "chalk":
        tooth = np.random.default_rng(seed).random((h, w)).astype(f32)
        tooth = ndi.gaussian_filter(tooth, 0.7)
        n = fbm(h, w, scale=25, octaves=3, seed=seed)
        a = a * np.clip((tooth - 0.3) * 2.6, 0, 1) * (0.75 + 0.35 * n)
        a = np.clip(a + ndi.gaussian_filter(a, 3) * 0.25, 0, 1)
        out = paper * (1 - a[..., None] * opacity) + col[None, None] * a[..., None] * opacity
        return np.clip(out, 0, 1).astype(f32)
    a = a * opacity
    out = paper * (1 - a[..., None] * (1 - col[None, None]))
    return np.clip(out, 0, 1).astype(f32)


def save_jpg(arr_or_img, path, q=88):
    im = to_img(arr_or_img) if isinstance(arr_or_img, np.ndarray) else arr_or_img
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.convert("RGB").save(path, quality=q, optimize=True, progressive=True)


def save_png(img: Image.Image, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)
