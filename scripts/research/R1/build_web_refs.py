"""R1-streets: build the curated reference set references/streets/web/ (agents' eyes only).

usage: python3 -I build_web_refs.py plan   -> writes _raw/webrefs_plan.json (top candidates per tag)
       python3 -I build_web_refs.py fetch  -> downloads/resizes (<=1280 px, q82) into references/streets/web/
"""
import concurrent.futures as cf
import io
import json
import os
import re
import sys

import requests
from PIL import Image

RAW = "/home/user/special-telegram/references/streets/_raw"
WEB = "/home/user/special-telegram/references/streets/web"
UA = "HiaPhatGameDev/0.1 (https://github.com/PukkingDragon123/special-telegram)"
BUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

PLAN = {  # tag -> (topic name used in filename, count)
    "shophouse": ("shophouse_row", 5), "soi": ("bangkok_soi", 4), "wires": ("utility_pole_wires", 4),
    "sidewalk": ("sidewalk", 3), "curb": ("curb_painted", 2), "road": ("road_traffic", 3),
    "food": ("street_food_stall", 4), "market": ("fresh_market", 3), "store": ("convenience_store", 2),
    "winmotosai": ("motorcycle_taxi", 3), "spirit": ("spirit_house", 2), "temple": ("temple_wall_street", 2),
    "canal": ("khlong_canal_houses", 3), "rural": ("rural_edge", 5), "provincial": ("provincial_town", 2),
    "night": ("night_street", 4), "rain": ("rain_wet_street", 2), "tuktuk": ("tuktuk", 2),
    "songthaew": ("songthaew", 2), "taxi": ("taxi", 2), "bus": ("city_bus", 2), "pickup": ("pickup_loaded", 2),
    "scooter": ("scooter_rider", 3), "delivery": ("delivery_rider", 1), "plate": ("licence_plate", 1),
    "signs": ("signage", 3), "grille": ("window_grille", 1), "ac": ("ac_units_facade", 1),
    "balcony": ("balcony_plants", 1), "laundry": ("laundry_hanging", 1), "gate": ("folding_gate", 1),
    "furniture": ("plastic_chairs", 1), "dog": ("soi_dog", 1),
}


def slug(s, n=5):
    s = re.sub(r"[^A-Za-z0-9]+", "_", s or "").strip("_").lower()
    return "_".join(s.split("_")[:n])[:40]


def plan():
    cands = {}
    for src in ("flickr", "commons"):
        mp = os.path.join(RAW, src, "meta.jsonl")
        for line in open(mp, encoding="utf-8"):
            c = json.loads(line)
            if (c.get("w") or 0) < 700:
                continue
            cands.setdefault(c["tag"], []).append(c)
    out = []
    skip = set(json.load(open(os.path.join(RAW, "webrefs_skip.json")))) if os.path.exists(os.path.join(RAW, "webrefs_skip.json")) else set()
    for tag, (topic, n) in PLAN.items():
        got = 0
        for c in cands.get(tag, []):
            if c["id"] in skip:
                continue
            out.append({"id": c["id"], "tag": tag, "topic": topic, "src": c["source"], "url": c["url"],
                        "thumb": c.get("thumb"), "title": c.get("title", ""), "page": c.get("page", ""),
                        "author": c.get("author", ""), "licence": c.get("licence", "")})
            got += 1
            if got >= n + 2:      # 2 spares per tag for rejection
                break
    json.dump(out, open(os.path.join(RAW, "webrefs_plan.json"), "w"), ensure_ascii=False, indent=1)
    print(len(out), "planned")


def fetch_one(p):
    url = p["url"]
    if p["src"] == "commons":
        url = (p.get("thumb") or url).split("?")[0]
    ua = UA if "wikimedia" in url else BUA
    try:
        r = requests.get(url, headers={"User-Agent": ua}, timeout=(8, 30))
        if r.status_code != 200 or not r.headers.get("content-type", "").startswith("image/"):
            return p["id"], None, f"http {r.status_code}"
        im = Image.open(io.BytesIO(r.content)).convert("RGB")
    except Exception as e:
        return p["id"], None, type(e).__name__
    im.thumbnail((1280, 1280), Image.LANCZOS)
    name = f"{p['topic']}__{slug(p['title'])}__{p['id']}.jpg"
    im.save(os.path.join(WEB, name), quality=82, optimize=True)
    return p["id"], name, "ok"


def fetch():
    os.makedirs(WEB, exist_ok=True)
    plan_ = json.load(open(os.path.join(RAW, "webrefs_plan.json")))
    have = {f.split("__")[-1][:-4] for f in os.listdir(WEB) if f.endswith(".jpg")}
    todo = [p for p in plan_ if p["id"] not in have]
    res = {}
    with cf.ThreadPoolExecutor(4) as ex:
        for cid, name, st in ex.map(fetch_one, todo):
            res[cid] = name
            print(cid, st, name or "")


if __name__ == "__main__":
    {"plan": plan, "fetch": fetch}[sys.argv[1]]()
