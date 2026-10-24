# Characters — art bible (R3-people)

Everything here is for **real, everyday Thai people on a real Thai street** — not stock models,
not festival costumes, not other countries. Look at `web/` (git-ignored, look-only photos of real
Bangkok street life: vendors, market aunties, วินมอไซค์, riders, students, monks, office lunch
crowds, cart uncles) before modelling anybody. `web/index.json` lists every photo's source page.

Game-ready textures live in `public/assets/textures/{faces,clothing,hair}/` (each folder has a
`manifest.json`). Ghosts have their own bible: `references/ghosts/NOTES.md`.

---------------------------------------------------------------------------------------------------

## 1. The look in one paragraph (Chilla's Art, Thai street edition)

Low-poly bodies with **photo textures** and a **static photo face** (ref2: the convenience-store
salaryman). Silhouettes are simple but correct: sloped shoulders, slight belly on uncles, thin
teenage limbs, aunties wide at the hips. Clothes are separate low-poly shells with real fabric
photos (wrinkled, faded, a bit dirty). Nobody is glamorous: sun-tanned forearms, sweat-yellowed
singlets, cheap plastic slippers, a towel or ผ้าขาวม้า over the shoulder, a phone in one hand, a
plastic bag (ถุงแกง) in the other. Faces never animate; expressions are texture swaps.

## 2. Body proportions (low-poly Thai adult)

| | Men | Women | Notes |
|---|---|---|---|
| Height, adult 20–50 | **1.70 m** (range 1.60–1.80) | **1.58 m** (range 1.50–1.68) | NCD-RisC: Thai born ~1996 ≈ 170 / 159 cm |
| Height, 60+ (uncles/aunties/grandmas) | 1.63 m | 1.52 m | older generation is shorter; grandma 1.45–1.50 |
| Teen students (M.1–M.6) | 1.55–1.72 m | 1.50–1.62 m | thin, long-limbed |
| Head height (chin→crown) | 0.225 m (≈ 7.5 heads) | 0.215 m (≈ 7.3 heads) | for readability we model **7 heads tall** (head ~5 % bigger) |
| Shoulder width (bi-acromial) | 0.39 m | 0.35 m | narrower than Western bases; shoulders slope |
| Hip width | 0.33 m | 0.35 m | aunties: 0.38–0.42 m |
| Arm span | ≈ height | ≈ height | |
| BMI feel | 23–25 (uncles 26–29, belly) | 22–24 (aunties 26+) | moto-taxi guys wiry; office men soft; construction lean |

Low-poly budget (suggestion): body 1.5–3 k tris, head 300–600 tris, each clothing shell 200–800,
hair 200–900 (cards). Hands = mitten blocks with a thumb (no first-person hands anyway).

**Skin tones** (sRGB, sampled from the shipped face textures after even-lighting; use the
`avgSkinRGB` of the face you pick, or one of these for bodies):

| Name | Hex | Who |
|---|---|---|
| light (Thai-Chinese, office, students) | `#d9b2a0` | indoor workers, Yaowarat families |
| light-medium | `#cfa38e` | most Bangkok office / shop staff |
| medium (typical) | `#c38a70` | vendors, riders, aunties |
| tan | `#b07a5c` | moto-taxi, street cooks, delivery |
| deep tan | `#8e5b3e` | construction, farmers from Isan, fishermen |
| dark brown | `#6e4430` | labourers, southern sea-gypsy features |

Farmer's tan is very Thai: face, neck-V and forearms 1–2 steps darker than shoulders/torso
(vertex-colour gradient on the body mesh). Old people: add age spots/redness via the detail map.

## 3. Faces (static photo faces) — see `public/assets/textures/faces/manifest.json`

* Source: **SFHQ synthetic faces (CC0)** — people who do not exist; selected for Thai /
  Southeast-Asian looks, ordinary (not model-like) features, neutral expressions.
* Every texture is 512×512, front-projection aligned: eye centres (0.36,0.44) & (0.64,0.44),
  mouth centre (0.50,0.73), chin ≈ 0.90. Even lighting, de-shined, hair removed above the
  forehead, outside of the face oval = the face's own average skin colour (no seam on the head).
* `*_detail.jpg` = recolourable version (multiply by any skin tone, formula in the manifest);
  `*_mask.png` = where the tint applies (eyes/teeth excluded).
* Expression swaps for the 5 player-capable young men: `dumb_thinking` (skill-tree face), `drunk`
  (casino intro), `sleep` (cardboard at midnight), `shock` (losing everything / dog eats the
  pork); `scream` for 3 young women (customisation gag "สาววิ่งกรีดร้อง").

