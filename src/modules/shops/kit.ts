import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/* ============================================================================================
 * Fixture kit — real-looking shop furniture parts (no raw boxes): bevelled boxes with metre UVs, round
 * tubes between two points, pillow-shaped snack bags / cups / cartons whose fronts are cells of the painted
 * package atlas (packs.ts: each pack its own fictional product), merged into one draw call.
 * ========================================================================================== */

/** Re-project UVs by the dominant normal axis, in metres / tile (keeps PBR texel density on any shape). */
export function metreUV(g: THREE.BufferGeometry, tile = 1) {
  const n = g.getAttribute('normal'), p = g.getAttribute('position');
  let uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv) { uv = new THREE.BufferAttribute(new Float32Array(p.count * 2), 2); g.setAttribute('uv', uv); }
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (ay >= ax && ay >= az) uv.setXY(i, x / tile, z / tile);
    else if (ax >= az) uv.setXY(i, z / tile, y / tile);
    else uv.setXY(i, x / tile, y / tile);
  }
  uv.needsUpdate = true;
  return g;
}

/** Bevelled box, origin at the bottom centre, UVs in metres / tile. */
export function rbox(w: number, h: number, d: number, r = 0.01, tile = 1, seg = 2) {
  const rr = Math.max(0.0005, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  const g = new RoundedBoxGeometry(w, h, d, seg, rr);
  metreUV(g, tile);
  return g.translate(0, h / 2, 0);
}

/** Round tube (bar / leg / rail) from a to b. */
export function tube(a: [number, number, number], b: [number, number, number], r: number, sides = 8) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(r, r, len, sides, 1, false);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  g.applyQuaternion(q).translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}

/** Turned profile (lathe) from [radius, y] pairs. */
export function lathe(pts: [number, number][], seg = 16) {
  return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), seg);
}

export interface PackRowOpts {
  /** photo region of this shelf row, uv (0..1, v up) */
  u0: number; u1: number; v0: number; v1: number;
  /** pack count and size */
  n: number; w: number; h: number; d: number;
  /** 'bag' = pillow snack bag, 'box' = carton, 'cup' = cup noodle / tub, 'bottle' handled elsewhere */
  shape: 'bag' | 'box' | 'cup';
  /** row origin (left end, bottom, front face z) in the shelf's local frame */
  x0: number; y: number; z: number;
  gap?: number;
  /** deterministic variation */
  seed?: number;
  /** extra rows of packs behind the front one (depth, using the same faces) */
  deep?: number;
  /** per-pack uv cell [u0,u1,v0,v1] (package atlas, packs.ts) — overrides the photo-slice uvs */
  cellUV?: (i: number) => [number, number, number, number];
}

