import * as THREE from 'three';
import { lifeTex } from './tex';

/* ============================================================================================
 * Low-poly, PHOTO-TEXTURED Thai vehicles (models face -Z, origin at ground centre).
 *  - box cars (taxi, pickup, songthaew, bus, junk truck): lofted side profile; sides use the
 *    rectified side photo (planar projection), front/rear use front/rear photo crops — one
 *    1024² atlas per type: side = top half, front = bottom-left, rear = bottom-right.
 *  - motorbikes / tuk-tuks: alpha cut-out side photos on twin planes + a solid core.
 * Atlases live in public/assets/gen/life/tex/veh_<id>.jpg|png (credits: references/credits/life.md).
 * ========================================================================================== */

export type VKind = 'moto' | 'tuktuk' | 'car' | 'pickup' | 'songthaew' | 'bus' | 'icecream' | 'junk';

export interface VDef {
  id: string;
  kind: VKind;
  name: string;
  len: number; wid: number; hgt: number;
  /** wheel centres along z (local, -Z = front) & radius; x offset (half track) */
  wheels: { z: number; r: number; x: number }[];
  speed: [number, number];
  engine: string;   // logical sound
  horn: string;
  /** headlight / taillight local positions */
  head: [number, number, number][];
  tail: [number, number, number][];
  rider?: boolean;
  weight: number;   // spawn weight on the main road
  soi?: number;     // spawn weight in the soi
}

/** cross-section of a box car at z: bottom, belt line, roof; half widths at belt and roof */
interface Sec { z: number; y0: number; y1: number; y2: number; w1: number; w2: number }

export const VDEFS: Record<string, VDef> = {
  moto_red: { id: 'moto_red', kind: 'moto', name: 'Honda Wave', len: 1.9, wid: 0.7, hgt: 1.08, wheels: [{ z: -0.64, r: 0.3, x: 0 }, { z: 0.6, r: 0.3, x: 0 }], speed: [8, 13], engine: 'moto_idle', horn: 'moto_horn', head: [[0, 0.92, -0.86]], tail: [[0, 0.82, 0.92]], rider: true, weight: 9, soi: 6 },
  moto_blue: { id: 'moto_blue', kind: 'moto', name: 'scooter', len: 1.85, wid: 0.7, hgt: 1.1, wheels: [{ z: -0.62, r: 0.28, x: 0 }, { z: 0.6, r: 0.28, x: 0 }], speed: [8, 12], engine: 'moto_idle', horn: 'moto_horn', head: [[0, 0.95, -0.84]], tail: [[0, 0.85, 0.9]], rider: true, weight: 7, soi: 5 },
  tuktuk: { id: 'tuktuk', kind: 'tuktuk', name: 'ตุ๊กตุ๊ก', len: 2.75, wid: 1.32, hgt: 1.78, wheels: [{ z: -1.02, r: 0.26, x: 0 }, { z: 0.78, r: 0.27, x: 0.58 }], speed: [7, 10], engine: 'tuktuk', horn: 'car_horn', head: [[0, 0.95, -1.3]], tail: [[0.5, 0.6, 1.36], [-0.5, 0.6, 1.36]], rider: true, weight: 3, soi: 0.6 },
  taxi_pink: { id: 'taxi_pink', kind: 'car', name: 'แท็กซี่สีชมพู', len: 4.55, wid: 1.76, hgt: 1.5, wheels: [{ z: -1.38, r: 0.31, x: 0.76 }, { z: 1.32, r: 0.31, x: 0.76 }], speed: [9, 14], engine: 'car_engine', horn: 'car_horn', head: [[0.6, 0.72, -2.26], [-0.6, 0.72, -2.26]], tail: [[0.66, 0.85, 2.26], [-0.66, 0.85, 2.26]], weight: 4, soi: 0.3 },
  taxi_gy: { id: 'taxi_gy', kind: 'car', name: 'แท็กซี่เขียวเหลือง', len: 4.55, wid: 1.76, hgt: 1.5, wheels: [{ z: -1.38, r: 0.31, x: 0.76 }, { z: 1.32, r: 0.31, x: 0.76 }], speed: [9, 14], engine: 'car_engine', horn: 'car_horn', head: [[0.6, 0.72, -2.26], [-0.6, 0.72, -2.26]], tail: [[0.66, 0.85, 2.26], [-0.66, 0.85, 2.26]], weight: 3, soi: 0.3 },
  pickup: { id: 'pickup', kind: 'pickup', name: 'กระบะ', len: 5.1, wid: 1.82, hgt: 1.78, wheels: [{ z: -1.62, r: 0.36, x: 0.78 }, { z: 1.42, r: 0.36, x: 0.78 }], speed: [8, 13], engine: 'diesel', horn: 'truck_horn', head: [[0.66, 0.92, -2.52], [-0.66, 0.92, -2.52]], tail: [[0.8, 0.95, 2.54], [-0.8, 0.95, 2.54]], weight: 4, soi: 0.6 },
  songthaew: { id: 'songthaew', kind: 'songthaew', name: 'สองแถว', len: 5.0, wid: 1.82, hgt: 2.3, wheels: [{ z: -1.6, r: 0.36, x: 0.78 }, { z: 1.4, r: 0.36, x: 0.78 }], speed: [7, 11], engine: 'diesel', horn: 'truck_horn', head: [[0.66, 0.92, -2.48], [-0.66, 0.92, -2.48]], tail: [[0.8, 0.95, 2.5], [-0.8, 0.95, 2.5]], weight: 2.5, soi: 0.4 },
  bus_red: { id: 'bus_red', kind: 'bus', name: 'รถเมล์ ขสมก.', len: 10.6, wid: 2.5, hgt: 3.15, wheels: [{ z: -3.3, r: 0.5, x: 1.05 }, { z: 3.0, r: 0.5, x: 1.05 }], speed: [6, 10], engine: 'bus_engine', horn: 'truck_horn', head: [[0.95, 0.85, -5.3], [-0.95, 0.85, -5.3]], tail: [[1.05, 1.0, 5.32], [-1.05, 1.0, 5.32]], weight: 1.4 },
  icecream: { id: 'icecream', kind: 'icecream', name: 'ไอติม', len: 2.2, wid: 1.45, hgt: 1.5, wheels: [{ z: -0.66, r: 0.28, x: 0 }, { z: 0.6, r: 0.28, x: 0 }], speed: [3, 3.6], engine: 'moto_idle', horn: 'icecream_bell', head: [[0, 0.95, -0.86]], tail: [[0, 0.82, 0.92]], rider: true, weight: 0 },
  junk: { id: 'junk', kind: 'junk', name: 'รถรับซื้อของเก่า', len: 4.4, wid: 1.66, hgt: 2.15, wheels: [{ z: -1.32, r: 0.33, x: 0.7 }, { z: 1.25, r: 0.33, x: 0.7 }], speed: [3, 3.8], engine: 'diesel', horn: 'junk_speaker', head: [[0.6, 0.9, -2.18], [-0.6, 0.9, -2.18]], tail: [[0.72, 0.9, 2.2], [-0.72, 0.9, 2.2]], weight: 0 },
};

