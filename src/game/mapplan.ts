import type { AnchorPt, Zone } from './contracts';

/**
 * MAP PLAN — shared layout every module relies on (docs/MAP_PLAN.md has the prose version).
 * Units: metres. +X = east, -Z = north, +Y = up. Ground ≈ y 0 (sidewalks +0.15, road 0).
 * yaw convention (same as cameras): forward = (-sin yaw, 0, -cos yaw). yaw 0 faces north (-Z),
 * yaw π/2 faces west (-X), yaw -π/2 faces east (+X), yaw π faces south (+Z).
 *
 *            N (-Z)
 *   z -270 ┌───────────── RURAL: rice paddies (W) · banana grove + stilt houses (E) ─────────┐
 *   z -180 ├────────────── CANAL (คลอง) z -175..-165, bridge at x 0 ──────────────────────────┤
 *   z -160 │  spirit house + banyan (W)   │ soi end T-junction │  temple wall & gate (E)     │
 *          │  shophouses                  │                    │  shophouses                 │
 *   z -100 │  vacant lot: rain tree,      │  SOI HIA PHAT      │                             │
 *          │  cardboard, homeless, dog    │  road x -3.5..3.5  │  FRESH MARKET shed          │
 *   z  -60 │  apartment, barber, gas shop │  sidewalks to ±6   │  x 6..50, z -80..-40        │
 *   z  -30 │  plastic & furniture shop    │                    │  kitchen-equipment shop     │
 *   z  -16 │  pharmacy / gold shop        │   [cart_start]     │  closed shophouse + awning  │
 *   z   -2 │  OFFICE TOWER (W of x -20)   │                    │  8-Twelve (corner)          │
 *   z  2-6 │ north sidewalk · bus stop x-30 · moto-taxi stand x-8 · overpass x-45          │
 *   z 6-22 │ MAIN ROAD (4 lanes, median z 14) x -130..130 — heavy traffic                   │
 *   z22-26 │ south sidewalk                                                                  │
 *   z26-90 │ shophouses · clinic · "แม็กโคร่ง" wholesale store x 30..110 + parking           │
 *          └─────────────────────────────────────────────────────────────────────────────────┘
 */
export const MAP_BOUNDS = { minX: -130, maxX: 130, minZ: -270, maxZ: 90 };

export const ANCHORS: Record<string, AnchorPt> = {
  // intro & player
  player_spawn: { p: [-4.6, 0.15, -21], yaw: -Math.PI / 2 },
  wake_0: { p: [-4.7, 0.15, -18.5], yaw: -Math.PI / 2 },
  wake_1: { p: [-4.9, 0.15, -20.3], yaw: -Math.PI / 2 },
  wake_2: { p: [-4.6, 0.15, -22.1], yaw: -Math.PI / 2 },
  wake_3: { p: [-4.9, 0.15, -23.9], yaw: -Math.PI / 2 },
  cart_start: { p: [4.9, 0.15, -23], yaw: Math.PI / 2 },
  old_man_spot: { p: [6.6, 0.15, -25.2], yaw: Math.PI / 2 },
  tables_area: { p: [9.2, 0.15, -23], r: 3.6 },
  item_respawn: { p: [5.5, 0.6, -21] },
  // shops (door/counter positions; shopkeepers stand ~1 m behind)
  auntie_stall: { p: [10.5, 0.15, -55], yaw: -Math.PI / 2 },
  butcher_stall: { p: [16, 0.15, -48], yaw: 0 },
  veg_stall: { p: [16, 0.15, -62], yaw: Math.PI },
  egg_stall: { p: [22, 0.15, -55], yaw: -Math.PI / 2 },
  kitchen_shop: { p: [7.2, 0.15, -35], yaw: -Math.PI / 2 },
  plastic_shop: { p: [-7.2, 0.15, -27], yaw: Math.PI / 2 },
  gas_shop: { p: [-7.2, 0.15, -45], yaw: Math.PI / 2 },
  convenience_store: { p: [7.2, 0.15, -9], yaw: -Math.PI / 2 },
  convenience_counter: { p: [12, 0.15, -10], yaw: -Math.PI / 2 },
  wholesale_door: { p: [40, 0.15, 30], yaw: Math.PI },
  wholesale_counter: { p: [46, 0.15, 40], yaw: Math.PI },
  // life
  sleep_spot: { p: [-10, 0.15, -86], r: 4 },
  cardboard_pile: { p: [-12.5, 0.15, -83.5] },
  homeless_spot: { p: [-7.2, 0.15, -80], yaw: Math.PI / 2 },
  dog_home: { p: [-11, 0.15, -90] },
  cat_spot: { p: [7.5, 0.15, -95] },
  moto_taxi_stand: { p: [-8, 0.15, 1.2], yaw: Math.PI },
  bus_stop: { p: [-30, 0.15, 4], yaw: Math.PI },
  spirit_house: { p: [-8, 0.15, -152] },
  temple_gate: { p: [22, 0.15, -150], yaw: 0 },
  canal_bridge: { p: [0, 0.6, -170] },
  // alternative cart spots (price zones)
  office_spot: { p: [-16, 0.15, 3.8], yaw: Math.PI },
  market_spot: { p: [5.2, 0.15, -52], yaw: Math.PI / 2 },
  mainroad_spot: { p: [12, 0.15, 3.8], yaw: Math.PI },
  rural_spot: { p: [6, 0.05, -200], yaw: Math.PI / 2 },
  // night
  ghost_moto_a: { p: [0, 0, -158] },
  ghost_moto_b: { p: [0, 0, 4] },
  krasue_spot: { p: [30, 0.05, -210] },
  nang_tani_spot: { p: [42, 0.05, -214] },
  pret_spot: { p: [30, 0.15, -153] },
};

