import * as THREE from 'three';
import { RNG } from '../../core/rng';
import { WB, ALL, SIDES, PY, NY, PX, NX, PZ, NZ } from './geo';
import { U, NOISE_GLSL } from './mats';
import { SOI, MAIN, SW_H } from './layout';

/**
 * DRAINS & MANHOLES (ท่อระบายน้ำ / ฝาท่อ) — real 3D street drainage seated in the asphalt and sidewalks:
 *  - round cast-iron manholes on the road in a square concrete collar, sunk ~1 cm with a worn rim
 *  - square municipal covers (photo with the fish relief) flush in the footpath
 *  - slotted double covers and gutter grates (iron bars) with a real shaft below: look through and you see
 *    the dark concrete walls falling away and a glint of moving sewer water (animated, emissive-free)
 *  - steam curling out of some grates at night and after rain
 * The asphalt / footpath quads get holes cut where a drain sits (flatHoles). Positions are published as
 * game.world.drains for the critters (roaches, rats) and the water module.
 */

export type DrainKind = 'manhole' | 'grate';
export interface Drain {
  x: number; z: number; y: number;      // surface height
  kind: DrainKind;
  style: 'round' | 'square' | 'slots' | 'gutter';
  sx: number; sz: number;               // hole size (x, z) in metres
  depth: number;
  steam: boolean;
}

/** published list (filled by planDrains, read by index.ts → game.world.drains) */
export const DRAINS: Drain[] = [];

type Rect = { x0: number; z0: number; x1: number; z1: number };

/** deterministic drain layout along the soi and the main road */
export function planDrains(rng: RNG): Drain[] {
  DRAINS.length = 0;
  const add = (d: Drain) => { DRAINS.push(d); return d; };
  // soi: gutter grates on both kerbs (storm inlets), staggered
  for (let z = -8; z > -156; z -= 13 + rng.range(-2, 3)) {
    add({ x: SOI.x0 + 0.24, z, y: 0, kind: 'grate', style: 'gutter', sx: 0.36, sz: 0.96, depth: 0.75, steam: rng.chance(0.35) });
    add({ x: SOI.x1 - 0.24, z: z + 6, y: 0, kind: 'grate', style: 'gutter', sx: 0.36, sz: 0.96, depth: 0.75, steam: rng.chance(0.35) });
  }
  // soi: round manholes in the lanes
  for (let z = -12; z > -156; z -= 22 + rng.range(-4, 4)) {
    const x = rng.chance(0.5) ? rng.range(-1.8, -1.0) : rng.range(1.0, 1.8);
    add({ x, z, y: 0, kind: 'manhole', style: 'round', sx: 0.92, sz: 0.92, depth: 1.2, steam: rng.chance(0.3) });
  }
  // soi footpaths: square municipal covers + slotted drain covers near the kerb
  for (let i = 0; i < 18; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * rng.range(4.05, 4.4);
    const z = -4 - i * 8.3 + rng.range(-2, 2);
    if (z < -152) break;
    const slots = rng.chance(0.45);
    add(slots
      ? { x, z, y: SW_H, kind: 'grate', style: 'slots', sx: 0.5, sz: 0.74, depth: 0.85, steam: rng.chance(0.25) }
      : { x, z, y: SW_H, kind: 'manhole', style: 'square', sx: 0.62, sz: 0.62, depth: 0.9, steam: false });
  }
  // main road: kerb grates both sides + manholes in the lanes (away from the soi mouth / zebra)
  for (let x = -126; x < 126; x += 15 + rng.range(-2, 2)) {
    if (Math.abs(x) > 5 && Math.abs(x + 11.5) > 2.5) add({ x, z: MAIN.z0 + 0.24, y: 0, kind: 'grate', style: 'gutter', sx: 0.96, sz: 0.36, depth: 0.75, steam: rng.chance(0.25) });
    if (Math.abs(x + 4) > 2.5) add({ x: x + 7, z: MAIN.z1 - 0.24, y: 0, kind: 'grate', style: 'gutter', sx: 0.96, sz: 0.36, depth: 0.75, steam: false });
  }
  for (let x = -124; x < 124; x += 26 + rng.range(-5, 5)) {
    if (Math.abs(x + 11.5) < 3) continue;
    add({ x, z: rng.pick([9, 11.5, 17, 19.5]), y: 0, kind: 'manhole', style: 'round', sx: 0.92, sz: 0.92, depth: 1.2, steam: rng.chance(0.2) });
  }
  return DRAINS;
}

