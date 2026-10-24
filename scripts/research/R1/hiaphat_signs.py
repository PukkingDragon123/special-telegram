"""R1-streets: player's shop signs 'ร้านเฮียผัด' in 4 upgrade tiers, composited onto REAL photo
carriers (cardboard scan, rusty painted metal board, vinyl banner, light box) with LOOPED Thai
fonts only (Sriracha / Itim / Chonburi / Sarabun).  Text inherits the photo's surface texture.

usage: python3 -I hiaphat_signs.py
"""
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from photodecal import load_any, lum, smoothstep, feather, save_rgba, ellipse_mask  # noqa

SIGNS = "/home/user/special-telegram/public/assets/img/signs"
RAW = "/home/user/special-telegram/references/streets/_raw"
FONTS = "/home/user/special-telegram/scripts/_cache/fonts"
rng = np.random.default_rng(42)


def F(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size, layout_engine=ImageFont.Layout.RAQM)


def text_layer(W, H, lines, wobble=0.0, seed=0):
    """lines: list of (text, font, size, (cx,cy) in 0..1, colour rgb, stroke, stroke_rgb, rot_deg).
    Returns RGBA float array."""
    out = np.zeros((H, W, 4), np.float32)
    for (txt, fname, size, (cx, cy), col, stroke, scol, rot) in lines:
        f = F(fname, size)
        d0 = ImageDraw.Draw(Image.new("L", (8, 8)))
        bb = d0.textbbox((0, 0), txt, font=f, stroke_width=stroke, language="th")
        tw, th = bb[2] - bb[0] + 40, bb[3] - bb[1] + 40
        layer = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        d.text((20 - bb[0], 20 - bb[1]), txt, font=f, fill=tuple(int(c * 255) for c in col) + (255,),
               stroke_width=stroke, stroke_fill=tuple(int(c * 255) for c in scol) + (255,), language="th")
        if rot:
            layer = layer.rotate(rot, resample=Image.BICUBIC, expand=True)
        a = np.asarray(layer).astype(np.float32) / 255
        if wobble:
            # hand-made wobble: small smooth displacement field
            h, w = a.shape[:2]
            r = np.random.default_rng(seed + len(txt))
            dx = cv2.resize(r.standard_normal((h // 40 + 2, w // 40 + 2)).astype(np.float32), (w, h)) * wobble
            dy = cv2.resize(r.standard_normal((h // 40 + 2, w // 40 + 2)).astype(np.float32), (w, h)) * wobble
            gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
            a = cv2.remap(a, gx + dx, gy + dy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
        h, w = a.shape[:2]
        x0, y0 = int(cx * W - w / 2), int(cy * H - h / 2)
        xs, ys = max(0, x0), max(0, y0)
        xe, ye = min(W, x0 + w), min(H, y0 + h)
        sub = a[ys - y0:ye - y0, xs - x0:xe - x0]
        dst = out[ys:ye, xs:xe]
        al = sub[..., 3:4]
        dst[..., :3] = dst[..., :3] * (1 - al) + sub[..., :3] * al
        dst[..., 3:4] = np.maximum(dst[..., 3:4], al)
    return out


def paint_on(base_rgb, layer, absorb=0.55, wear=None, seed=0):
    """Composite paint/ink onto a photo surface: paint picks up the surface luminance (texture
    shows through), optional wear mask removes paint in places."""
    lb = lum(base_rgb)
    tex = (lb / max(lb.mean(), 1e-3))[..., None]
    col = layer[..., :3] * (1 - absorb + absorb * np.clip(tex, 0.3, 1.6))
    a = layer[..., 3]
    if wear is not None:
        a = a * wear
    return base_rgb * (1 - a[..., None]) + np.clip(col, 0, 1) * a[..., None]


def grain_wear(h, w, seed, lo=0.25, hi=0.45, scale=24):
    r = np.random.default_rng(seed)
    n = cv2.resize(r.standard_normal((h // scale + 2, w // scale + 2)).astype(np.float32), (w, h), interpolation=cv2.INTER_CUBIC)
    n2 = cv2.resize(r.standard_normal((h // 3 + 2, w // 3 + 2)).astype(np.float32), (w, h))
    v = (n * 0.8 + n2 * 0.35)
    v = (v - v.min()) / (v.max() - v.min())
    return smoothstep(lo, hi, v)


def save(name, rgb, alpha=None):
    a = np.ones(rgb.shape[:2], np.float32) if alpha is None else alpha
    save_rgba(np.dstack([np.clip(rgb, 0, 1), a]), os.path.join(SIGNS, name))
    print("wrote", name, rgb.shape[1], rgb.shape[0])


MAN = {}


def man(file, th, en, w, h, mount, kind, sources, notes):
    MAN[file] = {"file": file, "th": th, "en": en, "real_size_m": [w, h], "mount": mount, "kind": kind,
                 "source_ids": sources, "licence": "derived from CC0 / web photo carriers (see credits)",
                 "notes": notes, "fonts": "looped Thai only"}


def tier1_cardboard():
    c = load_any(RAW + "/cc0/ambientcg/Cardboard001/Cardboard001_2K-JPG_Color.jpg")[0][..., :3]
    c = c[0:1100, 200:1850]                      # mostly paper face, a few torn spots
    c = cv2.resize(c, (1024, 683), interpolation=cv2.INTER_AREA)
    H, W = c.shape[:2]
    # cut an irregular hand-torn outline
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    r = np.random.default_rng(3)
    edge = np.minimum(np.minimum(xx, W - 1 - xx), np.minimum(yy, H - 1 - yy))
    nz = cv2.resize(r.standard_normal((H // 20 + 2, W // 20 + 2)).astype(np.float32), (W, H), interpolation=cv2.INTER_CUBIC)
    alpha = smoothstep(6, 10, edge + nz * 6)
    ink = (0.06, 0.06, 0.07)
    lines = [("เฮียผัด", "Sriracha-Regular.ttf", 230, (0.5, 0.36), ink, 0, ink, -2.5),
             ("กะเพรา ไข่ดาว 40.-", "Itim-Regular.ttf", 92, (0.5, 0.70), (0.55, 0.06, 0.05), 0, ink, 1.5),
             ("อร่อย!!", "Sriracha-Regular.ttf", 64, (0.83, 0.90), ink, 0, ink, -8)]
    lay = text_layer(W, H, lines, wobble=2.5, seed=1)
    out = paint_on(c, lay, absorb=0.25, wear=grain_wear(H, W, 5, 0.08, 0.2, 6))
    # brown tape strips at the top corners
    for (x0, y0, ang) in ((40, 10, -20), (W - 170, 12, 18)):
        tape = Image.new("L", (W, H), 0)
        ImageDraw.Draw(tape).rectangle([x0, y0, x0 + 130, y0 + 38], fill=255)
        tape = tape.rotate(ang, center=(x0 + 65, y0 + 19), resample=Image.BICUBIC)
        tm = np.asarray(tape).astype(np.float32) / 255
        out = out * (1 - tm[..., None] * 0.55) + np.array([0.62, 0.45, 0.25]) * tm[..., None] * 0.55
    save("hiaphat_tier1_cardboard_handwritten.png", out, alpha)
    man("hiaphat_tier1_cardboard_handwritten.png", "เฮียผัด / กะเพรา ไข่ดาว 40.- / อร่อย!!",
        "Player shop tier 1: marker on a torn cardboard box flap (real cardboard scan), taped to the cart",
        0.6, 0.4, "taped to cart / leaning on stool", "player shop sign", ["ambientcg:Cardboard001"],
        "Text: Sriracha + Itim (looped). Blank cardboard can be reused for menu price edits.")


def tier2_painted_board():
    b = load_any(RAW + "/full/5799351b.jpg")[0][..., :3]
    q = np.array([[26, 30], [455, 52], [455, 293], [24, 268]], np.float32)
    W, H = 1024, 600
    M = cv2.getPerspectiveTransform(q, np.array([[0, 0], [W - 1, 0], [W - 1, H - 1], [0, H - 1]], np.float32))
    c = cv2.warpPerspective(b, M, (W, H), flags=cv2.INTER_LANCZOS4)
    rust = np.clip((c[..., 0] - c[..., 2]) * 3, 0, 1)
    red = (0.72, 0.08, 0.06)
    blue = (0.08, 0.18, 0.55)
    lines = [("ร้านเฮียผัด", "Chonburi-Regular.ttf", 150, (0.5, 0.33), red, 0, red, 0),
             ("อาหารตามสั่ง", "Sarabun-Bold.ttf", 100, (0.5, 0.63), blue, 0, blue, 0),
             ("โทร. 08x-xxx-xxxx", "Sarabun-Bold.ttf", 46, (0.5, 0.84), (0.1, 0.1, 0.1), 0, blue, 0)]
    lay = text_layer(W, H, lines, wobble=1.2, seed=2)
    wear = grain_wear(H, W, 9, 0.06, 0.2, 10) * np.clip(1 - rust * 1.6, 0, 1)
    out = paint_on(c, lay, absorb=0.4, wear=wear)
    save("hiaphat_tier2_painted_metal_board.png", out, np.ones((H, W), np.float32))
    man("hiaphat_tier2_painted_metal_board.png", "ร้านเฮียผัด / อาหารตามสั่ง / โทร. 08x-xxx-xxxx",
        "Player shop tier 2: hand-painted lettering on an old white enamel board with rust (real photo carrier)",
        1.6, 0.95, "hung in a steel frame on a pole / wired to the cart canopy", "player shop sign", ["5799351b"],
        "Chonburi + Sarabun (looped). Paint is worn off where the board is rusty.")


def tier3_vinyl():
    b = load_any(RAW + "/full/581dbead.jpg")[0][..., :3]
    q = np.array([[87, 121], [617, 121], [617, 394], [87, 394]], np.float32)
    W, H = 1280, 659
    M = cv2.getPerspectiveTransform(q, np.array([[0, 0], [W - 1, 0], [W - 1, H - 1], [0, H - 1]], np.float32))
    c = cv2.warpPerspective(b, M, (W, H), flags=cv2.INTER_LANCZOS4)
    shade = lum(c) / np.percentile(lum(c), 90)          # vinyl wrinkles/shading from the photo
    shade = np.clip(shade, 0.55, 1.1)[..., None]
    # printed design: red top band, yellow lower band, food photo circle
    design = np.ones((H, W, 3), np.float32) * np.array([0.98, 0.97, 0.94])
    design[: int(H * 0.56)] = np.array([0.80, 0.06, 0.07])
    design[int(H * 0.82):] = np.array([0.98, 0.78, 0.10])
    food = load_any(RAW + "/full/food_kaprao_cc0.jpg")[0][..., :3]
    fc = food[30:700, 300:1000]                        # plate only (avoid tablecloth print)
    D = int(H * 0.86)
    fc = cv2.resize(fc, (D, int(D * fc.shape[0] / fc.shape[1])), interpolation=cv2.INTER_AREA)
    fh, fw = fc.shape[:2]
    m = ellipse_mask(fh, fw, fw / 2, fh / 2, fw / 2 - 6, fh / 2 - 6, 0.0, 0, 0.03)
    x0, y0 = int(W * 0.72) - fw // 2, int(H * 0.47) - fh // 2
    ys, ye = max(0, y0), min(H, y0 + fh)
    xs, xe = max(0, x0), min(W, x0 + fw)
    ring = ellipse_mask(fh, fw, fw / 2, fh / 2, fw / 2 + 2, fh / 2 + 2, 0.0, 0, 0.02)
    sub = design[ys:ye, xs:xe]
    rr = ring[ys - y0:ye - y0, xs - x0:xe - x0][..., None]
    sub[:] = sub * (1 - rr) + np.array([1.0, 1.0, 1.0]) * rr
    mm = m[ys - y0:ye - y0, xs - x0:xe - x0][..., None]
    sub[:] = sub * (1 - mm) + fc[ys - y0:ye - y0, xs - x0:xe - x0] * mm
    white, yel, red, dark = (1, 1, 1), (1.0, 0.86, 0.12), (0.78, 0.05, 0.05), (0.12, 0.08, 0.06)
    lines = [("ร้านเฮียผัด", "Chonburi-Regular.ttf", 132, (0.30, 0.20), white, 7, (0.35, 0.02, 0.02), 0),
             ("อาหารตามสั่ง", "Sarabun-Bold.ttf", 84, (0.30, 0.43), yel, 0, yel, 0),
             ("กะเพรา  ข้าวผัด  ไข่เจียว", "Sarabun-Bold.ttf", 54, (0.30, 0.66), red, 0, red, 0),
             ("เริ่มต้น 40.-   โทร. 08x-xxx-xxxx", "Sarabun-Bold.ttf", 44, (0.30, 0.905), dark, 0, dark, 0)]
    lay = text_layer(W, H, lines, 0.0)
    design = design * (1 - lay[..., 3:4]) + lay[..., :3] * lay[..., 3:4]
    # sun fade + dirt, then apply the photo's vinyl shading
    fade = grain_wear(H, W, 21, 0.2, 0.9, 80)[..., None] * 0.12
    design = design * (1 - fade) + np.array([0.9, 0.88, 0.8]) * fade
    out = np.clip(design * shade, 0, 1)
    # keep the photo's grommets visible: blend original where it is dark & small (grommet rings)
    gm = np.zeros((H, W), np.float32)
    for gx, gy in ((0.03, 0.05), (0.97, 0.05), (0.03, 0.95), (0.97, 0.95)):
        gm = np.maximum(gm, ellipse_mask(H, W, gx * W, gy * H, 30, 30, 0.0, 0, 0.2))
    out = out * (1 - gm[..., None]) + c * gm[..., None]
    save("hiaphat_tier3_vinyl_banner_food_photo.png", out)
    man("hiaphat_tier3_vinyl_banner_food_photo.png", "ร้านเฮียผัด / อาหารตามสั่ง / กะเพรา ข้าวผัด ไข่เจียว / เริ่มต้น 40.-",
        "Player shop tier 3: printed vinyl banner with a real CC0 krapao food photo, on a real vinyl-banner "
        "photo carrier (wrinkles + grommets)", 2.0, 1.03, "tied with rope to the stall frame",
        "player shop sign", ["581dbead", "food_kaprao_cc0 (Commons CC0)"],
        "Chonburi + Sarabun (looped). Style follows real Thai tam-sang vinyl banners (banner_tamsang_paksaep_vinyl.png).")


def tier4_lightbox():
    b = load_any(RAW + "/full/c1af38ec.jpg")[0][..., :3]
    q = np.array([[205, 50], [497, 50], [497, 585], [205, 585]], np.float32)
    W, H = 560, 1024
    M = cv2.getPerspectiveTransform(q, np.array([[0, 0], [W - 1, 0], [W - 1, H - 1], [0, H - 1]], np.float32))
    c = cv2.warpPerspective(b, M, (W, H), flags=cv2.INTER_LANCZOS4)
    l = lum(c)
    face = smoothstep(0.80, 0.92, l)                    # the glowing white face of the box
    face = cv2.morphologyEx(face, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
    design = np.ones((H, W, 3), np.float32) * np.array([1.0, 0.98, 0.93])
    design[: int(H * 0.30)] = np.array([0.82, 0.07, 0.07])
    design[int(H * 0.86):] = np.array([0.06, 0.45, 0.22])
    red, white, green = (0.80, 0.05, 0.05), (1, 1, 1), (0.05, 0.42, 0.2)
    lines = [("ร้าน", "Chonburi-Regular.ttf", 110, (0.5, 0.15), white, 0, white, 0),
             ("เฮีย", "Chonburi-Regular.ttf", 170, (0.5, 0.42), red, 0, red, 0),
             ("ผัด", "Chonburi-Regular.ttf", 170, (0.5, 0.63), red, 0, red, 0),
             ("ตามสั่ง", "Sarabun-Bold.ttf", 78, (0.5, 0.79), green, 0, green, 0),
             ("24 ชม.", "Sarabun-Bold.ttf", 60, (0.5, 0.93), white, 0, white, 0)]
    lay = text_layer(W, H, lines, 0.0)
    design = design * (1 - lay[..., 3:4]) + lay[..., :3] * lay[..., 3:4]
    # inner face rectangle (where the photo is bright) gets the print; keep frame & wall from photo
    ys, xs = np.where(face > 0.5)
    y0, y1, x0, x1 = ys.min() + 6, ys.max() - 6, xs.min() + 6, xs.max() - 6
    dz = cv2.resize(design, (x1 - x0, y1 - y0), interpolation=cv2.INTER_AREA)
    out = c.copy()
    fm = face[y0:y1, x0:x1][..., None]
    out[y0:y1, x0:x1] = out[y0:y1, x0:x1] * (1 - fm) + dz * fm
    alpha = np.ones((H, W), np.float32)
    save("hiaphat_tier4_lightbox_vertical.png", out, alpha)
    em = np.zeros((H, W), np.float32)
    em[y0:y1, x0:x1] = fm[..., 0]
    save_rgba(np.dstack([np.dstack([em] * 3), np.ones_like(em)]), os.path.join(SIGNS, "hiaphat_tier4_lightbox_vertical_emissive.png"))
    man("hiaphat_tier4_lightbox_vertical.png", "ร้าน เฮียผัด ตามสั่ง 24 ชม.",
        "Player shop tier 4: projecting vertical light box (real light-box photo, printed face replaced)",
        0.6, 1.1, "projecting from facade on a bracket, 2.6-3.2 m", "player shop sign", ["c1af38ec"],
        "Use _emissive.png as emissive mask (face only) - glows at night.")


if __name__ == "__main__":
    tier1_cardboard(); tier2_painted_board(); tier3_vinyl(); tier4_lightbox()
    p = os.path.join(RAW, "manifest_signs_hiaphat.json")
    json.dump(MAN, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
