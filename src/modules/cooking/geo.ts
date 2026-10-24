import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { fbm3, mulberry, vnoise3 } from './util';

/**
 * Low-poly-but-organic geometry builders. Everything gets noise wobble / dents / facets so nothing
 * reads as a primitive. Origins: bottom centre unless noted.
 */

/** Lathe from a [radius, y] profile with radial wobble. u = angle (0..1, seam at back), v = height (0..1). */
export function lathe(profile: [number, number][], segs = 16, o: { wobble?: number; seed?: number; freq?: number; phase?: number } = {}) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y));
  // phase: rotate so u=0.5 (label front) faces +Z
  const g = new THREE.LatheGeometry(pts, segs, o.phase ?? -Math.PI, Math.PI * 2);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const ymin = profile.reduce((a, p) => Math.min(a, p[1]), Infinity), ymax = profile.reduce((a, p) => Math.max(a, p[1]), -Infinity);
  const w = o.wobble ?? 0, f = o.freq ?? 6, sd = (o.seed ?? 1) * 13.1;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (w && r > 1e-4) {
      const n = vnoise3(x * f + sd, y * f, z * f - sd);
      const k = 1 + n * w;
      pos.setXYZ(i, x * k, y, z * k);
    }
    uv.setXY(i, uv.getX(i), (y - ymin) / Math.max(1e-4, ymax - ymin));
  }
  g.computeVertexNormals();
  return g;
}

/** Faceted organic mound (decimated-photoscan look). UVs projected from the top (u=x, v=z). */
export function mound(r: number, h: number, o: { seed?: number; detail?: number; rough?: number; flat?: boolean; base?: number; squash?: [number, number] } = {}) {
  const g0 = new THREE.IcosahedronGeometry(1, o.detail ?? 2);
  const g = g0.index ? g0.toNonIndexed() : g0;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const rough = o.rough ?? 0.22, sd = (o.seed ?? 1) * 7.77;
  const sx = o.squash?.[0] ?? 1, sz = o.squash?.[1] ?? 1;
  const base = o.base ?? 0;
  // displace per unique vertex position (keeps the mesh watertight even though non-indexed)
  const cache = new Map<string, [number, number, number]>();
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    let v = cache.get(key);
    if (!v) {
      const n = fbm3(x * 1.7 + sd, y * 1.7, z * 1.7 - sd, 3);
      const k = 1 + n * rough * 2;
      let yy = y < 0 ? y * 0.05 : y; // flatten the underside
      v = [x * r * k * sx, Math.max(base, yy * h * (1 + n * rough)), z * r * k * sz];
      cache.set(key, v);
    }
    pos.setXYZ(i, v[0], v[1], v[2]);
  }
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) { uv[i * 2] = pos.getX(i) / (2 * r) + 0.5; uv[i * 2 + 1] = 0.5 - pos.getZ(i) / (2 * r); }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  if (o.flat === false) return smoothNormals(g);
  return g;
}

