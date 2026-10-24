"""Woven PP macro photos. Usage: python3 -I fetch_props_extra2.py <out_dir>"""
import sys
sys.path.insert(0, "/home/user/special-telegram/scripts/research/R2")
import fetch_foodtex  # noqa: E402

fetch_foodtex.T = {
    "pp_woven_macro": ["pp woven fabric close up macro", "polypropylene woven fabric roll close up white",
                       "ผ้าใบสาน pp ใกล้ๆ", "woven sack material macro photo"],
}
fetch_foodtex.main()
