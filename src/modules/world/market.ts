import * as THREE from 'three';
import { RNG } from '../../core/rng';
import { WB, ALL, SIDES, PX, NX, PY, NY, PZ, NZ } from './geo';
import type { ShopCtx } from './shophouse';
import type { FoliageSys } from './foliage';
import { flat, groundDecal } from './streets';
import { PLASTIC_COLORS } from './props';
import { EMIS } from './mats';
import { MARKET } from './layout';
import { WindCloth, dressMarketStalls, PileBatch, KIND_PILE, SeafoodBatch } from './realprops-market';

/**
 * FRESH MARKET (ตลาดสด) — steel-post shed with corrugated gable roofs + fibreglass skylights,
 * trusses, hanging fluorescent tubes, wet concrete floor with drains and puddles, decorative stalls
 * (produce photos, baskets, crates, tarps, scales). The 4 FUNCTIONAL stalls (auntie/butcher/veg/egg)
 * are built by the shops module: their spots and the aisle in front of each stay clear.
 */

type R4 = [number, number, number, number]; // x0,z0,x1,z1

export function buildMarket(c: ShopCtx & { rng: RNG; fol: FoliageSys | null }) {
  const w = c.w, rng = c.rng, M = MARKET, y0 = M.floor;
  const A = c.anchors;
  // reserved: stall zone (2.8 m on the facing side) + aisle in front (2.4 m) for each functional stall
  const reserved: R4[] = [];
  const res = (name: string) => {
    const a = A[name]; if (!a) return;
    const yaw = a.yaw ?? 0;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);  // facing direction
    const px = a.p[0], pz = a.p[2];
    const pts = [[px - fz * 2.9 - fx * 2.6, pz + fx * 2.9 - fz * 2.6], [px + fz * 2.9 + fx * 3.1, pz - fx * 2.9 + fz * 3.1]];
    reserved.push([Math.min(pts[0][0], pts[1][0]), Math.min(pts[0][1], pts[1][1]), Math.max(pts[0][0], pts[1][0]), Math.max(pts[0][1], pts[1][1])]);
  };
  for (const n of ['auntie_stall', 'butcher_stall', 'veg_stall', 'egg_stall']) res(n);
  const free = (r: R4) => !reserved.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);

  // ---------------------------------------------------------------- floor + drains + puddles
  // floor: hosed-down concrete (clean, light) — the wet look comes from a few sheen patches by the drains, not from
  // a texture full of black blotches
  // smooth trowelled concrete (fine hairlines, no big cracks); vertex AO just under the puddle threshold so the
  // world shader never paints rain puddles under the roof — the damp patches by the drains are decals
  w.mat('concrete_road', { autoDirt: false, ao: 0.82, tint: [1.32, 1.3, 1.26] });
  flat(w, M.x0, M.z0, M.x1, M.z1, y0, 8);
  c.phys.box([(M.x0 + M.x1) / 2, y0 / 2, (M.z0 + M.z1) / 2], [M.x1 - M.x0, y0, M.z1 - M.z0]);
  w.mat('grate', { uv: 'face', autoDirt: false, group: 'detail' });
  for (const z of [-46.2, -63.7]) for (let x = 8; x < 48; x += 1) w.quad(x, y0 + 0.004, z + 0.15, x + 1, y0 + 0.004, z + 0.15, x + 1, y0 + 0.004, z - 0.15, x, y0 + 0.004, z - 0.15, [0, 0, 1, 0.3]);
  const D = c.decals;
  if (D) for (let i = 0; i < 16; i++) {
    const k = rng.int(0, 3);
    const z = rng.pick([-46.2, -63.7]) + rng.range(-0.9, 0.9);
    groundDecal(w, D.cell('decal_puddles', k % 2, k >> 1, 2, 2), rng.range(8, 48), y0 + 0.006, z, rng.range(0.7, 1.6), rng.range(0.4, 0.9), rng.range(0, 6), { wet: 0.35, alpha: rng.range(0.3, 0.42), tint: 0x8c8a86 });   // indoors: damp, not a sky mirror
  }
  // stains: old water marks / oil spots on the concrete (subtle)
  if (D) for (let i = 0; i < 14; i++) {
    const k = rng.int(0, 3);
    groundDecal(w, D.cell('decal_oil_stains', k % 2, k >> 1, 2, 2), rng.range(8, 48), y0 + 0.005, rng.range(-78, -42), rng.range(0.6, 1.4), rng.range(0.5, 1.1), rng.range(0, 6), { alpha: rng.range(0.18, 0.3), tint: 0x6a6660 });
  }

  // ---------------------------------------------------------------- structure: posts, trusses, roofs
  const eave = 4.9, ridge = 7.2, midZ = (M.z0 + M.z1) / 2;
  const postAt = (x: number, z: number) => {
    w.mat('metal_paint', { tint: 0x3a5a4a, ov: 'steel_rust', ovAmt: 0.65, uv: 'local' });
    w.bevelBox(x - 0.11, y0, z - 0.11, x + 0.11, eave + 0.2, z + 0.11, 0.03);
    w.mat('concrete_old', { uv: 'local' });
    w.box(x - 0.2, y0, z - 0.2, x + 0.2, y0 + 0.5, z + 0.2, SIDES | PY);
    c.phys.box([x, eave / 2, z], [0.26, eave, 0.26]);
  };
  const postsX = [6.4, 13.6, 20.8, 28, 35.2, 42.4, 49.6];
  for (const x of postsX) { postAt(x, M.z1 + 0.4); postAt(x, M.z0 - 0.4); if (x > 7 && x < 49) postAt(x, -66.0); else postAt(x, midZ); }
  // west edge extra posts (avoid the entrance gaps)
  for (const z of [-46, -66.8]) postAt(6.4, z);
  // trusses (steel tubes) across each span, every post line
  w.setGroup('detail');
  for (const x of postsX) {
    w.mat('steel_rust', { uv: 'local' });
    for (const [za, zb] of [[M.z1 + 0.4, midZ], [midZ, M.z0 - 0.4]] as [number, number][]) {
      const zm = (za + zb) / 2;
      w.tube([x, eave, za, x, ridge - 0.25, zm, x, eave, zb], 0.05, 4);
      w.tube([x, eave, za, x, eave, zb], 0.04, 4);
      for (let t = 0.2; t < 0.85; t += 0.2) { const z = za + (zb - za) * t; const yTop = eave + (ridge - 0.25 - eave) * (1 - Math.abs(t - 0.5) * 2); w.tube([x, eave, z, x, yTop, z + (zb - za) * 0.06], 0.02, 3); }
    }
    // purlins between post lines
  }
  for (let z = M.z1 + 0.4; z > M.z0; z -= 2.5) { w.mat('steel_rust', { uv: 'local' }); w.tube([M.x0 + 0.4, roofY(z), z, M.x1 - 0.4, roofY(z), z], 0.025, 3); }
  w.setGroup('base');
  function roofY(z: number) {
    const span = (M.z1 - M.z0) / 2;
    const zl = z > midZ ? (z - midZ) / span : (midZ - z) / span; // 0 at the mid valley... two gables
    // two gable spans: ridges at the centre of each half
    const h = z > midZ ? Math.abs(z - (M.z1 + midZ) / 2) / (span / 2) : Math.abs(z - (M.z0 + midZ) / 2) / (span / 2);
    void zl;
    return ridge - (ridge - eave) * Math.min(1, h) - 0.2;
  }
  // roof sheets (two gables), skylight strips near the ridges
  const gable = (za: number, zb: number) => {
    const zm = (za + zb) / 2;
    w.mat('roof_galv', { ov: 'corr_rust', ovAmt: 0.7, uv: 'world', ao: 0.95 });
    // south slope (faces +z)
    w.quad(M.x0 - 0.6, eave, za + 0.6, M.x1 + 0.6, eave, za + 0.6, M.x1 + 0.6, ridge, zm, M.x0 - 0.6, ridge, zm);
    w.quad(M.x1 + 0.6, eave, zb - 0.6, M.x0 - 0.6, eave, zb - 0.6, M.x0 - 0.6, ridge, zm, M.x1 + 0.6, ridge, zm);
    // undersides: galvanised sheet lit by the bounce off the floor and the skylights (a little self-light so the
    // roof never reads as a black void from below)
    w.mat('roof_galv', { tint: 0x6c6a66, ao: 0.72, uv: 'world', emis: EMIS.store.i, emisK: 0.012 });
    w.quad(M.x1 + 0.6, eave - 0.02, za + 0.6, M.x0 - 0.6, eave - 0.02, za + 0.6, M.x0 - 0.6, ridge - 0.02, zm, M.x1 + 0.6, ridge - 0.02, zm);
    w.quad(M.x0 - 0.6, eave - 0.02, zb - 0.6, M.x1 + 0.6, eave - 0.02, zb - 0.6, M.x1 + 0.6, ridge - 0.02, zm, M.x0 - 0.6, ridge - 0.02, zm);
    // fibreglass skylight strips (lighter), a raised ridge vent
    w.mat('roof_fibre', { tint: 0xe8e0b8, uv: 'world', emis: EMIS.coolday.i, emisK: 0.05 });
    const t0 = 0.55, t1 = 0.75;
    const zs = (t: number, z0: number) => z0 + (zm - z0) * t, ys = (t: number) => eave + (ridge - eave) * t;
    for (let x = M.x0 + 2; x < M.x1 - 2; x += 7.2) {
      w.quad(x, ys(t0) + 0.01, zs(t0, za + 0.6), x + 3, ys(t0) + 0.01, zs(t0, za + 0.6), x + 3, ys(t1) + 0.01, zs(t1, za + 0.6), x, ys(t1) + 0.01, zs(t1, za + 0.6));
      w.quad(x + 3, ys(t0) + 0.01, zs(t0, zb - 0.6), x, ys(t0) + 0.01, zs(t0, zb - 0.6), x, ys(t1) + 0.01, zs(t1, zb - 0.6), x + 3, ys(t1) + 0.01, zs(t1, zb - 0.6));
    }
    // the same skylights seen from BELOW: translucent fibreglass glowing with daylight
    w.mat('roof_fibre', { tint: 0xfff6dc, uv: 'world', emis: EMIS.store.i, emisK: 0.75 });
    for (let x = M.x0 + 2; x < M.x1 - 2; x += 7.2) {
      w.quad(x + 3, ys(t0) - 0.035, zs(t0, za + 0.6), x, ys(t0) - 0.035, zs(t0, za + 0.6), x, ys(t1) - 0.035, zs(t1, za + 0.6), x + 3, ys(t1) - 0.035, zs(t1, za + 0.6));
      w.quad(x, ys(t0) - 0.035, zs(t0, zb - 0.6), x + 3, ys(t0) - 0.035, zs(t0, zb - 0.6), x + 3, ys(t1) - 0.035, zs(t1, zb - 0.6), x, ys(t1) - 0.035, zs(t1, zb - 0.6));
    }
    w.mat('roof_galv', { uv: 'world' });
    w.box(M.x0 - 0.6, ridge - 0.05, zm - 0.5, M.x1 + 0.6, ridge + 0.45, zm + 0.5, PY | PZ | NZ);
    // gable end walls (cement block + corrugated)
    w.mat('corr_rust', { uv: 'world' });
    w.tri(M.x1 + 0.3, eave, za + 0.4, M.x1 + 0.3, eave, zb - 0.4, M.x1 + 0.3, ridge, zm);
    w.tri(M.x0 - 0.3, eave, zb - 0.4, M.x0 - 0.3, eave, za + 0.4, M.x0 - 0.3, ridge, zm);
  };
  gable(M.z1, midZ);
  gable(midZ, M.z0);
  // perimeter low walls on the east / north / south sides (open above for ventilation)
  w.mat('cement_block', { ov: 'plaster_moldy', ovAmt: 0.8 });
  w.box(M.x1 - 0.2, 0, M.z0, M.x1 + 0.1, 1.4, M.z1, ALL & ~NY);
  w.box(M.x0 + 4, 0, M.z0 - 0.1, M.x1, 1.4, M.z0 + 0.2, ALL & ~NY);
  w.box(M.x0 + 4, 0, M.z1 - 0.2, M.x1, 1.4, M.z1 + 0.1, ALL & ~NY);
  c.phys.box([M.x1 - 0.05, 0.7, (M.z0 + M.z1) / 2], [0.3, 1.4, M.z1 - M.z0]);
  c.phys.box([(M.x0 + 4 + M.x1) / 2, 0.7, M.z0 + 0.05], [M.x1 - M.x0 - 4, 1.4, 0.3]);
  c.phys.box([(M.x0 + 4 + M.x1) / 2, 0.7, M.z1 - 0.05], [M.x1 - M.x0 - 4, 1.4, 0.3]);
  // chain-link-ish mesh above the low walls (steel bars)
  w.setGroup('detail');
  w.mat('metal_paint', { tint: 0x5a6a5a, ov: 'steel_rust', ovAmt: 0.6, uv: 'local' });
  for (let z = M.z0 + 0.5; z < M.z1; z += 0.35) w.box(M.x1 - 0.1, 1.4, z, M.x1 - 0.07, 3.2, z + 0.03, PX | NX);
  w.setGroup('base');

  // ---------------------------------------------------------------- entrance sign arch on the soi side
  for (const z of [-52.2, -57.8]) {
    w.mat('metal_paint', { tint: 0x2a5a8a, ov: 'steel_rust', ovAmt: 0.5, uv: 'local' });
    w.box(M.x0 - 0.1, y0, z - 0.1, M.x0 + 0.1, 4.6, z + 0.1, SIDES);
    c.phys.box([M.x0, 2.3, z], [0.2, 4.6, 0.2]);
  }
  w.mat('metal_paint', { tint: 0xe8e4d8 });
  w.box(M.x0 - 0.15, 3.7, -58.4, M.x0 + 0.05, 4.7, -51.6, ALL);
  const ms = c.signs?.pick('market', 6.8, rng);
  if (ms) { w.atlas('sign', { e0: 0.7, ao: 1 }); const r = ms.r; w.quad(M.x0 - 0.16, 3.75, -51.7, M.x0 - 0.16, 3.75, -58.3, M.x0 - 0.16, 4.65, -58.3, M.x0 - 0.16, 4.65, -51.7, [r.u0, r.v0, r.u1, r.v1]); }
  c.lights.add({ p: new THREE.Vector3(M.x0 - 0.8, 4.2, -55), color: new THREE.Color(0xfff0e0), intensity: 0, range: 0, glow: 1.6, kind: 'sign' });

  // ---------------------------------------------------------------- decorative stalls
  const islands: { r: R4; face: number[] }[] = [];
  const addIsland = (x0: number, z0: number, x1: number, z1: number) => { const r: R4 = [x0, z0, x1, z1]; if (free(r)) islands.push({ r, face: [] }); };
  for (let x = 8.2; x < 47; x += 4.6) {
    addIsland(x, -44.2, x + 4, -41.2);            // south edge row
    addIsland(x, -78.8, x + 4, -75.8);            // north edge row
    addIsland(x, -51.4, x + 4, -48.6);            // between south aisle & centre
    addIsland(x, -61.4, x + 4, -58.6);            // between centre & north aisle
    addIsland(x, -73.2, x + 4, -67.4);            // back-to-back block
    if (x > 25) addIsland(x, -56.6, x + 4, -53.4); // centre east of the egg stall
  }
  const goods = ['chili', 'lime', 'veg', 'fruit', 'fish', 'herbs', 'dried', 'flowers', 'banana', 'garlic', 'shrimp', 'egg', 'meat', 'rice', 'tomato', 'onion', 'mango', 'eggplant', 'cabbage'];
  const cloth = new WindCloth();
  for (const isl of islands) stall(c, isl.r, y0, rng, goods, cloth);

  // tubes + light points over the aisles
  w.setGroup('detail');
  for (let x = 10; x < 48; x += 6) for (const z of [-46.2, -55, -63.7, -74.5]) {
    w.put(c.props.tube(), x, eave - 1.3, z, 0);
    w.mat('rubber', { uv: 'local' });
    w.tube([x - 0.4, eave - 1.3, z, x - 0.4, eave - 0.05, z], 0.005, 3);
  }
  w.setGroup('base');
  // the market runs its tubes all day (it is dim under the roof): pool lights over every aisle, on by day
  for (let x = 10; x < 48; x += 9) for (const z of [-46.2, -55, -63.7, -74.5]) c.lights.add({ p: new THREE.Vector3(x, eave - 1.5, z), color: new THREE.Color(0xeef6ff), intensity: 14, range: 11, glow: 0.6, kind: 'tube', day: 0.9 });

  // crates / styrofoam boxes / baskets stacked along the walls
  w.setGroup('detail');
  for (let i = 0; i < 26; i++) {
    const x = rng.range(9, 48.5), z = rng.chance(0.5) ? rng.range(-79.3, -78.9) : rng.range(-40.9, -40.6);
    if (!free([x - 0.4, z - 0.4, x + 0.4, z + 0.4])) continue;
    const st = rng.int(1, 4);
    for (let k = 0; k < st; k++) w.put(c.props.crate(rng.pick(PLASTIC_COLORS)), x, y0 + k * 0.254, z, rng.range(-0.1, 0.1));
    if (rng.chance(0.3)) c.props.real.add('styro_box', x + 0.6, y0, z, rng.range(-0.2, 0.2));
  }
  w.setGroup('base');
  // micro detail around the functional stalls + wind-blown cloth (one mesh)
  dressMarketStalls({ ...c, rng }, cloth);
  flushMarketPiles(c);
  const cm = cloth.build();
  if (cm) { c.props.real.addObject(cm); c.props.real.animate(new THREE.Vector3((M.x0 + M.x1) / 2, 3, (M.z0 + M.z1) / 2), 90, (_dt, t) => { cloth.uTime.value = t; }); }
}

