# Thai streets: world art bible (R1-streets)

What this covers: how the map in เฮียผัด! should look so it reads as **real Thailand**, meaning busy, dirty, old, hot, hazy and **not cozy**.

Where the files are:
- `references/streets/web/` has 80 reference photos, each ≤1280 px. The folder is git-ignored, so look at them but never ship them. File names follow `topic__title__id.jpg`; this document refers to them by **id**.
- `public/assets/textures/world/` holds the game textures and decals. `manifest.json` gives each one's purpose, size, alpha, tiling, real size in metres and sources.
- `public/assets/img/signs/` holds 66 signs, plates and posters cut from **real photos**. Its `manifest.json` gives the Thai text, the English meaning, real size and mount type.
- Credits are in `references/credits/R1-streets.md`. Rows marked `unknown` are web images whose licence was not checked. The client accepted these on 2026-10-19; the lead should review them before any public release.

> **Client rule (2026-10-19):** signs, plates, posters, facades and decals come from **real internet photos**. Crop, rectify and clean them. Do not hand-draw them. Any Thai text rendered in-engine must use a **looped** Thai font (ไทยมีหัว): Sarabun, Noto Sans/Serif Thai Looped, Taviraj, Trirong, Chonburi, Pattaya, Charm/Charmonman, Srisakdi, Itim, Mali or Sriracha. Never use Kanit, Mitr, Prompt, Chakra Petch, Bai Jamjuree or Athiti.

---

## 1. What makes it read as Thai (checklist)

1. **Shophouse rows (ตึกแถว).** Narrow 4 m bays repeat endlessly, 3–4 storeys, flat roofs with water tanks, rebar stubs and antennas. Every bay is personalised: a different paint colour, sign, awning, grille and set of plants. *Refs:* `5e87d09e`, `7a353dab`, `d68602c2`, `7b1b2eb6`, `dfa9202c`.
2. **Overhead cable chaos.** Concrete poles carry fat black bundles of telecom cable, loops of spare cable, junction boxes, transformers, and sagging lines crossing the street at odd angles. *Refs:* `73880232`, `729fd97e`, `db508502`, `a9f1367e`, `dfa9202c`.
3. **The ground floor is fully open.** In the day the roller shutters are rolled up and the shop spills onto the footpath (goods, stools, motorbikes). At night the shutters come down, leaving a rusty steel wall with a padlock at the bottom.
4. **The footpath is not for walking.** It is occupied by food carts, plastic tables, parked motorbikes, poles, signs, gas cylinders and potted plants. Pedestrians walk on the road. *Refs:* `2490d0cf`, `4bd46b88`, `87010520`, `c76ba61e`, `dc1b885a`.
5. **Painted kerbs** (red-white, yellow-white, yellow-black), **tactile yellow strips** and grey pressed-concrete tiles, all broken, patched and sinking. *Refs:* `5d1ae719`, `40ff7eee`.
6. **Signage everywhere, in layers.** Red-and-gold Chinese-Thai gold shops, faded vinyl banners with food photos, hand-painted boards, light boxes, phone numbers (08x-xxx-xxxx) and English mixed into the Thai.
7. **Motorbikes outnumber everything.** Look for orange-vested win-motosai riders, delivery riders with boxes, families of three on one Honda Wave, tuk-tuks, pink and green-yellow taxis, songthaews, pickups piled high, and old red-cream buses.
8. **Small sacred things on the street:** spirit houses with garlands and red Fanta bottles, shrine cloths tied to old trees, temple walls with white crenellations.
9. **Climate damage.** Black mould streaks under every ledge, rust bleeding from everything metal, moss at wall bases, sun-bleached plastic, blue tarps, and puddles that never dry.
10. **Haze and light.** By day the sky is blown-out white-grey and shadows are soft; there is no blue-sky postcard. By night the light is mixed: sodium orange, cool fluorescent tubes, white LED, red and blue neon, and the 7-Eleven glowing white.

---

## 2. Palettes (hex values sampled from the reference photos and shipped textures)

