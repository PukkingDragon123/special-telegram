import { WB, Template, ALL, SIDES, PY, NY, PX, NX, PZ, NZ } from './geo';

/**
 * PROP TEMPLATES — low-poly, PBR/photo textured street furniture, built once and stamped
 * (merged) into the chunk meshes. Origin = bottom centre, facing +Z unless noted.
 */

export type Props = ReturnType<typeof makeProps>;

const C = {
  red: 0xc0302a, blue: 0x2a62b8, green: 0x2f8a3e, yellow: 0xe0b020, orange: 0xe06a20, pink: 0xe07aa0, white: 0xe8e4dc,
  black: 0x1c1c1e, grey: 0x8a8a88, cream: 0xd8ccb0, brown: 0x7a5232, teal: 0x2a8a8a, purple: 0x6a3a8a,
};
export const PLASTIC_COLORS = [C.red, C.blue, C.green, C.yellow, C.orange, C.pink, C.white, C.teal];

export function makeProps(w: WB) {
  const T = (fn: (w: WB) => void) => w.template(fn);
  const cache = new Map<string, Template>();
  const memo = (key: string, fn: () => Template) => { let t = cache.get(key); if (!t) { t = fn(); cache.set(key, t); } return t; };

  // ------------------------------------------------------------------ building services
  const acUnit = () => memo('ac', () => T((w) => {
    // condenser body (dirty off-white sheet metal) — origin bottom centre, back against the wall at z=0, front +Z
    w.mat('metal_paint', { tint: 0xd6d2c4, ov: 'steel_rust', ovAmt: 0.35, uv: 'local' });
    w.bevelBox(-0.41, 0, 0.02, 0.41, 0.56, 0.31, 0.025);
    // front: dark fan recess + spokes + side grille
    w.mat('galv', { tint: 0x3a3a3a, uv: 'local' });
    w.cyl(-0.1, 0.28, 0.315, 0.2, 0.2, 0.005, 12, 1);
    w.pushTR(-0.1, 0.28, 0.315, Math.PI / 2, 0, 0);
    w.cyl(0, 0, 0, 0.21, 0.21, 0.012, 12, 0);
    w.pop();
    w.mat('metal_paint', { tint: 0x1a1a1a, uv: 'local' });
    for (let i = 0; i < 4; i++) {
      w.pushTR(-0.1, 0.28, 0.322, 0, 0, (i / 4) * Math.PI);
      w.box(-0.19, -0.008, 0, 0.19, 0.008, 0.006, PZ);
      w.pop();
    }
    w.mat('galv', { tint: 0x9a9890, uv: 'local' });
    w.box(0.16, 0.06, 0.312, 0.37, 0.5, 0.318, PZ);
    // brackets (rusty angle iron) + pipes to the wall
    w.mat('steel_rust', { uv: 'local' });
    w.box(-0.38, -0.05, -0.02, -0.33, 0.0, 0.42, ALL);
    w.box(0.33, -0.05, -0.02, 0.38, 0.0, 0.42, ALL);
    w.box(-0.38, -0.45, -0.02, -0.34, 0.0, 0.03, SIDES);
    w.box(0.34, -0.45, -0.02, 0.38, 0.0, 0.03, SIDES);
    w.mat('plastic', { tint: 0xe8e4d8, uv: 'local' });
    w.tube([0.36, 0.2, 0.18, 0.5, 0.25, 0.1, 0.55, 0.9, 0.04], 0.025, 5);
  }));

  const waterTankSteel = () => memo('tankS', () => T((w) => {
    w.mat('steel_rust', { uv: 'local' });
    for (const [x, z] of [[-0.45, -0.45], [0.45, -0.45], [0.45, 0.45], [-0.45, 0.45]]) w.box(x - 0.03, 0, z - 0.03, x + 0.03, 0.7, z + 0.03, SIDES);
    w.box(-0.55, 0.65, -0.55, 0.55, 0.72, 0.55, ALL);
    w.mat('stainless', { ov: 'steel_rust', ovAmt: 0.2, uv: 'local' });
    w.cyl(0, 0.72, 0, 0.6, 0.6, 1.25, 12, 1, 0, 0.02);
    w.cyl(0, 1.97, 0, 0.6, 0.15, 0.12, 12, 1);
    w.mat('plastic', { tint: 0x2a5aa0, uv: 'local' });
    w.tube([0.55, 0.9, 0, 0.75, 0.9, 0, 0.75, -0.4, 0], 0.025, 4);
  }));
  const waterTankBlue = () => memo('tankB', () => T((w) => {
    w.mat('concrete_old', { uv: 'local' });
    w.box(-0.6, 0, -0.6, 0.6, 0.25, 0.6, ALL & ~NY);
    w.mat('plastic_gloss', { tint: 0x1f4f9a, uv: 'local' });
    w.cyl(0, 0.25, 0, 0.58, 0.62, 1.15, 14, 1, 0, 0.015);
    w.cyl(0, 1.4, 0, 0.62, 0.22, 0.22, 14, 1);
  }));
  const antenna = () => memo('ant', () => T((w) => {
    w.mat('galv', { uv: 'local' });
    w.cyl(0, 0, 0, 0.025, 0.02, 3.2, 5, 1);
    for (let k = 0; k < 2; k++) {
      const y = 2.3 + k * 0.7;
      w.box(-0.02, y - 0.015, -0.9, 0.02, y + 0.015, 0.9, ALL);
      for (let i = 0; i < 9; i++) { const z = -0.85 + i * 0.21; const l = 0.55 - i * 0.03; w.box(-l, y - 0.008, z - 0.008, l, y + 0.008, z + 0.008, ALL); }
    }
    w.mat('steel_rust', { uv: 'local' });
    w.tube([0, 2.0, 0, 1.2, 0, 0.6], 0.006, 3);
    w.tube([0, 2.0, 0, -1.1, 0, -0.5], 0.006, 3);
  }));
  const dish = () => memo('dish', () => T((w) => {
    w.mat('galv', { tint: 0xd8d8d4, uv: 'local' });
    w.cyl(0, 0, 0, 0.03, 0.03, 0.9, 5, 1);
    w.pushTR(0, 0.95, 0, -0.9, 0, 0);
    w.cyl(0, -0.05, 0, 0.05, 0.38, 0.14, 12, 0);
    w.cyl(0, 0.09, 0, 0.38, 0.36, 0.01, 12, 1);
    w.pop();
    w.mat('metal_paint', { tint: 0x333333, uv: 'local' });
    w.box(-0.02, 0.9, 0.2, 0.02, 0.95, 0.55, ALL);
  }));

  // ------------------------------------------------------------------ plastic furniture
  const stool = (col: number) => memo('stool' + col, () => T((w) => {
    w.mat('plastic', { tint: col, uv: 'local' });
    // tapered legs + round seat (red plastic stool)
    w.cyl(0, 0, 0, 0.17, 0.14, 0.42, 8, 0, 0.2);
    w.cyl(0, 0.42, 0, 0.15, 0.15, 0.04, 10, 1);
    w.mat('plastic', { tint: col * 0 + 0x101010, uv: 'local' });
  }));
  const stoolStack = (col: number, n: number) => memo('stack' + col + n, () => T((w) => {
    w.mat('plastic', { tint: col, uv: 'local' });
    for (let i = 0; i < n; i++) {
      const y = i * 0.075;
      w.cyl(0, y, 0, 0.17, 0.142, 0.42, 8, i === n - 1 ? 0 : 0, 0.2 + i * 0.07);
    }
    w.cyl(0, (n - 1) * 0.075 + 0.42, 0, 0.15, 0.15, 0.04, 10, 1);
  }));
  const plasticChair = (col: number) => memo('chair' + col, () => T((w) => {
    w.mat('plastic', { tint: col, uv: 'local' });
    for (const [x, z] of [[-0.21, -0.2], [0.21, -0.2], [-0.21, 0.2], [0.21, 0.2]]) w.cyl(x, 0, z, 0.025, 0.03, 0.44, 5, 0);
    w.bevelBox(-0.24, 0.42, -0.24, 0.24, 0.46, 0.24, 0.04);
    w.pushTR(0, 0.46, -0.23, -0.18, 0, 0);
    w.bevelBox(-0.23, 0, -0.025, 0.23, 0.42, 0.015, 0.05);
    w.pop();
  }));
  const chairStack = (col: number, n: number) => memo('chairs' + col + n, () => T((w) => {
    w.mat('plastic', { tint: col, uv: 'local' });
    for (const [x, z] of [[-0.21, -0.2], [0.21, -0.2], [-0.21, 0.2], [0.21, 0.2]]) w.cyl(x, 0, z, 0.025, 0.03, 0.44, 5, 0);
    for (let i = 0; i < n; i++) {
      const y = 0.42 + i * 0.09;
      w.box(-0.245, y, -0.245, 0.245, y + 0.05, 0.245, ALL & ~NY);
      w.pushTR(0, y + 0.05, -0.23 - i * 0.012, -0.18, 0, 0);
      w.box(-0.23, 0, -0.025, 0.23, 0.42, 0.012, PZ | NZ | PY);
      w.pop();
    }
  }));
  const plasticTable = (col: number) => memo('table' + col, () => T((w) => {
    w.mat('plastic', { tint: col, uv: 'local' });
    w.bevelBox(-0.45, 0.7, -0.35, 0.45, 0.74, 0.35, 0.05);
    for (const [x, z] of [[-0.4, -0.3], [0.4, -0.3], [-0.4, 0.3], [0.4, 0.3]]) w.cyl(x, 0, z, 0.03, 0.035, 0.7, 5, 0);
  }));
  const basket = (col: number) => memo('basket' + col, () => T((w) => {
    w.mat('plastic', { tint: col, uv: 'local' });
    w.cyl(0, 0, 0, 0.2, 0.26, 0.26, 10, 0, 0, 0.02);
    w.cyl(0, 0.26, 0, 0.27, 0.27, 0.02, 10, 0);
  }));
  const bucket = (col: number) => memo('bucket' + col, () => T((w) => {
    w.mat('plastic_gloss', { tint: col, uv: 'local' });
    w.cyl(0, 0, 0, 0.13, 0.16, 0.3, 10, 0, 0, 0.02);
    w.mat('plastic', { tint: 0x2a2a2a, uv: 'local' });
    w.cyl(0, 0.02, 0, 0.12, 0.12, 0.01, 10, 1);
  }));
  const crate = (col: number) => memo('crate' + col, () => T((w) => {
    w.mat('plastic', { tint: col, uv: 'local' });
    w.box(-0.27, 0, -0.2, 0.27, 0.3, 0.2, ALL & ~NY);
    w.mat('plastic', { tint: (col & 0xfefefe) >> 1, uv: 'local' });
    w.box(-0.24, 0.02, -0.17, 0.24, 0.31, 0.17, PY);
  }));

  // ------------------------------------------------------------------ trash & junk
  const trashBag = (k: number) => memo('bag' + k, () => T((w) => {
    w.mat('plastic_gloss', { tint: k % 3 === 0 ? 0x16181a : k % 3 === 1 ? 0x1a2a1c : 0x202020, uv: 'local' });
    // lumpy sack: a jittered low-poly ellipsoid made of stacked prisms
    const r0 = 0.24 + (k % 2) * 0.05;
    w.cyl(0, 0, 0, r0 * 0.8, r0, 0.22, 7, 0, k, 0.3);
    w.cyl(0, 0.22, 0, r0, r0 * 0.75, 0.2, 7, 0, k + 0.4, 0.35);
    w.cyl(0, 0.42, 0, r0 * 0.75, 0.06, 0.16, 7, 1, k + 0.8, 0.3);
    w.cyl(0, 0.58, 0, 0.06, 0.02, 0.08, 4, 1, k);
  }));
  const bin = (col: number) => memo('bin' + col, () => T((w) => {
    w.mat('plastic', { tint: col, ov: 'plaster_moldy', ovAmt: 0.25, uv: 'local' });
    w.bevelBox(-0.29, 0.06, -0.33, 0.29, 1.0, 0.33, 0.04);
    w.box(-0.32, 1.0, -0.37, 0.32, 1.06, 0.36, ALL);
    w.mat('rubber', { uv: 'local' });
    w.pushTR(0, 0.1, -0.36, 0, 0, Math.PI / 2);
    w.cyl(0, -0.3, 0, 0.1, 0.1, 0.05, 8, 3);
    w.cyl(0, 0.25, 0, 0.1, 0.1, 0.05, 8, 3);
    w.pop();
  }));
  const cardboardPile = (k: number) => memo('cb' + k, () => T((w) => {
    w.mat('cardboard', { uv: 'local' });
    w.box(-0.4, 0, -0.3, 0.3, 0.45, 0.25, ALL & ~NY);
    w.pushT(0.15, 0.45, 0, 0.4 + k * 0.3);
    w.box(-0.25, 0, -0.2, 0.25, 0.35, 0.2, ALL & ~NY);
    w.pop();
    w.pushTR(-0.1, 0.01, 0.55, 0, 0.3 + k, 0.0);
    w.box(-0.5, 0, -0.35, 0.5, 0.02, 0.35, ALL & ~NY); // flattened box
    w.pop();
  }));
  const lpgTank = (col: number) => memo('lpg' + col, () => T((w) => {
    w.mat('metal_paint', { tint: col, ov: 'steel_rust', ovAmt: 0.4, uv: 'local' });
    w.cyl(0, 0.04, 0, 0.16, 0.16, 0.5, 10, 0, 0, 0.01);
    w.cyl(0, 0.54, 0, 0.16, 0.08, 0.08, 10, 1);
    w.cyl(0, 0, 0, 0.14, 0.15, 0.05, 10, 0);
    w.mat('steel_rust', { uv: 'local' });
    w.cyl(0, 0.6, 0, 0.1, 0.1, 0.1, 8, 0);
    w.mat('brass', { uv: 'local' });
    w.cyl(0, 0.6, 0, 0.025, 0.025, 0.09, 6, 1);
  }));
  const wok = () => memo('wok', () => T((w) => {
    w.mat('stainless_dirty', { tint: 0x55504a, uv: 'local' });
    w.cyl(0, 0, 0, 0.06, 0.2, 0.09, 12, 0);
    w.mat('wood_old', { uv: 'local' });
    w.box(0.19, 0.07, -0.015, 0.4, 0.1, 0.015, ALL);
  }));
  const pot = (r: number) => memo('pot' + r, () => T((w) => {
    w.mat('alu', { uv: 'local' });
    w.cyl(0, 0, 0, r, r, r * 1.6, 12, 1);
    w.box(-r - 0.05, r * 1.3, -0.015, -r, r * 1.4, 0.015, ALL);
    w.box(r, r * 1.3, -0.015, r + 0.05, r * 1.4, 0.015, ALL);
  }));

  // ------------------------------------------------------------------ vehicles
  const motorbike = (col: number) => memo('moto' + col, () => T((w) => {
    // Honda-Wave style underbone scooter, length along Z (front +Z)
    const body = (o: any = {}) => w.mat('plastic_gloss', { tint: col, uv: 'local', ...o });
    // wheels
    for (const z of [-0.62, 0.62]) {
      w.mat('rubber', { uv: 'local' });
      w.pushTR(0, 0.29, z, 0, 0, Math.PI / 2);
      w.cyl(0, -0.055, 0, 0.29, 0.29, 0.11, 12, 3);
      w.pop();
      w.mat('alu', { uv: 'local' });
      w.pushTR(0, 0.29, z, 0, 0, Math.PI / 2);
      w.cyl(0, -0.058, 0, 0.17, 0.17, 0.116, 10, 3);
      w.pop();
    }
    // frame / engine
    w.mat('metal_paint', { tint: 0x2a2a2a, uv: 'local' });
    w.box(-0.12, 0.2, -0.45, 0.12, 0.42, 0.1, ALL);
    w.mat('chrome', { uv: 'local' });
    w.tube([0.1, 0.25, -0.2, 0.14, 0.3, -0.75, 0.14, 0.42, -0.95], 0.04, 5); // exhaust
    // body panels
    body();
    w.bevelBox(-0.16, 0.45, -0.75, 0.16, 0.78, -0.05, 0.06); // rear body
    w.bevelBox(-0.13, 0.28, -0.05, 0.13, 0.5, 0.3, 0.05);    // floor tunnel
    w.pushTR(0, 0.38, 0.38, -0.35, 0, 0);
    w.bevelBox(-0.2, 0, -0.08, 0.2, 0.62, 0.08, 0.06);       // leg shield
    w.pop();
    w.bevelBox(-0.14, 0.6, 0.62, 0.14, 0.72, 0.85, 0.04);    // front fender
    // seat
    w.mat('leather', { uv: 'local' });
    w.bevelBox(-0.15, 0.78, -0.72, 0.15, 0.86, -0.08, 0.05);
    // fork + handlebar + headlight + mirrors
    w.mat('chrome', { uv: 'local' });
    w.tube([0, 0.3, 0.62, 0, 0.95, 0.42], 0.025, 5);
    w.tube([-0.33, 1.02, 0.4, 0, 0.98, 0.42, 0.33, 1.02, 0.4], 0.016, 4);
    w.tube([-0.25, 1.0, 0.4, -0.3, 1.25, 0.38], 0.008, 3);
    w.tube([0.25, 1.0, 0.4, 0.3, 1.25, 0.38], 0.008, 3);
    w.mat('plastic_gloss', { tint: 0x222222, uv: 'local' });
    w.box(-0.06, 1.22, 0.35, 0.06, 1.3, 0.4, ALL);
    body();
    w.bevelBox(-0.16, 0.9, 0.36, 0.16, 1.06, 0.52, 0.04);     // handlebar cover
    w.mat('glass', { tint: 0xfff6d0, uv: 'local', emis: 1, emisK: 0.0 });
    w.box(-0.07, 0.92, 0.52, 0.07, 1.0, 0.54, PZ);
    // rear rack + plate + tail light
    w.mat('steel_rust', { uv: 'local' });
    w.box(-0.14, 0.85, -0.95, 0.14, 0.87, -0.7, ALL);
    w.mat('plastic', { tint: 0xf0ece0, uv: 'local' });
    w.box(-0.1, 0.55, -0.88, 0.1, 0.69, -0.86, ALL);
    w.mat('plastic_gloss', { tint: 0xc01818, uv: 'local' });
    w.box(-0.06, 0.72, -0.86, 0.06, 0.77, -0.8, ALL);
    // side stand (tilt is applied by the caller)
  }));

  const pickup = (col: number) => memo('pickup' + col, () => T((w) => {
    // Hilux-like single cab pickup, length along Z (front +Z), ~4.9 m
    const paint = () => w.mat('metal_paint', { tint: col, ov: 'steel_rust', ovAmt: 0.12, uv: 'local' });
    for (const z of [-1.45, 1.35]) for (const x of [-0.78, 0.78]) {
      w.mat('rubber', { uv: 'local' });
      w.pushTR(x, 0.36, z, 0, 0, Math.PI / 2);
      w.cyl(0, -0.12, 0, 0.36, 0.36, 0.24, 12, 3);
      w.pop();
      w.mat('alu', { uv: 'local' });
      w.pushTR(x + (x > 0 ? 0.125 : -0.125), 0.36, z, 0, 0, Math.PI / 2);
      w.cyl(0, -0.005, 0, 0.21, 0.21, 0.01, 10, 3);
      w.pop();
    }
    paint();
    w.bevelBox(-0.88, 0.45, -2.45, 0.88, 0.95, 2.45, 0.08);      // lower body
    w.bevelBox(-0.86, 0.95, 0.15, 0.86, 1.0, 2.4, 0.12);         // hood base
    // cab
    w.prismCab = undefined as any;
    w.bevelBox(-0.84, 0.95, -0.55, 0.84, 1.55, 0.6, 0.1);
    w.mat('glass', { tint: 0x101418, uv: 'local' });
    w.quad(-0.8, 1.02, 0.62, 0.8, 1.02, 0.62, 0.72, 1.5, 0.35, -0.72, 1.5, 0.35); // windscreen (slanted)
    w.box(-0.85, 1.05, -0.4, -0.84, 1.45, 0.4, NX);
    w.box(0.84, 1.05, -0.4, 0.85, 1.45, 0.4, PX);
    w.box(-0.7, 1.05, -0.56, 0.7, 1.45, -0.55, NZ);
    paint();
    w.box(-0.84, 1.5, -0.55, 0.84, 1.6, 0.35, ALL & ~NY);
    // bed (open box)
    w.box(-0.88, 0.95, -2.45, -0.8, 1.42, -0.6, ALL);
    w.box(0.8, 0.95, -2.45, 0.88, 1.42, -0.6, ALL);
    w.box(-0.88, 0.95, -2.45, 0.88, 1.42, -2.37, ALL);
    w.mat('rubber', { uv: 'local' });
    w.box(-0.8, 0.96, -2.37, 0.8, 0.98, -0.6, PY);
    // bumpers, grille, lights
    w.mat('chrome', { uv: 'local' });
    w.bevelBox(-0.9, 0.4, 2.42, 0.9, 0.58, 2.58, 0.05);
    w.mat('metal_paint', { tint: 0x1a1a1a, uv: 'local' });
    w.box(-0.6, 0.62, 2.44, 0.6, 0.88, 2.47, PZ);
    w.box(-0.9, 0.4, -2.58, 0.9, 0.56, -2.44, ALL);
    w.mat('glass', { tint: 0xfff3d8, uv: 'local' });
    w.box(-0.85, 0.7, 2.43, -0.62, 0.86, 2.46, PZ);
    w.box(0.62, 0.7, 2.43, 0.85, 0.86, 2.46, PZ);
    w.mat('plastic_gloss', { tint: 0xb01010, uv: 'local' });
    w.box(-0.88, 0.95, -2.46, -0.74, 1.25, -2.44, NZ);
    w.box(0.74, 0.95, -2.46, 0.88, 1.25, -2.44, NZ);
    w.mat('plastic', { tint: 0xf2eee0, uv: 'local' });
    w.box(-0.25, 0.6, -2.6, 0.25, 0.75, -2.58, NZ);
  }));

  // ------------------------------------------------------------------ street furniture
  const umbrella = (col: number) => memo('umb' + col, () => T((w) => {
    w.mat('steel_rust', { uv: 'local' });
    w.cyl(0, 0, 0, 0.025, 0.025, 2.25, 5, 1);
    w.mat('concrete_old', { uv: 'local' });
    w.cyl(0, 0, 0, 0.22, 0.2, 0.12, 8, 1);
    w.mat('tarp', { tint: col, uv: 'local', ao: 0.95 });
    const R = 1.25, N = 10;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
      const sag = 0.05;
      w.tri(0, 2.42, 0, Math.cos(a1) * R, 2.05 + sag, Math.sin(a1) * R, Math.cos(a0) * R, 2.05 + sag, Math.sin(a0) * R);
      w.tri(0, 2.42, 0, Math.cos(a0) * R, 2.05 + sag, Math.sin(a0) * R, Math.cos(a1) * R, 2.05 + sag, Math.sin(a1) * R);
    }
  }));
  const barrier = (col: number) => memo('barrier' + col, () => T((w) => {
    // water-filled plastic road barrier (red/white)
    w.mat('plastic_gloss', { tint: col, ov: 'plaster_moldy', ovAmt: 0.3, uv: 'local' });
    w.prism([[-0.95, -0.25], [0.95, -0.25], [0.95, 0.25], [-0.95, 0.25]], 0, 0.15, false);
    w.prism([[-0.9, -0.22], [0.9, -0.22], [0.9, 0.22], [-0.9, 0.22]], 0.15, 0.55, false);
    w.prism([[-0.85, -0.14], [0.85, -0.14], [0.85, 0.14], [-0.85, 0.14]], 0.55, 0.95, true);
  }));
  const cone = () => memo('cone', () => T((w) => {
    w.mat('plastic_gloss', { tint: 0xe85a10, uv: 'local' });
    w.box(-0.2, 0, -0.2, 0.2, 0.04, 0.2, ALL & ~NY);
    w.cyl(0, 0.04, 0, 0.14, 0.03, 0.66, 8, 1);
    w.mat('plastic', { tint: 0xf0f0f0, uv: 'local' });
    w.cyl(0, 0.3, 0, 0.102, 0.08, 0.12, 8, 0);
  }));
  const tube = () => memo('tube', () => T((w) => {
    // hanging fluorescent tube (emissive) with a little reflector — origin at the top
    w.mat('metal_paint', { tint: 0xe0e0dc, uv: 'local' });
    w.box(-0.62, -0.05, -0.05, 0.62, 0, 0.05, ALL);
    w.mat('plastic', { tint: 0xf4fbff, uv: 'local', emis: 2, emisK: 0.75 });
    w.pushTR(-0.6, -0.075, 0, 0, 0, -Math.PI / 2);
    w.cyl(0, 0, 0, 0.018, 0.018, 1.2, 6, 3);
    w.pop();
    w.mat('rubber', { uv: 'local' });
    w.tube([-0.4, 0, 0, -0.4, 0.6, 0], 0.004, 3);
    w.tube([0.4, 0, 0, 0.4, 0.6, 0], 0.004, 3);
  }));

  const spiritHouse = () => memo('spirit', () => T((w) => {
    // ศาลพระภูมิ on a pillar: base platform, white/gold pillar, little Thai-style house with tiered roof
    w.mat('tiles_wall', { tint: 0xd8d0c0, uv: 'local' });
    w.box(-0.9, 0, -0.9, 0.9, 0.35, 0.9, ALL & ~NY);
    w.mat('marble', { uv: 'local' });
    w.box(-0.75, 0.35, -0.75, 0.75, 0.42, 0.75, ALL & ~NY);
    w.mat('plaster', { tint: 0xf0ece4, uv: 'local' });
    w.bevelBox(-0.18, 0.42, -0.18, 0.18, 1.45, 0.18, 0.04);
    w.mat('brass', { uv: 'local' });
    w.box(-0.24, 1.45, -0.24, 0.24, 1.52, 0.24, ALL);
    // platform
    w.mat('plaster', { tint: 0xe8dcc0, uv: 'local' });
    w.box(-0.5, 1.52, -0.45, 0.5, 1.6, 0.45, ALL);
    // house body
    w.mat('plaster', { tint: 0xf4f0e8, uv: 'local' });
    w.box(-0.32, 1.6, -0.3, 0.32, 2.05, 0.25, ALL & ~NY);
    w.mat('brass', { uv: 'local' });
    for (const x of [-0.3, -0.1, 0.1, 0.3]) w.cyl(x, 1.6, 0.3, 0.025, 0.025, 0.45, 6, 1);
    w.box(-0.12, 1.62, 0.251, 0.12, 1.92, 0.27, PZ);
    // tiered roof (red & green tiles with gold trim)
    const roof = (y: number, hw: number, hd: number, h: number, col: number) => {
      w.mat('roof_tiles', { tint: col, uv: 'local' });
      w.quad(-hw, y, hd, hw, y, hd, hw * 0.25, y + h, 0, -hw * 0.25, y + h, 0);
      w.quad(hw, y, -hd, -hw, y, -hd, -hw * 0.25, y + h, 0, hw * 0.25, y + h, 0);
      w.mat('brass', { uv: 'local' });
      w.tri(-hw, y, hd, -hw * 0.25, y + h, 0, -hw, y, -hd);
      w.tri(hw, y, -hd, hw * 0.25, y + h, 0, hw, y, hd);
      w.box(-hw - 0.02, y - 0.02, hd - 0.01, hw + 0.02, y + 0.01, hd + 0.02, ALL);
    };
    roof(2.05, 0.45, 0.42, 0.28, 0xb03020);
    roof(2.22, 0.32, 0.3, 0.26, 0x2a7a3a);
    w.mat('brass', { uv: 'local' });
    w.cyl(0, 2.45, 0, 0.03, 0.005, 0.3, 6, 1);
    // chofa finials
    w.tube([-0.45, 2.05, 0.42, -0.5, 2.18, 0.46], 0.012, 3);
    w.tube([0.45, 2.05, 0.42, 0.5, 2.18, 0.46], 0.012, 3);
  }));

  const atm = () => memo('atm', () => T((w) => {
    w.mat('metal_paint', { tint: 0x2a3a5a, uv: 'local' });
    w.bevelBox(-0.4, 0, -0.4, 0.4, 1.9, 0.35, 0.04);
    w.mat('plastic', { tint: 0x1a1a1a, uv: 'local' });
    w.box(-0.3, 1.05, 0.35, 0.3, 1.55, 0.42, ALL);
    w.mat('glass', { tint: 0x2a5a8a, uv: 'local', emis: 7, emisK: 0.35 });
    w.box(-0.22, 1.18, 0.42, 0.22, 1.48, 0.425, PZ);
    w.mat('stainless', { uv: 'local' });
    w.box(-0.32, 0.9, 0.35, 0.32, 1.02, 0.55, ALL);
    w.mat('plastic_gloss', { tint: 0xd02020, uv: 'local', emis: 5, emisK: 0.3 });
    w.box(-0.4, 1.9, -0.4, 0.4, 2.15, 0.36, ALL);
  }));
  const phoneBooth = () => memo('phone', () => T((w) => {
    w.mat('metal_paint', { tint: 0x2a62a8, ov: 'steel_rust', ovAmt: 0.4, uv: 'local' });
    w.box(-0.45, 0, -0.4, 0.45, 0.1, 0.4, ALL & ~NY);
    for (const [x, z] of [[-0.42, -0.37], [0.42, -0.37], [-0.42, 0.37], [0.42, 0.37]]) w.box(x - 0.03, 0.1, z - 0.03, x + 0.03, 2.2, z + 0.03, SIDES);
    w.box(-0.5, 2.2, -0.45, 0.5, 2.35, 0.45, ALL);
    w.box(-0.42, 0.1, -0.4, 0.42, 2.2, -0.37, PZ | NZ);
    w.mat('metal_paint', { tint: 0xc8c8c0, uv: 'local' });
    w.box(-0.2, 1.1, -0.37, 0.2, 1.6, -0.25, ALL);
    w.mat('glass', { tint: 0x30383c, uv: 'local' });
    w.box(-0.45, 0.9, -0.37, -0.44, 2.15, 0.37, NX | PX);
    w.box(0.44, 0.9, -0.37, 0.45, 2.15, 0.37, NX | PX);
  }));

  const cart = (col: number) => memo('cart' + col, () => T((w) => {
    // street-food push cart (stainless + glass cabinet) — decoration only
    w.mat('stainless_dirty', { uv: 'local' });
    w.box(-0.75, 0.55, -0.4, 0.75, 0.95, 0.4, ALL);
    w.mat('glass', { tint: 0x8a9a9a, uv: 'local' });
    w.box(-0.7, 0.95, -0.35, 0.7, 1.45, 0.35, ALL & ~NY);
    w.mat('metal_paint', { tint: col, uv: 'local' });
    w.box(-0.75, 1.45, -0.42, 0.75, 1.5, 0.42, ALL);
    w.mat('rubber', { uv: 'local' });
    for (const x of [-0.55, 0.55]) { w.pushTR(x, 0.28, 0.0, 0, 0, Math.PI / 2); w.cyl(0, -0.45, 0, 0.28, 0.28, 0.05, 10, 3); w.cyl(0, 0.4, 0, 0.28, 0.28, 0.05, 10, 3); w.pop(); }
    w.mat('steel_rust', { uv: 'local' });
    w.box(-0.7, 0.28, -0.03, 0.7, 0.32, 0.03, ALL);
    w.tube([-0.75, 0.9, -0.35, -1.05, 0.95, -0.35, -1.05, 0.95, 0.35, -0.75, 0.9, 0.35], 0.016, 4);
  }));

  const vestRail = () => memo('vests', () => T((w) => {
    // motorcycle-taxi stand: a rail with orange vests hanging
    w.mat('steel_rust', { uv: 'local' });
    w.box(-0.9, 0, -0.03, -0.86, 1.8, 0.03, SIDES);
    w.box(0.86, 0, -0.03, 0.9, 1.8, 0.03, SIDES);
    w.box(-0.9, 1.75, -0.02, 0.9, 1.79, 0.02, ALL);
    w.mat('tarp', { tint: 0xf06818, uv: 'local' });
    for (let i = 0; i < 6; i++) {
      const x = -0.72 + i * 0.29;
      w.pushTR(x, 1.75, 0.0, 0.05 * (i % 2), 0.1 * ((i * 7) % 3 - 1), 0);
      w.quad(-0.13, -0.68, 0.015, 0.13, -0.68, 0.015, 0.11, -0.02, 0.015, -0.11, -0.02, 0.015);
      w.quad(0.13, -0.68, -0.015, -0.13, -0.68, -0.015, -0.11, -0.02, -0.015, 0.11, -0.02, -0.015);
      w.pop();
    }
  }));
  const bench = () => memo('bench', () => T((w) => {
    w.mat('wood_paint', { tint: 0x5a7a4a, uv: 'local' });
    w.box(-0.9, 0.42, -0.2, 0.9, 0.47, 0.2, ALL);
    w.mat('steel_rust', { uv: 'local' });
    for (const x of [-0.8, 0.8]) w.box(x - 0.03, 0, -0.18, x + 0.03, 0.42, 0.18, SIDES);
  }));

  const junkPile = (k: number) => memo('junk' + k, () => T((w) => {
    w.mat('wood_old', { uv: 'local' });
    w.pushTR(0, 0.05, 0, 0.1, k, 0.2); w.box(-0.6, 0, -0.08, 0.6, 0.04, 0.08, ALL); w.pop();
    w.mat('plywood', { uv: 'local' });
    w.pushTR(0.2, 0.4, -0.2, -0.3, k * 2, 0); w.box(-0.5, -0.4, -0.01, 0.5, 0.4, 0.01, ALL); w.pop();
    w.mat('plastic', { tint: PLASTIC_COLORS[k % PLASTIC_COLORS.length], uv: 'local' });
    w.box(-0.4, 0, 0.1, -0.1, 0.25, 0.35, ALL & ~NY);
    w.mat('steel_rust', { uv: 'local' });
    w.tube([-0.5, 0.02, -0.3, 0.6, 0.2, 0.3], 0.02, 4);
  }));

  const signBoxStand = () => memo('aframe', () => T((w) => {
    w.mat('metal_paint', { tint: 0xd8d2c8, uv: 'local' });
    w.pushTR(0, 0, 0.2, -0.22, 0, 0); w.box(-0.32, 0, -0.01, 0.32, 0.95, 0.01, ALL); w.pop();
    w.pushTR(0, 0, -0.2, 0.22, 0, 0); w.box(-0.32, 0, -0.01, 0.32, 0.95, 0.01, ALL); w.pop();
  }));

  return {
    acUnit, waterTankSteel, waterTankBlue, antenna, dish,
    stool, stoolStack, plasticChair, chairStack, plasticTable, basket, bucket, crate,
    trashBag, bin, cardboardPile, lpgTank, wok, pot,
    motorbike, pickup, umbrella, barrier, cone, tube, spiritHouse, atm, phoneBooth, cart, vestRail, bench, junkPile, signBoxStand,
    C,
  };
}

void SIDES; void PY; void NY;
