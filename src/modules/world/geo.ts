import * as THREE from 'three';

/**
 * Fast static-geometry builder for the world.
 *
 * Every primitive is appended straight into typed arrays of a "bucket" (one bucket per
 * material kind × detail group × 40 m chunk). At the end each bucket becomes ONE merged mesh, so
 * the whole map costs a handful of draw calls per chunk.
 *
 * Common vertex format (all kinds):
 *   position(3) normal(3) uv(2) color(4 = tint.rgb * dirt, a = ambient occlusion) extra(4)
 * `extra` meaning depends on the kind:
 *   world/cut : x = texture-array layer, y = overlay layer, z = overlay amount, w = emissive (palette + fraction)
 *   sign      : x = glow at night (0..1)
 *   decal     : (unused)
 *   fol       : x = wind weight, y = phase, z = stiffness
 */

export type Kind = 'world' | 'cut' | 'sign' | 'decal' | 'fol';
export type Group = 'base' | 'detail';
export type UVMode = 'world' | 'local' | 'face';

export const PX = 1, NX = 2, PY = 4, NY = 8, PZ = 16, NZ = 32, ALL = 63, SIDES = PX | NX | PZ | NZ;

export class Buf {
  pos: Float32Array; nrm: Float32Array; uv: Float32Array; col: Float32Array; ext: Float32Array; idx: Uint32Array;
  nv = 0; ni = 0;
  constructor(v = 256, i = 384) {
    this.pos = new Float32Array(v * 3); this.nrm = new Float32Array(v * 3); this.uv = new Float32Array(v * 2);
    this.col = new Float32Array(v * 4); this.ext = new Float32Array(v * 4); this.idx = new Uint32Array(i);
  }
  reserve(av: number, ai: number) {
    const cap = this.pos.length / 3;
    if (this.nv + av > cap) {
      let n = cap * 2; while (n < this.nv + av) n *= 2;
      const g = <T extends Float32Array>(a: T, k: number) => { const b = new Float32Array(n * k); b.set(a.subarray(0, this.nv * k)); return b as T; };
      this.pos = g(this.pos, 3); this.nrm = g(this.nrm, 3); this.uv = g(this.uv, 2); this.col = g(this.col, 4); this.ext = g(this.ext, 4);
    }
    if (this.ni + ai > this.idx.length) {
      let n = this.idx.length * 2; while (n < this.ni + ai) n *= 2;
      const b = new Uint32Array(n); b.set(this.idx.subarray(0, this.ni)); this.idx = b;
    }
  }
  /** append another buffer transformed by m (normal matrix nm), with optional colour multiply */
  appendFrom(src: Buf, m: THREE.Matrix4, nm: THREE.Matrix3, tint?: ArrayLike<number> | null, extOverride?: (ext: Float32Array, o: number) => void) {
    this.reserve(src.nv, src.ni);
    const e = m.elements, n = nm.elements, o = this.nv;
    for (let i = 0; i < src.nv; i++) {
      const x = src.pos[i * 3], y = src.pos[i * 3 + 1], z = src.pos[i * 3 + 2];
      const j = (o + i) * 3;
      this.pos[j] = e[0] * x + e[4] * y + e[8] * z + e[12];
      this.pos[j + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      this.pos[j + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      const nx = src.nrm[i * 3], ny = src.nrm[i * 3 + 1], nz = src.nrm[i * 3 + 2];
      let ax = n[0] * nx + n[3] * ny + n[6] * nz, ay = n[1] * nx + n[4] * ny + n[7] * nz, az = n[2] * nx + n[5] * ny + n[8] * nz;
      const l = Math.hypot(ax, ay, az) || 1; ax /= l; ay /= l; az /= l;
      this.nrm[j] = ax; this.nrm[j + 1] = ay; this.nrm[j + 2] = az;
      this.uv[(o + i) * 2] = src.uv[i * 2]; this.uv[(o + i) * 2 + 1] = src.uv[i * 2 + 1];
      const c = (o + i) * 4, s = i * 4;
      this.col[c] = src.col[s] * (tint ? tint[0] : 1); this.col[c + 1] = src.col[s + 1] * (tint ? tint[1] : 1);
      this.col[c + 2] = src.col[s + 2] * (tint ? tint[2] : 1); this.col[c + 3] = src.col[s + 3];
      this.ext[c] = src.ext[s]; this.ext[c + 1] = src.ext[s + 1]; this.ext[c + 2] = src.ext[s + 2]; this.ext[c + 3] = src.ext[s + 3];
      if (extOverride) extOverride(this.ext, c);
    }
    for (let i = 0; i < src.ni; i++) this.idx[this.ni + i] = src.idx[i] + o;
    this.nv += src.nv; this.ni += src.ni;
  }
  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, this.nv * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.slice(0, this.nv * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv.slice(0, this.nv * 2), 2));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, this.nv * 4), 4));
    g.setAttribute('aExtra', new THREE.BufferAttribute(this.ext.slice(0, this.nv * 4), 4));
    const idx = this.nv > 65535 ? this.idx.slice(0, this.ni) : Uint16Array.from(this.idx.subarray(0, this.ni));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export interface LayerInfo { index: number; tile: number; tileV?: number }
