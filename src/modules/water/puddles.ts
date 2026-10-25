import * as THREE from 'three';
import { Assets } from '../../core/assets';
import { RIPPLE_GLSL } from './ripples';
import { SHARED } from './surface';
import { FXU } from './fx';
import { U as WU } from '../world/mats';

/**
 * PUDDLES (local, every peer): spreading wet decals from spills, pours and awning drips. One
 * InstancedMesh. Shape = the alpha of the street-puddle mask atlas (textures/world/decal_puddles,
 * traced from real puddle photos) + noise; surface = the street's planar reflection
 * (world/reflect.ts, when on) or the HDRI-ish sky colour, rippled by the shared heightfield.
 * Puddles grow with the water poured into them, dry slowly, and creep toward + swirl into drains.
 */

const MAX = 40;

export interface Puddle {
  x: number; z: number; y: number;
  vol: number;            // litres
  rot: number; cell: number; seed: number;
  wet: number;            // 0..1 visual fade-in
  stretch: number; dir: number;
  drain: { x: number; z: number; y: number } | null;
  draining: boolean;
  src: 'spill' | 'drip';
}

const VERT = /* glsl */`
attribute vec4 aPud;   // wet, cell, seed, stretch
varying vec2 vUv; varying vec3 vWP; varying vec4 vPud;
void main() {
  vUv = uv; vPud = aPud;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FRAG = /* glsl */`
