import * as THREE from 'three';

/**
 * WATER FX (local, every peer, deterministic-enough, zero per-frame allocation):
 *  - Droplets: ONE InstancedMesh; ballistic CPU sim; each droplet is stretched along its velocity.
 *  - Crowns: ONE InstancedMesh of an open cylinder; a shader grows a spiky, thinning splash crown.
 *  - Rings: ONE InstancedMesh of quads; expanding ripple rings on water surfaces / puddles.
 *  - Streams: a few pre-allocated ribbon meshes along a parabola with a scrolling noise shader
 *    (taps, hose, pouring, spills).
 */

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export const FXU = {
  uTime: { value: 0 },
  /** 1 by day, ~0.3 at night (unlit shaders) */
  uLit: { value: 1 },
  uTint: { value: new THREE.Color(0xd6e4ea) },
};

export type LandFn = (x: number, y: number, z: number, size: number, kind: number) => void;

// ------------------------------------------------------------------ droplets
export class Droplets {
  readonly mesh: THREE.InstancedMesh;
  private N: number;
  private P: Float32Array; private V: Float32Array;
  private life: Float32Array; private size: Float32Array; private floor: Float32Array; private kind: Uint8Array;
  private head = 0;
  private alive = 0;
  onLand: LandFn | null = null;

  constructor(N: number) {
    this.N = N;
    const g = new THREE.SphereGeometry(1, 6, 4);
    const m = new THREE.MeshStandardMaterial({ color: 0xe4f0f4, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.72, depthWrite: false, envMapIntensity: 1.4 });
    m.name = 'water-droplet';
    this.mesh = new THREE.InstancedMesh(g, m, N);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'water-droplets';
    this.mesh.renderOrder = 4;
    for (let i = 0; i < N; i++) this.mesh.setMatrixAt(i, ZERO);
    this.P = new Float32Array(N * 3); this.V = new Float32Array(N * 3);
    this.life = new Float32Array(N); this.size = new Float32Array(N); this.floor = new Float32Array(N); this.kind = new Uint8Array(N);
    this.mesh.visible = false;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, floorY: number, kind = 0, life = 2.5) {
    const i = this.head; this.head = (this.head + 1) % this.N;
    if (this.life[i] <= 0) this.alive++;
    const o = i * 3;
    this.P[o] = x; this.P[o + 1] = y; this.P[o + 2] = z;
    this.V[o] = vx; this.V[o + 1] = vy; this.V[o + 2] = vz;
    this.life[i] = life; this.size[i] = size; this.floor[i] = floorY; this.kind[i] = kind;
    this.mesh.visible = true;
  }

