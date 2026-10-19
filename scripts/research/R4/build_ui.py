"""Main-menu 2D art in the album-cover (ref4) lettering style -> public/assets/img/ui/
Run: python3 -I scripts/research/R4/build_ui.py"""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from printfx import *  # noqa
from titlefx import cover_title, compose, bubble, glyph_mask, STYLE_COVER

OUT = "/home/user/special-telegram/public/assets/img/ui/"
os.makedirs(OUT, exist_ok=True)
MAN = {"style": "ref4 album-cover lettering: warm-white fill #FBFDF8, thin inner contour #0F1A0B, "
                "thick green band #6CBF4B (gradient #86CF66 -> #4E9E3A), dark edge #1E3314, hard shadow down-right",
       "files": {}}

HOVER = dict(STYLE_COVER, fill="#FFE04A")          # backdrop-glow yellow fill on hover
PRESSED = dict(STYLE_COVER, fill="#F2C230", green="#5AAE3C", green_hi="#6CBF4B", green_lo="#3F8A2E")
DISABLED = dict(STYLE_COVER, fill="#D9D6CC", green="#8FA088", green_hi="#A3B19C", green_lo="#768871", outer="#3A4236")


def save(img, name, note, **kw):
    img.save(OUT + name, optimize=True)
    MAN["files"][name] = dict(w=img.width, h=img.height, note=note, **kw)


def scaled_to_width(img, w):
    s = w / img.width
    return img.resize((w, max(1, int(img.height * s))), Image.LANCZOS)


# 1) title
t = cover_title("เฮียผัด!", "Chonburi-Regular", 420, round_px=420 * 0.022, fatten_px=420 * 0.03)
save(scaled_to_width(t, 2048) if t.width > 2048 else t, "title_hiaphat.png",
     "main title, Chonburi fattened + rounded (bubbly 70s serif like the cover). Place bottom-centre over the rug, ~62% of screen width")
t2 = cover_title("เฮียผัด!", "Mitr-Bold", 400, round_px=400 * 0.015, fatten_px=400 * 0.012)
save(t2, "title_hiaphat_alt_mitr.png", "alternate title, Mitr Bold (rounder, cleaner)")

# 2) subtitles (the cover's small 'hong ser' line: rounded bold, white fill, thin green outline, no inner line)
def subtitle(text, font, size, name, note):
    pad = int(size * 0.3)
    m = glyph_mask(text, font, size, pad, ss=2)
    mb = bubble(m, size * 0.01, size * 0.004)
    img = compose(mb, size * 0.72, inner_w=0.0, green_w=0.075, outer_w=0.0, shadow=(0.02, 0.03))
    img = img.crop(img.getbbox())
    save(img, name, note)


subtitle("hia phat!", "Mitr-Bold", 200, "subtitle_hiaphat_latin.png", "romanised subtitle in the cover's 'hong ser' position")
subtitle("ร้อยบาทสร้างตัว", "Mitr-Medium", 180, "tagline_roi_baht_sang_tua.png", "Thai tagline: 'building a life from 100 baht'")
subtitle("ตำนานกะเพราร้อยบาท", "Mitr-Medium", 180, "tagline_tamnan_kaprao.png", "alt tagline: 'legend of the 100-baht kaprao'")

