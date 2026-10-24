"""ซอยเก๋ SOI-KAY: parody Thai street-fashion magazine kit -> public/assets/img/magazine/
Run: python3 -I scripts/research/R4/build_magazine.py
Built from REAL photos (references/ui/_raw/mag, Flickr, see credits) + a real coated-paper scan
(ambientCG Paper001, CC0) + looped Thai fonts (Trirong / Taviraj / Noto Sans Thai Looped / Sarabun / Sriracha)."""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from printfx import *  # noqa
from build_newspaper import fit_line_var, para

ROOT = "/home/user/special-telegram"
RAW = ROOT + "/references/ui/_raw/mag/"
ACG = ROOT + "/references/ui/_raw/acg/"
OUT = ROOT + "/public/assets/img/magazine/"
PW, PH = 1024, 1448          # one page
SW, SH = 2 * PW, PH          # spread
CELL = 2.4                   # fine AM screen for coated stock
INK = INKS_GLOSS
LAYOUT = {"page": {"w": PW, "h": PH}, "spread": {"w": SW, "h": SH}, "cover": {}, "spreads": {}, "tabs": {}, "parts": {}}

SRC = {}  # photo name -> source (filled from _sources.tsv)
for line in open(RAW + "_sources.tsv", encoding="utf-8"):
    p = line.rstrip("\n").split("\t")
    if len(p) >= 4:
        SRC[p[0].rsplit(".", 1)[0]] = dict(url=p[1], author=p[2], license=p[3])
USED = set()


def photo(name, crop=None):
    USED.add(name)
    im = Image.open(RAW + name + ".jpg").convert("RGB")
    if crop:
        w, h = im.size
        im = im.crop((int(crop[0] * w), int(crop[1] * h), int(crop[2] * w), int(crop[3] * h)))
    return im


def boost(im, sat=1.18, con=1.06):
    a = to_arr(im)
    g = gray_of(a)[..., None]
    a = np.clip(g + (a - g) * sat, 0, 1)
    a = np.clip((a - 0.5) * con + 0.5, 0, 1)
    return to_img(a)


