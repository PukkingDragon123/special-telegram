"""Menu posters + community posters + 8-Twelve promos -> public/assets/img/posters/
Built from REAL photos (references/ui/_raw/{posters,photos,ads}, Flickr; see credits) + real material scans
(ambientCG Cardboard002 / Paper001 / Paper003, CC0) + looped Thai fonts.
Run: python3 -I scripts/research/R4/build_posters.py"""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from printfx import *  # noqa
from printfx import _max_paste

ROOT = "/home/user/special-telegram"
RAWD = ROOT + "/references/ui/_raw/"
ACG = RAWD + "acg/"
OUT = ROOT + "/public/assets/img/posters/"
MAN = {"note": "all posters use looped Thai fonts; photos are real (see sources); regions in px of each file", "files": {}}

SRC = {}
for sub in ("posters", "photos", "ads", "mag"):
    p = RAWD + sub + "/_sources.tsv"
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            f = line.rstrip("\n").split("\t")
            if len(f) >= 4:
                SRC[sub + "/" + f[0]] = dict(url=f[1], author=f[2], license=f[3])


def ph(path, crop=None):
    im = Image.open(RAWD + path).convert("RGB")
    if crop:
        w, h = im.size
        im = im.crop((int(crop[0] * w), int(crop[1] * h), int(crop[2] * w), int(crop[3] * h)))
    ph.used.add(path)
    return im


ph.used = set()


def src_of(paths):
    return [dict(file=p, **SRC.get(p, {})) for p in paths]


