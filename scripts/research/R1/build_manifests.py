"""R1-streets: assemble public manifests + credits from partial manifests and the source index.

usage: python3 -I build_manifests.py
Writes public/assets/textures/world/manifest.json, public/assets/img/signs/manifest.json and
references/credits/R1-streets.md.
"""
import glob
import json
import os
import re

RAW = "/home/user/special-telegram/references/streets/_raw"
TEX = "/home/user/special-telegram/public/assets/textures/world"
SIGN = "/home/user/special-telegram/public/assets/img/signs"
CRED = "/home/user/special-telegram/references/credits/R1-streets.md"

PH = {  # Poly Haven / ambientCG CC0 scans used as detail sources
    "polyhaven:rusty_corrugated_iron": ("https://polyhaven.com/a/rusty_corrugated_iron", "Poly Haven", "CC0"),
    "polyhaven:painted_metal_shutter": ("https://polyhaven.com/a/painted_metal_shutter", "Poly Haven", "CC0"),
    "polyhaven:rusty_metal_shutter": ("https://polyhaven.com/a/rusty_metal_shutter", "Poly Haven", "CC0"),
    "ambientcg:Cardboard001": ("https://ambientcg.com/view?id=Cardboard001", "ambientCG", "CC0"),
}
PROC_SOURCES = {  # procedural-over-CC0 ground materials
    "sidewalk_tile_circles_grey": ["concrete_floor_worn_001"], "sidewalk_tile_red_hex": ["concrete_floor_worn_001"],
    "sidewalk_tile_chain_grey": ["brushed_concrete"], "sidewalk_tile_grid_grey_redband": ["square_concrete_pavers"],
    "tactile_strip_yellow": ["brushed_concrete"], "paver_interlock_I": ["concrete_pavers"],
    "concrete_slab_footpath": ["concrete_floor_worn_001"], "curb_red_white": ["brushed_concrete"],
    "curb_yellow_black": ["brushed_concrete"], "curb_white_yellow": ["brushed_concrete"],
    "curb_bare_concrete": ["brushed_concrete"], "asphalt_soi_patched": ["worn_asphalt", "asphalt_02"],
    "asphalt_main_worn": ["asphalt_04"],
}


def index():
    idx = {}
    for mp in glob.glob(os.path.join(RAW, "*", "meta.jsonl")):
        for line in open(mp, encoding="utf-8"):
            try:
                c = json.loads(line)
            except Exception:
                continue
            idx.setdefault(c["id"], c)
    return idx


def src_info(sid, idx):
    sid = sid.split("#")[0].split(" ")[0]
    if sid in PH:
        u, a, l = PH[sid]
        return {"id": sid, "url": u, "author": a, "licence": l}
    if sid.startswith("polyhaven:"):
        n = sid.split(":")[1]
        return {"id": sid, "url": f"https://polyhaven.com/a/{n}", "author": "Poly Haven", "licence": "CC0"}
    if sid.startswith("food_kaprao_cc0"):
        return {"id": sid, "url": "https://commons.wikimedia.org/wiki/File:Ka-phrao_mu_(basil_fried_pork)_with_rice_%26_egg,_Bangkok,_2019-03-31_(1).jpg",
                "author": "Wikimedia Commons contributor", "licence": "CC0"}
    cid = sid.split("_")[0]
    c = idx.get(cid)
    if not c:
        return {"id": sid, "url": "", "author": "", "licence": "unknown"}
    lic = c.get("licence") or ("unknown (web image, found via %s)" % c.get("source", "web"))
    return {"id": cid, "url": c.get("page") or c.get("url"), "image_url": c.get("url"),
            "author": (c.get("author") or "").replace("\n", " ").strip()[:80], "licence": lic}


