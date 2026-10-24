"""Extra real products for cooking slots. Usage: python3 -I fetch_products3.py <out_dir>"""
import sys
sys.path.insert(0, "/home/user/special-telegram/scripts/research/R2")
import fetch_products  # noqa: E402

fetch_products.P = {
    "curry_paste": ["น้ำพริกแกงเผ็ด แม่พลอย กระปุก", "Mae Ploy red curry paste 400g tub", "Mae Ploy red curry paste"],
    "chili_paste": ["น้ำพริกเผา แม่ประนอม ขวด", "Pantainorasingh chili paste in oil jar", "น้ำพริกเผา ตราแม่ประนอม"],
    "tapioca": ["แป้งมันสำปะหลัง ตราปลามังกร 500 กรัม", "แป้งมัน ตราช้างสามเศียร", "tapioca starch fish dragon brand"],
}
fetch_products.main()