### Head mesh for planar face projection (Chilla's Art recipe)
1. Head = slightly squashed sphere/box hybrid, ~400 tris: flat-ish face plane, cheekbones
   chamfered, nose = 3-face wedge, brow ridge one loop, chin one loop, ears as flat 8-tri
   shells (plain skin), neck cylinder 8 sides.
2. Project the face texture **planar from the front** (orthographic, +Z) onto the front
   hemisphere; image square = face width at the ears × the same height, with the eye line on
   the brow-ridge loop's lower edge (v = 0.44) and the mouth on the mouth loop (v = 0.73).
3. Back/sides/top use a plain skin material = `avgSkinRGB` (+ one of the tileable
   `skin_detail_*` maps): the face texture already fades into exactly that colour.
4. Hair = separate shell or cards on top (see §6); a hair shell can cover the forehead down to
   v ≈ 0.25 (all faces have clean skin up there).
5. Shading: keep the face material slightly rough (0.55–0.65), no normal map, a hint of SSS or
   wrap lighting. Photo faces already contain soft frontal light — keep scene lights soft.

## 4. Clothing catalogue (real-photo textures in `public/assets/textures/clothing/`)

| Garment (TH) | What it really looks like | Colours (hex) |
|---|---|---|
| เสื้อกล้าม white ribbed singlet | 1×1 rib knit, deep armholes, low neck; old ones yellow at the armpits/neck, stretched | new `#f2f0ea`, worn `#e8dfc8`, sweat stain `#d8c48e` |
| กางเกงบ็อกเซอร์ plaid boxers / sleep shorts | woven cotton shirting plaid, elastic waist, worn as street shorts | blue/navy/white `#2b3f6c` `#e9e6dd`; red/navy `#8e2a2a`; green/yellow check |
| ผ้าขาวม้า pha khao ma | hand-woven cotton check 70×170 cm: tied round the waist, as a towel on the shoulder, a head wrap, a sling | red/green/white `#b5302c` `#2f6b3b` `#efe7d6`; blue/white; purple/red |
| โสร่ง men's sarong | tube of plaid cotton, rolled at the waist; uncles at home, Muslim south | maroon/green `#5a1f24` `#355c3f`, navy/brown |
| กางเกงขาก๊วย | loose wide-leg cotton trousers, drawstring, mid-calf; old Chinese-Thai uncles, vendors | indigo `#2a3550`, black `#1d1d20`, khaki `#9d8a6a` |
| shorts | cheap cotton twill or jersey, knee length | black `#1e1e1f`, khaki `#a8916c`, navy |
| เสื้อลายดอก / Hawaiian | rayon or "ผ้าไหมอิตาลี" print shirts, big flowers; uncles at weddings/Songkran, ref4 guy 2 | lime `#86ad55` + cream `#f4f2c5`, red hibiscus, navy palm |
| striped polo / tee | horizontal stripes, pique knit | ref4 guy 3: bottle green `#2a5e48` on off-white `#f2f0e3` |
| เสื้อเชิ้ตขาว white dress shirt | poplin, short sleeve for office & students | `#f4f4f1` |
| ยีนส์ | dark indigo, faded at thighs/knees | `#1f2a44` → faded `#4a5f86` |
| สูท cheap black suit | polyester-wool, shiny at the elbows | `#17171a` |
| casino suits (intro) | gold satin / maroon velvet / black shawl lapel | gold `#c9a14a`, maroon `#5e1420` |
| เสื้อวิน moto-taxi vest | fluorescent orange polyester mesh, yellow-green reflective bands, big white number on the back, licence card window on the back | `#ff6a13`, band `#c8f03c`, number plate `#ffffff` |
| ชุดนักเรียน | boys: white short-sleeve shirt + khaki (primary) or navy/black shorts, black belt, white socks, black/white canvas shoes; girls: white blouse with navy bow/tie, navy or black pleated skirt | shirt `#f6f6f2`, navy `#1c2741`, khaki `#b0966a` |
| ปักชื่อ name embroidery | blue thread satin stitch above the right chest pocket: student name + school initials (อักษรย่อ) | thread `#1f3f9c` |
| เสื้อคุณแม่ auntie blouse | small floral print on pastel rayon, loose cut | pink `#e8b9c4`, mint `#bfe0d0`, lilac `#c9b8df` |
| ตำรวจ police | khaki-brown gabardine (สีกากี), cap, black belt, whistle | `#6e5a3c` |
| ผ้ากันเปื้อน apron | canvas apron, oil, chili and soy stains, towel tucked in the waist | white-ish `#e6e1d6`, blue `#3d5a80` |
| ไรเดอร์ rider jackets | polyester softshell, reflective tape, box on the bike; parody brands only | green `#00a651`-ish, pink `#e2187e`-ish |
| รองเท้าแตะ ช้างดาว-style | blue straps + white footbed with blue edges, rubber, everyone wears them | `#2f5fb0`, `#f3f3ef` |
| sneakers | white canvas/leather, dirty | `#efeee9` |
| hats | bucket hats (khaki/denim), caps (faded), farmer's straw hat, motorcycle helmets everywhere | |

