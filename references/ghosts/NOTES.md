# Thai ghosts — visual bible (R3-people)

Night-time (roughly 22:00–05:00 game time) brings ผี to the neighbourhood. Tone: **funny-scary**
— real Thai folklore looks (Thai horror films of the 1980s–2000s, temple hell-garden statues,
spirit-house culture), played for jump-scares and slapstick, never gory for its own sake and never
mocking Buddhism. Look-only references are in `web/` (`web/index.json` = sources: Thai film
posters, Wat hell-garden statues, Kuman Thong amulets, Mae Nak shrine at Wat Mahabut, Krahang
performance photos, Thai ghost-video thumbnails). Game textures (all from real photos) are in
`public/assets/textures/ghosts/` with a `manifest.json`.

General rules for every ghost
* Faces: static photo faces like the NPCs (Chilla's Art). Ghost faces = an NPC face texture
  graded pale/grey-green (multiply `#b8c2b0`, lift blacks, darken eye sockets with a soft vignette
  on the eye area) — or no face at all (headless rider, hair-covered Mae Nak).
* Lighting: ghosts are lit by a cold rim light (`#9fd4ff`) and carry a faint emissive term so
  they read in the dark; spawn inside the volumetric mist (`ghost_mist_*.jpg` scrolling on
  camera-facing quads + fog).
* Audio language: wind, distant dog howls (หมาหอน — dogs howl before a ghost appears), a
  clock tick stopping, the Thai ghost giggle "หึ หึ หึ", flies buzzing, a temple bell far away,
  then a loud sting on the reveal. Ghost proximity = low drone + tinnitus whistle.
* Counter-play (funny): run to the spirit house (ศาลพระภูมิ) and wai, hold up a holy-basil
  bunch or an amulet, turn on all the lights, play loud ลูกทุ่ง music, or hide under the plastic
  table. Ghosts steal food, knock pots over, scare customers away, chase players — they never
  "kill"; getting caught = you wake up on the cardboard with a black-and-white filter and lose a
  little money/time.

---------------------------------------------------------------------------------------------------

## 1. กระสือ Krasue — floating woman's head with dangling glowing entrails

* **Look:** a beautiful but pale young woman's head (long black hair, often wet and stringy),
  flying at head height; below the neck hang her **heart, lungs, stomach and a long coil of
  intestines**, glistening, red-pink with yellowish fat, that **glow green-yellow** at night
  ("ไฟกระสือ" — the will-o'-the-wisp lights seen over rice fields). Lips smeared red.
* **Colours:** skin `#d9cbbf` greyed; entrails `#8c2a2e` → `#c4545a`, fat `#d9b56b`; glow
  `#9cff6a` / `#e8ff8a`; hair `#0b0a0c` with blue-grey wet highlights.
* **Behaviour (lore):** a cursed woman whose head leaves her body at night to eat raw meat,
  blood, and filth; hides from people, bobs over fields and drains. Afraid of thorny bushes
  (her guts get stuck), so villagers put thorny branches round the house.
* **In game:** drifts in from the canal/rice-field edge, dives at the **raw minced pork** in
  your cart (steals ingredients!), giggles, flees if you swing the spatula or a thorny bamboo
  stick. Her glow is visible from far away (great for silhouettes in the haze). Funny: she gets
  her intestines tangled in the utility-pole wires or on the plastic chair stack and has to
  wiggle free.
* **Sounds:** wet slither, high giggle, a sucking slurp when she eats, crackling glow hum.
* **Low-poly recipe:** head = NPC female head (pale face texture) + long wet hair cards
  (`hair_wet_black.png`); neck stump with a ragged ring; organs = 3–5 lumpy noise-displaced
  ellipsoids; intestines = a spline tube (8 sides, 40–60 segments, length ~1.2 m) with
  `krasue_entrails_albedo.jpg` + `krasue_entrails_emissive.jpg` (multiply emissive by a pulsing
  0.5–1.5 intensity, bloom on); spring-chain simulation so the guts swing; slight point light.

## 2. ปอบ Phi Pop — the flesh-eating possessing spirit

* **Look:** possesses a normal villager (often an old lady or a drunk uncle): looks like a
  normal NPC from far away, but up close — grey-green skin, red eyes, black lips, blood on the
  chin, stringy greasy hair, sarong and a stained singlet/blouse; walks hunched with hands like
  claws, eats raw liver/guts. Thai comedy films (ผีหัวขาด / ปอบ series, e.g. ปอบหวีด) made Phi
  Pop a comic monster.
* **Colours:** skin `#8e9a86`, eyes `#c0201a`, mouth `#3a1012`, clothes faded `#cfc6b0`.
* **Behaviour:** pretends to be a customer, orders "แบบดิบๆ" (raw), then reveals itself and
  chases people; afraid of a mo phi (shaman) with a sacred thread, salt, and holy-basil.
* **In game:** a regular-looking customer who orders raw pork; when you serve it raw (or burnt
  rice), the face texture swaps to the Phi Pop face and it chases everyone around the tables.
  Slapping/throwing salt makes it drop the possession (the NPC wakes up confused and pays).
* **Sounds:** wet chewing, sniffing ("ฟึด ฟึด"), gurgling laugh.
* **Low-poly recipe:** reuse any NPC body + clothes; swap face texture → graded pop face; add
  `pret_grey_skin.jpg` tint on arms; hunched pose; long fingernail cones.

## 3. นางตานี Nang Tani — the banana-tree lady

* **Look:** a gentle, beautiful young woman in **traditional Thai dress in green** (green silk
  pha sin skirt with a gold woven border + a green sabai / breast cloth over one shoulder),
  long black hair loose or in a low bun, barefoot, appears beside **wild banana trees (กล้วยตานี)**
  on full-moon nights, floating slightly, sometimes her lower body fades into mist.
  Offerings of red/green dresses and garlands are tied around banana trunks.
* **Colours:** silk `#2f7d4a` / `#3f9a5c` with gold `#c9a646` brocade; skin warm pale
  `#e3c7ad` with green rim light; hair `#0d0c0e`.
* **Behaviour:** mostly benign — gives food to monks, protects the tree; dangerous only to men
  who disrespect/cut her tree (she appears as a terrifying woman).
* **In game:** stands among the banana trees at the rural edge; if you cut banana leaves for
  your dishes without a wai/offering she follows you, your fire turns green and food burns.
  Leave a garland → she nods and vanishes (and leaves a bunch of bananas: free ingredient).
* **Sounds:** soft female humming, banana leaves rustling with no wind, wind chimes.
* **Low-poly recipe:** NPC woman body, pha sin = flared tube with `nangtani_green_silk.jpg`,
  sabai = draped strip over one shoulder; long hair cards; lower 30 % fades with a vertical
  alpha gradient into mist; banana trees with `banana_leaf.jpg` leaf cards.

## 4. แม่นาค Mae Nak Phra Khanong — the devoted wife

* **Look:** young village woman of the old Phra Khanong canal (19th century): **very long
  straight black hair** covering most of the face, pale skin, simple **white or pale traditional
  dress** (white sabai/blouse + dark pha sin or a white funeral cloth), often holding her baby
  bundle; famous for her **impossibly long arm** stretching down through the floorboards to pick
  up a dropped lime (มะนาว). Her shrine at Wat Mahabut (Bangkok) is full of dresses, cosmetics
  and toys offered by visitors.
* **Colours:** dress `#ece6d8` (stained `#c9bfa8`), skin `#d7d0c6`, hair `#070708`, eyes red-rim.
* **Behaviour:** waits for her husband, attacks anyone who tries to separate them; sad more than evil.
* **In game:** appears at the canal pier and under the shophouse stilts; if you drop an
  ingredient (a lime!) near her, an arm stretches 6–10 m along the ground and takes it.
  Funny: she politely hands back the lime and asks "พี่มากเห็นไหม" (has anyone seen Mak?).
* **Sounds:** a baby crying in the distance, wooden floor creaks, "พี่มาก…" whisper.
* **Low-poly recipe:** woman body, white dress shell (`ghost_rag_white.png` for the hem),
  hair = long wet hair cards falling over the face (no face texture needed); the long arm = a
  stretchable bone chain with a skin-tinted cylinder (8 sides) and the hand at the end.

## 5. เปรต Pret — the giant hungry ghost (Buddhist preta)

* **Look:** **extremely tall (3–5 m) and thin**, ribs and spine showing, long neck, sparse
  hair, sunken eyes, **mouth as small as a needle-eye** (cannot eat), belly sometimes swollen,
  long hands, greyish skin. Temple hell gardens (e.g. Wat Phai Rong Wua, Wat Saen Suk) have
  white/grey concrete Pret statues with long tongues, emaciated bodies — exactly the look.
  Appears on วันสารทเดือนสิบ (10th-month festival) begging relatives for merit.
* **Colours:** skin `#8f8a84` / `#a7a19a` (cement grey with blue undertone), eyes black `#111`,
  tiny mouth dark red; tattered loincloth `#b9ad95`.
* **Behaviour:** moans and begs ("ขอส่วนบุญ"), harmless but terrifying; sins of the past life.
* **In game:** towers over the shophouse roofs, peeks into the 2nd-floor window, slowly walks
  along the road; begs for food — give a dish → it can't eat (tiny mouth) and cries; if a monk
  NPC is present at dawn it fades with relief (merit). Comedic: it bonks its head on the
  utility wires and hangs its laundry-like loincloth on them.
* **Sounds:** a very high thin whistle ("หวีดดด") — the classic Thai pret sound, slow heavy steps.
* **Low-poly recipe:** stretched human rig (legs 2×, neck 3×), 1.5 k tris, rib loops
  modelled, `pret_grey_skin.jpg` + darker cavities in vertex colour, tiny mouth in the face
  texture (shrink the mouth by warping an old-man face), slow IK walk.

## 6. ผีหัวขาดขี่มอไซค์ — the headless motorcycle rider

* **Look:** a dead motorbike-accident victim riding at night: **no head** (neck stump), body in
  a torn jacket or a moto-taxi vest, sometimes holding his helmet (with the head inside) under
  one arm; the motorbike is an old Thai step-through (Honda Dream / Wave-like) **burnt, rusty,
  bent**, one dim yellow headlight flickering, no sound… then a sudden engine roar. Urban
  legend on dark highways and bridges.
* **Colours:** rust `#7a3b1c`, burnt black `#141110`, faded red/blue body panels `#7d2322` /
  `#2d4a7a`, vest orange `#d95d1a` (dirty), headlight `#ffd27a`.
* **Behaviour:** rides past at midnight, stops beside you, offers a ride ("ไปไหนครับ") with no head.
* **In game:** the ghost "วิน" — at midnight a moto-taxi waits at the empty วิน stand; walk up
  and it turns: headless. Then it chases players along the street (honk honk), circles the
  stall, and knocks over chairs. Getting hit = ragdoll + wake up on cardboard.
* **Sounds:** a dead-silent approach, then a two-stroke scream, horn "แป๊น", chain rattle,
  helmet laughing.
* **Low-poly recipe:** reuse the street motorbike model with `ghost_moto_burnt.jpg`
  (burnt/rusty livery) + broken headlight emissive flicker; rider = NPC body in a torn
  `win_vest` + ragged neck stump (dark red ring + `krasue_entrails` tint), helmet prop with a
  face inside (photo face texture graded grey).

## 7. ผีกระหัง Phi Krahang — the flying male ghost with rice-winnowers

* **Look:** a man (often a sorcerer) in a **loincloth / ผ้าขาวม้า**, flying at night with **two
  round woven rice-winnowing baskets (กระด้ง) as wings** on his arms and a **rice-pounding pestle
  (สาก)** between his legs as a tail; lean, tanned, wild hair. Comic figure in Thai films.
* **Colours:** skin `#7a4f36`, bamboo winnowers `#b48a52` (darker weave `#6e5333`), pestle
  wood `#5a3d22`, loincloth red/green check.
* **Behaviour:** steals food and scares villagers; partner/male counterpart of Krasue.
* **In game:** swoops over the street flapping the winnowers (wobbly flight), steals cooked
  dishes off the tables, drops them on someone's head. Throw a rice basket / sticky rice to make
  him chase it.
* **Sounds:** whoosh-flap of woven bamboo, a pestle "ตุ้บ" on landing, cackle.
* **Low-poly recipe:** NPC man body + pha khao ma loincloth (`clothing/phakhaoma_*`); two
  flat discs (16-gon, slight dish) with a bamboo-weave texture (use the woven/wicker
  photos); pestle = 8-sided cylinder.

## 8. กุมารทอง Kuman Thong — the golden child spirit

* **Look:** a small child (3–5 years) spirit, usually seen as a **gilded statuette** (gold
  leaf, topknot / short hair, red cloth, sitting or standing, sometimes with a green or red
  sash), kept in shops for luck and fed red Fanta, sweets and toys. When it manifests: a small
  pale boy with a topknot, red shorts, giggling.
* **Colours:** gold `#c8a24a` with worn black under-layer, red cloth `#b3201f`, green `#2f7a3a`.
* **Behaviour:** protective, mischievous; gets jealous if neglected.
* **In game (cute-creepy):** a Kuman Thong statue sits on a shelf in the shop; at night it
  moves when you are not looking, eats your sugar, plays with the ladles; give it red Fanta
  (parody red soda) → luck bonus for the next day.
* **Sounds:** child giggle, small running footsteps, a toy bell.
* **Low-poly recipe:** 300-tri statuette with a gold PBR material (metalness 1, roughness
  0.35, worn edges via curvature/vertex colour); a ghost child version uses a kid body with a
  grey-graded face.

---------------------------------------------------------------------------------------------------

## Night ecology (who appears where)

| Place | Ghost | Cue before it appears |
|---|---|---|
| Canal pier / old wooden house | แม่นาค | baby crying, lime rolls |
| Banana trees at the rural edge | นางตานี | leaves rustle, green moonlight |
| Rice field / drains | กระสือ, กระหัง | green floating lights, flapping |
| Empty วินมอไซค์ stand / main road | ผีหัวขาด | a single headlight, no engine sound |
| Temple wall at the end of the soi | เปรต | high whistle, footsteps shaking water in buckets |
| Customer tables | ปอบ | an order for raw meat |
| Shop shelf | กุมารทอง | giggle, toy bell |

## Texture list (public/assets/textures/ghosts/, all derived from real photos — see manifest)

* `krasue_entrails_albedo.jpg` + `krasue_entrails_emissive.jpg` — raw pork-intestine photo,
  tileable along U for a tube; emissive = mask of the glistening fatty parts.
* `hair_wet_black.png` — wet black hair strands with alpha (hair cards for Krasue/Mae Nak).
* `ghost_rag_white.png` — tattered white cloth with holes/torn edge (alpha).
* `nangtani_green_silk.jpg` — green Thai silk with a gold woven border.
* `banana_leaf.jpg` (+ `banana_leaf_card.png` with alpha) — banana-tree leaves.
* `pret_grey_skin.jpg` — wrinkled grey skin (elephant/old-skin photo, desaturated).
* `ghost_moto_burnt.jpg` — burnt / rusty motorbike paint for the headless rider.
* `ghost_mist_a.jpg`, `ghost_mist_b.jpg` — tileable smoke/fog (greyscale, use as alpha).