### Day, hazy street
| role | hex |
|---|---|
| sky (blown out, overcast-hazy) | `#f9fafb` → `#d2d1d3` (horizon `#a8afb8`) |
| concrete / render, light | `#a8afb8`, `#888d94` |
| concrete / render, mid | `#727174`, `#5a585b` |
| shadows / openings | `#454343`, `#2f2b2c`, `#151315` |
| dust / warm dirt | `#b39a81` |
| asphalt (soi) | `#46423d` |
| footpath tiles | `#928e86` |
| streaked concrete wall | `#73736f` |
| shophouse paint accents (faded) | mint/teal `#2b8484`, sky blue `#608ebc`, cream `#d8cdb4`, rust `#7c3d1e` |
| signage accents | deep blue `#193583`, sign yellow `#d1a618`, Chinese red/gold `#b8242a` / `#dca831` |

Grade daytime toward **low saturation (≈0.85)**, a warm-grey haze (fog colour ≈ `#c9c6bf`), lifted blacks and soft contrast. The only strong colours should be signs, plastic, tuk-tuks and taxis.

### Night
| role | hex |
|---|---|
| sky / unlit | `#0e0b08`, `#261d17` |
| sodium-lit surfaces | `#502811`, `#844a28`, `#c9864f` |
| sodium lamp (≈2000 K, main roads, older sois) | `#df813e` core, `#e5a879` halo, `#eac5a5` glare |
| fluorescent tube (shops, stalls, sois) | `#dddeda` with a slight green tint `#e8ecea`; cool LED `#a5c6d9` |
| white LED street lights (newer, ≈4000–5000 K) | `#e9ecef` |
| blue LED / neon | `#4781ea`; red neon `#ff3b30`; pink `#ff4fa0` |
| 7-Eleven interior spill | pure white `#ffffff` over a green/orange fascia |

### Market and food
Chili or umbrella red `#a9381b`, orange `#db7f3b`, tarp blue `#375d80`/`#5782b4`, aluminium `#90a19b`, deep stall shadow `#120f0c`/`#352821`.

### Rural edge
Rice-paddy greens `#48802d`, `#659d45`; dark tree mass `#40492b`/`#172012`; dry dirt `#656353`/`#81846e`; hazy sky `#b2cbd1`/`#c8e7e8`.

### Official colours (sampled from the shipped sign photos)
BMA street-name sign blue `#1b82f4` (older and navy versions `#11326c`). Green direction sign `#14564d`. BMA district fingerpost `#2b565a`. No-parking disc: blue `#2c5f8e` with a red ring `#873d44`, which fades pinkish. Private licence plate white `#dedfe3`. Public-transport plate yellow `#febf29`. 7-Eleven fascia: green `#037e6f`, red `#ee1851`, orange. Makro red `#d85665`. Faded kerb paint: red `#8d4c43`, white `#979289`.

---

## 3. Materials list (what to texture with what)

| surface | texture(s) |
|---|---|
| main-road asphalt | `asphalt_main_worn` (3 m tile) + `roadline_*_photo` + `roadmark_zebra_worn_photo` + `decal_oil_stains_photo` |
| soi asphalt | `asphalt_soi_patched` + `decal_potholes_photo` + `decal_puddles_photo` + `manhole_*` |
| footpath | `sidewalk_tile_circles_grey` (classic BMA), `sidewalk_tile_red_hex` (old town), `sidewalk_tile_chain_grey` (newer), `sidewalk_tile_grid_grey_redband` + `tactile_strip_yellow`, `concrete_slab_footpath` (provincial / soi) |
| forecourts, market floor, parking | `paver_interlock_I`, `concrete_slab_footpath` |
| kerbs | `curb_red_white`, `curb_white_yellow`, `curb_yellow_black`, `curb_bare_concrete` (UV-unfolded profile; see manifest) |
| drains | `trench_grate_cast_iron_photo`, `manhole_square_bma`, `manhole_double_drain_cover`, `manhole_round_iron` |
| shophouse walls | `wall_peeling_paint_teal/orange/red_over_cream`, `wall_concrete_black_streaks`, `wall_concrete_mould_stained`, `wall_concrete_plain_dirty`, plus decals `decal_wall_grime_streaks_photo` and `decal_moss_photo` |
| ground-floor openings (closed) | `shutter_closed_rusty_white`, `shutter_closed_graffiti` (whole bay); tileable `shutter_slats_painted_green`, `shutter_slats_rusty_scan`, `shutter_slats_rust_brown` |
| security | `gate_folding_steel` (+ `_alpha.png`), `window_grille_white_on_glass` |
| old wooden houses / canal | `window_wood_shutters_old` (+ Poly Haven wood planks from R6 if needed) |
| AC condensers | `ac_outdoor_unit_front_a`, `ac_outdoor_unit_front_b` |
| roofs, fences, lean-tos | `corrugated_zinc_rusty`, `corrugated_zinc_streaked` |
| stall covers | `tarp_blue_photo`, `awning_stripes_*_photo` |
| overhead cables | tube geometry with `cable_black_rubber_photo`; bundles and tangles as alpha-tested cards with `wire_bundle_tangle_photo` |
| clutter decals | `decal_litter_atlas` (bags, bottles, cups, foam boxes, cans, caps), `decal_cigarette_butts_photo`, `decal_gum_spots_photo`, `decal_torn_posters_photo`, `decal_flyers_loan_cluster_photo` |

