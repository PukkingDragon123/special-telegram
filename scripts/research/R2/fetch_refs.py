"""Collect candidate reference photos (unknown licence -> references only, git-ignored).
Usage: python3 -I fetch_refs.py <out_dir> [per_query]
"""
import json
import os
import sys

sys.path.insert(0, "/home/user/special-telegram/scripts/research/R2")
import r2lib  # noqa: E402

QUERIES = [
    # dishes
    ("dish_kaphrao", "ข้าวกะเพราหมูสับไข่ดาว จานเมลามีน"),
    ("dish_kaphrao", "กะเพราหมูสับไข่ดาว ร้านอาหารตามสั่ง"),
    ("dish_kaphrao", "pad krapow moo sab kai dao street food bangkok plate"),
    ("dish_kaphrao", "กะเพราหมูสับ ราดข้าว ไข่ดาวกรอบ ร้านข้างทาง"),
    ("dish_kaphrao", "ผัดกะเพราหมูสับ ในกระทะ"),
    ("dish_kaidao", "ไข่ดาวกรอบ ขอบกรอบ ไข่แดงเยิ้ม"),
    ("dish_kaidao", "ทอดไข่ดาว น้ำมันเยอะ กระทะเหล็ก"),
    ("dish_kaijiao", "ไข่เจียวฟู กรอบ ร้านอาหารตามสั่ง"),
    ("dish_kaijiao", "ข้าวไข่เจียว ซอสพริก จานเมลามีน"),
    ("dish_khaophat", "ข้าวผัดหมู ไข่ ร้านอาหารตามสั่ง มะนาว แตงกวา"),
    ("dish_phatphrikkaeng", "ผัดพริกแกงหมู ถั่วฝักยาว ราดข้าว"),
    ("dish_phatsiew", "ผัดซีอิ๊วหมู เส้นใหญ่ คะน้า"),
    ("dish_radna", "ราดหน้าหมู เส้นใหญ่ คะน้า"),
    ("dish_tomyum", "ต้มยำกุ้งน้ำข้น ชาม ร้านอาหาร"),
    ("dish_tomyum", "ต้มยำน้ำใส หมู ชาม"),
    ("dish_muukratiam", "ข้าวหมูกระเทียม ไข่ดาว"),
    ("dish_phakbung", "ผัดผักบุ้งไฟแดง จาน"),
    # carts & vendors
    ("cart", "รถเข็นอาหารตามสั่ง ตู้กระจก"),
    ("cart", "ร้านอาหารตามสั่ง ข้างทาง เตาแก๊ส ถังแก๊ส กระทะ"),
    ("cart", "thai street food cart wok stall bangkok"),
    ("cart", "รถเข็นสแตนเลส ขายอาหาร ตู้กระจก"),
    ("cart", "ร้านอาหารตามสั่ง รถเข็น ซอย"),
    ("vendor", "พ่อค้า ผัดกะเพรา ไฟลุก กระทะ"),
    ("vendor", "bangkok street vendor wok flames cooking"),
    ("vendor", "แม่ค้า อาหารตามสั่ง ผัด กระทะ"),
    ("burner", "หัวเตาแก๊สแรงดันสูง เตาฟู่ ร้านอาหารตามสั่ง"),
    ("burner", "ถังแก๊ส 15 กิโล หุงต้ม"),
    # markets
    ("market", "ตลาดสด แม่ค้า แผงผัก"),
    ("market", "แผงหมู ตลาดสด ตะขอแขวน"),
    ("market", "ตลาดสด ร่มใหญ่ แผงลอย"),
    ("market", "แผงไข่ไก่ ตลาดสด ถาดไข่"),
    ("market", "ตาชั่ง ตลาดสด กิโล"),
    ("market", "thai wet market vegetables basket"),
    ("market", "thai fresh market pork stall"),
    # raw ingredients
    ("ingr_basil", "ใบกะเพรา กำ สด"),
    ("ingr_pork", "หมูสับ ถาด ตลาด"),
    ("ingr_chili", "พริกขี้หนูสวน สด"),
    ("ingr_garlic", "กระเทียมไทย กลีบ"),
    ("ingr_shallot", "หอมแดง ศรีสะเกษ"),
    ("ingr_longbean", "ถั่วฝักยาว กำ ตลาด"),
    ("ingr_morningglory", "ผักบุ้งจีน กำ"),
    ("ingr_eggs", "ไข่ไก่ แผง 30 ฟอง"),
    ("ingr_rice", "ข้าวหอมมะลิ กระสอบ 15 กิโล"),
    ("ingr_oil", "น้ำมันปาล์ม ขวด 1 ลิตร"),
    ("ingr_onion", "หอมหัวใหญ่ ตลาด"),
    # seasonings
    ("season_gm", "ซอสปรุงรส ภูเขาทอง ฝาเขียว ขวด"),
    ("season_fish", "น้ำปลา ทิพรส ขวด"),
    ("season_oyster", "ซอสหอยนางรม แม่ครัว ขวด"),
    ("season_soy", "ซีอิ๊วขาว เด็กสมบูรณ์ ขวด"),
    ("season_darksoy", "ซีอิ๊วดำ หวาน ขวด"),
    ("season_sugar", "น้ำตาลทราย มิตรผล ถุง 1 กก"),
    ("season_msg", "ผงชูรส อายิโนะโมะโต๊ะ ถุง"),
    ("season_pepper", "พริกไทยป่น ตรามือ"),
    ("season_chiliflake", "พริกป่น ขวด ร้านก๋วยเตี๋ยว"),
    ("season_prikfishsauce", "พริกน้ำปลา ถ้วย"),
    ("season_caddy", "พวงเครื่องปรุง ก๋วยเตี๋ยว"),
    ("season_vinegar", "น้ำส้มสายชู ขวด"),
    ("season_rack", "ชั้นวางเครื่องปรุง ร้านอาหารตามสั่ง"),
    # tools
    ("tool_wok", "กระทะเหล็ก ร้านอาหารตามสั่ง"),
    ("tool_spatula", "ตะหลิว เหล็ก ด้ามไม้"),
    ("tool_ladle", "กระบวย สแตนเลส"),
    ("tool_cleaver", "มีดอีโต้ สับหมู"),
    ("tool_board", "เขียงไม้มะขาม"),
    ("tool_mortar", "ครกดินเผา สากไม้"),
    ("tool_ricecooker", "หม้อหุงข้าว ขนาดใหญ่ ร้านอาหาร"),
    ("tool_paddle", "ทัพพี ตักข้าว"),
    ("tool_sieve", "กระชอน ลวด ด้ามไม้"),
    ("tool_tongs", "ที่คีบ สแตนเลส"),
    # dishware
    ("dishware", "จานเมลามีน ลายดอก ร้านอาหาร"),
    ("dishware", "ชามตราไก่"),
    ("dishware", "ช้อนส้อมสแตนเลส กล่องใส่ช้อน ร้านอาหาร"),
    ("dishware", "ทิชชู่ม้วน โต๊ะร้านอาหาร"),
    ("dishware", "จานเมลามีน ลายเขียว"),
    # takeaway
    ("takeaway", "ถุงแกง หนังยาง"),
    ("takeaway", "กล่องโฟม ข้าวกะเพรา"),
    ("takeaway", "กล่องกระดาษ ใส่อาหาร ข้าวกะเพรา"),
    # drinks
    ("drink", "ตู้กดน้ำ หยอดเหรียญ"),
    ("drink", "ถังน้ำแข็ง ร้านอาหาร"),
    ("drink", "แก้วพลาสติก น้ำแข็ง ร้านอาหาร"),
    ("drink", "ชาเย็น แก้วซีล"),
    ("drink", "น้ำแดง โซดา ขวดแก้ว"),
    ("drink", "เครื่องดื่มชูกำลัง ขวดสีชา"),
    ("drink", "ตู้แช่ น้ำอัดลม ร้านอาหาร"),
    # furniture
    ("furniture", "เก้าอี้พลาสติก สีแดง ร้านอาหารข้างทาง"),
    ("furniture", "โต๊ะพับสแตนเลส ร้านอาหาร"),
    ("furniture", "ร่มแม่ค้า ร่มใหญ่"),
    ("furniture", "กะละมังล้างจาน ร้านอาหาร"),
    ("furniture", "โต๊ะพลาสติก เก้าอี้พลาสติก ร้านข้างทาง"),
]


