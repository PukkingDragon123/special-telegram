"""ลุงชิต's secret recipe notebook -> public/assets/img/recipebook/
Deliberately LAZY / UGLY but clearly human-made (client exception to the 'use real images' rule):
real paper scans (ambientCG Paper001/Paper003/Paper006, CC0) + printed school-notebook rules + jittered
handwriting (Sriracha / Itim / Mali, OFL) + wobbly ballpoint doodles + stains.
Run: python3 -I scripts/research/R4/build_recipebook.py"""
import sys, os, json, math, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from printfx import *  # noqa
from printfx import _max_paste
from recipes_data import RECIPES

ROOT = "/home/user/special-telegram"
ACG = ROOT + "/references/ui/_raw/acg/"
OUT = ROOT + "/public/assets/img/recipebook/"
W, H = 1024, 1448
RULE0, RULE = 168, 54            # first ruled line y, spacing
MARGIN_X = 128
BLUE, RED, PENCIL, BLACK = "#1F3590", "#C22A2A", "#4B4A48", "#1A1A1C"
HAND = "Sriracha-Regular"
HAND2 = "Itim-Regular"          # the four friends' pencil notes
HAND3 = "Mali-Regular"


# ------------------------------------------------------------------ paper
def scan_paper(h, w, which="Paper001", tone="#F1ECDC", strength=0.8, seed=0):
    tex = to_arr(Image.open(ACG + f"{which}/{which}_2K-JPG_Color.jpg"))
    th, tw = tex.shape[:2]
    big = np.tile(tex, (h // th + 2, w // tw + 2, 1))
    rng = np.random.default_rng(seed)
    oy, ox = rng.integers(0, th), rng.integers(0, tw)
    a = big[oy:oy + h, ox:ox + w]
    det = a / np.maximum(blur(a, 40), 1e-3)
    return np.clip(np.array(hexrgb(tone), f32)[None, None] * (1 + (det - 1) * strength), 0, 1).astype(f32)


def creases(h, w, strength=0.25, seed=0):
    tex = gray_of(to_arr(Image.open(ACG + "Paper003/Paper003_2K-JPG_Color.jpg")))
    rng = np.random.default_rng(seed)
    k = int(rng.integers(0, 4))
    tex = np.rot90(tex, k)
    tex = np.asarray(Image.fromarray(np.ascontiguousarray(tex), "F").resize((max(w, h), max(w, h)), Image.BICUBIC), f32)[:h, :w]
    return (1 + (tex / blur(tex, 90) - 1) * strength).astype(f32)


def notebook_page(seed, page_no):
    paper = scan_paper(H, W, "Paper001", "#F0EAD8", 0.9, seed)
    P = Press(W, H, seed=seed)
    # printed rules (light blue) and red margin, like a Thai school notebook
    for y in range(RULE0, H - 40, RULE):
        P.rect((0, y, W, y + 2), (0.55, 0.18, 0, 0))
    P.rect((0, RULE0 - RULE - 6, W, RULE0 - RULE - 2), (0.55, 0.18, 0, 0))
    P.rect((MARGIN_X, 0, MARGIN_X + 2, H), (0, 0.75, 0.55, 0))
    out = P.composite(paper, cell=3.0, misreg=((0.6, 0), (0, 0.5), (0, 0), (0, 0)), spread=0.6, density=(0.8, 1.0))
    out *= edge_yellow(H, W, seed, 1.2, 0.07)
    out *= creases(H, W, 0.18, seed)[..., None]
    out *= edge_wear(H, W, seed=seed, amount=0.8, width=20)[..., None]
    return out


# ------------------------------------------------------------------ handwriting
def line_img(text, font, size, seed, jitter=1.0):
    f = F(font, size)
    wid = int(f.getlength(text) * 1.12 + size * 2)
    lay = Image.new("L", (max(8, wid), int(size * 2.4)), 0)
    xe = hand_text(lay, (size * 0.3, size * 0.7), text, font, size, seed=seed, jitter=jitter, rot_var=3.5, size_var=0.07,
                   baseline_wave=0.04)
    return lay, xe


class Writer:
    def __init__(self, seed):
        self.layers = {c: Image.new("L", (W, H), 0) for c in (BLUE, RED, PENCIL, BLACK)}
        self.rng = np.random.default_rng(seed)
        self.boxes = []  # occupied rectangles (x0,y0,x1,y1)
        self.seed = seed

    def write(self, x, baseline, text, size=40, color=BLUE, font=HAND, angle=None, jitter=1.0):
        """Write one line; returns (x_end, box). A slight slope makes it lazy."""
        if angle is None:
            angle = float(self.rng.normal(0, 0.9))
        lay, xe = line_img(text, font, size, int(self.rng.integers(0, 1 << 30)), jitter)
        rot = lay.rotate(angle, resample=Image.BICUBIC, expand=True, center=(size * 0.3, size * 0.7))
        dx = (rot.width - lay.width) / 2
        dy = (rot.height - lay.height) / 2
        px, py = int(x - size * 0.3 - dx), int(baseline - size * 0.7 - dy - size * 0.75 - size * 0.44)  # ink bottom sits on baseline
        _max_paste(self.layers[color], rot, px, py)
        x1 = x + (xe - size * 0.3)
        box = (x, baseline - size * 1.2, x1, baseline + size * 0.22)
        self.boxes.append(box)
        return x1, box

    def segs(self, x, baseline, text, size=40, color=BLUE, font=HAND):
        """Markup: ~~crossed out~~ and [r:red text]."""
        parts = re.split(r"(~~.*?~~|\[r:.*?\])", text)
        cx = x
        for p in parts:
            if not p:
                continue
            if p.startswith("~~"):
                t = p[2:-2]
                x1, box = self.write(cx, baseline, t, size, color, font)
                self.cross(cx - 4, baseline - size * 0.38, x1 + 4, color)
                cx = x1 + size * 0.35
            elif p.startswith("[r:"):
                t = p[3:-1]
                x1, box = self.write(cx, baseline, t, size * 0.92, RED, font)
                cx = x1 + size * 0.25
            else:
                x1, box = self.write(cx, baseline, p, size, color, font)
                cx = x1
        return cx

    def cross(self, x0, y, x1, color=BLUE):
        s = int(self.rng.integers(0, 1 << 30))
        n = max(3, int((x1 - x0) / 26))
        pts = []
        for i in range(n + 1):
            pts.append((x0 + (x1 - x0) * i / n, y + (8 if i % 2 else -8) + self.rng.normal(0, 2)))
        scribble(self.layers[color], pts, width=3.2, seed=s, jitter=1.5)
        scribble(self.layers[color], [(x0, y + 2), (x1, y - 3)], width=3.0, seed=s + 1, jitter=1.2)

    def underline(self, x0, y, x1, color=BLUE, twice=False, width=3.4):
        s = int(self.rng.integers(0, 1 << 30))
        scribble(self.layers[color], [(x0, y), ((x0 + x1) / 2, y + self.rng.normal(0, 3)), (x1, y - 4)], width=width, seed=s, jitter=2)
        if twice:
            scribble(self.layers[color], [(x0 + 10, y + 10), (x1 - 20, y + 8)], width=width * 0.85, seed=s + 1, jitter=2)

    def circle(self, box, color=RED, width=3.4, loops=1.15):
        x0, y0, x1, y1 = box
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        rx, ry = (x1 - x0) / 2 + 16, (y1 - y0) / 2 + 12
        pts = [(cx + math.cos(t) * rx * (1 + self.rng.normal(0, 0.03)), cy + math.sin(t) * ry * (1 + self.rng.normal(0, 0.05)))
               for t in np.linspace(0.4, 0.4 + 2 * math.pi * loops, 24)]
        scribble(self.layers[color], pts, width=width, seed=int(self.rng.integers(0, 1 << 30)), jitter=2)

    def arrow(self, p0, p1, color=BLUE, width=3.4, bend=0.15):
        (x0, y0), (x1, y1) = p0, p1
        mx, my = (x0 + x1) / 2 + (y1 - y0) * bend, (y0 + y1) / 2 - (x1 - x0) * bend
        s = int(self.rng.integers(0, 1 << 30))
        scribble(self.layers[color], [(x0, y0), (mx, my), (x1, y1)], width=width, seed=s, jitter=1.5)
        a = math.atan2(y1 - my, x1 - mx)
        for da in (2.6, -2.6):
            scribble(self.layers[color], [(x1, y1), (x1 + math.cos(a + da) * 26, y1 + math.sin(a + da) * 26)], width=width, seed=s + 3)

    def box(self, b, color=BLUE, width=3.2):
        x0, y0, x1, y1 = b
        scribble(self.layers[color], [(x0, y0), (x1, y0 + 2), (x1 + 2, y1), (x0 - 2, y1 + 2), (x0 + 4, y0 - 4)], width=width,
                 seed=int(self.rng.integers(0, 1 << 30)), jitter=2.2, n=6)

    def free(self, b, pad=10):
        x0, y0, x1, y1 = b
        for (a0, b0, a1, b1) in self.boxes:
            if a0 - pad < x1 and a1 + pad > x0 and b0 - pad < y1 and b1 + pad > y0:
                return False
        return 0 <= x0 and x1 <= W - 20 and 20 <= y0 and y1 <= H - 30

    def place(self, w, h, prefer):
        """Find a free spot near the preferred (x,y) by scanning downward/upward in steps."""
        px, py = prefer
        for dy in [0, 54, -54, 108, -108, 162, -162, 216, 270, 324, 378, 432, -216, -270]:
            for dx in [0, -60, 60, -120]:
                b = (px + dx, py + dy, px + dx + w, py + dy + h)
                if self.free(b):
                    self.boxes.append(b)
                    return b
        return None

    def composite(self, paper):
        out = paper
        out = ink_composite(out, self.layers[PENCIL], PENCIL, kind="pencil", seed=self.seed + 1)
        out = ink_composite(out, self.layers[BLUE], BLUE, kind="ballpoint", seed=self.seed + 2)
        out = ink_composite(out, self.layers[RED], RED, kind="ballpoint", seed=self.seed + 3)
        out = ink_composite(out, self.layers[BLACK], BLACK, kind="marker", seed=self.seed + 4)
        return out


# ------------------------------------------------------------------ bad doodles (wobbly ballpoint)
def D(wr, color):
    return wr.layers[color], int(wr.rng.integers(0, 1 << 30))


def doodle(wr, name, b, color=BLUE, label=None):
    lay, s = D(wr, color)
    x0, y0, x1, y1 = b
    w, h = x1 - x0, y1 - y0
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    sc = scribble
    if name == "wok":
        pts = [(x0 + w * 0.08, y0 + h * 0.35)] + [(cx + math.cos(t) * w * 0.42, y0 + h * 0.35 + math.sin(t) * h * 0.32)
                                                  for t in np.linspace(0.15, math.pi - 0.15, 9)] + [(x1 - w * 0.08, y0 + h * 0.35)]
        sc(lay, pts[::-1], width=4, seed=s, jitter=2)
        sc(lay, [(x0 + w * 0.06, y0 + h * 0.35), (x1 - w * 0.06, y0 + h * 0.33)], width=3.5, seed=s + 1, jitter=2)
        sc(lay, [(x1 - w * 0.06, y0 + h * 0.34), (x1 + w * 0.08, y0 + h * 0.28)], width=6, seed=s + 2)
        for k in range(4):  # flames
            fx = x0 + w * (0.25 + k * 0.17)
            sc(lay, [(fx - 12, y1), (fx - 4, y1 - h * 0.18), (fx + 2, y1 - h * 0.08), (fx + 8, y1 - h * 0.25), (fx + 14, y1)], width=3, seed=s + 5 + k)
    elif name == "garlic":
        pts = [(cx + math.cos(t) * w * 0.32 * (1 + 0.25 * math.sin(t * 3)), cy + h * 0.1 + math.sin(t) * h * 0.32) for t in np.linspace(0, 2 * math.pi, 14)]
        sc(lay, pts, width=3.5, seed=s, jitter=2)
        sc(lay, [(cx - 6, y0 + h * 0.25), (cx, y0), (cx + 8, y0 + h * 0.25)], width=3, seed=s + 1)
        for k in (-1, 0, 1):
            sc(lay, [(cx + k * w * 0.12, cy - h * 0.12), (cx + k * w * 0.16, cy + h * 0.32)], width=2.5, seed=s + 2 + k)
    elif name == "chili":
        sc(lay, [(x0 + w * 0.15, y0 + h * 0.3), (cx, y0 + h * 0.45), (x1 - w * 0.12, y1 - h * 0.15), (cx + w * 0.05, y0 + h * 0.62),
                 (x0 + w * 0.12, y0 + h * 0.42)], width=3.5, seed=s, jitter=1.5)
        sc(lay, [(x0 + w * 0.14, y0 + h * 0.34), (x0, y0 + h * 0.12)], width=3.5, seed=s + 1)
    elif name == "pig":
        pts = [(cx + math.cos(t) * w * 0.4, cy + math.sin(t) * h * 0.38) for t in np.linspace(0, 2 * math.pi, 16)]
        sc(lay, pts, width=3.5, seed=s, jitter=2.5)
        sn = [(cx + math.cos(t) * w * 0.15, cy + h * 0.1 + math.sin(t) * h * 0.1) for t in np.linspace(0, 2 * math.pi, 10)]
        sc(lay, sn, width=3, seed=s + 1)
        for k in (-1, 1):
            sc(lay, [(cx + k * w * 0.05, cy + h * 0.09), (cx + k * w * 0.05 + 1, cy + h * 0.13)], width=5, seed=s + 2 + k)
            sc(lay, [(cx + k * w * 0.16, cy - h * 0.12), (cx + k * w * 0.17, cy - h * 0.1)], width=6, seed=s + 4 + k)
            sc(lay, [(cx + k * w * 0.22, cy - h * 0.28), (cx + k * w * 0.36, cy - h * 0.48), (cx + k * w * 0.38, cy - h * 0.22)], width=3, seed=s + 6 + k)
    elif name == "egg":
        pts = [(cx + math.cos(t) * w * 0.42 * (1 + 0.18 * math.sin(t * 5 + 1)), cy + math.sin(t) * h * 0.36 * (1 + 0.15 * math.cos(t * 4)))
               for t in np.linspace(0, 2 * math.pi, 20)]
        sc(lay, pts, width=3.5, seed=s, jitter=2)
        yl = [(cx + w * 0.05 + math.cos(t) * w * 0.14, cy - h * 0.04 + math.sin(t) * h * 0.13) for t in np.linspace(0, 2 * math.pi, 12)]
        sc(lay, yl, width=3.5, seed=s + 1)
        for k in range(5):  # lazy hatching on the yolk
            sc(lay, [(cx - w * 0.06 + k * 8, cy - h * 0.1), (cx - w * 0.02 + k * 8, cy + h * 0.06)], width=2, seed=s + 3 + k)
    elif name == "plate":
        pts = [(cx + math.cos(t) * w * 0.46, cy + h * 0.18 + math.sin(t) * h * 0.2) for t in np.linspace(0, 2 * math.pi, 18)]
        sc(lay, pts, width=3.5, seed=s, jitter=2)
        mound = [(cx - w * 0.3, cy + h * 0.18)] + [(cx + math.cos(t) * w * 0.3, cy + h * 0.15 - math.sin(t) * h * 0.4 + (6 if k % 2 else -4))
                                                   for k, t in enumerate(np.linspace(math.pi, 0, 9))]
        sc(lay, mound, width=3, seed=s + 1)
    elif name == "basil":
        for k, (ox, oy, a) in enumerate([(-0.2, 0.1, -0.6), (0.15, -0.05, 0.4), (0.0, 0.25, 1.4)]):
            lx, ly = cx + ox * w, cy + oy * h
            L = w * 0.28
            pts = [(lx - math.cos(a) * L, ly - math.sin(a) * L), (lx + math.cos(a + 0.5) * L * 0.4, ly + math.sin(a + 0.5) * L * 0.4),
                   (lx + math.cos(a) * L, ly + math.sin(a) * L), (lx + math.cos(a - 0.5) * L * 0.4, ly + math.sin(a - 0.5) * L * 0.4),
                   (lx - math.cos(a) * L, ly - math.sin(a) * L)]
            sc(lay, pts, width=3, seed=s + k, jitter=1.5)
            sc(lay, [pts[0], pts[2]], width=2, seed=s + 10 + k)
    elif name == "clock":
        pts = [(cx + math.cos(t) * w * 0.4, cy + math.sin(t) * h * 0.4) for t in np.linspace(0, 2 * math.pi * 1.05, 16)]
        sc(lay, pts, width=3.5, seed=s, jitter=2)
        sc(lay, [(cx, cy), (cx, cy - h * 0.28)], width=3.5, seed=s + 1)
        sc(lay, [(cx, cy), (cx + w * 0.2, cy + h * 0.05)], width=3.5, seed=s + 2)
    elif name == "fire":
        sc(lay, [(x0 + w * 0.2, y1), (x0 + w * 0.1, cy), (x0 + w * 0.3, y0 + h * 0.3), (x0 + w * 0.38, cy - h * 0.05), (cx, y0),
                 (x1 - w * 0.3, cy - h * 0.1), (x1 - w * 0.15, y0 + h * 0.25), (x1 - w * 0.1, cy + h * 0.15), (x1 - w * 0.22, y1), (x0 + w * 0.2, y1)],
           width=3.5, seed=s, jitter=2)
    elif name == "shrimp":
        pts = [(cx + math.cos(t) * w * 0.38, cy + math.sin(t) * h * 0.35) for t in np.linspace(-0.5, math.pi + 0.9, 12)]
        sc(lay, pts, width=4, seed=s, jitter=1.5)
        for k in range(4):
            t = -0.2 + k * 0.7
            sc(lay, [(cx + math.cos(t) * w * 0.26, cy + math.sin(t) * h * 0.24), (cx + math.cos(t) * w * 0.42, cy + math.sin(t) * h * 0.4)], width=2.5, seed=s + k)
        sc(lay, [(cx + w * 0.38, cy - h * 0.18), (x1, y0)], width=2, seed=s + 9)
    elif name == "mushroom":
        sc(lay, [(x0 + w * 0.1, cy), (cx - w * 0.1, y0 + h * 0.1), (cx + w * 0.15, y0 + h * 0.1), (x1 - w * 0.1, cy), (x0 + w * 0.1, cy)], width=3.5, seed=s, jitter=2)
        sc(lay, [(cx - w * 0.12, cy), (cx - w * 0.1, y1), (cx + w * 0.12, y1), (cx + w * 0.1, cy)], width=3.5, seed=s + 1, jitter=1.5)
    elif name == "noodles":
        for k in range(5):
            yy = y0 + h * (0.2 + k * 0.15)
            pts = [(x0 + w * (0.05 + i * 0.1), yy + (10 if i % 2 else -10) + wr.rng.normal(0, 3)) for i in range(10)]
            sc(lay, pts, width=2.6, seed=s + k)
    elif name == "bowl":
        sc(lay, [(x0, cy - h * 0.1), (cx, cy - h * 0.14), (x1, cy - h * 0.1)], width=3.5, seed=s)
        pts = [(cx + math.cos(t) * w * 0.5, cy - h * 0.1 + math.sin(t) * h * 0.55) for t in np.linspace(0, math.pi, 10)]
        sc(lay, pts, width=3.5, seed=s + 1, jitter=1.5)
        for k in range(3):  # steam
            sx = cx + (k - 1) * w * 0.25
            sc(lay, [(sx, cy - h * 0.25), (sx + 10, cy - h * 0.4), (sx - 6, cy - h * 0.55), (sx + 8, y0)], width=2.4, seed=s + 3 + k)
    elif name == "mortar":
        pts = [(cx + math.cos(t) * w * 0.42, cy + math.sin(t) * h * 0.35) for t in np.linspace(0, math.pi, 10)]
        sc(lay, [(x0 + w * 0.06, cy), (x1 - w * 0.06, cy)], width=3.5, seed=s)
        sc(lay, pts, width=3.5, seed=s + 1)
        sc(lay, [(cx + w * 0.05, cy - h * 0.05), (x1 - w * 0.05, y0)], width=7, seed=s + 2)
    elif name == "stickman":
        sc(lay, [(cx + math.cos(t) * w * 0.14, y0 + h * 0.16 + math.sin(t) * h * 0.13) for t in np.linspace(0, 2 * math.pi, 10)], width=3, seed=s)
        sc(lay, [(cx, y0 + h * 0.29), (cx, y0 + h * 0.65)], width=3, seed=s + 1)
        sc(lay, [(cx, y0 + h * 0.65), (cx - w * 0.18, y1)], width=3, seed=s + 2)
        sc(lay, [(cx, y0 + h * 0.65), (cx + w * 0.18, y1)], width=3, seed=s + 3)
        sc(lay, [(cx - w * 0.25, y0 + h * 0.45), (cx, y0 + h * 0.4), (cx + w * 0.22, y0 + h * 0.3)], width=3, seed=s + 4)
        sc(lay, [(cx + w * 0.22, y0 + h * 0.3), (cx + w * 0.22, y0 + h * 0.18)], width=4, seed=s + 5)  # thumbs up
        sc(lay, [(cx - w * 0.06, y0 + h * 0.13), (cx - w * 0.05, y0 + h * 0.14)], width=4, seed=s + 6)
        sc(lay, [(cx + w * 0.05, y0 + h * 0.13), (cx + w * 0.06, y0 + h * 0.14)], width=4, seed=s + 7)
        sc(lay, [(cx - w * 0.07, y0 + h * 0.2), (cx, y0 + h * 0.23), (cx + w * 0.07, y0 + h * 0.2)], width=2.5, seed=s + 8)
    elif name == "lime":
        pts = [(cx + math.cos(t) * w * 0.4, cy + math.sin(t) * h * 0.4) for t in np.linspace(0, 2 * math.pi, 14)]
        sc(lay, pts, width=3.5, seed=s, jitter=2)
        for k in range(6):
            a = k * math.pi / 3
            sc(lay, [(cx, cy), (cx + math.cos(a) * w * 0.33, cy + math.sin(a) * h * 0.33)], width=2.2, seed=s + k)
    elif name == "lemongrass":
        for k in range(3):
            sc(lay, [(x0 + w * (0.3 + k * 0.15), y1), (x0 + w * (0.35 + k * 0.12), cy), (x0 + w * (0.25 + k * 0.25), y0)], width=3, seed=s + k)
    if label:
        wr.write(x0 + 4, y1 + 34, label, 30, color)


def stains(out, seed, n_grease=3, coffee=True, sauce=True):
    rng = np.random.default_rng(seed)
    for k in range(n_grease):
        cx, cy, r = rng.uniform(80, W - 80), rng.uniform(150, H - 120), rng.uniform(26, 70)
        al, rgb = stain_blob(H, W, cx, cy, r, seed=seed + k, edge=0.8, fill=0.28, color="#B89A55")
        out = apply_stain(out, al, rgb)
    if coffee:
        cx, cy, r = rng.uniform(250, W - 150), rng.uniform(300, H - 250), rng.uniform(95, 125)
        al, rgb = coffee_ring(H, W, cx, cy, r, seed=seed + 11, strength=0.95)
        out = apply_stain(out, al, rgb)
    if sauce:  # chilli-sauce / soy splatter dots
        cx, cy = rng.uniform(100, W - 100), rng.uniform(200, H - 150)
        lay = np.zeros((H, W), f32)
        yy, xx = np.ogrid[0:H, 0:W]
        for k in range(int(rng.integers(6, 14))):
            dx, dy = rng.normal(0, 40), rng.normal(0, 30)
            rr = abs(rng.normal(4, 3)) + 1
            lay += ((xx - cx - dx) ** 2 + (yy - cy - dy) ** 2 < rr * rr).astype(f32)
        lay = np.clip(ndi.gaussian_filter(lay, 0.8), 0, 1) * 0.55
        out = apply_stain(out, lay, np.array(hexrgb("#9C3B1A"), f32))
    return out


def fingerprint(out, cx, cy, seed=0, strength=0.16):
    """Oily thumbprint: distorted concentric ridges."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:H, 0:W].astype(f32)
    a = rng.uniform(0, math.pi)
    u = (xx - cx) * math.cos(a) + (yy - cy) * math.sin(a)
    v = -(xx - cx) * math.sin(a) + (yy - cy) * math.cos(a)
    d = np.sqrt((u / 1.0) ** 2 + (v / 1.35) ** 2)
    warp = fbm(H, W, 30, 3, seed) * 9
    ridges = 0.5 + 0.5 * np.sin((d + warp) / 2.6)
    mask = np.clip(1 - d / 62, 0, 1) ** 0.6
    al = ridges * mask * strength
    return apply_stain(out, al.astype(f32), np.array(hexrgb("#8E7A50"), f32))


def dog_ear(img_arr, corner="tr", size=110, seed=0):
    h, w = img_arr.shape[:2]
    out = img_arr.copy()
    yy, xx = np.mgrid[0:h, 0:w].astype(f32)
    if corner == "tr":
        d = (w - xx) + yy
    else:
        d = (w - xx) + (h - yy)
    tri = d < size
    back = scan_paper(h, w, "Paper001", "#E3DCC8", 0.9, seed + 5)
    edge = np.abs(d - size) < 2.0
    shadow = np.clip(1 - (d - size) / 30, 0, 1) * (d >= size)
    out = out * (1 - 0.25 * shadow[..., None])
    out[tri] = back[tri] * 0.97
    out[edge] *= 0.8
    alpha = np.ones((h, w), f32)
    # the folded flap covers the corner; the area beyond the flap's mirror is empty (transparent)
    alpha[d < size * 0.0] = 0
    return out


# ------------------------------------------------------------------ page scripts
def ing_line(i):
    th, en, amt, g, unit = i
    return f"- {th} {amt} ({g:g} {unit})" if unit else f"- {th} {amt}"


ABBR = [("ช้อนโต๊ะ", "ชต."), ("ช้อนชา", "ชช.")]


def ing_short(i):
    """Compact form for two-column lists, the way Thai cooks really scribble (ชต. / ชช.)."""
    th, en, amt, g, unit = i
    name = th.split(" (")[0]
    a = amt
    for x, y_ in ABBR:
        a = a.replace(x, y_)
    if "กรัม" in a or "มล." in a:
        return f"- {name} {g:g} {unit}"
    return f"- {name} {a} ({g:g}{unit})"


def wrap_hand(text, size, width):
    lines = wrap_thai(text, F(HAND, size), width)
    for i in range(len(lines) - 1):
        if lines[i].rstrip().endswith("("):
            lines[i] = lines[i].rstrip()[:-1].rstrip()
            lines[i + 1] = "(" + lines[i + 1].lstrip()
    return [l for l in lines if l.strip()]


def write_title(wr, th, sub, pg_label):
    x1, box = wr.write(MARGIN_X + 30, RULE0 - 2, th, 70, BLACK, angle=-1.2)
    wr.underline(MARGIN_X + 24, RULE0 + 12, x1 + 10, RED, twice=True)
    if sub:
        wr.write(x1 + 30, RULE0 - 4, sub, 34, BLUE)
    wr.write(W - 120, 70, pg_label, 34, BLUE, angle=4)


def page_kaprao_1(wr, R):
    write_title(wr, R["th"], "(1 จาน) ขายดีสุด!!", "1")
    doodle(wr, "pig", (760, 70, 900, 180), BLUE)
    y = RULE0 + RULE * 1
    wr.write(MARGIN_X + 20, y, "ของที่ต้องใช้", 44, BLUE)
    y += RULE
    custom = {
        "น้ำปลา": "- น้ำปลา ~~2 ช้อนโต๊ะ~~ 1 ช้อนชา (5 g) [r:เค็มไป ลูกค้าด่า!]",
        "ซีอิ๊วดำ": "- ซีอิ๊วดำ ½ ช้อนชา (นิดเดียว เอาสี)",
        "พริกขี้หนู": "- พริกขี้หนู 5 เม็ด (5 g) [r:ฝรั่ง = 1 เม็ด!!]",
        "หมูสับ": "- หมูสับ 120 g (ไม่ต้องติดมันมาก)",
        "ใบกะเพรา": "- ใบกะเพรา 1 กำ (15 g) ใส่ตอนท้าย!",
    }
    for ing in R["ingredients"]:
        t = custom.get(ing[0], ing_line(ing))
        wr.segs(MARGIN_X + 34, y, t, 38, BLUE)
        y += RULE
    y += RULE
    xe, bb = wr.write(MARGIN_X + 44, y - 4, "ห้ามใส่ถั่วฝักยาว!!! (โดนด่า)", 42, RED, angle=-1.5)
    wr.box((MARGIN_X + 28, y - 62, xe + 18, y + 14), RED)
    pb = wr.place(170, 140, (790, 420))
    if pb:
        doodle(wr, "garlic", pb, BLUE)
    pb = wr.place(160, 120, (790, 640))
    if pb:
        doodle(wr, "chili", pb, BLUE)
    pb = wr.place(200, 170, (760, 900))
    if pb:
        doodle(wr, "mortar", pb, PENCIL)
        wr.write(pb[0], pb[3] + 40, "โขลกหยาบๆ", 32, PENCIL)
    wr.write(MARGIN_X + 40, RULE0 + RULE * 23, "(ลองแล้ว อร่อยจริง! ~ ต้น)", 30, PENCIL, font=HAND2, angle=1.5)


def page_kaprao_2(wr, R):
    write_title(wr, "กะเพรา (ต่อ)", "วิธีทำ", "2")
    y = RULE0 + RULE * 2
    widths = 540
    for k, (th, en, heat, secs) in enumerate(R["steps"]):
        lines = wrap_hand(th, 38, widths)
        for j, ln in enumerate(lines):
            pre = f"{k + 1}. " if j == 0 else "    "
            xe, box = wr.write(MARGIN_X + 30, y, pre + ln, 38, BLUE)
            y += RULE
        if secs:
            xe2, b2 = wr.write(MARGIN_X + 80, y - 2, f"~{secs} วิ", 34, RED)
            if k == 1:
                wr.circle(b2, RED)
            y += RULE
    xe, b = wr.write(MARGIN_X + 60, y, "อย่าให้ไหม้!! ไหม้ = ขม ทิ้ง!", 42, RED, angle=-2)
    wr.underline(MARGIN_X + 56, y + 14, xe, RED)
    pb = wr.place(230, 170, (730, 230))
    if pb:
        doodle(wr, "wok", pb, BLUE)
    pb = wr.place(120, 120, (800, 560))
    if pb:
        doodle(wr, "clock", pb, BLUE)
        wr.write(pb[0] + 10, pb[3] + 36, "20 วิ", 32, BLUE)
    pb = wr.place(220, 150, (740, 820))
    if pb:
        doodle(wr, "plate", pb, BLUE)
        doodle(wr, "egg", (pb[0] + 120, pb[1] - 20, pb[0] + 210, pb[1] + 60), BLUE)
    wr.write(MARGIN_X + 30, RULE0 + RULE * 20, "ลูกค้าประจำ: ป้าแดง ไม่เผ็ด / พี่วิน เผ็ดมาก", 32, BLUE)
    # lottery doodle
    lb = (MARGIN_X + 420, RULE0 + RULE * 21 + 10, MARGIN_X + 700, RULE0 + RULE * 22 + 30)
    wr.write(lb[0] + 14, lb[3] - 16, "งวดนี้ 58 85 ??", 36, BLUE, angle=2)
    wr.box(lb, BLUE)
    xe, b = wr.write(lb[2] + 30, lb[3] - 14, "471", 36, RED, angle=-4)
    wr.circle(b, RED)


def page_generic(wr, R, pg, doodles, extras=None):
    write_title(wr, R["th"], "(1 จาน)" if R["id"] != "tom_yam" else "(1 ชาม)", str(pg))
    y = RULE0 + RULE
    ings = R["ingredients"]
    two_col = len(ings) > 7
    fs = 34 if two_col else 38
    if two_col:
        half = (len(ings) + 1) // 2
        texts = [ing_short(i) for i in ings]
        avail = W - 36 - (MARGIN_X + 26)
        fs = 34
        while fs > 24:
            fnt = F(HAND, fs)
            lw = max(fnt.getlength(t) for t in texts[:half]) * 1.07
            rw = max(fnt.getlength(t) for t in texts[half:]) * 1.07
            if lw + 36 + rw <= avail:
                break
            fs -= 1
        rx = MARGIN_X + 26 + lw + 36
        for k, t in enumerate(texts):
            col = 0 if k < half else 1
            row = k if k < half else k - half
            wr.write(MARGIN_X + 26 if col == 0 else rx, y + row * RULE, t, fs, BLUE)
        y += half * RULE
    else:
        for ing in ings:
            wr.write(MARGIN_X + 30, y, ing_line(ing), fs, BLUE)
            y += RULE
    y += RULE
    xe, b = wr.write(MARGIN_X + 22, y, "วิธีทำ", 44, BLACK)
    wr.underline(MARGIN_X + 20, y + 10, xe, BLUE)
    y += RULE
    for k, (th, en, heat, secs) in enumerate(R["steps"]):
        has_t = ("วิ" in th) or ("นาที" in th)
        txt = th + ("" if has_t else (f" ({secs // 60} นาที)" if secs >= 120 else (f" (~{secs} วิ)" if secs else "")))
        lines = wrap_hand(txt, 36, 600)
        for j, ln in enumerate(lines):
            wr.segs(MARGIN_X + 30, y, (f"{k + 1}. " if j == 0 else "    ") + ln, 36, BLUE)
            y += RULE
    for t in R.get("tips", []):
        xe, b = wr.write(MARGIN_X + 50, y, "* " + t, 34, RED, angle=float(wr.rng.normal(0, 1.5)))
        y += RULE
    for name, pref, col, lab in doodles:
        pb = wr.place(pref[2], pref[3], (pref[0], pref[1]))
        if pb:
            doodle(wr, name, pb, col, lab)
    if extras:
        extras(wr, y)
    clutter(wr, pg)


CLUTTER = [
    ("ซื้อ: ไข่ 1 แผง / หมู 2 โล / กะเพรา 3 กำ", BLUE, HAND),
    ("ติดเงินเจ๊ร้านน้ำแข็ง 120 บาท", RED, HAND),
    ("อย่าลืมจ่ายค่าแก๊ส!!", RED, HAND),
    ("เลขเด็ดต้นกล้วย 39 ?? 93 ??", BLUE, HAND),
    ("ลูกค้าบ่น รอนาน (ก็ทำคนเดียวนี่หว่า)", BLUE, HAND),
    ("ฝนตก = ขายไม่ดี นอนเลย", BLUE, HAND),
    ("หมาน้ำตาล ชอบมาขอ ให้กระดูกได้", BLUE, HAND),
    ("(ผัดเร็วขึ้น = รวยขึ้น? ~ เบิ้ม)", PENCIL, HAND2),
    ("(ไข่ 2 ฟอง ขึ้นราคา 10 บาท ดีไหม ~ ต้น)", PENCIL, HAND2),
    ("ป้าแดง ค้าง 40 บาท (อย่าลืมทวง)", RED, HAND),
    ("ร้านเจ๊ ตลาดเช้า กะเพราสดสุด", BLUE, HAND),
    ("ไฟแรง ≠ ไฟไหม้ !!!", RED, HAND),
    ("ข้าวสาร 1 กระสอบ = 25 โล", BLUE, HAND),
    ("อย่าให้หมาเห็นหมู!!", RED, HAND),
    ("(พี่วินว่าเค็ม ~ แจ็ค)", PENCIL, HAND2),
    ("งวดหน้า 2 ตัวล่าง 07 ชัวร์!", BLUE, HAND),
    ("น้ำปลาหมด ซื้อ 2 ขวด", BLUE, HAND),
    ("(ลุงเขียนลายมือไม่ออกเลย ~ บอส)", PENCIL, HAND2),
]


def clutter(wr, pg):
    """Little human mess on empty bottom rows: shopping lists, debts, lottery guesses, friends' notes."""
    rng = np.random.default_rng(pg * 31)
    base_i = ((pg - 3) * 2) % len(CLUTTER)
    picks = [base_i, (base_i + 1) % len(CLUTTER)]
    row = 19
    for k in picks:
        t, col, font = CLUTTER[k]
        size = 32 if font == HAND else 30
        wid = F(font, size).getlength(t) * 1.08
        while row <= 23:
            base = RULE0 + RULE * row
            box = (MARGIN_X + 30, base - size * 1.2, MARGIN_X + 30 + wid, base + size * 0.22)
            if wr.free(box, pad=6):
                wr.write(MARGIN_X + 30 + rng.uniform(0, 60), base - rng.uniform(0, 4), t, size, col, font=font)
                row += 1
                break
            row += 1


def build_pages():
    pages = []
    R = {r["id"]: r for r in RECIPES}
    specs = [
        ("page_01_kaprao_1.png", "kaprao_moo_sap", lambda wr: page_kaprao_1(wr, R["kaprao_moo_sap"]), dict(coffee=False)),
        ("page_02_kaprao_2.png", "kaprao_moo_sap", lambda wr: page_kaprao_2(wr, R["kaprao_moo_sap"]), dict(coffee=True)),
    ]

    def khai_dao_extra(wr, y):
        xe, b = wr.write(MARGIN_X + 40, RULE0 + RULE * 21, "แก๊สหมด โทร 08๑-๕๕๕-๕๕", 36, BLUE, angle=-1)
        wr.phone_end = (xe, RULE0 + RULE * 21)
        wr.write(MARGIN_X + 40, RULE0 + RULE * 22, "(ลูกค้าชอบเยิ้มๆ ~ บอส)", 30, PENCIL, font=HAND2)

    gen = [
        ("page_03_khai_dao.png", "khai_dao", [("egg", (720, 260, 230, 190), BLUE, "ไข่แดงเยิ้มๆ"), ("fire", (800, 620, 130, 150), RED, "ร้อน! ระวังมือ")], khai_dao_extra),
        ("page_04_khai_jiao.png", "khai_jiao", [("egg", (730, 300, 200, 170), BLUE, "ฟูๆ"), ("wok", (720, 760, 230, 170), BLUE, None)], None),
        ("page_05_khao_phat.png", "khao_phat", [("plate", (720, 700, 230, 150), BLUE, "ข้าวเย็น!"), ("lime", (800, 1000, 110, 110), BLUE, None)], None),
        ("page_06_phat_phrik_kaeng.png", "phat_phrik_kaeng", [("chili", (790, 760, 150, 120), RED, None), ("pig", (780, 1000, 140, 120), BLUE, None)], None),
        ("page_07_phat_si_io.png", "phat_si_io", [("noodles", (720, 760, 230, 150), BLUE, "เส้นใหญ่"), ("wok", (720, 1040, 230, 160), BLUE, None)], None),
        ("page_08_rad_na.png", "rad_na", [("bowl", (720, 780, 230, 170), BLUE, "ข้นๆ"), ("noodles", (740, 1080, 200, 120), PENCIL, None)], None),
        ("page_09_tom_yam.png", "tom_yam", [("shrimp", (760, 760, 170, 140), BLUE, None), ("mushroom", (800, 960, 120, 120), BLUE, None),
                                             ("lemongrass", (790, 1150, 130, 150), PENCIL, None)], None),
        ("page_10_moo_krathiam.png", "moo_krathiam", [("garlic", (780, 300, 170, 150), BLUE, "เยอะๆ!!"), ("pig", (780, 700, 150, 130), BLUE, None)], None),
        ("page_11_phat_phak_bung.png", "phat_phak_bung", [("fire", (760, 700, 180, 200), RED, "ไฟแดง!!"), ("stickman", (780, 1020, 150, 190), PENCIL, "เท่!")], None),
    ]
    out = []
    for i, (fn, rid, fnc, opts) in enumerate(specs):
        out.append((fn, rid, i + 1, fnc, opts))
    for j, (fn, rid, dl, ex) in enumerate(gen):
        pg = len(specs) + j + 1
        out.append((fn, rid, pg, (lambda wr, rid=rid, pg=pg, dl=dl, ex=ex: page_generic(wr, R[rid], pg, dl, ex)), dict(coffee=(pg % 3 == 0))))
    return out


def render_page(fn, pg, fnc, opts, seed):
    paper = notebook_page(seed, pg)
    wr = Writer(seed)
    fnc(wr)
    out = wr.composite(paper)
    out = stains(out, seed + 100, n_grease=2 + pg % 3, coffee=opts.get("coffee", False), sauce=(pg % 2 == 0))
    rng = np.random.default_rng(seed)
    out = fingerprint(out, rng.uniform(150, W - 150), rng.uniform(H * 0.6, H - 120), seed=seed + 7)
    if pg in (3, 7, 10):
        out = dog_ear(out, "br" if pg == 7 else "tr", size=120, seed=seed)
    if getattr(wr, "phone_end", None):  # grease blob over the phone number's last digits
        px, py = wr.phone_end
        al, rgb = stain_blob(H, W, px - 10, py - 14, 46, seed=seed + 55, edge=1.0, fill=0.5, color="#A98A45")
        out = apply_stain(out, al, rgb)
    return out


def build_cover(seed=900):
    paper = scan_paper(H, W, "Paper006", "#9E7B55", 1.1, seed)
    P = Press(W, H, seed=seed)
    # printed parody school-notebook cover (dark blue ink on kraft)
    P.text((W / 2, 150), "สมุดบันทึก", F("Taviraj-Black", 92), "navy", anchor="mm")
    P.text((W / 2, 238), "ตรากระทะทอง  ·  40 แผ่น  ·  70 แกรม", F("Sarabun-SemiBold", 30), "navy", anchor="mm")
    bx0, by0, bx1, by1 = 170, 330, W - 170, 760
    for dx in (0, 8):
        P.rect((bx0 + dx, by0 + dx, bx1 - dx, by0 + dx + 3), "navy")
        P.rect((bx0 + dx, by1 - dx - 3, bx1 - dx, by1 - dx), "navy")
        P.rect((bx0 + dx, by0 + dx, bx0 + dx + 3, by1 - dx), "navy")
        P.rect((bx1 - dx - 3, by0 + dx, bx1 - dx, by1 - dx), "navy")
    labels = ["ชื่อ", "วิชา", "ชั้น", "โรงเรียน"]
    for k, lab in enumerate(labels):
        yy = by0 + 110 + k * 90
        P.text((bx0 + 40, yy), lab, F("Sarabun-Bold", 36), "navy", anchor="ls")
        x = bx0 + 40 + P.measure(lab, F("Sarabun-Bold", 36))[0] + 16
        while x < bx1 - 40:
            P.rect((x, yy - 4, x + 5, yy - 1), "navy")
            x += 11
    out = P.composite(paper, cell=3.0, spread=0.8, density=(0.72, 0.95), voids=0.004)
    # worn print: rub off ink at the edges/corners (lighten towards paper)
    wear = smoothstep(0.55, 0.9, fbm(H, W, 90, 5, seed + 3)) * (1 - edge_wear(H, W, seed, 4.0, 60))
    out = out * (1 - np.clip(wear, 0, 0.6)[..., None]) + paper * np.clip(wear, 0, 0.6)[..., None]
    out *= creases(H, W, 0.35, seed)[..., None]
    out *= edge_wear(H, W, seed=seed, amount=1.6, width=30)[..., None]
    wr = Writer(seed)
    wr.write(bx0 + 140, by0 + 104, "ลุงชิต", 56, BLUE, angle=-2)
    wr.write(bx0 + 140, by0 + 194, "กับข้าว (ทำขาย)", 50, BLUE, angle=-1)
    wr.write(bx0 + 140, by0 + 284, "-", 50, BLUE)
    wr.write(bx0 + 240, by0 + 374, "ชีวิต", 50, BLUE, angle=3)
    xe, b = wr.write(150, 960, "สูตรลับ", 150, BLACK, angle=-7)
    xe2, b2 = wr.write(260, 1150, "ห้ามดู!!", 150, BLACK, angle=-5)
    wr.underline(250, 1190, xe2, RED, twice=True, width=7)
    wr.write(640, 1290, "(ของลุง ห้ามแตะ)", 44, RED, angle=-3)
    lb = (120, 1300, 420, 1380)
    wr.write(lb[0] + 16, lb[3] - 18, "งวด 16 → 471", 40, BLUE, angle=1)
    wr.box(lb, BLUE)
    doodle(wr, "stickman", (780, 840, 930, 1040), BLUE)
    out = wr.composite(out)
    out = stains(out, seed + 5, n_grease=4, coffee=True, sauce=True)
    out = fingerprint(out, 820, 620, seed=seed + 9, strength=0.2)
    # packing tape along the spine (left edge) + a torn corner piece of tape
    img = to_img(out).convert("RGBA")
    tape = tape_strip(110, H + 40, seed=seed, color=(0.95, 0.92, 0.80), alpha=0.42, torn=False)
    img.alpha_composite(tape, (-38, -20))
    t2 = tape_strip(220, 64, seed=seed + 1, alpha=0.5).rotate(38, expand=True, resample=Image.BICUBIC)
    img.alpha_composite(t2, (W - 230, -40))
    return img.convert("RGB")


def small_png(img, path):
    """256-colour octree palette + Floyd-Steinberg dither: visually identical, ~5x smaller."""
    img.convert("RGB").quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG).save(path, optimize=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = {"page_size": [W, H], "style": "lazy, ugly, human-made notebook (ballpoint, pencil, red pen, marker); real paper scans",
                "fonts": "handwriting: Sriracha (old man), Itim (friends' pencil notes); printed cover: Taviraj/Sarabun",
                "cover": "cover.png", "pages": []}
    small_png(build_cover(), OUT + "cover.png")
    print("cover")
    R = {r["id"]: r for r in RECIPES}
    for k, (fn, rid, pg, fnc, opts) in enumerate(build_pages()):
        img = render_page(fn, pg, fnc, opts, seed=1000 + pg * 17)
        small_png(to_img(img), OUT + fn)
        r = R[rid]
        entry = dict(page=pg, file=fn, dish_id=rid, dish=r["th"], dish_en=r["en"], unlock_day=r["unlock_day"],
                     part=(f"{1 if fn.endswith('_1.png') else 2}/2" if r["pages"] == 2 else "1/1"))
        if not (r["pages"] == 2 and fn.endswith("_2.png")):
            entry["ingredients"] = [dict(th=i[0], en=i[1], amount=i[2], qty=i[3], unit=i[4]) for i in r["ingredients"]]
        if not (r["pages"] == 2 and fn.endswith("_1.png")):
            entry["steps"] = [dict(n=n + 1, th=s[0], en=s[1], heat=s[2], seconds=s[3]) for n, s in enumerate(r["steps"])]
        entry["tips"] = r.get("tips", [])
        manifest["pages"].append(entry)
        print(fn)
    manifest["recipes"] = [dict(id=r["id"], th=r["th"], en=r["en"], unlock_day=r["unlock_day"], serving="1",
                                ingredients=[dict(th=i[0], en=i[1], amount=i[2], qty=i[3], unit=i[4]) for i in r["ingredients"]],
                                steps=[dict(n=n + 1, th=s[0], en=s[1], heat=s[2], seconds=s[3]) for n, s in enumerate(r["steps"])],
                                tips=r.get("tips", [])) for r in RECIPES]
    manifest["notes"] = {"phone_number": "page 3 has a grease-smudged, deliberately incomplete number (no real number)",
                         "lottery": "page 2 + cover: lottery doodles 58 / 85 / 471",
                         "friends_notes": "pencil notes in a different hand (Itim) = the four guys' later comments"}
    with open(OUT + "manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    print("done")


if __name__ == "__main__":
    main()
