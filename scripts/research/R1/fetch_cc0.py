"""R1-streets: fetch CC0 base materials from Poly Haven (direct JPGs) and ambientCG (zips).

usage: python3 -I fetch_cc0.py polyhaven <res> id1 id2 ...
       python3 -I fetch_cc0.py ambientcg <res> Asset1 Asset2 ...   (res e.g. 2K)
Files land in references/streets/_raw/cc0/<provider>/<id>/ (bytes only; zips are
extracted with zipfile after checking member names; nothing is executed).
"""
import io
import json
import os
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import net  # noqa: E402

ROOT = "/home/user/special-telegram/references/streets/_raw/cc0"


def polyhaven(res, ids):
    for aid in ids:
        out = os.path.join(ROOT, "polyhaven", aid)
        os.makedirs(out, exist_ok=True)
        try:
            files = net.get_json(f"https://api.polyhaven.com/files/{aid}")
        except Exception as e:
            print("fail", aid, e)
            continue
        want = {"Diffuse": "diff", "nor_gl": "nor_gl", "Rough": "rough", "AO": "ao",
                "Displacement": "disp", "arm": None}
        for key, short in want.items():
            if not short or key not in files:
                continue
            node = files[key].get(res) or files[key].get("2k") or files[key].get("1k")
            if not node:
                continue
            fmt = node.get("jpg") or node.get("png")
            if not fmt:
                continue
            url = fmt["url"]
            ext = os.path.splitext(url)[1]
            dest = os.path.join(out, f"{aid}_{short}{ext}")
            ok = net.download(url, dest)
            print(aid, short, "ok" if ok else "FAIL")


def ambientcg(res, ids):
    for aid in ids:
        out = os.path.join(ROOT, "ambientcg", aid)
        os.makedirs(out, exist_ok=True)
        url = f"https://ambientcg.com/get?file={aid}_{res}-JPG.zip"
        r = net.get(url, timeout=120)
        if r.status_code != 200 or not r.content[:2] == b"PK":
            # some assets only ship PNG
            url = f"https://ambientcg.com/get?file={aid}_{res}-PNG.zip"
            r = net.get(url, timeout=120)
        if r.status_code != 200 or not r.content[:2] == b"PK":
            print("fail", aid, r.status_code)
            continue
        z = zipfile.ZipFile(io.BytesIO(r.content))
        for m in z.infolist():
            name = os.path.basename(m.filename)
            if not name or not name.lower().endswith((".jpg", ".png")):
                continue
            with open(os.path.join(out, name), "wb") as f:
                f.write(z.read(m))
        print(aid, "ok", len(z.infolist()))


if __name__ == "__main__":
    prov, res, ids = sys.argv[1], sys.argv[2], sys.argv[3:]
    (polyhaven if prov == "polyhaven" else ambientcg)(res, ids)
