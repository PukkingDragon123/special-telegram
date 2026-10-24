#!/usr/bin/env python3
"""Accessories, text decals, hair, ghost and skin textures from REAL photos (R3-people).

Usage: python3 -I misc_build.py <cand_root> <polyhaven_dir> <font_dir> <out_root> [section ...]
sections: accessories decals hair ghosts skin
Writes into <out_root>/{clothing,hair,ghosts,faces}/ and merges records into each folder's
manifest.json (provenance = web image + page URL from the candidate index, or Poly Haven).
Thai text is rendered only with LOOPED Thai fonts (Sarabun, Chonburi, Pattaya, Noto Sans Thai Looped).
"""
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import phototex as P  # noqa: E402
import texlib as T  # noqa: E402

CAND, PH, FONTS, ROOT = sys.argv[1:5]
ONLY = set(sys.argv[5:])
MANS = {}


def want(s):
    return not ONLY or s in ONLY


def man(folder):
    if folder not in MANS:
        p = os.path.join(ROOT, folder, "manifest.json")
        MANS[folder] = json.load(open(p)) if os.path.exists(p) else {"textures": {}}
    return MANS[folder]


def src_info(rel):
    job, fn = rel.split("/")
    for e in json.load(open(os.path.join(CAND, job, "index.json"))):
        if e["file"] == fn:
            return {"type": "web photo", "image": e["image"], "page": e["page"], "title": e["title"][:120],
                    "licence": "unknown / all rights reserved by the owner (client-approved web use, see credits)"}
    return {"type": "web photo", "image": "?", "page": "?"}


def ph_info(asset):
    return {"type": "photo scan", "image": f"https://polyhaven.com/a/{asset}", "page": f"https://polyhaven.com/a/{asset}",
            "author": "Poly Haven", "licence": "CC0"}


def cand(rel):
    return P.load(os.path.join(CAND, rel))


def ph(asset, m="Diffuse"):
    for ext in ("jpg", "png"):
        p = os.path.join(PH, f"{asset}__{m}.{ext}")
        if os.path.exists(p):
            return P.load(p)
    raise FileNotFoundError(asset)


def put(folder, name, img, desc, sources, kind="tileable", size=None, ext="jpg", extra=None, normal=None):
    d = os.path.join(ROOT, folder)
    os.makedirs(d, exist_ok=True)
    if size is not None:
        if isinstance(size, int):
            size = (size, size)
        img = cv2.resize(img, size, interpolation=cv2.INTER_AREA if img.shape[1] > size[0] else cv2.INTER_CUBIC)
    fn = f"{name}.{ext}"
    T.save(os.path.join(d, fn), img, quality=88)
    rec = {"file": fn, "size": [img.shape[1], img.shape[0]], "kind": kind, "desc": desc, "sources": sources}
    if normal is not None:
        n = cv2.resize(normal, (img.shape[1], img.shape[0]), interpolation=cv2.INTER_AREA)
        T.save(os.path.join(d, name + "_normal.jpg"), n, quality=90)
        rec["normal"] = name + "_normal.jpg"
    if extra:
        rec.update(extra)
    man(folder)["textures"][name] = rec
    print(folder, fn, rec["size"])


def seamless(img, box=None, flatten=0.2, strength=0.7):
    reg = P.crop(img, box) if box else img
    return P.periodic(P.flatten_light(reg, flatten, strength))


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


def text_mask(w, h, lines, fnt_specs, anchor_y):
    """lines: list of str; fnt_specs: list of (font, y); returns float mask HxW."""
    im = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(im)
    for txt, (f, y) in zip(lines, fnt_specs):
        bb = d.textbbox((0, 0), txt, font=f)
        x = (w - (bb[2] - bb[0])) / 2 - bb[0]
        d.text((x, y), txt, font=f, fill=255)
    return np.asarray(im, np.float32) / 255.0