export type LayerLookup = (name: string) => LayerInfo;

export interface MatOpts {
  tint?: number | [number, number, number];
  /** overlay (grime) layer name + amount 0..1 */
  ov?: string; ovAmt?: number;
  /** emissive palette index (1..15) and strength 0..1 */
  emis?: number; emisK?: number;
  dirt?: number; ao?: number;
  uv?: UVMode;
  /** uv scale multiplier (1 = real metres) and offset in metres */
  uvS?: number; uo?: number; vo?: number;
  group?: Group;
  /** automatic ground grime on vertical faces */
  autoDirt?: boolean;
}

export interface Template { bufs: Partial<Record<Kind, Buf>>; }

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();

/** hex/array → linear-ish [r,g,b] multiplier (sRGB → linear so tints match picked colours) */
export function tintOf(t: number | [number, number, number] | undefined): [number, number, number] {
  if (t === undefined) return [1, 1, 1];
  if (Array.isArray(t)) return t;
  const c = new THREE.Color(t);
  return [c.r, c.g, c.b];
}

export class WB {
  readonly buckets = new Map<string, Buf>();
  chunk = 40;
  // current material state
  kind: Kind = 'world';
  group: Group = 'base';
  layer = 0; tile = 2; tileV = 2; ov = 0; ovAmt = 0; emis = 0;
  tr = 1; tg = 1; tb = 1; dirt = 1; ao = 1;
  uvMode: UVMode = 'world'; uvS = 1; uo = 0; vo = 0; autoDirt = true;
  /** current transform (local → world) */
  M = new THREE.Matrix4();
  NM = new THREE.Matrix3();
  private stack: THREE.Matrix4[] = [];
  private identity = true;
  /** when set, primitives go into this buffer instead of the chunk buckets (template building) */
  target: Template | null = null;
  /** force chunk position (e.g. whole building in one chunk) */
  pinChunk: [number, number] | null = null;
  tris = 0;

  constructor(public lookup: LayerLookup) {}

  // ------------------------------------------------------------------ state

