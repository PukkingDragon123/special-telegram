import * as THREE from 'three';
import { U } from './mats';

/**
 * NIGHT LIGHTS
 *  - every lamp / sign / tube / lit window registers a light POINT (cheap data)
 *  - a fixed POOL of real PointLights (count never changes → no shader recompiles) is assigned
 *    to the points nearest the camera, with smooth fades
 *  - all points also get an organic noise glow billboard (one draw call for all), street lamps
 *    get a soft dusty light cone and a ground light pool (both merged, additive)
 *  - modules can register their own THREE.Light / emissive objects (WorldAPI.addNightLight)
 */

export interface LightPoint {
  p: THREE.Vector3;
  color: THREE.Color;
  /** pool light intensity (candela-ish) */
  intensity: number;
  range: number;
  /** glow billboard size in metres (0 = none) */
  glow: number;
  kind: 'lamp' | 'sign' | 'tube' | 'window' | 'custom' | 'store';
  /** fraction lit during the day (store lights) */
  day?: number;
  /** points with a priority > 1 win pool slots more easily */
  prio?: number;
  /** optional live object (custom lights) */
  obj?: THREE.Object3D;
}

const GLOW_VERT = /* glsl */`
attribute vec3 aCenter; attribute vec2 aCorner; attribute vec4 aCol; attribute float aSize;
uniform float uNight; uniform vec3 uCam;
varying vec2 vC; varying vec4 vCol; varying float vFade; varying float vSeed;
void main() {
  vC = aCorner; vCol = aCol;
  vSeed = fract(sin(dot(aCenter, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  float dist = length(aCenter - uCam);
  // near lights are carried by real pool lights → the halo shrinks a bit but stays visible
  float sz = aSize * mix(0.75, 1.0, smoothstep(6.0, 30.0, dist)) * (1.0 + dist * 0.004);
  vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);
  mv.xy += aCorner * sz;
  mv.z += sz * 0.5; // pull toward camera a little (don't clip into lamp housings)
  vFade = mix(aCol.a, 1.0, uNight) * smoothstep(1.0, 3.0, dist);
  gl_Position = projectionMatrix * mv;
}`;
const GLOW_FRAG = /* glsl */`
uniform float uTime; uniform float uNight;
varying vec2 vC; varying vec4 vCol; varying float vFade; varying float vSeed;
float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float vn(vec2 x) { vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
void main() {
  float r = length(vC);
  if (r > 1.0) discard;
  float a = atan(vC.y, vC.x);
  // organic halo: radial falloff modulated by angular noise (no flat discs) + soft star streaks
  float n = vn(vec2(a * 2.5 + vSeed * 10.0, uTime * 0.25 + vSeed * 3.0)) * 0.35 + vn(vec2(a * 7.0, r * 3.0 - uTime * 0.4)) * 0.15;
  float core = exp(-r * r * 38.0) * 1.6;
  float halo = exp(-r * (3.2 - n * 1.6)) * (1.0 - r);
  float streak = pow(max(0.0, 1.0 - abs(vC.y) * 9.0), 3.0) * (1.0 - r) * 0.18;
  float k = (core + halo * 0.55 + streak) * vFade;
  gl_FragColor = vec4(vCol.rgb * k, 1.0);
}`;

const CONE_VERT = /* glsl */`
attribute vec4 aCol; attribute float aT;
uniform vec3 uCam;
varying vec4 vCol; varying float vT; varying vec3 vW; varying vec3 vN; varying vec3 vV;
void main() {
  vCol = aCol; vT = aT;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(uCam - w.xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const CONE_FRAG = /* glsl */`