**PBR conventions.** Albedo is sRGB. Normal maps are OpenGL (+Y) and linear. ORM packs R = AO, G = roughness, B = metalness, all linear. Decal PNGs use straight alpha. Roughness guide: wet puddle 0.04, painted metal 0.4–0.55, rust 0.8–0.95, concrete 0.85–0.95, plastic 0.35–0.5.

---

## 4. Real dimensions (use these, in metres)

### Shophouses (ตึกแถว)
| item | value |
|---|---|
| bay (unit) width | **4.0** typical (old Chinatown 3.5–4.5, newer 4.0–5.0, double units 8.0) |
| depth | 12–16 (old rows up to 20+); new suburban townhouse rows ≈8 |
| storeys | 3–4 plus roof deck or mezzanine ("3.5 / 4.5 storeys"); old Chinatown 2–3 |
| ground floor, floor-to-floor | 3.6–4.2 (with mezzanine 4.5–5.0) |
| upper floors, floor-to-floor | 3.0–3.3 |
| total height | ≈ 11–15 (3–4 storeys) + 1.0 parapet + 1.5–2.0 water tank on stand |
| row length | 4–10 units; the building law caps a row at **40 m** before a gap ≥4 m (Ministerial Reg. 55) |
| party wall | 0.20 |
| balcony / canopy projection | 0.6–1.0 (concrete hood over the shutter at ≈3.2–3.8 m) |
| upper window band | 2.6–3.2 wide × 1.4–1.8 tall per bay, sill ≈0.9 |
| roller shutter (ประตูม้วน) | clear width 3.4–3.8 × height 2.8–3.5; slat pitch ≈75–80 mm; housing box 0.35–0.45 at the top |
| folding steel gate (ประตูยืด) | same opening, 2.4–3.0 high, lattice ≈12 cm, folded stack 0.3 |
| AC outdoor unit | 0.78–0.85 W × 0.55–0.62 H × 0.27–0.30 D, on wall brackets, 1–2 per floor |
| shop sign band | full bay width × 0.6–1.2, at 2.8–3.6 above the footpath |

### Streets
| item | value |
|---|---|
| soi carriageway | narrow 3–4 (one car), typical **5–7**, wide 8–10 |
| main road lane | 3.0–3.25 (urban), 3.5 (arterial); 2–4 lanes each way; raised median 1.2–3 |
| footpath (main road) | 1.5–3.0 (often 2.0–2.5), with the tree, pole and sign zone eating 0.6–1.0 of it |
| footpath (soi) | 0–1.2, often none or broken |
| kerb height | 0.15–0.20 (old ones up to 0.25); kerb width 0.15 |
| kerb paint blocks | 0.5 long (alternating colours) |
| footpath tiles | 0.40 × 0.40 or 0.30 × 0.30; tactile strip 0.30 wide |
| lane lines | 0.10–0.15 wide; urban dashes ≈2 m paint / 2 m gap (highway ≈3 m / 3–9 m); centre double yellow ≈2 × 0.10–0.12 |
| zebra crossing bars | 0.40–0.50 wide, same gap, 3–4 long |
| manhole | round ≈0.6–0.75; BMA square ≈0.6–0.8; footpath drain covers 0.6 × 0.6 every 6–10 m |
| speed bump | 0.10 high × 0.6–3.6 deep, painted yellow-black |

