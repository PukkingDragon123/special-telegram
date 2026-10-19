"""Build the ไทยรั่ว parody tabloid kit -> public/assets/img/newspaper/
Run: python3 -I scripts/research/R4/build_newspaper.py [--fast]
Reads licence-clean photos from references/ui/_raw/photos (see references/credits/R4-culture-ui.md)."""
import sys, os, json, math, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from printfx import *  # noqa
import content_th as C

ROOT = "/home/user/special-telegram"
RAW = ROOT + "/references/ui/_raw/photos/"
OUT = ROOT + "/public/assets/img/newspaper/"
FAST = "--fast" in sys.argv
W, H = 1448, 2048
M = 40
CELL = 4.0

# name -> (file, focus(x,y) for cover crop, licence note)
PHOTOS = {
    "wok_fire": ("flickr_54090994717.jpg", (0.5, 0.45), (0.43, 0.10, 1.0, 0.86)),  # pre-crop: no face
    "kaprao_egg": ("flickr_3369547949.jpg", (0.5, 0.28)),
    "kaprao_egg_closeup": ("flickr_54642751606.jpg", (0.5, 0.5)),
    "soi_dog": ("flickr_2754634061.jpg", (0.5, 0.35)),
    "soi_dog_sitting": ("flickr_5382900339.jpg", (0.5, 0.5)),
    "crowd_foodcourt": ("flickr_55594668736.jpg", (0.5, 0.6), (0.0, 0.0, 0.86, 1.0)),  # pre-crop: hide shop phone no.
    "food_cart": ("flickr_55584958636.jpg", (0.5, 0.5), (0.0, 0.42, 0.93, 1.0)),  # pre-crop: cart only, no face/logo
    "flood_shop": ("flickr_6281220556.jpg", (0.5, 0.5), (0.0, 0.0, 1.0, 0.86)),  # pre-crop: remove watermark
    "flood_night": ("flickr_293603403.jpg", (0.5, 0.5)),
    "traffic_night": ("flickr_55449136652.jpg", (0.5, 0.5)),
    "hippo_baby": ("flickr_5061983744.jpg", (0.45, 0.5)),
    "casino_tables": ("flickr_9396537891_crop.jpg", (0.4, 0.6)),
    "wok_vendor_flames": ("flickr_55013937204.jpg", (0.35, 0.55)),
    "market_garlic": ("flickr_55200584883.jpg", (0.5, 0.5)),
}


def photo(name):
    im = Image.open(RAW + PHOTOS[name][0])
    if len(PHOTOS[name]) > 2 and PHOTOS[name][2]:
        x0, y0, x1, y1 = PHOTOS[name][2]
        w, h = im.size
        im = im.crop((int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h)))
    return im


def focus(name):
    return PHOTOS[name][1]


ADS = ROOT + "/references/ui/_raw/ads/"


def adphoto(name):
    return Image.open(ADS + name + ".jpg")


REG = {}


def reg(name, box, **kw):
    x0, y0, x1, y1 = [int(round(v)) for v in box]
    REG[name] = dict(x=x0, y=y0, w=x1 - x0, h=y1 - y0, **kw)


# ------------------------------------------------------------------ text helpers
def fit_line(P, box, text, font_name, size, cmyk="K", align="l", min_sx=0.62, sx=1.0, valign="m", stroke=0):
    """Draw one line fitted into box (condense horizontally, then shrink)."""
    x0, y0, x1, y1 = box
    bw, bh = x1 - x0, y1 - y0
    s = size
    while True:  # fit the ink height (looped Thai has tall marks above/below)
        f = F(font_name, s)
        l, t, r, b = f.getbbox(text, anchor="la", stroke_width=stroke)
        if (b - t) <= bh or s < 12:
            break
        s = int(s * 0.95)
    while True:
        f = F(font_name, s)
        tw = P.measure(text, f, stroke)[0]
        need = bw / max(1, tw)
        if need >= min_sx or s < 12:
            break
        s = int(s * 0.94)
    scale = min(sx, need)
    x = {"l": x0, "m": (x0 + x1) / 2, "r": x1}[align]
    y = {"m": (y0 + y1) / 2, "t": y0, "b": y1}[valign]
    P.text((x, y), text, F(font_name, s), cmyk, anchor=align + valign, scale_x=scale, stroke=stroke)
    return s, scale


def fit_line_var(P, box, text, wght=900, cmyk="K", align="l", fill=True, family="NotoSansThaiLooped", max_stretch=1.12):
    """Tabloid headline: fit ink height, then pick the variable-font width (wdth 100..62) that fills the
    measure, finishing with a small horizontal scale so the line runs edge to edge."""
    x0, y0, x1, y1 = box
    bw, bh = x1 - x0, y1 - y0
    s = int(bh * 1.25)
    while True:
        f = F(f"{family}@{wght}w100", s)
        l, t, r, b = f.getbbox(text, anchor="la")
        if (b - t) <= bh or s < 12:
            break
        s = int(s * 0.96)
    chosen = None
    for wd in (100, 93, 87, 81, 75, 68, 62):
        f = F(f"{family}@{wght}w{wd}", s)
        tw = P.measure(text, f)[0]
        if tw <= bw:
            chosen = (wd, f, tw)
            break
    if chosen is None:
        f = F(f"{family}@{wght}w62", s)
        chosen = (62, f, P.measure(text, f)[0])
    wd, f, tw = chosen
    sx = bw / tw if fill else min(1.0, bw / tw)
    sx = min(sx, max_stretch)
    x = {"l": x0, "m": (x0 + x1) / 2, "r": x1}[align]
    P.text((x, (y0 + y1) / 2), text, f, cmyk, anchor=align + "m", scale_x=sx)
    return s, wd, sx


def para(P, box, text, font_name, size, lead, cmyk="K", justify=True, first_indent=0):
    x0, y0, x1, y1 = box
    f = F(font_name, size)
    y = y0 + size
    for line, last in wrap_paragraphs(text, f, x1 - x0):
        if y > y1:
            break
        if justify:
            for dx, chunk in justify_tokens(line, f, x1 - x0, last=last):
                P.text((x0 + dx, y), chunk, f, cmyk, anchor="ls")
        else:
            P.text((x0, y), line, f, cmyk, anchor="ls")
        y += lead
    return y


def stars(P, cx, cy, n, r, cmyk="K", filled=5):
    """Printed rating stars (vector)."""
    for i in range(n):
        x = cx + i * r * 2.3
        pts = []
        for k in range(10):
            a = -math.pi / 2 + k * math.pi / 5
            rr = r if k % 2 == 0 else r * 0.45
            pts.append((r * 1.2 + rr * math.cos(a), r * 1.2 + rr * math.sin(a)))
        im = Image.new("L", (int(r * 2.4) + 2, int(r * 2.4) + 2), 0)
        d = ImageDraw.Draw(im)
        if i < filled:
            d.polygon(pts, fill=255)
        else:
            d.polygon(pts, outline=255, width=max(1, int(r * 0.18)))
        P.mask(np.asarray(im, f32) / 255, (x - r * 1.2, cy - r * 1.2), cmyk)


