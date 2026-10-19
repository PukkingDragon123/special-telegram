"""Parody product labels for เฮียผัด! (all original designs; colour language evokes real Thai products).
Usage: python3 -I make_labels.py [name ...]   (no args = all)
Outputs PNGs + manifest.json into public/assets/img/labels/.
"""
import json
import math
import os
import random
import sys

sys.path.insert(0, "/home/user/special-telegram/scripts/research/R2")
import numpy as np  # noqa: E402
from PIL import Image, ImageDraw, ImageFilter, ImageChops  # noqa: E402

import art  # noqa: E402
import labelkit as K  # noqa: E402

OUT = "/home/user/special-telegram/public/assets/img/labels"
RAW = "/home/user/special-telegram/references/food/_raw"
REG = {}
MANIFEST = {}


def label(name, **meta):
    def deco(fn):
        REG[name] = (fn, meta)
        return fn
    return deco


def canvas(w_cm, h_cm, px_w=2048, bg="#ffffff"):
    W = px_w
    H = int(round(px_w * h_cm / w_cm))
    return Image.new("RGBA", (W, H), K.C(bg))


def export(im, name, out_w=1024, keep_alpha=False, seed=0, grain=4.0, misreg=1, worn=None, worn_kw=None):
    os.makedirs(OUT, exist_ok=True)
    fin = K.finish(im, seed=seed, grain=grain, misreg=misreg, out_w=out_w, keep_alpha=keep_alpha)
    p = os.path.join(OUT, name + ".png")
    fin.save(p, optimize=True)
    files = [os.path.basename(p)]
    if worn:
        g = K.greasy(im, seed=seed + 100, **(worn_kw or {}))
        gf = K.finish(g, seed=seed + 1, grain=grain + 2, misreg=misreg, out_w=out_w, keep_alpha=keep_alpha)
        p2 = os.path.join(OUT, name + "_worn.png")
        gf.save(p2, optimize=True)
        files.append(os.path.basename(p2))
    return files, fin.size


SMALL = "Sarabun-Regular"
SMALLB = "Sarabun-Bold"


def fake_fda(seed):
    r = random.Random(seed)
    return f"{r.randint(10, 74)}-{r.randint(1, 2)}-{r.randint(10000, 99999)}-{r.randint(1, 5)}-{r.randint(1, 9999):04d}"


def info_panel(im, box, lines, fname=SMALL, size=None, col="#1a1a1a", bold_first=True, line=1.32):
    """Uniform-size small print block; shrinks until every line fits the box width and height."""
    x0, y0, x1, y1 = box
    size = size or (y1 - y0) / (len(lines) * line + 0.2)
    while size > 5:
        ok = all(K.text_size(ln, K.F(SMALLB if (bold_first and i == 0) else fname, size))[0] <= (x1 - x0)
                 for i, ln in enumerate(lines)) and size * line * len(lines) <= (y1 - y0) + size * 0.3
        if ok:
            break
        size *= 0.95
    d = ImageDraw.Draw(im)
    y = y0
    for i, ln in enumerate(lines):
        f = K.F(SMALLB if (bold_first and i == 0) else fname, size)
        d.text((x0, y), ln, font=f, fill=K.C(col), anchor="la")
        y += size * line
    return y


def side(im, xy, s, fname, size, col, maxw, stroke=0, stroke_fill="#ffffff"):
    """Centered text fitted to a max width (for side claims between front and back panels)."""
    f = K.fit(s, fname, maxw, None, size)
    K.text(im, xy, s, f, col, stroke=stroke, stroke_fill=stroke_fill)


# =====================================================================================================
@label("seasoning_sauce_phukhao_ngern", product="ซอสปรุงรส ฝาเขียว (Seasoning sauce, green cap)",
       brand_th="ภูเขาเงิน", brand_en="Silver Mountain", evokes="Golden Mountain seasoning sauce (ซอสภูเขาทอง ฝาเขียว)",
       package="PET bottle 600 ml, full wrap label (front panel centred at u=0.5)",
       real_dims_cm={"bottle_h": 24.5, "bottle_d": 7.2, "label_w": 22.6, "label_h": 8.0}, cap="green (#1f8a3c)",
       worn=True)
def seasoning_sauce():
    im = canvas(22.6, 8.0)
    W, H = im.size
    yb = int(H * 0.36)
    im.alpha_composite(K.lin_grad(W, yb, [(0, "#ffe43d"), (1, "#f5b70a")]), (0, 0))
    im.alpha_composite(K.lin_grad(W, H - yb, [(0, "#20903f"), (0.55, "#167333"), (1, "#0c5022")]), (0, yb))
    im.alpha_composite(K.guilloche(W, H - yb, "#ffffff", n=24, amp=0.85, freq=6, width=2, alpha=22, seed=4), (0, yb))
    d = ImageDraw.Draw(im)
    d.rectangle([0, yb - 9, W, yb], fill=K.C("#c8161d"))
    d.rectangle([0, yb, W, yb + 6], fill=K.C("#ffffff"))
    d.rectangle([0, H - 16, W, H], fill=K.C("#c8161d"))
    d.rectangle([0, 0, W, 10], fill=K.C("#c8161d"))
    cx = W * 0.5
    # ---- emblem (oval badge straddling both bands)
    ow, oh = W * 0.175, H * 0.60
    oy = H * 0.07
    ob = [cx - ow / 2, oy, cx + ow / 2, oy + oh]
    d.ellipse([ob[0] - 9, ob[1] - 9, ob[2] + 9, ob[3] + 9], fill=K.C("#ffffff"))
    gold = K.metal(W, H, "gold", seed=2, angle=80)
    K.paint_mask(im, K.ellipse_mask(im.size, [ob[0] - 4, ob[1] - 4, ob[2] + 4, ob[3] + 4]), gold)
    d.ellipse(ob, fill=K.C("#c8161d"))
    ib = [ob[0] + ow * 0.11, ob[1] + oh * 0.13, ob[2] - ow * 0.11, ob[3] - oh * 0.13]
    iw, ih = int(ib[2] - ib[0]), int(ib[3] - ib[1])
    scene = K.lin_grad(iw, ih, [(0, "#9fd8ff"), (0.55, "#fff4cf"), (1, "#ffe08a")])
    scene.alpha_composite(art.mountain(iw, int(ih * 0.92), "silver", seed=7), (0, int(ih * 0.08)))
    lay = Image.new("RGBA", im.size, (0, 0, 0, 0))
    lay.paste(scene, (int(ib[0]), int(ib[1])))
    K.paint_mask(im, K.ellipse_mask(im.size, ib), lay)
    d.ellipse(ib, outline=K.C("#ffd75e"), width=5)
    K.arc_text(im, (cx, oy + oh / 2), oh * 0.44, "ตราภูเขาเงิน", K.F("Kanit-Bold", H * 0.052), "#ffffff",
               start_deg=-90)
    K.arc_text(im, (cx, oy + oh / 2), oh * 0.445, "SILVER MOUNTAIN", K.F("Kanit-Bold", H * 0.040), "#ffe9a0",
               start_deg=90, clockwise=False)
    # ---- brand lettering
    K.text(im, (cx, H * 0.80), "ภูเขาเงิน", K.F("Chonburi-Regular", H * 0.135), "#ffffff", stroke=8,
           stroke_fill="#c8161d", outer=(6, "#ffffff"), shadow=(6, 7, 4, "#00000090"))
    K.text(im, (cx, H * 0.925), "SEASONING SAUCE  •  ซอสถั่วเหลืองปรุงรส", K.F("Kanit-Medium", H * 0.038), "#ffffff")
    # titles in yellow band
    K.text(im, (cx - ow * 1.02, H * 0.13), "น้ำซอสปรุงรส", K.F("Pridi-Bold", H * 0.085), "#c8161d")
    K.text(im, (cx - ow * 1.02, H * 0.26), "(ซอสถั่วเหลือง)", K.F("Pridi-Bold", H * 0.05), "#155f2a")
    K.text(im, (cx + ow * 1.02, H * 0.13), "สูตรฝาเขียว", K.F("Pridi-Bold", H * 0.085), "#155f2a")
    K.text(im, (cx + ow * 1.02, H * 0.26), "หอม เข้ม กลมกล่อม", K.F("Pridi-Bold", H * 0.05), "#c8161d")
    # chef mascot (right) with a small burst
    chef = art.chef_face(int(H * 0.42))
    im.alpha_composite(chef, (int(cx + ow * 0.66), int(H * 0.53)))
    bp = K.star_pts(cx + ow * 1.38, H * 0.53, H * 0.085, H * 0.065, 14, seed=2)
    K.paint_mask(im, K.poly_mask(im.size, bp), "#ffffff")
    bp2 = K.star_pts(cx + ow * 1.38, H * 0.53, H * 0.075, H * 0.057, 14, seed=2)
    K.paint_mask(im, K.poly_mask(im.size, bp2), "#c8161d")
    K.text(im, (cx + ow * 1.38, H * 0.515), "อร่อย", K.F("Kanit-Black", H * 0.034), "#ffffff")
    K.text(im, (cx + ow * 1.38, H * 0.555), "เด็ด!", K.F("Kanit-Black", H * 0.034), "#ffe43d")
    # seal (left)
    sl = art.seal(int(H * 0.34), "สูตรดั้งเดิม", "ฝาเขียว", "ตั้งแต่ ๒๕๐๒", col="#c8161d", seed=3)
    sx = int(cx - ow * 0.70 - sl.width)
    im.alpha_composite(sl, (sx, int(H * 0.50)))
    K.text(im, (sx + sl.width / 2, H * 0.915), "ปริมาตรสุทธิ 600 มล.", K.F("Kanit-Bold", H * 0.040), "#ffffff",
           stroke=3, stroke_fill="#0b4019")
    # ---- back panel left: ingredients / maker
    panel_left(im, (W * 0.015, H * 0.43, W * 0.232, H * 0.94), [
        "ส่วนประกอบ / INGREDIENTS",
        "ถั่วเหลือง 40%, น้ำ, เกลือ, น้ำตาล, แป้งข้าวสาลี",
        "วัตถุกันเสีย (โซเดียมเบนโซเอต INS 211)",
        "วัตถุแต่งกลิ่นรส (INS 621, 627, 631)",
        "ผลิตโดย บจก. ไทยเทพรสพาเหรด (ปลอม)",
        "99/9 ซ.ลืมทาง ถ.สุขุมเวิ้ง เขตมึน กทม. 10999",
        "วิธีใช้: ผัด ต้ม แกง ทอด จิ้ม ตามชอบ",
        "เก็บในที่แห้งและเย็น ปิดฝาให้สนิทหลังใช้",
        "เลขสารบบอาหาร " + fake_fda(1),
    ], border="#c8161d", seed=1)
    # top-left yellow band: brand line repeat
    K.text(im, (W * 0.13, H * 0.13), "ภูเขาเงิน", K.F("Chonburi-Regular", H * 0.075), "#c8161d")
    K.text(im, (W * 0.13, H * 0.25), "เข้มข้นถึงใจ ใช้ได้ทุกเมนู", K.F("Kanit-Medium", H * 0.042), "#6b2a00")
    K.text(im, (W * 0.87, H * 0.13), "ภูเขาเงิน", K.F("Chonburi-Regular", H * 0.075), "#c8161d")
    K.text(im, (W * 0.87, H * 0.25), "ผัดกะเพรา ไม่มีไม่ได้!", K.F("Kanit-Medium", H * 0.042), "#6b2a00")
    # ---- back panel right: nutrition + barcode
    panel_right(im, (W * 0.768, H * 0.43, W * 0.985, H * 0.94), NUTRI_SAUCE, "885123401001",
                ["ผลิตในประเทศไทย", "PRODUCT OF THAILAND", "ควรบริโภคก่อน: ดูที่คอขวด"], border="#c8161d")
    return im


