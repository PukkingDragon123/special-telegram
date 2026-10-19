# Map plan — ซอยเฮียผัด and surroundings

Canonical data: `src/game/mapplan.ts` (`ANCHORS`, `ZONES`, `MAP_BOUNDS`). Units metres, +X east, **-Z north**.
The world module may refine positions slightly but must keep every anchor name and its meaning.

## Districts (south → north)

1. **South side of the main road (z 26..90)** — row of shophouses (gold shop, clinic, pharmacy), and the big
   **"แม็กโคร่ง" wholesale store** (x 30..110) with a parking lot. Unlocks Day 3. Anchors `wholesale_door`, `wholesale_counter`.
2. **Main road ถนนเจริญผัด (z 6..22)** — 4 lanes + median, x -130..130, constant traffic (motorbikes, tuk-tuks,
   songthaews, buses, pickups), horns, a **pedestrian overpass** at x -45, **bus stop** (`bus_stop`, x -30) and the
   **motorcycle-taxi stand** (`moto_taxi_stand`, x -8) on the north sidewalk (z 2..6). `mainroad_spot` and
   `office_spot` are alternative cart locations (more customers, higher prices).
3. **Soi Hia Phat (x -3.5..3.5, sidewalks to ±6)** running north from the main road to z -158.
   * East side: **8-Twelve** convenience store on the corner (`convenience_store`, `convenience_counter`) →
     a **closed shophouse with an awning and wide apron** where the old man's cart stands (`cart_start`,
     `old_man_spot`, `tables_area` for plastic tables) → **kitchen-equipment shop** (`kitchen_shop`) →
     the **fresh market (ตลาดสด)** shed x 6..50, z -80..-40 (`auntie_stall` just inside the soi entrance,
     `butcher_stall`, `veg_stall`, `egg_stall`; open 05:00–14:00) → older shophouses → temple wall & gate (`temple_gate`).
   * West side: pharmacy/gold shop on the corner → **plastic & furniture shop** (`plastic_shop`) → barber, massage,
     a rival noodle shop, **gas shop** (`gas_shop`, LPG refills) → apartment block (ห้องเช่า) → **vacant lot** with a big
     rain tree, cardboard boxes (`cardboard_pile`, `sleep_spot`), the homeless man (`homeless_spot`) and the stray
     dog's hangout (`dog_home`) → shophouses → **spirit house** under a banyan (`spirit_house`).
   * The players wake up on the west sidewalk (`wake_0..3`, `player_spawn`) looking across at the cart.
4. **Office block (x -70..-6, z -45..6)** — an office tower; office workers flood out for lunch (price factor 1.3).
5. **Canal (z -175..-165)** — murky green คลอง, concrete banks, wooden houses on stilts, a small bridge at x 0 (`canal_bridge`).
6. **Rural edge (z < -180)** — dirt road north from the bridge, rice paddies (W), banana grove + wooden stilt houses (E),
   a roadside stall spot (`rural_spot`, price factor 0.7). Night ghosts: `krasue_spot`, `nang_tani_spot` (banana trees),
   `pret_spot` (temple wall), headless motorcycle rider along the soi `ghost_moto_a` → `ghost_moto_b`.

## Price zones (`ZONES`)
| id | kind | price factor | traffic |
|---|---|---|---|
| soi_south | soi | 1.00 | 1.0 |
| market | market | 0.85 | 1.4 (morning) |
| office | office | 1.30 | 1.2 (lunch) |
| mainroad | mainroad | 1.10 | 1.5 |
| soi_north | soi | 0.95 | 0.6 |
| temple | temple | 0.90 | 0.5 |
| canal | canal | 0.80 | 0.4 |
| rural | rural | 0.70 | 0.35 |
| wholesale | shop | 1.00 | 0.3 |
