import * as THREE from 'three';
import { RNG } from '../../core/rng';
import { WB, ALL, SIDES, PX, NX, PY, NY, PZ, NZ } from './geo';
import { Shophouse, ShopCtx, buildRows } from './shophouse';
import type { FoliageSys } from './foliage';
import { canopyTree, weeds, grassPatch, bananaTree, coconutPalm, pottedPlant, bougainvillea } from './foliage';
import { flat, groundDecal } from './streets';
import { PLASTIC_COLORS } from './props';
import { EMIS } from './mats';
import { SW_H, SEVEN, CLOSED_HOUSE, APARTMENT, LOT, SPIRIT_LOT, TEMPLE, OFFICE, WHOLESALE, MAIN, UnitSpec, MARKET } from './layout';

export interface SpecialCtx extends ShopCtx { rng: RNG; holes: { x0: number; z0: number; x1: number; z1: number }[]; fol: FoliageSys | null }

/** helper: wall with holes on an arbitrary axis-aligned plane via a temporary frame */
function frame(w: WB, x: number, z: number, yaw: number, fn: () => void) { w.pushT(x, 0, z, yaw); fn(); w.pop(); }

export function buildSpecial(c: SpecialCtx) {
  sevenTwelve(c);
  closedHouse(c);
  apartment(c);
  officeTower(c);
  wholesale(c);
  temple(c);
  spiritLot(c);
  vacantLot(c);
  backBlocks(c);
}