export const ZONES: Zone[] = [
  { id: 'soi_south', kind: 'soi', name: { th: 'ปากซอยเฮียผัด', en: 'Soi Hia Phat (mouth)' }, rect: [-6, -100, 6, 2], priceFactor: 1.0, traffic: 1.0 },
  { id: 'market', kind: 'market', name: { th: 'ตลาดสด', en: 'Fresh market' }, rect: [6, -82, 52, -38], priceFactor: 0.85, traffic: 1.4 },
  { id: 'office', kind: 'office', name: { th: 'ย่านออฟฟิศ', en: 'Office block' }, rect: [-70, -45, -6, 6], priceFactor: 1.3, traffic: 1.2 },
  { id: 'mainroad', kind: 'mainroad', name: { th: 'ถนนเจริญผัด', en: 'Charoen Phat Road' }, rect: [-130, 2, 130, 26], priceFactor: 1.1, traffic: 1.5 },
  { id: 'soi_north', kind: 'soi', name: { th: 'ท้ายซอย', en: 'Back of the soi' }, rect: [-6, -160, 6, -100], priceFactor: 0.95, traffic: 0.6 },
  { id: 'temple', kind: 'temple', name: { th: 'หน้าวัด', en: 'Temple front' }, rect: [6, -160, 90, -140], priceFactor: 0.9, traffic: 0.5 },
  { id: 'canal', kind: 'canal', name: { th: 'ริมคลอง', en: 'Canal side' }, rect: [-130, -180, 130, -160], priceFactor: 0.8, traffic: 0.4 },
  { id: 'rural', kind: 'rural', name: { th: 'ทุ่งนาหลังคลอง', en: 'Rice fields' }, rect: [-130, -270, 130, -180], priceFactor: 0.7, traffic: 0.35 },
  { id: 'wholesale', kind: 'shop', name: { th: 'แม็กโคร่ง', en: 'Makrong wholesale' }, rect: [26, 26, 115, 85], priceFactor: 1.0, traffic: 0.3 },
];

export function zoneAt(p: ArrayLike<number>): Zone | null {
  // most specific (smallest) zone wins
  let best: Zone | null = null, area = Infinity;
  for (const z of ZONES) {
    const [a, b, c, d] = z.rect;
    if (p[0] >= a && p[0] <= c && p[2] >= b && p[2] <= d) {
      const ar = (c - a) * (d - b);
      if (ar < area) { area = ar; best = z; }
    }
  }
  return best;
}

/** yaw that faces from (x,z) toward direction (dx,dz). */
export const yawTo = (dx: number, dz: number) => Math.atan2(-dx, -dz);
