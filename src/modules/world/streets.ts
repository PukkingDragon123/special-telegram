import { RNG } from '../../core/rng';
import { WB, PY, PX, NX, PZ, NZ } from './geo';
import type { Atlas, AtlasRect } from './atlas';
import { SOI, MAIN, CROAD, SW_H, MEDIAN_H, ZEBRAS, SEVEN, CLOSED_HOUSE, MARKET, LOT, SPIRIT_LOT, TEMPLE, OFFICE, WHOLESALE, CANAL, BRIDGE } from './layout';

/**
 * STREETS — asphalt, raised sidewalks with real curbs (step-up), painted curb codes, the main road
 * median, lane markings, zebra crossings, gutters & inlet grates, manholes, potholes, puddles,
 * oil stains, patches, gum — everything grimy and worn.
 */

export interface Ctx {
  w: WB;
  rng: RNG;
  decals: Atlas | null;
  phys: { box(c: number[], s: number[], yaw?: number): void };
}

/** surfaces that the base ground must not cover */
export const SURFACES: { x0: number; z0: number; x1: number; z1: number }[] = [];
const S = (x0: number, z0: number, x1: number, z1: number) => SURFACES.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1) });

/** horizontal rect surface at height y, split into ≤ seg-sized quads (chunk friendly) */
export function flat(w: WB, x0: number, z0: number, x1: number, z1: number, y: number, seg = 10) {
  const nx = Math.max(1, Math.ceil((x1 - x0) / seg)), nz = Math.max(1, Math.ceil((z1 - z0) / seg));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const a = x0 + ((x1 - x0) * i) / nx, b = x0 + ((x1 - x0) * (i + 1)) / nx;
    const c = z0 + ((z1 - z0) * j) / nz, d = z0 + ((z1 - z0) * (j + 1)) / nz;
    w.quad(a, y, d, b, y, d, b, y, c, a, y, c);
  }
}

/** a decal quad lying on the ground (rotation in radians), size in metres */
export function groundDecal(w: WB, r: AtlasRect | undefined, x: number, y: number, z: number, sx: number, sz: number, rot = 0, opts: { alpha?: number; wet?: number; rough?: number; tint?: number | [number, number, number] } = {}) {
  if (!r) return;
  w.atlas('decal', { tint: opts.tint ?? 0xffffff, ao: opts.alpha ?? 1, e0: opts.wet ?? 0, e1: opts.rough ?? 0, group: 'detail' });
  const c = Math.cos(rot), s = Math.sin(rot);
  const hx = sx / 2, hz = sz / 2;
  // corners: a(-x,+z) b(+x,+z) c(+x,-z) d(-x,-z) in local, rotated
  const P = (lx: number, lz: number) => [x + lx * c - lz * s, z + lx * s + lz * c];
  const a = P(-hx, hz), b = P(hx, hz), cc = P(hx, -hz), d = P(-hx, -hz);
  w.quad(a[0], y, a[1], b[0], y, b[1], cc[0], y, cc[1], d[0], y, d[1], [r.u0, r.v0, r.u1, r.v1]);
}

/** vertical decal on a wall facing (nx,nz) */
export function wallDecal(w: WB, r: AtlasRect | undefined, x: number, y: number, z: number, nx: number, nz: number, sw: number, sh: number, opts: { alpha?: number; tint?: number | [number, number, number] } = {}) {
  if (!r) return;
  w.atlas('decal', { tint: opts.tint ?? 0xffffff, ao: opts.alpha ?? 1, group: 'detail' });
  const rx = -nz, rz = nx; // right vector when looking at the wall
  const ox = x + nx * 0.012, oz = z + nz * 0.012;
  const hw = sw / 2;
  w.quad(ox - rx * hw, y, oz - rz * hw, ox + rx * hw, y, oz + rz * hw, ox + rx * hw, y + sh, oz + rz * hw, ox - rx * hw, y + sh, oz - rz * hw, [r.u0, r.v0, r.u1, r.v1]);
}

/**
 * Curb strip along a straight edge. (x0,z0)→(x1,z1) is the road edge line, (nx,nz) points to the
 * ROAD (outward from the sidewalk). Builds the vertical face (road side) and a top strip.
 */
