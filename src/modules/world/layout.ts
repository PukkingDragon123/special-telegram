/**
 * LAYOUT — every street, sidewalk, frontage row and special lot of the map, derived from
 * src/game/mapplan.ts (anchors are kept exactly). Units metres, +X east, -Z north.
 */

export const SW_H = 0.15;          // sidewalk / shop floor height
export const MEDIAN_H = 0.22;

// ---------------------------------------------------------------- streets
export const SOI = { x0: -3.5, x1: 3.5, zN: -158, zS: 6, swW: 2.5 };              // soi road + sidewalks to ±6
export const MAIN = { x0: -130, x1: 130, z0: 6, z1: 22, med0: 13.25, med1: 14.75, swN0: 0, swS1: 26 }; // 4 lanes + median
export const CROAD = { z0: -162, z1: -158, sw0: -158, sw1: -155.5 };            // canal-side road (E-W) + its south sidewalk
export const CANAL = { zS: -165, zN: -175, water: -1.25, bed: -2.6, bankS: -162, bankN: -179 };
export const BRIDGE = { x0: -3.2, x1: 3.2, zS: -161.5, zN: -178.5, peak: 0.6 };
export const RROAD = { x0: -3, x1: 3, zS: -178.5, zN: -268 };                    // rural dirt road
export const RURAL_Y = 0.05;

/** The zebra crossings (x range or z range + position). */
export const ZEBRAS = [
  { axis: 'x' as const, at: -11.5, from: MAIN.z0, to: MAIN.z1, w: 4 },   // across the main road, west of the soi mouth
  { axis: 'z' as const, at: -20.5, from: SOI.x0, to: SOI.x1, w: 3 },     // across the soi near the cart (wake → cart)
  { axis: 'z' as const, at: -57, from: SOI.x0, to: SOI.x1, w: 3 },       // market entrance
  { axis: 'z' as const, at: -150, from: SOI.x0, to: SOI.x1, w: 3 },      // temple / spirit house
];

// ---------------------------------------------------------------- frontage rows
export type Face = 'E' | 'W' | 'N' | 'S';
export type GroundType = 'open' | 'shutter' | 'half' | 'gate' | 'closed' | 'eatery';

export interface UnitSpec {
  face: Face;
  /** frontage line coordinate (x for E/W facing rows, z for N/S facing rows) */
  line: number;
  /** range along the street axis */
  a0: number; a1: number;
  depth?: number;
  storeys?: number;
  shop?: string;           // interior / dressing preset
  ground?: GroundType;
  seed?: number;
  /** extra flags */
  corner?: 'left' | 'right';   // the end wall is a street facade
  tint?: number;
  noSign?: boolean;
  sign?: string;               // preferred sign category
  awning?: 'corr' | 'tarp' | 'none' | 'big';
  name?: string;
  far?: boolean;               // background row (lower detail)
}

const R = (face: Face, line: number, start: number, widths: (number | [number, Partial<UnitSpec>])[], dir: 1 | -1, base: Partial<UnitSpec> = {}): UnitSpec[] => {
  const out: UnitSpec[] = [];
  let a = start;
  for (const w of widths) {
    const ww = Array.isArray(w) ? w[0] : w;
    const extra = Array.isArray(w) ? w[1] : {};
    const a1 = a + ww * dir;
    if (!extra.name || extra.name !== 'gap') out.push({ face, line, a0: Math.min(a, a1), a1: Math.max(a, a1), ...base, ...extra });
    a = a1;
  }
  return out;
};

/** West side of the soi: facade faces EAST along x = -6, listed south → north. */
export const ROW_SOI_W: UnitSpec[] = R('E', -6, 0, [
  [4.5, { shop: 'gold', ground: 'open', corner: 'left', storeys: 4, name: 'gold_shop', sign: 'gold' }],
  [4.5, { shop: 'pharmacy', ground: 'open', storeys: 4, name: 'pharmacy', sign: 'pharmacy' }],
  [4.0, { shop: 'phone', ground: 'open', storeys: 3 }],
  [4.0, { shop: 'residence', ground: 'gate', storeys: 3 }],
  [4.0, { shop: 'eatery', ground: 'eatery', storeys: 3, sign: 'food' }],
  [4.0, { shop: 'plastic', ground: 'open', storeys: 3, name: 'plastic_shop', sign: 'plastic' }],
  [4.0, { shop: 'plastic', ground: 'open', storeys: 3, noSign: true }],
  [4.0, { shop: 'plastic', ground: 'open', storeys: 3, noSign: true }],
  [4.0, { shop: 'barber', ground: 'open', storeys: 3, sign: 'barber' }],
  [4.0, { shop: 'massage', ground: 'open', storeys: 4, sign: 'massage' }],
  [4.0, { shop: 'gas', ground: 'open', storeys: 3, name: 'gas_shop', sign: 'gas' }],
  [4.0, { shop: 'gas', ground: 'open', storeys: 3, noSign: true }],
  [4.0, { shop: 'noodle', ground: 'eatery', storeys: 3, name: 'rival_noodle', sign: 'food' }],
  [2.0, { name: 'gap' }],
], -1, { depth: 14 });

