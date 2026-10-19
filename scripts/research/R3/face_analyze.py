#!/usr/bin/env python3
"""Analyse candidate synthetic face images with MediaPipe FaceLandmarker.

Usage: python -I face_analyze.py <model.task> <out.json> <img_dir> [<img_dir> ...]

Writes per image: 478 landmarks (pixel coords), blendshapes, head yaw/pitch/roll,
a crude lighting-asymmetry metric and mean cheek colour.  Images are treated as
untrusted data (decoded with OpenCV only).
"""
import json
import math
import os
import sys

import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision


def euler_from_matrix(m):
    r = np.array(m)[:3, :3]
    sy = math.sqrt(r[0, 0] ** 2 + r[1, 0] ** 2)
    pitch = math.degrees(math.atan2(r[2, 1], r[2, 2]))
    yaw = math.degrees(math.atan2(-r[2, 0], sy))
    roll = math.degrees(math.atan2(r[1, 0], r[0, 0]))
    return yaw, pitch, roll


def main():
    model, out = sys.argv[1], sys.argv[2]
    dirs = sys.argv[3:]
    opts = vision.FaceLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=model),
        output_face_blendshapes=True,
        output_facial_transformation_matrixes=True,
        num_faces=2)
    lm = vision.FaceLandmarker.create_from_options(opts)
    res = {}
    if os.path.exists(out):
        with open(out) as f:
            res = json.load(f)
    files = []
    for d in dirs:
        for fn in sorted(os.listdir(d)):
            if fn.lower().endswith((".jpg", ".jpeg", ".png")):
                files.append(os.path.join(d, fn))
    for i, p in enumerate(files):
        key = os.path.basename(p)
        if key in res:
            continue
        img = cv2.imread(p, cv2.IMREAD_COLOR)
        if img is None:
            continue
        h, w = img.shape[:2]
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        r = lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
        if not r.face_landmarks:
            res[key] = {"path": p, "ok": False}
            continue
        pts = np.array([[q.x * w, q.y * h] for q in r.face_landmarks[0]], dtype=np.float32)
        bs = {c.category_name: round(float(c.score), 4) for c in r.face_blendshapes[0]}
        yaw, pitch, roll = euler_from_matrix(r.facial_transformation_matrixes[0])
        # cheeks: mediapipe 50 (subject right cheek, image left), 280 (image right)
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
        def patch(idx, rad):
            x, y = pts[idx]
            x0, x1 = int(max(0, x - rad)), int(min(w, x + rad))
            y0, y1 = int(max(0, y - rad)), int(min(h, y + rad))
            return lab[y0:y1, x0:x1].reshape(-1, 3).mean(0), img[y0:y1, x0:x1].reshape(-1, 3).mean(0)
        iod = float(np.linalg.norm(pts[263] - pts[33]))
        rad = max(4, iod * 0.08)
        lc, lbgr = patch(50, rad)
        rc, rbgr = patch(280, rad)
        fh, _ = patch(151, rad)
        res[key] = {
            "path": p, "ok": True, "n_faces": len(r.face_landmarks),
            "yaw": round(yaw, 2), "pitch": round(pitch, 2), "roll": round(roll, 2),
            "bs": bs, "iod": round(iod, 1),
            "light_asym": round(float(lc[0] - rc[0]), 2),
            "cheekL_L": round(float(lc[0]), 1), "cheekR_L": round(float(rc[0]), 1),
            "forehead_L": round(float(fh[0]), 1),
            "cheek_rgb": [round(float(v), 1) for v in ((lbgr + rbgr) / 2)[::-1]],
            "lm": pts.round(2).tolist(),
        }
        if i % 50 == 0:
            print(i, "/", len(files), file=sys.stderr)
            with open(out, "w") as f:
                json.dump(res, f)
    with open(out, "w") as f:
        json.dump(res, f)
    print("analysed", len(res))


if __name__ == "__main__":
    main()
