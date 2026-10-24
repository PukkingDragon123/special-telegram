import * as THREE from 'three';
import { RNG } from '../../core/rng';
import { WB, ALL, SIDES, PX, NX, PY, NY, PZ, NZ } from './geo';
import type { ShopCtx } from './shophouse';
import type { FoliageSys } from './foliage';
import { weeds, pottedPlant, bananaTree, coconutPalm, bougainvillea } from './foliage';
import { flat, groundDecal, wallDecal } from './streets';
import { PLASTIC_COLORS } from './props';
import { EMIS } from './mats';
import { SW_H, SOI, MAIN, CROAD, ZEBRAS, POLES_SOI, POLES_SOI_E, POLES_MAIN_N, POLES_MAIN_S } from './layout';

/**
 * STREET LIFE DRESSING — parked motorbikes & pickups, trash bags, bins, crates, stools, potted
 * plants, street-food carts & umbrellas (non-interactive), bus stop shelter, motorcycle-taxi stand,
 * pedestrian overpass, phone booth, posters on poles, weeds in every crack, road-closure barriers
 * at the map edges (players stay inside MAP_BOUNDS).
 */

type Ctx = ShopCtx & { rng: RNG; fol: FoliageSys | null };

const BIKE_COLS = [0xc0302a, 0x1c1c1e, 0x2a62b8, 0xe8e4dc, 0x3a3a3a, 0x8a1a1a, 0xd8d0b8, 0x2a6a3a, 0xe07020];

