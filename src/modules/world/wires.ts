import * as THREE from 'three';
import { RNG } from '../../core/rng';
import { WB, SIDES, ALL, PY, NY } from './geo';
import type { NightLights } from './lights';
import type { Props } from './props';
import { POLES_SOI, POLES_SOI_E, POLES_MAIN_N, POLES_MAIN_S, POLES_CANAL, POLES_RURAL, SW_H, MAIN, MEDIAN_H } from './layout';
import { EMIS } from './mats';

/**
 * UTILITY POLES & WIRES — Thai concrete poles with steel crossarms, insulators, transformers,
 * junction boxes, slack-cable coils, and the iconic SAGGING TANGLED BLACK BUNDLES between poles,
 * drop cables to the shophouses; sodium street lamps on arms + double-arm lamp posts on the median.
 */

export interface PoleCtx { w: WB; rng: RNG; lights: NightLights; phys: { box(c: number[], s: number[], yaw?: number): void }; props: Props }

interface PoleInfo { x: number; z: number; y: number; h: number; dir: THREE.Vector2; side: THREE.Vector2; lamp: boolean; tx: boolean }

const SODIUM = new THREE.Color(0xffa448);
const LED = new THREE.Color(0xe8f0ff);

function pole(c: PoleCtx, x: number, z: number, y: number, along: THREE.Vector2, toRoad: THREE.Vector2, o: { h?: number; lamp?: boolean; transformer?: boolean; led?: boolean } = {}): PoleInfo {
  const { w, rng } = c;
  const h = o.h ?? rng.range(8.6, 9.6);
  const yaw = Math.atan2(along.x, along.y);
  // tapered square concrete pole (8-sided bevel so it never reads as a lazy box)
  w.setGroup('base');
  w.mat('concrete_old', { tint: 0xc8c4bc, ov: 'plaster_moldy', ovAmt: 0.55, uv: 'local' });
  w.pushT(x, y, z, yaw);
  const r0 = 0.17, r1 = 0.1;
  const P = (r: number): [number, number][] => [[-r, -r * 0.6], [-r * 0.6, -r], [r * 0.6, -r], [r, -r * 0.6], [r, r * 0.6], [r * 0.6, r], [-r * 0.6, r], [-r, r * 0.6]];
  // build as 3 stacked frustums
  const segs = 3;
  for (let i = 0; i < segs; i++) {
    const ya = (h * i) / segs, yb = (h * (i + 1)) / segs;
    const ra = r0 + (r1 - r0) * (i / segs), rb = r0 + (r1 - r0) * ((i + 1) / segs);
    const A = P(ra), B = P(rb);
    for (let k = 0; k < 8; k++) {
      const a = A[k], b = A[(k + 1) % 8], cc = B[(k + 1) % 8], d = B[k];
      w.quad(b[0], ya, b[1], a[0], ya, a[1], d[0], yb, d[1], cc[0], yb, cc[1]);
    }
  }
  w.fan(P(r1), h, true);
  // black/white base band + number plate
  w.mat('metal_paint', { tint: 0x1a1a1a, uv: 'local' });
  w.box(-r0 - 0.005, 0.0, -r0 - 0.005, r0 + 0.005, 0.5, r0 + 0.005, SIDES);
  w.mat('metal_paint', { tint: 0xe8e8e0, uv: 'local' });
  w.box(-0.08, 2.2, r0 * 0.9, 0.08, 2.45, r0 * 0.9 + 0.01, ALL);
  // crossarms (perpendicular to the line = local X), insulators
  w.setGroup('detail');
  w.mat('galv', { ov: 'steel_rust', ovAmt: 0.4, uv: 'local' });
  w.box(-0.9, h - 0.35, -0.05, 0.9, h - 0.25, 0.05, ALL);
  w.box(-0.7, h - 1.15, -0.05, 0.7, h - 1.05, 0.05, ALL);
  w.tube([-0.6, h - 0.3, 0, 0, h - 0.9, 0, 0.6, h - 0.3, 0], 0.02, 3);
  w.mat('plastic_gloss', { tint: 0xd8d4c8, uv: 'local' });
  for (const xx of [-0.75, 0, 0.75]) w.cyl(xx, h - 0.25, 0, 0.045, 0.035, 0.14, 6, 1);
  for (const xx of [-0.55, 0.55]) w.cyl(xx, h - 1.05, 0, 0.04, 0.03, 0.12, 6, 1);
  // telecom clamp bracket + junction box + slack coil
  w.mat('metal_paint', { tint: 0x9a9a94, ov: 'steel_rust', ovAmt: 0.5, uv: 'local' });
  w.box(-0.25, 5.9, -0.22, 0.25, 6.0, 0.22, ALL);
  if (rng.chance(0.55)) { w.mat('plastic', { tint: rng.pick([0x9aa0a0, 0xd8d4c8, 0x5a6a6a]), uv: 'local' }); w.bevelBox(0.12, 4.1, -0.15, 0.45, 4.6, 0.12, 0.02); }
  if (rng.chance(0.5)) {
    w.mat('rubber', { uv: 'local' });
    const cy = rng.range(5.0, 5.7);
    for (let k = 0; k < 3; k++) {
      const pts: number[] = [];
      const R = 0.32 + k * 0.03;
      for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI * 2; pts.push(Math.cos(a) * R * 0.25 + 0.22, cy + Math.sin(a) * R, Math.cos(a) * R * 0.9 * 0.3); }
      w.tube(pts, 0.012, 3);
    }
  }
  // transformer (grey tank with fins, on a platform bracket) + fuse cutouts
  if (o.transformer) {
    w.mat('galv', { tint: 0x9aa09a, ov: 'steel_rust', ovAmt: 0.35, uv: 'local' });
    w.box(-0.5, 4.3, -0.55, 0.5, 4.38, 0.15, ALL);
    w.cyl(0, 4.38, -0.32, 0.32, 0.32, 1.0, 10, 1);
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; w.box(Math.cos(a) * 0.33 - 0.02, 4.45, -0.32 + Math.sin(a) * 0.33 - 0.02, Math.cos(a) * 0.33 + 0.02, 5.25, -0.32 + Math.sin(a) * 0.33 + 0.02, SIDES); }
    w.mat('plastic_gloss', { tint: 0x8a6a4a, uv: 'local' });
    for (const xx of [-0.15, 0, 0.15]) w.cyl(xx, 5.38, -0.32, 0.03, 0.03, 0.18, 6, 1);
    w.mat('rubber', { uv: 'local' });
    for (const xx of [-0.15, 0, 0.15]) w.tube([xx, 5.56, -0.32, xx * 3, h - 1.05, 0], 0.01, 3);
  }
  // stickers / posters (loan ads, cable company tags) as decals happen in dressing.ts
  w.pop();
  // lamp arm toward the road
  if (o.lamp) {
    const ly = h - 1.6;
    const ax = x + toRoad.x * 1.9, az = z + toRoad.y * 1.9;
    w.mat('galv', { tint: 0xc8c8c0, ov: 'steel_rust', ovAmt: 0.3, uv: 'local' });
    w.tube([x + toRoad.x * 0.15, ly - 0.6, z + toRoad.y * 0.15, x + toRoad.x * 0.9, ly + 0.1, z + toRoad.y * 0.9, ax, ly + 0.25, az], 0.035, 5);
    lampHead(c, ax, ly + 0.2, az, Math.atan2(toRoad.x, toRoad.y), o.led ? LED : SODIUM);
  }
  c.phys.box([x, y + h / 2, z], [0.34, h, 0.34], yaw);
  return { x, z, y, h, dir: along.clone(), side: toRoad.clone(), lamp: !!o.lamp, tx: !!o.transformer };
}

