#!/usr/bin/env python3
"""R5-audio: OpenGameArt search + page inspection helper (polite, 2 s delay).

  python3 -I oga.py search <type:sfx|music> "<keys>" [licenses=cc0,by,bysa]
  python3 -I oga.py page <url-or-path>      -> title, author, licences, file links
  python3 -I oga.py dl <outdir> <url> ...   -> download files into a fresh dir
"""
import html, os, re, subprocess, sys, time, urllib.parse

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
LIC = {"cc0": "4", "by3": "2", "by4": "17981", "bysa3": "3", "bysa4": "17982"}
TYPE = {"sfx": "13", "music": "12"}


def get(url):
    time.sleep(2.0)
    r = subprocess.run(["curl", "-sS", "-L", "-A", UA, url], capture_output=True)
    return r.stdout.decode("utf-8", "replace")


def search(typ, keys, lics=("cc0", "by3", "by4", "bysa3", "bysa4"), pages=1):
    out = []
    for page in range(pages):
        q = [("keys", keys), ("field_art_type_tid[]", TYPE[typ]), ("sort_by", "count"),
             ("sort_order", "DESC"), ("items_per_page", "48"), ("page", str(page))]
        for l in lics:
            q.append(("field_art_licenses_tid[]", LIC[l]))
        t = get("https://opengameart.org/art-search-advanced?" + urllib.parse.urlencode(q))
        found = re.findall(r'<span class="art-preview-title"><a href="(/content/[^"]+)">([^<]+)</a>', t)
        if not found:
            found = re.findall(r'<a href="(/content/[^"]+)"[^>]*>([^<]+)</a>', t)
        for href, title in found:
            item = (href, html.unescape(title))
            if item not in out:
                out.append(item)
        if len(found) < 48:
            break
    return out


def page(url):
    if url.startswith("/"):
        url = "https://opengameart.org" + url
    t = get(url)
    title = re.search(r"<title>([^<]+)</title>", t)
    author = re.findall(r'field-name-author-submitter.*?<a href="/users/[^"]+">([^<]+)</a>', t, re.S)
    lic = re.findall(r"<div class=['\"]license-name['\"]>([^<]+)</div>", t)
    notice = re.search(r'field-name-field-copyright-notice.*?<div class="field-item even">(.*?)</div>', t, re.S)
    if notice:
        lic.append("NOTICE: " + html.unescape(re.sub(r"<[^>]+>", " ", notice.group(1))).strip()[:300])
    files = re.findall(r'href="(https://opengameart.org/sites/default/files/[^"]+)"', t)
    body = re.search(r'field-name-body.*?<div class="field-item even"[^>]*>(.*?)</div>', t, re.S)
    btxt = re.sub(r"<[^>]+>", " ", body.group(1)) if body else ""
    return {"url": url, "title": html.unescape(title.group(1)) if title else "", "author": author[:1],
            "licenses": lic, "files": sorted(set(files)), "body": " ".join(btxt.split())[:600]}


def dl(outdir, urls):
    os.makedirs(outdir, exist_ok=True)
    for u in urls:
        fn = urllib.parse.unquote(u.rsplit("/", 1)[-1])
        fn = re.sub(r"[^A-Za-z0-9._()-]+", "_", fn)
        dest = os.path.join(outdir, fn)
        if os.path.exists(dest):
            continue
        time.sleep(1.5)
        r = subprocess.run(["curl", "-sS", "-L", "-A", UA, "-o", dest, "-w", "%{http_code}", u],
                           capture_output=True, text=True)
        print(r.stdout, fn, flush=True)


if __name__ == "__main__":
    c = sys.argv[1]
    if c == "search":
        lics = sys.argv[4].split(",") if len(sys.argv) > 4 else ("cc0", "by3", "by4", "bysa3", "bysa4")
        for href, title in search(sys.argv[2], sys.argv[3], lics):
            print(href, "|", title)
    elif c == "page":
        for u in sys.argv[2:]:
            p = page(u)
            print("##", p["title"], "|", p["author"], "|", p["licenses"])
            print("  ", p["body"][:400])
            for f in p["files"]:
                print("   ", f)
    elif c == "dl":
        dl(sys.argv[2], sys.argv[3:])
