import * as THREE from 'three';
import { RNG } from '../../core/rng';
import { WB, ALL, SIDES, PX, NX, PY, NY, PZ, NZ } from './geo';
import type { ShopCtx } from './shophouse';
import type { FoliageSys } from './foliage';
import { flat, groundDecal } from './streets';
import { PLASTIC_COLORS } from './props';
import { EMIS } from './mats';
import { MARKET } from './layout';

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
    const pts = [[px - fz * 1.6 - fx * 2.6, pz + fx * 1.6 - fz * 2.6], [px + fz * 1.6 + fx * 3.1, pz - fx * 1.6 + fz * 3.1]];
    reserved.push([Math.min(pts[0][0], pts[1][0]), Math.min(pts[0][1], pts[1][1]), Math.max(pts[0][0], pts[1][0]), Math.max(pts[0][1], pts[1][1])]);
  };
  for (const n of ['auntie_stall', 'butcher_stall', 'veg_stall', 'egg_stall']) res(n);
  const free = (r: R4) => !reserved.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);

  // ---------------------------------------------------------------- floor + drains + puddles
  w.mat('concrete_wet', { autoDirt: false, ao: 0.9 });
  flat(w, M.x0, M.z0, M.x1, M.z1, y0, 8);
  c.phys.box([(M.x0 + M.x1) / 2, y0 / 2, (M.z0 + M.z1) / 2], [M.x1 - M.x0, y0, M.z1 - M.z0]);
  w.mat('grate', { uv: 'face', autoDirt: false, group: 'detail' });
  for (const z of [-46.2, -63.7]) for (let x = 8; x < 48; x += 1) w.quad(x, y0 + 0.004, z + 0.15, x + 1, y0 + 0.004, z + 0.15, x + 1, y0 + 0.004, z - 0.15, x, y0 + 0.004, z - 0.15, [0, 0, 1, 0.3]);
  const D = c.decals;
  if (D) for (let i = 0; i < 40; i++) {
    const k = rng.int(0, 3);
    groundDecal(w, D.cell('decal_puddles', k % 2, k >> 1, 2, 2), rng.range(8, 48), y0 + 0.006, rng.range(-78, -42), rng.range(0.8, 2.4), rng.range(0.6, 1.6), rng.range(0, 6), { wet: 1, alpha: rng.range(0.6, 0.95) });
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
    // undersides (dark)
    w.mat('roof_galv', { tint: 0x8a8884, ao: 0.55, uv: 'world' });
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
  const goods = ['chili', 'lime', 'veg', 'fruit', 'fish', 'herbs', 'dried', 'flowers', 'banana', 'garlic', 'shrimp', 'egg', 'meat', 'rice'];
  for (const isl of islands) stall(c, isl.r, y0, rng, goods);

  // tubes + light points over the aisles
  w.setGroup('detail');
  for (let x = 10; x < 48; x += 6) for (const z of [-46.2, -55, -63.7, -74.5]) {
    w.put(c.props.tube(), x, eave - 1.3, z, 0);
    w.mat('rubber', { uv: 'local' });
    w.tube([x - 0.4, eave - 1.3, z, x - 0.4, eave - 0.05, z], 0.005, 3);
  }
  w.setGroup('base');
  for (let x = 12; x < 48; x += 12) for (const z of [-46, -63.5]) c.lights.add({ p: new THREE.Vector3(x, eave - 1.5, z), color: new THREE.Color(0xe8f6ff), intensity: 16, range: 12, glow: 0.7, kind: 'tube', day: 0.3 });

  // crates / styrofoam boxes / baskets stacked along the walls
  w.setGroup('detail');
  for (let i = 0; i < 26; i++) {
    const x = rng.range(9, 48.5), z = rng.chance(0.5) ? rng.range(-79.3, -78.9) : rng.range(-40.9, -40.6);
    if (!free([x - 0.4, z - 0.4, x + 0.4, z + 0.4])) continue;
    const st = rng.int(1, 4);
    for (let k = 0; k < st; k++) w.put(c.props.crate(rng.pick(PLASTIC_COLORS)), x, y0 + k * 0.31, z, rng.range(-0.1, 0.1));
  }
  w.setGroup('base');
}