### Poles and wires
| item | value |
|---|---|
| concrete power pole | 9–12 high (12–14 for MEA HV); square or octagonal taper, 0.25–0.35 at the base |
| pole spacing | 30–40 in town (shorter at corners) |
| power conductors | top 1–2 m of the pole on cross-arms with insulators; transformer on a twin-pole platform at 4–6 |
| telecom / CATV bundle | at 5–7; bundles 0.1–0.5 thick; coils of spare cable (loop Ø 0.6–1.0) hung on the pole |
| wire sag | 0.3–1.0 per 35 m span (telecom sags more) |
| street lamp | 8–10 high on poles or on the power pole, an arm of 1.5–2.5 over the road |

### Signs (real sizes for the shipped files: see `img/signs/manifest.json`)
| item | value |
|---|---|
| street-name sign (BMA blue) | 1.2–1.6 × 0.3–0.6, at 2.5–3.2 on its own post |
| soi sign | 1.0–1.2 × 0.4–0.6 |
| round traffic sign | Ø 0.60 (urban), 0.75–0.90 (highway); bottom edge 2.0–2.2 |
| car licence plate | **0.34 × 0.15** (13.5″ × 6″) |
| motorcycle plate | ≈0.22 × 0.17 (3 lines: letters / province / number) |
| vinyl banner | 1 × 2, 1.2 × 2.4 (tied with rope to frames, fences, trees) |
| light box (projecting) | 0.6 × 1.0–1.2 |

### Street-food furniture
| item | value |
|---|---|
| plastic stool | seat Ø 0.30, height 0.25 (low) / 0.45 (standard) |
| plastic chair | seat height 0.44, total 0.80 |
| folding / plastic table | 0.60 × 0.60 or 0.60 × 0.90, height 0.70–0.75 |
| steel food cart (รถเข็น) | 1.2–1.8 L × 0.6–0.8 W × 0.85 counter + glass case 0.5; canopy to ≈2.2 |
| beach umbrella | Ø 1.8–2.4, pole 2.2 |

---

## 5. Signage conventions

- **Thai first and large.** English, Chinese or a phone number go small underneath. Typefaces are bold looped Thai headline faces (similar to Chonburi), old-fashioned hand-lettering, and modern loopless display faces, which you may see on photos but must not render yourself. Phone numbers are `08x-xxx-xxxx` or `02-xxx-xxxx`.
- **Kinds** (see `img/signs/`):
  - *Light boxes*: `shop_barber_noi_lightbox`, `sign_room_for_rent_lightbox`, `shop_chicken_rice_midnight_korat_lightbox`, `shop_pharmacy_world_lightbox`. These glow at night; give them an emissive multiplier of 1.5–3.
  - *Painted metal and enamel boards*: `shop_hardware_leevittaya`, `shop_pharmacy_ruamphesatchakon`, `menu_coffee_boran_handpainted`, `shop_tamsang_pongpaeng_board`.
  - *Vinyl banners with food photos*: `banner_tamsang_paksaep_vinyl` (the reference look for a made-to-order cart), `banner_private_land_no_dumping`, `banner_laundry_open_vinyl`.
  - *Chinese-Thai gold shops*: red and gold, often stacked vertically up the facade on scaffold frames (`shop_gold_*`). Yaowarat refs: `d68602c2`, `7b1b2eb6`.
  - *Neon*: `shop_noodle_neon_logo`, `shop_gold_jinhuaheng_neon_white`, `shop_noodle_paord_night`.
  - *Chain stores*: `shop_7eleven_fascia_band`, `shop_7eleven_fascia_dusk`, `shop_7eleven_front_small`, `shop_makro_facade_sign`. Real brands are allowed under the client rule.
  - *Official*: `street_sign_*`, `traffic_no_parking_round` plus `traffic_no_parking_timeplate` (mount the plate under the disc), `traffic_no_uturn_round`, `sign_no_dog_poop_no_litter`.
  - *Paper*: `flyer_loan_ngern_duan_bw`, `poster_lottery_results_sheet`, `poster_phone_shop_film`, `decal_flyers_loan_cluster_photo`, `decal_torn_posters_photo`. These are taped or glued to poles at 1.2–2.0 m.
