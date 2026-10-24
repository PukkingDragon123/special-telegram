# UI references: casino intro, diegetic paper kits

Files in this folder:
- `ALBUM_COVER_BREAKDOWN.md`: main-menu 3D recreation of ref4 (camera, poses, palette, light, lettering, Host/Join placement).
- `album_cover_blocking.png`: my own schematic of the cover. `album_cover_palette.png`: sampled colours.
- `web/newspaper/`: real Thai tabloid fronts (Commons PD scans of Thai Rath 1968–69, a 2015 Krabi newsstand photo). Look only.
- `web/magazine/`: Thai magazine and street-snap references (Flickr). Look only.
- `web/casino/`: casino interiors (Flickr). Look only.
- `_raw/`: source photos and material scans used to build the shipped kits (git-ignored; sources in `references/credits/R4-culture-ui.md`).

---

## 1. Casino references (intro cutscene)

| File (`web/casino/`) | What it shows | Take from it |
|---|---|---|
| `flickr_489009374`, `flickr_4314744355`, `flickr_3214700889`, `flickr_2573114250` | **Poipet** border casinos (Thai–Cambodian border): gaudy façades, gold columns, neon, cheap-luxury interiors | The setting. A Thai gambler's casino is a *border* casino: tacky gold, red carpet, cigarette haze, fluorescent + chandelier mix |
| `flickr_43427189780`, `flickr_274697557` | European grand-casino interiors: domed ceilings, huge crystal chandeliers | Chandelier shapes; warm 2700 K pools of light |
| `flickr_9396537891` (CC BY 4.0), `flickr_6755953879`, `flickr_20892267173` | **Baccarat** tables, green baize, Macau-style rows of tables | Baccarat is *the* game in Asian casinos. Green felt, PLAYER / BANKER boxes, chip stacks, card shoe |
| `flickr_6927605542` | Roulette table + wheel | Slow-motion ball-spin hero shot |
| `flickr_4558733597`, `flickr_5360649706`, `flickr_3464736201` | Slot-machine banks, lights, "777" reels | Background bokeh, flashing light rhythm, coin-spill gag |
| `flickr_45211519171`, `flickr_540389722`, `flickr_3107381797` | Macau Venetian / Lisboa: painted ceilings, gold-and-red, carpets with loud patterns | Carpet pattern (busy red/gold swirl), ceiling gold |

### Lighting & colour notes
- **Palette:** blood-red carpet `#7A0E14`–`#A3161C`, gold trim `#C8962E` (hi `#F2D27A`), baize green `#0F5B3A` (lit `#1F7A4E`), black lacquer `#0B0B0D`, warm skin highlights.
- **Light:** many small warm sources (2700–3200 K). Chandeliers give soft overhead pools; table lamps hang low over each table (a bright felt rectangle, dark surroundings). Slot banks add coloured rim light (magenta / cyan / amber) flickering at 2–6 Hz.
- **Atmosphere:** visible haze or cigarette smoke (volumetric fog, density 0.02), bloom on chandeliers and slot lights, slight orange-magenta grade, crushed blacks. Border casinos feel **too bright and too tacky**: lean into gold and glitter.
- **Props:** chip stacks in red / blue / green / black, plastic playing cards, the baccarat score board (big roads of red and blue circles), cocktail glasses, beer bottles (no real brands: green "ช้างเผือก" parody or plain labels), champagne bucket, wine glasses, cash bricks of 1000-baht-looking notes (parody: make them clearly not real currency).

## 2. Shot list: "รวยแป๊บเดียว" (slow-motion casino → blackout → wake-up)
Total ≈ 55–65 s, skippable after first view. Music: lounge-y luk thung with brass that slows down (pitch-down) as luck turns. All four guys wear cheap shiny suits (one too big, one too small, one powder-blue, one gold).

