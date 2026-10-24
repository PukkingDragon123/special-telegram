# Scan Objaverse 1.0 metadata chunks for animated/rigged animals (dog, cat, chicken, bird…) with permissive licences.
import gzip, json, sys, os, re, urllib.request, concurrent.futures as cf
OUT = sys.argv[1]
BASE = "https://huggingface.co/datasets/allenai/objaverse/resolve/main/metadata/000-%03d.json.gz"
PAT = re.compile(r"\b(dog|dogs|puppy|shiba|husky|mutt|stray|canine|cat|cats|kitten|kitty|chicken|rooster|hen|pigeon|crow|bird|gecko|lizard|ghost|motorcycle|scooter|moped|tuk.?tuk|rickshaw|hippo)\b", re.I)
OK_LIC = ("by", "by-sa", "cc0")
def lic_ok(l):
    l = (l or "").lower()
    return ("nc" not in l and "nd" not in l) and any(k in l for k in ("by", "cc0", "zero", "public"))
def fetch(i):
    req = urllib.request.Request(BASE % i, headers={"User-Agent": "HiaPhatGameResearch/1.0"})
    for t in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                d = json.loads(gzip.decompress(r.read()))
            break
        except Exception as e:
            err = e
    else:
        return i, [], str(err)
    hits = []
    for uid, m in d.items():
        name = m.get("name") or ""
        tags = " ".join(t.get("name", "") for t in (m.get("tags") or []))
        cats = " ".join(c.get("name", "") for c in (m.get("categories") or []))
        txt = f"{name} {tags} {cats}"
        if not PAT.search(txt): continue
        if not lic_ok(m.get("license")): continue
        hits.append({"uid": uid, "chunk": i, "name": name, "tags": tags[:200], "cats": cats, "lic": m.get("license"), "anim": m.get("animationCount", 0),
                     "faces": m.get("faceCount"), "verts": m.get("vertexCount"), "likes": m.get("likeCount"), "views": m.get("viewCount"), "uri": m.get("viewerUrl") or m.get("uri"),
                     "user": (m.get("user") or {}).get("username"), "desc": (m.get("description") or "")[:200]})
    return i, hits, None
res = []
with cf.ThreadPoolExecutor(10) as ex:
    for i, hits, err in ex.map(fetch, range(160)):
        if err: print("ERR", i, err, flush=True)
        res.extend(hits)
        print("chunk", i, len(hits), flush=True)
json.dump(res, open(OUT, "w"), indent=0, ensure_ascii=False)
print("TOTAL", len(res))
