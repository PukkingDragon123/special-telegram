import { RNG } from '../../core/rng';
import { WB, Template, ALL, SIDES, PX, NX, PY, NY, PZ, NZ } from './geo';
import { EMIS } from './mats';

/**
 * ARCHITECTURE KIT — small lived-in facade pieces as merged templates (zero extra draw calls):
 * birdcages, ตี่จู้เอี๊ยะ floor shrines and wall shrine shelves (หิ้ง), CCTV cameras, PVC drainpipes,
 * rebar stubs on unfinished roofs, breeze-block (ช่องลม) bands, decorative Thai window grilles.
 * Everything uses real-photo texture-array layers.
 */

const memo = new WeakMap<WB, Map<string, Template>>();
function M(w: WB, key: string, fn: (w: WB) => void): Template {
  let m = memo.get(w);
  if (!m) { m = new Map(); memo.set(w, m); }
  let t = m.get(key);
  if (!t) { t = w.template(fn); m.set(key, t); }
  return t;
}

/** hanging bamboo / wire birdcage (origin = hook point, hangs down ~0.55 m) */
export function birdcage(w: WB, v = 0): Template {
  return M(w, 'birdcage' + v, (w) => {
    const r = v === 0 ? 0.16 : 0.13, h = v === 0 ? 0.32 : 0.4, y0 = -0.55, y1 = y0 + h;
    w.mat(v === 0 ? 'bamboo' : 'brass', { uv: 'local', tint: v === 0 ? 0xc8a878 : 0xd0b070, ao: 0.95 });
    // base tray + rings
    w.cyl(0, y0, 0, r + 0.015, r + 0.015, 0.04, 10, 3);
    for (const yy of [y0 + 0.12, y1]) { const pts: number[] = []; for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI * 2; pts.push(Math.cos(a) * r, yy, Math.sin(a) * r); } w.tube(pts, 0.005, 3); }
    // vertical wires + dome
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      w.tube([Math.cos(a) * r, y0 + 0.03, Math.sin(a) * r, Math.cos(a) * r, y1, Math.sin(a) * r, Math.cos(a) * r * 0.35, y1 + 0.1, Math.sin(a) * r * 0.35, 0, y1 + 0.13, 0], 0.003, 3);
    }
    // hook + cloth cover half drawn over the top (the bird sleeps)
    w.tube([0, y1 + 0.13, 0, 0, -0.02, 0, 0.02, 0, 0], 0.004, 3);
    if (v === 1) { w.mat('fabric', { uv: 'local', tint: 0x2a4a8a }); w.cyl(0, y1 - 0.06, 0, r * 1.05, r * 0.5, 0.18, 10, 1); }
    // the bird
    w.mat('plastic', { uv: 'local', tint: v === 0 ? 0x5a4a3a : 0xd8c040 });
    w.cyl(0.02, y0 + 0.13, 0, 0.025, 0.018, 0.06, 6, 1, 0, 0.2);
  });
}

/** red floor shrine (ตี่จู้เอี๊ยะ) at a shop entrance, with incense and a candle glow */
export function floorShrine(w: WB): Template {
  return M(w, 'floorShrine', (w) => {
    w.mat('plastic_gloss', { uv: 'local', tint: 0xa01410, ao: 0.9 });
    w.box(-0.22, 0, -0.16, 0.22, 0.36, 0.16, ALL & ~NY & ~PZ);
    w.box(-0.24, 0.36, -0.17, 0.24, 0.4, 0.2, ALL);
    w.mat('brass', { uv: 'local' });
    w.box(-0.24, 0.0, 0.16, 0.24, 0.03, 0.17, PZ | PY);
    w.mat('plastic', { uv: 'local', tint: 0x3a1a0a, ao: 0.5 });
    w.quad(-0.2, 0.02, -0.15, 0.2, 0.02, -0.15, 0.2, 0.34, -0.15, -0.2, 0.34, -0.15);
    // incense pot + sticks, oranges, a red Fanta bottle
    w.mat('brass', { uv: 'local' });
    w.cyl(0, 0.02, 0.06, 0.06, 0.05, 0.08, 8, 1);
    w.mat('wood_old', { uv: 'local', tint: 0x8a2a1a });
    for (let i = 0; i < 5; i++) w.tube([-0.02 + i * 0.01, 0.1, 0.06, -0.03 + i * 0.015, 0.28, 0.06 + (i - 2) * 0.01], 0.003, 3);
    w.mat('plastic_gloss', { uv: 'local', tint: 0xe86010 });
    for (const x of [-0.13, 0.13]) w.cyl(x, 0.02, 0.07, 0.035, 0.035, 0.06, 6, 1, 0, 0.15);
    w.mat('plastic_gloss', { uv: 'local', tint: 0xc81830 });
    w.cyl(0.17, 0.02, -0.05, 0.025, 0.02, 0.16, 6, 1);
    w.mat('plastic_gloss', { uv: 'local', tint: 0xff4020, emis: EMIS.candle.i, emisK: 0.8 });
    w.cyl(-0.13, 0.02, -0.06, 0.018, 0.018, 0.07, 6, 1);
  });
}

