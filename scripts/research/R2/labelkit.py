"""labelkit: helpers to draw authentic-looking printed packaging labels with Pillow (+raqm for Thai).

All drawing happens on RGBA canvases at supersampled resolution; `finish()` adds print artefacts.
"""
import math
import random

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

FONT_DIR = "/home/user/special-telegram/scripts/_cache/fonts/"
_fc = {}


def F(name, size):
    key = (name, int(size))
    if key not in _fc:
        _fc[key] = ImageFont.truetype(FONT_DIR + name + ".ttf", max(4, int(size)),
                                      layout_engine=ImageFont.Layout.RAQM)
    return _fc[key]


def C(h, a=255):
    """'#rrggbb' -> (r,g,b,a)"""
    if isinstance(h, tuple):
        return h if len(h) == 4 else h + (a,)
    h = h.lstrip("#")
    if len(h) == 8:
        a = int(h[6:8], 16)
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


# ------------------------------------------------------------------ noise & gradients
def fbm(w, h, scale=64, octaves=4, seed=0, persistence=0.5):
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    s = scale
    for _ in range(octaves):
        gw, gh = max(2, int(w / s) + 2), max(2, int(h / s) + 2)
        g = (rng.random((gh, gw)) * 255).astype(np.uint8)
        im = Image.fromarray(g, "L").resize((int(gw * s), int(gh * s)), Image.BICUBIC)
        a = np.asarray(im, np.float32)[:h, :w] / 255.0
        if a.shape != (h, w):
            a = np.pad(a, ((0, h - a.shape[0]), (0, w - a.shape[1])), mode="edge")
        out += a * amp
        tot += amp
        amp *= persistence
        s = max(1.0, s / 2)
    return out / tot


def _stops(t, stops):
    t = np.clip(t, 0, 1)
    xs = [s[0] for s in stops]
    chans = []
    for ci in range(4):
        ys = [C(s[1])[ci] for s in stops]
        chans.append(np.interp(t, xs, ys))
    return Image.fromarray(np.dstack(chans).astype(np.uint8), "RGBA")


def lin_grad(w, h, stops, angle=90):
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    a = math.radians(angle)
    dx, dy = math.cos(a), math.sin(a)
    proj = (x - w / 2) * dx + (y - h / 2) * dy
    half = abs(w / 2 * dx) + abs(h / 2 * dy)
    return _stops((proj + half) / (2 * half + 1e-6), stops)


def rad_grad(w, h, stops, cx=0.5, cy=0.5, rx=0.5, ry=None):
    ry = ry if ry is not None else rx * w / h
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.sqrt(((x / w - cx) / rx) ** 2 + ((y / h - cy) / ry) ** 2)
    return _stops(d, stops)


def metal(w, h, kind="gold", seed=1, angle=90, bands=None):
    """Metallic foil look: banded gradient + brushed micro-noise."""
    if kind == "gold":
        st = bands or [(0, "#7a5410"), (0.18, "#e9c867"), (0.32, "#fff3b0"), (0.45, "#c8952c"),
                       (0.62, "#8a5f14"), (0.78, "#f2d47a"), (1, "#9b6b18")]
    elif kind == "silver":
        st = bands or [(0, "#5d6066"), (0.2, "#d9dde2"), (0.33, "#ffffff"), (0.48, "#9aa0a8"),
                       (0.64, "#5f646b"), (0.8, "#e3e7eb"), (1, "#80868e")]
    elif kind == "red":
        st = bands or [(0, "#5c0006"), (0.25, "#d11a22"), (0.4, "#ff6a5c"), (0.55, "#b10c16"),
                       (1, "#6d0309")]
    else:
        st = bands
    base = lin_grad(w, h, st, angle)
    rng = np.random.default_rng(seed)
    streak = rng.normal(0, 1, (h, 1)).astype(np.float32)
    streak = np.repeat(streak, w, axis=1) if angle == 90 else np.repeat(rng.normal(0, 1, (1, w)), h, axis=0)
    n = fbm(w, h, 8, 2, seed) - 0.5
    arr = np.asarray(base, np.float32)
    arr[..., :3] += (streak[..., None] * 6 + n[..., None] * 18)
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")