/** holes (rects) of the drains lying on a surface at height y inside the rect */
export function drainHoles(y: number, r?: Rect): Rect[] {
  const out: Rect[] = [];
  for (const d of DRAINS) {
    if (Math.abs(d.y - y) > 0.05) continue;
    const h = { x0: d.x - d.sx / 2, z0: d.z - d.sz / 2, x1: d.x + d.sx / 2, z1: d.z + d.sz / 2 };
    if (r && (h.x1 <= r.x0 || h.x0 >= r.x1 || h.z1 <= r.z0 || h.z0 >= r.z1)) continue;
    out.push(h);
  }
  return out;
}

/** rect minus holes (axis aligned) */
function subtractRects(r: Rect, holes: Rect[]): Rect[] {
  let parts = [r];
  for (const h of holes) {
    const next: Rect[] = [];
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
  return parts.filter((p) => p.x1 - p.x0 > 0.003 && p.z1 - p.z0 > 0.003);
}

/** like streets.flat() but leaves holes for drains (uses the current material) */
export function flatHoles(w: WB, x0: number, z0: number, x1: number, z1: number, y: number, seg = 10) {
  const nx = Math.max(1, Math.ceil((x1 - x0) / seg)), nz = Math.max(1, Math.ceil((z1 - z0) / seg));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const a = x0 + ((x1 - x0) * i) / nx, b = x0 + ((x1 - x0) * (i + 1)) / nx;
    const c = z0 + ((z1 - z0) * j) / nz, d = z0 + ((z1 - z0) * (j + 1)) / nz;
    const cell = { x0: a, z0: c, x1: b, z1: d };
    const holes = drainHoles(y, cell);
    for (const p of holes.length ? subtractRects(cell, holes) : [cell]) w.quad(p.x0, y, p.z1, p.x1, y, p.z1, p.x1, y, p.z0, p.x0, y, p.z0);
  }
}

/** shaft walls inside a hole: concrete getting darker with depth (3 bands) */
function shaft(w: WB, d: Drain, inset = 0) {
  const x0 = d.x - d.sx / 2 + inset, x1 = d.x + d.sx / 2 - inset, z0 = d.z - d.sz / 2 + inset, z1 = d.z + d.sz / 2 - inset;
  const bands = [[0, 0.22, 0.75], [0.22, 0.5, 0.42], [0.5, d.depth, 0.16]];
  for (const [a, b, k] of bands) {
    const ya = d.y - Math.min(b, d.depth), yb = d.y - a;
    w.mat('concrete_old', { tint: [0.55 * k + 0.05, 0.53 * k + 0.05, 0.48 * k + 0.04], ao: 0.5 + 0.5 * k, autoDirt: false, ov: 'plaster_moldy', ovAmt: 0.8, group: 'detail' });
    // inward-facing walls
    w.quad(x0, ya, z1, x0, ya, z0, x0, yb, z0, x0, yb, z1);   // west wall faces +x
    w.quad(x1, ya, z0, x1, ya, z1, x1, yb, z1, x1, yb, z0);   // east wall faces -x
    w.quad(x0, ya, z0, x1, ya, z0, x1, yb, z0, x0, yb, z0);   // north wall faces +z
    w.quad(x1, ya, z1, x0, ya, z1, x0, yb, z1, x1, yb, z1);   // south wall faces -z
  }
  // silt floor (never really visible, but closes the box)
  w.mat('mud', { tint: 0x3a3428, ao: 0.4, autoDirt: false });
  w.quad(x0, d.y - d.depth, z1, x1, d.y - d.depth, z1, x1, d.y - d.depth, z0, x0, d.y - d.depth, z0);
}

