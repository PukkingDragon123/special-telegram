"""Shrimp sources. Usage: python3 -I fetch_foodtex6.py <out_dir>"""
import sys
sys.path.insert(0, "/home/user/special-telegram/scripts/research/R2")
import fetch_foodtex  # noqa: E402

fetch_foodtex.T = {
    "shrimp_raw": ["กุ้งขาว ดิบ พื้นหลังขาว", "raw shrimp isolated on white background", "raw prawns white background top view"],
    "shrimp_cooked": ["กุ้งสุก พื้นหลังขาว", "cooked shrimp isolated white background"],
}
fetch_foodtex.main()
