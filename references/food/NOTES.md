# Food, kitchen, cart & market — research notes (R2-food)

Everything the cooking, shop and economy agents need for **เฮียผัด!**: what real Thai อาหารตามสั่ง looks like,
real recipes with grams / ml / seconds / heat plus what goes wrong, 2025–2026 Thai prices with sources, and a
recommended in-game economy.

> **Client rule change (2026-10-19), applied here.** Product labels and food textures are now built from
> **real photos found online** (real Thai brands: ภูเขาทอง, แม่ครัว, เด็กสมบูรณ์, ทิพรส, มิตรผล,
> อายิโนะโมะโต๊ะ, ตรามือ, ช้าง, ลีโอ, สิงห์, กระทิงแดง, M-150, โค้ก, แฟนต้า, มาม่า …), "any licence".
> This overrides two lines of `docs/GAME_BRIEF.md` (§4 "no real brand logos", §5 "licence-clean only"). Every
> shipped file and its source URL is listed in `references/credits/R2-food.md` and in each `manifest.json`.
> **Before any public release, a human has to decide on these unknown-licence and trademark files.**
> The earlier parody label set (originals with Thai copy, barcodes, GDA boxes, worn variants) is kept for that
> case in `references/food/_raw/labels_parody_superseded/` (git-ignored), and its generator stays in
> `scripts/research/R2/make_labels.py`.

## 0. What's where

| Path | What |
|---|---|
| `references/food/web/` (git-ignored) | **100 reference photos**: `dish_*`: กะเพรา (8), ไข่ดาว, ไข่เจียว, ข้าวผัด, พริกแกง, ผัดซีอิ๊ว, ราดหน้า, ต้มยำ, หมูกระเทียม, ผักบุ้ง. `cart_*`, `vendor_wok_*`, `burner_lpg_*`, `market_*`, `ingr_*`, `season_*`, `tool_*`, `dishware_*`, `takeaway_*`, `drink_*`, `furniture_*`, `cardboard_*`, `label_ref_*`. Sources in `web/_sources.csv` |
| `public/assets/img/labels/` | **45 real product label textures**, flattened or unwrapped from product photos; 13 have `*_worn.png` greasy variants (PNG names are referenced by src/modules/shops). `manifest.json` gives product, brand, package, real size in cm, cap colour, unwrap method and source URL |
| `public/assets/textures/food/` | **36 food texture entries** (seamless tiles + normal maps, alpha cut-outs, derived burnt/wilted variants), including red-curry stir-fry, rat na, tom yum, raw shrimp, smashed garlic and Thai garlic bunch. See `manifest.json` |
| `public/assets/textures/props/` | **15 prop texture sets**: wok, stainless, tamarind board, plates and bowl, PP plastic and stool, woven PP sack, film, LPG paint, hose, styrofoam, rice cooker, glass grime, cardboard and sleeping mats. See `manifest.json` |
| `scripts/research/R2/` | All scripts: search and fetch, `flatten.py` (cylinder/cone unwrap, perspective, de-shading), `texkit.py` (seamless tiling, normals, cut-outs), `process_labels.py`, `make_foodtex.py`, `make_props.py`, `palette.py` |

UV conventions used throughout:
- **Bottle and can labels** are cylinder unwraps of the photographed front arc (about 120–150°). Map them to
  the front of the container and tint the back with the label's edge colour.
- **Discs** (plates, wok top, board top, rice mound, tom yum) are circles inscribed in a square, for planar UVs.
- **`*_polar.jpg`** puts the angle on u and the radius on v (centre at the top row), the same layout as `THREE.LatheGeometry`.
- **`*_n.jpg`** is an OpenGL normal map and **`*_r.jpg`** is roughness.

---

## (a) Visual analysis and palettes

**The plate (what a customer actually gets).** An อาหารตามสั่ง plate is a **9-inch melamine plate**, usually
white with a printed rim (pink or purple flowers, blue-and-white chinoiserie, or the iconic **ไก่ rooster with a
banana tree and a green vine rim**).
- **Rice** is one ทัพพี (rice paddle) of jasmine rice, 180–220 g, piled as a mound on one side and slightly
  flattened by the paddle.
- **The stir-fry** goes next to or over the rice. Kaphrao is *dry-glossy*: the mince is broken into 3–8 mm
  crumbs with caramelised brown edges and an oily sheen. The basil is wilted and **near-black-green**, with
  occasional red chili rings or chili skins. A little oily sauce pools at the rice edge.
- **The egg** (ไข่ดาว) sits on top of the rice. The white has a **lacy, dark-golden, bubbly frilled rim**
  (deep-fried in a lot of oil), the centre white is glossy, and the yolk is orange and domed.
- **Utensils:** a stainless spoon and fork are laid on the plate rim or taken from a steel box on the table.
  A small bowl of **พริกน้ำปลา** (fish sauce, sliced chili, garlic) is on the side.

**Photo-scan look (ref5).** Food meshes should be lumpy, decimated and organic: a rice mound blob, a mince-mass
blob, egg discs with a wobbly outline, separate basil leaf quads using the alpha cut-outs. Do not use spheres or
cylinders. Put the tiles (`kaphrao_pork_tile`, `rice_cooked_tile`) on the blobs with triplanar or box UVs and
let the normal maps add crumb detail. Keep roughness low (0.25–0.4) on oily food for that glossy street-food
sheen.

