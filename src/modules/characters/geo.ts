import * as THREE from 'three';

/* ============================================================================================
 * Low-level geometry helpers: a skinned-geometry accumulator, periodic profiles, lofts.
 * ========================================================================================== */

export type V3 = [number, number, number];
/** bone weights as flat pairs [bone, w, bone, w, ...] */
export type W = number[];

export const v3add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const v3sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const v3mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const v3dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const v3cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const v3len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const v3norm = (a: V3): V3 => { const l = v3len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const v3lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
export const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** blend two weight sets: (1-t)·A + t·B */
export function wmix(a: W, b: W, t: number): W {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const out: W = [];
  for (let i = 0; i < a.length; i += 2) out.push(a[i], a[i + 1] * (1 - t));
  for (let i = 0; i < b.length; i += 2) out.push(b[i], b[i + 1] * t);
  return out;
}
export const wb = (bone: number): W => [bone, 1];

/** Skinned geometry accumulator with two material groups (0 = atlas, 1 = accessory palette). */
export class Geo {
  P: number[] = []; N: number[] = []; UV: number[] = []; SI: number[] = []; SW: number[] = []; C: number[] = [];
  I: number[][] = [[], []];
  /** vertex colour applied to subsequently added vertices (accessory tint) */
  color: V3 = [1, 1, 1];

  get count() { return this.P.length / 3; }

  v(p: V3, n: V3, u: number, v: number, w: W): number {
    this.P.push(p[0], p[1], p[2]);
    this.C.push(this.color[0], this.color[1], this.color[2]);
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    this.N.push(n[0] / l, n[1] / l, n[2] / l);
    this.UV.push(u, v);
    // merge duplicate bones, keep the 4 strongest, normalise
    const acc = new Map<number, number>();
    for (let i = 0; i < w.length; i += 2) if (w[i + 1] > 1e-4) acc.set(w[i], (acc.get(w[i]) ?? 0) + w[i + 1]);
    const arr = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    let s = 0;
    for (const e of arr) s += e[1];
    for (let i = 0; i < 4; i++) {
      const e = arr[i];
      this.SI.push(e ? e[0] : 0);
      this.SW.push(e ? e[1] / (s || 1) : 0);
    }
    return this.count - 1;
  }

  tri(a: number, b: number, c: number, g = 0) { this.I[g].push(a, b, c); }

  /** triangle with winding fixed so that its normal faces `out` */
  triOut(a: number, b: number, c: number, out: V3, g = 0) {
    const P = this.P;
    const ab: V3 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
    const ac: V3 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
    if (v3dot(v3cross(ab, ac), out) >= 0) this.tri(a, b, c, g); else this.tri(a, c, b, g);
  }

  append(o: Geo) {
    const off = this.count;
    this.P.push(...o.P); this.N.push(...o.N); this.UV.push(...o.UV); this.SI.push(...o.SI); this.SW.push(...o.SW); this.C.push(...o.C);
    for (let g = 0; g < 2; g++) for (const i of o.I[g]) this.I[g].push(i + off);
  }

  /** one indexed geometry per material group (atlas, accessory); null when empty */
  buildSplit(): [THREE.BufferGeometry | null, THREE.BufferGeometry | null] {
    const mk = (I: number[]) => {
      if (!I.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.UV, 2));
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.SI, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.SW, 4));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
      g.setAttribute('afat', new THREE.Float32BufferAttribute(new Float32Array(this.count), 1));
      g.setIndex(I.slice());
      return g;
    };
    return [mk(this.I[0]), mk(this.I[1])];
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.UV, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.SI, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.SW, 4));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    const idx = [...this.I[0], ...this.I[1]];
    g.setIndex(idx);
    g.addGroup(0, this.I[0].length, 0);
    if (this.I[1].length) g.addGroup(this.I[0].length, this.I[1].length, 1);
    return g;
  }
}

/**
 * Periodic radius profile sampled at n segments. `ctrl` are radii at equally spaced angles over
 * a full turn (asymmetric), or over [0, π] when `sym` (mirrored). θ=0 is the ring's `f` direction.
 * Segment j is at θ_j = -π + 2πj/n  (so j = n/2 is θ=0).
 */