def solid(w, h, col):
    return Image.new("RGBA", (int(w), int(h)), C(col))


# ------------------------------------------------------------------ text
def text_size(s, font, stroke=0):
    d = ImageDraw.Draw(Image.new("L", (8, 8)))
    b = d.textbbox((0, 0), s, font=font, stroke_width=stroke)
    return b[2] - b[0], b[3] - b[1]


def fit(s, fname, max_w, max_h=None, start=200, stroke_ratio=0.0, minimum=6):
    size = int(start)
    while size > minimum:
        f = F(fname, size)
        w, h = text_size(s, f, int(size * stroke_ratio))
        if w <= max_w and (max_h is None or h <= max_h):
            return f
        size = int(size * 0.94)
    return F(fname, minimum)


def text(im, xy, s, font, fill="#000000", anchor="mm", stroke=0, stroke_fill="#ffffff", shadow=None,
         outer=None, rotate=0, align="center", spacing=4, opacity=1.0):
    """Draw text with optional stroke, outer second stroke, drop shadow, gradient/texture fill.
    fill: colour or RGBA Image (same size as im) used as texture. outer=(width, colour) extra outline."""
    W, H = im.size
    layers = []
    multiline = "\n" in s

    def mask_for(sw):
        m = Image.new("L", (W, H), 0)
        d = ImageDraw.Draw(m)
        if multiline:
            d.multiline_text(xy, s, font=font, fill=255, anchor=anchor, stroke_width=sw, stroke_fill=255,
                             align=align, spacing=spacing)
        else:
            d.text(xy, s, font=font, fill=255, anchor=anchor, stroke_width=sw, stroke_fill=255)
        if rotate:
            m = m.rotate(rotate, resample=Image.BICUBIC, center=xy)
        return m

    fill_mask = mask_for(0)
    if outer:
        layers.append((mask_for(stroke + outer[0]), outer[1]))
    if stroke:
        layers.append((mask_for(stroke), stroke_fill))
    layers.append((fill_mask, fill))
    if shadow:
        dx, dy, blur, col = shadow
        base_mask = layers[0][0]
        sh = ImageChops.offset(base_mask, int(dx), int(dy))
        if blur:
            sh = sh.filter(ImageFilter.GaussianBlur(blur))
        _paint(im, sh, col, opacity)
    for m, col in layers:
        _paint(im, m, col, opacity)
    return fill_mask


