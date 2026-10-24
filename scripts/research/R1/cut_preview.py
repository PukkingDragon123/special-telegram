"""Cut out candidate litter photos and save previews (for choosing). usage: python3 -I cut_preview.py id ..."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from photodecal import *
from PIL import Image, ImageDraw, ImageFont
OUT = "/tmp/claude-0/-home-user-special-telegram/7e6bcd1d-aa72-520f-8b31-cf837c26660e/scratchpad/R1/cut"
F = ImageFont.truetype("/home/user/special-telegram/scripts/_cache/fonts/Sarabun-Bold.ttf", 14)
tiles = []
for cid in sys.argv[1:]:
    try:
        a, has = load_any(cid)
    except Exception as e:
        print(cid, "ERR", e); continue
    frac_transparent = float((a[..., 3] < 0.5).mean())
    if not has or frac_transparent < 0.02:
        a = key_background(a, tol=0.09)
    a = trim(a)
    a = decontaminate(a)
    save_rgba(a, f"{OUT}/{cid}.png")
    im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8), "RGBA")
    im.thumbnail((200, 200))
    bg = Image.new("RGBA", (210, 230), (96, 104, 92, 255))
    bg.alpha_composite(im, ((210 - im.width) // 2, (210 - im.height) // 2))
    d = ImageDraw.Draw(bg)
    d.text((4, 212), f"{cid} {'A' if has else 'K'}", fill=(255, 230, 80), font=F)
    tiles.append(bg)
cols = 8
rows = (len(tiles) + cols - 1) // cols
sheet = Image.new("RGB", (cols * 210, rows * 230), (20, 20, 20))
for i, t in enumerate(tiles):
    sheet.paste(t.convert("RGB"), ((i % cols) * 210, (i // cols) * 230))
sheet.save(OUT + "/_sheet.jpg", quality=85)
print("ok", len(tiles))
