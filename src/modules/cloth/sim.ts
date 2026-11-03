import type { GarmentMesh } from './garments';

/* ============================================================================================
 * CLOTH SOLVER — position-based dynamics (Verlet integration + Gauss-Seidel distance constraints).
 *
 *  - stretch constraints on every triangle edge (structural + shear), stiff
 *  - bending constraints across every shared edge (opposite vertices), soft → real fabric folds
 *  - aerodynamics per triangle: F = ½ρ·Cd·A·(v_rel·n)·n with v_rel = wind − v_tri, so cloth billows,
 *    flips and flutters instead of swaying like a rigid plane
 *  - pins (pegs / hanger / bar contact) follow animated targets (moving carts drag their towel along)
 *  - collisions: capsules (bars, people), spheres, half-spaces (walls), ground; with friction
 * All state is in flat typed arrays; no allocations per step.
 * ========================================================================================== */

export interface ClothEnv {
  dt: number;
  /** wind velocity at the cloth (m/s, world) */
  wx: number; wy: number; wz: number;
  /** gust turbulence 0..1 (adds spatial variation per triangle) */
  turb: number;
  time: number;
  /** world spheres x,y,z,r (people) */
  spheres: Float32Array; nSpheres: number;
}

export class Cloth {
  readonly n: number;
  readonly x: Float32Array;
  /** initial pose (reset target if the solver ever blows up) */
  readonly rest: Float32Array;
  readonly p: Float32Array;
  readonly im: Float32Array;
  readonly f: Float32Array;
  readonly tris: Uint32Array;
  readonly nrm: Float32Array;
  /** constraints: a, b, rest, stiffness */
  private cA: Uint32Array; private cB: Uint32Array; private cR: Float32Array; private cK: Float32Array;
  private nC: number;
  /** pinned node ids + their world targets */
  pinIdx: Uint32Array;
  pinT: Float32Array;
  /** capsules ax ay az bx by bz r (world) */
  caps: Float32Array = new Float32Array(0);
  /** half-spaces nx ny nz d */
  walls: Float32Array = new Float32Array(0);
  ground = -1e9;
  /** total mass kg (distributed evenly) */
  mass: number;
  iters = 5;
  damping = 0.985;
  drag = 0.55;
  /** bounding sphere (world), updated each step */
  cx = 0; cy = 0; cz = 0; rad = 1;
  /** seconds since last motion above threshold (for sleeping) */
  calm = 0;
  private phase: number;

