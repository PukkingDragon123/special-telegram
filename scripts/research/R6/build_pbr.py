#!/usr/bin/env python3
"""R6-pbr: build the PBR material library from CC0 sources (Poly Haven / ambientCG).

Usage:  python3 -I build_pbr.py [material_id ...]     (no args = build all standard recipes)
Output: public/assets/textures/pbr/<id>/{albedo,normal,orm[,height,opacity]}.jpg
        scripts/research/R6/out/std_manifest.json  (merged later by make_manifest.py)
ORM = R:ambient occlusion, G:roughness, B:metalness (linear). Normal = OpenGL (+Y up).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # our own script dir only
import numpy as np  # noqa: E402

import r6lib as L  # noqa: E402

# id, src, size, tileMeters (None = from source metadata), tint, tags, height, ops
R = []


def m(mid, src, size=1024, tile=None, tint=False, tags=(), height=False, ops=(), note=""):
    R.append(dict(id=mid, src=src, size=size, tile=tile, tint=tint, tags=list(tags), height=height,
                  ops=list(ops), note=note))


# ------------------------------------------------------------------ ground
m("asphalt_road_sunbleached", "ph:asphalt_04", 2048, 4.0, tags=["ground", "road", "asphalt", "outdoor", "main-road", "sun-bleached"], height=True, ops=[("lum", 0.36)],
  note="Main road. Grey, sun-bleached, faint cracks.")
m("asphalt_cracked", "ph:asphalt_02", 1024, 3.0, tags=["ground", "road", "asphalt", "cracked", "outdoor"], height=True)
m("asphalt_wet", "ph:asphalt_04", 1024, 4.0, tags=["ground", "road", "asphalt", "wet", "rain", "puddles", "night"], height=True,
  ops=[("lum", 0.36), ("wet", dict(coverage=0.17, damp=0.9, seed=11, darken=0.33, blob_scale=8))],
  note="Same base as asphalt_road_sunbleached with puddles in low areas (roughness ~0.05) and damp darkening.")
m("concrete_soi_road", "ph:brushed_concrete", 1024, 2.5, tags=["ground", "concrete", "soi", "lane", "outdoor"], ops=[("desat", 0.5)])
m("concrete_old_cracked", "ph:cracked_concrete", 1024, 2.0, tags=["ground", "concrete", "cracked", "old", "outdoor"], height=True)
m("concrete_wet_puddles", "ph:garage_floor", 1024, 1.9, tags=["ground", "concrete", "wet", "puddles", "market-floor"], height=True,
  ops=[("desat", 0.45), ("wet", dict(coverage=0.2, damp=0.8, seed=5, darken=0.3, blob_scale=6))],
  note="Puddle-friendly concrete: height.jpg marks low spots; roughness already varies (wet patches).")
m("sidewalk_pavers_square", "acg:PavingStones112", 2048, 2.0, tags=["ground", "sidewalk", "pavers", "square", "outdoor", "main-sidewalk"], height=True)
m("sidewalk_pavers_interlocking", "ph:concrete_pavers", 1024, None, tags=["ground", "sidewalk", "pavers", "interlocking", "uni-paver", "outdoor"])
m("sidewalk_tactile_yellow", "acg:TactilePaving006", 1024, 0.9, tags=["ground", "sidewalk", "tactile", "yellow", "outdoor"],
  ops=[("recolor", dict(rgb=(222, 182, 38), amount=0.85))], note="Photogrammetry tactile tiles re-coloured to Thai safety yellow.")
m("gravel_crushed", "acg:Gravel033", 1024, None, tags=["ground", "gravel", "roadside", "construction", "outdoor"])
m("dirt_path_dry", "ph:dirt_floor", 1024, None, tags=["ground", "dirt", "path", "rural", "dry"])
m("mud_wet_rural", "ph:brown_mud_02", 1024, None, tags=["ground", "mud", "wet", "rural", "path"], height=True)
m("laterite_red_dirt", "ph:red_laterite_soil_stones", 1024, None, tags=["ground", "laterite", "red-dirt", "rural", "empty-lot"])
m("grass_dry", "ph:withered_grass", 1024, None, tags=["ground", "grass", "dry", "hot-season", "empty-lot", "rural"])
m("grass_lush", "ph:leafy_grass", 1024, None, tags=["ground", "grass", "lush", "green", "rainy-season", "rural"])
m("leaf_litter_dry", "ph:dry_decay_leaves", 1024, None, tags=["ground", "leaves", "litter", "dry", "under-trees"])

# ------------------------------------------------------------------ walls
m("plaster_painted_clean", "ph:painted_plaster_wall", 2048, None, tint=True, tags=["wall", "plaster", "painted", "shophouse", "clean"],
  ops=[("desat", 0.9), ("lum", 0.72)], note="Neutral light grey; tint per building colour.")
m("plaster_painted_dirty", "ph:white_plaster_02", 1024, None, tint=True, tags=["wall", "plaster", "painted", "dirty", "stained", "shophouse"],
  ops=[("desat", 0.85), ("lum", 0.62)])
m("plaster_moldy_stained", "ph:concrete_wall_003", 1024, None, tags=["wall", "plaster", "mold", "stained", "humid", "shophouse"])
m("plaster_peeling", "ph:worn_plaster_wall", 1024, None, tint=True, tags=["wall", "plaster", "peeling", "old", "shophouse"],
  ops=[("desat", 0.75), ("lum", 0.55)])
m("plaster_peeling_red", "ph:peeling_painted_wall", 1024, None, tags=["wall", "plaster", "peeling", "red", "cracked-paint"])
m("plaster_broken_brick", "ph:damaged_plaster", 1024, None, tags=["wall", "plaster", "broken", "exposed-brick", "old"])
m("concrete_mossy", "ph:worn_mossy_plasterwall", 1024, None, tags=["wall", "concrete", "moss", "mold", "humid", "canal"])
m("brick_exposed_red", "acg:Bricks090", 1024, None, tags=["wall", "brick", "red", "exposed", "mortar"])
m("tiles_wall_white_dirty", "acg:Tiles039", 1024, 1.6, tags=["wall", "tiles", "ceramic", "white", "kitchen", "dirty", "shophouse"])
m("terrazzo_floor", "acg:Terrazzo019M", 1024, 0.65, tags=["floor", "terrazzo", "shophouse", "interior"])
m("tiles_floor_ceramic", "ph:floor_tiles_08", 1024, None, tags=["floor", "tiles", "ceramic", "beige", "shop", "interior"])
m("tiles_floor_terracotta", "ph:terracotta_floor_tiles", 1024, None, tags=["floor", "tiles", "terracotta", "temple", "old-house"])
m("cement_block_wall", "ph:concrete_block_wall", 1024, None, tags=["wall", "cement-block", "masonry", "unplastered", "back-alley"],
  ops=[("desat", 0.55), ("lum", 0.42)])
m("temple_white_wall", "acg:PaintedPlaster017", 1024, 2.0, tags=["wall", "plaster", "white", "temple", "whitewash"])

# ------------------------------------------------------------------ metals
m("steel_rusty", "ph:rusty_metal_02", 1024, None, tags=["metal", "steel", "rust", "rusty", "old"])
m("corrugated_painted", "ph:box_profile_metal_sheet", 1024, None, tint=True, tags=["metal", "corrugated", "painted", "wall", "roof", "fence"],
  ops=[("desat", 1.0), ("lum", 0.6)])
m("corrugated_rusty", "ph:rusty_corrugated_iron", 1024, None, tags=["metal", "corrugated", "rust", "roof", "fence", "shack"])
m("metal_painted_chipped", "ph:green_metal_rust", 1024, None, tint=True, tags=["metal", "painted", "chipped", "rust", "grille", "cart"],
  ops=[("neutralize", dict(keep_rust=True)), ("lum", 0.55)],
  note="Real scan; green paint neutralised to grey so it can be tinted, rust spots keep their colour.")
m("shutter_roller_rusty", "ph:rusty_metal_shutter", 1024, None, tags=["metal", "roller-shutter", "shophouse", "rust"])
m("shutter_roller_painted", "ph:painted_metal_shutter", 1024, None, tags=["metal", "roller-shutter", "shophouse", "painted"])
m("cast_iron_wok", "acg:Metal063", 1024, 0.5, tags=["metal", "cast-iron", "carbon-steel", "wok", "seasoned", "dark"], ops=[("desat", 0.5), ("lum", 0.13)])

# ------------------------------------------------------------------ wood
m("wood_planks_old", "ph:old_planks_02", 1024, None, tags=["wood", "planks", "old", "weathered"])
m("wood_painted_weathered", "ph:distressed_painted_planks", 1024, None, tags=["wood", "planks", "painted", "weathered", "chipped"])
m("plywood", "ph:plywood", 1024, None, tags=["wood", "plywood", "sheet", "construction"])
m("wood_teak", "ph:dark_wood", 1024, None, tags=["wood", "teak-style", "furniture", "varnished", "dark"],
  note="Dark varnished hardwood, reads as typical Thai stained-teak furniture.")
m("bamboo_poles", "ph:bamboo_wall", 1024, None, tags=["wood", "bamboo", "poles", "dry", "rural", "stall"])
m("bamboo_woven", "ph:bamboo_wall_03", 1024, None, tags=["wood", "bamboo", "woven", "panel", "rural", "basket"])
m("chopping_board_endgrain", "acg:TreeEnd003", 1024, 0.45, tags=["wood", "end-grain", "chopping-board", "kitchen", "tamarind-style", "round-decal"],
  note="Round log slice with bark rim (not tileable). opacity.jpg masks the disc.")

# ------------------------------------------------------------------ roofs
m("roof_clay_tiles", "ph:clay_roof_tiles_03", 1024, None, tags=["roof", "clay", "tiles", "old-house"])
m("roof_corrugated_galvanized", "ph:corrugated_iron", 1024, None, tags=["roof", "corrugated", "galvanized", "zinc", "metal"])
m("roof_fibrecement_corrugated", "ph:asbestos_sheet", 1024, None, tags=["roof", "fibre-cement", "corrugated", "grey", "shophouse-back"])
m("roof_concrete_slab", "ph:concrete_floor_damaged_01", 1024, None, tags=["roof", "concrete", "slab", "stained", "flat-roof"])

# ------------------------------------------------------------------ plastic & misc
m("rubber_black", "ph:rubber_tiles", 1024, None, tags=["rubber", "black", "mat", "tyre"])
m("cardboard_worn", "acg:Paper005", 1024, 0.6, tags=["cardboard", "paper", "worn", "sleeping-mat", "box"])
m("paper_creased", "acg:Paper003", 1024, 0.4, tags=["paper", "creased", "white", "menu", "bag"])
m("canvas_tarp", "acg:Fabric044", 1024, 0.5, tint=True, tags=["fabric", "canvas", "tarp", "awning", "umbrella"], ops=[("desat", 1.0), ("lum", 0.7)])
m("cotton_jersey", "ph:cotton_jersey", 1024, None, tint=True, tags=["fabric", "cotton", "jersey", "singlet", "t-shirt"], ops=[("desat", 1.0), ("lum", 0.78)])
m("denim", "ph:denim_fabric_04", 1024, None, tags=["fabric", "denim", "jeans"])
m("velvet_red", "ph:velour_velvet", 1024, None, tags=["fabric", "velvet", "red", "casino", "curtain", "chair"])
m("leather_black", "acg:Leather037", 1024, 0.5, tags=["leather", "black", "seat", "motorbike", "sofa"], ops=[("desat", 0.85), ("lum", 0.08)])
m("leather_red", "acg:Leather038", 1024, 0.5, tags=["leather", "red", "casino", "sofa", "booth"], ops=[("recolor", dict(rgb=(118, 16, 20), amount=0.9))],
  note="Multi-angle photo leather re-coloured to casino red.")
m("marble_beige_polished", "acg:Marble026", 1024, 1.5, tags=["stone", "marble", "beige", "polished", "casino", "counter", "lobby"])
m("marble_checker_floor", "ph:floor_tiles_06", 1024, None, tags=["floor", "marble", "checkerboard", "casino", "lobby"])


# ------------------------------------------------------------------ ops
def lum(a):
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def op_desat(mat, amount):
    a = mat["albedo"].astype(np.float32)
    l = lum(a)[..., None]
    mat["albedo"] = np.clip(a * (1 - amount) + l * amount, 0, 255)


def op_lum(mat, target):
    """Scale albedo so the mean sRGB luminance becomes target (0..1)."""
    a = mat["albedo"].astype(np.float32)
    cur = lum(a).mean() / 255.0
    mat["albedo"] = np.clip(a * (target / max(cur, 1e-3)), 0, 255)


def scan_field(ph_id, size, blur, seed=0):
    """0..1 tileable variation field from a real Poly Haven scan's displacement map (periodic blur).
    seed picks a quarter-turn/flip so different materials don't share the same layout."""
    p = L.fetch_ph(ph_id, "1k", ("Displacement",))
    h = L.load_img(p["Displacement"], "F")
    h = L.resize_arr(h.astype(np.float32), size, is_float=True)
    k = seed % 8
    h = np.rot90(h, k % 4)
    if k >= 4:
        h = h[:, ::-1]
    h = L.fft_blur(np.ascontiguousarray(h), blur)
    return (h - h.min()) / (h.max() - h.min() + 1e-9)


