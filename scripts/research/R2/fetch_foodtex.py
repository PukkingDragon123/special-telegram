"""Food-texture source photos from web image search (client rule: any licence, pick best-looking).
Usage: python3 -I fetch_foodtex.py <out_dir> [per_topic]"""
import json
import os
import sys

sys.path.insert(0, "/home/user/special-telegram/scripts/research/R2")
import r2lib  # noqa: E402

T = {
    "rice_close": ["ข้าวหอมมะลิ หุงสุก ใกล้ๆ", "cooked jasmine rice close up texture"],
    "rice_mound": ["ข้าวสวย จาน มุมบน", "steamed rice on plate top view"],
    "pork_raw": ["หมูบด ดิบ ใกล้ๆ", "raw minced pork close up"],
    "kaphrao_close": ["ผัดกะเพราหมูสับ ใกล้ๆ", "pad kra pao moo sab close up"],
    "basil_white": ["ใบกะเพรา พื้นหลังขาว", "holy basil leaves isolated on white background"],
    "chili_red_white": ["พริกขี้หนู พื้นหลังขาว", "red bird eye chili isolated white background"],
    "chili_green_white": ["พริกขี้หนูเขียว พื้นหลังขาว", "green bird eye chili isolated white"],
    "garlic_white": ["กระเทียมไทย กลีบ พื้นหลังขาว", "thai garlic cloves isolated white background"],
    "garlic_crushed": ["กระเทียมทุบ ใกล้ๆ", "crushed garlic close up"],
    "egg_fried_white": ["ไข่ดาว พื้นหลังขาว", "fried egg isolated white background top view"],
    "egg_crispy": ["ไข่ดาวกรอบ มุมบน", "thai crispy fried egg top view"],
    "omelette": ["ไข่เจียว ใกล้ๆ", "thai omelette kai jeow close up"],
    "longbean_white": ["ถั่วฝักยาว พื้นหลังขาว", "yardlong bean isolated white background"],
    "cucumber_white": ["แตงกวาหั่น พื้นหลังขาว", "cucumber slices isolated white background"],
    "onion_white": ["หอมใหญ่หั่น พื้นหลังขาว", "sliced onion isolated white background"],
    "friedrice_close": ["ข้าวผัดหมู ใกล้ๆ", "thai fried rice close up"],
    "noodles_wide": ["ผัดซีอิ๊ว เส้นใหญ่ ใกล้ๆ", "wide rice noodles pad see ew close up"],
    "tomyum_top": ["ต้มยำน้ำข้น มุมบน", "tom yum soup top view"],
    "burnt": ["ข้าวไหม้ ก้นกระทะ", "burnt food close up texture"],
    "sauce_glossy": ["ซอส มันเงา ใกล้ๆ", "glossy brown sauce texture close up"],
    "oil_pan": ["น้ำมันร้อน ในกระทะ ใกล้ๆ", "hot oil in pan close up"],
    "basil_cooked": ["กะเพรา ผัด ใบ ใกล้ๆ", "stir fried holy basil leaves close up"],
}


def main():
    out = sys.argv[1]
    per = int(sys.argv[2]) if len(sys.argv) > 2 else 6
    os.makedirs(out, exist_ok=True)
    log = open(os.path.join(out, "_log.jsonl"), "a", encoding="utf-8")
    for topic, qs in T.items():
        d = os.path.join(out, topic)
        if os.path.isdir(d) and len(os.listdir(d)) >= 3:
            continue
        cands, seen = [], set()
        for q in qs:
            try:
                for it in r2lib.ddg_images(q, n=30):
                    if it["image"] in seen or min(it["w"], it["h"]) < 700:
                        continue
                    if any(b in (it["image"] + it["page"]).lower() for b in r2lib.BAD_HOSTS):
                        continue
                    seen.add(it["image"])
                    it["query"] = q
                    cands.append(it)
            except Exception as e:  # noqa: BLE001
                print("ERR", q, e, flush=True)
        got = 0
        for it in cands[: per * 3]:
            if got >= per:
                break
            res = r2lib.download_image(it["image"], os.path.join(d, f"{topic}_{got + 1:02d}.jpg"), maxdim=2000,
                                       min_side=650, quality=93)
            if not res:
                continue
            got += 1
            log.write(json.dumps(dict(it, topic=topic, file=os.path.relpath(res[2], out), size=res[:2]),
                                 ensure_ascii=False) + "\n")
            log.flush()
        print(topic, got, flush=True)


if __name__ == "__main__":
    main()