function lampHead(c: PoleCtx, x: number, y: number, z: number, yaw: number, col: THREE.Color) {
  const w = c.w;
  w.pushT(x, y, z, yaw);
  w.mat('metal_paint', { tint: 0x8a8c88, uv: 'local' });
  w.bevelBox(-0.16, -0.06, -0.3, 0.16, 0.08, 0.32, 0.04);
  w.mat('glass', { tint: 0xfff0d8, uv: 'local', emis: col === LED ? EMIS.white.i : EMIS.sodium.i, emisK: 0.95 });
  w.box(-0.12, -0.09, -0.22, 0.12, -0.06, 0.26, NY | PY);
  w.pop();
  c.lights.lamp(new THREE.Vector3(x, y - 0.15, z), col, col === LED ? 30 : 42, 22, 4.6);
}

/** wires between consecutive poles of a line (and the bundles) */
function span(c: PoleCtx, a: PoleInfo, b: PoleInfo, heavy = 1) {
  const { w, rng } = c;
  w.setGroup('detail');
  w.mat('rubber', { tint: 0x2a2a2a, uv: 'local' });
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const px = -dz / len, pz = dx / len; // perpendicular
  // HV conductors (bare aluminium) on the top crossarm
  w.mat('alu', { tint: 0x8a8a88, uv: 'local' });
  for (const o of [-0.75, 0, 0.75]) {
    w.tube(WB.sagLine(a.x + px * o, a.y + a.h - 0.18, a.z + pz * o, b.x + px * o, b.y + b.h - 0.18, b.z + pz * o, len * 0.012, 8), 0.007, 3);
  }
  for (const o of [-0.55, 0.55]) w.tube(WB.sagLine(a.x + px * o, a.y + a.h - 0.98, a.z + pz * o, b.x + px * o, b.y + b.h - 0.98, b.z + pz * o, len * 0.016, 8), 0.007, 3);
  // telecom / fibre bundles: the famous tangle
  w.mat('rubber', { tint: 0x1c1c1c, uv: 'local' });
  const n = Math.round(rng.range(7, 14) * heavy);
  for (let i = 0; i < n; i++) {
    const ya = a.y + rng.range(5.4, 6.3), yb = b.y + rng.range(5.4, 6.3);
    const oa = rng.range(-0.25, 0.25), ob = rng.range(-0.25, 0.25);
    const sag = len * rng.range(0.018, 0.05);
    const thick = rng.chance(0.2) ? rng.range(0.022, 0.04) : rng.range(0.008, 0.016);
    w.tube(WB.sagLine(a.x + px * oa, ya, a.z + pz * oa, b.x + px * ob, yb, b.z + pz * ob, sag, 10, rng.range(0, 0.12), rng.range(0, 6)), thick, 3);
  }
  // a thick main trunk bundle with cable ties
  w.tube(WB.sagLine(a.x, a.y + 6.0, a.z, b.x, b.y + 6.0, b.z, len * 0.035, 12), 0.05 * heavy, 5);
  // occasional loose hanging cable
  if (rng.chance(0.35)) {
    const t = rng.range(0.25, 0.75);
    const mx = a.x + dx * t, mz = a.z + dz * t, my = a.y + 6.0 - len * 0.035 * 4 * t * (1 - t);
    w.tube([mx, my, mz, mx + rng.range(-0.3, 0.3), my - rng.range(0.8, 2.2), mz + rng.range(-0.3, 0.3)], 0.01, 3);
  }
  w.setGroup('base');
}