uniform float uTime; uniform float uNight; uniform vec3 uCam;
varying vec4 vCol; varying float vT; varying vec3 vW; varying vec3 vN; varying vec3 vV;
float h31(vec3 p) { return fract(sin(dot(p, vec3(17.1, 113.7, 41.9))) * 43758.5453); }
float vn3(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z); }
void main() {
  float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
  float dust = 0.6 + 0.4 * vn3(vW * 1.7 + vec3(0.0, -uTime * 0.35, uTime * 0.1)) + 0.25 * vn3(vW * 6.0 + uTime * 0.2);
  float fall = (1.0 - vT) * (1.0 - vT) * smoothstep(0.0, 0.08, vT);
  float dist = length(uCam - vW);
  float k = edge * dust * fall * uNight * vCol.a * smoothstep(1.5, 6.0, dist) * 0.22;
  gl_FragColor = vec4(vCol.rgb * k, 1.0);
}`;

const POOL_FRAG = /* glsl */`
uniform float uNight; uniform vec3 uCam; uniform float uTime;
varying vec2 vUv2; varying vec4 vCol; varying vec3 vW;
float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float vn(vec2 x) { vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
void main() {
  float r = length(vUv2);
  if (r > 1.0) discard;
  float n = vn(vW.xz * 0.9) * 0.5 + vn(vW.xz * 3.1) * 0.25;
  float k = pow(1.0 - r, 1.8) * (0.75 + n * 0.5);
  float dist = length(uCam - vW);
  k *= uNight * vCol.a * mix(0.35, 1.0, smoothstep(10.0, 28.0, dist));
  gl_FragColor = vec4(vCol.rgb * k * 0.55, 1.0);
}`;
const POOL_VERT = /* glsl */`
attribute vec4 aCol; attribute vec2 aUv2;
varying vec2 vUv2; varying vec4 vCol; varying vec3 vW;
void main() { vUv2 = aUv2; vCol = aCol; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

export class NightLights {
  readonly points: LightPoint[] = [];
  readonly pool: THREE.PointLight[] = [];
  readonly root = new THREE.Group();
  private assigned: (LightPoint | null)[] = [];
  private fade: number[] = [];
  private timer = 0;
  private glowMesh: THREE.Mesh | null = null;
  private coneMesh: THREE.Mesh | null = null;
  private poolMesh: THREE.Mesh | null = null;
  readonly custom: { obj: THREE.Object3D; base: number; isLight: boolean; mats?: { m: any; base: number }[] }[] = [];
  readonly camU = { value: new THREE.Vector3() };
  private cones: { top: THREE.Vector3; r: number; h: number; color: THREE.Color; k: number }[] = [];
  private pools: { p: THREE.Vector3; r: number; color: THREE.Color; k: number }[] = [];

  constructor(poolSize: number) {
    this.root.name = 'night-lights';
    for (let i = 0; i < poolSize; i++) {
      const l = new THREE.PointLight(0xffa040, 0, 16, 2);
      l.castShadow = false;
      l.name = 'pool-light-' + i;
      this.pool.push(l);
      this.assigned.push(null);
      this.fade.push(0);
      this.root.add(l);
    }
  }

  add(p: LightPoint) { this.points.push(p); return p; }

  /** street lamp: point + cone + ground pool */
  lamp(top: THREE.Vector3, color: THREE.Color | number, intensity = 40, range = 20, coneR = 4.2) {
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    this.add({ p: top.clone(), color: c, intensity, range, glow: 1.5, kind: 'lamp', prio: 1.4 });
    const groundY = 0.02;
    this.cones.push({ top: top.clone(), r: coneR, h: top.y - groundY, color: c, k: 1 });
    this.pools.push({ p: new THREE.Vector3(top.x, groundY + 0.17, top.z), r: coneR * 1.9, color: c, k: 1 });
  }

  /** soft pool of light on the ground (signs, shop fronts) without a cone */
  groundPool(p: THREE.Vector3, r: number, color: THREE.Color | number, k = 1) {
    this.pools.push({ p: p.clone(), r, color: color instanceof THREE.Color ? color : new THREE.Color(color), k });
  }

  /** register a module light / emissive object */
  addCustom(obj: THREE.Object3D, intensity?: number) {
    const isLight = (obj as any).isLight;
    if (isLight) {
      const l = obj as THREE.Light;
      this.custom.push({ obj, base: intensity ?? l.intensity, isLight: true });
      l.intensity = 0;
    } else {
      const mats: { m: any; base: number }[] = [];
      obj.traverse((o: any) => {
        const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of ms) if (m.emissive) mats.push({ m, base: intensity ?? (m.emissiveIntensity || 1) });
      });
      this.custom.push({ obj, base: intensity ?? 1, isLight: false, mats });
    }
  }

  /** build the merged glow / cone / pool meshes (call once after all points are registered) */
  build() {
    // ---- glows
    const pts = this.points.filter((p) => p.glow > 0);
    if (pts.length) {
      const n = pts.length;
      const center = new Float32Array(n * 4 * 3), corner = new Float32Array(n * 4 * 2), col = new Float32Array(n * 4 * 4), size = new Float32Array(n * 4);
      const idx = new Uint32Array(n * 6);
      const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      pts.forEach((p, i) => {
        for (let k = 0; k < 4; k++) {
          const v = i * 4 + k;
          center.set([p.p.x, p.p.y, p.p.z], v * 3);
          corner.set(cs[k], v * 2);
          col.set([p.color.r, p.color.g, p.color.b, p.day ?? 0], v * 4);
          size[v] = p.glow;
        }
        idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(center.slice(), 3));
      g.setAttribute('aCenter', new THREE.BufferAttribute(center, 3));
      g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
      g.setAttribute('aCol', new THREE.BufferAttribute(col, 4));
      g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeBoundingSphere();
      const m = new THREE.ShaderMaterial({
        vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uNight: U.uNight, uTime: U.uTime, uCam: this.camU },
      });
      this.glowMesh = new THREE.Mesh(g, m);
      this.glowMesh.frustumCulled = false;
      this.glowMesh.renderOrder = 10;
      this.glowMesh.name = 'light-glows';
      this.root.add(this.glowMesh);
    }
    // ---- cones (merged open cones)
    if (this.cones.length) {
      const S = 14;
      const pos: number[] = [], nrm: number[] = [], col: number[] = [], tt: number[] = [], idx: number[] = [];
      for (const c of this.cones) {
        const base = pos.length / 3;
        for (let r = 0; r <= 1; r++) {
          for (let s = 0; s <= S; s++) {
            const a = (s / S) * Math.PI * 2;
            const rad = r === 0 ? 0.12 : c.r;
            const y = r === 0 ? c.top.y - 0.05 : c.top.y - c.h;
            pos.push(c.top.x + Math.cos(a) * rad, y, c.top.z + Math.sin(a) * rad);
            const slope = c.r / c.h;
            const n = new THREE.Vector3(Math.cos(a), slope, Math.sin(a)).normalize();
            nrm.push(n.x, n.y, n.z);
            col.push(c.color.r, c.color.g, c.color.b, c.k);
            tt.push(r);
          }
        }
        for (let s = 0; s < S; s++) {
          const a = base + s, b = base + s + 1, cc = base + S + 1 + s, d = base + S + 1 + s + 1;
          idx.push(a, cc, b, b, cc, d);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 4));
      g.setAttribute('aT', new THREE.Float32BufferAttribute(tt, 1));
      g.setIndex(idx);
      g.computeBoundingSphere();
      const m = new THREE.ShaderMaterial({
        vertexShader: CONE_VERT, fragmentShader: CONE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { uNight: U.uNight, uTime: U.uTime, uCam: this.camU },
      });
      this.coneMesh = new THREE.Mesh(g, m);
      this.coneMesh.frustumCulled = false;
      this.coneMesh.renderOrder = 9;
      this.coneMesh.name = 'light-cones';
      this.root.add(this.coneMesh);
    }
    // ---- ground pools
    if (this.pools.length) {
      const pos: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [];
      for (const p of this.pools) {
        const b = pos.length / 3;
        const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        for (const c of cs) { pos.push(p.p.x + c[0] * p.r, p.p.y, p.p.z + c[1] * p.r); uv.push(c[0], c[1]); col.push(p.color.r, p.color.g, p.color.b, p.k); }
        idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('aUv2', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 4));
      g.setIndex(idx);
      g.computeBoundingSphere();
      const m = new THREE.ShaderMaterial({
        vertexShader: POOL_VERT, fragmentShader: POOL_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
        uniforms: { uNight: U.uNight, uTime: U.uTime, uCam: this.camU },
      });
      this.poolMesh = new THREE.Mesh(g, m);
      this.poolMesh.frustumCulled = false;
      this.poolMesh.renderOrder = 2;
      this.poolMesh.name = 'light-pools';
      this.root.add(this.poolMesh);
    }
  }

  private _tmp = new THREE.Vector3();
  update(cam: THREE.Vector3, night: number, dt: number) {
    this.camU.value.copy(cam);
    const on = night > 0.02;
    this.root.visible = true;
    if (this.glowMesh) this.glowMesh.visible = on || this.points.some((p) => (p.day ?? 0) > 0);
    if (this.coneMesh) this.coneMesh.visible = on;
    if (this.poolMesh) this.poolMesh.visible = on;
    // custom module lights
    for (const c of this.custom) {
      if (c.isLight) (c.obj as THREE.Light).intensity = c.base * night;
      else if (c.mats?.length) for (const mm of c.mats) mm.m.emissiveIntensity = mm.base * night;
      else c.obj.visible = night > 0.5;
    }
    // re-assign pool every 0.25 s
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.25;
      const cand: { p: LightPoint; s: number }[] = [];
      for (const p of this.points) {
        const lit = Math.max(night, p.day ?? 0);
        if (lit <= 0.01 || p.intensity <= 0) continue;
        const d = p.p.distanceTo(cam);
        if (d > 70) continue;
        cand.push({ p, s: d / (p.prio ?? 1) });
      }
      cand.sort((a, b) => a.s - b.s);
      const want = new Set(cand.slice(0, this.pool.length).map((c) => c.p));
      // keep existing assignments that are still wanted
      for (let i = 0; i < this.pool.length; i++) {
        const a = this.assigned[i];
        if (a && !want.has(a)) this.assigned[i] = null;
        else if (a) want.delete(a);
      }
      for (const p of want) {
        const slot = this.assigned.findIndex((x) => x === null);
        if (slot < 0) break;
        this.assigned[slot] = p;
        this.fade[slot] = 0;
        const l = this.pool[slot];
        l.position.copy(p.p);
        l.color.copy(p.color);
        l.distance = p.range;
      }
    }
    for (let i = 0; i < this.pool.length; i++) {
      const a = this.assigned[i];
      const l = this.pool[i];
      if (!a) { this.fade[i] = Math.max(0, this.fade[i] - dt * 3); l.intensity *= 0.8; continue; }
      this.fade[i] = Math.min(1, this.fade[i] + dt * 2.5);
      const lit = Math.max(night, a.day ?? 0);
      l.intensity = a.intensity * lit * this.fade[i];
    }
  }
}