def rrect_bg(im, box, col, alpha=255, r=14):
    lay = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ImageDraw.Draw(lay).rounded_rectangle([int(v) for v in box], radius=r, fill=K.C(col, alpha))
    im.alpha_composite(lay)


# ----------------------------------------------------------------------------------------------- helpers
def panel_left(im, box, lines, border="#c8161d", bg="#fffdf5", alpha=245, txt="#1a1a1a", gda=None, seed=0,
               recycle=("1", "PET")):
    """Back panel: small print, then (if room) GDA strip, QR code and recycling mark."""
    rrect_bg(im, box, bg, alpha, r=16)
    ImageDraw.Draw(im).rounded_rectangle([int(v) for v in box], radius=16, outline=K.C(border), width=4)
    x0, y0, x1, y1 = box
    pad = (x1 - x0) * 0.05
    bh = y1 - y0
    text_h = bh * (0.52 if bh > (x1 - x0) * 0.9 else 0.62)
    y = info_panel(im, (x0 + pad, y0 + pad, x1 - pad, y0 + pad + text_h), lines, col=txt)
    room = y1 - pad - y
    if room > bh * 0.22:
        gh = min(room * 0.55, (x1 - x0) * 0.36)
        gs = K.gda_strip((x1 - x0) - 2 * pad, gh, gda) if gda else K.gda_strip((x1 - x0) - 2 * pad, gh)
        im.alpha_composite(gs, (int(x0 + pad), int(y + pad * 0.5)))
        y += pad * 0.5 + gh
        room = y1 - pad - y
    if room > bh * 0.12:
        qs = min(room - pad * 0.5, (x1 - x0) * 0.3)
        q = K.qr_like(qs, seed=seed + 3)
        im.alpha_composite(q, (int(x0 + pad), int(y1 - pad - qs)))
        K.text(im, (x0 + pad * 2 + qs, y1 - pad - qs * 0.62), "สแกนดูสูตรเด็ด", K.F(SMALLB, qs * 0.16), txt,
               anchor="lm")
        K.text(im, (x0 + pad * 2 + qs, y1 - pad - qs * 0.38), "www.ไม่มีจริง.co.th", K.F(SMALL, qs * 0.13), txt,
               anchor="lm")
        if recycle:
            rc = K.recycle_icon(qs * 0.62, recycle[0], recycle[1], col=txt)
            im.alpha_composite(rc, (int(x1 - pad - rc.width), int(y1 - pad - rc.height)))


def panel_right(im, box, rows, code, lines, border=None, bg="#ffffff", txt="#1a1a1a", accent="#c8161d"):
    """Back panel: nutrition box on top, small print + EAN-13 barcode below."""
    rrect_bg(im, box, bg, 250, r=16)
    if border:
        ImageDraw.Draw(im).rounded_rectangle([int(v) for v in box], radius=16, outline=K.C(border), width=4)
    x0, y0, x1, y1 = box
    bw_, bh_ = x1 - x0, y1 - y0
    pad = bw_ * 0.05
    nb = K.nutrition_box(int(bw_ - 2 * pad), int(bh_ * 0.58), rows)
    im.alpha_composite(nb, (int(x0 + pad), int(y0 + pad)))
    bw = bw_ * 0.46
    bc = K.barcode(code, bw, min(bw * 0.58, bh_ * 0.34))
    im.alpha_composite(bc, (int(x1 - pad - bw), int(y1 - pad - bc.height)))
    info_panel(im, (x0 + pad, y0 + pad * 1.6 + bh_ * 0.58, x1 - pad * 2 - bw, y1 - pad), lines, col=txt)


NUTRI_SAUCE = [("หนึ่งหน่วยบริโภค", "1 ช้อนชา (5 มล.)"), ("--", ""), ("*พลังงานทั้งหมด", "5 กิโลแคลอรี"),
               ("ไขมันทั้งหมด", "0 ก."), ("โปรตีน", "1 ก."), ("น้ำตาล", "1 ก."), ("*โซเดียม", "420 มก. (18%)")]


def bg_v(im, stops, y0=0, y1=None):
    W, H = im.size
    y1 = H if y1 is None else y1
    im.alpha_composite(K.lin_grad(W, int(y1 - y0), stops), (0, int(y0)))


def photo(path, cut=False, thresh=232):
    p = os.path.join(RAW, path)
    im = Image.open(p).convert("RGB")
    return K.cutout_white(im, thresh) if cut else im.convert("RGBA")


# =====================================================================================================
@label("fish_sauce_thiprod", product="น้ำปลาแท้ (Fish sauce)", brand_th="ทิพรด", brand_en="THIP-ROD",
       evokes="Tiparos fish sauce (น้ำปลาทิพรส)", package="PET bottle 700 ml, wrap label (front centred)",
       real_dims_cm={"bottle_h": 29.0, "bottle_d": 7.5, "label_w": 23.5, "label_h": 9.5}, cap="white (#f2f2f2)",
       worn=True, worn_kw={"base_col": (120, 60, 15)})
def fish_sauce():
    im = canvas(23.5, 9.5)
    W, H = im.size
    bg_v(im, [(0, "#ffd52a"), (1, "#f3ae06")])
    im.alpha_composite(K.guilloche(W, H, "#c8161d", n=16, amp=0.9, freq=4, width=2, alpha=24, seed=9), (0, 0))
    d = ImageDraw.Draw(im)
    cx = W / 2
    pw = W * 0.24
    px0, px1 = cx - pw / 2, cx + pw / 2
    # red centre panel with gold frame
    gold = K.metal(W, H, "gold", seed=5, angle=80)
    K.paint_mask(im, K.poly_mask(im.size, [(px0 - 10, H), (px0 - 10, H * 0.06), (px1 + 10, H * 0.06),
                                            (px1 + 10, H)]), gold)
    d.rectangle([px0, H * 0.075, px1, H], fill=K.C("#c8161d"))
    d.rectangle([px0 + 10, H * 0.09, px1 - 10, H - 4], outline=K.C("#ffd35a"), width=3)
    K.text(im, (cx, H * 0.17), "น้ำปลาแท้", K.F("Pridi-Bold", H * 0.085), "#ffe14a")
    K.text(im, (cx, H * 0.27), "ตรา", K.F("Kanit-Bold", H * 0.05), "#ffffff")
    K.text(im, (cx, H * 0.42), "ทิพรด", K.F("Chonburi-Regular", H * 0.16), "#ffffff", stroke=5,
           stroke_fill="#7d0a0d", shadow=(5, 6, 3, "#00000080"))
    # fish oval
    ob = [cx - pw * 0.40, H * 0.55, cx + pw * 0.40, H * 0.80]
    d.ellipse([ob[0] - 6, ob[1] - 6, ob[2] + 6, ob[3] + 6], fill=K.C("#ffd35a"))
    sea = K.lin_grad(int(ob[2] - ob[0]), int(ob[3] - ob[1]), [(0, "#d9f1ff"), (1, "#6fb4e0")])
    lay = Image.new("RGBA", im.size, (0, 0, 0, 0))
    lay.paste(sea, (int(ob[0]), int(ob[1])))
    fw = int((ob[2] - ob[0]) * 0.80)
    f1 = art.fish(fw, int(fw * 0.32), seed=1)
    lay.alpha_composite(f1, (int(ob[0] + (ob[2] - ob[0]) * 0.08), int(ob[1] + (ob[3] - ob[1]) * 0.12)))
    f2 = art.fish(int(fw * 0.7), int(fw * 0.7 * 0.32), seed=2).transpose(Image.FLIP_LEFT_RIGHT)
    lay.alpha_composite(f2, (int(ob[0] + (ob[2] - ob[0]) * 0.22), int(ob[1] + (ob[3] - ob[1]) * 0.55)))
    K.paint_mask(im, K.ellipse_mask(im.size, ob), lay)
    K.text(im, (cx, H * 0.86), "FISH SAUCE", K.F("Kanit-Bold", H * 0.055), "#ffe14a")
    K.text(im, (cx, H * 0.935), "ปริมาตรสุทธิ 700 มล.", K.F("Kanit-Medium", H * 0.04), "#ffffff")
    # side claims (on yellow)
    lx_, rx_, mw = W * 0.297, W * 0.703, W * 0.145
    side(im, (lx_, H * 0.20), "หมักจากปลากะตัก", "Pridi-Bold", H * 0.06, "#c8161d", mw)
    side(im, (lx_, H * 0.29), "ทะเลอ่าวไทยแท้ ๆ", "Pridi-Bold", H * 0.048, "#1c3f94", mw)
    side(im, (rx_, H * 0.20), "หมักนาน ๑๘ เดือน", "Pridi-Bold", H * 0.06, "#c8161d", mw)
    side(im, (rx_, H * 0.29), "หอม ใส สีทอง", "Pridi-Bold", H * 0.048, "#1c3f94", mw)
    sl = art.seal(int(H * 0.36), "คุณภาพ", "เกรด ๑", "PREMIUM", col="#1c3f94", seed=4)
    im.alpha_composite(sl, (int(lx_ - sl.width / 2), int(H * 0.40)))
    side(im, (lx_, H * 0.86), "ปลาแท้ ทำน้ำปลาแท้", "Kanit-Medium", H * 0.045, "#3a2a00", mw)
    side(im, (rx_, H * 0.50), "ไม่ใส่", "Kanit-Black", H * 0.09, "#1c3f94", mw)
    side(im, (rx_, H * 0.62), "วัตถุกันเสีย", "Kanit-Black", H * 0.09, "#c8161d", mw)
    side(im, (rx_, H * 0.74), "ไม่เติมผงชูรส", "Kanit-Bold", H * 0.05, "#3a2a00", mw)
    # back panels
    panel_left(im, (W * 0.015, H * 0.08, W * 0.215, H * 0.94), [
        "ส่วนประกอบ / INGREDIENTS",
        "ปลากะตัก 70%, เกลือ 25%, น้ำตาล 5%",
        "โปรตีนจากปลาไม่น้อยกว่า 9 ก. ต่อ 100 มล.",
        "ผลิตโดย บจก. ทิพรดฟิชซอส (ปลอม) จ.ระยองนิด",
        "88 ม.4 ต.ปากน้ำเหม็น อ.เมืองหอม 21999",
        "วิธีใช้: ปรุงรสอาหาร หรือทำพริกน้ำปลา",
        "เมื่อเปิดแล้วควรปิดฝาให้สนิท",
        "อาจพบผลึกเกลือซึ่งเป็นธรรมชาติของน้ำปลาแท้",
        "เลขสารบบอาหาร " + fake_fda(2),
    ], border="#c8161d")
    panel_right(im, (W * 0.785, H * 0.08, W * 0.985, H * 0.94), [
        ("หนึ่งหน่วยบริโภค", "1 ช้อนชา (5 มล.)"), ("--", ""), ("*พลังงานทั้งหมด", "0 กิโลแคลอรี"),
        ("ไขมันทั้งหมด", "0 ก."), ("โปรตีน", "0 ก."), ("น้ำตาล", "0 ก."), ("*โซเดียม", "1,350 มก. (56%)")],
        "885223402007", ["ผลิตในประเทศไทย", "PRODUCT OF THAILAND", "ควรบริโภคก่อน: ดูที่ไหล่ขวด",
                          "ยิ่งเก็บนาน ยิ่งหอม"], border="#c8161d")
    return im


@label("oyster_sauce_pakrua", product="ซอสหอยนางรม (Oyster sauce)", brand_th="ป้าครัว", brand_en="PA KRUA",
       evokes="Mae Krua oyster sauce (ซอสหอยนางรมแม่ครัว)", package="glass bottle 600 cc (770 g), wrap label",
       real_dims_cm={"bottle_h": 25.5, "bottle_d": 7.6, "label_w": 23.0, "label_h": 11.0},
       cap="red metal crown/screw cap (#b5121b) + gold neck foil", worn=True, worn_kw={"base_col": (55, 30, 15)})