export function curb(w: WB, layer: string, x0: number, z0: number, x1: number, z1: number, nx: number, nz: number, h = SW_H, topW = 0.2, base = 0) {
  w.mat(layer, { uv: 'face', autoDirt: false, group: 'base' });
  const len = Math.hypot(x1 - x0, z1 - z0);
  const segs = Math.max(1, Math.ceil(len / 6));
  const tV = w.tileV; // metres-equivalent of one full texture height
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const ax = x0 + (x1 - x0) * t0, az = z0 + (z1 - z0) * t0, bx = x0 + (x1 - x0) * t1, bz = z0 + (z1 - z0) * t1;
    const u0 = len * t0, u1 = len * t1;
    // make the quad face the road: order so that normal = (nx, nz)
    const dx = bx - ax, dz = bz - az;
    const cross = dx * nz - dz * nx; // >0 → (a→b) runs with the road on the right... choose order
    const [px0, pz0, px1, pz1] = cross < 0 ? [ax, az, bx, bz] : [bx, bz, ax, az];
    const [uu0, uu1] = cross < 0 ? [u0, u1] : [u1, u0];
    // vertical face (v 0..0.6 of the texture)
    w.quad(px0, base, pz0, px1, base, pz1, px1, h, pz1, px0, h, pz0, [uu0, 0, uu1, tV * 0.6]);
    // top strip (v 0.6..1.0)
    const ix = -nx * topW, iz = -nz * topW;
    w.quad(px0, h, pz0, px1, h, pz1, px1 + ix, h, pz1 + iz, px0 + ix, h, pz0 + iz, [uu0, tV * 0.6, uu1, tV]);
  }
}

/** raised sidewalk slab: top surface + curb faces on the listed road edges */
function sidewalk(c: Ctx, x0: number, z0: number, x1: number, z1: number, layer: string, edges: { side: 'x0' | 'x1' | 'z0' | 'z1'; curb: string; from?: number; to?: number }[], h = SW_H, uvRot = false) {
  const w = c.w;
  S(x0, z0, x1, z1);
  // top surface inset by the curb strip on curbed sides
  const inset = 0.2;
  let ax0 = x0, ax1 = x1, az0 = z0, az1 = z1;
  for (const e of edges) { if (e.side === 'x0') ax0 += inset; if (e.side === 'x1') ax1 -= inset; if (e.side === 'z0') az0 += inset; if (e.side === 'z1') az1 -= inset; }
  w.mat(layer, { uvS: 1, autoDirt: false, uo: c.rng.range(0, 3), vo: c.rng.range(0, 3) });
  if (uvRot) w.uvMode = 'world';
  flat(w, ax0, az0, ax1, az1, h, 8);
  for (const e of edges) {
    const f = e.from, t = e.to;
    if (e.side === 'x1') curb(w, e.curb, x1, f ?? z0, x1, t ?? z1, 1, 0, h);
    if (e.side === 'x0') curb(w, e.curb, x0, f ?? z0, x0, t ?? z1, -1, 0, h);
    if (e.side === 'z1') curb(w, e.curb, f ?? x0, z1, t ?? x1, z1, 0, 1, h);
    if (e.side === 'z0') curb(w, e.curb, f ?? x0, z0, t ?? x1, z0, 0, -1, h);
  }
  // collider: one slab (step height 0.15 → the character controller steps up)
  c.phys.box([(x0 + x1) / 2, h / 2, (z0 + z1) / 2], [x1 - x0, h, z1 - z0]);
}