  mat(name: string, o: MatOpts = {}) {
    const L = this.lookup(name);
    this.kind = 'world';
    this.layer = L.index; this.tile = L.tile; this.tileV = L.tileV ?? L.tile;
    this.ov = o.ov ? this.lookup(o.ov).index : 0;
    this.ovAmt = o.ov ? (o.ovAmt ?? 0.5) : 0;
    this.emis = o.emis ? o.emis + Math.min(0.999, Math.max(0, o.emisK ?? 0.8)) : 0;
    const t = tintOf(o.tint); this.tr = t[0]; this.tg = t[1]; this.tb = t[2];
    this.dirt = o.dirt ?? 1; this.ao = o.ao ?? 1;
    this.uvMode = o.uv ?? 'world'; this.uvS = o.uvS ?? 1; this.uo = o.uo ?? 0; this.vo = o.vo ?? 0;
    if (o.group) this.group = o.group;
    this.autoDirt = o.autoDirt ?? true;
    return this;
  }
  /** cutout variant of a world layer (alpha from the albedo array) */
  cut(name: string, o: MatOpts = {}) { this.mat(name, o); this.kind = 'cut'; return this; }
  /** atlas based kinds: uv are explicit atlas coordinates */
  atlas(kind: 'sign' | 'decal' | 'fol', o: { tint?: number | [number, number, number]; ao?: number; dirt?: number; e0?: number; e1?: number; e2?: number; e3?: number; group?: Group } = {}) {
    this.kind = kind;
    const t = tintOf(o.tint); this.tr = t[0]; this.tg = t[1]; this.tb = t[2];
    this.dirt = o.dirt ?? 1; this.ao = o.ao ?? 1;
    this.layer = o.e0 ?? 0; this.ov = o.e1 ?? 0; this.ovAmt = o.e2 ?? 0; this.emis = o.e3 ?? 0;
    this.uvMode = 'face'; this.uvS = 1; this.uo = 0; this.vo = 0; this.autoDirt = false;
    if (o.group) this.group = o.group;
    return this;
  }
  setGroup(g: Group) { this.group = g; return this; }
  setTint(t: number | [number, number, number]) { const c = tintOf(t); this.tr = c[0]; this.tg = c[1]; this.tb = c[2]; return this; }
  setEmis(pal: number, k = 0.8) { this.emis = pal ? pal + Math.min(0.999, Math.max(0, k)) : 0; return this; }

  push(m?: THREE.Matrix4) {
    this.stack.push(this.M.clone());
    if (m) this.M.multiply(m);
    this.NM.getNormalMatrix(this.M);
    this.identity = false;
    return this;
  }
  /** push translate + yaw (+ optional uniform scale) */
  pushT(x: number, y: number, z: number, yaw = 0, s = 1) {
    _q.setFromAxisAngle(_n.set(0, 1, 0), yaw);
    _m4.compose(_v.set(x, y, z), _q, _s.set(s, s, s));
    return this.push(_m4);
  }
  pushTR(x: number, y: number, z: number, rx: number, ry: number, rz: number, s = 1) {
    _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ'));
    _m4.compose(_v.set(x, y, z), _q, _s.set(s, s, s));
    return this.push(_m4);
  }
  pop() {
    this.M.copy(this.stack.pop()!);
    this.NM.getNormalMatrix(this.M);
    this.identity = this.stack.length === 0;
    return this;
  }

  // ------------------------------------------------------------------ buckets

  bucketAt(wx: number, wz: number, kind = this.kind, group = this.group): Buf {
    if (this.target) {
      let b = this.target.bufs[kind];
      if (!b) b = this.target.bufs[kind] = new Buf(256, 384);
      return b;
    }
    const ix = this.pinChunk ? this.pinChunk[0] : Math.floor(wx / this.chunk);
    const iz = this.pinChunk ? this.pinChunk[1] : Math.floor(wz / this.chunk);
    const key = kind + '|' + group + '|' + ix + '|' + iz;
    let b = this.buckets.get(key);
    if (!b) { b = new Buf(group === 'base' ? 4096 : 1024, group === 'base' ? 6144 : 1536); this.buckets.set(key, b); }
    return b;
  }

  // ------------------------------------------------------------------ primitives

  private wp = new Float32Array(12);
  private lp = new Float32Array(12);

