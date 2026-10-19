"""Album-cover title lettering (ref4 'Tattoo Colour' style) for Thai text.
Layers (outside -> inside): hard drop shadow, thin dark outer edge, thick bright-green outline band,
thin near-black inner contour, warm-white fill. Outlines of neighbouring letters merge."""
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from printfx import F, hexrgb, f32

STYLE_COVER = dict(fill="#FBFDF8", inner="#0F1A0B", green="#6CBF4B", green_hi="#86CF66", green_lo="#4E9E3A",
                   outer="#1E3314", shadow="#0F1A0B")


def glyph_mask(text, font_name, size, pad, scale_x=1.0, tracking=0, ss=1):
    f = F(font_name, size * ss)
    l, t, r, b = f.getbbox(text, anchor="ls")
    if tracking:
        from printfx import thai_clusters
        cl = thai_clusters(text)
        w = int(sum(f.getlength(c) for c in cl) + tracking * ss * (len(cl) - 1) - l + 4)
    else:
        w = r - l
    W, H = int(w + 2 * pad * ss), int(b - t + 2 * pad * ss)
    im = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(im)
    if tracking:
        x = pad * ss - l
        for c in cl:
            d.text((x, pad * ss - t), c, font=f, fill=255, anchor="ls")
            x += f.getlength(c) + tracking * ss
    else:
        d.text((pad * ss - l, pad * ss - t), text, font=f, fill=255, anchor="ls")
    if scale_x != 1.0:
        im = im.resize((int(im.width * scale_x), im.height), Image.LANCZOS)
    if ss != 1:
        im = im.resize((im.width // ss, im.height // ss), Image.LANCZOS)
    return np.asarray(im, f32) / 255.0


def bubble(mask, round_px=6.0, fatten_px=3.0):
    """Soften corners + fatten (blur/threshold and distance-based dilation)."""
    m = mask > 0.5
    if fatten_px > 0:
        d = ndi.distance_transform_edt(~m)
        m = d <= fatten_px
    if round_px > 0:
        b = ndi.gaussian_filter(m.astype(f32), round_px)
        m = b > 0.5
    return m


def sdf(m):
    """signed distance: >0 outside, <0 inside (px)."""
    return ndi.distance_transform_edt(~m) - ndi.distance_transform_edt(m)


def aa(sd, edge):
    """coverage of region {sd < edge} with ~1px antialiasing."""
    return np.clip(edge - sd + 0.5, 0, 1).astype(f32)


def compose(m, cap_h, style=STYLE_COVER, inner_w=0.016, green_w=0.11, outer_w=0.022, shadow=(0.035, 0.05), gloss=True):
    """m: boolean glyph mask (already bubbled). Widths are fractions of the cap height."""
    sd = sdf(m)
    iw, gw, ow = inner_w * cap_h, green_w * cap_h, outer_w * cap_h
    fill_a = aa(sd, -iw)
    inner_a = aa(sd, 0.0)
    green_a = aa(sd, gw)
    outer_a = aa(sd, gw + ow)
    sx, sy = int(round(shadow[0] * cap_h)), int(round(shadow[1] * cap_h))
    shadow_a = ndi.shift(outer_a, (sy, sx), order=1)
    h, w = m.shape
    rgb = np.zeros((h, w, 3), f32)
    a = np.zeros((h, w), f32)

    def over(col, al):
        nonlocal rgb, a
        c = np.array(hexrgb(col), f32) if isinstance(col, str) else col
        rgb = rgb * (1 - al[..., None]) + (c if c.ndim == 3 else c[None, None]) * al[..., None]
        a = a * (1 - al) + al

    over(style["shadow"], shadow_a * 0.92)
    over(style["outer"], outer_a)
    # green band with a soft vertical gradient (lighter top, darker bottom) like a printed sticker
    yy = np.linspace(0, 1, h, dtype=f32)[:, None] * np.ones((1, w), f32)
    g_hi, g_mid, g_lo = (np.array(hexrgb(style[k]), f32) for k in ("green_hi", "green", "green_lo"))
    tt = yy[..., None]
    gcol = np.where(tt < 0.5, g_hi * (1 - tt * 2) + g_mid * (tt * 2), g_mid * (1 - (tt - 0.5) * 2) + g_lo * ((tt - 0.5) * 2))
    over(gcol, green_a)
    over(style["inner"], inner_a)
    fcol = np.ones((h, w, 3), f32) * np.array(hexrgb(style["fill"]), f32)
    if gloss:  # faint warm shade at the bottom of each letter
        fcol = fcol * (1 - 0.06 * yy[..., None]) + np.array([0, 0, -0.01], f32) * yy[..., None]
    over(fcol, fill_a)
    out = np.dstack([np.clip(rgb, 0, 1), np.clip(a, 0, 1)])
    return Image.fromarray((out * 255 + 0.5).astype(np.uint8), "RGBA")


def cover_title(text, font_name, size, round_px=None, fatten_px=None, scale_x=1.0, tracking=0, **kw):
    pad = int(size * 0.35)
    m = glyph_mask(text, font_name, size, pad, scale_x=scale_x, tracking=tracking, ss=2)
    cap_h = size * 0.72
    rp = size * 0.02 if round_px is None else round_px
    fp = size * 0.012 if fatten_px is None else fatten_px
    mb = bubble(m, rp, fp)
    img = compose(mb, cap_h, **kw)
    bb = img.getbbox()
    return img.crop(bb) if bb else img