/** wall shrine shelf (หิ้ง): red bracket shelf with a little gilded shrine, garlands and a candle */
export function wallShrine(w: WB): Template {
  return M(w, 'wallShrine', (w) => {
    w.mat('wood_paint', { uv: 'local', tint: 0x9a1810, ao: 0.9 });
    w.box(-0.3, 0, 0, 0.3, 0.04, 0.32, ALL);
    w.box(-0.28, -0.18, 0, -0.25, 0, 0.26, ALL); w.box(0.25, -0.18, 0, 0.28, 0, 0.26, ALL);
    w.mat('brass', { uv: 'local', tint: 0xe0b050 });
    w.box(-0.12, 0.04, 0.06, 0.12, 0.2, 0.22, ALL & ~NY);
    w.cyl(0, 0.2, 0.14, 0.15, 0.0, 0.16, 4, 0, Math.PI / 4);
    w.mat('fabric', { uv: 'local', tint: 0xf0d040 });
    w.tube([-0.25, 0.03, 0.31, -0.1, -0.08, 0.32, 0.1, -0.08, 0.32, 0.25, 0.03, 0.31], 0.018, 4);
    w.mat('plastic_gloss', { uv: 'local', tint: 0xff3010, emis: EMIS.candle.i, emisK: 0.9 });
    w.cyl(0.2, 0.04, 0.2, 0.02, 0.02, 0.07, 6, 1);
    w.cyl(-0.2, 0.04, 0.2, 0.02, 0.02, 0.07, 6, 1);
  });
}

/** bullet CCTV camera on a wall bracket (origin on the wall, looks out along +z, slightly down) */
export function cctv(w: WB): Template {
  return M(w, 'cctv', (w) => {
    w.mat('plastic', { uv: 'local', tint: 0xe8e8e4 });
    w.box(-0.05, -0.06, 0, 0.05, 0.06, 0.02, ALL);
    w.tube([0, 0, 0.02, 0, -0.02, 0.14], 0.012, 4);
    w.pushTR(0, -0.05, 0.2, 0.35, 0, 0);
    w.bevelBox(-0.045, -0.045, -0.13, 0.045, 0.045, 0.1, 0.012, true, true);
    w.mat('glass', { tint: 0x101418 });
    w.box(-0.03, -0.03, 0.1, 0.03, 0.03, 0.11, PZ);
    w.mat('plastic', { uv: 'local', tint: 0xff2020, emis: EMIS.red.i, emisK: 0.6 });
    w.box(0.032, 0.02, 0.1, 0.04, 0.028, 0.105, PZ);
    w.pop();
  });
}

/** PVC / galvanised downpipe from the roof scupper to the footpath, with brackets and a shoe */
export function drainpipe(w: WB, x: number, yTop: number, yBot: number, z: number, rng: RNG) {
  const kind = rng.weighted(['pvc', 'pvcblue', 'galv'], [5, 2, 2]);
  const r = kind === 'galv' ? 0.05 : 0.045;
  w.mat(kind === 'galv' ? 'galv' : 'plastic', { uv: 'local', tint: kind === 'pvc' ? 0x8c9094 : kind === 'pvcblue' ? 0x3f6aa6 : 0xb0b0a8, ov: kind === 'galv' ? 'steel_rust' : 'plaster_moldy', ovAmt: 0.55 });
  // scupper elbow out of the parapet
  w.tube([x, yTop, -0.05, x, yTop - 0.05, z * 0.6, x, yTop - 0.25, z], r, 6);
  w.cyl(x, yBot + 0.18, z, r, r, yTop - 0.25 - (yBot + 0.18), 8, 0);
  // shoe at the bottom (spills onto the footpath)
  w.tube([x, yBot + 0.2, z, x, yBot + 0.08, z + 0.04, x, yBot + 0.04, z + 0.18], r, 6);
  w.mat('steel_rust', { uv: 'local' });
  for (let y = yBot + 1.2; y < yTop - 0.4; y += 1.7) w.box(x - r - 0.012, y, -0.01, x + r + 0.012, y + 0.035, z + r + 0.008, ALL & ~NY);
}

/** rusty rebar sticking out of an unfinished column stub (future floors that never came) */
export function rebar(w: WB, x: number, y: number, z: number, rng: RNG) {
  w.mat('concrete_old', { uv: 'local', tint: 0xa8a49c, ov: 'plaster_moldy', ovAmt: 0.7 });
  const h = rng.range(0.12, 0.45);
  w.box(x - 0.13, y, z - 0.13, x + 0.13, y + h, z + 0.13, ALL & ~NY);
  w.mat('steel_rust', { uv: 'local', tint: 0x8a5a3a });
  for (const [dx, dz] of [[-0.08, -0.08], [0.08, -0.08], [-0.08, 0.08], [0.08, 0.08]]) {
    const L = rng.range(0.5, 1.4), bx = rng.range(-0.12, 0.12), bz = rng.range(-0.12, 0.12);
    w.tube([x + dx, y + h - 0.02, z + dz, x + dx + bx * 0.2, y + h + L * 0.7, z + dz + bz * 0.2, x + dx + bx, y + h + L, z + dz + bz], 0.008, 3);
  }
}

