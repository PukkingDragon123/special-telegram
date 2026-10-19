# ref4 album cover → เฮียผัด! main menu: 3D breakdown

Source: `references/user/ref4_ALBUM_COVER_main_menu.jpg` (500 × 500 px, the client's reference: a Thai band's
2000s album cover). We copy the **composition, poses, outfits, furniture, palette, light and lettering style**.
**Do not copy the band members' faces.** The four guys use our own static photo faces (GAME_BRIEF §1.5).

All colours below were **sampled from the image with Python** (`scripts/research/R4/sample_album.py`,
`sample_album2.py`). Coordinates are in the 500 px image; `n(x, y)` = normalised 0–1 (x right, y down).

Companion files:
- `references/ui/album_cover_blocking.png`: my own schematic (front view at cover framing + top-down plan with the solved camera).
- `references/ui/album_cover_palette.png`: swatches of every sampled colour.
- `public/assets/img/ui/`: the finished title / button / plate / arrow art in this lettering style (see §9).

---

## 1. Camera

| Item | Value | How it was derived |
|---|---|---|
| Height | **0.40–0.45 m** above the floor (≈ coffee-table-top height) | The table top (y ≈ 312–325) is seen almost edge-on: only a ~8 px strip of the top surface shows |
| Eye level / horizon | **y ≈ 0.63** of the frame (63 % down) | Edge-on table top. The level line sits below the frame centre |
| Pitch | **+5° to +6° (looking slightly up)** | Horizon is (0.634 − 0.5) × FOV ≈ 5.4° below the optical centre |
| Field of view (square frame) | **≈ 40–42° horizontal = vertical** | G2's face (≈ 15 cm) spans ≈ 33 px, so the frame is ≈ 2.27 m wide at his depth (≈ 3.1 m) |
| Focal length | ≈ **32 mm on a square 24 × 24 crop** (≈ 47–50 mm FF 3:2 equivalent) | Same as above |
| Distance to group | G1 ≈ 2.2 m, G4 ≈ 2.3 m, G3 ≈ 2.9 m, G2 ≈ 3.1–3.3 m, backdrop ≈ 5 m | Head sizes + seated/standing head heights (G2 head centre ≈ 1.5 m, G1 seated ≈ 1.0 m) |
| Roll | 0° (verticals of the table legs and chair are upright) | |
| Lens character | Mild perspective: the foreground feet (G1's sneaker, G4's sneakers) are large, the standing G2 is slightly foreshortened looking up | |

**three.js:** `new PerspectiveCamera(41, aspect, 0.05, 50)`, position `(0, 0.43, 0)`, lookAt `(0, 0.72, 3.0)`
(≈ +5.5° pitch). `fov` is vertical in three.js. Keep **41° vertical** at 16:9: the cover's square becomes the
central 56 % of the screen and the extra width shows more of the yellow backdrop and the dark corners, which suits it.
At portrait / narrow aspect, widen the vertical FOV so the horizontal FOV stays ≥ 40°.
Idle: a slow 6–8 s sway of ±0.6° yaw plus a 1 cm dolly breath. On "Host / Join", push in 0.25 m over 0.6 s (easeOutCubic).

## 2. Framing (front view, normalised)

```
y 0.00 ┌──────────────────────────────────────────────┐  dark olive top (#6E6141), corners #473E28
       │        G2 afro top (0.06)                    │
y 0.10 │   ╭──── edge of the yellow spot-disc ────╮   │  disc edge passes (0.02,0.23) (0.5,0.11) (0.96,0.22)
       │ G1 head      G2 face        G4 head        │
y 0.30 │ (0.04–0.20)  (0.36–0.43)   (0.73–0.86)     │
       │                     G3 head (0.58–0.69)     │
y 0.48 │ blue chair ─┐  sofa back  JENGA  orange chair│  Jenga x 0.47–0.54, y 0.49–0.62
y 0.63 │─────────────── table top (eye level) ────────│  table x 0.40–0.70, y 0.625–0.65
       │   T I T L E   line 1  (x 0.18–0.73, y 0.63–0.75)
y 0.75 │        T I T L E   line 2  (x 0.28–0.85, y 0.75–0.88)
       │  rug (olive)            subtitle (x 0.38–0.65, y 0.92–0.99)
y 1.00 └──────────────────────────────────────────────┘
```

- The group fills the full width. G1 is cut by the left edge and G4 by the right edge. The standing G2 nearly touches the top.
- The table and Jenga tower sit dead centre, in the vertical middle third, right on the eye-level line.
- The title covers the lower 37 % over the legs and rug. Only the feet show below it: G1's sneaker at n(0.52–0.60, 0.87–0.92), G4's white sneakers at n(0.73–0.89, 0.89–0.98).