  update(dt: number) {
    if (this.alive <= 0) { if (this.mesh.visible) this.mesh.visible = false; return; }
    const P = this.P, V = this.V;
    let alive = 0;
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) continue;
      const o = i * 3;
      this.life[i] -= dt;
      V[o + 1] -= 9.81 * dt;
      const drag = 1 - Math.min(0.5, dt * 0.6);
      V[o] *= drag; V[o + 2] *= drag;
      P[o] += V[o] * dt; P[o + 1] += V[o + 1] * dt; P[o + 2] += V[o + 2] * dt;
      if (P[o + 1] <= this.floor[i] || this.life[i] <= 0) {
        if (P[o + 1] <= this.floor[i] && this.life[i] > 0) this.onLand?.(P[o], this.floor[i], P[o + 2], this.size[i], this.kind[i]);
        this.life[i] = 0;
        this.mesh.setMatrixAt(i, ZERO);
        continue;
      }
      alive++;
      const sp = Math.hypot(V[o], V[o + 1], V[o + 2]);
      const s = this.size[i];
      if (sp > 0.05) { _d.set(V[o] / sp, V[o + 1] / sp, V[o + 2] / sp); _q.setFromUnitVectors(UP, _d); }
      else _q.identity();
      _s.set(s, s * (1 + Math.min(4, sp * 0.45)), s);
      _p.set(P[o], P[o + 1], P[o + 2]);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    this.alive = alive;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ crowns
const CROWN_VERT = /* glsl */`
attribute vec3 aCrown;   // age 0..1, seed, thickness
uniform float uTime;
varying float vY; varying float vA; varying vec3 vN; varying vec3 vVD;
void main() {
  float t = aCrown.x, sd = aCrown.y;
  float ang = atan(position.z, position.x);
  float y = position.y;                       // 0..1
  float spikes = 0.55 + 0.45 * abs(sin(ang * 7.0 + sd * 6.0)) * (0.7 + 0.3 * sin(ang * 13.0 - sd * 3.0));
  float rise = sin(3.14159 * min(1.0, t * 1.25));
  float h = rise * mix(0.75, 1.15, spikes) * (1.0 - t * 0.35);
  float rad = mix(0.35, 1.0, sqrt(t)) + y * (0.25 + t * 0.55) * spikes;
  vec3 p = vec3(cos(ang) * rad, y * h, sin(ang) * rad);
  vY = y; vA = (1.0 - smoothstep(0.55, 1.0, t)) * (0.85 - y * 0.45 * (1.0 - spikes));
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vN = normalize(mat3(modelMatrix * instanceMatrix) * vec3(cos(ang), 0.35, sin(ang)));
  vVD = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const CROWN_FRAG = /* glsl */`
uniform float uLit; uniform vec3 uTint;
varying float vY; varying float vA; varying vec3 vN; varying vec3 vVD;
void main() {
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vVD))), 2.0);
  vec3 c = uTint * (0.55 + 0.45 * vY) + fres * 0.35;
  float a = vA * (0.35 + fres * 0.55);
  gl_FragColor = vec4(c * uLit, a);
}`;

export class Crowns {
  readonly mesh: THREE.InstancedMesh;
  private N: number;
  private age: Float32Array; private dur: Float32Array;
  private attr: THREE.InstancedBufferAttribute;
  private head = 0; private alive = 0;
  constructor(N = 16) {
    this.N = N;
    const g = new THREE.CylinderGeometry(1, 1, 1, 28, 4, true);
    g.translate(0, 0.5, 0);
    this.attr = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aCrown', this.attr);
    const m = new THREE.ShaderMaterial({ vertexShader: CROWN_VERT, fragmentShader: CROWN_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uTime: FXU.uTime, uLit: FXU.uLit, uTint: FXU.uTint } });
    this.mesh = new THREE.InstancedMesh(g, m, N);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.name = 'water-crowns';
    for (let i = 0; i < N; i++) this.mesh.setMatrixAt(i, ZERO);
    this.age = new Float32Array(N).fill(2); this.dur = new Float32Array(N).fill(0.5);
    this.mesh.visible = false;
  }
  spawn(x: number, y: number, z: number, radius: number, height: number, dur = 0.55) {
    const i = this.head; this.head = (this.head + 1) % this.N;
    this.age[i] = 0; this.dur[i] = dur;
    this.attr.setXYZ(i, 0, Math.random() * 10, 1);
    _p.set(x, y, z); _q.setFromAxisAngle(UP, Math.random() * 6.28); _s.set(radius, height, radius);
    _m.compose(_p, _q, _s);
    this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alive++;
    this.mesh.visible = true;
  }
  update(dt: number) {
    if (this.alive <= 0) { this.mesh.visible = false; return; }
    let alive = 0;
    for (let i = 0; i < this.N; i++) {
      if (this.age[i] >= 1) continue;
      this.age[i] += dt / this.dur[i];
      if (this.age[i] >= 1) { this.mesh.setMatrixAt(i, ZERO); this.mesh.instanceMatrix.needsUpdate = true; continue; }
      alive++;
      this.attr.setX(i, this.age[i]);
    }
    this.attr.needsUpdate = true;
    this.alive = alive;
  }
}

// ------------------------------------------------------------------ rings
const RING_VERT = /* glsl */`
attribute vec2 aRing;   // age 0..1, strength
varying vec2 vUv; varying vec2 vR;
void main() { vUv = uv; vR = aRing; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }`;
const RING_FRAG = /* glsl */`
uniform float uLit; uniform vec3 uTint;
varying vec2 vUv; varying vec2 vR;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float t = vR.x;
  float rr = mix(0.08, 1.0, sqrt(t));
  float w = 0.05 + 0.08 * t;
  float ring = smoothstep(w, 0.0, abs(r - rr)) + 0.55 * smoothstep(w * 0.8, 0.0, abs(r - rr * 0.62)) * step(0.25, t);
  float a = ring * (1.0 - t) * (1.0 - t) * vR.y;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uTint * uLit * 1.15, a * 0.55);
}`;

export class Rings {
  readonly mesh: THREE.InstancedMesh;
  private N: number;
  private age: Float32Array; private dur: Float32Array;
  private attr: THREE.InstancedBufferAttribute;
  private head = 0; private alive = 0;
  constructor(N = 64) {
    this.N = N;
    const g = new THREE.PlaneGeometry(2, 2);
    g.rotateX(-Math.PI / 2);
    this.attr = new THREE.InstancedBufferAttribute(new Float32Array(N * 2), 2);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aRing', this.attr);
    const m = new THREE.ShaderMaterial({ vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false, uniforms: { uLit: FXU.uLit, uTint: FXU.uTint }, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.InstancedMesh(g, m, N);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.name = 'water-rings';
    for (let i = 0; i < N; i++) this.mesh.setMatrixAt(i, ZERO);
    this.age = new Float32Array(N).fill(2); this.dur = new Float32Array(N).fill(1);
    this.mesh.visible = false;
  }
  spawn(x: number, y: number, z: number, radius: number, strength = 1, dur = 1.2) {
    const i = this.head; this.head = (this.head + 1) % this.N;
    this.age[i] = 0; this.dur[i] = dur;
    this.attr.setXY(i, 0, Math.min(1, strength));
    _p.set(x, y + 0.004, z); _q.identity(); _s.set(radius, 1, radius);
    _m.compose(_p, _q, _s);
    this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alive++;
    this.mesh.visible = true;
  }
  update(dt: number) {
    if (this.alive <= 0) { this.mesh.visible = false; return; }
    let alive = 0;
    for (let i = 0; i < this.N; i++) {
      if (this.age[i] >= 1) continue;
      this.age[i] += dt / this.dur[i];
      if (this.age[i] >= 1) { this.mesh.setMatrixAt(i, ZERO); this.mesh.instanceMatrix.needsUpdate = true; continue; }
      alive++;
      this.attr.setX(i, this.age[i]);
    }
    this.attr.needsUpdate = true;
    this.alive = alive;
  }
}

// ------------------------------------------------------------------ streams
const SEG = 18;
const STREAM_VERT = /* glsl */`
attribute float aV; attribute float aSide;
varying vec2 vUv; varying vec3 vWP;
void main() { vUv = vec2(aSide, aV); vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const STREAM_FRAG = /* glsl */`
uniform float uTime; uniform float uLit; uniform vec3 uTint; uniform float uFlow; uniform float uLen; uniform float uMurk;
varying vec2 vUv; varying vec3 vWP;
float sh(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float sn(vec2 x) { vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(mix(sh(i), sh(i + vec2(1, 0)), f.x), mix(sh(i + vec2(0, 1)), sh(i + vec2(1, 1)), f.x), f.y); }
void main() {
  float x = vUv.x;                         // -1..1 across
  float v = vUv.y * uLen;                  // metres along the stream
  float sc = v * 7.0 - uTime * 9.0 * uFlow;
  float n = sn(vec2(x * 3.0, sc)) * 0.6 + sn(vec2(x * 7.0 + 3.0, sc * 2.3)) * 0.4;
  float breakup = smoothstep(0.55, 1.0, vUv.y) * 0.55;
  float edge = 1.0 - smoothstep(0.35 + n * 0.45 - breakup, 1.0, abs(x));
  float core = 1.0 - smoothstep(0.0, 0.55, abs(x + (n - 0.5) * 0.3));
  float streak = smoothstep(0.45, 0.85, sn(vec2(x * 11.0, sc * 0.6)));
  float a = edge * (0.42 + core * 0.3 + streak * 0.25) * (1.0 - breakup * (n * 0.9));
  a *= smoothstep(0.0, 0.04, vUv.y);
  vec3 c = mix(uTint, vec3(0.52, 0.46, 0.34), uMurk) * (0.62 + core * 0.35 + streak * 0.35);
  gl_FragColor = vec4(c * uLit, clamp(a, 0.0, 0.92));
}`;

export class Stream {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  active = false;
  /** world end point of the last update */
  readonly end = new THREE.Vector3();
  readonly start = new THREE.Vector3();
  constructor() {
    const n = (SEG + 1) * 2;
    this.pos = new Float32Array(n * 3);
    const v = new Float32Array(n), side = new Float32Array(n);
    const idx: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      v[i * 2] = v[i * 2 + 1] = i / SEG;
      side[i * 2] = -1; side[i * 2 + 1] = 1;
      if (i < SEG) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    this.geo = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(this.pos, 3); pa.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', pa);
    this.geo.setAttribute('aV', new THREE.BufferAttribute(v, 1));
    this.geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    this.geo.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: STREAM_VERT, fragmentShader: STREAM_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uTime: FXU.uTime, uLit: FXU.uLit, uTint: FXU.uTint, uFlow: { value: 1 }, uLen: { value: 1 }, uMurk: { value: 0 } },
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 6;
    this.mesh.name = 'water-stream';
  }

  /**
   * Parabolic stream from p0 with initial velocity v0 down to the plane y = yEnd (or `tMax` s).
   * width0 → width1 across, faced to the camera. Returns flight time.
   */
  set(p0: THREE.Vector3, v0: THREE.Vector3, yEnd: number, width0: number, width1: number, cam: THREE.Vector3, murk = 0, tMax = 2): number {
    // solve y0 + vy t - 4.905 t^2 = yEnd
    const a = -4.905, b = v0.y, c = p0.y - yEnd;
    const disc = b * b - 4 * a * c;
    let T = disc > 0 ? (-b - Math.sqrt(disc)) / (2 * a) : tMax;
    if (!(T > 0)) T = 0.05;
    T = Math.min(T, tMax);
    this.start.copy(p0);
    let len = 0, lx = p0.x, ly = p0.y, lz = p0.z;
    for (let i = 0; i <= SEG; i++) {
      const t = (i / SEG) * T;
      const x = p0.x + v0.x * t, y = p0.y + v0.y * t - 4.905 * t * t, z = p0.z + v0.z * t;
      // tangent
      const tx = v0.x, ty = v0.y - 9.81 * t, tz = v0.z;
      // side = normalize(tangent × viewdir)
      const vx = cam.x - x, vy = cam.y - y, vz = cam.z - z;
      let sx = ty * vz - tz * vy, sy = tz * vx - tx * vz, sz = tx * vy - ty * vx;
      const sl = Math.hypot(sx, sy, sz) || 1;
      const w = (width0 + (width1 - width0) * (i / SEG)) * 0.5;
      sx = (sx / sl) * w; sy = (sy / sl) * w; sz = (sz / sl) * w;
      const o = i * 6;
      this.pos[o] = x - sx; this.pos[o + 1] = y - sy; this.pos[o + 2] = z - sz;
      this.pos[o + 3] = x + sx; this.pos[o + 4] = y + sy; this.pos[o + 5] = z + sz;
      if (i > 0) len += Math.hypot(x - lx, y - ly, z - lz);
      lx = x; ly = y; lz = z;
      if (i === SEG) this.end.set(x, y, z);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.mat.uniforms.uLen.value = len;
    this.mat.uniforms.uFlow.value = 0.6 + Math.min(1.5, v0.length() * 0.4);
    this.mat.uniforms.uMurk.value = murk;
    this.mesh.visible = true;
    this.active = true;
    return T;
  }
  hide() { this.mesh.visible = false; this.active = false; }
}

// ------------------------------------------------------------------ drain swirls
const SWIRL_FRAG = /* glsl */`
uniform float uTime; uniform float uLit; uniform vec3 uTint;
varying vec2 vUv; varying vec2 vR;
void main() {
  vec2 c = vUv - 0.5; float r = length(c) * 2.0;
  if (r > 1.0) discard;
  float a = atan(c.y, c.x);
  float arms = sin(a * 3.0 + log(r + 0.05) * 7.0 + uTime * 9.0 * (0.5 + vR.y));
  float s = smoothstep(0.2, 0.95, arms) * smoothstep(1.0, 0.45, r) * smoothstep(0.02, 0.18, r);
  float hole = 1.0 - smoothstep(0.0, 0.22, r);
  float al = (s * 0.6 + hole * 0.5) * vR.y;
  if (al < 0.01) discard;
  vec3 col = mix(uTint * 1.1, vec3(0.05, 0.06, 0.05), hole);
  gl_FragColor = vec4(col * uLit, al);
}`;

export class Swirls {
  readonly mesh: THREE.InstancedMesh;
  private attr: THREE.InstancedBufferAttribute;
  private slots: { x: number; y: number; z: number; k: number; t: number }[] = [];
  constructor(private N = 6) {
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    this.attr = new THREE.InstancedBufferAttribute(new Float32Array(N * 2), 2);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aRing', this.attr);
    const m = new THREE.ShaderMaterial({ vertexShader: RING_VERT, fragmentShader: SWIRL_FRAG, transparent: true, depthWrite: false, uniforms: { uTime: FXU.uTime, uLit: FXU.uLit, uTint: FXU.uTint }, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.mesh = new THREE.InstancedMesh(g, m, N);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.count = 0;
    this.mesh.name = 'water-swirls';
  }
  /** keep a swirl alive at a drain (strength k 0..1) */
  feed(x: number, y: number, z: number, k: number) {
    let s = this.slots.find((o) => Math.abs(o.x - x) < 0.05 && Math.abs(o.z - z) < 0.05);
    if (!s) { if (this.slots.length >= this.N) return; s = { x, y, z, k: 0, t: 0 }; this.slots.push(s); }
    s.k = Math.min(1, Math.max(s.k, k)); s.t = 0.5;
  }
  update(dt: number) {
    let n = 0;
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const s = this.slots[i];
      s.t -= dt;
      if (s.t <= 0) s.k = Math.max(0, s.k - dt * 1.5);
      if (s.k <= 0.01 && s.t <= 0) { this.slots.splice(i, 1); continue; }
    }
    for (const s of this.slots) {
      _p.set(s.x, s.y + 0.016, s.z); _q.identity(); const r = 0.32 + s.k * 0.18; _s.set(r, 1, r);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(n, _m);
      this.attr.setXY(n, 0, s.k);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.attr.needsUpdate = true;
  }
  active() { return this.slots; }
}
