"""R1-streets: polite HTTP helpers (Wikimedia Commons, Openverse, Bing, Flickr).

Downloads are treated as untrusted data: they are only written to disk as bytes,
never executed. Run scripts that read downloads with `python3 -I`.
"""
import json
import os
import re
import sys
import time
import urllib.parse

import requests

UA = "HiaPhatGameDev/0.1 (https://github.com/PukkingDragon123/special-telegram)"
BROWSER_UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/124.0 Safari/537.36")

_session = requests.Session()
_last_call = {}
MIN_INTERVAL = {"commons.wikimedia.org": 2.5, "api.openverse.org": 3.5, "yandex.com": 3.0, "avatars.mds.yandex.net": 0.2,
                "upload.wikimedia.org": 0.6, "www.bing.com": 1.5,
                "www.flickr.com": 1.5}


def _wait(host):
    iv = MIN_INTERVAL.get(host, 1.0)
    dt = time.time() - _last_call.get(host, 0)
    if dt < iv:
        time.sleep(iv - dt)
    _last_call[host] = time.time()


def get(url, params=None, ua=UA, tries=8, timeout=40, stream=False):
    host = urllib.parse.urlparse(url).netloc
    for attempt in range(tries):
        _wait(host)
        try:
            r = _session.get(url, params=params, headers={"User-Agent": ua},
                             timeout=timeout, stream=stream)
        except requests.RequestException as e:
            print(f"  [net] {host} error {e!r}; retry", file=sys.stderr)
            time.sleep(3 + attempt * 2)
            continue
        if r.status_code == 429 or r.status_code >= 500:
            ra = r.headers.get("retry-after")
            try:
                wait = float(ra) if ra else 10 * (attempt + 1)
            except ValueError:
                wait = 10 * (attempt + 1)
            wait = min(max(wait, 3), 120) + 1
            print(f"  [net] {host} HTTP {r.status_code}; sleeping {wait:.0f}s", file=sys.stderr)
            time.sleep(wait)
            continue
        return r
    raise RuntimeError(f"giving up on {url}")


def get_json(url, params=None, ua=UA):
    r = get(url, params=params, ua=ua)
    r.raise_for_status()
    return r.json()


def download(url, dest, ua=UA, min_bytes=4000):
    """Download url to dest (bytes only). Returns True on success."""
    if os.path.exists(dest) and os.path.getsize(dest) > min_bytes:
        return True
    try:
        r = get(url, ua=ua, timeout=60)
    except RuntimeError as e:
        print(f"  [dl] fail {e}", file=sys.stderr)
        return False
    if r.status_code != 200:
        print(f"  [dl] HTTP {r.status_code} {url}", file=sys.stderr)
        return False
    ctype = r.headers.get("content-type", "")
    if not ctype.startswith("image/"):
        print(f"  [dl] not an image ({ctype}) {url}", file=sys.stderr)
        return False
    data = r.content
    if len(data) < min_bytes:
        return False
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, dest)
    return True


# ---------------------------------------------------------------- Commons
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
CLEAN_LICENCES = re.compile(r"^(cc0|public domain|pd|cc by(-sa)? ?[1-4]\.0|cc by(-sa)?$|"
                            r"cc-by(-sa)?-[1-4]\.0|attribution|no restrictions|copyrighted free use)",
                            re.I)


def _strip_html(s):
    return re.sub(r"<[^>]+>", "", s or "").strip()


def commons_files(params_extra, width=1280):
    params = {"action": "query", "format": "json", "prop": "imageinfo",
              "iiprop": "url|size|extmetadata|mime", "iiurlwidth": str(width),
              "iiextmetadatafilter": "LicenseShortName|Artist|LicenseUrl|ImageDescription|Credit|UsageTerms",
              }
    params.update(params_extra)
    data = get_json(COMMONS_API, params)
    out = []
    for page in (data.get("query", {}).get("pages", {}) or {}).values():
        ii = (page.get("imageinfo") or [{}])[0]
        if not ii:
            continue
        em = ii.get("extmetadata", {})
        lic = em.get("LicenseShortName", {}).get("value", "")
        out.append({
            "source": "commons",
            "title": page.get("title"),
            "page": "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(page.get("title", "").replace(" ", "_")),
            "url": ii.get("url"), "thumb": ii.get("thumburl"),
            "w": ii.get("width"), "h": ii.get("height"), "mime": ii.get("mime"),
            "licence": lic, "licence_url": em.get("LicenseUrl", {}).get("value", ""),
            "author": _strip_html(em.get("Artist", {}).get("value", ""))[:200],
            "desc": _strip_html(em.get("ImageDescription", {}).get("value", ""))[:300],
            "clean": bool(CLEAN_LICENCES.search(lic.strip())),
        })
    return out


def commons_search(query, limit=40, width=1280):
    return commons_files({"generator": "search", "gsrsearch": query, "gsrnamespace": "6",
                          "gsrlimit": str(limit)}, width)


def commons_category(cat, limit=50, width=1280):
    return commons_files({"generator": "categorymembers", "gcmtitle": cat,
                          "gcmtype": "file", "gcmlimit": str(limit)}, width)