## 3. The set (dimensions are for the 3D build)

| Element | Description | Colours (sampled) |
|---|---|---|
| **Backdrop** | Seamless paper cyclorama ≈ 6 m wide, curving into the floor at ≈ 4.5–5 m depth. Lit by a big yellow-gelled spot (see §6) | glow core `#FFF78C`, `#FEF288`, `#FEE976`; sat. yellow `#FDEF51`/`#FEF454`; edge `#EFCD76` → `#C8B278`; outside the disc `#887854` → `#6E6141` (top) → `#473E28` (corners) |
| **Studio floor** (beyond the rug) | Cream paper or concrete, visible only at the far left and right, y ≈ 0.69–0.75 | `#DFD7C7`, `#E4DDC0`, shadowed `#CBC9C6` |
| **Rug** | ≈ 3.0 × 2.5 m low-pile **olive / moss-green** rug under everything, front edge out of frame. A slightly lighter green band and two pale stripe lines run parallel to the front at y ≈ 0.79, 0.91 and 0.945. Heavy, almost black shadows under the chairs and on the right | base `#5B5A2E`, mid `#646235`, dark `#434522`, deep shadow `#242514`/`#010104`, lit band `#AEBE6C`, stripe `#A0AA69`/`#B9D18C` |
| **Sofa** | Low 2–3 seat sofa behind the table, ≈ 1.8 × 0.8 m, seat h ≈ 0.38 m, back h ≈ 0.70 m. **Caramel / tan** smooth leather or vinyl with soft highlights. Its left arm shows behind G1/G2 | mid `#AB6931`, shadow `#63350C`, highlight `#F8C48A`, deep `#5C200F` |
| **Coffee table** | Low rectangular table ≈ 0.9 × 0.5 m, **h 0.38 m**, glossy **orange-red** lacquered top ≈ 3 cm thick, slim dark legs | top `#E17539`, lit `#EB9661`, dark edge `#B96F2D`, legs `#281E18` |
| **Jenga tower** | Full 18-level tower (blocks 7.5 × 2.5 × 1.5 cm → tower 7.5 × 7.5 × 27 cm) **rotated ~45°** so a corner faces the camera (that is why it looks 2.3 : 1). Every block is one bright colour, colours random per block. A few blocks are pulled out (gaps). G3 is pulling one and G1 holds a blue one | red `#DD7A69`/`#943C2F`, orange `#F4B066`/`#B97838`, yellow `#FEE97A`/`#DCBE58`, blue `#4A5BB4`/`#283284`, purple `#9952B4`/`#612F83`, pink `#E16CA7`/`#B04A7A`, rose `#ED7387` |
| **G1 chair** | **Panton-style S-shaped cantilever chair**, glossy molded plastic, deep **cobalt / ultramarine blue**, seen ¾ from front-left. The sweeping base reaches the bottom-left corner, n(0.14–0.30, 0.80–0.98) | mid `#00146A`, shadow `#001253`, highlight `#12319C`, spec `#355997` |
| **G4 chair** | **Mid-century molded shell chair** (Eames-DSR-like), **mustard-orange** shell on thin dark metal legs, placed side-on facing left (toward the tower) | lit `#B5742B`, mid `#713A04`, shadow `#5C2E05` (lit side reads as mustard `#C99033` on screen) |

Top-down positions (metres, camera at origin looking +z, +x right). Also drawn in `album_cover_blocking.png`.

| Item | x | z | Facing |
|---|---|---|---|
| table centre | 0.00 | 2.50 | long side to camera |
| Jenga | 0.00 | 2.50 | rotated 45° |
| sofa centre | 0.00 | 3.20 | faces camera |
| **G1** (blue chair) | −0.72 | 2.20 | chair faces right-front (yaw ≈ +40°) |
| **G2** (standing) | −0.36 | 3.25 | faces camera, slight turn to his left |
| **G3** (on sofa) | +0.29 | 2.95 | faces camera, leans to the tower |
| **G4** (orange chair) | +0.62 | 2.30 | body yaw ≈ −70° (faces left toward the tower) |
| backdrop sweep | — | 4.5–5.0 | — |

## 4. The four guys (= the 4 player slots)

Suggested slot mapping: **P1 / host = G2** (standing hero in the middle), P2 = G1, P3 = G3, P4 = G4.
Left-to-right order also works. Everyone is mid-20s, slim, warm-tan skin:
lit `#FAD3AC`, mid `#C98A61`, shadow `#683521`.