def _paint(im, mask, col, opacity=1.0):
    if isinstance(col, Image.Image):
        src = col if col.size == im.size else col.resize(im.size)
        a = ImageChops.multiply(mask, src.getchannel("A"))
    else:
        c = C(col)
        src = Image.new("RGBA", im.size, c)
        a = mask if c[3] == 255 else mask.point(lambda v: v * c[3] // 255)
    if opacity < 1:
        a = a.point(lambda v: int(v * opacity))
    im.paste(src, (0, 0), a)


def paint_mask(im, mask, col, opacity=1.0):
    _paint(im, mask, col, opacity)


def arc_text(im, center, radius, s, font, fill, start_deg=-90, clockwise=True, stroke=0, stroke_fill=None,
             spread=None):
    """Draw text along a circle (Latin or Thai clusters). Each grapheme cluster rendered separately."""
    clusters = _clusters(s)
    widths = [text_size(c, font)[0] + font.size * 0.06 for c in clusters]
    total = sum(widths)
    circ = 2 * math.pi * radius
    span = spread if spread else total / circ * 360
    ang = start_deg - span / 2 if clockwise else start_deg + span / 2
    for c, w in zip(clusters, widths):
        a_step = w / circ * 360
        a_mid = ang + (a_step / 2 if clockwise else -a_step / 2)
        r = math.radians(a_mid)
        x = center[0] + radius * math.cos(r)
        y = center[1] + radius * math.sin(r)
        tile = Image.new("RGBA", (int(font.size * 3), int(font.size * 3)), (0, 0, 0, 0))
        text(tile, (tile.width / 2, tile.height / 2), c, font, fill, stroke=stroke,
             stroke_fill=stroke_fill or "#ffffff")
        rot = -(a_mid + 90) if clockwise else -(a_mid - 90)
        tile = tile.rotate(rot, resample=Image.BICUBIC)
        im.alpha_composite(tile, (int(x - tile.width / 2), int(y - tile.height / 2)))
        ang += a_step if clockwise else -a_step


def _clusters(s):
    """Split a Thai/Latin string into grapheme-ish clusters (combining marks stay with base)."""
    comb = set("ัิีึืฺุู็่้๊๋์ํ๎")
    out = []
    for ch in s:
        if out and ch in comb:
            out[-1] += ch
        else:
            out.append(ch)
    return out


# ------------------------------------------------------------------ shapes
def rrect(im, box, r, fill=None, outline=None, width=1):
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([int(v) for v in box], radius=int(r), fill=C(fill) if fill else None,
                        outline=C(outline) if outline else None, width=int(width))


def rect_tex(im, box, tex, r=0):
    """Paste texture image into (rounded) rect box."""
    x0, y0, x1, y1 = [int(v) for v in box]
    m = Image.new("L", im.size, 0)
    ImageDraw.Draw(m).rounded_rectangle([x0, y0, x1, y1], radius=int(r), fill=255)
    t = tex.resize((x1 - x0, y1 - y0)) if tex.size != (x1 - x0, y1 - y0) else tex
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    layer.paste(t, (x0, y0))
    im.paste(layer, (0, 0), ImageChops.multiply(m, layer.getchannel("A")))


def poly_mask(size, pts):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).polygon([(float(x), float(y)) for x, y in pts], fill=255)
    return m


def ellipse_mask(size, box):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).ellipse([int(v) for v in box], fill=255)
    return m


def star_pts(cx, cy, r_out, r_in, n=16, rot=0, jitter=0.0, seed=0):
    rnd = random.Random(seed)
    pts = []
    for i in range(n * 2):
        r = r_out if i % 2 == 0 else r_in
        r *= 1 + rnd.uniform(-jitter, jitter)
        a = math.pi * i / n + math.radians(rot)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def ribbon(im, box, col, fold="#000000", notch=0.35, tail=0.12):
    """Banner with notched tails. box = (x0,y0,x1,y1) of main band."""
    x0, y0, x1, y1 = box
    h = y1 - y0
    t = (x1 - x0) * tail
    d = ImageDraw.Draw(im)
    fc = C(fold)
    darker = (int(C(col)[0] * 0.6), int(C(col)[1] * 0.6), int(C(col)[2] * 0.6), 255)
    for side in (-1, 1):
        if side < 0:
            pts = [(x0 + t * 0.6, y0 + h * 0.25), (x0 - t, y0 + h * 0.25), (x0 - t + t * notch, y0 + h * 0.75),
                   (x0 - t, y1 + h * 0.25), (x0 + t * 0.6, y1 + h * 0.25)]
        else:
            pts = [(x1 - t * 0.6, y0 + h * 0.25), (x1 + t, y0 + h * 0.25), (x1 + t - t * notch, y0 + h * 0.75),
                   (x1 + t, y1 + h * 0.25), (x1 - t * 0.6, y1 + h * 0.25)]
        d.polygon(pts, fill=darker)
        tri = [(x0, y1), (x0 + t * 0.6, y1 + h * 0.25), (x0 + t * 0.6, y1)] if side < 0 else \
              [(x1, y1), (x1 - t * 0.6, y1 + h * 0.25), (x1 - t * 0.6, y1)]
        d.polygon(tri, fill=fc)
    d.rectangle([x0, y0, x1, y1], fill=C(col))