export const APARTMENT = { x0: -24, x1: -6, z0: -75, z1: -55, storeys: 6 };
export const LOT = { x0: -32, x1: -6, z0: -98, z1: -75 };       // vacant lot (rain tree, cardboard, homeless)
export const ROW_SOI_W2: UnitSpec[] = R('E', -6, -98, [
  [4.0, { shop: 'grocery', ground: 'open', storeys: 3, sign: 'grocery' }],
  [4.0, { shop: 'residence', ground: 'shutter', storeys: 3 }],
  [4.0, { shop: 'repair', ground: 'open', storeys: 3, sign: 'repair' }],
  [4.0, { shop: 'repair', ground: 'open', storeys: 3, noSign: true }],
  [4.0, { shop: 'residence', ground: 'gate', storeys: 2 }],
  [4.0, { shop: 'laundry', ground: 'open', storeys: 3 }],
  [4.0, { shop: 'closed', ground: 'shutter', storeys: 4 }],
  [4.0, { shop: 'salon', ground: 'open', storeys: 3, sign: 'salon' }],
  [4.0, { shop: 'residence', ground: 'half', storeys: 3 }],
  [4.0, { shop: 'eatery', ground: 'eatery', storeys: 3, sign: 'food' }],
  [4.0, { shop: 'closed', ground: 'shutter', storeys: 3 }],
  [4.0, { shop: 'residence', ground: 'gate', storeys: 3, corner: 'right' }],
], -1, { depth: 13 });
export const SPIRIT_LOT = { x0: -20, x1: -6, z0: -158, z1: -146 };

/** East side of the soi: facade faces WEST along x = +6. */
export const SEVEN = { x0: 6, x1: 20, z0: -15, z1: 0 };              // 8-Twelve corner store
export const CLOSED_HOUSE = { x0: 13.4, x1: 27, z0: -30.5, z1: -15, apronX: 6 };
export const ROW_SOI_E1: UnitSpec[] = R('W', 6, -30.5, [
  [4.0, { shop: 'kitchen', ground: 'open', storeys: 3, name: 'kitchen_shop', sign: 'kitchen' }],
  [4.0, { shop: 'kitchen', ground: 'open', storeys: 3, noSign: true }],
  [1.5, { name: 'gap' }],
], -1, { depth: 14 });
export const MARKET = { x0: 6, x1: 50, z0: -80, z1: -40, floor: 0.15, roofY: 6.2 };
export const ROW_SOI_E2: UnitSpec[] = R('W', 6, -82, [
  [4.0, { shop: 'hardware', ground: 'open', storeys: 3, sign: 'hardware' }],
  [4.0, { shop: 'hardware', ground: 'open', storeys: 3, noSign: true }],
  [4.0, { shop: 'residence', ground: 'gate', storeys: 3 }],
  [4.0, { shop: 'closed', ground: 'shutter', storeys: 3 }],
  [4.0, { shop: 'grocery', ground: 'open', storeys: 4, sign: 'grocery' }],
  [4.0, { shop: 'eatery', ground: 'eatery', storeys: 3, sign: 'food' }],
  [4.0, { shop: 'residence', ground: 'half', storeys: 3 }],
  [4.0, { shop: 'print', ground: 'open', storeys: 3 }],
  [4.0, { shop: 'closed', ground: 'shutter', storeys: 2 }],
  [4.0, { shop: 'residence', ground: 'gate', storeys: 3 }],
  [4.0, { shop: 'coffee', ground: 'open', storeys: 3, sign: 'coffee' }],
  [4.0, { shop: 'residence', ground: 'shutter', storeys: 4 }],
  [4.0, { shop: 'closed', ground: 'shutter', storeys: 3 }],
  [4.0, { shop: 'residence', ground: 'gate', storeys: 3, corner: 'left' }],
], -1, { depth: 13 });
export const TEMPLE = { x0: 6, x1: 90, z0: -150, z1: -95, gateX: 22, forecourtZ: -158 };

