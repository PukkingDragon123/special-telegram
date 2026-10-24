import * as THREE from 'three';
import { RNG } from '../../core/rng';

/* ============================================================================================
 * THE THOUGHT CLOUD — a big, soft, volumetric-looking cloud made of displaced icospheres
 * (fbm noise in the vertex shader, churning slowly), all merged into ONE draw call.
 * Shading: wrap diffuse + back-light translucency (subsurface-ish), fresnel rim glow, crease
 * occlusion from the displacement, cream-top / lavender-bottom dream gradient, micro fluff.
 * The front is open (an alcove of puffs) so a dream scene can live inside it.
 * Trailing puffs lead down to the thinker's head and pop in one by one (uAppear).
 *
 * Cloud-local frame: +Y up, +Z faces the viewer (the opening), origin = centre of the cloud.
 * ========================================================================================== */

const NOISE = /* glsl */ `
float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.07 + 3.1; a *= 0.5; } return s; }
float fbm2(vec3 p) { return 0.62 * vn(p) + 0.38 * vn(p * 2.3 + 1.7); }
`;

const vert = /* glsl */ `
attribute vec3 aCenter;
attribute vec3 aInfo;   // x radius, y seed, z appear delay (0..1)
uniform float uTime, uAppear, uChurn, uPop;
varying vec3 vN, vW, vL;
varying float vCrease, vSeed;
${NOISE}
float disp(vec3 d) {
  vec3 q = d * 1.7 + vec3(aInfo.y * 7.0, uTime * 0.11 * uChurn, aInfo.y * 3.0);
  return 0.78 + 0.42 * fbm(q) + 0.07 * sin(uTime * 0.6 + aInfo.y * 9.0);
}
void main() {
  float ap = clamp((uAppear - aInfo.z) / 0.22, 0.0, 1.0);
  // elastic pop-in
  float pop = ap <= 0.0 ? 0.0 : 1.0 + sin(ap * 9.0) * exp(-ap * 5.0) * 0.35 * uPop - (1.0 - ap) * (1.0 - ap);
  float r = aInfo.x * max(pop, 0.0);
  vec3 d = normalize(position);
  float h = disp(d);
  // neighbour samples for a smooth displaced normal
  vec3 t1 = normalize(cross(d, abs(d.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 t2 = cross(d, t1);
  float e = 0.08;
  vec3 dA = normalize(d + t1 * e), dB = normalize(d + t2 * e);
  vec3 P = d * h, A = dA * disp(dA), B = dB * disp(dB);
  vec3 n = normalize(cross(A - P, B - P));
  if (dot(n, d) < 0.0) n = -n;
  vec3 local = aCenter + P * r;
  vec4 w = modelMatrix * vec4(local, 1.0);
  vW = w.xyz;
  vL = local;
  vN = normalize(mat3(modelMatrix) * n);
  vCrease = h;
  vSeed = aInfo.y;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const frag = /* glsl */ `