export function profile(ctrl: number[], n: number, sym: boolean): number[] {
  let full = ctrl;
  if (sym) { full = ctrl.slice(); for (let i = ctrl.length - 2; i >= 1; i--) full.push(ctrl[i]); }
  const m = full.length;
  const out: number[] = [];
  for (let j = 0; j < n; j++) {
    let th = -Math.PI + (2 * Math.PI * j) / n;
    if (th < 0) th += Math.PI * 2;
    const x = (th / (Math.PI * 2)) * m;
    const k = Math.floor(x), t = x - k;
    const p0 = full[(k - 1 + m) % m], p1 = full[k % m], p2 = full[(k + 1) % m], p3 = full[(k + 2) % m];
    const t2 = t * t, t3 = t2 * t;
    out.push(0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3));
  }
  return out;
}

export function lerpArr(a: number[], b: number[], t: number) { return a.map((v, i) => v + (b[i] - v) * t); }

export interface Ring {
  c: V3;
  /** u-centre direction (θ = 0) */
  f: V3;
  /** θ = +90° direction */
  s: V3;
  /** radii per segment (length n) */
  r: number[];
  /** texture t (0..1 in region) */
  t: number;
  /** ring weights or per-vertex weight function */
  w: W | ((p: V3, j: number) => W);
}

export interface LoftOpts {
  n: number;
  /** maps (s ∈ 0..1 around, t) → atlas uv */
  uv: (s: number, t: number) => [number, number];
  capStart?: { depth: number; t?: number };
  capEnd?: { depth: number; t?: number };
  group?: number;
  /** column range to emit (for split UV islands): [j0, j1] inclusive, default full ring with seam */
  cols?: [number, number];
  /** use precomputed normals for the grid (e.g. shared across islands) */
  normals?: V3[][];
  /** override uv per vertex (p, j, ring index) */
  uvFn?: (p: V3, j: number, i: number) => [number, number];
}

/** grid positions of a loft */
export function loftGrid(rings: Ring[], n: number): V3[][] {
  return rings.map((rg) => {
    const row: V3[] = [];
    for (let j = 0; j < n; j++) {
      const th = -Math.PI + (2 * Math.PI * j) / n;
      const c = Math.cos(th), s = Math.sin(th), r = rg.r[j];
      row.push([rg.c[0] + (rg.f[0] * c + rg.s[0] * s) * r, rg.c[1] + (rg.f[1] * c + rg.s[1] * s) * r, rg.c[2] + (rg.f[2] * c + rg.s[2] * s) * r]);
    }
    return row;
  });
}

/** smooth normals of a closed loft grid (central differences), oriented outward */
export function gridNormals(rings: Ring[], P: V3[][], n: number): V3[][] {
  const R = P.length;
  const out: V3[][] = [];
  for (let i = 0; i < R; i++) {
    const row: V3[] = [];
    const ia = Math.max(0, i - 1), ib = Math.min(R - 1, i + 1);
    for (let j = 0; j < n; j++) {
      const along = v3sub(P[ib][j], P[ia][j]);
      const around = v3sub(P[i][(j + 1) % n], P[i][(j - 1 + n) % n]);
      let nn = v3cross(along, around);
      const radial = v3sub(P[i][j], rings[i].c);
      if (v3len(nn) < 1e-9) nn = radial;
      if (v3dot(nn, radial) < 0) nn = v3mul(nn, -1);
      row.push(v3norm(nn));
    }
    out.push(row);
  }
  return out;
}

