#!/usr/bin/env python3
"""Harvest look-only reference photos from DuckDuckGo image search and Wikimedia Commons
categories (R3-people; replaces the Bing harvester whose results were off-topic).

Usage: python3 -I web_refs2.py <jobs.json> <out_web_dir> <tmp_dl_dir>
jobs.json: [{"src": "ddg", "q": "...", "prefix": "...", "n": 5},
            {"src": "commons", "cat": "Category:...", "prefix": "...", "n": 6}]
Downloads go to a fresh tmp dir, are verified/re-encoded with Pillow (max 1024 px) and
recorded in index.json with the query, image URL and page URL.  Nothing is executed.
"""
import hashlib
import io
import json
import os
import re
import sys
import time

import requests
from PIL import Image

BROWSER_UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/126.0 Safari/537.36")
WM_UA = "HiaPhatGameDev/0.1 (https://github.com/PukkingDragon123/special-telegram)"
S = requests.Session()
S.headers.update({"User-Agent": BROWSER_UA, "Accept-Language": "en-US,en;q=0.9"})
W = requests.Session()
W.headers.update({"User-Agent": WM_UA})
MAX_BYTES = 15 << 20
SKIP_HOSTS = ("shutterstock.com/search", "logo", "vector", "clipart", "cartoon", "illustration")


def _ddg_once(q, pages=1):
    r = S.get("https://duckduckgo.com/", params={"q": q, "iax": "images", "ia": "images"}, timeout=30)
    m = re.search(r'vqd=["\']?([\d-]+)', r.text)
    if not m:
        return None
    time.sleep(1.5)
    vqd = m.group(1)
    out = []
    for p in range(1, pages + 1):
        r2 = S.get("https://duckduckgo.com/i.js",
                   params={"l": "us-en", "o": "json", "q": q, "vqd": vqd, "f": ",,,,,", "p": str(p)},
                   headers={"Referer": "https://duckduckgo.com/"}, timeout=30)
        try:
            d = r2.json()
        except ValueError:
            break
        for x in d.get("results", []):
            out.append({"murl": x.get("image", ""), "purl": x.get("url", ""), "t": x.get("title", ""),
                        "w": x.get("width", 0), "h": x.get("height", 0)})
        time.sleep(1.0)
    return out


_LAST = [0.0]


def ddg(q, pages=1, tries=5):
    """DuckDuckGo image search with back-off: an empty answer usually means a soft rate limit."""
    gap = time.time() - _LAST[0]
    if gap < 8.0:
        time.sleep(8.0 - gap)
    _LAST[0] = time.time()
    for t in range(tries):
        try:
            out = _ddg_once(q, pages)
        except requests.RequestException as e:
            print("ddg error", e, file=sys.stderr)
            out = None
        if out:
            time.sleep(2.0)
            return out
        wait = 30 * (t + 1)
        print(f"ddg: empty for {q!r}, sleeping {wait}s", file=sys.stderr, flush=True)
        time.sleep(wait)
    return []


def commons(cat, limit=60):
    out = []
    params = {"action": "query", "format": "json", "generator": "categorymembers", "gcmtitle": cat,
              "gcmtype": "file", "gcmlimit": str(limit), "prop": "imageinfo",
              "iiprop": "url|extmetadata|size|mime", "iiurlwidth": "1024"}
    r = W.get("https://commons.wikimedia.org/w/api.php", params=params, timeout=40)
    if r.status_code == 429:
        time.sleep(5)
        r = W.get("https://commons.wikimedia.org/w/api.php", params=params, timeout=40)
    d = r.json()
    for p in (d.get("query", {}).get("pages", {}) or {}).values():
        ii = (p.get("imageinfo") or [{}])[0]
        if not ii.get("mime", "").startswith("image/jpeg"):
            continue
        md = ii.get("extmetadata", {})
        out.append({"murl": ii.get("thumburl") or ii.get("url"), "purl": ii.get("descriptionurl", ""),
                    "t": p.get("title", ""),
                    "licence": (md.get("LicenseShortName") or {}).get("value", ""),
                    "author": re.sub("<[^>]+>", "", (md.get("Artist") or {}).get("value", ""))[:120]})
    time.sleep(1.2)
    return out


def fetch(url, tmp, sess):
    r = sess.get(url, timeout=30, stream=True)
    r.raise_for_status()
    buf = io.BytesIO()
    for chunk in r.iter_content(65536):
        buf.write(chunk)
        if buf.tell() > MAX_BYTES:
            raise ValueError("too big")
    p = os.path.join(tmp, hashlib.sha1(url.encode()).hexdigest()[:16] + ".bin")
    with open(p, "wb") as f:
        f.write(buf.getvalue())
    return p


def to_jpg(src, dst, min_side=400):
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
    jobs_file, out_dir, tmp = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(tmp, exist_ok=True)
    idx_path = os.path.join(out_dir, "index.json")
    index = json.load(open(idx_path)) if os.path.exists(idx_path) else []
    seen = {e["source"] for e in index}
    jobs = json.load(open(jobs_file))
    for job in jobs:
        prefix, n = job["prefix"], job.get("n", 5)
        have = sum(1 for e in index if e["file"].rsplit("_", 1)[0] == prefix)
        if have >= n:
            continue
        try:
            if job["src"] == "ddg":
                cands = ddg(job["q"])
                sess = S
            else:
                cands = commons(job["cat"])
                sess = W
        except Exception as e:  # noqa: BLE001
            print("search fail", job, e, file=sys.stderr)
            time.sleep(3)
            continue
        k = have
        for c in cands:
            if k >= n:
                break
            u = c["murl"]
            if not u or u in seen or any(s in u.lower() for s in SKIP_HOSTS):
                continue
            seen.add(u)
            try:
                p = fetch(u, tmp, sess)
                fn = f"{prefix}_{k + 1:02d}.jpg"
                size = to_jpg(p, os.path.join(out_dir, fn))
                os.remove(p)
            except Exception as e:  # noqa: BLE001
                print("  skip", u[:90], e, file=sys.stderr)
                continue
            k += 1
            rec = {"file": fn, "query": job.get("q") or job.get("cat"), "source": u, "page": c["purl"],
                   "title": c["t"], "size": list(size), "backend": job["src"]}
            if "licence" in c:
                rec["licence"] = c["licence"]
                rec["author"] = c["author"]
            index.append(rec)
            print(fn, size, u[:80], flush=True)
            time.sleep(0.5 if job["src"] == "ddg" else 1.1)
        with open(idx_path, "w") as f:
            json.dump(index, f, ensure_ascii=False, indent=1)
    print("total", len(index))


if __name__ == "__main__":
    main()