/** worn concrete collar around a cover: 4 strips sloping slightly down toward the cover */
function collar(w: WB, d: Drain, cx0: number, cz0: number, cx1: number, cz1: number, drop: number, layer = 'concrete_old', tint = 0x8a8478) {
  const x0 = d.x - d.sx / 2, x1 = d.x + d.sx / 2, z0 = d.z - d.sz / 2, z1 = d.z + d.sz / 2, y = d.y, yi = d.y - drop;
  w.mat(layer, { tint, autoDirt: false, ov: 'asphalt_cracked', ovAmt: 0.5 });
  w.quad(x0, y, z1, cx0, yi, cz1, cx0, yi, cz0, x0, y, z0);       // west strip
  w.quad(cx1, yi, cz1, x1, y, z1, x1, y, z0, cx1, yi, cz0);       // east
  w.quad(x0, y, z0, cx0, yi, cz0, cx1, yi, cz0, x1, y, z0);       // north
  w.quad(cx0, yi, cz1, x0, y, z1, x1, y, z1, cx1, yi, cz1);       // south
}

/** build all drains (call after planDrains, inside the streets build) */
export function buildDrains(w: WB, rng: RNG) {
  for (const d of DRAINS) {
    const { x, z, y } = d;
    w.setGroup('detail');
    if (d.style === 'round') {
      // square concrete collar → octagon-ish lip → round iron cover sunk 1 cm
      const r = 0.34, c = 0.4;
      collar(w, d, x - c, z - c, x + c, z + c, 0.006, 'concrete_old', 0x7c776e);
      w.mat('concrete_old', { tint: 0x6e6a62, autoDirt: false });
      const yi = y - 0.006, yc = y - 0.012;
      const N = 20;
      for (let i = 0; i < N; i++) {
        // ring between the square collar edge (approximated by its inscribed circle + corners) and the cover
        const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
        const sq = (a: number) => { const ca = Math.cos(a), sa = Math.sin(a); const k = c / Math.max(Math.abs(ca), Math.abs(sa)); return [x + ca * k, z + sa * k]; };
        const p0 = sq(a0), p1 = sq(a1);
        w.quad(x + Math.cos(a0) * r, yc, z + Math.sin(a0) * r, x + Math.cos(a1) * r, yc, z + Math.sin(a1) * r, p1[0], yi, p1[1], p0[0], yi, p0[1]);
      }
      // the cover itself (photo disc), uv maps the circle of the photo
      w.mat('drain_round', { autoDirt: false, uv: 'face' });
      const uvs = (px: number, pz: number) => [0.5 + (px - x) / (2 * r) * 0.985, 0.5 - (pz - z) / (2 * r) * 0.985];
      const poly: [number, number][] = [];
      for (let i = 0; i < N; i++) { const a = -(i / N) * Math.PI * 2; poly.push([x + Math.cos(a) * r, z + Math.sin(a) * r]); }
      for (let i = 1; i < N - 1; i++) {
        const A = poly[0], B = poly[i], C = poly[i + 1];
        const ua = uvs(A[0], A[1]), ub = uvs(B[0], B[1]), uc = uvs(C[0], C[1]);
        triUV(w, A[0], yc, A[1], B[0], yc, B[1], C[0], yc, C[1], ua, ub, uc);
      }
    } else if (d.style === 'square') {
      // municipal square cover in a steel frame, flush with the footpath tiles (2 mm proud frame)
      const fx = d.sx / 2, fz = d.sz / 2, ci = 0.035;
      w.mat('steel_rust', { autoDirt: false, uv: 'local' });
      w.box(x - fx, y - 0.02, z - fz, x + fx, y + 0.002, z - fz + ci, PY | PZ);
      w.box(x - fx, y - 0.02, z + fz - ci, x + fx, y + 0.002, z + fz, PY | NZ);
      w.box(x - fx, y - 0.02, z - fz + ci, x - fx + ci, y + 0.002, z + fz - ci, PY | PX);
      w.box(x + fx - ci, y - 0.02, z - fz + ci, x + fx, y + 0.002, z + fz - ci, PY | NX);
      w.mat('drain_square', { autoDirt: false, uv: 'face' });
      const u = rng.chance(0.5) ? [0, 0, 1, 1] : [1, 1, 0, 0];   // 0° / 180° (never mirrored: Thai text on the lid)
      w.quad(x - fx + ci, y - 0.004, z + fz - ci, x + fx - ci, y - 0.004, z + fz - ci, x + fx - ci, y - 0.004, z - fz + ci, x - fx + ci, y - 0.004, z - fz + ci, u);
    } else if (d.style === 'slots') {
      // slotted double cover over an open shaft (alpha-cut slots)
      shaft(w, d, 0.04);
      const fx = d.sx / 2, fz = d.sz / 2, ci = 0.04;
      w.mat('concrete_old', { tint: 0x9a948a, autoDirt: false });
      w.box(x - fx, y - 0.05, z - fz, x + fx, y + 0.003, z - fz + ci, PY | PZ);
      w.box(x - fx, y - 0.05, z + fz - ci, x + fx, y + 0.003, z + fz, PY | NZ);
      w.box(x - fx, y - 0.05, z - fz + ci, x - fx + ci, y + 0.003, z + fz - ci, PY | PX);
      w.box(x + fx - ci, y - 0.05, z - fz + ci, x + fx, y + 0.003, z + fz - ci, PY | NX);
      w.cut('drain_slots', { autoDirt: false, uv: 'face' });
      w.quad(x - fx + ci, y - 0.003, z + fz - ci, x + fx - ci, y - 0.003, z + fz - ci, x + fx - ci, y - 0.003, z - fz + ci, x - fx + ci, y - 0.003, z - fz + ci, [0, 0, 1, 1]);
      // thickness of the cast lid (seen through the slots at an angle)
      w.mat('steel_rust', { autoDirt: false, uv: 'local', ao: 0.6 });
      w.box(x - fx + ci, y - 0.035, z - fz + ci, x + fx - ci, y - 0.031, z + fz - ci, NY);
    } else {
      // gutter grate: iron frame + cast bars across the flow, open shaft below
      shaft(w, d, 0);
      const alongZ = d.sz > d.sx;
      const L = alongZ ? d.sz : d.sx, Wd = alongZ ? d.sx : d.sz;
      w.mat('steel_rust', { autoDirt: false, uv: 'local', ov: 'grate_iron', ovAmt: 0.6 });
      const yT = y - 0.006, yB = y - 0.05;
      const bar = (a0: number, a1: number, b0: number, b1: number, faces = ALL & ~NY) => {
        if (alongZ) w.box(x + b0, yB, z + a0, x + b1, yT, z + a1, faces); else w.box(x + a0, yB, z + b0, x + a1, yT, z + b1, faces);
      };
      // frame
      bar(-L / 2, L / 2, -Wd / 2, -Wd / 2 + 0.03);
      bar(-L / 2, L / 2, Wd / 2 - 0.03, Wd / 2);
      bar(-L / 2, -L / 2 + 0.03, -Wd / 2, Wd / 2);
      bar(L / 2 - 0.03, L / 2, -Wd / 2, Wd / 2);
      // bars across, a stiffener along
      for (let a = -L / 2 + 0.06; a < L / 2 - 0.04; a += 0.055) bar(a, a + 0.022, -Wd / 2 + 0.03, Wd / 2 - 0.03);
      bar(-L / 2, L / 2, -0.012, 0.012, PY);
      // kerb inlet mouth: a dark slot in the kerb face beside road grates
      if (y < 0.05) {
        const toKerb = Math.abs(x - SOI.x0) < 0.5 ? -1 : Math.abs(x - SOI.x1) < 0.5 ? 1 : 0;
        w.mat('rubber', { tint: 0x050505, ao: 0.3, autoDirt: false });
        if (toKerb !== 0) {
          const kx = toKerb < 0 ? SOI.x0 + 0.004 : SOI.x1 - 0.004;
          if (toKerb < 0) w.quad(kx, 0.01, z + 0.42, kx, 0.01, z - 0.42, kx, 0.1, z - 0.42, kx, 0.1, z + 0.42);
          else w.quad(kx, 0.01, z - 0.42, kx, 0.01, z + 0.42, kx, 0.1, z + 0.42, kx, 0.1, z - 0.42);
          w.mat('steel_rust', { autoDirt: false, uv: 'local' });
          w.box(kx - 0.02, 0.1, z - 0.45, kx + 0.02, 0.125, z + 0.45, ALL & ~NY);
        } else {
          const kz = Math.abs(z - MAIN.z0) < 0.5 ? MAIN.z0 + 0.004 : MAIN.z1 - 0.004;
          const nz = Math.abs(z - MAIN.z0) < 0.5 ? 1 : -1;
          if (nz > 0) w.quad(x - 0.42, 0.01, kz, x + 0.42, 0.01, kz, x + 0.42, 0.1, kz, x - 0.42, 0.1, kz);
          else w.quad(x + 0.42, 0.01, kz, x - 0.42, 0.01, kz, x - 0.42, 0.1, kz, x + 0.42, 0.1, kz);
        }
      }
    }
  }
  w.setGroup('base');
}