/** cable from a pole to a shophouse facade (drop) */
function drop(c: PoleCtx, p: PoleInfo, tx: number, ty: number, tz: number) {
  const { w, rng } = c;
  w.setGroup('detail');
  w.mat('rubber', { tint: 0x1a1a1a, uv: 'local' });
  for (let i = 0; i < rng.int(1, 3); i++) {
    const len = Math.hypot(tx - p.x, tz - p.z);
    w.tube(WB.sagLine(p.x, p.y + rng.range(5.2, 6.0), p.z, tx + rng.range(-0.3, 0.3), ty + rng.range(-0.3, 0.3), tz, len * rng.range(0.03, 0.07), 8), rng.range(0.008, 0.014), 3);
  }
  w.setGroup('base');
}

function line(c: PoleCtx, pts: [number, number][], y: number, toRoad: THREE.Vector2, opts: { lamps?: boolean; led?: boolean; heavy?: number; drops?: 'x+' | 'x-' | 'z+' | 'z-'; dropAt?: number } = {}) {
  const out: PoleInfo[] = [];
  for (let i = 0; i < pts.length; i++) {
    const [x, z] = pts[i];
    const nx = pts[Math.min(pts.length - 1, i + 1)], pv = pts[Math.max(0, i - 1)];
    const along = new THREE.Vector2(nx[0] - pv[0], nx[1] - pv[1]).normalize();
    out.push(pole(c, x, z, y, along, toRoad, { lamp: opts.lamps !== false, transformer: c.rng.chance(0.22), led: opts.led }));
  }
  for (let i = 0; i < out.length - 1; i++) span(c, out[i], out[i + 1], opts.heavy ?? 1);
  // drops into the facades on the pole's side
  if (opts.drops) for (const p of out) {
    const n = c.rng.int(1, 3);
    for (let k = 0; k < n; k++) {
      const off = c.rng.range(-12, 12);
      const d = opts.dropAt ?? 6.1;
      if (opts.drops === 'x-') drop(c, p, -d, c.rng.range(4.3, 5.2), p.z + off);
      if (opts.drops === 'x+') drop(c, p, d, c.rng.range(4.3, 5.2), p.z + off);
      if (opts.drops === 'z-') drop(c, p, p.x + off, c.rng.range(4.3, 5.2), -(opts.dropAt ?? 0.1));
      if (opts.drops === 'z+') drop(c, p, p.x + off, c.rng.range(4.3, 5.2), opts.dropAt ?? 26.1);
    }
  }
  return out;
}

