"""Extra real-product queries. Usage: python3 -I fetch_products2.py <out_dir>"""
import sys
sys.path.insert(0, "/home/user/special-telegram/scripts/research/R2")
import fetch_products  # noqa: E402

fetch_products.P = {
    "leo_bottle2": ["Leo beer bottle 620ml white background", "เบียร์ลีโอ 620 มล. ขวด พื้นขาว", "Leo lager beer thailand bottle png"],
    "leo_can": ["เบียร์ลีโอ กระป๋อง 490 มล.", "Leo beer can 490ml"],
    "chang_bottle": ["เบียร์ช้าง ขวด 620 มล. พื้นขาว", "Chang classic beer bottle 620ml white background"],
    "leo_carton2": ["ลังเบียร์ลีโอ กระป๋อง 24", "Leo beer 24 cans carton box"],
    "beer_carton_brown": ["ลังกระดาษ เบียร์ช้าง ขวด", "Chang beer carton box 12 bottles"],
    "mama_box_side": ["ลังมาม่า ต้มยำกุ้ง 30 ซอง", "มาม่า ยกลัง 30 ซอง กล่อง"],
    "melamine_leaf": ["จานเมลามีน ลายใบไม้ ขอบเขียว", "จานเมลามีน ลายดอกไม้ ร้านอาหารตามสั่ง"],
    "melamine_blue": ["จานเมลามีน ลายคราม", "จานลายครามเมลามีน ร้านข้าว"],
    "rooster_bowl": ["ชามตราไก่ มุมบน", "ชามตราไก่ ลายไก่ ชามก๋วยเตี๋ยว"],
    "melamine_white": ["จานเมลามีน สีขาว ขอบเรียบ", "white melamine plate top view"],
    "stool_red_top": ["เก้าอี้พลาสติก ทรงเตี้ย สีแดง มุมบน", "red plastic stool top view"],
    "stool_blue": ["เก้าอี้พลาสติก สีน้ำเงิน ร้านก๋วยเตี๋ยว", "blue plastic stool thailand"],
    "lpg_hose": ["สายแก๊ส หุงต้ม สีส้ม", "LPG gas hose orange"],
    "curry_bag": ["ถุงแกง ใส ถุงร้อน", "ถุงร้อน ใส่แกง มัดยาง"],
    "foam_box": ["กล่องโฟม ใส่อาหาร สีขาว", "styrofoam food box white"],
    "rice_cooker_big": ["หม้อหุงข้าว 10 ลิตร เชิงพาณิชย์", "หม้อหุงข้าวไฟฟ้า ขนาดใหญ่ สแตนเลส"],
    "tamarind_board_top": ["เขียงไม้มะขาม หน้าเขียง มุมบน", "เขียงไม้มะขามแท้ ขนาดใหญ่"],
    "wok_inside": ["กระทะเหล็ก ด้านใน ดำ ใช้งาน", "seasoned carbon steel wok interior"],
}
fetch_products.main()
