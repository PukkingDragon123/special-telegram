"""Write references/credits/R4-culture-ui.md from the source logs (_sources.tsv) and kit manifests.
Run: python3 -I scripts/research/R4/build_credits.py"""
import os, sys, json, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_newspaper as NP

ROOT = "/home/user/special-telegram"
RAW = ROOT + "/references/ui/_raw/"
A = ROOT + "/public/assets/img/"
OUT = ROOT + "/references/credits/R4-culture-ui.md"

SRC = {}
for sub in ("photos", "ads", "mag", "posters"):
    p = RAW + sub + "/_sources.tsv"
    for line in open(p, encoding="utf-8"):
        f = line.rstrip("\n").split("\t")
        if len(f) >= 4:
            SRC[sub + "/" + f[0]] = dict(url=f[1], author=f[2], license=f[3], title=(f[5] if len(f) > 5 else ""))
# derived crop (watermark removed) of a casino photo
SRC["photos/flickr_9396537891_crop.jpg"] = dict(url="https://www.flickr.com/photos/58628800@N05/9396537891/", author="Kev Cook", license="CC BY 4.0", title="Baccarat Tables (cropped)")
SRC["mag/talat_noi_mural_cc0.jpg"] = SRC.get("photos/flickr_55591634412.jpg", SRC.get("mag/talat_noi_mural_cc0.jpg"))

ACG = {
    "Paper001": "https://ambientcg.com/view?id=Paper001", "Paper002": "https://ambientcg.com/view?id=Paper002",
    "Paper003": "https://ambientcg.com/view?id=Paper003", "Paper006": "https://ambientcg.com/view?id=Paper006",
    "Cardboard002": "https://ambientcg.com/view?id=Cardboard002",
}

use = {}  # source key -> set(shipped paths)


def add(src, shipped):
    use.setdefault(src, set()).add(shipped)


# ---- newspaper
fronts = ["newspaper/front_template_blank.jpg", "newspaper/front_example_day1.jpg", "newspaper/front_example_good_day.jpg", "newspaper/front_example_disaster_day.jpg"]
for name, spec in NP.PHOTOS.items():
    key = "photos/" + spec[0]
    for suf in ("color", "bw"):
        add(key, f"newspaper/photos/{name}_{suf}.jpg")
on_all = ["traffic_night", "kaprao_egg_closeup", "market_garlic", "food_cart", "hippo_baby"]
per_page = {"newspaper/front_example_day1.jpg": ["casino_tables", "soi_dog"], "newspaper/front_example_good_day.jpg": ["crowd_foodcourt", "kaprao_egg"],
            "newspaper/front_example_disaster_day.jpg": ["wok_fire", "flood_shop"]}
for fr in fronts:
    for n in on_all:
        add("photos/" + NP.PHOTOS[n][0], fr)
    for n in per_page.get(fr, []):
        add("photos/" + NP.PHOTOS[n][0], fr)
    for ad in ("hazy_sun", "herbal_roots", "takrut_gold", "lottery_tickets", "apartment_facade"):
        add("ads/" + ad + ".jpg", fr)
add("ads/herbal_roots.jpg", "newspaper/parts/ad_herbal.png")
add("ads/takrut_gold.jpg", "newspaper/parts/ad_takrut.png")
add("ads/lottery_tickets.jpg", "newspaper/parts/ad_lottery.png")
add("ads/apartment_facade.jpg", "newspaper/parts/ad_room_for_rent.png")
for f in fronts + ["newspaper/newsprint_tile_2048.jpg", "newspaper/newsprint_sheet_folded_1448x2048.jpg", "newspaper/newsprint_sheet_folded_normal_1448x2048.jpg"]:
    add("acg/Paper002", f)
    add("acg/Paper003", f)

# ---- magazine
ml = json.load(open(A + "magazine/layout.json", encoding="utf-8"))
mag_files = [os.path.relpath(p, A) for p in glob.glob(A + "magazine/spread_*.jpg") + glob.glob(A + "magazine/preview_*.jpg")]
for n in ml["photo_sources"]:
    key = "mag/" + n + ".jpg"
    if n == "talat_noi_mural_cc0":
        add(key, "magazine/cover_soikay_1024x1448.jpg")
    elif n == "sticky_note":
        for t in glob.glob(A + "magazine/tabs/*.png"):
            add(key, os.path.relpath(t, A))
        add(key, "magazine/preview_spread_A_with_tabs.jpg")
    else:
        for f in mag_files:
            add(key, f)