function smoothNormals(g: THREE.BufferGeometry) {
  // average normals of coincident vertices (soft mound)
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal') as THREE.BufferAttribute;
  const acc = new Map<string, THREE.Vector3>();
  const key = (i: number) => `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    const v = acc.get(k) ?? new THREE.Vector3();
    v.x += nor.getX(i); v.y += nor.getY(i); v.z += nor.getZ(i);
    acc.set(k, v);
  }
  for (let i = 0; i < pos.count; i++) { const v = acc.get(key(i))!.clone().normalize(); nor.setXYZ(i, v.x, v.y, v.z); }
  return g;
}

/** A leaf (folded diamond) along +X, UV 0..1 across the leaf texture. Origin at the stem. */
export function leaf(len: number, wid: number, fold = 0.25) {
  const L = len, W = wid / 2;
  // vertices: stem(0), tip(1), left mid(2), right mid(3), left q(4), right q(5)
  const P = [
    [0, 0, 0], [L, 0, 0], [L * 0.45, W * fold, -W], [L * 0.45, W * fold, W], [L * 0.75, W * fold * 0.6, -W * 0.65], [L * 0.75, W * fold * 0.6, W * 0.65],
    [L * 0.45, -W * 0.05, 0], [L * 0.2, W * fold * 0.5, -W * 0.6], [L * 0.2, W * fold * 0.5, W * 0.6],
  ];
  const UV = [[0, 0.5], [1, 0.5], [0.45, 0], [0.45, 1], [0.75, 0.17], [0.75, 0.83], [0.45, 0.5], [0.2, 0.2], [0.2, 0.8]];
  const tris = [[0, 7, 6], [0, 6, 8], [7, 2, 6], [6, 3, 8], [2, 4, 6], [6, 5, 3], [4, 1, 6], [6, 1, 5]];
  const pos: number[] = [], uv: number[] = [];
  for (const t of tris) for (const i of t) { pos.push(...P[i]); uv.push(UV[i][0], UV[i][1]); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** Merge many transformed copies of a base geometry. */
export function scatter(base: THREE.BufferGeometry, n: number, place: (i: number, m: THREE.Matrix4, rnd: () => number) => void, seed = 1) {
  const rnd = mulberry(seed);
  const parts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    m.identity();
    place(i, m, rnd);
    parts.push(base.clone().applyMatrix4(m));
  }
  return merge(parts);
}

/** Merge geometries (normalises indexed / non-indexed & attributes). */
export function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const list = geos.filter(Boolean).map((g) => {
    let x = g.index ? g.toNonIndexed() : g;
    if (!x.getAttribute('normal')) x.computeVertexNormals();
    if (!x.getAttribute('uv')) x.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(x.getAttribute('position').count * 2), 2));
    for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(k)) x.deleteAttribute(k);
    x.morphAttributes = {};
    return x;
  });
  if (!list.length) return new THREE.BufferGeometry();
  if (list.length === 1) return list[0];
  return mergeGeometries(list, false) ?? list[0];
}

/** Rounded box, UVs scaled to metres / tile (so tiled PBR materials keep texel density). Origin = centre. */
export function rbox(w: number, h: number, d: number, r = 0.01, tile = 0.5, seg = 2) {
  const g = new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  const nor = g.getAttribute('normal'), pos = g.getAttribute('position'), uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let u: number, v: number;
    if (ny > nx && ny > Math.abs(nor.getZ(i))) { u = x; v = z; } else if (nx > Math.abs(nor.getZ(i))) { u = z; v = y; } else { u = x; v = y; }
    uv.setXY(i, u / tile, v / tile);
  }
  return g;
}

/** Tube along points (CatmullRom). */
export function tube(points: [number, number, number][], r: number, segs = 24, radial = 6, closed = false) {
  const c = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), closed, 'catmullrom', 0.1);
  return new THREE.TubeGeometry(c, segs, r, radial, closed);
}

/** Straight bar between two points (low-poly cylinder). */
export function bar(a: [number, number, number], b: [number, number, number], r: number, radial = 6) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const g = new THREE.CylinderGeometry(r, r, len, radial, 1, true);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  g.applyQuaternion(q);
  const mid = va.add(vb).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

/** Push vertices along their normals by noise (dents, lumps). Works on indexed geometry. */
export function dent(g: THREE.BufferGeometry, amt: number, freq = 8, seed = 1) {
  const pos = g.getAttribute('position') as THREE.BufferAttribute, nor = g.getAttribute('normal');
  if (!nor) g.computeVertexNormals();
  const n2 = g.getAttribute('normal');
  const s = seed * 3.3;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const d = (fbm3(x * freq + s, y * freq, z * freq - s, 2)) * amt;
    pos.setXYZ(i, x + n2.getX(i) * d, y + n2.getY(i) * d, z + n2.getZ(i) * d);
  }
  g.computeVertexNormals();
  return g;
}

/** Non-indexed + face normals → hard facets. */
export function facet(g: THREE.BufferGeometry) {
  const x = g.index ? g.toNonIndexed() : g;
  x.computeVertexNormals();
  return x;
}

/** Planar UV projection (top-down by default). */
export function planarUV(g: THREE.BufferGeometry, scale = 1, axis: 'y' | 'z' | 'x' = 'y', off: [number, number] = [0.5, 0.5]) {
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const [a, b] = axis === 'y' ? [x, -z] : axis === 'z' ? [x, y] : [z, y];
    uv[i * 2] = a * scale + off[0]; uv[i * 2 + 1] = b * scale + off[1];
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Irregular flat disc (fried egg white, puddles, sauce stains) with a soft rim, UV planar. */
export function blobDisc(r: number, o: { seg?: number; seed?: number; rough?: number; thick?: number; rim?: number } = {}) {
  const seg = o.seg ?? 18, sd = (o.seed ?? 1) * 5.1, rough = o.rough ?? 0.25, th = o.thick ?? 0.006;
  const pos: number[] = [];
  const ring = (k: number) => {
    const out: [number, number][] = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const n = fbm3(Math.cos(a) * 1.3 + sd, Math.sin(a) * 1.3, sd, 3);
      const rr = r * k * (1 + n * rough * 2);
      out.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    return out;
  };
  const outer = ring(1), inner = ring(0.62);
  const yC = th, yI = th * 0.9, yO = th * 0.25;
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    // centre fan
    pos.push(0, yC, 0, inner[j][0], yI, -inner[j][1], inner[i][0], yI, -inner[i][1]);
    // ring
    pos.push(inner[i][0], yI, -inner[i][1], inner[j][0], yI, -inner[j][1], outer[j][0], yO, -outer[j][1]);
    pos.push(inner[i][0], yI, -inner[i][1], outer[j][0], yO, -outer[j][1], outer[i][0], yO, -outer[i][1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  planarUV(g, 1 / (2 * r * 1.3));
  g.computeVertexNormals();
  return g;
}

/** Shallow dish (plate / tray) lathe profile helper: returns geometry with top-projected UVs for printed patterns. */
export function plateGeo(r: number, h: number, o: { well?: number; lip?: number; seg?: number; wobble?: number; seed?: number } = {}) {
  const well = o.well ?? 0.62;
  // the lathe goes bottom → rim → top (eating) surface
  const outer: [number, number][] = [[0.0001, 0], [r * well, 0], [r * 0.82, h * 0.45], [r * 0.97, h * 0.9], [r, h]];
  const inner: [number, number][] = [[r * 0.985, h * 0.98], [r * 0.82, h * 0.6], [r * well * 0.98, h * 0.22], [r * 0.4, h * 0.18], [0.0001, h * 0.18]];
  const g = lathe([...outer, ...inner], o.seg ?? 20, { wobble: o.wobble ?? 0.004, seed: o.seed });
  planarUV(g, 1 / (2 * r));
  return g;
}

/** Flat photo "card" lying in XZ (facing up), slightly domed. Image top → -Z. Origin centre. */
export function card(w: number, d: number, dome = 0.006, seg = 4) {
  const p = new THREE.PlaneGeometry(w, d, seg, seg);
  const pos = p.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / (w / 2), y = pos.getY(i) / (d / 2);
    pos.setZ(i, dome * Math.max(0, 1 - x * x) * Math.max(0, 1 - y * y));
  }
  p.computeVertexNormals();
  p.rotateX(-Math.PI / 2);
  return p;
}
