import * as THREE from 'three';
import { RNG } from '../../core/rng';
import { WB, ALL, SIDES, PX, NX, PY, NY, PZ, NZ, hash2 } from './geo';
import type { Props } from './props';
import { PLASTIC_COLORS } from './props';
import type { UnitSpec, Face } from './layout';
import { SW_H } from './layout';
import type { NightLights } from './lights';
import type { Atlas, AtlasRect } from './atlas';
import { EMIS } from './mats';
import type { AnchorPt } from '../../game/contracts';

/**
 * PROCEDURAL SHOPHOUSE (ตึกแถว) GENERATOR
 * Local frame per unit: x 0..W along the facade (left→right seen from the street), facade plane
 * z = 0 (street at +z, building interior toward -z), y up. Ground floor sits on the sidewalk (0.15).
 */

export interface SignPick { r: AtlasRect; glow: number; id: string }
export interface SignSource {
  /** pick a sign for a category; aspect = width / height wanted */
  pick(cat: string, aspect: number, rng: RNG): SignPick | null;
  /** pick a photo for a shop interior back wall */
  interior(cat: string, rng: RNG): AtlasRect | null;
  poster(rng: RNG): AtlasRect | null;
  graffiti(rng: RNG): AtlasRect | null;
}

export interface ShopCtx {
  w: WB;
  props: Props;
  lights: NightLights;
  signs: SignSource | null;
  decals: Atlas | null;
  phys: { box(c: number[], s: number[], yaw?: number): void };
  anchors: Record<string, AnchorPt>;
  /** shops whose fronts are owned by the shops module (no shutters, keep 3.5 m clear) */
  managed: Set<string>;
}

const WALL_TINTS = [0xe8dcc8, 0xd9c7a6, 0xc9d6c2, 0xe2c6c0, 0xc8d2dc, 0xe6d7a0, 0xd8d8d0, 0xb8c4a8, 0xd8b8a0, 0xa8b8c8, 0xe0e0d8, 0xd0c0b0, 0xc0b8a8, 0xe8c8a0];
const TRIM_TINTS = [0xffffff, 0xe0d8c8, 0x8a8478, 0x5a6a5a, 0x7a3a2a, 0x3a4a6a];
const GRILLE_TINTS = [0xe8e8e0, 0x2a2a2a, 0x3a5a3a, 0x6a4a2a, 0x8a8a8a, 0x2a3a5a, 0x9a2a2a];
const SHUTTER_TINTS = [0xc8c8c0, 0x8aa0b0, 0x9aa890, 0xc0a080, 0x7a8a9a, 0xd0c8a8, 0xa04030, 0x40607a];

/** world frame of a unit */
export function unitFrame(u: { face: Face; line: number; a0: number; a1: number }) {
  const W = u.a1 - u.a0;
  switch (u.face) {
    case 'W': return { ox: u.line, oz: u.a0, yaw: Math.atan2(-1, 0), W };   // U = +Z (south)
    case 'E': return { ox: u.line, oz: u.a1, yaw: Math.atan2(1, 0), W };    // U = -Z
    case 'S': return { ox: u.a0, oz: u.line, yaw: 0, W };                   // U = +X, facade faces +Z
    case 'N': return { ox: u.a1, oz: u.line, yaw: Math.PI, W };             // U = -X
  }
}

export class Shophouse {
  private m = new THREE.Matrix4();
  private yaw = 0;
  private ox = 0; private oz = 0;
  constructor(private c: ShopCtx) {}