for f in glob.glob(A + "magazine/**/*.*", recursive=True):
    r = os.path.relpath(f, A)
    if r.endswith((".jpg", ".png")) and not any(x in r for x in ("normal", "gutter", "marks/", "tabs/", "roughness")):
        add("acg/Paper001", r)

# ---- recipebook
for f in glob.glob(A + "recipebook/*.png"):
    r = os.path.relpath(f, A)
    for m in ("Paper001", "Paper003"):
        add("acg/" + m, r)
add("acg/Paper006", "recipebook/cover.png")

# ---- posters
pm = json.load(open(A + "posters/manifest.json", encoding="utf-8"))
for fn, info in pm["files"].items():
    for s in info.get("sources", []):
        add(s["file"], "posters/" + fn)
    if "cardboard" in fn:
        add("acg/Cardboard002", "posters/" + fn)
    else:
        add("acg/Paper001", "posters/" + fn)
    if fn.startswith(("poster_", "menu_cardboard")):
        add("acg/Paper003", "posters/" + fn)

lines = ["# R4-culture-ui — credits & licences",
         "",
         "Format: **shipped path** (under `public/assets/img/`) | source URL | author | licence.",
         "",
         "**Licence note (client rule change, Oct 2026):** the coordinator relayed the client's instruction to build the newspaper / magazine / posters "
         "from *real internet images, any licence*, recording source URLs. Several sources below are **All Rights Reserved** Flickr photos. "
         "They are heavily processed (halftoned, cropped, composited) but are **not licence-clean** — replace them with CC/PD equivalents (or obtain permission) "
         "before any public/commercial release. CC BY / CC BY-SA sources require attribution in the game credits; CC BY-SA derivatives "
         "(the composited pages) should be shared under CC BY-SA. Images marked CC BY-NC / NC-ND are non-commercial only.",
         "",
         "## Own creations (no third-party content)",
         "- `ui/*` (title, buttons, plates, arrow, labels) — rendered from OFL fonts (Chonburi, Noto Sans Thai Looped). OFL fonts are in `public/assets/fonts/`.",
         "- All print simulation (halftone, misregistration, folds, stains, handwriting jitter, doodles), layouts, Thai copy and parody brands (ไทยรั่ว, ซอยเก๋, 8-Twelve, ตราเสือหลับ, น้องหมูดึ๋ง).",
         "- `references/ui/album_cover_blocking.png`, `album_cover_palette.png` (diagram/swatches drawn by script; colours sampled from the client's reference).",
         "",
         "## Material scans (CC0)",
         ]
for m, url in ACG.items():
    files = sorted(use.get("acg/" + m, []))
    if files:
        lines.append(f"- **ambientCG {m}** | {url} | ambientCG (Lennart Demes) | CC0 1.0 — used in {len(files)} files: " + ", ".join(f"`{f}`" for f in files[:12]) + (" …" if len(files) > 12 else ""))
lines += ["", "## Photos (by source)", "", "| Source photo | Author | Licence | Shipped files that contain it |", "|---|---|---|---|"]
order = sorted([k for k in use if not k.startswith("acg/")], key=lambda k: (SRC.get(k, {}).get("license", "zz"), k))
for k in order:
    s = SRC.get(k, {})
    files = sorted(use[k])
    lic = s.get("license", "?")
    flag = " ⚠" if ("All Rights" in lic or "NC" in lic) else ""
    lines.append(f"| [{k.split('/')[-1]}]({s.get('url', '')}) {s.get('title', '')[:40]} | {s.get('author', '?')} | {lic}{flag} | " + "<br>".join(f"`{f}`" for f in files) + " |")
lines += ["", "## Look-only references (NOT shipped)",
          "- `references/ui/web/newspaper/` — Wikimedia Commons: Thai Rath front pages 1968/1969 (public domain scans), "
          "'Thai newspapers for sale at newsstand' (Maksym Kozlenko, CC BY-SA 4.0), 'Man in Tuk-Tuk with Newspaper' (Adam Jones, CC BY-SA 2.0). URLs in `_sources.tsv`.",
          "- `references/ui/web/magazine/`, `references/ui/web/casino/` — Flickr, mostly All Rights Reserved; URLs in each `_sources.tsv`.",
          "- `references/user/ref4_ALBUM_COVER_main_menu.jpg` — client-supplied (third-party album cover); only measured, never shipped.", ""]
open(OUT, "w", encoding="utf-8").write("\n".join(lines))
print("sources", len(order), "->", OUT)