// ======================================================================== 8-TWELVE (shell only)
function sevenTwelve(c: SpecialCtx) {
  const w = c.w, sh = new Shophouse(c);
  // upper floors via the shophouse generator (3 units of 5 m), no ground floor, no canopy
  const units: UnitSpec[] = [
    { face: 'W', line: SEVEN.x0, a0: -15, a1: -10, depth: 14, storeys: 4, noGround: true, noCanopy: true, noSign: true, wall: 'plaster', tint: 0xe8e2d4 },
    { face: 'W', line: SEVEN.x0, a0: -10, a1: -5, depth: 14, storeys: 4, noGround: true, noCanopy: true, noSign: true, wall: 'plaster', tint: 0xe8e2d4 },
    { face: 'W', line: SEVEN.x0, a0: -5, a1: 0, depth: 14, storeys: 4, noGround: true, noCanopy: true, noSign: true, wall: 'plaster', tint: 0xe8e2d4, corner: 'right' },
  ];
  units[0].corner = 'left';
  units.forEach((u, i) => sh.build(u, { left: i === 0 ? 0 : 99, right: i === 2 ? 0 : 99, mergeL: i > 0, mergeR: i < 2 }, 900 + i));
  const x0 = SEVEN.x0, x1 = SEVEN.x0 + 14, z0 = SEVEN.z0, z1 = SEVEN.z1;
  const y0 = SW_H, yT = y0 + 3.55;            // ceiling of the store
  const yF = 4.15;                            // first floor (shophouse h0 is ~3.75-4.2; the fascia hides the joint)
  // floor + ceiling + inner walls
  w.mat('tiles_floor', { tint: 0xf4f2ee, autoDirt: false, ao: 0.95 });
  flat(w, x0 + 0.1, z0 + 0.1, x1 - 0.2, z1 - 0.1, y0 + 0.004, 6);
  c.phys.box([(x0 + x1) / 2, y0 / 2, (z0 + z1) / 2], [x1 - x0, y0, z1 - z0]);
  w.mat('plaster', { tint: 0xf4f4f0, ao: 0.9 });
  w.quad(x0, yT, z0, x1, yT, z0, x1, yT, z1, x0, yT, z1); // ceiling faces down? (a→b along +x at z0, c at z1) → normal -y
  w.mat('tiles_wall', { tint: 0xf8f8f4, ao: 0.85 });
  w.quad(x1 - 0.2, y0, z1, x1 - 0.2, y0, z0, x1 - 0.2, yT, z0, x1 - 0.2, yT, z1);   // back wall (faces -x)
  w.quad(x0, y0, z0 + 0.12, x1, y0, z0 + 0.12, x1, yT, z0 + 0.12, x0, yT, z0 + 0.12); // north wall (faces +z)
  // staff door at the back
  w.mat('alu', { tint: 0xd8d8d4 });
  w.box(x1 - 0.24, y0, -4.2, x1 - 0.2, y0 + 2.1, -3.2, NX);
  // ceiling light panels (store palette: on day & night)
  for (let x = x0 + 1.4; x < x1 - 0.8; x += 2.4) for (let z = z0 + 1.6; z < z1 - 0.8; z += 2.6) {
    w.mat('plastic', { tint: 0xffffff, emis: EMIS.store.i, emisK: 0.75 });
    w.box(x - 0.6, yT - 0.03, z - 0.15, x + 0.6, yT, z + 0.15, NY);
  }
  for (let x = x0 + 2; x < x1; x += 4.5) for (let z = z0 + 2.5; z < z1; z += 5) c.lights.add({ p: new THREE.Vector3(x, yT - 0.3, z), color: new THREE.Color(0xf0f8ff), intensity: 16, range: 11, glow: 0, kind: 'store', day: 0.9, prio: 1.6 });
  // glass fronts: west (soi) with the door gap at z -10.2..-7.8, south (main road)
  const doorZ0 = -10.3, doorZ1 = -7.7;
  const mull = (x: number, z: number, along: 'x' | 'z') => {
    w.mat('alu', { tint: 0xc8ccd0, uv: 'local' });
    if (along === 'z') w.box(x - 0.04, y0, z - 0.04, x + 0.04, yT, z + 0.04, ALL & ~NY);
    else w.box(x - 0.04, y0, z - 0.04, x + 0.04, yT, z + 0.04, ALL & ~NY);
  };
  const glassPane = (ax: number, az: number, bx: number, bz: number) => {
    w.glass({ tint: 0xdfe8ea, alpha: 0.16 });
    w.quad(ax, y0 + 0.05, az, bx, y0 + 0.05, bz, bx, yT, bz, ax, yT, az);
  };
  const gx = x0 + 0.08;
  for (let z = z0 + 0.3; z < z1 - 0.2; z += 1.3) {
    const ze = Math.min(z1 - 0.15, z + 1.3);
    if (ze > doorZ0 && z < doorZ1) continue;
    glassPane(gx, ze, gx, z);
    mull(gx, z, 'z');
  }
  mull(gx, doorZ0, 'z'); mull(gx, doorZ1, 'z');
  // automatic sliding door leaves pulled open
  w.glass({ tint: 0xdfe8ea, alpha: 0.18 });
  w.quad(gx - 0.12, y0 + 0.05, doorZ0 + 0.05, gx - 0.12, y0 + 0.05, doorZ0 - 1.15, gx - 0.12, y0 + 2.4, doorZ0 - 1.15, gx - 0.12, y0 + 2.4, doorZ0 + 0.05);
  w.quad(gx - 0.12, y0 + 0.05, doorZ1 + 1.15, gx - 0.12, y0 + 0.05, doorZ1 - 0.05, gx - 0.12, y0 + 2.4, doorZ1 - 0.05, gx - 0.12, y0 + 2.4, doorZ1 + 1.15);
  w.mat('alu', { tint: 0xc8ccd0, uv: 'local' });
  w.box(gx - 0.15, y0 + 2.4, doorZ0 - 1.2, gx + 0.05, y0 + 2.6, doorZ1 + 1.2, ALL);
  // south glazing
  const gz = z1 - 0.08;
  for (let x = x0 + 0.3; x < x1 - 0.3; x += 1.3) { const xe = Math.min(x1 - 0.2, x + 1.3); glassPane(x, gz, xe, gz); mull(x, gz, 'x'); }
  // low wall under the glass + corner column
  w.mat('tiles_wall', { tint: 0xe0e0dc });
  w.box(x0, y0, z0, x0 + 0.12, y0 + 0.05, z1, PX | NX | PY);
  w.mat('plaster', { tint: 0xe8e2d4 });
  w.box(x0 - 0.05, y0, z1 - 0.35, x0 + 0.35, yF, z1 + 0.05, ALL & ~NY);
  // fascia band: real convenience-store sign photo if available, else green/orange/red stripes (paint)
  const fy0 = yT, fy1 = yF + 0.5;
  w.mat('metal_paint', { tint: 0xf4f4f0 });
  w.box(x0 - 0.35, fy0, z0, x0, fy1, z1 + 0.35, PX | NX | PY | NY | NZ);
  w.box(x0 - 0.35, fy0, z1, x1, fy1, z1 + 0.35, PZ | PY | NY | PX);
  const signR = c.signs?.pick('convenience', 6, c.rng);
  const stripes: [number, number][] = [[0x1e8a4a, 0.34], [0xf08a20, 0.34], [0xd8282a, 0.34]];
  if (signR) {
    w.atlas('sign', { e0: 0.6, ao: 1 });
    const r = signR.r;
    w.quad(x0 - 0.36, fy0 + 0.05, z1 - 0.2, x0 - 0.36, fy0 + 0.05, z0 + 0.2, x0 - 0.36, fy1 - 0.05, z0 + 0.2, x0 - 0.36, fy1 - 0.05, z1 - 0.2, [r.u0, r.v0, r.u1, r.v1]);
    w.quad(x0 + 0.2, fy0 + 0.05, z1 + 0.36, x1 - 0.2, fy0 + 0.05, z1 + 0.36, x1 - 0.2, fy1 - 0.05, z1 + 0.36, x0 + 0.2, fy1 - 0.05, z1 + 0.36, [r.u0, r.v0, r.u1, r.v1]);
  } else {
    let y = fy0 + 0.12;
    for (const [col, h] of stripes) {
      w.mat('plastic_gloss', { tint: col, emis: EMIS.store.i, emisK: 0.08 });
      w.quad(x0 - 0.36, y, z1 + 0.35, x0 - 0.36, y, z0, x0 - 0.36, y + h, z0, x0 - 0.36, y + h, z1 + 0.35);
      w.quad(x0 - 0.35, y, z1 + 0.36, x1, y, z1 + 0.36, x1, y + h, z1 + 0.36, x0 - 0.35, y + h, z1 + 0.36);
      y += h;
    }
  }
  c.lights.add({ p: new THREE.Vector3(x0 - 1.2, yT, -7.5), color: new THREE.Color(0xf4fbff), intensity: 0, range: 0, glow: 2.4, kind: 'sign', day: 0.2 });
  c.lights.groundPool(new THREE.Vector3(x0 - 1.4, SW_H + 0.01, -7.5), 4.5, 0xe8f4ff, 1.0);
  c.lights.groundPool(new THREE.Vector3(13, SW_H + 0.01, 1.6), 4.5, 0xe8f4ff, 1.0);
  // colliders: back + north walls, glass fronts with the door gap
  c.phys.box([x1 - 0.1, 2, (z0 + z1) / 2], [0.3, 4, z1 - z0]);
  c.phys.box([(x0 + x1) / 2, 2, z0 + 0.06], [x1 - x0, 4, 0.2]);
  c.phys.box([gx, 2, (z0 + doorZ0) / 2], [0.12, 4, doorZ0 - z0]);
  c.phys.box([gx, 2, (doorZ1 + z1) / 2], [0.12, 4, z1 - doorZ1]);
  c.phys.box([(x0 + x1) / 2, 2, gz], [x1 - x0, 4, 0.12]);
  // ATM + ice chest outside, bins
  w.setGroup('detail');
  w.put(c.props.atm(), x0 - 0.45, SW_H, -13.3, -Math.PI / 2);
  c.phys.box([x0 - 0.45, 1.1, -13.3], [0.8, 2.2, 0.8]);
  w.put(c.props.bin(0x2a7a3a), x0 - 0.5, SW_H, -1.6, -Math.PI / 2);
  w.setGroup('base');
  // shelf anchors for the shops module (gondola lines in the store)
  for (let i = 0; i < 3; i++) c.anchors[`shelf:convenience_store:${i}`] = { p: [x0 + 4.0 + i * 2.6, SW_H, -6.5], yaw: 0, r: 3.5 };
  c.anchors['shelf:convenience_store:fridge'] = { p: [x1 - 0.8, SW_H, -8.0], yaw: Math.PI / 2, r: 5 };
}

