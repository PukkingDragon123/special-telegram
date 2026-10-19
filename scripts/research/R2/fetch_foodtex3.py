"""Third round: isolated ingredient photos still missing. Usage: python3 -I fetch_foodtex3.py <out_dir>"""
import sys
sys.path.insert(0, "/home/user/special-telegram/scripts/research/R2")
import fetch_foodtex  # noqa: E402

fetch_foodtex.T = {
    "garlic_clove_iso": ["garlic clove isolated white background", "peeled garlic clove isolated", "กลีบกระเทียมไทย แกะเปลือก"],
    "cucumber_iso": ["cucumber slice isolated white background", "sliced cucumber isolated on white"],
    "lime_iso": ["lime half isolated white background", "มะนาวผ่าครึ่ง พื้นขาว"],
    "soy_pool": ["soy sauce pool close up", "dark sauce texture macro glossy"],
    "tomyum_surface": ["ต้มยำน้ำข้น ใกล้ๆ น้ำซุป", "tom yum broth surface close up oil"],
    "noodle_raw_wide": ["เส้นใหญ่ ก๋วยเตี๋ยว สด", "fresh wide rice noodles sheet"],
    "chili_single": ["single red chili pepper isolated", "bird eye chili single isolated white"],
}
fetch_foodtex.main()
