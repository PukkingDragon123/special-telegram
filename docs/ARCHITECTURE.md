# เฮียผัด! — Architecture & Agent Handbook

Read `docs/GAME_BRIEF.md` (vision + non-negotiable style rules) and `references/README.md`
(real Thai references) first. This file explains HOW the code works and the RULES for agents.

## 0. Rules for agents (important)

1. **Stay in your folder.** Your code lives in `src/modules/<your-module>/` (auto-loaded). Generated
   assets go in `public/assets/gen/<your-module>/`. Do **not** edit `src/core`, `src/net`, `src/sim`,
   `src/game`, `src/ui3d`, other modules, `package.json`, or shared docs. If you need a core change,
   message the lead (`SendMessage` to `main`) with the exact proposed diff and keep going with a
   local workaround in your module meanwhile.
2. **Never run `git add/commit/push`, `npm install`, or kill other processes.** The lead integrates.
   Several agents share this working tree at the same time.
3. **Shared dev server**: `http://127.0.0.1:5173/` is already running (Vite). If it's down, start your
   own on another port: `npx vite --port 51xx --host 127.0.0.1` and set `HP_URL`.
4. The machine is shared and CPU-bound (software WebGL): run only ONE headless browser at a time, keep quick checks
   small (`HP_W=800 HP_H=450`, `&quality=low`, `&only=<the modules you need>`), save high-quality shots for final checks.
   **Test visually and often**: `node scripts/shot.mjs "<query>" <out.png> <wait> [--eval "<js>"] [--keys "KeyW:800"]`
   then look at the PNG with the Read tool. Headless WebGL is software-rendered (slow): use
   `HP_W=800 HP_H=450` and `&quality=low` for quick checks, high quality for final look checks.
   `window.__hp = { game, engine, Input, Sound, Assets, Overlay }` is available for `--eval`.
   Useful params: `?autostart&skipintro` (straight into the world), `&debug` (anchor markers,
   dev items), `&only=world,characters` (load only these modules), `&skip=ghosts`,
   `&timescale=20` (fast clock), `&quality=low|medium|high|ultra`, multiplayer tests:
   `?host=tabs&autostart` + `?join=CODE&net=tabs` in two pages of the same browser context.
5. `npx tsc --noEmit` must stay clean for your files (non-strict TS).
6. **Client art rules**: ALL art comes from real images found on the internet (packaging, labels,
   signs, posters, food, fabrics…) — never hand-made/faked (only exception: the lazy recipe book).
   ALL Thai text uses LOOPED fonts (ไทยมีหัว) — use `F.*` from `src/core/fonts.ts` only.
   **Quality bar** (from the client): realistic low-poly, textured everything, organic shapes,
   noise shaders for clouds/smoke/steam, static photo faces, no first-person hands, almost no 2D
   UI (diegetic 3D UI only), Thai fonts, polished animation & sound on every interaction, funny.
   Look at the references before building; match them.
7. Performance budget (target 60 fps on a mid PC at `high`): whole frame < ~700 draw calls,
   merge static geometry (`BufferGeometryUtils.mergeGeometries`), instance repeated props
   (`InstancedMesh`), share materials, 512–1024 px textures, no per-frame allocations in hot loops,
   distance-cull / LOD far things, shadows only on things that need them.
8. Bilingual text: Thai first (natural spoken Thai), short English gloss where useful (`tl(th, en)`).
9. Finish with a concise report: what you built, files, how to test, known gaps, any core
   changes you need.

## 1. Layout

```
src/main.ts            boot (fonts → manifests → physics → engine → game → modules → menu)
src/core/              engine (render loop, postFX), input, assets, audio (Sound), fonts (F), rng/noise, proctex
src/net/               transport (local / BroadcastChannel tabs / PeerJS internet), session
src/sim/               state (replicated entities), physics (Rapier)
src/game/              Game hub, contracts, items, interaction, player (FP controller), views, scenes,
                       world-scene, npc mover, clock, mapplan, stubs (placeholder characters/world)
src/ui3d/              text (Thai canvas text), cloud shader, bubbles (say/think/shout/popup/tag), overlay
src/modules/<name>/    FEATURE MODULES (auto-discovered: index.ts must `export default defineModule({...})`)
public/assets/         textures/{pbr,world,food,props,faces,clothing,hair,ghosts,foliage}, img/{signs,labels,
                       newspaper,magazine,recipebook,posters,ui}, audio/, fonts/, hdri/, gen/<module>/
references/            research notes + reference images (look at them!)
```