**The cart (รถเข็นอาหารตามสั่ง).**
- **Body:** brushed and dented stainless steel with a **glass display box** on top (greasy fingerprints, fogged
  corners). Inside the box are ingredients in stainless trays or plastic tubs: minced pork, sliced pork, chicken,
  squid, a holy-basil bunch, chilies, long beans, eggs stacked in pulp trays.
- **Stove:** a high-pressure **KB5 cast-iron burner** (roaring blue flame), a **15 kg LPG tank** under the cart
  with an orange hose, and a black **carbon-steel wok** with a rusty-blue patina.
- **Condiments:** a rack of seasoning bottles: green-cap ภูเขาทอง, แม่ครัว oyster sauce, เด็กสมบูรณ์ soy,
  fish sauce, a sugar tub, an MSG tub. A **tamarind-wood chopping board** sits beside them.
- **Surroundings:** a big striped umbrella or tarp roof, a fluorescent tube light at night, red/blue plastic
  stools, stainless folding tables, and a tissue roll on every table.

**The fresh market (ตลาดสด).**
- Concrete floor wet from melting ice, blue and red plastic tubs, woven baskets and **round hanging scales**.
- Pork stalls hang hooks with cuts over a tiled counter with a thick round chopping block.
- Aunties wear aprons and sleeve covers; vegetables are piled on banana leaves; egg trays are stacked 10 high.
- Bags are pink and clear plastic. Fluorescent tubes hang on wires, and faded umbrellas are orange, blue or striped.

**Packaging colour language** (labels in `img/labels/`):

| Product | Colours |
|---|---|
| Seasoning sauce (ภูเขาทอง) | yellow and green with a red emblem |
| Oyster sauce (แม่ครัว) | red and white with the auntie medallion |
| Soy sauces (เด็กสมบูรณ์) | yellow with green, or dark brown |
| Fish sauce (ทิพรส / ปลาหมึก) | gold, red and white |
| MSG (อายิโนะโมะโต๊ะ) | white bag with a red bowl |
| Sugar (มิตรผล) | white and blue |
| Pepper (ตรามือ) | green and gold |
| Palm oil (มรกต) | green |
| Soybean oil (องุ่น) | yellow and red |

Drinks, LPG and beer are the expected brand colours.

**Measured palettes** (k-means over the reference photos in `web/`, most common first):

| Subject | Colours |
|---|---|
| Kaphrao plates | `#71592b` sauce-brown, `#2f2a1b` dark basil/shadow, `#c47934` caramel edge, `#b2aa98`/`#d2cbb9` rice, `#f1f0e9` plate white |
| Fried eggs | `#0a0908` wok black, `#674929`/`#8e7458` crispy lace, `#dca05d` golden edge, `#ec7e0f` yolk |
| Omelette | `#a5622e`, `#cb935d`, `#4d2e17` browned spots |
| Carts | `#827c71`, `#b0aba3` steel, `#37312d`/`#181615` shadows, `#704d39` rust/grease, `#d47c4c` warm light |
| Market | `#493c31`, `#86583a`, `#aa7b5e`, `#bda591` (dim, warm, brown-grey) |
| Stools | `#226ec5` blue, `#c93532` red |
| Dishware | `#e2ddd5` melamine white, `#7790b0` blue print |

Hand-picked accents:

| Item | Colour |
|---|---|
| Holy basil, fresh | `#4f8f2a` |
| Holy basil, cooked | `#26341a` |
| Bird's-eye chili, red | `#d0201a` |
| Bird's-eye chili, green | `#3e7d23` |
| Garlic | `#efe3c4` |
| Jasmine rice | `#f3f0e6` |
| Kaphrao sauce | `#5c3b1c` |
| Tom yum | `#e2581d` |
| Wok fire | `#3a7cff` |

---

## (b) Recipes: real street-stall amounts, one plate