def oyster_sauce():
    im = canvas(23.0, 11.0)
    W, H = im.size
    bg_v(im, [(0, "#ffffff"), (1, "#f3efe6")])
    d = ImageDraw.Draw(im)
    cx = W / 2
    # red sash bands behind medallion
    d.polygon([(cx - W * 0.20, H * 0.30), (cx + W * 0.20, H * 0.30), (cx + W * 0.17, H * 0.44),
               (cx - W * 0.17, H * 0.44)], fill=K.C("#b5121b"))
    d.rectangle([0, H * 0.86, W, H], fill=K.C("#b5121b"))
    gold = K.metal(W, H, "gold", seed=8, angle=85)
    K.paint_mask(im, K.poly_mask(im.size, [(0, H * 0.845), (W, H * 0.845), (W, H * 0.862), (0, H * 0.862)]), gold)
    K.paint_mask(im, K.poly_mask(im.size, [(0, H * 0.02), (W, H * 0.02), (W, H * 0.035), (0, H * 0.035)]), gold)
    # medallion
    R = H * 0.37
    my = H * 0.45
    K.paint_mask(im, K.ellipse_mask(im.size, [cx - R - 12, my - R - 12, cx + R + 12, my + R + 12]), gold)
    d.ellipse([cx - R, my - R, cx + R, my + R], fill=K.C("#c8161d"))
    r2 = R * 0.74
    inner = K.rad_grad(int(r2 * 2), int(r2 * 2), [(0, "#ffffff"), (0.8, "#dcecff"), (1, "#a8c8ef")])
    lay = Image.new("RGBA", im.size, (0, 0, 0, 0))
    lay.paste(inner, (int(cx - r2), int(my - r2)))
    face = art.auntie_face(int(r2 * 1.9))
    lay.alpha_composite(face, (int(cx - face.width / 2), int(my - r2 * 0.92)))
    K.paint_mask(im, K.ellipse_mask(im.size, [cx - r2, my - r2, cx + r2, my + r2]), lay)
    d.ellipse([cx - r2, my - r2, cx + r2, my + r2], outline=K.C("#ffd35a"), width=6)
    K.arc_text(im, (cx, my), R * 0.87, "ซอสหอยนางรม ตราป้าครัว", K.F("Kanit-Bold", H * 0.058), "#ffffff",
               start_deg=-90)
    K.arc_text(im, (cx, my), R * 0.87, "OYSTER SAUCE", K.F("Kanit-Bold", H * 0.050), "#ffe14a", start_deg=90,
               clockwise=False)
    # brand banner under medallion
    rb = (cx - W * 0.12, H * 0.74, cx + W * 0.12, H * 0.84)
    K.ribbon(im, rb, "#1f4fa0", fold="#0d2a5c")
    K.text(im, (cx, (rb[1] + rb[3]) / 2), "ป้าครัว", K.F("Chonburi-Regular", H * 0.075), "#ffffff", stroke=3,
           stroke_fill="#0d2a5c")
    K.text(im, (cx, H * 0.93), "ปริมาตรสุทธิ 600 ซม³  •  น้ำหนักสุทธิ 770 ก.", K.F("Kanit-Medium", H * 0.045),
           "#ffffff")
    # oysters photos left/right
    for i, (fx, flip) in enumerate([(W * 0.262, False), (W * 0.738, True)]):
        try:
            ph = photo("labelart/la_oyster/la_oyster_commons_0%d.jpg" % (1 + i * 2))
            sz = int(W * 0.095)
            ph = ph.resize((sz, int(sz * ph.height / ph.width)))
            if flip:
                ph = ph.transpose(Image.FLIP_LEFT_RIGHT)
            m = K.ellipse_mask(ph.size, [0, 0, ph.width - 1, ph.height - 1]).filter(ImageFilter.GaussianBlur(3))
            ph.putalpha(m)
            im.alpha_composite(ph, (int(fx - ph.width / 2), int(H * 0.40)))
        except Exception as e:  # noqa: BLE001
            print("oyster photo", e)
    side(im, (W * 0.262, H * 0.17), "สูตรเข้มข้น", "Pridi-Bold", H * 0.075, "#b5121b", W * 0.09)
    side(im, (W * 0.262, H * 0.27), "หอยนางรมแท้", "Pridi-Bold", H * 0.05, "#1f4fa0", W * 0.09)
    side(im, (W * 0.738, H * 0.17), "ผัดอะไรก็อร่อย", "Pridi-Bold", H * 0.07, "#b5121b", W * 0.09)
    side(im, (W * 0.738, H * 0.27), "ป้าใส่ทุกกระทะ", "Pridi-Bold", H * 0.05, "#1f4fa0", W * 0.09)
    side(im, (W * 0.262, H * 0.70), "ไม่ใส่สีสังเคราะห์", "Kanit-Bold", H * 0.045, "#1f4fa0", W * 0.09)
    side(im, (W * 0.738, H * 0.70), "เข้มข้น หอมหอย", "Kanit-Bold", H * 0.045, "#1f4fa0", W * 0.09)
    panel_left(im, (W * 0.015, H * 0.08, W * 0.215, H * 0.82), [
        "ส่วนประกอบ / INGREDIENTS",
        "น้ำตาล, น้ำ, หัวน้ำมันหอยนางรม 24%, เกลือ",
        "แป้งมันสำปะหลังดัดแปร, สีคาราเมล (INS 150c)",
        "วัตถุปรุงแต่งรสอาหาร (INS 621)",
        "วัตถุกันเสีย (INS 211)",
        "ผลิตโดย บจก. ป้าครัวฟู้ดส์ (ปลอม)",
        "เขตบางกะปิด กรุงเทพมหานคร 10999",
        "เขย่าก่อนใช้  •  เปิดแล้วเก็บในตู้เย็น",
        "เลขสารบบอาหาร " + fake_fda(3),
    ], border="#1f4fa0")
    panel_right(im, (W * 0.785, H * 0.08, W * 0.985, H * 0.82), [
        ("หนึ่งหน่วยบริโภค", "1 ช้อนโต๊ะ (15 ก.)"), ("--", ""), ("*พลังงานทั้งหมด", "20 กิโลแคลอรี"),
        ("ไขมันทั้งหมด", "0 ก."), ("โปรตีน", "0 ก."), ("น้ำตาล", "4 ก."), ("*โซเดียม", "640 มก. (27%)")],
        "885334501238", ["ผลิตในประเทศไทย", "PRODUCT OF THAILAND", "ควรบริโภคก่อน: ดูที่ฝา"], border="#1f4fa0",
        accent="#b5121b")
    return im


def soy_common(dark=False):
    im = canvas(21.0, 10.0)
    W, H = im.size
    cx = W / 2
    d = ImageDraw.Draw(im)
    if not dark:
        bg_v(im, [(0, "#ffe94a"), (1, "#f7c815")])
        im.alpha_composite(K.guilloche(W, H, "#2e8b3d", n=14, amp=0.9, freq=3, width=2, alpha=30, seed=2), (0, 0))
        oval_col, ring_col, title_col, sub_col = "#2e8b3d", "#ffffff", "#5b2b0b", "#c8161d"
    else:
        bg_v(im, [(0, "#6d1d10"), (1, "#3a0d06")])
        im.alpha_composite(K.guilloche(W, H, "#ffb02e", n=14, amp=0.9, freq=3, width=2, alpha=26, seed=3), (0, 0))
        oval_col, ring_col, title_col, sub_col = "#e8641c", "#ffd35a", "#ffe14a", "#ffffff"
    d.rectangle([0, 0, W, H * 0.035], fill=K.C("#c8161d"))
    d.rectangle([0, H * 0.965, W, H], fill=K.C("#c8161d"))
    # oval with baby
    ow, oh = W * 0.18, H * 0.58
    ob = [cx - ow / 2, H * 0.245, cx + ow / 2, H * 0.245 + oh]
    d.ellipse([ob[0] - 10, ob[1] - 10, ob[2] + 10, ob[3] + 10], fill=K.C(ring_col))
    d.ellipse(ob, fill=K.C(oval_col))
    g = K.rad_grad(int(ow), int(oh), [(0, "#ffffff55"), (1, "#00000000")], cx=0.45, cy=0.35, rx=0.6)
    lay = Image.new("RGBA", im.size, (0, 0, 0, 0))
    lay.paste(g, (int(ob[0]), int(ob[1])))
    baby = art.baby_face(int(ow * 1.0))
    lay.alpha_composite(baby, (int(cx - baby.width / 2), int(ob[1] + oh * 0.12)))
    K.paint_mask(im, K.ellipse_mask(im.size, ob), lay)
    # titles
    title = "ซีอิ๊วดำหวาน" if dark else "ซีอิ๊วขาว สูตร ๑"
    K.text(im, (cx, H * 0.13), title, K.F("Chonburi-Regular", H * 0.10), title_col, stroke=3,
           stroke_fill="#ffffff" if not dark else "#2a0904")
    lx_ = W * 0.315
    side(im, (lx_, H * 0.36), "ตรา", "Kanit-Bold", H * 0.05, sub_col, W * 0.16)
    side(im, (lx_, H * 0.48), "เด็กอิ่ม", "Chonburi-Regular", H * 0.12, "#c8161d" if not dark else "#ffe14a",
         W * 0.17, stroke=4, stroke_fill="#ffffff" if not dark else "#2a0904")
    side(im, (lx_, H * 0.60), "DEK-IM BRAND", "Kanit-Bold", H * 0.045, sub_col, W * 0.16)
    eng = "SWEET DARK SOY SAUCE" if dark else "THIN SOY SAUCE FORMULA 1"
    K.text(im, (cx, H * 0.93), eng, K.F("Kanit-Bold", H * 0.045), "#ffffff" if dark else "#5b2b0b")
    # right badges
    for i, (t1, t2, col) in enumerate([("หมักธรรมชาติ", "๑๒๐ วัน", "#c8161d"), ("ถูกหลัก", "อนามัย", "#2e8b3d")]):
        bx = W * (0.655 + i * 0.075)
        by = H * (0.40 + i * 0.22)
        r = H * 0.105
        d.ellipse([bx - r - 5, by - r - 5, bx + r + 5, by + r + 5], fill=K.C("#ffffff"))
        d.ellipse([bx - r, by - r, bx + r, by + r], fill=K.C(col))
        K.text(im, (bx, by - r * 0.25), t1, K.fit(t1, "Kanit-Bold", r * 1.7, None, H * 0.04), "#ffffff")
        K.text(im, (bx, by + r * 0.3), t2, K.fit(t2, "Kanit-Black", r * 1.5, None, H * 0.06), "#ffe14a")
    side(im, (lx_, H * 0.76), "ปริมาตรสุทธิ " + ("950 ก." if dark else "700 มล."), "Kanit-Bold", H * 0.05,
         "#ffffff" if dark else "#5b2b0b", W * 0.16)
    ing = ["ส่วนประกอบ / INGREDIENTS"] + (
        ["น้ำตาลโตนด 60%, ซีอิ๊วหมัก 35%, เกลือ", "กากน้ำตาล, วัตถุกันเสีย (INS 211)",
         "เหมาะสำหรับ: ผัดซีอิ๊ว ราดหน้า ข้าวขาหมู"] if dark else
        ["ถั่วเหลือง 45%, น้ำ, เกลือ, น้ำตาล", "แป้งสาลี, วัตถุกันเสีย (INS 211)",
         "เหมาะสำหรับ: ผัด ต้ม จิ้ม หมักเนื้อสัตว์"]) + [
        "ผลิตโดย บจก. เด็กอิ่มฟู้ด (ปลอม)", "ซ.อิ่มใจ เขตบางพลัด-หลง กทม. 10999",
        "เก็บในที่ร่ม ไม่โดนแสงแดด", "เลขสารบบอาหาร " + fake_fda(4 if dark else 5)]
    panel_left(im, (W * 0.015, H * 0.10, W * 0.215, H * 0.90), ing, border="#c8161d")
    panel_right(im, (W * 0.785, H * 0.10, W * 0.985, H * 0.90), [
        ("หนึ่งหน่วยบริโภค", "1 ช้อนโต๊ะ (15 มล.)"), ("--", ""),
        ("*พลังงานทั้งหมด", "45 กิโลแคลอรี" if dark else "10 กิโลแคลอรี"), ("ไขมันทั้งหมด", "0 ก."),
        ("โปรตีน", "1 ก." if dark else "2 ก."), ("น้ำตาล", "10 ก." if dark else "1 ก."),
        ("*โซเดียม", "560 มก. (23%)" if dark else "950 มก. (40%)")],
        "88544560" + ("1014" if dark else "1007"), ["ผลิตในประเทศไทย", "PRODUCT OF THAILAND",
                                                    "ควรบริโภคก่อน: ดูที่คอขวด"], border="#c8161d")
    return im