export function buildPoles(c: PoleCtx) {
  const V = (x: number, z: number) => new THREE.Vector2(x, z);
  // soi: poles on both sidewalks, wires cross the road at a few places
  const W = line(c, POLES_SOI, SW_H, V(1, 0), { lamps: true, drops: 'x-' });
  const E = line(c, POLES_SOI_E, SW_H, V(-1, 0), { lamps: false, drops: 'x+', heavy: 0.7 });
  for (let i = 0; i < Math.min(W.length, E.length); i += 2) span(c, W[i], E[i], 0.5);
  // main road both sides
  const MN = line(c, POLES_MAIN_N, SW_H, V(0, 1), { lamps: false, drops: 'z-', dropAt: 0.1, heavy: 1.2 });
  const MS = line(c, POLES_MAIN_S, SW_H, V(0, -1), { lamps: false, drops: 'z+', dropAt: 26.1 });
  // connect the soi line to the main road line at the mouth
  const nearN = MN.reduce((b, p) => (Math.abs(p.x - W[0].x) < Math.abs(b.x - W[0].x) ? p : b), MN[0]);
  span(c, W[0], nearN, 0.8);
  void MS;
  // canal road + rural road
  line(c, POLES_CANAL, SW_H, V(0, -1), { lamps: true, drops: 'z+', dropAt: -155.4 });
  line(c, POLES_RURAL, 0.05, V(-1, 0), { lamps: true, heavy: 0.4 });

  // median lamp posts (double arm, LED/sodium mix) along the main road
  const zc = (MAIN.med0 + MAIN.med1) / 2;
  for (let x = -126; x <= 126; x += 34) {
    const { w } = c;
    w.setGroup('base');
    w.mat('galv', { tint: 0xb8bab4, ov: 'steel_rust', ovAmt: 0.25, uv: 'local' });
    w.cyl(x, MEDIAN_H, zc, 0.12, 0.08, 10, 8, 1);
    w.mat('concrete_old', { uv: 'local' });
    w.box(x - 0.3, MEDIAN_H, zc - 0.3, x + 0.3, MEDIAN_H + 0.35, zc + 0.3, ALL & ~NY);
    w.setGroup('detail');
    w.mat('galv', { tint: 0xb8bab4, uv: 'local' });
    const led = Math.abs(x) > 60;
    for (const s of [-1, 1]) {
      w.tube([x, MEDIAN_H + 9.2, zc, x, MEDIAN_H + 9.8, zc + s * 1.0, x, MEDIAN_H + 9.9, zc + s * 2.4], 0.05, 5);
      lampHead(c, x, MEDIAN_H + 9.85, zc + s * 2.5, s > 0 ? 0 : Math.PI, led ? LED : SODIUM);
    }
    c.phys.box([x, MEDIAN_H + 5, zc], [0.3, 10, 0.3]);
  }
}

void PY;