const PROFILES: Record<string, Sec[]> = {
  car: [
    { z: -2.27, y0: 0.32, y1: 0.66, y2: 0.7, w1: 0.82, w2: 0.78 },
    { z: -2.1, y0: 0.24, y1: 0.8, y2: 0.86, w1: 0.86, w2: 0.82 },
    { z: -1.0, y0: 0.24, y1: 0.88, y2: 0.94, w1: 0.88, w2: 0.84 },
    { z: -0.62, y0: 0.24, y1: 0.92, y2: 1.38, w1: 0.88, w2: 0.68 },
    { z: 0.0, y0: 0.24, y1: 0.93, y2: 1.47, w1: 0.88, w2: 0.68 },
    { z: 0.95, y0: 0.24, y1: 0.95, y2: 1.43, w1: 0.88, w2: 0.68 },
    { z: 1.55, y0: 0.26, y1: 0.98, y2: 1.03, w1: 0.87, w2: 0.82 },
    { z: 2.27, y0: 0.36, y1: 0.98, y2: 1.02, w1: 0.84, w2: 0.8 },
  ],
  pickup: [
    { z: -2.55, y0: 0.42, y1: 0.86, y2: 0.92, w1: 0.86, w2: 0.82 },
    { z: -2.3, y0: 0.34, y1: 1.0, y2: 1.05, w1: 0.9, w2: 0.86 },
    { z: -1.2, y0: 0.34, y1: 1.06, y2: 1.12, w1: 0.91, w2: 0.88 },
    { z: -0.75, y0: 0.34, y1: 1.08, y2: 1.72, w1: 0.91, w2: 0.72 },
    { z: 0.25, y0: 0.34, y1: 1.08, y2: 1.76, w1: 0.91, w2: 0.72 },
    { z: 0.42, y0: 0.34, y1: 1.08, y2: 1.12, w1: 0.91, w2: 0.9 },
    { z: 2.55, y0: 0.38, y1: 1.08, y2: 1.12, w1: 0.91, w2: 0.9 },
  ],
  songthaew: [
    { z: -2.5, y0: 0.42, y1: 0.86, y2: 0.92, w1: 0.86, w2: 0.82 },
    { z: -2.25, y0: 0.34, y1: 1.0, y2: 1.05, w1: 0.9, w2: 0.86 },
    { z: -1.15, y0: 0.34, y1: 1.06, y2: 1.12, w1: 0.91, w2: 0.88 },
    { z: -0.7, y0: 0.34, y1: 1.08, y2: 1.72, w1: 0.91, w2: 0.72 },
    { z: 0.2, y0: 0.34, y1: 1.08, y2: 2.25, w1: 0.91, w2: 0.9 },
    { z: 2.5, y0: 0.38, y1: 1.08, y2: 2.25, w1: 0.91, w2: 0.9 },
  ],
  bus: [
    { z: -5.32, y0: 0.42, y1: 1.2, y2: 3.0, w1: 1.24, w2: 1.2 },
    { z: -5.2, y0: 0.36, y1: 1.2, y2: 3.12, w1: 1.25, w2: 1.23 },
    { z: 5.2, y0: 0.36, y1: 1.2, y2: 3.12, w1: 1.25, w2: 1.23 },
    { z: 5.32, y0: 0.42, y1: 1.2, y2: 3.0, w1: 1.24, w2: 1.2 },
  ],
  junk: [
    { z: -2.2, y0: 0.42, y1: 0.84, y2: 0.9, w1: 0.8, w2: 0.76 },
    { z: -2.0, y0: 0.34, y1: 0.96, y2: 1.0, w1: 0.83, w2: 0.8 },
    { z: -1.1, y0: 0.34, y1: 1.0, y2: 1.06, w1: 0.83, w2: 0.82 },
    { z: -0.7, y0: 0.34, y1: 1.02, y2: 1.62, w1: 0.83, w2: 0.68 },
    { z: 0.15, y0: 0.34, y1: 1.02, y2: 1.66, w1: 0.83, w2: 0.68 },
    { z: 0.3, y0: 0.34, y1: 1.02, y2: 1.06, w1: 0.83, w2: 0.82 },
    { z: 2.2, y0: 0.38, y1: 1.02, y2: 1.06, w1: 0.83, w2: 0.82 },
  ],
};

