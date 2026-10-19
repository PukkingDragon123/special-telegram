"""R2-food research helpers: image search (DDG, Wikimedia Commons, Flickr CC) + safe downloads.

Run scripts that import this with `python3 -I` and insert this directory into sys.path manually.
Downloaded bytes are treated as untrusted data: they are only decoded by Pillow, never executed.
"""
import html
import io
import json
import os
import re
import time

import requests
from PIL import Image

UA_WIKI = "HiaPhatGameDev/0.1 (https://github.com/PukkingDragon123/special-telegram)"
UA_BROWSER = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/124.0 Safari/537.36")

_session = requests.Session()
_session.headers.update({"Accept-Language": "en-US,en;q=0.9,th;q=0.8"})
_last_call = {}

BAD_HOSTS = ("dreamstime", "shutterstock", "alamy", "ftcdn", "123rf", "istockphoto", "gettyimages",
             "depositphotos", "magnific", "freepik", "vecteezy", "pixabay", "pexels", "canstockphoto",
             "agefotostock", "stock.adobe", "bigstockphoto", "pond5", "superstock", "colourbox",
             "storyblocks", "photodune", "crushpixel", "lovepik", "pngtree")


def _throttle(key, gap):
    t = _last_call.get(key, 0)
    d = time.time() - t
    if d < gap:
        time.sleep(gap - d)
    _last_call[key] = time.time()


def get(url, params=None, ua=UA_BROWSER, headers=None, timeout=30, retries=4, key=None, gap=1.0, stream=False):
    h = {"User-Agent": ua}
    if headers:
        h.update(headers)
    key = key or re.sub(r"^https?://([^/]+).*$", r"\1", url)
    for attempt in range(retries):
        _throttle(key, gap)
        try:
            r = _session.get(url, params=params, headers=h, timeout=timeout, stream=stream)
        except requests.RequestException as e:
            if attempt == retries - 1:
                raise
            time.sleep(2 + attempt * 2)
            continue
        if r.status_code == 429 or r.status_code >= 500:
            ra = r.headers.get("Retry-After")
            wait = int(ra) if ra and ra.isdigit() else (8 if "wiki" in url else 5) * (attempt + 1)
            time.sleep(min(wait, 90))
            continue
        return r
    return r


# ---------------------------------------------------------------- DuckDuckGo images
def ddg_images(q, n=60, region="th-th"):
    r = get("https://duckduckgo.com/", params={"q": q, "iax": "images", "ia": "images"}, key="ddg", gap=1.5)
    m = re.search(r"vqd=[\"']?([\d-]+)", r.text)
    if not m:
        return []
    vqd = m.group(1)
    out = []
    url = "https://duckduckgo.com/i.js"
    params = {"l": region, "o": "json", "q": q, "vqd": vqd, "f": ",,,", "p": "1"}
    while url and len(out) < n:
        r = get(url, params=params, headers={"Referer": "https://duckduckgo.com/"}, key="ddg", gap=1.5)
        try:
            j = r.json()
        except ValueError:
            break
        for x in j.get("results", []):
            out.append({"title": x.get("title", ""), "image": x.get("image", ""), "thumb": x.get("thumbnail", ""),
                        "w": x.get("width") or 0, "h": x.get("height") or 0, "page": x.get("url", ""),
                        "source": x.get("source", "")})
        nxt = j.get("next")
        if not nxt:
            break
        url = "https://duckduckgo.com/" + nxt
        params = {"vqd": vqd}
    return out[:n]


# ---------------------------------------------------------------- Wikimedia Commons
def _strip_html(s):
    s = re.sub(r"<[^>]+>", "", s or "")
    return html.unescape(s).strip()


def commons_search(q, limit=30, width=1280):
    params = {"action": "query", "format": "json", "generator": "search", "gsrsearch": q, "gsrnamespace": 6,
              "gsrlimit": min(limit, 50), "prop": "imageinfo", "iiprop": "url|size|extmetadata|mime",
              "iiurlwidth": width}
    r = get("https://commons.wikimedia.org/w/api.php", params=params, ua=UA_WIKI, key="commons", gap=3.0, retries=6)
    try:
        j = r.json()
    except ValueError:
        return []
    pages = j.get("query", {}).get("pages", {})
    out = []
    for p in sorted(pages.values(), key=lambda p: p.get("index", 0)):
        ii = (p.get("imageinfo") or [{}])[0]
        em = ii.get("extmetadata", {})
        out.append({
            "title": p.get("title", ""),
            "url": ii.get("url", ""), "thumb": ii.get("thumburl", ""),
            "w": ii.get("width", 0), "h": ii.get("height", 0), "mime": ii.get("mime", ""),
            "license": _strip_html(em.get("LicenseShortName", {}).get("value", "")),
            "license_url": em.get("LicenseUrl", {}).get("value", ""),
            "artist": _strip_html(em.get("Artist", {}).get("value", "")),
            "credit": _strip_html(em.get("Credit", {}).get("value", "")),
            "desc": _strip_html(em.get("ImageDescription", {}).get("value", ""))[:200],
            "page": ii.get("descriptionurl", ""),
        })
    return out


OK_COMMONS = re.compile(r"^(CC0|Public domain|PD|CC BY(-SA)? ?\d|CC BY(-SA)?$|CC-BY|Attribution|No restrictions)", re.I)


def commons_ok(item):
    lic = item.get("license", "")
    if re.search(r"NC|ND|fair use|non-free", lic, re.I):
        return False
    return bool(OK_COMMONS.search(lic))