/** one decorative market stall (back-to-back stalls on deep islands) */
function stall(c: ShopCtx & { rng: RNG }, r: R4, y0: number, rng: RNG, goods: string[], cloth: WindCloth) {
  const w = c.w, P = c.props;
  const [x0, z0, x1, z1] = r;
  const deep = z1 - z0 > 4;
  const tables: R4[] = deep ? [[x0, z0, x1, z0 + 1.2], [x0, z1 - 1.2, x1, z1]] : [[x0, z0 + 0.6, x1, z1 - 0.6]];
  for (const t of tables) {
    const [a, b, cc, d] = t;
    const top = y0 + 0.82;
    // tiled concrete counter or steel table
    if (rng.chance(0.5)) {
      // tiled concrete counter: recessed kick, bevelled body, overhanging tiled top with a rounded nosing
      w.mat('tiles_wall', { tint: rng.pick([0xffffff, 0xd8e8e0, 0xe8e0d0]), ov: 'plaster_moldy', ovAmt: 0.5, uv: 'world' });
      w.bevelBox(a + 0.04, y0 + 0.1, b + 0.04, cc - 0.04, top - 0.05, d - 0.04, 0.02);
      w.mat('concrete_old', { uv: 'world', ao: 0.6 });
      w.bevelBox(a + 0.08, y0, b + 0.08, cc - 0.08, y0 + 0.1, d - 0.08, 0.01);
      w.mat('tiles_wall', { tint: 0xf2f2ee, uv: 'world' });
      w.bevelBox(a - 0.02, top - 0.05, b - 0.02, cc + 0.02, top, d + 0.02, 0.025);
    } else {
      // stainless market table: bevelled top with a folded edge, round tube legs with feet, a lower shelf
      w.mat('stainless_dirty', { uv: 'local' });
      w.bevelBox(a, top - 0.04, b, cc, top, d, 0.015);
      for (const [px, pz] of [[a + 0.05, b + 0.05], [cc - 0.05, b + 0.05], [a + 0.05, d - 0.05], [cc - 0.05, d - 0.05]]) { w.cyl(px, y0, pz, 0.022, 0.022, top - 0.04 - y0, 10, 0); w.cyl(px, y0, pz, 0.03, 0.03, 0.02, 10, 1); }
      w.bevelBox(a + 0.03, y0 + 0.2, b + 0.03, cc - 0.03, y0 + 0.22, d - 0.03, 0.008);
      w.mat('plastic', { tint: rng.pick([0x2a5ab0, 0xd03030, 0x2a8a4a, 0xe0d0b0]), uv: 'local' });
      w.box(a - 0.02, top, b - 0.02, cc + 0.02, top + 0.006, d + 0.02, PY);
    }
    c.phys.box([(a + cc) / 2, top / 2, (b + d) / 2], [cc - a, top, d - b]);
    // goods: the whole top is covered — 2–3 rows of baskets / trays / ice trays, two kinds per table in runs
    w.setGroup('detail');
    const k1 = rng.pick(goods), k2 = rng.pick(goods);
    const depth = d - b;
    const rows = depth > 1.5 ? 3 : depth > 0.95 ? 2 : 1;
    for (let rI = 0; rI < rows; rI++) {
      const z = b + depth * ((rI + 0.5) / rows) + rng.range(-0.04, 0.04);
      let i = 0;
      for (let x = a + 0.3; x < cc - 0.25; x += rng.range(0.44, 0.56), i++) produce(c, (Math.floor(i / 2) + rI) % 2 ? k2 : k1, x, top, z, rng);
    }
    // crates under the table
    for (let x = a + 0.4; x < cc - 0.3; x += 0.7) if (rng.chance(0.6)) c.props.real.add('lib:plastic_crate_02', x, y0, (b + d) / 2, rng.range(-0.2, 0.2), { color: rng.pick(PLASTIC_COLORS) });
    // hanging scale + vendor stool
    if (rng.chance(0.5)) { w.mat('rubber', { uv: 'local' }); w.tube([cc - 0.48, top + 1.9, b + 0.42, cc - 0.48, top + 1.45, b + 0.42], 0.003, 3); c.props.real.add('hanging_scale', cc - 0.48, top + 1.45, b + 0.42, rng.range(-0.4, 0.4)); }
    c.props.real.add('thai_stool', (a + cc) / 2 + rng.range(-1, 1), y0, deep ? (b < z0 + 0.1 ? d + 0.5 : b - 0.5) : d + 0.45, rng.range(0, 6), { color: rng.pick(PLASTIC_COLORS) });
    w.setGroup('base');
  }
  // tarp or umbrella above (colourful, sagging, moving in the wind)
  w.setGroup('detail');
  if (rng.chance(0.55)) {
    const col = rng.pick([0x2a5ab0, 0xd03030, 0x2a8a4a, 0xe8c020, 0xe06a20]);
    const y = 3.1 + rng.range(-0.2, 0.3);
    cloth.tarp(new THREE.Vector3(x0 - 0.2, y - 0.25, z1 + 0.3), new THREE.Vector3(x1 + 0.2, y - 0.25, z1 + 0.3), new THREE.Vector3(x1 + 0.2, y, z0 - 0.3), new THREE.Vector3(x0 - 0.2, y, z0 - 0.3), col, rng.range(0.1, 0.22));
    w.mat('rubber', { uv: 'local' });
    for (const x of [x0 - 0.2, x1 + 0.2]) { w.tube([x, y, z0 - 0.3, x, 4.85, z0 - 0.3], 0.004, 3); w.tube([x, y - 0.25, z1 + 0.3, x, 4.85, z1 + 0.3], 0.004, 3); }
  } else if (rng.chance(0.5)) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    w.mat('steel_rust', { uv: 'local' }); w.cyl(cx, y0, cz, 0.022, 0.022, 2.3, 6, 1);
    c.props.real.add('tyre', cx, y0, cz, rng.range(0, 6), { phys: 'static' });   // old tyre filled with concrete = umbrella base
    w.mat('concrete_old', { uv: 'local' }); w.cyl(cx, y0, cz, 0.2, 0.2, 0.13, 12, 1);
    cloth.umbrella(new THREE.Vector3(cx, y0, cz), 1.3, 2.42, rng.pick([0xc03020, 0x2a62b8, 0xe0b020]));
  }
  // a bare bulb on a cord, styrofoam boxes, sometimes a radio or a sleeping cat-sized sack of rice
  if (rng.chance(0.5)) {
    const bx = (x0 + x1) / 2 + rng.range(-1, 1), bz = (z0 + z1) / 2;
    w.mat('rubber', { uv: 'local' }); w.tube([bx, 3.0, bz, bx + 0.02, 2.6, bz, bx, 2.25, bz], 0.004, 3);
    c.props.real.add('bulb', bx, 2.25, bz, 0);
    c.lights.add({ p: new THREE.Vector3(bx, 2.15, bz), color: new THREE.Color(0xffc890), intensity: 5, range: 6, glow: 0.4, kind: 'custom' });
  }
  if (rng.chance(0.5)) c.props.real.add('styro_box', x1 + 0.25, y0, (z0 + z1) / 2 + rng.range(-0.8, 0.8), rng.range(-0.3, 0.3));
  w.setGroup('base');
}