function rnd(s: number) { const x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

/**
 * One shelf row of products. Each pack's FRONT is a different slice of the shelf photo (so every pack reads
 * as its own real product), the sides take the slice's edge colours. Returns a geometry in the shelf frame.
 */
export function packRow(o: PackRowOpts): THREE.BufferGeometry {
  const gs: THREE.BufferGeometry[] = [];
  const gap = o.gap ?? 0.006;
  const du = (o.u1 - o.u0) / o.n;
  const seed = o.seed ?? 1;
  for (let i = 0; i < o.n; i++) {
    let pu0 = o.u0 + du * i + du * 0.04, pu1 = o.u0 + du * (i + 1) - du * 0.04, pv0 = o.v0, pv1 = o.v1;
    if (o.cellUV) [pu0, pu1, pv0, pv1] = o.cellUV(i);
    for (let k = 0; k <= (o.deep ?? 0); k++) {
      const jx = (rnd(seed + i * 7.1 + k) - 0.5) * 0.008, jz = (rnd(seed + i * 3.3 + k * 2) - 0.5) * 0.01;
      const tilt = (rnd(seed + i * 5.7 + k) - 0.5) * (o.shape === 'bag' ? 0.12 : 0.04);
      const g = o.shape === 'cup' ? cupGeo(o.w, o.h, pu0, pu1, pv0, pv1) : packGeo(o.w, o.h, o.d, o.shape === 'bag', pu0, pu1, pv0, pv1);
      g.rotateZ(tilt * 0.3).rotateY(tilt);
      g.translate(o.x0 + (o.w + gap) * i + o.w / 2 + jx, o.y, o.z - o.d / 2 - k * (o.d + 0.004) + jz);
      gs.push(g);
    }
  }
  return mergeGeometries(gs, false)!;
}

/** pillow bag or carton, origin bottom centre, front = +z, UV front = the photo slice */
function packGeo(w: number, h: number, d: number, bag: boolean, u0: number, u1: number, v0: number, v1: number) {
  const g = new THREE.BoxGeometry(w, h, d, bag ? 6 : 1, bag ? 8 : 1, 1);
  const p = g.getAttribute('position') as THREE.BufferAttribute, n = g.getAttribute('normal') as THREE.BufferAttribute, uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const nx = x / (w / 2), ny = y / (h / 2);
    const nz = n.getZ(i), nX = n.getX(i), nY = n.getY(i);
    // UVs: front shows the slice, back a mirrored slice, sides / top stretch the slice's edges
    const fu = u0 + (nx * 0.5 + 0.5) * (u1 - u0), fv = v0 + (ny * 0.5 + 0.5) * (v1 - v0);
    if (nz > 0.5) uv.setXY(i, fu, fv);
    else if (nz < -0.5) uv.setXY(i, u1 - (fu - u0), fv);
    else if (Math.abs(nX) > 0.5) uv.setXY(i, nX > 0 ? u1 - 0.002 : u0 + 0.002, fv);
    else uv.setXY(i, fu, nY > 0 ? v1 - 0.002 : v0 + 0.002);
    if (bag) {
      // pillow: bulges in the middle, crimped flat at the top and bottom seals
      const bx = 1 - Math.pow(Math.abs(nx), 4), by = 1 - Math.pow(Math.abs(ny), 3);
      const seal = Math.abs(ny) > 0.86 ? 0.12 : 1;
      p.setZ(i, Math.sign(z) * (d / 2) * Math.max(0.08, bx * by) * seal);
      p.setX(i, x * (1 - 0.06 * (1 - Math.abs(ny))));
    }
  }
  g.computeVertexNormals();
  return g.translate(0, h / 2, 0);
}

/** cup noodle / tub: tapered cylinder, front half shows the slice */
function cupGeo(w: number, h: number, u0: number, u1: number, v0: number, v1: number) {
  const seg = 14;
  const g = new THREE.CylinderGeometry(w / 2, w * 0.38, h, seg, 1, false);
  const p = g.getAttribute('position') as THREE.BufferAttribute, uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(x, z);                         // 0 = facing +z
    const t = Math.max(0, Math.min(1, a / Math.PI * 0.9 + 0.5));
    const top = y > h / 2 - 1e-4 && Math.abs(x) + Math.abs(z) < w * 0.01;
    uv.setXY(i, u0 + t * (u1 - u0), top ? v1 - 0.01 : v0 + (y / h + 0.5) * (v1 - v0));
  }
  return g.translate(0, h / 2, 0);
}

/** Price-tag rail along a shelf front edge (rounded PVC strip). */
export function tagRail(len: number, h = 0.035) { return rbox(len, h, 0.008, 0.003, 1, 1); }

/** merge helper that tolerates mixed index / attribute sets */
export function mergeLoose(gs: THREE.BufferGeometry[]) {
  const norm = gs.map((g) => {
    const x = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(k)) x.deleteAttribute(k);
    if (!x.getAttribute('uv')) x.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(x.getAttribute('position').count * 2), 2));
    return x;
  });
  return mergeGeometries(norm, false)!;
}
