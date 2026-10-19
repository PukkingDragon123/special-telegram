import * as THREE from 'three';

/**
 * Cooking VFX: fbm-noise billboard particles for smoke / steam (alpha) and fire (additive),
 * plus the gas-burner flame shader. One InstancedMesh per blend mode → 2 draw calls for all
 * particles in the world. Everything is client-local and driven by replicated cooking data.
 */

const NOISE = /* glsl */ `
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1.,0.)), u.x), mix(h21(i+vec2(0.,1.)), h21(i+vec2(1.,1.)), u.x), u.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
`;

const PVERT = /* glsl */ `
attribute vec4 aP; // age01, seed, kind, alpha
varying vec2 vUv; varying vec4 vP;
void main(){
  vUv = uv; vP = aP;
  vec3 c = vec3(instanceMatrix[3]);
  float s = length(vec3(instanceMatrix[0]));
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  float a = aP.y * 6.2831 + aP.x * (aP.y - 0.5) * 2.5;
  vec2 p = mat2(cos(a), -sin(a), sin(a), cos(a)) * position.xy;
  mv.xy += p * s;
  gl_Position = projectionMatrix * mv;
}`;

const SMOKE_FRAG = /* glsl */ `
varying vec2 vUv; varying vec4 vP;
${NOISE}
void main(){
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float age = vP.x;
  float n = fbm(vUv * 2.6 + vec2(vP.y * 17.0, vP.y * 9.0 - age * 1.2));
  float n2 = fbm(vUv * 6.0 - vec2(age * 0.8, vP.y * 5.0));
  float mask = smoothstep(1.0, 0.15, r + (n - 0.5) * 1.1 + (n2 - 0.5) * 0.35);
  float a = mask * vP.w * smoothstep(0.0, 0.1, age) * (1.0 - smoothstep(0.45, 1.0, age));
  vec3 col = vP.z < 0.5 ? vec3(0.96, 0.97, 0.98) : (vP.z < 1.5 ? vec3(0.46, 0.44, 0.42) : vec3(0.12, 0.1, 0.09));
  col *= 0.78 + 0.32 * n;
  gl_FragColor = vec4(col, a);
}`;

const FIRE_FRAG = /* glsl */ `
varying vec2 vUv; varying vec4 vP;
${NOISE}
void main(){
  vec2 p = vUv - 0.5;
  float r = length(p * vec2(1.0, 0.8)) * 2.0;
  float age = vP.x;
  float n = fbm(vUv * 3.0 + vec2(vP.y * 13.0, -age * 4.0));
  float mask = smoothstep(1.0, 0.05, r + (n - 0.5) * 1.3);
  vec3 col = mix(vec3(1.0, 0.92, 0.55), vec3(1.0, 0.38, 0.06), clamp(age * 1.3 + r * 0.5, 0.0, 1.0));
  col = mix(col, vec3(0.5, 0.1, 0.02), smoothstep(0.7, 1.0, age));
  float a = mask * vP.w * (1.0 - smoothstep(0.5, 1.0, age)) * smoothstep(0.0, 0.06, age);
  gl_FragColor = vec4(col * 1.6, a);
}`;

type Kind = 0 | 1 | 2 | 3; // 0 steam, 1 smoke, 2 dark smoke, 3 fire