@label("light_soy_dek_im", product="ซีอิ๊วขาว สูตร 1 (Light/thin soy sauce)", brand_th="เด็กอิ่ม",
       brand_en="DEK-IM", evokes="Healthy Boy thin soy sauce formula 1 (ซีอิ๊วขาวตราเด็กสมบูรณ์)",
       package="glass bottle 700 ml, wrap label", real_dims_cm={"bottle_h": 27.0, "bottle_d": 7.0,
                                                                  "label_w": 21.0, "label_h": 10.0},
       cap="yellow/white plastic screw cap (#f2d22e)", worn=True)
def light_soy():
    return soy_common(False)


@label("dark_soy_dek_im", product="ซีอิ๊วดำหวาน (Sweet dark soy sauce)", brand_th="เด็กอิ่ม", brand_en="DEK-IM",
       evokes="Healthy Boy sweet dark soy sauce (ซีอิ๊วดำหวานตราเด็กสมบูรณ์)",
       package="glass/PET bottle 950 g, wrap label", real_dims_cm={"bottle_h": 25.0, "bottle_d": 7.6,
                                                                    "label_w": 21.0, "label_h": 10.0},
       cap="red plastic cap (#c8161d)", worn=True, worn_kw={"base_col": (40, 18, 8)})
def dark_soy():
    return soy_common(True)


@label("white_pepper_tra_thao", product="พริกไทยขาวป่น (Ground white pepper)", brand_th="ตราเท้าที่ ๑",
       brand_en="FOOT BRAND No.1", evokes="Hand brand ground white pepper (พริกไทยป่นตรามือที่ 1)",
       package="glass shaker jar 60 g, wrap label", real_dims_cm={"jar_h": 10.5, "jar_d": 5.3, "label_w": 16.5,
                                                                   "label_h": 6.0},
       cap="dark green plastic shaker cap (#1d5a3a)", worn=True, worn_kw={"drips": False})
def white_pepper():
    im = canvas(16.5, 6.0)
    W, H = im.size
    cx = W / 2
    bg_v(im, [(0, "#2a7a45"), (1, "#14502a")])
    d = ImageDraw.Draw(im)
    # yellow ornamental centre panel
    pw = W * 0.40
    gold = K.metal(W, H, "gold", seed=11, angle=80)
    K.paint_mask(im, K.poly_mask(im.size, [(cx - pw / 2 - 10, H * 0.06), (cx + pw / 2 + 10, H * 0.06),
                                            (cx + pw / 2 + 10, H * 0.94), (cx - pw / 2 - 10, H * 0.94)]), gold)
    d.rectangle([cx - pw / 2, H * 0.08, cx + pw / 2, H * 0.92], fill=K.C("#ffe466"))
    im.alpha_composite(K.guilloche(int(pw), int(H * 0.84), "#c8161d", n=10, amp=0.9, freq=2.5, width=2, alpha=30),
                       (int(cx - pw / 2), int(H * 0.08)))
    # foot logo in white circle w/ red ring
    r = H * 0.25
    lx, ly = cx - pw * 0.30, H * 0.48
    d.ellipse([lx - r - 8, ly - r - 8, lx + r + 8, ly + r + 8], fill=K.C("#c8161d"))
    d.ellipse([lx - r, ly - r, lx + r, ly + r], fill=K.C("#ffffff"))
    fp = art.footprint(int(r * 1.5))
    im.alpha_composite(fp, (int(lx - fp.width / 2), int(ly - fp.height / 2)))
    K.text(im, (cx + pw * 0.12, H * 0.25), "พริกไทยขาวป่น", K.fit("พริกไทยขาวป่น", "Chonburi-Regular", pw * 0.55,
                                                                    None, H * 0.13), "#c8161d")
    K.text(im, (cx + pw * 0.12, H * 0.47), "ตราเท้าที่ ๑", K.F("Chonburi-Regular", H * 0.12), "#155f2a",
           stroke=2, stroke_fill="#ffffff")
    K.text(im, (cx + pw * 0.12, H * 0.64), "GROUND WHITE PEPPER", K.F("Kanit-Bold", H * 0.058), "#7a2a00")
    K.text(im, (cx + pw * 0.12, H * 0.78), "หอม ฉุน แท้ 100%", K.F("Kanit-Bold", H * 0.07), "#c8161d")
    K.text(im, (cx + pw * 0.12, H * 0.88), "น้ำหนักสุทธิ 60 กรัม", K.F("Kanit-Medium", H * 0.05), "#3a2a00")
    # sides
    for sx in (W * 0.16, W * 0.84):
        K.text(im, (sx, H * 0.18), "พริกไทยขาวป่นแท้", K.F("Pridi-Bold", H * 0.07), "#ffe466")
    panel_left(im, (W * 0.02, H * 0.28, W * 0.29, H * 0.92), [
        "ส่วนประกอบ: พริกไทยขาว 100%", "ผลิตโดย ห้างเท้าทองพริกไทย (ปลอม)", "ถ.ทรงไม่ดำ สัมพันธวงศ์ กทม.",
        "เก็บให้พ้นความชื้น ปิดฝาทุกครั้ง", "เลขสารบบอาหาร " + fake_fda(6)], border="#ffe466", bg="#fffbe8")
    bw = W * 0.18
    bc = K.barcode("885556601020", bw, H * 0.40)
    im.alpha_composite(bc, (int(W * 0.79 - bw / 2), int(H * 0.40)))
    K.text(im, (W * 0.79, H * 0.32), "ผลิตในประเทศไทย", K.F(SMALLB, H * 0.05), "#ffffff")
    K.text(im, (W * 0.79, H * 0.88), "ควรบริโภคก่อน 18/10/71", K.F(SMALL, H * 0.045), "#ffe466")
    return im


@label("chili_flakes_saeb_song", product="พริกป่นคั่ว (Roasted chili flakes)", brand_th="แสบทรวง",
       brand_en="SAEB-SONG", evokes="generic Thai roasted chili flake jar (พริกป่น ร้านก๋วยเตี๋ยว)",
       package="PET jar 100 g, wrap label", real_dims_cm={"jar_h": 9.5, "jar_d": 6.5, "label_w": 20.0, "label_h": 6.5},
       cap="red plastic screw cap (#c8161d)", worn=True, worn_kw={"base_col": (140, 40, 10)})
def chili_flakes():
    im = canvas(20.0, 6.5)
    W, H = im.size
    cx = W / 2
    bg_v(im, [(0, "#2a0a06"), (0.6, "#140403"), (1, "#000000")])
    fl = art.flames(W, int(H * 0.55), seed=3)
    im.alpha_composite(fl, (0, int(H * 0.45)))
    d = ImageDraw.Draw(im)
    K.text(im, (cx, H * 0.26), "พริกป่นคั่ว", K.F("Kanit-Black", H * 0.22), "#ffffff", stroke=6,
           stroke_fill="#c8161d", shadow=(6, 6, 4, "#000000"))
    K.text(im, (cx, H * 0.50), "ตราแสบทรวง", K.F("Chonburi-Regular", H * 0.13), "#ffe14a", stroke=5,
           stroke_fill="#5a0a05")
    K.text(im, (cx, H * 0.66), "เผ็ดจนลืมแฟนเก่า", K.F("Kanit-Bold", H * 0.085), "#ffffff", stroke=3,
           stroke_fill="#5a0a05")
    # heat meter
    for i in range(5):
        c = art.chili(int(H * 0.30), int(H * 0.10), col="#e61e1e", curve=0.2)
        im.alpha_composite(c, (int(cx - H * 0.80 + i * H * 0.32), int(H * 0.77)))
    K.text(im, (cx, H * 0.93), "ระดับความเผ็ด ★★★★★  •  น้ำหนักสุทธิ 100 ก.", K.F("Kanit-Bold", H * 0.05),
           "#ffffff")
    panel_left(im, (W * 0.02, H * 0.10, W * 0.28, H * 0.90), [
        "ส่วนประกอบ: พริกขี้หนูแห้งคั่ว 100%", "ไม่ผสมสี ไม่ใส่วัตถุกันเสีย", "ผลิตโดย ร้านเจ๊แสบ (ปลอม)",
        "ต.ร้อนจัด อ.เหงื่อตก จ.ศรีสะเกษ", "คำเตือน: ห้ามขยี้ตา", "เลขสารบบอาหาร " + fake_fda(7)],
        border="#e61e1e", bg="#fff4e6")
    bw = W * 0.17
    bc = K.barcode("885667702034", bw, H * 0.42)
    im.alpha_composite(bc, (int(W * 0.84 - bw / 2), int(H * 0.40)))
    K.text(im, (W * 0.84, H * 0.20), "คั่วหอม ป่นสด", K.F("Kanit-Bold", H * 0.08), "#ffe14a")
    K.text(im, (W * 0.84, H * 0.31), "ใส่ก๋วยเตี๋ยว ยำ ส้มตำ", K.F("Kanit-Medium", H * 0.05), "#ffffff")
    return im


@label("cooking_oil_oh_luen", product="น้ำมันปาล์มโอเลอีน (Palm olein cooking oil)", brand_th="โอ้ลื่น",
       brand_en="OH-LUEN", evokes="Morakot / Oleen palm oil 1 L bottles (น้ำมันปาล์มมรกต/โอลีน)",
       package="PET bottle 1 L, wrap label", real_dims_cm={"bottle_h": 30.0, "bottle_d": 8.4, "label_w": 25.0,
                                                           "label_h": 11.0},
       cap="green plastic cap (#1d7a3a)", worn=True, worn_kw={"base_col": (170, 130, 40)})
