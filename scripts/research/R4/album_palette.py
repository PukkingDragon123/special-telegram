"""Palette swatch sheet of colours sampled from ref4 (values from sample_album*.py)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image, ImageDraw
from printfx import F
groups = [
 ("Backdrop glow (centre → corner)", [("core", "#FFF78C"), ("inner", "#FEF288"), ("yellow", "#FEE976"), ("sat. yellow", "#FDEF51"), ("warm", "#FADD73"), ("ochre", "#EFCD76"), ("olive", "#C8B278"), ("olive-brown", "#887854"), ("top", "#6E6141"), ("corner", "#473E28")]),
 ("Floor / rug", [("floor cream", "#DFD7C7"), ("floor warm", "#E4DDC0"), ("rug base", "#5B5A2E"), ("rug mid", "#6A6938"), ("rug dark", "#484525"), ("rug shadow", "#242514"), ("rug band", "#A0AA69"), ("rug stripe", "#64A254")]),
 ("Furniture", [("blue chair", "#021571"), ("blue shadow", "#011356"), ("blue hi", "#172A78"), ("orange chair", "#A0743E"), ("orange mid", "#723A07"), ("sofa", "#A35E1B"), ("sofa hi", "#E8A45F"), ("sofa dark", "#5C200F"), ("table", "#E17539"), ("table hi", "#EB9661")]),
 ("Jenga blocks", [("red", "#DD7A69"), ("red dk", "#943C2F"), ("orange", "#F4B066"), ("orange dk", "#B97838"), ("yellow", "#FEE97A"), ("blue", "#4A5BB4"), ("blue dk", "#283284"), ("purple", "#9952B4"), ("pink", "#E16CA7"), ("rose", "#ED7387")]),
 ("G1 / G2", [("G1 shirt", "#F8F7F9"), ("G1 stripe", "#A29BBF"), ("G1 trousers", "#D4B57C"), ("G1 tr. shadow", "#554630"), ("G1 hair", "#10080B"), ("G2 shirt grn", "#7DA24D"), ("G2 shirt yel", "#F4E376"), ("G2 tee", "#FEFEFD"), ("G2 jeans", "#0F0C1C"), ("G2 lenses", "#984A30")]),
 ("G3 / G4 / skin", [("G3 tee", "#F4F7F1"), ("G3 stripe", "#7D6A5E"), ("G3 jeans", "#0A0615"), ("G3 jeans hi", "#2940A0"), ("G4 shirt", "#F0EFE9"), ("G4 pattern", "#716869"), ("G4 trousers", "#050303"), ("skin hi", "#F2CB91"), ("skin mid", "#C98A5E"), ("skin dark", "#814E35")]),
 ("Title lettering", [("fill", "#FBFDF8"), ("inner line", "#0F1A0B"), ("green band", "#6CBF4B"), ("green hi", "#86CF66"), ("green lo", "#4E9E3A"), ("outer edge", "#1E3314"), ("subtitle outline", "#99B07B")]),
]
sw, sh = 150, 92
W = 10 * sw + 40
H = len(groups) * (sh + 54) + 30
im = Image.new("RGB", (W, H), "#1C1C1A")
d = ImageDraw.Draw(im)
y = 20
for title, cols in groups:
    d.text((20, y), title, font=F("Sarabun-Bold", 24), fill="#FFFFFF")
    y += 32
    for i, (n, h) in enumerate(cols):
        x = 20 + i * sw
        d.rectangle((x, y, x + sw - 8, y + sh - 30), fill=h)
        d.text((x, y + sh - 28), f"{n}", font=F("Sarabun-Regular", 15), fill="#DDDDDD")
        d.text((x, y + sh - 12), h, font=F("Sarabun-Regular", 13), fill="#AAAAAA")
    y += sh + 22
im.save("/home/user/special-telegram/references/ui/album_cover_palette.png", optimize=True)
print("ok")
