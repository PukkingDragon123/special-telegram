"""R1-streets: cut real-photo signs / plates / facade elements into game-ready PNGs.

usage: python3 -I signcut.py <spec.json> [name ...]
spec.json: list of entries
 {"out": "file.png" (relative to public/assets/img/signs or abs dir via "dir"),
  "src": "<id>_1920" | "<id>"  (file in _raw/full, .jpg),
  "quad": [[x,y]x4] TL,TR,BR,BL in source px,
  "w_m": 1.2, "h_m": 0.4, "px": 1024 (output long side),
  "mask": "rect" | "circle" | "octagon" | "diamond" | "round:<r>" | "poly",
  "poly": [[x,y],...] (source px, for mask=poly: applied BEFORE warp),
  "inset": 0.0 (fraction trimmed from each edge after warp),
  "wb": 0.5 (auto-levels strength), "sharp": 0.6,
  "th": "...", "en": "...", "mount": "...", "kind": "...", "notes": "..."}
Writes the PNG and returns manifest rows (merged into _raw/manifest_signs.json).
"""
import glob
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

RAW = "/home/user/special-telegram/references/streets/_raw"
OUT_SIGN = "/home/user/special-telegram/public/assets/img/signs"


def meta_index():
    idx = {}
    for mp in glob.glob(os.path.join(RAW, "*", "meta.jsonl")):
        for line in open(mp, encoding="utf-8"):
            try:
                c = json.loads(line)
            except Exception:
                continue
            idx.setdefault(c["id"], c)
    return idx


def shape_mask(kind, W, H, r=0.0):
    ss = 4
    m = Image.new("L", (W * ss, H * ss), 0)
    d = ImageDraw.Draw(m)
    w, h = W * ss, H * ss
    if kind == "circle":
        d.ellipse([1, 1, w - 2, h - 2], fill=255)
    elif kind == "octagon":
        k = 0.2929
        d.polygon([(w * k, 0), (w * (1 - k), 0), (w, h * k), (w, h * (1 - k)), (w * (1 - k), h),
                   (w * k, h), (0, h * (1 - k)), (0, h * k)], fill=255)
    elif kind == "diamond":
        d.polygon([(w / 2, 0), (w, h / 2), (w / 2, h), (0, h / 2)], fill=255)
    elif kind.startswith("round"):
        rr = float(kind.split(":")[1]) if ":" in kind else 0.06
        d.rounded_rectangle([0, 0, w - 1, h - 1], radius=int(min(w, h) * rr), fill=255)
    else:
        d.rectangle([0, 0, w, h], fill=255)
    return np.asarray(m.resize((W, H), Image.LANCZOS)).astype(np.float32) / 255


def auto_wb(a, strength):
    if strength <= 0:
        return a
    out = a.copy()
    for c in range(3):
        lo, hi = np.percentile(a[..., c], 0.7), np.percentile(a[..., c], 99.6)
        out[..., c] = np.clip((a[..., c] - lo) / max(hi - lo, 1e-3), 0, 1)
    return a * (1 - strength) + out * strength


def process(e, idx):
    src = os.path.join(RAW, "full", e["src"] + ".jpg")
    im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32) / 255
    alpha_src = None
    if e.get("mask") == "poly":
        pm = Image.new("L", (im.shape[1], im.shape[0]), 0)
        ImageDraw.Draw(pm).polygon([tuple(p) for p in e["poly"]], fill=255)
        pm = pm.filter(ImageFilter.GaussianBlur(1.0))
        alpha_src = np.asarray(pm).astype(np.float32) / 255
    w_m, h_m = e["w_m"], e["h_m"]
    px = e.get("px", 1024)
    if w_m >= h_m:
        W, H = px, int(round(px * h_m / w_m))
    else:
        H, W = px, int(round(px * w_m / h_m))
    q = np.array(e["quad"], np.float32)
    dst = np.array([[0, 0], [W - 1, 0], [W - 1, H - 1], [0, H - 1]], np.float32)
    M = cv2.getPerspectiveTransform(q, dst)
    # supersample the warp to avoid aliasing when shrinking
    out = cv2.warpPerspective(im, M, (W, H), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REPLICATE)
    a = None
    if alpha_src is not None:
        a = cv2.warpPerspective(alpha_src, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    ins = e.get("inset", 0.0)
    if ins:
        dx, dy = int(W * ins), int(H * ins)
        out = cv2.resize(out[dy:H - dy, dx:W - dx], (W, H), interpolation=cv2.INTER_LANCZOS4)
        if a is not None:
            a = cv2.resize(a[dy:H - dy, dx:W - dx], (W, H), interpolation=cv2.INTER_LINEAR)
    out = np.clip(out, 0, 1)
    out = auto_wb(out, e.get("wb", 0.4))
    sh = e.get("sharp", 0.5)
    if sh:
        bl = cv2.GaussianBlur(out, (0, 0), 1.2)
        out = np.clip(out + (out - bl) * sh, 0, 1)
    mk = e.get("mask", "rect")
    if mk not in ("rect", "poly"):
        sm = shape_mask(mk, W, H)
        a = sm if a is None else a * sm
    dirp = e.get("dir", OUT_SIGN)
    os.makedirs(dirp, exist_ok=True)
    path = os.path.join(dirp, e["out"])
    if a is not None:
        img = Image.fromarray((np.dstack([out, a]) * 255 + 0.5).astype(np.uint8), "RGBA")
    else:
        img = Image.fromarray((out * 255 + 0.5).astype(np.uint8), "RGB")
    if path.endswith(".jpg"):
        img.convert("RGB").save(path, quality=88, optimize=True)
    else:
        img.save(path, optimize=True)
    cid = e["src"].split("_")[0]
    c = idx.get(cid, {})
    row = {"file": e["out"], "th": e.get("th", ""), "en": e.get("en", ""),
           "real_size_m": [w_m, h_m], "mount": e.get("mount", ""), "kind": e.get("kind", ""),
           "px": [W, H], "alpha": a is not None,
           "source_page": c.get("page") or c.get("url", ""), "source_image": c.get("url", ""),
           "author": c.get("author", ""), "licence": c.get("licence", "unknown (web image)"),
           "notes": e.get("notes", "")}
    print("wrote", path, W, H)
    return row


def main():
    spec = json.load(open(sys.argv[1], encoding="utf-8"))
    names = set(sys.argv[2:])
    idx = meta_index()
    man_p = os.path.join(RAW, "manifest_signs.json")
    man = json.load(open(man_p, encoding="utf-8")) if os.path.exists(man_p) else {}
    for e in spec:
        if names and e["out"] not in names:
            continue
        row = process(e, idx)
        man[e["out"]] = row
    json.dump(man, open(man_p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