def op_wet(mat, coverage=0.16, damp=0.85, seed=0, darken=0.35, puddle_rough=0.03, damp_rough=0.3, blob_scale=7):
    """Rain-wet look, tile-safe (all filters periodic):
    - whole surface damp (darker, roughness lowered) except a few drier patches,
    - puddles (~coverage of area) in low-lying spots: near-mirror roughness, flattened normal."""
    size = mat["albedo"].shape[0]
    h = mat["height"]
    if h is None:
        raise RuntimeError("wet op needs height")
    h = (h - h.min()) / (h.max() - h.min() + 1e-9)
    hs = L.fft_blur(h.astype(np.float32), size / 200.0)
    hs = (hs - hs.min()) / (hs.max() - hs.min() + 1e-9)
    # variation fields come from REAL scanned displacement maps (CC0 Poly Haven scans), not noise
    n_big = scan_field("concrete_floor_damaged_01", size, size / 14.0, seed)
    n_mid = scan_field("brown_mud_02", size, size / (blob_scale * 6.0), seed + 1)
    n_fine = scan_field("dirt_floor", size, size / 160.0, seed + 2)
    field = 0.45 * (1 - hs) + 0.42 * n_mid + 0.13 * n_fine
    t_p = np.quantile(field, 1 - coverage)
    p = L.smoothstep(t_p - 0.008, t_p + 0.012, field)
    # dampness: mostly wet, some drier patches (raised + big-noise driven)
    dry = L.smoothstep(0.55, 0.85, 0.6 * n_big + 0.4 * hs)
    d = np.clip(damp * (1 - 0.65 * dry), 0, 1)
    d = np.maximum(d, L.fft_blur(p.astype(np.float32), size / 256.0) * 1.0)
    a = mat["albedo"].astype(np.float32)
    a *= (1 - darken * d)[..., None]
    a *= (1 - 0.18 * p)[..., None]
    mat["albedo"] = a
    orm = mat["orm"].astype(np.float32)
    r = orm[..., 1] / 255.0
    r = r * (1 - d) + (r * 0.35 + damp_rough * 0.65) * d
    r = r * (1 - p) + puddle_rough * p
    orm[..., 1] = np.clip(r, 0, 1) * 255
    mat["orm"] = orm
    n = L.normal_decode(mat["normal"])
    flat = np.zeros_like(n)
    flat[..., 2] = 1
    n = n * (1 - p[..., None]) + flat * p[..., None]
    mat["normal"] = L.normal_encode(n)
    mat.setdefault("extra", {})["wetmask"] = (p * 255).astype(np.uint8)