def burst(P, cx, cy, r, n=18, cmyk="yellow", inner=0.78):
    pts = []
    for k in range(n * 2):
        a = k * math.pi / n
        rr = r if k % 2 == 0 else r * inner
        pts.append((r + rr * math.cos(a), r + rr * math.sin(a)))
    im = Image.new("L", (int(2 * r) + 2, int(2 * r) + 2), 0)
    ImageDraw.Draw(im).polygon(pts, fill=255)
    P.mask(np.asarray(im, f32) / 255, (cx - r, cy - r), cmyk)


def frame(P, box, w=2, cmyk="K"):
    x0, y0, x1, y1 = box
    P.rect((x0, y0, x1, y0 + w), cmyk)
    P.rect((x0, y1 - w, x1, y1), cmyk)
    P.rect((x0, y0, x0 + w, y1), cmyk)
    P.rect((x1 - w, y0, x1, y1), cmyk)


def dotted_frame(P, box, cmyk="K", step=8, dot=3):
    x0, y0, x1, y1 = box
    for x in range(int(x0), int(x1), step):
        P.rect((x, y0, x + dot, y0 + 2), cmyk)
        P.rect((x, y1 - 2, x + dot, y1), cmyk)
    for y in range(int(y0), int(y1), step):
        P.rect((x0, y, x0 + 2, y + dot), cmyk)
        P.rect((x1 - 2, y, x1, y + dot), cmyk)


def sun_icon(P, cx, cy, r, cmyk="orange"):
    im = Image.new("L", (int(r * 4), int(r * 4)), 0)
    d = ImageDraw.Draw(im)
    c = r * 2
    d.ellipse((c - r, c - r, c + r, c + r), fill=255)
    for k in range(12):
        a = k * math.pi / 6
        d.line((c + math.cos(a) * r * 1.3, c + math.sin(a) * r * 1.3, c + math.cos(a) * r * 1.85, c + math.sin(a) * r * 1.85),
               fill=255, width=max(2, int(r * 0.22)))
    P.mask(np.asarray(im, f32) / 255, (cx - c, cy - c), cmyk)


def bottle_icon(P, x, y, w, h):
    """Simple engraved-style herbal liquor bottle (printed line art + tint)."""
    im = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(im)
    nw = w * 0.28
    d.rectangle((w / 2 - nw / 2, 0, w / 2 + nw / 2, h * 0.28), fill=255)
    d.rounded_rectangle((w * 0.12, h * 0.25, w * 0.88, h), radius=int(w * 0.18), fill=255)
    P.mask(np.asarray(im, f32) / 255, (x, y), (0.1, 0.55, 0.9, 0.45), contone=True)
    lab = Image.new("L", (w, h), 0)
    ImageDraw.Draw(lab).rectangle((w * 0.2, h * 0.5, w * 0.8, h * 0.82), fill=255)
    P.mask(np.asarray(lab, f32) / 255, (x, y), "white")
    P.text((x + w / 2, y + h * 0.66), "เสือ", F("NotoSansThaiLooped@900w75", int(w * 0.24)), "red", anchor="mm")


def takrut_icon(P, x, y, w, h):
    im = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, h * 0.35, w, h * 0.65), radius=int(h * 0.15), fill=255)
    for k in range(5):
        xx = w * (0.15 + k * 0.17)
        d.line((xx, h * 0.33, xx, h * 0.67), fill=0, width=3)
    d.line((w * 0.5, h * 0.35, w * 0.5, 0), fill=255, width=3)
    P.mask(np.asarray(im, f32) / 255, (x, y), (0.05, 0.3, 0.9, 0.35), contone=True)


def barcode(P, x, y, w, h, seed=7, digits="8 851234 000019"):
    rng = np.random.default_rng(seed)
    xx = x
    bars = []
    while xx < x + w:
        bw = int(rng.integers(1, 4))
        if rng.random() < 0.55:
            bars.append((xx, bw))
        xx += bw + int(rng.integers(1, 3))
    for bx, bw in bars:
        P.rect((bx, y, min(x + w, bx + bw), y + h - 16), "K")
    P.text((x + w / 2, y + h), digits, F("Sarabun-Regular", 14), "K", anchor="ms")


# ------------------------------------------------------------------ page sections
def draw_teasers(P, dyn):
    y0, y1 = 34, 150
    P.rect((M, y0, 196, y1), "red")
    P.text((118, 84), "เด่น", F("NotoSansThaiLooped@900w75", 50), None, anchor="ms")
    P.text((118, 130), "ในฉบับ", F("NotoSansThaiLooped@900w75", 34), None, anchor="ms")
    burst(P, 184, 44, 18, n=10, cmyk="yellow", inner=0.5)
    thumbs = ["traffic_night", "kaprao_egg_closeup", "market_garlic", "food_cart"]
    cw = (W - M - 206 - 3 * 10) / 4
    for i, ((txt, pg), th) in enumerate(zip(C.TEASERS, thumbs)):
        x0 = 206 + i * (cw + 10)
        P.rect((x0, y0, x0 + cw, y1), (0, 0.02, 0.18, 0))  # light yellow tint panel
        P.image((x0 + 6, y0 + 6, x0 + 106, y1 - 6), photo(th), "cmyk", contrast=1.15, focus=focus(th))
        fx0 = x0 + 116
        f = F("NotoSansThaiLooped@800w85", 23)
        lines = wrap_thai(txt, f, cw - 124)
        for k, ln in enumerate(lines[:2]):
            P.text((fx0, y0 + 36 + k * 30), ln, f, "navy", anchor="ls")
        P.rect((x0 + cw - 92, y1 - 34, x0 + cw - 6, y1 - 8), "red")
        P.text((x0 + cw - 49, y1 - 21), pg, F("NotoSansThaiLooped@800w85", 19), None, anchor="mm")
    reg("teasers", (206, y0, W - M, y1), dynamic=False, note="static teaser strip (4 cells)")


