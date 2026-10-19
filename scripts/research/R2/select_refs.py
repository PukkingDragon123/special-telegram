"""Copy the hand-picked reference photos into references/food/web/ with descriptive names + sources CSV.
Usage: python3 -I select_refs.py"""
import csv
import json
import os
import shutil

RAW = "/home/user/special-telegram/references/food/_raw"
WEB = "/home/user/special-telegram/references/food/web"
PICK = {
    # final name prefix: [(round, file), ...]  -> named <prefix>_<nn>.jpg
    "dish_kaphrao": [("cand", f"dish_kaphrao/dish_kaphrao_{i:02d}.jpg") for i in (1, 2, 3, 4, 9, 14, 18, 19)],
    "dish_kaidao": [("cand", f"dish_kaidao/dish_kaidao_{i:02d}.jpg") for i in (3, 4, 5)],
    "dish_kaijiao": [("cand", f"dish_kaijiao/dish_kaijiao_{i:02d}.jpg") for i in (2, 3, 5)],
    "dish_khaophat": [("cand", f"dish_khaophat/dish_khaophat_{i:02d}.jpg") for i in (2, 3)],
    "dish_phatphrikkaeng": [("cand", f"dish_phatphrikkaeng/dish_phatphrikkaeng_{i:02d}.jpg") for i in (1, 2)],
    "dish_phatsiew": [("cand", f"dish_phatsiew/dish_phatsiew_{i:02d}.jpg") for i in (2, 3)],
    "dish_radna": [("cand", f"dish_radna/dish_radna_{i:02d}.jpg") for i in (3, 4)],
    "dish_tomyum": [("cand", f"dish_tomyum/dish_tomyum_{i:02d}.jpg") for i in (2, 3)],
    "dish_muukratiam": [("cand", f"dish_muukratiam/dish_muukratiam_{i:02d}.jpg") for i in (1, 2)],
    "dish_phakbung": [("cand", f"dish_phakbung/dish_phakbung_{i:02d}.jpg") for i in (1, 3)],
    "cart": [("cand", "cart/cart_09.jpg"), ("cand", "cart/cart_15.jpg"), ("cand", "cart/cart_18.jpg"),
             ("cand2", "cart/cart_01.jpg"), ("cand2", "cart/cart_05.jpg"), ("cand2", "cart/cart_07.jpg"),
             ("cand2", "cart/cart_08.jpg")],
    "vendor_wok": [("cand", f"vendor/vendor_{i:02d}.jpg") for i in (1, 2, 6)],
    "burner_lpg": [("cand", "burner/burner_02.jpg"), ("cand", "burner/burner_03.jpg"), ("cand", "burner/burner_06.jpg")],
    "market": [("cand", f"market/market_{i:02d}.jpg") for i in (1, 3, 5, 8, 15, 22)],
    "ingr_basil": [("cand", "ingr_basil/ingr_basil_01.jpg"), ("cand", "ingr_basil/ingr_basil_02.jpg")],
    "ingr_pork": [("cand2", "ingr_pork/ingr_pork_01.jpg"), ("cand2", "ingr_pork/ingr_pork_04.jpg")],
    "ingr_chili": [("cand", "ingr_chili/ingr_chili_02.jpg")],
    "ingr_garlic": [("cand", "ingr_garlic/ingr_garlic_02.jpg")],
    "ingr_longbean": [("cand", "ingr_longbean/ingr_longbean_01.jpg")],
    "ingr_morningglory": [("cand", "ingr_morningglory/ingr_morningglory_01.jpg")],
    "ingr_eggs": [("cand", "ingr_eggs/ingr_eggs_03.jpg")],
    "ingr_ricesack": [("cand", "ingr_rice/ingr_rice_01.jpg")],
    "season": [("cand", "season_gm/season_gm_04.jpg"), ("cand", "season_fish/season_fish_01.jpg"),
               ("cand", "season_oyster/season_oyster_01.jpg"), ("cand", "season_soy/season_soy_01.jpg"),
               ("cand", "season_darksoy/season_darksoy_03.jpg"), ("cand", "season_sugar/season_sugar_01.jpg"),
               ("cand", "season_msg/season_msg_02.jpg"), ("cand", "season_pepper/season_pepper_01.jpg"),
               ("cand", "season_prikfishsauce/season_prikfishsauce_01.jpg"),
               ("cand2", "season_caddy/season_caddy_01.jpg"), ("cand2", "season_vinegar/season_vinegar_03.jpg")],
    "tool": [("cand", "tool_wok/tool_wok_03.jpg"), ("cand2", "tool_wok/tool_wok_01.jpg"),
             ("cand", "tool_spatula/tool_spatula_03.jpg"),
             ("cand", "tool_cleaver/tool_cleaver_02.jpg"), ("cand", "tool_board/tool_board_01.jpg"),
             ("cand", "tool_mortar/tool_mortar_04.jpg"), ("cand", "tool_ricecooker/tool_ricecooker_04.jpg")],
    "dishware": [("cand", "dishware/dishware_02.jpg"), ("cand", "dishware/dishware_05.jpg"),
                 ("cand2", "dishware/dishware_01.jpg"), ("cand2", "dishware/dishware_04.jpg")],
    "takeaway": [("cand", "takeaway/takeaway_01.jpg"), ("cand", "takeaway/takeaway_08.jpg"),
                 ("cand", "takeaway/takeaway_09.jpg"), ("cand2", "takeaway/takeaway_05.jpg")],
    "drink": [("cand", "drink/drink_01.jpg"), ("cand", "drink/drink_05.jpg"), ("cand", "drink/drink_14.jpg"),
              ("cand", "drink/drink_17.jpg")],
    "furniture": [("cand", "furniture/furniture_05.jpg"), ("cand", "furniture/furniture_09.jpg"),
                  ("cand2", "furniture/furniture_06.jpg"),
                  ("cand2", "furniture/furniture_07.jpg"), ("cand2", "furniture/furniture_13.jpg")],
    "cardboard": [("cand2", "cardboard/cardboard_01.jpg"), ("cand2", "cardboard/cardboard_06.jpg")],
    "label_ref": [("cand2", f"label_ref/label_ref_{i:02d}.jpg") for i in (4, 7, 13, 22, 33, 37)],
}


def main():
    logs = {}
    for rnd in ("cand", "cand2"):
        p = os.path.join(RAW, rnd, "_log.jsonl")
        for line in open(p, encoding="utf-8"):
            d = json.loads(line)
            logs[(rnd, d["file"])] = d
    os.makedirs(WEB, exist_ok=True)
    rows = []
    n = 0
    for prefix, items in PICK.items():
        for i, (rnd, f) in enumerate(items, 1):
            src = os.path.join(RAW, rnd, f)
            if not os.path.exists(src):
                print("missing", src)
                continue
            name = f"{prefix}_{i:02d}.jpg"
            shutil.copy2(src, os.path.join(WEB, name))
            d = logs.get((rnd, f), {})
            rows.append([name, d.get("query", ""), d.get("image", ""), d.get("page", ""), d.get("title", "")])
            n += 1
    with open(os.path.join(WEB, "_sources.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["file", "search_query", "image_url", "page_url", "title"])
        w.writerows(rows)
    print("copied", n)


if __name__ == "__main__":
    main()
