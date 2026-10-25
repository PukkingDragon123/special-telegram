import * as THREE from 'three';

/**
 * RIPPLE FIELD — one small CPU wave simulation (Hugo-Elias heightfield) in a square window that
 * follows the camera (≈10 m). Every local water surface near the player (buckets, tubs, drums,
 * puddles, the canal ripple patch) samples it by WORLD xz, so a single 64–96² texture serves all
 * of them. Normals + height are packed into an RGBA8 DataTexture (linear filtering everywhere).
 * Nothing is allocated per frame.
 */
export class RippleField {
  readonly N: number;
  readonly cell: number;
  readonly span: number;
  /** world xz of texel (0,0) corner */
  ox = 0; oz = 0;
  private cur: Float32Array;
  private prev: Float32Array;
  private data: Uint8Array;
  readonly tex: THREE.DataTexture;
  readonly uniforms: { uRipTex: { value: THREE.Texture }; uRipO: { value: THREE.Vector2 }; uRipSpan: { value: number } };
  private acc = 0;
  private placed = false;
  private active = 0;  // seconds since the last disturbance (skip work when calm)
  damping = 0.982;

  constructor(N = 96, cell = 0.105) {
    this.N = N; this.cell = cell; this.span = N * cell;
    this.cur = new Float32Array(N * N);
    this.prev = new Float32Array(N * N);
    this.data = new Uint8Array(N * N * 4);
    for (let i = 0; i < N * N; i++) { this.data[i * 4] = 128; this.data[i * 4 + 1] = 128; this.data[i * 4 + 2] = 128; this.data[i * 4 + 3] = 255; }
    this.tex = new THREE.DataTexture(this.data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.LinearFilter; this.tex.minFilter = THREE.LinearFilter;
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.tex.needsUpdate = true;
    this.uniforms = { uRipTex: { value: this.tex }, uRipO: { value: new THREE.Vector2() }, uRipSpan: { value: this.span } };
  }

  /** keep the window centred on (x,z); shifts the simulation by whole cells */
  follow(x: number, z: number) {
    const N = this.N, c = this.cell;
    const tx = Math.floor((x - this.span / 2) / c) * c, tz = Math.floor((z - this.span / 2) / c) * c;
    const dxc = Math.round((tx - this.ox) / c), dzc = Math.round((tz - this.oz) / c);
    if (this.placed && Math.abs(dxc) < N / 5 && Math.abs(dzc) < N / 5) return;
    if (!this.placed || Math.abs(dxc) >= N || Math.abs(dzc) >= N) { this.cur.fill(0); this.prev.fill(0); }
    else { this.shift(this.cur, dxc, dzc); this.shift(this.prev, dxc, dzc); }
    this.placed = true;
    this.ox = tx; this.oz = tz;
    this.uniforms.uRipO.value.set(tx, tz);
  }

  private shift(a: Float32Array, dx: number, dz: number) {
    const N = this.N;
    // new(i,j) = old(i+dx, j+dz)
    if (dz >= 0) for (let j = 0; j < N; j++) this.shiftRow(a, j, j + dz, dx);
    else for (let j = N - 1; j >= 0; j--) this.shiftRow(a, j, j + dz, dx);
  }
  private shiftRow(a: Float32Array, j: number, sj: number, dx: number) {
    const N = this.N, row = j * N;
    if (sj < 0 || sj >= N) { a.fill(0, row, row + N); return; }
    const srow = sj * N;
    if (dx >= 0) { for (let i = 0; i < N; i++) { const si = i + dx; a[row + i] = si < N ? a[srow + si] : 0; } }
    else { for (let i = N - 1; i >= 0; i--) { const si = i + dx; a[row + i] = si >= 0 ? a[srow + si] : 0; } }
  }

  /** push the surface down (positive amp) around a world point */
  drop(x: number, z: number, amp: number, radius = 0.12) {
    const N = this.N, c = this.cell;
    const fx = (x - this.ox) / c, fz = (z - this.oz) / c;
    const rc = Math.max(1, radius / c);
    const i0 = Math.max(1, Math.floor(fx - rc)), i1 = Math.min(N - 2, Math.ceil(fx + rc));
    const j0 = Math.max(1, Math.floor(fz - rc)), j1 = Math.min(N - 2, Math.ceil(fz + rc));
    if (i0 > i1 || j0 > j1) return;
    const r2 = rc * rc;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = i - fx, dz = j - fz, d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const k = 1 - d2 / r2;
      this.cur[j * N + i] -= amp * k * k;
    }
    this.active = 0;
  }

  /** true if (x,z) is inside the simulated window */
  covers(x: number, z: number, pad = 0) {
    return x > this.ox + pad && x < this.ox + this.span - pad && z > this.oz + pad && z < this.oz + this.span - pad;
  }

  update(dt: number) {
    this.active += dt;
    if (this.active > 6) return;          // calm: nothing to simulate or upload
    this.acc += dt;
    const h = 1 / 45;
    let n = 0;
    while (this.acc >= h && n < 2) { this.acc -= h; n++; this.step(); }
    if (this.acc > h) this.acc = 0;
    if (n) this.encode();
  }

  private step() {
    const N = this.N, a = this.cur, b = this.prev, d = this.damping;
    for (let j = 1; j < N - 1; j++) {
      const row = j * N;
      for (let i = 1; i < N - 1; i++) {
        const k = row + i;
        b[k] = ((a[k - 1] + a[k + 1] + a[k - N] + a[k + N]) * 0.5 - b[k]) * d;
      }
    }
    this.cur = b; this.prev = a;
  }

  private encode() {
    const N = this.N, h = this.cur, D = this.data;
    for (let j = 1; j < N - 1; j++) {
      const row = j * N;
      for (let i = 1; i < N - 1; i++) {
        const k = row + i;
        let nx = (h[k - 1] - h[k + 1]) * 70, nz = (h[k - N] - h[k + N]) * 70, hh = h[k] * 120;
        nx = nx > 127 ? 127 : nx < -127 ? -127 : nx;
        nz = nz > 127 ? 127 : nz < -127 ? -127 : nz;
        hh = hh > 127 ? 127 : hh < -127 ? -127 : hh;
        const o = k * 4;
        D[o] = 128 + nx; D[o + 1] = 128 + nz; D[o + 2] = 128 + hh;
      }
    }
    this.tex.needsUpdate = true;
  }
}

/** GLSL helpers: world-xz ripple normal (xz slope) + height from the field. */
export const RIPPLE_GLSL = /* glsl */`
uniform sampler2D uRipTex; uniform vec2 uRipO; uniform float uRipSpan;
vec3 ripSample(vec2 wxz) {
  vec2 uv = (wxz - uRipO) / uRipSpan;
  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return vec3(0.0);
  vec4 t = texture2D(uRipTex, uv);
  float e = smoothstep(0.0, 0.1, uv.x) * smoothstep(1.0, 0.9, uv.x) * smoothstep(0.0, 0.1, uv.y) * smoothstep(1.0, 0.9, uv.y);
  return vec3((t.r - 0.5) * 2.0, (t.g - 0.5) * 2.0, (t.b - 0.5) * 2.0) * e;
}`;
