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

## Controls

| Key | Action |
|---|---|
| WASD / Shift / Ctrl / Space | move / run / crouch / jump |
| Mouse | look (first person, no hands) |
| E | pick up / interact / pay shopkeeper |
| Q | drop selected item |
| 1–5 / wheel | select inventory slot |
| Left click (hold) | use held item: pour, add ingredient, stir, chop, wash, place |
| Right click on a friend | slap / high-five / give money |
| R | haggle with a shopkeeper |
| F | read the recipe book / ask auntie for credit |
| Tab | think (skill tree thought cloud) |
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
`?customize` · `?newspaper` · `?intro=<step>` · `?scene=casino`.
itch.io build: `npm run build && node scripts/itch-pack.mjs` → `hia-phat-itch.zip` (under 1000 files; assets packed into .pak files).
Headless checks: `node scripts/shot.mjs "<query>" out.png <wait>` and `node scripts/playtest.mjs`.

## Code

`src/core` engine, post-FX, input, assets, audio · `src/net` transports · `src/sim` replicated state + physics ·
`src/game` hub, items, interaction, player, scenes · `src/ui3d` 3D bubbles/text · `src/modules/*` features
(characters, world, cooking, restaurant, shops, menu, intro, social, life). See `docs/ARCHITECTURE.md`,
`docs/GAME_BRIEF.md`, `docs/MAP_PLAN.md`. Asset sources: `CREDITS.md`.
