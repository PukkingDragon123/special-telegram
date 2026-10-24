"""R1-streets: facade elements & wall materials from REAL photos (rectified, cleaned).

usage: python3 -I tex_facade_photo.py [job ...]
"""
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from photodecal import *  # noqa

OUT = "/home/user/special-telegram/public/assets/textures/world"
RAW = "/home/user/special-telegram/references/streets/_raw"
CC0 = RAW + "/cc0/polyhaven"
MAN = {}


def src(cid):
    return load_any(cid)[0][..., :3]


def rs(a, w, h):
    interp = cv2.INTER_AREA if w * h < a.shape[0] * a.shape[1] else cv2.INTER_CUBIC
    return cv2.resize(np.ascontiguousarray(a, np.float32), (w, h), interpolation=interp)


def meta(name, purpose, size, alpha, tiling, real, sources, maps=("albedo", "normal", "orm"), **kw):
    m = {"purpose": purpose, "size": size, "alpha": alpha, "tiling": tiling, "real_world_m": real,
         "maps": list(maps), "source_ids": sources}
    m.update(kw)
    MAN[name] = m


def write_pbr(name, rgb, hgt=None, rough=None, metal=None, nstr=3.0, wrap=False, ao=None, q=88):
    rgb = np.ascontiguousarray(np.clip(rgb, 0, 1), np.float32)
    if hgt is None:
        hgt = height_from_lum(rgb, 3)
    if rough is None:
        rough = np.clip(0.8 - (lum(rgb) - 0.4) * 0.3, 0.3, 1)
    if metal is None:
        metal = np.zeros_like(rough)
    if ao is None:
        ao = np.clip(0.6 + hgt * 0.5, 0.35, 1)
    save_rgb(rgb, f"{OUT}/{name}_albedo.jpg", q)
    save_rgb(normal_from_height(hgt, nstr, wrap), f"{OUT}/{name}_normal.jpg", 92)
    save_rgb(np.dstack([ao, rough, metal]), f"{OUT}/{name}_orm.jpg", 88)
    print("wrote", name, rgb.shape[1], rgb.shape[0])


def rect_px(a, quad, w_m, h_m, px=1024):
    if w_m >= h_m:
        W, H = px, int(round(px * h_m / w_m))
    else:
        H, W = px, int(round(px * w_m / h_m))
    return rectify(a, quad, W, H)


def slat_height(rgb, period_hint=None):
    """Roller-shutter slat profile from luminance rows (horizontal slats)."""
    l = lum(rgb)
    prof = cv2.GaussianBlur(l, (0, 0), 2.5)
    h = prof - cv2.GaussianBlur(prof, (0, 0), 18)
    h = (h - h.min()) / max(h.max() - h.min(), 1e-6)
    return h