// ======================================================================== CLOSED SHOPHOUSE + AWNING + APRON
function closedHouse(c: SpecialCtx) {
  const w = c.w;
  const units: UnitSpec[] = [-30.5, -25.67, -20.83].map((a, i) => ({
    face: 'W' as const, line: CLOSED_HOUSE.x0, a0: a, a1: a + 4.83, depth: 13.6, storeys: 3, shop: 'closed', ground: 'closed' as const, awning: 'none' as const, sign: 'old', noSign: i === 1, wall: 'plaster_peeling', tint: 0xd8cbb0,
  }));
  buildRows(c, [units]);
  // big corrugated awning over the apron on steel posts (posts only at the corners: tables area stays free)
  const ax0 = 7.9, ax1 = CLOSED_HOUSE.x0, az0 = CLOSED_HOUSE.z0 + 0.4, az1 = CLOSED_HOUSE.z1 - 0.4;
  const yHi = 3.75, yLo = 3.15;
  w.mat('corr_rust', { uv: 'world', ao: 0.95 });
  w.quad(ax0, yLo, az1, ax0, yLo, az0, ax1, yHi, az0, ax1, yHi, az1);
  w.quad(ax0, yLo - 0.01, az0, ax0, yLo - 0.01, az1, ax1, yHi - 0.01, az1, ax1, yHi - 0.01, az0);
  // translucent fibreglass panels (lighter strips)
  w.mat('roof_fibre', { tint: 0xe8e0c0, uv: 'world' });
  for (const z of [-27, -19.5]) w.quad(ax0 + 0.01, yLo + 0.01, z + 1.0, ax0 + 0.01, yLo + 0.01, z, ax1, yHi + 0.01, z, ax1, yHi + 0.01, z + 1.0);
  w.mat('steel_rust', { uv: 'local' });
  for (const z of [az0 + 0.1, az1 - 0.1]) { w.box(ax0 - 0.05, SW_H, z - 0.05, ax0 + 0.05, yLo, z + 0.05, SIDES); c.phys.box([ax0, 1.7, z], [0.12, 3.2, 0.12]); }
  w.box(ax0 - 0.06, yLo - 0.22, az0, ax0 + 0.06, yLo, az1, ALL);
  for (let z = az0 + 1.5; z < az1; z += 2.4) w.tube([ax0, yLo - 0.15, z, ax1 - 0.1, yHi - 0.25, z], 0.03, 4);
  // gutter + fluorescent tube under the awning (lights the cart area at night)
  w.mat('galv', { uv: 'local' });
  w.box(ax0 - 0.12, yLo - 0.12, az0, ax0 - 0.02, yLo, az1, ALL);
  w.setGroup('detail');
  w.put(c.props.tube(), 10.6, yLo + 0.2, -23, Math.PI / 2);
  w.put(c.props.tube(), 10.6, yLo + 0.2, -18.5, Math.PI / 2);
  w.setGroup('base');
  c.lights.add({ p: new THREE.Vector3(10.6, yLo, -21), color: new THREE.Color(0xe8f6ff), intensity: 14, range: 10, glow: 0.8, kind: 'tube', prio: 2 });
  // apron grime: oil stains, cracks (decals)
  const D = c.decals;
  if (D) for (let i = 0; i < 8; i++) {
    const k = c.rng.int(0, 3);
    groundDecal(w, D.cell('decal_oil_stains', k % 2, k >> 1, 2, 2), c.rng.range(6.5, 13), SW_H + 0.006, c.rng.range(-30, -15.5), c.rng.range(0.8, 1.6), c.rng.range(0.8, 1.6), c.rng.range(0, 6), { alpha: 0.6 });
  }
}

// ======================================================================== APARTMENT (ห้องเช่า)
function apartment(c: SpecialCtx) {
  const A = APARTMENT;
  const units: UnitSpec[] = [];
  const n = 5, W = (A.z1 - A.z0) / n;
  for (let i = 0; i < n; i++) units.push({
    face: 'E', line: A.x1, a0: A.z0 + i * W, a1: A.z0 + (i + 1) * W, depth: A.x1 - A.x0, storeys: A.storeys, style: 'apartment',
    shop: i === 2 ? 'residence' : 'residence', ground: i === 2 ? 'gate' : 'open', wall: 'plaster', tint: 0xe6d6c0, noSign: i !== 2, sign: 'apartment',
    corner: i === 0 ? 'left' : i === n - 1 ? 'right' : undefined, awning: 'none',
  });
  buildRows(c, [units]);
}

