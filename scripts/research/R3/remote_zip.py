#!/usr/bin/env python3
"""Read a (ZIP64) archive over HTTP Range requests without downloading it all.

R3-people research helper.  Usage:
  python3 -I remote_zip.py list  <url> <out_listing.json>
  python3 -I remote_zip.py fetch <url> <listing.json> <out_dir> <name> [<name> ...]
  python3 -I remote_zip.py fetchlist <url> <listing.json> <out_dir> <names.txt>

Only stored (0) and deflated (8) members are supported.  Member names are
sanitised to their basename before writing (no path traversal).
"""
import json
import os
import re
import struct
import sys
import time
import zlib

import requests

UA = "HiaPhatGameDev/0.1 (https://github.com/PukkingDragon123/special-telegram)"
S = requests.Session()
S.headers["User-Agent"] = UA


def size_of(url):
    r = S.head(url, allow_redirects=True, timeout=60)
    r.raise_for_status()
    return int(r.headers.get("content-length") or r.headers.get("x-linked-size"))


def rng(url, start, end):
    """Inclusive byte range."""
    for attempt in range(6):
        try:
            r = S.get(url, headers={"Range": f"bytes={start}-{end}"}, timeout=120)
            if r.status_code == 429:
                time.sleep(5 * (attempt + 1))
                continue
            r.raise_for_status()
            if r.status_code != 206 and not (start == 0):
                raise RuntimeError(f"server ignored range: {r.status_code}")
            return r.content
        except (requests.RequestException, RuntimeError) as e:  # noqa: PERF203
            print("retry", attempt, e, file=sys.stderr)
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("range fetch failed")


def list_zip(url):
    total = size_of(url)
    tail_len = min(total, 1 << 17)
    tail = rng(url, total - tail_len, total - 1)
    eocd = tail.rfind(b"PK\x05\x06")
    if eocd < 0:
        raise RuntimeError("no EOCD")
    (_, disk, cd_disk, n_disk, n_total, cd_size, cd_off, clen) = struct.unpack(
        "<IHHHHIIH", tail[eocd:eocd + 22])
    if cd_off == 0xFFFFFFFF or n_total == 0xFFFF or cd_size == 0xFFFFFFFF:
        loc = tail.rfind(b"PK\x06\x07", 0, eocd)
        if loc < 0:
            raise RuntimeError("no zip64 locator")
        _, _, z64_off, _ = struct.unpack("<IIQI", tail[loc:loc + 20])
        z64 = rng(url, z64_off, z64_off + 56 - 1)
        if z64[:4] != b"PK\x06\x06":
            raise RuntimeError("bad zip64 eocd")
        (_, _, _, _, _, _, n_disk, n_total, cd_size, cd_off) = struct.unpack(
            "<IQHHIIQQQQ", z64[:56])
    print(f"archive {total} bytes, {n_total} entries, CD {cd_size} bytes @ {cd_off}",
          file=sys.stderr)
    cd = b""
    step = 8 << 20
    pos = cd_off
    while pos < cd_off + cd_size:
        end = min(cd_off + cd_size - 1, pos + step - 1)
        cd += rng(url, pos, end)
        pos = end + 1
    entries = []
    p = 0
    while p + 46 <= len(cd) and cd[p:p + 4] == b"PK\x01\x02":
        (_, _, _, flags, method, _, _, crc, csize, usize, nlen, xlen, mlen, _, _, _,
         loff) = struct.unpack("<IHHHHHHIIIHHHHHII", cd[p:p + 46])
        name = cd[p + 46:p + 46 + nlen].decode("utf-8", "replace")
        extra = cd[p + 46 + nlen:p + 46 + nlen + xlen]
        if 0xFFFFFFFF in (csize, usize, loff):
            q = 0
            while q + 4 <= len(extra):
                hid, hsz = struct.unpack("<HH", extra[q:q + 4])
                if hid == 1:
                    vals = extra[q + 4:q + 4 + hsz]
                    k = 0
                    if usize == 0xFFFFFFFF:
                        usize = struct.unpack("<Q", vals[k:k + 8])[0]
                        k += 8
                    if csize == 0xFFFFFFFF:
                        csize = struct.unpack("<Q", vals[k:k + 8])[0]
                        k += 8
                    if loff == 0xFFFFFFFF:
                        loff = struct.unpack("<Q", vals[k:k + 8])[0]
                        k += 8
                q += 4 + hsz
        entries.append({"name": name, "method": method, "csize": csize, "usize": usize,
                        "off": loff, "crc": crc})
        p += 46 + nlen + xlen + mlen
    return {"url": url, "size": total, "entries": entries}


SAFE = re.compile(r"[^A-Za-z0-9._-]")


def fetch_member(url, e, out_dir):
    # one request: local header + generous slack for name/extra + data
    blob = rng(url, e["off"], e["off"] + 30 + 1024 + e["csize"] - 1)
    if blob[:4] != b"PK\x03\x04":
        raise RuntimeError("bad local header for " + e["name"])
    nlen, xlen = struct.unpack("<HH", blob[26:30])
    s = 30 + nlen + xlen
    if s + e["csize"] <= len(blob):
        data = blob[s:s + e["csize"]]
    else:
        start = e["off"] + s
        data = rng(url, start, start + e["csize"] - 1)
    if e["method"] == 8:
        data = zlib.decompress(data, -15)
    elif e["method"] != 0:
        raise RuntimeError("unsupported method %d" % e["method"])
    if (zlib.crc32(data) & 0xFFFFFFFF) != e["crc"]:
        raise RuntimeError("crc mismatch " + e["name"])
    base = SAFE.sub("_", os.path.basename(e["name"]))
    path = os.path.join(out_dir, base)
    with open(path, "wb") as f:
        f.write(data)
    return path


def main():
    cmd = sys.argv[1]
    if cmd == "list":
        url, out = sys.argv[2], sys.argv[3]
        lst = list_zip(url)
        with open(out, "w") as f:
            json.dump(lst, f)
        print(len(lst["entries"]), "entries")
        return
    url, listing, out_dir = sys.argv[2], sys.argv[3], sys.argv[4]
    with open(listing) as f:
        lst = json.load(f)
    by = {e["name"]: e for e in lst["entries"]}
    if cmd == "fetch":
        names = sys.argv[5:]
    else:
        with open(sys.argv[5]) as f:
            names = [ln.strip() for ln in f if ln.strip()]
    os.makedirs(out_dir, exist_ok=True)
    from concurrent.futures import ThreadPoolExecutor

    todo = [n for n in names
            if not os.path.exists(os.path.join(out_dir, SAFE.sub("_", os.path.basename(n))))]

    def one(n):
        try:
            fetch_member(url, by[n], out_dir)
        except Exception as ex:  # noqa: BLE001
            print("FAIL", n, ex, file=sys.stderr)

    with ThreadPoolExecutor(max_workers=4) as ex:
        for i, _ in enumerate(ex.map(one, todo)):
            if i % 50 == 0:
                print(i, "/", len(todo), file=sys.stderr)


if __name__ == "__main__":
    main()
