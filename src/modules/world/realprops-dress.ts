import { RNG } from '../../core/rng';
import type { ShopCtx } from './shophouse';
import { SW_H, POLES_SOI, POLES_SOI_E, MARKET } from './layout';
import { PLASTIC_COLORS } from './props';
import { RealProps } from './realprops';

/**
 * SOI CLUTTER with real props — the lived-in footpath of the reference photos: LPG cylinders at the
 * gas shop, brooms and dustpans leaning on shop walls, blue water drums, tyre stacks, potted plants
 * in clay and glazed pots on the steps, jerrycans and gallon bottles, cement bags, crates, hand trucks,
 * monobloc chairs where the aunties sit, wet-floor sign at the 8-Twelve, the odd rat by the trash.
 * Everything small is a sleeping physics body (realprops.ts).
 */

type Ctx = ShopCtx & { rng: RNG };
const DRUM_COLS = [0x2a5ab0, 0x1f4f9a, 0x2a7a3a, 0x3a6ac0];
const LPG_COLS = [0xb82a22, 0x2a52a8, 0x2a7a3a, 0x9a9a98, 0xc8a020];
const POT_PLANTS = ['plant_taro', 'plant_taro', 'plant_aloe', 'pot_clay', 'pot_ceramic'];

export function dressSoi(c: Ctx, ok: (x: number, z: number, r?: number) => boolean) {
  const real = c.props.real, rng = c.rng;
  const place = (x: number, z: number, r: number) => { if (!ok(x, z, r) || !real.free(x, z, r)) return false; real.claim(x, z, r); return true; };
  // side: -1 west (wall at x=-6, faces +x), +1 east
  const wallYaw = (side: number) => (side < 0 ? Math.PI / 2 : -Math.PI / 2);   // local -Z → into the wall
  const faceRoad = (side: number) => (side < 0 ? Math.PI / 2 : -Math.PI / 2) + Math.PI;

  // ---------------------------------------------------------------- LPG cylinders outside the gas shop
  const gs = c.anchors.gas_shop?.p;
  if (gs) for (const z0 of [gs[2] - 5.1, gs[2] + 4.6]) {
    for (let k = 0; k < 6; k++) {
      const x = -5.75 + (k % 2) * 0.36, z = z0 + Math.floor(k / 2) * 0.36 * (z0 < gs[2] ? -1 : 1);
      if (!ok(x, z, 0.2)) continue;
      real.add(rng.chance(0.5) ? 'lpg' : 'lpg_small', x, SW_H, z, rng.range(0, 6), { color: rng.pick(LPG_COLS) });
      real.claim(x, z, 0.2);
    }
    if (ok(-5.3, z0, 0.4)) real.add('hand_truck', -5.35, SW_H, z0 + (z0 < gs[2] ? -1.2 : 1.2), wallYaw(-1) + Math.PI, {});
  }

  // ---------------------------------------------------------------- brooms, dustpans & mops leaning on walls and poles
  for (let i = 0; i < 26; i++) {
    const side = rng.chance(0.5) ? -1 : 1, z = rng.range(-150, -3);
    const x = side * (6 - 0.5);
    if (!place(x, z, 0.35)) continue;
    if (rng.chance(0.6)) real.add('broom', x, SW_H, z, wallYaw(side) + rng.range(-0.15, 0.15));
    else real.add('broom_wood', side * 5.84, SW_H, z, wallYaw(side), { rx: -0.28 });
    if (rng.chance(0.6)) real.add('dustpan', side * 5.6, SW_H, z + rng.range(0.25, 0.45), faceRoad(side) + rng.range(-0.4, 0.4));
  }
  for (const [px, pz] of [...POLES_SOI, ...POLES_SOI_E]) {
    if (!rng.chance(0.4) || !ok(px, pz + 0.35, 0.3)) continue;
    const side = px < 0 ? -1 : 1;
    real.add('broom_wood', px + side * 0.05, SW_H, pz + 0.3, 0, { rx: 0.3 * (pz > 0 ? 1 : -1), rz: 0.05 });
  }

  // ---------------------------------------------------------------- blue water drums, tyre stacks, junk corners
  for (let i = 0; i < 18; i++) {
    const side = rng.chance(0.5) ? -1 : 1, z = rng.range(-150, -4), x = side * rng.range(5.45, 5.6);
    if (!place(x, z, 0.4)) continue;
    real.add('drum', x, SW_H, z, rng.range(0, 6), { color: rng.pick(DRUM_COLS) });
    if (rng.chance(0.4) && place(x, z + 0.7, 0.35)) real.add('bucket', x - side * 0.05, SW_H, z + 0.7, rng.range(0, 6), { color: rng.pick(PLASTIC_COLORS) });
  }
  for (let i = 0; i < 9; i++) {
    const side = rng.chance(0.5) ? -1 : 1, z = rng.range(-150, -4), x = side * 5.5;
    if (!place(x, z, 0.4)) continue;
    const n = rng.int(2, 5);
    for (let k = 0; k < n; k++) real.add('tyre', x + rng.range(-0.04, 0.04), SW_H + k * 0.165, z + rng.range(-0.04, 0.04), rng.range(0, 6));
    if (rng.chance(0.5)) real.add('tyre_up', x - side * 0.05, SW_H, z + 0.62, faceRoad(side) + 1.5, { rz: 0.0 });
  }
  // ---------------------------------------------------------------- potted plants on the steps (clusters, like every Thai shop front)
  for (let i = 0; i < 34; i++) {
    const side = rng.chance(0.5) ? -1 : 1, z = rng.range(-150, -3), x = side * rng.range(5.55, 5.8);
    if (!place(x, z, 0.35)) continue;
    const n = rng.int(1, 4);
    for (let k = 0; k < n; k++) {
      const zz = z + k * rng.range(0.35, 0.5);
      if (k && !place(x, zz, 0.25)) break;
      real.add(rng.pick(POT_PLANTS), x + rng.range(-0.08, 0.08), SW_H, zz, rng.range(0, 6), { scale: rng.range(0.85, 1.1) });
    }
  }
  // ---------------------------------------------------------------- containers: jerrycans, gallon bottles, cleaners, cement bags, crates, cardboard
  for (let i = 0; i < 40; i++) {
    const side = rng.chance(0.5) ? -1 : 1, z = rng.range(-150, -3), x = side * rng.range(5.35, 5.8);
    if (!place(x, z, 0.3)) continue;
    const t = rng.int(0, 6);
    if (t === 0) { real.add('jerrycan', x, SW_H, z, rng.range(0, 6), { color: rng.pick([0xc03020, 0x2a62b8, 0xe0b020, 0xe8e4dc]) }); if (rng.chance(0.5)) real.add('jerrycan', x, SW_H, z + 0.32, rng.range(0, 6), { color: 0xc03020 }); }
    else if (t === 1) for (let k = 0; k < rng.int(2, 5); k++) real.add('gallon', x + (k % 2) * 0.17, SW_H, z + Math.floor(k / 2) * 0.15, rng.range(0, 6));
    else if (t === 2) { real.add('cleaner', x, SW_H, z, rng.range(0, 6)); real.add('cleaner', x + 0.05, SW_H, z + 0.12, rng.range(0, 6)); real.add('bucket', x, SW_H, z + 0.35, 0, { color: rng.pick(PLASTIC_COLORS) }); }
    else if (t === 3) { for (let k = 0; k < rng.int(1, 4); k++) real.add('cement', x, SW_H + k * 0.18, z, faceRoad(side) + Math.PI / 2 + rng.range(-0.2, 0.2)); }
    else if (t === 4) { const col = rng.pick(PLASTIC_COLORS); for (let k = 0; k < rng.int(1, 4); k++) real.add(rng.chance(0.7) ? 'crate' : 'tote', x, SW_H + k * 0.254, z, faceRoad(side) + Math.PI / 2 + rng.range(-0.1, 0.1), { color: col }); }
    else if (t === 5) { real.add('cardboard', x, SW_H, z, rng.range(0, 6)); if (rng.chance(0.6)) real.add('cardboard', x, SW_H + 0.335, z, rng.range(0, 6)); }
    else { real.add('wood_crate', x - side * 0.1, SW_H, z, faceRoad(side) + Math.PI / 2); }
  }
  // ---------------------------------------------------------------- where the aunties sit: monobloc chairs and stools by doors
  for (let i = 0; i < 16; i++) {
    const side = rng.chance(0.5) ? -1 : 1, z = rng.range(-150, -3), x = side * rng.range(5.1, 5.5);
    if (!place(x, z, 0.4)) continue;
    const t = rng.int(0, 3);
    if (t === 0) real.add('monobloc', x, SW_H, z, faceRoad(side) + rng.range(-0.6, 0.6), { color: rng.pick([0xf2efe6, 0xe8e4dc, 0x2a62b8, 0xc03020, 0x2a8a4a]) });
    else if (t === 1) real.add('metal_stool', x, SW_H, z, rng.range(0, 6));
    else if (t === 2) real.add('folding_stool', x, SW_H, z, rng.range(0, 6));
    else real.add('thai_stool', x, SW_H, z, rng.range(0, 6), { color: rng.pick(PLASTIC_COLORS) });
  }
  // ---------------------------------------------------------------- big static stuff: utility boxes, hydrants, barriers
  for (const [x, z, id, yaw] of [[-5.6, -36.5, 'utility_box', Math.PI / 2], [5.65, -66.8, 'utility_box', -Math.PI / 2], [-5.55, -118, 'utility_box', Math.PI / 2],
    [4.3, -12.5, 'hydrant', -Math.PI / 2], [-4.3, -61, 'hydrant', Math.PI / 2], [4.3, -126, 'hydrant', -Math.PI / 2]] as [number, number, string, number][]) {
    if (!ok(x, z, 0.4)) continue;
    real.add(id, x, SW_H, z, yaw);
    real.claim(x, z, 0.5);
  }
  // 8-Twelve: wet-floor sign by the door, a mop bucket
  const cs = c.anchors.convenience_store?.p;
  if (cs) { real.add('wet_sign', cs[0] - 1.4, SW_H, cs[2] + 2.2, -Math.PI / 2 + 0.3); real.add('bucket', cs[0] - 1.5, SW_H, cs[2] + 2.8, 0, { color: 0xe0b020 }); }
  // rats near the trash piles at poles (one or two, very small)
  for (const [px, pz] of POLES_SOI.slice(1, 4)) if (ok(px, pz, 0.3)) real.add('rat', px + 0.5, SW_H, pz - 0.6, rng.range(0, 6));
  // market edge: crates & styrofoam boxes stacked outside the shed
  for (let i = 0; i < 10; i++) {
    const x = MARKET.x0 + 0.5 + rng.range(0, 1), z = rng.range(MARKET.z0 + 2, MARKET.z1 - 2);
    if (Math.abs(z + 55) < 4 || !place(x, z, 0.35)) continue;
    if (rng.chance(0.5)) for (let k = 0; k < rng.int(1, 3); k++) real.add('styro_box', x, MARKET.floor + k * 0.31, z, rng.range(-0.2, 0.2));
    else for (let k = 0; k < rng.int(1, 4); k++) real.add('crate', x, MARKET.floor + k * 0.254, z, rng.range(-0.1, 0.1), { color: rng.pick(PLASTIC_COLORS) });
  }
}

/** street-food table setting: condiment caddy, tissue box, spoon cup, jug & glasses (all small physics props) */
export function tableSetting(real: RealProps, x: number, y: number, z: number, yaw: number, rng: RNG, steel = false) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const L = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
  const at = (id: string, lx: number, lz: number, o: any = {}) => { const [px, pz] = L(lx, lz); real.add(id, px, y, pz, yaw + (o.a ?? rng.range(-0.4, 0.4)), o); };
  at('caddy', -0.18 + (steel ? 0.05 : 0), 0.02);
  at('spoon_cup', 0.02, 0.06);
  at('tissue', 0.2, -0.04, { color: rng.pick([0xf4b8c8, 0xe8e4dc, 0x9ad0f0]), a: rng.range(-0.2, 0.2) });
  if (rng.chance(0.6)) { at('jug', 0.28, 0.16, { color: rng.pick([0x2a8a4a, 0xe86a8a, 0x2a62b8]) }); at('glass_cup', 0.12, 0.2); if (rng.chance(0.5)) at('glass_cup', -0.05, 0.22); }
}