/** Atlas regions (u0,v0,u1,v1) in uv space (v up). */
const R_SIDE = [0, 0.5, 1, 1], R_FRONT = [0, 0, 0.5, 0.5], R_REAR = [0.5, 0, 1, 0.5];

/** Loft a box-car body from sections; UVs: sides → side photo (planar z/y), caps → front/rear. */
export function loftBody(secs: Sec[], len: number, hgt: number): THREE.BufferGeometry {
  const P: number[] = [], UV: number[] = [], I: number[] = [];
  const z0 = secs[0].z, z1 = secs[secs.length - 1].z;
  const su = (z: number, _side: number) => { const t = (z - z0) / (z1 - z0); return R_SIDE[0] + t * (R_SIDE[2] - R_SIDE[0]); };
  const sv = (y: number) => R_SIDE[1] + (y / hgt) * (R_SIDE[3] - R_SIDE[1]);
  const v = (x: number, y: number, z: number, u: number, vv: number) => { P.push(x, y, z); UV.push(u, vv); return P.length / 3 - 1; };
  const quad = (a: number, b: number, c: number, d: number) => I.push(a, b, c, a, c, d);
  // per section ring: [left bottom, left belt, left roof, right roof, right belt, right bottom]
  for (let i = 0; i < secs.length - 1; i++) {
    const A = secs[i], B = secs[i + 1];
    for (const side of [1, -1]) {
      // lower side (bottom → belt)
      let a = v(side * A.w1, A.y0, A.z, su(A.z, side), sv(A.y0)), b = v(side * B.w1, B.y0, B.z, su(B.z, side), sv(B.y0));
      let c = v(side * B.w1, B.y1, B.z, su(B.z, side), sv(B.y1)), d = v(side * A.w1, A.y1, A.z, su(A.z, side), sv(A.y1));
      side > 0 ? quad(a, d, c, b) : quad(a, b, c, d);
      // upper side (belt → roof, tapered = glasshouse)
      a = v(side * A.w1, A.y1, A.z, su(A.z, side), sv(A.y1)); b = v(side * B.w1, B.y1, B.z, su(B.z, side), sv(B.y1));
      c = v(side * B.w2, B.y2, B.z, su(B.z, side), sv(B.y2)); d = v(side * A.w2, A.y2, A.z, su(A.z, side), sv(A.y2));
      side > 0 ? quad(a, d, c, b) : quad(a, b, c, d);
    }
    // roof (sample the side photo's roof strip)
    const rv = sv(Math.max(A.y2, B.y2)) - 0.004;
    const a = v(A.w2, A.y2, A.z, 0.3, rv), b = v(B.w2, B.y2, B.z, 0.7, rv), c = v(-B.w2, B.y2, B.z, 0.7, rv - 0.002), d = v(-A.w2, A.y2, A.z, 0.3, rv - 0.002);
    quad(a, d, c, b);
    // underside (dark)
    const e = v(A.w1, A.y0, A.z, 0.5, R_SIDE[1] + 0.003), f = v(-A.w1, A.y0, A.z, 0.5, R_SIDE[1] + 0.003), g = v(-B.w1, B.y0, B.z, 0.5, R_SIDE[1] + 0.003), h = v(B.w1, B.y0, B.z, 0.5, R_SIDE[1] + 0.003);
    quad(e, h, g, f);
  }
  // front & rear caps (planar x/y into the front / rear regions)
  const cap = (S: Sec, reg: number[], flip: boolean) => {
    const W = S.w1, H = hgt;
    const cu = (x: number) => reg[0] + ((flip ? -x : x) / (2 * W) + 0.5) * (reg[2] - reg[0]);
    const cv = (y: number) => reg[1] + (y / H) * (reg[3] - reg[1]);
    const lb = v(S.w1, S.y0, S.z, cu(S.w1), cv(S.y0)), lm = v(S.w1, S.y1, S.z, cu(S.w1), cv(S.y1)), lt = v(S.w2, S.y2, S.z, cu(S.w2), cv(S.y2));
    const rt = v(-S.w2, S.y2, S.z, cu(-S.w2), cv(S.y2)), rm = v(-S.w1, S.y1, S.z, cu(-S.w1), cv(S.y1)), rb = v(-S.w1, S.y0, S.z, cu(-S.w1), cv(S.y0));
    if (flip) { quad(lb, rb, rm, lm); quad(lm, rm, rt, lt); } else { quad(lb, lm, rm, rb); quad(lm, lt, rt, rm); }
  };
  cap(secs[0], R_FRONT, true);
  cap(secs[secs.length - 1], R_REAR, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setIndex(I);
  g.computeVertexNormals();
  return g;
}

function boxGeo(w: number, h: number, d: number, x: number, y: number, z: number, uvRect?: number[]) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  if (uvRect) {
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uvRect[0] + uv.getX(i) * (uvRect[2] - uvRect[0]), uvRect[1] + uv.getY(i) * (uvRect[3] - uvRect[1]));
  }
  return g;
}