## 5. NPC archetypes (≥ 20)

Each line: clothing · accessories · props carried · behaviour hints.

1. **ป้าแม่ค้า** (market auntie, 45–65): floral blouse or polo, ผ้าถุง/sarong skirt or trousers, apron with money pouch (กระเป๋าคาดเอว), hair in a bun or short perm, rubber boots or slippers · gold necklace, hair net · plastic basket, scale, bag of chili · sits on a low stool fanning flies, shouts prices, gives change from the apron, bargains (mad system: easily offended by lowballing, softened by "ป้าสวยจัง").
2. **ลุงวินมอไซค์** (moto-taxi uncle, 35–60): orange numbered vest over a polo or tee, jeans or slacks, open-face helmet, flip-flops or sneakers · towel round the neck, phone holder · motorbike (Honda-Wave-like parody) · squats in a row at the วิน, smokes, plays checkers on a bottle-cap board, yells "ไปไหนครับ".
3. **นักเรียนชาย** (schoolboy 13–18): white shirt + navy/black shorts (khaki for primary), black belt with school buckle, white socks, canvas shoes, buzz cut · name embroidery · backpack, phone, iced pink milk (นมชมพู) bag · walks in groups, laughs loud, buys fishballs after school at 16:00.
4. **นักเรียนหญิง** (schoolgirl 13–18): white blouse, navy bow, navy/black pleated skirt, ear-length bob or ponytail with a black ribbon · name embroidery · bag, umbrella, tumbler · groups of 2–4, shares snacks, takes selfies.
5. **พนักงานออฟฟิศ** (office worker 25–45): white/pastel shirt or blouse, slacks/pencil skirt, lanyard ID card · smartwatch · phone, iced coffee in a plastic cup with a bag-handle · 11:45–13:00 rush: queue, order fast, rate harshly on wait time.
6. **ไรเดอร์เขียว / ไรเดอร์ชมพู** (delivery riders, parody brands "Grub"/"foodpandan" style — original logos): brand jacket, helmet, face mask, jeans · phone mount · cube box on the bike, plastic order bags · rushes in, orders for pickup, impatient, always on the phone.
7. **ฝรั่งแบกเป้** (backpacker): elephant pants or shorts, singlet with a beer logo parody, sunburn, big backpack, sandals · map/phone, bottle of water · points at the menu, asks "not spicy?", tips in coins.
8. **ยายขายพวงมาลัย** (garland grandma 65+): faded floral blouse, sarong skirt, cloth head cover or straw hat · jasmine garlands on a rod · walks between traffic at red lights, sells to drivers; respectful, slow.
9. **คนไร้บ้าน** (homeless man 50+): stained grey tee, torn shorts, barefoot or mismatched slippers, long hair · plastic bags, cardboard · sleeps under the shophouse awning; player can give coins → blesses you.
10. **สาววิ่งกรีดร้อง** (screaming girl — customisation gag): casual student or office look; walks past the T-posing player, sees him, swaps to the `scream` face texture, runs off waving her arms.
11. **พ่อครัวร้านตามสั่ง** (street cook, rival stall): white singlet or tee, apron, towel on the shoulder, hairnet or cap · wok, ladle · stir-fries with huge flames, shouts "ได้แล้วครับ".
12. **ลุงขายรถเข็น** (the old cart man — sells the cart for 100 ฿): white singlet, ขาก๊วย trousers or sarong, ผ้าขาวม้า on the shoulder, flip-flops, grey crew cut · reading glasses · hand-written recipe book · grumpy-kind; catches the players "stealing" the cart.
13. **คนงานก่อสร้าง** (construction worker): long-sleeve shirt, face fully wrapped in a cloth / balaclava, wide hat or hard hat, gloves, rubber boots · trowel, bucket · comes in pairs at lunch, eats huge portions, cheap.
14. **พระ** (monk): saffron robe (จีวร), shaved head, barefoot, alms bowl (บาตร) with a cloth strap · only at dawn alms round (06:00–07:00). **Respect rules:** cannot be slapped, snatched from or angered; women do not touch; players can kneel and give food (merit +).
15. **ตำรวจจราจร** (traffic police): khaki-brown uniform, white helmet/cap, white gloves, whistle, reflective vest at night · stands at the junction, whistles, occasionally buys iced coffee.
16. **คนขับสองแถว / แท็กซี่** (driver): polo + slacks or a taxi-company shirt, sunglasses · towel on the shoulder · parks illegally, eats in 3 minutes.
17. **แม่บ้านถือถุงกับข้าว** (housewife): T-shirt, cotton trousers or skirt, slippers · fan, plastic bags of curry · buys take-away for the family, asks for extra rice.
18. **เด็กแว้น** (young bike racer, affectionate): skinny jeans, tank top, mullet dyed brown, loud exhaust · motorbike with stickers · revs, honks, eats standing up.
19. **ลุงสภากาแฟ** (newspaper uncle): polo or singlet, shorts, reading glasses on the head · tabloid (ไทยรั่ว parody), coffee in a glass · sits all morning, comments on everything, gives tips.
20. **หมอดู** (fortune teller): white or dark shirt, amulets, reading glasses · cards, palm-reading table · sits near the temple wall.
21. **คนกวาดถนน** (street sweeper): orange/green city worker uniform, wide hat, gloves · long broom, bin cart · sweeps around your tables (cleanliness bonus if you are clean).
22. **รปภ.** (security guard): dark navy/brown guard uniform, cap · baton, whistle, plastic chair · nods off in the afternoon.
23. **ป้าชุดนอน** (auntie in house clothes): loose แขนกุด blouse or nightdress (ชุดกระโปรงผ้าคอตตอน), sarong, slippers, curlers · walks a small dog, gossips.
24. **คนขายลอตเตอรี่** (lottery seller): vest or polo, cap, wooden board with tickets on a strap · walks table to table: "ลอตเตอรี่ไหมคะ".
25. **กลุ่มทัวร์เอเชีย** (Asian tour group): sun hats, umbrellas, selfie sticks · photograph every dish before eating.