def draw_masthead(P, x0=M, y0=160, x1=820, y1=392):
    P.rect((x0, y0, x1, y1), "red")
    P.rect((x0 + 10, y0 + 10, x1 - 10, y0 + 13), None)
    P.rect((x0 + 10, y1 - 13, x1 - 10, y1 - 10), None)
    f = F("Taviraj-Black", 152)
    sx = 1.2
    cx = (x0 + x1) / 2
    top = y0 + 18
    P.text((cx + 7, top + 7), C.MASTHEAD["name"], f, "navy", anchor="mt", stroke=3, scale_x=sx)
    P.text((cx, top), C.MASTHEAD["name"], f, None, anchor="mt", stroke=3, scale_x=sx)
    P.text((cx, y1 - 22), C.MASTHEAD["slogan"] + "   ·   " + C.MASTHEAD["latin"], F("NotoSansThaiLooped@800w85", 25), "yellow", anchor="ms")
    # red ink "leaking" from the masthead block (it's a leaky paper)
    for dx, L in ((x0 + 96, 9), (x0 + 430, 12), (x0 + 452, 7), (x1 - 120, 10)):
        im = Image.new("L", (16, int(L + 12)), 0)
        d = ImageDraw.Draw(im)
        d.rectangle((5, 0, 10, L), fill=255)
        d.ellipse((3, L - 3, 13, L + 7), fill=255)
        P.mask(np.asarray(im, f32) / 255, (dx - 8, y1 - 1), "red")
    reg("masthead", (x0, y0, x1, y1), dynamic=False)


def draw_masthead_right(P, day=None):
    # issue/day box
    bx0, by0, bx1, by1 = 836, 160, 1006, 300
    frame(P, (bx0, by0, bx1, by1), 3, "K")
    P.rect((bx0, by0, bx1, by0 + 38), "K")
    P.text(((bx0 + bx1) / 2, by0 + 20), "เปิดร้านวันที่", F("NotoSansThaiLooped@800w85", 24), None, anchor="mm")
    reg("day_number", (bx0 + 6, by0 + 42, bx1 - 6, by1 - 6), dynamic=True, font="NotoSansThaiLooped@900w75", size=96,
        color="#1F1C1C", align="center", example="1", note="day counter (big digits)")
    if day is not None:
        fit_line(P, (bx0 + 8, by0 + 44, bx1 - 8, by1 - 6), str(day), "NotoSansThaiLooped@900w75", 96, "K", align="m")
    # weather box
    wx0, wy0, wx1, wy1 = 1020, 160, W - M, 300
    P.rect((wx0, wy0, wx1, wy1), (0.18, 0.04, 0, 0))
    P.image((wx0 + 8, wy0 + 8, wx0 + 110, wy1 - 8), adphoto("hazy_sun"), "cmyk", contrast=1.15, focus=(0.75, 0.25))
    P.text((wx0 + 120, wy0 + 40), C.WEATHER["title"], F("NotoSansThaiLooped@800w85", 26), "navy", anchor="ls")
    fit_line(P, (wx0 + 120, wy0 + 48, wx1 - 12, wy0 + 100), C.WEATHER["big"], "NotoSansThaiLooped@900w75", 50, "red", min_sx=0.7)
    P.text((wx0 + 120, wy0 + 128), C.WEATHER["line"], F("Sarabun-SemiBold", 21), "K", anchor="ls", max_w=wx1 - wx0 - 132)
    # price burst + tagline
    burst(P, 900, 352, 50, n=16, cmyk="yellow", inner=0.8)
    P.text((900, 340), "ราคา", F("NotoSansThaiLooped@800w85", 22), "red", anchor="mm")
    P.text((900, 368), "10.-", F("NotoSansThaiLooped@900w75", 32), "red", anchor="mm")
    fit_line(P, (962, 318, W - M, 352), C.MASTHEAD["tagline"], "NotoSerifThai@900w75", 34, "red", min_sx=0.6)
    P.text((962, 384), "อ่านข่าวรั่วได้ทุกวัน ที่ " + C.MASTHEAD["online"] + "  ·  ส่งข่าวรั่วทางไลน์ได้ตลอด 24 ชม.",
           F("Sarabun-SemiBold", 19), "navy", anchor="ls", max_w=W - M - 962)


def draw_dateline(P, date_info=None):
    y0, y1 = 404, 444
    P.rect((M, y0, W - M, y0 + 3), "K")
    P.rect((M, y1 - 1, W - M, y1), "K")
    reg("dateline", (M, y0 + 4, W - M, y1 - 2), dynamic=True, font="Sarabun-SemiBold", size=22, color="#1F1C1C",
        align="justify-3", example="ปีที่ 1 ฉบับที่ 1 | วันจันทร์ที่ 1 มิถุนายน พ.ศ. 2569 | ราคา 10 บาท",
        note="3 parts: left issue, centre Thai date with พ.ศ., right price")
    if date_info:
        left, centre, right = date_info
        f = F("Sarabun-SemiBold", 22)
        cy = (y0 + y1) / 2 + 2
        P.text((M + 4, cy), left, f, "K", anchor="lm")
        P.text((W / 2, cy), centre, F("NotoSansThaiLooped@800w85", 22), "K", anchor="mm")
        P.text((W - M - 4, cy), right, f, "K", anchor="rm")


def draw_headline(P, kicker=None, l1=None, l2=None, c1="K", c2="red"):
    reg("kicker", (M, 456, 520, 500), dynamic=True, font="NotoSansThaiLooped@900w75", size=34, color="#FFFFFF", bg="#D5271A",
        note="small red tag above the headline (white text on red bar); optional")
    reg("headline_1", (M, 506, W - M, 656), dynamic=True, font="NotoSansThaiLooped@900w75", size=170, color="#1F1C1C",
        condense="fit width, scaleX 0.62..1.0", align="left")
    reg("headline_2", (M, 662, W - M, 812), dynamic=True, font="NotoSansThaiLooped@900w75", size=170, color="#D5271A",
        condense="fit width, scaleX 0.62..1.0", align="left")
    if kicker:
        f = F("NotoSansThaiLooped@900w75", 34)
        tw = P.measure(kicker, f)[0]
        P.rect((M, 456, M + tw + 28, 500), "red")
        P.text((M + 14, 478), kicker, f, None, anchor="lm")
    if l1:
        fit_line_var(P, (M, 506, W - M, 656), l1, 900, c1)
    if l2:
        fit_line_var(P, (M, 662, W - M, 812), l2, 900, c2)


def draw_main_photo(P, ph=None, caption=None):
    box = (M, 830, 930, 1352)
    reg("photo_main", box, dynamic=True, kind="photo", note="paste a halftoned photo (photos/*.jpg) with multiply blend; 2px black frame is printed")
    if ph is not None:
        P.image(box, photo(ph), "cmyk", contrast=1.12, bright=0.02, focus=focus(ph))
    frame(P, box, 2)
    P.rect((M, 1362, M + 14, 1376), "red")
    reg("caption_main", (M + 22, 1356, 930, 1424), dynamic=True, font="Sarabun-SemiBold", size=23, color="#1F1C1C",
        lines=2, note="photo caption (red square bullet is printed)")
    if caption:
        para(P, (M + 22, 1352, 930, 1424), caption, "Sarabun-SemiBold", 23, 30, "K", justify=False)