// ======================================================================== OFFICE TOWER
function officeTower(c: SpecialCtx) {
  const w = c.w, rng = c.rng;
  const O = OFFICE;
  const floors = O.storeys, fh = 3.7, podium = 2;
  const H = SW_H + floors * fh;
  // podium (granite + glass lobby)
  w.mat('marble', { tint: 0x8a8680, ov: 'concrete_streaked', ovAmt: 0.4 });
  w.box(O.x0 - 2, 0, O.z0, O.x1 + 2, SW_H + podium * fh, O.z1 + 1, ALL & ~NY);
  w.glass({ tint: 0xc8d8dc, alpha: 0.35 });
  w.quad(O.x0 + 6, SW_H + 0.05, O.z1 + 1.02, O.x1 - 6, SW_H + 0.05, O.z1 + 1.02, O.x1 - 6, SW_H + 4.6, O.z1 + 1.02, O.x0 + 6, SW_H + 4.6, O.z1 + 1.02);
  // lobby interior glow
  w.mat('marble', { tint: 0xd8d0c0, emis: EMIS.shopwarm.i, emisK: 0.15 });
  w.quad(O.x1 - 6, SW_H, O.z1 + 0.6, O.x0 + 6, SW_H, O.z1 + 0.6, O.x0 + 6, SW_H + 4.6, O.z1 + 0.6, O.x1 - 6, SW_H + 4.6, O.z1 + 0.6);
  // canopy over the entrance
  w.mat('alu', { tint: 0xb8bcc0 });
  w.box(-50, SW_H + 4.7, O.z1 + 1, -40, SW_H + 5.0, O.z1 + 5, ALL);
  // tower: spandrel bands + glass strips (lit floors at night)
  for (let f = podium; f < floors; f++) {
    const y = SW_H + f * fh;
    w.mat('concrete_streaked', { tint: 0xb8b4ac });
    w.box(O.x0, y, O.z0, O.x1, y + 1.1, O.z1, SIDES);
    const lit = rng.chance(0.55);
    w.mat('glass', { tint: rng.pick([0x30404a, 0x28343c, 0x3a4a50]), emis: lit ? EMIS.cool.i : 0, emisK: rng.range(0.15, 0.4) });
    w.box(O.x0 + 0.15, y + 1.1, O.z0 + 0.15, O.x1 - 0.15, y + fh, O.z1 - 0.15, SIDES);
    w.mat('alu', { tint: 0x9aa0a4, uv: 'local' });
    for (let x = O.x0 + 1.5; x < O.x1; x += 1.5) { w.box(x - 0.05, y + 1.1, O.z1 - 0.2, x + 0.05, y + fh, O.z1 - 0.05, PZ | PX | NX); w.box(x - 0.05, y + 1.1, O.z0 + 0.05, x + 0.05, y + fh, O.z0 + 0.2, NZ | PX | NX); }
    for (let z = O.z0 + 1.5; z < O.z1; z += 1.5) { w.box(O.x1 - 0.2, y + 1.1, z - 0.05, O.x1 - 0.05, y + fh, z + 0.05, PX | PZ | NZ); w.box(O.x0 + 0.05, y + 1.1, z - 0.05, O.x0 + 0.2, y + fh, z + 0.05, NX | PZ | NZ); }
  }
  w.mat('roof_slab');
  w.box(O.x0, H, O.z0, O.x1, H + 0.6, O.z1, ALL & ~NY);
  w.mat('galv', { tint: 0x8a8e90 });
  w.box(O.x0 + 6, H + 0.6, O.z0 + 5, O.x0 + 16, H + 4, O.z0 + 14, ALL & ~NY);
  w.cyl(O.x1 - 6, H + 0.6, O.z0 + 8, 0.15, 0.08, 12, 6, 1);
  c.lights.add({ p: new THREE.Vector3(O.x1 - 6, H + 12.6, O.z0 + 8), color: new THREE.Color(0xff2020), intensity: 0, range: 0, glow: 1.2, kind: 'sign', day: 0.3 });
  const sign = c.signs?.pick('office', 5, rng);
  if (sign) {
    w.atlas('sign', { e0: 1, ao: 1 });
    const r = sign.r;
    w.quad(O.x0 + 8, H - 4, O.z1 + 0.05, O.x1 - 8, H - 4, O.z1 + 0.05, O.x1 - 8, H - 0.5, O.z1 + 0.05, O.x0 + 8, H - 0.5, O.z1 + 0.05, [r.u0, r.v0, r.u1, r.v1]);
  }
  c.phys.box([(O.x0 + O.x1) / 2, H / 2, (O.z0 + O.z1 + 1) / 2], [O.x1 - O.x0 + 4, H, O.z1 - O.z0 + 1]);
  // plaza: planters with palms, security booth, motorbike parking
  w.mat('concrete_old', { tint: 0xb0aaa0 });
  for (const x of [-60, -52, -36, -30]) {
    w.box(x - 1.2, SW_H, -6, x + 1.2, SW_H + 0.5, -3.6, ALL & ~NY);
    c.phys.box([x, SW_H + 0.25, -4.8], [2.4, 0.5, 2.4]);
    if (c.fol) coconutPalm(w, c.fol, x, SW_H + 0.5, -4.8, rng, 0.7);
  }
  w.mat('metal_paint', { tint: 0xd8d4c8 });
  w.box(-25, SW_H, -7.5, -23, SW_H + 2.6, -5.5, ALL & ~NY);
  w.glass({ alpha: 0.3 }); w.quad(-25.01, SW_H + 1.1, -5.6, -25.01, SW_H + 1.1, -7.4, -25.01, SW_H + 2.2, -7.4, -25.01, SW_H + 2.2, -5.6);
  c.phys.box([-24, 1.4, -6.5], [2, 2.6, 2]);
  w.setGroup('detail');
  for (let i = 0; i < 9; i++) w.put(c.props.motorbike(rng.pick([0xc0302a, 0x1c1c1e, 0x2a62b8, 0xe8e4dc, 0x6a6a6a])), -64 + i * 0.85, SW_H, -7.8, Math.PI + rng.range(-0.15, 0.15), 1, { rz: 0.09 });
  w.setGroup('base');
}