def mat(name, h, w, tone=None, strength=1.0, seed=0, rot=False):
    tex = to_arr(Image.open(ACG + f"{name}/{name}_2K-JPG_Color.jpg"))
    if rot:
        tex = np.ascontiguousarray(np.rot90(tex))
    th, tw = tex.shape[:2]
    big = np.tile(tex, (h // th + 2, w // tw + 2, 1))
    rng = np.random.default_rng(seed)
    oy, ox = rng.integers(0, th), rng.integers(0, tw)
    a = big[oy:oy + h, ox:ox + w]
    if tone is None:
        return a
    det = a / np.maximum(blur(a, 40), 1e-3)
    return np.clip(np.array(hexrgb(tone), f32)[None, None] * (1 + (det - 1) * strength), 0, 1).astype(f32)


def creases(h, w, strength=0.25, seed=0):
    tex = gray_of(to_arr(Image.open(ACG + "Paper003/Paper003_2K-JPG_Color.jpg")))
    tex = np.rot90(tex, int(np.random.default_rng(seed).integers(0, 4)))
    tex = np.asarray(Image.fromarray(np.ascontiguousarray(tex), "F").resize((max(w, h), max(w, h)), Image.BICUBIC), f32)[:h, :w]
    return (1 + (tex / blur(tex, 90) - 1) * strength).astype(f32)


def gloss_print(P, paper, seed=0, cell=2.6):
    return P.composite(paper, inks=INKS_GLOSS, cell=cell, misreg=((0.6, -0.3), (-0.4, 0.5), (0.3, 0.6), (0, 0)),
                       spread=0.4, density=(0.94, 1.0), rough=0.04, seed=seed, gain=0.08, max_k=0.97)


def photocopy(arr, seed=0, contrast=1.7, toner=0.93):
    """Cheap office photocopy: grey, crushed, toner speckle, drum streaks, slightly soft."""
    h, w = arr.shape[:2]
    g = gray_of(arr)
    g = np.clip((g - 0.5) * contrast + 0.55, 0, 1)
    g = blur(g, 0.6)
    rng = np.random.default_rng(seed)
    speck = (rng.random((h, w)) > 0.9985).astype(f32)
    speck = np.clip(blur(speck, 0.8) * 4, 0, 1)
    streak = (fbm(1, w, 6, 2, seed)[0] - 0.5) * 0.06
    g = g + streak[None, :] - speck * 0.6
    # toner never gets truly black, paper never truly white
    g = 1 - (1 - np.clip(g, 0, 1)) * toner
    g = np.clip(g, 0.06, 0.985)
    return np.repeat(g[..., None], 3, -1).astype(f32)


def wall_wear(arr, seed=0, fade=0.25, tape=True, torn=False, crease=0.28):
    h, w = arr.shape[:2]
    a = arr.copy()
    # sun fade: lighten + desaturate + shift to cyan-ish (red inks fade first)
    g = gray_of(a)[..., None]
    a = a * (1 - fade) + (g * 0.5 + 0.5) * fade
    a[..., 0] = a[..., 0] * (1 - fade * 0.3) + fade * 0.3
    a *= creases(h, w, crease, seed)[..., None]
    a *= edge_wear(h, w, seed=seed, amount=1.2, width=24)[..., None]
    a *= edge_yellow(h, w, seed, 1.0, 0.06)
    img = to_img(a).convert("RGBA")
    if torn:  # tear off a corner (alpha)
        al = np.ones((h, w), f32)
        yy, xx = np.mgrid[0:h, 0:w].astype(f32)
        edge = (w - xx) + (h - yy) * 0.7 + fbm(h, w, 30, 3, seed) * 25
        al[edge < 160] = 0
        img.putalpha(Image.fromarray((al * 255).astype(np.uint8)))
    if tape:
        rng = np.random.default_rng(seed)
        for (x, y, r) in [(-20, -10, -35), (w - 120, -14, 33), (-24, h - 50, 35), (w - 110, h - 46, -30)]:
            if rng.random() < 0.85:
                t = tape_strip(150, 46, seed=int(rng.integers(0, 999)), alpha=0.5).rotate(r + rng.normal(0, 5), expand=True, resample=Image.BICUBIC)
                img.alpha_composite(t, (max(0, x), max(0, y)))
    return img


def laminate(img_arr, seed=0):
    """Laminated menu: clear border, specular streak, a few bubbles, rounded corners (RGBA)."""
    h, w = img_arr.shape[:2]
    pad = 26
    H2, W2 = h + 2 * pad, w + 2 * pad
    out = np.ones((H2, W2, 3), f32) * np.array([0.86, 0.86, 0.84], f32)
    out[pad:pad + h, pad:pad + w] = img_arr
    yy, xx = np.mgrid[0:H2, 0:W2].astype(f32)
    spec = np.exp(-(((xx * 0.8 - yy) / W2 - 0.05) / 0.07) ** 2) * 0.10 + np.exp(-(((xx * 0.8 - yy) / W2 + 0.35) / 0.025) ** 2) * 0.07
    out = np.clip(out + spec[..., None], 0, 1)
    rng = np.random.default_rng(seed)
    for _ in range(5):
        cx, cy, r = rng.uniform(pad, W2 - pad), rng.uniform(pad, H2 - pad), rng.uniform(10, 26)
        d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / r
        out = np.clip(out + (np.exp(-((d - 0.9) / 0.1) ** 2) * 0.10)[..., None] - (np.exp(-((d - 1.05) / 0.06) ** 2) * 0.05)[..., None], 0, 1)
    al = Image.new("L", (W2, H2), 0)
    ImageDraw.Draw(al).rounded_rectangle((0, 0, W2 - 1, H2 - 1), radius=30, fill=255)
    img = to_img(out).convert("RGBA")
    img.putalpha(al)
    return img, pad


def save(img, name, note, regions=None, photos=None, **kw):
    path = OUT + name
    if name.endswith(".jpg"):
        img.convert("RGB").save(path, quality=88, optimize=True, progressive=True)
    else:
        img.save(path, optimize=True)
    MAN["files"][name] = dict(w=img.width, h=img.height, note=note, regions=regions or {}, sources=src_of(photos or []), **kw)


def hand_layer(w, h):
    return Image.new("L", (w, h), 0)


def hwrite(lay, x, base, text, font, size, seed, angle=0.0, jitter=1.0):
    f = F(font, size)
    wid = int(f.getlength(text) * 1.15 + size * 2)
    l2 = Image.new("L", (wid, int(size * 2.6)), 0)
    xe = hand_text(l2, (size * 0.3, size * 0.75), text, font, size, seed=seed, jitter=jitter, rot_var=3, size_var=0.06, baseline_wave=0.03)
    r = l2.rotate(angle, resample=Image.BICUBIC, expand=True, center=(size * 0.3, size * 0.75))
    dx, dy = (r.width - l2.width) / 2, (r.height - l2.height) / 2
    _max_paste(lay, r, int(x - size * 0.3 - dx), int(base - size * 0.75 - dy - size * 1.19))
    return x + xe - size * 0.3


# ================================================================== 1. laminated photo menu
DISHES = [
    ("กะเพราหมูสับ", "Holy basil pork", "photos/flickr_3369547949.jpg", (0.1, 0.0, 0.9, 0.75)),
    ("ไข่ดาว", "Fried egg", "photos/flickr_54642751606.jpg", (0.2, 0.0, 0.85, 0.8)),
    ("ไข่เจียว", "Omelette", "posters/dish_khai_jiao.jpg", (0.0, 0.1, 1.0, 0.8)),
    ("ข้าวผัด", "Fried rice", "posters/dish_khao_phat.jpg", (0.05, 0.0, 0.95, 1.0)),
    ("ผัดพริกแกง", "Red curry stir-fry", "posters/dish_phrik_kaeng.jpg", (0.0, 0.0, 1.0, 1.0)),
    ("ผัดซีอิ๊ว", "Pad see ew", "posters/dish_phat_si_io.jpg", (0.0, 0.0, 1.0, 1.0)),
    ("ราดหน้า", "Rad na", "posters/dish_rad_na.jpg", (0.0, 0.0, 1.0, 1.0)),
    ("ต้มยำกุ้ง", "Tom yum", "posters/dish_tom_yam.jpg", (0.05, 0.0, 0.95, 1.0)),
    ("หมูกระเทียม", "Garlic pork", "posters/dish_moo_krathiam.jpg", (0.0, 0.0, 1.0, 1.0)),
    ("ผัดผักบุ้ง", "Morning glory", "posters/dish_phak_bung.jpg", (0.0, 0.0, 1.0, 1.0)),
]
EX_PRICES = ["50", "10", "15", "50", "50", "50", "55", "80", "55", "40"]


def photo_menu(filled):
    W, H = 1448, 1024
    paper = mat("Paper001", H, W, "#FBFAF6", 0.4, seed=3)
    P = Press(W, H, seed=3)
    P.rect((0, 0, W, 150), "red")
    P.rect((0, 150, W, 162), "yellow")
    P.text((40, 110), "อาหารตามสั่ง", F("NotoSansThaiLooped@900w75", 104), "yellow", anchor="ls")
    P.text((W - 40, 72), "ร้านเฮียผัด", F("Chonburi-Regular", 58), None, anchor="rs")
    P.text((W - 40, 126), "สั่งได้ทุกอย่าง ไม่มีในเมนูก็ทำให้ (ถ้ามีของ)", F("Sarabun-Bold", 26), None, anchor="rs")
    cols, rows = 5, 2
    gx, gy, cw, chh, gap = 30, 186, (W - 60 - 4 * 18) / 5, 352, 18
    regions = {"slots": []}
    for i, (th, en, path, crop) in enumerate(DISHES):
        c, r = i % cols, i // cols
        x0 = gx + c * (cw + gap)
        y0 = gy + r * (chh + 24)
        P.rect((x0, y0, x0 + cw, y0 + chh), (0, 0, 0, 0.06), contone=True)
        P.image((x0 + 8, y0 + 8, x0 + cw - 8, y0 + 228), ph(path, crop), "cmyk", contrast=1.08)
        num = f"{i + 1}"
        P.rect((x0 + 8, y0 + 8, x0 + 52, y0 + 52), "red")
        P.text((x0 + 30, y0 + 31), num, F("NotoSansThaiLooped@900", 30), None, anchor="mm")
        P.text((x0 + 12, y0 + 280), th, F("NotoSansThaiLooped@800w87", 40), "K", anchor="ls", max_w=cw - 24)
        P.text((x0 + 12, y0 + 310), en, F("Trirong-Bold", 21), (0, 0, 0, 0.6), anchor="ls", contone=True, max_w=cw - 24)
        # price slot: yellow circle sticker printed with "บาท"
        pcx, pcy, pr = x0 + cw - 62, y0 + 222, 54
        circ = Image.new("L", (2 * pr + 2, 2 * pr + 2), 0)
        ImageDraw.Draw(circ).ellipse((0, 0, 2 * pr, 2 * pr), fill=255)
        P.mask(np.asarray(circ, f32) / 255, (pcx - pr, pcy - pr), "yellow")
        P.text((pcx, pcy + 34), "บาท", F("NotoSansThaiLooped@700", 20), "red", anchor="ms")
        reg = dict(dish=th, price=dict(x=int(pcx - pr + 10), y=int(pcy - pr + 14), w=int(2 * pr - 20), h=50, cx=int(pcx), cy=int(pcy - 8),
                   font="NotoSansThaiLooped@900w75", size=46, color="#D41E2A"), hit=dict(x=int(x0), y=int(y0), w=int(cw), h=int(chh)))
        regions["slots"].append(reg)
        if filled:
            P.text((pcx, pcy - 8), EX_PRICES[i], F("NotoSansThaiLooped@900w75", 50), "red", anchor="mm")
    # add-on strip
    yb = gy + 2 * (chh + 24) + 2
    P.rect((30, yb, W - 30, H - 20), "K")
    P.text((50, yb + 50), "เพิ่ม: ไข่ดาว +10   ไข่เจียว +15   พิเศษ +10   ข้าวเปล่า 10", F("NotoSansThaiLooped@800w87", 36), None, anchor="ls")
    P.text((W - 50, yb + 50), "ไม่เผ็ด / เผ็ดมาก บอกได้!", F("NotoSansThaiLooped@800w87", 32), "yellow", anchor="rs")
    out = gloss_print(P, paper, 4)
    img, pad = laminate(out, seed=5)
    for s in regions["slots"]:
        for k in ("price", "hit"):
            s[k]["x"] += pad
            s[k]["y"] += pad
        s["price"]["cx"] += pad
        s["price"]["cy"] += pad
    return img, regions


# ================================================================== 2. handwritten cardboard menu
CARD_ITEMS = ["กะเพราหมูสับ", "+ ไข่ดาว", "ไข่เจียว", "ข้าวผัด", "ผัดพริกแกง", "ต้มยำ"]


def cardboard_menu(filled):
    W, H = 1200, 1500
    base = mat("Cardboard002", H, W, None, seed=7, rot=True)
    base = np.clip(base * 1.05, 0, 1)
    rng = np.random.default_rng(3)
    lay = hand_layer(W, H)
    red = hand_layer(W, H)
    hwrite(lay, 120, 190, "เมนู", "Sriracha-Regular", 150, 1, angle=-3)
    hwrite(red, 520, 170, "อร่อย!!", "Sriracha-Regular", 96, 2, angle=-8)
    scribble(red, [(120, 230), (480, 238), (900, 222)], width=9, seed=3, jitter=3)
    regions = {"slots": []}
    y = 380
    for i, it in enumerate(CARD_ITEMS):
        xe = hwrite(lay, 110, y, it, "Sriracha-Regular", 84 if i != 1 else 70, 10 + i, angle=float(rng.normal(-1, 1.2)))
        # dotted leader drawn by hand
        for x in range(int(xe + 30), 820, 34):
            scribble(lay, [(x, y - 8), (x + 10, y - 9)], width=5, seed=40 + x)
        regions["slots"].append(dict(dish=it, price=dict(x=840, y=int(y - 90), w=300, h=110, baseline=int(y), font="Sriracha-Regular",
                                     size=96, color="#121214", style="marker, jitter + rotate -4..4 deg, then '.-'")))
        if filled:
            p = ["50", "10", "15", "50", "50", "80"][i]
            hwrite(red if i == 0 else lay, 860, y, p + ".-", "Sriracha-Regular", 96, 70 + i, angle=float(rng.normal(-2, 2)))
        y += 160
    hwrite(lay, 110, y + 60, "ไม่มีเงินทอนแบงค์พัน!", "Sriracha-Regular", 64, 90, angle=-2)
    scribble(red, [(100, y + 80), (820, y + 70)], width=7, seed=91, jitter=3)
    out = ink_composite(base, lay, "#141416", kind="marker", seed=5)
    out = ink_composite(out, red, "#C9161E", kind="marker", seed=6)
    out *= creases(H, W, 0.2, 9)[..., None]
    out = apply_stain(out, *stain_blob(H, W, 980, 1320, 90, seed=4, edge=0.9, fill=0.35, color="#6B4A28"))
    img = to_img(out).convert("RGBA")
    al = np.ones((H, W), f32)
    yy, xx = np.mgrid[0:H, 0:W].astype(f32)
    wob = fbm(H, W, 40, 3, 11) * 18
    al[(xx < 8 + wob * 0.5) | (xx > W - 10 - wob * 0.6) | (yy < 6 + wob * 0.4) | (yy > H - 8 - wob * 0.5)] = 0
    img.putalpha(Image.fromarray((ndi.gaussian_filter(al, 0.8) * 255).astype(np.uint8)))
    return img, regions


# ================================================================== 3. A-frame chalkboard face
def chalkboard(filled):
    W, H = 900, 1300
    im = ph("posters/chalkboard_real.jpg")
    base = to_arr(fit_image(im, W, H, "cover"))
    base = np.clip((base - 0.5) * 1.1 + 0.48, 0, 1)
    lay = hand_layer(W, H)
    yel = hand_layer(W, H)
    regions = {"slots": []}
    hwrite(lay, 90, 170, "วันนี้มี!", "Sriracha-Regular", 120, 1, angle=-4)
    scribble(yel, [(90, 210), (420, 214), (640, 200)], width=8, seed=2, jitter=3)
    y = 380
    for i, it in enumerate(["กะเพราหมูสับ", "ไข่ดาว", "ข้าวผัด", "ต้มยำ"]):
        hwrite(lay, 90, y, it, "Sriracha-Regular", 74, 10 + i, angle=-1.5)
        regions["slots"].append(dict(dish=it, price=dict(x=620, y=y - 80, w=230, h=100, baseline=y, font="Sriracha-Regular", size=80,
                                     color="#F2EFE6", style="chalk: draw then apply chalk texture (alpha noise)")))
        if filled:
            hwrite(yel, 640, y, ["50", "10", "50", "80"][i] + ".-", "Sriracha-Regular", 80, 20 + i, angle=-3)
        y += 150
    hwrite(lay, 90, y + 70, "อิ่มอร่อย ราคาเป็นกันเอง", "Itim-Regular", 56, 30, angle=-1)
    # doodles: chili + smiley
    scribble(yel, [(660, 1080), (700, 1050), (760, 1110), (720, 1180), (680, 1150), (660, 1080)], width=7, seed=41, jitter=2)
    scribble(lay, [(650, 1078), (628, 1040)], width=7, seed=42)
    for t0 in (0,):
        pts = [(220 + math.cos(t) * 70, 1130 + math.sin(t) * 70) for t in np.linspace(0, 2 * math.pi, 18)]
        scribble(lay, pts, width=6, seed=43, jitter=2)
    scribble(lay, [(190, 1110), (192, 1112)], width=10, seed=44)
    scribble(lay, [(250, 1110), (252, 1112)], width=10, seed=45)
    scribble(lay, [(180, 1150), (220, 1175), (262, 1150)], width=6, seed=46)
    out = ink_composite(base, lay, "#F3F1EA", kind="chalk", seed=7)
    out = ink_composite(out, yel, "#F6E27A", kind="chalk", seed=8)
    return to_img(out), regions


# ================================================================== 4. community posters
def poster_monday():
    W, H = 1024, 1448
    paper = mat("Paper001", H, W, "#FCFBF7", 0.3, seed=21)
    P = Press(W, H, seed=21)
    P.image((0, 0, W, H), ph("posters/roses_yellow.jpg"), "cmyk", contrast=1.1, bright=0.03, focus=(0.5, 0.5))
    # glow panel behind text
    pan = np.zeros((520, W), f32)
    pan[:] = np.linspace(0.0, 0.75, 520, dtype=f32)[::-1, None] * 0 + 0.55
    P.mask(blur(np.pad(np.ones((360, W - 120), f32), 60), 30)[:520, :W] * 0.5, (0, 40), (0, 0, 0, 0.0), contone=True)
    t1 = F("Charmonman-Bold", 170)
    for dx, dy in ((6, 6),):
        P.text((W / 2 + dx, 210 + dy), "สวัสดี", t1, (0.7, 0.9, 0, 0.5), anchor="mm", contone=True, stroke=10)
    P.text((W / 2, 210), "สวัสดี", t1, "white", anchor="mm", stroke=14)
    P.text((W / 2, 210), "สวัสดี", t1, "magenta", anchor="mm")
    t2 = F("Charmonman-Bold", 150)
    P.text((W / 2, 400), "วันจันทร์", t2, "white", anchor="mm", stroke=14)
    P.text((W / 2, 400), "วันจันทร์", t2, (0, 0.2, 1, 0), anchor="mm")
    blessings = ["ขอให้มีความสุข สุขภาพแข็งแรง", "ร่ำรวยเงินทอง ค้าขายร่ำรวย", "คิดสิ่งใดสมปรารถนานะคะ"]
    y = H - 330
    for b in blessings:
        P.text((W / 2, y), b, F("Srisakdi-Bold", 62), "white", anchor="mm", stroke=9)
        P.text((W / 2, y), b, F("Srisakdi-Bold", 62), (0.85, 0.1, 0.0, 0.3), anchor="mm")
        y += 96
    # sparkles
    rng = np.random.default_rng(3)
    for _ in range(40):
        x, yy, r = rng.uniform(40, W - 40), rng.uniform(40, H - 40), rng.uniform(6, 22)
        im = Image.new("L", (int(r * 4), int(r * 4)), 0)
        d = ImageDraw.Draw(im)
        c = r * 2
        d.polygon([(c, 0), (c + r * 0.25, c - r * 0.25), (4 * r, c), (c + r * 0.25, c + r * 0.25), (c, 4 * r), (c - r * 0.25, c + r * 0.25),
                   (0, c), (c - r * 0.25, c - r * 0.25)], fill=255)
        P.mask(np.asarray(im, f32) / 255, (x - c, yy - c), "white")
    out = gloss_print(P, paper, 22, cell=2.2)
    return wall_wear(out, seed=23, fade=0.12, crease=0.2), ["posters/roses_yellow.jpg"]


def tear_tabs(P, y0, H, W, text, n=8, cmyk="K", font="Sarabun-Bold"):
    tw = W / n
    for i in range(n):
        x0 = i * tw
        P.rect((x0, y0, x0 + 2, H), cmyk)
        im = Image.new("L", (int(H - y0), int(tw)), 0)
        m, info = P.text_mask(text, F(font, 26))
        mi = Image.fromarray((m * 255).astype(np.uint8)).rotate(90, expand=True)
        P.mask(np.asarray(mi, f32) / 255, (x0 + tw / 2 - mi.width / 2, y0 + 14), cmyk)


def poster_missing_dog():
    W, H = 1024, 1448
    paper = mat("Paper001", H, W, "#F7F6F1", 0.4, seed=31)
    P = Press(W, H, seed=31)
    P.text((W / 2, 150), "หมาหาย!!", F("NotoSansThaiLooped@900w75", 190), "K", anchor="mm")
    P.image((90, 270, W - 90, 840), ph("photos/flickr_2754634061.jpg", (0.0, 0.05, 1.0, 0.75)), "k", contrast=1.2)
    P.rect((90, 270, W - 90, 274), "K"); P.rect((90, 836, W - 90, 840), "K")
    lines = [("ชื่อ \"เจ้าตูบ\" เพศผู้ สีน้ำตาลขาว หางงอ", 44), ("ชอบกินหมูสับ (กินของร้านเฮียผัดหมดถุง)", 40),
             ("หายแถวซอยเก้า ใกล้ร้าน 8-Twelve", 40), ("ใครพบเห็น กรุณาติดต่อ ให้รางวัล 500 บาท!!", 44)]
    y = 920
    for t, s in lines:
        P.text((W / 2, y), t, F("Sarabun-ExtraBold", s), "K", anchor="mm", max_w=W - 120)
        y += 72
    tear_tabs(P, H - 210, H, W, "เจ้าตูบ โทร 08x-xxx-xxxx", n=8)
    white = np.ones((H, W, 3), f32)
    out = P.composite(white, cell=3.0, misreg=((0, 0),) * 4, spread=0.5)
    out = photocopy(out, seed=32) * paper
    img = wall_wear(out, seed=33, fade=0.1, torn=True)
    # two tabs already torn off
    al = np.asarray(img.getchannel("A")).copy()
    tw = W / 8
    for i in (2, 5):
        al[H - 205:, int(i * tw + 3):int((i + 1) * tw - 1)] = 0
    img.putalpha(Image.fromarray(al))
    return img, ["photos/flickr_2754634061.jpg"]


def poster_room():
    W, H = 1024, 1448
    paper = mat("Paper001", H, W, "#F8F7F2", 0.4, seed=41)
    P = Press(W, H, seed=41)
    P.text((W / 2, 160), "ห้องว่าง", F("NotoSansThaiLooped@900w75", 210), "red", anchor="mm")
    P.text((W / 2, 330), "ให้เช่า", F("NotoSansThaiLooped@900w75", 170), "red", anchor="mm")
    P.image((110, 440, W - 110, 860), ph("ads/apartment_facade.jpg"), "cmyk", contrast=1.1)
    feats = ["✓ แอร์ ✓ เฟอร์ฯ ✓ น้ำอุ่น ✓ WiFi ฟรี", "ใกล้ 8-Twelve ใกล้วินมอไซค์ ปากซอยเก้า", "รายเดือน 3,500.- (น้ำไฟตามมิเตอร์)", "ไม่รับสัตว์เลี้ยง (หมาจรก็ไม่รับ)"]
    y = 940
    for t in feats:
        P.text((W / 2, y), t, F("Sarabun-ExtraBold", 44), "K", anchor="mm", max_w=W - 100)
        y += 70
    tear_tabs(P, H - 200, H, W, "ห้องเช่า 08x-xxx-xxxx", n=8, cmyk="red")
    out = gloss_print(P, paper, 42, cell=3.2)
    return wall_wear(out, seed=43, fade=0.35), ["ads/apartment_facade.jpg"]


def poster_lottery():
    W, H = 1024, 1448
    paper = mat("Paper001", H, W, "#FBF9F2", 0.3, seed=51)
    P = Press(W, H, seed=51)
    P.rect((0, 0, W, H), (0, 0.15, 0.9, 0))
    P.image((0, 520, W, 1060), ph("ads/lottery_tickets.jpg"), "cmyk", contrast=1.1)
    P.text((W / 2, 140), "สลากกินแบ่ง", F("Taviraj-Black", 130), "red", anchor="mm")
    P.text((W / 2, 300), "มีมาใหม่!", F("NotoSansThaiLooped@900w75", 150), "K", anchor="mm")
    P.text((W / 2, 440), "งวด 1 และ 16 ทุกเดือน · ใบละ 80 บาท", F("Sarabun-ExtraBold", 46), "K", anchor="mm")
    P.rect((60, 1100, W - 60, 1300), "red")
    P.text((W / 2, 1170), "เลขเด็ด! เลขสวย! เลขต้นกล้วย!", F("NotoSansThaiLooped@900w75", 66), "yellow", anchor="mm")
    P.text((W / 2, 1250), "ถูกแล้วอย่าลืมทำบุญ", F("Sarabun-ExtraBold", 44), None, anchor="mm")
    P.text((W / 2, H - 60), "ซื้อพอประมาณ อย่าเอาเงินค่าไข่ไปซื้อหมด", F("Sarabun-Bold", 30), "K", anchor="mm")
    out = gloss_print(P, paper, 52)
    return wall_wear(out, seed=53, fade=0.2), ["ads/lottery_tickets.jpg"]


def poster_temple_fair():
    W, H = 1024, 1448
    paper = mat("Paper001", H, W, "#FBFAF5", 0.3, seed=61)
    P = Press(W, H, seed=61)
    P.rect((0, 0, W, H), (0.9, 0.95, 0, 0.35))
    P.image((0, 380, W, 1000), ph("posters/night_fair.jpg"), "cmyk", contrast=1.15, bright=0.05)
    P.text((W / 2, 110), "งานประจำปี", F("Chonburi-Regular", 100), "yellow", anchor="mm")
    P.text((W / 2, 250), "วัดศรีซอยเก้า", F("Taviraj-Black", 130), None, anchor="mm", stroke=4)
    P.text((W / 2, 250), "วัดศรีซอยเก้า", F("Taviraj-Black", 130), "red", anchor="mm")
    P.text((W / 2, 345), "ขอเชิญร่วมทำบุญ 3 คืน 3 วัน", F("Sarabun-ExtraBold", 46), None, anchor="mm")
    items = ["ชิงช้าสวรรค์ · ปาเป้า · ตกปลา · บ้านผีสิง", "ลิเกคณะดาวรุ่งซอยเก้า · หนังกลางแปลง", "รำวงย้อนยุค · ขนมโตเกียว · ไอติมกะทิ"]
    y = 1080
    for t in items:
        P.text((W / 2, y), t, F("Sarabun-ExtraBold", 42), "yellow", anchor="mm", max_w=W - 80)
        y += 70
    P.rect((0, H - 180, W, H), "red")
    P.text((W / 2, H - 112), "15–17 พฤศจิกายน 2569", F("NotoSansThaiLooped@900w75", 70), "yellow", anchor="mm")
    P.text((W / 2, H - 46), "แต่งกายสุภาพ งดเครื่องดื่มแอลกอฮอล์ในเขตวัด", F("Sarabun-Bold", 30), None, anchor="mm")
    out = gloss_print(P, paper, 62, cell=3.0)
    return wall_wear(out, seed=63, fade=0.25), ["posters/night_fair.jpg"]


def poster_molam():
    W, H = 1024, 1448
    paper = mat("Paper001", H, W, "#FBFAF5", 0.3, seed=71)
    P = Press(W, H, seed=71)
    P.image((0, 0, W, 900), ph("posters/concert_stage.jpg"), "cmyk", contrast=1.2)
    P.rect((0, 900, W, H), (0.0, 1.0, 0.2, 0.15))
    P.text((W / 2, 120), "หมอลำซิ่ง!!", F("NotoSansThaiLooped@900w75", 160), "yellow", anchor="mm", stroke=6)
    P.text((W / 2, 120), "หมอลำซิ่ง!!", F("NotoSansThaiLooped@900w75", 160), "red", anchor="mm")
    P.text((W / 2, 260), "คณะเสียงแคนแสนซิ่ง", F("Pattaya-Regular", 96), None, anchor="mm", stroke=4)
    P.text((W / 2, 260), "คณะเสียงแคนแสนซิ่ง", F("Pattaya-Regular", 96), "yellow", anchor="mm")
    singers = [("น้องแพรวพราว ลำซิ่ง", "yellow"), ("บักเสือ สะออน", None), ("พี่แป๋ว แคนทองคำ", "yellow")]
    y = 980
    for t, c in singers:
        P.text((W / 2, y), t, F("Taviraj-Black", 70), c, anchor="mm")
        y += 92
    P.rect((60, 1250, W - 60, 1330), "yellow")
    P.text((W / 2, 1292), "ลานวัดศรีซอยเก้า · ส. 21 พ.ย. · 2 ทุ่มเป็นต้นไป", F("NotoSansThaiLooped@800w87", 40), "red", anchor="mm", max_w=W - 140)
    P.text((W / 2, 1395), "บัตรผ่านประตู 100.- · เด็กต่ำกว่า 120 ซม. ฟรี · ม่วนซื่น โฮแซว!", F("Sarabun-ExtraBold", 34), None, anchor="mm", max_w=W - 60)
    out = gloss_print(P, paper, 72, cell=3.0)
    return wall_wear(out, seed=73, fade=0.3, torn=True), ["posters/concert_stage.jpg"]


def poster_hippo():
    W, H = 1024, 1448
    paper = mat("Paper001", H, W, "#FFFDF8", 0.3, seed=81)
    P = Press(W, H, seed=81)
    P.rect((0, 0, W, H), (0, 0.32, 0.12, 0))
    P.image((70, 300, W - 70, 1000), ph("photos/flickr_5061983744.jpg"), "cmyk", contrast=1.15, bright=0.06, focus=(0.45, 0.5))
    P.text((W / 2, 130), "น้องหมูดึ๋ง", F("Chonburi-Regular", 140), None, anchor="mm", stroke=8)
    P.text((W / 2, 130), "น้องหมูดึ๋ง", F("Chonburi-Regular", 140), "magenta", anchor="mm")
    P.text((W / 2, 240), "ฮิปโปแคระ เด้งดึ๋ง ขวัญใจทั้งซอย", F("NotoSansThaiLooped@800w87", 48), "K", anchor="mm")
    P.text((W / 2, 1090), "ใจฟู! ดึ๋งๆ ทั้งวัน", F("NotoSansThaiLooped@900w75", 90), None, anchor="mm", stroke=6)
    P.text((W / 2, 1090), "ใจฟู! ดึ๋งๆ ทั้งวัน", F("NotoSansThaiLooped@900w75", 90), "magenta", anchor="mm")
    P.text((W / 2, 1210), "กินแตงโม งับรองเท้าพี่เลี้ยง นอนแช่น้ำ", F("Sarabun-ExtraBold", 44), "K", anchor="mm")
    P.text((W / 2, 1300), "ห้ามป้อนกะเพรา! (เผ็ด)", F("Sarabun-ExtraBold", 50), "red", anchor="mm")
    out = gloss_print(P, paper, 82, cell=2.6)
    return wall_wear(out, seed=83, fade=0.1), ["photos/flickr_5061983744.jpg"]


# ================================================================== 5. 8-Twelve promos
def eight_twelve_band(P, W, y=0, h=70):
    P.rect((0, y, W, y + h * 0.34), "orange")
    P.rect((0, y + h * 0.34, W, y + h * 0.67), "green")
    P.rect((0, y + h * 0.67, W, y + h), "red")


def promo(kind):
    W, H = 1024, 1448
    paper = mat("Paper001", H, W, "#FBFAF6", 0.3, seed=91)
    P = Press(W, H, seed=91 + len(kind))
    eight_twelve_band(P, W, 0, 90)
    P.rect((40, 110, 380, 200), "white")
    P.text((60, 175), "8-Twelve", F("Trirong-Black", 62), "green", anchor="ls")
    P.text((W - 40, 175), "อิ่มง่าย ใกล้บ้าน 24 ชม.", F("NotoSansThaiLooped@800w87", 40), "K", anchor="rs")
    if kind == "sausage":
        photo, crop = "posters/sausages_grill.jpg", None
        title, sub, price, note = "ไส้กรอกจัมโบ้", "ชิ้นที่ 2 ลดครึ่งราคา!", "35.-", "*เฉพาะสาขาซอยเก้า ไส้กรอกหมด = หมด"
    elif kind == "thai_tea":
        photo, crop = "posters/thai_tea.jpg", (0.0, 0.1, 1.0, 0.85)
        title, sub, price, note = "ชาไทยเย็น", "หวานเย็นชื่นใจ แก้ร้อน 38°", "15.-", "*น้ำแข็งเยอะ ไม่ได้ตั้งใจ"
    else:
        photo, crop = "photos/flickr_3369547949.jpg", (0.05, 0.0, 0.95, 0.85)
        title, sub, price, note = "ข้าวกะเพราหมูสับ", "อุ่นร้อน 2 นาที (ของเฮียผัดอร่อยกว่า)", "39.-", "*ไข่ดาวไม่รวม ไข่ดาวต้องไปร้านเฮียผัด"
    P.image((0, 230, W, 1000), ph(photo, crop), "cmyk", contrast=1.1, bright=0.03)
    P.rect((0, 1000, W, H - 90), "white")
    P.text((50, 1130), title, F("NotoSansThaiLooped@900w75", 110), "K", anchor="ls", max_w=W - 330)
    P.text((50, 1215), sub, F("NotoSansThaiLooped@800w87", 48), "red", anchor="ls", max_w=W - 330)
    # price burst
    r = 150
    cx, cy = W - 175, 1130
    pts = []
    for k in range(40):
        a = k * math.pi / 20
        rr = r if k % 2 == 0 else r * 0.86
        pts.append((r + rr * math.cos(a), r + rr * math.sin(a)))
    im = Image.new("L", (2 * r + 2, 2 * r + 2), 0)
    ImageDraw.Draw(im).polygon(pts, fill=255)
    P.mask(np.asarray(im, f32) / 255, (cx - r, cy - r), "red")
    P.text((cx, cy - 40), "เพียง", F("NotoSansThaiLooped@800", 40), "yellow", anchor="mm")
    P.text((cx, cy + 30), price, F("NotoSansThaiLooped@900w75", 110), None, anchor="mm")
    P.text((50, H - 120), note, F("Sarabun-SemiBold", 28), "K", anchor="ls")
    eight_twelve_band(P, W, H - 90, 90)
    out = gloss_print(P, paper, 93 + len(kind))
    img = to_img(out * creases(H, W, 0.1, 94)[..., None]).convert("RGBA")
    return img, [photo]


def main():
    os.makedirs(OUT, exist_ok=True)
    for filled in (False, True):
        img, reg = photo_menu(filled)
        save(img, f"menu_laminated_photo{'_example' if filled else ''}.png",
             "laminated อาหารตามสั่ง photo menu (10 dishes). Game draws prices in regions.slots[].price (yellow circles)", reg,
             [d[2] for d in DISHES], kind="menu_photo")
        img, reg = cardboard_menu(filled)
        save(img, f"menu_cardboard_handwritten{'_example' if filled else ''}.png",
             "hand-written marker menu on real corrugated cardboard; game writes prices with Sriracha + jitter", reg, [], kind="menu_cardboard")
        img, reg = chalkboard(filled)
        save(img, f"aframe_chalkboard{'_example' if filled else ''}.jpg",
             "A-frame chalkboard face (real chalkboard photo); game writes chalk prices", reg, ["posters/chalkboard_real.jpg"], kind="menu_chalkboard")
        print("menus", filled)
    for fn, name, note in [(poster_monday, "poster_sawasdee_wan_jan.png", "auntie LINE-style 'Happy Monday' flower greeting, printed and taped up"),
                           (poster_missing_dog, "poster_missing_dog.png", "photocopied missing-dog poster with tear-off tabs (2 torn)"),
                           (poster_room, "poster_room_for_rent.png", "ห้องว่างให้เช่า poster with tear-off tabs"),
                           (poster_lottery, "poster_lottery.png", "lottery seller poster"),
                           (poster_temple_fair, "poster_temple_fair.png", "งานวัด temple fair poster (respectful)"),
                           (poster_molam, "poster_molam_concert.png", "mo lam concert poster, made-up troupe & singers"),
                           (poster_hippo, "poster_hippo_moodueng.png", "cute pygmy-hippo poster, parody name 'น้องหมูดึ๋ง'")]:
        img, photos = fn()
        save(img, name, note, None, photos, kind="community_poster")
        print(name)
    for k in ("sausage", "thai_tea", "kaprao"):
        img, photos = promo(k)
        save(img, f"promo_8twelve_{k}.png", f"8-Twelve in-store promo ({k})", None, photos, kind="store_promo")
    # web size: palette-quantise big PNGs with alpha kept
    for name in list(MAN["files"]):
        if name.endswith(".png"):
            p = OUT + name
            im = Image.open(p).convert("RGBA")
            q = im.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG)
            q.save(p, optimize=True)
    with open(OUT + "manifest.json", "w", encoding="utf-8") as f:
        json.dump(MAN, f, ensure_ascii=False, indent=1)
    print("done", sorted(ph.used))


if __name__ == "__main__":
    main()
