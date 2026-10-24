"""Round 5: single cucumber slice / single chili / lime isolated. Usage: python3 -I fetch_foodtex5.py <out_dir>"""
import sys
sys.path.insert(0, "/home/user/special-telegram/scripts/research/R2")
import fetch_foodtex  # noqa: E402

fetch_foodtex.T = {
    "cucumber_slice_png": ["cucumber slice png transparent", "แตงกวาหั่นแว่น png", "fresh cucumber slices on white"],
    "chili_single_png": ["red chili pepper png", "พริกขี้หนู png", "green chili pepper png"],
    "lime_png": ["lime slice png", "มะนาว ผ่าซีก png"],
}
fetch_foodtex.main()