/** explicit-uv triangle (degenerate quad) for texture-array layers */
function triUV(w: WB, ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, ua: number[], ub: number[], uc: number[]) {
  w.quad(ax, ay, az, bx, by, bz, cx, cy, cz, cx, cy, cz, [0, 0, 1, 1]);
  // patch the 4 uvs of the quad just written (quad() only takes an axis-aligned uv rect)
  const B = w.lastBuf!; const o = B.nv - 4;
  B.uv[o * 2] = ua[0]; B.uv[o * 2 + 1] = ua[1];
  B.uv[o * 2 + 2] = ub[0]; B.uv[o * 2 + 3] = ub[1];
  B.uv[o * 2 + 4] = uc[0]; B.uv[o * 2 + 5] = uc[1];
  B.uv[o * 2 + 6] = uc[0]; B.uv[o * 2 + 7] = uc[1];
}

// ------------------------------------------------------------------ sewer water + steam (one mesh each)

const WATER_GLSL = /* glsl */`
float swH(vec2 p, float t) {
  return wNoise(vec3(p * 6.0 + vec2(t * 0.35, t * 0.11), t * 0.2)) * 0.6 + wNoise(vec3(p * 17.0 - vec2(t * 0.6, -t * 0.25), t * 0.4)) * 0.4;
}`;

