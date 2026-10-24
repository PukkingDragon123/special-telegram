#!/usr/bin/env python3
"""Assemble R3 outputs into public/assets/textures/{faces,clothing,hair,ghosts} with manifests.

Usage: python3 -I finalize.py <faces_out> <misc_out_root> <face_selection.json> <public_textures_dir>
"""
import json
import os
import shutil
import sys

from PIL import Image

faces_out, misc_root, sel_path, pub = sys.argv[1:5]
SFHQ = {
    "pt2": ("https://www.kaggle.com/datasets/selfishgene/synthetic-faces-high-quality-sfhq-part-2",
            "https://huggingface.co/datasets/bitmind/SyntheticFacesHQ (SFHQ-part2.zip mirror)"),
    "pt3": ("https://www.kaggle.com/datasets/selfishgene/synthetic-faces-high-quality-sfhq-part-3",
            "https://huggingface.co/datasets/bitmind/SyntheticFacesHQ (SFHQ-part3.zip mirror)"),
    "pt4": ("https://www.kaggle.com/datasets/selfishgene/synthetic-faces-high-quality-sfhq-part-4",
            "https://huggingface.co/datasets/bitmind/SyntheticFacesHQ (SFHQ-part4.zip mirror)"),
}

# ------------------------------------------------------------------ faces
fd = os.path.join(pub, "faces")
os.makedirs(fd, exist_ok=True)
meta = json.load(open(os.path.join(faces_out, "_build_meta.json")))
sel = json.load(open(sel_path))
faces = []
for e in sel:
    fid = e["id"]
    m = meta[fid]
    rec = {"id": fid, "file": f"{fid}.jpg", "detail": f"{fid}_detail.jpg", "mask": f"{fid}_mask.png",
           "sex": e["sex"], "ageGroup": e["ageGroup"], "look": e.get("look", ""), "roles": e.get("roles", []),
           "avgSkinRGB": m["avgSkinRGB"], "avgSkinHex": m["avgSkinHex"], "variants": {}}
    for v in e.get("variants", []):
        rec["variants"][v] = {"file": f"{fid}_{v}.jpg", "detail": f"{fid}_{v}_detail.jpg", "mask": f"{fid}_{v}_mask.png"}
    part = e["src"].split("_")[1]
    rec["source"] = {"dataset": "Synthetic Faces High Quality (SFHQ) by David Beniaguev — StyleGAN2-generated faces of people who do not exist",
                     "image": e["src"], "page": SFHQ[part][0], "downloadedFrom": SFHQ[part][1]}
    rec["licence"] = "CC0 1.0 (Kaggle dataset licence); author: 'no privacy or license issues… use as you see fit'"
    faces.append(rec)
    for f in [rec["file"], rec["detail"], rec["mask"]] + [x for v in rec["variants"].values() for x in v.values()]:
        shutil.copy2(os.path.join(faces_out, f), os.path.join(fd, f))

misc_faces = json.load(open(os.path.join(misc_root, "faces", "manifest.json")))["textures"]
for k, v in misc_faces.items():
    shutil.copy2(os.path.join(misc_root, "faces", v["file"]), os.path.join(fd, v["file"]))