def op_recolor(mat, rgb=(200, 160, 40), amount=1.0):
    """Shift a real scan toward a target colour while keeping its luminance detail."""
    a = mat["albedo"].astype(np.float32)
    l = lum(a)
    new = (l / max(l.mean(), 1e-3))[..., None] * np.array(rgb, np.float32)
    mat["albedo"] = np.clip(a * (1 - amount) + new * amount, 0, 255)


def op_neutralize(mat, keep_rust=True):
    """Desaturate the dominant paint hue (e.g. green) while keeping rust-coloured pixels."""
    a = mat["albedo"].astype(np.float32)
    mx, mn = a.max(-1), a.min(-1)
    l = lum(a)[..., None]
    gray = np.repeat(l, 3, -1)
    if keep_rust:
        r, g, b = a[..., 0], a[..., 1], a[..., 2]
        rust = np.clip(((r - g) / (mx + 1e-3) - 0.08) / 0.15, 0, 1) * np.clip(((r - b) / (mx + 1e-3) - 0.15) / 0.2, 0, 1)
    else:
        rust = np.zeros(a.shape[:2], np.float32)
    w = (1 - rust)[..., None]
    mat["albedo"] = np.clip(gray * w + a * (1 - w), 0, 255)


OPS = dict(desat=op_desat, lum=op_lum, wet=op_wet, recolor=op_recolor, neutralize=op_neutralize)