# 3) buttons: text-only bubble stickers + small English line under (in the same style but thinner)
def button(th, en, name, styles=(("", STYLE_COVER), ("_hover", HOVER), ("_pressed", PRESSED), ("_disabled", DISABLED))):
    for suffix, st in styles:
        main = cover_title(th, "Mitr-Bold", 200, round_px=3, fatten_px=2.5, style=st)
        pad = 24
        m = glyph_mask(en, "Kanit-Black", 74, pad, ss=2, tracking=6)
        small = compose(bubble(m, 1.0, 1.0), 74 * 0.72, inner_w=0.0, green_w=0.11, outer_w=0.03, shadow=(0.03, 0.05), style=st)
        small = small.crop(small.getbbox())
        W = max(main.width, small.width) + 8
        Hh = main.height + small.height - 18
        canvas = Image.new("RGBA", (W, Hh), (0, 0, 0, 0))
        canvas.alpha_composite(main, ((W - main.width) // 2, 0))
        canvas.alpha_composite(small, ((W - small.width) // 2, main.height - 18))
        save(canvas, f"{name}{suffix}.png", f"button '{th}' / {en} ({suffix.strip('_') or 'normal'})")


button("สร้างห้อง", "HOST", "btn_host")
button("เข้าร่วม", "JOIN", "btn_join")
button("เริ่มเลย!", "START", "btn_start")
button("แต่งตัว", "CUSTOMIZE", "btn_customize")
button("ออก", "QUIT", "btn_quit", styles=(("", STYLE_COVER), ("_hover", HOVER)))


# 4) plates (room code / player name) — rounded sticker plates; game draws text inside
def plate(w, h, name, note, label=None):
    pad = 60
    im = Image.new("L", (w + 2 * pad, h + 2 * pad), 0)
    ImageDraw.Draw(im).rounded_rectangle((pad, pad, pad + w, pad + h), radius=int(h * 0.42), fill=255)
    m = np.asarray(im) > 127
    img = compose(m, h * 0.9, inner_w=0.022, green_w=0.10, outer_w=0.025, shadow=(0.03, 0.06))
    if label:
        lab = cover_title(label, "Mitr-Bold", 70, round_px=1.5, fatten_px=1.0)
        img.alpha_composite(lab, (pad + 30, max(0, pad - lab.height // 2)))
    img = img.crop(img.getbbox())
    inner = dict(x=pad + int(h * 0.30), y=pad + int(h * 0.18), w=w - int(h * 0.6), h=h - int(h * 0.36))
    save(img, name, note, text_region=inner, text_font="Kanit-Black", text_color="#1E3314")


plate(760, 170, "plate_room_code.png", "room-code plate (game draws the code in the white area)", label="รหัสห้อง")
plate(620, 130, "plate_player_name.png", "player name tag over each of the 4 guys")


# 5) 'you' arrow + waiting label
def arrow(name):
    W, Hh = 420, 520
    im = Image.new("L", (W, Hh), 0)
    d = ImageDraw.Draw(im)
    # wobbly hand-cut arrow pointing down
    pts = [(150, 60), (270, 50), (262, 300), (360, 292), (212, 470), (60, 300), (158, 306)]
    d.polygon(pts, fill=255)
    m = np.asarray(im) > 127
    m = bubble(m, 9, 0)
    img = compose(m, 260, inner_w=0.016, green_w=0.10, outer_w=0.022, shadow=(0.035, 0.05))
    lab = cover_title("คุณ", "Mitr-Bold", 150, round_px=3, fatten_px=2)
    canvas = Image.new("RGBA", (max(img.width, lab.width) + 20, img.height + lab.height - 10), (0, 0, 0, 0))
    canvas.alpha_composite(lab, ((canvas.width - lab.width) // 2, 0))
    canvas.alpha_composite(img, ((canvas.width - img.width) // 2, lab.height - 10))
    canvas = canvas.crop(canvas.getbbox())
    save(canvas, name, "arrow that bobs above YOUR character on the menu ('คุณ' = you); click to customise")


arrow("arrow_you.png")
w = cover_title("รอเพื่อน...", "Mitr-Bold", 140, round_px=1.5, fatten_px=0.5, style=DISABLED)
save(w, "label_waiting_friend.png", "label over an empty (silhouette) slot: 'waiting for a friend...'")
for i in range(1, 5):
    n = cover_title(f"P{i}", "Mitr-Bold", 120, round_px=1.5, fatten_px=0.5)
    save(n, f"label_p{i}.png", f"player slot number {i}")

with open(OUT + "manifest.json", "w", encoding="utf-8") as f:
    json.dump(MAN, f, ensure_ascii=False, indent=1)
print(len(MAN["files"]), "files")