### G1: long hair, blue Panton chair (left, cut by the frame)
- **Hair:** black `#10080B` (sheen `#563D3A`), straight, **jaw-to-shoulder length**, centre-parted, falls over the cheek in profile.
- **Outfit:** white long-sleeve tee `#F8F7F9` with **thin dark horizontal stripes** on the sleeves and chest (`#2D2737`, grey-lavender shade `#A29BBF`). **Beige chinos** `#D4B57C` (lit `#F7DEC0`, shadow `#554630`). **Retro running sneakers**: white `#EDECDF` with mustard `#ECBD56` and sage `#84A867` panels.
- **Pose:** sits deep in the chair. **Torso leans forward ≈ 35°**, head bowed ≈ 30°, profile facing right, eyes on his hands.
  Both **upper arms hang forward**, elbows on the thighs near the knees, **forearms horizontal pointing right**, hands together at n(0.19–0.22, 0.43–0.45) **holding a blue Jenga block**.
  The near leg is bent with the foot by the chair base. The **far leg stretches diagonally forward-right**: knee at n(0.30–0.38, 0.58–0.64), sneaker at n(0.52–0.60, 0.87–0.92), under the title.

### G2: afro, standing (centre-left, tallest)
- **Hair:** big round **afro** `#1B1219` (brown sheen `#8C754F`), white **headband** `#FBFBFA`.
- **Accessories:** **large white-framed sunglasses with amber-brown lenses** (`#984A30`, hot spot `#E1936E`). Thin silver chain necklace with a small pendant.
- **Outfit:** open **short-sleeve camp-collar shirt**, white base `#F4F2C9` with a **lime / yellow-green leaf-floral print** (greens `#62963E` / `#A7C86A` / `#F0FA9D`, yellows `#DACE61` / `#FCEF83`, dark accents `#3B310E`), worn open over a **plain white crew tee** `#FEFEFD`. **Dark indigo-black jeans** `#0F0C1C` (sheen `#574C4C`).
- **Pose:** stands behind G1's chair, left of the sofa. **Weight on his left leg** (screen right), hip slightly cocked, feet ≈ shoulder width.
  Shoulders relaxed, **arms hang straight**: right hand (screen left) by the front pocket at n(0.29–0.32, 0.45–0.50), left hand by the left thigh at n(0.45–0.47, 0.44–0.48).
  **Head tilted down ≈ 15° and slightly to his right**, looking down at the camera with a deadpan "cool" stare.

### G3: bangs, on the sofa (centre-right, smallest in frame)
- **Hair:** black `#210A07`, medium-short with **heavy straight bangs** over the eyebrows.
- **Outfit:** white tee `#F4F7F1` with **horizontal stripes**, mint-teal (`#8FB4A6`, lit `#C7E8DF`, shade `#51716B`) and thin charcoal. **Mid-blue jeans** (lit `#2940A0`, shadow `#0A0615`).
- **Pose:** sits on the front edge of the low sofa, knees high, **leaning forward ≈ 30°**.
  **Right arm extended forward-left: his hand is at the tower's mid height, pulling a blue block** at n(0.51–0.54, 0.47–0.49).
  Left forearm rests across his left knee. **Head bowed and turned left**, frowning in concentration at the tower.

### G4: side-saddle on the orange shell chair (right, closest)
- **Hair:** black `#0A0612`, short, **combed up and back with a side part** (2000s wet-look).
- **Outfit:** white short-sleeve shirt `#F0EFE9` with a **pale-blue / grey paisley-floral print** (`#B0B5DB`, `#646784`, `#4D506C`), sleeves slightly rolled. **Black slim trousers** `#050303`. **White sneakers** `#F4F3F4` with dark-grey side stripes `#4C473B`. **Brown leather-strap watch** `#5D2C28` on his right wrist.
- **Pose:** the chair is turned side-on and he sits **facing left toward the tower**. **Torso leans forward ≈ 45°**, head raised, profile looking left-down at G3's hand on the tower.
  **Right arm (nearer the tower) reaches forward**: forearm on his knee, wrist with the watch at n(0.66–0.68, 0.45–0.48), fingers pointing at the tower. The far arm is hidden behind his body.
  Knees point left. His **right foot is planted in the right foreground** at n(0.73–0.89, 0.89–0.98). The left foot is further back.

**Story of the pose:** a tense Jenga moment. G3 is mid-pull, G4 and G1 watch the tower (G1 already holds a block), and G2 alone ignores the game and stares at the viewer.
For the menu: idle-loop it. G3's hand inches the block out over ~4 s and puts it back. G4 leans in, G1 turns the block in his fingers, G2 breathes and adjusts his sunglasses every ~10 s.
**Easter egg:** when all 4 players are in, the tower wobbles. If nobody presses Start for 60 s, it collapses (physics) and everyone turns to the camera.