function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // minimal merge (position/uv/normal + index)
  const P: number[] = [], N: number[] = [], UV: number[] = [], I: number[] = [];
  let off = 0;
  for (const g0 of geos) {
    const g = g0.index ? g0 : g0;
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) { P.push(p.getX(i), p.getY(i), p.getZ(i)); N.push(n.getX(i), n.getY(i), n.getZ(i)); UV.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0); }
    if (g.index) for (let i = 0; i < g.index.count; i++) I.push(g.index.getX(i) + off);
    else for (let i = 0; i < p.count; i++) I.push(i + off);
    off += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  out.setIndex(I);
  return out;
}

/** Twin alpha cut-out planes showing the side photo (left / right), centred on x=±half. */
function cutoutPlanes(len: number, hgt: number, half: number, y0 = 0): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    const g = new THREE.PlaneGeometry(len, hgt);
    g.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
    g.translate(side * half, y0 + hgt / 2, 0);
    // map to the side region; left side mirrored so the front reads on both sides
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const u = side > 0 ? 1 - uv.getX(i) : uv.getX(i);
      uv.setXY(i, R_SIDE[0] + u * (R_SIDE[2] - R_SIDE[0]), R_SIDE[1] + uv.getY(i) * (R_SIDE[3] - R_SIDE[1]));
    }
    geos.push(g);
  }
  return merge(geos);
}

export interface VModel { geo: THREE.BufferGeometry; mat: THREE.Material; cutout?: { geo: THREE.BufferGeometry; mat: THREE.Material } }