- **The player's shop (ร้านเฮียผัด) upgrade tiers**, all on real photo carriers with looped fonts:
  1. `hiaphat_tier1_cardboard_handwritten`: marker on a cardboard flap, taped to the cart.
  2. `hiaphat_tier2_painted_metal_board`: hand-painted on a rusty enamel board.
  3. `hiaphat_tier3_vinyl_banner_food_photo`: vinyl banner with a real (CC0) krapao photo.
  4. `hiaphat_tier4_lightbox_vertical` plus `_emissive`: a projecting light box.
  - Blank carriers for in-engine text: `blank_metal_sign_rusty_posts`, `blank_metal_sign_white_rust_frame`, `blank_vinyl_banner_grommets`, `blank_lightbox_vertical`.
- **Mounting:** sign bands sit flush above the shutter. Light boxes project at 90° on brackets so they can be read along the street. Vinyl is tied at its four grommets and sags. Hand boards lean on stools or hang from the cart canopy.
- **Licence plates** (`plate_*`, 12 files):
  - white plate with black letters: private car
  - green letters: private pickup or van
  - yellow plate with black text: taxi, tuk-tuk, songthaew, bus
  - red plate: temporary new car
  - motorbikes: white 3-line plates
  - yellow "สอน": driving school

  Format is `กท 1063` on the top line with the province underneath.

---

## 6. Clutter catalogue (what goes where)

| zone | clutter |
|---|---|
| footpath in front of shops | stacked goods, plastic stools, a motorbike parked half on the kerb, gas cylinders (`dc1b885a`), potted plants in old buckets, a brooms-and-bucket corner, a shop dog asleep on the tiles (`82385e9c`, `a0fd3b5d`), standing A-boards, an ice cooler |
| kerb line | utility poles every 30–40 m, signposts, a sign or tree every few metres, drain covers, cigarette butts, gum, an oil drip under every bike |
| corners / soi mouth | win-motosai stand (bench, vest rack, fare board `sign_winmoto_price_list`, a row of bikes) (`75d9c0ab`, `6ba84a88`), a 7-Eleven, a spirit house or shrine tree, a pile of black and white trash bags, a payphone or ATM, a soi gate arch (`street_sign_soi_gate_masjid_banglaung`) |
| shophouse facade | AC units with black drip stains below, rusty grilles, laundry on poles, plants on the balcony (`489cff0a`), satellite dishes, water tanks on the roof, rebar stubs, fading signs, a CCTV camera, power meters in a box by the shutter, torn posters on pillars |
| market lane | blue tarps and umbrellas, aluminium trays, plastic baskets (`29bf4cf9`), hanging bare bulbs, wet floor with a drainage channel (`trench_grate_cast_iron_photo`), crates, foam boxes, cardboard (`13fe935b`) |
| empty lot / edge | corrugated fence, weeds, a banana tree, a dumped sofa, a vinyl "private land" banner (`banner_private_land_no_dumping`), puddles, a stray dog pack |

---

## 7. Vehicle catalogue