# ------------------------------------------------------------------ paper
def coated_paper(h, w, seed=0, tone="#F7F6F2", strength=0.35):
    tex = to_arr(Image.open(ACG + "Paper001/Paper001_2K-JPG_Color.jpg"))
    th, tw = tex.shape[:2]
    big = np.tile(tex, (h // th + 2, w // tw + 2, 1))
    rng = np.random.default_rng(seed)
    oy, ox = rng.integers(0, th), rng.integers(0, tw)
    a = big[oy:oy + h, ox:ox + w]
    det = a / np.maximum(blur(a, 30), 1e-3)
    out = np.array(hexrgb(tone), f32)[None, None] * (1 + (det - 1) * strength)
    return np.clip(out, 0, 1).astype(f32)


def print_page(P, paper, seed=1):
    return P.composite(paper, inks=INK, cell=CELL, misreg=((0.5, -0.3), (-0.4, 0.4), (0.3, 0.5), (0, 0)),
                       spread=0.35, density=(0.96, 1.0), rough=0.04, seed=seed, gain=0.08, max_k=0.97)


# ------------------------------------------------------------------ helpers
def text_block(P, box, text, font, size, lead, cmyk="K", justify=False):
    return para(P, box, text, font, size, lead, cmyk, justify=justify)


def ean13_bits(d12):
    L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"]
    G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"]
    R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"]
    PAR = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"]
    d = [int(c) for c in d12]
    s = sum(v * (3 if i % 2 else 1) for i, v in enumerate(d))
    d.append((10 - s % 10) % 10)
    par = PAR[d[0]]
    bits = "101" + "".join((L if par[i] == "L" else G)[d[1 + i]] for i in range(6)) + "01010" + \
           "".join(R[d[7 + i]] for i in range(6)) + "101"
    return bits, "".join(map(str, d))


def barcode(P, x, y, mod=2, h=90, digits12="885555500006", addon="06"):
    bits, full = ean13_bits(digits12)
    guard = {0, 1, 2, 45, 46, 47, 48, 49, 92, 93, 94}
    x0 = x + 7 * mod
    P.rect((x, y - 4, x0 + 95 * mod + 30 * mod, y + h + 26), "white")
    for i, b in enumerate(bits):
        if b == "1":
            hh = h + (10 if i in guard else 0)
            P.rect((x0 + i * mod, y, x0 + (i + 1) * mod, y + hh), "K")
    f = F("Sarabun-SemiBold", int(mod * 9))
    P.text((x + 1, y + h + 18), full[0], f, "K", anchor="ls")
    P.text((x0 + 3 * mod + 21 * mod, y + h + 18), full[1:7], f, "K", anchor="ms")
    P.text((x0 + 50 * mod + 21 * mod, y + h + 18), full[7:], f, "K", anchor="ms")
    # 2-digit add-on (issue number), as on real magazines
    ax = x0 + 95 * mod + 9 * mod
    add_bits = "1011" + ("0001101" if addon[0] == "0" else "0011001") + "01" + ("0100111" if addon[1] == "6" else "0110011")
    for i, b in enumerate(add_bits):
        if b == "1":
            P.rect((ax + i * mod, y + 14, ax + (i + 1) * mod, y + h + 10), "K")
    P.text((ax + 10 * mod, y + 10), addon, F("Sarabun-SemiBold", int(mod * 8)), "K", anchor="ms")
    return full


def sticker_img(kind, size=220, seed=0):
    """Glossy die-cut price sticker (RGBA). Printed on real paper texture."""
    s = size
    pad = 14
    W = s + 2 * pad
    mask = Image.new("L", (W, W), 0)
    d = ImageDraw.Draw(mask)
    cx = cy = W / 2
    if kind in ("sale50", "new"):
        pts = []
        n = 16
        for k in range(n * 2):
            a = k * math.pi / n
            r = s / 2 if k % 2 == 0 else s / 2 * 0.84
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
        d.polygon(pts, fill=255)
    else:
        d.ellipse((pad, pad, pad + s, pad + s), fill=255)
    m = np.asarray(mask, f32) / 255
    paper = coated_paper(W, W, seed=seed, tone="#FBFAF6", strength=0.5)
    P = Press(W, W, seed=seed)
    col = {"p99": "red", "p59": "red", "p20": "yellow", "p199": "K", "sale50": "yellow", "new": "magenta", "hot": "orange"}[kind]
    P.mask(m, (0, 0), col)
    tcol = "K" if col == "yellow" else None
    if kind.startswith("p"):
        val = kind[1:]
        P.text((cx, cy - s * 0.17), "ราคา", F("NotoSansThaiLooped@800", int(s * 0.14)), tcol, anchor="mm")
        P.text((cx, cy + s * 0.10), "฿" + val, F("NotoSansThaiLooped@900w75", int(s * 0.36)), tcol, anchor="mm")
        P.text((cx, cy + s * 0.33), "เท่านั้น!", F("NotoSansThaiLooped@700", int(s * 0.11)), tcol, anchor="mm")
    elif kind == "sale50":
        P.text((cx, cy - s * 0.15), "ลด", F("NotoSansThaiLooped@900", int(s * 0.2)), "red", anchor="mm")
        P.text((cx, cy + s * 0.12), "50%", F("NotoSansThaiLooped@900w75", int(s * 0.34)), "red", anchor="mm")
    elif kind == "new":
        P.text((cx, cy - s * 0.02), "ใหม่!", F("NotoSansThaiLooped@900", int(s * 0.3)), None, anchor="mm")
        P.text((cx, cy + s * 0.23), "NEW", F("Trirong-Black", int(s * 0.13)), None, anchor="mm", tracking=4)
    elif kind == "hot":
        P.text((cx, cy - s * 0.06), "ขายดี", F("NotoSansThaiLooped@900", int(s * 0.26)), None, anchor="mm")
        P.text((cx, cy + s * 0.2), "BEST SELLER", F("Trirong-Black", int(s * 0.09)), None, anchor="mm", tracking=2)
    # thin white keyline inside the edge
    inner = ndi.binary_erosion(m > 0.5, iterations=int(s * 0.04)) & ~ndi.binary_erosion(m > 0.5, iterations=int(s * 0.055))
    P.mask(inner.astype(f32), (0, 0), "white")
    out = print_page(P, paper, seed)
    # gloss: soft diagonal highlight
    yy, xx = np.mgrid[0:W, 0:W].astype(f32)
    hl = np.exp(-(((xx - yy) / W + 0.25) / 0.18) ** 2) * 0.10
    out = np.clip(out + hl[..., None], 0, 1)
    # drop shadow + alpha
    sh = ndi.gaussian_filter(np.roll(np.roll(m, 4, 0), 3, 1), 3.5) * 0.45
    alpha = np.maximum(m, sh)
    rgb = np.where(m[..., None] > 0.01, out, 0.05)
    rgb = rgb * (m[..., None] / np.maximum(alpha[..., None], 1e-3)) + 0.05 * (1 - m[..., None] / np.maximum(alpha[..., None], 1e-3))
    return Image.fromarray((np.dstack([np.clip(rgb, 0, 1), np.clip(alpha, 0, 1)]) * 255).astype(np.uint8), "RGBA")


def sticky_tex():
    """Real sticky-note paper texture (yellow flat area of the photo), normalised to neutral luminance detail."""
    im = to_arr(photo("sticky_note"))
    h, w = im.shape[:2]
    patch = im[int(h * 0.55):int(h * 0.8), int(w * 0.35):int(w * 0.75)]
    g = gray_of(patch)
    det = g / np.maximum(blur(g, 25), 1e-3)
    return det


TAB_COLS = {"tops": "#FFE45C", "bottoms": "#7FD3F0", "shoes": "#FF9CC2", "accessories": "#A8E66B", "face_hair": "#FFB25C", "skin": "#C9A8F2"}
TAB_LABELS = {"tops": "เสื้อ", "bottoms": "กางเกง", "shoes": "รองเท้า", "accessories": "เครื่องประดับ", "face_hair": "หน้า/ผม", "skin": "สีผิว"}


def tab_img(key, w=200, h=118, seed=0, active=False):
    det = sticky_tex()
    rng = np.random.default_rng(seed)
    dh, dw = det.shape
    oy, ox = rng.integers(0, max(1, dh - h)), rng.integers(0, max(1, dw - w))
    d = np.ones((h, w), f32)
    pd = det[oy:oy + h, ox:ox + w]
    d[:pd.shape[0], :pd.shape[1]] = pd
    col = np.array(hexrgb(TAB_COLS[key]), f32)
    rgb = col[None, None] * (1 + (d[..., None] - 1) * 1.6)
    # adhesive strip (slightly darker, the part stuck under the page) on the left 28 %
    xx = np.arange(w)[None, :].astype(f32)
    rgb *= (1 - 0.06 * (xx < w * 0.28))[..., None]
    # curl: right end lifts -> lighter + shadow line
    rgb *= (1 + 0.05 * smoothstep(w * 0.7, w, xx))[..., None]
    lay = Image.new("L", (w, h), 0)
    lab = TAB_LABELS[key]
    fs = int(h * 0.36)
    while F("Sriracha-Regular", fs).getlength(lab) > w * 0.60 and fs > 14:
        fs -= 1
    hand_text(lay, (w * 0.33, h * 0.5 - fs * 0.55), lab, "Sriracha-Regular", fs, seed=seed + 3, jitter=1.0, rot_var=2.5)
    rgb = ink_composite(np.clip(rgb, 0, 1), lay, "#1D1F2A", kind="marker", seed=seed)
    alpha = np.ones((h, w), f32)
    # slightly irregular cut on the free end
    prof = np.cumsum(rng.normal(0, 0.4, h))
    prof = (prof - prof.min()) / (np.ptp(prof) + 1e-6) * 3
    for y in range(h):
        alpha[y, w - int(prof[y]) - 1:] = 0
    if active:
        rgb = np.clip(rgb * 1.04 + 0.02, 0, 1)
    # shadow below
    pad = 10
    A = np.zeros((h + pad, w + pad), f32)
    A[pad // 2 + 3:pad // 2 + 3 + h, pad // 2 + 2:pad // 2 + 2 + w] = alpha * 0.35
    A = ndi.gaussian_filter(A, 2.5)
    RGB = np.zeros((h + pad, w + pad, 3), f32)
    A2 = A.copy()
    RGB[pad // 2:pad // 2 + h, pad // 2:pad // 2 + w] = rgb
    A2[pad // 2:pad // 2 + h, pad // 2:pad // 2 + w] = np.maximum(A2[pad // 2:pad // 2 + h, pad // 2:pad // 2 + w], alpha)
    return Image.fromarray((np.dstack([RGB, A2]) * 255).astype(np.uint8), "RGBA")


def marker_mark(kind, seed=0):
    """Hand-drawn red marker marks (RGBA) — a reader circled stuff in the magazine."""
    W, H = {"circle": (360, 260), "arrow": (300, 200), "underline": (380, 60), "heart": (160, 150), "note_this": (360, 130),
            "cross": (160, 160), "star": (170, 170)}[kind]
    lay = Image.new("L", (W, H), 0)
    rng = np.random.default_rng(seed)
    if kind == "circle":
        pts = []
        for t in np.linspace(0, 2 * math.pi * 1.12, 26):
            pts.append((W / 2 + math.cos(t + 0.3) * (W * 0.44 + rng.normal(0, 4)), H / 2 + math.sin(t + 0.3) * (H * 0.40 + rng.normal(0, 4))))
        scribble(lay, pts, width=7, seed=seed, jitter=2.5)
    elif kind == "arrow":
        scribble(lay, [(20, H * 0.75), (W * 0.35, H * 0.45), (W * 0.65, H * 0.35), (W - 40, H * 0.28)], width=7, seed=seed)
        scribble(lay, [(W - 95, H * 0.12), (W - 40, H * 0.28), (W - 105, H * 0.5)], width=7, seed=seed + 1)
    elif kind == "underline":
        scribble(lay, [(10, 30), (W * 0.3, 36), (W * 0.6, 26), (W - 10, 34)], width=8, seed=seed)
        scribble(lay, [(30, 46), (W * 0.5, 40), (W - 40, 48)], width=6, seed=seed + 1)
    elif kind == "heart":
        pts = [(80, 140), (20, 70), (30, 25), (70, 25), (80, 55), (92, 22), (135, 25), (145, 70), (80, 140)]
        scribble(lay, pts, width=7, seed=seed, jitter=1.5)
    elif kind == "cross":
        scribble(lay, [(20, 20), (140, 140)], width=9, seed=seed)
        scribble(lay, [(140, 22), (22, 138)], width=9, seed=seed + 1)
    elif kind == "star":
        pts = []
        for k in range(11):
            a = -math.pi / 2 + k * 4 * math.pi / 5
            pts.append((85 + 70 * math.cos(a), 88 + 70 * math.sin(a)))
        scribble(lay, pts, width=6, seed=seed, jitter=2)
    elif kind == "note_this":
        hand_text(lay, (14, 30), "อันนี้แหละ!!", "Sriracha-Regular", 70, seed=seed, jitter=1.1, rot_var=4)
    a = np.asarray(lay, f32) / 255
    a = np.clip(ndi.gaussian_filter(a, 0.7) * 1.1, 0, 1)
    n = fbm(H, W, 30, 3, seed)
    a = a * (0.82 + 0.18 * n)
    col = np.array(hexrgb("#D8202A"), f32)
    rgb = np.ones((H, W, 3), f32) * col
    rgb *= (0.85 + 0.15 * n)[..., None]
    return Image.fromarray((np.dstack([rgb, a]) * 255).astype(np.uint8), "RGBA")


# ------------------------------------------------------------------ page templates
CATS = [
    # key, Thai, English, kicker, photo, crop, pull-quote
    ("tops", "เสื้อ", "TOPS", "เสื้อกล้าม เชิ้ตลายดอก ยืดคอกลม ฮิตทั้งซอย", "clothes_alley_pratunam", (0.0, 0.05, 1.0, 0.75),
     "“ร้อนแค่ไหน เสื้อกล้ามก็เอาอยู่”"),
    ("bottoms", "กางเกง", "BOTTOMS", "ขาสั้น ขาก๊วย กางเกงเล ใส่สบาย รับลมร้อน", "clothes_alley2", (0.0, 0.18, 1.0, 0.85),
     "“กางเกงเลตัวเดียว ผัดกะเพราได้ทั้งวัน”"),
    ("shoes", "รองเท้า", "SHOES", "แตะหูคีบ ผ้าใบ รองเท้าแตะสีสด ลุยได้ทุกซอย", "shoe_wall", (0.0, 0.15, 1.0, 0.85),
     "“เปลี่ยนรองเท้า เปลี่ยนชีวิต (มั้ง)”"),
    ("accessories", "เครื่องประดับ", "ACCESSORIES", "แว่นดำ สร้อย นาฬิกา หมวก เสริมดวงเรียกลูกค้า", "sunglasses_pile", (0.0, 0.0, 1.0, 0.8),
     "“แว่นดำอันเดียว เท่ไปสามซอย”"),
    ("face_hair", "หน้าตา ทรงผม", "FACE & HAIR", "รองทรง สกินเฮด ทรงเกาหลี หนวดเท่ๆ ช่างตัดให้", "barber_chairs", (0.0, 0.32, 1.0, 1.0),
     "“ตัดผมใหม่ ลูกค้าจำไม่ได้ แต่ป้าจำได้”"),
    ("skin", "สีผิว", "SKIN TONE", "ผิวขาว ผิวสองสี ผิวแทนแดดเมืองไทย สวยหล่อได้ทุกโทน", "foundation_swatches", (0.0, 0.0, 1.0, 1.0),
     "“ผิวสีไหนก็หล่อ ถ้าผัดกะเพราเป็น”"),
]
SPREADS = [("A", 0, 1), ("B", 2, 3), ("C", 4, 5)]
PAGE_NO = {"tops": 22, "bottoms": 23, "shoes": 38, "accessories": 39, "face_hair": 54, "skin": 55}

M = 56
BAND = (M, M, PW - M, 476)
GRID_Y0, GRID_Y1 = 560, 1336
COLS, ROWS = 3, 2
GAP = 22


def slot_boxes():
    gw = (PW - 2 * M - (COLS - 1) * GAP) / COLS
    gh = (GRID_Y1 - GRID_Y0 - (ROWS - 1) * GAP) / ROWS
    out = []
    for r in range(ROWS):
        for c in range(COLS):
            x0 = M + c * (gw + GAP)
            y0 = GRID_Y0 + r * (gh + GAP)
            out.append((x0, y0, x0 + gw, y0 + gh))
    return out


def studio_bg(w, h, seed=0):
    """Light seamless-paper product backdrop (real paper scan detail + soft falloff)."""
    p = coated_paper(h, w, seed=seed, tone="#ECEAE5", strength=0.6)
    yy, xx = np.mgrid[0:h, 0:w].astype(f32)
    g = 1 - 0.10 * ((xx - w / 2) / (w / 2)) ** 2 - 0.06 * (yy / h) ** 1.5
    floor = smoothstep(h * 0.62, h * 0.78, yy)
    p = p * g[..., None] * (1 - 0.05 * floor[..., None])
    return p


def build_page(cat_idx, side, seed, example=False, items=None):
    key, th, en, kicker, ph, crop, quote = CATS[cat_idx]
    paper = coated_paper(PH, PW, seed=seed)
    P = Press(PW, PH, seed=seed)
    regs = {"category": key, "slots": []}
    # header photo band (real photo)
    P.image(BAND, boost(photo(ph, crop)), "cmyk", contrast=1.05, focus=(0.5, 0.5))
    # dark gradient at band bottom for the title
    bx0, by0, bx1, by1 = BAND
    gh = 190
    grad = np.linspace(0, 1, gh, dtype=f32)[:, None] ** 1.6 * np.ones((1, bx1 - bx0), f32)
    P.mask(grad * 0.62, (bx0, by1 - gh), (0, 0, 0, 1.0), contone=True, overprint=True)
    # category title
    P.text((bx0 + 30, by1 - 92), th, F("Trirong-Black", 96 if len(th) < 8 else 74), None, anchor="ls")
    P.text((bx0 + 34, by1 - 40), en, F("Trirong-Bold", 30), "yellow", anchor="ls", tracking=8)
    kx = bx0 + 34 + P.measure(en, F("Trirong-Bold", 30), tracking=8)[0] + 24
    P.text((kx, by1 - 42), kicker, F("Sarabun-SemiBold", 22), None, anchor="ls", max_w=(630 if side == "L" else bx1 - 20) - kx)
    # running head + folio
    P.text((M, 34), "ซอยเก๋  SOI-KAY", F("Trirong-Bold", 20), "K", anchor="ls", tracking=2)
    P.text((PW - M, 34), "STREET LOOKBOOK · ฉบับหน้าร้อน 38 องศา", F("Sarabun-SemiBold", 18), "K", anchor="rs")
    pn = PAGE_NO[key]
    fol_x = M if side == "L" else PW - M
    P.text((fol_x, PH - 40), str(pn), F("Trirong-Black", 30), "K", anchor="ls" if side == "L" else "rs")
    P.text((PW / 2, PH - 42), "ซอยเก๋ · มิถุนายน 2569", F("Sarabun-Regular", 17), "K", anchor="ms")
    # pull-quote strip between band and grid
    P.rect((M, 492, M + 8, 540), "red")
    P.text((M + 22, 528), quote, F("Taviraj-Bold", 34), "K", anchor="ls", max_w=PW - 2 * M - 30)
    # item slots
    for i, (x0, y0, x1, y1) in enumerate(slot_boxes()):
        ix0, iy0, ix1, iy1 = int(x0), int(y0), int(x1), int(y0 + (y1 - y0) * 0.66)
        bg = studio_bg(ix1 - ix0, iy1 - iy0, seed=seed * 10 + i)
        P.image((ix0, iy0, ix1, iy1), to_img(bg), "cmyk")
        P.rect((ix0, iy1, ix1, iy1 + 2), "K")
        num = f"{i + 1:02d}"
        P.text((ix0 + 10, iy0 + 30), num, F("Trirong-Black", 26), "K", anchor="ls")
        reg = dict(id=f"{key}_{i + 1}", render=dict(x=ix0, y=iy0, w=ix1 - ix0, h=iy1 - iy0),
                   name=dict(x=ix0, y=iy1 + 8, w=ix1 - ix0, h=38, font="NotoSansThaiLooped@800", size=26, color="#1A1A1A", baseline=iy1 + 38),
                   name_en=dict(x=ix0, y=iy1 + 46, w=ix1 - ix0, h=24, font="Trirong-Bold", size=16, color="#555555", baseline=iy1 + 64, tracking_px=1),
                   price=dict(x=ix0, y=int(y1) - 46, w=ix1 - ix0, h=44, font="NotoSansThaiLooped@900w75", size=38, color="#D7262E", baseline=int(y1) - 6),
                   sticker_anchor=dict(x=ix1 - 40, y=iy0 + 30), hit=dict(x=int(x0), y=int(y0), w=int(x1 - x0), h=int(y1 - y0)))
        regs["slots"].append(reg)
        if example and items and i < len(items):
            nm, nm_en, price, img = items[i]
            if img is not None:
                P.image((ix0 + 8, iy0 + 8, ix1 - 8, iy1 - 8), img, "cmyk", contrast=1.05)
            P.text((ix0, iy1 + 38), nm, F("NotoSansThaiLooped@800", 26), "K", anchor="ls", max_w=ix1 - ix0)
            P.text((ix0, iy1 + 64), nm_en, F("Trirong-Bold", 16), "K", anchor="ls", tracking=1, max_w=ix1 - ix0)
            P.text((ix0, int(y1) - 6), price, F("NotoSansThaiLooped@900w75", 38), "red", anchor="ls")
    # small print / credits line
    P.text((PW - M, PH - 70), "ราคาสินค้าโดยประมาณ ต่อราคาได้ตามความหน้าด้าน · ภาพ: ตลาดในกรุงเทพฯ", F("Sarabun-Regular", 14), "K", anchor="rs")
    out = print_page(P, paper, seed)
    regs["player_polaroid"] = None
    return out, regs


def polaroid(img_rgb=None, w=300, h=360, seed=0, label="ลุคของคุณ"):
    """Real-paper polaroid frame (RGBA) with tape; inner window is where the game pastes the player render."""
    pad = 24
    P = Press(w, h, seed=seed)
    paper = coated_paper(h, w, seed=seed, tone="#F4F2EC", strength=0.8)
    win = (18, 18, w - 18, h - 70)
    if img_rgb is not None:
        P.image(win, img_rgb, "cmyk")
    else:
        P.rect(win, (0.05, 0.03, 0.0, 0.18), contone=True)
    a = print_page(P, paper, seed)
    lay = Image.new("L", (w, h), 0)
    hand_text(lay, (28, h - 52), label, "Sriracha-Regular", 34, seed=seed, jitter=1.0)
    a = ink_composite(a, lay, "#1B2A6B", kind="ballpoint", seed=seed)
    img = Image.fromarray((np.dstack([a, np.ones((h, w), f32)]) * 255).astype(np.uint8), "RGBA")
    big = Image.new("RGBA", (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
    sh = Image.new("L", (w + 2 * pad, h + 2 * pad), 0)
    ImageDraw.Draw(sh).rectangle((pad + 4, pad + 6, pad + w + 4, pad + h + 6), fill=110)
    sh = sh.filter(ImageFilter.GaussianBlur(7))
    big.putalpha(sh)
    big = Image.composite(big, Image.new("RGBA", big.size, (0, 0, 0, 0)), sh)
    shadow = Image.new("RGBA", big.size, (20, 18, 15, 0))
    shadow.putalpha(sh)
    shadow.alpha_composite(img, (pad, pad))
    tape = tape_strip(130, 40, seed=seed)
    shadow.alpha_composite(tape.rotate(-6, expand=True, resample=Image.BICUBIC), (pad + w // 2 - 70, 4))
    rot = shadow.rotate(3.0, expand=True, resample=Image.BICUBIC)
    return rot, dict(window_local=dict(x=pad + win[0], y=pad + win[1], w=win[2] - win[0], h=win[3] - win[1]), rotation_deg=3.0,
                     size=dict(w=rot.width, h=rot.height))


def gutter(spread):
    """Spine shading for a 2-page spread (multiply)."""
    h, w = spread.shape[:2]
    xx = np.arange(w, dtype=f32)[None, :]
    d = np.abs(xx - w / 2) / (w / 2)
    shade = 1 - 0.30 * np.exp(-(d / 0.035) ** 2) - 0.08 * np.exp(-(d / 0.12) ** 2)
    hl = 0.035 * np.exp(-((d - 0.16) / 0.06) ** 2)
    return (shade + hl).astype(f32) * np.ones((h, 1), f32)


def build_cover(seed=7):
    paper = coated_paper(PH, PW, seed=seed)
    P = Press(PW, PH, seed=seed)
    bgp = "talat_noi_mural_cc0"
    P.image((0, 0, PW, PH), boost(photo(bgp), 1.08, 1.02), "cmyk", focus=(0.62, 0.5))
    top = np.linspace(1, 0, 470, dtype=f32)[:, None] ** 1.3 * np.ones((1, PW), f32)
    P.mask(top * 0.55, (0, 0), (0, 0, 0, 1.0), contone=True, overprint=True)
    xx = np.linspace(0, 1, PW, dtype=f32)[None, :]
    side = (np.clip(1 - xx / 0.42, 0, 1) ** 1.5 + np.clip((xx - 0.58) / 0.42, 0, 1) ** 1.5) * np.ones((PH - 470 - 210, 1), f32)
    P.mask(side * 0.62, (0, 470), (0, 0, 0, 1.0), contone=True, overprint=True)
    # masthead
    P.text((PW / 2, 40), "S O I - K A Y", F("Trirong-Bold", 34), None, anchor="mt", tracking=6)
    mf = F("Trirong-Black", 250)
    P.text((PW / 2 + 5, 72 + 5), "ซอยเก๋", mf, (0, 0, 0, 0.85), anchor="mt", contone=True, overprint=True)
    P.text((PW / 2, 72), "ซอยเก๋", mf, "red", anchor="mt")
    P.text((PW / 2, 372), "นิตยสารแฟชั่นริมทาง ฉบับคนหล่อแต่ไม่มีตังค์", F("Sarabun-SemiBold", 26), None, anchor="mt")
    # issue strip
    P.rect((0, 418, PW, 456), (0, 0, 0, 0.88), contone=True)
    P.text((M, 446), "ฉบับที่ 99  ·  มิถุนายน 2569", F("Sarabun-SemiBold", 22), None, anchor="ls")
    P.text((PW - M, 446), "ราคา 59 บาท", F("NotoSansThaiLooped@800", 24), "yellow", anchor="rs")
    # cover lines
    lines_l = [("เสื้อกล้าม", "ฟีเวอร์!", "yellow"), ("100 ลุค", "งบไม่เกินร้อย", None), ("ทรงผม", "รับลมร้อน 38°", "yellow")]
    y = 560
    for a, b, c in lines_l:
        P.text((M, y), a, F("NotoSansThaiLooped@900w75", 66), c, anchor="ls")
        P.text((M, y + 46), b, F("NotoSansThaiLooped@800", 34), None, anchor="ls")
        y += 170
    lines_r = [("แตะหูคีบ", "ใส่ได้ทุกงาน", None), ("แว่นดำ", "เท่ไปสามซอย", "yellow"), ("สีผิวไหน", "เข้ากับกะเพรา?", None)]
    y = 560
    for a, b, c in lines_r:
        P.text((PW - M, y), a, F("NotoSansThaiLooped@900w75", 62), c, anchor="rs")
        P.text((PW - M, y + 44), b, F("NotoSansThaiLooped@800", 32), None, anchor="rs")
        y += 170
    # bottom banner
    P.rect((0, PH - 210, PW, PH - 120), "red")
    P.text((PW / 2, PH - 165), "สัมภาษณ์พิเศษ! ป้าแม่ค้าผัก ผู้แต่งตัวเก๋ที่สุดในตลาด", F("NotoSansThaiLooped@900w75", 44), None, anchor="mm",
           max_w=PW - 2 * M)
    full = barcode(P, PW - 290, PH - 112, mod=2, h=70)
    P.text((M, PH - 60), "แถมฟรี! สติกเกอร์ ลด 50%", F("NotoSansThaiLooped@900", 38), "yellow", anchor="ls")
    out = print_page(P, paper, seed)
    LAYOUT["cover"] = dict(file="cover_soikay_1024x1448.jpg", player_render=dict(x=262, y=470, w=500, h=760,
                           note="paste the live player render (transparent PNG) here, feet near y=1230; it overlaps the cover lines' inner edges like a real cover star"),
                           background_photo=dict(name=bgp, **SRC.get(bgp, {})), barcode_digits=full,
                           masthead_note="masthead printed in red Trirong Black; S O I - K A Y tracking 6")
    return out


def main():
    os.makedirs(OUT + "stickers", exist_ok=True)
    os.makedirs(OUT + "tabs", exist_ok=True)
    os.makedirs(OUT + "marks", exist_ok=True)
    # paper + maps
    pap = coated_paper(1024, 1024, seed=3)
    save_jpg(pap, OUT + "paper_glossy_1024.jpg", 92)
    rough = 0.22 + 0.06 * spectral_noise(1024, 1024, beta=1.2, seed=5)
    save_jpg(np.dstack([rough] * 3), OUT + "paper_glossy_roughness_1024.jpg", 92)
    # spread normal (gutter curvature + gentle wave)
    xx = np.linspace(-1, 1, SW, dtype=f32)[None, :] * np.ones((SH, 1), f32)
    height = -np.exp(-(np.abs(xx) / 0.06) ** 2) * 6 + 2 * np.exp(-((np.abs(xx) - 0.2) / 0.2) ** 2) + fbm(SH, SW, 400, 3, 9) * 1.5
    height_to_normal(height, 2.0).convert("RGB").save(OUT + "spread_normal_2048x1448.jpg", quality=92)
    g = gutter(np.zeros((SH, SW, 3), f32))
    gim = Image.fromarray(((1 - np.clip(g, 0, 1)) * 255).astype(np.uint8), "L")
    blackrgba = Image.new("RGBA", (SW, SH), (10, 8, 6, 0))
    blackrgba.putalpha(gim)
    blackrgba.save(OUT + "spread_gutter_shadow_2048x1448.png", optimize=True)
    # cover
    save_jpg(build_cover(), OUT + "cover_soikay_1024x1448.jpg", 90)
    print("cover")
    # stickers
    for k in ["p99", "p59", "p20", "p199", "sale50", "new", "hot"]:
        sticker_img(k, 220, seed=len(k)).save(OUT + f"stickers/sticker_{k}.png", optimize=True)
    # tabs
    tabs = {}
    for i, k in enumerate(TAB_COLS):
        tab_img(k, seed=i).save(OUT + f"tabs/tab_{k}.png", optimize=True)
    # marks
    for i, k in enumerate(["circle", "arrow", "underline", "heart", "note_this", "cross", "star"]):
        marker_mark(k, seed=i + 1).save(OUT + f"marks/marker_{k}.png", optimize=True)
    # polaroid (empty) for the player render
    pol, polinfo = polaroid(None, seed=4)
    pol.save(OUT + "polaroid_your_look.png", optimize=True)
    LAYOUT["parts"]["polaroid_your_look.png"] = polinfo
    # spreads
    for sid, li, ri in SPREADS:
        L, lreg = build_page(li, "L", seed=20 + li)
        R, rreg = build_page(ri, "R", seed=20 + ri)
        sp = np.concatenate([L, R], 1) * gutter(np.zeros((SH, SW, 3), f32))[..., None]
        # paste polaroid on the left page band (right side)
        spi = to_img(sp).convert("RGBA")
        px, py = 640, 150
        spi.alpha_composite(pol, (px, py))
        name = f"spread_{sid}_{CATS[li][0]}_{CATS[ri][0]}_2048x1448.jpg"
        spi.convert("RGB").save(OUT + name, quality=90, optimize=True, progressive=True)
        for r in rreg["slots"]:
            for k2 in ("render", "name", "name_en", "price", "hit"):
                r[k2]["x"] += PW
            r["sticker_anchor"]["x"] += PW
        win = polinfo["window_local"]
        LAYOUT["spreads"][sid] = dict(file=name, left=dict(category=CATS[li][0], title=CATS[li][1], slots=lreg["slots"]),
                                      right=dict(category=CATS[ri][0], title=CATS[ri][1], slots=rreg["slots"]),
                                      player_polaroid=dict(x=px, y=py, w=pol.width, h=pol.height, window=dict(
                                          x=px + win["x"], y=py + win["y"], w=win["w"], h=win["h"]), rotation_deg=3.0,
                                          note="polaroid baked in; paste the player render into 'window' (rotate +3deg around its centre)"),
                                      photos=[dict(name=CATS[li][4], **SRC.get(CATS[li][4], {})), dict(name=CATS[ri][4], **SRC.get(CATS[ri][4], {}))])
        print("spread", sid)
    # example spread A with stand-in item photos cropped from the real market photos + marker marks + stickers
    items_l = [("เสื้อกล้ามขาว", "WHITE SINGLET", "฿59", photo("tshirt_pile", (0.35, 0.35, 0.6, 0.75))),
               ("เชิ้ตลายดอก", "FLORAL SHIRT", "฿199", photo("clothes_alley_pratunam", (0.62, 0.35, 0.8, 0.62))),
               ("ยืดคอกลม", "CREW TEE", "฿99", photo("tshirt_pile", (0.62, 0.45, 0.85, 0.85))),
               ("เสื้อบอลไทย", "FOOTBALL SHIRT", "฿150", photo("clothes_alley_pratunam", (0.25, 0.3, 0.42, 0.6))),
               ("เสื้อวินมอไซค์", "TAXI VEST", "฿120", photo("clothes_alley2", (0.6, 0.25, 0.78, 0.55))),
               ("เสื้อฮาวาย", "ALOHA SHIRT", "฿179", photo("clothes_alley_pratunam", (0.78, 0.3, 0.95, 0.6)))]
    items_r = [("ขาสั้นผ้าร่ม", "NYLON SHORTS", "฿79", photo("clothes_alley2", (0.08, 0.35, 0.28, 0.75))),
               ("กางเกงเล", "FISHERMAN PANTS", "฿99", photo("clothes_mannequins", (0.82, 0.2, 0.98, 0.7))),
               ("ยีนส์ฟอก", "WASHED JEANS", "฿250", photo("clothes_alley_pratunam", (0.0, 0.25, 0.15, 0.7))),
               ("ขาก๊วยลายช้าง", "ELEPHANT PANTS", "฿100", photo("dress_stall_cc0", (0.55, 0.35, 0.72, 0.85))),
               ("วอร์มนักเรียน", "TRACK PANTS", "฿129", photo("clothes_alley2", (0.3, 0.4, 0.45, 0.8))),
               ("บ็อกเซอร์", "BOXERS", "฿39", photo("tshirt_pile", (0.05, 0.4, 0.3, 0.8)))]
    L, _ = build_page(0, "L", seed=20, example=True, items=items_l)
    R, _ = build_page(1, "R", seed=21, example=True, items=items_r)
    sp = np.concatenate([L, R], 1) * gutter(np.zeros((SH, SW, 3), f32))[..., None]
    spi = to_img(sp).convert("RGBA")
    spi.alpha_composite(pol, (640, 150))
    st = {k: Image.open(OUT + f"stickers/sticker_{k}.png") for k in ["p59", "sale50", "new", "hot"]}
    boxes = slot_boxes()
    for (k, si, side) in [("p59", 0, 0), ("hot", 1, 0), ("sale50", 3, 1), ("new", 4, 1)]:
        x0, y0, x1, y1 = boxes[si]
        s = st[k].resize((150, 150), Image.LANCZOS).rotate(-8 + si * 5, expand=True, resample=Image.BICUBIC)
        spi.alpha_composite(s, (int(x1 - 120 + side * PW), int(y0 - 24)))
    mk = Image.open(OUT + "marks/marker_circle.png")
    x0, y0, x1, y1 = boxes[1]
    spi.alpha_composite(mk.resize((int(x1 - x0 + 70), int((y1 - y0) * 0.95))), (int(x0 - 35), int(y0 - 10)))
    nt = Image.open(OUT + "marks/marker_note_this.png").rotate(-6, expand=True, resample=Image.BICUBIC)
    spi.alpha_composite(nt, (int(x0 - 10), int(y1 - 30)))
    ar = Image.open(OUT + "marks/marker_arrow.png")
    spi.alpha_composite(ar, (int(PW + boxes[3][0] - 230), int(boxes[3][1] + 60)))
    spi.convert("RGB").save(OUT + "spread_A_example_filled_2048x1448.jpg", quality=90, optimize=True, progressive=True)
    wide = Image.new("RGBA", (SW + 160, SH + 40), (58, 52, 46, 255))
    for i, k in enumerate(TAB_COLS):
        timg = Image.open(OUT + f"tabs/tab_{k}.png")
        wide.alpha_composite(timg, (SW - 70, 20 + 150 + i * 128))
    wide.alpha_composite(spi, (0, 20))
    wide.convert("RGB").save(OUT + "preview_spread_A_with_tabs.jpg", quality=86, optimize=True)
    # tabs layout along the right edge of the spread (on the right page edge), top to bottom
    ty = 150
    for i, k in enumerate(TAB_COLS):
        timg = Image.open(OUT + f"tabs/tab_{k}.png")
        LAYOUT["tabs"][k] = dict(file=f"tabs/tab_{k}.png", label=TAB_LABELS[k], spread={"tops": "A", "bottoms": "A", "shoes": "B",
                                 "accessories": "B", "face_hair": "C", "skin": "C"}[k],
                                 x=SW - 70, y=ty + i * 128, w=timg.width, h=timg.height,
                                 hit=dict(x=SW - 4, y=ty + i * 128 + 5, w=timg.width - 70, h=timg.height - 14),
                                 note="tab sticks out past the right page edge: x is where its adhesive end sits under the page; pull it 12px further out when active")
    LAYOUT["skin_tones"] = {"note": "suggested swatch chips for the skin page (game colours)", "tones": [
        {"th": "ขาวอมชมพู", "hex": "#F1C9A8"}, {"th": "ขาวเหลือง", "hex": "#E9C08F"}, {"th": "สองสี", "hex": "#C98E5E"},
        {"th": "แทนแดดไทย", "hex": "#A86B43"}, {"th": "คล้ำเข้ม", "hex": "#7A4A2C"}, {"th": "เข้มมาก", "hex": "#55321F"}]}
    LAYOUT["fonts"] = {"rule": "LOOPED Thai fonts only", "headline": "Trirong-Black", "pullquote": "Taviraj-Bold",
                       "item_name": "NotoSansThaiLooped@800", "price": "NotoSansThaiLooped@900 + font-stretch 75%",
                       "latin": "Trirong-Bold (tracking)", "hand": "Sriracha-Regular (tabs, polaroid label)"}
    LAYOUT["render_hints"] = {
        "item_renders": "render each clothing item on transparent bg, paste into slot.render with object-fit: contain, add a soft contact shadow; then multiply-blend a 6% paper grain (paper_glossy_1024.jpg) over it so it sits in the print",
        "selected": "draw marks/marker_circle.png over the selected slot (scale to slot.hit) and optionally marks/marker_note_this.png",
        "stickers": "stickers/*.png at slot.sticker_anchor (centre), random rotation -10..10 deg",
        "material": "three.js: MeshPhysicalMaterial({map: spread, roughnessMap: paper_glossy_roughness_1024 (repeat 2,1.4), roughness:0.35, clearcoat:0.6, clearcoatRoughness:0.25, normalMap: spread_normal}); overlay spread_gutter_shadow if the spread is drawn flat",
    }
    LAYOUT["photo_sources"] = {n: SRC.get(n, {}) for n in sorted(USED)}
    with open(OUT + "layout.json", "w", encoding="utf-8") as f:
        json.dump(LAYOUT, f, ensure_ascii=False, indent=1)
    print("done", sorted(USED))


if __name__ == "__main__":
    main()