/** North side of the main road (facade faces SOUTH along z = 0). */
export const OFFICE = { x0: -62, x1: -28, z0: -40, z1: -9, plazaX0: -66, plazaX1: -22, storeys: 18 };
export const ROW_MAIN_NW: UnitSpec[] = R('S', 0, -66, [
  4.2, 4.2, [4.2, { shop: 'eatery', ground: 'eatery' }], 4.2, [4.2, { shop: 'closed', ground: 'shutter' }], 4.5, 4.5, 4.2,
  [4.2, { shop: 'eatery', ground: 'eatery' }], 4.2, 4.2, 4.5, 4.5, 4.2, [4.2, { shop: 'closed', ground: 'shutter' }], 4.0,
], -1, { depth: 14 });
export const ROW_MAIN_NE: UnitSpec[] = R('S', 0, 20, [
  [4.2, { shop: 'hardware', ground: 'open' }], 4.2, 4.2, [4.5, { shop: 'eatery', ground: 'eatery' }], 4.5, 4.2, [4.2, { shop: 'closed', ground: 'shutter' }],
  4.2, [4.5, { shop: 'gold', ground: 'open', sign: 'gold' }], 4.5, 4.2, 4.2, [4.2, { shop: 'eatery', ground: 'eatery' }], 4.2, 4.5, 4.5, 4.2, 4.2, 4.2,
  [4.2, { shop: 'closed', ground: 'shutter' }], 4.5, 4.5, 4.2, 4.2, 4.2, 4.2,
], 1, { depth: 14 });

/** South side of the main road (facade faces NORTH along z = 26). */
export const WHOLESALE = { x0: 30, x1: 80, z0: 30.5, z1: 82, doorX: 40, parkX0: 82, parkX1: 112 };
export const ROW_MAIN_S: UnitSpec[] = R('N', 26, -130, [
  4.2, 4.2, 4.5, [4.5, { shop: 'eatery', ground: 'eatery' }], 4.2, 4.2, [4.2, { shop: 'closed', ground: 'shutter' }], 4.5, 4.5, 4.2,
  [4.2, { shop: 'clinic', ground: 'open', sign: 'clinic' }], 4.2, 4.5, [4.5, { shop: 'gold', ground: 'open', sign: 'gold' }], 4.2, 4.2, 4.2,
  [4.2, { shop: 'pharmacy', ground: 'open', sign: 'pharmacy' }], 4.5, 4.5, 4.2, [4.2, { shop: 'eatery', ground: 'eatery' }], 4.2, 4.2,
  4.5, 4.5, 4.2, 4.2, [4.2, { shop: 'closed', ground: 'shutter' }], 4.2, 4.5, 4.5, 4.2, 4.2, [4.2, { shop: 'eatery', ground: 'eatery' }], 4.2, 4.2, 4.0,
], 1, { depth: 14 });
export const ROW_MAIN_S2: UnitSpec[] = R('N', 26, 113, [4.2, 4.2, 4.3, 4.3], 1, { depth: 14 });

/** Canal road south side (facade faces NORTH along z = -155.5). */
export const ROW_CANAL_W: UnitSpec[] = R('N', -155.5, -20, [
  4.2, [4.2, { shop: 'eatery', ground: 'eatery' }], 4.2, [4.2, { shop: 'closed', ground: 'shutter' }], 4.5, 4.5, 4.2, 4.2, 4.2, [4.2, { shop: 'grocery', ground: 'open' }],
  4.5, 4.5, 4.2, 4.2, [4.2, { shop: 'closed', ground: 'shutter' }], 4.2, 4.2, 4.5, 4.5, 4.2, 4.2, 4.2, 4.2, 4.2, 4.2,
], -1, { depth: 12, storeys: 3 });
export const ROW_CANAL_E: UnitSpec[] = R('N', -155.5, 90, [4.2, 4.2, [4.5, { shop: 'eatery', ground: 'eatery' }], 4.5, 4.2, 4.2, 4.2, 4.2, 4.2], 1, { depth: 12, storeys: 3 });

/** All street-facing shophouse rows. */
export const ROWS: UnitSpec[][] = [ROW_SOI_W, ROW_SOI_W2, ROW_SOI_E1, ROW_SOI_E2, ROW_MAIN_NW, ROW_MAIN_NE, ROW_MAIN_S, ROW_MAIN_S2, ROW_CANAL_W, ROW_CANAL_E];