## 6. Hairstyles (real-photo hair textures in `public/assets/textures/hair/`)

| Style | Who | Build |
|---|---|---|
| ทรงนักเรียน / เกรียน buzz | schoolboys, police, soldiers, monks (shaved) | scalp-coloured shell + `buzz` texture (stubble) |
| รองทรงสูง/ต่ำ | moto-taxi, uncles, office men | short shell (sides) + top cards (black straight) |
| side-part / หวีเสย | office men, old-school uncles | shell with a part line, slight shine (pomade) |
| two-block / undercut | young men, riders | buzz sides + longer top cards |
| mullet | เด็กแว้น, young guys, ref: 2020s trend | cards hanging at the nape, often dyed brown |
| long layered (ref4 guy 1) | rocker / 2000s band look | 10–14 long cards, shoulder length, wispy fringe |
| afro + headband (ref4 guy 2) | the funny friend | lumpy noise-displaced shell + afro texture + white terry headband |
| school bob ติ่งหู | schoolgirls | bob shell cut at the earlobe, straight fringe |
| ponytail | students, staff | shell + one hanging card strip |
| long straight black | young women | 12–20 cards |
| auntie perm ผมดัด | aunties 50+ (often dyed burgundy/brown) | lumpy short shell + perm texture |
| grey crop / salt-and-pepper | uncles 55+ | short shell + `salt_pepper` |
| bun + hairnet | cooks, vendors | small ball shell + net overlay |

## 7. The four album-cover guys (ref4 → main menu 4 player slots)

Measured colours are from the cover (k-means on each garment).

1. **Left — seated on a cobalt-blue plastic S-chair, leaning forward, holding a Jenga block**
   * Hair: shoulder-length layered black hair, centre-left part, wispy strands over the cheek.
   * Top: long-sleeve white knit tee (`#f8f6f7`) with thin irregular horizontal dark-grey/black
     stripes (`#3b3a40`) across chest and belly, plain white sleeves → `clothing/stripe_white_grey`.
   * Trousers: beige/taupe chinos (`#b39b78`).
   * Shoes: retro canvas sneakers — mustard yellow (`#e6c069`) upper, white toe cap & sole, red details.
   * Chair: cobalt `#1a2fa0` (shadow `#021570`) one-piece plastic cantilever chair.