export function buildStreetLife(c: Ctx) {
  const w = c.w, rng = c.rng, P = c.props, F = c.fol;
  const A = c.anchors;
  // keep-clear zones (anchors used by gameplay)
  const clear: [number, number, number][] = [];
  for (const n of ['cart_start', 'old_man_spot', 'item_respawn', 'wake_0', 'wake_1', 'wake_2', 'wake_3', 'player_spawn', 'plastic_shop', 'gas_shop', 'kitchen_shop', 'convenience_store', 'market_spot', 'mainroad_spot', 'office_spot', 'homeless_spot', 'moto_taxi_stand', 'bus_stop']) {
    const a = A[n]; if (a) clear.push([a.p[0], a.p[2], n.endsWith('_shop') ? 4.2 : n.startsWith('wake') ? 1.6 : 2.4]);
  }
  for (const z of ZEBRAS) if (z.axis === 'z') clear.push([-4.75, z.at, 2]), clear.push([4.75, z.at, 2]);
  const ok = (x: number, z: number, r = 0.6) => !clear.some(([cx, cz, cr]) => Math.hypot(x - cx, z - cz) < cr + r);
  const tables = A.tables_area;
  const okT = (x: number, z: number, r = 0.6) => ok(x, z, r) && !(tables && Math.hypot(x - tables.p[0], z - tables.p[2]) < (tables.r ?? 3.6) + 0.5);

  w.setGroup('detail');
  // ---------------------------------------------------------------- parked motorbikes (rows, slanted, on sidewalks)
  const bikeRow = (x: number, z0: number, z1: number, yaw: number, gap = 0.82) => {
    for (let z = z0; z > z1; z -= gap + rng.range(0, 0.4)) {
      if (!okT(x, z) || rng.chance(0.25)) { z -= rng.range(0.5, 3); continue; }
      w.put(P.motorbike(rng.pick(BIKE_COLS)), x + rng.range(-0.15, 0.15), SW_H, z, yaw + rng.range(-0.2, 0.2), 1, { rz: 0.08 });
      c.phys.box([x, 0.6, z], [0.4, 1.0, 1.4], yaw);
    }
  };
  bikeRow(-5.3, -3, -16, Math.PI / 2 + 0.35);
  bikeRow(-5.3, -34, -40, Math.PI / 2 + 0.35);
  bikeRow(-5.3, -50, -54, Math.PI / 2 + 0.35);
  bikeRow(-5.4, -56, -74, Math.PI / 2 + 0.4);   // apartment
  bikeRow(-5.3, -100, -144, Math.PI / 2 + 0.35);
  bikeRow(5.3, -84, -136, -Math.PI / 2 + 0.35);
  bikeRow(5.3, -39, -40.5, -Math.PI / 2 + 0.35);
  for (let x = -120; x < 125; x += rng.range(4, 14)) {
    if (Math.abs(x) < 8) continue;
    const z = rng.chance(0.5) ? 1.0 : 25.0;
    if (!okT(x, z)) continue;
    const n = rng.int(1, 4);
    for (let k = 0; k < n; k++) { const xx = x + k * 0.85; w.put(P.motorbike(rng.pick(BIKE_COLS)), xx, SW_H, z, (z < 10 ? 0 : Math.PI) + rng.range(-0.25, 0.25), 1, { rz: 0.08 }); c.phys.box([xx, 0.6, z], [0.4, 1.0, 1.4]); }
  }
  // licence plates (real-photo cut-outs, img/signs/plate_*) — local z offset lz: + front / − back
  const plate = (x: number, y: number, z: number, yaw: number, lz: number, cat: string, pw = 0.34, ph = 0.15) => {
    const r = c.signs?.any(cat, rng); if (!r) return;
    const n = Math.sign(lz) || 1, cs = Math.cos(yaw), sn = Math.sin(yaw), hw = (pw / 2) * n;
    const W = (lx: number, ly: number) => [x + lx * cs + lz * sn, y + ly, z - lx * sn + lz * cs];
    const a = W(-hw, 0), b = W(hw, 0), cc = W(hw, ph), d = W(-hw, ph);
    w.atlas('sign', { e0: 0, ao: 0.85 });
    w.quad(a[0], a[1], a[2], b[0], b[1], b[2], cc[0], cc[1], cc[2], d[0], d[1], d[2], [r.u0, r.v0, r.u1, r.v1]);
  };
  const pickupAt = (col: number, x: number, z: number, yaw: number) => {
    w.put(P.pickup(col), x, 0, z, yaw);
    plate(x, 0.6, z, yaw, -2.607, 'plate');
    plate(x, 0.42, z, yaw, 2.585, 'plate');
  };
  // a parked pickup in the soi (half on the curb) + one on the canal road
  pickupAt(0xd8d8d4, 2.4, -112, Math.PI + 0.02);
  c.phys.box([2.4, 0.9, -112], [1.9, 1.8, 5]);
  pickupAt(0x2a4a7a, -2.4, -128, 0.03);
  c.phys.box([-2.4, 0.9, -128], [1.9, 1.8, 5]);
  pickupAt(0xa02020, 40, (CROAD.z0 + CROAD.z1) / 2 - 1, Math.PI / 2);

  // ---------------------------------------------------------------- trash bags at poles, bins, crates
  const allPoles = [...POLES_SOI, ...POLES_SOI_E, ...POLES_MAIN_N, ...POLES_MAIN_S];
  for (const [px, pz] of allPoles) {
    if (!ok(px, pz, 0.8) || rng.chance(0.3)) continue;
    const n = rng.int(2, 6);
    for (let k = 0; k < n; k++) w.put(P.trashBag(rng.int(0, 9)), px + rng.range(-0.6, 0.6), SW_H, pz + rng.range(-0.6, 0.6), rng.range(0, 6), rng.range(0.8, 1.2));
    if (rng.chance(0.4)) w.put(P.bin(rng.pick([0x2a7a3a, 0x2a5aa0, 0xe0a020, 0x8a8a8a])), px + 0.8, SW_H, pz, rng.range(0, 6));
  }
  for (let i = 0; i < 40; i++) {
    const side = rng.chance(0.5) ? -1 : 1;
    const x = side * rng.range(5.3, 5.8), z = rng.range(-150, -2);
    if (!okT(x, z, 0.8)) continue;
    const t = rng.int(0, 4);
    if (t === 0) for (let k = 0; k < rng.int(1, 3); k++) w.put(P.crate(rng.pick(PLASTIC_COLORS)), x, SW_H + k * 0.31, z, rng.range(-0.2, 0.2));
    else if (t === 1) w.put(P.stoolStack(rng.pick(PLASTIC_COLORS), rng.int(4, 9)), x, SW_H, z, 0);
    else if (t === 2) w.put(P.bucket(rng.pick(PLASTIC_COLORS)), x, SW_H, z, 0);
    else if (t === 3) w.put(P.cardboardPile(rng.int(0, 3)), x, SW_H, z, rng.range(0, 6));
    else w.put(P.junkPile(rng.int(0, 5)), x, SW_H, z, rng.range(0, 6));
    c.phys.box([x, 0.4, z], [0.6, 0.8, 0.6]);
  }

  // ---------------------------------------------------------------- street food stalls (decor, not interactive)
  const foodStall = (x: number, z: number, yaw: number) => {
    if (!okT(x, z, 1.4)) return;
    w.put(P.cart(rng.pick([0x2a5a9a, 0xc03020, 0x2a7a3a, 0xe0b020])), x, SW_H, z, yaw);
    w.put(P.umbrella(rng.pick([0xc03020, 0x2a62b8, 0xe0b020, 0x2a8a3e, 0xe06a20])), x + Math.cos(yaw) * 0.2, SW_H, z - Math.sin(yaw) * 0.2, rng.range(0, 6));
    for (let k = 0; k < rng.int(2, 5); k++) w.put(P.stool(rng.pick(PLASTIC_COLORS)), x + rng.range(-1.4, 1.4), SW_H, z + rng.range(-1.4, 1.4), rng.range(0, 6));
    if (rng.chance(0.6)) w.put(P.plasticTable(rng.pick([0xe8e4dc, 0x2a62b8, 0xc0302a])), x + rng.range(-1.2, 1.2), SW_H, z + rng.range(0.8, 1.4), rng.range(-0.2, 0.2));
    c.phys.box([x, 0.75, z], [1.6, 1.5, 1.0], yaw);
    c.lights.add({ p: new THREE.Vector3(x, SW_H + 2.0, z), color: new THREE.Color(0xfff0d0), intensity: 5, range: 6, glow: 0.35, kind: 'custom' });
  };
  foodStall(-5.0, -10, Math.PI / 2);
  foodStall(5.0, -44.5, -Math.PI / 2);
  foodStall(-5.0, -95, Math.PI / 2);
  foodStall(5.0, -140, -Math.PI / 2);
  foodStall(20, 3.2, 0);
  foodStall(-60, 24.6, Math.PI);
  foodStall(64, 3.2, 0);
  foodStall(-90, 3.2, 0);
  foodStall(12, -156.7, Math.PI);

  // ---------------------------------------------------------------- bus stop shelter (bus_stop anchor)
  {
    const bs = A.bus_stop.p;
    const x = bs[0], z = 2.5;
    w.mat('metal_paint', { tint: 0x2a5a8a, ov: 'steel_rust', ovAmt: 0.4, uv: 'local' });
    for (const dx of [-2.2, 2.2]) { w.box(x + dx - 0.06, SW_H, z - 0.9, x + dx + 0.06, SW_H + 2.6, z - 0.78, SIDES); w.box(x + dx - 0.06, SW_H, z + 0.5, x + dx + 0.06, SW_H + 2.6, z + 0.62, SIDES); c.phys.box([x + dx, 1.4, z - 0.15], [0.15, 2.6, 1.5]); }
    w.mat('roof_fibre', { tint: 0xd8dccc, uv: 'local' });
    w.quad(x - 2.5, SW_H + 2.6, z + 1.1, x + 2.5, SW_H + 2.6, z + 1.1, x + 2.5, SW_H + 2.75, z - 1.2, x - 2.5, SW_H + 2.75, z - 1.2);
    w.quad(x + 2.5, SW_H + 2.59, z + 1.1, x - 2.5, SW_H + 2.59, z + 1.1, x - 2.5, SW_H + 2.74, z - 1.2, x + 2.5, SW_H + 2.74, z - 1.2);
    w.mat('stainless', { uv: 'local' });
    w.box(x - 1.8, SW_H + 0.42, z - 0.75, x + 1.8, SW_H + 0.47, z - 0.4, ALL);
    for (const dx of [-1.6, 0, 1.6]) w.box(x + dx - 0.03, SW_H, z - 0.6, x + dx + 0.03, SW_H + 0.42, z - 0.55, SIDES);
    c.phys.box([x, 0.4, z - 0.6], [3.6, 0.5, 0.4]);
    // back panel with an advert photo
    w.mat('glass', { tint: 0x1a2024 });
    w.box(x - 2.2, SW_H + 0.3, z - 0.92, x + 2.2, SW_H + 2.4, z - 0.88, PZ | NZ);
    const ad = c.signs?.any('poster', rng);
    if (ad) { w.atlas('sign', { e0: 0.8, ao: 1 }); w.quad(x - 1.0, SW_H + 0.6, z - 0.86, x + 1.0, SW_H + 0.6, z - 0.86, x + 1.0, SW_H + 2.2, z - 0.86, x - 1.0, SW_H + 2.2, z - 0.86, [ad.u0, ad.v0, ad.u1, ad.v1]); c.lights.add({ p: new THREE.Vector3(x, SW_H + 1.4, z - 0.6), color: new THREE.Color(0xf0f6ff), intensity: 3, range: 4, glow: 0.6, kind: 'sign' }); }
    // bus stop pole sign
    w.mat('galv', { uv: 'local' }); w.cyl(x + 3, SW_H, z + 1.0, 0.04, 0.04, 2.8, 6, 1);
    w.mat('metal_paint', { tint: 0x2a62b8, uv: 'local' }); w.box(x + 2.75, SW_H + 2.2, z + 0.98, x + 3.25, SW_H + 2.8, z + 1.02, ALL);
  }
  // ---------------------------------------------------------------- motorcycle-taxi stand (win)
  {
    const mt = A.moto_taxi_stand.p;
    const x = mt[0], z = mt[2];
    w.put(P.bench(), x + 0.2, SW_H, z - 0.5, 0);
    w.put(P.vestRail(), x - 1.4, SW_H, z - 0.35, 0);
    w.mat('tarp', { tint: 0xe86a1a, uv: 'local', ao: 0.95 });
    w.quad(x - 2.8, SW_H + 2.5, z + 1.4, x + 1.6, SW_H + 2.5, z + 1.4, x + 1.6, SW_H + 2.75, z - 0.9, x - 2.8, SW_H + 2.75, z - 0.9);
    w.quad(x + 1.6, SW_H + 2.49, z + 1.4, x - 2.8, SW_H + 2.49, z + 1.4, x - 2.8, SW_H + 2.74, z - 0.9, x + 1.6, SW_H + 2.74, z - 0.9);
    w.mat('steel_rust', { uv: 'local' });
    for (const [dx, dz] of [[-2.7, 1.3], [1.5, 1.3]]) { w.cyl(x + dx, SW_H, z + dz, 0.03, 0.03, 2.5, 5, 0); c.phys.box([x + dx, 1.3, z + dz], [0.08, 2.5, 0.08]); }
    const vs = c.signs?.any('moto', rng);
    if (vs) { w.atlas('sign', { e0: 0, ao: 1 }); w.quad(x - 2.6, SW_H + 1.6, z - 0.88, x - 0.6, SW_H + 1.6, z - 0.88, x - 0.6, SW_H + 2.4, z - 0.88, x - 2.6, SW_H + 2.4, z - 0.88, [vs.u0, vs.v0, vs.u1, vs.v1]); }
    for (let k = 0; k < 4; k++) { w.put(P.motorbike(rng.pick(BIKE_COLS)), x + 2.4 + k * 0.85, SW_H, z + 1.6, Math.PI + rng.range(-0.15, 0.15), 1, { rz: 0.08 }); c.phys.box([x + 2.4 + k * 0.85, 0.6, z + 1.6], [0.4, 1.0, 1.4]); }
  }
  // ---------------------------------------------------------------- street-name / traffic signs (real photo signs on steel poles)
  const signPole = (x: number, z: number, yaw: number, cat: string, wd: number, top = 2.9) => {
    const r = c.signs?.any(cat, rng);
    if (!r) return;
    const hh = wd / Math.max(0.3, r.aspect);
    w.mat('galv', { tint: 0xc8c8c4, ov: 'steel_rust', ovAmt: 0.3, uv: 'local' });
    w.cyl(x, SW_H, z, 0.035, 0.035, top + 0.1, 6, 1);
    c.phys.box([x, 1.5, z], [0.08, 3, 0.08]);
    w.pushT(x, 0, z, yaw);
    w.mat('metal_paint', { tint: 0x9a9a98, uv: 'local' });
    w.box(-wd / 2, top - hh, -0.04, wd / 2, top, -0.02, ALL);
    w.atlas('sign', { e0: 0, ao: 1 });
    w.quad(-wd / 2, top - hh, -0.015, wd / 2, top - hh, -0.015, wd / 2, top, -0.015, -wd / 2, top, -0.015, [r.u0, r.v0, r.u1, r.v1]);
    w.atlas('sign', { e0: 0, ao: 0.7, tint: 0x9a9a9a });
    w.quad(wd / 2, top - hh, -0.045, -wd / 2, top - hh, -0.045, -wd / 2, top, -0.045, wd / 2, top, -0.045, [r.u1, r.v0, r.u0, r.v1]);
    w.pop();
  };
  signPole(-5.6, 1.2, Math.PI, 'soi', 1.1, 3.1);           // soi name at the mouth (faces the main road)
  signPole(5.6, 1.2, Math.PI, 'street', 1.2, 3.1);
  signPole(-3.95, -40, -Math.PI / 2, 'traffic', 0.5, 2.6);
  signPole(3.95, -70, Math.PI / 2, 'traffic', 0.5, 2.6);
  signPole(-3.95, -120, -Math.PI / 2, 'traffic', 0.5, 2.6);
  signPole(-20, 1.0, Math.PI, 'street_dir', 1.4, 3.6);
  signPole(60, 25.2, 0, 'street_dir', 1.4, 3.6);
  signPole(-6.0, -154.5, 0, 'soigate', 1.2, 3.0);
  if (c.signs?.any('lot', rng)) { const r = c.signs.any('lot', rng)!; w.atlas('sign', { ao: 0.9 }); w.quad(-6.02, SW_H + 0.4, -88.5, -6.02, SW_H + 0.4, -90.5, -6.02, SW_H + 1.4, -90.5, -6.02, SW_H + 1.4, -88.5, [r.u0, r.v0, r.u1, r.v1]); }
  // ---------------------------------------------------------------- pedestrian overpass at x -45
  overpass(c);
  // phone booth + extra ATM
  w.put(P.phoneBooth(), -14.5, SW_H, 0.8, 0);
  c.phys.box([-14.5, 1.2, 0.8], [0.9, 2.3, 0.8]);
  w.put(P.phoneBooth(), 33, SW_H, 25.4, Math.PI);
  c.phys.box([33, 1.2, 25.4], [0.9, 2.3, 0.8]);
  // ---------------------------------------------------------------- posters & loan stickers on poles
  for (const [px, pz] of allPoles) {
    if (rng.chance(0.4)) continue;
    const ps = (rng.chance(0.6) ? c.decals?.get('decal_flyers_loan_cluster_photo') : null) ?? c.signs?.poster(rng);
    if (!ps) break;
    const sideN = px < -3 ? [1, 0] : px > 3 ? [-1, 0] : pz < 10 ? [0, 1] : [0, -1];
    wallDecal(w, ps, px + sideN[0] * 0.17, SW_H + rng.range(1.2, 1.8), pz + sideN[1] * 0.17, sideN[0], sideN[1], 0.3, 0.42, { alpha: 0.95 });
  }
  // ---------------------------------------------------------------- weeds in cracks, at wall bases and curbs; potted plants at shop fronts
  if (F) {
    for (let i = 0; i < 260; i++) {
      const t = rng.int(0, 3);
      let x: number, z: number, y = SW_H;
      if (t === 0) { x = rng.chance(0.5) ? -5.95 : 5.95; z = rng.range(-157, -1); }
      else if (t === 1) { x = rng.chance(0.5) ? SOI.x0 + 0.05 : SOI.x1 - 0.05; z = rng.range(-157, 4); y = 0; }
      else if (t === 2) { x = rng.range(-128, 128); z = rng.chance(0.5) ? MAIN.swN0 + 0.08 : MAIN.swS1 - 0.08; }
      else { x = rng.range(-128, 128); z = rng.chance(0.5) ? MAIN.z0 + 0.06 : MAIN.z1 - 0.06; y = 0; }
      if (!ok(x, z, 0.3)) continue;
      weeds(w, F, x, y, z, rng, rng.range(0.5, 1.1));
    }
    for (let i = 0; i < 46; i++) {
      const side = rng.chance(0.5) ? -1 : 1;
      const x = side * rng.range(5.4, 5.9), z = rng.range(-150, -2);
      if (!okT(x, z, 0.6)) continue;
      pottedPlant(w, F, x, SW_H, z, rng);
    }
    for (let x = -124; x < 124; x += rng.range(6, 16)) if (ok(x, 0.5, 0.5)) pottedPlant(w, F, x, SW_H, 0.45, rng);
    // banana clumps & palms poking out of gaps (the soi fades into green toward the canal)
    for (const [x, z] of [[-21, -54.2], [-20.5, -99], [24, -40.8], [-31, -146], [8.5, -81]] as [number, number][]) bananaTree(w, F, x, SW_H, z, rng, 0.9);
    for (const [x, z] of [[-34, -100], [55, -38], [-70, -42], [96, -40], [-100, 40], [120, 42]] as [number, number][]) coconutPalm(w, F, x, 0.15, z, rng, 1);
    for (const [x, z] of [[-9.5, -146.2], [13.6, -16.5]] as [number, number][]) bougainvillea(w, F, x, SW_H, z, rng, 1.2);
  }
  // ---------------------------------------------------------------- road closures at the map edges (physical blockers)
  for (const sx of [-1, 1]) {
    const x = sx * 128.5;
    for (let z = MAIN.z0 + 0.6; z < MAIN.z1; z += 1.95) w.put(P.barrier(z % 3.9 < 1.95 ? 0xd02020 : 0xf0f0ec), x, 0, z, Math.PI / 2);
    for (let z = MAIN.z0 + 1; z < MAIN.z1; z += 3) w.put(P.cone(), x - sx * 1.6, 0, z, 0);
    pickupAt(0xe8e4dc, x + sx * 3.5, 10, sx > 0 ? 0 : Math.PI);
    c.phys.box([x, 2, 14], [1.2, 4, 26]);
    c.phys.box([x, 2, (CROAD.z0 + CROAD.z1) / 2], [1.2, 4, 10]);
    for (let z = CROAD.z0 + 0.5; z < CROAD.sw1; z += 1.95) w.put(P.barrier(0xd02020), x, 0, z, Math.PI / 2);
  }
  w.setGroup('base');
  // ---------------------------------------------------------------- invisible bounds (natural blockers are in front of these)
  c.phys.box([0, 3, 89], [270, 6, 1]);
  c.phys.box([0, 3, -270], [270, 6, 1]);
  c.phys.box([-130.5, 3, -90], [1, 6, 360]);
  c.phys.box([130.5, 3, -90], [1, 6, 360]);
  void flat; void groundDecal; void EMIS; void PX; void NX; void PY; void NY; void PZ; void NZ;
}