def cooking_oil():
    im = canvas(25.0, 11.0)
    W, H = im.size
    cx = W / 2
    bg_v(im, [(0, "#1a8f42"), (1, "#0b5a28")])
    d = ImageDraw.Draw(im)
    # yellow sun band
    band = K.lin_grad(W, int(H * 0.26), [(0, "#ffe23d"), (1, "#f4b30c")])
    im.alpha_composite(band, (0, int(H * 0.08)))
    d.rectangle([0, H * 0.34, W, H * 0.355], fill=K.C("#ffffff"))
    # brand
    K.text(im, (cx, H * 0.21), "น้ำมันปาล์มโอเลอีน", K.F("Mitr-Bold", H * 0.10), "#0d5a28")
    K.text(im, (cx, H * 0.52), "โอ้ลื่น", K.F("Mitr-Bold", H * 0.22), "#ffffff", stroke=8, stroke_fill="#0b4a20",
           shadow=(6, 8, 6, "#00000080"))
    K.text(im, (cx, H * 0.70), "OH-LUEN PALM OLEIN OIL", K.F("Kanit-Bold", H * 0.05), "#ffe23d")
    pf = art.palm_fruits(int(H * 0.42), int(H * 0.42), seed=4)
    im.alpha_composite(pf, (int(cx + W * 0.09), int(H * 0.38)))
    im.alpha_composite(pf.transpose(Image.FLIP_LEFT_RIGHT), (int(cx - W * 0.09 - pf.width), int(H * 0.38)))
    # claims
    for i, t in enumerate(["ทอดกรอบ ไม่อมน้ำมัน", "ปราศจากโคเลสเตอรอล", "มีวิตามินอี"]):
        K.text(im, (cx, H * (0.79 + i * 0.065)), t, K.F("Kanit-Medium", H * 0.05), "#ffffff")
    K.text(im, (cx + W * 0.17, H * 0.90), "1 ลิตร", K.F("Kanit-Black", H * 0.09), "#ffe23d", stroke=3,
           stroke_fill="#0b4a20")
    panel_left(im, (W * 0.015, H * 0.40, W * 0.225, H * 0.95), [
        "ส่วนประกอบ: น้ำมันปาล์มโอเลอีนบริสุทธิ์ 100%", "สารต้านอนุมูลอิสระ (INS 319)",
        "ผลิตโดย บจก. โอ้ลื่นปาล์มออยล์ (ปลอม)", "อ.ลื่นล้ม จ.ชุมพรวด 86999",
        "ห้ามใช้น้ำมันทอดซ้ำจนดำ", "เลขสารบบอาหาร " + fake_fda(8)], border="#1a8f42")
    panel_right(im, (W * 0.775, H * 0.40, W * 0.985, H * 0.95), [
        ("หนึ่งหน่วยบริโภค", "1 ช้อนโต๊ะ (15 มล.)"), ("--", ""), ("*พลังงานทั้งหมด", "120 กิโลแคลอรี"),
        ("ไขมันทั้งหมด", "14 ก."), ("ไขมันอิ่มตัว", "6 ก."), ("โคเลสเตอรอล", "0 มก."), ("*โซเดียม", "0 มก.")],
        "885778803041", ["ผลิตในประเทศไทย", "PRODUCT OF THAILAND", "ควรบริโภคก่อน: ดูที่ฝา"], border="#1a8f42",
        accent="#0d5a28")
    for sx in (W * 0.12, W * 0.88):
        K.text(im, (sx, H * 0.21), "โอ้ลื่น", K.F("Mitr-Bold", H * 0.1), "#0d5a28")
    return im


@label("vinegar_priao_jeed", product="น้ำส้มสายชูกลั่น 5% (Distilled vinegar)", brand_th="เปรี้ยวจี๊ด",
       brand_en="PRIAO-JEED", evokes="Thai distilled vinegar bottles (น้ำส้มสายชูกลั่น ภูเขาทอง/อสร.)",
       package="PET bottle 700 ml, wrap label", real_dims_cm={"bottle_h": 26.0, "bottle_d": 7.2, "label_w": 22.0,
                                                              "label_h": 8.0}, cap="white plastic cap (#f4f4f4)")
def vinegar():
    im = canvas(22.0, 8.0)
    W, H = im.size
    cx = W / 2
    bg_v(im, [(0, "#ffffff"), (1, "#e8f6fb")])
    d = ImageDraw.Draw(im)
    d.rectangle([0, H * 0.72, W, H], fill=K.C("#1aa3c9"))
    d.rectangle([0, H * 0.70, W, H * 0.72], fill=K.C("#e1251b"))
    # bowl of pickled chili rings (drawn)
    bx, by, br = cx, H * 0.43, H * 0.24
    d.ellipse([bx - br * 1.5, by - br * 0.5, bx + br * 1.5, by + br * 0.5], fill=K.C("#f5f0e0"),
              outline=K.C("#1aa3c9"), width=5)
    rnd = random.Random(5)
    ov = Image.new("RGBA", im.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(ov)
    for i in range(26):
        rx_ = bx + rnd.uniform(-1.25, 1.25) * br
        ry_ = by + rnd.uniform(-0.3, 0.3) * br
        rr = rnd.uniform(0.10, 0.16) * br
        col = rnd.choice(["#e1251b", "#7fb236", "#f2a81d", "#e1251b"])
        od.ellipse([rx_ - rr, ry_ - rr * 0.7, rx_ + rr, ry_ + rr * 0.7], outline=K.C(col), width=max(3, int(rr * 0.4)))
        od.ellipse([rx_ - rr * 0.25, ry_ - rr * 0.2, rx_ + rr * 0.25, ry_ + rr * 0.2], fill=K.C("#fff6c8"))
    im.alpha_composite(ov)
    K.text(im, (cx, H * 0.14), "น้ำส้มสายชูกลั่น 5%", K.F("Chonburi-Regular", H * 0.11), "#1a6f93")
    K.text(im, (cx, H * 0.80), "ตราเปรี้ยวจี๊ด", K.F("Chonburi-Regular", H * 0.11), "#ffffff", stroke=4,
           stroke_fill="#e1251b")
    K.text(im, (cx, H * 0.93), "DISTILLED VINEGAR 5%  •  700 มล.", K.F("Kanit-Bold", H * 0.045), "#ffffff")
    K.text(im, (cx - W * 0.17, H * 0.40), "หมักจากธรรมชาติ", K.F("Pridi-Bold", H * 0.06), "#e1251b")
    K.text(im, (cx - W * 0.17, H * 0.50), "ไม่ใช่กรดน้ำส้มเข้มข้น", K.F("Pridi-Bold", H * 0.045), "#1a6f93")
    K.text(im, (cx + W * 0.17, H * 0.40), "ดองพริก ใส่ก๋วยเตี๋ยว", K.F("Pridi-Bold", H * 0.06), "#e1251b")
    K.text(im, (cx + W * 0.17, H * 0.50), "เปรี้ยวจี๊ดถึงใจ", K.F("Pridi-Bold", H * 0.045), "#1a6f93")
    panel_left(im, (W * 0.015, H * 0.08, W * 0.23, H * 0.66), [
        "ส่วนประกอบ: น้ำส้มสายชูหมักกลั่น 5%, น้ำ", "ผลิตโดย บจก. เปรี้ยวจี๊ดอุตสาหกรรม (ปลอม)",
        "นิคมฯ ลาดกระบังงา กทม.", "เลขสารบบอาหาร " + fake_fda(9)], border="#1aa3c9")
    bw = W * 0.14
    bc = K.barcode("885889904058", bw, H * 0.34)
    im.alpha_composite(bc, (int(W * 0.88 - bw / 2), int(H * 0.30)))
    K.text(im, (W * 0.88, H * 0.18), "ผลิตในประเทศไทย", K.F(SMALLB, H * 0.04), "#1a6f93")
    return im


# =====================================================================================================
@label("sugar_bag_mit_plaat", product="น้ำตาลทรายขาว 1 กก. (White sugar bag)", brand_th="มิตรพลาด",
       brand_en="MIT PLAAT", evokes="Mitr Phol refined sugar 1 kg bag (น้ำตาลทรายมิตรผล)",
       package="clear PE pillow bag 1 kg, front print (transparent window = see the sugar)",
       real_dims_cm={"bag_w": 16.0, "bag_h": 26.0}, cap="none (heat-sealed bag)", alpha=True, out_w=640,
       worn=True, worn_kw={"drips": False, "edge": False, "base_col": (150, 120, 60), "strength": 0.55})
def sugar_bag():
    im = Image.new("RGBA", (1280, 2080), (0, 0, 0, 0))
    W, H = im.size
    d = ImageDraw.Draw(im)
    white = (255, 255, 255, 245)
    # printed areas: top block, bottom block; middle = clear window with frame
    d.rectangle([0, 0, W, H * 0.30], fill=white)
    d.rectangle([0, H * 0.78, W, H], fill=white)
    d.rectangle([0, H * 0.30, W * 0.10, H * 0.78], fill=white)
    d.rectangle([W * 0.62, H * 0.30, W, H * 0.78], fill=white)
    # blue square logo
    lx, ly, ls = W * 0.07, H * 0.035, W * 0.20
    d.rounded_rectangle([lx, ly, lx + ls, ly + ls], radius=ls * 0.12, fill=K.C("#1f5fae"))
    for i in range(3):
        for j in range(3 - i):
            cx_ = lx + ls * (0.22 + j * 0.22 + i * 0.11)
            cy_ = ly + ls * (0.72 - i * 0.2)
            d.rectangle([cx_ - ls * 0.09, cy_ - ls * 0.09, cx_ + ls * 0.09, cy_ + ls * 0.09], fill=K.C("#ffffff"))
    K.text(im, (lx + ls + W * 0.04, ly + ls * 0.38), "มิตรพลาด", K.F("Kanit-Bold", W * 0.10), "#1f5fae", anchor="lm")
    K.text(im, (lx + ls + W * 0.04, ly + ls * 0.80), "Mit Plaat", K.F("Kanit-Medium", W * 0.05), "#1f5fae",
           anchor="lm")
    K.text(im, (W * 0.07, H * 0.185), "SUPER", K.F("Kanit-Black", W * 0.10), "#1f5fae", anchor="lm")
    K.text(im, (W * 0.07, H * 0.232), "REFINED SUGAR", K.F("Kanit-Black", W * 0.075), "#1f5fae", anchor="lm")
    K.text(im, (W * 0.07, H * 0.275), "น้ำตาลทรายขาวบริสุทธิ์", K.F("Kanit-Medium", W * 0.05), "#5a8fd1", anchor="lm")
    bx, by, br = W * 0.82, H * 0.20, W * 0.11
    d.ellipse([bx - br, by - br, bx + br, by + br], fill=K.C("#2e7d32"))
    K.text(im, (bx, by - br * 0.25), "จากอ้อย", K.F("Kanit-Bold", br * 0.36), "#ffffff")
    K.text(im, (bx, by + br * 0.28), "100%", K.F("Kanit-Black", br * 0.5), "#ffffff")
    # window frame
    d.rounded_rectangle([W * 0.10, H * 0.30, W * 0.62, H * 0.78], radius=40, outline=K.C("#1f5fae"), width=6)
    K.text(im, (W * 0.36, H * 0.33), "มองเห็นน้ำตาลจริง", K.F("Kanit-Medium", W * 0.035), "#1f5fae")
    sc = art.sugarcane(int(W * 0.40), int(H * 0.50), seed=3)
    im.alpha_composite(sc, (int(W * 0.60), int(H * 0.28)))
    # bottom block
    d.rectangle([0, H * 0.78, W, H * 0.80], fill=K.C("#1f5fae"))
    K.text(im, (W * 0.07, H * 0.84), "น้ำตาลทรายขาว", K.F("Kanit-Bold", W * 0.075), "#1f5fae", anchor="lm")
    K.text(im, (W * 0.07, H * 0.885), "หวานพลาดทุกที ไม่ได้ตั้งใจ", K.F("Kanit-Medium", W * 0.042), "#5a8fd1",
           anchor="lm")
    K.text(im, (W * 0.93, H * 0.84), "1 กก.", K.F("Kanit-Black", W * 0.11), "#1f5fae", anchor="rm")
    K.text(im, (W * 0.93, H * 0.885), "NET WT 1 kg", K.F("Kanit-Medium", W * 0.04), "#1f5fae", anchor="rm")
    bc = K.barcode("885991001007", W * 0.30, W * 0.17)
    im.alpha_composite(bc, (int(W * 0.66), int(H * 0.905)))
    info_panel(im, (W * 0.07, H * 0.91, W * 0.62, H * 0.99), [
        "ส่วนประกอบ: น้ำตาลทรายขาวบริสุทธิ์ 99.8%", "ผลิตโดย บจก. น้ำตาลมิตรพลาด (ปลอม) จ.สุพรรณบุหรี่",
        "เลขสารบบอาหาร " + fake_fda(10)], col="#1f5fae")
    return im


@label("msg_bag_aroi_dee_moto", product="ผงชูรส 500 ก. (MSG bag)", brand_th="อร่อยดีโมโตะ",
       brand_en="AROI-DEE-MOTO", evokes="Ajinomoto MSG pouch (ผงชูรสอายิโนะโมะโต๊ะ ตราถ้วยแดง)",
       package="printed PE pouch 500 g, front print", real_dims_cm={"bag_w": 15.0, "bag_h": 23.0},
       cap="none (heat-sealed)", out_w=640, worn=True, worn_kw={"drips": False, "base_col": (160, 130, 80),
                                                                 "strength": 0.6})
def msg_bag():
    im = canvas(15.0, 23.0, px_w=1280)
    W, H = im.size
    bg_v(im, [(0, "#ffffff"), (1, "#f1f1ee")])
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, H * 0.035], fill=K.C("#d4161c"))
    d.rectangle([0, H * 0.88, W, H], fill=K.C("#1b3f93"))
    d.rectangle([0, H * 0.87, W, H * 0.88], fill=K.C("#d4161c"))
    K.text(im, (W * 0.5, H * 0.075), "อร่อยแท้ ต้องดีโมโตะ", K.F("Kanit-Medium", W * 0.05), "#1b3f93")
    bl = art.bowl_logo(int(W * 0.46))
    im.alpha_composite(bl, (int(W * 0.27), int(H * 0.10)))
    K.text(im, (W * 0.5, H * 0.42), "อร่อยดีโมโตะ", K.F("Kanit-Black", W * 0.135), "#d4161c", stroke=4,
           stroke_fill="#ffffff", shadow=(4, 5, 3, "#00000040"))
    K.text(im, (W * 0.5, H * 0.49), "AROI-DEE-MOTO", K.F("Kanit-Bold", W * 0.065), "#d4161c")
    rb = (W * 0.18, H * 0.53, W * 0.82, H * 0.60)
    K.ribbon(im, rb, "#d4161c", fold="#7d0a0d")
    K.text(im, (W * 0.5, (rb[1] + rb[3]) / 2), "ผงชูรส", K.F("Kanit-Black", W * 0.085), "#ffffff")
    K.text(im, (W * 0.5, H * 0.645), "ตราชามแดง", K.F("Chonburi-Regular", W * 0.075), "#1b3f93")
    K.text(im, (W * 0.5, H * 0.70), "โมโนโซเดียมกลูตาเมต 99%", K.F("Kanit-Medium", W * 0.05), "#333333")
    sl = art.seal(int(W * 0.28), "ขายดี", "อันดับ ๑", "ในซอยนี้", col="#d4161c", seed=6)
    im.alpha_composite(sl, (int(W * 0.66), int(H * 0.73)))
    K.text(im, (W * 0.08, H * 0.76), "น้ำหนักสุทธิ", K.F("Kanit-Medium", W * 0.05), "#1b3f93", anchor="lm")
    K.text(im, (W * 0.08, H * 0.815), "500 กรัม", K.F("Kanit-Black", W * 0.10), "#1b3f93", anchor="lm")
    bc = K.barcode("885992002013", W * 0.34, W * 0.16)
    im.alpha_composite(bc, (int(W * 0.60), int(H * 0.895)))
    info_panel(im, (W * 0.06, H * 0.895, W * 0.56, H * 0.985), [
        "ใช้ปรุงรสอาหาร ครั้งละไม่เกิน ½ ช้อนชา", "ผลิตโดย บจก. ดีโมโตะ (ไทยแลนด์) ปลอม",
        "เลขสารบบอาหาร " + fake_fda(11)], col="#ffffff", bold_first=False)
    return im


