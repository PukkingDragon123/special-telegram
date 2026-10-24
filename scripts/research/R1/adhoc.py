"""Register + download ad-hoc image URLs (found via Openverse / web search) into the index.
usage: python3 -I adhoc.py <tag> <url> <licence> <author> <page> [title]"""
import hashlib, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import net
RAW = "/home/user/special-telegram/references/streets/_raw"
tag, url, lic, author, page = sys.argv[1:6]
title = sys.argv[6] if len(sys.argv) > 6 else ""
cid = hashlib.md5(url.encode()).hexdigest()[:8]
c = {"source": "adhoc", "id": cid, "tag": tag, "url": url, "thumb": url, "licence": lic,
     "author": author, "page": page, "title": title, "clean": lic.lower().startswith(("cc", "public"))}
ua = net.UA if "wikimedia" in url else net.BROWSER_UA
dest = os.path.join(RAW, "full", cid + ".jpg")
if "upload.wikimedia.org" in url and "/thumb/" not in url:
    tail = url.split("/wikipedia/commons/")[1]
    name = tail.split("/")[-1]
    for w in (1920, 1280):
        if net.download(f"https://thumb.wikimedia.org/wikipedia/commons/thumb/{tail}/{w}px-{name}", dest, ua=net.UA):
            break
    else:
        net.download(url, dest, ua=net.UA)
else:
    net.download(url, dest, ua=ua)
ok = os.path.exists(dest)
mp = os.path.join(RAW, "adhoc", "meta.jsonl")
known = set()
if os.path.exists(mp):
    known = {json.loads(l)["id"] for l in open(mp, encoding="utf-8")}
if cid not in known:
    with open(mp, "a", encoding="utf-8") as f:
        f.write(json.dumps(c, ensure_ascii=False) + "\n")
print(cid, "ok" if ok else "FAIL", url[:80])
