import * as THREE from 'three';
import { RNG } from '../../core/rng';
import { WB, SIDES, ALL, PY, NY } from './geo';
import type { NightLights } from './lights';
import type { Props } from './props';
import { POLES_SOI, POLES_SOI_E, POLES_MAIN_N, POLES_MAIN_S, POLES_CANAL, POLES_RURAL, SW_H, MAIN, MEDIAN_H } from './layout';
import { EMIS } from './mats';
import { ARCH } from './archmodels';

const IDENT = new THREE.Matrix4();

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
  // the pole + crossarm/insulator set are real library models (custom bpy kit: gen/lib/arch/thai_pole*.glb),
  // instanced; the code below adds the per-pole clutter (junction boxes, coils, transformers, lamps)
  ARCH.add('thai_pole', IDENT, x, y, z, yaw, [1, h / 9, 1]);
  ARCH.add('thai_pole_arms', IDENT, x, y + h, z, yaw, 1);
  w.pushT(x, y, z, yaw);
  w.setGroup('detail');
  // junction box + slack coil (the telecom clamp ring is part of the pole model)
  if (rng.chance(0.55)) { w.mat('plastic', { tint: rng.pick([0x9aa0a0, 0xd8d4c8, 0x5a6a6a]), uv: 'local' }); w.bevelBox(0.12, 4.1, -0.15, 0.45, 4.6, 0.12, 0.02); }
  if (rng.chance(0.3)) {
    // big hanging loops of spare fibre (several coils bundled, sagging)
    w.mat('rubber', { tint: 0x161616, uv: 'local' });
    const cy = rng.range(4.6, 5.2), R = rng.range(0.4, 0.6);
    for (let k = 0; k < rng.int(5, 9); k++) {
      const pts: number[] = [];
      const rr = R * rng.range(0.85, 1.15), ox = rng.range(-0.06, 0.06);
      for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI * 2; pts.push(0.3 + ox + Math.sin(a) * 0.06, cy + 0.55 - (1 - Math.cos(a)) * rr * 0.9, Math.sin(a) * rr * 0.55); }
      w.tube(pts, 0.012, 3);
    }
  }
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
  if (o.transformer && rng.chance(0.5)) {
    w.mat('galv', { tint: 0x9aa09a, ov: 'steel_rust', ovAmt: 0.35, uv: 'local' });
    w.box(-0.5, 4.3, -0.55, 0.5, 4.38, 0.15, ALL);
    w.cyl(0, 4.38, -0.32, 0.32, 0.32, 1.0, 10, 1);
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; w.box(Math.cos(a) * 0.33 - 0.02, 4.45, -0.32 + Math.sin(a) * 0.33 - 0.02, Math.cos(a) * 0.33 + 0.02, 5.25, -0.32 + Math.sin(a) * 0.33 + 0.02, SIDES); }
    w.mat('plastic_gloss', { tint: 0x8a6a4a, uv: 'local' });
    for (const xx of [-0.15, 0, 0.15]) w.cyl(xx, 5.38, -0.32, 0.03, 0.03, 0.18, 6, 1);
    w.mat('rubber', { uv: 'local' });
    for (const xx of [-0.15, 0, 0.15]) w.tube([xx, 5.56, -0.32, xx * 3, h - 1.05, 0], 0.01, 3);
  } else if (o.transformer) {
    // rectangular MEA/PEA tank with radiator fins on a concrete cantilever beam (like the Bangkok photos)
    w.mat('concrete_old', { tint: 0xa8a49c, ov: 'plaster_moldy', ovAmt: 0.6, uv: 'local' });
    w.box(-0.25, 3.95, -1.25, 0.25, 4.25, 0.18, ALL);
    w.mat('galv', { tint: 0x8e948e, ov: 'steel_rust', ovAmt: 0.45, uv: 'local' });
    w.bevelBox(-0.42, 4.25, -1.15, 0.42, 5.35, -0.45, 0.04, true, false);
    for (let k = 0; k < 9; k++) {
      const z = -1.1 + k * 0.075;
      w.box(-0.6, 4.35, z, -0.42, 5.2, z + 0.02, ALL & ~NY); w.box(0.42, 4.35, z, 0.6, 5.2, z + 0.02, ALL & ~NY);
    }
    w.mat('metal_paint', { tint: 0x5a5e5a, uv: 'local' });
    w.box(-0.35, 4.25, -0.45, 0.35, 4.6, -0.36, ALL);
    w.cyl(0.15, 4.75, -0.43, 0.06, 0.06, 0.04, 8, 1, Math.PI / 2);
    w.mat('plastic_gloss', { tint: 0x7a5a3a, uv: 'local' });
    for (const xx of [-0.22, 0, 0.22]) { w.cyl(xx, 5.35, -0.8, 0.04, 0.03, 0.26, 6, 1); w.cyl(xx, 5.43, -0.8, 0.055, 0.055, 0.03, 6, 1); w.cyl(xx, 5.52, -0.8, 0.05, 0.05, 0.03, 6, 1); }
    w.mat('rubber', { uv: 'local' });
    for (const xx of [-0.22, 0, 0.22]) w.tube([xx, 5.6, -0.8, xx * 1.5, 6.4, -0.3, xx * 3, h - 1.05, 0], 0.012, 3);
    // the low-voltage spaghetti out of the side of the tank
    for (let k = 0; k < 6; k++) w.tube([0.42, 4.5 + k * 0.08, -0.6 - k * 0.05, 0.9, 4.2 + k * 0.1, -0.3, 0.3, 5.8 + k * 0.05, 0.1], 0.014, 3);
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

/** aExtra.y < 0 marks thin cables: the world vertex shader widens them with distance (no sub-pixel dashes) */
const WIRE_FLAG = -7;

/** wires between consecutive poles of a line (and the bundles) */
function span(c: PoleCtx, a: PoleInfo, b: PoleInfo, heavy = 1) {
  const { w, rng } = c;
  w.setGroup('detail');
  w.mat('rubber', { tint: 0x2a2a2a, uv: 'local' });
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const px = -dz / len, pz = dx / len; // perpendicular
  // HV conductors (bare aluminium) on the top crossarm
  w.mat('alu', { tint: 0x8a8a88, uv: 'local' }); w.ov = WIRE_FLAG;
  for (const o of [-0.75, 0, 0.75]) {
    w.tube(WB.sagLine(a.x + px * o, a.y + a.h - 0.18, a.z + pz * o, b.x + px * o, b.y + b.h - 0.18, b.z + pz * o, len * 0.012, 8), 0.007, 3);
  }
  for (const o of [-0.55, 0.55]) w.tube(WB.sagLine(a.x + px * o, a.y + a.h - 0.98, a.z + pz * o, b.x + px * o, b.y + b.h - 0.98, b.z + pz * o, len * 0.016, 8), 0.007, 3);
  // telecom / fibre bundles: the famous tangle
  w.mat('rubber', { tint: 0x1c1c1c, uv: 'local' }); w.ov = WIRE_FLAG;
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
  // the infamous MASS: on some spans dozens of cables sag together in a fat, loose bundle
  if (heavy >= 0.7 && rng.chance(0.45)) {
    const m = Math.round(rng.range(14, 26) * heavy);
    const sagM = len * rng.range(0.06, 0.1);
    for (let i = 0; i < m; i++) {
      const oa = rng.range(-0.18, 0.18), ob = rng.range(-0.18, 0.18), dy = rng.range(-0.25, 0.25);
      w.tube(WB.sagLine(a.x + px * oa, a.y + 5.9 + dy, a.z + pz * oa, b.x + px * ob, b.y + 5.9 + dy * 0.7, b.z + pz * ob, sagM * rng.range(0.8, 1.25), 12, rng.range(0.05, 0.25), rng.range(0, 6)), rng.range(0.008, 0.02), 3);
    }
    // black cable ties / splice boxes along the bundle
    w.mat('plastic', { tint: 0x1a1a1a, uv: 'local' }); w.ov = WIRE_FLAG;
    for (let k = 0; k < 3; k++) {
      const t = 0.2 + k * 0.3 + rng.range(-0.05, 0.05);
      const mx = a.x + dx * t, mz = a.z + dz * t, my = a.y + 5.9 - sagM * 4 * t * (1 - t);
      if (k === 1 && rng.chance(0.5)) w.box(mx - 0.12, my - 0.18, mz - 0.1, mx + 0.12, my + 0.06, mz + 0.1, ALL);
    }
  }
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
  w.mat('rubber', { tint: 0x1a1a1a, uv: 'local' }); w.ov = WIRE_FLAG;
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