@label("lpg_decal_unicorn_gas", product="ก๊าซหุงต้ม LPG 15 กก. decal sheet", brand_th="ยูนิคอร์นแก๊ส",
       brand_en="UNICORN GAS", evokes="Thai LPG cylinder brands (ยูนิคแก๊ส / เวิลด์แก๊ส / ปตท.) painted logos",
       package="decal sheet for a 15 kg LPG cylinder (paint body teal #1f8f8a)",
       real_dims_cm={"cylinder_h": 59.0, "cylinder_d": 30.0}, cap="brass valve + red/black regulator",
       alpha=True, regions={"body_logo": [0, 0, 1, 0.56], "warning_sticker": [0.02, 0.58, 0.62, 0.98],
                            "tare_seal": [0.66, 0.6, 0.98, 0.94]})
def lpg_decal():
    im = Image.new("RGBA", (2048, 2048), (0, 0, 0, 0))
    W, H = im.size
    d = ImageDraw.Draw(im)
    # body logo (white stencil paint)
    cx, cy, r = W * 0.22, H * 0.27, H * 0.19
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=K.C("#ffffff"), width=26)
    uh = art.unicorn_head(int(r * 1.5))
    im.alpha_composite(uh, (int(cx - uh.width / 2), int(cy - uh.height / 2)))
    side(im, (W * 0.70, H * 0.20), "ยูนิคอร์นแก๊ส", "Kanit-Black", H * 0.10, "#ffffff", W * 0.54)
    side(im, (W * 0.70, H * 0.31), "UNICORN GAS", "Kanit-Bold", H * 0.07, "#ffffff", W * 0.5)
    side(im, (W * 0.70, H * 0.40), "ก๊าซหุงต้ม  •  15 กก.", "Kanit-Bold", H * 0.05, "#ffffff", W * 0.5)
    side(im, (W * 0.70, H * 0.47), "โทรสั่ง 1-333-ยูนิ", "Kanit-Bold", H * 0.045, "#ffffff", W * 0.5)
    # warning sticker
    sx0, sy0, sx1, sy1 = W * 0.02, H * 0.58, W * 0.62, H * 0.98
    d.rounded_rectangle([sx0, sy0, sx1, sy1], radius=30, fill=K.C("#ffd21f"), outline=K.C("#111111"), width=8)
    d.rectangle([sx0 + 8, sy0 + 8, sx1 - 8, sy0 + (sy1 - sy0) * 0.2], fill=K.C("#d4161c"))
    K.text(im, ((sx0 + sx1) / 2, sy0 + (sy1 - sy0) * 0.11), "อันตราย  ก๊าซไวไฟ", K.F("Kanit-Black", H * 0.05),
           "#ffffff")
    # flammable diamond pictogram
    dx, dy, ds = sx0 + (sx1 - sx0) * 0.17, sy0 + (sy1 - sy0) * 0.58, (sy1 - sy0) * 0.30
    d.polygon([(dx, dy - ds), (dx + ds, dy), (dx, dy + ds), (dx - ds, dy)], fill=K.C("#ffffff"),
              outline=K.C("#d4161c"))
    d.polygon([(dx, dy - ds * 0.86), (dx + ds * 0.86, dy), (dx, dy + ds * 0.86), (dx - ds * 0.86, dy)],
              fill=K.C("#ffffff"))
    for k in range(4):
        d.line([(dx, dy - ds + k), (dx + ds - k, dy), (dx, dy + ds - k), (dx - ds + k, dy), (dx, dy - ds + k)],
               fill=K.C("#d4161c"), width=10)
    fl = art.flames(int(ds * 0.9), int(ds * 0.8), seed=2, cols=("#111111", "#111111", "#111111", "#111111"))
    im.alpha_composite(fl, (int(dx - fl.width / 2), int(dy - fl.height * 0.6)))
    d.rectangle([dx - ds * 0.4, dy + ds * 0.25, dx + ds * 0.4, dy + ds * 0.32], fill=K.C("#111111"))
    lines = ["• ห้ามวางใกล้เปลวไฟหรือความร้อน", "• ตั้งถังในแนวตั้งเสมอ ห้ามกลิ้ง/ห้ามนอน",
             "• ปิดวาล์วทุกครั้งหลังใช้งาน", "• ได้กลิ่นแก๊ส ห้ามจุดไฟ ห้ามกดสวิตช์ไฟ",
             "• ตรวจสายแก๊สด้วยน้ำสบู่ทุกเดือน", "แจ้งเหตุแก๊สรั่ว 24 ชม. โทร 1-333-ยูนิ"]
    info_panel(im, (sx0 + (sx1 - sx0) * 0.36, sy0 + (sy1 - sy0) * 0.26, sx1 - 30, sy1 - 20), lines,
               col="#111111", bold_first=False, fname="Kanit-Medium")
    # tare / standard seal
    tx, ty, tr = W * 0.82, H * 0.77, H * 0.16
    d.ellipse([tx - tr, ty - tr, tx + tr, ty + tr], fill=K.C("#ffffff"), outline=K.C("#1f4fa0"), width=10)
    d.ellipse([tx - tr * 0.82, ty - tr * 0.82, tx + tr * 0.82, ty + tr * 0.82], outline=K.C("#1f4fa0"), width=4)
    K.arc_text(im, (tx, ty), tr * 0.91, "ถังได้มาตรฐาน ตรวจสภาพแล้ว", K.F("Kanit-Bold", tr * 0.13), "#1f4fa0",
               start_deg=-90)
    K.text(im, (tx, ty - tr * 0.22), "TW 13.6 kg", K.F("Kanit-Black", tr * 0.22), "#1f4fa0")
    K.text(im, (tx, ty + tr * 0.10), "ก๊าซ 15 kg", K.F("Kanit-Bold", tr * 0.2), "#d4161c")
    K.text(im, (tx, ty + tr * 0.38), "ตรวจ 10/2569", K.F("Kanit-Medium", tr * 0.15), "#1f4fa0")
    return im


@label("water_bottle_jai_yen", product="น้ำดื่ม 600 มล. (Drinking water)", brand_th="ใจเย็น",
       brand_en="JAI YEN", evokes="Crystal / Singha / Nestlé drinking water 600 ml (น้ำดื่มคริสตัล)",
       package="PET bottle 600 ml, film wrap label", real_dims_cm={"bottle_h": 22.0, "bottle_d": 6.5,
                                                                    "label_w": 21.0, "label_h": 5.5},
       cap="light blue plastic cap (#5ab4e5)")
