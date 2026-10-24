"""R1-streets: fast parallel download of chosen candidate ids (any source).

usage: python3 -I fetch_web.py id1 id2 ...      -> _raw/full/<id>.jpg (bytes only)
Falls back to the search-engine thumbnail when the original host fails.
"""
import concurrent.futures as cf
import glob
import json
import os
import sys

import requests

RAW = "/home/user/special-telegram/references/streets/_raw"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0 Safari/537.36")
WM_UA = "HiaPhatGameDev/0.1 (https://github.com/PukkingDragon123/special-telegram)"


def index():
    idx = {}
    for mp in glob.glob(os.path.join(RAW, "*", "meta.jsonl")):
        for line in open(mp, encoding="utf-8"):
            try:
                c = json.loads(line)
            except Exception:
                continue
            idx.setdefault(c["id"], c)
    return idx


def grab(url, dest, ua):
    try:
        r = requests.get(url, headers={"User-Agent": ua, "Referer": ""}, timeout=(8, 25))
    except requests.RequestException as e:
        return f"err {type(e).__name__}"
    if r.status_code != 200:
        return f"http {r.status_code}"
    if not r.headers.get("content-type", "").startswith("image/") or len(r.content) < 3000:
        return "not image"
    with open(dest, "wb") as f:
        f.write(r.content)
    return "ok"


def job(c):
    out = os.path.join(RAW, "full", c["id"] + ".jpg")
    if os.path.exists(out) and os.path.getsize(out) > 3000:
        return c["id"], "cached"
    url = c["url"]
    if c["source"] == "commons":
        url = (c.get("thumb") or url).split("?")[0]
    ua = WM_UA if "wikimedia" in url else UA
    res = grab(url, out, ua)
    if res != "ok" and c.get("thumb") and c["thumb"] != url:
        res2 = grab(c["thumb"], out, UA)
        res = f"{res} -> thumb {res2}"
    return c["id"], res


def main():
    idx = index()
    os.makedirs(os.path.join(RAW, "full"), exist_ok=True)
    todo = [idx[i] for i in sys.argv[1:] if i in idx]
    missing = [i for i in sys.argv[1:] if i not in idx]
    if missing:
        print("unknown:", missing)
    with cf.ThreadPoolExecutor(6) as ex:
        for cid, res in ex.map(job, todo):
            print(cid, res, flush=True)


if __name__ == "__main__":
    main()