## 2. Modules

```ts
// src/modules/mything/index.ts
import { defineModule } from '../../game/contracts';
export default defineModule({
  id: 'mything',
  deps: ['characters'],                 // init order
  init(game) { /* every peer, once: define items, views, intents, providers, event handlers, scenes */ },
  async buildWorld(game) { /* every peer, when the gameplay world scene is entered */ },
  hostUpdate(game, dt) { /* HOST only, 30 Hz: simulation */ },
  frame(game, dt) { /* every peer, every frame: visuals */ },
  onNewDay(game, day) { /* HOST, after sleeping */ },
});
```

Register entity visuals with `game.registerView(type, (e, game) => ({ object, update(e, dt), dispose() }))`
(views are created while the world scene is active; they READ state and never write replicated fields).

## 3. State & networking (host-authoritative)

* Everything gameplay-relevant is an **entity** in `game.state`: plain JSON `{ id, t, ...fields }`.
  `game.state.spawn(t, data)` / `despawn(id)` (host only), `get(id)`, `all(t)`, `each(t, fn)`, `find(t, pred)`.
* The HOST mutates entities freely; every 50 ms it diffs and broadcasts. Clients apply.
  `p` `[x,y,z]`, `q` `[x,y,z,w]`, `yaw`, `pitch` go on a quantized fast channel; other fields as JSON.
  Fields starting with `_` are local-only (physics handles, AI scratch). Keep entities small.
* `game.g` is the global entity (id 0): `scene, phase, seed, day, time, paused, freezeTime` (core) + module fields.
* **Intents** (client → host): `game.intent('cook.addOil', {...})`; host handler
  `game.onIntent('cook.addOil', (playerEnt, data, peer) => { ...mutate state... })`.
  On the host, `game.intent` runs the handler immediately (same code path for solo and online).
* **Events** (one-shot, all peers): `game.emit('fx:smoke', data)` → every peer's `game.on('fx:smoke', fn)`.
  Helpers: `game.sfx(key, pos, opts)`, `game.say(entityId, tl('…','…'), opts)`, `game.popup(pos, text)`.
* Each client owns its own player's `p/yaw/pitch/crouch/sel`. Everything else is host-owned.
* Ambient, non-interactive life (crowds walking past, traffic, birds) should be **client-local and
  deterministic** (seeded from `game.g.seed` + `game.g.time`), not entities → zero bandwidth.
* Local-only (non-networked) events: `game.events.on/emit` (e.g. `'world:ready'`, `'day:midnight'` (host),
  `'item:picked'` (host), `'xp'`, `'money'`, `'scene:entered'`).

## 4. Players

Player entity: `{ t:'player', peer, slot 0-3, name, look, p, yaw, pitch, inv:[5 ids|null], sel, wallet,
xp:{cook,prep,serve,clean}, sp, skills:[], mode:'free'|<module modes>, crouch, anim, animT, animLoop }`.
* `game.me` local player entity, `game.players()`, `game.player` = `LocalPlayer` (first-person controller):
  `player.setMode('play'|'external'|'frozen')` — `'external'` gives YOU the camera (`game.camera`) and shows
  the body (skill tree, emotes, cutscenes). `player.teleport(p, yaw)`, `player.pos`, `player.yaw`.
* Play an animation on any rig'd entity (players, npcs): host sets `e.anim='slap'; e.animT=game.g.time+Math.random(); e.animLoop=false`.
* Wallets are separate per player: `game.money(playerId, ±amount, reason, popupAt?)` (host) → false if broke.
* XP: `game.xp(playerId, 'cook'|'prep'|'serve'|'clean', amount)`; skills: `game.hasSkill(pl,'id')`, `game.skillMul(pl,'chop')`.

## 5. Items (`game.items`)