  /**
   * Quad from 4 points (counter-clockwise seen from the front): a=bottom-left, b=bottom-right,
   * c=top-right, d=top-left. `uvs` optional explicit [u0,v0,u1,v1] (atlas / face mapping).
   */
  quad(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, uvs?: ArrayLike<number> | null, flipNormal = false) {
    const lp = this.lp, wp = this.wp;
    lp[0] = ax; lp[1] = ay; lp[2] = az; lp[3] = bx; lp[4] = by; lp[5] = bz; lp[6] = cx; lp[7] = cy; lp[8] = cz; lp[9] = dx; lp[10] = dy; lp[11] = dz;
    // local normal
    let ux = bx - ax, uy = by - ay, uz = bz - az, vx = dx - ax, vy = dy - ay, vz = dz - az;
    let lnx = uy * vz - uz * vy, lny = uz * vx - ux * vz, lnz = ux * vy - uy * vx;
    let ll = Math.hypot(lnx, lny, lnz);
    if (ll < 1e-12) { // degenerate a-b: use c
      ux = cx - ax; uy = cy - ay; uz = cz - az;
      lnx = uy * vz - uz * vy; lny = uz * vx - ux * vz; lnz = ux * vy - uy * vx; ll = Math.hypot(lnx, lny, lnz) || 1;
    }
    lnx /= ll; lny /= ll; lnz /= ll;
    if (flipNormal) { lnx = -lnx; lny = -lny; lnz = -lnz; }
    // to world
    const e = this.M.elements;
    for (let i = 0; i < 4; i++) {
      const x = lp[i * 3], y = lp[i * 3 + 1], z = lp[i * 3 + 2];
      if (this.identity) { wp[i * 3] = x; wp[i * 3 + 1] = y; wp[i * 3 + 2] = z; }
      else {
        wp[i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
        wp[i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        wp[i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      }
    }
    let nx = lnx, ny = lny, nz = lnz;
    if (!this.identity) {
      const n = this.NM.elements;
      nx = n[0] * lnx + n[3] * lny + n[6] * lnz; ny = n[1] * lnx + n[4] * lny + n[7] * lnz; nz = n[2] * lnx + n[5] * lny + n[8] * lnz;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    }
    const cxw = (wp[0] + wp[6]) * 0.5, czw = (wp[2] + wp[8]) * 0.5;
    const B = this.bucketAt(cxw, czw);
    B.reserve(4, 6);
    const o = B.nv;
    // uv
    const mode = this.uvMode;
    const atlasKind = this.kind === 'sign' || this.kind === 'decal' || this.kind === 'fol';
    let uvArr: number[] | null = null;
    if (uvs) {
      // explicit: a(u0,v0) b(u1,v0) c(u1,v1) d(u0,v1)
      uvArr = [uvs[0], uvs[1], uvs[2], uvs[1], uvs[2], uvs[3], uvs[0], uvs[3]];
      if (!atlasKind) { const ku = this.uvS / this.tile, kv = this.uvS / this.tileV; for (let i = 0; i < 8; i += 2) { uvArr[i] *= ku; uvArr[i + 1] *= kv; } }
    } else if (mode === 'face') {
      const lu = Math.hypot(bx - ax, by - ay, bz - az), lv = Math.hypot(dx - ax, dy - ay, dz - az);
      const ku = atlasKind ? 1 : this.uvS / this.tile, kv = atlasKind ? 1 : this.uvS / this.tileV;
      const u0 = this.uo, v0 = this.vo;
      uvArr = [u0 * ku, v0 * kv, (u0 + lu) * ku, v0 * kv, (u0 + lu) * ku, (v0 + lv) * kv, u0 * ku, (v0 + lv) * kv];
    }
    const ku = this.uvS / this.tile, kv = this.uvS / this.tileV;
    const P = mode === 'local' ? lp : wp;
    const pnx = mode === 'local' ? lnx : nx, pny = mode === 'local' ? lny : ny, pnz = mode === 'local' ? lnz : nz;
    const anx = Math.abs(pnx), any = Math.abs(pny), anz = Math.abs(pnz);
    const vertical = Math.abs(ny) < 0.6;
    for (let i = 0; i < 4; i++) {
      const j = (o + i) * 3;
      B.pos[j] = wp[i * 3]; B.pos[j + 1] = wp[i * 3 + 1]; B.pos[j + 2] = wp[i * 3 + 2];
      B.nrm[j] = nx; B.nrm[j + 1] = ny; B.nrm[j + 2] = nz;
      let u: number, v: number;
      if (uvArr) { u = uvArr[i * 2]; v = uvArr[i * 2 + 1]; }
      else {
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        if (any >= anx && any >= anz) { u = x; v = pny > 0 ? -z : z; }
        else if (anx >= anz) { u = pnx > 0 ? -z : z; v = y; }
        else { u = pnz > 0 ? x : -x; v = y; }
        u = (u + this.uo) * ku; v = (v + this.vo) * kv;
      }
      B.uv[(o + i) * 2] = u; B.uv[(o + i) * 2 + 1] = v;
      let d = this.dirt;
      if (this.autoDirt && vertical) {
        const h = wp[i * 3 + 1];
        const t = Math.min(1, Math.max(0, h / 1.4));
        d *= 0.7 + 0.3 * (t * t * (3 - 2 * t));
      }
      const c = (o + i) * 4;
      B.col[c] = this.tr; B.col[c + 1] = this.tg; B.col[c + 2] = this.tb; B.col[c + 3] = this.ao * d;
      B.ext[c] = this.layer; B.ext[c + 1] = this.ov; B.ext[c + 2] = this.ovAmt; B.ext[c + 3] = this.emis;
    }
    B.idx[B.ni] = o; B.idx[B.ni + 1] = o + 1; B.idx[B.ni + 2] = o + 2;
    B.idx[B.ni + 3] = o; B.idx[B.ni + 4] = o + 2; B.idx[B.ni + 5] = o + 3;
    B.nv += 4; B.ni += 6;
    this.tris += 2;
  }

  /** set per-vertex AO of the last n vertices written into the bucket at (wx,wz) — rarely needed */

  /** face with centre c, half-extent right vector r and up vector u (normal = r × u) */
  face(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, ux: number, uy: number, uz: number, uvs?: ArrayLike<number> | null) {
    this.quad(
      cx - rx - ux, cy - ry - uy, cz - rz - uz,
      cx + rx - ux, cy + ry - uy, cz + rz - uz,
      cx + rx + ux, cy + ry + uy, cz + rz + uz,
      cx - rx + ux, cy - ry + uy, cz - rz + uz, uvs);
  }

  /** axis-aligned box (in current transform space) from min/max corners */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, faces = ALL) {
    if (x1 < x0) { const t = x0; x0 = x1; x1 = t; }
    if (y1 < y0) { const t = y0; y0 = y1; y1 = t; }
    if (z1 < z0) { const t = z0; z0 = z1; z1 = t; }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2, hx = (x1 - x0) / 2, hy = (y1 - y0) / 2, hz = (z1 - z0) / 2;
    if (faces & PX) this.face(x1, cy, cz, 0, 0, -hz, 0, hy, 0);
    if (faces & NX) this.face(x0, cy, cz, 0, 0, hz, 0, hy, 0);
    if (faces & PZ) this.face(cx, cy, z1, hx, 0, 0, 0, hy, 0);
    if (faces & NZ) this.face(cx, cy, z0, -hx, 0, 0, 0, hy, 0);
    if (faces & PY) this.face(cx, y1, cz, hx, 0, 0, 0, 0, -hz);
    if (faces & NY) this.face(cx, y0, cz, hx, 0, 0, 0, 0, hz);
  }

  /** box from centre + size */
  boxC(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, faces = ALL) {
    this.box(cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2, faces);
  }

  /** box with bevelled vertical edges (8-sided footprint) — breaks the "lazy box" look */
  bevelBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, b = 0.03, top = true, bottom = false) {
    const pts: [number, number][] = [[x0 + b, z0], [x1 - b, z0], [x1, z0 + b], [x1, z1 - b], [x1 - b, z1], [x0 + b, z1], [x0, z1 - b], [x0, z0 + b]];
    this.prism(pts, y0, y1, top, bottom);
  }

  /** vertical prism from a CCW (seen from above, i.e. x right, z down → use clockwise in xz) polygon */
  prism(pts: [number, number][], y0: number, y1: number, top = true, bottom = false) {
    const n = pts.length;
    // determine winding (signed area in x,z with z pointing "down" in top view)
    let area = 0;
    for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    const ccw = area < 0; // in x-z plane seen from +Y, counter-clockwise means negative here
    for (let i = 0; i < n; i++) {
      let a = pts[i], b = pts[(i + 1) % n];
      if (!ccw) { const t = a; a = b; b = t; }
      // walking CCW (seen from above) the outside is on the right → a is bottom-left seen from outside
      this.quad(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y1, a[1]);
    }
    if (top) this.fan(pts, y1, true);
    if (bottom) this.fan(pts, y0, false);
  }

  /** convex polygon cap (fan) at height y; up=true → normal +Y */
  fan(pts: [number, number][], y: number, up: boolean) {
    const n = pts.length;
    let area = 0;
    for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    const ccwTop = area < 0;
    for (let i = 1; i < n - 1; i++) {
      let a = pts[0], b = pts[i], c = pts[i + 1];
      if (ccwTop !== up) { const t = b; b = c; c = t; }
      this.tri(a[0], y, a[1], b[0], y, b[1], c[0], y, c[1]);
    }
  }

  /** single triangle (front = CCW) */
  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, uvs?: ArrayLike<number>) {
    // emit as degenerate quad (d = c) — keeps one code path; cost: 2 extra indices
    this.quad(ax, ay, az, bx, by, bz, cx, cy, cz, cx, cy, cz, uvs ? [uvs[0], uvs[1], uvs[2], uvs[3]] : null);
  }

