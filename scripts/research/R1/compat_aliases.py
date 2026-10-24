"""R1-streets: keep texture names already used by src/modules/world working after the switch to
real-photo decals. Each alias is rebuilt from the photo-based texture (same layout the code expects).
usage: python3 -I compat_aliases.py"""
import json, os, shutil, sys
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from photodecal import load_any, save_rgba, save_rgb, decontaminate, trim, fit

W = "/home/user/special-telegram/public/assets/textures/world"
RAW = "/home/user/special-telegram/references/streets/_raw"
MAN = {}


def cp(src, dst):
    shutil.copyfile(os.path.join(W, src), os.path.join(W, dst))


def alias(name, of, purpose, size, alpha, tiling, real, maps, **kw):
    m = {"purpose": purpose + f" (compat alias of {of}, real-photo based; name kept because src/modules/world uses it)",
         "size": size, "alpha": alpha, "tiling": tiling, "real_world_m": real, "maps": maps, "alias_of": of}
    m.update(kw)
    MAN[name] = m


# straight copies (same layout)
cp("decal_oil_stains_photo.png", "decal_oil_stains.png")
a = load_any(os.path.join(W, "decal_oil_stains.png"))[0]
save_rgb(np.dstack([1 - a[..., 3] * 0.55] * 3), os.path.join(W, "decal_oil_stains_rough.jpg"))
alias("decal_oil_stains", "decal_oil_stains_photo", "Oil/grease stain atlas 2x2", "1024x1024", True, False, [2.4, 2.4], ["rgba", "rough"])
cp("decal_potholes_photo.png", "decal_asphalt_patches.png")
cp("decal_potholes_photo_normal.jpg", "decal_asphalt_patches_normal.jpg")
a = load_any(os.path.join(W, "decal_asphalt_patches.png"))[0]
save_rgb(np.dstack([np.full(a.shape[:2], 0.85, np.float32)] * 3), os.path.join(W, "decal_asphalt_patches_rough.jpg"))
alias("decal_asphalt_patches", "decal_potholes_photo", "Road damage atlas 2x2 (potholes / broken asphalt)", "1024x1024", True, False, [3.0, 3.0], ["rgba", "normal", "rough"])
cp("decal_gum_spots_photo.png", "decal_gum_spots.png")
alias("decal_gum_spots", "decal_gum_spots_photo", "Gum spots on pavement", "1024xN", True, False, [3.0, 1.0], ["rgba"])
for old, new, p in (("roadline_white_worn", "roadline_white_edge_photo", "Worn white line, tiles along V"),
                    ("roadline_yellow_worn", "roadline_yellow_single_photo", "Worn single yellow line, tiles along V"),
                    ("roadline_double_yellow_worn", "roadline_double_yellow_photo", "Worn double yellow line, tiles along V"),
                    ("roadmark_zebra_worn", "roadmark_zebra_worn_photo", "Worn zebra crossing bars")):
    cp(new + ".png", old + ".png")
    alias(old, new, p, "see alias_of", True, "V only" if "line" in old else False, None, ["rgba"])
for old in ("manhole_round_drain", "manhole_round_electric"):
    cp("manhole_round_iron.png", old + ".png")
    cp("manhole_round_iron_normal.jpg", old + "_normal.jpg")
    a = load_any(os.path.join(W, old + ".png"))[0]
    save_rgb(np.dstack([np.full(a.shape[:2], 0.9, np.float32), np.full(a.shape[:2], 0.55, np.float32), np.full(a.shape[:2], 0.5, np.float32)]), os.path.join(W, old + "_orm.jpg"))
    alias(old, "manhole_round_iron", "Round cast-iron manhole cover (real photo)", "512x512", True, False, [0.76, 0.76], ["rgba", "normal", "orm"])
# puddles 2x2 atlas: split the photo puddle decal into its 4 largest blobs
pd = load_any(os.path.join(W, "decal_puddles_photo.png"))[0]
b = (pd[..., 3] > 0.25).astype(np.uint8)
n, lab, st, _ = cv2.connectedComponentsWithStats(cv2.dilate(b, np.ones((15, 15), np.uint8)), 8)
order = np.argsort(-st[1:, cv2.CC_STAT_AREA])[:4] + 1
cells = []
for i in order:
    x, y, w, h = st[i, 0], st[i, 1], st[i, 2], st[i, 3]
    c = pd[y:y + h, x:x + w].copy()
    c[..., 3] *= (lab[y:y + h, x:x + w] == i)
    cells.append(trim(c, 6, 0.02))
atlas = np.zeros((1024, 1024, 4), np.float32)
for k, c in enumerate(cells):
    f = fit(c, 500, 500)
    h, w = f.shape[:2]
    ox, oy = (k % 2) * 512 + (512 - w) // 2, (k // 2) * 512 + (512 - h) // 2
    atlas[oy:oy + h, ox:ox + w] = f
save_rgba(decontaminate(atlas), os.path.join(W, "decal_puddles.png"))
save_rgb(np.dstack([np.clip(1 - atlas[..., 3] * 0.96, 0.04, 1)] * 3), os.path.join(W, "decal_puddles_rough.jpg"))
alias("decal_puddles", "decal_puddles_photo", "Puddle atlas 2x2: 4 real puddle shapes split from the photo decal", "1024x1024", True, False, [3.0, 3.0], ["rgba", "rough"])
# trench grate: photo strip rotated to run along U (code expects 1.0 x 0.3125 m, tiles along U)
for m in ("albedo", "normal", "orm"):
    a = load_any(os.path.join(W, f"trench_grate_cast_iron_photo_{m}.jpg"))[0][..., :3]
    a = np.rot90(a).copy()
    if m == "normal":
        a = np.stack([1 - a[..., 1], a[..., 0], a[..., 2]], -1)
    a = cv2.resize(np.ascontiguousarray(a, np.float32), (1024, 320), interpolation=cv2.INTER_AREA)
    save_rgb(a, os.path.join(W, f"trench_grate_steel_{m}.jpg"))
alias("trench_grate_steel", "trench_grate_cast_iron_photo", "Cast-iron trench grate strip rotated to run along U", "1024x320", False, "U only", [1.6, 0.5], ["albedo", "normal", "orm"])
for m in ("albedo", "normal", "orm"):
    a = load_any(os.path.join(W, f"manhole_square_bma_{m}.jpg"))[0][..., :3]
    h, w = a.shape[:2]
    s = min(h, w)
    a = a[(h - s) // 2:(h - s) // 2 + s, (w - s) // 2:(w - s) // 2 + s]
    save_rgb(cv2.resize(np.ascontiguousarray(a, np.float32), (512, 512), interpolation=cv2.INTER_AREA), os.path.join(W, f"drain_cover_concrete_holes_{m}.jpg"))
alias("drain_cover_concrete_holes", "manhole_square_bma", "Square cast-iron footpath cover in concrete (real BMA photo), square crop", "512x512", False, False, [0.67, 0.67], ["albedo", "normal", "orm"])
p = os.path.join(RAW, "manifest_zz_compat.json")
json.dump(MAN, open(p, "w"), ensure_ascii=False, indent=1)
print("aliases:", len(MAN))