def guilloche(w, h, col="#000000", n=18, amp=0.5, freq=3.0, width=1, seed=0, alpha=90):
    """Security-print style interference lines (RGBA)."""
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = C(col, alpha)
    rnd = random.Random(seed)
    ph2 = rnd.uniform(0, 6)
    for i in range(n):
        ph = i / n * math.pi * 2
        pts = []
        for x in range(0, w + 4, 3):
            t = x / w * math.pi * 2 * freq
            y = h / 2 + h * amp * 0.5 * math.sin(t + ph) * math.cos(t * 0.5 + ph2 + ph * 0.3)
            pts.append((x, y))
        d.line(pts, fill=c, width=width)
    return im


def halftone(w, h, value, spacing=8, angle=45, col="#000000", max_r=None):
    """value: np array (h,w) in [0,1] -> dot radius. Returns RGBA dots."""
    im = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(im)
    max_r = max_r or spacing * 0.62
    a = math.radians(angle)
    ca, sa = math.cos(a), math.sin(a)
    diag = int(math.hypot(w, h))
    for i in range(-diag // spacing, diag // spacing + 1):
        for j in range(-diag // spacing, diag // spacing + 1):
            x = (i * ca - j * sa) * spacing + w / 2
            y = (i * sa + j * ca) * spacing + h / 2
            if 0 <= x < w and 0 <= y < h:
                r = max_r * math.sqrt(float(value[int(y), int(x)]))
                if r > 0.3:
                    d.ellipse([x - r, y - r, x + r, y + r], fill=255)
    out = Image.new("RGBA", (w, h), C(col))
    out.putalpha(im)
    return out


def paper(w, h, base="#f4efe2", seed=0, fibre=0.06):
    arr = np.zeros((h, w, 4), np.float32)
    b = C(base)
    n = fbm(w, h, 24, 4, seed) - 0.5
    fine = np.random.default_rng(seed).normal(0, 1, (h, w)) * 0.5
    for i in range(3):
        arr[..., i] = b[i] + (n * 30 + fine * 6) * fibre * 10
    arr[..., 3] = 255
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")


# ------------------------------------------------------------------ barcode & small print
_L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"]
_G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"]
_R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"]
_PAR = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"]


def ean13(d12):
    d12 = "".join(c for c in d12 if c.isdigit())[:12]
    s = sum(int(c) * (3 if i % 2 else 1) for i, c in enumerate(d12))
    return d12 + str((10 - s % 10) % 10)


def barcode(d12, w, h, fg="#111111", bg="#ffffff", font="ChakraPetch-Regular", quiet=True):
    code = ean13(d12)
    bits = "101"
    par = _PAR[int(code[0])]
    for i, c in enumerate(code[1:7]):
        bits += (_L if par[i] == "L" else _G)[int(c)]
    bits += "01010"
    for c in code[7:]:
        bits += _R[int(c)]
    bits += "101"
    total = len(bits) + 18  # quiet zones (11 left + 7 right)
    mod = w / total
    im = Image.new("RGBA", (int(w), int(h)), C(bg))
    d = ImageDraw.Draw(im)
    bar_h = h * 0.78
    guard_idx = set(list(range(0, 3)) + list(range(45, 50)) + list(range(92, 95)))
    for i, b in enumerate(bits):
        if b == "1":
            x = (11 + i) * mod
            hh = h * 0.9 if i in guard_idx else bar_h
            d.rectangle([x, h * 0.04, x + mod - 0.2, hh], fill=C(fg))
    f = F(font, min(h * 0.17, mod * 6.2))
    d.text((mod * 5.5, h * 0.98), code[0], font=f, fill=C(fg), anchor="ms")
    d.text(((11 + 3 + 21) * mod, h * 0.98), code[1:7], font=f, fill=C(fg), anchor="ms")
    d.text(((11 + 50 + 21) * mod, h * 0.98), code[7:], font=f, fill=C(fg), anchor="ms")
    return im


def nutrition_box(w, h, rows, title="ข้อมูลโภชนาการ", font="Sarabun-Regular", bold="Sarabun-Bold",
                  fg="#111111", bg="#ffffff"):
    """Thai nutrition facts box. rows: list of (label, value) or ('--', '') separators."""
    w, h = int(w), int(h)
    im = Image.new("RGBA", (w, h), C(bg))
    d = ImageDraw.Draw(im)
    lw = max(1, int(w / 160))
    d.rectangle([lw, lw, w - lw - 1, h - lw - 1], outline=C(fg), width=lw * 2)
    pad = w * 0.05
    ft = fit(title, bold, w - 2 * pad, h * 0.13, h * 0.12)
    d.text((w / 2, pad * 0.6), title, font=ft, fill=C(fg), anchor="mt")
    y = pad * 0.6 + ft.size * 1.3
    d.line([pad, y, w - pad, y], fill=C(fg), width=lw * 3)
    n_rows = sum(1 for r in rows if r[0] != "--")
    n_sep = len(rows) - n_rows
    rh = (h - y - pad * 0.5 - n_sep * 6) / max(1, n_rows)
    fs = rh * 0.62
    while fs > 5:
        ok = all(text_size(lab.lstrip("*") + "    " + val, F(bold, fs))[0] <= w - 2 * pad for lab, val in rows
                 if lab != "--")
        if ok:
            break
        fs *= 0.93
    fr = F(font, fs)
    fb = F(bold, fs)
    for lab, val in rows:
        if lab == "--":
            d.line([pad, y + 3, w - pad, y + 3], fill=C(fg), width=lw * 2)
            y += 6
            continue
        y += rh
        bold_row = lab.startswith("*")
        lab = lab.lstrip("*")
        d.text((pad, y - rh * 0.22), lab, font=fb if bold_row else fr, fill=C(fg), anchor="ls")
        d.text((w - pad, y - rh * 0.22), val, font=fb if bold_row else fr, fill=C(fg), anchor="rs")
        d.line([pad, y, w - pad, y], fill=C(fg), width=lw)
    return im


def para(im, box, s, fname, size, fill="#222222", line=1.25, align="left"):
    """Simple word-wrapped paragraph (splits on spaces; Thai segments should be pre-spaced or short)."""
    x0, y0, x1, y1 = box
    f = F(fname, size)
    words = s.split(" ")
    lines, cur = [], ""
    for wd in words:
        t = (cur + " " + wd).strip()
        if text_size(t, f)[0] <= (x1 - x0):
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = wd
    if cur:
        lines.append(cur)
    d = ImageDraw.Draw(im)
    y = y0
    for ln in lines:
        if y + size > y1 + size * 0.3:
            break
        if align == "center":
            d.text(((x0 + x1) / 2, y), ln, font=f, fill=C(fill), anchor="ma")
        elif align == "right":
            d.text((x1, y), ln, font=f, fill=C(fill), anchor="ra")
        else:
            d.text((x0, y), ln, font=f, fill=C(fill), anchor="la")
        y += size * line
    return y


# ------------------------------------------------------------------ photos
def cutout_white(img, thresh=235, soft=18, grow=0):
    """Remove near-white background by flood fill from borders. Returns RGBA."""
    im = img.convert("RGB")
    arr = np.asarray(im, np.int16)
    lum_min = arr.min(axis=2)
    bg = (lum_min > thresh).astype(np.uint8) * 255
    m = Image.fromarray(bg, "L")
    # flood from borders: keep only bg regions connected to edges
    seed_mask = Image.new("L", m.size, 0)
    w, h = m.size
    ff = m.copy()
    for (x, y) in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 0), (w // 2, h - 1), (0, h // 2),
                   (w - 1, h // 2)]:
        if ff.getpixel((x, y)) == 255:
            ImageDraw.floodfill(ff, (x, y), 128)
    bgc = np.asarray(ff) == 128
    alpha = np.where(bgc, 0, 255).astype(np.uint8)
    a = Image.fromarray(alpha, "L")
    if grow:
        a = a.filter(ImageFilter.MinFilter(grow * 2 + 1))
    a = a.filter(ImageFilter.GaussianBlur(1.0))
    out = im.convert("RGBA")
    out.putalpha(a)
    return out


def duotone(img, dark, light, contrast=1.0):
    g = np.asarray(img.convert("L"), np.float32) / 255.0
    g = np.clip((g - 0.5) * contrast + 0.5, 0, 1)
    d, l = np.array(C(dark), np.float32), np.array(C(light), np.float32)
    arr = d[None, None, :] * (1 - g[..., None]) + l[None, None, :] * g[..., None]
    out = Image.fromarray(arr.astype(np.uint8), "RGBA")
    if img.mode == "RGBA":
        out.putalpha(img.getchannel("A"))
    return out


def place(im, src, box, mode="cover", opacity=1.0):
    """Paste src (RGBA) into box with cover/contain fit."""
    x0, y0, x1, y1 = [int(v) for v in box]
    bw, bh = x1 - x0, y1 - y0
    sw, sh = src.size
    s = max(bw / sw, bh / sh) if mode == "cover" else min(bw / sw, bh / sh)
    r = src.resize((max(1, int(sw * s)), max(1, int(sh * s))), Image.LANCZOS)
    if mode == "cover":
        l, t = (r.width - bw) // 2, (r.height - bh) // 2
        r = r.crop((l, t, l + bw, t + bh))
        pos = (x0, y0)
    else:
        pos = (x0 + (bw - r.width) // 2, y0 + (bh - r.height) // 2)
    if r.mode != "RGBA":
        r = r.convert("RGBA")
    if opacity < 1:
        r.putalpha(r.getchannel("A").point(lambda v: int(v * opacity)))
    im.alpha_composite(r, pos)


# ------------------------------------------------------------------ finishing
def finish(im, seed=0, grain=5.0, misreg=1, blur=0.35, uneven=0.04, out_w=None, keep_alpha=False):
    """Print artefacts: CMY misregistration, ink unevenness, paper grain, softening, downsample."""
    rgba = im.convert("RGBA")
    a = rgba.getchannel("A")
    rgb = rgba.convert("RGB")
    if misreg:
        r, g, b = rgb.split()
        r = ImageChops.offset(r, misreg, 0)
        b = ImageChops.offset(b, 0, -misreg)
        rgb = Image.merge("RGB", (r, g, b))
    arr = np.asarray(rgb, np.float32)
    h, w = arr.shape[:2]
    if uneven:
        n = fbm(w, h, max(16, w // 10), 3, seed)
        arr *= (1 - uneven / 2 + n[..., None] * uneven)
    if grain:
        g = np.random.default_rng(seed + 7).normal(0, grain, (h, w, 1))
        arr += g
    rgb = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")
    if blur:
        rgb = rgb.filter(ImageFilter.GaussianBlur(blur))
    out = rgb.convert("RGBA")
    out.putalpha(a)
    if out_w:
        out = out.resize((out_w, int(out.height * out_w / out.width)), Image.LANCZOS)
    if not keep_alpha:
        bgc = Image.new("RGBA", out.size, (255, 255, 255, 255))
        bgc.alpha_composite(out)
        out = bgc
    return out


def greasy(im, seed=0, strength=1.0, drips=True, edge=True, base_col=(92, 52, 18)):
    """Worn & greasy variant: oil-soaked translucent patches, sauce drips, scuffs, edge wear, dirt."""
    rnd = random.Random(seed)
    rgba = im.convert("RGBA")
    w, h = rgba.size
    arr = np.asarray(rgba, np.float32)
    rgb = arr[..., :3]
    # oil soak: darker, warmer, slightly desaturated-yellow
    n1 = fbm(w, h, max(24, w // 6), 4, seed)
    n2 = fbm(w, h, max(12, w // 20), 3, seed + 3)
    soak = np.clip((n1 * 0.75 + n2 * 0.35 - 0.52) * 3.2 * strength, 0, 1)
    soak_tint = np.array([0.80, 0.70, 0.50], np.float32)
    rgb = rgb * (1 - soak[..., None] * (1 - soak_tint))
    # general grime
    g = fbm(w, h, max(8, w // 40), 3, seed + 11)
    rgb *= (0.93 + 0.07 * g[..., None])
    rgb = rgb * (1 - 0.06 * strength) + np.array([60, 45, 25]) * 0.06 * strength
    out = Image.fromarray(np.clip(np.dstack([rgb, arr[..., 3]]), 0, 255).astype(np.uint8), "RGBA")
    ov = Image.new("RGBA", out.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    # drips from the top edge (sauce running down from the cap): tapered translucent runs with a bulb
    if drips:
        for _ in range(max(1, int(rnd.randint(2, 6) * strength))):
            x = rnd.uniform(0.05, 0.95) * w
            length = rnd.uniform(0.12, 0.65) * h
            wd = rnd.uniform(0.0025, 0.007) * w
            col = (int(base_col[0] * rnd.uniform(0.6, 1.3)), int(base_col[1] * rnd.uniform(0.6, 1.3)),
                   int(base_col[2] * rnd.uniform(0.6, 1.3)))
            alpha = rnd.randint(70, 130)
            left, right = [], []
            y = -4.0
            n = 60
            for i in range(n + 1):
                t = i / n
                y = -4 + length * t
                x += rnd.uniform(-0.25, 0.25) * wd
                ww = wd * (1.0 - 0.55 * t) * (0.85 + 0.15 * math.sin(t * 9))
                left.append((x - ww, y))
                right.append((x + ww, y))
            dl = ImageDraw.Draw(ov)
            dl.polygon(left + list(reversed(right)), fill=col + (alpha,))
            rr = wd * 1.25
            dl.ellipse([x - rr, y - rr, x + rr, y + rr * 1.5], fill=col + (min(255, alpha + 30),))
    # scuffs: scratches revealing paper
    for _ in range(int(40 * strength)):
        x, y = rnd.uniform(0, w), rnd.uniform(0, h)
        ang = rnd.uniform(-0.5, 0.5) + (math.pi / 2 if rnd.random() < 0.3 else 0)
        ln = rnd.uniform(0.01, 0.06) * w
        d.line([x, y, x + math.cos(ang) * ln, y + math.sin(ang) * ln], fill=(235, 228, 210, rnd.randint(40, 120)),
               width=max(1, int(w / 700)))
    # dirt specks
    for _ in range(int(300 * strength)):
        x, y = rnd.uniform(0, w), rnd.uniform(0, h)
        r = rnd.uniform(0.3, 1.8) * w / 1000
        d.ellipse([x - r, y - r, x + r, y + r], fill=(40, 28, 15, rnd.randint(60, 160)))
    # fingerprint-ish smudge
    for _ in range(int(2 * strength)):
        cx, cy = rnd.uniform(0.2, 0.8) * w, rnd.uniform(0.3, 0.9) * h
        rr = rnd.uniform(0.03, 0.05) * w
        for k in range(10):
            r2 = rr * (0.25 + k * 0.08)
            d.ellipse([cx - r2, cy - r2 * 1.3, cx + r2, cy + r2 * 1.3], outline=(70, 50, 25, 26),
                      width=max(1, int(w / 600)))
    out.alpha_composite(ov)
    if edge:
        # paper wear at edges: lighten towards edges with noise
        arr = np.asarray(out, np.float32)
        y, x = np.mgrid[0:h, 0:w].astype(np.float32)
        de = np.minimum.reduce([x, y, w - 1 - x, h - 1 - y]) / (0.035 * min(w, h))
        nn = fbm(w, h, max(6, w // 60), 3, seed + 5)
        wear = np.clip(1.0 - de - (nn - 0.5) * 1.4, 0, 1) * strength
        paper_c = np.array([228, 220, 200], np.float32)
        arr[..., :3] = arr[..., :3] * (1 - wear[..., None] * 0.85) + paper_c * wear[..., None] * 0.85
        out = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")
    return out


def save(im, path, quality=92):
    if path.endswith(".jpg"):
        im.convert("RGB").save(path, quality=quality, optimize=True)
    else:
        im.save(path, optimize=True)


def gda_strip(w, h, vals=(("พลังงาน", "5", "กิโลแคลอรี"), ("น้ำตาล", "1", "กรัม"), ("ไขมัน", "0", "กรัม"),
                          ("โซเดียม", "390", "มิลลิกรัม")), title="คุณค่าทางโภชนาการต่อ 1 หน่วยบริโภค",
              fg="#1a1a1a", bg="#ffffff", font="Sarabun-Bold"):
    """Thai GDA (Guideline Daily Amount) strip: title + 4 rounded value boxes (mandatory on Thai snacks)."""
    w, h = int(w), int(h)
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    ft = fit(title, font, w * 0.98, h * 0.22, h * 0.2)
    d.text((w / 2, 0), title, font=ft, fill=C(fg), anchor="ma")
    top = ft.size * 1.25
    n = len(vals)
    gap = w * 0.02
    bw = (w - gap * (n - 1)) / n
    for i, (lab, num, unit) in enumerate(vals):
        x0 = i * (bw + gap)
        d.rounded_rectangle([x0, top, x0 + bw, h - 2], radius=bw * 0.18, fill=C(bg), outline=C(fg),
                            width=max(1, int(w / 300)))
        bh = h - 2 - top
        d.text((x0 + bw / 2, top + bh * 0.08), lab, font=fit(lab, font, bw * 0.86, None, bh * 0.2), fill=C(fg),
               anchor="ma")
        d.text((x0 + bw / 2, top + bh * 0.52), num, font=fit(num, font, bw * 0.8, None, bh * 0.32), fill=C(fg),
               anchor="mm")
        d.text((x0 + bw / 2, top + bh * 0.92), unit, font=fit(unit, "Sarabun-Regular", bw * 0.86, None, bh * 0.16),
               fill=C(fg), anchor="md")
    return im


def qr_like(size, seed=0, fg="#111111", bg="#ffffff", n=25):
    """QR-code-looking matrix (random modules + 3 finder patterns). Decorative only."""
    rnd = random.Random(seed)
    m = size / (n + 2)
    im = Image.new("RGBA", (int(size), int(size)), C(bg))
    d = ImageDraw.Draw(im)
    grid = [[rnd.random() < 0.48 for _ in range(n)] for _ in range(n)]
    for (fx, fy) in [(0, 0), (n - 7, 0), (0, n - 7)]:
        for yy in range(-1, 8):
            for xx in range(-1, 8):
                if 0 <= fy + yy < n and 0 <= fx + xx < n:
                    grid[fy + yy][fx + xx] = (0 <= xx <= 6 and 0 <= yy <= 6) and (
                        xx in (0, 6) or yy in (0, 6) or (2 <= xx <= 4 and 2 <= yy <= 4))
    for y in range(n):
        for x in range(n):
            if grid[y][x]:
                d.rectangle([(x + 1) * m, (y + 1) * m, (x + 2) * m - 0.5, (y + 2) * m - 0.5], fill=C(fg))
    return im


def recycle_icon(size, num="1", label="PET", col="#1a1a1a"):
    S = int(size)
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    lw = max(2, S // 14)
    pts = [(S * 0.5, S * 0.08), (S * 0.92, S * 0.78), (S * 0.08, S * 0.78)]
    for i in range(3):
        a, b = pts[i], pts[(i + 1) % 3]
        d.line([a[0] + (b[0] - a[0]) * 0.12, a[1] + (b[1] - a[1]) * 0.12, a[0] + (b[0] - a[0]) * 0.80,
                a[1] + (b[1] - a[1]) * 0.80], fill=C(col), width=lw)
        tip = (a[0] + (b[0] - a[0]) * 0.88, a[1] + (b[1] - a[1]) * 0.88)
        d.ellipse([tip[0] - lw, tip[1] - lw, tip[0] + lw, tip[1] + lw], fill=C(col))
    d.text((S * 0.5, S * 0.55), num, font=F("Kanit-Bold", S * 0.3), fill=C(col), anchor="mm")
    d.text((S * 0.5, S * 0.98), label, font=F("Kanit-Bold", S * 0.2), fill=C(col), anchor="md")
    return im
