"""Wikimedia Commons helper (search + licence metadata + thumbnail download).
Usage:
  python3 -I commons.py search "<query>" [limit]
  python3 -I commons.py get "<File:Title>" <out_dir> <width> [name]
Prints title | size | licence | artist | url. Respects >=1.1 s between API calls."""
import sys, os, time, json, re, io
import requests
from PIL import Image

UA = {"User-Agent": "HiaPhatGameDev/0.1 (https://github.com/PukkingDragon123/special-telegram)"}
API = "https://commons.wikimedia.org/w/api.php"
_last = [0.0]

def call(params):
    while True:
        dt = time.time() - _last[0]
        if dt < 1.1:
            time.sleep(1.1 - dt)
        _last[0] = time.time()
        r = requests.get(API, params=params, headers=UA, timeout=40)
        if r.status_code == 429:
            time.sleep(5); continue
        r.raise_for_status()
        return r.json()

def strip(s):
    return re.sub(r"<[^>]+>", "", s or "").strip()

def info(titles, width=None):
    p = {"action": "query", "format": "json", "prop": "imageinfo", "titles": "|".join(titles),
         "iiprop": "url|size|extmetadata|mime"}
    if width:
        p["iiurlwidth"] = str(width)
    d = call(p)
    out = []
    for pg in d.get("query", {}).get("pages", {}).values():
        ii = (pg.get("imageinfo") or [{}])[0]
        md = ii.get("extmetadata", {})
        out.append({"title": pg.get("title"), "w": ii.get("width"), "h": ii.get("height"), "mime": ii.get("mime"),
                    "url": ii.get("url"), "thumb": ii.get("thumburl"), "page": ii.get("descriptionurl"),
                    "license": strip(md.get("LicenseShortName", {}).get("value")),
                    "artist": strip(md.get("Artist", {}).get("value"))[:80],
                    "desc": strip(md.get("ImageDescription", {}).get("value"))[:120]})
    return out

if sys.argv[1] == "search":
    q = sys.argv[2]; lim = int(sys.argv[3]) if len(sys.argv) > 3 else 20
    d = call({"action": "query", "format": "json", "list": "search", "srsearch": q, "srnamespace": "6", "srlimit": str(lim)})
    titles = [x["title"] for x in d.get("query", {}).get("search", [])]
    for i in range(0, len(titles), 20):
        for it in info(titles[i:i + 20]):
            print(f"{it['title']} | {it['w']}x{it['h']} | {it['license']} | {it['artist']} | {it['desc'][:70]}")
elif sys.argv[1] == "get":
    title, out, width = sys.argv[2], sys.argv[3], int(sys.argv[4])
    name = sys.argv[5] if len(sys.argv) > 5 else None
    os.makedirs(out, exist_ok=True)
    it = info([title], width)[0]
    u = it["thumb"] or it["url"]
    time.sleep(1.1)
    r = requests.get(u, headers=UA, timeout=60)
    if r.status_code == 429:
        time.sleep(6); r = requests.get(u, headers=UA, timeout=60)
    r.raise_for_status()
    im = Image.open(io.BytesIO(r.content)); im.load()
    im = im.convert("RGB")
    fn = name or re.sub(r"[^A-Za-z0-9_.-]+", "_", title.replace("File:", ""))[:60]
    if not fn.lower().endswith(".jpg"):
        fn = os.path.splitext(fn)[0] + ".jpg"
    im.save(os.path.join(out, fn), quality=92)
    with open(os.path.join(out, "_sources.tsv"), "a", encoding="utf-8") as f:
        f.write(f"{fn}\t{it['page']}\t{it['artist']}\t{it['license']}\t{im.size[0]}x{im.size[1]}\n")
    print(f"saved {fn} {im.size} | {it['license']} | {it['artist']} | {it['page']}")