```ts
game.items.define({
  kind: 'pork_minced', name: tl('หมูสับ', 'minced pork'), weight: 0.5, carry: 'hand', tags: ['ingredient','meat'],
  price: 45, data: () => ({ g: 500 }),
  build: (e, game) => object3D,            // textured low-poly, origin at BOTTOM CENTRE
  refresh: (obj, e) => {...},              // e.data changed
  animate: (obj, e, dt) => {...},          // per frame (steam…)
  label: (e) => tl(`หมูสับ ${e.data.g} g`),
  hold: { pos:[0,0,0], rot:[0,-0.5,0], scale:1 },   // first-person held pose tweak
  container: { capacity: 6, accepts: (child, def) => def.tags?.includes('ingredient'), layout: 'pile' },
  fixed: true,     // furniture: no tipping once placed
  slots: 3,        // takes 3 inventory slots (big)
});
```
Host API: `spawn(kind, pos, {data, yaw, in, vel})`, `give(player, kind)`, `remove(e)`, `toWorld(e,pos,vel,yaw)`,
`toContainer(e, c)`, `putInInventory(pl, e)`, `detach(e)`. Queries: `carried(pl)`, `selected(pl)`,
`freeSlots(pl)`, `isOverloaded(pl)`, `weight(pl)`, `speedMul(pl)`, `contents(c)`, `worldPos(e)`, `defOf(e)`.
Built-in intents: `item.pickup {id}`, `item.drop {slot, throw}`, `item.place {slot,pos,yaw}`, `item.put {slot,into}`, `item.take {from}`.
Host events: `item:picked`, `item:dropped`, `item:placed`, `item:put`, `item:snatch {by, from, item}` (social module turns this into the tug-of-war).
Carried items attach to body points automatically (hands → under arms → head → back → mouth), wobble, and the
local player sees only the SELECTED item lower-right (no hands). Quantity stuff (grams in a wok) is module data, not items.

## 6. Interaction (`game.interact`)

```ts
game.interact.register(object3D, { kind: 'stove_knob', eid?: entityId, data: { name: tl('ปุ่มเตา') } });
game.interact.provide((ctx) => {
  // ctx: { game, me, held, hit:{object,mesh,point,normal,dist,kind,eid,ent,data}|null, surface, camera }
  if (ctx.hit?.kind !== 'stove_knob') return;
  return { key: 'E', label: tl('เปิดไฟ', 'turn on'), priority: 5, run: (c) => game.intent('stove.toggle', { id: c.hit.eid }) };
  // hold actions: { key:'LMB', hold:true, run(start), tick(ctx,dt), end(ctx), status: () => '12 g กำลังเท' }
}, order);
```
Keys: `E` interact/pick up · `LMB` use held item on target / place · `RMB` social/alt · `F` read/inspect · `R` secondary.
`Q` drop is handled by the controller. The best action per key wins by `priority`. A small dark tag near the target
shows "title + [E] action" (like the Cooking Simulator "1 g Pouring" label). `status()` overrides the tag title live.

## 7. Characters (`game.chars`, contract in `src/game/contracts.ts`)

`game.chars.create(look) → CharacterRig` (`root, play(anim), setMove(speed), setCarry(pose), setFace(variant),
lookAt(p), attach(point), setSilhouette(on), setFirstPerson(on), setLook(look), update(dt), dispose()`),
`randomLook(archetype, seed)`, `playerLook(slot)`, `catalogue()`. Rigs face **-Z** (same as cameras).
yaw convention everywhere: forward = `(-sin yaw, 0, -cos yaw)`; `yawTo(dx,dz)` in `mapplan.ts`.
**NPC entities** (`t:'npc'`) are drawn by the characters module from these fields:
`{ role, look, p, yaw, anim?, animT?, animLoop?, face?, lookAt?: eid|null, hold?: itemKind|null, name?: TL }` —
the module that spawns an NPC owns its `role` and AI (e.g. `customer`, `shopkeeper:auntie`, `oldman`, `homeless`).
Move NPCs with `game.npcs.go(e, target, { speed, onArrive, face })` (host).

## 8. World (`game.world`, contract `WorldAPI`)

`anchors` (named points — full list + layout in `src/game/mapplan.ts` / `docs/MAP_PLAN.md`), `anchor(name)`,
`zones` + `zoneAt(p)` (price factor & customer traffic per area), `nav.path(from,to)`, `nav.randomPoint(zone)`,
`groundY(x,z)`, `root`, `addNightLight(light)`. The `world` module builds it in `buildWorld` and sets `game.world`;
until then a stub world with the same anchors is used. Static colliders: `game.physics.addBox(center, size, yaw)`.

## 9. 3D UI (`game.ui`) & overlay

* `game.ui.say(anchor, text|tl, {style, duration, sub, voice, tailX})`, `think(...)`, `shout(...)` — organic noise
  bubbles with typewriter reveal + babble blips. `anchor` = Object3D | Vector3 | () => Vector3.
* `game.ui.popup(pos, '+60 ฿', {style})` rising text; `game.ui.tag(anchor, title, sub)` small dark label.
* **Quick choice (mad system / bargaining)**: `game.ui.choose({ options: [tl(..),tl(..),tl(..)], seconds: 3, onPick: (i) => … })`
  — 3 reply bubbles in front of the LOCAL camera with a burning fuse; 1/2/3 or mouse-slide + click; `i = -1` on timeout.
  Local-only UI: send the outcome to the host yourself (`game.intent`). Pair it with `game.ui.shout(npcAnchor, line)`.