def draw_right_column(P, deck=None, body=None, stats=None):
    x0, x1 = 948, W - M
    reg("deck", (x0, 830, x1, 1040), dynamic=True, font="NotoSansThaiLooped@800w85", size=44, colors=["#D5271A", "#1C2A7A", "#1F1C1C"],
        lines=3, condense="scaleX 0.8", note="3 sub-headline lines, alternating red / blue / black")
    if deck:
        cols = ["red", "blue", "K"]
        for i, ln in enumerate(deck[:4]):
            fit_line_var(P, (x0, 840 + i * 66, x1, 894 + i * 66), ln, 800, cols[i % 3], fill=False)
    P.rect((x0, 1044, x1, 1046), "K")
    reg("body_main", (x0, 1054, x1, 1196), dynamic=True, font="NotoSansThaiLooped", size=20, line_height=27,
        color="#1F1C1C", justify=True, note="main story body; or use pre-rendered parts/body_*.png")
    if body:
        y = para(P, (x0, 1050, x1, 1172), body, "NotoSansThaiLooped", 20, 27, "K")
        P.text((x1, 1192), "(อ่านต่อหน้า 12)", F("NotoSansThaiLooped@800w85", 20), "red", anchor="rs")
    # stats box
    sx0, sy0, sx1, sy1 = x0, 1210, x1, 1430
    frame(P, (sx0, sy0, sx1, sy1), 3, "K")
    P.rect((sx0, sy0, sx1, sy0 + 46), "red")
    P.text(((sx0 + sx1) / 2, sy0 + 24), "สรุปยอดร้านเฮียผัด ประจำวัน", F("NotoSansThaiLooped@900w75", 28), None, anchor="mm")
    labels = [("ยอดขาย", "บาท"), ("ลูกค้า", "คน"), ("เมนูเด็ด", ""), ("รีวิว", "ดาว")]
    for i, (lab, unit) in enumerate(labels):
        ry = sy0 + 46 + 14 + i * 42
        P.text((sx0 + 16, ry + 26), lab, F("NotoSansThaiLooped@800w85", 26), "navy", anchor="ls")
        for xx in range(int(sx0 + 140), int(sx1 - 70), 9):  # dotted leader
            P.rect((xx, ry + 22, xx + 3, ry + 25), "K")
        if unit:
            P.text((sx1 - 14, ry + 26), unit, F("Sarabun-SemiBold", 22), "K", anchor="rs")
        key = ["stat_money", "stat_customers", "stat_dish", "stat_rating"][i]
        reg(key, (sx0 + 150, ry - 6, sx1 - 70, ry + 34), dynamic=True, font="NotoSansThaiLooped@900w75", size=34, color="#1F1C1C",
            align="right", bg="#F1ECDF", note="erase the dotted leader under the value with bg colour before drawing" if i < 3 else "draw number + stars (★)")
    if stats:
        for i, val in enumerate(stats):
            ry = sy0 + 46 + 14 + i * 42
            if i == 3:
                n = int(round(float(val)))
                P.rect((sx0 + 150, ry - 4, sx1 - 70, ry + 32), "white")
                stars(P, sx1 - 70 - 5 * 2.3 * 13 - 6, ry + 14, 5, 13, "red", filled=n)
                P.text((sx0 + 158, ry + 26), str(val), F("NotoSansThaiLooped@900w75", 32), "K", anchor="ls")
            else:
                f = F("NotoSansThaiLooped@900w75", 34)
                tw = P.measure(val, f)[0]
                P.rect((sx1 - 76 - tw - 10, ry - 4, sx1 - 70, ry + 32), "white")
                P.text((sx1 - 78, ry + 27), val, f, "K" if i != 0 else "red", anchor="rs")


def draw_second_bar(P, text=None):
    y0, y1 = 1446, 1536
    P.rect((M, y0, W - M, y1), "K")
    P.rect((M, y0, 236, y1), "red")
    P.text((138, (y0 + y1) / 2 - 16), "ข่าว", F("NotoSansThaiLooped@900w75", 34), None, anchor="mm")
    P.text((138, (y0 + y1) / 2 + 20), "ฮอต!", F("NotoSansThaiLooped@900w75", 40), "yellow", anchor="mm")
    reg("headline_bar", (252, y0 + 8, W - M - 16, y1 - 8), dynamic=True, font="NotoSansThaiLooped@900w75", size=64, color="#FFFFFF",
        on="black bar (paper shows through white text)", condense="fit width, scaleX 0.65..0.92")
    if text:
        fit_line_var(P, (252, y0 + 12, W - M - 16, y1 - 12), text, 900, None)


def draw_col_a(P, ph=None, caption=None, text=None):
    box = (M, 1552, 470, 1770)
    reg("photo_second", box, dynamic=True, kind="photo")
    if ph is not None:
        P.image(box, photo(ph), "cmyk", contrast=1.1, focus=focus(ph))
    frame(P, box, 2)
    reg("caption_second", (M, 1774, 470, 1806), dynamic=True, font="Sarabun-SemiBold", size=19, color="#1F1C1C", lines=1)
    reg("text_second", (M, 1810, 470, 1890), dynamic=True, font="NotoSansThaiLooped", size=18, line_height=24,
        color="#1F1C1C", lines=3)
    if caption:
        P.text((M, 1798), caption, F("Sarabun-SemiBold", 19), "K", anchor="ls", max_w=430)
    if text:
        para(P, (M, 1806, 470, 1890), text, "NotoSansThaiLooped", 18, 24, "K")


def draw_col_b(P):
    x0, x1 = 488, 940
    s = C.SMALL[0]
    f = F("NotoSansThaiLooped@800w85", 31)
    y = 1552 + 30
    for ln in wrap_thai(s["head"], f, x1 - x0)[:2]:
        P.text((x0, y), ln, f, "navy", anchor="ls")
        y += 36
    P.image((x0, y - 16, x0 + 170, y + 104), photo("hippo_baby"), "cmyk", contrast=1.25, bright=0.08, focus=focus("hippo_baby"))
    frame(P, (x0, y - 16, x0 + 170, y + 104), 1)
    para(P, (x0 + 182, y - 22, x1, y + 108), s["text"], "NotoSansThaiLooped", 17, 23, "K")
    y += 118
    P.rect((x0, y, x1, y + 2), "K")
    s = C.SMALL[1]
    y += 34
    for ln in wrap_thai(s["head"], f, x1 - x0)[:2]:
        P.text((x0, y), ln, f, "red", anchor="ls")
        y += 36
    para(P, (x0, y - 20, x1, 1890), s["text"], "NotoSansThaiLooped", 17, 23, "K")
    P.rect((x1 + 8, 1552, x1 + 9, 1890), "K")  # column rule