| vehicle | size L × W × H (m) | colours / liveries | refs |
|---|---|---|---|
| Honda Wave-type step-through (the most common bike) | 1.90 × 0.70 × 1.08, seat 0.76 | red/black, blue/black, white; basket in front, often 2–3 riders | `35b4ce4c`, `7a7bd0a4`, `743f3fb5` |
| Honda Click-type automatic scooter | 1.92 × 0.68 × 1.08 | white, red, matte grey | |
| win-motosai rider | (bike as above) | **orange vest** with a number on the back and a district patch (sometimes purple or green) | `75d9c0ab`, `6ba84a88`, `0b484f31` |
| delivery rider | bike + 0.45 box | green / orange / pink apps' jackets and boxes (real brands allowed) | |
| tuk-tuk | 3.0 × 1.35 × 1.75 | two-tone body (blue, green, red, yellow) with a chrome trim roof, yellow plate | `95dc17e0`, `34111720` |
| songthaew (pickup + bench box) | 5.0 × 1.75 × 2.3 | red (Chiang Mai), white-blue, green, yellow by route; Hino truck versions in Phuket | `9acf0eb9`, `ce05bb80` |
| taxi (Corolla-class sedan) | 4.6 × 1.75 × 1.5 | **pink**, green-yellow (owner-driver), blue, orange, red-blue; "TAXI-METER" roof sign | `d9901979`, `f60ba2d2` |
| BMTA city bus | 10.5–12 × 2.5 × 3.2 | **red-cream** non-AC classic, blue-white AC, orange, new blue EV | `9eecb975` |
| pickup (D-Max / Hilux class) | 5.3 × 1.8 × 1.8 | white, silver, grey, black; overloaded and roped, steel cage racks | `98ac7b9d`, `499e2432` |
| sedan / SUV filler | 4.5–4.8 × 1.8 × 1.5 | white, silver, black, grey (Thai cars are mostly white and silver) | |

Plates go front and rear on cars and rear only on bikes. Use the real plate textures from `img/signs/plate_*`.

---

## 8. Rural-edge catalogue

- **Rice paddy**: flooded or green. Raised earth dykes 0.4–0.6 wide and 0.3 high; a muddy lane; a lone sugar-palm or coconut palm (12–20 m, slim curved trunk). *Refs:* `0750a5d2`, `b6bba2de`. `826e0a09` is generic, not Thai.
- **Banana trees**: 3–5 m clumps with torn leaves, beside houses and canals.
- **Wooden stilt house (บ้านใต้ถุนสูง)**: posts 2–2.5 m, open underside with hammock, motorbike and pots; wooden walls and a corrugated roof.
- **Canal (คลอง)**: brown-green water 0.5–1.5 m below the walkway; houses half on stilts (`17ab48ca`), concrete walkway with a pipe rail, long-tail boat or express boat (`7aab4373`), water hyacinth, moss line on the walls (`decal_moss_photo`).
- **Provincial-town street**: wider and emptier than Bangkok, 2-storey wooden or concrete shophouses, more sky, same cable mess (`5ac7a080`, `6add9f41`, `946dae78`).
- The transition from city to edge goes: shophouse row → corrugated-fenced empty lot → a few wooden houses with banana trees → paddy. Push haze and fog stronger toward the edge.

---

## 9. Night lighting notes

- **Main road**: tall sodium lamps (orange `#df813e`) or newer white LED, spaced ≈35 m. They make long warm pools with dark gaps between them.
- **Sois**: few lamps. Light comes mainly from shopfronts: fluorescent tubes (cool `#dddeda`, slightly green) behind half-closed shutters, a TV glow, and bare warm bulbs over food carts and stalls (`5d1ae719`, `40ff7eee`, `e357b82e`, `ff99c4d8`).
- **Signs**: light boxes glow and neon flickers (red, blue `#4781ea`, pink). The 7-Eleven is the brightest thing on the block and spills white light onto the footpath.
- **Wet streets**: after rain every puddle (roughness 0.04) mirrors the signs. Add bloom and a slight haze around the lamps (`6aaee946`).
- **Ghost hours**: kill half the shop lights, keep one flickering fluorescent, and leave a lone sodium lamp at the soi end.

---

## 10. BUILD RECIPES

### A. Low-poly but realistic shophouse row
1. **Module**: a 4.0 m bay, 14 m deep (the back can be a simple box), 3 or 4 storeys. Ground floor 4.0 m, upper floors 3.2 m, parapet 1.0 m. Rows are 4–8 bays; break the roofline with tanks and add-ons.
2. **Facade geometry per bay** (≈300–600 tris):
   - an inset ground opening, 3.6 × 3.2, holding either a shutter quad (`shutter_closed_*`) or an open shop interior (a dark box with shelves);
   - a concrete hood or balcony slab projecting 0.8 at 3.6–3.9 m, with bevelled edges;
   - an upper window band on each floor, 2.8 × 1.6, using `window_grille_white_on_glass` or a recessed dark glass quad with a folding-gate grille card;
   - pilasters between bays, 0.2 wide and 0.05 proud, so the bays read separately.
