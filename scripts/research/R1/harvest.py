"""R1-streets: harvest candidate reference photos.

usage: python3 -I harvest.py commons|openverse|bing  <queries.txt>  <outdir>

queries.txt lines:  tag | query        (query starting with 'Category:' -> category listing)
Writes <outdir>/meta.jsonl (one candidate per line, with id) and small thumbs
<outdir>/thumbs/<id>.jpg for contact sheets.  Bytes only, nothing is executed.
"""
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import net  # noqa: E402


def small_thumb(c):
    t = c.get("thumb") or c.get("url")
    if c["source"] == "commons" and t:
        if "/1280px-" in t:
            return t.replace("/1280px-", "/330px-")
        u = c["url"].split("?")[0]
        if "/wikipedia/commons/" in u:
            tail = u.split("/wikipedia/commons/")[1]          # a/ab/Name.jpg
            name = tail.split("/")[-1]
            return f"https://thumb.wikimedia.org/wikipedia/commons/thumb/{tail}/330px-{name}"
    return t


def main():
    mode, qfile, outdir = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(os.path.join(outdir, "thumbs"), exist_ok=True)
    metap = os.path.join(outdir, "meta.jsonl")
    seen = set()
    if os.path.exists(metap):
        for line in open(metap, encoding="utf-8"):
            try:
                seen.add(json.loads(line)["url"])
            except Exception:
                pass
    done_q = set()
    donep = os.path.join(outdir, "done_queries.txt")
    if os.path.exists(donep):
        done_q = set(x.strip() for x in open(donep, encoding="utf-8"))
    for line in open(qfile, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        tag, q = [x.strip() for x in line.split("|", 1)]
        if q in done_q:
            continue
        print(f"== {mode}: {tag} | {q}", flush=True)
        try:
            if mode == "commons":
                res = net.commons_category(q, 50) if q.startswith("Category:") else net.commons_search(q, 40)
            elif mode == "openverse":
                res = net.openverse(q, 20)
            elif mode == "flickr":
                res = net.flickr_search(q, 1)
            elif mode == "flickrall":
                res = net.flickr_search(q, 1, any_licence=True)
            elif mode == "flickr2":
                res = net.flickr_search(q, 2)
            elif mode == "yandex":
                res = net.yandex_images(q, 0)
            elif mode == "yandex2":
                res = net.yandex_images(q, 1)
            elif mode == "bing":
                res = net.bing_images(q, 35)
            else:
                raise SystemExit("bad mode")
        except Exception as e:  # keep going
            print("   query failed:", e, flush=True)
            continue
        n_new = 0
        with open(metap, "a", encoding="utf-8") as mf:
            for c in res:
                if not c.get("url") or c["url"] in seen:
                    continue
                if c.get("mime") and c["mime"] not in ("image/jpeg", "image/png", "image/webp"):
                    continue
                if mode == "commons" and (c.get("w") or 0) < 900:
                    continue
                if mode == "commons" and not c.get("clean"):
                    continue
                seen.add(c["url"])
                cid = hashlib.md5(c["url"].encode()).hexdigest()[:8]
                c.update({"id": cid, "tag": tag, "query": q})
                ok = net.download(small_thumb(c), os.path.join(outdir, "thumbs", cid + ".jpg"),
                                  ua=net.UA if mode not in ("bing", "yandex", "yandex2") else net.BROWSER_UA,
                                  min_bytes=1500)
                if not ok:
                    continue
                mf.write(json.dumps(c, ensure_ascii=False) + "\n")
                n_new += 1
        with open(donep, "a", encoding="utf-8") as df:
            df.write(q + "\n")
        print(f"   +{n_new} (of {len(res)})", flush=True)


if __name__ == "__main__":
    main()