# ---------------------------------------------------------------- Openverse
def openverse(query, page_size=20, page=1):
    data = get_json("https://api.openverse.org/v1/images/",
                    {"q": query, "license_type": "commercial,modification",
                     "page_size": str(page_size), "page": str(page)})
    out = []
    for r in data.get("results", []):
        out.append({"source": "openverse/" + (r.get("source") or ""),
                    "title": r.get("title"), "page": r.get("foreign_landing_url"),
                    "url": r.get("url"), "thumb": r.get("url"),
                    "w": r.get("width"), "h": r.get("height"),
                    "licence": f"CC {r.get('license','').upper()} {r.get('license_version','')}".strip(),
                    "licence_url": r.get("license_url"), "author": r.get("creator"),
                    "desc": ", ".join(t["name"] for t in (r.get("tags") or [])[:12]),
                    "clean": True})
    return out


# ---------------------------------------------------------------- Bing (unknown licence)
def bing_images(query, count=35):
    r = get("https://www.bing.com/images/search",
            params={"q": query, "form": "HDRSC2", "first": "1", "count": str(count)},
            ua=BROWSER_UA)
    html = r.text
    out = []
    for m in re.finditer(r'm="(\{[^"]+\})"', html):
        raw = m.group(1).replace("&quot;", '"').replace("&amp;", "&")
        try:
            j = json.loads(raw)
        except Exception:
            continue
        if "murl" in j:
            out.append({"source": "bing", "url": j["murl"], "page": j.get("purl"),
                        "title": j.get("t", ""), "thumb": j.get("turl"), "clean": False})
    return out


# ---------------------------------------------------------------- Flickr (CC search HTML)
FLICKR_LIC = {4: "CC BY 2.0", 5: "CC BY-SA 2.0", 7: "No known copyright restrictions",
              8: "US Government Work", 9: "CC0 1.0", 10: "Public Domain Mark 1.0",
              11: "CC BY 4.0", 12: "CC BY-SA 4.0"}
FLICKR_LIC_URL = {4: "https://creativecommons.org/licenses/by/2.0/",
                  5: "https://creativecommons.org/licenses/by-sa/2.0/",
                  9: "https://creativecommons.org/publicdomain/zero/1.0/",
                  10: "https://creativecommons.org/publicdomain/mark/1.0/",
                  11: "https://creativecommons.org/licenses/by/4.0/",
                  12: "https://creativecommons.org/licenses/by-sa/4.0/"}


def flickr_search(text, page=1, any_licence=False):
    params = {"text": text, "page": str(page)}
    if not any_licence:
        params["license"] = "4,5,9,10,11,12"
    r = get("https://www.flickr.com/search/", params=params, ua=BROWSER_UA)
    h = r.text
    i = h.find("modelExport:")
    if i < 0:
        return []
    i += len("modelExport:")
    while h[i] == " ":
        i += 1
    obj, _ = json.JSONDecoder().raw_decode(h, i)
    try:
        lst = obj["main"]["search-photos-lite-models"][0]["data"]["photos"]["data"]["_data"]
    except (KeyError, IndexError):
        return []
    out = []
    for e in lst:
        if not e:
            continue
        p = e["data"]
        lic = p.get("license")
        if lic not in FLICKR_LIC and not any_licence:
            continue
        sz = {k: v["data"] for k, v in p["sizes"]["data"].items()}
        big = max(sz.values(), key=lambda d: d["width"])
        small = sz.get("n") or sz.get("w") or big
        owner = p.get("pathAlias") or p.get("ownerNsid")
        out.append({"source": "flickr", "title": p.get("title", ""),
                    "page": f"https://www.flickr.com/photos/{owner}/{p.get('id')}/",
                    "url": "https:" + big["url"], "thumb": "https:" + small["url"],
                    "w": big["width"], "h": big["height"],
                    "licence": FLICKR_LIC.get(lic, "All rights reserved (Flickr licence %s)" % lic),
                    "licence_url": FLICKR_LIC_URL.get(lic, ""),
                    "author": p.get("realname") or p.get("username") or owner,
                    "desc": "", "clean": True})
    return out


# ---------------------------------------------------------------- Yandex images (unknown licence)
STOCK = re.compile(r"(shutterstock|dreamstime|alamy|bigstockphoto|123rf|istockphoto|gettyimages|"
                   r"depositphotos|adobe\.com|stock\.adobe|vecteezy|freepik|pixabay|pexels|canstockphoto|"
                   r"agefotostock|superstock|pond5|colourbox|photodune|featurepics|ytimg\.com|ggpht\.com|"
                   r"telesco\.pe|userapi\.com)", re.I)


def yandex_images(query, page=0):
    import html as _html
    r = get("https://yandex.com/images/search", params={"text": query, "p": str(page)}, ua=BROWSER_UA)
    h = _html.unescape(r.text)
    out = []
    i = h.find('"entities":{')
    if i < 0:
        return out
    try:
        ents, _ = json.JSONDecoder().raw_decode(h, i + len('"entities":'))
    except Exception:
        return out
    for e in ents.values():
        u = e.get("origUrl")
        if not u or STOCK.search(u):
            continue
        th = e.get("image") or ""
        if th.startswith("//"):
            th = "https:" + th
        out.append({"source": "yandex", "url": u, "thumb": th, "w": e.get("origWidth"),
                    "h": e.get("origHeight"), "title": e.get("alt", "")[:120], "page": "",
                    "clean": False})
    return out


if __name__ == "__main__":
    print(commons_search(sys.argv[1] if len(sys.argv) > 1 else "shophouse bangkok", 3))
