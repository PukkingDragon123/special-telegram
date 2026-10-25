# Cooking (food polish) — asset credits

Everything here is derived from **real photos / scans / recordings**. Nothing is hand-painted.

## 3D scans — `models/` (Poly Haven, CC0)

Downloaded and decimated (~450–500 tris, 512 px WebP textures, meshopt geometry) with `scripts/polyhaven.mjs`.
See `models/CREDITS.md` and `models/manifest.json`.

| file | source | author | used for |
|---|---|---|---|
| `models/food_lime_01/food_lime_01.glb` | https://polyhaven.com/a/food_lime_01 | Oliver Harries | lime (มะนาว) |
| `models/yellow_onion/yellow_onion.glb` | https://polyhaven.com/a/yellow_onion | Kuutti Siitonen | onion (หอมใหญ่) |
| `models/food_ginger_01/food_ginger_01.glb` | https://polyhaven.com/a/food_ginger_01 | Oliver Harries | galangal (ข่า), tinted |

## Photo-derived maps

Source photos are the real cut-outs in `public/assets/textures/food/` (their sources are listed in
`references/credits/R2-food.md` and `textures/food/manifest.json`). Derived with a numpy/scipy script
(alpha distance/blur dome + photo luminance detail; yolk found by colour), no painting:

| file | derived from |
|---|---|
| `relief/<name>_h.png` (64 px height maps) + `relief/<name>_n.jpg` (detail normal maps) + `relief/meta.json` (yolk centre/radius) | `textures/food/<name>.png` for egg_fried_crispy / runny / burnt, rice_mound_top, basil_bunch_fresh / cooked, chili_red_bunch, chili_green_pile, garlic_bulbs_bunch, garlic_crushed, garlic_minced_pile, shrimp_raw_pile, omelette_whole, long_beans_bundle, kale_leaf, onion_slices, shallots_sliced |
| `leaf_basil.png`, `leaf_basil_n.jpg` | crop of the top leaf of `textures/food/basil_sprig_fresh.png` |
| `chili_red_strip.jpg`, `chili_green_strip.jpg` (+ `_n`) | `textures/food/chili_red_single.png` / `chili_green_single.png`, each row resampled across the chili silhouette (a straightened unwrap) |
| `egg_shell.jpg`, `egg_shell_n.jpg` | de-shaded, mirror-tiled shell patch of a real Thai brown egg: Shopee listing "ไข่ไก่สดใหม่จากฟาร์ม เบอร์ 3 ไข่ไก่อารมณ์ดี", https://down-th.img.susercontent.com/file/th-11134207-7rasb-m5egp3hjf48a77 (copy: `references/food/_raw/cand/ingr_eggs/ingr_eggs_02.jpg`), licence unknown — same status as the other R2 web photos |

## Impact sounds — `audio/` (trimmed ≤ 0.5 s, mono, normalised, MP3)

Registered at runtime as Sound keys `food_plap`, `food_splat`, `food_squish`, `food_thud`, `food_tok`, `food_shell`,
`food_jelly`, `food_soft`, `food_bounce`, `food_rattle` (see `src/modules/cooking/juice.ts`).

**Kenney "Impact Sounds"** (CC0) — https://kenney.nl/assets/impact-sounds

| file | Kenney source |
|---|---|
| `plap_3` | impactPunch_medium_001 |
| `thud_1`, `thud_2`, `thud_3` | impactSoft_heavy_000, impactSoft_heavy_002, impactPunch_heavy_001 |
| `tok_1`, `tok_2`, `tok_3` | impactGeneric_light_000 / 002, impactWood_light_001 (pitched up) |
| `shell_1`, `shell_2` | impactPlate_light_000 / 002 (pitched up: egg-shell tock) |
| `soft_2`, `soft_3` | impactSoft_medium_000 / 002 |
| `rattle_1`, `rattle_2` | layered quick hits of impactGeneric_light_000–004 and impactWood_light_002 / 003 |

**Mixkit** (Mixkit Sound Effects Free License, https://mixkit.co/license/#sfxFree) — `https://assets.mixkit.co/active_storage/sfx/<id>/<id>.wav`

| file | Mixkit # / title |
|---|---|
| `plap_1` | #2920 Fish dropped hit |
| `plap_2` | #2159 Meat hit sound |
| `splat_1`, `splat_2` | #2889 Funny cartoon fast splat, #2890 Cartoon quick splat |
| `squish_1`, `squish_2` | #324 Juicy insect fast squish, #3167 Squishing a soggy cloth shirt |
| `jelly_1`, `jelly_2` | #135 Shaking jelly liquid on a plastic box, #3148 Set down jelly jar |
| `soft_1` | #754 Fall on foam splash |
| `bounce_1` | #2085 Basketball ball bouncing |
