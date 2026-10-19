#!/usr/bin/env python3
"""R6-pbr: search Wikimedia Commons (File namespace) and fetch small thumbnails + licence metadata.

Usage: python3 -I commons_search.py <out_name> "<query1>" ["<query2>" ...]
Writes scripts/_cache/pbr_dl/commons/<out_name>.json and thumbs in commons/<out_name>/.
Respects >= 1 s between API calls and backs off on HTTP 429.
"""
import html
import json
import os
import re
import sys
import time

import requests

UA = "HiaPhatGameDev/0.1 (https://github.com/PukkingDragon123/special-telegram)"
API = "https://commons.wikimedia.org/w/api.php"
CACHE = "/home/user/special-telegram/scripts/_cache/pbr_dl/commons"
OK_LIC = re.compile(r"^(cc0|public domain|pd|cc[- ]by(-sa)?[- ]?\d|cc by(-sa)? \d|cc-by|cc-by-sa)", re.I)
S = requests.Session()
S.headers["User-Agent"] = UA
_last = [0.0]


def get(params):
    for i in range(12):
        wait = 3.0 - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        r = S.get(API, params=params, timeout=60)
        if r.status_code == 429:
            ra = r.headers.get("retry-after", "30")
            time.sleep((int(ra) if ra.isdigit() else 30) + 3 + 5 * i)
            continue
        r.raise_for_status()
        return r.json()
    raise RuntimeError("too many 429")


def strip(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


def main():
    name = sys.argv[1]
    queries = sys.argv[2:]
    out_dir = os.path.join(CACHE, name)
    os.makedirs(out_dir, exist_ok=True)
    results = {}
    for q in queries:
        data = get(dict(action="query", format="json", generator="search", gsrnamespace=6, gsrsearch=q, gsrlimit=40,
                        prop="imageinfo", iiprop="url|size|extmetadata|mime", iiurlwidth=360))
        for p in (data.get("query", {}).get("pages", {}) or {}).values():
            ii = (p.get("imageinfo") or [{}])[0]
            if ii.get("mime") not in ("image/jpeg", "image/png"):
                continue
            em = ii.get("extmetadata", {})
            lic = strip(em.get("LicenseShortName", {}).get("value", ""))
            if not OK_LIC.search(lic):
                continue
            title = p["title"]
            results[title] = dict(title=title, query=q, license=lic,
                                  licenseUrl=strip(em.get("LicenseUrl", {}).get("value", "")),
                                  artist=strip(em.get("Artist", {}).get("value", ""))[:200],
                                  credit=strip(em.get("Credit", {}).get("value", ""))[:200],
                                  descurl=ii.get("descriptionurl"), url=ii.get("url"), thumb=ii.get("thumburl"),
                                  width=ii.get("width"), height=ii.get("height"))
    # thumbnails (upload.wikimedia.org; keep polite pacing)
    for i, (t, r) in enumerate(sorted(results.items())):
        fn = os.path.join(out_dir, f"{i:03d}.jpg")
        r["thumbfile"] = fn
        if not os.path.exists(fn) and r.get("thumb"):
            time.sleep(1.2)
            try:
                rr = S.get(r["thumb"], timeout=60)
                for k in range(5):
                    if rr.status_code != 429:
                        break
                    ra = rr.headers.get("retry-after", "30")
                    time.sleep((int(ra) if ra.isdigit() else 30) + 3)
                    rr = S.get(r["thumb"], timeout=60)
                rr.raise_for_status()
                open(fn, "wb").write(rr.content)
            except Exception as e:  # noqa
                print("thumb fail", t, e)
    json.dump(results, open(os.path.join(CACHE, f"{name}.json"), "w"), indent=1, ensure_ascii=False)
    print(name, len(results), "results")


if __name__ == "__main__":
    main()