* Networked versions: `game.say(eid, ...)`, `game.popup(pos, text)`.
* Canvas text with Thai shaping: `renderText([{text, style}], {pad, scale})`, styles `TS.*`, fonts `F.*`.
* Cloud material: `makeCloudMaterial({style:'speech'|'thought'|'tag'|'shout', ...})`.
* `Overlay` (the only DOM UI): `subtitle(th, en, sec)`, `letterbox(on)`, `fade(to, sec)`, `showHint('[E] …')`,
  `crosshair(on)`. Post FX: `game.engine.post.setLook('thaiDay'|'golden'|'night'|'casino'|'dream'|'album', k)`,
  `post.fade = 0..1`, `post.setDOF(on, dist)`, `post.bloom.intensity`, `engine.timeScale` (slow-mo).

## 10. Audio (`Sound`, keys from `public/assets/audio/manifest.json`)

`Sound.play(key, {pos, vol, pitch, loop})` → handle `{stop(fade), setPos, setVolume, setPitch}`,
`Sound.loop(key, opts)`, `Sound.music(key)`, networked one-shot: `game.sfx(key, pos, opts)`.
Unknown keys only warn. Check the manifest for available keys (`desc` explains each).

## 11. Assets (`Assets`)

`Assets.pbr(id, {repeat, color, roughness})` (library in `textures/pbr/manifest.json`; missing ids fall back to
noise), `Assets.pbrWorld(id)` for metre-UVs, `Assets.texture(path, {srgb, repeat})` (non-blocking),
`Assets.json(path)`, `Assets.image(path)`, `Assets.hdr(path)`. Every folder has a `manifest.json` describing
its files. Procedural helpers: `proceduralTexture(kind, opts)`, `noiseMaterial(color, kind)` (temporary placeholders
only — final art must be real internet images), `normalFromHeight(canvas)`. Record source URLs of shipped files
in `references/credits/*.md`.

## 12. Time

`game.clock`: `time` (hours 6→24), `day`, `label()`, `isNight`, `nightFactor` (0..1), `rush` (customer flow),
`sunDir()`. One day = 20 real minutes (06:00→24:00). Host events: `'clock:hour'`, `'day:midnight'`; `clock.newDay()`.

## 13. Ownership map (who owns what — don't fight over these)

| Thing | Owner module |
|---|---|
| `player` entity, `item` framework, intents `item.*`, `g.scene/phase/seed/day/time/paused` | core |
| `game.chars`, `npc` view, faces/clothing/hair, animations | `characters` |
| `game.world`, map geometry, colliders, nav, sky, sun, day/night lighting, weather, street lights, signs | `world` |
| `cart` entity, kitchen stations, all ingredient/tool/dish item kinds, recipes, cooking sim, recipe book | `cooking` |
| customers (`npc` role `customer`), tables/chairs/umbrella/menu poster/sign kinds, `g.shopOpen`, `g.menu`, `g.reputation`, ratings, dish washing, cleaning, water machine/cups/soda | `restaurant` |
| shops & shopkeepers (`npc` role `shopkeeper:*`), shop stock & hours, buying, bargaining, mad system dialogs, furniture delivery | `shops` |
| `menu` / `customize` scenes, magazine UI, newspaper scene, lobby UI, settings | `menu` |
| `casino` scene, intro sequence in the world (`g.introStep`), old man, cart purchase, dog-eats-food, tutorial objectives | `intro` |
| right-click social (slap/high-five/give money), snatch tug-of-war, skill tree thought cloud, XP levels, `g.unlocks`, day stats, sleeping on cardboard, day transition, save/load | `social` |
| ambient crowds, traffic, stray dog & cat (`dog`/`cat` entities), homeless man, ghosts (`ghost` entities), night events, Thai meme easter eggs, ambience audio zones | `life` |

Item kind prefixes: cooking → ingredients/tools/dishes (`pork_minced`, `wok`, `plate`, `dish`…); restaurant →
`table_*`, `stool_*`, `chair_*`, `umbrella_*`, `menu_poster`, `cup_*`, `soda_*`, `water_dispenser`, `sponge`, `dish_rack`,
`tissue_box`, `trash_bag`; shops → `shopping_basket`, `plastic_bag`; social → `cardboard`; life → `dog_food`, `garland`.