3. **Variation per bay**: a random wall material (teal, orange, cream or plain concrete) with a random tint of ±10% hue; random sign band (from `img/signs/shop_*`); random AC count (0–2 per floor, on brackets, with a drip streak decal below); laundry and plants on some balconies; one bay boarded or rusted shut (`shutter_closed_rusty_white`); one bay with the gate half-closed (`gate_folding_steel_alpha`).
4. **Weathering pass**:
   - `decal_wall_grime_streaks_photo` under every slab edge and AC unit;
   - a damp, mossy wall base from `decal_moss_photo` at 0–0.8 m;
   - vertex-colour AO in the corners;
   - torn posters on the pilasters;
   - rust runs under the grilles.
5. **Roof**: water tanks (Ø 1.0–1.5 cylinders, stainless or beige plastic), a satellite dish, rebar stubs, a corrugated lean-to (`corrugated_zinc_rusty`), and antenna masts.

### B. Soi intersection
1. The main road is 2 × 2 lanes of 3.2 m with a 1.5 m median (`curb_yellow_black` at the nose); the soi meets it at 90° and is 6 m wide.
2. The footpath on the main road is 2.5 m (`sidewalk_tile_circles_grey`) with a 0.18 m kerb. Paint the kerb `curb_red_white` for 10–15 m either side of the soi mouth and at bus stops, and use `curb_white_yellow` near the shops.
3. At the soi mouth:
   - a ramp in the kerb, cracked;
   - `roadline_double_yellow_photo` and `roadline_white_edge_photo` on the main road, a stop line, and a worn zebra (`roadmark_zebra_worn_photo`) 5 m in;
   - a soi sign on its own post (`street_sign_soi_ekkachai46_blue`) or a soi gate arch;
   - a no-parking disc with its time plate (`traffic_no_parking_round` + `traffic_no_parking_timeplate`);
   - a utility pole on each corner with cables crossing diagonally.
4. On the corner: a 7-Eleven bay, a win-motosai stand (bench, 3–6 bikes, `sign_winmoto_price_list`), a spirit house on a 1.5 m post, a trash-bag pile against the pole, and a food cart.
5. Inside the soi there is no footpath, or a broken 0.8 m strip: `asphalt_soi_patched` with `decal_potholes_photo`, `decal_puddles_photo`, manholes (`manhole_square_bma`) every 20–30 m, and parked bikes on both sides.

### C. Utility pole with wire bundles
1. **Pole**: a tapered octagon of 8 sides, 10–12 m, Ø 0.32 → 0.18, in grey concrete with grime (`wall_concrete_mould_stained` scaled down), stencilled numbers, and a band of flyers at 1.2–2 m (`decal_flyers_loan_cluster_photo`, `flyer_loan_ngern_duan_bw`).
2. **Top 1.5 m**: two cross-arms with insulators carrying 3–4 power conductors. Some poles get a transformer: a box Ø 0.6 × 1.0 on a platform between two poles at 5 m.
3. **5–7 m**: a cable clamp ring carrying 6–20 telecom cables. Model 3–6 thick tubes, 8 sides, Ø 2–5 cm, with `cable_black_rubber_photo`, plus 2–3 alpha cards with `wire_bundle_tangle_photo` (crossed quads, 2–3 m) for the hairy mess. Add 1–2 coils of spare cable (torus Ø 0.8) and a few grey junction boxes.
4. **Spans**: catenaries between poles (35 m) with 0.4–1.0 m sag. Make the telecom ones lower and saggier. Add random drop wires to the shophouse facades (a thin tube with 1 bend) and a few dangling loose ends.
5. **Lamp**: on every second pole, an arm of 2 m over the road with a sodium or LED head (emissive) at 8–9 m.

