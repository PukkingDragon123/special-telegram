#!/usr/bin/env python3
"""R6-pbr: download leaf/plant atlases (diffuse + alpha + nor_gl) from Poly Haven models (CC0)
and ambientCG foliage atlases, into scripts/_cache/pbr_dl/raw/. Data only, never executed.
Usage: python3 -I fetch_plant_atlases.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import r6lib as L  # noqa: E402

PH_MODELS = ["potted_plant_02", "potted_plant_01", "anthurium_botany_01", "calathea_orbifolia_01", "pachira_aquatica_01",
             "fern_02", "grass_bermuda_01", "grass_medium_01", "grass_medium_02", "weed_plant_02", "periwinkle_plant",
             "moss_01", "jacaranda_tree", "island_tree_01", "island_tree_02", "tree_small_02", "shrub_02", "shrub_04",
             "dandelion_01", "nettle_plant", "shrub_sorrel_01", "celandine_01"]
ACG = ["Foliage001", "Foliage002", "Foliage003", "Foliage004", "Foliage005", "Foliage006", "Foliage007", "Foliage008",
       "LeafSet017", "LeafSet029", "LeafSet024", "LeafSet022", "LeafSet018", "LeafSet026", "LeafSet009", "LeafSet010",
       "LeafSet001", "LeafSet002", "LeafSet003", "LeafSet004", "LeafSet014", "Leaf001", "Leaf002", "Leaf003", "Moss002"]


def pick(files, kinds):
    for k in kinds:
        if k in files:
            return k
    return None


def fetch_model(aid, res="2k"):
    fdir = os.path.join(L.CACHE, "catalog", "files")
    fn = os.path.join(fdir, f"model_{aid}.json")
    if not os.path.exists(fn):
        open(fn, "wb").write(L.http_get(f"https://api.polyhaven.com/files/{aid}"))
    files = json.load(open(fn))
    want = {
        "diff": pick(files, ["leaves_diff", "Diffuse"]),
        "alpha": pick(files, ["leaves_alpha", "Alpha", "opacity", "Mask"]),
        "nor": pick(files, ["leaves_nor_gl", "nor_gl"]),
        "arm": pick(files, ["leaves_arm", "arm"]),
        "translucency": pick(files, ["translucency"]),
    }
    d = os.path.join(L.RAW, f"phm_{aid}_{res}")
    os.makedirs(d, exist_ok=True)
    out = {}
    for role, key in want.items():
        if not key:
            continue
        entry = files[key].get(res) or files[key].get("1k")
        fmt = "png" if role == "alpha" and "png" in entry else ("jpg" if "jpg" in entry else "png")
        p = os.path.join(d, f"{role}.{fmt}")
        if not os.path.exists(p):
            open(p, "wb").write(L.http_get(entry[fmt]["url"]))
        out[role] = p
    return out


def main():
    res = {}
    for aid in PH_MODELS:
        try:
            res["ph:" + aid] = fetch_model(aid)
            print("ok", aid, list(res["ph:" + aid]))
        except Exception as e:  # noqa
            print("FAIL", aid, e)
    for aid in ACG:
        try:
            res["acg:" + aid] = L.fetch_acg(aid, "2K")
            print("ok", aid, list(res["acg:" + aid]))
        except Exception as e:  # noqa
            print("FAIL", aid, e)
    json.dump(res, open(os.path.join(L.CACHE, "plant_atlases.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
