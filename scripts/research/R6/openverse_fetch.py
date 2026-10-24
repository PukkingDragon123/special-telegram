#!/usr/bin/env python3
"""R6-pbr: download selected Openverse results (by idx) at full available size.
For Flickr items, tries the larger static sizes (_k 2048, _h 1600) via the landing page only if
the API url is the 1024 '_b' size and the Flickr 'sizes' are not accessible -> falls back to 'url'.
Usage: python3 -I openverse_fetch.py <set> <idx> [<idx> ...]
"""
import json
import os
import sys
import time

import requests

UA = "HiaPhatGameDev/0.1 (https://github.com/PukkingDragon123/special-telegram)"
CACHE = "/home/user/special-telegram/scripts/_cache/pbr_dl/openverse"
S = requests.Session()
S.headers["User-Agent"] = UA


def main():
    name = sys.argv[1]
    items = {r["idx"]: r for r in json.load(open(os.path.join(CACHE, f"{name}.json")))}
    od = os.path.join(CACHE, f"{name}_full")
    os.makedirs(od, exist_ok=True)
    selp = os.path.join(CACHE, f"{name}_selected.json")
    sel = json.load(open(selp)) if os.path.exists(selp) else {}
    for a in sys.argv[2:]:
        r = items[int(a)]
        fn = os.path.join(od, f"{int(a):03d}.jpg")
        if not os.path.exists(fn):
            rr = S.get(r["url"], timeout=120)
            rr.raise_for_status()
            if rr.content[:3] != b"\xff\xd8\xff" and rr.content[:8] != b"\x89PNG\r\n\x1a\n":
                raise RuntimeError("not an image")
            open(fn, "wb").write(rr.content)
            time.sleep(0.5)
        r = dict(r)
        r["file"] = fn
        sel[str(a)] = r
        print(a, r["license"], r["title"][:60] if r.get("title") else "", os.path.getsize(fn))
    json.dump(sel, open(selp, "w"), indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main()