def draw_col_c(P, lotto=None):
    x0, x1 = 958, W - M
    xm = (x0 + x1) / 2
    # lottery box
    lb = (x0, 1552, xm - 6, 1722)
    dotted_frame(P, lb, "red")
    P.rect((lb[0] + 6, lb[1] + 6, lb[2] - 6, lb[1] + 44), "red")
    P.text(((lb[0] + lb[2]) / 2, lb[1] + 25), C.ADS["lottery"]["title"], F("NotoSansThaiLooped@900w75", 28), None, anchor="mm")
    reg("lotto_numbers", (lb[0] + 8, lb[1] + 50, lb[2] - 8, lb[1] + 118), dynamic=True, font="NotoSansThaiLooped@900w75", size=64,
        color="#1F1C1C", align="center", example="58 · 85")
    if lotto:
        fit_line(P, (lb[0] + 10, lb[1] + 50, lb[2] - 10, lb[1] + 118), lotto, "NotoSansThaiLooped@900w75", 66, "K", align="m")
    P.image((lb[0] + 8, lb[1] + 120, lb[2] - 8, lb[1] + 146), adphoto("lottery_tickets"), "cmyk", contrast=1.1, focus=(0.5, 0.45))
    P.text(((lb[0] + lb[2]) / 2, lb[1] + 164), C.ADS["lottery"]["line"], F("NotoSansThaiLooped@800w85", 17), "red", anchor="ms", max_w=lb[2] - lb[0] - 14)
    # herbal liquor ad
    hb = (xm + 6, 1552, x1, 1722)
    frame(P, hb, 2)
    P.image((hb[0] + 8, hb[1] + 8, hb[0] + 72, hb[3] - 26), adphoto("herbal_roots"), "cmyk", contrast=1.2, focus=(0.5, 0.5))
    P.text((hb[0] + 78, hb[1] + 40), C.ADS["herbal"]["title"], F("NotoSansThaiLooped@900w75", 27), "K", anchor="ls", max_w=hb[2] - hb[0] - 84)
    P.text((hb[0] + 78, hb[1] + 76), C.ADS["herbal"]["brand"], F("NotoSansThaiLooped@900w75", 31), "red", anchor="ls", max_w=hb[2] - hb[0] - 84)
    para(P, (hb[0] + 78, hb[1] + 84, hb[2] - 8, hb[1] + 142), C.ADS["herbal"]["line"], "Sarabun-SemiBold", 17, 21, "K", justify=False)
    P.text(((hb[0] + hb[2]) / 2, hb[3] - 10), C.ADS["herbal"]["small"], F("Sarabun-Regular", 13), "K", anchor="ms", max_w=hb[2] - hb[0] - 10)
    # takrut ad
    tb = (x0, 1732, xm - 6, 1890)
    P.rect(tb, (0, 0.04, 0.3, 0))
    frame(P, tb, 2)
    P.image((tb[0] + 8, tb[1] + 8, tb[0] + 86, tb[1] + 92), adphoto("takrut_gold"), "cmyk", contrast=1.1, focus=(0.5, 0.5))
    P.text((tb[0] + 92, tb[1] + 36), "ตะกรุด", F("NotoSansThaiLooped@900w75", 28), "red", anchor="ls")
    P.text((tb[0] + 92, tb[1] + 66), "เรียกลูกค้า", F("NotoSansThaiLooped@900w75", 28), "K", anchor="ls")
    para(P, (tb[0] + 10, tb[1] + 98, tb[2] - 8, tb[3] - 22), C.ADS["takrut"]["line"], "Sarabun-SemiBold", 16, 20, "K", justify=False)
    P.text(((tb[0] + tb[2]) / 2, tb[3] - 8), C.ADS["takrut"]["small"], F("NotoSansThaiLooped@800w85", 15), "navy", anchor="ms", max_w=tb[2] - tb[0] - 10)
    # room for rent
    rb = (xm + 6, 1732, x1, 1890)
    frame(P, rb, 2, "red")
    fit_line(P, (rb[0] + 8, rb[1] + 6, rb[2] - 8, rb[1] + 52), C.ADS["room"]["title"], "NotoSansThaiLooped@900w75", 40, "red", align="m")
    P.image((rb[0] + 8, rb[1] + 54, rb[0] + 70, rb[1] + 114), adphoto("apartment_facade"), "cmyk", contrast=1.1, focus=(0.5, 0.5))
    para(P, (rb[0] + 76, rb[1] + 50, rb[2] - 6, rb[1] + 118), C.ADS["room"]["line"], "Sarabun-SemiBold", 15, 19, "K", justify=False)
    P.text(((rb[0] + rb[2]) / 2, rb[3] - 30), C.ADS["room"]["price"], F("NotoSansThaiLooped@900w75", 24), "K", anchor="ms")
    P.text(((rb[0] + rb[2]) / 2, rb[3] - 8), C.ADS["room"]["phone"], F("NotoSansThaiLooped@800w85", 17), "navy", anchor="ms")


def draw_bottom(P):
    y0 = 1902
    P.rect((M, y0, W - M, y0 + 3), "K")
    n = len(C.CLASSIFIEDS)
    bw = (W - 2 * M - 230 - (n - 1) * 8) / n
    for i, (t, s) in enumerate(C.CLASSIFIEDS):
        x0 = M + i * (bw + 8)
        frame(P, (x0, y0 + 12, x0 + bw, y0 + 98), 1)
        fit_line(P, (x0 + 6, y0 + 16, x0 + bw - 6, y0 + 46), t, "NotoSansThaiLooped@900w75", 24, "red" if i % 2 == 0 else "navy", min_sx=0.7)
        para(P, (x0 + 6, y0 + 50, x0 + bw - 6, y0 + 98), s, "Sarabun-Regular", 15, 19, "K", justify=False)
    barcode(P, W - M - 210, y0 + 14, 210, 84)
    P.text((W / 2, H - 22), C.MASTHEAD["printer"], F("Sarabun-Regular", 15), "K", anchor="ms", max_w=W - 2 * M)


# ------------------------------------------------------------------ sheet (paper + folds)
def back_page_layer(seed=9):
    """Mirrored, faint print from the reverse side (show-through)."""
    B = Press(W, H, seed=seed)
    rng = np.random.default_rng(seed)
    B.rect((M, 40, W - M, 170), "K")
    y = 200
    while y < H - 100:
        cols = rng.integers(2, 5)
        cw = (W - 2 * M - (cols - 1) * 20) / cols
        hgt = rng.integers(160, 420)
        for c in range(cols):
            x0 = M + c * (cw + 20)
            if rng.random() < 0.3:
                B.rect((x0, y, x0 + cw, y + hgt * 0.7), (0, 0, 0, 0.55), contone=True)
            else:
                fit_line(B, (x0, y, x0 + cw, y + 50), "ข่าวทั่วไทย ประจำวัน", "NotoSansThaiLooped@900w75", 46, "K", min_sx=0.5)
                para(B, (x0, y + 56, x0 + cw, y + hgt), C.BACK_PAGE * 2, "NotoSansThaiLooped", 17, 23, "K")
        y += hgt + 30
    white = np.ones((H, W, 3), f32)
    a = B.composite(white, cell=CELL, misreg=((0, 0),) * 4, spread=1.0)
    g = gray_of(a)[:, ::-1]
    return blur(1 - g, 1.6)