def water_bottle():
    im = canvas(21.0, 5.5)
    W, H = im.size
    bg_v(im, [(0, "#0a63b8"), (0.6, "#1490dc"), (1, "#5cc3f2")])
    d = ImageDraw.Draw(im)
    # white wave
    pts = [(x, H * (0.70 + 0.08 * math.sin(x / W * math.pi * 4))) for x in range(0, W + 8, 8)]
    d.polygon(pts + [(W, H), (0, H)], fill=K.C("#ffffff"))
    pts2 = [(x, H * (0.66 + 0.07 * math.sin(x / W * math.pi * 4 + 0.8))) for x in range(0, W + 8, 8)]
    d.line(pts2, fill=K.C("#9be0ff"), width=6)
    # drops
    rnd = random.Random(4)
    ov = Image.new("RGBA", im.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(ov)
    for _ in range(70):
        x, y, r = rnd.uniform(0, W), rnd.uniform(0, H * 0.6), rnd.uniform(4, 16)
        od.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, rnd.randint(40, 110)))
        od.ellipse([x - r * 0.4, y - r * 0.6, x - r * 0.05, y - r * 0.2], fill=(255, 255, 255, 200))
    im.alpha_composite(ov)
    mt = art.mountain(int(W * 0.16), int(H * 0.6), "silver", seed=12, sun=False)
    im.alpha_composite(mt, (int(W * 0.30), int(H * 0.12)))
    for cx in (W * 0.5,):
        K.text(im, (cx, H * 0.20), "น้ำดื่ม", K.F("Mitr-Bold", H * 0.14), "#ffffff")
        K.text(im, (cx, H * 0.46), "ใจเย็น", K.F("Mitr-Bold", H * 0.30), "#ffffff", stroke=6, stroke_fill="#0a4f96",
               shadow=(4, 5, 4, "#00000060"))
        K.text(im, (cx, H * 0.80), "JAI YEN DRINKING WATER", K.F("Kanit-Bold", H * 0.08), "#0a63b8")
        K.text(im, (cx, H * 0.92), "ผ่านกระบวนการ RO • UV • โอโซน", K.F("Kanit-Medium", H * 0.065), "#0a63b8")
    K.text(im, (W * 0.70, H * 0.38), "600", K.F("Kanit-Black", H * 0.24), "#ffffff")
    K.text(im, (W * 0.70, H * 0.58), "มล.", K.F("Kanit-Bold", H * 0.10), "#ffffff")
    info_panel(im, (W * 0.03, H * 0.08, W * 0.25, H * 0.62), [
        "น้ำดื่มตราใจเย็น เย็นใจทุกหยด", "ผลิตโดย บจก. ใจเย็นวอเตอร์ (ปลอม)", "ต.น้ำใส อ.ใจดี จ.ปทุมทานี",
        "เลขสารบบอาหาร " + fake_fda(12), "ห้ามนำขวดมาใส่น้ำมันเชื้อเพลิง"], col="#ffffff")
    bc = K.barcode("885993003020", W * 0.13, H * 0.42)
    im.alpha_composite(bc, (int(W * 0.84), int(H * 0.10)))
    K.text(im, (W * 0.905, H * 0.62), "ดื่มก่อน 19/10/70", K.F(SMALLB, H * 0.06), "#ffffff")
    return im


def fizzy_dots(im, box, seed=0, n=120, col=(255, 255, 255)):
    rnd = random.Random(seed)
    ov = Image.new("RGBA", im.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(ov)
    x0, y0, x1, y1 = box
    for _ in range(n):
        x, y = rnd.uniform(x0, x1), rnd.uniform(y0, y1)
        r = rnd.uniform(3, 14)
        od.ellipse([x - r, y - r, x + r, y + r], outline=col + (rnd.randint(60, 160),), width=2)
    im.alpha_composite(ov)


@label("cola_can_saa", product="น้ำอัดลม โคล่า 325 มล. (Cola can)", brand_th="ซ่าส์", brand_en="SAA COLA",
       evokes="Coca-Cola / est Cola cans (red cola)", package="aluminium can 325 ml, full can wrap",
       real_dims_cm={"can_h": 11.5, "can_d": 6.6, "label_w": 20.8, "label_h": 11.5}, cap="aluminium pull-tab top")
def cola_can():
    im = canvas(20.8, 11.5)
    W, H = im.size
    bg_v(im, [(0, "#b00b14"), (0.5, "#e01722"), (1, "#a0070f")])
    d = ImageDraw.Draw(im)
    for k, (amp, ph, col, wd) in enumerate([(0.10, 0.0, "#ffffff", 60), (0.08, 0.6, "#ffffff", 14)]):
        pts = [(x, H * (0.62 + amp * math.sin(x / W * math.pi * 2 + ph))) for x in range(0, W + 8, 8)]
        d.line(pts, fill=K.C(col), width=wd)
    fizzy_dots(im, (0, 0, W, H * 0.5), seed=3)
    for cx in (W * 0.27, W * 0.77):
        K.text(im, (cx, H * 0.34), "ซ่าส์", K.F("Pattaya-Regular", H * 0.34), "#ffffff", shadow=(5, 6, 4, "#5a0006"))
        K.text(im, (cx, H * 0.52), "C O L A", K.F("Kanit-Black", H * 0.09), "#ffffff")
    K.text(im, (W * 0.52, H * 0.12), "ซ่าสะใจ ดับร้อนทุกซอย", K.F("Kanit-Bold", H * 0.05), "#ffffff")
    K.text(im, (W * 0.24, H * 0.82), "รสชาติต้นตำรับ", K.F("Kanit-Bold", H * 0.06), "#ffffff")
    K.text(im, (W * 0.24, H * 0.90), "325 มล.", K.F("Kanit-Black", H * 0.07), "#ffffff")
    rrect_bg(im, (W * 0.52, H * 0.70, W * 0.72, H * 0.97), "#ffffff", 255, r=12)
    info_panel(im, (W * 0.53, H * 0.72, W * 0.71, H * 0.95), [
        "น้ำอัดลมกลิ่นโคล่า", "น้ำ, น้ำตาล 9%, คาร์บอนไดออกไซด์", "สีคาราเมล, กรดฟอสฟอริก, คาเฟอีน",
        "ผลิตโดย บจก. ซ่าส์เบฟเวอเรจ (ปลอม)", "เลขสารบบอาหาร " + fake_fda(13)])
    gd = K.gda_strip(W * 0.17, H * 0.22, (("พลังงาน", "130", "กิโลแคลอรี"), ("น้ำตาล", "33", "กรัม"),
                                         ("ไขมัน", "0", "กรัม"), ("โซเดียม", "20", "มิลลิกรัม")),
                     title="ต่อ 1 กระป๋อง", fg="#ffffff", bg="#00000000")
    im.alpha_composite(gd, (int(W * 0.79), int(H * 0.72)))
    bc = K.barcode("885994004037", W * 0.11, H * 0.24)
    im.alpha_composite(bc, (int(W * 0.395), int(H * 0.72)))
    return im


def fan_kao(flavor):
    """Shared layout for the แฟนเก่า soda family."""
    conf = {
        "orange": ("#ff8a00", "#e95c00", "กลิ่นส้ม", "ORANGE", "orange_slice"),
        "red": ("#e0142d", "#9e0718", "น้ำแดง กลิ่นสตรอว์เบอร์รี่", "STRAWBERRY", "strawberry"),
        "green": ("#33b54a", "#147a2c", "น้ำเขียว กลิ่นครีมโซดา", "CREAM SODA", None),
    }[flavor]
    c1, c2, th, en, fruit = conf
    im = canvas(20.8, 11.5) if flavor == "orange" else canvas(22.0, 9.0)
    W, H = im.size
    im.alpha_composite(K.rad_grad(W, H, [(0, c1), (1, c2)], cx=0.5, cy=0.45, rx=0.6), (0, 0))
    fizzy_dots(im, (0, 0, W, H), seed=7, n=160)
    for cx in (W * 0.27, W * 0.77):
        # blue leaf-shaped badge
        bw, bh = W * 0.20, H * 0.34
        badge = Image.new("RGBA", im.size, (0, 0, 0, 0))
        bd = ImageDraw.Draw(badge)
        bd.rounded_rectangle([cx - bw / 2, H * 0.14, cx + bw / 2, H * 0.14 + bh], radius=bh * 0.45,
                             fill=K.C("#1d3f9e"), outline=K.C("#ffffff"), width=8)
        bd.polygon([(cx + bw * 0.22, H * 0.17), (cx + bw * 0.30, H * 0.07), (cx + bw * 0.50, H * 0.05),
                    (cx + bw * 0.44, H * 0.14), (cx + bw * 0.34, H * 0.20)], fill=K.C("#3fb34f"),
                   outline=K.C("#ffffff"))
        im.alpha_composite(badge.rotate(6, center=(cx, H * 0.3), resample=Image.BICUBIC))
        K.text(im, (cx, H * 0.30), "แฟนเก่า", K.F("Kanit-Black", H * 0.13), "#ffffff", stroke=5,
               stroke_fill="#0b1f55", rotate=6)
        K.text(im, (cx, H * 0.58), th, K.fit(th, "Kanit-Black", W * 0.22, None, H * 0.075), "#ffffff", stroke=4,
               stroke_fill=c2)
        K.text(im, (cx, H * 0.67), en, K.F("Kanit-Bold", H * 0.05), "#ffffff")
    if fruit == "orange_slice":
        for (fx, fy, fs) in [(0.47, 0.70, 0.30), (0.56, 0.78, 0.22), (0.97, 0.75, 0.28)]:
            o = art.orange_slice(int(H * fs), seed=int(fx * 100))
            im.alpha_composite(o, (int(W * fx - o.width / 2), int(H * fy - o.height / 2)))
    elif fruit == "strawberry":
        for (fx, fy, fs) in [(0.47, 0.72, 0.28), (0.55, 0.80, 0.2), (0.97, 0.76, 0.26)]:
            o = art.strawberry(int(H * fs), seed=int(fx * 100))
            im.alpha_composite(o, (int(W * fx - o.width / 2), int(H * fy - o.height / 2)))
    else:
        ov = Image.new("RGBA", im.size, (0, 0, 0, 0))
        od = ImageDraw.Draw(ov)
        rnd = random.Random(2)
        for _ in range(40):
            x, y, r = rnd.uniform(0.40, 0.62) * W, rnd.uniform(0.55, 0.95) * H, rnd.uniform(8, 30)
            od.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, 70), outline=(255, 255, 255, 180), width=3)
        im.alpha_composite(ov)
    K.text(im, (W * 0.52, H * 0.10), "หวานเหมือนแฟนเก่า ซ่าเหมือนวันเลิก", K.F("Kanit-Bold", H * 0.05), "#ffffff")
    rrect_bg(im, (W * 0.03, H * 0.76, W * 0.22, H * 0.97), "#ffffff", 235, r=10)
    info_panel(im, (W * 0.04, H * 0.78, W * 0.21, H * 0.95), [
        "น้ำหวานอัดก๊าซ " + th.split(" ")[-1], "น้ำ, น้ำตาล 10%, CO₂, กรดซิตริก", "แต่งกลิ่นเลียนธรรมชาติ, สีสังเคราะห์",
        "บจก. แฟนเก่าเบฟเวอเรจ (ปลอม)", "เลขสารบบอาหาร " + fake_fda(14)])
    bc = K.barcode("8859950050" + {"orange": "44", "red": "51", "green": "68"}[flavor], W * 0.11, H * 0.2)
    im.alpha_composite(bc, (int(W * 0.66), int(H * 0.78)))
    vol = "325 มล." if flavor == "orange" else "450 มล."
    K.text(im, (W * 0.27, H * 0.76), vol, K.F("Kanit-Black", H * 0.07), "#ffffff", stroke=3, stroke_fill=c2)
    return im


@label("soda_can_fan_kao_orange", product="น้ำอัดลมกลิ่นส้ม 325 มล. (Orange soda can)", brand_th="แฟนเก่า",
       brand_en="FAN-KAO", evokes="Fanta orange can", package="aluminium can 325 ml, full can wrap",
       real_dims_cm={"can_h": 11.5, "can_d": 6.6, "label_w": 20.8, "label_h": 11.5}, cap="aluminium pull-tab top")
def soda_orange():
    return fan_kao("orange")


@label("soda_bottle_fan_kao_red", product="น้ำแดง กลิ่นสตรอว์เบอร์รี่ 450 มล. (Red soda)", brand_th="แฟนเก่า น้ำแดง",
       brand_en="FAN-KAO RED", evokes="Fanta strawberry 'น้ำแดง' bottle", package="PET bottle 450 ml, wrap label",
       real_dims_cm={"bottle_h": 21.0, "bottle_d": 7.0, "label_w": 22.0, "label_h": 9.0}, cap="red plastic cap (#d0102a)")
def soda_red():
    return fan_kao("red")


@label("soda_bottle_fan_kao_green", product="น้ำเขียว กลิ่นครีมโซดา 450 มล. (Green soda)",
       brand_th="แฟนเก่า น้ำเขียว", brand_en="FAN-KAO GREEN", evokes="Fanta green / cream soda 'น้ำเขียว' bottle",
       package="PET bottle 450 ml, wrap label", real_dims_cm={"bottle_h": 21.0, "bottle_d": 7.0, "label_w": 22.0,
                                                              "label_h": 9.0}, cap="green plastic cap (#2fa84a)")