// ======================================================================== WHOLESALE "แม็กโคร่ง"
function wholesale(c: SpecialCtx) {
  const w = c.w, rng = c.rng, Wh = WHOLESALE;
  const x0 = Wh.x0, x1 = Wh.x1, z0 = Wh.z0, z1 = Wh.z1, H = 12;
  const doorX0 = Wh.doorX - 2.6, doorX1 = Wh.doorX + 2.6;
  // walls (corrugated, painted) with the entrance gap
  w.mat('corr_paint', { tint: 0x2a4a9a, ov: 'steel_rust', ovAmt: 0.3, uv: 'world' });
  // north facade pieces (faces -z)
  const north = (a: number, b: number, ya: number, yb: number) => w.quad(b, ya, z0, a, ya, z0, a, yb, z0, b, yb, z0);
  north(x0, doorX0, 0, H); north(doorX1, x1, 0, H); north(doorX0, doorX1, 4.2, H);
  w.mat('corr_paint', { tint: 0xd8d4c8, ov: 'steel_rust', ovAmt: 0.4 });
  w.quad(x0, 0, z0, x0, 0, z1, x0, H, z1, x0, H, z0);   // west (faces -x)
  w.quad(x1, 0, z1, x1, 0, z0, x1, H, z0, x1, H, z1);   // east (faces +x)
  w.quad(x0, 0, z1, x1, 0, z1, x1, H, z1, x0, H, z1);
  w.mat('roof_galv', { tint: 0xb8b8b4 });
  w.quad(x0 - 0.5, H, z1 + 0.5, x1 + 0.5, H, z1 + 0.5, x1 + 0.5, H + 1.6, (z0 + z1) / 2, x0 - 0.5, H + 1.6, (z0 + z1) / 2);
  w.quad(x1 + 0.5, H, z0 - 0.5, x0 - 0.5, H, z0 - 0.5, x0 - 0.5, H + 1.6, (z0 + z1) / 2, x1 + 0.5, H + 1.6, (z0 + z1) / 2);
  // sign band (yellow/red) + sign photo if available
  w.mat('metal_paint', { tint: 0xe8b818 });
  w.box(x0 - 0.2, H - 3.2, z0 - 0.4, x1 + 0.2, H - 0.6, z0 - 0.05, ALL);
  const sg = c.signs?.pick('wholesale', 8, rng);
  if (sg) { w.atlas('sign', { e0: 1, ao: 1 }); const r = sg.r; w.quad(x1 - 8, H - 3.1, z0 - 0.42, x0 + 8, H - 3.1, z0 - 0.42, x0 + 8, H - 0.7, z0 - 0.42, x1 - 8, H - 0.7, z0 - 0.42, [r.u0, r.v0, r.u1, r.v1]); }
  // entrance canopy + glass doors (open gap)
  w.mat('metal_paint', { tint: 0xc02020 });
  w.box(doorX0 - 2, 4.2, z0 - 3.5, doorX1 + 2, 4.6, z0, ALL);
  w.mat('steel_rust', { uv: 'local' });
  for (const x of [doorX0 - 1.8, doorX1 + 1.8]) { w.box(x - 0.08, SW_H, z0 - 3.4, x + 0.08, 4.2, z0 - 3.2, SIDES); c.phys.box([x, 2.2, z0 - 3.3], [0.2, 4.2, 0.2]); }
  w.glass({ alpha: 0.2 });
  w.quad(doorX0 - 1.5, SW_H, z0 - 0.02, doorX0, SW_H, z0 - 0.02, doorX0, 4.0, z0 - 0.02, doorX0 - 1.5, 4.0, z0 - 0.02);
  w.quad(doorX1, SW_H, z0 - 0.02, doorX1 + 1.5, SW_H, z0 - 0.02, doorX1 + 1.5, 4.0, z0 - 0.02, doorX1, 4.0, z0 - 0.02);
  // interior front hall (enterable): floor, back partition, high-bay lights
  const zi = z0 + 18;
  w.mat('concrete_old', { tint: 0xb8b4ac, autoDirt: false });
  flat(w, x0 + 0.2, z0 + 0.1, x1 - 0.2, zi, SW_H + 0.003, 10);
  c.phys.box([(x0 + x1) / 2, SW_H / 2, (z0 + zi) / 2], [x1 - x0, SW_H, zi - z0]);
  w.mat('corr_paint', { tint: 0xe0dcd0, ao: 0.8 });
  w.quad(x0, 0, z0 + 0.1, x1, 0, z0 + 0.1, x1, H, z0 + 0.1, x0, H, z0 + 0.1);
  w.quad(x1, SW_H, zi, x0, SW_H, zi, x0, H, zi, x1, H, zi);
  w.mat('galv', { tint: 0x8a8a88, ao: 0.6 });
  w.quad(x0, H - 0.5, z0, x1, H - 0.5, z0, x1, H - 0.5, zi, x0, H - 0.5, zi);
  for (let x = x0 + 4; x < x1; x += 8) for (let z = z0 + 4; z < zi; z += 7) {
    w.mat('plastic', { tint: 0xffffff, emis: EMIS.store.i, emisK: 0.6 });
    w.cyl(x, H - 1.3, z, 0.35, 0.25, 0.3, 8, 3);
    c.lights.add({ p: new THREE.Vector3(x, H - 1.5, z), color: new THREE.Color(0xf4f8ff), intensity: 22, range: 14, glow: 0, kind: 'store', day: 0.8 });
  }
  // colliders: walls with the door gap, inner partition
  c.phys.box([(x0 + doorX0) / 2, H / 2, z0], [doorX0 - x0, H, 0.3]);
  c.phys.box([(doorX1 + x1) / 2, H / 2, z0], [x1 - doorX1, H, 0.3]);
  c.phys.box([x0, H / 2, (z0 + z1) / 2], [0.3, H, z1 - z0]);
  c.phys.box([x1, H / 2, (z0 + z1) / 2], [0.3, H, z1 - z0]);
  c.phys.box([(x0 + x1) / 2, H / 2, zi], [x1 - x0, H, 0.3]);
  // parking lot: asphalt + lines + parked vehicles + lamp posts, fence
  const p0 = Wh.parkX0, p1 = Wh.parkX1;
  w.mat('asphalt_soi', { autoDirt: false, tint: 0xb0aca8 });
  flat(w, p0, MAIN.swS1, p1, z1, 0.0, 10);
  c.holes.push({ x0: p0, z0: MAIN.swS1, x1: p1, z1: z1 });
  c.holes.push({ x0: x0 - 4, z0: MAIN.swS1, x1: x1, z1: z1 });
  const D = c.decals;
  const line = D?.get('roadline_white_worn');
  w.setGroup('detail');
  for (let z = 32; z < z1 - 4; z += 2.6) for (const x of [p0 + 2, p0 + 14, p0 + 18, p1 - 2]) {
    if (line) groundDecal(w, line, x + 2.5, 0.006, z, 0.12, 5, Math.PI / 2, { alpha: 0.7 });
  }
  const colors = [0xd8d8d4, 0x1c1c1e, 0x8a8a88, 0xa02020, 0x2a4a7a, 0xe8e4dc];
  for (let i = 0; i < 12; i++) {
    const z = 33 + i * 4.2 + rng.range(-0.3, 0.3);
    if (rng.chance(0.75)) w.put(c.props.pickup(rng.pick(colors)), p0 + 5 + rng.range(-0.2, 0.2), 0, z, Math.PI / 2 + rng.range(-0.05, 0.05)), c.phys.box([p0 + 5, 0.9, z], [5, 1.8, 1.9]);
    if (rng.chance(0.6)) w.put(c.props.pickup(rng.pick(colors)), p1 - 5, 0, z + 1, -Math.PI / 2 + rng.range(-0.05, 0.05)), c.phys.box([p1 - 5, 0.9, z + 1], [5, 1.8, 1.9]);
  }
  w.setGroup('base');
  // perimeter wall + guard booth
  w.mat('cement_block', { ov: 'plaster_moldy', ovAmt: 0.7 });
  w.box(p1, 0, MAIN.swS1 + 2, p1 + 0.25, 2.2, z1, ALL & ~NY);
  w.box(x0 - 4.25, 0, z1, p1 + 0.25, 2.2, z1 + 0.25, ALL & ~NY);
  c.phys.box([p1 + 0.12, 1.1, (MAIN.swS1 + 2 + z1) / 2], [0.25, 2.2, z1 - MAIN.swS1 - 2]);
  w.mat('metal_paint', { tint: 0xe8e4dc });
  w.box(p0 + 9, 0, 28, p0 + 11, 2.6, 30, ALL & ~NY);
  c.phys.box([p0 + 10, 1.3, 29], [2, 2.6, 2]);
  // shelf/rack anchors for the shops module (kept clear around the counter)
  for (let i = 0; i < 4; i++) c.anchors[`shelf:wholesale:${i}`] = { p: [Wh.doorX + 2 + i * 3.5, SW_H, 44], yaw: Math.PI, r: 4 };
}

