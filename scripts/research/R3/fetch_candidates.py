#!/usr/bin/env python3
"""Download candidate source photos for textures (R3-people).

Usage: python3 -I fetch_candidates.py <jobs.json> <cand_root>
jobs.json: [{"name": "singlet_rib", "q": ["white rib knit fabric texture", ...], "n": 8}, ...]
Each job gets its own fresh directory <cand_root>/<name>/ with NN.jpg (re-encoded, max 2048 px)
and index.json (image url, page url, title).  Downloads are untrusted: verified with Pillow,
never executed.
"""
import hashlib
import io
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from web_refs2 import S, ddg  # noqa: E402
from PIL import Image  # noqa: E402

MAX_BYTES = 20 << 20


def grab(url, tmpdir):
    r = S.get(url, timeout=30, stream=True)
    r.raise_for_status()
    buf = io.BytesIO()
    for chunk in r.iter_content(65536):
        buf.write(chunk)
        if buf.tell() > MAX_BYTES:
            raise ValueError("too big")
    p = os.path.join(tmpdir, hashlib.sha1(url.encode()).hexdigest()[:16] + ".bin")
    with open(p, "wb") as f:
        f.write(buf.getvalue())
    return p


def main():
    jobs = json.load(open(sys.argv[1]))
    root = sys.argv[2]
    for job in jobs:
        d = os.path.join(root, job["name"])
        os.makedirs(d, exist_ok=True)
        tmp = os.path.join(root, "_tmp_" + job["name"])
        os.makedirs(tmp, exist_ok=True)
        ip = os.path.join(d, "index.json")
        idx = json.load(open(ip)) if os.path.exists(ip) else []
        if len(idx) >= job.get("n", 8):
            continue
        seen = {e["image"] for e in idx}
        qs = job["q"] if isinstance(job["q"], list) else [job["q"]]
        cands = []
        for q in qs:
            try:
                for c in ddg(q):
                    c["query"] = q
                    cands.append(c)
            except Exception as e:  # noqa: BLE001
                print("search fail", q, e, file=sys.stderr)
            time.sleep(1.5)
        # interleave queries
        k = len(idx)
        min_side = job.get("min_side", 500)
        for c in cands:
            if k >= job.get("n", 8):
                break
            u = c["murl"]
            if not u or u in seen:
                continue
            seen.add(u)
            try:
                p = grab(u, tmp)
                with Image.open(p) as im:
                    im.verify()
                with Image.open(p) as im:
                    im = im.convert("RGB")
                    if min(im.size) < min_side:
                        raise ValueError("small %s" % (im.size,))
                    s = 2048 / max(im.size)
                    if s < 1:
                        im = im.resize((round(im.size[0] * s), round(im.size[1] * s)), Image.LANCZOS)
                    fn = f"{k + 1:02d}.jpg"
                    im.save(os.path.join(d, fn), "JPEG", quality=92)
                os.remove(p)
            except Exception as e:  # noqa: BLE001
                print("  skip", u[:80], e, file=sys.stderr)
                continue
            k += 1
            idx.append({"file": fn, "image": u, "page": c["purl"], "title": c["t"], "query": c["query"]})
            print(job["name"], fn, u[:80], flush=True)
            time.sleep(0.4)
        json.dump(idx, open(ip, "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