def soda_green():
    return fan_kao("green")


@label("chayen_cup_sticker_tra_mue_thue", product="สติ๊กเกอร์แก้วชาเย็น (Thai iced-tea cup sticker)",
       brand_th="ชาตรามือถือ", brand_en="CHA TRA MUE THUE", evokes="ChaTraMue (ชาตรามือ) Thai tea cup branding",
       package="round sticker for 16-22 oz PP cup", real_dims_cm={"sticker_d": 7.0}, cap="sealed film lid / dome lid",
       alpha=True, out_w=512)
def chayen_sticker():
    S = 1024
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse([4, 4, S - 4, S - 4], fill=K.C("#ffffff"))
    d.ellipse([22, 22, S - 22, S - 22], fill=K.C("#e3501c"))
    d.ellipse([S * 0.2, S * 0.2, S * 0.8, S * 0.8], fill=K.C("#c43a10"))
    hp = art.hand_phone(int(S * 0.46))
    im.alpha_composite(hp, (int(S * 0.27), int(S * 0.20)))
    K.arc_text(im, (S / 2, S / 2), S * 0.40, "ชาตรามือถือ", K.F("Kanit-Black", S * 0.09), "#ffffff", start_deg=-90)
    K.arc_text(im, (S / 2, S / 2), S * 0.40, "CHA TRA MUE THUE", K.F("Kanit-Bold", S * 0.055), "#ffe3c4",
               start_deg=90, clockwise=False)
    K.text(im, (S / 2, S * 0.70), "ชาไทยต้นตำรับ", K.F("Kanit-Bold", S * 0.06), "#ffffff")
    K.text(im, (S / 2, S * 0.76), "สั่งง่าย แค่ยกมือถือ", K.F("Kanit-Medium", S * 0.04), "#ffe3c4")
    return im


@label("whisky_saeng_salua", product="สุราผสม 700 มล. (Thai 'whisky'/rum)", brand_th="แสงสลัว",
       brand_en="SAENG SALUA", evokes="SangSom (แสงโสม) Thai spirit flat bottle", package="flat glass bottle 700 ml, "
       "front label (not wrap) + neck strip at top 18% of image", real_dims_cm={"bottle_h": 24.0, "bottle_w": 10.5,
                                                                              "label_w": 9.0, "label_h": 11.0},
       cap="gold metal screw cap", out_w=640)
def whisky():
    im = canvas(9.0, 11.0, px_w=1280)
    W, H = im.size
    im.alpha_composite(K.rad_grad(W, H, [(0, "#7a1410"), (0.7, "#3d0806"), (1, "#1e0403")], cy=0.45, rx=0.7), (0, 0))
    gold = K.metal(W, H, "gold", seed=21, angle=80)
    d = ImageDraw.Draw(im)
    for inset, wd in [(18, 14), (48, 4), (62, 2)]:
        m = Image.new("L", im.size, 0)
        ImageDraw.Draw(m).rounded_rectangle([inset, inset, W - inset, H - inset], radius=40, outline=255, width=wd)
        K.paint_mask(im, m, gold)
    im.alpha_composite(K.guilloche(W, H, "#e9c867", n=20, amp=0.5, freq=3, width=2, alpha=30, seed=5), (0, 0))
    em = art.lamp_emblem(int(W * 0.42))
    im.alpha_composite(em, (int(W * 0.29), int(H * 0.08)))
    K.text(im, (W / 2, H * 0.47), "แสงสลัว", K.F("Charmonman-Bold", H * 0.13), gold, stroke=3,
           stroke_fill="#2a0503", shadow=(4, 5, 4, "#000000"))
    K.text(im, (W / 2, H * 0.58), "SAENG SALUA", K.F("Trirong-Bold", H * 0.05), "#f2d47a")
    K.text(im, (W / 2, H * 0.64), "SPECIAL THAI SPIRIT", K.F("Trirong-Regular", H * 0.032), "#f2d47a")
    rb = (W * 0.16, H * 0.68, W * 0.84, H * 0.74)
    K.ribbon(im, rb, "#b5121b", fold="#5a0606")
    K.text(im, (W / 2, (rb[1] + rb[3]) / 2), "สุราผสม 40 ดีกรี", K.F("Kanit-Bold", H * 0.035), "#ffe9a8")
    for i, (t1, t2) in enumerate([("เหรียญทอง", "งานวัด ๒๕๔๒"), ("ดื่มแล้ว", "สลัวทุกที")]):
        sl = art.seal(int(W * 0.20), t1, "๑", t2, col="#7a1410", seed=30 + i, txt_col="#ffe9a8")
        im.alpha_composite(sl, (int(W * (0.12 + i * 0.56)), int(H * 0.705)))
    K.text(im, (W / 2, H * 0.80), "700 มล.", K.F("Kanit-Bold", H * 0.04), "#f2d47a")
    info_panel(im, (W * 0.12, H * 0.885, W * 0.88, H * 0.955), [
        "คำเตือน: การดื่มสุราอาจทำให้เป็นโรคตับแข็งและความดันโลหิตสูง",
        "การดื่มสุราทำให้ความสามารถในการขับขี่ลดลง  •  ห้ามจำหน่ายแก่บุคคลอายุต่ำกว่า 20 ปี",
        "ผลิตโดย โรงสุราแสงสลัว (ปลอม) อ.มืดค่ำ จ.ปทุมมัว"], col="#f2d47a", bold_first=True)
    return im


@label("pork_tray_sticker", product="สติ๊กเกอร์ถาดหมูบด (Minced pork tray scale label)", brand_th="ฟาร์มหมูยิ้ม",
       brand_en="MOO YIM FARM", evokes="supermarket weigh-scale price sticker on foam meat trays",
       package="paper sticker on foam tray", real_dims_cm={"sticker_w": 6.0, "sticker_h": 4.0},
       cap="n/a (cling-film tray)", alpha=True, out_w=512)
def pork_sticker():
    im = Image.new("RGBA", (1200, 800), (0, 0, 0, 0))
    W, H = im.size
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([4, 4, W - 4, H - 4], radius=30, fill=K.C("#ffffff"), outline=K.C("#bbbbbb"), width=3)
    d.rounded_rectangle([4, 4, W - 4, H * 0.2], radius=30, fill=K.C("#e8457a"))
    d.rectangle([4, H * 0.12, W - 4, H * 0.2], fill=K.C("#e8457a"))
    K.text(im, (W * 0.05, H * 0.10), "ฟาร์มหมูยิ้ม  •  สดใหม่ทุกวัน", K.F("Kanit-Bold", H * 0.07), "#ffffff", anchor="lm")
    K.text(im, (W * 0.05, H * 0.31), "หมูบด", K.F("Kanit-Black", H * 0.14), "#111111", anchor="lm")
    K.text(im, (W * 0.05, H * 0.43), "MINCED PORK", K.F("Kanit-Bold", H * 0.065), "#111111", anchor="lm")
    rows = [("น้ำหนัก (กก.)", "0.500"), ("ราคา/กก. (บาท)", "129.00"), ("ราคา (บาท)", "64.50")]
    for i, (a, b) in enumerate(rows):
        y = H * (0.55 + i * 0.10)
        K.text(im, (W * 0.05, y), a, K.F("Sarabun-Regular", H * 0.055), "#111111", anchor="lm")
        K.text(im, (W * 0.60, y), b, K.F("Kanit-Black" if i == 2 else "Kanit-Bold", H * (0.085 if i == 2 else 0.06)),
               "#111111", anchor="rm")
    K.text(im, (W * 0.05, H * 0.87), "บรรจุ 19/10/69 06:12  •  ควรบริโภคก่อน 21/10/69", K.F("Sarabun-Regular", H * 0.045),
           "#111111", anchor="lm")
    K.text(im, (W * 0.05, H * 0.93), "เก็บรักษาที่ 0-4 °C", K.F("Sarabun-Bold", H * 0.045), "#e8457a", anchor="lm")
    bc = K.barcode("201234006450", W * 0.33, H * 0.36)
    im.alpha_composite(bc, (int(W * 0.63), int(H * 0.27)))
    d.rounded_rectangle([W * 0.66, H * 0.68, W * 0.94, H * 0.9], radius=18, outline=K.C("#e8457a"), width=6)
    K.text(im, (W * 0.80, H * 0.79), "เนื้อแดงล้วน", K.F("Kanit-Black", H * 0.06), "#e8457a")
    return im


@label("basil_bundle_tag", product="ป้ายรัดกำใบกะเพรา (Holy-basil bundle tag)", brand_th="สวนลุงแหลม",
       brand_en="UNCLE LAEM'S GARDEN", evokes="paper tag / rubber band on market herb bundles",
       package="kraft paper tag with rubber band hole", real_dims_cm={"tag_w": 3.5, "tag_h": 7.0},
       cap="n/a", alpha=True, out_w=256)
def basil_tag():
    im = Image.new("RGBA", (500, 1000), (0, 0, 0, 0))
    W, H = im.size
    tag = K.paper(W, H, "#c9a26b", seed=3)
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).polygon([(W * 0.25, 0), (W * 0.75, 0), (W, H * 0.12), (W, H), (0, H), (0, H * 0.12)], fill=255)
    ImageDraw.Draw(m).ellipse([W * 0.4, H * 0.05, W * 0.6, H * 0.15], fill=0)
    im.paste(tag, (0, 0), m)
    d = ImageDraw.Draw(im)
    d.ellipse([W * 0.38, H * 0.04, W * 0.62, H * 0.16], outline=K.C("#8a6a3a"), width=6)
    K.text(im, (W / 2, H * 0.27), "กะเพรา", K.F("Sriracha-Regular", W * 0.22), "#1f5e22")
    K.text(im, (W / 2, H * 0.38), "ป่าแท้ ปลอดสาร", K.F("Kanit-Bold", W * 0.09), "#3b2a14")
    d.ellipse([W * 0.15, H * 0.45, W * 0.85, H * 0.75], outline=K.C("#2e7d32"), width=8)
    K.text(im, (W / 2, H * 0.55), "สวนลุงแหลม", K.F("Kanit-Black", W * 0.10), "#2e7d32")
    K.text(im, (W / 2, H * 0.65), "อ.บางเลน", K.F("Kanit-Medium", W * 0.07), "#2e7d32")
    K.text(im, (W / 2, H * 0.84), "กำละ 10.-", K.F("Sriracha-Regular", W * 0.16), "#c8161d")
    return im


# =====================================================================================================
def main():
    names = sys.argv[1:] or list(REG)
    man_path = os.path.join(OUT, "manifest.json")
    if os.path.exists(man_path):
        try:
            MANIFEST.update({e["name"]: e for e in json.load(open(man_path, encoding="utf-8"))["labels"]})
        except Exception:  # noqa: BLE001
            pass
    for n in names:
        fn, meta = REG[n]
        im = fn()
        keep_alpha = meta.get("alpha", False)
        files, size = export(im, n, out_w=meta.get("out_w", 1024), keep_alpha=keep_alpha, seed=hash(n) % 1000,
                             worn=meta.get("worn", False), worn_kw=meta.get("worn_kw"))
        entry = {"name": n, "files": files, "size_px": list(size), "alpha": keep_alpha}
        entry.update({k: v for k, v in meta.items() if k not in ("worn", "worn_kw", "out_w", "alpha")})
        MANIFEST[n] = entry
        print("made", n, files, size, flush=True)
    data = {"note": "Parody labels (original designs). Wrap labels: u=0..1 around the container, front panel "
                    "centred at u=0.5 unless noted. *_worn.png = greasy/worn variant.",
            "labels": [MANIFEST[k] for k in sorted(MANIFEST)]}
    json.dump(data, open(man_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