ACG = ROOT + "/references/ui/_raw/acg/"


def real_newsprint(h, w, seed=0, tone="#E6E1D3", strength=1.0, yellow_edges=0.0):
    """Newsprint built from a real scanned recycled paper (ambientCG Paper002, CC0):
    keep the scan's fibres/flecks/mottling, re-toned to newsprint grey-cream."""
    tex = to_arr(Image.open(ACG + "Paper002/Paper002_2K-JPG_Color.jpg"))
    th, tw = tex.shape[:2]
    reps_y, reps_x = h // th + 2, w // tw + 2
    big = np.tile(tex, (reps_y, reps_x, 1))
    rng = np.random.default_rng(seed)
    oy, ox = rng.integers(0, th), rng.integers(0, tw)
    a = big[oy:oy + h, ox:ox + w]
    mean = blur(a, 48)
    detail = a / np.maximum(mean, 1e-3)
    low = gray_of(mean)
    low = low / low.mean()
    out = np.array(hexrgb(tone), f32)[None, None] * (1 + (detail - 1) * strength) * (1 + (low - 1) * 0.6)[..., None]
    if yellow_edges > 0:
        out *= edge_yellow(h, w, seed, yellow_edges)
    return np.clip(out, 0, 1).astype(f32)


def real_creases(h, w, seed=0, strength=0.35):
    """Shading multiplier from a real creased-paper scan (ambientCG Paper003, CC0)."""
    tex = gray_of(to_arr(Image.open(ACG + "Paper003/Paper003_2K-JPG_Color.jpg")))
    tex = np.asarray(Image.fromarray(tex, "F").resize((max(w, h), max(w, h)), Image.BICUBIC), f32)[:h, :w]
    m = tex / blur(tex, 90)
    return (1 + (m - 1) * strength).astype(f32)


def make_sheet(seed=3, show_through=True, fold=True):
    paper = real_newsprint(H, W, seed=seed, tone="#E6E1D3", yellow_edges=0.8)
    if show_through:
        st = back_page_layer(seed + 6)
        paper *= (1 - 0.05 * st)[..., None]
    rng = np.random.default_rng(seed)
    shade = np.ones((H, W), f32)
    height = np.zeros((H, W), f32)
    if fold:
        s1, h1 = fold_field(H, W, [("h", H * 0.5 + rng.normal(0, 4), 1.5), ("v", W * 0.5 + rng.normal(0, 6), -0.5)],
                            seed=seed, sharp=2.2, wobble=2.5)
        s2, h2 = crease_field(H, W, n=6, seed=seed + 1, strength=0.03)
        shade = s1 * s2 * real_creases(H, W, seed, 0.30) * edge_wear(H, W, seed=seed + 2, amount=1.0, width=22)
        height = h1 * 0.02 + h2 * 0.6
    return paper, shade, height


def composite_page(P, paper, shade, seed=5):
    out = P.composite(paper, cell=CELL, seed=seed, density=(0.84, 1.0), voids=0.0015)
    out *= shade[..., None]
    return out


# ------------------------------------------------------------------ build
def build_page(kind, sheet, seed):
    paper, shade, _ = sheet
    P = Press(W, H, seed=seed)
    dyn = kind != "blank"
    draw_teasers(P, dyn)
    draw_masthead(P)
    date = {
        "day1": ("ปีที่ 1 ฉบับที่ 1", "วันจันทร์ที่ 1 มิถุนายน พ.ศ. 2569", "ราคา 10 บาท  ·  " + C.MASTHEAD["online"]),
        "good": ("ปีที่ 1 ฉบับที่ 8", "วันจันทร์ที่ 8 มิถุนายน พ.ศ. 2569", "ราคา 10 บาท  ·  " + C.MASTHEAD["online"]),
        "bad": ("ปีที่ 1 ฉบับที่ 14", "วันอาทิตย์ที่ 14 มิถุนายน พ.ศ. 2569", "ราคา 10 บาท  ·  " + C.MASTHEAD["online"]),
    }.get(kind)
    day = {"day1": 1, "good": 8, "bad": 14}.get(kind)
    draw_masthead_right(P, day)
    draw_dateline(P, date)
    if kind == "day1":
        draw_headline(P, "ระทึกกลางซอยเก้า!", "4 หนุ่มหมดตัว! ควักเหรียญ", "ซื้อรถเข็นลุง 100 บาท")
        draw_main_photo(P, "casino_tables", C.CAPTIONS["casino"])
        draw_right_column(P, C.DECKS["day1"], C.BODY["day1"], ["120", "6", "กะเพราหมูสับ", "3.5"])
        draw_second_bar(P, C.SECOND["day1"])
        draw_col_a(P, "soi_dog", C.CAPTIONS["dog"], C.SECOND_TEXT["day1"])
        draw_col_c(P, "10 · 01")
    elif kind == "good":
        draw_headline(P, "เฮียผัดฟีเวอร์!", "คิวยาวถึงปากซอย! ลูกค้า 97 คน", "แห่ชิมกะเพราไข่ดาวเยิ้ม")
        draw_main_photo(P, "crowd_foodcourt", C.CAPTIONS["good"])
        draw_right_column(P, C.DECKS["good"], C.BODY["good"], ["4,850", "97", "กะเพราไข่ดาว", "4.6"])
        draw_second_bar(P, C.SECOND["good"])
        draw_col_a(P, "kaprao_egg", "เมนูเด็ดประจำร้าน กะเพราหมูสับไข่ดาวเยิ้มๆ", C.SECOND_TEXT["good"])
        draw_col_c(P, "58 · 85")
    elif kind == "bad":
        draw_headline(P, "สลด! วันซวยของเฮียผัด", "ไฟลุกท่วมกระทะ!", "กะเพราไหม้ทั้งซอย ลูกค้าหนีเกลี้ยง")
        draw_main_photo(P, "wok_fire", C.CAPTIONS["bad"])
        draw_right_column(P, C.DECKS["bad"], C.BODY["bad"], ["-320", "12", "กะเพราไหม้", "1.2"])
        draw_second_bar(P, C.SECOND["bad"])
        draw_col_a(P, "flood_shop", C.CAPTIONS["flood"], C.SECOND_TEXT["bad"])
        draw_col_c(P, "00 · 13")
    else:  # blank template
        draw_headline(P)
        draw_main_photo(P)
        draw_right_column(P)
        draw_second_bar(P)
        draw_col_a(P)
        draw_col_c(P)
    draw_col_b(P)
    draw_bottom(P)
    return composite_page(P, paper, shade, seed)


def color_to_alpha(a):
    """float RGB on white -> RGBA image (normal-blend equivalent of the ink over white)."""
    al = 1 - a.min(-1)
    rgb = np.where(al[..., None] > 1e-4, (a - (1 - al[..., None])) / np.maximum(al[..., None], 1e-4), 0)
    return Image.fromarray((np.dstack([np.clip(rgb, 0, 1), al]) * 255 + 0.5).astype(np.uint8), "RGBA")