/** a tray / basket / heap of goods with a real produce photo on top when available */
/** real produce piles of the decor stalls (flushed once by the market builder) */
let marketPiles: PileBatch | null = null;
let marketSea: SeafoodBatch | null = null;
export function flushMarketPiles(c: ShopCtx) {
  if (marketSea) { const g = new THREE.Group(); g.name = 'decor-seafood'; marketSea.flush(g); c.props.real.addObject(g); marketSea = null; }
  if (!marketPiles) return;
  const g = new THREE.Group(); g.name = 'decor-piles';
  marketPiles.flush(g); c.props.real.addObject(g); marketPiles = null;
}
export function produce(c: ShopCtx, kind: string, x: number, y: number, z: number, rng: RNG) {
  const w = c.w;
  // seafood: styrofoam trays of crushed ice with real 3D fish / prawns (instanced for the whole market)
  if (kind === 'fish' || kind === 'shrimp') {
    marketSea ??= new SeafoodBatch();
    marketSea.add(kind, new THREE.Vector3(x, y, z), rng.range(-0.15, 0.15), 0.42, 0.32, Math.floor(x * 37 + z * 11));
    return;
  }
  // rice / dried goods: open sacks and a bamboo tray heaped with dried chillies
  if (kind === 'rice') { c.props.real.add('lib:rice_sack', x, y, z, rng.range(-0.4, 0.4), { phys: 'none' }); return; }
  const ph = c.signs?.any('produce:' + kind, rng) ?? c.signs?.any('produce', rng) ?? null;
  // container: real library models — wicker basket, Thai plastic market basket, or a กระด้ง bamboo tray
  const container = rng.pick(['basket', 'tray', 'bowl']);
  const r = container === 'basket' ? 0.17 : container === 'tray' ? 0.2 : rng.range(0.2, 0.28);
  const yaw = rng.range(-0.3, 0.3);
  if (container === 'basket') c.props.real.add('lib:wicker_basket_01', x, y, z, yaw, { phys: 'none' });
  else if (container === 'tray') c.props.real.add('lib:plastic_basket', x, y, z, yaw, { color: rng.pick([0x2a5ab0, 0xd03030, 0x2a8a4a, 0xe86a8a]), phys: 'none' });
  else c.props.real.add('lib:kradong', x, y, z, yaw, { scale: (2 * r) / 0.712, phys: 'none' });
  // heap: real produce models where they exist (instanced, batched for the whole market) …
  const hy = y + (container === 'basket' ? 0.09 : container === 'tray' ? 0.15 : 0.02);
  const hh = rng.range(0.06, 0.16);
  const pk = KIND_PILE[kind];
  if (pk && PileBatch.has(pk)) {
    marketPiles ??= new PileBatch();
    marketPiles.add(pk, new THREE.Vector3(x, hy - 0.01, z), yaw, r * 0.85, r * (container === 'tray' ? 0.6 : 0.85), Math.floor(x * 31 + z * 17));
    return;
  }
  // … else a soft photo dome (fish on ice, dried goods, flowers, rice): 12 sectors × 3 rings, not a 6-sided cone
  if (ph) {
    w.atlas('sign', { e0: 0, ao: 0.95 });
    const N = 12, RINGS = 3;
    const cu = (ph.u0 + ph.u1) / 2, cv = (ph.v0 + ph.v1) / 2, ru = (ph.u1 - ph.u0) / 2, rv = (ph.v1 - ph.v0) / 2;
    const pt = (i: number, k: number) => {
      const a = (i / N) * Math.PI * 2, t = k / RINGS;              // t: 0 rim … 1 top
      const lump = 1 + 0.07 * Math.sin(a * 3 + x * 5) * (1 - t);
      const rr = r * 0.92 * Math.cos(t * Math.PI * 0.5) * lump;
      return { p: [x + Math.cos(a) * rr, hy + hh * Math.sin(t * Math.PI * 0.5), z + Math.sin(a) * rr], uv: [cu + Math.cos(a) * ru * (rr / r), cv + Math.sin(a) * rv * (rr / r)] };
    };
    for (let k = 0; k < RINGS; k++) for (let i = 0; i < N; i++) {
      const a = pt(i, k), b = pt(i + 1, k), c2 = pt(i + 1, k + 1), d = pt(i, k + 1);
      w.quad(a.p[0], a.p[1], a.p[2], d.p[0], d.p[1], d.p[2], c2.p[0], c2.p[1], c2.p[2], b.p[0], b.p[1], b.p[2], null);
      patchLastUV(w, x, z, [a.uv[0], a.uv[1], d.uv[0], d.uv[1], c2.uv[0], c2.uv[1], b.uv[0], b.uv[1]]);
    }
  } else {
    w.mat(kind === 'fish' || kind === 'shrimp' ? 'plastic_gloss' : 'leaves', { tint: kindTint(kind), uv: 'local' });
    w.cyl(x, hy, z, r * 0.9, r * 0.25, hh, 7, 1, 0, 0.3);
  }
}

function kindTint(k: string) {
  return ({ chili: 0xc82018, lime: 0x5a9a2a, veg: 0x4a8a3a, fruit: 0xe0a020, fish: 0x8a9aa8, herbs: 0x3a7a2a, dried: 0x9a6a3a, flowers: 0xf0b020, banana: 0xd8c040, garlic: 0xe8dcc8, shrimp: 0xe0806a, egg: 0xe8d8b8, meat: 0xb04848, rice: 0xf0ece0 } as any)[k] ?? 0x8a8a6a;
}

/** overwrite the uvs of the 4 vertices just written into the bucket at (x,z) */
function patchLastUV(w: WB, _x: number, _z: number, uvs: number[]) {
  const B = w.lastBuf;
  if (!B) return;
  const o = B.nv - 4;
  for (let i = 0; i < 8; i++) B.uv[o * 2 + i] = uvs[i];
}

void PX; void NX; void PZ; void NZ; void NY;