def build(rec, report):
    need_h = True
    mat = L.load_material(rec["src"], rec["size"], need_height=need_h)
    gl = None
    if mat.get("height") is not None:
        gl = L.check_normal_gl(mat["normal"], mat["height"])
    for op in rec["ops"]:
        if isinstance(op, tuple) and isinstance(op[1], dict):
            OPS[op[0]](mat, **op[1])
        else:
            OPS[op[0]](mat, op[1])
    files = L.write_material(rec["id"], mat, rec["size"], write_height=rec["height"], extra=mat.get("extra"),
                             data_size=min(rec["size"], 1024))
    info = L.source_info(rec["src"])
    tile = rec["tile"] if rec["tile"] is not None else (info["tile_m"] or 1.0)
    entry = dict(files)
    if rec["size"] > 1024:
        entry["dataMapResolution"] = 1024
    entry.update(dict(tileMeters=tile, tint=rec["tint"], tags=rec["tags"],
                      source=rec["src"].replace("ph:", "polyhaven:").replace("acg:", "ambientcg:"),
                      sourceUrl=info["url"], author=info["author"], license="CC0", resolution=rec["size"]))
    if any(op[0] == "wet" for op in rec["ops"]):   # puddle layout uses displacement of three more real scans
        extra = ["concrete_floor_damaged_01", "brown_mud_02", "dirt_floor"]
        entry["source"] += " + puddle layout from displacement of " + ", ".join("polyhaven:" + x for x in extra)
        entry["sourceUrl"] += "".join(" ; https://polyhaven.com/a/" + x for x in extra)
    if rec["note"]:
        entry["note"] = rec["note"]
    report[rec["id"]] = dict(gl_check=gl, src=rec["src"])
    return entry


def main():
    want = set(sys.argv[1:])
    outdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
    os.makedirs(outdir, exist_ok=True)
    man_p = os.path.join(outdir, "std_manifest.json")
    rep_p = os.path.join(outdir, "std_report.json")
    manifest = json.load(open(man_p)) if os.path.exists(man_p) else {}
    report = json.load(open(rep_p)) if os.path.exists(rep_p) else {}
    for rec in R:
        if want and rec["id"] not in want:
            continue
        try:
            manifest[rec["id"]] = build(rec, report)
            g = report[rec["id"]]["gl_check"]
            flag = "" if (g is None or (g[1] > 0.02 and g[0] < -0.02)) else "  <-- CHECK NORMAL CONVENTION"
            print(f"ok {rec['id']:32s} {rec['src']:34s} gl={None if g is None else (round(g[0],3), round(g[1],3))}{flag}", flush=True)
        except Exception as e:  # noqa
            print(f"FAIL {rec['id']}: {e}", flush=True)
        json.dump(manifest, open(man_p, "w"), indent=1)
        json.dump(report, open(rep_p, "w"), indent=1)


if __name__ == "__main__":
    main()