export function buildStreets(c: Ctx) {
  const w = c.w, rng = c.rng, D = c.decals;
  const VIS = 420; // visual extension beyond the playable bounds (fogged)

  // ------------------------------------------------------------ asphalt
  w.mat('asphalt_main', { autoDirt: false, group: 'base' });
  flat(w, -VIS, MAIN.z0, VIS, MAIN.med0, 0, 12);
  flat(w, -VIS, MAIN.med1, VIS, MAIN.z1, 0, 12);
  S(-VIS, MAIN.z0, VIS, MAIN.z1);
  w.mat('asphalt_soi', { autoDirt: false });
  flat(w, SOI.x0, SOI.zN, SOI.x1, MAIN.z0, 0, 10);
  S(SOI.x0, CROAD.z0, SOI.x1, MAIN.z0);
  // canal road
  w.mat('asphalt_soi', { autoDirt: false, uo: 13 });
  flat(w, -VIS, CROAD.z0, VIS, CROAD.z1, 0, 12);
  S(-VIS, CROAD.z0, VIS, CROAD.z1);
  // the soi mouth also crosses the main-road sidewalk band (z 0..6) → asphalt there too
  w.mat('asphalt_soi', { autoDirt: false });
  flat(w, SOI.x0, MAIN.swN0, SOI.x1, MAIN.z0, 0.0, 6);

  // ------------------------------------------------------------ median (raised, painted curbs, planter strip)
  {
    const m0 = MAIN.med0, m1 = MAIN.med1;
    w.mat('concrete_old', { autoDirt: false });
    flat(w, -VIS, m0 + 0.2, VIS, m1 - 0.2, MEDIAN_H, 12);
    for (let x = -VIS; x < VIS; x += 40) {
      const x1 = Math.min(VIS, x + 40);
      const near = Math.abs(x) < 60;
      curb(w, near ? 'curb_rw' : 'curb', x, m0, x1, m0, 0, -1, MEDIAN_H);
      curb(w, near ? 'curb_rw' : 'curb', x, m1, x1, m1, 0, 1, MEDIAN_H);
    }
    c.phys.box([0, MEDIAN_H / 2, (m0 + m1) / 2], [260, MEDIAN_H, m1 - m0]);
    S(-VIS, m0, VIS, m1);
    // dusty soil + weeds strip in the middle (planter)
    w.mat('dirt', { autoDirt: false, tint: 0xb0a090 });
    for (let x = -126; x < 126; x += 18) flat(w, x + 1, m0 + 0.45, x + 15, m1 - 0.45, MEDIAN_H + 0.01, 15);
  }

  // ------------------------------------------------------------ sidewalks
  // main road north (z 0..6), split by the soi mouth
  sidewalk(c, MAIN.x0 - 10, MAIN.swN0, SOI.x0, MAIN.z0, 'tile_redband', [{ side: 'z1', curb: 'curb' }, { side: 'x1', curb: 'curb_rw' }]);
  sidewalk(c, SOI.x1, MAIN.swN0, MAIN.x1 + 10, MAIN.z0, 'tile_redband', [{ side: 'z1', curb: 'curb' }, { side: 'x0', curb: 'curb_rw' }]);
  // painted red/white near the soi mouth and the zebra, yellow at the bus stop
  curbPaint(c, -24, -3.5, MAIN.z0, 'curb_rw');
  curbPaint(c, 3.5, 24, MAIN.z0, 'curb_rw');
  curbPaint(c, -36, -24, MAIN.z0, 'curb_yb');
  // main road south (z 22..26)
  sidewalk(c, MAIN.x0 - 10, MAIN.z1, MAIN.x1 + 10, MAIN.swS1, 'tile_redband', [{ side: 'z0', curb: 'curb' }]);
  curbPaintS(c, -20, -4, 'curb_rw');
  curbPaintS(c, 34, 50, 'curb_wy');
  // soi sidewalks
  sidewalk(c, -6, SOI.zN, SOI.x0, MAIN.swN0, 'tile_chain', [{ side: 'x1', curb: 'curb' }]);
  sidewalk(c, SOI.x1, SOI.zN, 6, MAIN.swN0, 'tile_circles', [{ side: 'x0', curb: 'curb' }]);
  curbPaintSoi(c, -1, 0, -18, 'curb_rw');
  curbPaintSoi(c, 1, 0, -18, 'curb_rw');
  curbPaintSoi(c, 1, -40, -78, 'curb_wy');      // market loading
  curbPaintSoi(c, -1, -52, -60, 'curb_yb');
  curbPaintSoi(c, 1, -146, -158, 'curb_rw');
  curbPaintSoi(c, -1, -146, -158, 'curb_rw');
  // canal road south sidewalk + north bank walk
  sidewalk(c, -VIS, CROAD.sw0, SOI.x0, CROAD.sw1, 'footpath', [{ side: 'z0', curb: 'curb' }, { side: 'x1', curb: 'curb_rw' }]);
  sidewalk(c, SOI.x1, CROAD.sw0, VIS, CROAD.sw1, 'footpath', [{ side: 'z0', curb: 'curb' }, { side: 'x0', curb: 'curb_rw' }]);
  sidewalk(c, -VIS, CANAL.zS, BRIDGE.x0, CROAD.z0, 'footpath', [{ side: 'z1', curb: 'curb' }]);
  sidewalk(c, BRIDGE.x1, CANAL.zS, VIS, CROAD.z0, 'footpath', [{ side: 'z1', curb: 'curb' }]);

  // ------------------------------------------------------------ lots at sidewalk height
  // 8-Twelve forecourt + closed shophouse apron (concrete)
  sidewalk(c, CLOSED_HOUSE.apronX, CLOSED_HOUSE.z0, CLOSED_HOUSE.x0, CLOSED_HOUSE.z1, 'concrete_old', []);
  // temple forecourt (terracotta tiles, red-white curb to the canal road)
  sidewalk(c, TEMPLE.x0, TEMPLE.forecourtZ, TEMPLE.x1, TEMPLE.z0, 'tiles_terracotta', []);
  // office plaza
  sidewalk(c, OFFICE.plazaX0, OFFICE.z1, OFFICE.plazaX1, MAIN.swN0, 'pavers_square', []);
  // wholesale forecourt
  sidewalk(c, WHOLESALE.x0 - 4, MAIN.swS1, WHOLESALE.x1, WHOLESALE.z0 + 0.2, 'concrete_old', []);
  // spirit house lot (pavers + soil around the banyan, built in props) & vacant lot are built by their own builders
  S(LOT.x0, LOT.z0, LOT.x1, LOT.z1);
  S(SPIRIT_LOT.x0, SPIRIT_LOT.z0, SPIRIT_LOT.x1, SPIRIT_LOT.z1);
  S(MARKET.x0, MARKET.z0, MARKET.x1, MARKET.z1);
  S(SEVEN.x0, SEVEN.z0, SEVEN.x1, SEVEN.z1);

  // ------------------------------------------------------------ tactile strip on the main road sidewalks
  w.mat('tactile', { autoDirt: false, uv: 'face' });
  for (const [z, x0, x1] of [[2.2, -128, -4], [2.2, 4, 128], [24.4, -128, 128]] as [number, number, number][]) {
    for (let x = x0; x < x1; x += 6) {
      const xe = Math.min(x1, x + 6);
      // strip 0.3 m wide; u across the strip, v along it (bars point along the walk)
      w.quad(x, SW_H + 0.004, z + 0.15, x, SW_H + 0.004, z - 0.15, xe, SW_H + 0.004, z - 0.15, xe, SW_H + 0.004, z + 0.15, [0, 0, 0.3, xe - x]);
    }
  }

  // ------------------------------------------------------------ gutters: inlet grates along the curbs
  w.mat('grate', { autoDirt: false, uv: 'face', group: 'detail' });
  const grate = (x: number, z: number, along: 'x' | 'z') => {
    const y = 0.006;
    if (along === 'x') w.quad(x - 0.5, y, z + 0.16, x + 0.5, y, z + 0.16, x + 0.5, y, z - 0.16, x - 0.5, y, z - 0.16, [0, 0, 1, 0.3125]);
    else w.quad(x - 0.16, y, z + 0.5, x + 0.16, y, z + 0.5, x + 0.16, y, z - 0.5, x - 0.16, y, z - 0.5, [0, 0, 0.3125, 1]);
  };
  for (let z = -8; z > -156; z -= 13 + rng.range(-2, 3)) { grate(SOI.x0 + 0.2, z, 'z'); grate(SOI.x1 - 0.2, z + 6, 'z'); }
  for (let x = -126; x < 126; x += 15 + rng.range(-2, 2)) { if (Math.abs(x) > 5) grate(x, MAIN.z0 + 0.2, 'x'); grate(x + 7, MAIN.z1 - 0.2, 'x'); }

  // ------------------------------------------------------------ road markings (decals)
  if (D) {
    const white = D.get('roadline_white_edge_photo') ?? D.get('roadline_white_worn'), yellow = D.get('roadline_yellow_worn'), dbl = D.get('roadline_double_yellow_photo') ?? D.get('roadline_double_yellow_worn');
    // main road: edge lines + lane dashes + yellow along the median
    for (let x = -VIS; x < VIS; x += 3) {
      groundDecal(w, white, x + 1.5, 0.006, MAIN.z0 + 0.45, 0.15, 3, Math.PI / 2, { alpha: 0.85 });
      groundDecal(w, white, x + 1.5, 0.006, MAIN.z1 - 0.45, 0.15, 3, Math.PI / 2, { alpha: 0.85 });
      groundDecal(w, yellow, x + 1.5, 0.006, MAIN.med0 - 0.3, 0.15, 3, Math.PI / 2, { alpha: 0.8 });
      groundDecal(w, yellow, x + 1.5, 0.006, MAIN.med1 + 0.3, 0.15, 3, Math.PI / 2, { alpha: 0.8 });
    }
    for (let x = -VIS; x < VIS; x += 9) {
      groundDecal(w, white, x + 1.5, 0.006, (MAIN.z0 + MAIN.med0) / 2, 0.15, 3, Math.PI / 2, { alpha: 0.7 });
      groundDecal(w, white, x + 1.5, 0.006, (MAIN.med1 + MAIN.z1) / 2, 0.15, 3, Math.PI / 2, { alpha: 0.7 });
    }
    // soi: faded double yellow centre line in the first 40 m, then broken single
    for (let z = MAIN.z0 - 1.5; z > -40; z -= 3) groundDecal(w, dbl, 0, 0.006, z, 0.3, 3, 0, { alpha: 0.75 });
    for (let z = -44; z > SOI.zN + 2; z -= 9) groundDecal(w, yellow, 0, 0.006, z, 0.13, 3, 0, { alpha: 0.55 });
    // canal road centre line
    for (let x = -VIS; x < VIS; x += 9) groundDecal(w, yellow, x, 0.006, (CROAD.z0 + CROAD.z1) / 2, 0.13, 3, Math.PI / 2, { alpha: 0.5 });
    // zebra crossings (photo: stripes run along image u; ~4.5 m of stripes over the image height)
    const zebP = D.get('roadmark_zebra_worn_photo');
    if (zebP) for (const zb of ZEBRAS) {
      const span = zb.to - zb.from, per = 4.5;
      const fu = Math.min(1, zb.w / 6);
      for (let a0 = zb.from; a0 < zb.to - 0.05; a0 += per) {
        const a1 = Math.min(zb.to, a0 + per);
        const fv = (a1 - a0) / per;
        const r = { ...zebP, u1: zebP.u0 + (zebP.u1 - zebP.u0) * fu, v0: zebP.v1 - (zebP.v1 - zebP.v0) * fv };
        if (zb.axis === 'x') groundDecal(w, r, zb.at, 0.007, (a0 + a1) / 2, zb.w, a1 - a0, 0, { alpha: 0.95 });
        else groundDecal(w, r, (a0 + a1) / 2, 0.007, zb.at, zb.w, a1 - a0, Math.PI / 2, { alpha: 0.95 });
      }
      void span;
    }
    // stop line + "slow" text on the soi approach to the main road
    groundDecal(w, white, -1.75, 0.006, MAIN.z0 - 0.8, 0.3, 3.5, Math.PI / 2, { alpha: 0.85 });

    // ---------------------------------------------------------- manholes, patches, potholes, puddles, oil, gum
    const mh = D.get('manhole_round_iron') ?? D.get('manhole_round_drain'), me = D.get('manhole_round_electric') ?? mh;
    for (let z = -12; z > -156; z -= 22 + rng.range(-4, 4)) groundDecal(w, rng.chance(0.7) ? mh : me, rng.range(-1.6, 1.6), 0.008, z, 0.85, 0.85, rng.range(0, 6.28));
    for (let x = -124; x < 124; x += 26 + rng.range(-5, 5)) groundDecal(w, rng.chance(0.6) ? mh : me, x, 0.008, rng.pick([9, 11.5, 17, 19.5]), 0.85, 0.85, rng.range(0, 6.28));
    for (let i = 0; i < 26; i++) groundDecal(w, rng.chance(0.5) ? mh : me, rng.chance(0.5) ? rng.range(-5.6, -3.9) : rng.range(3.9, 5.6), SW_H + 0.006, rng.range(-150, -2), 0.7, 0.7, rng.range(0, 6.28));
    const patch = (cx: number, cy: number) => D.cell('decal_asphalt_patches', cx, cy, 2, 2);
    const pud = (cx: number, cy: number) => (D.has('decal_puddles_photo') && (cx + cy) % 2 === 0 ? D.cell('decal_puddles_photo', cx, cy, 2, 2) : D.cell('decal_puddles', cx, cy, 2, 2));
    const oil = (cx: number, cy: number) => (D.has('decal_oil_stains_photo') && cx === 0 ? D.cell('decal_oil_stains_photo', cx, cy, 2, 2) : D.cell('decal_oil_stains', cx, cy, 2, 2));
    const hole = (cx: number, cy: number) => D.cell('decal_potholes_photo', cx, cy, 2, 2);
    // potholes (photo) on the soi and main road, often with a puddle
    for (let i = 0; i < 26; i++) {
      const onSoi = i < 14;
      const x = onSoi ? rng.range(-3, 3) : rng.range(-125, 125);
      const z = onSoi ? rng.range(-156, 4) : rng.range(MAIN.z0 + 0.6, MAIN.z1 - 0.6);
      const k = rng.int(0, 3), s = rng.range(0.7, 1.4);
      groundDecal(w, hole(k % 2, k >> 1), x, 0.0095, z, s * 1.3, s, rng.range(0, 6.28), { alpha: 1, tint: 0x7a7670 });
    }
    // litter: bags, bottles, cups, foam boxes along gutters & sidewalks (photo atlas 4x5)
    const lit = (i: number) => D.cell('decal_litter_atlas', i % 4, Math.floor(i / 4) % 5, 4, 5);
    for (let i = 0; i < 120; i++) {
      const t = rng.int(0, 2);
      let x: number, z: number, y = 0.0096;
      if (t === 0) { x = rng.chance(0.5) ? rng.range(-3.45, -3.0) : rng.range(3.0, 3.45); z = rng.range(-156, 4); }
      else if (t === 1) { x = rng.chance(0.5) ? rng.range(-5.9, -3.8) : rng.range(3.8, 5.9); z = rng.range(-156, 0); y = SW_H + 0.007; }
      else { x = rng.range(-125, 125); z = rng.chance(0.5) ? rng.range(6.05, 6.6) : rng.range(21.4, 21.95); }
      const s = rng.range(0.22, 0.4);
      groundDecal(w, lit(rng.int(0, 19)), x, y, z, s, s, rng.range(0, 6.28), { alpha: 1 });
    }
    // cigarette butts near shops / bus stop
    const cig = D.get('decal_cigarette_butts_photo');
    for (let i = 0; i < 24; i++) groundDecal(w, cig, rng.chance(0.5) ? rng.range(-5.8, -4) : rng.range(4, 5.8), SW_H + 0.006, rng.range(-150, -1), 0.9, 0.25, rng.range(0, 6.28), { alpha: 0.9 });
    for (let i = 0; i < 6; i++) groundDecal(w, cig, rng.range(-34, -26), SW_H + 0.006, rng.range(0.8, 4.5), 0.9, 0.25, rng.range(0, 6.28), { alpha: 0.9 });
    for (let i = 0; i < 70; i++) {
      const onSoi = i < 34;
      const x = onSoi ? rng.range(-3, 3) : rng.range(-125, 125);
      const z = onSoi ? rng.range(-156, 5) : rng.range(MAIN.z0 + 0.5, MAIN.z1 - 0.5);
      const k = rng.int(0, 3);
      const s = rng.range(1.2, 2.8);
      groundDecal(w, patch(k % 2, k >> 1), x, 0.007, z, s, s * rng.range(0.7, 1.3), rng.range(0, 6.28), { alpha: rng.range(0.7, 1), tint: 0x8c8882 });
    }
    // puddles collect at gutters and potholes (mirror-like)
    for (let i = 0; i < 46; i++) {
      const side = rng.chance(0.5) ? -1 : 1;
      let x: number, z: number;
      if (i < 26) { x = side * rng.range(2.6, 3.3); z = rng.range(-156, 4); }
      else { x = rng.range(-125, 125); z = rng.chance(0.5) ? rng.range(6.3, 7.2) : rng.range(20.8, 21.7); }
      const k = rng.int(0, 3);
      const s = rng.range(0.8, 2.2);
      groundDecal(w, pud(k % 2, k >> 1), x, 0.009, z, s * rng.range(1, 1.8), s, rng.range(0, 6.28), { wet: 1, alpha: rng.range(0.75, 1) });
    }
    for (let i = 0; i < 60; i++) {
      const k = rng.int(0, 3);
      const onSoi = i < 30;
      const x = onSoi ? rng.range(-3.2, 3.2) : rng.range(-125, 125);
      const z = onSoi ? rng.range(-156, 5) : rng.range(MAIN.z0 + 0.6, MAIN.z1 - 0.6);
      const s = rng.range(0.6, 1.6);
      groundDecal(w, oil(k % 2, k >> 1), x, 0.0085, z, s, s, rng.range(0, 6.28), { alpha: rng.range(0.5, 0.9), rough: 0.35 });
    }
    // oil drips where motorbikes park on the sidewalks + gum spots
    for (let i = 0; i < 40; i++) {
      const side = rng.chance(0.5) ? -1 : 1;
      const k = rng.int(0, 3);
      groundDecal(w, oil(k % 2, k >> 1), side * rng.range(4.2, 5.6), SW_H + 0.007, rng.range(-150, -2), rng.range(0.5, 1.1), rng.range(0.5, 1.1), rng.range(0, 6.28), { alpha: 0.6, rough: 0.4 });
    }
    const gum = D.get('decal_gum_spots_photo') ?? D.get('decal_gum_spots');
    for (let i = 0; i < 40; i++) {
      const side = rng.chance(0.5) ? -1 : 1;
      const z = rng.range(-150, 2);
      groundDecal(w, gum, side * rng.range(4, 5.8), SW_H + 0.006, z, 1.2, 0.4, rng.range(0, 6.28), { alpha: 0.8 });
    }
    for (let i = 0; i < 30; i++) groundDecal(w, gum, rng.range(-120, 120), SW_H + 0.006, rng.chance(0.5) ? rng.range(0.5, 5) : rng.range(22.5, 25.5), 1.2, 0.4, rng.range(0, 6.28), { alpha: 0.8 });
  }
}

