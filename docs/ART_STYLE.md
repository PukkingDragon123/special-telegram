# เฮียผัด! — ONE art style for every agent

The client, Oct 25: "I hate the lazy blocky assets, I need detailed assets. Make custom assets in a realistic style or download
from Sketchfab, super detailed, with small props too. The map looks bad right now. Make every agent use the same art style,
working on the same thing."

**Everyone builds to this sheet.** If your screenshot doesn't match it, it isn't done.

## 1. The look in one line
**Photo-real indie realism.** Think Chilla's Art (`references/user/ref2_chillas_art_convenience_store.webp`,
`ref3_chillas_art_kotatsu_room.jpg`), Cooking Simulator (`ref1_cooking_simulator_counter.jpg`) and photoscanned Thai
food (`ref5`). Real photo/scan textures on detailed mid-poly models, in a dense, dirty, lived-in Bangkok soi
(`references/streets/web/*.jpg`: look at at least 10 of them before you build anything).

Not: cartoon, flat colour, plastic toy, voxel, "2005 game", boxes with a photo stuck on.

## 2. Hard rules
1. **No visible primitives.** A finished asset is never a raw box, cylinder or plane.
   - Every hard edge is bevelled.
   - Every object has real thickness, a broken-up silhouette and the small parts it has in reality: screws, rims, lips, handles, hinges, feet, cables, labels, seams, welds.
   - A stool has its leg flare, its moulded lip and its drainage hole. A stall has tarp ropes, clamps, bulbs on wires, crates under it, a cash tin and a calendar.
2. **Where models come from** (client, Oct 25: "download assets from Sketchfab from now on, but some Thai assets make it yourself"):
   - **Generic objects come from Sketchfab.** Vehicles, tools, furniture, kitchenware, bins, plants, critters, poles, AC units: anything that exists outside Thailand.
     - Discover with the Sketchfab search API (`https://api.sketchfab.com/v3/search?type=models&q=...&downloadable=true`, no token needed).
     - Download through the official download API when `SKETCHFAB_TOKEN` is set in the environment (`GET https://api.sketchfab.com/v3/models/<uid>/download` with `Authorization: Token $SKETCHFAB_TOKEN`).
     - Otherwise download through the **Objaverse mirror** (Objaverse 1.0 uids are Sketchfab uids): check the uid is in `object-paths.json.gz`, then fetch `https://huggingface.co/datasets/allenai/objaverse/resolve/main/<path>`.
     - **Licences: CC0 / CC-BY / CC-BY-SA only** (no NC, no ND). Credit the author and link in CREDITS and `catalog.json`.
   - **Thai-specific objects are custom-made by us**, because nothing online gets them right. Examples:
     - Thai plastic stools and tables;
     - the รถเข็น food cart and its stainless parts;
     - the ตู้กับข้าว glass food cabinet;
     - the condiment caddy (พริกน้ำปลา, น้ำส้มพริกดอง, chili flakes, sugar);
     - the ศาลพระภูมิ spirit house and its garlands;
     - the โอ่ง water jar;
     - Thai market baskets and woven trays (กระด้ง);
     - Thai signage boxes;
     - Thai electric poles with their wire bundles;
     - Thai shophouse facade parts: folding gates, ventilation blocks, grilles;
     - the พัดไล่แมลงวัน fly-fan;
     - the เขียงมะขาม chopping block;
     - Thai brand bottles and packs.
     Build them with headless Blender (`import bpy`, installed for python3) or in code. Model them from the real reference photos, with bevels, real thickness and every small part, real photo textures, and baked AO and normal maps. Then add them to the library like any other model.
   - Poly Haven models that are already imported may stay. New generic models come from Sketchfab. PBR *materials and textures* (Poly Haven, ambientCG, real photos) are still fine for custom models.
   Never ship an untextured or flat-colour mesh.
3. **PBR everywhere:**
   - albedo + normal + roughness, plus AO and metalness where relevant;
   - texel density about 512 px/m for things within arm's reach and about 256 px/m for architecture;
   - textures 512–1024 (2048 only for hero assets);
   - albedo has no baked light except AO.
4. **Age and grime.** Nothing is clean or new. Use dust in crevices, rust bleeding from bolts, sun-bleached plastic, chipped paint, water stains, fingerprints, grease near cooking, stickers, tape repairs and handwritten notes (looped Thai fonts only).
5. **Micro-detail density** (minimum small props within 3 m):
   - shopfront: ≥ 15;
   - market stall: ≥ 25;
   - cart / cooking station: ≥ 20;
   - table: ≥ 6 (condiment caddy with 4 jars, tissue box, spoon cup, jug, glasses);
   - sidewalk: something every 2–3 m (bins, bags, plants, bikes, crates, cones, cables, puddles, litter).
6. **Real-world scale:** metres; origin at bottom centre; +Z forward.
   Thai sizes: plastic stool 45 cm; folding table 75 cm; shophouse floor 3.2–3.6 m; kerb 15–20 cm; LPG tank 15 kg about 60 cm.
7. **Colour and grade:** sun-bleached but saturated Thai plastics (red, blue, green, pink stools), warm concrete, teal and pastel paint, no pure white or black. Assets must read well under the shared HDRI and sun, and under the `thaiDay` and night grades in `src/core/postfx.ts`.
8. **Physics:**
   - loose small or medium props are dynamic Rapier bodies (convex hull) with real mass and friction;
   - heavy or fixed ones get static colliders;
   - food and soft things use the food juice layer (`src/modules/cooking/juice.ts`).
9. **Performance** (polished, but shippable):
   - triangle budget: props 500–15k tris by size; hero assets up to about 40k;
   - LOD or impostor for far things;
   - InstancedMesh for repeats; shared materials;
   - meshopt-compressed GLB (`npx -y @gltf-transform/cli optimize --compress meshopt --texture-compress webp`) and the three `MeshoptDecoder`;
   - fewer than ~700 draw calls per frame at `high`.
10. **One shared library:**
    - every imported or custom model goes in `public/assets/gen/lib/<category>/<name>.glb`;
    - each one gets an entry in `public/assets/gen/lib/catalog.json`: `{ id, file, category, tags, size_m, tris, license, author, source_url, physics: 'dynamic'|'static'|'none', mass_kg }`;
    - load them through `src/modules/world/lib.ts` (owned by the **assets** agent);
    - **search the catalog before importing anything**, so there are no duplicates and the style stays consistent.
11. **Review loop:**
    - take a screenshot at eye height (1.6 m) and compare it side by side with a real reference photo;
    - if anything looks blocky, clean, empty or toy-like, fix it before reporting;
    - put the reference photo and your screenshot paths in your report.
