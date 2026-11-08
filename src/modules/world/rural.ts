import * as THREE from 'three';
import { RNG } from '../../core/rng';
import { WB, ALL, SIDES, PX, NX, PY, NY, PZ, NZ } from './geo';
import type { SpecialCtx } from './buildings';
import { flat, groundDecal } from './streets';
import { bananaTree, coconutPalm, canopyTree, grassPatch, weeds, riceRows, card } from './foliage';
import { makeWaterMaterial, pendingWater } from './canal';
import { EMIS } from './mats';
import { RROAD, RURAL_Y, CANAL } from './layout';

/**
 * RURAL EDGE (z < -179) — dirt road north from the bridge, flooded rice paddies with dikes and
 * rice rows (W), banana grove with wooden stilt houses (E), roadside stall spot, palms, tall grass,
 * fences, a tree line + fence at the north boundary.
 */

const PX0 = -128, PX1 = -6, PZ0 = -262, PZ1 = -182, CW = 26, CD = 22;

export function buildRural(c: SpecialCtx) {
  const w = c.w, rng = c.rng, F = c.fol;
  const zTop = CANAL.bankN;
  // ---------------------------------------------------------------- ground: grass everywhere (except paddies & road)
  c.holes.push({ x0: -420, z0: -420, x1: 420, z1: zTop });
  const rects: [number, number, number, number][] = [
    [-420, -300, RROAD.x0 - 1.2, PZ0], [RROAD.x1 + 1.2, -300, 420, zTop],
    [-420, PZ0, PX0, zTop], [PX1, PZ0, RROAD.x0 - 1.2, zTop], [PX0, PZ1, PX1, zTop], [RROAD.x0 - 1.2, -300, RROAD.x1 + 1.2, RROAD.zN],
  ];
  for (const [x0, z0, x1, z1] of rects) {
    if (x1 <= x0 || z1 <= z0) continue;
    w.mat('grass', { autoDirt: false, ov: 'grass_dry', ovAmt: 0.6, uo: x0, vo: z0 });
    flat(w, x0, z0, x1, z1, RURAL_Y, 20);
  }
  // ground colliders around (not over) the paddy block
  const gbox = (x0: number, z0: number, x1: number, z1: number) => c.phys.box([(x0 + x1) / 2, RURAL_Y - 0.5, (z0 + z1) / 2], [x1 - x0, 1, z1 - z0]);
  const zc = CANAL.zN;
  gbox(-420, -300, PX0, zc); gbox(PX1, -300, 420, zc); gbox(PX0, PZ1, PX1, zc); gbox(PX0, -300, PX1, PZ0);
  // ---------------------------------------------------------------- dirt road (+ grass verges/shoulders, ruts, puddles)
  w.mat('dirt', { autoDirt: false, ov: 'laterite', ovAmt: 0.6 });
  flat(w, RROAD.x0, RROAD.zN, RROAD.x1, RROAD.zS, RURAL_Y + 0.02, 10);
  w.mat('grass_dry', { autoDirt: false, ov: 'dirt', ovAmt: 0.5 });
  flat(w, RROAD.x0 - 1.2, RROAD.zN, RROAD.x0, RROAD.zS, RURAL_Y + 0.01, 10);
  flat(w, RROAD.x1, RROAD.zN, RROAD.x1 + 1.2, RROAD.zS, RURAL_Y + 0.01, 10);
  const D = c.decals;
  if (D) for (let i = 0; i < 24; i++) {
    const k = rng.int(0, 3);
    groundDecal(w, D.cell('decal_puddles', k % 2, k >> 1, 2, 2), rng.range(-2.4, 2.4), RURAL_Y + 0.03, rng.range(RROAD.zN + 2, RROAD.zS - 2), rng.range(1, 2.6), rng.range(0.8, 1.6), rng.range(0, 6), { wet: 1, alpha: rng.range(0.6, 0.95), tint: 0xb8a888 });
  }
  // ---------------------------------------------------------------- rice paddies with dikes (west) — matches layout.groundHeight
  const water = new THREE.Group();
  water.name = 'paddy-water';
  const pm = makeWaterMaterial(0x4a5a34, 0x2a3220);
  pm.roughness = 0.12;
  for (let x = PX0; x < PX1 - 1; x += CW) for (let z = PZ1; z > PZ0 + 1; z -= CD) {
    const cx0 = x + 1.2, cx1 = Math.min(PX1, x + CW), cz1 = z - 1.2, cz0 = Math.max(PZ0, z - CD);
    if (cx1 - cx0 < 2 || cz1 - cz0 < 2) continue;
    // mud floor + water plane + rice
    w.mat('mud', { autoDirt: false });
    flat(w, cx0, cz0, cx1, cz1, -0.12, 12);
    const g = new THREE.PlaneGeometry(cx1 - cx0, cz1 - cz0);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, pm);
    m.position.set((cx0 + cx1) / 2, -0.04, (cz0 + cz1) / 2);
    m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
    water.add(m);
    c.phys.box([(cx0 + cx1) / 2, -0.12 - 0.5, (cz0 + cz1) / 2], [cx1 - cx0, 1, cz1 - cz0]);
    if (F && rng.chance(0.85)) riceRows(w, F, cx0 + 0.3, cz0 + 0.3, cx1 - 0.3, cz1 - 0.3, -0.06, rng);
  }
  pendingWater.push(water);
  // dikes (raised grass bunds)
  const dike = (x0: number, z0: number, x1: number, z1: number) => {
    w.mat('grass', { autoDirt: false, ov: 'mud', ovAmt: 0.5 });
    w.box(x0, -0.12, z0, x1, 0.16, z1, ALL & ~NY);
    c.phys.box([(x0 + x1) / 2, 0.02, (z0 + z1) / 2], [x1 - x0, 0.28, z1 - z0]);
  };
  for (let x = PX0; x <= PX1 - 1; x += CW) dike(x, PZ0, x + 1.2, PZ1);
  for (let z = PZ1; z >= PZ0; z -= CD) dike(PX0, z - 1.2, PX1, z);
  // visual paddies continuing west beyond the playable area (no colliders)
  w.mat('grass', { autoDirt: false, tint: 0x9ab07a });
  // ---------------------------------------------------------------- banana grove + wooden stilt houses (east)
  if (F) {
    for (let i = 0; i < 120; i++) {
      const x = rng.range(9, 72), z = rng.range(-244, -186);
      if (Math.hypot(x - 20, z + 195) < 5.5 || Math.hypot(x - 46, z + 226) < 5.5 || Math.hypot(x - 62, z + 199) < 5.5) continue;
      if (Math.abs(z + 205) < 1.6 && x < 54) continue; // grove path
      if (Math.abs(x - 30) < 1.4 && z < -205 && z > -233) continue;
      bananaTree(w, F, x, RURAL_Y, z, rng, rng.range(0.8, 1.2));
    }
    // ghost spots surrounded by banana trees (nang tani lives in banana trees)
    const nt = c.anchors.nang_tani_spot.p;
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; bananaTree(w, F, nt[0] + Math.cos(a) * 2.2, RURAL_Y, nt[2] + Math.sin(a) * 2.2, rng, 1.1); }
    for (let i = 0; i < 30; i++) coconutPalm(w, F, rng.range(-120, 120), RURAL_Y, rng.range(-266, -186), rng, rng.range(0.85, 1.25));
    grassPatch(w, F, RROAD.x0 - 1.6, RROAD.zN, RROAD.x0 - 0.1, RROAD.zS, RURAL_Y, 1.6, rng, 'grass');
    grassPatch(w, F, RROAD.x1 + 0.1, RROAD.zN, RROAD.x1 + 1.6, RROAD.zS, RURAL_Y, 1.6, rng, 'grass');
    grassPatch(w, F, 8, -250, 74, -184, RURAL_Y, 0.25, rng, 'grass');
    grassPatch(w, F, 74, -262, 128, -184, RURAL_Y, 0.15, rng, 'grass');
    // tree line at the north boundary
    // (mixed species, irregular spacing and depth — the old even row of identical canopy trees looked planted)
    for (let x = -126; x < 128; x += rng.range(6, 19)) {
      const z = rng.range(-269, -256), k = rng.next();
      if (k < 0.55) canopyTree(w, F, x, RURAL_Y, z, rng, { h: rng.range(7, 15), r: rng.range(3.5, 7.5), trunk: rng.range(0.35, 0.6) });
      else if (k < 0.8) coconutPalm(w, F, x, RURAL_Y, z, rng, rng.range(0.8, 1.25));
      else { bananaTree(w, F, x, RURAL_Y, z, rng, rng.range(0.9, 1.3)); if (rng.chance(0.6)) bananaTree(w, F, x + rng.range(1.2, 2.2), RURAL_Y, z + rng.range(-1.5, 1.5), rng, rng.range(0.7, 1.1)); }
      if (rng.chance(0.25)) x += rng.range(8, 16);   // open gaps (fields seen through)
    }
  }
  stiltHome(c, 20, -195, rng);
  stiltHome(c, 46, -226, rng);
  stiltHome(c, 62, -199, rng);
  // ---------------------------------------------------------------- roadside stall spot (rural_spot): a bamboo sala + shade tree, anchor kept clear
  {
    const a = c.anchors.rural_spot.p;
    const x = a[0] + 3.4, z = a[2];
    const Y = RURAL_Y;
    const bam = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number) => w.tube([x + ax, Y + ay, z + az, x + bx, Y + by, z + bz], r, 8);
    // posts: thick bamboo with a node ring every ~45 cm, sitting on a concrete footing
    for (const [dx, dz] of [[-1.2, -1.4], [1.2, -1.4], [-1.2, 1.4], [1.2, 1.4]]) {
      w.mat('concrete_old', { uv: 'local' });
      w.bevelBox(x + dx - 0.11, Y - 0.02, z + dz - 0.11, x + dx + 0.11, Y + 0.08, z + dz + 0.11, 0.02);
      w.mat('bamboo', { uv: 'local' });
      w.cyl(x + dx, Y + 0.08, z + dz, 0.058, 0.052, 2.36, 10, 1);
      for (let k = 0; k < 5; k++) w.cyl(x + dx, Y + 0.32 + k * 0.45, z + dz, 0.064, 0.064, 0.025, 10, 0);
      c.phys.box([x + dx, 1.2, z + dz], [0.12, 2.4, 0.12]);
    }
    // platform: bamboo bearers + joists, woven deck with split-bamboo edging
    w.mat('bamboo', { uv: 'local' });
    for (const dz of [-1.4, 1.4]) bam(-1.32, 0.38, dz, 1.32, 0.38, dz, 0.05);
    for (const dx of [-1.2, 0, 1.2]) bam(dx, 0.44, -1.5, dx, 0.44, 1.5, 0.04);
    w.mat('bamboo_woven', { uv: 'world' });
    w.bevelBox(x - 1.28, Y + 0.47, z - 1.48, x + 1.28, Y + 0.52, z + 1.48, 0.03);
    w.mat('bamboo', { uv: 'local' });
    for (const s of [-1, 1]) { bam(-1.3, 0.53, s * 1.49, 1.3, 0.53, s * 1.49, 0.03); bam(s * 1.29, 0.53, -1.5, s * 1.29, 0.53, 1.5, 0.03); }
    c.phys.box([x, 0.3, z], [2.6, 0.6, 3]);
    // roof frame: wall plates, tie beams, ridge pole, rafters, purlins
    for (const dz of [-1.4, 1.4]) bam(-1.75, 2.39, dz, 1.75, 2.39, dz, 0.05);
    for (const dx of [-1.2, 1.2]) bam(dx, 2.33, -1.5, dx, 2.33, 1.5, 0.045);
    for (const dx of [-1.2, 1.2]) bam(dx, 2.35, 0, dx, 2.83, 0, 0.04);               // king posts
    bam(-1.8, 2.84, 0, 1.8, 2.84, 0, 0.05);                                          // ridge pole
    for (const dx of [-1.6, -0.8, 0, 0.8, 1.6]) for (const s of [-1, 1]) bam(dx, 2.83, 0, dx, 2.24, s * 1.95, 0.032);
    for (const s of [-1, 1]) for (const f of [0.35, 0.72]) bam(-1.75, 2.869 - 0.62 * f, s * 1.95 * f, 1.75, 2.869 - 0.62 * f, s * 1.95 * f, 0.026);
    // fibre-cement roof sheets with real thickness (top, underside, fascia edges), ridge capping
    w.mat('roof_fibre', { tint: 0xc8b890, uv: 'world' });
    for (const s of [-1, 1]) {
      const e = z + s * 1.95, r = z, ye = Y + 2.3, yr = Y + 2.92, t = 0.025;
      const [l, rr] = s > 0 ? [x - 1.75, x + 1.75] : [x + 1.75, x - 1.75];
      w.quad(l, ye, e, rr, ye, e, rr, yr, r, l, yr, r);
      w.quad(l, ye - t, e, l, yr - t, r, rr, yr - t, r, rr, ye - t, e);
      w.quad(rr, ye - t, e, rr, ye, e, l, ye, e, l, ye - t, e);
      w.quad(l, ye - t, e, l, ye, e, l, yr, r, l, yr - t, r);
      w.quad(rr, yr - t, r, rr, yr, r, rr, ye, e, rr, ye - t, e);
    }
    w.mat('metal_paint', { tint: 0x8a8578, uv: 'local' });
    w.pushTR(x, Y + 2.93, z, 0, 0, 0);
    w.quad(-1.78, -0.05, 0.16, 1.78, -0.05, 0.16, 1.78, 0.02, 0, -1.78, 0.02, 0);
    w.quad(1.78, -0.05, -0.16, -1.78, -0.05, -0.16, -1.78, 0.02, 0, 1.78, 0.02, 0);
    w.pop();
    if (F) canopyTree(w, F, x + 5, RURAL_Y, z - 4, rng, { h: 9, r: 5, trunk: 0.45 });
    const R2 = c.props.real;
    R2.add('basket', x - 0.6, RURAL_Y + 0.55, z + 0.4, 0.3, { phys: 'none' });
    R2.add('bananas', x + 0.3, RURAL_Y + 0.55, z - 0.5, 1.1);
    R2.add('styro_box', x + 1.6, RURAL_Y, z + 1.0, 0.2);
    R2.add('thai_stool', x + 1.7, RURAL_Y, z - 0.9, 0.4, { color: 0xc03020 });
    R2.add('drum', x - 1.8, RURAL_Y, z - 1.2, 0, { color: 0x2a5ab0 });
    c.lights.add({ p: new THREE.Vector3(x, RURAL_Y + 2.3, z), color: new THREE.Color(0xffc080), intensity: 6, range: 8, glow: 0.4, kind: 'custom' });
  }
  // ---------------------------------------------------------------- fences: bamboo along the grove, barbed wire posts along paddies
  w.setGroup('detail');
  w.mat('bamboo', { uv: 'local' });
  for (let z = -186; z > -246; z -= 1.6) { w.cyl(7.6, RURAL_Y, z, 0.035, 0.03, 1.2, 5, 1); }
  w.tube([7.6, RURAL_Y + 0.5, -186, 7.6, RURAL_Y + 0.5, -246], 0.02, 3);
  w.tube([7.6, RURAL_Y + 1.0, -186, 7.6, RURAL_Y + 1.0, -246], 0.02, 3);
  w.mat('wood_old', { uv: 'local' });
  for (let z = -184; z > -262; z -= 3) w.box(-4.9, RURAL_Y, z - 0.05, -4.8, RURAL_Y + 1.1, z + 0.05, SIDES | PY);
  w.mat('steel_rust', { uv: 'local' });
  for (const y of [0.45, 0.8]) w.tube([-4.85, RURAL_Y + y, -184, -4.85, RURAL_Y + y, -262], 0.006, 3);
  w.setGroup('base');
  // north boundary fence (corrugated sheets & wire) behind the tree line
  w.mat('corr_rust', { uv: 'world' });
  w.quad(128, 0, -269, -128, 0, -269, -128, 2.2, -269, 128, 2.2, -269);
  w.quad(-128, 0, -269.05, 128, 0, -269.05, 128, 2.2, -269.05, -128, 2.2, -269.05);
  void weeds; void card; void EMIS; void PX; void NX; void PY; void PZ; void NZ;
}