def main():
    idx = index()
    parts = {}
    for p in sorted(glob.glob(os.path.join(RAW, "manifest_*.json"))):
        if "signs" in p:
            continue
        parts.update(json.load(open(p, encoding="utf-8")))
    # ---------------- textures
    files = sorted(os.listdir(TEX))
    groups = {}
    for f in files:
        if f == "manifest.json":
            continue
        base = re.sub(r"_(albedo|normal|orm|rough|alpha)\.(jpg|png)$", "", f)
        base = re.sub(r"\.(png|jpg)$", "", base)
        groups.setdefault(base, []).append(f)
    tex_man = {"_readme": ("R1-streets world textures. Maps: *_albedo (sRGB), *_normal (OpenGL +Y, linear), "
                           "*_orm (R=AO, G=roughness, B=metalness, linear), *.png = RGBA decal/atlas (sRGB, "
                           "straight alpha), *_rough = roughness for a decal. real_world_m = [U,V] metres covered "
                           "by the whole texture. Real-photo derived unless noted; sources in 'sources' and "
                           "references/credits/R1-streets.md."), "textures": {}}
    missing = []
    for base, fs in sorted(groups.items()):
        m = dict(parts.get(base, {}))
        if not m:
            missing.append(base)
        m["files"] = fs
        sids = m.pop("source_ids", None) or ([m.pop("source")] if isinstance(m.get("source"), str) and len(m.get("source", "")) == 8 else None)
        srcs = []
        if sids:
            srcs = [src_info(s, idx) for s in sids]
        if base in PROC_SOURCES:
            m["method"] = ("procedural layout/wear (modelled on Thai references, see NOTES.md) over CC0 "
                           "Poly Haven photo-scan detail")
            srcs = [{"id": "polyhaven:" + n, "url": f"https://polyhaven.com/a/{n}", "author": "Poly Haven",
                     "licence": "CC0"} for n in PROC_SOURCES[base]]
        m["sources"] = srcs
        tex_man["textures"][base] = m
    json.dump(tex_man, open(os.path.join(TEX, "manifest.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("textures:", len(groups), "missing meta:", missing)
    # ---------------- signs
    sm = {}
    for p in ("manifest_signs.json", "manifest_signs_hiaphat.json"):
        pp = os.path.join(RAW, p)
        if os.path.exists(pp):
            sm.update(json.load(open(pp, encoding="utf-8")))
    sign_list = []
    smissing = []
    from PIL import Image
    for f in sorted(os.listdir(SIGN)):
        if f == "manifest.json":
            continue
        e = dict(sm.get(f, {}))
        if f.endswith("_emissive.png"):
            e = {"file": f, "th": "", "en": "Emissive mask for hiaphat_tier4_lightbox_vertical.png (white = glowing face)",
                 "real_size_m": [0.6, 1.1], "mount": "same as the light box", "kind": "emissive mask",
                 "source_ids": ["c1af38ec"]}
        if not e:
            smissing.append(f)
            continue
        im = Image.open(os.path.join(SIGN, f))
        row = {"file": f, "th": e.get("th", ""), "en": e.get("en", ""),
               "real_size_m": e.get("real_size_m"), "mount": e.get("mount", ""), "kind": e.get("kind", ""),
               "px": list(im.size), "alpha": im.mode == "RGBA"}
        if e.get("notes"):
            row["notes"] = e["notes"]
        if "source_ids" in e:
            row["sources"] = [src_info(s, idx) for s in e["source_ids"]]
        else:
            cid = None
            for k, c in idx.items():
                if c.get("url") == e.get("source_image"):
                    cid = k
                    break
            row["sources"] = [src_info(cid, idx)] if cid else [{"url": e.get("source_page"), "image_url": e.get("source_image"),
                                                                "author": e.get("author", ""), "licence": e.get("licence", "")}]
        row["method"] = ("composited: looped Thai lettering painted onto real photo carrier" if f.startswith("hiaphat_")
                         else "real photo: cropped, perspective-rectified, white-balanced, sharpened")
        sign_list.append(row)
    json.dump({"_readme": ("R1-streets signs, plates, posters: cut from REAL photos (client rule) and rectified "
                           "to a flat front view at the real aspect ratio; real_size_m = [width, height]. "
                           "hiaphat_* = player-shop signs (4 upgrade tiers) composited on real photo carriers "
                           "with looped Thai fonts. blank_* = empty carriers for in-engine text."),
               "signs": sign_list}, open(os.path.join(SIGN, "manifest.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print("signs:", len(sign_list), "missing meta:", smissing)
    # ---------------- credits
    rows = []
    for base, m in tex_man["textures"].items():
        for s in m["sources"]:
            rows.append((f"public/assets/textures/world/{base}_*", s.get("url", ""), s.get("author", ""), s.get("licence", "")))
    for r in sign_list:
        for s in r.get("sources", []):
            rows.append((f"public/assets/img/signs/{r['file']}", s.get("url", "") or s.get("image_url", ""),
                         s.get("author", ""), s.get("licence", "")))
    seen = set()
    out = ["# R1-streets credits", "",
           "Third-party sources of every file R1-streets shipped. Client rule change (2026-10-19): signs, plates, "
           "posters, facades and decals must come from real internet photos, any licence accepted, real brands "
           "allowed. Rows marked `unknown` are web images (Yandex/Flickr all-rights/stock-style sites) whose "
           "licence was NOT verified - the lead should review them before any public release. Everything else is "
           "CC0 / CC BY / CC BY-SA (attribution required for BY/BY-SA). Procedural ground materials list the CC0 "
           "scans they are built on.", "",
           "| shipped path | source URL | author | licence |", "|---|---|---|---|"]
    for row in rows:
        if row in seen:
            continue
        seen.add(row)
        out.append("| " + " | ".join(x.replace("|", "/") for x in row) + " |")
    out += ["", "Scripts that produced these files: `scripts/research/R1/` (signcut.py + specs/*.json, "
            "tex_photo_decals.py, tex_facade_photo.py, tex_ground.py, tex_ground2.py, hiaphat_signs.py). "
            "Reference photos for agents (not shipped) are in references/streets/web/ (git-ignored)."]
    open(CRED, "w", encoding="utf-8").write("\n".join(out) + "\n")
    print("credits rows:", len(seen))


if __name__ == "__main__":
    main()
