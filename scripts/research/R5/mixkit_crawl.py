#!/usr/bin/env python3
"""R5-audio: crawl Mixkit free-SFX category pages (slowly) and build a local catalog.

Usage: python3 -I mixkit_crawl.py <out_dir> cat1 cat2 ...
Pages are saved as untrusted HTML in <out_dir>/pages, catalog in <out_dir>/catalog.json.
Only titles / ids / durations / tags are parsed (regex, no execution of anything).
"""
import json, os, re, subprocess, sys, time, html

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
DELAY = 4.0


def fetch(url, dest):
    for attempt in range(4):
        r = subprocess.run(["curl", "-sS", "-A", UA, "-o", dest, "-w", "%{http_code}", url],
                           capture_output=True, text=True)
        code = r.stdout.strip()
        if code == "200":
            return True
        if code in ("404", "301", "302", "410"):
            return False
        wait = 60 * (attempt + 1)
        print(f"  {url} -> {code}; sleeping {wait}s", flush=True)
        time.sleep(wait)
    return False


def parse(text):
    items = []
    chunks = text.split('data-audio-player-item-id-value="')[1:]
    for ch in chunks:
        m = re.match(r"(\d+)", ch)
        if not m:
            continue
        iid = int(m.group(1))
        t = re.search(r'item-grid-card__title">\s*(.*?)\s*</h2>', ch, re.S)
        title = html.unescape(t.group(1).strip()) if t else ""
        d = re.search(r'data-test-id="duration">\s*([0-9:]+)\s*<', ch)
        dur = d.group(1) if d else ""
        # tags until next item
        tags = re.findall(r'meta-links__link" data-global--meta-links-target="link" href="/free-sound-effects/([a-z0-9-]+)/"', ch)
        items.append({"id": iid, "title": title, "dur": dur, "tags": tags})
    pages = [int(x) for x in re.findall(r"\?page=(\d+)", text)]
    return items, (max(pages) if pages else 1)


def main():
    out = sys.argv[1]
    cats = sys.argv[2:]
    os.makedirs(os.path.join(out, "pages"), exist_ok=True)
    catpath = os.path.join(out, "catalog.json")
    catalog = json.load(open(catpath)) if os.path.exists(catpath) else {}
    done_path = os.path.join(out, "done_cats.json")
    done = set(json.load(open(done_path))) if os.path.exists(done_path) else set()
    for cat in cats:
        if cat in done:
            continue
        page, maxp = 1, 1
        while page <= maxp:
            url = f"https://mixkit.co/free-sound-effects/{cat}/" + (f"?page={page}" if page > 1 else "")
            dest = os.path.join(out, "pages", f"{cat}_{page}.html")
            if not os.path.exists(dest) or os.path.getsize(dest) < 5000:
                ok = fetch(url, dest)
                time.sleep(DELAY)
                if not ok:
                    break
            text = open(dest, encoding="utf-8", errors="replace").read()
            items, mp = parse(text)
            maxp = max(maxp, mp)
            for it in items:
                k = str(it["id"])
                e = catalog.setdefault(k, {"title": it["title"], "dur": it["dur"], "tags": [], "cats": []})
                for tg in it["tags"]:
                    if tg not in e["tags"]:
                        e["tags"].append(tg)
                if cat not in e["cats"]:
                    e["cats"].append(cat)
            print(f"{cat} p{page}/{maxp}: {len(items)} items (catalog {len(catalog)})", flush=True)
            page += 1
        done.add(cat)
        json.dump(catalog, open(catpath, "w"), indent=0, ensure_ascii=False)
        json.dump(sorted(done), open(done_path, "w"))
    json.dump(catalog, open(catpath, "w"), indent=0, ensure_ascii=False)


if __name__ == "__main__":
    main()