class Pool {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private px: Float32Array; private py: Float32Array; private pz: Float32Array;
  private vx: Float32Array; private vy: Float32Array; private vz: Float32Array;
  private age: Float32Array; private life: Float32Array; private s0: Float32Array; private s1: Float32Array;
  private seed: Float32Array; private kind: Float32Array; private alpha: Float32Array; private lift: Float32Array;
  private attr: THREE.InstancedBufferAttribute;
  constructor(readonly max: number, frag: string, blending: THREE.Blending) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.ShaderMaterial({ vertexShader: PVERT, fragmentShader: frag, transparent: true, depthWrite: false, blending });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.raycast = () => {};
    this.attr = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aP', this.attr);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const f = () => new Float32Array(max);
    this.px = f(); this.py = f(); this.pz = f(); this.vx = f(); this.vy = f(); this.vz = f();
    this.age = f(); this.life = f(); this.s0 = f(); this.s1 = f(); this.seed = f(); this.kind = f(); this.alpha = f(); this.lift = f();
    this.mesh.count = 0;
  }
  emit(kind: Kind, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, alpha: number, lift = 0.3) {
    let i = this.n;
    if (i >= this.max) {
      // recycle the oldest
      let oi = 0, oa = -1;
      for (let k = 0; k < this.n; k++) { const a = this.age[k] / this.life[k]; if (a > oa) { oa = a; oi = k; } }
      i = oi;
    } else this.n++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.age[i] = 0; this.life[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.seed[i] = Math.random(); this.kind[i] = kind; this.alpha[i] = alpha; this.lift[i] = lift;
  }
  update(dt: number, wind: THREE.Vector3) {
    const m = this.mesh.instanceMatrix.array as Float32Array;
    const a = this.attr.array as Float32Array;
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      const age = this.age[i] + dt;
      if (age >= this.life[i]) continue;
      // compact into slot w
      if (w !== i) {
        this.px[w] = this.px[i]; this.py[w] = this.py[i]; this.pz[w] = this.pz[i]; this.vx[w] = this.vx[i]; this.vy[w] = this.vy[i]; this.vz[w] = this.vz[i];
        this.life[w] = this.life[i]; this.s0[w] = this.s0[i]; this.s1[w] = this.s1[i]; this.seed[w] = this.seed[i]; this.kind[w] = this.kind[i]; this.alpha[w] = this.alpha[i]; this.lift[w] = this.lift[i];
      }
      this.age[w] = age;
      const drag = Math.exp(-1.6 * dt);
      this.vx[w] = this.vx[w] * drag + wind.x * dt * 0.6;
      this.vz[w] = this.vz[w] * drag + wind.z * dt * 0.6;
      this.vy[w] = this.vy[w] * Math.exp(-0.9 * dt) + this.lift[w] * dt;
      this.px[w] += this.vx[w] * dt; this.py[w] += this.vy[w] * dt; this.pz[w] += this.vz[w] * dt;
      const k = age / this.life[w];
      const s = this.s0[w] + (this.s1[w] - this.s0[w]) * Math.sqrt(k);
      const o = w * 16;
      m[o] = s; m[o + 1] = 0; m[o + 2] = 0; m[o + 3] = 0;
      m[o + 4] = 0; m[o + 5] = s; m[o + 6] = 0; m[o + 7] = 0;
      m[o + 8] = 0; m[o + 9] = 0; m[o + 10] = s; m[o + 11] = 0;
      m[o + 12] = this.px[w]; m[o + 13] = this.py[w]; m[o + 14] = this.pz[w]; m[o + 15] = 1;
      const q = w * 4;
      a[q] = k; a[q + 1] = this.seed[w]; a[q + 2] = this.kind[w]; a[q + 3] = this.alpha[w];
      w++;
    }
    this.n = w;
    this.mesh.count = w;
    if (w) { this.mesh.instanceMatrix.needsUpdate = true; this.attr.needsUpdate = true; }
  }
  clear() { this.n = 0; this.mesh.count = 0; }
}

export class CookFX {
  readonly root = new THREE.Group();
  private smoke = new Pool(260, SMOKE_FRAG, THREE.NormalBlending);
  private fire = new Pool(90, FIRE_FRAG, THREE.AdditiveBlending);
  wind = new THREE.Vector3(0.12, 0, 0.05);
  private acc = new Map<string, number>();

  constructor() {
    this.root.name = 'cookfx';
    this.root.add(this.smoke.mesh, this.fire.mesh);
  }
  attach(scene: THREE.Object3D) { scene.add(this.root); }
  detach() { this.root.removeFromParent(); this.smoke.clear(); this.fire.clear(); }

  /** Rate-based emission helper: call every frame with a rate (particles/s) and a key. */
  rate(key: string, perSec: number, dt: number, fn: () => void) {
    if (perSec <= 0) return;
    let a = (this.acc.get(key) ?? Math.random()) + perSec * dt;
    let guard = 0;
    while (a >= 1 && guard++ < 12) { a -= 1; fn(); }
    this.acc.set(key, a);
  }

