#!/usr/bin/env python3
"""Slow, rate-limit-tolerant Commons downloader.  python3 -I commons_queue.py <queue.tsv>
queue.tsv lines: <outdir>\t<File:Title>
Downloads originals from upload.wikimedia.org (URL computed from md5 of the name)."""
import hashlib, os, re, subprocess, sys, time, urllib.parse

UA = "HiaPhatGameDev/0.1 (https://github.com/PukkingDragon123/special-telegram)"


def url_for(title):
    name = title.replace("File:", "").replace(" ", "_")
    h = hashlib.md5(name.encode("utf-8")).hexdigest()
    return f"https://upload.wikimedia.org/wikipedia/commons/{h[0]}/{h[:2]}/{urllib.parse.quote(name)}"


def main():
    items = [l.rstrip("\n").split("\t") for l in open(sys.argv[1], encoding="utf-8") if "\t" in l]
    pending = [(d, t) for d, t in items]
    wait = 5
    while pending:
        d, t = pending[0]
        os.makedirs(d, exist_ok=True)
        fn = re.sub(r"[\s,/\\'\"]+", "_", t.replace("File:", ""))
        dest = os.path.join(d, fn)
        if os.path.exists(dest) and os.path.getsize(dest) > 4000:
            pending.pop(0)
            continue
        r = subprocess.run(["curl", "-sS", "-L", "-A", UA, "-o", dest, "-w", "%{http_code}", url_for(t)],
                           capture_output=True, text=True)
        code = r.stdout.strip()
        if code == "200" and os.path.getsize(dest) > 4000:
            print("ok", fn, flush=True)
            pending.pop(0)
            wait = 5
        elif code == "404":
            print("404", t, flush=True)
            os.remove(dest)
            pending.pop(0)
        else:
            if os.path.exists(dest):
                os.remove(dest)
            wait = min(300, max(60, wait * 2))
            print(code, "waiting", wait, t, flush=True)
            time.sleep(wait)
            continue
        time.sleep(wait)


if __name__ == "__main__":
    main()