function curbPaint(c: Ctx, x0: number, x1: number, z: number, layer: string) {
  curb(c.w, layer, x0, z + 0.002, x1, z + 0.002, 0, 1, SW_H + 0.002, 0.202);
}
function curbPaintS(c: Ctx, x0: number, x1: number, layer: string) {
  curb(c.w, layer, x0, MAIN.z1 - 0.002, x1, MAIN.z1 - 0.002, 0, -1, SW_H + 0.002, 0.202);
}
function curbPaintSoi(c: Ctx, side: -1 | 1, z0: number, z1: number, layer: string) {
  const x = side < 0 ? SOI.x0 + 0.002 : SOI.x1 - 0.002;
  curb(c.w, layer, x, z0, x, z1, side < 0 ? 1 : -1, 0, SW_H + 0.002, 0.202);
}

/** subtract axis-aligned rects from a rect */
export function subtract(r: { x0: number; z0: number; x1: number; z1: number }, holes: { x0: number; z0: number; x1: number; z1: number }[]) {
  let parts = [r];
  for (const h of holes) {
    const next: typeof parts = [];
    for (const p of parts) {
      if (h.x1 <= p.x0 || h.x0 >= p.x1 || h.z1 <= p.z0 || h.z0 >= p.z1) { next.push(p); continue; }
      if (h.z0 > p.z0) next.push({ x0: p.x0, z0: p.z0, x1: p.x1, z1: h.z0 });
      if (h.z1 < p.z1) next.push({ x0: p.x0, z0: h.z1, x1: p.x1, z1: p.z1 });
      const z0 = Math.max(p.z0, h.z0), z1 = Math.min(p.z1, h.z1);
      if (h.x0 > p.x0) next.push({ x0: p.x0, z0, x1: h.x0, z1 });
      if (h.x1 < p.x1) next.push({ x0: h.x1, z0, x1: p.x1, z1 });
    }
    parts = next;
  }
  return parts.filter((p) => p.x1 - p.x0 > 0.01 && p.z1 - p.z0 > 0.01);
}

/** base ground everywhere not covered by built surfaces (concrete in the city) */
export function buildBaseGround(c: Ctx, extraHoles: { x0: number; z0: number; x1: number; z1: number }[]) {
  const w = c.w;
  const holes = [...SURFACES, ...extraHoles];
  const cell = 20;
  for (let x = -300; x < 300; x += cell) for (let z = -170; z < 200; z += cell) {
    const r = { x0: x, z0: Math.max(z, -165), x1: x + cell, z1: z + cell };
    if (r.z1 <= r.z0) continue;
    const parts = subtract(r, holes);
    for (const p of parts) {
      const far = p.x0 > 130 || p.x1 < -130 || p.z0 > 90;
      w.mat(far ? 'concrete_road' : 'concrete_old', { autoDirt: false, tint: far ? 0x9a948a : 0xa8a298, uo: x * 0.37, vo: z * 0.21 });
      flat(w, p.x0, p.z0, p.x1, p.z1, 0, 20);
    }
  }
  // a single collider under the whole city (and beyond) at y=0
  c.phys.box([0, -0.5, 10], [900, 1, 340]);
}

void PY; void PX; void NX; void PZ; void NZ;
