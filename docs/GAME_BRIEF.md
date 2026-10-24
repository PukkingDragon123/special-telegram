# เฮียผัด! (Hia Phat!) — Game Brief (READ THIS FIRST, every agent)

A **1–4 player online co-op Thai street-food cooking game** that runs in the browser
(Three.js + Rapier physics + PeerJS). Four broke friends lose everything at a casino, wake up
on a dirty, busy Thai street in singlets and shorts, buy an old man's food cart for exactly
100 baht, and grow it from one wok of **กะเพราหมูสับ + ไข่ดาว** into a real **อาหารตามสั่ง** shop.

Tone: **funny, chaotic, satisfying, physical** — Thai pop culture, memes, slapstick between
friends. The *world* is **NOT cozy**: hot, hazy, grimy, loud, crowded, real.

---

## 1. Visual style — NON-NEGOTIABLE RULES (from the client)

Look references (on disk, view them with the Read tool):
`references/user/ref1_cooking_simulator_counter.jpg` (physical cooking, tiny diegetic "1 g Pouring" label),
`references/user/ref2_chillas_art_convenience_store.webp` and `ref3_chillas_art_kotatsu_room.jpg`
(Chilla's Art style: low-poly + photo textures, static photo faces, held item shown with NO hands),
`references/user/ref5_lowpoly_photoscan_thai_food_blender.jpg` (decimated photogrammetry look for food),
`references/user/ref4_ALBUM_COVER_main_menu.jpg` (the main menu must recreate this composition).

1. **"Realistic low-poly"**: low polygon counts / chunky silhouettes, but **photo / PBR textures
   everywhere**, baked AO / vertex-color grime, decals, wear. Think decimated photogrammetry and
   PS2-era photo-textured horror games, rendered with a modern PBR + post-processing pipeline.
2. **No lazy simple shapes.** Never ship an untextured box/sphere/cylinder/circle. Bevel, chip,
   dent, noise-displace, break symmetry. Organic shapes. Smoke, steam, clouds, fire, speech
   bubbles, thought clouds use **noise (fbm) shaders / noise maps**, never flat circles.
3. **Everything is textured and detailed — with REAL images from the internet.** (Client rule.)
   Packaging, product labels (seasonings etc.), signs, posters, food, fabrics, facades, decals:
   ALWAYS find real photos online (Google/Bing/DDG/Flickr/Commons/product sites) and crop /
   flatten / rectify / colour-match them. NEVER hand-make or fake art (no self-designed parody
   labels or signs). Procedural noise is only for shaders (smoke, clouds, wear masks).
4. **Realistic shader for PC**: PBR materials, HDRI env lighting, soft shadows, SSAO, bloom,
   tone mapping, color grading, subtle film grain/vignette, haze/fog, wet/dirty surfaces.
5. **Real sculpted, rigged models** (client rule): people, animals, ghosts are ACTUAL sculpted
   models with proper rigs (sourced from the internet — Quaternius CC0, Objaverse, OpenGameArt,
   glTF samples — converted/fixed with headless Blender, see scripts/_cache/blender). Animals
   (dog, cat…) get real FUR (shell texturing + fur photos) and FACIAL ANIMATION (blink, ears,
   jaw/pant/tongue, bark). Human faces stay static photo textures (Chilla's Art style) with
   texture-swapped expressions.
6. **No first-person hands.** First-person camera; the held item floats in the lower right of
   the view (like ref2). Other players see items physically on your body.
7. **Almost no 2D UI.** Use floating 3D text clouds, speech bubbles, physical objects
   (signs, posters, a recipe book, a newspaper, a magazine, coins, banknotes), diegetic labels.
   Only tiny, elegant, necessary overlays (crosshair dot, a subtle interaction hint).
8. **Looped Thai fonts only — ไทยมีหัว** (client rule): Sarabun, Noto Sans Thai Looped,
   IBM Plex Sans Thai Looped, Noto Serif Thai, Taviraj, Trirong, Chonburi, Pattaya, Charmonman,
   Charm, Srisakdi; handwriting: Itim, Mali, Sriracha. NEVER loopless fonts (Kanit, Mitr, Prompt,
   Chakra Petch, Bai Jamjuree, Athiti…). Use `F.*` from `src/core/fonts.ts` (all looped).
   Thai text is primary; a small English subtitle line under important text is welcome.
9. **Polish**: eased transitions, juicy animations, squash/stretch, screen-shake used sparingly,
   satisfying sounds on everything (see §5 audio).
10. 2D art assets (magazine, newspaper, posters, menus, labels, signs) are built from **real
    photos found on the internet, edited together** — not flat vector "lazy UI" and not
    self-drawn. The recipe book is the only exception: its art is deliberately **lazy, ugly,
    scribbled — but clearly human-made** (ballpoint doodles, crossed-out words, coffee stains).

## 2. The world

A Thai neighbourhood that feels like a **real, busy, dirty Thai city street that fades into
rural edges**: old concrete **shophouses (ตึกแถว)** with rusty roller shutters, steel window
grilles, AC units, faded signs, tangled **utility-pole wires**, red-white painted curbs,
potholes, puddles, trash bags, street-food stalls, a fresh market (ตลาดสด), a parody convenience
store, a wholesale shop, a furniture/plastic shop, a hardware shop, a motorcycle-taxi stand
(วินมอไซค์ vests), a spirit house (ศาลพระภูมิ), a temple wall, a canal (คลอง), banana trees,
coconut palms, a patch of rice field / empty lot at the edge, stray dogs and cats.
Traffic: motorcycles, tuk-tuks, songthaews, pickups, taxis, buses — horns everywhere.
**People everywhere**: aunties, uncles, students in uniform, office workers, motorbike-taxi
guys, delivery riders, vendors, a homeless man, monks (treated respectfully).

## 3. Game flow & features (complete list from the client)

**Main menu** — recreate the album cover (ref4) exactly as a 3D scene: warm yellow glowing
backdrop, green rug, small table with a Jenga tower, four guys in the same poses/outfits/chairs.
Title **"เฮียผัด!"** in the same bubbly white + thick green outline style. Add **Host** and
**Join** UI (styled to fit the cover). The 4 guys = the 4 player slots: when alone, the other
three are dark **silhouettes**; when friends join, they appear. You can **click yourself** (an
arrow points at your character) to customize.

**Customization** — your character **T-poses in the middle of a Thai street wearing only shorts
and เสื้อกล้าม**; then a girl walks by, screams, and runs away. The customization UI looks like a
**realistic Thai fashion magazine** (photo pages, prices, captions): change clothing,
accessories, looks (hair, face), skin colour.

**Newspaper** — a super realistic parody Thai tabloid (used for day summaries / headlines).

**Intro cutscene** — short, funny: casino, all four in suits, gambling, drinking wine & beer,
celebrating in slow motion; they get drunk and lose everything; screen fades out. They wake up
on a busy Thai street in singlets and shorts. They see a food cart and try to take it; an old
man catches them and offers to sell it for **100 baht**. All four pull out coins — exactly
enough. Inside the cart: a recipe book, rice, minced pork, holy basil, seasonings. A **stray
dog** runs by and eats all the rice and pork. Objective: go to **auntie's market stall** and buy
more ingredients.

**Core cooking** — start with one food cart, a wok, dishes and basic utensils. The old man's
recipe book has **กะเพราหมูสับ** and **ไข่ดาว** and teaches how to cook (lazy human art).
Players physically grab tools and ingredients, prepare (chop, crush garlic & chili), add
seasonings, control the heat, cook, plate onto a dish with rice / vegetables / utensils, and
serve. **Result depends on how much of each ingredient and seasoning** goes in (grams /
splashes, heat, time, burnt-ness). Customers give an **honest rating** (price, taste, wait,
portion, cleanliness). Click the **sign** to open/close the shop and set the **menu poster**.
Buy more things: water machine, cups, soda, ice, etc. Plastic tables & chairs; collect dirty
dishes, wash dishes, clean up. NPCs walk around, come to eat, order, pay and leave.

**Inventory** — **E** pick up, **Q** drop. 5 slots per player. Carried items are **physically
visible on your character** (in hands, under arms, on head, on back, stacked…) — funny and
physical. The more you carry the slower you move; with all 5 slots full you are **overloaded**
and can't do anything until you drop something.

**Shops & economy** — walk to actual shops to buy everything (ingredients, furniture, plastic
tables, chairs, better equipment). Shops open / unlock more stock by day. **Bargaining** and a
**mad system**: shopkeepers and customers can get angry — choose the right words within
**3 seconds**. Set the right food prices for the location. **Each player has a separate wallet.**

**Player interactions** — right-click another player: **slap**, **high-five**, **give money**.
**Snatch** items from friends (even while they read the recipe book) → a **click-fast tug-of-war
minigame**, whoever clicks faster wins.

**Neighbourhood life** — Thai pop culture references & memes; a homeless person you can give
coins to; a stray dog you can feed (it follows you, can be adopted); a stray cat adoptable on
**Day 5**; NPCs, animals and interactions everywhere. **Thai ghosts at night** including a
**motorcycle ghost** (headless rider), กระสือ, ปอบ, นางตานี, เปรต, …

**Time** — one in-game day = **20 real minutes**. At **midnight** all players sleep on
**cardboard** they find. Simple progression: start with กะเพรา, gradually unlock more
อาหารตามสั่ง menus (ไข่เจียว, ข้าวผัด, ผัดพริกแกง, ผัดซีอิ๊ว, ราดหน้า, ต้มยำ, …), ingredients,
equipment, furniture, better restaurant setups. The restaurant visibly grows as you earn.

**XP & skill tree** — skills: cooking, preparing, serving, cleaning (unlock faster actions and
other upgrades). Opening it switches to **third-person**: your character thinks with a dumb
expression under a big, beautiful **3D thought cloud** containing a dreamy skill tree with
branches, floating กะเพรา, spatulas, woks… Every upgrade icon is a **spinning 3D item**, with
cool text transitions. Friends can see you thinking and **slap you**. The skill tree is funny.

## 4. Culture & content guardrails
- Funny and affectionate, never mean to Thai people. Thai text should read naturally.
- **No royal-family references at all. No real politicians / political memes.**
- Real Thai products, brands and shop signs are WELCOME (client wants real packaging found
  online). Don't use real identifiable private people's faces for characters (use faces of
  people who don't exist, chosen to look authentically Thai).
- Monks, temples, spirit houses are treated respectfully (no slapping monks, no jokes about
  Buddha images). Ghost folklore is fine.

## 5. Assets, references, licences
- `references/` = research notes + reference images **for agents to look at** (raw web
  downloads live in `references/**/web/` / `_raw/`, git-ignored).
- `public/assets/` = game-ready assets, **sourced from real images on the internet** (any
  source the client is happy with; real brands OK). Record every shipped third-party file's
  source URL in `references/credits/*.md` → `CREDITS.md`.
- PBR materials: Poly Haven, ambientCG scans. Keep web sizes small: 1K (some 2K) JPG/WebP,
  power-of-two where tiled.
- Audio: CC0 / free-licence SFX (Kenney, Mixkit, OpenGameArt, Wikimedia Commons, BigSoundBank,
  archive.org public domain…). Ogg/MP3, normalized, trimmed, short.
- Fonts: Google Fonts (OFL) Thai families in `public/assets/fonts/`.
