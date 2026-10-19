"""R1-streets: download full-size images for chosen candidate ids.

usage: python3 -I fetch_full.py <id> [<id> ...] [--orig]
Looks the id up in every _raw/*/meta.jsonl. Default = 1280px (Commons thumb) or the
largest Flickr/Openverse URL.  --orig fetches Commons originals (for texture work).
Saves to references/streets/_raw/full/<id>.jpg  (bytes only).
"""
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import net  # noqa: E402

RAW = "/home/user/special-telegram/references/streets/_raw"


def index():
    idx = {}
    for mp in glob.glob(os.path.join(RAW, "*", "meta.jsonl")):
        for line in open(mp, encoding="utf-8"):
            try:
                c = json.loads(line)
            except Exception:
                continue
            idx[c["id"]] = c
    return idx


def main():
    args = sys.argv[1:]
    orig = "--orig" in args
    args = [a for a in args if a != "--orig"]
    idx = index()
    out = os.path.join(RAW, "full")
    os.makedirs(out, exist_ok=True)
    for cid in args:
        c = idx.get(cid)
        if not c:
            print("unknown id", cid)
            continue
        if c["source"] == "commons":
            url = c["url"] if orig else (c.get("thumb") or c["url"])
            url = url.split("?")[0]
        else:
            url = c["url"]
        suffix = "_orig" if orig and c["source"] == "commons" else ""
        dest = os.path.join(out, cid + suffix + ".jpg")
        ok = net.download(url, dest)
        print(cid, "ok" if ok else "FAIL", url[:90])


if __name__ == "__main__":
    main()