/**
 * breeze-block (ช่องลม) lattice filling the hole x0..x1 × y0..y1 at facade depth z (concrete webs on a 0.2 m grid,
 * open behind → you see the sky / roof through it)
 */
export function breezeBlocks(w: WB, x0: number, x1: number, y0: number, y1: number, z: number, tint: number) {
  w.mat('cement_block', { uv: 'local', tint, ov: 'plaster_moldy', ovAmt: 0.7 });
  const nx = Math.max(2, Math.round((x1 - x0) / 0.2)), ny = Math.max(2, Math.round((y1 - y0) / 0.2));
  const cx = (x1 - x0) / nx, cy = (y1 - y0) / ny, t = 0.035, d0 = z - 0.14, d1 = z;
  for (let i = 0; i <= nx; i++) { const x = x0 + i * cx; w.box(x - t / 2, y0, d0, x + t / 2, y1, d1, PZ | PX | NX); }
  for (let j = 0; j <= ny; j++) { const y = y0 + j * cy; w.box(x0, y - t / 2, d0, x1, y + t / 2, d1, PZ | PY | NY); }
  // diagonal flower pattern in each cell (thin rotated webs)
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const mx = x0 + (i + 0.5) * cx, my = y0 + (j + 0.5) * cy;
    w.pushTR(mx, my, d1 - 0.02, 0, 0, Math.PI / 4);
    w.box(-cx * 0.36, -0.01, -0.06, cx * 0.36, 0.01, 0, PZ | PY | NY);
    w.box(-0.01, -cy * 0.36, -0.06, 0.01, cy * 0.36, 0, PZ | PX | NX);
    w.pop();
  }
}

/**
 * decorative Thai window grille motif inside the rect (x0..x1, y0..y1) at depth z: 'sun' (sunrise fan in the
 * top part), 'diamond' (lattice), 'scroll' (S-curves between bars). Bars are 16 mm square steel.
 */
export function grilleMotif(w: WB, motif: string, x0: number, x1: number, y0: number, y1: number, z: number) {
  const t = 0.008;
  if (motif === 'sun') {
    // fans from bottom-centre of each 0.9 m bay, in the upper half
    const bays = Math.max(1, Math.round((x1 - x0) / 0.9));
    const bw = (x1 - x0) / bays;
    for (let b = 0; b < bays; b++) {
      const cx = x0 + bw * (b + 0.5), cy = y0 + (y1 - y0) * 0.55, R = Math.min(bw * 0.48, (y1 - cy) * 0.95);
      const arc: number[] = [];
      for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI; arc.push(cx + Math.cos(a) * R, cy + Math.sin(a) * R, z); }
      w.tube(arc, t, 4);
      const arc2: number[] = [];
      for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI; arc2.push(cx + Math.cos(a) * R * 0.45, cy + Math.sin(a) * R * 0.45, z); }
      w.tube(arc2, t, 4);
      for (let i = 1; i < 6; i++) { const a = (i / 6) * Math.PI; w.tube([cx + Math.cos(a) * R * 0.45, cy + Math.sin(a) * R * 0.45, z, cx + Math.cos(a) * R, cy + Math.sin(a) * R, z], t, 4); }
      w.tube([cx - R, cy, z, cx + R, cy, z], t, 4);
    }
  } else if (motif === 'diamond') {
    const s = 0.22;
    for (let x = x0 - (y1 - y0); x < x1; x += s) {
      const a = [Math.max(x0, x), 0], b = [Math.min(x1, x + (y1 - y0)), 0];
      const ya = y0 + (a[0] - x), yb = y0 + (b[0] - x);
      if (b[0] > a[0]) w.tube([a[0], ya, z, b[0], yb, z], t, 4);
      const xa = Math.max(x0, x), xb = Math.min(x1, x + (y1 - y0));
      if (xb > xa) w.tube([xa, y1 - (xa - x), z, xb, y1 - (xb - x), z], t, 4);
    }
  } else {
    // scrolls: S curves between 0.24 m spaced posts
    for (let x = x0 + 0.12; x < x1 - 0.12; x += 0.24) {
      for (const yy of [y0 + (y1 - y0) * 0.25, y0 + (y1 - y0) * 0.72]) {
        const pts: number[] = [];
        for (let i = 0; i <= 8; i++) { const k = i / 8; pts.push(x - 0.1 + k * 0.2, yy + Math.sin(k * Math.PI * 2) * 0.07, z); }
        w.tube(pts, t, 4);
      }
    }
  }
}

void SIDES; void PX; void NX; void PY; void NY; void PZ; void NZ;