// ---------------------------------------------------------------- utility poles (one side of each street)
export interface PoleLine { pts: [number, number][]; side: string }
/** soi poles on the west sidewalk edge near the curb, main road on both sidewalks */
export const POLES_SOI: [number, number][] = [];
for (let z = -4; z >= -156; z -= 31) POLES_SOI.push([-3.95, z]);
export const POLES_SOI_E: [number, number][] = [];
for (let z = -18; z >= -150; z -= 33) POLES_SOI_E.push([3.95, z]);
export const POLES_MAIN_N: [number, number][] = [];
for (let x = -126; x <= 128; x += 34) POLES_MAIN_N.push([x, 5.55]);
export const POLES_MAIN_S: [number, number][] = [];
for (let x = -120; x <= 128; x += 36) POLES_MAIN_S.push([x, 22.45]);
export const POLES_CANAL: [number, number][] = [];
for (let x = -124; x <= 126; x += 32) POLES_CANAL.push([x, -157.6]);
export const POLES_RURAL: [number, number][] = [];
for (let z = -186; z >= -266; z -= 30) POLES_RURAL.push([3.6, z]);

// ---------------------------------------------------------------- ground height (walkable surface)
export interface GroundRect { x0: number; z0: number; x1: number; z1: number; y: number }
export const GROUND_RECTS: GroundRect[] = [];
const G = (x0: number, z0: number, x1: number, z1: number, y: number) => GROUND_RECTS.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), y });
// main road sidewalks
G(MAIN.x0, MAIN.swN0, SOI.x0, MAIN.z0, SW_H);
G(SOI.x1, MAIN.swN0, MAIN.x1, MAIN.z0, SW_H);
G(MAIN.x0, MAIN.z1, MAIN.x1, MAIN.swS1, SW_H);
G(MAIN.x0, MAIN.med0, MAIN.x1, MAIN.med1, MEDIAN_H);
// soi sidewalks
G(-6, SOI.zN, SOI.x0, MAIN.swN0, SW_H);
G(SOI.x1, SOI.zN, 6, MAIN.swN0, SW_H);
// canal road south sidewalk (west & east of the soi)
G(MAIN.x0, CROAD.sw0, SOI.x0, CROAD.sw1, SW_H);
G(SOI.x1, CROAD.sw0, MAIN.x1, CROAD.sw1, SW_H);
// canal bank walk (south bank)
G(MAIN.x0, CANAL.zS, BRIDGE.x0, CROAD.z0, SW_H);
G(BRIDGE.x1, CANAL.zS, MAIN.x1, CROAD.z0, SW_H);
// lots & plazas
G(SEVEN.x0, SEVEN.z0, SEVEN.x1, SEVEN.z1, SW_H);
G(CLOSED_HOUSE.apronX, CLOSED_HOUSE.z0, CLOSED_HOUSE.x0, CLOSED_HOUSE.z1, SW_H);
G(MARKET.x0, MARKET.z0, MARKET.x1, MARKET.z1, MARKET.floor);
G(LOT.x0, LOT.z0, LOT.x1, LOT.z1, SW_H);
G(SPIRIT_LOT.x0, SPIRIT_LOT.z0, SPIRIT_LOT.x1, SPIRIT_LOT.z1, SW_H);
G(TEMPLE.x0, TEMPLE.forecourtZ, TEMPLE.x1, TEMPLE.z0, SW_H);
G(OFFICE.plazaX0, OFFICE.z1, OFFICE.plazaX1, MAIN.swN0, SW_H);
G(WHOLESALE.x0 - 4, MAIN.swS1, WHOLESALE.x1, WHOLESALE.z0 + 14, SW_H);
// rural ground
G(MAIN.x0, -270, MAIN.x1, CANAL.bankN, RURAL_Y);

export function inRect(x: number, z: number, r: { x0: number; z0: number; x1: number; z1: number }) {
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
}

/** analytic ground height (walkable surface) consistent with the built geometry */
export function groundHeight(x: number, z: number): number {
  // bridge
  if (x >= BRIDGE.x0 && x <= BRIDGE.x1 && z <= BRIDGE.zS && z >= BRIDGE.zN) {
    const t = (z - BRIDGE.zS) / (BRIDGE.zN - BRIDGE.zS); // 0..1
    const e0 = 0, e1 = RURAL_Y;
    return e0 + (e1 - e0) * t + BRIDGE.peak * Math.sin(Math.PI * t);
  }
  // canal water / bed
  if (z < CANAL.zS && z > CANAL.zN) return CANAL.water;
  let y = 0;
  for (const r of GROUND_RECTS) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1 && r.y > y) y = r.y;
  // rice paddies sit a bit lower (water)
  if (z < CANAL.bankN && x < -6 && x > -128 && z > -262) {
    const px = ((x + 128) % 26), pz = ((-z - 182) % 22);
    const dike = px < 1.2 || pz < 1.2;
    return dike ? 0.16 : -0.12;
  }
  return y;
}