  /**
   * Cylinder / cone along +Y at (x,y,z). sides 3..16. caps: 1 = top, 2 = bottom.
   * jitter > 0 displaces vertices with noise (organic, dented).
   */
  cyl(x: number, y: number, z: number, r0: number, r1: number, h: number, sides = 8, caps = 1, rot = 0, jitter = 0) {
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= sides; i++) {
      const a = rot + (i / sides) * Math.PI * 2;
      const j = jitter ? 1 + (hash1(i * 7.13 + x * 3.1 + z * 1.7) - 0.5) * jitter : 1;
      pts.push([Math.cos(a) * j, Math.sin(a) * j, a]);
    }
    pts[sides] = pts[0];
    const circ = Math.PI * (r0 + r1);
    const uvs = [0, 0, 0, 0];
    for (let i = 0; i < sides; i++) {
      const p = pts[i], q = pts[i + 1];
      // seen from outside, increasing angle runs right→left, so q (next angle) is the left edge
      uvs[0] = -((i + 1) / sides) * circ + this.uo; uvs[1] = this.vo; uvs[2] = -(i / sides) * circ + this.uo; uvs[3] = h + this.vo;
      this.quad(x + q[0] * r0, y, z + q[1] * r0, x + p[0] * r0, y, z + p[1] * r0, x + p[0] * r1, y + h, z + p[1] * r1, x + q[0] * r1, y + h, z + q[1] * r1, uvs);
    }
    if (caps & 1 && r1 > 0.001) {
      const poly: [number, number][] = []; for (let i = 0; i < sides; i++) poly.push([x + pts[i][0] * r1, z + pts[i][1] * r1]);
      this.fan(poly, y + h, true);
    }
    if (caps & 2 && r0 > 0.001) {
      const poly: [number, number][] = []; for (let i = 0; i < sides; i++) poly.push([x + pts[i][0] * r0, z + pts[i][1] * r0]);
      this.fan(poly, y, false);
    }
  }

  /** tube through a polyline of points [x,y,z,...] (cables, pipes, railings). sides 3..8 */
  tube(p: ArrayLike<number>, r: number, sides = 4, capEnds = false) {
    const n = p.length / 3;
    if (n < 2) return;
    const up = new THREE.Vector3(0, 1, 0);
    const T = new THREE.Vector3(), N = new THREE.Vector3(), Bv = new THREE.Vector3(), P = new THREE.Vector3();
    const rings: number[][] = [];
    let len = 0;
    const lens: number[] = [0];
    for (let i = 1; i < n; i++) { len += Math.hypot(p[i * 3] - p[i * 3 - 3], p[i * 3 + 1] - p[i * 3 - 2], p[i * 3 + 2] - p[i * 3 - 1]); lens.push(len); }
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      T.set(p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]).normalize();
      N.crossVectors(T, Math.abs(T.y) > 0.95 ? _n.set(1, 0, 0) : up).normalize();
      Bv.crossVectors(T, N).normalize();
      const ring: number[] = [];
      for (let s = 0; s < sides; s++) {
        const ang = (s / sides) * Math.PI * 2;
        P.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]).addScaledVector(N, Math.cos(ang) * r).addScaledVector(Bv, Math.sin(ang) * r);
        ring.push(P.x, P.y, P.z);
      }
      rings.push(ring);
    }
    const sv = this.uvMode; this.uvMode = 'face';
    for (let i = 0; i < n - 1; i++) {
      const A = rings[i], Bb = rings[i + 1];
      for (let s = 0; s < sides; s++) {
        const s2 = (s + 1) % sides;
        const u0 = lens[i], u1 = lens[i + 1];
        const v0 = (s / sides) * r * 6.28, v1 = ((s + 1) / sides) * r * 6.28;
        this.quad(A[s * 3], A[s * 3 + 1], A[s * 3 + 2], Bb[s * 3], Bb[s * 3 + 1], Bb[s * 3 + 2], Bb[s2 * 3], Bb[s2 * 3 + 1], Bb[s2 * 3 + 2], A[s2 * 3], A[s2 * 3 + 1], A[s2 * 3 + 2], [u0, v0, u1, v1]);
      }
    }
    this.uvMode = sv;
    if (capEnds) { /* cables never need caps */ }
  }

  /** catenary-ish sagging cable between two points; returns the polyline */
  static sagLine(ax: number, ay: number, az: number, bx: number, by: number, bz: number, sag: number, segs = 10, wobble = 0, seed = 0): number[] {
    const out: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const s = 4 * t * (1 - t);
      const w = wobble ? Math.sin(t * Math.PI * 2 + seed) * wobble * s : 0;
      out.push(ax + (bx - ax) * t + w * 0.3, ay + (by - ay) * t - sag * s, az + (bz - az) * t + w);
    }
    return out;
  }

  // ------------------------------------------------------------------ templates

  /** Build a template (local space) with fn(this). */
  template(fn: (w: WB) => void): Template {
    const saveT = this.target, saveM = this.M.clone(), saveStack = this.stack, saveId = this.identity;
    const t: Template = { bufs: {} };
    this.target = t; this.M.identity(); this.NM.identity(); this.stack = []; this.identity = true;
    try { fn(this); } finally {
      this.target = saveT; this.M.copy(saveM); this.NM.getNormalMatrix(this.M); this.stack = saveStack; this.identity = saveId;
    }
    return t;
  }

  /** Place a template at x,y,z with yaw (+ optional extra rotation/scale and tint multiply). */
  put(t: Template, x: number, y: number, z: number, yaw = 0, s: number | [number, number, number] = 1, opts: { tint?: number | [number, number, number]; group?: Group; rx?: number; rz?: number } = {}) {
    _q.setFromEuler(_e.set(opts.rx ?? 0, yaw, opts.rz ?? 0, 'YXZ'));
    if (typeof s === 'number') _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
    _m4.compose(_v.set(x, y, z), _q, _s);
    const m = this.identity ? _m4 : this.M.clone().multiply(_m4);
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const wx = m.elements[12], wz = m.elements[14];
    const tint = opts.tint !== undefined ? tintOf(opts.tint) : null;
    for (const k of Object.keys(t.bufs) as Kind[]) {
      const src = t.bufs[k]!;
      const B = this.target ? this.bucketAt(wx, wz, k) : this.bucketAt(wx, wz, k, opts.group ?? this.group);
      B.appendFrom(src, m, nm, tint);
      this.tris += src.ni / 3;
    }
  }

  // ------------------------------------------------------------------ finalize

  /** Create meshes. materials: kind → material. Returns meshes grouped. */
  finalize(materials: Record<Kind, THREE.Material>, opts: { shadows: Record<Kind, boolean> }): { mesh: THREE.Mesh; kind: Kind; group: Group }[] {
    const out: { mesh: THREE.Mesh; kind: Kind; group: Group }[] = [];
    for (const [key, b] of this.buckets) {
      if (!b.ni) continue;
      const [kind, group] = key.split('|') as [Kind, Group];
      const g = b.toGeometry();
      const m = new THREE.Mesh(g, materials[kind]);
      m.name = 'world:' + key;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      m.castShadow = opts.shadows[kind] && (group === 'base' || kind !== 'decal');
      m.receiveShadow = true;
      if (kind === 'decal') m.renderOrder = 1;
      out.push({ mesh: m, kind, group });
    }
    this.buckets.clear();
    return out;
  }
}

/** cheap deterministic hash → [0,1) */
export function hash1(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
export function hash2(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