  constructor(readonly mesh: GarmentMesh, pos: Float32Array, pinIdx: number[], mass = 0.2, seed = 0) {
    const n = (this.n = mesh.n);
    this.x = pos;
    this.p = new Float32Array(pos);
    this.rest = new Float32Array(pos);
    this.f = new Float32Array(n * 3);
    this.nrm = new Float32Array(n * 3);
    this.im = new Float32Array(n).fill(n / Math.max(0.02, mass));
    this.mass = mass;
    this.tris = mesh.tris;
    this.phase = seed * 1.618;
    this.pinIdx = new Uint32Array(pinIdx);
    this.pinT = new Float32Array(pinIdx.length * 3);
    for (let i = 0; i < pinIdx.length; i++) { const k = pinIdx[i]; this.im[k] = 0; this.pinT.set([pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]], i * 3); }
    // ---- constraints from the pattern (rest lengths in pattern space = flat garment)
    const xy = mesh.xy;
    const edges = new Map<number, number>();           // edge key → first opposite vertex
    const A: number[] = [], B: number[] = [], R: number[] = [], K: number[] = [];
    const key = (a: number, b: number) => (a < b ? a * 65536 + b : b * 65536 + a);
    const dist = (a: number, b: number) => Math.hypot(xy[a * 2] - xy[b * 2], xy[a * 2 + 1] - xy[b * 2 + 1]);
    const t = mesh.tris;
    for (let i = 0; i < t.length; i += 3) {
      for (let e = 0; e < 3; e++) {
        const a = t[i + e], b = t[i + ((e + 1) % 3)], o = t[i + ((e + 2) % 3)];
        const k = key(a, b);
        const prev = edges.get(k);
        if (prev === undefined) { edges.set(k, o); A.push(a); B.push(b); R.push(dist(a, b)); K.push(1); }
        else if (prev >= 0) {
          // bending: across the shared edge, opposite vertex ↔ opposite vertex
          A.push(prev); B.push(o); R.push(dist(prev, o)); K.push(0.1);
          edges.set(k, -1);
        }
      }
    }
    this.nC = A.length;
    this.cA = new Uint32Array(A); this.cB = new Uint32Array(B); this.cR = new Float32Array(R); this.cK = new Float32Array(K);
    this.updateBounds();
  }

  setWalls(w: number[]) { this.walls = new Float32Array(w); }
  setCapsules(c: number[]) { this.caps = new Float32Array(c); }

  /** One simulation step. */
  step(env: ClothEnv) {
    const { x, p, im, f, n } = this;
    const dt = env.dt, dt2 = dt * dt;
    f.fill(0);
    // ---- aerodynamics per triangle
    const t = this.tris;
    const rho = 1.2 * this.drag;
    const ph = this.phase, T = env.time;
    let motion = 0;
    for (let i = 0; i < t.length; i += 3) {
      const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
      const e1x = x[b] - x[a], e1y = x[b + 1] - x[a + 1], e1z = x[b + 2] - x[a + 2];
      const e2x = x[c] - x[a], e2y = x[c + 1] - x[a + 1], e2z = x[c + 2] - x[a + 2];
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const l2 = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (l2 < 1e-12) continue;
      const area = 0.5 * l2;
      nx /= l2; ny /= l2; nz /= l2;
      // triangle velocity
      const vx = (x[a] + x[b] + x[c] - p[a] - p[b] - p[c]) / (3 * dt);
      const vy = (x[a + 1] + x[b + 1] + x[c + 1] - p[a + 1] - p[b + 1] - p[c + 1]) / (3 * dt);
      const vz = (x[a + 2] + x[b + 2] + x[c + 2] - p[a + 2] - p[b + 2] - p[c + 2]) / (3 * dt);
      // spatial turbulence: travelling ripples across the garment
      const mx = x[a], my = x[a + 1], mz = x[a + 2];
      const tw = 1 + env.turb * (0.55 * Math.sin(T * 3.1 + mx * 2.3 + mz * 1.9 + ph) + 0.35 * Math.sin(T * 5.7 - my * 3.7 + ph * 2.1));
      const rx = env.wx * tw - vx, ry = env.wy * tw - vy, rz = env.wz * tw - vz;
      const vn = rx * nx + ry * ny + rz * nz;
      const F = 0.5 * rho * area * vn * Math.abs(vn) / 3;
      f[a] += F * nx; f[a + 1] += F * ny; f[a + 2] += F * nz;
      f[b] += F * nx; f[b + 1] += F * ny; f[b + 2] += F * nz;
      f[c] += F * nx; f[c + 1] += F * ny; f[c + 2] += F * nz;
    }
    // ---- integrate (Verlet)
    const damp = this.damping;
    for (let i = 0; i < n; i++) {
      const w = im[i];
      if (w === 0) continue;
      const k = i * 3;
      const vx = (x[k] - p[k]) * damp, vy = (x[k + 1] - p[k + 1]) * damp, vz = (x[k + 2] - p[k + 2]) * damp;
      p[k] = x[k]; p[k + 1] = x[k + 1]; p[k + 2] = x[k + 2];
      x[k] += vx + f[k] * w * dt2;
      x[k + 1] += vy + (f[k + 1] * w - 9.81) * dt2;
      x[k + 2] += vz + f[k + 2] * w * dt2;
      motion += vx * vx + vy * vy + vz * vz;
    }
    // ---- pins follow their targets (moving anchors drag the cloth; their own velocity is kept)
    const pi = this.pinIdx, pt = this.pinT;
    for (let j = 0; j < pi.length; j++) {
      const k = pi[j] * 3;
      p[k] = x[k]; p[k + 1] = x[k + 1]; p[k + 2] = x[k + 2];
      x[k] = pt[j * 3]; x[k + 1] = pt[j * 3 + 1]; x[k + 2] = pt[j * 3 + 2];
    }
    // ---- constraints
    const cA = this.cA, cB = this.cB, cR = this.cR, cK = this.cK, nC = this.nC;
    for (let it = 0; it < this.iters; it++) {
      for (let c = 0; c < nC; c++) {
        const a = cA[c], b = cB[c];
        const wa = im[a], wb = im[b], ws = wa + wb;
        if (ws === 0) continue;
        const ka = a * 3, kb = b * 3;
        const dx = x[kb] - x[ka], dy = x[kb + 1] - x[ka + 1], dz = x[kb + 2] - x[ka + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < 1e-9) continue;
        const r = cR[c];
        // fabric: stiff against stretching, free to compress (buckles into folds)
        let s = (d - r) / d;
        if (s < 0) s *= cK[c] < 1 ? 1 : 0.35;
        s *= cK[c] / ws;
        x[ka] += dx * s * wa; x[ka + 1] += dy * s * wa; x[ka + 2] += dz * s * wa;
        x[kb] -= dx * s * wb; x[kb + 1] -= dy * s * wb; x[kb + 2] -= dz * s * wb;
      }
    }
    this.collide(env);
    this.calm = motion / n < 2.5e-8 ? this.calm + dt : 0;
    this.updateBounds();
    // never let a blown-up garment poison the frame (NaN pixels turn the whole post chain black)
    if (!Number.isFinite(this.cx + this.cy + this.cz)) { this.x.set(this.rest); this.p.set(this.rest); this.updateBounds(); }
  }

  private collide(env: ClothEnv) {
    const { x, p, im, n } = this;
    const caps = this.caps, walls = this.walls, sph = env.spheres, ns = env.nSpheres;
    const g = this.ground;
    for (let i = 0; i < n; i++) {
      if (im[i] === 0) continue;
      const k = i * 3;
      let px = x[k], py = x[k + 1], pz = x[k + 2];
      let hit = false;
      for (let c = 0; c < caps.length; c += 7) {
        const ax = caps[c], ay = caps[c + 1], az = caps[c + 2], bx = caps[c + 3], by = caps[c + 4], bz = caps[c + 5], r = caps[c + 6] + 0.006;
        const ex = bx - ax, ey = by - ay, ez = bz - az;
        const tt = Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey + (pz - az) * ez) / (ex * ex + ey * ey + ez * ez + 1e-12)));
        const qx = px - (ax + ex * tt), qy = py - (ay + ey * tt), qz = pz - (az + ez * tt);
        const d2 = qx * qx + qy * qy + qz * qz;
        if (d2 < r * r && d2 > 1e-12) { const d = Math.sqrt(d2), s = (r - d) / d; px += qx * s; py += qy * s; pz += qz * s; hit = true; }
      }
      for (let s = 0; s < ns; s++) {
        const o = s * 4, r = sph[o + 3];
        const qx = px - sph[o], qy = py - sph[o + 1], qz = pz - sph[o + 2];
        const d2 = qx * qx + qy * qy + qz * qz;
        if (d2 < r * r && d2 > 1e-12) { const d = Math.sqrt(d2), f = (r - d) / d; px += qx * f; py += qy * f; pz += qz * f; hit = true; }
      }
      for (let w = 0; w < walls.length; w += 4) {
        const dd = px * walls[w] + py * walls[w + 1] + pz * walls[w + 2] - walls[w + 3];
        if (dd < 0) { px -= walls[w] * dd; py -= walls[w + 1] * dd; pz -= walls[w + 2] * dd; hit = true; }
      }
      if (py < g) { py = g; hit = true; }
      if (hit) {
        // friction: kill most of the tangential velocity on contact
        x[k] = px; x[k + 1] = py; x[k + 2] = pz;
        p[k] += (px - p[k]) * 0.35; p[k + 1] += (py - p[k + 1]) * 0.35; p[k + 2] += (pz - p[k + 2]) * 0.35;
      }
    }
  }

  updateBounds() {
    const x = this.x, n = this.n;
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < n; i++) { sx += x[i * 3]; sy += x[i * 3 + 1]; sz += x[i * 3 + 2]; }
    this.cx = sx / n; this.cy = sy / n; this.cz = sz / n;
    let r2 = 0;
    for (let i = 0; i < n; i += 4) { const dx = x[i * 3] - this.cx, dy = x[i * 3 + 1] - this.cy, dz = x[i * 3 + 2] - this.cz; r2 = Math.max(r2, dx * dx + dy * dy + dz * dz); }
    this.rad = Math.sqrt(r2) + 0.05;
  }

  /** smooth vertex normals into this.nrm */
  computeNormals() {
    const x = this.x, nr = this.nrm, t = this.tris;
    nr.fill(0);
    for (let i = 0; i < t.length; i += 3) {
      const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
      const e1x = x[b] - x[a], e1y = x[b + 1] - x[a + 1], e1z = x[b + 2] - x[a + 2];
      const e2x = x[c] - x[a], e2y = x[c + 1] - x[a + 1], e2z = x[c + 2] - x[a + 2];
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      nr[a] += nx; nr[a + 1] += ny; nr[a + 2] += nz;
      nr[b] += nx; nr[b + 1] += ny; nr[b + 2] += nz;
      nr[c] += nx; nr[c + 1] += ny; nr[c + 2] += nz;
    }
    for (let i = 0; i < nr.length; i += 3) {
      const l = Math.sqrt(nr[i] * nr[i] + nr[i + 1] * nr[i + 1] + nr[i + 2] * nr[i + 2]);
      // a node whose triangles are all degenerate would get a zero normal → normalize(0) = NaN in the shader,
      // and one NaN pixel spreads through bloom into a black frame: give it a valid normal
      if (!(l > 1e-12)) { nr[i] = 0; nr[i + 1] = 1; nr[i + 2] = 0; continue; }
      nr[i] /= l; nr[i + 1] /= l; nr[i + 2] /= l;
    }
  }
}