def satin_patch():
    """A real satin-stitch thread patch (photo of embroidered letters), luminance detail, mean 1."""
    im = cand("embroidery_blue/01.jpg")
    hsv = cv2.cvtColor(im, cv2.COLOR_RGB2HSV)
    m = ((hsv[..., 1] > 0.45) & (hsv[..., 2] > 0.25)).astype(np.uint8)
    dist = cv2.distanceTransform(m, cv2.DIST_L2, 5)
    y, x = np.unravel_index(np.argmax(dist), dist.shape)
    r = int(dist[y, x] * 0.65)
    patch = im[y - r:y + r, x - r:x + r]
    Y = patch.mean(-1)
    Y = Y / (cv2.GaussianBlur(Y, (0, 0), r * 0.5) + 1e-4)
    return P.periodic(np.clip(Y / Y.mean(), 0.4, 1.6)), "embroidery_blue/01.jpg"


def embroider(base, mask, thread_rgb, satin, scale=0.35):
    """Composite embroidered text: thread colour x real satin-stitch detail, raised shading."""
    h, w = mask.shape
    sp = cv2.resize(satin, (max(8, int(satin.shape[1] * scale)), max(8, int(satin.shape[0] * scale))))
    reps = (h // sp.shape[0] + 2, w // sp.shape[1] + 2)
    det = np.tile(sp, reps)[:h, :w]
    m = cv2.GaussianBlur(mask, (0, 0), 0.6)
    dist = cv2.GaussianBlur(cv2.distanceTransform((mask > 0.5).astype(np.uint8), cv2.DIST_L2, 3), (0, 0), 1.0)
    bevel = np.clip(dist / 2.5, 0, 1) * 0.25 + 0.75
    thread = np.float32(thread_rgb)[None, None, :] * (det * bevel)[..., None]
    shadow = cv2.GaussianBlur(np.roll(np.roll(mask, 2, 0), 1, 1), (0, 0), 1.5) * (1 - m)
    out = base * (1 - 0.35 * shadow[..., None])
    return out * (1 - m[..., None]) + np.clip(thread, 0, 1) * m[..., None], m


# =============================================================================== accessories
if want("accessories"):
    src = "flipflop_bluewhite/01.jpg"
    im = cand(src)
    hsv = cv2.cvtColor(im, cv2.COLOR_RGB2HSV)
    top = P.crop(im, (395, 180, 680, 730))
    put("clothing", "flipflop_top_photo", top, "real top view of a blue-strap / white-sole rubber thong slipper (ช้างดาว style) — sole-top UV decal", [src_info(src)], kind="photo decal", size=(256, 512))
    sub = P.crop(im, (395, 180, 680, 730))
    shsv = cv2.cvtColor(sub, cv2.COLOR_RGB2HSV)
    wm = ((shsv[..., 1] < 0.10) & (shsv[..., 2] > 0.70)).astype(np.uint8)
    wm = cv2.morphologyEx(wm, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    dist = cv2.distanceTransform(wm, cv2.DIST_L2, 5)
    sy, sx = np.unravel_index(np.argmax(dist), dist.shape)
    r = max(12, int(dist[sy, sx] * 0.7))
    sole = seamless(sub, (sx - r, sy - r, sx + r, sy + r), 0.3, 0.8)
    put("clothing", "flipflop_sole_rubber", sole, "white rubber sole (tileable, from the same photo)", [src_info(src)], size=256)
    blue = im[(hsv[..., 0] > 200) & (hsv[..., 0] < 240) & (hsv[..., 1] > 0.55) & (hsv[..., 2] > 0.35)]
    bcol = np.percentile(blue, 70, axis=0).astype(np.float32) if len(blue) > 50 else np.float32([0.18, 0.37, 0.69])
    strap = P.colorize(sole, tuple(bcol), 1.3)
    put("clothing", "flipflop_strap_blue", strap, "blue rubber strap (colour sampled from the real slipper's straps, rubber detail from its sole)", [src_info(src)], size=256, extra={"strapRGB": T.rgb2hex(bcol)})

    src = "sneaker_white/01.jpg"
    im = cand(src)
    put("clothing", "sneaker_white_worn_photo", P.crop(im, (400, 120, 1010, 990)), "real photo of a worn white canvas sneaker (side / front) — decal reference for shoe UVs", [src_info(src)], kind="photo decal", size=(512, 728))

    src = "bucket_hat/01.jpg"
    im = cand(src)
    t = seamless(im, (100, 150, 600, 500), 0.25, 0.8)
    put("clothing", "bucket_hat_khaki", t, "washed khaki cotton bucket-hat crown fabric", [src_info(src)], size=512, normal=P.normal_from(t, 1.5))
    brim = P.crop(im, (0, 650, 700, 950))
    put("clothing", "bucket_hat_brim_stitched", seamless(brim, None, 0.25, 0.8), "bucket-hat brim with concentric stitch lines (real photo)", [src_info(src)], size=(512, 256))

    src = "cap_fabric/05.jpg"
    im = cand(src)
    cap = seamless(im, (250, 380, 750, 620), 0.25, 0.8)
    cap = np.tile(cap, (2, 1, 1))
    put("clothing", "cap_washed_lilac", cap, "washed cotton-twill baseball cap fabric (faded lilac)", [src_info(src)], size=512)
    navy = P.colorize(cap, (0.12, 0.15, 0.27), 1.1)
    put("clothing", "cap_washed_navy", navy, "same cap twill recoloured faded navy", [src_info(src)], size=512)

    src = "sunglass_lens/04.jpg"
    lens = P.crop(cand(src), (180, 180, 570, 570))
    lens = cv2.resize(lens, (256, 256), interpolation=cv2.INTER_AREA)
    yy = np.linspace(0, 1, 256)[:, None, None]
    top_col = np.float32([0.21, 0.07, 0.04])
    g = np.clip(1 - yy * 1.6, 0, 1) * 0.65
    lens_g = lens * (1 - g) + top_col * g
    put("clothing", "sunglass_lens_amber", lens_g, "ref4 afro guy: amber-brown tinted lens, darker at the top (real lens photo + gradient); use alpha ~0.75, roughness 0.05", [src_info(src)], kind="lens")

# =============================================================================== decals (text)
if want("decals"):
    satin, satin_src = satin_patch()
    base = cv2.resize(P.colorize(ph("stretch_poplin"), (0.93, 0.93, 0.91), 0.8), (512, 256), interpolation=cv2.INTER_AREA)
    sar = "Sarabun-Bold.woff2"
    for nm, l1, l2, l3 in [("nametag_boy", "ผ.ว.", "ด.ช. สมชาย ใจดี", "ม.2/5"), ("nametag_girl", "ผ.ว.", "ด.ญ. มะลิ ศรีสุข", "ม.3/1")]:
        m = text_mask(512, 256, [l2, l1 + "  " + l3], [(font(sar, 58), 40), (font(sar, 50), 140)], 0)
        img, a = embroider(base.copy(), m, (0.10, 0.22, 0.62), satin, 0.18)
        put("clothing", nm, img, f"Thai school-shirt chest embroidery on white poplin: name '{l2}', parody school initials '{l1}' (โรงเรียนผัดวิทยา) + class; blue satin stitch = real embroidery photo detail; font Sarabun (looped)",
            [src_info(satin_src), ph_info("stretch_poplin")], kind="decal on fabric", extra={"font": "Sarabun Bold (OFL, looped Thai)"})
        rgba = np.dstack([img, np.clip(a * 1.2, 0, 1)])
        put("clothing", nm + "_alpha", rgba, "same embroidery as an RGBA decal (alpha = thread only)", [src_info(satin_src)], kind="decal (RGBA)", ext="png")
    # parody rider logos (original names, not real brands)
    for nm, th, en, bg in [("rider_logo_khunhiw", "คุณหิว", "KHUN HIW delivery", (0.0, 0.62, 0.30)),
                           ("rider_logo_pinto", "ปิ่นโต", "PINTO food", (0.86, 0.10, 0.48))]:
        jacket = cv2.resize(P.colorize(ph("bi_stretch"), bg, 1.0), (512, 512), interpolation=cv2.INTER_AREA)
        m = text_mask(512, 512, [th, en], [(font("Chonburi-Regular.woff2", 120), 120), (font("Chonburi-Regular.woff2", 46), 330)], 0)
        mm = cv2.GaussianBlur(m, (0, 0), 0.7)[..., None]
        # screen-printed plastisol: white ink with the fabric weave showing through, slight cracks
        weave = T.detail_from_photo(jacket, 6.0)
        ink = np.clip(np.float32([0.97, 0.97, 0.96]) * np.clip(weave, 0.85, 1.1)[..., None], 0, 1)
        img = jacket * (1 - mm) + ink * mm
        put("clothing", nm, img, f"PARODY delivery-rider jacket back print '{th} / {en}' (original name, no real brand), white plastisol on polyester; font Chonburi (looped Thai)",
            [ph_info("bi_stretch")], kind="print panel", extra={"font": "Chonburi (OFL, looped Thai)"})
    # parody cap front embroidery
    cap = cv2.resize(P.load(os.path.join(ROOT, "clothing", "cap_washed_navy.jpg")), (512, 512))
    m = text_mask(512, 512, ["เฮียผัด", "HIA PHAT"], [(font("Chonburi-Regular.woff2", 110), 150), (font("Chonburi-Regular.woff2", 50), 300)], 0)
    img, a = embroider(cap, m, (0.95, 0.93, 0.88), satin, 0.15)
    put("clothing", "cap_front_hiaphat", img, "cap front panel with the game's own parody logo 'เฮียผัด / HIA PHAT' in white satin-stitch embroidery (real thread photo detail), font Chonburi",
        [src_info(satin_src), src_info("cap_fabric/05.jpg")], kind="print panel", extra={"font": "Chonburi (OFL, looped Thai)"})

# =============================================================================== hair
def strand_card(photo, w, h, tip=0.35, seed=0, root_fade=0.0):
    """Hair card RGBA from a real hair photo with vertical strands: alpha from strand detail."""
    ph_ = cv2.resize(photo, (w, h), interpolation=cv2.INTER_AREA)
    Y = ph_.mean(-1)
    hp = Y - cv2.GaussianBlur(Y, (0, 0), 3)
    hp = (hp - hp.mean()) / (hp.std() + 1e-6)
    # strand-coherent noise: blur strongly along y
    sn = cv2.GaussianBlur(hp, (0, 0), sigmaX=0.8, sigmaY=12)
    sn = (sn - sn.mean()) / (sn.std() + 1e-6)
    yy = np.linspace(0, 1, h)[:, None]
    xx = np.linspace(-1, 1, w)[None, :]
    rng = np.random.default_rng(seed)
    # tip length varies per column (clumps)
    col = cv2.GaussianBlur(rng.standard_normal((1, w)).astype(np.float32), (0, 0), sigmaX=w * 0.03).ravel()
    col = (col - col.mean()) / (col.std() + 1e-6)
    end = 1 - tip * (0.5 + 0.35 * col)[None, :]
    body = np.clip((end - yy) / (tip * 0.6) + 0.35 * sn, 0, 1)
    side = np.clip((1 - np.abs(xx)) / 0.18 + 0.3 * sn, 0, 1)
    a = body * side
    if root_fade > 0:
        a *= np.clip(yy / root_fade + 0.3 * sn, 0, 1)
    a = np.clip(a * 1.15, 0, 1)
    return np.dstack([ph_, a])


if want("hair"):
    src = "hair_black_straight/03.jpg"
    im = cand(src)
    t = seamless(im, (100, 100, 1780, 1780), 0.2, 0.6)
    put("hair", "hair_black_straight", t, "black straight hair, strands along V (tileable) — shells for crew cuts, side-parts, bobs, long hair", [src_info(src)], size=1024, normal=P.normal_from(t, 1.5))
    long_src = P.crop(im, (100, 100, 1780, 1780))
    atlas = np.zeros((1024, 1024, 4), np.float32)
    specs = [(0, 256, 1024, 0.30, 1), (256, 256, 1024, 0.45, 2), (512, 256, 640, 0.40, 3), (768, 256, 640, 0.55, 4)]
    for x0, w, h, tip, seed in specs:
        sub = long_src[:, (seed - 1) * 400:(seed - 1) * 400 + 400]
        card = strand_card(sub, w, h, tip, seed)
        atlas[:h, x0:x0 + w] = card
    short = strand_card(long_src[:600, 1200:1600], 256, 384, 0.6, 7)
    short2 = strand_card(long_src[700:1300, 400:800], 256, 384, 0.7, 8)
    atlas[640:1024, 512:768] = short
    atlas[640:1024, 768:1024] = short2
    atlas[..., :3] = np.where(atlas[..., 3:4] > 0.01, atlas[..., :3], np.float32([0.03, 0.025, 0.025]))
    put("hair", "hair_cards_black", atlas, "alpha hair-card atlas from a real black-hair photo: [0-256] long card, [256-512] long wispy card (ref4 left guy / long female hair / Mae Nak), [512-768,0-640] medium, [768-1024,0-640] ponytail strip, bottom-right two short clumps (fringe, mullet, two-block top)",
        [src_info(src)], kind="hair cards (RGBA, alpha-test 0.35 or alpha-hash)", ext="png",
        extra={"cards": {"long": [0, 0, 256, 1024], "long_wispy": [256, 0, 256, 1024], "medium": [512, 0, 256, 640], "ponytail": [768, 0, 256, 640], "short_a": [512, 640, 256, 384], "short_b": [768, 640, 256, 384]}})
    # bob edge card: straight cut
    bob = strand_card(long_src[200:1000, 800:1600], 512, 256, 0.10, 11)
    put("hair", "hair_card_bob_edge", bob, "school-bob (ผมติ่งหู) edge card: straight blunt cut at the bottom", [src_info(src)], kind="hair card (RGBA)", ext="png")

    src = "hair_grey/04.jpg"
    t = seamless(cand(src), (330, 320, 1080, 1070), 0.2, 0.6)
    put("hair", "hair_salt_pepper", t, "salt-and-pepper grey straight hair (uncles 55+, grandmas)", [src_info(src)], size=1024, normal=P.normal_from(t, 1.5))

    src = "hair_brown_dyed/01.jpg"
    reg = np.ascontiguousarray(np.rot90(P.crop(cand(src), (0, 120, 2048, 900)), 1))
    t = seamless(reg, None, 0.2, 0.6)
    put("hair", "hair_dyed_brown", t, "dyed chestnut-brown hair (เด็กแว้น mullets, aunties, young women), strands along V", [src_info(src)], size=1024, normal=P.normal_from(t, 1.5))

    src = "hair_afro/05.jpg"
    im = cand(src)
    Y = im.mean(-1)
    ys, xs = np.nonzero(Y < 0.35)
    x0, x1 = np.percentile(xs, [20, 80])
    y0, y1 = np.percentile(ys, [15, 70])
    t = seamless(im, (x0, y0, x1, y1), 0.15, 0.6)
    put("hair", "hair_afro_black", t, "ref4 standing guy: black afro (tight coils), use on a lumpy noise-displaced shell", [src_info(src)], size=512, normal=P.normal_from(t, 2.5))

    src = "hair_perm/06.jpg"
    t = seamless(cand(src), None, 0.2, 0.5)
    put("hair", "hair_perm_light_brown", t, "auntie perm curls (light brown / highlighted)", [src_info(src)], size=512, normal=P.normal_from(t, 2.5))
    dark = P.colorize(t, (0.13, 0.07, 0.06), 1.25)
    put("hair", "hair_perm_dark_burgundy", dark, "auntie perm curls recoloured to the classic dark burgundy-brown dye", [src_info(src)], size=512, normal=P.normal_from(t, 2.5))
    blk = P.colorize(t, (0.05, 0.045, 0.045), 1.3)
    put("hair", "hair_perm_black", blk, "auntie perm curls, black", [src_info(src)], size=512, normal=P.normal_from(t, 2.5))

    src = "hair_buzz/01.jpg"
    t = seamless(cand(src), (340, 330, 690, 600), 0.2, 0.7)
    put("hair", "hair_buzz_scalp", t, "buzz cut / ทรงนักเรียน: short dark stubble over scalp (tileable; tint the scalp with the skin colour if needed)", [src_info(src)], size=512, normal=P.normal_from(t, 2.0))

# =============================================================================== ghosts
if want("ghosts"):
    src = "ghost_intestines/06.jpg"
    im = cand(src)
    t = seamless(im, (120, 200, 620, 430), 0.15, 0.7)
    t = np.tile(t, (2, 1, 1))
    sat = cv2.cvtColor(t.astype(np.float32), cv2.COLOR_RGB2HSV)
    raw = np.clip(t * np.float32([1.05, 0.88, 0.9]), 0, 1)
    put("ghosts", "krasue_entrails_albedo", raw, "Krasue intestines albedo: real raw pork-intestine photo (tile along U on a tube)", [src_info(src)], size=1024, normal=P.normal_from(t, 3.0))
    Y = t.mean(-1)
    spec = np.clip((Y - np.percentile(Y, 80)) / (np.percentile(Y, 99) - np.percentile(Y, 80) + 1e-4), 0, 1)
    loc = Y - cv2.GaussianBlur(Y, (0, 0), 6)
    spec = np.clip((loc - np.percentile(loc, 88)) / (np.percentile(loc, 99.5) - np.percentile(loc, 88) + 1e-4), 0, 1)
    body = cv2.GaussianBlur(Y, (0, 0), 10)
    body = np.clip((body - body.min()) / (body.max() - body.min() + 1e-4), 0, 1)
    glow = np.clip(0.9 * cv2.GaussianBlur(spec, (0, 0), 1.5) + 0.22 * body ** 2, 0, 1)
    em = glow[..., None] * np.float32([0.61, 1.0, 0.42])
    put("ghosts", "krasue_entrails_emissive", em, "emissive map (green-yellow ไฟกระสือ glow) derived from the wet highlights & fat of the same photo; multiply by a pulsing intensity, bloom on", [src_info(src)], size=1024)

    src = "ghost_rag/02.jpg"
    im = cand(src)
    reg = P.crop(im, (30, 0, 640, 900))
    Y = reg.mean(-1)
    a = np.clip((Y - 0.18) / 0.25, 0, 1)
    a = cv2.GaussianBlur(a, (0, 0), 0.7)
    rgb = np.where(a[..., None] > 0.05, reg / np.maximum(a[..., None], 0.3), reg)
    rgba = np.dstack([np.clip(rgb, 0, 1), a])
    put("ghosts", "ghost_rag_white", rgba, "tattered off-white cloth with torn, frayed edges and holes (real photo, alpha from the black backdrop) — Mae Nak / white-lady dress hem, ghost shrouds", [src_info(src)], kind="RGBA cut-out", size=(512, 768), ext="png")

    src = "ghost_green_silk/07.jpg"
    im = cand(src)
    panel = P.crop(im, (320, 40, 900, 1000))
    panel = P.flatten_light(panel, 0.3, 0.6)
    put("ghosts", "nangtani_green_silk", panel, "Nang Tani pha sin: real green Thai silk with woven gold/white diamond pattern and a purple-gold border band at the bottom (wrap horizontally; V = skirt height)", [src_info(src)], kind="panel (tile U)", size=(1024, 1024))
    patt = seamless(im, (260, 40, 940, 420), 0.25, 0.6)
    put("ghosts", "nangtani_green_silk_pattern", patt, "the same silk's green diamond body pattern, tileable both ways (sabai / shawl)", [src_info(src)], size=512)

    src = "ghost_banana_leaf/02.jpg"
    t = seamless(cand(src), (0, 0, 2048, 1362), 0.25, 0.6)
    put("ghosts", "banana_leaf", t, "banana-leaf surface with midrib and parallel veins (real photo) — Nang Tani's banana trees, leaf cards", [src_info(src)], size=1024, normal=P.normal_from(t, 2.0))

    src = "ghost_grey_skin/04.jpg"
    t = seamless(cand(src), (0, 0, 2000, 1333), 0.2, 0.7)
    lab = cv2.cvtColor(t.astype(np.float32), cv2.COLOR_RGB2LAB)
    lab[..., 1] = lab[..., 1] * 0.25
    lab[..., 2] = lab[..., 2] * 0.25 - 3
    g = np.clip(cv2.cvtColor(lab, cv2.COLOR_LAB2RGB), 0, 1)
    put("ghosts", "pret_grey_skin", g, "Pret / Phi Pop: deeply wrinkled grey skin (real elephant-skin photo, desaturated to cement grey with a blue undertone)", [src_info(src)], size=1024, normal=P.normal_from(t, 3.0))

    src = "rust_paint/01.jpg"
    im = cand(src)
    t = seamless(im, (0, 0, 720, 720), 0.2, 0.6)
    yy = np.linspace(0, 1, t.shape[0])[:, None, None]
    soot = T.fbm(t.shape[0], t.shape[1], beta=2.2, seed=3)[..., None]
    burn = np.clip(0.35 + 0.25 * soot, 0, 1)
    burnt = t * (1 - burn * 0.55)
    put("ghosts", "ghost_moto_burnt", burnt, "headless rider's motorbike: burnt, peeling blue-grey paint over orange rust (real photo, soot darkened)", [src_info(src)], size=1024, normal=P.normal_from(t, 3.0))

    for nm, src, box in [("ghost_mist_a", "ghost_smoke/01.jpg", (0, 0, 626, 626)), ("ghost_mist_b", "ghost_smoke/03.jpg", None)]:
        im = cand(src)
        reg = P.crop(im, box) if box else im
        h, w = reg.shape[:2]
        n = min(h, w)
        reg = reg[(h - n) // 2:(h - n) // 2 + n, (w - n) // 2:(w - n) // 2 + n]
        Y = reg.mean(-1)
        Y = P.periodic(Y)
        Y = np.clip((Y - np.percentile(Y, 2)) / (np.percentile(Y, 99.5) - np.percentile(Y, 2)), 0, 1)
        put("ghosts", nm, np.dstack([Y] * 3), "real smoke photo (on black) as greyscale, made seamless — use as alpha / density for ghost mist quads; scroll UVs slowly", [src_info(src)], size=512)

# =============================================================================== skin (faces folder)
def skin_detail(img, box, sigma=18):
    reg = P.crop(img, box) if box else img
    reg = P.flatten_light(reg, 0.2, 1.0)
    d = T.detail_from_photo(reg, sigma)
    d = np.clip(d, 0.6, 1.4)
    d = P.periodic(d)
    lin = 0.2158 * d  # same neutral grey as the face *_detail maps (sRGB 128 = no change)
    return np.dstack([T.lin_to_srgb(lin)] * 3)


if want("skin"):
    for nm, src, box, desc in [("skin_detail_pores_a", "skin_macro/05.jpg", (500, 250, 950, 700), "cheek pores (real macro photo)"),
                               ("skin_detail_lines_b", "skin_macro/01.jpg", (0, 0, 800, 590), "fine skin lines / back-of-hand texture (real macro photo)"),
                               ("skin_detail_pores_c", "skin_macro/02.jpg", None, "pores + faint freckles (real macro photo)")]:
        im = cand(src)
        if box is None:
            h, w = im.shape[:2]
            box = (w * 0.35, h * 0.3, w * 0.75, h * 0.7)
        put("faces", nm, skin_detail(im, box), f"tileable neutral skin detail: {desc}. Multiply: albedo = skinRGB * detail / 0.5 (linear: skinLin * srgb2lin(detail) / 0.2158)", [src_info(src)], size=512)
    for nm, src, box, desc in [("hand_back", "hand_top/06.jpg", (60, 160, 560, 1000), "back of a hand, fingers spread (real photo, background filled with the hand's own skin colour)"),
                               ("foot_top", "foot_top/03.jpg", (370, 220, 640, 690), "bare foot from above (real photo, background filled with the foot's own skin colour)")]:
        im = P.crop(cand(src), box)
        Y = im.mean(-1)
        fg = (Y < 0.93).astype(np.uint8)
        fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
        n, cc, st, _ = cv2.connectedComponentsWithStats(fg)
        if n > 1:
            k = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
            fg = (cc == k).astype(np.uint8)
        fgs = cv2.GaussianBlur(cv2.erode(fg, np.ones((5, 5), np.uint8)).astype(np.float32), (0, 0), 3)
        lin = T.srgb_to_lin(im)
        avg = lin[fg > 0].mean(0)
        out = lin * fgs[..., None] + avg[None, None, :] * (1 - fgs[..., None])
        put("faces", nm, T.lin_to_srgb(out), desc + " — planar-project on low-poly hands/feet; use the *_detail map for recolouring",
            [src_info(src)], kind="projection", size=(256, 512) if box[3] - box[1] > box[2] - box[0] else 512,
            extra={"avgSkinRGB": [int(round(c * 255)) for c in T.lin_to_srgb(avg)]})
        det = T.lin_to_srgb(np.clip(0.2158 * out / avg[None, None, :], 0, 1))
        put("faces", nm + "_detail", det, "recolourable version (divide by average skin, neutral grey = 128)", [src_info(src)], kind="projection",
            size=(256, 512) if box[3] - box[1] > box[2] - box[0] else 512)

for folder, m in MANS.items():
    json.dump(m, open(os.path.join(ROOT, folder, "manifest.json"), "w"), ensure_ascii=False, indent=1)
