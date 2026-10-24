"""Extra prop texture sources. Usage: python3 -I fetch_props_extra.py <out_dir>"""
import sys
sys.path.insert(0, "/home/user/special-telegram/scripts/research/R2")
import fetch_foodtex  # noqa: E402

fetch_foodtex.T = {
    "board_used_top": ["เขียงไม้มะขาม เก่า ใช้งาน รอยมีด", "เขียงไม้ ร้านหมู ตลาดสด หน้าเขียง", "used wooden chopping block top view knife marks"],
    "board_endgrain": ["หน้าตัดไม้มะขาม วงปี", "tamarind wood cross section rings", "tree trunk cross section top view"],
    "pp_woven": ["กระสอบพลาสติกสาน ใกล้ๆ", "woven polypropylene sack texture close up", "woven pp bag fabric macro"],
    "plastic_crumpled": ["ถุงพลาสติกใส ยับ ใกล้ๆ", "crumpled clear plastic bag texture", "crinkled plastic film texture"],
    "melamine_green_rim": ["จานเมลามีน ขอบเขียว", "จานเมลามีน ลายใบไม้ เขียว ร้านข้าวแกง", "จาน ลายเขียว ร้านอาหารตามสั่ง"],
    "stainless_table_top": ["โต๊ะสแตนเลส หน้าโต๊ะ รอยขีดข่วน", "scratched stainless steel table top texture"],
}
fetch_foodtex.main()