face_manifest = {
    "about": "Static photo faces (Chilla's Art style) for low-poly heads. 512x512 sRGB JPG, front planar projection.",
    "alignment": {"eyeRight_image_left": [0.36, 0.44], "eyeLeft_image_right": [0.64, 0.44], "mouthCentre": [0.50, 0.73],
                  "chinY": "≈0.90 (0.87–0.93 per face)", "uvOrigin": "top-left (image coords); flip V for three.js UVs",
                  "notes": "eye centre = midpoint of the eye corners; outside the face oval the texture is the face's own avgSkinRGB, so the rest of the head uses a flat material of that colour"},
    "processing": "MediaPipe 478-pt landmarks -> exact 3-point affine; hair/background masked with the MediaPipe multiclass segmenter and refilled with extrapolated skin + the face's own micro-detail; asymmetric low-frequency lighting removed (symmetric form shading partly kept); de-shine; low-frequency colour transfer to avgSkinRGB at the oval edge",
    "avgSkinRGB": "sRGB 0-255; robust mean (20th–85th luminance percentile) of visible skin with eyes/brows/lips/nose excluded",
    "detailFormula": {
        "encode": "detail_srgb = lin2srgb( clamp( K * srgb2lin(face_srgb) / srgb2lin(avgSkinRGB/255), 0, 1 ) ),  K = 0.2158 (= srgb2lin(128/255))",
        "decode_glsl": "vec3 albedoLin = srgb2lin(texture(detail, uv).rgb) / 0.2158 * srgb2lin(skinTone);",
        "notes": "skin = mid-grey (≈128) in the detail map; eyes, teeth, lips keep their own relative colour. Use *_mask.png (255 = tintable skin, 0 = eyes / mouth interior) to blend: albedo = mix(faceTexture, detail-tinted, mask) when re-skinning; three.js textures: set detail.colorSpace = SRGBColorSpace and multiply in linear."},
    "variants": "Expression swaps (faces never animate): dumb_thinking (eyes rolled up/inward, brows uneven, mouth slack-open), drunk (flushed cheeks/nose, heavy half-lids, lopsided grin), sleep (closed eyelids, lips slightly parted), shock (wide eyes, raised brows, O-mouth with real-photo teeth), scream (wide eyes, big open mouth with real-photo teeth). Made by TPS landmark warps + transplanted mouth interiors from other CC0 SFHQ faces (SFHQ_pt2_00078890, SFHQ_pt4_00047693, SFHQ_pt4_00089594).",
    "faces": faces,
    "bodySkin": {k: {kk: vv for kk, vv in v.items() if kk != "kind"} | {"kind": v.get("kind")} for k, v in misc_faces.items()},
}
json.dump(face_manifest, open(os.path.join(fd, "manifest.json"), "w"), ensure_ascii=False, indent=1)
print("faces:", len(faces), "files:", len(os.listdir(fd)))

# ------------------------------------------------------------------ other folders
for folder in ("clothing", "hair", "ghosts"):
    src = os.path.join(misc_root, folder)
    dst = os.path.join(pub, folder)
    os.makedirs(dst, exist_ok=True)
    man = json.load(open(os.path.join(src, "manifest.json")))
    used = set()
    for k, v in man["textures"].items():
        for key in ("file", "normal"):
            if key in v:
                used.add(v[key])
    missing = [f for f in used if not os.path.exists(os.path.join(src, f))]
    if missing:
        print("MISSING", folder, missing)
    for f in sorted(used):
        sp = os.path.join(src, f)
        dp = os.path.join(dst, f)
        if f.endswith("_normal.jpg"):
            with Image.open(sp) as im:
                if im.size[0] > 512:
                    im = im.resize((512, 512), Image.LANCZOS)
                im.convert("RGB").save(dp, "JPEG", quality=88)
        elif f.endswith(".jpg"):
            with Image.open(sp) as im:
                im.convert("RGB").save(dp, "JPEG", quality=85, optimize=True)
        else:
            shutil.copy2(sp, dp)
    orphans = [f for f in os.listdir(src) if f not in used and f != "manifest.json"]
    man["about"] = {
        "clothing": "Clothing fabrics / prints built from REAL photos (web photos of real fabrics & garments, Poly Haven CC0 fabric scans). Tileable unless 'kind' says otherwise. Normal maps are OpenGL (+Y) convention, 512 px.",
        "hair": "Hair textures from REAL hair photos: solid shell textures (strands along V) + RGBA hair-card atlases (alpha-test ~0.35 or alpha-hash, double-sided).",
        "ghosts": "Thai-ghost textures from REAL photos (see references/ghosts/NOTES.md for how each ghost uses them).",
    }[folder]
    man["normalConvention"] = "OpenGL (+Y up)"
    json.dump(man, open(os.path.join(dst, "manifest.json"), "w"), ensure_ascii=False, indent=1)
    print(folder, len(man["textures"]), "textures; orphans skipped:", orphans)