uniform vec3 uLight, uTop, uBottom, uRim, uGlow, uInner;
uniform float uTime, uOpacity, uNight;
varying vec3 vN, vW, vL;
varying float vCrease, vSeed;
${NOISE}
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  if (!gl_FrontFacing) N = -N;
  vec3 L = normalize(uLight);
  float wrap = 0.6;
  float dif = clamp((dot(N, L) + wrap) / (1.0 + wrap), 0.0, 1.0);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.6);
  // translucency: light coming through thin edges toward the viewer
  float sss = pow(clamp(dot(V, -L), 0.0, 1.0), 3.0) * (0.35 + 0.65 * fres);
  float hgt = smoothstep(-1.1, 1.1, vL.y);
  vec3 base = mix(uBottom, uTop, hgt);
  float crease = smoothstep(0.72, 1.12, vCrease);
  float fluff = fbm2(vW * 7.0 + vec3(0.0, uTime * 0.05, vSeed));
  float ao = mix(0.42, 1.0, crease) * (0.88 + 0.24 * fluff);
  // inward-facing back wall glows like the inside of a dream
  float inner = smoothstep(-0.3, -1.0, vL.z) * smoothstep(1.7, 0.2, length(vL.xy * vec2(0.7, 1.0)));
  vec3 col = base * (0.46 + 0.44 * dif) * ao;
  col += uInner * inner * 0.18 * (0.8 + 0.4 * fluff);
  col += uRim * fres * 0.32;
  col += uGlow * sss * 0.3;
  col = mix(col, col * vec3(0.78, 0.8, 1.0) + vec3(0.02, 0.025, 0.05), uNight * 0.45);
  gl_FragColor = vec4(col, uOpacity);
}`;

export interface CloudOpts {
  /** half extents of the cloud body */
  rx?: number; ry?: number; rz?: number;
  /** cloud-local position of the thinker's head (trailing puffs go there) */
  head?: THREE.Vector3;
  seed?: number;
  /** icosphere detail (5 for close-ups, 3 for far viewers) */
  detail?: number;
  /** leave the front open (alcove) */
  open?: boolean;
}

interface Puff { c: THREE.Vector3; r: number; delay: number }

function layout(o: Required<CloudOpts>): Puff[] {
  const rnd = new RNG(o.seed);
  const out: Puff[] = [];
  const { rx, ry, rz } = o;
  // rim ring (the silhouette of the cloud) — leaves the middle open
  const ring = 22;
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * Math.PI * 2 + rnd.range(-0.06, 0.06);
    const s = Math.sin(a);
    const r = (s < -0.5 ? 0.24 : 0.3) + rnd.range(0, 0.1) + (s > 0.4 ? 0.06 : 0);
    out.push({ c: new THREE.Vector3(Math.cos(a) * rx * 1.02, s * ry * 1.0, rnd.range(-0.12, 0.05) * rz), r, delay: 0.25 + 0.4 * ((i / ring + 0.25) % 1) * 0.5 });
  }
  // outer second ring, behind: fluffy depth to the silhouette
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.22;
    out.push({ c: new THREE.Vector3(Math.cos(a) * rx * 0.98, Math.sin(a) * ry * 0.92, -0.62 * rz), r: 0.4 + rnd.range(0, 0.12), delay: 0.3 + rnd.range(0, 0.2) });
  }
  // back wall (the dream backdrop), far behind the tree
  for (let i = 0; i < 12; i++) {
    const x = ((i % 4) - 1.5) * rx * 0.48 + rnd.range(-0.08, 0.08), y = (Math.floor(i / 4) - 1) * ry * 0.58 + rnd.range(-0.06, 0.06);
    out.push({ c: new THREE.Vector3(x, y, -1.55 * rz - rnd.range(0, 0.1)), r: 0.45 + rnd.range(0, 0.12), delay: 0.35 + rnd.range(0, 0.2) });
  }
  if (!o.open) for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    out.push({ c: new THREE.Vector3(Math.cos(a) * rx * 0.35, Math.sin(a) * ry * 0.3, 0.3 * rz), r: 0.45 + rnd.range(0, 0.1), delay: 0.5 });
  }
  // little top bumps for a classic cumulus silhouette
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * rx * 0.36 + rnd.range(-0.06, 0.06);
    out.push({ c: new THREE.Vector3(x, ry * (1.12 - Math.abs(i - 2) * 0.1), -0.3 * rz + rnd.range(-0.05, 0.05)), r: 0.3 + rnd.range(0, 0.1), delay: 0.45 + i * 0.03 });
  }
  // trailing puffs toward the head
  const head = o.head;
  const bottom = new THREE.Vector3(rx * 0.1, -ry * 1.05, 0.0);
  const trail = [0.25, 0.5, 0.75];
  trail.forEach((t, i) => {
    const p = head.clone().lerp(bottom, t);
    p.x += Math.sin(t * Math.PI) * 0.18;
    out.push({ c: p, r: 0.045 + t * 0.11, delay: i * 0.08 });
  });
  return out;
}

const geoCache = new Map<string, THREE.BufferGeometry>();

function buildGeometry(o: Required<CloudOpts>) {
  const key = JSON.stringify(o);
  const hit = geoCache.get(key);
  if (hit) return hit;
  const puffs = layout(o);
  const ico = new THREE.IcosahedronGeometry(1, o.detail).toNonIndexed();
  const ip = ico.attributes.position as THREE.BufferAttribute;
  const nv = ip.count;
  const pos = new Float32Array(puffs.length * nv * 3);
  const cen = new Float32Array(puffs.length * nv * 3);
  const inf = new Float32Array(puffs.length * nv * 3);
  puffs.forEach((pf, k) => {
    const seed = (k * 0.618 + o.seed * 0.137) % 1 * 10;
    for (let i = 0; i < nv; i++) {
      const j = (k * nv + i) * 3;
      pos[j] = ip.getX(i); pos[j + 1] = ip.getY(i); pos[j + 2] = ip.getZ(i);
      cen[j] = pf.c.x; cen[j + 1] = pf.c.y; cen[j + 2] = pf.c.z;
      inf[j] = pf.r; inf[j + 1] = seed; inf[j + 2] = pf.delay;
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCenter', new THREE.BufferAttribute(cen, 3));
  g.setAttribute('aInfo', new THREE.BufferAttribute(inf, 3));
  const R = Math.max(o.rx, o.ry, o.rz) + 1 + o.head.length();
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R);
  ico.dispose();
  geoCache.set(key, g);
  return g;
}

export class ThoughtCloud {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  readonly opts: Required<CloudOpts>;
  private appear = 0;
  private target = 0;
  time = Math.random() * 50;

  constructor(o: CloudOpts = {}) {
    this.opts = { rx: o.rx ?? 1.5, ry: o.ry ?? 1.0, rz: o.rz ?? 0.75, head: o.head ?? new THREE.Vector3(0, -1.9, 0.1), seed: o.seed ?? 3, detail: o.detail ?? 5, open: o.open ?? true };
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag,
      uniforms: {
        uTime: { value: 0 }, uAppear: { value: 0 }, uChurn: { value: 1 }, uPop: { value: 1 },
        uLight: { value: new THREE.Vector3(0.4, 0.9, 0.5) },
        uTop: { value: new THREE.Color(0xfffaf0) }, uBottom: { value: new THREE.Color(0xd2c6f0) },
        uRim: { value: new THREE.Color(0xfff0c8) }, uGlow: { value: new THREE.Color(0xffd6b0) }, uInner: { value: new THREE.Color(0xffe7ff) },
        uOpacity: { value: 1 }, uNight: { value: 0 },
      },
    });
    this.mesh = new THREE.Mesh(buildGeometry(this.opts), this.mat);
    this.mesh.name = 'thought-cloud';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.group.add(this.mesh);
    this.group.name = 'thought-cloud-group';
  }

  /** 1 = fully grown, 0 = gone */
  show(on: boolean) { this.target = on ? 1 : 0; }
  get visibleK() { return this.appear; }
  get done() { return this.target === 0 && this.appear <= 0.001; }

  update(dt: number, night = 0) {
    this.time += dt;
    const sp = this.target > this.appear ? 0.75 : 1.8;
    this.appear += Math.sign(this.target - this.appear) * Math.min(Math.abs(this.target - this.appear), dt * sp);
    const u = this.mat.uniforms;
    u.uTime.value = this.time;
    u.uAppear.value = this.target > 0 ? this.appear * 1.25 : this.appear * 1.25;
    u.uPop.value = this.target > 0 ? 1 : 0;
    u.uNight.value = night;
    this.mesh.visible = this.appear > 0.001;
  }

  dispose() { this.mat.dispose(); this.group.removeFromParent(); }
}

// ------------------------------------------------------------------ soft dream glow sprite (inside)

const glowFrag = /* glsl */ `
uniform float uTime, uK;
uniform vec3 uCol;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p * vec2(0.8, 1.0));
  float n = fbm2(vec3(p * 2.2, uTime * 0.07));
  float a = smoothstep(1.0, 0.0, r + (n - 0.5) * 0.45) * uK;
  gl_FragColor = vec4(uCol * a, a);
  #ifdef STRAIGHT
  gl_FragColor = vec4(uCol, a);
  #endif
}`;

export function dreamGlow(w: number, h: number, color: THREE.ColorRepresentation, additive = true) {
  const m = new THREE.ShaderMaterial({
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: glowFrag, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uTime: { value: 0 }, uK: { value: 1 }, uCol: { value: new THREE.Color(color) } },
  });
  if (!additive) m.defines = { STRAIGHT: 1 };
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  mesh.renderOrder = 4;
  return mesh;
}
