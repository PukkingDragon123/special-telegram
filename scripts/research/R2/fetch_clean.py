"""Fetch licence-clean candidate photos (Wikimedia Commons + Flickr CC BY/BY-SA/CC0/PDM) for textures.
Usage: python3 -I fetch_clean.py <out_dir> <topics.json>
topics.json: {"topic": {"commons": ["q1", ...], "flickr": ["q1", ...], "n": 8}}
Writes <out_dir>/<topic>/<topic>_<src>_<nn>.jpg and <out_dir>/_meta.jsonl (licence + author + url).
"""
import json
import os
import sys

sys.path.insert(0, "/home/user/special-telegram/scripts/research/R2")
import r2lib  # noqa: E402

USE_OV = True  # Commons API is rate-limited on the shared IP; Openverse aggregates Commons + Flickr CC


def main():
    out_dir, topics_file = sys.argv[1], sys.argv[2]
    topics = json.load(open(topics_file, encoding="utf-8"))
    os.makedirs(out_dir, exist_ok=True)
    meta = open(os.path.join(out_dir, "_meta.jsonl"), "a", encoding="utf-8")
    seen = set()
    for topic, spec in topics.items():
        n_max = spec.get("n", 8)
        got = 0
        tdir = os.path.join(out_dir, topic)
        if os.path.isdir(tdir) and len(os.listdir(tdir)) >= min(3, n_max):
            print(f"{topic}: skip (already {len(os.listdir(tdir))})", flush=True)
            continue
        cands = []
        for q in spec.get("commons", []) if USE_OV else []:
            try:
                for it in r2lib.openverse(q, n=20):
                    if not it["url"] or (it["w"] and min(it["w"], it["h"]) < 600):
                        continue
                    cands.append(("ov-" + (it["provider"] or "x"), it["url"], it["page"], it["author"],
                                  it["license"], it["title"]))
            except Exception as e:  # noqa: BLE001
                print("ERR openverse", q, e, flush=True)
        for q in spec.get("commons", []) if not USE_OV else []:
            try:
                for it in r2lib.commons_search(q, limit=25, width=1600):
                    if not it["mime"].startswith("image/") or it["mime"] in ("image/svg+xml", "image/gif"):
                        continue
                    if not r2lib.commons_ok(it):
                        continue
                    if min(it["w"], it["h"]) < 700:
                        continue
                    cands.append(("commons", it["thumb"] or it["url"], it["page"], it["artist"], it["license"],
                                  it["title"]))
            except Exception as e:  # noqa: BLE001
                print("ERR commons", q, e, flush=True)
        for q in spec.get("flickr", []):
            try:
                for it in r2lib.flickr_search(q):
                    if min(it["w"] or 0, it["h"] or 0) < 600:
                        continue
                    cands.append(("flickr", it["url"], it["page"], it["author"], it["license"], it["title"]))
            except Exception as e:  # noqa: BLE001
                print("ERR flickr", q, e, flush=True)
        cands.sort(key=lambda c: 0 if "flickr" in c[0] else 1)  # Flickr CDN is fast; Wikimedia is throttled
        for src, url, page, author, lic, title in cands:
            if got >= n_max:
                break
            if url in seen:
                continue
            seen.add(url)
            dest = os.path.join(out_dir, topic, f"{topic}_{src.replace('ov-', '')}_{got+1:02d}.jpg")
            res = r2lib.download_image(url, dest, maxdim=1600, min_side=600)
            if not res:
                continue
            got += 1
            meta.write(json.dumps({"file": os.path.relpath(res[2], out_dir), "topic": topic, "src": src,
                                   "url": url, "page": page, "author": author, "license": lic, "title": title,
                                   "size": res[:2]}, ensure_ascii=False) + "\n")
            meta.flush()
        print(f"{topic}: {got} (cands {len(cands)})", flush=True)


if __name__ == "__main__":
    main()
