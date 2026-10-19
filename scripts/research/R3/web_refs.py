#!/usr/bin/env python3
"""Harvest look-only web reference photos (unknown licence -> references/**/web/, git-ignored).

Usage: python3 -I web_refs.py <queries.json> <out_web_dir> <tmp_dl_dir>
queries.json: [{"q": "...", "prefix": "vendor", "n": 4}, ...]

Bing image-search HTML is parsed for the `m` JSON (murl = media url, purl = page url).
Each download goes to a fresh tmp dir, is decoded/verified with Pillow, re-encoded as a
max-1024px JPEG into the web dir and recorded in index.json (query, source, page).
Nothing downloaded is ever executed.
"""
import hashlib
import html
import io
import json
import os
import re
import sys
import time
import urllib.parse

import requests
from PIL import Image

BROWSER_UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/126.0 Safari/537.36")
S = requests.Session()
S.headers.update({"User-Agent": BROWSER_UA, "Accept-Language": "en-US,en;q=0.9"})
M_RE = re.compile(r'class="iusc"[^>]*?\sm="([^"]+)"')
MAX_BYTES = 12 << 20


def bing(q, first=1):
    url = "https://www.bing.com/images/search?" + urllib.parse.urlencode(
        {"q": q, "form": "HDRSC2", "first": first, "qft": "+filterui:imagesize-large"})
    r = S.get(url, timeout=30)
    r.raise_for_status()
    out = []
    for m in M_RE.finditer(r.text):
        try:
            d = json.loads(html.unescape(m.group(1)))
        except json.JSONDecodeError:
            continue
        if d.get("murl"):
            out.append({"murl": d["murl"], "purl": d.get("purl", ""), "t": d.get("t", "")})
    return out


def fetch(url, tmp):
    r = S.get(url, timeout=25, stream=True)
    r.raise_for_status()
    buf = io.BytesIO()
    for chunk in r.iter_content(65536):
        buf.write(chunk)
        if buf.tell() > MAX_BYTES:
            raise ValueError("too big")
    data = buf.getvalue()
    p = os.path.join(tmp, hashlib.sha1(url.encode()).hexdigest()[:16] + ".bin")
    with open(p, "wb") as f:
        f.write(data)
    return p


def to_jpg(src, dst, min_side=360):
    with Image.open(src) as im:
        im.verify()
    with Image.open(src) as im:
        im = im.convert("RGB")
        w, h = im.size
        if min(w, h) < min_side:
            raise ValueError(f"too small {w}x{h}")
        s = 1024 / max(w, h)
        if s < 1:
            im = im.resize((round(w * s), round(h * s)), Image.LANCZOS)
        im.save(dst, "JPEG", quality=86)
        return im.size


def main():
    qfile, out_dir, tmp = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(tmp, exist_ok=True)
    idx_path = os.path.join(out_dir, "index.json")
    index = json.load(open(idx_path)) if os.path.exists(idx_path) else []
    seen = {e["source"] for e in index}
    with open(qfile) as f:
        queries = json.load(f)
    for qd in queries:
        q, prefix, n = qd["q"], qd["prefix"], qd.get("n", 4)
        have = sum(1 for e in index if e["file"].startswith(prefix + "_"))
        if have >= n:
            continue
        try:
            cands = bing(q)
        except Exception as e:  # noqa: BLE001
            print("search fail", q, e, file=sys.stderr)
            time.sleep(3)
            continue
        time.sleep(1.2)
        k = have
        for c in cands:
            if k >= n:
                break
            if c["murl"] in seen:
                continue
            seen.add(c["murl"])
            try:
                p = fetch(c["murl"], tmp)
                fn = f"{prefix}_{k + 1:02d}.jpg"
                size = to_jpg(p, os.path.join(out_dir, fn))
                os.remove(p)
            except Exception as e:  # noqa: BLE001
                print("  skip", c["murl"][:90], e, file=sys.stderr)
                continue
            k += 1
            index.append({"file": fn, "query": q, "source": c["murl"], "page": c["purl"],
                          "title": c["t"], "size": list(size)})
            print(fn, size, c["murl"][:80])
            time.sleep(0.4)
        with open(idx_path, "w") as f:
            json.dump(index, f, ensure_ascii=False, indent=1)
    print("total", len(index))


if __name__ == "__main__":
    main()