# ---------------------------------------------------------------- Flickr (HTML search, CC filter)
FLICKR_LIC = {1: "CC BY-NC-SA 2.0", 2: "CC BY-NC 2.0", 3: "CC BY-NC-ND 2.0", 4: "CC BY 2.0", 5: "CC BY-SA 2.0",
              6: "CC BY-ND 2.0", 7: "No known copyright restrictions", 8: "US Government Work", 9: "CC0 1.0",
              10: "Public Domain Mark 1.0"}


def flickr_search(q, licenses="4,5,9,10", page=1):
    r = get("https://www.flickr.com/search/", params={"text": q, "license": licenses, "page": page},
            key="flickr", gap=1.5)
    s = r.text
    i = s.find('"_data":[')
    if i < 0:
        return []
    try:
        arr, _ = json.JSONDecoder().raw_decode(s[i + len('"_data":'):])
    except ValueError:
        return []
    out = []
    for p in arr:
        if not p:
            continue
        d = p.get("data", p)
        sizes = d.get("sizes", {}).get("data", {})
        best = None
        for k in ("l", "c", "z"):
            if k in sizes:
                best = sizes[k]["data"]
                break
        if not best:
            continue
        owner = d.get("pathAlias") or d.get("ownerNsid")
        out.append({"id": d.get("id"), "title": d.get("title", ""), "owner": d.get("ownerNsid"),
                    "author": d.get("realname") or d.get("username") or d.get("ownerNsid"),
                    "license": FLICKR_LIC.get(d.get("license"), str(d.get("license"))),
                    "url": "https:" + best["url"] if best["url"].startswith("//") else best["url"],
                    "w": best.get("width"), "h": best.get("height"),
                    "page": f"https://www.flickr.com/photos/{owner}/{d.get('id')}/"})
    return out


# ---------------------------------------------------------------- downloads
def wiki_thumb(url, width=1280):
    """upload.wikimedia.org original -> standard-width thumbnail URL (1280px is an allowed bucket)."""
    m = re.match(r"^(https://upload\.wikimedia\.org/wikipedia/commons)/([0-9a-f])/([0-9a-f]{2})/([^/]+)$", url)
    if not m:
        return None
    name = m.group(4)
    suffix = ".jpg" if name.lower().endswith((".tif", ".tiff")) else ""
    return f"{m.group(1)}/thumb/{m.group(2)}/{m.group(3)}/{name}/{width}px-{name}{suffix}"


def download_image(url, dest, maxdim=1280, min_side=400, quality=88, ua=UA_BROWSER, keep_alpha=False):
    """Download url -> dest (JPG unless keep_alpha and image has alpha -> PNG). Returns (w,h,dest) or None."""
    if any(b in url.lower() for b in BAD_HOSTS):
        return None
    th = wiki_thumb(url)
    if th:
        res = _download(th, dest, maxdim, min_side, quality, ua, keep_alpha)
        if res:
            return res
    return _download(url, dest, maxdim, min_side, quality, ua, keep_alpha)


def _download(url, dest, maxdim=1280, min_side=400, quality=88, ua=UA_BROWSER, keep_alpha=False):
    try:
        key = "commons-up" if "wikimedia.org" in url else None
        if key and _last_call.get("wiki429", 0) > time.time() - 120:
            return None  # circuit breaker: Wikimedia upload is rate-limiting this IP, skip for 2 minutes
        r = get(url, ua=UA_WIKI if "wikimedia.org" in url else ua, timeout=20, retries=1 if key else 3, key=key,
                gap=1.5 if key else 0.3, stream=True)
        if key and r is not None and r.status_code == 429:
            _last_call["wiki429"] = time.time()
    except Exception:
        return None
    if r is None or r.status_code != 200:
        return None
    buf = io.BytesIO()
    t0 = time.time()
    try:
        for chunk in r.iter_content(65536):
            buf.write(chunk)
            if time.time() - t0 > 45 or buf.tell() > 30_000_000:
                r.close()
                return None
    except Exception:
        return None
    if buf.tell() < 5000:
        return None
    try:
        im = Image.open(io.BytesIO(buf.getvalue()))
        im.load()
    except Exception:
        return None
    if min(im.size) < min_side:
        return None
    has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
    if keep_alpha and has_alpha:
        im = im.convert("RGBA")
    else:
        im = im.convert("RGB")
    if max(im.size) > maxdim:
        im.thumbnail((maxdim, maxdim), Image.LANCZOS)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if keep_alpha and has_alpha:
        dest = os.path.splitext(dest)[0] + ".png"
        im.save(dest, optimize=True)
    else:
        dest = os.path.splitext(dest)[0] + ".jpg"
        im.save(dest, quality=quality, optimize=True)
    return im.size[0], im.size[1], dest


# ---------------------------------------------------------------- Openverse (CC search aggregator)
OV_OK = {"by": "CC BY", "by-sa": "CC BY-SA", "cc0": "CC0", "pdm": "Public Domain Mark"}


def openverse(q, n=20, licenses="by,by-sa,cc0,pdm", page=1, extra=None):
    params = {"q": q, "license": licenses, "page_size": min(n, 20), "page": page, "mature": "false"}
    if extra:
        params.update(extra)
    r = get("https://api.openverse.org/v1/images/", params=params, ua=UA_WIKI, key="openverse", gap=3.5,
            retries=4)
    try:
        j = r.json()
    except ValueError:
        return []
    out = []
    for x in j.get("results", []):
        lic = OV_OK.get(x.get("license"), x.get("license"))
        ver = x.get("license_version") or ""
        out.append({"title": x.get("title") or "", "url": x.get("url"), "page": x.get("foreign_landing_url"),
                    "author": x.get("creator") or "", "license": f"{lic} {ver}".strip(),
                    "w": x.get("width") or 0, "h": x.get("height") or 0, "provider": x.get("provider")})
    return out
