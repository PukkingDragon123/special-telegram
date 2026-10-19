#!/usr/bin/env python3
"""R6-pbr: search Openverse (CC-licensed images, mostly Flickr/Wikimedia) for photo sources.

Usage: python3 -I openverse_search.py <set_name> "<query>" [more queries...]
Only licences that allow commercial use AND modification (cc0, pdm, by, by-sa) are requested.
Writes scripts/_cache/pbr_dl/openverse/<set>.json + small thumbnails <set>/NNN.jpg (data only).
"""
import json
import os
import re
import sys
import time

import requests

UA = "HiaPhatGameDev/0.1 (https://github.com/PukkingDragon123/special-telegram)"
API = "https://api.openverse.org/v1/images/"
CACHE = "/home/user/special-telegram/scripts/_cache/pbr_dl/openverse"
S = requests.Session()
S.headers["User-Agent"] = UA


def get_json(params):
    for i in range(6):
        r = S.get(API, params=params, timeout=60)
        if r.status_code == 429:
            ra = r.headers.get("retry-after", "30")
            time.sleep((int(ra) if ra.isdigit() else 30) + 2)
            continue
        r.raise_for_status()
        return r.json()
    raise RuntimeError("429 loop")


def small_url(url):
    m = re.match(r"(https://live\.staticflickr\.com/\d+/\d+_[0-9a-f]+)(_[a-z])?\.jpg", url or "")
    if m:
        return m.group(1) + "_n.jpg"   # 320 px
    return None


def main():
    name = sys.argv[1]
    queries = sys.argv[2:]
    os.makedirs(os.path.join(CACHE, name), exist_ok=True)
    out = {}
    for q in queries:
        d = get_json(dict(q=q, page_size=20, license_type="commercial,modification", mature="false"))
        for r in d.get("results", []):
            out[r["id"]] = dict(id=r["id"], title=r.get("title"), query=q, url=r.get("url"), landing=r.get("foreign_landing_url"),
                                creator=r.get("creator"), creator_url=r.get("creator_url"), license=r.get("license"),
                                license_version=r.get("license_version"), license_url=r.get("license_url"),
                                provider=r.get("provider"), source=r.get("source"), width=r.get("width"), height=r.get("height"),
                                attribution=r.get("attribution"))
        time.sleep(3)
    items = sorted(out.values(), key=lambda r: (r["query"], r["id"]))
    for i, r in enumerate(items):
        r["idx"] = i
        fn = os.path.join(CACHE, name, f"{i:03d}.jpg")
        r["thumbfile"] = fn
        if os.path.exists(fn):
            continue
        su = small_url(r["url"])
        if not su:
            continue
        try:
            rr = S.get(su, timeout=60)
            if rr.status_code == 200 and rr.content[:3] == b"\xff\xd8\xff":
                open(fn, "wb").write(rr.content)
        except Exception as e:  # noqa
            print("thumb fail", r["id"], e)
        time.sleep(0.25)
    json.dump(items, open(os.path.join(CACHE, f"{name}.json"), "w"), indent=1, ensure_ascii=False)
    print(name, len(items))


if __name__ == "__main__":
    main()
