import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Assets } from '../../core/assets';

/* =============================================================================================
 * Geometry + material helpers for restaurant furniture. Low-poly but never a raw primitive:
 * bevels, noise wobble, splayed legs, lips and rims. Origins at the BOTTOM CENTRE.
 * ============================================================================================= */

function h3(x: number, y: number, z: number) { const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return n - Math.floor(n); }
export function vnoise(x: number, y: number, z: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a: number, b: number, t: number) => a + (b - a) * t;
  const x1 = L(h3(xi, yi, zi), h3(xi + 1, yi, zi), u), x2 = L(h3(xi, yi + 1, zi), h3(xi + 1, yi + 1, zi), u);
  const x3 = L(h3(xi, yi, zi + 1), h3(xi + 1, yi, zi + 1), u), x4 = L(h3(xi, yi + 1, zi + 1), h3(xi + 1, yi + 1, zi + 1), u);
  return L(L(x1, x2, v), L(x3, x4, v), w) * 2 - 1;
}

/** Radial noise wobble (dents) on any geometry. */
export function wobble(g: THREE.BufferGeometry, amt = 0.02, freq = 9, seed = 1) {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = vnoise(x * freq + seed * 3.1, y * freq, z * freq - seed);
    p.setXYZ(i, x * (1 + n * amt), y + n * amt * 0.15, z * (1 + n * amt));
  }
  g.computeVertexNormals();
  return g;
}

/** Lathe around Y; uv.x = angle (0..1, 0.5 = front +Z), uv.y = height 0..1. */
export function lathe(profile: [number, number][], segs = 18, o: { wob?: number; seed?: number; arc?: [number, number] } = {}) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(1e-4, r), y));
  const g = new THREE.LatheGeometry(pts, segs, o.arc?.[0] ?? -Math.PI, o.arc?.[1] ?? Math.PI * 2);
  const pos = g.getAttribute('position'), uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const ymin = Math.min(...profile.map((p) => p[1])), ymax = Math.max(...profile.map((p) => p[1]));
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), (pos.getY(i) - ymin) / Math.max(1e-4, ymax - ymin));
  if (o.wob) wobble(g, o.wob, 7, o.seed ?? 1); else g.computeVertexNormals();
  return g;
}

/** Rounded box resting on y=0 (or at y). */
export function rbox(w: number, h: number, d: number, r = 0.01, x = 0, y = 0, z = 0, seg = 2) {
  const g = new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  g.translate(x, y + h / 2, z);
  return g;
}

/** Tapered (frustum) square leg from (x0,0,z0) to (x1,h,z1). */
export function leg(x0: number, z0: number, x1: number, z1: number, h: number, w0: number, w1: number) {
  const g = new THREE.CylinderGeometry(w1 * 0.7071, w0 * 0.7071, h, 4, 1);
  g.rotateY(Math.PI / 4);
  // shear so the leg splays from the top point to the foot
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) + h / 2) / h; // 0 bottom … 1 top
    p.setXYZ(i, p.getX(i) + x0 + (x1 - x0) * t, p.getY(i) + h / 2, p.getZ(i) + z0 + (z1 - z0) * t);
  }
  g.computeVertexNormals();
  return g;
}

/** Round tube between two points. */
export function tube(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 6) {
  const d = b.clone().sub(a);
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1);
  g.translate(0, d.length() / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

export function merge(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const list = gs.map((g) => {
    const x = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(k)) x.deleteAttribute(k);
    if (!x.getAttribute('uv')) x.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(x.getAttribute('position').count * 2), 2));
    return x;
  });
  return mergeGeometries(list, false) ?? list[0];
}

export function mesh(g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], shadow = true) {
  const x = new THREE.Mesh(g, m);
  x.castShadow = shadow; x.receiveShadow = true;
  return x;
}

export function group(...o: THREE.Object3D[]) { const g = new THREE.Group(); for (const x of o) g.add(x); return g; }

// ------------------------------------------------------------------ materials (cached)

const MATS = new Map<string, THREE.Material>();
export function mat<T extends THREE.Material>(key: string, make: () => T): T {
  let m = MATS.get(key) as T;
  if (!m) { m = make(); MATS.set(key, m); }
  return m;
}

/** Real PP-plastic photo texture (textures/props/plastic_pp_*) — red / blue, else tinted PBR plastic. */
export function plastic(color: 'red' | 'blue' | number, rough = 1) {
  return mat('pl:' + color + rough, () => {
    if (color === 'red' || color === 'blue') {
      const m = new THREE.MeshStandardMaterial({
        map: Assets.texture(`textures/props/plastic_pp_${color}.jpg`, { repeat: 2 }),
        normalMap: Assets.texture('textures/props/plastic_pp_n.jpg', { srgb: false, repeat: 2 }),
        roughnessMap: Assets.texture('textures/props/plastic_pp_r.jpg', { srgb: false, repeat: 2 }),
        roughness: rough, metalness: 0,
      });
      m.normalScale.set(0.6, 0.6);
      return m;
    }
    return Assets.pbr('plastic_rough', { repeat: 2, color, fallback: color, roughness: rough }).clone();
  });
}
export const pbr = (id: string, o: { repeat?: number; color?: number; rough?: number; metal?: number; side?: THREE.Side } = {}) =>
  mat(`pbr:${id}:${o.repeat}:${o.color}:${o.rough}:${o.metal}:${o.side}`, () => Assets.pbr(id, { repeat: o.repeat ?? 1, color: o.color, roughness: o.rough, metalness: o.metal, side: o.side, fallback: o.color ?? 0x999999 }));

/** Photo material (real image file under public/assets). */
export function photo(path: string, o: { alpha?: boolean; rough?: number; side?: THREE.Side; color?: number; repeat?: [number, number]; clamp?: boolean; transparent?: boolean } = {}) {
  return mat(`ph:${path}:${o.alpha}:${o.rough}:${o.side}:${o.color}:${o.repeat}:${o.clamp}:${o.transparent}`, () => {
    const t = Assets.texture(path, { srgb: true, wrap: !o.clamp, repeat: o.repeat });
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: o.rough ?? 0.6, metalness: 0, side: o.side ?? THREE.FrontSide, color: o.color ?? 0xffffff });
    if (o.alpha) m.alphaTest = 0.45;
    if (o.transparent) { m.transparent = true; m.depthWrite = false; }
    return m;
  });
}

export const flat = (color: number, rough = 0.7, metal = 0, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  mat(`fl:${color}:${rough}:${metal}:${JSON.stringify(extra)}`, () => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra }));

/** Squeeze uv.x so a front-only photo label covers `deg` degrees around +Z (front). */
export function frontArc(g: THREE.BufferGeometry, deg = 150) {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const k = 360 / deg;
  for (let i = 0; i < uv.count; i++) uv.setX(i, (uv.getX(i) - 0.5) * k + 0.5);
  return g;
}

/** Remap a lathe's uv.y into a sub-range (label band). */
export function band(g: THREE.BufferGeometry, y0: number, y1: number) {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, (uv.getY(i) - y0) / (y1 - y0));
  return g;
}