/** dark, slowly flowing sewer water at the bottom of every open shaft */
export function makeSewerWater(): THREE.Mesh | null {
  const open = DRAINS.filter((d) => d.style === 'gutter' || d.style === 'slots');
  if (!open.length) return null;
  const pos: number[] = [], idx: number[] = [];
  for (const d of open) {
    const yw = d.y - d.depth + 0.18;
    const x0 = d.x - d.sx / 2, x1 = d.x + d.sx / 2, z0 = d.z - d.sz / 2, z1 = d.z + d.sz / 2;
    const b = pos.length / 3;
    pos.push(x0, yw, z1, x1, yw, z1, x1, yw, z0, x0, yw, z0);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const m = new THREE.MeshStandardMaterial({ color: 0x15170f, roughness: 0.06, metalness: 0, envMapIntensity: 0.55 });
  m.name = 'sewer-water';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = U.uTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
varying vec3 vSwW;`).replace('#include <fog_vertex>', `#include <fog_vertex>
vSwW = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform float uTime; varying vec3 vSwW;
${NOISE_GLSL}
${WATER_GLSL}`).replace('#include <color_fragment>', `#include <color_fragment>
float scum = smoothstep(0.55, 0.8, wNoise(vec3(vSwW.xz * 9.0 + vec2(uTime * 0.12, 0.0), 2.0)));
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.09, 0.09, 0.06), scum * 0.6);`)
      .replace('#include <normal_fragment_maps>', `{
  float e = 0.02;
  float h0 = swH(vSwW.xz, uTime), hx = swH(vSwW.xz + vec2(e, 0.0), uTime), hz = swH(vSwW.xz + vec2(0.0, e), uTime);
  vec3 nW = normalize(vec3(-(hx - h0) / e * 0.025, 1.0, -(hz - h0) / e * 0.025));
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
}`);
  };
  m.customProgramCacheKey = () => 'sewer-water-v1';
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'sewer-water';
  mesh.matrixAutoUpdate = false;
  mesh.receiveShadow = false;
  return mesh;
}

const STEAM_VERT = /* glsl */`
#include <fog_pars_vertex>
attribute vec4 aSeed; attribute vec2 aCorner;
uniform float uTime; uniform float uSteam; uniform vec3 uCam;
varying vec2 vC; varying float vA; varying float vS;
void main() {
  float life = fract(uTime * (0.16 + aSeed.y * 0.08) + aSeed.x);
  vec3 c = position;
  c.y += life * (1.6 + aSeed.z);
  c.x += sin(uTime * 0.7 + aSeed.w * 6.28 + life * 3.0) * 0.18 * life + life * 0.25;
  c.z += cos(uTime * 0.5 + aSeed.w * 4.0) * 0.12 * life;
  float sz = 0.25 + life * 0.9;
  vec4 mv = viewMatrix * vec4(c, 1.0);
  mv.xy += aCorner * sz;
  vC = aCorner; vS = aSeed.w;
  float dist = length(uCam - c);
  vA = uSteam * smoothstep(0.0, 0.15, life) * (1.0 - life) * smoothstep(60.0, 25.0, dist);
  gl_Position = projectionMatrix * mv;
  vec4 mvPosition = mv;
  #include <fog_vertex>
}`;
const STEAM_FRAG = /* glsl */`
#include <fog_pars_fragment>
uniform float uTime; uniform vec3 uCol;
varying vec2 vC; varying float vA; varying float vS;
${NOISE_GLSL}
void main() {
  float r = length(vC);
  if (r > 1.0 || vA < 0.002) discard;
  float n = wFbm(vec3(vC * 1.7 + vS * 10.0, uTime * 0.25 + vS * 3.0));
  float a = smoothstep(1.0, 0.1, r) * smoothstep(0.25, 0.75, n) * vA * 0.32;
  gl_FragColor = vec4(uCol, a);
  #include <fog_fragment>
}`;

export class DrainSteam {
  mesh: THREE.Mesh | null = null;
  private mat: THREE.ShaderMaterial | null = null;
  constructor() {
    const src = DRAINS.filter((d) => d.steam);
    if (!src.length) return;
    const P = 7;
    const n = src.length * P;
    const pos = new Float32Array(n * 4 * 3), seed = new Float32Array(n * 4 * 4), corner = new Float32Array(n * 4 * 2), idx: number[] = [];
    const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    let q = 0;
    for (const d of src) for (let i = 0; i < P; i++, q++) {
      const s = [i / P + Math.random() * 0.1, Math.random(), Math.random() * 0.8, Math.random()];
      for (let k = 0; k < 4; k++) {
        const v = q * 4 + k;
        pos.set([d.x + (Math.random() - 0.5) * d.sx * 0.6, d.y - 0.05, d.z + (Math.random() - 0.5) * d.sz * 0.6], v * 3);
        seed.set(s, v * 4); corner.set(cs[k], v * 2);
      }
      idx.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -60), 400);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: STEAM_VERT, fragmentShader: STEAM_FRAG, transparent: true, depthWrite: false, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uSteam: { value: 0 }, uCol: { value: new THREE.Color(0.6, 0.6, 0.58) }, uCam: { value: new THREE.Vector3() } }]),
    });
    this.mat.uniforms.uTime = U.uTime;
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.name = 'drain-steam';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
  }
  /** night & rain bring the steam out; colour follows the ambient light */
  update(cam: THREE.Vector3, night: number, rain: number, ambient: THREE.Color) {
    if (!this.mat || !this.mesh) return;
    const k = Math.min(1, night * 0.85 + rain * 1.2);
    this.mesh.visible = k > 0.01;
    this.mat.uniforms.uSteam.value = k;
    this.mat.uniforms.uCam.value.copy(cam);
    this.mat.uniforms.uCol.value.copy(ambient).multiplyScalar(0.9).addScalar(0.05 + 0.1 * night);
  }
}

// ------------------------------------------------------------------ hooks for index.ts

let steam: DrainSteam | null = null;
/** add the sewer water + steam meshes to the world root (call once after the streets are built) */
export function installDrainFx(root: THREE.Object3D) {
  const water = makeSewerWater();
  if (water) root.add(water);
  steam = new DrainSteam();
  if (steam.mesh) root.add(steam.mesh);
}
/** per frame */
export function drainsFrame(cam: THREE.Vector3, night: number, rain: number, ambient: THREE.Color) { steam?.update(cam, night, rain, ambient); }
/** the public list for game.world.drains */
export function publicDrains(): { p: [number, number, number]; kind: DrainKind }[] {
  return DRAINS.map((d) => ({ p: [Math.round(d.x * 100) / 100, d.y, Math.round(d.z * 100) / 100] as [number, number, number], kind: d.kind }));
}

void SIDES; void PZ; void NZ;
