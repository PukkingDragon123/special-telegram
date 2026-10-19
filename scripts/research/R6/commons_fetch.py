#!/usr/bin/env python3
"""R6-pbr: download selected Wikimedia Commons images (by search-result index) at a standard
thumbnail width (960/1280/1920/3840) or the original if smaller. Data only, never executed.

Usage: python3 -I commons_fetch.py <set_name> <idx>[:width] [<idx>[:width] ...]
Reads commons/<set>.json (from commons_search.py); writes commons/<set>_full/<idx>.jpg and updates
commons/<set>_selected.json with licence/author/url metadata.
"""
import json
import os
import re
import sys
import time

import requests

UA = "HiaPhatGameDev/0.1 (https://github.com/PukkingDragon123/special-telegram)"
CACHE = "/home/user/special-telegram/scripts/_cache/pbr_dl/commons"
S = requests.Session()
S.headers["User-Agent"] = UA


def get(url):
    for i in range(8):
        r = S.get(url, timeout=120)
        if r.status_code == 429:
            ra = r.headers.get("retry-after", "30")
            time.sleep((int(ra) if ra.isdigit() else 30) + 5)
            continue
        r.raise_for_status()
        return r.content
    raise RuntimeError("429 loop " + url)


def main():
    name = sys.argv[1]
    res = json.load(open(os.path.join(CACHE, f"{name}.json")))
    items = sorted(res.items())
    out_dir = os.path.join(CACHE, f"{name}_full")
    os.makedirs(out_dir, exist_ok=True)
    selp = os.path.join(CACHE, f"{name}_selected.json")
    sel = json.load(open(selp)) if os.path.exists(selp) else {}
    for arg in sys.argv[2:]:
        idx, _, w = arg.partition(":")
        idx = int(idx)
        w = int(w or 1920)
        title, r = items[idx]
        fn = os.path.join(out_dir, f"{idx:03d}.jpg")
        if not os.path.exists(fn):
            if r["width"] <= w or not r.get("thumb"):
                url = r["url"]
            else:
                url = re.sub(r"/(\d+)px-", f"/{w}px-", r["thumb"])
            data = get(url)
            if data[:3] != b"\xff\xd8\xff" and data[:8] != b"\x89PNG\r\n\x1a\n":
                raise RuntimeError("not an image: " + url)
            open(fn, "wb").write(data)
            time.sleep(2.0)
        r = dict(r)
        r["file"] = fn
        sel[str(idx)] = r
        print(idx, title, r["license"], os.path.getsize(fn))
    json.dump(sel, open(selp, "w"), indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main()