// ======================================================================== TEMPLE (respectful: wall, gate, roofs behind)
function temple(c: SpecialCtx) {
  const w = c.w, rng = c.rng, T = TEMPLE;
  const wallH = 2.7, zW = T.z0;
  const gx0 = T.gateX - 2.6, gx1 = T.gateX + 2.6;
  const wallSeg = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    const yaw = Math.atan2(bx - ax, bz - az) - Math.PI / 2;
    frame(w, ax, az, yaw, () => {
      w.mat('temple_wall', { ov: 'concrete_mossy', ovAmt: 0.55 });
      w.box(0, 0, -0.18, len, wallH, 0.18, PZ | NZ | PY);
      w.mat('roof_tiles', { tint: 0xb04a2a });
      w.quad(0, wallH, 0.32, len, wallH, 0.32, len, wallH + 0.35, 0, 0, wallH + 0.35, 0);
      w.quad(len, wallH, -0.32, 0, wallH, -0.32, 0, wallH + 0.35, 0, len, wallH + 0.35, 0);
      // pillars every 4 m with lotus caps
      w.mat('temple_wall');
      for (let x = 0; x <= len; x += 4) { w.bevelBox(x - 0.28, 0, -0.28, x + 0.28, wallH + 0.55, 0.28, 0.05); w.mat('brass'); w.cyl(x, wallH + 0.55, 0, 0.16, 0.02, 0.4, 8, 1); w.mat('temple_wall'); }
    });
    c.phys.box([(ax + bx) / 2, wallH / 2 + 0.3, (az + bz) / 2], [Math.abs(bx - ax) + 0.4, wallH + 0.6, Math.abs(bz - az) + 0.4]);
  };
  wallSeg(T.x0, zW, gx0, zW);
  wallSeg(gx1, zW, T.x1, zW);
  wallSeg(T.x0, -142, T.x0, zW);
  wallSeg(T.x1, zW, T.x1, -100);
  // gate: two tall white pillars + Thai gable roof (red/green tiles, gold chofa)
  for (const x of [gx0, gx1]) {
    w.mat('temple_wall');
    w.bevelBox(x - 0.45, 0, zW - 0.45, x + 0.45, 4.6, zW + 0.45, 0.08);
    w.mat('brass');
    w.box(x - 0.5, 4.6, zW - 0.5, x + 0.5, 4.75, zW + 0.5, ALL);
    c.phys.box([x, 2.3, zW], [0.9, 4.6, 0.9]);
  }
  const gy = 4.75, gw = (gx1 - gx0) / 2 + 0.9, gcx = T.gateX;
  for (let tier = 0; tier < 2; tier++) {
    const y = gy + tier * 0.9, hw = gw - tier * 0.6, hd = 1.4 - tier * 0.25, h = 1.5 - tier * 0.3;
    w.mat('roof_tiles', { tint: tier === 0 ? 0xb03a22 : 0x2a6a3a });
    w.quad(gcx - hw, y, zW + hd, gcx + hw, y, zW + hd, gcx + hw * 0.55, y + h, zW, gcx - hw * 0.55, y + h, zW);
    w.quad(gcx + hw, y, zW - hd, gcx - hw, y, zW - hd, gcx - hw * 0.55, y + h, zW, gcx + hw * 0.55, y + h, zW);
    w.mat('brass');
    w.tri(gcx - hw, y, zW + hd, gcx - hw * 0.55, y + h, zW, gcx - hw, y, zW - hd);
    w.tri(gcx + hw, y, zW - hd, gcx + hw * 0.55, y + h, zW, gcx + hw, y, zW + hd);
    w.tube([gcx - hw, y, zW + hd, gcx - hw - 0.3, y + 0.5, zW + hd + 0.15], 0.04, 4);
    w.tube([gcx + hw, y, zW + hd, gcx + hw + 0.3, y + 0.5, zW + hd + 0.15], 0.04, 4);
  }
  // courtyard floor inside + low chain at the gate (visitors respect the temple; not enterable)
  w.mat('tiles_terracotta', { autoDirt: false, tint: 0xd8c8b0 });
  flat(w, T.x0 + 0.3, -149.8, T.x1 - 0.3, -100, 0.15, 10);
  c.holes.push({ x0: T.x0, z0: -150, x1: T.x1, z1: T.z1 });
  w.mat('brass');
  for (const x of [gx0 + 0.6, T.gateX, gx1 - 0.6]) w.cyl(x, 0.15, zW - 0.3, 0.05, 0.05, 0.9, 6, 1);
  w.mat('metal_paint', { tint: 0xc8a020 });
  w.tube(WB.sagLine(gx0 + 0.6, 1.0, zW - 0.3, T.gateX, 1.0, zW - 0.3, 0.12, 6), 0.012, 3);
  w.tube(WB.sagLine(T.gateX, 1.0, zW - 0.3, gx1 - 0.6, 1.0, zW - 0.3, 0.12, 6), 0.012, 3);
  c.phys.box([T.gateX, 0.8, zW - 0.3], [gx1 - gx0, 1.4, 0.2]);
  // ubosot (ordination hall) + viharn: white walls, stacked tiered roofs, gold trim, chofa
  const hall = (cx: number, cz: number, L: number, Wd: number, tiers: number) => {
    const y0 = 0.15 + 1.2;
    w.mat('temple_wall', { ov: 'concrete_mossy', ovAmt: 0.3 });
    w.box(cx - L / 2 - 1, 0.15, cz - Wd / 2 - 1, cx + L / 2 + 1, y0, cz + Wd / 2 + 1, ALL & ~NY);
    w.box(cx - L / 2, y0, cz - Wd / 2, cx + L / 2, y0 + 6.5, cz + Wd / 2, ALL & ~NY);
    w.mat('brass');
    for (let x = cx - L / 2 + 1.5; x < cx + L / 2; x += 3) { w.box(x - 0.5, y0 + 1.2, cz + Wd / 2, x + 0.5, y0 + 4.2, cz + Wd / 2 + 0.05, PZ); w.box(x - 0.5, y0 + 1.2, cz - Wd / 2 - 0.05, x + 0.5, y0 + 4.2, cz - Wd / 2, NZ); }
    let y = y0 + 6.5;
    for (let t = 0; t < tiers; t++) {
      const hw = Wd / 2 + 1.4 - t * 1.1, hl = L / 2 + 1.2 - t * 1.6, h = 4.2 - t * 0.6;
      w.mat('roof_tiles', { tint: t % 2 === 0 ? 0xc0462a : 0x2a6a3a });
      w.quad(cx - hl, y, cz + hw, cx + hl, y, cz + hw, cx + hl, y + h, cz, cx - hl, y + h, cz);
      w.quad(cx + hl, y, cz - hw, cx - hl, y, cz - hw, cx - hl, y + h, cz, cx + hl, y + h, cz);
      w.mat('brass');
      w.tri(cx - hl, y, cz + hw, cx - hl, y + h, cz, cx - hl, y, cz - hw);
      w.tri(cx + hl, y, cz - hw, cx + hl, y + h, cz, cx + hl, y, cz + hw);
      w.box(cx - hl, y + h - 0.08, cz - 0.12, cx + hl, y + h + 0.12, cz + 0.12, ALL);
      for (const s of [-1, 1]) w.tube([cx + s * hl, y + h, cz, cx + s * (hl + 0.4), y + h + 1.2, cz], 0.07, 5);
      y += h * 0.55;
    }
    c.phys.box([cx, 4, cz], [L + 2, 8, Wd + 2]);
  };
  hall(46, -124, 26, 12, 3);
  hall(72, -112, 18, 9, 2);
  // chedi (bell-shaped stupa)
  w.mat('temple_wall');
  w.cyl(24, 0.15, -118, 3.2, 3.0, 1.2, 12, 1);
  w.cyl(24, 1.35, -118, 2.4, 2.6, 2.2, 12, 1, 0, 0.0);
  w.cyl(24, 3.55, -118, 2.6, 1.4, 2.4, 12, 1);
  w.mat('brass');
  w.cyl(24, 5.95, -118, 0.9, 0.06, 6.5, 10, 1);
  c.phys.box([24, 3, -118], [6.4, 6, 6.4]);
  if (c.fol) {
    canopyTree(w, c.fol, 60, 0.15, -140, rng, { h: 13, r: 7, trunk: 0.7 });  // bodhi tree
    canopyTree(w, c.fol, 14, 0.15, -105, rng, { h: 11, r: 6, trunk: 0.6 });
    for (let i = 0; i < 6; i++) coconutPalm(w, c.fol, 30 + i * 9, 0.15, -102, rng, 0.9);
  }
}