| # | Shot | Camera | Action | Sound | Length |
|---|---|---|---|---|---|
| 1 | Establishing: border casino entrance at night | Low, wide, slow push-in under a gaudy gold arch; neon sign "คาสิโนโชคดีมีชัย" (parody) | The 4 guys step out of a tuk-tuk in suits, adjust ties in sync | Tuk-tuk putter, then casino doors open: wave of noise | 4 s |
| 2 | Red-carpet walk | Dolly back in front of them, 48 fps → slow-mo | They strut; one trips on the carpet, the others pretend not to know him | Brass sting | 4 s |
| 3 | Baccarat table | Overhead top-down on green felt | Chips pushed onto **BANKER**; a card is flipped in extreme slow-mo with dealer squeeze | Heartbeat, held breath | 5 s |
| 4 | WIN | Whip-pan to faces (static photo faces, so the *bodies* overact: arms up, jumping, a hat flies off) | Chips rain; one guy kisses a chip | Crowd "เฮ้!!", coins | 3 s |
| 5 | Celebration montage (slow-mo, 4 cuts) | Handheld orbit | Beer shower (parody bottles), wine glasses clink and shatter, a guy dances on a chair, cash fanned like a peacock | Music peaks | 8 s |
| 6 | Roulette all-in | Macro on the wheel, ball bouncing in slow-mo | Every chip pushed onto one number. The ball hesitates on their number... and rolls one slot over | Music grinds to a halt (tape-stop) | 6 s |
| 7 | Lose everything | Wide, static | Security escorts them out by the collars; one still holds an empty champagne bottle | "ขอบคุณที่ใช้บริการค่ะ" | 5 s |
| 8 | Drunk stumble outside | POV from player 1, double vision (shader: offset + blur), horizon tilting | Neon smears, friends' faces swim | Muffled music, hiccup | 5 s |
| 9 | Blackout | Eyelids close (two black noise-edged shapes meet), 1.5 s of black | — | Silence, then a rooster crows | 3 s |
| 10 | Wake up on the street | First-person, eyes open (blurry, then focus); morning haze; they're in **singlets and shorts** on cardboard by a gutter | A stray dog sniffs their face; a motorbike honks past | City wake-up: horns, a sweeping broom, the ice-cream bell far away, a radio | 6 s |
| 11 | Realisation | Third-person wide, the 4 sit up in a row | Pockets turned out: coins only. Thought cloud over one: a fbm-noise cloud with "หมดตัว..." | — | 4 s |
| 12 | The cart | Over-the-shoulder | An unattended food cart, the hero object, glints in the sun ("ting!") | — | 2 s |
| → | Gameplay starts | Control handed over; objective text in a speech bubble | "จะเอายังไงกันดี" | | |

**Style rules for the intro:** keep it physical (no 2D cards). Text is diegetic: neon signs, the casino board, thought clouds.
Slow motion uses time-scale 0.25 on physics plus motion-blur post. Faces stay static (Chilla's Art rule), so all the comedy comes from body animation and props.

## 3. Diegetic paper kits (shipped in `public/assets/img/`)
| Kit | Folder | Read first |
|---|---|---|
| ไทยรั่ว tabloid (newspaper / day summary) | `newspaper/` | `layout.json`: regions for dynamic headline, deck, body, stats, photos, lottery number, date (พ.ศ.). Examples: `front_example_*.jpg` |
| ซอยเก๋ street-fashion magazine (customisation UI) | `magazine/` | `layout.json`: per-spread item slots (render / name / price / sticker anchor / hit), polaroid window for the live player render, sticky-note tab hit areas |
| Old man's recipe notebook | `recipebook/` | `manifest.json`: per page dish, steps and ingredients with grams; full recipe data in `recipes` |
| Menu posters + community posters + 8-Twelve promos | `posters/` | `manifest.json`: price-slot regions for the 3 menus |
| Main-menu lettering (album-cover style) | `ui/` | `manifest.json` + `ALBUM_COVER_BREAKDOWN.md` §7–9 |

Client rules applied: **looped Thai fonts only** (Noto Sans Thai Looped variable, Sarabun, Taviraj, Trirong, Chonburi, Charmonman, Srisakdi; handwriting Sriracha / Itim / Mali).
Photos are **real photos** from the internet (sources in each manifest and in `references/credits/R4-culture-ui.md`), printed through a simulated halftone / photocopy / lamination process.
The recipe book alone is deliberately lazy hand-drawn art.
