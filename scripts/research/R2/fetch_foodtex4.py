"""Round 4 texture sources. Usage: python3 -I fetch_foodtex4.py <out_dir>"""
import sys
sys.path.insert(0, "/home/user/special-telegram/scripts/research/R2")
import fetch_foodtex  # noqa: E402

fetch_foodtex.T = {
    "oil_bubbles": ["น้ำมันเดือด ฟอง ใกล้ๆ", "bubbling hot oil close up texture", "deep frying oil bubbles top view"],
    "burnt_crust": ["ข้าวตัง ก้นหม้อ ไหม้", "burnt rice crust close up", "burnt food pan close up texture"],
    "friedrice_top": ["ข้าวผัดหมู เต็มจาน ใกล้ๆ มุมบน", "thai fried rice texture close up top view"],
    "tomyum_clear": ["ต้มยำน้ำใส ใกล้ๆ", "clear tom yum soup close up"],
    "radna_top": ["ราดหน้าหมู มุมบน ใกล้ๆ", "rad na noodles gravy top view"],
}
fetch_foodtex.main()
