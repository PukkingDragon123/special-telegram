"""Second round of food texture sources. Usage: python3 -I fetch_foodtex2.py <out_dir>"""
import sys
sys.path.insert(0, "/home/user/special-telegram/scripts/research/R2")
import fetch_foodtex  # noqa: E402

fetch_foodtex.T = {
    "cucumber_slices": ["แตงกวาหั่นแว่น", "cucumber slices top view white background", "sliced cucumber rounds"],
    "chili_red": ["พริกขี้หนูแดง สด พื้นขาว", "red thai chili peppers white background", "bird's eye chili red isolated"],
    "onion_rings": ["หอมหัวใหญ่ หั่นแว่น", "onion slices white background top view", "sliced white onion rings"],
    "garlic_peeled": ["กระเทียมแกะเปลือก พื้นขาว", "peeled garlic cloves white background"],
    "garlic_chopped": ["กระเทียมสับ", "minced garlic close up"],
    "basil_leaf": ["ใบกะเพรา ใบเดียว พื้นขาว", "holy basil leaf isolated white", "tulsi leaves white background"],
    "egg_top": ["ไข่ดาว มุมบน พื้นขาว", "sunny side up egg isolated top view", "fried egg crispy edges top view"],
    "rice_macro": ["เมล็ดข้าวหุงสุก มาโคร", "cooked white rice grains macro texture"],
    "pork_mince_tex": ["หมูสับ ดิบ เนื้อ ใกล้", "ground pork texture macro"],
    "longbean_cut": ["ถั่วฝักยาว หั่นท่อน", "chopped long beans pieces"],
    "kale_leaf": ["คะน้า ผัก สด พื้นขาว", "chinese broccoli kailan white background"],
    "morning_glory": ["ผักบุ้งไฟแดง ใกล้ๆ", "stir fried morning glory close up"],
    "radna_gravy": ["ราดหน้า น้ำราดหน้า ใกล้ๆ", "rad na gravy close up"],
    "char_wok": ["คราบไหม้ กระทะ", "burnt pan bottom texture"],
    "lime_wedge": ["มะนาวผ่าซีก พื้นขาว", "lime wedge isolated white"],
    "shallot_sliced": ["หอมแดงซอย", "sliced shallots close up"],
}
fetch_foodtex.main()
