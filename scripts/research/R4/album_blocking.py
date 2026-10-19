"""Schematic blocking diagram of the ref4 composition (own drawing, no cover pixels).
Front view at the cover's framing (normalised 0..1) + top-down plan with the solved camera."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image, ImageDraw
from printfx import F

W, H = 2000, 1000
im = Image.new("RGB", (W, H), "#20211C")
d = ImageDraw.Draw(im)
f, fs, fb = F("Kanit-Regular", 22), F("Kanit-Regular", 17), F("Kanit-Bold", 26)
# ---------------- front view (square 900px) ----------------
S, ox, oy = 900, 50, 60
def P(x, y):  # normalised -> px
    return (ox + x * S, oy + y * S)
# backdrop glow rings
for r, c in [(0.62, "#473E28"), (0.55, "#6E6141"), (0.5, "#8F7E50"), (0.46, "#C9B677"), (0.42, "#E7D27C"), (0.36, "#FDEF51"), (0.25, "#FEE976"), (0.14, "#FFF78C")]:
    cx, cy = P(0.49, 0.40)
    d.ellipse((cx - r * S, cy - r * S * 0.92, cx + r * S, cy + r * S * 0.92), fill=c)
d.rectangle((ox, oy, ox + S, oy + S), outline="#999", width=2)
# mask outside square
d.rectangle((0, 0, ox - 1, H), fill="#20211C"); d.rectangle((ox + S + 1, 0, 1000, H), fill="#20211C")
d.rectangle((0, 0, 1000, oy - 1), fill="#20211C"); d.rectangle((0, oy + S + 1, 1000, H), fill="#20211C")
# floor & rug
d.polygon([P(0, 0.68), P(1, 0.68), P(1, 1), P(0, 1)], fill="#DFD7C7")
d.polygon([P(0.0, 0.76), P(1, 0.74), P(1, 1), P(0, 1)], fill="#5B5A2E")
for yy in (0.79, 0.91, 0.945):
    d.line([P(0, yy), P(1, yy - 0.01)], fill="#A0AA69", width=3)
# horizon
d.line([P(0, 0.634), P(1, 0.634)], fill="#FF5050", width=1)
d.text(P(0.005, 0.605), "horizon / eye level ≈ 63% down (camera h≈0.38 m = table top)", font=fs, fill="#FF8080")
# sofa
d.rounded_rectangle([P(0.20, 0.50), P(0.74, 0.66)], radius=14, fill="#A35E1B")
# table + jenga
d.rectangle([P(0.38, 0.625), P(0.72, 0.66)], fill="#E17539")
d.rectangle([P(0.48, 0.49), P(0.535, 0.63)], fill="#C04A5A")
for i in range(13):
    y = 0.49 + i * 0.0108
    c = ["#C8202A", "#2B3FA8", "#F2C531", "#4CA64C", "#E0457B", "#F08A2E", "#6B3FA0"][i % 7]
    d.rectangle([P(0.48, y), P(0.535, y + 0.0095)], fill=c)
# blue chair (g1)
d.polygon([P(0.0, 0.50), P(0.17, 0.52), P(0.18, 0.69), P(0.0, 0.70)], fill="#0A2A9E")
d.polygon([P(0.15, 0.70), P(0.21, 0.70), P(0.30, 0.97), P(0.14, 0.98)], fill="#0A2A9E")
# orange chair (g4)
d.polygon([P(0.71, 0.49), P(0.88, 0.50), P(0.86, 0.76), P(0.74, 0.74)], fill="#C07A1E")
for x0, x1 in ((0.74, 0.72), (0.86, 0.92), (0.95, 0.99)):
    d.line([P(x0, 0.76), P(x1, 0.93)], fill="#5A3A10", width=4)
# people silhouettes (ellipses heads + body boxes)
def person(lbl, head, body, legs, col, txt):
    hx, hy, hr = head
    d.ellipse([P(hx - hr, hy - hr * 1.2), P(hx + hr, hy + hr * 1.2)], fill="#1A1410")
    d.polygon([P(*p) for p in body], fill=col)
    for L in legs:
        d.line([P(*p) for p in L], fill="#1E1A2A", width=26)
    d.text(P(hx - 0.03, hy - hr * 1.2 - 0.05), lbl, font=fb, fill="#FFFFFF")
    d.text(P(hx - 0.06, hy - hr * 1.2 - 0.022), txt, font=fs, fill="#FFFFFF")
person("G1", (0.19, 0.27, 0.06), [(0.0, 0.33), (0.20, 0.36), (0.24, 0.48), (0.0, 0.52)],
       [[(0.20, 0.60), (0.40, 0.62), (0.56, 0.88)]], "#F8F7F9", "blue S-chair, leans fwd")
person("G2", (0.39, 0.15, 0.065), [(0.25, 0.22), (0.47, 0.22), (0.46, 0.46), (0.27, 0.46)],
       [[(0.31, 0.46), (0.32, 0.78)], [(0.42, 0.46), (0.44, 0.78)]], "#7DA24D", "standing, afro")
person("G3", (0.63, 0.33, 0.05), [(0.58, 0.38), (0.76, 0.38), (0.72, 0.56), (0.58, 0.56)],
       [[(0.60, 0.58), (0.66, 0.64), (0.66, 0.72)]], "#F4F7F1", "on sofa, reaches tower")
person("G4", (0.79, 0.26, 0.055), [(0.74, 0.30), (1.0, 0.30), (1.0, 0.58), (0.80, 0.58)],
       [[(0.88, 0.60), (0.84, 0.80), (0.80, 0.96)]], "#F0EFE9", "side-saddle on orange chair")
# title + subtitle zones
d.rectangle([P(0.18, 0.63), P(0.84, 0.89)], outline="#7CFF6A", width=3)
d.text(P(0.20, 0.64), "TITLE ZONE  x 0.18–0.84, y 0.63–0.89  → 'เฮียผัด!'", font=f, fill="#7CFF6A")
d.rectangle([P(0.38, 0.915), P(0.65, 0.985)], outline="#B8FFB0", width=2)
d.text(P(0.385, 0.925), "subtitle / Host·Join row", font=fs, fill="#B8FFB0")
d.text((ox, 20), "FRONT VIEW (cover framing, normalised coords)", font=fb, fill="#FFFFFF")
# ---------------- top view ----------------
tx, ty, sc = 1100, 80, 160  # px per metre; camera at (tx+ 0.0) bottom
cam = (tx + 2.5 * sc, ty + 5.4 * sc)
def T(x, z):  # x lateral (m, +right), z depth from camera (m)
    return (cam[0] + x * sc, cam[1] - z * sc)
d.text((tx, 20), "TOP VIEW (metres, camera at origin looking +z)", font=fb, fill="#FFFFFF")
for z in range(0, 6):
    d.line([T(-2.5, z), T(2.5, z)], fill="#33352C")
    d.text(T(-2.5, z), f"{z} m", font=fs, fill="#77796C")
# backdrop sweep
d.arc([T(-2.6, 5.2), T(2.6, 4.2)], 180, 360, fill="#FDEF51", width=6)
d.text(T(-0.8, 5.05), "paper backdrop (spot glow centre h≈1.25 m)", font=fs, fill="#FDEF51")
d.rectangle([T(-1.5, 3.9), T(1.5, 1.4)], outline="#6A6938", width=4)
d.text(T(-1.45, 1.55), "green rug ~3.0 × 2.5 m", font=fs, fill="#A0AA69")
d.rectangle([T(-0.45, 2.75), T(0.45, 2.25)], fill="#E17539"); d.text(T(-0.4, 2.62), "table 0.9×0.5 h0.38", font=fs, fill="#20211C")
d.rectangle([T(-0.06, 2.56), T(0.06, 2.44)], fill="#C8202A"); d.text(T(0.08, 2.5), "Jenga", font=fs, fill="#FFFFFF")
d.rounded_rectangle([T(-0.9, 3.45), T(0.9, 2.95)], radius=10, fill="#A35E1B"); d.text(T(-0.2, 3.3), "sofa", font=fs, fill="#20211C")
for lbl, x, z, c in [("G1 blue chair", -0.72, 2.2, "#0A2A9E"), ("G2 standing", -0.36, 3.25, "#7DA24D"), ("G3 on sofa", 0.29, 2.95, "#F4F7F1"), ("G4 orange chair", 0.62, 2.3, "#C07A1E")]:
    d.ellipse([T(x - 0.18, z + 0.18), T(x + 0.18, z - 0.18)], fill=c, outline="#000")
    d.text(T(x - 0.3, z - 0.22), lbl, font=fs, fill="#FFFFFF")
d.line([T(-0.72, 2.2), T(0.07, 1.7)], fill="#D4B57C", width=5); d.text(T(-0.3, 1.62), "G1 foot", font=fs, fill="#D4B57C")
d.line([T(0.62, 2.3), T(0.33, 1.45)], fill="#111", width=5); d.text(T(0.36, 1.35), "G4 foot", font=fs, fill="#BBBBBB")
# camera + FOV
d.ellipse([cam[0] - 10, cam[1] - 10, cam[0] + 10, cam[1] + 10], fill="#FF5050")
for s_ in (-1, 1):
    a = math.radians(21) * s_
    d.line([cam, (cam[0] + math.sin(a) * 5.5 * sc, cam[1] - math.cos(a) * 5.5 * sc)], fill="#FF5050", width=2)
d.text((cam[0] + 16, cam[1] - 30), "camera h 0.38–0.45 m, pitch +6°, HFOV≈42° (≈47 mm FF)", font=fs, fill="#FF8080")
im.save("/home/user/special-telegram/references/ui/album_cover_blocking.png", optimize=True)
print("ok")