### D. Market lane (ตลาดสด)
1. **Width 3–4 m**: a concrete floor (`concrete_slab_footpath` / `paver_interlock_I`) kept permanently wet (roughness 0.2–0.4 in patches) with a central or side drain (`trench_grate_cast_iron_photo`).
2. **Stalls**: 1.5–2 m wide on both sides. Each has a table at 0.8 m (steel frame, tiled or plywood top), a canopy of `tarp_blue_photo`, `awning_stripes_*_photo` or a beach umbrella at 2.2–2.5 m, bare bulbs on cables, and plastic baskets and trays of produce (`29bf4cf9`, `13fe935b`).
3. **Overhead**: a corrugated roof on a steel frame (`corrugated_zinc_rusty`), with fluorescent tubes hanging on chains and hand-written price cards.
4. **Entrance**: an arch sign (`market_arch_700rai_sattahip`) on two steel posts 4–5 m high, with motorbikes parked outside and a pile of foam boxes and crates.
5. **Floor decals**: litter (`decal_litter_atlas`: bags, foam boxes, cups), crushed leaves, puddles, and oil stains near the fried-food stalls.

### E. Canal edge (คลอง)
1. **Water**: a flat plane 1.0–1.5 m below the walkway, brown-green (`#4b4a33`) with a turbidity fog, slow normal-map ripples, floating litter cards and water hyacinth clumps.
2. **Embankment**: a concrete wall with `wall_concrete_mould_stained` and a dark green moss band at the waterline (`decal_moss_photo`, tinted darker), plus drain pipes outfalling into the canal.
3. **Walkway**: 1.2–2.0 m of concrete with a steel pipe railing (2 rails at 0.5 and 1.0 m, painted blue or green, rusty) and potted plants.
4. **Houses on the other bank**: wooden stilt houses with corrugated roofs (`corrugated_zinc_rusty`), `window_wood_shutters_old`, a small pier of planks on posts, laundry and a long-tail boat (`17ab48ca`, `7aab4373`).
5. **Banana trees and a coconut palm** lean over the water. Add a footbridge (an arched concrete span 1.5 m wide) with a railing and a shrine.

---

## 11. Notes for the world builder

- **Scale**: all textures list `real_world_m` in the manifest. Set UV repeat = surface size ÷ real_world_m. Signs are flat rectified fronts: build a 2–4 cm thick box and use the sign PNG on the front face, with a darker, rusty edge colour on the sides.
- Decal atlases (litter, oil, potholes, posters, moss, streaks) give per-cell UVs in `manifest.json` → `atlas_uv` / `atlas`.
- **Compat aliases**: `decal_puddles`, `decal_oil_stains`, `decal_asphalt_patches`, `decal_gum_spots`, `roadline_*_worn`, `roadmark_zebra_worn`, `manhole_round_drain/electric`, `trench_grate_steel` and `drain_cover_concrete_holes` keep the names that src/modules/world already loads, but now contain the real-photo versions (see `alias_of` in the manifest).
- **Night emissives**: light boxes, neon, `shop_7eleven_fascia_dusk` and `hiaphat_tier4_lightbox_vertical_emissive`.
- **Known gaps**:
  - There is no real-photo speed-bump sign or "ระวังสุนัขดุ" (beware of dog) sign. Only the no-dog-poop sign exists.
  - There is no motorcycle-repair shop sign.
  - Ground pavers and kerbs are procedural layouts over CC0 photo scans, not photos of real Thai tiles. Replace them with rectified photos if a good top-down shot turns up.
  - Some signs come from low-resolution sources (`sign_laundry_service_price`, `banner_laundry_open_vinyl`, `traffic_no_uturn_round`). Use them small or at a distance.

Sources for the regulations and figures: Ministerial Regulation No. 55 (B.E. 2543) via the Silpakorn University paper on row houses (row up to 40 m, 4 m gap between rows, units 4.0 m wide); Thai kerb-colour meanings from autospinn.com, sanook.com and ktc.co.th; licence plate 13.5″ × 6″ from autospinn.com. Other dimensions are typical values cross-checked against the reference photos.
