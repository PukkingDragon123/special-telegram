#!/usr/bin/env python3
"""R5-audio: tiny Wikimedia Commons API helper (polite: UA + >=1s between calls).

CLI:
  python3 -I commons.py search "<query>" [limit]          -> prints File: titles
  python3 -I commons.py cat "<Category:...>" [limit]       -> prints File: titles in category
  python3 -I commons.py info <outjson> "File:a" "File:b"   -> license/author/url/duration json
  python3 -I commons.py dl <outdir> "File:a" ...           -> downloads originals into outdir (fresh dir)
"""
import json, os, re, subprocess, sys, time, urllib.parse

UA = "HiaPhatGameDev/0.1 (https://github.com/PukkingDragon123/special-telegram)"
API = "https://commons.wikimedia.org/w/api.php"
_last = [0.0]


def _get(params, dest=None, url=None):
    for attempt in range(5):
        wait = 1.1 - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        u = url or (API + "?" + urllib.parse.urlencode(params))
        cmd = ["curl", "-sS", "-L", "-A", UA, "-w", "\n%{http_code}", u]
        if dest:
            cmd = ["curl", "-sS", "-L", "-A", UA, "-o", dest, "-w", "%{http_code}", u]
        r = subprocess.run(cmd, capture_output=True)
        out = r.stdout.decode("utf-8", "replace")
        if dest:
            code = out.strip()
            body = None
        else:
            body, _, code = out.rpartition("\n")
        if code == "200":
            return body if not dest else True
        if code == "429":
            time.sleep(10 * (attempt + 1))
            continue
        print("HTTP", code, u[:200], file=sys.stderr)
        return None
    return None


def search(q, limit=200):
    titles, cont = [], {}
    while len(titles) < limit:
        p = {"action": "query", "list": "search", "srsearch": q, "srnamespace": 6,
             "srlimit": min(500, limit), "format": "json"}
        p.update(cont)
        b = _get(p)
        if not b:
            break
        d = json.loads(b)
        titles += [x["title"] for x in d.get("query", {}).get("search", [])]
        if "continue" in d:
            cont = d["continue"]
        else:
            break
    return titles[:limit]


def cat(c, limit=2000):
    titles, cont = [], {}
    while len(titles) < limit:
        p = {"action": "query", "list": "categorymembers", "cmtitle": c, "cmtype": "file",
             "cmlimit": 500, "format": "json"}
        p.update(cont)
        b = _get(p)
        if not b:
            break
        d = json.loads(b)
        titles += [x["title"] for x in d.get("query", {}).get("categorymembers", [])]
        if "continue" in d:
            cont = d["continue"]
        else:
            break
    return titles[:limit]


def info(titles):
    res = {}
    for i in range(0, len(titles), 40):
        chunk = titles[i:i + 40]
        p = {"action": "query", "titles": "|".join(chunk), "prop": "imageinfo",
             "iiprop": "url|size|mime|extmetadata|mediatype", "format": "json"}
        b = _get(p)
        if not b:
            continue
        d = json.loads(b)
        for pg in d.get("query", {}).get("pages", {}).values():
            ii = (pg.get("imageinfo") or [{}])[0]
            em = ii.get("extmetadata", {})
            def g(k):
                v = em.get(k, {}).get("value", "")
                return re.sub(r"<[^>]+>", "", str(v)).strip()
            res[pg.get("title")] = {
                "url": ii.get("url"), "descurl": ii.get("descriptionurl"), "mime": ii.get("mime"),
                "size": ii.get("size"), "duration": ii.get("duration"),
                "license": g("LicenseShortName"), "licenseurl": g("LicenseUrl"),
                "artist": g("Artist"), "credit": g("Credit"), "desc": g("ImageDescription")[:300],
            }
    return res


def dl(outdir, titles):
    os.makedirs(outdir, exist_ok=True)
    inf = info(titles)
    meta_path = os.path.join(outdir, "_meta.json")
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    for t, m in inf.items():
        if not m.get("url"):
            continue
        fn = re.sub(r"[^A-Za-z0-9._()-]+", "_", t.replace("File:", ""))
        dest = os.path.join(outdir, fn)
        if not os.path.exists(dest):
            ok = _get(None, dest=dest, url=m["url"])
            print(("ok  " if ok else "FAIL"), fn, m.get("license"), flush=True)
        m["local"] = fn
        meta[t] = m
    json.dump(meta, open(meta_path, "w"), indent=1, ensure_ascii=False)


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "search":
        for t in search(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 100):
            print(t)
    elif cmd == "cat":
        for t in cat(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 2000):
            print(t)
    elif cmd == "info":
        r = info(sys.argv[3:])
        json.dump(r, open(sys.argv[2], "w"), indent=1, ensure_ascii=False)
        for t, m in r.items():
            print(t, "|", m["license"], "|", m["artist"][:40], "|", m["duration"], "|", m["desc"][:80])
    elif cmd == "dl":
        dl(sys.argv[2], sys.argv[3:])


def direct_url(title):
    """upload.wikimedia.org URL computed from the file name (no API call)."""
    import hashlib
    name = title.replace("File:", "").replace(" ", "_")
    h = hashlib.md5(name.encode("utf-8")).hexdigest()
    return f"https://upload.wikimedia.org/wikipedia/commons/{h[0]}/{h[:2]}/{urllib.parse.quote(name)}"


def dl_direct(outdir, titles):
    os.makedirs(outdir, exist_ok=True)
    for t in titles:
        fn = re.sub(r"[^A-Za-z0-9._()-]+", "_", t.replace("File:", ""))
        dest = os.path.join(outdir, fn)
        if os.path.exists(dest) and os.path.getsize(dest) > 1000:
            continue
        ok = _get(None, dest=dest, url=direct_url(t))
        print(("ok  " if ok else "FAIL"), fn, flush=True)