Units: 1 tbsp (ช้อนโต๊ะ) = 15 ml, 1 tsp (ช้อนชา) = 5 ml. Street cooks use a ladle (กระบวย) and spoon by eye;
the game can show "ช้อน/ทัพพี/หยิบมือ" with grams in small text (like ref1's "1 g Pouring").

**Heat model.**

| Burner | Pan temperature | Notes |
|---|---|---|
| KB5 high-pressure burner, max | 250–300 °C wok surface | "wok hei" |
| Home low-pressure stove | ~180–220 °C | The starting cart in the game should have this weak stove. The KB5 is the first big upgrade |

Oil temperatures:

| Oil temperature | What happens |
|---|---|
| ~150 °C | food absorbs oil |
| 170–190 °C | crisp frying |
| >210 °C | smoking, garlic burns in seconds |

### 1. ผัดกะเพราหมูสับ (stir-fried minced pork with holy basil). About 2½–3 min on high heat

Ingredients:

| Ingredient | Amount | Notes |
|---|---|---|
| Palm oil | 15–20 ml | |
| Thai garlic | 10–12 g (4–6 small cloves) | Pounded together with the chilies |
| Bird's-eye chili | 3–8 g (2–8 chilies) | Coarse paste in the ครก, or chopped. 4–5 chilies = เผ็ดกลาง (medium hot) |
| Minced pork | 100 g | Typical stall portion 80–120 g; "พิเศษ" 150 g |
| Oyster sauce | 10 ml | |
| Fish sauce | 5 ml | |
| Seasoning sauce (ฝาเขียว) | 5 ml | |
| Dark sweet soy | 2–3 ml | For colour |
| Sugar | 3–4 g | |
| Water | 15–30 ml | |
| Holy basil leaves | 15–25 g | A loose cupped handful |
| Jasmine rice | 180–220 g | On the plate |

Optional extras (customers argue about these): long beans 20 g, onion 20 g, baby corn. They are a running
"กะเพราแท้ห้ามใส่ถั่ว/ข้าวโพด" meme.

Method:
1. Heat the wok until it just smokes (20–30 s on high).
2. Add the oil, then the garlic-chili paste. Stir **10–15 s** until fragrant and pale gold. Chili fumes make
   everyone cough: a good game gag.
3. Add the pork, break it up and sear **60–90 s** until no pink is left and the edges brown. Splash water if it
   sticks.
4. Add the sauces, sugar and water. Toss **20–30 s** until glossy: the liquid should coat the pork, not pool.
5. Add the basil and toss **5–10 s** until just wilted. Plate immediately.

Wongnai's version (with a ready-made kaphrao sauce) uses the same order: season when the pork is half-cooked so
the flavour soaks in, and add the basil last until it just wilts.

What goes wrong (simulate these):

| Mistake | Result |
|---|---|
| **Burnt garlic** (>25 s in very hot oil before the pork, or not stirred) | dark specks, bitter. Taste −20 |
| **Raw garlic** (pork added within 3 s) | harsh, no aroma. Aroma −10 |
| **Pork undercooked** (pink, <45 s) | complaint, risk of illness. Overcooked (>3 min) is dry and crumbly. Texture −15 |
| **Too wet** (>45 ml liquid) | soupy "กะเพราราดน้ำ", soggy rice |
| **Too dry** (no water and high heat) | sauce scorches on the wok, bitter |
| **Basil too early** (>30 s on heat) | black, limp, aroma gone |
| **Too little basil** (<8 g) | "ไม่มีกะเพราเลย" complaint |
| **Wilted, yellow basil from yesterday** | aroma ×0.6 |
| **Too salty** | sum of salt points (below) > 18 per 100 g pork |
| **Too sweet** | sugar > 8 g |
| **Wrong basil** (โหระพา sweet basil, or แมงลัก) | instant "นี่มันไม่ใช่กะเพรา" rating hit |
| **Chili** | 1–3 = mild, 4–6 = medium, 7–10 = hot, >10 = "เผ็ดตาย" (only some customers like it) |

**Salt points** per ml: fish sauce 1.0 · seasoning sauce 0.8 · light soy 0.7 · oyster sauce 0.45 · dark sweet
soy 0.3 · MSG 0.5 per 0.5 g. **Target 11–15 points per plate.**

### 2. ไข่ดาว (fried egg). Two styles

**ไข่ดาวกรอบ, crispy edge with a runny yolk (street style).** Fry one egg at a time:
1. Heat 80–150 ml oil (1–1.5 cm deep in a small wok) on high to **180–200 °C** (shimmering, light smoke).
2. Crack the egg (size 2 is about 60 g; a duck egg is 70–80 g) from low height into the oil. It bubbles and
   puffs violently.
3. Spoon oil over the **white only**, 2–3 times.
4. Fry **45–75 s** until the frill is brown and lacy and the white is set. The yolk stays runny below about 65 °C.
5. Lift with the spatula and drain about 5 s.

Wongnai's tip for a crisp white with an uncooked yolk is to fry the white first and add the yolk once the white
starts to set.

Timing and faults:

| Condition | Result |
|---|---|
| 90–120 s | jammy or set yolk: "ไข่ดาวสุก ๆ ไม่เอาเยิ้ม" (some customers order it) |
| Oil < 150 °C | pale, flat, greasy, no frill. Texture −20 |
| > 150 s, or oil > 215 °C | **burnt** black lace, bitter, hard dry yolk → `egg_fried_burnt.png` |
| Water drops in the oil | violent spitting: burn damage or slapstick moment |
| Yolk broken while cracking | "ไข่แตก" cosmetic penalty; some customers don't care |

**ไข่ดาวไม่กรอบ (soft):** 10–15 ml oil, medium-low heat, 2–3 min, lid on. Uses `egg_fried_runny.png`.

### 3. ไข่เจียว (Thai omelette). About 1½ min

Ingredients: 2 eggs (about 120 g), 5 ml fish sauce or seasoning sauce, and optionally 15 ml water or ½ tsp lime
juice (fluffier), or 1 tsp rice flour (crisper). Beat hard for **30–40 s** until frothy.

Method:
1. Heat 150–250 ml oil on high to **190–200 °C**.
2. Pour the egg from about **30 cm** high into the centre. It puffs into a lacy golden disc.
3. Fry 30–45 s, flip (spatula plus ladle), fry 20–40 s more. **Don't press it after flipping**, or it goes flat.
4. Drain and serve on rice with ซอสศรีราชา (Sriracha sauce).

What goes wrong:

| Mistake | Result |
|---|---|
| Oil not hot enough | soaks up oil, flat and greasy |
| Too long / too hot | dark brown, bitter edges |
| Under-beaten | dense, streaky white |
| >10 ml fish sauce | too salty |

Variant: ไข่เจียวหมูสับ adds 40–50 g minced pork.

### 4. ข้าวผัดหมู (pork fried rice). About 3 min

Ingredients:

| Ingredient | Amount | Notes |
|---|---|---|
| Oil | 20 ml | |
| Garlic | 8 g, chopped | |
| Sliced or minced pork | 80–100 g | |
| Egg | 1 | |
| Cooked rice | 220–250 g | **Day-old cold rice** (fresh rice turns mushy) |
| Onion | 20 g | |
| Chinese kale or spring onion | 15 g | |
| Tomato (optional) | 30 g | |
| Light soy | 10 ml | |
| Oyster sauce | 5 ml | |
| Sugar | 2–3 g | |
| White pepper | a pinch (0.2 g) | |
| To serve | cucumber slices 30 g, lime wedge, spring onion, พริกน้ำปลา | |

Method:
1. High heat: garlic 10 s, then pork 60 s.
2. Push the pork aside and scramble the egg 20–30 s.
3. Add the rice, break up the clumps and toss **60–90 s**, letting it sit 5–10 s between tosses to toast.
4. Pour the sauces down the hot side of the wok (they sizzle and smell good), 15 s.
5. Add the vegetables, 15 s.

What goes wrong:

| Mistake | Result |
|---|---|
| Fresh hot rice | sticky clumps |
| Low heat | steamed and soggy |
| Too much soy | brown and salty |
| Left too long without tossing | burnt crust → `burnt_residue_tile` |

### 5. ผัดพริกแกงหมู (red-curry stir-fry with long beans)

Ingredients: oil 20 ml, red curry paste 15–20 g (one heaped tbsp), sliced pork 100 g, long beans 50 g (2–3 cm
pieces), 2–3 kaffir lime leaves (shredded), fish sauce 5–10 ml, palm sugar 5 g, water 15–30 ml.

Method:
1. Medium-high heat. Fry the paste in the oil **30–60 s** until the oil turns red and smells good.
2. Add the pork, 60–90 s.
3. Add the beans, about 60 s (they should stay **bright green and crunchy**).
4. Season, then add the lime leaves last.

What goes wrong:

| Mistake | Result |
|---|---|
| Paste not fried long enough | raw, "dusty" taste |
| Paste too hot | scorched, bitter |
| Beans overcooked | olive and limp |
| Beans undercooked | raw and squeaky |
| Too dry | paste sticks and burns |

### 6. ผัดซีอิ๊วหมู (wide noodles with dark soy)

Ingredients: fresh wide rice noodles (เส้นใหญ่) 150–200 g, separated; pork 80–100 g, sliced and marinated with
light soy; egg 1; Chinese kale (คะน้า) 50 g, stems cut diagonally; garlic 8 g; oil 25 ml; dark sweet soy 10 ml;
light soy 10 ml; oyster sauce 5 ml; sugar 5 g; white pepper.

Method:
1. High heat: garlic and pork 60 s, then the kale stems 20 s.
2. Add the noodles and dark soy and **spread them over the wok surface. Let them char 20–30 s** each side for
   smoky, slightly burnt edges.
3. Push aside, scramble the egg and fold it in.
4. Add the leaves and the sauce.
5. Serve with พริกน้ำส้ม (chilies pickled in vinegar).

What goes wrong:

| Mistake | Result |
|---|---|
| Cold, unseparated noodles | clumps |
| Over-stirred | noodles break into mush |
| Too much dark soy | black |
| No char | pale, bland |
| Charred too long | bitter |

### 7. ราดหน้าหมู (noodles in thick gravy)

Ingredients:
- **Noodles:** 150 g wide rice noodles, pan-fried 30–45 s with 10 ml oil and 5 ml dark soy until the edges char,
  then plated.
- **Gravy:** oil 15 ml, garlic 8 g, marinated pork 80–100 g, kale 60 g, stock or water 250 ml, oyster sauce
  10 ml, light soy 10 ml, fermented soybean paste (เต้าเจี้ยว) 10 g, sugar 5 g, white pepper.
- **Slurry:** **10 g tapioca starch + 30 ml water**.

Method:
1. Garlic, then pork 60 s, then kale stems.
2. Add the stock and bring to the boil (about 60 s). Season.
3. Stir in the slurry **while stirring** and boil 20–30 s until glossy and it coats a spoon.
4. Pour over the noodles at serving time.

What goes wrong:

| Mistake | Result |
|---|---|
| Slurry dumped in without stirring | lumpy gravy |
| Not re-boiled after the slurry | too thin |
| >15 g starch | too thick and gluey |
| Gravy held too long | separates |
| Gravy poured on too early | soggy noodles |

### 8. ต้มยำ (tom yum, one bowl, about 400 ml)

**น้ำใส (clear):**
- Ingredients: water or stock 400 ml; lemongrass 1 stalk (20 g, bruised and cut); galangal 4–5 slices (15 g);
  3–4 kaffir lime leaves; 2 shallots, smashed; 3–6 chilies, smashed; mushrooms 50 g; shrimp 4–5 (100 g) or
  pork/chicken 100 g; fish sauce 15–20 ml; **lime juice 15–20 ml, added off the heat**; cilantro or culantro.
- Method: boil the aromatics 2–3 min, add the protein 1–2 min (shrimp just pink), the mushrooms 1 min, then the
  fish sauce. **Turn off the heat**, then add the lime and chilies.

**น้ำข้น (creamy):** same base, plus **roasted chili paste (น้ำพริกเผา) 15–20 g** and **evaporated milk
(นมข้นจืด) 40–60 ml** (or coconut milk) at the end. The broth turns orange-red with an oily sheen
(`tomyum_bowl_top.png`). Don't boil hard after the milk goes in.

What goes wrong:

| Mistake | Result |
|---|---|
| Lime boiled | bitter |
| Shrimp > 3 min | rubbery |
| Sour and salty out of balance | target sour ≈ salty, a little sweet |
| Boiled hard after the milk | milk splits (curdled look) |
| Bland | not enough aromatics or paste |

### 9. หมูกระเทียม (garlic pork)

Ingredients:
- **Marinade:** sliced pork 120 g with light soy 5 ml, oyster sauce 5 ml, seasoning sauce 5 ml, sugar 2 g, white
  pepper 0.5 g, tapioca starch 3 g, garlic 10 g (15 min).
- **Fried garlic:** chopped garlic 25–30 g.

Method:
1. Fry the garlic in 60–80 ml oil over **medium** heat **2–3 min** until *light* golden, then lift it out.
   **It keeps darkening off the heat.**
2. Sear the pork in 20 ml oil on high, 2–3 min, until browned.
3. Toss with the fried garlic and a little of the garlic oil. Serve on rice with cucumber; add a fried egg on
   request.

What goes wrong:

| Mistake | Result |
|---|---|
| Garlic dark brown | bitter (the most common failure) |
| Garlic pale | soggy, raw |
| Pork overcooked | dry, tough |

### 10. ผัดผักบุ้งไฟแดง (morning glory, "red fire")

Ingredients: morning glory 150 g, cut 8–10 cm; garlic 10 g, smashed; 2–4 chilies, smashed; fermented soybean
paste 10 g; oyster sauce 10 ml; light soy or fish sauce 5 ml; sugar 3 g; water 15 ml. **Pre-mix all of these in
a bowl.**

Method:
1. Heat 25 ml oil on very high heat until it smokes (~230 °C).
2. Dump the bowl in. The oil vapour **flares up** (ไฟลุก), which is the signature street spectacle.
3. Toss **30–45 s** and plate.

What goes wrong:

| Mistake | Result |
|---|---|
| > 60 s | olive, limp |
| < 20 s | raw, grassy |
| Flare not handled | singed eyebrows: slapstick |

**Side: พริกน้ำปลา.** Fish sauce 30 ml, sliced chilies 5 g, garlic 3 g, optional lime 5 ml. Self-serve in the
condiment caddy (พวงเครื่องปรุง: sugar, chili flakes, fish sauce with chili, chili vinegar).

### Quality model suggestion (for the cooking agent)

Each dish defines target windows. The rating is 100 minus penalties, then each customer applies their own
preferences:
- **Spice tolerance:** office workers 2–5 chilies, rural locals 5–10, tourists 0–2.
- **Salt preference:** ±15%.
- **Patience.**

**Kaphrao windows:**

| Factor | Target window |
|---|---|
| Garlic | 8–20 s |
| Pork | 60–120 s |
| Liquid | 15–40 ml |
| Salt points | 11–15 |
| Sugar | 2–6 g |
| Basil | 12–30 g, 3–15 s |
| Pork portion | ≥ 80 g ("portion" stat) |
| Egg | crispy or soft per order |

**Burnt-ness:** an accumulator per ingredient = Σ(time × max(0, T − T_burn)). Drive the texture blend
`burnt_residue_tile`, `egg_fried_burnt` and `basil_*_cooked` from it.

**Heat source:**

| Burner | Effect |
|---|---|
| Low stove | cooking times ×1.6, no wok hei bonus |
| KB5 | ×1.0, +5 "หอมไฟ" bonus when tossing |

---

## (c) Economy research (Thailand 2025–2026, with sources)

### Dish prices

| Context | Price (THB) | Source |
|---|---|---|
| Bangkok CBD (Silom–Surawong) average single-dish plate | **65.3** (May 2026); 64 (Jun 2025); 62.8 (2024); 31 in 2012 | AREA survey via [Posttoday, 3 Jun 2026](https://www.posttoday.com/smart-sme/743305) |
| Bangkok CBD ตามสั่ง/ข้าวแกง | "at least 60–70" | same |
| Nationwide Apr–Aug 2026 | 523 of 1,544 single dishes rose; +10 (55%) or +5 (42%); most common **40→50** and **50→60** (kaphrao included) | สนค. Ministry of Commerce via [Springnews](https://www.springnews.co.th/news/hot-issue/864936) |
| Bangkok residential, local meal | 45–75; kaphrao/noodles 45–60 | [Offpath Thailand 2026](https://offpaththailand.com/thailand-street-food-prices-2026/) |
| Chiang Mai, local meal | 40–70 | same |
| Tourist areas (Bangkok / Pattaya / Phuket) | 100–180 / 120–200 / 150–250+ | same |
| Kaphrao with fried egg, 2026 guides | 60–90 | [Facebook guide](https://www.facebook.com/fb-answers/thailand-street-food-price/), [Agoda](https://www.agoda.com/travel-guides/thailand/street-food-showdown-how-much-is-a-meal-in-thailand/) |
| Delivery menus (Wongnai) | kaphrao moo sap 60–69; **add fried egg 15**; ข้าวไข่ดาว 35; kaphrao with egg 90 (delivery mark-up); Chiang Mai kaphrao with duck egg 70 | [Wongnai](https://www.wongnai.com/delivery/businesses/1992733Df/order) |
| Delivery-platform average kaphrao | 52.78 (early 2021) → 59 (May 2022) | [Brandinside / LINE MAN Wongnai index](https://brandinside.asia/?p=133199) |

**Rule of thumb for 2026:**

| Location | Kaphrao + ไข่ดาว |
|---|---|
| Rural / small town | **40–50** |
| City soi | **50–60** |
| Office district | **60–70** |
| Tourist street | **90–150** |

ไข่ดาว add-on: **+10** (rural/soi) to **+15** (city / delivery); duck egg +15–20.

### Ingredient prices (CheckRaka aggregator of DIT, Talad Thai, Makro, markets — 18 Oct 2026)

| Item | Price | Notes / source |
|---|---|---|
| Minced pork (หมูบด) | **104.5–125 / kg** (market 105, Big C 115, Freshket 125) | [CheckRaka pork](https://checkraka.app/price/pork-today/) |
| Lean pork | 102–140 / kg (median 127) | same |
| Pork belly | 130–200 / kg | same |
| Holy basil (กะเพรา) | **55 / kg** lowest; normal **40–50 / kg**; Oct 2026 flood spike **150–190 / kg**; market bundles 5 → 10–20 THB | [CheckRaka veg](https://checkraka.app/price/vegetable-today/), [Amarin TV 5 Oct 2026](https://www.amarintv.com/news/social/559413) |
| Bird's-eye chili | 37.5–70 / kg (median 58.75); flood spike ~200 | [CheckRaka chili](https://checkraka.app/price/chili-today/) |
| Thai garlic / Chinese garlic | 90–95 / kg · 67.5–89 / kg | [CheckRaka garlic](https://checkraka.app/price/garlic-today/) |
| Shallot | 85–105 / kg (median 91.5) | [CheckRaka shallot](https://checkraka.app/price/shallot-today/) |
| Long bean / morning glory / kale / cucumber / spring onion | 42.5 / 25 / 17–45 / 21 / 65 per kg | CheckRaka veg |
| Eggs | size 2 **3.92 / egg (≈118 / tray of 30)**; size 0 4.50; size 3 3.50; duck 4.50. Farm-gate mixed sizes 3.40 (Mar 2026) → **4.00** (Aug 2026, ≈120 / tray) | [CheckRaka eggs](https://checkraka.app/price/egg-today/), [Thai PBS](https://www.thaipbs.or.th/news/content/503426) |
| Jasmine rice | 41.6 / kg median (30 at market); 5 kg bags 190–230; white rice 20–31 / kg | [CheckRaka rice](https://checkraka.app/price/rice-today/) |
| Palm oil / soybean oil / vegetable oil | 48–50 / 49.6 / 66.5 per litre | [CheckRaka palm oil](https://checkraka.app/price/palm-oil-today/) |
| Fish sauce / light soy / vinegar | ~39 / 32 / 20 per litre (bulk); 700 ml retail bottles 25–45 | [CheckRaka index](https://checkraka.app/price/), [Lazada listings](https://www.lazada.co.th/trending/Fish-Sauce-Top-Deals-This-Month/161002271) |
| Oyster sauce แม่ครัว 600 ml | ~45 | [Wongnai food tips](https://www.wongnai.com/food-tips/oyster-sauce) |
| MSG | 96–114 / kg (500 g bag ≈ 55–65) | [CheckRaka MSG](https://checkraka.app/price/msg-today/) |
| Sugar มิตรผล 1 kg | 24 → 25 THB / bag | [Matichon](https://www.matichon.co.th/economy/news_3481670) |
| LPG 15 kg refill | **423** (state cap, held through Mar 2026); some Chiang Mai shops charged 480 | [Thairath, Jan 2026](https://www.thairath.co.th/money/economics/thai_economics/2906457) |

### Equipment prices

| Item | Price (THB) | Source |
|---|---|---|
| KB5 high-pressure burner head (Lucky Flame) | 920–950 (Dyna Home KB-5A 800; online promo 269) | [HomePro](https://www.homepro.co.th/p/66876) |
| 2-burner high-pressure stove + 15 kg tank + regulator | **5,000–6,500** | [OFM restaurant budget 2026](https://www.ofm.co.th/blog/open-restaurant-budget-100k-checklist/amp/) |
| Carbon-steel wok 32 cm with spatula | 199–299 (home); street woks 14–16" ~250–600 (est.) | [HomePro search](https://www.homepro.co.th/search?q=%E0%B8%81%E0%B8%A3%E0%B8%B0%E0%B8%97%E0%B8%B0%E0%B9%80%E0%B8%AB%E0%B8%A5%E0%B9%87%E0%B8%81) |
| Basic cookware set (wok, pots, knives, boards, spatula, basins) | 6,000–8,000 | OFM |
| Commercial rice cooker 5 L (Sharp KSH-D55) | ~2,180; 1.8 L ~800 | [Lazada](https://www.lazada.co.th/trending/Rice-Cookers-Top-AddToCart/1810323143) |
| Plastic chair | 95–359 (ME LIVING 95, Superware CH-61 152–169); restaurant chairs 350–420 each | [HomePro](https://www.homepro.co.th/c/OUT15), OFM |
| Restaurant table | ~1,000 each | OFM |
| Stainless prep tables (2, with shelf) | 6,500–8,000 | OFM |
| 2-basin stainless sink | 4,500–6,000 | OFM |
| Garden umbrella 40" with stand | 749 | [HomePro](https://www.homepro.co.th/p/888125100400) |
| Tableware set (plates, bowls, glasses, cutlery) | 4,000–5,000; plate rack 195 | OFM |
| 2-door fridge | 18,000–25,000 new / 10,000–15,000 used | OFM |
| Glass-display stainless food cart | no listed price found; est. 6,000–15,000 new, 3,000–6,000 used (est.) | — |
| Hot/cold water dispenser | est. 3,000–6,000 (est.) | — |
| Ice bucket / cooler (กระติก) 150–600; cups ×50 35–60; tube-ice bag 10–20 | est. | — |

### Daily trade of a small stall

- **Per-plate cost** (Wongnai, 2021 prices): kaphrao moo sap = pork 100 g 13 + basil and chili 2 +
  seasonings 5 + rice 200 g 7 = **27 THB**, sold at 35 (8 profit). Fried rice 25 / ผัดซีอิ๊ว 23 / ราดหน้า 22 /
  ข้าวไข่เจียว 16 (sold at 25) ([Wongnai](https://www.wongnai.com/business-owners/cost-main-dish-restaurant)).
- **Thairath breakdown:** raw ingredients 11.33, labour 6.20, rent 2, gas 1.17 THB per plate.
- **Volume:** a typical stall sells **40–50 plates/day**; good city spots >100 ([Thairath](https://www.thairath.co.th/scoop/1592513)).
- **2026 re-cost** (prices above): rice 3 + pork 100 g 12.5 + basil 1.5 + garlic/chili 1.2 + oil 1 + sauces 2.5
  + gas 1.2 = **≈23 THB**, plus the egg 4 = **≈27 THB** for kaphrao + ไข่ดาว. Sold at 50–60 that is a
  ~50% gross margin.
- **Daily turnover** at 60 plates × 50–55 THB is ≈ **3,000–3,300 THB**, and gross profit ≈ 1,400–1,700 before
  rent and labour.
- Variable costs ≈ 40% of price is the usual rule ([Khaosod](https://www.khaosod.co.th/sentangsedtee/?p=216505)).
- **When prices spike** (flooded basil, Oct 2026), vendors kept the price and *cut the basil portion*. That would
  make a good in-game "newspaper headline → choose: raise price or shrink portion" event.

---

## (d) Recommended in-game economy

Scaled so the first day is tight but solvable, and growth is visible every day (a day is 20 real minutes). Prices
are rounded Thai-real so they feel authentic; quantities are game portions.

**Start.**
- The four players pay 25 THB each for the cart (100 total). Afterwards each wallet keeps **10–20 THB** of loose
  coins (random, about 60 THB pooled).
- Auntie at the market offers **เชื่อไว้ก่อน** (credit) of up to **100 THB** on Day 1. It is repaid
  automatically at midnight, with a "ดอกเบี้ยน้ำใจ" tip of 10.
- Day-1 shopping for about 8 plates ≈ 70–90 THB.

**Day-1 menu.** กะเพราหมูสับ **40** (+ไข่ดาว **10**). The player-set price shifts demand per area:

| Area | Fair price | Demand at fair price | +20% over | −20% under |
|---|---|---|---|---|
| Rural edge | 35–45 | 1.0× | demand ×0.55 | ×1.3 |
| City soi (start) | 45–55 | 1.0× | ×0.6 | ×1.25 |
| Office district (unlock Day 4) | 55–70 | 1.0×, lunch rush 11:30–13:00 | ×0.7 | ×1.2 |
| Tourist street (unlock Day 8) | 90–150 | 1.0× | ×0.8 | ×1.1 |

**Customers per day (4 players):**

| Day | Customers |
|---|---|
| 1 | 8–12 |
| 2 | 12–18 |
| 3 | 18–25 |
| 5 | 25–40 |
| 7 | 35–50 |
| 10+ | 45–80 |

Bad ratings cut the next day's footfall by up to 30%.

**Shop prices (THB, in-game).**

Market auntie (ป้าแผงผัก/แผงหมู) and the egg stall:

| Item | Unit | Price |
|---|---|---|
| หมูสับ minced pork | 100 g bag | 13 |
| หมูสับ minced pork | 500 g | 60 |
| หมูสไลซ์ sliced pork | 100 g | 14 |
| กะเพรา holy basil | กำ (~80 g, 4 plates) | 10 (flood event: 20) |
| พริกขี้หนู bird's-eye chili | ขีด 100 g | 7 |
| กระเทียมไทย Thai garlic | ขีด 100 g | 10 |
| หอมแดง shallot | ขีด 100 g | 10 |
| ถั่วฝักยาว long beans | กำ 250 g | 12 |
| ผักบุ้ง morning glory | กำ 300 g | 10 |
| คะน้า Chinese kale | กำ 300 g | 12 |
| แตงกวา cucumber | 3 pcs | 10 |
| มะนาว lime | 3 pcs | 10 |
| ไข่ไก่ eggs | 1 / pack 10 / tray 30 | 4.5 / 42 / 120 |
| ไข่เป็ด duck egg | 1 | 6 |
| กุ้ง shrimp | 100 g | 35 |
| เส้นใหญ่ wide rice noodles | 500 g | 20 |

Wholesale / convenience shop:

| Item | Price |
|---|---|
| ข้าวหอมมะลิ jasmine rice 1 kg / 5 kg | 38 / 189 |
| น้ำมันปาล์ม palm oil 1 L | 50 |
| ซอสปรุงรสฝาเขียว 200 / 600 ml | 22 / 52 |
| ซอสหอยนางรม oyster sauce 300 / 600 ml | 25 / 45 |
| น้ำปลา fish sauce 700 ml | 35 |
| ซีอิ๊วขาว light soy 700 ml | 45 |
| ซีอิ๊วดำหวาน dark sweet soy 950 g | 50 |
| น้ำตาล sugar 1 kg | 25 |
| ผงชูรส MSG 500 g | 60 |
| พริกไทยป่น white pepper (jar) | 39 |
| พริกป่น chili flakes (jar) | 25 |
| น้ำส้มสายชู vinegar 700 ml | 20 |
| น้ำพริกเผา roasted chili paste | 35 |
| พริกแกงเผ็ด red curry paste 100 g | 20 |
| นมข้นจืด evaporated milk | 22 |
| ถุงแกง curry bags (½ kg pack) | 45 |
| กล่องโฟม foam boxes (25) | 40 |
| กล่องกระดาษ paper boxes (25) | 75 |
| หนังยาง rubber bands | 15 |
| ทิชชู่ tissue roll | 10 |

Drinks:

| Item | Buy / sell |
|---|---|
| น้ำดื่ม water 600 ml | 7 / sell 10–15 |
| โค้ก/แฟนต้า 325 ml | 15 / sell 20–25 |
| น้ำแข็งหลอด tube ice (bag) | 15 |
| แก้วพลาสติก plastic cups (50) | 40 |
| ชาเย็น Thai iced tea (mix it yourself) | sell 25–35 (local, [Offpath](https://offpaththailand.com/thailand-street-food-prices-2026/)) |
| กระทิงแดง / M-150 | 10–12 / sell 15 |

LPG:

| Item | Price |
|---|---|
| Refill 15 kg | 423 (lasts about 3–4 game days of service) |
| Small 4 kg tank | 150 refill (starter cart) |

**Equipment and furniture unlocks:**

| Day | Item | Price | Effect |
|---|---|---|---|
| 1 | Cart (ships with weak low-pressure stove, 1 wok, ตะหลิว, 6 plates, 6 spoons, rice pot, wooden board) | 100 | — |
| 2 | Plastic stool (red/blue) | 120 | +1 seat |
| 2 | Plastic table | 350 | — |
| 2 | Tissue + spoon box | 60 | cleanliness +5 |
| 2 | Takeaway bags / foam boxes | above | delivery and takeaway customers |
| 3 | **KB5 high-pressure burner + regulator** | 950 | cook ×1.6 faster, หอมไฟ bonus |
| 3 | Second wok | 350 | — |
| 3 | Ice bucket (กระติก) | 250 | sell drinks |
| 3 | Tamarind chopping board | 450 | chop speed |
| 4 | Rice cooker 5 L | 2,200 | no manual rice pot |
| 4 | Unlock ไข่เจียว, ข้าวผัด | — | — |
| 4 | Office-district spot | rent 100/day | — |
| 5 | Stall umbrella | 750 | rain and heat comfort |
| 5 | Stainless folding table | 1,500 | — |
| 5 | Condiment caddy | 180 | rating +3 |
| 5 | Stray cat adoption | — | — |
| 6 | Unlock ผัดพริกแกง, ผัดซีอิ๊ว | — | — |
| 6 | Dish-washing tubs ×3 | 150 | — |
| 6 | Plate set (10 melamine) | 350 | — |
| 7 | Unlock ราดหน้า, หมูกระเทียม | — | — |
| 7 | Water dispenser | 3,900 | — |
| 7 | Glass display cart (stainless) | 9,000 | rating +10, ingredients stay fresh +1 day |
| 8 | Unlock ต้มยำ (needs pot + 2nd burner), ผัดผักบุ้ง | — | — |
| 8 | 2-burner stove set | 5,500 | — |
| 8 | Tourist-street spot | rent 300/day | — |
| 10+ | Fridge | 12,000 used / 20,000 new | — |
| 10+ | Shophouse front | rent 1,500/day | — |
| 10+ | Neon sign / menu board | 1,200 | — |

**Balancing anchors:**
- Day-3 profit ≈ **400–700 THB**, enough to buy the KB5 burner (it should feel like a celebration).
- Day 7 ≈ **1,500–2,500 THB**/day.
- The glass cart (9,000) is a week-1 goal, and a shophouse is a week-2+ goal.
- Each player has a separate wallet: give a **"หารค่าของ"** (split the cost) prompt when someone buys shared gear.

---

### Sources (all accessed Oct 2026)

- AREA Silom–Surawong food price survey, via Posttoday: https://www.posttoday.com/smart-sme/743305
- Ministry of Commerce (สนค.) single-dish price survey, via Springnews: https://www.springnews.co.th/news/hot-issue/864936
- Street-food price guides: https://offpaththailand.com/thailand-street-food-prices-2026/ · https://www.agoda.com/travel-guides/thailand/street-food-showdown-how-much-is-a-meal-in-thailand/
- LINE MAN Wongnai price index: https://brandinside.asia/?p=133199
- Wongnai per-plate costs: https://www.wongnai.com/business-owners/cost-main-dish-restaurant
- Wongnai kaphrao + kai dao recipe: https://www.wongnai.com/recipes/stir-fried-basil-with-minced-pork-and-fried-egg
- Wongnai fried-egg tips: https://www.wongnai.com/food-tips/fried-eggs
- Pholfoodmafia kaphrao variants: https://www.pholfoodmafia.com/?p=45573
- CheckRaka daily prices (18 Oct 2026): https://checkraka.app/price/ (pork, vegetable, chili, garlic, shallot, egg, rice, palm-oil, MSG pages)
- Basil flood spike: https://www.amarintv.com/news/social/559413
- Egg price rise: https://www.thaipbs.or.th/news/content/503426
- LPG price cap: https://www.thairath.co.th/money/economics/thai_economics/2906457
- Equipment: https://www.homepro.co.th/p/66876 · https://www.homepro.co.th/c/OUT15 · https://www.homepro.co.th/p/888125100400 · https://www.ofm.co.th/blog/open-restaurant-budget-100k-checklist/amp/
- Plates per day and cost per plate: https://www.thairath.co.th/scoop/1592513
- Margin rule of thumb: https://www.khaosod.co.th/sentangsedtee/?p=216505