const models = new Map<string, VModel>();

/** Build (cached) the body model for a vehicle type. */
export function vehicleModel(id: string): VModel {
  const hit = models.get(id);
  if (hit) return hit;
  const d = VDEFS[id];
  const fallbackCol: Record<string, string> = { taxi_pink: '#e0508a', taxi_gy: '#3e9a4a', pickup: '#d8d8d4', songthaew: '#2f5aa8', bus_red: '#b83a2a', junk: '#c9c2a8', moto_red: '#b8282a', moto_blue: '#2a4aa8', tuktuk: '#2a4ab8', icecream: '#3a7ac8' };
  const atlas = lifeTex(`veh_${id}.${d.kind === 'moto' || d.kind === 'tuktuk' || d.kind === 'icecream' ? 'png' : 'jpg'}`, { fallback: fallbackCol[id] ?? '#888888', kind: 'plastic', clamp: true });
  atlas.anisotropy = 4;
  let m: VModel;
  if (d.kind === 'moto' || d.kind === 'icecream') {
    const core = merge([
      boxGeo(0.22, 0.32, 1.1, 0, 0.62, 0.05, [0.45, 0.62, 0.55, 0.7]),     // body / seat block
      boxGeo(0.12, 0.5, 0.18, 0, 0.75, -0.62, [0.12, 0.7, 0.2, 0.82]),     // front fork cover
    ]);
    const mat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.5, metalness: 0.2 });
    const cmat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.5, metalness: 0.15, alphaTest: 0.5, side: THREE.DoubleSide });
    m = { geo: core, mat, cutout: { geo: cutoutPlanes(d.len, d.hgt, 0.13), mat: cmat } };
    if (d.kind === 'icecream') {
      // sidecar freezer box (blue/white, uses the front region of the atlas = box photo)
      const box = boxGeo(0.62, 0.62, 0.9, 0.62, 0.62, 0.05, [0, 0, 0.5, 0.5]);
      m.geo = merge([core, box]);
    }
  } else if (d.kind === 'tuktuk') {
    const parts = [
      boxGeo(1.18, 0.12, 1.5, 0, 0.42, 0.55, [0.4, 0.52, 0.6, 0.56]),            // floor
      boxGeo(1.25, 0.06, 2.0, 0, 1.78, 0.25, [0.3, 0.97, 0.7, 0.99]),             // roof
      boxGeo(1.05, 0.5, 0.12, 0, 0.75, 1.32, [0.5, 0, 1, 0.5]),                   // rear panel
      boxGeo(0.62, 0.62, 0.6, 0, 0.62, -1.0, [0, 0, 0.5, 0.5]),                   // nose fairing (front photo)
      boxGeo(1.1, 0.35, 0.45, 0, 0.72, 0.95, [0.62, 0.55, 0.78, 0.62]),           // passenger bench
    ];
    const mat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.55, metalness: 0.15 });
    const cmat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.55, metalness: 0.1, alphaTest: 0.5, side: THREE.DoubleSide });
    m = { geo: merge(parts), mat, cutout: { geo: cutoutPlanes(d.len, d.hgt, d.wid / 2 - 0.02), mat: cmat } };
  } else {
    const prof = PROFILES[d.kind === 'car' ? 'car' : d.kind];
    const body = loftBody(prof, d.len, d.hgt);
    const parts = [body];
    if (id.startsWith('taxi')) parts.push(boxGeo(0.62, 0.14, 0.22, 0, 1.54, 0.1, [0.35, 0.985, 0.65, 0.995])); // TAXI-METER roof sign
    if (d.kind === 'pickup' || d.kind === 'junk') {
      // open bed walls (inside surfaces) — reuse the side strip
      const bz0 = d.kind === 'junk' ? 0.32 : 0.44, bz1 = d.len / 2 - 0.04, bw = d.wid / 2 - 0.08;
      parts.push(boxGeo(d.wid - 0.16, 0.05, bz1 - bz0, 0, prof[prof.length - 1].y1 - 0.42, (bz0 + bz1) / 2, [0.45, 0.52, 0.55, 0.54]));
      parts.push(boxGeo(0.04, 0.4, bz1 - bz0, bw, prof[prof.length - 1].y1 - 0.2, (bz0 + bz1) / 2, [0.6, 0.62, 0.9, 0.7]));
      parts.push(boxGeo(0.04, 0.4, bz1 - bz0, -bw, prof[prof.length - 1].y1 - 0.2, (bz0 + bz1) / 2, [0.6, 0.62, 0.9, 0.7]));
    }
    const mat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.42, metalness: 0.25, envMapIntensity: 1.2 });
    m = { geo: merge(parts), mat };
  }
  models.set(id, m);
  return m;
}

