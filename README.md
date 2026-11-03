# เฮียผัด! (Hia Phat!)

A 1–4 player Thai street-food co-op cooking game for the browser (Three.js + Rapier + PeerJS).
Four broke friends lose everything at a casino, wake up on a dirty Thai soi in singlets and shorts,
buy an old man's food cart for exactly 100 baht and grow it into a real อาหารตามสั่ง shop.

## Run

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # production build in dist/
```

Use a desktop browser with a real GPU (Chrome/Edge/Firefox). Quality: `?quality=low|medium|high|ultra` (default high, auto-scales resolution).
Look: realistic PBR with ACES filmic grading by default; the inked anime style (outlines + cel bands + impact frames) is `?look=anime`.

## Controls

| Key | Action |
|---|---|
| WASD / Shift / Ctrl / Space | move / run / crouch / jump |
| Mouse | look (first person, no hands) |
| E | pick up / interact / pay shopkeeper / use an ATM |
| ATM | click the real keys or the screen · 0–9 · Enter · Backspace · Esc (cancel / take your card) |
| E on a person | talk: 3D floating lines, answer with 1–9 or the mouse, Esc to leave |
| B | build mode: wheel rotates 15°, click-hold drags a placed piece, X sells it back (50 %), E picks it up |
| holding furniture | ghost preview (green = fits), LMB place, R / Shift+R rotate 90°, Shift = free placement (no snapping) |
| Q | drop selected item |
| 1–5 / wheel | select inventory slot |
| Left click (hold) | use held item: pour, add ingredient, stir, chop, wash, place |
| Right click on a friend | slap / high-five / give money |
| R | haggle with a shopkeeper |
| F | read the recipe book / ask auntie for credit |
| Tab | Skill Heaven (look up into the sky; click floating skill props to learn) |
| 1 / 2 / 3 | answer in the 3-second mad / bargaining choice |
| Esc | pause |

## Game flow

Main menu (album cover) → customize (magazine) → casino cutscene → wake up on the soi → buy the cart (100 ฿) →
dog eats the food → auntie's market (credit) → cook กะเพราหมูสับ + ไข่ดาว → open the sign → serve customers →
night & ghosts → sleep on cardboard at midnight → newspaper → next day (new recipes, shops unlock by day).
One in-game day (06:00–24:00) lasts 20 real minutes.

## Multiplayer

Host / Join on the main menu: **online** uses PeerJS (WebRTC, share the 5-letter room code); **tabs** works between
tabs of one browser (dev). Multiplayer is implemented but not yet play-tested (single-player first).

## Dev / test URL params

`?autostart&skipintro` straight into the world · `?debug` · `?only=world,characters` · `?skip=life` ·
`?timescale=20` · `?time=22` · `?fly` · `?kitchenlab` · `?restaurantlab` · `?shoplab` · `?lifelab` · `?charlab` ·
`?customize` · `?newspaper` · `?intro=<step>` · `?scene=casino` · `?atm` (spawn at the store ATM) · `?clothlab` (test laundry in front of you) · `?look=anime` ·
`?restaurant=open|full` (shophouse rented, open, furnished / every upgrade) · `?buildlab` (furniture store, day 2, 30,000 ฿) · `?quests=all` · `?quest=<id>` ·
`?ritual=ready|chant|summon|demand|serve` · `?backrooms`.
itch.io build: `npm run build && node scripts/itch-pack.mjs` → `hia-phat-itch.zip` (under 1000 files; assets packed into .pak files).
Headless checks: `node scripts/shot.mjs "<query>" out.png <wait>` and `node scripts/playtest.mjs`.

## Code

`src/core` engine, post-FX, input, assets, audio · `src/net` transports · `src/sim` replicated state + physics ·
`src/game` hub, items, interaction, player, scenes · `src/ui3d` 3D bubbles/text · `src/modules/*` features
(characters, world, cooking, restaurant, shops, menu, intro, social, life, cloth, atm, water, critters, escape). See `docs/ARCHITECTURE.md`,
`docs/GAME_BRIEF.md`, `docs/MAP_PLAN.md`. Asset sources: `CREDITS.md`.

## Progression

Cart → save up (3,000 ฿, or 3.5★, or day 4) → the landlady เจ๊ลำไย rents you the closed shophouse behind the cart
(haggle the deposit, sign the contract, pull up the shutter) → customers eat inside at higher prices → rent every morning,
upgrades (air-con, TV, LED sign, the unit next door). Furniture comes from บ่าวคลาร์ค's furniture store (build mode).
Recipes unlock through side quests (10 of them, givers have a floating "!"), levels, recipe cards and restaurant milestones;
a locked recipe cannot be cooked. Talk to anyone with E. There is also a midnight ritual at the spirit house (ask around).
Code: `src/modules/restaurant` (premises, shop3d), `src/modules/build`, `src/modules/quests` (contract in `api.ts`),
`src/modules/ritual`, `src/modules/backrooms`.

## Cloth & ATM

`src/modules/cloth`: real cloth physics (position-based dynamics + per-triangle aerodynamics, gusty wind, pegs / hangers / ties,
collisions with people and walls). World builders publish laundry lines, hanger rails, tarps and curtains through
`ClothSpots` (`src/modules/cloth/api.ts`). Moving props attach cloth with `registerClothAnchor` (the food cart's ผ้าขาวม้า).
Garments are cut from real pattern outlines and use the real fabric photos in `public/assets/textures/clothing`.

`src/modules/backrooms`: the back room of บ่าวคลาร์ค's furniture store is much bigger than it should be: a seeded,
walkable liminal office maze (damp mono-yellow wallpaper, wet carpet, humming fluorescent panels that flicker), built
far outside the map. The store's back door (anchor `furniture_backdoor`) leads in, the EXIT door in the first room leads
back, and Clark waits at the "returns desk" in the farthest room. `?backrooms` starts inside.

`src/modules/atm`: two street ATMs (fictional banks) with a realistic screen UI. Per-player bank accounts live in `g.atm`
(host-authoritative `atm.op` intent).