/** one decorative market stall (back-to-back stalls on deep islands) */
function stall(c: ShopCtx & { rng: RNG }, r: R4, y0: number, rng: RNG, goods: string[]) {
  const w = c.w, P = c.props;
  const [x0, z0, x1, z1] = r;
  const deep = z1 - z0 > 4;
  const tables: R4[] = deep ? [[x0, z0, x1, z0 + 1.2], [x0, z1 - 1.2, x1, z1]] : [[x0, z0 + 0.6, x1, z1 - 0.6]];
  for (const t of tables) {
    const [a, b, cc, d] = t;
    const top = y0 + 0.82;
    // tiled concrete counter or steel table
    if (rng.chance(0.5)) {
      w.mat('tiles_wall', { tint: rng.pick([0xffffff, 0xd8e8e0, 0xe8e0d0]), ov: 'plaster_moldy', ovAmt: 0.5, uv: 'world' });
      w.box(a, y0, b, cc, top, d, ALL & ~NY);
    } else {
      w.mat('stainless_dirty', { uv: 'local' });
      w.box(a, top - 0.04, b, cc, top, d, ALL);
      for (const [px, pz] of [[a + 0.05, b + 0.05], [cc - 0.05, b + 0.05], [a + 0.05, d - 0.05], [cc - 0.05, d - 0.05]]) w.box(px - 0.025, y0, pz - 0.025, px + 0.025, top - 0.04, pz + 0.025, SIDES);
      w.mat('plastic', { tint: rng.pick([0x2a5ab0, 0xd03030, 0x2a8a4a, 0xe0d0b0]), uv: 'local' });
      w.box(a - 0.02, top, b - 0.02, cc + 0.02, top + 0.01, d + 0.02, PY);
    }
    c.phys.box([(a + cc) / 2, top / 2, (b + d) / 2], [cc - a, top, d - b]);
    // goods: trays/baskets with real produce photos (or tinted fill)
    w.setGroup('detail');
    const kind = rng.pick(goods);
    for (let x = a + 0.35; x < cc - 0.3; x += rng.range(0.55, 0.8)) {
      const z = (b + d) / 2 + rng.range(-0.15, 0.15);
      produce(c, kind, x, top, z, rng);
    }
    // crates under the table
    for (let x = a + 0.4; x < cc - 0.3; x += 0.7) if (rng.chance(0.6)) w.put(P.crate(rng.pick(PLASTIC_COLORS)), x, y0, (b + d) / 2, rng.range(-0.2, 0.2));
    // hanging scale + vendor stool
    if (rng.chance(0.5)) { w.mat('metal_paint', { tint: 0xc02020, uv: 'local' }); w.box(cc - 0.6, top + 0.9, b + 0.4, cc - 0.35, top + 1.15, b + 0.45, ALL); w.mat('rubber', { uv: 'local' }); w.tube([cc - 0.48, top + 1.15, b + 0.42, cc - 0.48, top + 1.9, b + 0.42], 0.004, 3); }
    w.put(P.stool(rng.pick(PLASTIC_COLORS)), (a + cc) / 2 + rng.range(-1, 1), y0, deep ? (b < z0 + 0.1 ? d + 0.5 : b - 0.5) : d + 0.45, rng.range(0, 6));
    w.setGroup('base');
  }
  // tarp or umbrella above (colourful)
  w.setGroup('detail');
  if (rng.chance(0.55)) {
    w.mat('tarp', { tint: rng.pick([0x2a5ab0, 0xd03030, 0x2a8a4a, 0xe8c020, 0xe06a20]), uv: 'local', ao: 0.95 });
    const y = 3.1 + rng.range(-0.2, 0.3);
    w.quad(x0 - 0.2, y - 0.25, z1 + 0.3, x1 + 0.2, y - 0.25, z1 + 0.3, x1 + 0.2, y, z0 - 0.3, x0 - 0.2, y, z0 - 0.3);
    w.quad(x1 + 0.2, y - 0.26, z1 + 0.3, x0 - 0.2, y - 0.26, z1 + 0.3, x0 - 0.2, y - 0.01, z0 - 0.3, x1 + 0.2, y - 0.01, z0 - 0.3);
    w.mat('rubber', { uv: 'local' });
    for (const x of [x0 - 0.2, x1 + 0.2]) w.tube([x, y, z0 - 0.3, x, 4.85, z0 - 0.3], 0.004, 3);
  } else if (rng.chance(0.5)) w.put(P.umbrella(rng.pick([0xc03020, 0x2a62b8, 0xe0b020])), (x0 + x1) / 2, y0, (z0 + z1) / 2, rng.range(0, 6));
  w.setGroup('base');
}

/** a tray / basket / heap of goods with a real produce photo on top when available */
export function produce(c: ShopCtx, kind: string, x: number, y: number, z: number, rng: RNG) {
  const w = c.w;
  const ph = c.signs?.any('produce:' + kind, rng) ?? c.signs?.any('produce', rng) ?? null;
  const container = rng.pick(['basket', 'tray', 'bowl']);
  const r = rng.range(0.2, 0.3);
  if (container === 'basket') { w.mat('bamboo_woven', { uv: 'local' }); w.cyl(x, y, z, r * 0.85, r, 0.14, 9, 0, 0, 0.04); }
  else if (container === 'tray') { w.mat('plastic', { tint: rng.pick([0x2a5ab0, 0xd03030, 0x2a8a4a, 0x303030]), uv: 'local' }); w.box(x - r, y, z - r * 0.7, x + r, y + 0.07, z + r * 0.7, ALL & ~NY); }
  else { w.mat('stainless', { uv: 'local' }); w.cyl(x, y, z, r * 0.6, r, 0.1, 10, 0); }
  // heap: a low dome; the photo is mapped across its top faces
  const hy = y + (container === 'basket' ? 0.12 : 0.06);
  const hh = rng.range(0.06, 0.16);
  if (ph) {
    w.atlas('sign', { e0: 0, ao: 0.95 });
    const N = 6;
    const cu = (ph.u0 + ph.u1) / 2, cv = (ph.v0 + ph.v1) / 2, ru = (ph.u1 - ph.u0) / 2, rv = (ph.v1 - ph.v0) / 2;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
      const rr = r * 0.92;
      const p0 = [x + Math.cos(a0) * rr, hy, z + Math.sin(a0) * rr], p1 = [x + Math.cos(a1) * rr, hy, z + Math.sin(a1) * rr];
      const uv0 = [cu + Math.cos(a0) * ru, cv + Math.sin(a0) * rv], uv1 = [cu + Math.cos(a1) * ru, cv + Math.sin(a1) * rv];
      // tri with explicit per-vertex uvs: emulate via quad with d=c
      w.quad(x, hy + hh, z, p1[0], p1[1], p1[2], p0[0], p0[1], p0[2], p0[0], p0[1], p0[2], null);
      // patch uvs of the last 4 vertices (centre, p1, p0, p0)
      patchLastUV(w, x, z, [cu, cv, uv1[0], uv1[1], uv0[0], uv0[1], uv0[0], uv0[1]]);
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