def part(name, w, h, drawfn, seed=1, cell=CELL):
    P = Press(w, h, seed=seed)
    drawfn(P)
    white = np.ones((h, w, 3), f32)
    a = P.composite(white, cell=cell, seed=seed, density=(0.86, 1.0))
    img = color_to_alpha(a)
    bb = img.getbbox()
    if bb:
        bb = (max(0, bb[0] - 4), max(0, bb[1] - 4), min(w, bb[2] + 4), min(h, bb[3] + 4))
        img = img.crop(bb)
    save_png(img, OUT + "parts/" + name + ".png")
    return img


def build_parts():
    parts = {}

    def bar(cmyk, text_cmyk=None, txt="พาดหัวข่าว"):
        def f(P):
            P.rect((6, 6, 1194, 126), cmyk)
        return f
    parts["bar_red"] = part("bar_red", 1200, 132, bar("red"), 11)
    parts["bar_black"] = part("bar_black", 1200, 132, bar("K"), 12)
    parts["bar_blue"] = part("bar_blue", 1200, 132, bar("blue"), 13)
    parts["bar_yellow_tint"] = part("bar_yellow_tint", 1200, 132, bar((0, 0.03, 0.3, 0)), 14)

    def ribbon(txt, cmyk, tcmyk=None):
        def f(P):
            fnt = F("NotoSansThaiLooped@900w75", 64)
            tw = P.measure(txt, fnt)[0]
            P.rect((10, 10, tw + 70, 100), cmyk)
            im = Image.new("L", (40, 90), 0)
            ImageDraw.Draw(im).polygon([(0, 0), (40, 0), (12, 45), (40, 90), (0, 90)], fill=255)
            P.mask(np.asarray(im, f32) / 255, (tw + 70, 10), cmyk)
            P.text((40, 56), txt, fnt, tcmyk, anchor="lm")
        return f
    for nm, txt, c, tc in [("ribbon_breaking", "ข่าวด่วน!", "red", None), ("ribbon_thrill", "ระทึก!", "K", "yellow"),
                           ("ribbon_special", "พิเศษ!", "blue", None), ("ribbon_highlight", "เด่นในฉบับ", "red", "yellow"),
                           ("ribbon_exclusive", "ข่าวรั่วสุดเอ็กซ์คลูซีฟ", "K", None)]:
        parts[nm] = part(nm, 1100, 112, ribbon(txt, c, tc), sum(map(ord, nm)) % 97)

    def photo_frame(P):
        frame(P, (6, 6, 906, 606), 3)
        P.rect((6, 616, 20, 630), "red")
    parts["photo_frame_900x600"] = part("photo_frame_900x600", 912, 640, photo_frame, 21)

    def caption_box(P):
        P.rect((6, 6, 806, 66), "K")
        P.rect((6, 6, 30, 66), "red")
    parts["caption_bar"] = part("caption_bar", 812, 72, caption_box, 22)

    def rules(P):
        P.rect((6, 10, 1194, 13), "K")
        P.rect((6, 30, 1194, 31), "K")
        P.rect((6, 50, 1194, 53), "K")
        P.rect((6, 57, 1194, 58), "K")
        for x in range(6, 1194, 10):
            P.rect((x, 80, x + 4, 83), "K")
        P.rect((6, 100, 1194, 104), "red")
    parts["column_rules"] = part("column_rules", 1200, 110, rules, 23)

    def stats_box(P):
        global_shift = (-948 + 6, -1210 + 6)
        Q = Press(W, H, seed=3)
        draw_right_column(Q)
        P.solid[:, :, :] = Q.solid[:, 1204:1204 + P.h, 942:942 + P.w]
        P.cont[:, :, :] = Q.cont[:, 1204:1204 + P.h, 942:942 + P.w]
    parts["stats_box"] = part("stats_box", 480, 236, stats_box, 24)

    def ad_from_page(x0, y0, x1, y1):
        def f(P):
            Q = Press(W, H, seed=4)
            draw_col_c(Q)
            P.solid[:] = Q.solid[:, y0:y1, x0:x1]
            P.cont[:] = Q.cont[:, y0:y1, x0:x1]
        return f
    xm = int((958 + W - M) / 2)
    parts["ad_lottery"] = part("ad_lottery", xm - 954, 180, ad_from_page(954, 1548, xm, 1728), 25)
    parts["ad_herbal"] = part("ad_herbal", W - M + 4 - xm, 180, ad_from_page(xm, 1548, W - M + 4, 1728), 26)
    parts["ad_takrut"] = part("ad_takrut", xm - 954, 166, ad_from_page(954, 1728, xm, 1894), 27)
    parts["ad_room_for_rent"] = part("ad_room_for_rent", W - M + 4 - xm, 166, ad_from_page(xm, 1728, W - M + 4, 1894), 28)

    def masthead(P):
        Q = Press(W, H, seed=2)
        draw_masthead(Q)
        P.solid[:] = Q.solid[:, 150:150 + P.h, 30:30 + P.w]
        P.cont[:] = Q.cont[:, 150:150 + P.h, 30:30 + P.w]
    img = part("masthead_thairua", 800, 256, masthead, 31)
    img.save(OUT + "masthead_thairua.png", optimize=True)
    os.remove(OUT + "parts/masthead_thairua.png")

    def stars_part(P):
        stars(P, 10, 30, 5, 22, "red", filled=5)
        stars(P, 10, 86, 5, 22, "red", filled=0)
    parts["stars_rating"] = part("stars_rating", 280, 120, stars_part, 32)

    def price_burst(P):
        burst(P, 70, 70, 64, n=16, cmyk="yellow", inner=0.8)
        P.text((70, 56), "ราคา", F("NotoSansThaiLooped@800w85", 28), "red", anchor="mm")
        P.text((70, 92), "10.-", F("NotoSansThaiLooped@900w75", 40), "red", anchor="mm")
    parts["price_burst"] = part("price_burst", 144, 144, price_burst, 33)

    def bc(P):
        barcode(P, 6, 6, 260, 110)
    parts["barcode"] = part("barcode", 272, 124, bc, 34)

    # body text overlays (ink only) for the main story column
    for k, txt in C.BODY.items():
        def bodyf(P, txt=txt):
            para(P, (4, 0, 460, 150), txt, "NotoSansThaiLooped", 20, 27, "K")
            P.text((460, 168), "(อ่านต่อหน้า 12)", F("NotoSansThaiLooped@800w85", 20), "red", anchor="rs")
        part("body_" + k, 468, 176, bodyf, 40)
    return parts