2. **Centre-left — standing, hands near his hips/front pockets**
   * Hair: big round black **afro**; **white terry headband** (`#f2efed`) across the forehead.
   * Oversized **amber-brown tinted sunglasses** (lens `#91573d` fading to `#36110a` at the top), thin metal frame.
   * Shirt: open short-sleeve **lime-green Hawaiian shirt** (`#86ad55`) with big cream/pale-yellow
     leaf & flower print (`#f4f2c5`, `#e4db7a`) and dark olive shadow leaves → `clothing/hawaiian_green_leaf`.
   * Under it: plain white crew/V-neck tee (`#fdfdfb`); thin silver chain necklace.
   * Dark indigo straight jeans (`#241f3b`), sneakers.
3. **Centre-right — seated on the mustard leather sofa, leaning in to the Jenga tower**
   * Hair: short black shaggy cut with a long fringe (2000s Thai pop).
   * Shirt: short-sleeve polo with **bottle-green and off-white horizontal stripes** (`#2a5e48` /
     `#f2f0e3`), a navy band and a small black/white check at the hem → `clothing/stripe_green_white`.
   * Medium-blue jeans (`#32429c` → faded), silver wristwatch.
4. **Right — sitting on a mustard-orange plastic shell chair, chest against the backrest, arms on top**
   * Hair: short black hair, gelled up/spiky at the front.
   * Shirt: long-sleeve **white shirt with small periwinkle-blue paisley/feather motifs in vertical
     rows** (`#f3f0d0` / `#7b8fd0`), sleeves pushed up → `clothing/paisley_blue_white`.
   * Black slim trousers (`#060204`), silver-black wristwatch.
   * White leather sneakers with red/blue/white side stripes (`#f6f5f6`).
   * Chair: mustard plastic shell `#d8962a` on metal legs.
* Set: warm yellow seamless backdrop with a radial glow (`#eed47d` centre → `#ceb46d` → olive
  `#5a523d` edges), mustard leather sofa (`#ad6b2b`, highlight `#f4d097`), low orange coffee
  table (`#ec773b`), a tall multicolour Jenga tower, olive-green shag rug (`#5b5f35`, darker `#444326`).

## 8. Casino intro looks (all four, before they lose everything)

* Guy 1: black shawl-lapel tuxedo (`clothing/suit_black_wool`), white shirt, loose black bow tie.
* Guy 2 (afro): **gold satin suit** (`clothing/casino_gold_satin`), black shirt, the sunglasses stay on.
* Guy 3: **maroon velvet suit** (`clothing/casino_maroon_velvet`), black shirt open collar, gold chain.
* Guy 4: white shirt + black waistcoat + slicked side-part, cigar prop, wristwatch.
* Props: wine glasses, beer bottles (parody "ช้างน้ำ"/"สิงห์โต"-style labels from the culture agent),
  stacks of chips, a slot machine glow. After the fade they wake up in **white singlets + plaid boxers / black shorts + slippers**.

## 9. Building low-poly characters that read as Chilla's Art

* **Body:** one mesh per body type (man-slim, man-belly, woman-slim, woman-wide, teen, grandma),
  shared rig. Skin material = `avgSkinRGB` × `skin_detail_*` (multiply, triplanar or UV).
* **Clothing as shells:** each garment is a separate closed shell 5–15 mm off the body,
  hard-edged silhouette, 2–3 loops at elbows/knees for bending. Singlets: deep armholes, low
  neck; shorts: wide leg openings; sarong: a straight tube with a rolled waist knot; ผ้าขาวม้า
  on the shoulder = a separate 20-tri cloth strip with a slight sway (spring bone).
* **Texture density:** ~512 px per metre for clothes (1024 maps tile 2×), faces 512 px for the
  head front. Add baked AO in vertex colours under collars, armpits, inside sleeves.
* **Wear:** multiply a grime/sweat mask (darker at armpits, collar, hem, knees).
* **Accessories:** phones, plastic bags, towels, lanyards, helmets — each a tiny textured mesh;
  they sell the "real Thai street" more than anything else.
* **Animation:** procedural walk with slight shoulder sway; aunties waddle, riders hurry,
  monks walk slowly in single file; idle = fanning, scrolling the phone, scratching the head.
* **Never** cartoon eyes or animated mouths: swap the face texture (blink is not needed; the
  `sleep` texture is used only when sleeping).