/** traditional wooden stilt house (เรือนไทย-ish, simplified) */
function stiltHome(c: SpecialCtx, x: number, z: number, rng: RNG) {
  const w = c.w;
  const W = rng.range(6, 8), D = rng.range(5, 7), fy = 2.3, wh = 2.5;
  const x0 = x - W / 2, x1 = x + W / 2, z0 = z - D / 2, z1 = z + D / 2;
  w.mat('wood_old', { tint: 0x7a6a58, uv: 'local' });
  for (let xx = x0; xx <= x1 + 0.01; xx += W / 3) for (let zz = z0; zz <= z1 + 0.01; zz += D / 2) { w.box(xx - 0.1, RURAL_Y, zz - 0.1, xx + 0.1, fy, zz + 0.1, SIDES); c.phys.box([xx, fy / 2, zz], [0.2, fy, 0.2]); }
  w.mat('wood_old', { uv: 'world' });
  w.box(x0 - 0.2, fy - 0.15, z0 - 0.2, x1 + 0.2, fy, z1 + 1.6, ALL);
  w.mat(rng.pick(['wood_old', 'wood_paint']), { tint: rng.pick([0xffffff, 0x9a8a70, 0x6a8a7a]), ov: 'plaster_moldy', ovAmt: 0.4, uv: 'world' });
  w.box(x0, fy, z0, x1, fy + wh, z1, SIDES);
  // openings (dark) + shutters
  w.mat('wood_old', { tint: 0x221e1a, ao: 0.4 });
  for (const xx of [x0 + 1.2, x + 0.5]) w.box(xx, fy + 0.8, z1 + 0.001, xx + 1.0, fy + 1.9, z1 + 0.01, PZ);
  w.box(x1 - 1.8, fy, z1 + 0.001, x1 - 0.9, fy + 2.1, z1 + 0.01, PZ);
  // steep roof
  const roofL = rng.pick(['roof_tiles', 'corr_rust', 'roof_galv']);
  w.mat(roofL, { uv: 'world', ao: 0.95 });
  const ry = fy + wh, rh = 2.2;
  w.quad(x0 - 0.7, ry - 0.3, z1 + 0.8, x1 + 0.7, ry - 0.3, z1 + 0.8, x1 + 0.7, ry + rh, z, x0 - 0.7, ry + rh, z);
  w.quad(x1 + 0.7, ry - 0.3, z0 - 0.8, x0 - 0.7, ry - 0.3, z0 - 0.8, x0 - 0.7, ry + rh, z, x1 + 0.7, ry + rh, z);
  w.mat(roofL, { uv: 'world', ao: 0.5, tint: 0x8a8a8a });
  w.quad(x1 + 0.7, ry - 0.31, z1 + 0.8, x0 - 0.7, ry - 0.31, z1 + 0.8, x0 - 0.7, ry + rh - 0.01, z, x1 + 0.7, ry + rh - 0.01, z);
  w.quad(x0 - 0.7, ry - 0.31, z0 - 0.8, x1 + 0.7, ry - 0.31, z0 - 0.8, x1 + 0.7, ry + rh - 0.01, z, x0 - 0.7, ry + rh - 0.01, z);
  w.mat('wood_old', { uv: 'world' });
  w.tri(x0, ry, z1, x0, ry, z0, x0, ry + rh, z); // gable (west)
  w.tri(x1, ry, z0, x1, ry, z1, x1, ry + rh, z);
  // stairs to the veranda
  w.mat('wood_old', { uv: 'local' });
  for (let i = 0; i < 9; i++) w.box(x1 - 1.6, RURAL_Y + i * 0.25, z1 + 1.6 + 1.9 - i * 0.22, x1 - 0.6, RURAL_Y + i * 0.25 + 0.06, z1 + 1.6 + 1.9 - i * 0.22 - 0.25, ALL);
  // under-house: table, hammock, motorbike, water jars
  w.setGroup('detail');
  w.mat('bamboo_woven', { uv: 'local' });
  w.box(x - 1, RURAL_Y + 0.45, z - 0.6, x + 1, RURAL_Y + 0.5, z + 0.6, ALL);
  w.mat('fabric', { tint: rng.pick([0x3a6a9a, 0xc04030, 0x4a8a4a]), uv: 'local' });
  w.tube(WB.sagLine(x0 + 0.2, fy - 0.4, z0 + 0.3, x0 + 0.2, fy - 0.4, z1 - 0.3, 0.7, 8), 0.12, 5);
  w.put(c.props.motorbike(rng.pick([0xc0302a, 0x1c1c1e, 0x2a62b8])), x1 - 1, RURAL_Y, z - 0.5, 0.4, 1, { rz: 0.08 });
  // real props: glazed water jars, blue drums, baskets, a tyre, plastic chairs & a cone hat's worth of clutter
  const R = c.props.real;
  for (let k = 0; k < 3; k++) R.add('pot_ceramic', x0 - 0.8, RURAL_Y, z0 + k * 0.9, rng.range(0, 6), { scale: rng.range(0.95, 1.15) });
  R.add('drum', x1 + 0.6, RURAL_Y, z0 + 0.4, rng.range(0, 6), { color: 0x2a5ab0 });
  R.add('drum_red', x1 + 0.65, RURAL_Y, z0 + 1.15, rng.range(0, 6));
  R.add('basket_lid', x - 0.6, RURAL_Y + 0.5, z + 0.2, rng.range(0, 6), { phys: 'none' });
  R.add('basket', x + 0.5, RURAL_Y + 0.5, z - 0.3, rng.range(0, 6), { phys: 'none' });
  for (let k = 0; k < 2; k++) R.add('monobloc', x + (k ? 1.4 : -1.4), RURAL_Y, z + 0.1, (k ? -1 : 1) * Math.PI / 2 + rng.range(-0.4, 0.4), { color: rng.pick([0x2a62b8, 0xe8e4dc, 0xc03020]) });
  R.add('tyre', x1 - 0.3, RURAL_Y, z1 + 0.9, 0);
  R.add('broom_wood', x1 - 2.0, RURAL_Y, z1 + 1.75, Math.PI, { rx: -0.25 });
  R.add('jerrycan', x1 - 0.5, RURAL_Y, z - 1.6, rng.range(0, 6), { color: 0xc03020 });
  R.add('bucket', x0 - 0.4, RURAL_Y, z1 - 0.3, 0, { color: rng.pick([0x2a62b8, 0x2a8a4a]) });
  w.setGroup('base');
  w.mat('glass', { tint: 0xfff0d0, emis: EMIS.warm.i, emisK: 0.7, uv: 'local' });
  w.box(x - 0.2, fy + 1.0, z1 + 0.012, x + 0.3, fy + 1.6, z1 + 0.02, PZ);
  c.lights.add({ p: new THREE.Vector3(x, fy + 1.4, z1 + 1.2), color: new THREE.Color(0xffb060), intensity: 5, range: 8, glow: 0.4, kind: 'window' });
  c.phys.box([x, fy + wh / 2, z], [W, wh, D]);
  c.phys.box([x, fy - 0.07, z + 0.8], [W + 0.4, 0.15, D + 2]);
}