def main():
    out_dir = sys.argv[1]
    per_q = int(sys.argv[2]) if len(sys.argv) > 2 else 4
    os.makedirs(out_dir, exist_ok=True)
    log = open(os.path.join(out_dir, "_log.jsonl"), "a", encoding="utf-8")
    counters = {}
    for qi, (cat, q) in enumerate(QUERIES):
        try:
            res = r2lib.ddg_images(q, n=40)
        except Exception as e:  # noqa: BLE001
            print("ERR search", q, e, flush=True)
            continue
        got = 0
        for item in res:
            if got >= per_q:
                break
            w, h = item["w"], item["h"]
            if min(w, h) < 500 or max(w, h) / max(1, min(w, h)) > 2.2:
                continue
            if any(b in (item["image"] + item["page"]).lower() for b in r2lib.BAD_HOSTS):
                continue
            n = counters.get(cat, 0) + 1
            dest = os.path.join(out_dir, cat, f"{cat}_{n:02d}.jpg")
            res_dl = r2lib.download_image(item["image"], dest, maxdim=1280, min_side=450)
            if not res_dl:
                continue
            counters[cat] = n
            got += 1
            rec = dict(item, cat=cat, query=q, file=os.path.relpath(res_dl[2], out_dir), size=res_dl[:2])
            log.write(json.dumps(rec, ensure_ascii=False) + "\n")
            log.flush()
        print(f"[{qi+1}/{len(QUERIES)}] {cat} '{q}': {got}", flush=True)


if __name__ == "__main__":
    main()