  /** local AABB → world collider */
  col(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const cs = Math.cos(this.yaw), sn = Math.sin(this.yaw);
    // rotation about Y by yaw: x' = x cos + z sin, z' = -x sin + z cos
    const wx = this.ox + cx * cs + cz * sn, wz = this.oz - cx * sn + cz * cs;
    this.c.phys.box([wx, (y0 + y1) / 2, wz], [Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)], this.yaw);
  }
  /** local point → world */
  wp(x: number, y: number, z: number) {
    const cs = Math.cos(this.yaw), sn = Math.sin(this.yaw);
    return new THREE.Vector3(this.ox + x * cs + z * sn, y, this.oz - x * sn + z * cs);
  }

  /** wall plane z = zf (facing +z) between x0..x1, y0..y1 with rectangular holes (+ reveals of depth rd) */
  wallHoles(x0: number, x1: number, y0: number, y1: number, holes: number[][], zf = 0, rd = 0.14, revealMat?: () => void) {
    const w = this.c.w;
    const ys = new Set<number>([y0, y1]);
    for (const h of holes) { if (h[2] > y0 && h[2] < y1) ys.add(h[2]); if (h[3] > y0 && h[3] < y1) ys.add(h[3]); }
    const yl = [...ys].sort((a, b) => a - b);
    for (let i = 0; i < yl.length - 1; i++) {
      const ya = yl[i], yb = yl[i + 1];
      const cov = holes.filter((h) => h[2] <= ya + 1e-4 && h[3] >= yb - 1e-4).map((h) => [Math.max(x0, h[0]), Math.min(x1, h[1])]).sort((a, b) => a[0] - b[0]);
      let x = x0;
      for (const [a, b] of cov) { if (a > x + 1e-4) w.quad(x, ya, zf, a, ya, zf, a, yb, zf, x, yb, zf); x = Math.max(x, b); }
      if (x < x1 - 1e-4) w.quad(x, ya, zf, x1, ya, zf, x1, yb, zf, x, yb, zf);
    }
    if (rd > 0) {
      revealMat?.();
      for (const h of holes) {
        const [a, b, c2, d] = h;
        const z1 = zf - rd;
        w.quad(a, c2, z1, a, c2, zf, a, d, zf, a, d, z1);          // left reveal (faces +x)
        w.quad(b, c2, zf, b, c2, z1, b, d, z1, b, d, zf);          // right reveal (faces -x)
        w.quad(a, d, zf, b, d, zf, b, d, z1, a, d, z1);            // head (faces -y)
        w.quad(a, c2, z1, b, c2, z1, b, c2, zf, a, c2, zf);        // sill (faces +y)
      }
    }
  }

  build(u: UnitSpec, nb: { left: number; right: number; mergeL: boolean; mergeR: boolean }, ord: number) {
    const c = this.c, w = c.w, P = c.props;
    const f = unitFrame(u);
    const W = f.W;
    this.yaw = f.yaw; this.ox = f.ox; this.oz = f.oz;
    const seed = (u.seed ?? Math.floor(hash2(f.ox * 1.37 + ord, f.oz * 0.91) * 1e9));
    const rng = new RNG(seed);
    const far = !!u.far;
    const D = u.depth ?? 14;
    const dims = unitDims(u);
    const n = dims.n;
    const y0 = SW_H;
    const h0 = dims.h0;
    const hf = dims.hf;
    const y1 = y0 + h0;
    const yR = y1 + (n - 1) * hf;
    const par = dims.par;
    const yP = yR + par;
    const pw = 0.16;
    const shop = u.shop ?? rng.weighted(['residence', 'closed', 'grocery', 'eatery', 'open'], [4, 2, 2, 2, 2]);
    const managed = !!u.name && c.managed.has(u.name) || (shop === 'kitchen' || shop === 'plastic' || shop === 'gas');
    let ground = u.ground ?? (shop === 'closed' ? 'shutter' : shop === 'residence' ? rng.pick(['gate', 'shutter', 'half'] as const) : 'open');
    if (managed) ground = 'open';
    const apt = u.style === 'apartment';
    const noG = !!u.noGround;
    // ---- look
    const wallL = u.wall ?? rng.weighted(['plaster', 'plaster_dirty', 'plaster_peeling', 'concrete_streaked', 'tiles_wall', 'plaster_red'], [42, 22, 12, 12, 7, 3]);
    const tint = u.tint ?? (wallL === 'plaster' || wallL === 'plaster_dirty' ? rng.pick(WALL_TINTS) : wallL === 'tiles_wall' ? rng.pick([0xffffff, 0xe8f0e8, 0xf0e8e0, 0xd8e4f0]) : 0xffffff);
    const ovL = rng.pick(['plaster_moldy', 'concrete_streaked', 'plaster_moldy', 'plaster_dirty']);
    const ovA = rng.range(0.35, 0.95);
    const trim = rng.pick(TRIM_TINTS);
    const wallMat = (o: any = {}) => w.mat(wallL, { tint, ov: ovL, ovAmt: ovA, ...o });
    const trimMat = (o: any = {}) => w.mat('plaster_dirty', { tint: trim, ov: 'plaster_moldy', ovAmt: 0.6, ...o });
    const winStyle = rng.weighted(['slider', 'louver', 'twin', 'old', 'strip'], [38, 16, 18, 12, 16]);
    const grilleCol = rng.pick(GRILLE_TINTS);
    const rd = Math.min(D - 1.5, rng.range(5.5, 8.5));

    w.pushT(f.ox, 0, f.oz, f.yaw);
    w.setGroup('base');

    // ================================================================ GROUND FLOOR
    const yb = y1 - 0.45;              // beam bottom (top of the opening)
    const open = !noG && ground !== 'shutter' && ground !== 'closed';
    if (!noG) {
    const ox0 = nb.mergeL ? 0 : pw, ox1 = nb.mergeR ? W : W - pw;
    // pilasters at ground level (tiles or plaster)
    const pilL = rng.chance(0.35) ? 'tiles_wall' : wallL;
    const pilT = pilL === 'tiles_wall' ? rng.pick([0xffffff, 0xd8e8d8, 0xe8d8c8, 0x8a2a2a]) : tint;
    w.mat(pilL, { tint: pilT, ov: ovL, ovAmt: ovA });
    if (!nb.mergeL) w.box(0, y0, -0.25, pw, yb + 0.02, 0.06, PZ | PX | NX);
    if (!nb.mergeR) w.box(W - pw, y0, -0.25, W, yb + 0.02, 0.06, PZ | PX | NX);
    if (nb.mergeL) w.box(-0.11, y0, -0.18, 0.11, yb, 0.04, PZ | PX | NX);
    // beam band above the opening
    wallMat();
    w.box(0, yb, -0.2, W, y1, 0.03, PZ | NY);
    // floor slab of the unit (shop floor at sidewalk height)
    if (open) {
      const fl = shop === 'gold' || shop === 'pharmacy' || shop === 'phone' || shop === 'salon' ? 'tiles_floor' : rng.pick(['terrazzo', 'tiles_floor', 'concrete_old', 'tiles_terracotta']);
      w.mat(fl, { autoDirt: false, ao: 0.8, tint: fl === 'concrete_old' ? 0x9a948a : 0xffffff });
      w.quad(ox0, y0 + 0.002, 0, ox1, y0 + 0.002, 0, ox1, y0 + 0.002, -rd, ox0, y0 + 0.002, -rd);
      this.col(0, 0, -rd, W, y0, 0);
      // interior shell
      const inL = shop === 'gold' ? 'plaster' : rng.pick(['plaster', 'plaster_dirty', 'tiles_wall', 'plaster_moldy']);
      const inT = shop === 'gold' ? 0x8a1a1a : shop === 'pharmacy' ? 0xf0f0ec : rng.pick([0xe8e4d8, 0xd8d0c0, 0xc8d0c8, 0xe0d8c8]);
      w.mat(inL, { tint: inT, ao: 0.62, ov: 'plaster_moldy', ovAmt: 0.4, autoDirt: true });
      if (!nb.mergeL) w.quad(ox0, y0, -rd, ox0, y0, 0, ox0, yb, 0, ox0, yb, -rd); // left wall faces +x
      if (!nb.mergeR) w.quad(ox1, y0, 0, ox1, y0, -rd, ox1, yb, -rd, ox1, yb, 0); // right wall faces -x
      w.quad(ox0, y0, -rd, ox1, y0, -rd, ox1, yb, -rd, ox0, yb, -rd);              // back wall
      w.mat('plaster_dirty', { tint: 0x9a968c, ao: 0.5 });
      w.quad(ox0, yb, 0, ox1, yb, 0, ox1, yb, -rd, ox0, yb, -rd);                  // ceiling (faces down)
      // back door into the dark house
      w.mat('wood_paint', { tint: rng.pick([0x6a4a2a, 0x4a5a6a, 0x7a6a5a]), ao: 0.5 });
      const dx = rng.range(ox0 + 0.4, Math.max(ox0 + 0.5, ox1 - 1.4));
      w.box(dx, y0, -rd + 0.01, dx + 0.9, y0 + 2.1, -rd + 0.04, PZ);
      // ceiling tubes (lit in the day for shops, at night for all)
      const pal = shop === 'residence' ? EMIS.warm.i : shop === 'gold' ? EMIS.shopwarm.i : EMIS.shopwarm.i;
      for (let k = 0; k < (W > 5 ? 2 : 1); k++) {
        const tx = W > 5 ? ox0 + (ox1 - ox0) * (k + 0.5) / 2 : (ox0 + ox1) / 2;
        w.mat('plastic', { tint: 0xf4f8ff, emis: pal, emisK: 0.7, ao: 1 });
        w.box(tx - 0.6, yb - 0.06, -rd * 0.45 - 0.03, tx + 0.6, yb - 0.02, -rd * 0.45 + 0.03, ALL & ~PY);
      }
      // colliders: back part + thin side walls (interior stays enterable)
      this.col(0, 0, -D, W, yP, -rd);
      if (!nb.mergeL) this.col(0, 0, -rd, pw, yb, 0);
      if (!nb.mergeR) this.col(W - pw, 0, -rd, W, yb, 0);
      // light point for the pool (shop glow spilling onto the sidewalk)
      const lp = this.wp(W / 2, yb - 0.2, -1.2);
      c.lights.add({ p: lp, color: new THREE.Color(shop === 'residence' ? 0xffc890 : 0xfff0d8), intensity: shop === 'residence' ? 6 : 12, range: 9, glow: 0, kind: 'tube', day: 0 });
      this.dressInterior(shop, ground, W, rd, ox0, ox1, y0, yb, rng, managed, u, nb);
    } else {
      this.col(0, 0, -D, W, yP, 0);
    }
    // closing elements
    if (!managed) {
      if (ground === 'shutter' || ground === 'closed' || ground === 'half') {
        const sl = rng.chance(ground === 'closed' ? 0.8 : 0.45) ? 'shutter_rust' : 'shutter';
        const st = sl === 'shutter' ? rng.pick(SHUTTER_TINTS) : 0xffffff;
        const bottom = ground === 'half' ? y0 + rng.range(1.1, 1.8) : y0;
        w.mat(sl, { tint: st, uv: 'face', ov: 'steel_rust', ovAmt: rng.range(0.2, 0.7), autoDirt: true });
        w.quad(ox0, bottom, -0.06, ox1, bottom, -0.06, ox1, yb, -0.06, ox0, yb, -0.06);
        if (ground === 'half') { w.mat('metal_paint', { tint: 0x4a4a48 }); w.box(ox0, bottom - 0.05, -0.1, ox1, bottom, -0.02, ALL); }
        // shutter housing box
        w.mat('metal_paint', { tint: st, ov: 'steel_rust', ovAmt: 0.5 });
        w.box(ox0, yb - 0.32, -0.06, ox1, yb, 0.22, PZ | NY | PX | NX);
        // padlocks / handles
        w.mat('steel_rust');
        if (ground !== 'half') { w.box(W / 2 - 0.2, y0 + 0.02, -0.06, W / 2 - 0.12, y0 + 0.12, 0.02, ALL); w.box(W / 2 + 0.12, y0 + 0.02, -0.06, W / 2 + 0.2, y0 + 0.12, 0.02, ALL); }
        // graffiti on closed shutters
        if (ground !== 'half' && c.signs && rng.chance(0.55)) {
          const g = c.signs.graffiti(rng);
          if (g) this.decalOnFacade(g, ox0 + rng.range(0.1, 0.6), y0 + rng.range(0.4, 1.0), rng.range(1.4, Math.min(3.0, ox1 - ox0 - 0.4)), -0.055);
        }
        if (ground === 'half') this.col(ox0, bottom, -0.15, ox1, yb, 0);
        else this.col(ox0, y0, -0.15, ox1, yb, 0);
      } else if (ground === 'gate') {
        // folding (accordion) steel gate, partly drawn
        const cover = rng.range(0.55, 1.0);
        const gx1 = ox0 + (ox1 - ox0) * cover;
        const gcol = rng.pick([0x5a5a58, 0x3a4a3a, 0x7a7a70, 0x2a2a2a]);
        w.setGroup('detail');
        w.mat('metal_paint', { tint: gcol, ov: 'steel_rust', ovAmt: 0.6, uv: 'local' });
        w.box(ox0, yb - 0.06, -0.12, ox1, yb, -0.06, ALL);
        w.box(ox0, y0, -0.12, ox1, y0 + 0.04, -0.06, ALL & ~NY);
        const gh = yb - y0;
        const step = 0.11;
        for (let x = ox0 + 0.02; x < gx1; x += step) w.box(x, y0, -0.11, x + 0.022, yb - 0.06, -0.07, PZ | NZ | PX | NX);
        // diagonal lattice (X pattern) between the bars
        for (let x = ox0 + 0.02; x < gx1 - step; x += step * 2) {
          for (let k = 0; k < 3; k++) {
            const ya = y0 + 0.2 + k * gh / 3, yb2 = ya + gh / 3 - 0.2;
            w.pushTR(x + step, (ya + yb2) / 2, -0.09, 0, 0, Math.atan2(gh / 3 - 0.2, step * 2) * 0 + 0.95);
            w.box(-0.012, -(gh / 3) * 0.5, -0.008, 0.012, (gh / 3) * 0.5, 0.008, PZ | NZ);
            w.pop();
          }
        }
        w.setGroup('base');
        this.col(ox0, y0, -0.15, gx1, yb, -0.05);
      }
    }

    } // !noG
    // ================================================================ CANOPY / AWNING
    const cd = u.noCanopy ? 0 : rng.range(0.7, 1.15);
    if (!u.noCanopy) {
    wallMat({ ao: 0.85 });
    w.box(0, yb + 0.12, 0.03, W, yb + 0.3, cd, PY | NY | PZ | (nb.left === 0 ? NX : 0) | (nb.right === 0 ? PX : 0));
    trimMat();
    w.box(0, yb - 0.05, cd - 0.08, W, yb + 0.3, cd, PZ | NY | NZ);
    const awn = u.awning ?? rng.weighted(['none', 'corr', 'tarp', 'corr'], [3, 4, 2, 2]);
    if (awn === 'corr' && !far) {
      // corrugated / polycarbonate extension sloping toward the street on steel brackets
      const ad = rng.range(1.2, 2.2), ay = yb + 0.2, drop = ad * 0.18;
      const layer = rng.pick(['corr_rust', 'roof_galv', 'corr_paint', 'roof_fibre']);
      w.mat(layer, { tint: layer === 'corr_paint' ? rng.pick([0x3a6a9a, 0xa04030, 0x3a7a4a, 0xc8c0a0]) : 0xffffff, ao: 0.9, uv: 'local' });
      w.quad(0, ay - drop, cd + ad, W, ay - drop, cd + ad, W, ay, cd - 0.05, 0, ay, cd - 0.05);
      w.quad(W, ay - drop - 0.01, cd + ad, 0, ay - drop - 0.01, cd + ad, 0, ay - 0.01, cd - 0.05, W, ay - 0.01, cd - 0.05);
      w.mat('steel_rust', { uv: 'local' });
      for (const x of [0.15, W - 0.15]) w.tube([x, yb - 0.6, 0.03, x, ay - drop - 0.03, cd + ad - 0.1], 0.025, 4);
    } else if (awn === 'tarp' && !far) {
      const ad = rng.range(1.6, 2.6), ay = yb + 0.1;
      w.mat('tarp', { tint: rng.pick([0x2a5ab0, 0x2a8a4a, 0xc0b8a0, 0xb03a2a, 0x3a3a8a]), ao: 0.95, uv: 'local' });
      const sag = 0.18;
      w.quad(0, ay - 0.5, cd + ad, W, ay - 0.5, cd + ad, W, ay, cd, 0, ay, cd);
      w.quad(W, ay - 0.5 - 0.005, cd + ad, 0, ay - 0.5 - 0.005, cd + ad, 0, ay - 0.005, cd, W, ay - 0.005, cd);
      w.quad(0, ay - 0.5 - sag, cd + ad + 0.02, W, ay - 0.5 - sag, cd + ad + 0.02, W, ay - 0.5, cd + ad, 0, ay - 0.5, cd + ad);
      if (rng.chance(0.6) && open) {
        w.mat('steel_rust', { uv: 'local' });
        for (const x of [0.2, W - 0.2]) w.cyl(x, y0, cd + ad - 0.1, 0.025, 0.025, ay - 0.5 - y0, 5, 0);
      }
    }

    } // canopy
    // ================================================================ UPPER FLOORS
    const holes: number[][] = [];
    const floors: { y: number; style: string; balcony: boolean; grille: boolean; hx0: number; hx1: number; hy0: number; hy1: number }[] = [];
    for (let k = 1; k < n; k++) {
      const yk = y1 + (k - 1) * hf;
      const balcony = apt || (!far && rng.chance(k === n - 1 ? 0.25 : 0.32) && W > 3.6);
      const grille = apt ? rng.chance(0.85) : rng.chance(balcony ? 0.5 : 0.55);
      if (balcony) {
        const hx0 = 0.4, hx1 = W - 0.4, hy0 = yk + 0.08, hy1 = yk + 2.5;
        holes.push([hx0, hx1, hy0, hy1]);
        floors.push({ y: yk, style: 'balcony', balcony, grille, hx0, hx1, hy0, hy1 });
      } else if (winStyle === 'twin' || (winStyle === 'old' && W > 3.9)) {
        const gap = winStyle === 'old' ? 0.55 : 0.4;
        const ww = (W - 2 * 0.45 - gap) / 2;
        const hy0 = yk + (winStyle === 'old' ? 0.6 : 0.95), hy1 = yk + 2.45;
        holes.push([0.45, 0.45 + ww, hy0, hy1], [W - 0.45 - ww, W - 0.45, hy0, hy1]);
        floors.push({ y: yk, style: winStyle, balcony, grille, hx0: 0.45, hx1: W - 0.45, hy0, hy1 });
      } else {
        const m = winStyle === 'strip' ? 0.3 : 0.55;
        const hy0 = yk + (winStyle === 'strip' ? 1.0 : 0.9), hy1 = yk + (winStyle === 'strip' ? 2.25 : 2.4);
        holes.push([m, W - m, hy0, hy1]);
        floors.push({ y: yk, style: winStyle, balcony, grille, hx0: m, hx1: W - m, hy0, hy1 });
      }
    }
    // facade wall (between pilasters handled as one plane; pilasters added on top)
    wallMat();
    this.wallHoles(0, W, y1, yP, holes, 0, 0.22, () => wallMat({ ao: 0.8 }));
    // pilasters (upper)
    w.mat(wallL, { tint: new THREE.Color(tint).multiplyScalar(0.94).getHex(), ov: ovL, ovAmt: ovA });
    if (!nb.mergeL || true) w.box(0, y1, 0, pw, yP + 0.06, 0.07, PZ | PX | (nb.left < yP ? NX : 0));
    w.box(W - pw, y1, 0, W, yP + 0.06, 0.07, PZ | NX | (nb.right < yP ? PX : 0));
    // floor bands + parapet coping
    trimMat();
    for (let k = 1; k < n; k++) { const yk = y1 + (k - 1) * hf; if (k > 1) w.box(0, yk - 0.14, 0, W, yk + 0.05, 0.09, PZ | PY | NY); }
    w.box(-0.02, yP, -0.3, W + 0.02, yP + 0.07, 0.1, ALL & ~NY);
    if (rng.chance(0.5)) w.box(0, yR - 0.12, 0, W, yR + 0.08, 0.1, PZ | PY | NY); // roof slab edge band
    // windows, grilles, balconies, AC units, laundry
    for (const fl of floors) this.floorFill(fl, W, hf, rng, grilleCol, trim, far);

    // ================================================================ SIDE / BACK WALLS + ROOF
    const sideL = rng.pick(['concrete_streaked', 'plaster_moldy', 'cement_block', 'plaster_brick']);
    w.mat(sideL, { tint: sideL === 'plaster_moldy' ? tint : 0xffffff, ov: 'plaster_moldy', ovAmt: 0.75 });
    if (u.corner === 'left') this.sideFacade(0, D, n, y1, hf, yP, rng, wallMat, trimMat, grilleCol, far, -Math.PI / 2, 0, -D);
    else if (nb.left < yP - 0.05) w.quad(0, Math.max(0, nb.left), -D, 0, Math.max(0, nb.left), 0, 0, yP, 0, 0, yP, -D);
    w.mat(sideL, { tint: sideL === 'plaster_moldy' ? tint : 0xffffff, ov: 'plaster_moldy', ovAmt: 0.75 });
    if (u.corner === 'right') this.sideFacade(0, D, n, y1, hf, yP, rng, wallMat, trimMat, grilleCol, far, Math.PI / 2, W, 0);
    else if (nb.right < yP - 0.05) w.quad(W, Math.max(0, nb.right), 0, W, Math.max(0, nb.right), -D, W, yP, -D, W, yP, 0);
    // back wall
    w.mat(sideL, { tint: 0xffffff, ov: 'plaster_moldy', ovAmt: 0.85 });
    w.quad(W, 0, -D, 0, 0, -D, 0, yP, -D, W, yP, -D);
    if (!far) {
      w.mat('glass', { tint: 0x0e1012, ao: 0.6 });
      for (let k = 1; k < n; k++) { const yk = y1 + (k - 1) * hf; w.quad(W * 0.6 + 0.6, yk + 1.0, -D - 0.02, W * 0.6 - 0.4, yk + 1.0, -D - 0.02, W * 0.6 - 0.4, yk + 2.0, -D - 0.02, W * 0.6 + 0.6, yk + 2.0, -D - 0.02); }
    }
    // roof slab + parapets
    w.mat('roof_slab', { autoDirt: false, ao: 0.9 });
    w.quad(0, yR, -0.15, W, yR, -0.15, W, yR, -D, 0, yR, -D);
    wallMat({ ov: 'plaster_moldy', ovAmt: 0.9 });
    w.box(0, yR, -D, W, yP, -D + 0.15, PZ | PY);                       // back parapet inner side
    w.box(0, yR, -D + 0.15, 0.15, yP, -0.15, PX | PY);
    w.box(W - 0.15, yR, -D + 0.15, W, yP, -0.15, NX | PY);
    w.box(0, yR, -0.3, W, yP, -0.15, NZ);                               // front parapet inner face
    if (!far) this.roofStuff(W, D, yR, rng);
    // facade cables: a vertical bundle near a pilaster
    if (!far && rng.chance(0.6)) {
      w.setGroup('detail');
      w.mat('rubber', { uv: 'local' });
      const cx = rng.chance(0.5) ? 0.25 : W - 0.25;
      for (let i = 0; i < rng.int(2, 5); i++) w.tube([cx + i * 0.03, yb + 0.3, 0.12 + i * 0.015, cx + i * 0.035 + 0.02, yR - 0.5, 0.1 + i * 0.012, cx + 0.5, yR + 0.2, 0.05], 0.012, 3);
      w.setGroup('base');
    }

    // ================================================================ SIGNS
    if (!u.noSign && c.signs) this.signs(u, shop, W, yb, y1, cd, n, hf, rng, open);
    w.pop();
    return { height: yP, storeys: n };
  }

  /** a street-facing side wall (corner unit): windows per floor, AC units, a ground-floor window */
  private sideFacade(_x: number, D: number, n: number, y1: number, hf: number, yP: number, rng: RNG, wallMat: (o?: any) => void, trimMat: (o?: any) => void, grilleCol: number, far: boolean, rot: number, ox: number, oz: number) {
    const w = this.c.w, P = this.c.props;
    w.pushT(ox, 0, oz, rot);
    const holes: number[][] = [];
    const nw = Math.max(1, Math.floor((D - 1.5) / 3.4));
    const span = (D - 1.2) / nw;
    for (let k = 1; k < n; k++) {
      const yk = y1 + (k - 1) * hf;
      for (let i = 0; i < nw; i++) { const a = 0.6 + i * span + span * 0.18, b = 0.6 + (i + 1) * span - span * 0.18; holes.push([a, b, yk + 0.95, yk + 2.3]); }
    }
    // ground floor shop window near the front
    holes.push([D - 3.4, D - 0.6, SW_H + 0.6, y1 - 0.8]);
    wallMat();
    this.wallHoles(0, D, 0, yP, holes, 0, 0.18, () => wallMat({ ao: 0.8 }));
    const lit = rng.chance(0.4);
    for (const h of holes) {
      w.mat('glass', { tint: rng.pick([0x0c0e10, 0x14181a, 0x1a1612]), emis: lit && rng.chance(0.5) ? EMIS.warm.i : 0, emisK: 0.4 });
      w.quad(h[0], h[2], -0.12, h[1], h[2], -0.12, h[1], h[3], -0.12, h[0], h[3], -0.12);
      w.mat('alu', { tint: 0xc8c8c0, uv: 'local' });
      const t = 0.04;
      w.box(h[0], h[2], -0.14, h[1], h[2] + t, -0.1, PZ | PY);
      w.box(h[0], h[3] - t, -0.14, h[1], h[3], -0.1, PZ | NY);
      w.box((h[0] + h[1]) / 2 - t / 2, h[2], -0.14, (h[0] + h[1]) / 2 + t / 2, h[3], -0.1, PZ | PX | NX);
      trimMat();
      w.box(h[0] - 0.05, h[2] - 0.06, 0, h[1] + 0.05, h[2], 0.07, PZ | PY | NY | PX | NX);
      if (!far && h[2] > y1 && rng.chance(0.35)) { w.setGroup('detail'); w.put(P.acUnit(), (h[0] + h[1]) / 2, h[2] - 0.75, 0.02, 0); w.setGroup('base'); }
      if (!far && h[2] > y1 && rng.chance(0.3)) {
        w.setGroup('detail');
        w.mat('metal_paint', { tint: grilleCol, ov: 'steel_rust', ovAmt: 0.5, uv: 'local' });
        for (let x = h[0]; x <= h[1] + 0.01; x += 0.12) w.box(x, h[2] - 0.04, 0.14, x + 0.016, h[3] + 0.04, 0.16, PZ | PX | NX);
        w.box(h[0] - 0.04, h[2] - 0.05, 0, h[1] + 0.04, h[2] - 0.02, 0.17, ALL);
        w.box(h[0] - 0.04, h[3] + 0.02, 0, h[1] + 0.04, h[3] + 0.05, 0.17, ALL);
        w.setGroup('base');
      }
    }
    trimMat();
    for (let k = 2; k < n; k++) { const yk = y1 + (k - 1) * hf; w.box(0, yk - 0.14, 0, D, yk + 0.05, 0.09, PZ | PY | NY); }
    w.box(0, yP, -0.3, D, yP + 0.07, 0.1, ALL & ~NY);
    w.pop();
  }

  /** decal on the facade plane (local coords) */
  private decalOnFacade(r: AtlasRect, x: number, y: number, width: number, z: number, alpha = 0.9) {
    const w = this.c.w;
    const h = width / Math.max(0.2, r.aspect);
    w.atlas('decal', { ao: alpha, group: 'detail' });
    w.quad(x, y, z + 0.012, x + width, y, z + 0.012, x + width, y + h, z + 0.012, x, y + h, z + 0.012, [r.u0, r.v0, r.u1, r.v1]);
  }

  private floorFill(fl: { y: number; style: string; balcony: boolean; grille: boolean; hx0: number; hx1: number; hy0: number; hy1: number }, W: number, hf: number, rng: RNG, grilleCol: number, trim: number, far: boolean) {
    const w = this.c.w, P = this.c.props;
    const zg = -0.12;
    const lit = rng.chance(0.35);
    const pal = rng.weighted([EMIS.warm.i, EMIS.cool.i, EMIS.tv.i], [5, 4, 1]);
    const glassT = rng.pick([0x0c0e10, 0x101418, 0x14181a, 0x1a1612, 0x18141a, 0x22201c]);
    const glass = (x0: number, y0: number, x1: number, y1: number, z = zg) => {
      w.mat('glass', { tint: glassT, emis: lit ? pal : 0, emisK: rng.range(0.25, 0.55), ao: 1 });
      w.quad(x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z);
      if (lit) this.c.lights.add({ p: this.wp((x0 + x1) / 2, (y0 + y1) / 2, z + 0.3), color: new THREE.Color(EMIS.warm.c), intensity: 0, range: 0, glow: 0, kind: 'window' });
    };
    const frame = (x0: number, y0: number, x1: number, y1: number, mullions: number, col: number, layer = 'alu') => {
      w.mat(layer, { tint: col, uv: 'local' });
      const t = 0.045, z0 = zg - 0.02, z1 = zg + 0.035;
      w.box(x0, y0, z0, x1, y0 + t, z1, PZ | PY);
      w.box(x0, y1 - t, z0, x1, y1, z1, PZ | NY);
      w.box(x0, y0, z0, x0 + t, y1, z1, PZ | PX);
      w.box(x1 - t, y0, z0, x1, y1, z1, PZ | NX);
      for (let i = 1; i <= mullions; i++) { const x = x0 + ((x1 - x0) * i) / (mullions + 1); w.box(x - t / 2, y0, z0, x + t / 2, y1, z1, PZ | PX | NX); }
    };
    const louvers = (x0: number, y0: number, x1: number, y1: number, col: number, openL: boolean) => {
      const mid = (x0 + x1) / 2;
      w.mat('wood_paint', { tint: col, uv: 'local', ov: 'plaster_moldy', ovAmt: 0.4 });
      const leaf = (a: number, b: number, hingeX: number, ang: number) => {
        w.pushTR(hingeX, 0, zg + 0.02, 0, ang, 0);
        const la = a - hingeX, lb = b - hingeX;
        w.box(Math.min(la, lb), y0, -0.02, Math.max(la, lb), y1, 0.02, ALL);
        w.mat('wood_paint', { tint: new THREE.Color(col).multiplyScalar(0.7).getHex(), uv: 'local' });
        for (let y = y0 + 0.12; y < y1 - 0.1; y += 0.11) w.box(Math.min(la, lb) + 0.05, y, 0.02, Math.max(la, lb) - 0.05, y + 0.035, 0.035, PZ | PY);
        w.mat('wood_paint', { tint: col, uv: 'local' });
        w.pop();
      };
      glass(x0, y0, x1, y1, zg - 0.08);
      leaf(x0, mid, x0, openL ? -1.6 : 0);
      leaf(mid, x1, x1, rng.chance(0.3) ? 1.5 : 0);
    };
    if (fl.style === 'balcony') {
      // recessed glazed doors + balcony slab + railing / cage
      glass(fl.hx0, fl.hy0, fl.hx1, fl.hy1);
      frame(fl.hx0, fl.hy0, fl.hx1, fl.hy1, 3, rng.pick([0xc8c8c0, 0x8a7a5a, 0x3a3a3a]));
      const bd = rng.range(0.85, 1.2);
      w.mat('concrete_old', { tint: 0xc8c0b0, ov: 'plaster_moldy', ovAmt: 0.6 });
      w.box(0.05, fl.y - 0.12, 0, W - 0.05, fl.y + 0.06, bd, PY | NY | PZ | PX | NX);
      const wallRail = rng.chance(0.4);
      if (wallRail) {
        w.mat('plaster_dirty', { tint: trim, ov: 'plaster_moldy', ovAmt: 0.8 });
        w.box(0.05, fl.y + 0.06, bd - 0.12, W - 0.05, fl.y + 1.0, bd, ALL & ~NY);
        w.box(0.05, fl.y + 0.06, 0, 0.17, fl.y + 1.0, bd - 0.12, ALL & ~NY);
        w.box(W - 0.17, fl.y + 0.06, 0, W - 0.05, fl.y + 1.0, bd - 0.12, ALL & ~NY);
      }
      if (!far) {
        w.setGroup('detail');
        w.mat('metal_paint', { tint: grilleCol, ov: 'steel_rust', ovAmt: 0.5, uv: 'local' });
        const top = fl.grille ? fl.y + hf - 0.15 : fl.y + 1.05;
        const yb0 = wallRail ? fl.y + 1.0 : fl.y + 0.06;
        // corner posts + rails
        w.box(0.08, yb0, bd - 0.06, 0.13, top, bd - 0.01, ALL);
        w.box(W - 0.13, yb0, bd - 0.06, W - 0.08, top, bd - 0.01, ALL);
        w.box(0.08, top - 0.04, bd - 0.06, W - 0.08, top, bd - 0.01, ALL);
        if (!wallRail) w.box(0.08, fl.y + 1.0, bd - 0.06, W - 0.08, fl.y + 1.04, bd - 0.01, ALL);
        for (let x = 0.25; x < W - 0.2; x += 0.13) w.box(x, yb0, bd - 0.045, x + 0.018, top, bd - 0.027, PZ | NZ | PX | NX);
        if (fl.grille) for (let z = 0.15; z < bd - 0.1; z += 0.15) { w.box(0.09, yb0, z, 0.11, top, z + 0.018, PX | NX | PZ | NZ); w.box(W - 0.11, yb0, z, W - 0.09, top, z + 0.018, PX | NX | PZ | NZ); }
        // laundry on a line
        if (rng.chance(0.55)) {
          w.mat('steel_rust', { uv: 'local' });
          const ly = fl.y + 2.05;
          w.box(0.15, ly, bd * 0.6, W - 0.15, ly + 0.015, bd * 0.6 + 0.015, ALL);
          let x = 0.3;
          while (x < W - 0.6) {
            const cw = rng.range(0.35, 0.7), ch = rng.range(0.45, 0.85);
            const den = rng.chance(0.25);
            w.mat(den ? 'denim' : 'fabric', { tint: den ? 0xffffff : rng.pick([0xffffff, 0xd03030, 0x3050c0, 0xe0c020, 0x30a050, 0xf080a0, 0x202020, 0xe08030, 0x80c0e0]), uv: 'local', ao: 0.95 });
            const zz = bd * 0.6 + 0.01;
            w.quad(x, ly - ch, zz, x + cw, ly - ch, zz, x + cw, ly, zz, x, ly, zz);
            w.quad(x + cw, ly - ch, zz - 0.002, x, ly - ch, zz - 0.002, x, ly, zz - 0.002, x + cw, ly, zz - 0.002);
            x += cw + rng.range(0.05, 0.25);
          }
        }
        // AC unit or junk on the balcony
        if (rng.chance(0.55)) w.put(P.acUnit(), rng.chance(0.5) ? 0.6 : W - 0.6, fl.y + 0.06, 0.05, 0);
        if (rng.chance(0.4)) w.put(P.bucket(rng.pick(PLASTIC_COLORS)), W * 0.5 + rng.range(-0.8, 0.8), fl.y + 0.06, bd * 0.5, rng.range(0, 6));
        w.setGroup('base');
      }
      return;
    }
    // windows
    const wins: number[][] = fl.style === 'twin' || fl.style === 'old'
      ? [[fl.hx0, fl.hx0 + (fl.hx1 - fl.hx0 - (fl.style === 'old' ? 0.55 : 0.4)) / 2], [fl.hx1 - (fl.hx1 - fl.hx0 - (fl.style === 'old' ? 0.55 : 0.4)) / 2, fl.hx1]]
      : [[fl.hx0, fl.hx1]];
    const fcol = rng.pick([0xc8c8c0, 0xb0a890, 0x6a6a68, 0x8a7a5a, 0xe8e8e0, 0x3a3a3a]);
    for (const [a, b] of wins) {
      if (fl.style === 'louver' || fl.style === 'old') louvers(a, fl.hy0, b, fl.hy1, rng.pick([0x5a7a5a, 0x4a6a8a, 0x8a5a3a, 0xa0a090, 0x2a5a4a]), rng.chance(0.25));
      else { glass(a, fl.hy0, b, fl.hy1); frame(a, fl.hy0, b, fl.hy1, Math.max(1, Math.round((b - a) / 0.9) - 1), fcol); }
      // sill
      w.mat('plaster_dirty', { tint: trim, ov: 'plaster_moldy', ovAmt: 0.7 });
      w.box(a - 0.06, fl.hy0 - 0.06, 0, b + 0.06, fl.hy0, 0.08, PZ | PY | NY | PX | NX);
    }
    // grille cage
    if (fl.grille && !far) {
      w.setGroup('detail');
      w.mat('metal_paint', { tint: grilleCol, ov: 'steel_rust', ovAmt: 0.55, uv: 'local' });
      const gz = rng.range(0.12, 0.26);
      const x0 = fl.hx0 - 0.05, x1 = fl.hx1 + 0.05, y0 = fl.hy0 - 0.05, y1 = fl.hy1 + 0.05;
      w.box(x0, y0, 0, x1, y0 + 0.03, gz, ALL);
      w.box(x0, y1 - 0.03, 0, x1, y1, gz, ALL);
      w.box(x0, y0, gz - 0.03, x0 + 0.03, y1, gz, ALL);
      w.box(x1 - 0.03, y0, gz - 0.03, x1, y1, gz, ALL);
      const pat = rng.int(0, 2);
      for (let x = x0 + 0.12; x < x1 - 0.08; x += 0.12) w.box(x, y0, gz - 0.022, x + 0.016, y1, gz - 0.006, PZ | NZ | PX | NX);
      w.box(x0, (y0 + y1) / 2, gz - 0.03, x1, (y0 + y1) / 2 + 0.025, gz, PZ | PY | NY);
      if (pat === 1) for (let x = x0 + 0.1; x < x1 - 0.3; x += 0.48) {
        w.pushTR(x + 0.24, y0 + 0.35, gz - 0.015, 0, 0, Math.PI / 4); w.box(-0.25, -0.01, -0.006, 0.25, 0.01, 0.006, PZ | NZ); w.pop();
        w.pushTR(x + 0.24, y0 + 0.35, gz - 0.015, 0, 0, -Math.PI / 4); w.box(-0.25, -0.01, -0.006, 0.25, 0.01, 0.006, PZ | NZ); w.pop();
      }
      // top hood
      w.mat('roof_galv', { uv: 'local' });
      w.quad(x0, y1 + 0.18, 0.02, x1, y1 + 0.18, 0.02, x1, y1, gz + 0.12, x0, y1, gz + 0.12);
      w.setGroup('base');
    }
    // AC condenser under the window (with drip stain)
    if (!far && rng.chance(0.42)) {
      w.setGroup('detail');
      const ax = rng.range(0.7, Math.max(0.75, W - 0.7));
      w.put(P.acUnit(), ax, fl.hy0 - 0.75, 0.02, 0);
      w.setGroup('base');
    }
  }

  private roofStuff(W: number, D: number, yR: number, rng: RNG) {
    const w = this.c.w, P = this.c.props;
    w.setGroup('detail');
    if (rng.chance(0.6)) w.put(rng.chance(0.55) ? P.waterTankSteel() : P.waterTankBlue(), rng.range(0.9, W - 0.9), yR, -rng.range(2.5, D - 2), rng.range(0, 6));
    if (rng.chance(0.45)) w.put(P.antenna(), rng.range(0.5, W - 0.5), yR, -rng.range(1, D - 1), rng.range(0, 3));
    if (rng.chance(0.18)) w.put(P.dish(), rng.range(0.6, W - 0.6), yR, -rng.range(0.8, 3), rng.range(-0.5, 0.5) + Math.PI);
    if (rng.chance(0.25)) {
      // rooftop shed: posts + corrugated roof
      const sx = rng.range(0.3, 1), sz = -rng.range(D * 0.45, D * 0.7);
      const sw = Math.min(W - 0.6, rng.range(2.2, 3.6)), sd = rng.range(2.4, 4);
      w.mat('steel_rust', { uv: 'local' });
      for (const [x, z] of [[sx, sz], [sx + sw, sz], [sx, sz - sd], [sx + sw, sz - sd]]) w.box(x - 0.04, yR, z - 0.04, x + 0.04, yR + 2.2, z + 0.04, SIDES);
      w.mat(rng.pick(['corr_rust', 'roof_galv', 'roof_fibre']), { uv: 'local' });
      w.quad(sx - 0.2, yR + 2.1, sz + 0.2, sx + sw + 0.2, yR + 2.1, sz + 0.2, sx + sw + 0.2, yR + 2.35, sz - sd - 0.2, sx - 0.2, yR + 2.35, sz - sd - 0.2);
      w.quad(sx + sw + 0.2, yR + 2.09, sz + 0.2, sx - 0.2, yR + 2.09, sz + 0.2, sx - 0.2, yR + 2.34, sz - sd - 0.2, sx + sw + 0.2, yR + 2.34, sz - sd - 0.2);
      if (rng.chance(0.5)) { w.mat('cement_block', { uv: 'local' }); w.box(sx, yR, sz - sd, sx + sw, yR + 1.1, sz - sd + 0.12, ALL); }
    }
    if (rng.chance(0.3)) w.put(P.junkPile(rng.int(0, 5)), rng.range(0.8, W - 0.8), yR, -rng.range(1, D - 1), rng.range(0, 6));
    w.setGroup('base');
  }

  private signs(u: UnitSpec, shop: string, W: number, yb: number, y1: number, cd: number, n: number, hf: number, rng: RNG, open: boolean) {
    const c = this.c, w = c.w, S = c.signs!;
    const cat = u.sign ?? (shop === 'residence' || shop === 'closed' ? (rng.chance(0.25) ? 'old' : '') : shop);
    if (!cat) return;
    // main fascia sign above the canopy
    const sh = rng.range(0.74, 0.92);
    const sw = W - 0.3;
    const pk = S.pick(cat, sw / sh, rng);
    if (pk) {
      const yS = yb + 0.36;
      const zS = 0.12;
      w.mat('metal_paint', { tint: 0x3a3a38, uv: 'local' });
      w.box(0.12, yS - 0.04, 0.02, W - 0.12, yS + sh + 0.04, zS, PZ | PY | NY | PX | NX);
      w.atlas('sign', { e0: pk.glow, e1: Math.random(), e2: rng.chance(0.15) ? 1 : 0, ao: 0.95 });
      const r = pk.r;
      w.quad(0.15, yS, zS + 0.005, W - 0.15, yS, zS + 0.005, W - 0.15, yS + sh, zS + 0.005, 0.15, yS + sh, zS + 0.005, [r.u0, r.v0, r.u1, r.v1]);
      if (pk.glow > 0) c.lights.add({ p: this.wp(W / 2, yS + sh / 2, 0.8), color: new THREE.Color(0xfff2e0), intensity: 0, range: 0, glow: sh * 1.2, kind: 'sign' });
    }
    // vertical blade sign on some units
    if (rng.chance(0.3) && n >= 3) {
      const vp = S.pick(cat === 'old' ? 'old' : 'vertical', 0.33, rng);
      if (vp) {
        const vh = rng.range(2.0, 3.2), vw = vh * Math.min(0.5, Math.max(0.22, vp.r.aspect));
        const vx = rng.chance(0.5) ? 0.2 : W - 0.2;
        const vy = y1 + 0.4;
        w.mat('steel_rust', { uv: 'local' });
        w.box(vx - 0.02, vy + vh - 0.05, 0, vx + 0.02, vy + vh, vw + 0.3, ALL);
        w.atlas('sign', { e0: vp.glow, e1: Math.random(), ao: 0.95 });
        const r = vp.r;
        // double-sided blade perpendicular to the facade
        w.quad(vx, vy, 0.25 + vw, vx, vy, 0.25, vx, vy + vh, 0.25, vx, vy + vh, 0.25 + vw, [r.u0, r.v0, r.u1, r.v1]);
        w.quad(vx + 0.01, vy, 0.25, vx + 0.01, vy, 0.25 + vw, vx + 0.01, vy + vh, 0.25 + vw, vx + 0.01, vy + vh, 0.25, [r.u0, r.v0, r.u1, r.v1]);
        if (vp.glow > 0) c.lights.add({ p: this.wp(vx, vy + vh / 2, 0.25 + vw / 2), color: new THREE.Color(0xfff0e0), intensity: 0, range: 0, glow: vh * 0.7, kind: 'sign' });
      }
    }
    // posters/stickers on the pilasters
    if (rng.chance(0.5)) {
      const ps = S.poster(rng);
      if (ps) this.decalOnFacade(ps, rng.chance(0.5) ? 0.0 : W - 0.16, SW_H + rng.range(1.0, 1.6), 0.16, 0.07, 0.95);
    }
    void open; void cd; void hf;
  }

  // ------------------------------------------------------------------ interiors
  private dressInterior(shop: string, ground: string, W: number, rd: number, x0: number, x1: number, y0: number, yb: number, rng: RNG, managed: boolean, u: UnitSpec, nb: { mergeL: boolean; mergeR: boolean }) {
    const c = this.c, w = c.w, P = c.props;
    w.setGroup('detail');
    const S = c.signs;
    // a real photo of a shop interior on the back wall gives instant believable clutter
    if (S && ground !== 'gate' && shop !== 'residence') {
      const r = S.interior(shop, rng);
      if (r) {
        const ww = x1 - x0 - 0.2, hh = Math.min(yb - y0 - 0.2, ww / Math.max(0.5, r.aspect));
        w.atlas('sign', { e0: 0.15, ao: 0.7 });
        w.quad(x0 + 0.1, y0 + 0.1, -rd + 0.05, x1 - 0.1, y0 + 0.1, -rd + 0.05, x1 - 0.1, y0 + 0.1 + hh, -rd + 0.05, x0 + 0.1, y0 + 0.1 + hh, -rd + 0.05, [r.u0, r.v0, r.u1, r.v1]);
      }
    }
    const shelfRow = (side: 'L' | 'R', za: number, zb: number, h = 2.2, layer = 'metal_paint', tint = 0xd8d4c8) => {
      const x = side === 'L' ? x0 + 0.02 : x1 - 0.47;
      w.mat(layer, { tint, uv: 'local', ao: 0.8 });
      for (const z of [za, zb]) w.box(x, y0, z - 0.03, x + 0.45, y0 + h, z, ALL & ~NY);
      for (let k = 0; k < 5; k++) { const y = y0 + 0.1 + k * (h - 0.15) / 4; w.box(x, y, zb, x + 0.45, y + 0.025, za, ALL); }
      // goods: boxes & bottles of random colours
      for (let k = 0; k < 4; k++) {
        const y = y0 + 0.125 + k * (h - 0.15) / 4;
        let z = zb + 0.05;
        while (z < za - 0.15) {
          const bw = rng.range(0.12, 0.35), bh = rng.range(0.15, (h - 0.15) / 4 - 0.08);
          const kind = rng.int(0, 2);
          if (kind === 0) { w.mat('cardboard', { uv: 'local', ao: 0.8, tint: rng.pick([0xffffff, 0xe8d0b0, 0xd0e0f0, 0xf0d0d0]) }); w.box(x + 0.05, y, z, x + 0.4, y + bh, z + bw, ALL & ~NY); }
          else if (kind === 1) { w.mat('plastic_gloss', { uv: 'local', ao: 0.85, tint: rng.pick(PLASTIC_COLORS) }); for (let q = 0; q < 3; q++) w.cyl(x + 0.12 + q * 0.11, y, z + bw / 2, 0.045, 0.04, bh, 6, 1); }
          else { w.mat('paper', { uv: 'local', ao: 0.85, tint: rng.pick([0xffffff, 0xfff0c0, 0xd0f0d0, 0xf0c0c0]) }); w.box(x + 0.05, y, z, x + 0.42, y + bh * 0.6, z + bw, ALL & ~NY); }
          z += bw + 0.03;
        }
      }
      this.col(side === 'L' ? x0 : x1 - 0.47, 0, zb, side === 'L' ? x0 + 0.47 : x1, y0 + h, za);
    };
    const anchorKey = u.name ?? '';
    if (managed) {
      // the shops module owns the front 3.5 m: dress only the back part + side walls deep inside
      const zDeep = -Math.min(rd - 0.6, 4.2);
      if (shop === 'kitchen') {
        w.mat('steel_rust', { uv: 'local' });
        w.box(x0 + 0.05, yb - 0.6, -rd + 0.15, x1 - 0.05, yb - 0.57, -rd + 0.2, ALL);
        for (let x = x0 + 0.4; x < x1 - 0.3; x += 0.55) w.put(P.wok(), x, yb - 1.05, -rd + 0.25, 0, 1, { rx: -1.35 });
        for (let x = x0 + 0.4; x < x1 - 0.4; x += 0.6) { w.put(P.pot(0.18), x, y0, -rd + 0.4, 0); w.put(P.pot(0.14), x + 0.05, y0 + 0.29, -rd + 0.4, 0); }
      } else if (shop === 'plastic') {
        for (let x = x0 + 0.4; x < x1 - 0.3; x += 0.55) w.put(P.stoolStack(rng.pick(PLASTIC_COLORS), rng.int(6, 12)), x, y0, -rd + 0.35, rng.range(0, 6));
        for (let x = x0 + 0.5; x < x1 - 0.4; x += 0.7) w.put(P.chairStack(rng.pick(PLASTIC_COLORS), rng.int(5, 9)), x, y0, zDeep + 0.4, 0);
        for (let x = x0 + 0.3; x < x1 - 0.3; x += 0.6) w.put(P.basket(rng.pick(PLASTIC_COLORS)), x, yb - 0.6, -rd + 0.3, 0);
      } else if (shop === 'gas') {
        for (let x = x0 + 0.3; x < x1 - 0.25; x += 0.36) w.put(P.lpgTank(rng.pick([0xc03020, 0x2a6a3a, 0x2a4a9a, 0x9a9a9a, 0xd8b020])), x, y0, -rd + 0.3, rng.range(0, 6));
        for (let x = x0 + 0.4; x < x1 - 0.3; x += 0.4) w.put(P.lpgTank(rng.pick([0xc03020, 0x2a6a3a, 0x2a4a9a])), x, y0, -rd + 0.7, rng.range(0, 6));
      }
      // shelf anchors for the shops module (side walls inside the 3.5 m zone)
      if (anchorKey) {
        let i = 0;
        for (const side of ['L', 'R'] as const) {
          if ((side === 'L' && nb.mergeL) || (side === 'R' && nb.mergeR)) continue;
          const lx = side === 'L' ? x0 + 0.35 : x1 - 0.35;
          const p = this.wp(lx, y0, -2.2);
          const yaw = this.yaw + (side === 'L' ? -Math.PI / 2 : Math.PI / 2);
          c.anchors[`shelf:${anchorKey}:${i++}`] = { p: [round2(p.x), y0, round2(p.z)], yaw: round2(yaw), r: 2.6 };
        }
        const pb = this.wp((x0 + x1) / 2, y0, -rd + 0.5);
        c.anchors[`shelf:${anchorKey}:back`] = { p: [round2(pb.x), y0, round2(pb.z)], yaw: round2(this.yaw + Math.PI), r: (x1 - x0) / 2 };
      }
      w.setGroup('base');
      return;
    }
    switch (shop) {
      case 'grocery': case 'pharmacy': case 'phone': case 'hardware': case 'print': case 'open': {
        const tint = shop === 'pharmacy' ? 0xf4f4f0 : shop === 'hardware' ? 0x5a6a7a : 0xd8d4c8;
        shelfRow('L', -0.8, -rd + 0.4, 2.2, 'metal_paint', tint);
        shelfRow('R', -1.4, -rd + 0.4, 2.2, 'metal_paint', tint);
        // counter
        w.mat(shop === 'pharmacy' || shop === 'phone' ? 'glass' : 'wood_paint', { tint: shop === 'pharmacy' || shop === 'phone' ? 0x9ab0b0 : 0x8a6a4a, uv: 'local', ao: 0.8 });
        const cx = rng.chance(0.5) ? x0 + 0.5 : x1 - 1.6;
        w.box(cx, y0, -1.6, cx + 1.1, y0 + 0.95, -1.0, ALL & ~NY);
        this.col(cx, 0, -1.6, cx + 1.1, y0 + 0.95, -1.0);
        if (shop === 'hardware') for (let x = x0 + 0.4; x < x1 - 0.3; x += 0.5) w.put(P.bucket(rng.pick(PLASTIC_COLORS)), x, yb - 0.5, -0.4, 0);
        break;
      }
      case 'gold': {
        w.mat('glass', { tint: 0x7a6a50, uv: 'local', emis: EMIS.shopwarm.i, emisK: 0.25 });
        w.box(x0 + 0.3, y0, -2.2, x1 - 0.3, y0 + 1.0, -1.6, ALL & ~NY);
        this.col(x0 + 0.3, 0, -2.2, x1 - 0.3, y0 + 1.0, -1.6);
        w.mat('brass', { uv: 'local' });
        for (let x = x0 + 0.5; x < x1 - 0.5; x += 0.25) w.box(x, y0 + 1.0, -2.0, x + 0.12, y0 + 1.03, -1.8, ALL);
        w.mat('plaster', { tint: 0xa01010, uv: 'local', ao: 0.8 });
        w.box(x0 + 0.1, y0 + 1.6, -rd + 0.05, x1 - 0.1, y0 + 2.8, -rd + 0.12, PZ);
        break;
      }
      case 'eatery': case 'noodle': case 'coffee': {
        // steel tables + plastic stools inside, a noodle cart at the front
        const sc = rng.pick(PLASTIC_COLORS);
        for (let z = -1.8; z > -rd + 1; z -= 1.6) {
          const tx = (x0 + x1) / 2 + rng.range(-0.3, 0.3);
          w.mat('stainless', { uv: 'local', ao: 0.85 });
          w.box(tx - 0.5, y0 + 0.72, z - 0.35, tx + 0.5, y0 + 0.75, z + 0.35, ALL);
          for (const [dx, dz] of [[-0.45, -0.3], [0.45, -0.3], [-0.45, 0.3], [0.45, 0.3]]) w.box(tx + dx - 0.02, y0, z + dz - 0.02, tx + dx + 0.02, y0 + 0.72, z + dz + 0.02, SIDES);
          for (const [dx, dz] of [[-0.75, 0], [0.75, 0], [0, 0.6]]) w.put(P.stool(sc), tx + dx, y0, z + dz, rng.range(0, 6));
          this.col(tx - 0.5, 0, z - 0.35, tx + 0.5, y0 + 0.75, z + 0.35);
        }
        w.put(P.cart(rng.pick([0x2a5a9a, 0xc03020, 0x2a7a3a])), x0 + 1.0, y0, -0.7, 0);
        this.col(x0 + 0.2, 0, -1.2, x0 + 1.8, y0 + 1.5, -0.2);
        // tables spill onto the sidewalk
        if (rng.chance(0.6)) {
          w.put(P.plasticTable(rng.pick([0xe8e4dc, 0x2a62b8, 0xc0302a])), (x0 + x1) / 2, y0, 1.2, 0);
          w.put(P.stool(sc), (x0 + x1) / 2 - 0.7, y0, 1.2, 1); w.put(P.stool(sc), (x0 + x1) / 2 + 0.7, y0, 1.2, 2);
        }
        break;
      }
      case 'barber': case 'salon': {
        w.mat('glass', { tint: 0x8aa0a8, uv: 'local' });
        w.box(x0 + 0.05, y0 + 1.0, -rd + 0.5, x0 + 0.08, y0 + 2.1, -0.8, PX);
        w.mat('leather', { uv: 'local' });
        for (let z = -1.5; z > -rd + 0.8; z -= 1.3) { w.box(x0 + 0.5, y0 + 0.4, z - 0.3, x0 + 1.1, y0 + 0.9, z + 0.3, ALL & ~NY); w.box(x0 + 1.0, y0 + 0.9, z - 0.3, x0 + 1.1, y0 + 1.5, z + 0.3, ALL); }
        if (shop === 'barber') { w.mat('plastic_gloss', { tint: 0xf0f0f0, uv: 'local', emis: EMIS.red.i, emisK: 0.2 }); w.cyl(x1 - 0.1, y0 + 1.4, 0.15, 0.08, 0.08, 0.7, 8, 3); }
        break;
      }
      case 'massage': {
        w.mat('fabric', { tint: 0x8a2a4a, uv: 'local', ao: 0.8 });
        w.box(x0 + 0.05, y0, -1.5, x1 - 0.05, yb - 0.1, -1.45, PZ);
        w.mat('leather', { uv: 'local' });
        w.box(x0 + 0.3, y0, -0.9, x0 + 1.0, y0 + 0.5, -0.2, ALL & ~NY);
        w.box(x1 - 1.0, y0, -0.9, x1 - 0.3, y0 + 0.5, -0.2, ALL & ~NY);
        break;
      }
      case 'repair': {
        for (let i = 0; i < 2; i++) w.put(P.motorbike(rng.pick([0xc0302a, 0x1c1c1e, 0x2a62b8, 0xe8e4dc])), x0 + 0.9 + i * 1.3, y0, -2.5, rng.range(-0.3, 0.3), 1, { rz: 0.08 });
        w.mat('rubber', { uv: 'local' });
        for (let k = 0; k < 5; k++) { w.pushTR(x1 - 0.5, y0 + 0.06 + k * 0.12, -0.8, Math.PI / 2, 0, 0); w.cyl(0, -0.06, 0, 0.32, 0.32, 0.11, 10, 3); w.pop(); }
        w.put(P.junkPile(rng.int(0, 4)), x1 - 1.0, y0, -rd + 1, rng.range(0, 6));
        break;
      }
      case 'laundry': {
        w.mat('plastic_gloss', { tint: 0xf0f0ec, uv: 'local' });
        for (let z = -1.2; z > -rd + 0.6; z -= 0.75) { w.box(x0 + 0.1, y0, z - 0.33, x0 + 0.75, y0 + 0.9, z + 0.33, ALL & ~NY); }
        this.col(x0, 0, -rd + 0.3, x0 + 0.8, y0 + 0.9, -0.8);
        break;
      }
      case 'residence': default: {
        if (rng.chance(0.8)) w.put(P.motorbike(rng.pick([0xc0302a, 0x1c1c1e, 0x2a62b8, 0xe8e4dc, 0x3a3a3a])), (x0 + x1) / 2 + rng.range(-0.6, 0.6), y0, -1.6, rng.range(-0.4, 0.4) + Math.PI / 2, 1, { rz: 0.09 });
        if (rng.chance(0.6)) { w.mat('teak', { uv: 'local', ao: 0.8 }); w.box(x0 + 0.1, y0, -rd + 0.3, x0 + 1.8, y0 + 0.45, -rd + 1.0, ALL & ~NY); }
        // household shrine shelf (red glow)
        w.mat('plastic_gloss', { tint: 0xa01818, uv: 'local', emis: EMIS.candle.i, emisK: 0.35 });
        w.box(x1 - 1.0, y0 + 1.9, -rd + 0.05, x1 - 0.2, y0 + 2.0, -rd + 0.35, ALL);
        w.put(P.bucket(rng.pick(PLASTIC_COLORS)), x0 + 0.3, y0, -0.5, 0);
        break;
      }
    }
    w.setGroup('base');
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** deterministic unit dimensions (storeys, floor heights, parapet) — shared by neighbours */
export function unitDims(u: UnitSpec) {
  const r = new RNG(Math.floor(hash2(u.a0 * 3.3 + u.line, u.a1 * 1.7) * 1e9) + 7);
  const nn = r.weighted([2, 3, 4, 5], [1, 6, 4, 1]);
  const n = u.storeys ?? nn;
  const h0 = r.range(3.75, 4.2), hf = r.range(3.05, 3.3), par = r.range(0.85, 1.25);
  return { n, h0, hf, par, top: SW_H + h0 + (n - 1) * hf + par };
}

/** Build all rows: computes neighbour heights & shop merges. Returns per-unit heights. */
export function buildRows(c: ShopCtx, rows: UnitSpec[][]) {
  const sh = new Shophouse(c);
  let ord = 0;
  for (const row of rows) {
    // exact neighbour heights (dimensions are deterministic per unit)
    for (const u of row) if (u.storeys === undefined) u.storeys = unitDims(u).n;
    const approxH = (u: UnitSpec) => unitDims(u).top;
    // order units along the facade direction (left → right seen from the street)
    const sorted = [...row].sort((a, b) => (a.face === 'W' || a.face === 'S' ? a.a0 - b.a0 : b.a0 - a.a0));
    for (let i = 0; i < sorted.length; i++) {
      const u = sorted[i];
      const L = sorted[i - 1], R = sorted[i + 1];
      const adj = (o?: UnitSpec) => !!o && Math.abs((u.face === 'W' || u.face === 'S' ? o.a1 : o.a0) - (u.face === 'W' || u.face === 'S' ? u.a0 : u.a1)) < 0.05;
      const adjR = (o?: UnitSpec) => !!o && Math.abs((u.face === 'W' || u.face === 'S' ? o.a0 : o.a1) - (u.face === 'W' || u.face === 'S' ? u.a1 : u.a0)) < 0.05;
      const left = adj(L) ? approxH(L!) - 0.1 : 0;
      const right = adjR(R) ? approxH(R!) - 0.1 : 0;
      const same = (o?: UnitSpec) => !!o && !!u.shop && o.shop === u.shop && !['residence', 'closed', undefined].includes(u.shop) && (o.storeys === u.storeys);
      sh.build(u, { left: u.corner === 'left' ? 0 : left, right: u.corner === 'right' ? 0 : right, mergeL: adj(L) && same(L), mergeR: adjR(R) && same(R) }, ord++);
    }
  }
}

void PY; void NY; void NZ; void PX; void NX; void PZ;