/** Emit a loft into the accumulator. */
export function loft(G: Geo, rings: Ring[], o: LoftOpts) {
  const n = o.n;
  const P = loftGrid(rings, n);
  const N = o.normals ?? gridNormals(rings, P, n);
  const g = o.group ?? 0;
  const [j0, j1] = o.cols ?? [0, n];
  const idx: number[][] = [];
  for (let i = 0; i < rings.length; i++) {
    const row: number[] = [];
    const rg = rings[i];
    for (let jj = j0; jj <= j1; jj++) {
      const j = jj % n;
      const p = P[i][j];
      const w = typeof rg.w === 'function' ? rg.w(p, j) : rg.w;
      const [u, v] = o.uvFn ? o.uvFn(p, jj, i) : o.uv(jj / n, rg.t);
      row.push(G.v(p, N[i][j], u, v, w));
    }
    idx.push(row);
  }
  for (let i = 0; i < rings.length - 1; i++) {
    const a = idx[i], b = idx[i + 1];
    // decide winding from the ring direction at this band
    const mid = (j1 - j0) >> 1;
    const pa = P[i][(j0 + mid) % n], pb = P[i + 1][(j0 + mid) % n], pc = P[i][(j0 + mid + 1) % n];
    const nrm = v3cross(v3sub(pb, pa), v3sub(pc, pa));
    const radial = v3sub(pa, rings[i].c);
    const flip = v3dot(nrm, radial) < 0;
    for (let k = 0; k < a.length - 1; k++) {
      if (!flip) { G.tri(a[k], b[k], a[k + 1], g); G.tri(a[k + 1], b[k], b[k + 1], g); }
      else { G.tri(a[k], a[k + 1], b[k], g); G.tri(a[k + 1], b[k + 1], b[k], g); }
    }
  }
  const cap = (ri: number, depth: number, tt: number | undefined, dirSign: number) => {
    const rg = rings[ri];
    const axis = v3norm(v3sub(rings[ri].c, rings[ri === 0 ? 1 : ri - 1].c));
    const ctr = v3add(rg.c, v3mul(axis, depth * dirSign * (ri === 0 ? 1 : 1)));
    const w = typeof rg.w === 'function' ? rg.w(rg.c, 0) : rg.w;
    const [u, v] = o.uv(0.5, tt ?? rg.t);
    const ci = G.v(ctr, axis, u, v, w);
    const row = idx[ri];
    for (let k = 0; k < row.length - 1; k++) G.triOut(row[k], row[k + 1], ci, axis, g);
  };
  if (o.capStart) cap(0, o.capStart.depth, o.capStart.t, 1);
  if (o.capEnd) cap(rings.length - 1, o.capEnd.depth, o.capEnd.t, 1);
  return { P, N, idx };
}

/** orthonormal frame for an axis: returns f (closest to `pref` ⟂ axis) and s = axis × f oriented by `sideRef` */
export function frame(axis: V3, pref: V3, sideRef?: V3): { f: V3; s: V3 } {
  const a = v3norm(axis);
  let f = v3sub(pref, v3mul(a, v3dot(pref, a)));
  if (v3len(f) < 1e-6) f = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
  f = v3norm(f);
  let s = v3norm(v3cross(a, f));
  if (sideRef && v3dot(s, sideRef) < 0) s = v3mul(s, -1);
  return { f, s };
}

/** Concatenate indexed geometries with identical attribute sets; optional one group per input. */
export function mergeGeos(list: THREE.BufferGeometry[], groups = false): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const names = Object.keys(list[0].attributes);
  let vcount = 0, icount = 0;
  for (const g of list) { vcount += g.attributes.position.count; icount += g.index ? g.index.count : g.attributes.position.count; }
  for (const n of names) {
    const a0 = list[0].attributes[n] as THREE.BufferAttribute;
    const Arr = (a0.array as any).constructor;
    const arr = new Arr(vcount * a0.itemSize);
    let off = 0;
    for (const g of list) { const a = g.attributes[n] as THREE.BufferAttribute; if (a) arr.set(a.array as any, off); off += g.attributes.position.count * a0.itemSize; }
    out.setAttribute(n, new THREE.BufferAttribute(arr, a0.itemSize, a0.normalized));
  }
  const idx = new (vcount > 65535 ? Uint32Array : Uint16Array)(icount);
  let io = 0, vo = 0;
  for (const g of list) {
    const n = g.index ? g.index.count : g.attributes.position.count;
    if (g.index) { const src = g.index.array; for (let i = 0; i < n; i++) idx[io + i] = src[i] + vo; }
    else for (let i = 0; i < n; i++) idx[io + i] = i + vo;
    if (groups) out.addGroup(io, n, out.groups.length);
    io += n; vo += g.attributes.position.count;
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
