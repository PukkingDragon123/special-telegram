"""Real Thai product photos (client rule change: labels must come from real product images, any licence).
Usage: python3 -I fetch_products.py <out_dir> [per_product]
"""
import json
import os
import sys

sys.path.insert(0, "/home/user/special-telegram/scripts/research/R2")
import r2lib  # noqa: E402

P = {
    "gm_sauce": ["ซอสภูเขาทอง ฝาเขียว 600 มล.", "Golden Mountain seasoning sauce bottle", "ซอสปรุงรสฝาเขียว ภูเขาทอง"],
    "tiparos": ["น้ำปลาทิพรส 700 มล.", "Tiparos fish sauce bottle"],
    "squid_fishsauce": ["น้ำปลาตราปลาหมึก 700 มล.", "Squid brand fish sauce bottle"],
    "maekrua": ["ซอสหอยนางรมแม่ครัว 600 มล.", "Maekrua oyster sauce bottle"],
    "hb_lightsoy": ["ซีอิ๊วขาว เด็กสมบูรณ์ สูตร 1 700 มล.", "Healthy Boy thin soy sauce formula 1"],
    "hb_darksoy": ["ซีอิ๊วดำหวาน เด็กสมบูรณ์", "Healthy Boy sweet dark soy sauce bottle"],
    "mitrphol": ["น้ำตาลทรายขาว มิตรผล 1 กก.", "Mitr Phol pure refined sugar 1kg"],
    "ajinomoto": ["อายิโนะโมะโต๊ะ ผงชูรส 500 กรัม", "Ajinomoto MSG Thailand pack"],
    "hand_pepper": ["พริกไทยขาวป่น ตรามือ ขวด", "Hand brand ground white pepper Thailand"],
    "chili_powder": ["พริกป่น ตรามือ ขวด", "พริกป่น ขวด ตรามือ 100 กรัม"],
    "angoon_oil": ["น้ำมันถั่วเหลือง องุ่น 1 ลิตร", "Angoon soybean oil 1 litre"],
    "palm_oil": ["น้ำมันปาล์ม มรกต 1 ลิตร", "Morakot palm oil 1 litre bottle"],
    "vinegar": ["น้ำส้มสายชูกลั่น 5% ภูเขาทอง", "น้ำส้มสายชู อสร ขวด"],
    "eggs": ["ไข่ไก่ ซีพี แพ็ค", "ไข่ไก่ เบอร์ 2 แพ็ค 10 ฟอง ฉลาก"],
    "rice5": ["ข้าวหอมมะลิ หงษ์ทอง 5 กก.", "ข้าวหอมมะลิ ตราฉัตร 5 กก."],
    "rice15": ["ข้าวหอมมะลิ 15 กก. กระสอบ", "ข้าวสาร 15 กิโล กระสอบ ตราฉัตร"],
    "lpg": ["ถังแก๊ส ปตท 15 กก.", "PTT LPG gas cylinder 15 kg", "ถังแก๊ส เวิลด์แก๊ส 15 กก."],
    "water": ["น้ำดื่มสิงห์ 600 มล.", "น้ำดื่มคริสตัล 600 มล."],
    "coke": ["โค้ก กระป๋อง 325 มล.", "Coca-Cola can Thailand"],
    "coke_glass": ["โค้ก ขวดแก้ว 250 มล.", "Coca-Cola glass bottle Thailand"],
    "fanta_orange": ["แฟนต้า ส้ม กระป๋อง", "Fanta orange can Thailand"],
    "fanta_red": ["แฟนต้า น้ำแดง สตรอเบอร์รี่", "Fanta strawberry Thailand bottle"],
    "fanta_green": ["แฟนต้า น้ำเขียว ครีมโซดา", "Fanta green cream soda Thailand"],
    "kratingdaeng": ["กระทิงแดง ขวด 150 มล.", "Krating Daeng bottle"],
    "m150": ["M-150 ขวด 150 มล.", "M-150 energy drink bottle"],
    "chatramue": ["ชาตรามือ แก้ว ชาเย็น", "ChaTraMue Thai tea cup logo"],
    "mama_cup": ["มาม่า คัพ ต้มยำกุ้ง", "Mama cup tom yum shrimp"],
    "chang_can": ["เบียร์ช้าง กระป๋อง 490 มล.", "Chang beer can"],
    "leo_bottle": ["เบียร์ลีโอ ขวด 620 มล.", "Leo beer bottle Thailand"],
    "singha_bottle": ["เบียร์สิงห์ ขวด 620 มล.", "Singha beer bottle"],
    "sangsom": ["แสงโสม 700 มล.", "SangSom rum bottle"],
    "ice_bag": ["น้ำแข็งหลอด ถุง 20 กิโล", "ถุงน้ำแข็งหลอด"],
    "pork_tray": ["หมูบด ซีพี ถาด", "CP minced pork tray Thailand"],
    "basil_pack": ["ใบกะเพรา แพ็ค ซุปเปอร์มาร์เก็ต", "ใบกะเพรา ถุง ฉลาก"],
    "mama_carton": ["ลังมาม่า ต้มยำกุ้ง", "Mama instant noodle carton box"],
    "chang_carton": ["ลังเบียร์ช้าง กระป๋อง", "Chang beer carton 24 cans"],
    "leo_carton": ["ลังเบียร์ลีโอ", "Leo beer carton box"],
}


def main():
    out = sys.argv[1]
    per = int(sys.argv[2]) if len(sys.argv) > 2 else 8
    os.makedirs(out, exist_ok=True)
    log = open(os.path.join(out, "_log.jsonl"), "a", encoding="utf-8")
    for prod, qs in P.items():
        d = os.path.join(out, prod)
        if os.path.isdir(d) and len(os.listdir(d)) >= 3:
            print(prod, "skip", flush=True)
            continue
        cands, seen = [], set()
        for q in qs:
            try:
                for it in r2lib.ddg_images(q, n=30):
                    if it["image"] in seen:
                        continue
                    seen.add(it["image"])
                    if min(it["w"], it["h"]) < 600:
                        continue
                    if any(b in (it["image"] + it["page"]).lower() for b in r2lib.BAD_HOSTS):
                        continue
                    it["query"] = q
                    cands.append(it)
            except Exception as e:  # noqa: BLE001
                print("ERR", q, e, flush=True)
        # prefer large images
        cands.sort(key=lambda it: -min(it["w"], it["h"]))
        got = 0
        for it in cands[: per * 3]:
            if got >= per:
                break
            dest = os.path.join(d, f"{prod}_{got + 1:02d}.jpg")
            res = r2lib.download_image(it["image"], dest, maxdim=2000, min_side=600, quality=93)
            if not res:
                continue
            got += 1
            log.write(json.dumps(dict(it, product=prod, file=os.path.relpath(res[2], out), size=res[:2]),
                                 ensure_ascii=False) + "\n")
            log.flush()
        print(prod, got, "of", len(cands), flush=True)


if __name__ == "__main__":
    main()