## 5. Silhouettes, "you" arrow, name plates
- **Empty slot:** render that guy as a flat silhouette (unlit material `#14110A`, 88 % opacity) with a 2–3 px yellow **rim** from the backdrop (`#FEE976`, fresnel), so it still reads against the glow. Put `label_waiting_friend.png` ("รอเพื่อน...") above the head, bobbing 1.5 cm at 0.5 Hz.
- **You:** `arrow_you.png` ("คุณ" + down arrow) floats 25 cm above your character's head with a squash-stretch bob. Clicking the character (or the arrow) opens customisation.
- **Name plates:** `plate_player_name.png` floats on the rug in front of each guy's feet, or above the head for the standing G2. Draw the name in the plate's `text_region` (see `ui/manifest.json`).

## 6. Lighting (match the photo, then grade)

| Light | Direction | Colour / strength | Notes |
|---|---|---|---|
| **Backdrop spot (the glow)** | From behind/above the camera onto the cyclorama behind the group | Yellow gel, `#FFF07A` → saturated `#FDEF51` | Not a small radial blob: it's a **huge soft-edged disc** (radius ≈ 1.0 × frame width) centred **below the frame** at n(0.49, 1.10). Only its top arc shows, as a halo framing the group. The arc passes n(0.02, 0.23), n(0.20, 0.14), n(0.50, 0.11), n(0.76, 0.12), n(0.96, 0.22). Soft edge ≈ 0.08 W. Inside the disc the brightness climbs to a pale lemon hot spot `#FFF8A0` at n(0.5, 0.45) behind the table. Outside the disc: olive-brown, darker toward the corners |
| **Key** | Camera-left, ≈ 45° left and 35–40° up | Warm white `#FFF2DC`, strong | Faces lit from the front-left. Dense shadows fall right / down-right: the rug right of G4 and under the chairs is crushed to black |
| **Fill** | On-axis from the camera, low | Neutral `#FFF8EE`, ≈ 25 % of the key | Keeps the faces readable, nothing more |
| **Rim / bounce** | From the backdrop (behind) | Yellow `#FEE976` | Yellow spill on hair edges, shoulders and chair tops (the orange chair's back edge glows), plus the sofa's top edge |
| Ambient | Hemisphere | Sky `#FFF3C0`, ground `#3A3A1C` | Low |

**three.js sketch:** the backdrop is a curved plane with an unlit `ShaderMaterial` (shader below) so the glow is exact and doesn't depend on lights.
Key: `DirectionalLight(0xfff2dc, 2.6)` at `(-2.2, 2.4, 0.5)` → target the group centre `(0, 0.8, 2.6)`, with soft shadows (PCFSoft, radius 4).
Fill: `PointLight(0xfff8ee, 0.6)` at the camera. Rim: two `SpotLight(0xfee976, 3)` at `(±1.6, 1.8, 4.2)` pointing at the group.
`HemisphereLight(0xfff3c0, 0x3a3a1c, 0.35)`.
Post: ACES filmic, exposure ≈ 1.1, **strong S-curve** (crushed blacks, clipped whites), saturation +15 %, warm white balance, subtle bloom only on the glow (threshold 0.9), soft vignette, fine grain. That gives the 2000s scanned-print look.

```glsl
// backdrop glow, uv = normalised screen-space of the cover framing (0..1, y down) or the cyclorama's uv
vec3 backdrop(vec2 uv){
  float d   = distance(uv*vec2(1.0,1.0), vec2(0.49, 1.10));      // disc centred below frame
  float disc= 1.0 - smoothstep(0.96, 1.04, d);                    // soft edge, radius ~1.0
  float hot = exp(-pow(distance(uv, vec2(0.50,0.45))/0.42, 2.0)); // lemon hot spot
  vec3 inside  = mix(vec3(0.992,0.937,0.318), vec3(1.0,0.973,0.627), hot); // #FDEF51 -> #FFF8A0
  vec3 edge    = vec3(0.937,0.804,0.463);                         // #EFCD76 at the rim
  inside = mix(edge, inside, smoothstep(1.02, 0.80, d));
  float vig = smoothstep(0.35, 0.85, distance(uv, vec2(0.5,0.55)));
  vec3 outside = mix(vec3(0.533,0.471,0.329), vec3(0.278,0.243,0.157), vig); // #887854 -> #473E28
  return mix(outside, inside, disc);
}
```

## 7. Title lettering (as on the cover)

- **Layout:** two lines, tightly stacked and **staggered**. Line 1 at x 0.18–0.73, y 0.63–0.75 (cap height ≈ 12 % of the frame). Line 2 starts ≈ 10 % further right, at x 0.28–0.85, y 0.75–0.88. The lines touch, so their outlines merge into one sticker. The whole block is ≈ 2.7 : 1.
- **Letterforms:** chunky, rounded, 70s "groovy" bold serif (Cooper-Black-like weight). The first capital of each word has a **curly swash terminal**. Slightly bouncy baseline, very tight letter spacing.
- **Layer stack (outside → in):**
  1. Soft dark drop shadow, down-right ≈ 0.6 % of the frame.
  2. Thin dark outer edge `#1E3314`.
  3. **Thick green band**, ≈ 2 % of the frame width (≈ 10 px at 500 px), mid `#70BB5C`, lit `#88C777`, shadow `#528A43`. The band merges between letters and across lines.
  4. Thin near-black inner keyline `#0F1A0B` (≈ 2 px at 500 px).
  5. Warm-white fill `#FBFDF8`.
- **Subtitle:** "hong ser" in rounded bold lowercase at x 0.38–0.65, y 0.92–0.99. White fill, thin grey-green outline (`#758E5B`, lit `#B6D19C`, shadow `#505C2B`), no inner keyline, small dark shadow.

### Adapting to "เฮียผัด!"
Thai has no capitals and "เฮีย / ผัด!" is only 3–4 glyphs per line. A two-line stack comes out nearly square
(tested), so **use one line**: `public/assets/img/ui/title_hiaphat.png` (1625 × 466, 3.5 : 1).
It's Chonburi (a looped, bubbly 70s-style Thai display face), fattened and rounded, with the exact layer stack above.
- **Place it:** centred at x 0.50, y 0.75. Width ≈ 0.70 of the square cover framing (≈ 39 % of a 16:9 screen width). It covers the legs exactly where the cover's title does.
- **Tagline / subtitle** (the "hong ser" slot): `tagline_roi_baht_sang_tua.png` "ร้อยบาทสร้างตัว" ("building a life from 100 baht") or `subtitle_hiaphat_latin.png` "hia phat!", at x 0.38–0.65, y 0.92–0.98.
- **Alternative title:** `title_hiaphat_alt_noto.png` (Noto Sans Thai Looped Black; cleaner, less bubbly).
- **Animation:** the title drops in with a squash (scaleY 0.8 → 1.1 → 1.0, 450 ms) and a tiny 1° wobble loop. The green band could shimmer once every ~8 s with a moving highlight.

## 8. Where the Host / Join UI goes (same sticker style)
- **Bottom row**, on the rug to the left and right of the tagline, like extra lines of the cover text:
  `btn_host.png` ("สร้างห้อง / HOST") centred at n(0.20, 0.93) and `btn_join.png` ("เข้าร่วม / JOIN") centred at n(0.80, 0.93).
  Each is ≈ 0.22 of the square framing wide. Hover swaps to `*_hover.png` (yellow fill, the backdrop colour) with a 1.06× scale. Press uses `*_pressed.png`.
- **16:9 side bands** (outside the square): put the **room-code plate** `plate_room_code.png` in the right band at title height after hosting (the code goes in its `text_region`), with a "copy" hint. Joining replaces the plate with a text field in the same plate art.
- **Start:** `btn_start.png` ("เริ่มเลย!") appears for the host in place of HOST once ≥ 1 friend has joined. `*_disabled.png` stays until the others are ready.
- **Customise / Quit:** `btn_customize.png` next to the "คุณ" arrow, or just click your guy. `btn_quit.png` small, top-right corner of the screen.
- Keep everything **diegetic-feeling**: no panels or boxes, only the sticker lettering floating over the set, as on the album cover.

## 9. Files delivered for the menu (`public/assets/img/ui/`, see `manifest.json`)
`title_hiaphat.png`, `title_hiaphat_alt_noto.png`, `subtitle_hiaphat_latin.png`, `tagline_roi_baht_sang_tua.png`,
`tagline_tamnan_kaprao.png`, `btn_{host,join,start,customize}{,_hover,_pressed,_disabled}.png`, `btn_quit{,_hover}.png`,
`plate_room_code.png`, `plate_player_name.png`, `arrow_you.png`, `label_waiting_friend.png`, `label_p1..p4.png`.
All are own creations (OFL fonts Chonburi + Noto Sans Thai Looped, rendered by `scripts/research/R4/build_ui.py`).
