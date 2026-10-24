"""Flickr search/download helper (uses the public site key the flickr.com search page embeds).
Usage:
  python3 -I flickr.py search "<text>" [clean|any] [n] [sort]      -> lists id | licence | owner | title | url
  python3 -I flickr.py get <photo_id> <out_dir> [name] [size]       -> downloads (size: l=1024, c=800, b=1024, h=1600, k=2048)
Licence ids: 4 CC-BY-2.0, 5 CC-BY-SA-2.0, 7 no known copyright, 9 CC0, 10 PDM, 11 CC-BY-4.0, 12 CC-BY-SA-4.0.
'clean' restricts to shippable licences (4,5,7,9,10,11,12)."""
import sys, os, re, io, time, json, tempfile
import requests
from PIL import Image

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"}
LIC = {"0": "All Rights Reserved", "1": "CC BY-NC-SA 2.0", "2": "CC BY-NC 2.0", "3": "CC BY-NC-ND 2.0", "4": "CC BY 2.0",
       "5": "CC BY-SA 2.0", "6": "CC BY-ND 2.0", "7": "No known copyright restrictions", "8": "US Gov work", "9": "CC0 1.0",
       "10": "Public Domain Mark 1.0", "11": "CC BY 4.0", "12": "CC BY-SA 4.0", "13": "CC BY-ND 4.0", "14": "CC BY-NC 4.0",
       "15": "CC BY-NC-SA 4.0", "16": "CC BY-NC-ND 4.0"}
CLEAN = "4,5,7,9,10,11,12"
KEYFILE = os.path.join(tempfile.gettempdir(), "r4_flickr_site_key.txt")  # cache outside the repo

def key():
    if os.path.exists(KEYFILE):
        return open(KEYFILE).read().strip()
    t = requests.get("https://www.flickr.com/search/", params={"text": "thailand"}, headers=UA, timeout=30).text
    k = re.findall(r'"api_key":"([0-9a-f]+)"', t) or re.findall(r'site_key = "([0-9a-f]+)"', t)
    open(KEYFILE, "w").write(k[0])
    return k[0]

def rest(method, **kw):
    p = {"method": method, "api_key": key(), "format": "json", "nojsoncallback": "1"}
    p.update(kw)
    for _ in range(3):
        r = requests.get("https://api.flickr.com/services/rest", params=p, headers=UA, timeout=40)
        if r.status_code == 200:
            d = r.json()
            if d.get("stat") == "ok":
                return d
            if d.get("code") == 100 and os.path.exists(KEYFILE):  # stale key
                os.remove(KEYFILE); p["api_key"] = key(); continue
            raise SystemExit(f"flickr error {d}")
        time.sleep(2)
    raise SystemExit(f"http {r.status_code}")

if sys.argv[1] == "search":
    text = sys.argv[2]; mode = sys.argv[3] if len(sys.argv) > 3 else "clean"
    n = sys.argv[4] if len(sys.argv) > 4 else "30"; sort = sys.argv[5] if len(sys.argv) > 5 else "relevance"
    kw = dict(text=text, per_page=n, sort=sort, content_type="1", media="photos",
              extras="license,owner_name,url_l,url_c,url_k,url_h,o_dims,date_taken")
    if mode == "clean":
        kw["license"] = CLEAN
    d = rest("flickr.photos.search", **kw)
    for ph in d["photos"]["photo"]:
        u = ph.get("url_k") or ph.get("url_h") or ph.get("url_l") or ph.get("url_c") or ""
        print(f"{ph['id']} | {LIC.get(str(ph['license']), ph['license'])} | {ph.get('ownername','')[:28]} | {ph.get('title','')[:60]} | {ph.get('width_l','?')}x{ph.get('height_l','?')}")
elif sys.argv[1] == "get":
    pid, out = sys.argv[2], sys.argv[3]
    name = sys.argv[4] if len(sys.argv) > 4 else None
    want = sys.argv[5] if len(sys.argv) > 5 else "k"
    os.makedirs(out, exist_ok=True)
    info = rest("flickr.photos.getInfo", photo_id=pid)["photo"]
    sizes = rest("flickr.photos.getSizes", photo_id=pid)["sizes"]["size"]
    order = {"k": ["Large 2048", "Large 1600", "Large", "Medium 800"], "h": ["Large 1600", "Large", "Medium 800"],
             "l": ["Large", "Medium 800"], "c": ["Medium 800", "Large"]}[want]
    src = None
    for lab in order:
        for s in sizes:
            if s["label"] == lab:
                src = s["source"]; break
        if src: break
    if not src:
        src = sizes[-1]["source"]
    for attempt in range(6):
        r = requests.get(src, headers=UA, timeout=60)
        if r.status_code == 429:
            time.sleep(8 * (attempt + 1)); continue
        break
    r.raise_for_status()
    im = Image.open(io.BytesIO(r.content)); im.load(); im = im.convert("RGB")
    fn = (name or f"flickr_{pid}") + ".jpg"
    im.save(os.path.join(out, fn), quality=92)
    lic = LIC.get(str(info["license"]), info["license"])
    owner = info["owner"].get("realname") or info["owner"].get("username")
    page = f"https://www.flickr.com/photos/{info['owner']['nsid']}/{pid}/"
    title = info["title"]["_content"]
    with open(os.path.join(out, "_sources.tsv"), "a", encoding="utf-8") as f:
        f.write(f"{fn}\t{page}\t{owner}\t{lic}\t{im.size[0]}x{im.size[1]}\t{title}\n")
    print(f"saved {fn} {im.size} | {lic} | {owner} | {page} | {title}")