// ======================================================================== SPIRIT HOUSE LOT (banyan + ศาลพระภูมิ)
function spiritLot(c: SpecialCtx) {
  const w = c.w, rng = c.rng, L = SPIRIT_LOT;
  w.mat('pavers_square', { autoDirt: false, tint: 0xc8c0b0 });
  flat(w, L.x0, L.z0, L.x1, L.z1, SW_H, 7);
  c.phys.box([(L.x0 + L.x1) / 2, SW_H / 2, (L.z0 + L.z1) / 2], [L.x1 - L.x0, SW_H, L.z1 - L.z0]);
  // soil bed around the banyan
  w.mat('leaves', { autoDirt: false });
  flat(w, -17.5, -156.5, -11.5, -149.5, SW_H + 0.01, 6);
  if (c.fol) canopyTree(w, c.fol, -14.5, SW_H, -153, rng, { h: 14, r: 7.5, trunk: 0.9, roots: true });
  else { w.mat('wood_old', { tint: 0x6a5a4a }); w.cyl(-14.5, SW_H, -153, 1.1, 0.8, 6, 9, 1, 0, 0.3); }
  c.phys.box([-14.5, 3, -153], [1.8, 6, 1.8]);
  // the spirit house at the anchor (respectful offerings: garlands, red soda, incense)
  const sp = c.anchors.spirit_house.p;
  w.put(c.props.spiritHouse(), sp[0], SW_H, sp[2] - 0.2, Math.PI / 2);
  c.phys.box([sp[0], 0.8, sp[2] - 0.2], [1.8, 1.6, 1.8]);
  w.setGroup('detail');
  w.mat('plastic_gloss', { tint: 0xc81818, uv: 'local' });
  for (let i = 0; i < 6; i++) w.cyl(sp[0] + 0.45 - (i % 3) * 0.15, SW_H + 0.42, sp[2] - 0.6 + Math.floor(i / 3) * 0.12, 0.03, 0.025, 0.2, 6, 1);
  w.mat('fabric', { tint: 0xf0a020, uv: 'local' });
  for (let i = 0; i < 5; i++) w.tube(WB.sagLine(sp[0] + 0.5, SW_H + 2.05, sp[2] - 0.6 + i * 0.25, sp[0] + 0.5, SW_H + 2.0, sp[2] - 0.45 + i * 0.25, 0.25, 6), 0.035, 5);
  w.mat('plaster', { tint: 0xf4f0e8, uv: 'local' });
  for (let i = 0; i < 4; i++) { w.pushT(sp[0] + 1.2, SW_H, sp[2] + 0.6 + i * 0.4, -Math.PI / 2); w.box(-0.08, 0.25, -0.18, 0.08, 0.45, 0.18, ALL); for (const z of [-0.14, 0.14]) for (const x of [-0.05, 0.05]) w.box(x - 0.02, 0, z - 0.02, x + 0.02, 0.25, z + 0.02, SIDES); w.box(-0.05, 0.4, 0.15, 0.05, 0.62, 0.25, ALL); w.pop(); }
  w.setGroup('base');
  c.lights.add({ p: new THREE.Vector3(sp[0], SW_H + 2.0, sp[2] - 0.2), color: new THREE.Color(0xff9040), intensity: 6, range: 6, glow: 0.5, kind: 'custom', day: 0.15 });
  // low decorative fence
  w.mat('metal_paint', { tint: 0x2a2a2a, uv: 'local' });
  for (let x = L.x0; x < L.x1 - 0.2; x += 0.25) w.box(x, SW_H, L.z1 - 0.1, x + 0.03, SW_H + 0.8, L.z1 - 0.07, PZ | NZ | PX | NX);
}

