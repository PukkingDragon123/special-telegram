"""R1-streets: curbs, asphalt and road-marking textures (Thai conventions).

usage: python3 -I tex_ground2.py [job ...]   jobs: curbs asphalt lines zebra roadtext
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texlib import *  # noqa
from tex_ground import write_material, stains_layer, crack_layer, MAN, base_concrete  # noqa

from PIL import Image, ImageDraw


# ------------------------------------------------------------------ curbs
def curb(name, colours, seg_m=0.5, seed=0, paint=True):
    W, H = 2048, 512          # 2.0 m (U, along curb) x 0.5 m (V, unfolded profile)
    ppm = W / 2.0
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    top_end, arris_end = int(0.20 * ppm), int(0.24 * ppm)
    zone_top = (y < top_end).astype(np.float32)
    zone_arris = ((y >= top_end) & (y < arris_end)).astype(np.float32)
    zone_face = (y >= arris_end).astype(np.float32)
    face_t = np.clip((y - arris_end) / (H - arris_end), 0, 1)        # 0 at arris -> 1 at road
    # concrete base (tileable in U because both sources tile at 2048/1024 periods)
    c = ph("brushed_concrete", "diff", 1024)
    hc = ph("brushed_concrete", "disp", 1024)
    c = np.concatenate([c, c], 1)[:H]
    hc = np.concatenate([hc, hc], 1)[:H]
    l = lum(c) / lum(c).mean()
    conc = hex2rgb("#8f8b83") * (0.65 + 0.35 * l)[..., None]
    hgt = 0.5 + (hc - 0.5) * 0.15
    # precast blocks = paint segments (0.5 m): joint at every boundary
    blk = seg_m * ppm
    dj = np.minimum(x % blk, blk - (x % blk))
    joint = 1 - smoothstep(1.5, 3.5, dj)
    chipn = fbm(H, W, 1.8, seed=seed + 2)
    chip = smoothstep(0.62, 0.8, chipn) * (1 - smoothstep(0, 18, dj)) * (zone_arris + zone_face * (face_t < 0.3))
    hgt -= joint * 0.3 + chip * 0.15
    alb = conc.copy()
    cover = np.zeros((H, W), np.float32)
    if paint:
        # wobbly hand-painted boundaries
        wob = (fbm(H, W, 3.0, seed=seed + 3) - 0.5) * 0.012 * ppm
        segf = (x + wob) / (seg_m * ppm)
        segi = np.floor(segf).astype(int) % len(colours)
        pal = np.array([hex2rgb(cc) for cc in colours])
        pcol = pal[segi]
        # per-segment fading (reds -> pinkish/orange, whites -> grey) and repaint age
        rngs = np.random.default_rng(seed)
        nseg = int(round(2.0 / seg_m))
        fade = rngs.uniform(0.05, 0.4, nseg)
        sidx = np.floor(segf).astype(int) % nseg
        f = fade[sidx][..., None]
        pcol = lerp(pcol, pcol * 0.7 + hex2rgb("#b8a796") * 0.3, f)
        # brush streaks along U
        streaks = fbm(H, W // 8, 1.6, seed=seed + 14)
        streaks = np.repeat(streaks, 8, axis=1)[:, :W]
        streaks = blur(streaks, 2)
        pcol = pcol * (0.93 + 0.12 * streaks)[..., None]
        # older paint coat underneath (shows in chips): colours shifted by one segment
        old = pal[(segi + 1) % len(colours)] * 0.8 + hex2rgb("#9c8f82") * 0.2
        n1 = fbm(H, W, 1.8, seed=seed + 4)
        n2 = fbm(H, W, 1.2, seed=seed + 5)
        n3 = fbm(H, W, 2.6, seed=seed + 15)
        wear = (zone_arris * 0.42 + zone_top * 0.16 +
                zone_face * (0.12 + 0.45 * smoothstep(0.6, 1.0, face_t)))
        wear = wear + (n3 - 0.5) * 0.25
        cover = smoothstep(wear - 0.08, wear + 0.08, n1 * 0.6 + n2 * 0.4)
        cover *= (1 - joint * 0.7) * (1 - chip)
        oldcover = smoothstep(0.45, 0.55, fbm(H, W, 1.6, seed=seed + 16)) * (1 - cover)
        under = lerp(conc, old * (0.8 + 0.2 * l)[..., None], oldcover * 0.8)
        thin = np.clip(l, 0.5, 1.6) ** 1.25             # thin paint: concrete relief shows
        alb = lerp(under, pcol * thin[..., None], cover)
        hgt += cover * 0.015
        # fine dark speckles (grit stuck in paint) and dirt film
        spk = smoothstep(0.78, 0.9, fbm(H, W, 0.6, seed=seed + 20))
        alb = alb * (1 - spk[..., None] * 0.45)
        film = 0.18 + 0.3 * smoothstep(0.3, 0.9, fbm(H, W, 2.3, seed=seed + 21))
        alb = lerp(alb, hex2rgb("#6e665b") * thin[..., None], film * (0.6 + 0.4 * zone_top))
    if not paint:
        spk = smoothstep(0.76, 0.9, fbm(H, W, 0.6, seed=seed + 20))
        alb = alb * (1 - spk[..., None] * 0.4)
        film = 0.2 + 0.35 * smoothstep(0.3, 0.9, fbm(H, W, 2.3, seed=seed + 21))
        alb = lerp(alb, hex2rgb("#5f584e") * (0.7 + 0.3 * l)[..., None], film)
        alb = alb * (0.75 + 0.35 * fbm(H, W, 1.8, seed=seed + 22))[..., None]
    # rain streaks running down the face from the arris (dirt washed down)
    sn = smoothstep(0.55, 0.8, fbm(H, W, 1.3, seed=seed + 17))
    rain = motion_blur_v(sn, 90) * zone_face * (1 - face_t * 0.3)
    alb = alb * (1 - rain[..., None] * 0.28)
    # road grime: dark band at the bottom of the face + vertical splash streaks
    streak = motion_blur_v(fbm(H, W, 1.2, seed=seed + 6), 60)
    gb = (fbm(H, W, 2.2, seed=seed + 19) - 0.5) * 0.35
    grime = zone_face * smoothstep(0.5, 1.05, face_t + gb) * (0.55 + 0.45 * streak)
    alb = lerp(alb, hex2rgb("#2c2924"), np.clip(grime, 0, 1) * 0.75)
    # tyre rubber scuffs: horizontal dark smears on the face
    r = np.random.default_rng(seed + 7)
    tyre = np.zeros((H, W), np.float32)
    for _ in range(0):
        cy = r.uniform(arris_end + 40, H - 30)
        cx = r.uniform(0, W)
        L = r.uniform(80, 420)
        hh = r.uniform(6, 22)
        dx = np.minimum(np.abs(x - cx), W - np.abs(x - cx))
        tyre = np.maximum(tyre, (1 - smoothstep(L * 0.3, L * 0.5, dx)) * (1 - smoothstep(0, hh, np.abs(y - cy))) * r.uniform(0.4, 0.9))
    tyre *= zone_face * (0.5 + 0.5 * fbm(H, W, 1.0, seed=seed + 8))
    alb = lerp(alb, hex2rgb("#1d1b19"), tyre * 0.7)
    # dust & footprints on top surface, general dirt
    dust = zone_top * (0.25 + 0.35 * fbm(H, W, 2.2, seed=seed + 9))
    alb = lerp(alb, hex2rgb("#8e8578"), dust * 0.5)
    alb = alb * (0.78 + 0.3 * fbm(H, W, 2.4, seed=seed + 10))[..., None]
    alb = alb * (0.9 + 0.12 * fbm(H, W, 1.4, seed=seed + 18))[..., None]
    alb = lerp(alb, hex2rgb("#2a2622"), joint * 0.8)
    st, gum = stains_layer(512, seed + 11, 0.0)
    st = np.tile(st, (1, 4)); gum = np.tile(gum, (1, 4))
    alb = alb * (1 - (st * zone_top)[..., None] * 0.35)
    alb = lerp(alb, hex2rgb("#24211f"), gum * zone_top * 0.8)
    # moss / algae line at the very bottom (damp gutter)
    moss = zone_face * smoothstep(0.88, 1.0, face_t) * smoothstep(0.45, 0.7, fbm(H, W, 2.0, seed=seed + 12))
    alb = lerp(alb, hex2rgb("#3d4526"), moss * 0.6)
    rough = np.clip(0.82 + 0.1 * fbm(H, W, 1.5, seed=seed + 13) - (1 - zone_face) * 0.02 - tyre * 0.15, 0.3, 1)
    if paint:
        rough = rough - cover * 0.12
    ao = np.clip(1 - joint * 0.6 - chip * 0.3 - zone_face * smoothstep(0.8, 1.0, face_t) * 0.35, 0.25, 1)
    nrm = height_to_normal(hgt, 5)
    save_jpg(saturation(alb, 0.95), f"{OUT_TEX}/{name}_albedo.jpg", 88)
    save_jpg(nrm, f"{OUT_TEX}/{name}_normal.jpg", 92)
    save_jpg(np.stack([ao, rough, np.zeros_like(ao)], -1), f"{OUT_TEX}/{name}_orm.jpg", 88)
    print("wrote", name)


def curbs():
    common = ("UV unfolded curb profile, U along the curb (tiles in U, 2.0 m), V across the profile "
              "(0.5 m): V 0.00-0.40 (image top) = top surface, sidewalk edge at the very top; "
              "V 0.40-0.48 = rounded arris; V 0.48-1.00 = road-facing vertical face, bottom row = "
              "road level with gutter grime and tyre scuffs. Precast joints every 1 m.")
    curb("curb_red_white", ["#b3352d", "#dedbd2"], seed=3)
    MAN["curb_red_white"] = {"purpose": "Red/white painted curb (ขอบทางขาวแดง = no stopping/parking at all). "
                             "0.5 m paint blocks, worn & dirty. " + common, "size": "2048x512",
                             "alpha": False, "tiling": "U only", "real_world_m": [2.0, 0.5],
                             "maps": ["albedo", "normal", "orm"]}
    curb("curb_yellow_black", ["#d9ab27", "#262420"], seed=5)
    MAN["curb_yellow_black"] = {"purpose": "Yellow/black painted curb (ขอบทางเหลืองดำ = obstruction marker: "
                                "traffic islands, median noses, pillars, bridge piers). " + common,
                                "size": "2048x512", "alpha": False, "tiling": "U only",
                                "real_world_m": [2.0, 0.5], "maps": ["albedo", "normal", "orm"]}
    curb("curb_white_yellow", ["#dedbd2", "#d9ab27"], seed=9)
    MAN["curb_white_yellow"] = {"purpose": "White/yellow painted curb (ขอบทางขาวเหลือง = no parking, brief "
                                "pick-up/drop-off allowed; bus stops, school gates). " + common,
                                "size": "2048x512", "alpha": False, "tiling": "U only",
                                "real_world_m": [2.0, 0.5], "maps": ["albedo", "normal", "orm"]}
    curb("curb_bare_concrete", ["#8f8b83"], seed=11, paint=False)
    MAN["curb_bare_concrete"] = {"purpose": "Unpainted dirty concrete curb for sois/markets. " + common,
                                 "size": "2048x512", "alpha": False, "tiling": "U only",
                                 "real_world_m": [2.0, 0.5], "maps": ["albedo", "normal", "orm"]}


# ------------------------------------------------------------------ asphalt
def asphalt(name, src, seed, patches=True, sealed_cracks=True, tone="#4a4844", real=3.0):
    n = 1024
    a = ph(src, "diff", n)
    h = ph(src, "disp", n)
    r0 = ph(src, "rough", n)
    l = lum(a) / lum(a).mean()
    alb = hex2rgb(tone) * (0.55 + 0.45 * l)[..., None]
    alb = lerp(alb, a, 0.35)         # keep some of the scan's aggregate colour
    hgt = 0.5 + (h - 0.5) * 0.3
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    if patches:
        # saw-cut utility trench patch (long rectangle) + square patches, darker & smoother
        pm = np.zeros((n, n), np.float32)
        im = Image.new("L", (n * 3, n * 3), 0)
        d = ImageDraw.Draw(im)
        for k in range(4):
            cx, cy = rng.uniform(0, n), rng.uniform(0, n)
            if k == 0:
                w, hh = rng.uniform(0.1, 0.16) * n, n * 0.9
            else:
                w, hh = rng.uniform(0.12, 0.3) * n, rng.uniform(0.1, 0.25) * n
            for ox in (0, n, 2 * n):
                for oy in (0, n, 2 * n):
                    d.rectangle([cx - w / 2 + ox, cy - hh / 2 + oy, cx + w / 2 + ox, cy + hh / 2 + oy], fill=255)
        pm = np.asarray(im.crop((n, n, 2 * n, 2 * n))).astype(np.float32) / 255
        pm = blur(pm, 1.0)
        b = ph("asphalt_02", "diff", n)
        lb = lum(b) / lum(b).mean()
        pcol = hex2rgb("#3d3b37") * (0.6 + 0.4 * lb)[..., None]
        pv = 0.35 + 0.3 * fbm(n, n, 2.0, seed=seed + 9)       # patches age differently
        alb = lerp(alb, pcol, pm * pv)
        edge = np.clip(blur(pm, 1.5) * (1 - pm) * 4 + pm * (1 - blur(pm, 1.5)) * 4, 0, 1)
        alb = lerp(alb, hex2rgb("#262421"), edge * 0.35)
        hgt += pm * 0.03
    if sealed_cracks:
        cr = crack_layer(n, seed + 3, 9)
        crb = blur(cr, 0.8)
        alb = lerp(alb, hex2rgb("#1d1c1a"), np.clip(crb, 0, 1) * 0.6)
        hgt += crb * 0.02
    st, gum = stains_layer(n, seed + 5, 1.2)
    oil = smoothstep(0.66, 0.9, fbm(n, n, 2.6, seed=seed + 6))
    alb = alb * (1 - oil[..., None] * 0.35) * (1 - st[..., None] * 0.25)
    dust = smoothstep(0.35, 0.85, fbm(n, n, 2.0, seed=seed + 7))
    alb = lerp(alb, hex2rgb("#7c766c") * (0.7 + 0.3 * l)[..., None], dust * 0.3)
    alb = alb * (0.88 + 0.2 * fbm(n, n, 2.4, seed=seed + 8))[..., None]
    rough = np.clip(r0 * 0.6 + 0.35 - oil * 0.3, 0.25, 1)
    if sealed_cracks:
        rough = rough - crb * 0.4
    ao = np.clip(1 - (blur(hgt, 3) - hgt) * 4, 0.4, 1)
    write_material(name, saturation(alb, 0.85), hgt, np.clip(rough, 0.2, 1), ao, nstrength=4, meta=None)


def asphalt_all():
    asphalt("asphalt_soi_patched", "worn_asphalt", 21)
    MAN["asphalt_soi_patched"] = {"purpose": "Soi / side-street asphalt: tired, dusty, saw-cut utility patch and "
                                  "square repairs, black sealed cracks, oil and food stains.",
                                  "size": "1024x1024", "alpha": False, "tiling": True,
                                  "real_world_m": [3.0, 3.0], "maps": ["albedo", "normal", "orm"],
                                  "source": "detail from Poly Haven worn_asphalt + asphalt_02 (CC0)"}
    asphalt("asphalt_main_worn", "asphalt_04", 31, patches=False, tone="#55534e")
    MAN["asphalt_main_worn"] = {"purpose": "Main-road asphalt: lighter, coarse aggregate, fewer patches, "
                                "sealed cracks, oil drips in lane centres.", "size": "1024x1024",
                                "alpha": False, "tiling": True, "real_world_m": [3.0, 3.0],
                                "maps": ["albedo", "normal", "orm"],
                                "source": "detail from Poly Haven asphalt_04 (CC0)"}


# ------------------------------------------------------------------ paint markings
def paint_wear(h, w, seed, amount=0.45):
    """Alpha multiplier for worn road paint: aggregate pits + wheel wear blotches."""
    n1 = fbm(h, w, 1.0, seed=seed)          # fine pits (asphalt aggregate shows through)
    n2 = fbm(h, w, 2.4, seed=seed + 1)      # larger worn areas
    pits = smoothstep(0.38, 0.6, n1)
    worn = smoothstep(amount - 0.2, amount + 0.25, n2)
    return np.clip(pits * worn, 0, 1)


def line_strip(name, colour, width_m, lines, length_m=1.6, seed=0, purpose=""):
    """Tileable (V) strip of road paint with alpha. lines = list of (offset_m, width_m)."""
    Wm = width_m
    W, H = 256, int(256 * length_m / Wm) if Wm >= 0.4 else 1024
    if Wm < 0.4:
        W = 128
        H = int(round(128 * length_m / Wm / 64)) * 64
    ppm = W / Wm
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    m = np.zeros((H, W), np.float32)
    for off, lw in lines:
        c = off * ppm
        m = np.maximum(m, 1 - smoothstep(lw * ppm / 2 - 1, lw * ppm / 2 + 1, np.abs(x - c) + (fbm(H, W, 2.5, seed=seed + 3) - 0.5) * 3))
    a = m * paint_wear(H, W, seed)
    col = hex2rgb(colour)
    tex = np.ones((H, W, 3), np.float32) * col
    tex = tex * (0.82 + 0.18 * fbm(H, W, 1.5, seed=seed + 4))[..., None]
    dirt = smoothstep(0.5, 0.9, fbm(H, W, 2.2, seed=seed + 5))
    tex = lerp(tex, hex2rgb("#6b675f"), dirt * 0.45)
    out = np.dstack([tex, a])
    save_png(out, f"{OUT_TEX}/{name}.png")
    MAN[name] = {"purpose": purpose, "size": f"{W}x{H}", "alpha": True, "tiling": "V only",
                 "real_world_m": [width_m, round(H / ppm, 3)], "maps": ["rgba"],
                 "notes": "Decal: lay on the road a few mm above asphalt; roughness ~0.6."}
    print("wrote", name, W, H)


def lines():
    line_strip("roadline_white_worn", "#e9e6dc", 0.20, [(0.10, 0.15)], 1.6, seed=1,
               purpose="Worn white lane line, 15 cm wide (urban Thai lanes). Dash it with geometry: "
                       "2 m paint / 2 m gap in town, 3 m / 3-6 m on highways; solid near junctions.")
    line_strip("roadline_yellow_worn", "#e2b52d", 0.20, [(0.10, 0.12)], 1.6, seed=2,
               purpose="Worn single yellow line (centre line / no-parking edge), 12 cm wide.")
    line_strip("roadline_double_yellow_worn", "#e2b52d", 0.40, [(0.13, 0.11), (0.27, 0.11)], 1.6, seed=3,
               purpose="Worn double solid yellow centre line (no overtaking), two 11 cm lines with ~3 cm gap.")


def zebra():
    W = H = 1024                       # 4.0 m (along road) x 4.0 m (crossing length)
    ppm = W / 4.0
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    bar_w, gap = 0.45, 0.45
    period = (bar_w + gap) * ppm
    xx = (x + 0.2 * ppm) % period
    wob = (fbm(H, W, 2.5, seed=4) - 0.5) * 4
    m = (1 - smoothstep(bar_w * ppm - 1.5, bar_w * ppm + 1.5, xx + wob)) * smoothstep(0, 2, xx + wob)
    # ends of the bars slightly ragged, crossing ends 0.15 m from texture edge
    m *= smoothstep(0.15 * ppm, 0.17 * ppm, y + wob) * (1 - smoothstep(H - 0.17 * ppm, H - 0.15 * ppm, y + wob))
    # heavy wheel-path wear: two bands along the road direction (x) where tyres run
    wheel = np.zeros((H, W), np.float32)
    for c in (0.28, 0.48, 0.72, 0.9):
        wheel = np.maximum(wheel, 1 - smoothstep(0.03 * H, 0.08 * H, np.abs(y - c * H)))
    wear = paint_wear(H, W, 7, 0.4) * (1 - wheel * smoothstep(0.3, 0.7, fbm(H, W, 1.8, seed=8)) * 0.9)
    a = m * wear
    col = hex2rgb("#e8e5da")
    tex = np.ones((H, W, 3), np.float32) * col * (0.82 + 0.18 * fbm(H, W, 1.5, seed=9))[..., None]
    tex = lerp(tex, hex2rgb("#5f5b54"), smoothstep(0.45, 0.9, fbm(H, W, 2.2, seed=10)) * 0.5)
    # tyre marks crossing the bars
    tyre = smoothstep(0.55, 0.8, fbm(H, W, 2.0, seed=12)) * wheel
    tex = lerp(tex, hex2rgb("#2a2826"), tyre * 0.6)
    save_png(np.dstack([tex, a]), f"{OUT_TEX}/roadmark_zebra_worn.png")
    MAN["roadmark_zebra_worn"] = {"purpose": "Worn zebra crossing (ทางม้าลาย) decal: 45 cm bars / 45 cm gaps, "
                                  "bars run along the road (texture X), crossing length = texture Y. Tyre-path "
                                  "wear and rubber marks.", "size": "1024x1024", "alpha": True,
                                  "tiling": "X (along road) only", "real_world_m": [4.0, 4.0],
                                  "maps": ["rgba"]}
    print("wrote zebra")


def road_text(name, text, colour="#e9e6dc", fontname="Kanit-Bold.ttf", stretch=2.6, width_m=1.2,
              purpose=""):
    """Thai road text marking, letters stretched along the driving direction."""
    f = font(fontname, 300)
    m = text_mask(text, f, 0, pad=30)
    w, h = m.size
    m = m.resize((w, int(h * stretch)), Image.LANCZOS)
    W = 512
    H = int(round(W * m.height / m.width / 64)) * 64
    m = m.resize((W - 40, H - 40), Image.LANCZOS)
    canvas = Image.new("L", (W, H), 0)
    canvas.paste(m, (20, 20))
    a = np.asarray(canvas).astype(np.float32) / 255
    a = a * paint_wear(H, W, len(text), 0.38)
    tex = np.ones((H, W, 3), np.float32) * hex2rgb(colour) * (0.84 + 0.16 * fbm(H, W, 1.5, seed=3))[..., None]
    tex = lerp(tex, hex2rgb("#5f5b54"), smoothstep(0.45, 0.9, fbm(H, W, 2.2, seed=4)) * 0.45)
    save_png(np.dstack([tex, a]), f"{OUT_TEX}/{name}.png")
    MAN[name] = {"purpose": purpose, "size": f"{W}x{H}", "alpha": True, "tiling": False,
                 "real_world_m": [width_m, round(width_m * H / W, 2)], "maps": ["rgba"],
                 "notes": "Text reads correctly for a driver approaching from the bottom of the texture."}
    print("wrote", name, W, H)


def roadtext():
    road_text("roadmark_text_yut", "หยุด", purpose="Painted 'หยุด' (STOP) before a stop line at soi mouths.")
    road_text("roadmark_text_chalong", "ช้าลง", purpose="Painted 'ช้าลง' (SLOW DOWN) before speed bumps / schools.")
    road_text("roadmark_text_khet_rongrian", "เขตโรงเรียน", width_m=2.4, stretch=4.6,
              colour="#e2b52d", purpose="Painted yellow 'เขตโรงเรียน' (SCHOOL ZONE).")


def save_manifest_part():
    p = os.path.join(RAW, "manifest_ground2.json")
    old = json.load(open(p)) if os.path.exists(p) else {}
    old.update(MAN)
    json.dump(old, open(p, "w"), ensure_ascii=False, indent=1)


JOBS = {"curbs": curbs, "asphalt": asphalt_all, "lines": lines, "zebra": zebra, "roadtext": roadtext}

if __name__ == "__main__":
    for nm in (sys.argv[1:] or list(JOBS)):
        JOBS[nm]()
    save_manifest_part()