# ------------------------------------------------------------------ roller shutters
def shutters():
    a = src("55eb42fa")
    r = even_light(rect_px(a, [[51, 58], [973, 58], [973, 695], [51, 695]], 3.6, 2.5), 0.4, 0.5)
    write_pbr("shutter_closed_rusty_white", r, slat_height(r), np.clip(0.55 + (0.6 - lum(r)) * 0.4, 0.3, 0.95),
              np.clip(0.35 - (r[..., 0] - r[..., 2]) * 2, 0, 0.35), nstr=4)
    meta("shutter_closed_rusty_white", "Whole closed roller shutter with its housing box (real photo, rectified): "
         "white paint, rust bleeding along every slat. One shophouse bay; box = top 15%.", "1024x711", False,
         False, [3.6, 2.5], ["55eb42fa"])
    a = src("7bbffe31")
    r = even_light(rect_px(a, [[339, 40], [1273, 40], [1273, 880], [339, 880]], 3.2, 2.9), 0.4, 0.4)
    write_pbr("shutter_closed_graffiti", r, slat_height(r), np.clip(0.6 + (0.6 - lum(r)) * 0.3, 0.3, 0.95),
              np.full(r.shape[:2], 0.25, np.float32), nstr=4)
    meta("shutter_closed_graffiti", "Whole closed roller shutter, cream, with a big purple graffiti throw-up "
         "(real photo, rectified).", "1024x928", False, False, [3.2, 2.9], ["7bbffe31"])
    # tileable slat materials
    for name, cid, box, purpose in (
            ("shutter_slats_grey", "2970b712", None, "Clean-ish grey galvanised roller-shutter slats"),
            ("shutter_slats_rusty_redwhite", "4f4b33ad", None, "Roller-shutter slats, red & white paint over heavy rust"),
            ("shutter_slats_rusty_green", "d74f9347", None, "Roller-shutter slats, flaking green paint & rust"),
            ("shutter_slats_rusty_white", "87be991c", None, "Roller-shutter slats, white paint with rust streaks"),
            ("shutter_slats_rust_brown", "0c254ef9", None, "Roller-shutter slats, fully rusted brown")):
        a = src(cid)
        h, w = a.shape[:2]
        s = min(h, w)
        c = a[(h - s) // 2:(h - s) // 2 + s, (w - s) // 2:(w - s) // 2 + s]
        c = even_light(c, 0.3, 0.6)
        c = rs(c, 1024, 1024)
        c = seamless_x(c, 0.18)
        c = seamless_y(c, 0.10)
        rust = np.clip((c[..., 0] - c[..., 2]) * 2.5, 0, 1)
        write_pbr(name, c, slat_height(c), np.clip(0.5 + rust * 0.35 + (0.5 - lum(c)) * 0.2, 0.25, 0.97),
                  np.clip(0.45 - rust * 0.5, 0, 0.45), nstr=4, wrap=True)
        meta(name, purpose + " (real photo, made tileable). Slats run along U; ~8 cm slat pitch.",
             "1024x1024", False, True, [1.2, 1.2], [cid])


# ------------------------------------------------------------------ gates, grilles, windows, AC
def gate_grille():
    a = src("532123f5")
    r = even_light(rect_px(a, [[120, 81], [1100, 81], [1100, 770], [120, 770]], 3.4, 2.4), 0.4, 0.4)
    l = lum(r)
    al = smoothstep(0.03, 0.12, l - local_bg(l, 48))
    al = cv2.morphologyEx(al, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    write_pbr("gate_folding_steel", r, height_from_lum(r, 2), np.clip(0.5 + (0.6 - l) * 0.3, 0.3, 0.9),
              np.clip(al * 0.6, 0, 0.6), nstr=3)
    save_rgba(decontaminate(np.dstack([r, feather(al, 0.6)])), f"{OUT}/gate_folding_steel_alpha.png")
    meta("gate_folding_steel", "Folding steel security gate ('ประตูยืด', scissor lattice) closed across a shop "
         "front (real photo, rectified). _albedo = opaque version (gate over dark interior); "
         "gate_folding_steel_alpha.png = lattice keyed out (alpha-test, cutoff ~0.4).", "1024x723",
         "albedo no / _alpha.png yes", False, [3.4, 2.4], ["532123f5"],
         maps=("albedo", "normal", "orm", "alpha_png"))
    a = src("ac496bea")
    r = even_light(rect_px(a, [[232, 219], [1249, 219], [1249, 1326], [232, 1326]], 1.4, 1.5), 0.4, 0.4)
    write_pbr("window_grille_white_on_glass", r, height_from_lum(r, 2), np.clip(0.35 + (0.6 - lum(r)) * 0.2, 0.15, 0.8),
              nstr=3)
    meta("window_grille_white_on_glass", "Window with white steel burglar bars over glass, frame included "
         "(real photo, rectified). Upper-floor shophouse window.", "956x1024", False, False, [1.4, 1.5],
         ["ac496bea"])
    a = src("8404aaab")
    r = even_light(rect_px(a, [[93, 51], [907, 51], [907, 797], [93, 797]], 1.2, 1.1), 0.4, 0.4)
    write_pbr("window_wood_shutters_old", r, height_from_lum(r, 3), np.clip(0.85 - lum(r) * 0.1, 0.5, 1), nstr=4)
    meta("window_wood_shutters_old", "Old weathered wooden window shutters, closed, in a crumbling frame (real "
         "photo, rectified). Old wooden shophouses, canal houses, rural houses.", "1024x939", False, False,
         [1.2, 1.1], ["8404aaab"])


def ac_units():
    for name, cid, quad, wm, hm in (("ac_outdoor_unit_front_a", "5602e394", [[418, 173], [802, 173], [802, 511], [418, 511]], 0.84, 0.62),
                                    ("ac_outdoor_unit_front_b", "79430bf1", [[92, 194], [833, 148], [810, 658], [99, 694]], 0.85, 0.60)):
        a = src(cid)
        r = rect_px(a, quad, wm, hm, 768)
        r = gray_world(r, 0.3)
        write_pbr(name, r, height_from_lum(r, 2), np.clip(0.45 + (0.5 - lum(r)) * 0.3, 0.25, 0.8),
                  np.full(r.shape[:2], 0.15, np.float32), nstr=3)
        meta(name, "Front face of a real split-type AC outdoor unit (fan grille + side panel), rectified. Map on a "
             "bevelled box (sides: tinted plain from the albedo edge colour); hang on wall brackets with "
             "a drip stain decal below.", f"{r.shape[1]}x{r.shape[0]}", False, False, [wm, hm], [cid])


# ------------------------------------------------------------------ walls & sheets
def wall(name, cid, box, real, purpose, sat=0.95):
    a = src(cid)
    if box:
        x0, y0, x1, y1 = box
        a = a[y0:y1, x0:x1]
    a = even_light(a, 0.3, 0.6)
    s = min(a.shape[:2])
    a = a[:s, :s]
    a = rs(a, 1024, 1024)
    a = make_seamless(a, 0.22)
    l = lum(a)
    a = np.clip(l[..., None] + (a - l[..., None]) * sat, 0, 1)
    write_pbr(name, a, height_from_lum(a, 4), np.clip(0.82 + (0.5 - l) * 0.2, 0.4, 1), nstr=3, wrap=True)
    meta(name, purpose + " (real photo, made tileable).", "1024x1024", False, True, [real, real], [cid])


def walls():
    wall("wall_peeling_paint_orange", "c4b0adb7", (150, 0, 833, 683), 1.5,
         "Orange-terracotta painted render flaking off in crusts")
    wall("wall_peeling_paint_teal", "2952c113", (240, 60, 960, 780), 1.5,
         "Teal painted wall flaking to bare plaster, faint marker tag")
    wall("wall_peeling_paint_red_over_cream", "4985c871", (0, 120, 683, 803), 1.2,
         "Dark red paint peeling over a cream base coat")
    wall("wall_concrete_black_streaks", "711eded1", None, 2.0,
         "Grey concrete with heavy black water / mould streaks (tropical weathering)")
    wall("wall_concrete_mould_stained", "18f9f9f9", None, 2.0,
         "Board-marked concrete wall, mould and rain staining")
    wall("wall_concrete_plain_dirty", "d8e3ee84", (128, 0, 896, 768), 2.0, "Plain dirty cement render")


def tarp_awning():
    a = src("018fbbfc")
    s = min(a.shape[:2])
    a = rs(even_light(a[:s, :s], 0.3, 0.5), 1024, 1024)
    a = make_seamless(a, 0.2)
    write_pbr("tarp_blue_photo", a, height_from_lum(a, 3), np.clip(0.55 - (lum(a) - 0.4) * 0.3, 0.3, 0.8),
              nstr=4, wrap=True)
    meta("tarp_blue_photo", "Blue woven tarpaulin (ผ้าใบฟ้า) from a real photo, tileable: stall roofs, cart "
         "covers, patched roofs.", "1024x1024", False, True, [1.5, 1.5], ["018fbbfc"])
    for name, cid, purpose in (("awning_stripes_green_white_photo", "466af2ae", "Green/white striped awning canvas"),
                               ("awning_stripes_red_yellow_photo", "f927d9b6", "Red/yellow striped awning canvas"),
                               ("awning_stripes_red_pink_photo", "26b713dd", "Faded red striped awning canvas")):
        try:
            a = src(cid)
        except Exception:
            continue
        s = min(a.shape[:2])
        a = rs(a[:s, :s], 1024, 1024)
        a = seamless_x(seamless_y(a, 0.15), 0.08)
        write_pbr(name, a, height_from_lum(a, 2), np.full(a.shape[:2], 0.8, np.float32), nstr=2, wrap=True)
        meta(name, purpose + " from a real fabric photo; stripes along V; tileable. Add rain-streak / grime "
             "decals (decal_wall_grime_streaks_photo) for the dirty Thai look.", "1024x1024", False, True,
             [1.5, 1.5], [cid])


def corrugated():
    nph = load_any(os.path.join(CC0, "rusty_corrugated_iron", "rusty_corrugated_iron_nor_gl.jpg"))[0][..., :3]
    hph = load_any(os.path.join(CC0, "rusty_corrugated_iron", "rusty_corrugated_iron_disp.jpg"))[0][..., 0]
    nph = rs(nph, 1024, 1024)
    hph = rs(hph, 1024, 1024)
    gx = np.abs(np.diff(hph, axis=1)).mean()
    gy = np.abs(np.diff(hph, axis=0)).mean()
    if gy > gx:
        hph = np.rot90(hph).copy()
        nph = np.rot90(nph).copy()
        nph = np.stack([nph[..., 1], 1 - nph[..., 0], nph[..., 2]], -1)
    shade = 0.8 + 0.4 * (hph - hph.mean())
    for name, cid, box, purpose in (("corrugated_zinc_rusty", "2e4aaa82", (100, 0, 820, 720), "Rusty galvanised corrugated sheet (สังกะสี)"),
                                    ("corrugated_zinc_streaked", "88699e03", (300, 0, 983, 683), "Galvanised corrugated sheet with rust streaks"),
                                    ("corrugated_zinc_rust_heavy", "6ce54af6", None, "Heavily rusted corrugated sheet")):
        a = src(cid)
        if box:
            x0, y0, x1, y1 = box
            a = a[y0:y1, x0:x1]
        s = min(a.shape[:2])
        a = rs(a[:s, :s], 1024, 1024)
        a = seamless_y(a, 0.15)
        a = seamless_x(a, 0.1)
        alb = np.clip(a * shade[..., None], 0, 1)
        rust = np.clip((alb[..., 0] - alb[..., 2]) * 3, 0, 1)
        rough = np.clip(0.5 + rust * 0.4, 0.25, 1)
        save_rgb(alb, f"{OUT}/{name}_albedo.jpg", 88)
        save_rgb(nph, f"{OUT}/{name}_normal.jpg", 92)
        save_rgb(np.dstack([np.full_like(rough, 0.9), rough, np.clip(0.6 - rust * 0.6, 0, 1)]), f"{OUT}/{name}_orm.jpg", 88)
        meta(name, purpose + " - albedo from a real photo, corrugation normal from Poly Haven "
             "rusty_corrugated_iron (CC0). Corrugations run along V. Back alleys, lean-to roofs, stall roofs, "
             "empty-lot fences.", "1024x1024", False, True, [1.5, 1.5], [cid, "polyhaven:rusty_corrugated_iron"])
        print("wrote", name)


def save_manifest_part():
    p = os.path.join(RAW, "manifest_facade_photo.json")
    old = json.load(open(p)) if os.path.exists(p) else {}
    old.update(MAN)
    json.dump(old, open(p, "w"), ensure_ascii=False, indent=1)


JOBS = {"shutters": shutters, "gate": gate_grille, "ac": ac_units, "walls": walls, "tarp": tarp_awning,
        "corrugated": corrugated}

if __name__ == "__main__":
    for nm in (sys.argv[1:] or list(JOBS)):
        print("==", nm, flush=True)
        JOBS[nm]()
        save_manifest_part()