// ======================================================================== VACANT LOT
function vacantLot(c: SpecialCtx) {
  const w = c.w, rng = c.rng, L = LOT, F = c.fol;
  // raised dirt / dry grass lot with rubble
  w.mat('dirt', { autoDirt: false, ov: 'grass_dry', ovAmt: 0.8 });
  flat(w, L.x0, L.z0, L.x1, L.z1, SW_H, 8);
  c.phys.box([(L.x0 + L.x1) / 2, SW_H / 2, (L.z0 + L.z1) / 2], [L.x1 - L.x0, SW_H, L.z1 - L.z0]);
  w.mat('leaves', { autoDirt: false });
  flat(w, -24, -92, -12, -80, SW_H + 0.008, 6);
  // the big rain tree
  if (F) canopyTree(w, F, -18, SW_H, -87, rng, { h: 12, r: 9, trunk: 0.85 });
  else { w.mat('wood_old', { tint: 0x6a5a4a }); w.cyl(-18, SW_H, -87, 1.0, 0.7, 5, 9, 1, 0, 0.3); }
  c.phys.box([-18, 3, -87], [1.6, 6, 1.6]);
  // broken low wall along the sidewalk with gaps, back fence of corrugated sheets
  w.mat('cement_block', { ov: 'plaster_moldy', ovAmt: 0.8 });
  for (const [z0, z1, h] of [[-75.2, -77.5, 1.2], [-82.5, -86, 0.6], [-91.5, -97.8, 1.4]] as [number, number, number][]) {
    w.box(-6.25, SW_H, z1, -6.05, SW_H + h, z0, ALL & ~NY);
    c.phys.box([-6.15, SW_H + h / 2, (z0 + z1) / 2], [0.2, h, Math.abs(z1 - z0)]);
  }
  w.mat('corr_rust', { uv: 'world' });
  w.quad(L.x0, 0, L.z0, L.x0, 0, L.z1, L.x0, 2.6, L.z1, L.x0, 2.6, L.z0);
  w.quad(L.x0 + 0.05, 0, L.z1, L.x0 + 0.05, 0, L.z0, L.x0 + 0.05, 2.6, L.z0, L.x0 + 0.05, 2.6, L.z1);
  c.phys.box([L.x0, 1.3, (L.z0 + L.z1) / 2], [0.2, 2.6, L.z1 - L.z0]);
  // junk: tyres, old mattress, plywood, sacks, a wrecked pickup
  w.setGroup('detail');
  for (let i = 0; i < 5; i++) w.put(c.props.junkPile(i), rng.range(-30, -20), SW_H, rng.range(-97, -78), rng.range(0, 6));
  w.mat('rubber', { uv: 'local' });
  for (let i = 0; i < 6; i++) { w.pushTR(-28 + (i % 3) * 0.2, SW_H + 0.12 + Math.floor(i / 3) * 0.22, -95 + (i % 2) * 0.1, Math.PI / 2, i, 0); w.cyl(0, -0.1, 0, 0.32, 0.32, 0.2, 10, 3); w.pop(); }
  w.mat('fabric', { tint: 0xb8a890, uv: 'local', ov: 'plaster_moldy', ovAmt: 0.9 });
  w.pushTR(-24, SW_H + 0.08, -78.5, 0.05, 0.4, 0); w.bevelBox(-0.9, -0.08, -0.7, 0.9, 0.08, 0.7, 0.08); w.pop();
  w.put(c.props.pickup(0x6a5a4a), -27, SW_H, -82, 1.2, 1, { rz: 0.06 });
  c.phys.box([-27, 1, -82], [4.5, 2, 4.5]);
  w.setGroup('base');
  if (F) {
    grassPatch(w, F, L.x0 + 0.5, L.z0 + 0.5, L.x1 - 0.5, L.z1 - 0.5, SW_H, 1.2, rng, 'grass');
    for (let i = 0; i < 40; i++) weeds(w, F, rng.range(L.x0, L.x1), SW_H, rng.range(L.z0, L.z1), rng, 1.3);
    for (let i = 0; i < 3; i++) bananaTree(w, F, rng.range(-31, -28), SW_H, rng.range(-96, -80), rng, 0.9);
  }
}

// ======================================================================== BACKGROUND BLOCKS (behind the frontage, & beyond the map edges)
function backBlocks(c: SpecialCtx) {
  const rows: UnitSpec[][] = [];
  const far = (face: 'N' | 'S' | 'E' | 'W', line: number, a0: number, a1: number, depth: number, minS = 3, maxS = 6) => {
    const u: UnitSpec[] = [];
    let a = a0;
    const r = new RNG(Math.floor(line * 1000 + a0));
    while (a < a1 - 3) {
      const wd = r.range(4, 9);
      const b = Math.min(a1, a + wd);
      u.push({ face, line, a0: a, a1: b, depth, far: true, storeys: r.int(minS, maxS), noSign: r.chance(0.6), shop: r.pick(['closed', 'residence', 'grocery']), ground: 'shutter', awning: 'none' });
      a = b;
    }
    rows.push(u);
  };
  // north of the main road, behind the frontage rows (faces south onto the backs)
  far('S', -16, 20, 130, 18, 4, 8);
  far('S', -16, -130, -68, 18, 4, 8);
  // behind the soi west rows (west of x -22)
  far('E', -22, -146, -100, 16, 3, 6);
  far('E', -24, -54, -44, 14, 4, 7);
  // east of the market (faces west toward the market's back)
  far('W', 52, -95, -40, 20, 3, 6);
  // behind the 8-Twelve / closed house (x 27..50)
  far('W', 28, -40, -15, 16, 4, 7);
  // south of the main road, behind the south row
  far('N', 40, -130, 30, 20, 4, 8);
  // visual extension beyond the playable bounds along the main road (no colliders needed: blocked by barriers)
  far('S', 0, 130, 260, 14, 3, 7);
  far('S', 0, -260, -130, 14, 3, 7);
  far('N', 26, 130, 260, 14, 3, 7);
  far('N', 26, -260, -130, 14, 3, 7);
  buildRows(c, rows);
}

void NX; void PX; void PY; void NZ; void PZ; void SIDES; void PLASTIC_COLORS; void pottedPlant; void bougainvillea; void MARKET;
