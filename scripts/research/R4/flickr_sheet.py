"""Contact sheet of Flickr search results (small thumbs) for quick curation.
Usage: python3 -I flickr_sheet.py "<query>" <out.jpg> [n=24] [clean|any] [sort]"""
import sys, os, io, requests
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image, ImageDraw, ImageFont
import flickr as FL

q, out = sys.argv[1], sys.argv[2]
n = int(sys.argv[3]) if len(sys.argv) > 3 else 24
mode = sys.argv[4] if len(sys.argv) > 4 else "any"
sort = sys.argv[5] if len(sys.argv) > 5 else "relevance"
kw = dict(text=q, per_page=str(n), sort=sort, content_type="1", media="photos", extras="license,owner_name,url_n,url_q")
if mode == "clean":
    kw["license"] = FL.CLEAN
d = FL.rest("flickr.photos.search", **kw)
phs = d["photos"]["photo"]
if not phs:
    print("0 results for", q); sys.exit(0)
cols = 6
tw, th = 300, 230
sheet = Image.new("RGB", (cols * tw, ((len(phs) + cols - 1) // cols) * th), (30, 30, 30))
dr = ImageDraw.Draw(sheet)
font = ImageFont.truetype("/home/user/special-telegram/scripts/_cache/fonts/Sarabun-Regular.ttf", 14)
for i, ph in enumerate(phs):
    u = ph.get("url_n") or ph.get("url_q")
    if not u:
        continue
    try:
        im = Image.open(io.BytesIO(requests.get(u, headers=FL.UA, timeout=20).content)).convert("RGB")
        im.thumbnail((tw - 6, th - 30))
        x, y = (i % cols) * tw, (i // cols) * th
        sheet.paste(im, (x + 3, y + 3))
        lic = FL.LIC.get(str(ph["license"]), "?")
        dr.text((x + 4, y + th - 26), f"{ph['id']} {lic[:16]}", font=font, fill=(255, 255, 0))
    except Exception:
        pass
sheet.save(out, quality=85)
print(len(phs), "results ->", out)