// ------------------------------------------------------------------ wheels (shared, instanced)

let wheelGeo: THREE.BufferGeometry | null = null, wheelMat: THREE.Material | null = null;
/** unit wheel (radius 1, width 1) along X; cap faces use the rim photo, tread the tyre photo */
export function wheelModel() {
  if (!wheelGeo) {
    const g = new THREE.CylinderGeometry(1, 1, 1, 14, 1, false);
    g.rotateZ(Math.PI / 2);
    // remap UVs: side (tread) → left strip, caps → rim disc region
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const n = g.attributes.normal as THREE.BufferAttribute;
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      if (Math.abs(n.getX(i)) > 0.9) uv.setXY(i, 0.5 + p.getZ(i) * 0.5 * 0.98 * 0.5 + 0.25, 0.5 + p.getY(i) * 0.5 * 0.98);
      else uv.setXY(i, uv.getX(i) * 0.25, uv.getY(i));
    }
    wheelGeo = g;
    wheelMat = new THREE.MeshStandardMaterial({ map: lifeTex('veh_wheel.jpg', { fallback: '#1c1c1c', kind: 'plastic', clamp: true }), roughness: 0.85, metalness: 0.2 });
  }
  return { geo: wheelGeo, mat: wheelMat! };
}

// ------------------------------------------------------------------ riders (static posed, instanced)

/**
 * Posed motorbike rider (sitting, hands on the bars), origin at the seat on the ground plane,
 * facing -Z. Parts are separate geometries so shirt / helmet colours can vary per instance.
 */
export function riderGeometries(): { shirt: THREE.BufferGeometry; skin: THREE.BufferGeometry; pants: THREE.BufferGeometry; helmet: THREE.BufferGeometry; hair: THREE.BufferGeometry } {
  const cyl = (r0: number, r1: number, a: THREE.Vector3, b: THREE.Vector3, seg = 7) => {
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, false);
    g.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.applyQuaternion(q);
    g.translate(a.x, a.y, a.z);
    return g;
  };
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const shirt: THREE.BufferGeometry[] = [], skin: THREE.BufferGeometry[] = [], pants: THREE.BufferGeometry[] = [];
  // torso leaning forward
  const hip = V(0, 0.98, 0.18), chest = V(0, 1.42, -0.02);
  const torso = cyl(0.17, 0.19, hip, chest, 9);
  torso.scale(1, 1, 0.75);
  shirt.push(torso);
  for (const s of [1, -1]) {
    const sh = V(s * 0.19, 1.38, -0.02), el = V(s * 0.24, 1.12, -0.24), wr = V(s * 0.28, 1.02, -0.5);
    shirt.push(cyl(0.055, 0.05, sh, el));
    skin.push(cyl(0.045, 0.04, el, wr));
    const hand = new THREE.SphereGeometry(0.045, 6, 4); hand.translate(wr.x, wr.y, wr.z - 0.02); skin.push(hand);
    const th = V(s * 0.1, 0.96, 0.16), kn = V(s * 0.17, 0.88, -0.28), an = V(s * 0.17, 0.42, -0.2);
    pants.push(cyl(0.08, 0.07, th, kn));
    pants.push(cyl(0.06, 0.05, kn, an));
    const foot = new THREE.BoxGeometry(0.09, 0.06, 0.22); foot.translate(an.x, 0.4, -0.27); skin.push(foot);
  }
  const neck = cyl(0.05, 0.05, V(0, 1.42, -0.04), V(0, 1.52, -0.08)); skin.push(neck);
  const head = new THREE.SphereGeometry(0.11, 9, 7); head.scale(0.9, 1.05, 1); head.translate(0, 1.62, -0.1); skin.push(head);
  const helmet = new THREE.SphereGeometry(0.135, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.62); helmet.translate(0, 1.64, -0.1);
  const hair = new THREE.SphereGeometry(0.118, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.5); hair.translate(0, 1.64, -0.09);
  const mergeUV = (arr: THREE.BufferGeometry[]) => merge(arr.map((g) => { if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; }));
  return { shirt: mergeUV(shirt), skin: mergeUV(skin), pants: mergeUV(pants), helmet: mergeUV([helmet]), hair: mergeUV([hair]) };
}