def build_photos():
    """Halftoned, multiply-ready (white background) newspaper photos, colour + B&W."""
    os.makedirs(OUT + "photos", exist_ok=True)
    out = []
    for name in PHOTOS:
        im, foc = photo(name), focus(name)
        w = 1024
        h = int(w * 0.66)
        for mode in ("cmyk", "k"):
            P = Press(w, h, seed=len(name))
            P.image((0, 0, w, h), im, mode, contrast=1.12, bright=0.02, focus=foc)
            white = np.ones((h, w, 3), f32)
            a = P.composite(white, cell=5.0, seed=len(name), density=(0.85, 1.0), voids=0.002)
            suffix = "color" if mode == "cmyk" else "bw"
            save_jpg(a, OUT + f"photos/{name}_{suffix}.jpg", 90)
        out.append(name)
    return out


def ink_colors():
    """Measured on-paper colours of the named inks (for the game's canvas text)."""
    res = {}
    paper = np.ones((10, 10 * 8, 3), f32) * np.array(hexrgb("#E6E1D3"), f32)
    P = Press(80, 10, seed=1)
    names = ["K", "red", "blue", "navy", "yellow", "orange", "green", "grey"]
    for i, n in enumerate(names):
        P.rect((i * 10, 0, i * 10 + 10, 10), n)
    a = P.composite(paper, misreg=((0, 0),) * 4, spread=0, density=(1, 1))
    for i, n in enumerate(names):
        c = a[5, i * 10 + 5]
        res[n] = "#%02X%02X%02X" % tuple(int(v * 255) for v in c)
    return res


def main():
    os.makedirs(OUT, exist_ok=True)
    # 1) tileable newsprint base 2048
    tile = real_newsprint(2048, 2048, seed=21, tone="#E6E1D3")
    save_jpg(tile, OUT + "newsprint_tile_2048.jpg", 90)
    # 2) folded blank sheet + normal map (no print)
    paper, shade, height = make_sheet(seed=3, show_through=False)
    save_jpg(paper * shade[..., None], OUT + "newsprint_sheet_folded_1448x2048.jpg", 90)
    n3 = to_arr(Image.open(ACG + "Paper003/Paper003_2K-JPG_NormalGL.jpg").resize((max(W, H), max(W, H))))[:H, :W]
    n2 = to_arr(Image.open(ACG + "Paper002/Paper002_2K-JPG_NormalGL.jpg").resize((W, H)))
    nf = np.asarray(height_to_normal(height, strength=1.6), f32) / 255.0
    nn = (nf - 0.5) + (n3 - 0.5) * 0.35 + (n2 - 0.5) * 0.6
    nn[..., 2] = np.abs(nn[..., 2]) + 0.35
    nn = nn / np.linalg.norm(nn, axis=-1, keepdims=True)
    nrm = to_img(nn * 0.5 + 0.5)
    nrm.convert("RGB").save(OUT + "newsprint_sheet_folded_normal_1448x2048.jpg", quality=92)
    # 3) pages
    sheet = make_sheet(seed=3, show_through=True)
    kinds = ["blank", "day1", "good", "bad"] if not FAST else ["blank", "good"]
    names = {"blank": "front_template_blank.jpg", "day1": "front_example_day1.jpg",
             "good": "front_example_good_day.jpg", "bad": "front_example_disaster_day.jpg"}
    for i, k in enumerate(kinds):
        REG.clear() if k != "blank" else None
        out = build_page(k, sheet, seed=50 + i)
        save_jpg(out, OUT + names[k], 90)
        if k == "blank":
            saved_reg = dict(REG)
        print("page", k)
    if FAST:
        return
    # 4) parts, photos
    build_parts()
    photos = build_photos()
    # 5) layout.json
    colors = ink_colors()
    layout = {
        "page": {"width": W, "height": H, "template": "front_template_blank.jpg",
                 "examples": {"day1": "front_example_day1.jpg", "good": "front_example_good_day.jpg",
                              "disaster": "front_example_disaster_day.jpg"},
                 "paper_tile": "newsprint_tile_2048.jpg", "sheet_folded": "newsprint_sheet_folded_1448x2048.jpg",
                 "sheet_normal": "newsprint_sheet_folded_normal_1448x2048.jpg", "masthead": "masthead_thairua.png"},
        "coordinates": "pixels in the 1448x2048 page, origin top-left; uv = x/1448, 1-(y/2048) for three.js",
        "render_hints": {
            "blend": "draw dynamic text/photos with ctx.globalCompositeOperation='multiply' onto the template so paper grain + folds show through",
            "ink_softening": "draw text at 2x then downscale, or add ctx.filter='blur(0.4px)'; optional 0.5-1px offset duplicate in magenta/yellow for misregistration on colour text",
            "white_on_bar": "regions with on/bg: draw text in paper colour #E6E1D3 (not pure white) using 'source-over'",
            "condense": "Thai tabloid headlines are condensed: ctx.save(); ctx.scale(sx,1) with sx=min(maxSX, regionW/textW), never below 0.62",
            "thai_wrap": "use Intl.Segmenter('th',{granularity:'word'}) to find line breaks; justify by widening existing spaces only",
            "fonts": "LOOPED Thai only. @font-face{font-family:'Noto Sans Thai Looped';src:url(assets/fonts/NotoSansThaiLooped.woff2);font-weight:100 900;font-stretch:62% 100%} — headlines weight 900 + font-stretch 68-75%; decks 800/75%; body 400; captions Sarabun-SemiBold; masthead Taviraj-Black",
            "photos": "photos/*_color.jpg are pre-halftoned on white: draw with multiply into photo_* regions (object-fit: cover)",
        },
        "ink_colors_on_paper": colors,
        "regions": saved_reg,
        "parts": sorted(os.listdir(OUT + "parts")),
        "photos": {n: {"color": f"photos/{n}_color.jpg", "bw": f"photos/{n}_bw.jpg"} for n in photos},
        "photo_suggestions": {"day1": ["casino_tables", "soi_dog", "food_cart"], "good": ["crowd_foodcourt", "kaprao_egg", "wok_fire"],
                              "disaster": ["wok_fire", "flood_shop", "flood_night", "traffic_night"],
                              "event": ["soi_dog_sitting", "hippo_baby", "market_garlic", "wok_vendor_flames"]},
        "headline_templates": "see references/culture/lines.json -> newspaper_headlines (placeholders {money} {customers} {dish} {rating} {day})",
        "date_format": {"pattern": "วัน{weekday}ที่ {d} {month} พ.ศ. {year_be}", "year_be": "gregorian + 543",
                        "weekdays": C.WEEKDAYS, "months": C.MONTHS,
                        "left": "ปีที่ 1 ฉบับที่ {day}", "right": "ราคา 10 บาท  ·  ไทยรั่วออนไลน์"},
    }
    with open(OUT + "layout.json", "w", encoding="utf-8") as f:
        json.dump(layout, f, ensure_ascii=False, indent=1)
    print("done")


if __name__ == "__main__":
    main()