  steam(p: THREE.Vector3, k = 1, spread = 0.08) {
    this.smoke.emit(0, p.x + (Math.random() - 0.5) * spread, p.y, p.z + (Math.random() - 0.5) * spread, (Math.random() - 0.5) * 0.08, 0.25 + Math.random() * 0.2, (Math.random() - 0.5) * 0.08, 1.4 + Math.random() * 0.8, 0.06 * k, 0.32 * k, 0.32, 0.25);
  }
  smokePuff(p: THREE.Vector3, k = 1, dark = false, spread = 0.1) {
    this.smoke.emit(dark ? 2 : 1, p.x + (Math.random() - 0.5) * spread, p.y, p.z + (Math.random() - 0.5) * spread, (Math.random() - 0.5) * 0.12, 0.35 + Math.random() * 0.25, (Math.random() - 0.5) * 0.12, 2.2 + Math.random() * 1.2, 0.1 * k, 0.65 * k, dark ? 0.55 : 0.4, 0.35);
  }
  /** Big flame-up over a wok (wok hei). */
  flare(p: THREE.Vector3, k = 1) {
    const n = Math.round(10 + k * 16);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 0.12;
      this.fire.emit(3, p.x + Math.cos(a) * r, p.y + 0.02, p.z + Math.sin(a) * r, Math.cos(a) * 0.3, 1.2 + Math.random() * 1.4 * k, Math.sin(a) * 0.3, 0.35 + Math.random() * 0.35, 0.1, 0.35 + 0.25 * k, 0.9, 1.5);
    }
    for (let i = 0; i < 4; i++) this.smokePuff(p.clone().add(new THREE.Vector3(0, 0.3, 0)), 1.1, false);
  }
  /** Small licking flames around a wok bottom at high heat. */
  lick(p: THREE.Vector3, k: number) {
    const a = Math.random() * Math.PI * 2, r = 0.13 + Math.random() * 0.05;
    this.fire.emit(3, p.x + Math.cos(a) * r, p.y, p.z + Math.sin(a) * r, Math.cos(a) * 0.15, 0.5 + Math.random() * 0.4, Math.sin(a) * 0.15, 0.2 + Math.random() * 0.15, 0.05, 0.12 * (0.6 + k), 0.7 * k, 0.6);
  }

  update(dt: number) {
    this.smoke.update(dt, this.wind);
    this.fire.update(dt, this.wind);
  }
}

// ------------------------------------------------------------------ gas burner flame

const FLAME_VERT = /* glsl */ `
varying vec2 vUv; varying float vH;
void main(){ vUv = uv; vH = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FLAME_FRAG = /* glsl */ `
uniform float uTime, uHeat, uWok, uOn;
varying vec2 vUv; varying float vH;
${NOISE}
void main(){
  float h = vH;
  float a = vUv.x;
  float jets = 0.55 + 0.45 * sin(a * 6.2831 * 18.0);
  float n = fbm(vec2(a * 14.0, h * 2.5 - uTime * (3.0 + uHeat * 5.0)));
  float n2 = fbm(vec2(a * 30.0 + 3.0, h * 5.0 - uTime * 7.0));
  float len = mix(0.35, 1.0, uHeat) * mix(1.0, 0.75, uWok);
  float body = 1.0 - smoothstep(len * (0.55 + 0.45 * n), len, h + (n2 - 0.5) * 0.25);
  float base = smoothstep(0.0, 0.06, h);
  float m = body * base * mix(0.6, 1.0, jets);
  vec3 blue = vec3(0.12, 0.32, 1.0);
  vec3 orange = vec3(1.0, 0.5, 0.12);
  float hot = smoothstep(0.15, 0.75, h / len + (n - 0.5) * 0.4) * (0.35 + 0.65 * uHeat);
  vec3 col = mix(blue * 1.8, orange * 2.2, hot);
  gl_FragColor = vec4(col, m * uOn * (0.45 + 0.55 * uHeat));
}`;

export function makeFlameMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uHeat: { value: 0 }, uWok: { value: 1 }, uOn: { value: 0 } },
  });
}

/** Ring of flame jets: open cone, uv.x around, uv.y up. Origin at the burner head. */
export function flameGeometry(r0 = 0.05, r1 = 0.15, h = 0.16) {
  const g = new THREE.CylinderGeometry(r1, r0, h, 36, 4, true);
  g.translate(0, h / 2, 0);
  return g;
}