uniform sampler2D uMask; uniform sampler2D uNM; uniform float uTime; uniform float uLit;
uniform sampler2D uRefl; uniform mat4 uReflMat; uniform float uReflOn; uniform vec3 uSky; uniform vec3 uSunDir;
varying vec2 vUv; varying vec3 vWP; varying vec4 vPud;
${RIPPLE_GLSL}
float ph(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float pn(vec2 x) { vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(mix(ph(i), ph(i + vec2(1, 0)), f.x), mix(ph(i + vec2(0, 1)), ph(i + vec2(1, 1)), f.x), f.y); }
void main() {
  float cell = vPud.y;
  vec2 cuv = vec2(mod(cell, 2.0), floor(cell / 2.0)) * 0.5 + vUv * 0.5;
  float m = texture2D(uMask, cuv).a;
  // soft blob fallback so tiny fresh puddles are round-ish, plus noisy edge
  float blob = 1.0 - smoothstep(0.25, 0.5, length(vUv - 0.5));
  float n = pn(vWP.xz * 9.0 + vPud.z * 13.0) * 0.6 + pn(vWP.xz * 23.0) * 0.4;
  float shape = max(m, blob * 0.85) + (n - 0.5) * 0.35;
  float wet = vPud.x;
  float a = smoothstep(0.42, 0.58, shape) * wet;
  float damp = smoothstep(0.15, 0.45, shape) * wet;          // darker wet rim around the water
  if (damp < 0.01) discard;
  // surface normal: fine real ripple-photo normals + heightfield rings
  vec3 rp = ripSample(vWP.xz);
  vec2 nm = (texture2D(uNM, vWP.xz * 1.6 + uTime * 0.02).xy * 2.0 - 1.0) * 0.05;
  vec2 sl = nm + rp.xy * 1.2;
  vec3 V = normalize(cameraPosition - vWP);
  vec3 N = normalize(vec3(sl.x, 1.0, sl.y));
  float cosT = clamp(dot(N, V), 0.0, 1.0);
  float fres = mix(0.3, 1.0, pow(1.0 - cosT, 2.2));
  vec3 refl;
  if (uReflOn > 0.5) {
    vec4 pr = uReflMat * vec4(vWP, 1.0);
    vec2 ruv = pr.xy / pr.w + sl * 0.12;
    refl = texture2D(uRefl, ruv).rgb;
  } else {
    vec3 R = reflect(-V, N);
    refl = mix(uSky * 0.55, uSky * 1.1, smoothstep(-0.1, 0.6, R.y));
    float sp = pow(max(0.0, dot(R, normalize(uSunDir))), 180.0);
    refl += sp * 2.0 * uLit;
  }
  vec3 water = vec3(0.035, 0.038, 0.034) * uLit;
  vec3 col = mix(water, refl, fres * a);
  float alpha = max(a * 0.92, damp * 0.42);
  gl_FragColor = vec4(mix(vec3(0.0), col, a / max(alpha, 0.001)), alpha);
  #include <colorspace_fragment>
}`;

export class Puddles {
  readonly list: Puddle[] = [];
  readonly mesh: THREE.InstancedMesh;
  private attr: THREE.InstancedBufferAttribute;
  private mat: THREE.ShaderMaterial;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  readonly sky = { value: new THREE.Color(0xa8b0b4) };
  /** drains: world-published + our own (set by index) */
  drains: { x: number; z: number; y: number }[] = [];
  onSwirl: ((d: { x: number; z: number; y: number }, k: number, dt: number) => void) | null = null;

  constructor() {
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    this.attr = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPud', this.attr);
    const nm = Assets.texture('textures/pbr/water_ripples_puddle/normal.jpg', { srgb: false });
    nm.wrapS = nm.wrapT = THREE.RepeatWrapping;
    const mask = Assets.texture('textures/world/decal_puddles.png', { srgb: true });
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      uniforms: {
        uMask: { value: mask }, uNM: { value: nm }, uTime: SHARED.uTime, uLit: FXU.uLit,
        uRipTex: SHARED.uRipTex, uRipO: SHARED.uRipO, uRipSpan: SHARED.uRipSpan,
        uRefl: WU?.uRefl ?? { value: null }, uReflMat: WU?.uReflMat ?? { value: new THREE.Matrix4() }, uReflOn: WU?.uReflOn ?? { value: 0 },
        uSky: this.sky, uSunDir: WU?.uSunDir ?? { value: new THREE.Vector3(0.3, 1, 0.2) },
      },
    });
    this.mesh = new THREE.InstancedMesh(g, this.mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.count = 0;
    this.mesh.name = 'water-puddles';
  }

  static radius(vol: number) { return Math.min(2.0, Math.sqrt(Math.max(0.02, vol) * 0.001 / (Math.PI * 0.0035)) + 0.06); }

  /** pour `litres` onto the ground at x,y,z (merges into a nearby puddle) */
  add(x: number, y: number, z: number, litres: number, src: Puddle['src'] = 'spill') {
    if (litres <= 0) return null;
    let best: Puddle | null = null, bd = 1e9;
    for (const p of this.list) {
      if (Math.abs(p.y - y) > 0.25) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < Puddles.radius(p.vol) + 0.25 && d < bd) { best = p; bd = d; }
    }
    if (best) {
      const k = litres / (best.vol + litres);
      best.x += (x - best.x) * k * 0.5; best.z += (z - best.z) * k * 0.5;
      best.vol += litres;
      return best;
    }
    if (this.list.length >= MAX) {
      // recycle the smallest
      let si = 0; for (let i = 1; i < this.list.length; i++) if (this.list[i].vol < this.list[si].vol) si = i;
      this.list.splice(si, 1);
    }
    const seed = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
    const p: Puddle = { x, z, y, vol: litres, rot: seed * 6.28, cell: Math.floor(seed * 7.7) % 4, seed, wet: 0, stretch: 1, dir: 0, drain: null, draining: false, src };
    // nearest drain within reach → the puddle will creep to it
    let dd = 3.2;
    for (const d of this.drains) { const k = Math.hypot(d.x - x, d.z - z); if (k < dd && Math.abs(d.y - y) < 0.4) { dd = k; p.drain = d; } }
    this.list.push(p);
    return p;
  }

  /** is (x,z) inside a puddle at height ~y? returns the puddle depth factor 0..1 */
  wetAt(x: number, y: number, z: number): Puddle | null {
    for (const p of this.list) {
      if (Math.abs(p.y - y) > 0.3 || p.vol < 0.1) continue;
      const r = Puddles.radius(p.vol) * 0.75;
      if ((p.x - x) ** 2 + (p.z - z) ** 2 < r * r) return p;
    }
    return null;
  }

  update(dt: number, rain: number) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.wet = Math.min(1, p.wet + dt * 3);
      // evaporation (none in the rain, slow in the shade/sun)
      if (rain < 0.05) p.vol -= p.vol * dt / (p.src === 'drip' ? 90 : 170) + dt * 0.002;
      if (p.drain) {
        const dx = p.drain.x - p.x, dz = p.drain.z - p.z, d = Math.hypot(dx, dz);
        p.dir = Math.atan2(dx, dz);
        const r = Puddles.radius(p.vol);
        if (d > 0.25) { const sp = Math.min(0.35, 0.08 + p.vol * 0.02) * dt; p.x += dx / d * sp; p.z += dz / d * sp; }
        p.stretch = 1 + Math.min(1.2, d / Math.max(0.3, r) * 0.5);
        p.draining = d < r * 0.8 + 0.2;
        if (p.draining) {
          const out = Math.min(p.vol, dt * (0.6 + p.vol * 0.12));
          p.vol -= out;
          this.onSwirl?.(p.drain, Math.min(1, out / dt / 1.5), dt);
        }
      }
      if (p.vol < 0.04) L.splice(i, 1);
    }
    this.write();
  }

  private write() {
    const L = this.list;
    let n = 0;
    for (const p of L) {
      if (n >= MAX) break;
      const r = Puddles.radius(p.vol);
      const fade = Math.min(1, p.vol / 0.25);
      this.p.set(p.x, p.y + 0.012, p.z);
      // stretch toward the drain: rotate so local z points at it
      this.q.setFromAxisAngle(this.up, p.drain ? p.dir : p.rot);
      this.s.set(r * 2 / Math.sqrt(p.stretch), 1, r * 2 * Math.sqrt(p.stretch) * (p.drain ? 1 : 0.85));
      this.m4.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(n, this.m4);
      this.attr.setXYZW(n, p.wet * fade, p.cell, p.seed, p.stretch);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.attr.needsUpdate = true;
  }
}