function overpass(c: Ctx) {
  const w = c.w;
  const x = -45, y = 5.6, zN = 4.3, zS = 23.7, wd = 1.4;
  const deck = (z0: number, z1: number) => {
    w.mat('concrete_old', { tint: 0xb8b2a8, ov: 'concrete_streaked', ovAmt: 0.6 });
    w.box(x - wd, y - 0.35, z0, x + wd, y, z1, ALL);
    w.mat('metal_paint', { tint: 0x3a6a9a, ov: 'steel_rust', ovAmt: 0.5, uv: 'local' });
    for (const sx of [-1, 1]) {
      w.box(x + sx * wd - 0.04, y, z0, x + sx * wd + 0.04, y + 1.1, z0 + 0.06, ALL);
      w.box(x + sx * wd - 0.04, y + 1.05, z0, x + sx * wd + 0.04, y + 1.15, z1, ALL);
      for (let z = z0; z < z1; z += 0.18) w.box(x + sx * wd - 0.015, y, z, x + sx * wd + 0.015, y + 1.05, z + 0.02, PX | NX);
    }
  };
  deck(zN, zS);
  c.phys.box([x, y - 0.17, (zN + zS) / 2], [wd * 2, 0.35, zS - zN]);
  c.phys.box([x - wd, y + 0.6, (zN + zS) / 2], [0.1, 1.2, zS - zN]);
  c.phys.box([x + wd, y + 0.6, (zN + zS) / 2], [0.1, 1.2, zS - zN]);
  // piers
  w.mat('concrete_old', { tint: 0xa8a29a, ov: 'concrete_streaked', ovAmt: 0.6 });
  for (const z of [zN + 0.5, 14, zS - 0.5]) { w.box(x - 0.45, 0, z - 0.45, x + 0.45, y - 0.35, z + 0.45, SIDES); c.phys.box([x, (y - 0.35) / 2, z], [0.9, y - 0.35, 0.9]); }
  // stairs (each side, running along the sidewalk)
  const stairs = (zc: number) => {
    // steps run east along the sidewalk, highest step next to the deck
    const n = 26, rise = (y - SW_H) / n, run = 0.3;
    w.mat('concrete_old', { tint: 0xb0aaa0 });
    for (let i = 0; i < n; i++) {
      const x0 = x + wd + 0.2 + i * run, x1 = x0 + run;
      const top = SW_H + rise * (n - i);
      w.box(x0, SW_H, zc - 0.8, x1, top, zc + 0.8, PY | NZ | PZ | PX);
      c.phys.box([(x0 + x1) / 2, top / 2, zc], [run, top, 1.6]);
    }
    w.mat('metal_paint', { tint: 0x3a6a9a, uv: 'local' });
    for (const s2 of [-1, 1]) w.tube([x + wd + 0.2, y + 1.0, zc + s2 * 0.8, x + wd + 0.2 + n * run, SW_H + 1.0, zc + s2 * 0.8], 0.03, 4);
  };
  stairs(zN + 0.9);
  stairs(zS - 0.9);
  // landing platforms joining stairs and deck
  w.mat('concrete_old', { tint: 0xb8b2a8 });
  w.box(x - wd, y - 0.35, zN - 0.2, x + wd + 0.25, y, zN + 1.8, ALL);
  w.box(x - wd, y - 0.35, zS - 1.8, x + wd + 0.25, y, zS + 0.2, ALL);
  // banners hung on the overpass (real photo adverts)
  const ad = c.signs?.any('banner', c.rng) ?? c.signs?.pick('shop', 5, c.rng)?.r ?? null;
  if (ad) {
    w.atlas('sign', { e0: 0.4, ao: 1 });
    w.quad(x + wd + 0.05, y - 1.6, 8, x + wd + 0.05, y - 1.6, 12, x + wd + 0.05, y - 0.4, 12, x + wd + 0.05, y - 0.4, 8, [ad.u0, ad.v0, ad.u1, ad.v1]);
    w.quad(x - wd - 0.05, y - 1.6, 20, x - wd - 0.05, y - 1.6, 16, x - wd - 0.05, y - 0.4, 16, x - wd - 0.05, y - 0.4, 20, [ad.u0, ad.v0, ad.u1, ad.v1]);
  }
}
