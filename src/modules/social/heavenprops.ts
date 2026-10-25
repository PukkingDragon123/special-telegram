import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { Assets } from '../../core/assets';
import { Ease, damp } from '../../core/util';
import { text3d, Text3D } from '../../ui3d/text3d';
import { NOISE, SUN_L, COL } from './heavenenv';
import { SKILLS, SkillDef, Branch, BRANCH_NAME, XpSkill, lvProgress, skillState, SkillState } from './skills';
import { buildMoney } from './money';
import { GEN } from './fx';

/* ============================================================================================
 * SKILL HEAVEN — the skills, as REAL 3D PROPS floating in the air (no tree, no lines, no nodes):
 * every skill is its item model (game.items.def(kind).build — woks, cleavers, plates, eggs, coins…)
 * bobbing and spinning on its own little noise-shader cloud puff, grouped per branch into clusters
 * around you, each cluster under a soft light column with a floating 3D title (Lv + xp).
 *   locked     → pale stone, misty, slightly see-through, slow
 *   affordable → full colour, glowing golden fresnel outline + pulsing halo with a ring
 *   learned    → full colour, sparkling, a real gold ring orbiting it
 * Hover/aim: the prop drifts toward you and turns to face you; name / level·cost / one-liner
 * appear as real extruded 3D text (src/ui3d/text3d.ts) beside it.
 * ========================================================================================== */

export const MAX_GROUPS = 32;
const ISLAND = 31;

// ------------------------------------------------------------------ cloud puffs (one draw for all)

const puffVert = /* glsl */ `
attribute vec3 aCenter;
attribute vec4 aInfo;     // x radius, y seed, z group
uniform float uTime;
uniform vec4 uOff[${MAX_GROUPS}];
uniform vec4 uGlow[${MAX_GROUPS}];
varying vec3 vN, vW;
varying float vCrease, vSeed, vUp;
varying vec4 vGlow;
${NOISE}
float disp(vec3 d) {
  vec3 q = d * 1.7 + vec3(aInfo.y * 7.0, uTime * 0.11, aInfo.y * 3.0);
  return 0.78 + 0.42 * fbm(q) + 0.07 * sin(uTime * 0.6 + aInfo.y * 9.0);
}
void main() {
  int gi = int(aInfo.z + 0.5);
  vec4 off = uOff[gi];
  float r = aInfo.x * off.w;
  vec3 d = normalize(position);
  float h = disp(d);
  vec3 t1 = normalize(cross(d, abs(d.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 t2 = cross(d, t1);
  float e = 0.08;
  vec3 dA = normalize(d + t1 * e), dB = normalize(d + t2 * e);
  vec3 P = d * h, A = dA * disp(dA), B = dB * disp(dB);
  vec3 n = normalize(cross(A - P, B - P));
  if (dot(n, d) < 0.0) n = -n;
  P.y *= d.y < 0.0 ? 0.72 : 1.0;   // flatter cloud base
  vec3 local = off.xyz + aCenter * off.w + P * r;
  vec4 w = modelMatrix * vec4(local, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * n);
  vCrease = h; vSeed = aInfo.y; vUp = d.y; vGlow = uGlow[gi];
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const puffFrag = /* glsl */ `
uniform vec3 uL, uTop, uMid, uBottom, uRim, uSunCol;
uniform float uTime;
varying vec3 vN, vW;
varying float vCrease, vSeed, vUp;
varying vec4 vGlow;
${NOISE}
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  if (!gl_FrontFacing) N = -N;
  float hl = dot(N, uL) * 0.5 + 0.5;
  float b1 = smoothstep(0.36, 0.42, hl), b2 = smoothstep(0.6, 0.66, hl);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float crease = smoothstep(0.72, 1.12, vCrease);
  float fluff = fbm(vW * 6.0 + vec3(0.0, uTime * 0.05, vSeed));
  // soft cel bands: periwinkle shadow, candy-pink mid, cream light
  vec3 col = mix(uBottom, uMid, b1);
  col = mix(col, uTop, b2);
  col *= mix(0.8, 1.0, smoothstep(0.25, 0.4, crease)) * (0.94 + 0.12 * fluff);
  float rim = smoothstep(0.58, 0.66, 1.0 - ndv);
  float back = pow(clamp(dot(V, -uL), 0.0, 1.0), 3.0);
  col += uRim * rim * (0.35 + 0.8 * back);
  col += vGlow.rgb * vGlow.a * (0.3 + 0.9 * rim + 0.25 * b2) * (0.55 + 0.45 * smoothstep(-0.3, 0.8, vUp));
  gl_FragColor = vec4(col, 1.0);
}`;

interface Lump { c: THREE.Vector3; r: number; g: number }

export class PuffField {
  readonly mesh: THREE.Mesh;
  readonly off: THREE.Vector4[] = [];
  readonly glow: THREE.Vector4[] = [];
  private mat: THREE.ShaderMaterial;

  constructor(lumps: Lump[], detail = 3) {
    for (let i = 0; i < MAX_GROUPS; i++) { this.off.push(new THREE.Vector4(0, 0, 0, 0)); this.glow.push(new THREE.Vector4(1, 1, 1, 0)); }
    const ico = new THREE.IcosahedronGeometry(1, detail);
    const ip = ico.attributes.position as THREE.BufferAttribute;
    const nv = ip.count;
    const pos = new Float32Array(lumps.length * nv * 3), cen = new Float32Array(lumps.length * nv * 3), inf = new Float32Array(lumps.length * nv * 4);
    lumps.forEach((l, k) => {
      const seed = ((k * 0.618 + 0.37) % 1) * 10;
      for (let i = 0; i < nv; i++) {
        const j = (k * nv + i) * 3, q = (k * nv + i) * 4;
        pos[j] = ip.getX(i); pos[j + 1] = ip.getY(i); pos[j + 2] = ip.getZ(i);
        cen[j] = l.c.x; cen[j + 1] = l.c.y; cen[j + 2] = l.c.z;
        inf[q] = l.r; inf[q + 1] = seed; inf[q + 2] = l.g; inf[q + 3] = 0;
      }
    });
    ico.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aCenter', new THREE.BufferAttribute(cen, 3));
    g.setAttribute('aInfo', new THREE.BufferAttribute(inf, 4));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: puffVert, fragmentShader: puffFrag,
      uniforms: {
        uTime: { value: 0 }, uOff: { value: this.off }, uGlow: { value: this.glow },
        uL: { value: SUN_L.clone() }, uTop: { value: new THREE.Color(1.12, 1.02, 0.95) }, uMid: { value: new THREE.Color(1.0, 0.78, 0.95) }, uBottom: { value: new THREE.Color(0.58, 0.6, 1.0) },
        uRim: { value: new THREE.Color(1.0, 0.8, 0.52) }, uSunCol: { value: COL.sun.clone() },
      },
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'heaven-puffs';
  }
  update(t: number) { this.mat.uniforms.uTime.value = t; }
  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); this.mesh.removeFromParent(); }
}

/** a little cloud puff under a prop (group-local lumps) */
function propLumps(g: number, seed: number): Lump[] {
  const r = (a: number) => (Math.sin(seed * 12.9898 + a * 78.233) * 43758.5453) % 1;
  const out: Lump[] = [{ c: new THREE.Vector3(0, -0.02, 0), r: 0.2, g }];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.abs(r(i)) * 0.8;
    out.push({ c: new THREE.Vector3(Math.cos(a) * 0.19, -0.05 + Math.abs(r(i + 9)) * 0.03, Math.sin(a) * 0.13), r: 0.12 + Math.abs(r(i + 3)) * 0.05, g });
  }
  out.push({ c: new THREE.Vector3(-0.05, 0.06, -0.06), r: 0.1, g });
  return out;
}

/** the fluffy island you stand on */
export function islandLumps(): Lump[] {
  const out: Lump[] = [{ c: new THREE.Vector3(0, -0.55, 0), r: 0.75, g: ISLAND }];
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + Math.sin(i * 3.1) * 0.2;
    const d = 0.75 + Math.abs(Math.sin(i * 1.7)) * 0.45;
    out.push({ c: new THREE.Vector3(Math.cos(a) * d, -0.42 - Math.abs(Math.sin(i * 2.3)) * 0.22, Math.sin(a) * d), r: 0.38 + Math.abs(Math.sin(i * 5.1)) * 0.2, g: ISLAND });
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    out.push({ c: new THREE.Vector3(Math.cos(a) * 0.45, -0.95, Math.sin(a) * 0.45), r: 0.5, g: ISLAND });
  }
  return out;
}

// ------------------------------------------------------------------ halos (one instanced draw)

const haloVert = /* glsl */ `
attribute vec4 aP;   // xyz centre, w size
attribute vec4 aC;   // rgb, a intensity
attribute vec4 aR;   // x ring, y unused, z mist, w seed
varying vec2 vUv; varying vec4 vC; varying vec4 vR;
void main() {
  vUv = uv; vC = aC; vR = aR;
  vec3 c = (modelMatrix * vec4(aP.xyz, 1.0)).xyz;
  vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 wp = c + (camR * position.x + camU * position.y) * aP.w + normalize(c - cameraPosition) * 0.18;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const haloFrag = /* glsl */ `
uniform float uTime;
varying vec2 vUv; varying vec4 vC; varying vec4 vR;
${NOISE}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float n = fbm(vec3(p * 2.5, uTime * 0.25 + vR.w * 10.0));
  float glow = exp(-r * r * 4.5) * (0.7 + 0.6 * n);
  float ring = exp(-pow((r - 0.6 - (n - 0.5) * 0.05) * 20.0, 2.0)) * vR.x;
  float rays = pow(max(0.0, sin(atan(p.y, p.x) * 7.0 + uTime * 0.5 + vR.w * 6.0)), 8.0) * exp(-r * 2.2) * vR.x * 0.6;
  float mist = smoothstep(1.0, 0.15, r + (n - 0.5) * 0.7) * vR.z;
  vec3 col = vC.rgb * (glow + ring * 1.7 + rays) * vC.a + vec3(0.85, 0.86, 0.95) * mist * 0.22;
  col *= 1.0 - smoothstep(0.9, 1.0, r);
  gl_FragColor = vec4(col, 1.0);
}`;

class Halos {
  readonly mesh: THREE.Mesh;
  private aP: THREE.InstancedBufferAttribute;
  private aC: THREE.InstancedBufferAttribute;
  private aR: THREE.InstancedBufferAttribute;
  private mat: THREE.ShaderMaterial;
  constructor(n: number) {
    const plane = new THREE.PlaneGeometry(2, 2);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.setAttribute('position', plane.getAttribute('position'));
    g.setAttribute('uv', plane.getAttribute('uv'));
    this.aP = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.aC = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.aR = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    for (const a of [this.aP, this.aC, this.aR]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aP', this.aP); g.setAttribute('aC', this.aC); g.setAttribute('aR', this.aR);
    g.instanceCount = n;
    this.mat = new THREE.ShaderMaterial({ vertexShader: haloVert, fragmentShader: haloFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: { value: 0 } } });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }
  set(i: number, p: THREE.Vector3, size: number, c: THREE.Color, k: number, ring: number, mist: number, seed: number) {
    this.aP.setXYZW(i, p.x, p.y, p.z, size);
    this.aC.setXYZW(i, c.r, c.g, c.b, k);
    this.aR.setXYZW(i, ring, 0, mist, seed);
  }
  commit(t: number) { this.aP.needsUpdate = true; this.aC.needsUpdate = true; this.aR.needsUpdate = true; this.mat.uniforms.uTime.value = t; }
  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); this.mesh.removeFromParent(); }
}

// ------------------------------------------------------------------ props

/** a stack of real 10 ฿ coins (money.ts) */
function coinStack() {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) { const c = buildMoney(10); c.position.set((i % 2) * 0.012, i * 0.0024, (i >> 1) * 0.008); c.rotation.set(Math.PI / 2 + (i - 2) * 0.05, 0, i * 0.4); g.add(c); }
  return g;
}

/** 'Slap-proof cheeks': the real wok item with a red slap print on its iron belly */
function slapWok(game: Game) {
  const g = new THREE.Group();
  const wok = game.items.def('wok');
  if (!wok) return coinStack();
  const o = wok.build({ id: -1, t: 'item', k: 'wok', data: wok.data?.() ?? {}, p: [0, 0, 0] } as any, game);
  o.rotation.x = -Math.PI / 2;   // iron belly toward you, like a cheek
  g.add(o);
  const print = new THREE.Mesh(new THREE.CircleGeometry(0.11, 24), new THREE.MeshStandardMaterial({ map: Assets.texture(GEN + 'handprint_red.png', { wrap: false }), transparent: true, depthWrite: false, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -4 }));
  print.position.z = 0.004;
  print.rotation.z = 0.3;
  g.add(print);
  return g;
}

/** Real item model for a skill: first existing item kind wins (cooking/restaurant/shops item builders). */
export function buildSkillProp(game: Game, kinds: string[]): THREE.Object3D {
  for (const k of kinds) {
    if (k === '__coin10') return coinStack();
    if (k === '__slapwok') return slapWok(game);
    const def = game.items.def(k);
    if (!def) continue;
    try {
      const fake: any = { id: -1, t: 'item', k, data: def.data?.() ?? {}, p: [0, 0, 0] };
      const o = def.build(fake, game);
      try { def.refresh?.(o, fake, game); } catch {}
      return o;
    } catch (e) { console.warn('[heaven] prop build failed', k, e); }
  }
  // modules not loaded (?only=social): real coins rather than any primitive
  return coinStack();
}

interface PropU { stone: { value: number }; rim: { value: number }; rimCol: { value: THREE.Color }; flash: { value: number } }

const PATCH_SRC = 'hvprop-v1';
function patchMaterial(src: THREE.Material, U: PropU): THREE.Material {
  const m = src.clone();
  const lit = (m as any).isMeshStandardMaterial || (m as any).isMeshLambertMaterial || (m as any).isMeshPhongMaterial || (m as any).isMeshToonMaterial;
  const known = lit || (m as any).isMeshBasicMaterial;
  if (!known) return m;
  m.userData.hv = { opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uStone = U.stone; sh.uniforms.uRim = U.rim; sh.uniforms.uRimCol = U.rimCol; sh.uniforms.uFlash = U.flash;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uStone, uRim, uFlash;\nuniform vec3 uRimCol;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        { float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          vec3 stone = vec3(l * 0.4 + 0.2) * vec3(0.86, 0.88, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, stone, uStone);
          diffuseColor.a *= 1.0 - uStone * 0.16; }`)
      .replace('#include <opaque_fragment>', `${lit ? `{ float fr = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 2.4);
          outgoingLight += uRimCol * (fr * uRim); }` : ''}
        outgoingLight += uRimCol * uFlash;
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => PATCH_SRC + (lit ? 'L' : 'B');
  m.userData.hvPatched = true;
  return m;
}

export interface PropNode {
  s: SkillDef;
  i: number;
  group: number;                // puff group index
  holder: THREE.Group;          // world placement (position = current centre)
  spinner: THREE.Group;         // rotation
  fit: THREE.Group;             // normalisation scale/offset
  raw: THREE.Object3D;
  U: PropU;
  mats: THREE.Material[];
  base: THREE.Vector3;          // rest position (heaven-local)
  cur: THREE.Vector3;
  state: SkillState | '';
  stoneK: number;
  hover: number;
  appear: number;
  appearAt: number;
  bounce: number;
  shake: number;
  happy: number;
  spin: number;
  meshCount: number;
  ring: THREE.Mesh | null;
  ringK: number;
  sparkT: number;
  size: number;
}

export interface Cluster { b: Branch; centre: THREE.Vector3; top: number; title: Text3D; sub: Text3D; key: string; at: number }

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _c = new THREE.Color(), _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

const C_GOLD = new THREE.Color(1.0, 0.72, 0.28);
const C_WARM = new THREE.Color(1.0, 0.9, 0.7);
const C_MIST = new THREE.Color(0.75, 0.78, 0.92);

/** where each branch cluster floats (azimuth from the start view, + = left), distance, height */
const SPOTS: Record<Branch, { az: number; d: number; h: number }> = {
  cook: { az: 0, d: 4.1, h: 0.9 },
  prep: { az: 0.95, d: 3.95, h: 0.5 },
  serve: { az: -0.95, d: 3.95, h: 1.15 },
  clean: { az: 1.95, d: 3.85, h: 0.8 },
  life: { az: -1.95, d: 3.7, h: 1.45 },
};

export function clusterCentre(b: Branch) {
  const s = SPOTS[b];
  return new THREE.Vector3(-Math.sin(s.az) * s.d, s.h, -Math.cos(s.az) * s.d);
}

export class SkillProps {
  readonly group = new THREE.Group();
  readonly nodes: PropNode[] = [];
  readonly clusters: Cluster[] = [];
  readonly puffs: PuffField;
  private halos: Halos;
  private ringGeo = new THREE.TorusGeometry(0.33, 0.011, 8, 72);
  private ringMat: THREE.MeshStandardMaterial;
  private t = 0;
  private fitT = 0;
  hovered: PropNode | null = null;

  constructor(private game: Game, private me: Ent) {
    const lumps: Lump[] = [...islandLumps()];
    const branches: Branch[] = ['cook', 'prep', 'serve', 'clean', 'life'];
    let gi = 0;
    for (const b of branches) {
      const list = SKILLS.filter((s) => s.branch === b).sort((a, c) => a.tier - c.tier);
      const centre = clusterCentre(b);
      const toCam = new THREE.Vector3(-centre.x, 0, -centre.z).normalize();
      const right = new THREE.Vector3().crossVectors(UP, toCam).normalize();
      const n = list.length;
      let top = -Infinity;
      list.forEach((s, k) => {
        const x = (k - (n - 1) / 2) * 0.98;
        const y = k * 0.3 + Math.sin(k * 1.9 + centre.x) * 0.16;
        const z = -Math.abs(k - (n - 1) / 2) * 0.32;
        const base = centre.clone().addScaledVector(right, x).add(new THREE.Vector3(0, y, 0)).addScaledVector(toCam, -z);
        top = Math.max(top, base.y);
        const node = this.makeNode(s, gi, base);
        lumps.push(...propLumps(gi, gi * 1.37 + 0.5));
        this.nodes.push(node);
        gi++;
      });
      const title = text3d('', { font: 'bubbly', size: 0.21, color: 0xffc24a, side: 0x4a2208, emissive: 0.2, metalness: 0.4, roughness: 0.3, rim: 0xfff0c0, rimStrength: 0.8, align: 'center', valign: 'bottom', castShadow: false, anim: { pop: 0.4, rise: 0.5, wobble: 0.04 } });
      const sub = text3d('', { font: 'ui', size: 0.085, color: 0x4a2a4a, side: 0xfff0e0, emissive: 0.05, bevelFace: true, align: 'center', valign: 'top', castShadow: false });
      this.group.add(title, sub);
      this.clusters.push({ b, centre, top, title, sub, key: '', at: 0 });
    }
    this.puffs = new PuffField(lumps);
    this.puffs.off[ISLAND].set(0, 0, 0, 1);
    this.puffs.glow[ISLAND].set(1, 0.85, 0.6, 0.12);
    this.group.add(this.puffs.mesh);
    this.halos = new Halos(this.nodes.length);
    this.group.add(this.halos.mesh);
    const gold = Assets.pbr('brass_gold');
    this.ringMat = gold.clone();
    this.ringMat.emissive = new THREE.Color(0xffc060);
    this.ringMat.emissiveIntensity = 0.35;
    this.ringMat.metalness = 1;
    this.ringMat.roughness = 0.25;
    this.refresh(true);
  }

  private makeNode(s: SkillDef, gi: number, base: THREE.Vector3): PropNode {
    const holder = new THREE.Group(), spinner = new THREE.Group(), fit = new THREE.Group();
    const raw = buildSkillProp(this.game, s.icon);
    fit.add(raw);
    spinner.add(fit);
    holder.add(spinner);
    holder.position.copy(base);
    holder.scale.setScalar(0.001);
    this.group.add(holder);
    const U: PropU = { stone: { value: 1 }, rim: { value: 0 }, rimCol: { value: new THREE.Color(1, 0.8, 0.4) }, flash: { value: 0 } };
    const size = s.branch === 'life' ? 0.58 : 0.7;
    const node: PropNode = {
      s, i: this.nodes.length, group: gi, holder, spinner, fit, raw, U, mats: [], base: base.clone(), cur: base.clone(), state: '', stoneK: 1,
      hover: 0, appear: 0, appearAt: 0, bounce: 0, shake: 0, happy: 0, spin: Math.random() * 6, meshCount: -1, ring: null, ringK: 0, sparkT: Math.random(), size,
    };
    this.fitNode(node);
    return node;
  }

  /** normalise the item (largest side = size, centred) and patch its materials; re-run if the model loads late */
  private fitNode(n: PropNode) {
    let count = 0;
    n.raw.traverse((o: any) => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      count++;
      o.castShadow = false; o.receiveShadow = false;
      if (Array.isArray(o.material)) o.material = o.material.map((m: THREE.Material) => (m.userData.hvPatched ? m : this.track(n, patchMaterial(m, n.U))));
      else if (o.material && !o.material.userData.hvPatched) o.material = this.track(n, patchMaterial(o.material, n.U));
    });
    if (count === n.meshCount) return;
    n.meshCount = count;
    // measure the item on its own (detached, identity parent), visible meshes only
    n.fit.remove(n.raw);
    n.raw.position.set(0, 0, 0);
    n.raw.updateMatrixWorld(true);
    const b = new THREE.Box3();
    n.raw.traverseVisible((o: any) => {
      if (!(o.isMesh || o.isSkinnedMesh) || !o.geometry?.attributes?.position) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      if (o.geometry.boundingBox && !o.geometry.boundingBox.isEmpty()) b.union(_box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
    });
    n.fit.add(n.raw);
    if (b.isEmpty()) { n.meshCount = -1; return; }
    const sz = b.getSize(_v), c = b.getCenter(_v2);
    n.raw.position.set(-c.x, -c.y, -c.z);
    n.fit.scale.setScalar(n.size / Math.max(sz.x, sz.y, sz.z, 1e-4));
    this.applyState(n, true);
  }
  private track(n: PropNode, m: THREE.Material) { n.mats.push(m); return m; }

  private applyState(n: PropNode, force = false) {
    const locked = n.state === 'locked' || n.state === 'poor';
    for (const m of n.mats) {
      const hv = m.userData.hv;
      if (!hv) continue;
      const wantT = locked ? true : hv.transparent;
      if (m.transparent !== wantT || force) { m.transparent = wantT; m.depthWrite = locked ? true : hv.depthWrite; m.needsUpdate = true; }
    }
    if (n.state === 'owned' && !n.ring) {
      n.ring = new THREE.Mesh(this.ringGeo, this.ringMat);
      n.ring.castShadow = false;
      n.holder.add(n.ring);
    }
  }

  /** re-evaluate skill states, titles, xp lines */
  refresh(force = false) {
    const me = this.game.state.get(this.me.id) ?? this.me;
    for (const n of this.nodes) {
      const st = skillState(me, n.s).st;
      if (st === n.state && !force) continue;
      n.state = st;
      this.applyState(n);
    }
    for (const c of this.clusters) {
      let line1: string, line2: string;
      if (c.b === 'life') {
        const tot = (['cook', 'prep', 'serve', 'clean'] as XpSkill[]).reduce((a, k) => a + lvProgress(k, me.xp?.[k] ?? 0).lv, 0);
        line1 = `${BRANCH_NAME.life.th}  เลเวลรวม ${tot}`;
        line2 = 'life · total level';
      } else {
        const p = lvProgress(c.b as XpSkill, me.xp?.[c.b] ?? 0);
        line1 = `${BRANCH_NAME[c.b].th}  Lv.${p.lv}`;
        line2 = p.lv >= 15 ? `${BRANCH_NAME[c.b].en} · MAX` : `${BRANCH_NAME[c.b].en} · ${p.cur}/${p.need} xp`;
      }
      const key = line1 + '|' + line2;
      if (key === c.key) continue;
      const first = !c.key;
      c.key = key;
      c.title.setText(line1);
      c.sub.setText(line2);
      if (!first) { c.title.popIn(0.03); c.sub.popIn(0.015); }
    }
  }

  /** start the arrival pop-in (props appear cluster by cluster) */
  arrive(delay = 0.25) {
    const t0 = this.t + delay;
    this.nodes.forEach((n, k) => { n.appear = 0; n.appearAt = t0 + Math.floor(k / 5) * 0.12 + (k % 5) * 0.09; });
    this.clusters.forEach((c, k) => { c.title.reveal = 0; c.sub.reveal = 0; c.at = t0 + 0.35 + k * 0.12; });
  }

  /** closest prop to a ray (heaven-local) */
  pick(ray: THREE.Ray): PropNode | null {
    let best: PropNode | null = null, bd = Infinity;
    for (const n of this.nodes) {
      if (n.appear < 0.6) continue;
      const d = ray.distanceSqToPoint(n.cur);
      const along = _v.copy(n.cur).sub(ray.origin).dot(ray.direction);
      if (along < 0.3) continue;
      const r = 0.36 + along * 0.025;
      if (d < r * r && along < bd) { bd = along; best = n; }
    }
    return best;
  }

  celebrate(n: PropNode) { n.happy = 1; n.bounce = 1; n.U.flash.value = 1.6; }
  refuse(n: PropNode) { n.shake = 1; }

  update(dt: number, camLocal: THREE.Vector3, burst: (p: THREE.Vector3, n: number, o: any) => void) {
    this.t += dt;
    const t = this.t;
    this.fitT += dt;
    const refit = this.fitT > 0.5;
    if (refit) this.fitT = 0;
    for (const n of this.nodes) {
      if (refit) this.fitNode(n);
      // appear
      if (t >= n.appearAt && n.appear < 1) {
        const was = n.appear;
        n.appear = Math.min(1, n.appear + dt * 1.8);
        if (was === 0) burst(n.base, 18, { color: 0xffffff, color2: 0xffe6b8, speed: 0.9, size: 0.035, life: 0.8, up: 0.3 });
      }
      const st = n.state;
      const owned = st === 'owned', ready = st === 'ready', locked = st === 'locked' || st === 'poor';
      const hov = this.hovered === n ? 1 : 0;
      n.hover += (hov - n.hover) * damp(7, dt);
      n.bounce = Math.max(0, n.bounce - dt * 1.3);
      n.shake = Math.max(0, n.shake - dt * 1.8);
      n.happy = Math.max(0, n.happy - dt * 0.9);
      n.U.flash.value = Math.max(0, n.U.flash.value - dt * 2.2);
      // stone ↔ colour (animated: learning makes it bloom into colour)
      const stoneT = locked ? (st === 'poor' ? 0.78 : 1) : 0;
      n.stoneK += (stoneT - n.stoneK) * damp(owned ? 3 : 6, dt);
      n.U.stone.value = n.stoneK;
      const pulse = 0.5 + 0.5 * Math.sin(t * 3.2 + n.i * 0.9);
      n.U.rim.value = ready ? 0.9 + 0.9 * pulse + n.hover * 0.6 : owned ? 0.35 + n.hover * 0.4 : st === 'poor' ? 0.15 : 0;
      n.U.rimCol.value.copy(ready ? C_GOLD : owned ? C_WARM : C_MIST);
      // motion: bob + drift toward you on hover
      const bob = Math.sin(t * 1.25 + n.i * 1.7) * 0.07;
      _v.copy(n.base);
      _v.y += bob;
      _v2.copy(camLocal).sub(_v);
      const dist = _v2.length();
      _v.addScaledVector(_v2.normalize(), Math.min(1.4, dist * 0.3) * Ease.inOutCubic(n.hover));
      _v.x += Math.sin(t * 38) * n.shake * 0.05;
      n.cur.copy(_v);
      n.holder.position.copy(_v);
      const pop = n.appear <= 0 ? 0.001 : Ease.outBack(n.appear, 2.2);
      const bounce = Math.sin(n.bounce * 13) * n.bounce * 0.3;
      n.holder.scale.setScalar(Math.max(0.001, pop * (1 + n.hover * 0.42 + bounce)));
      // spin: owned/ready spin, locked lazily; hovered turns to face you; happy = a joyful double spin
      n.spin += dt * (owned ? 0.9 : ready ? 0.7 : 0.25) * (1 - n.hover * 0.85);
      const happySpin = (1 - Math.pow(n.happy, 0.5)) * Math.PI * 4 * (n.happy > 0 ? 1 : 0);
      // holder faces you (yaw); the prop leans its top toward you so plates / woks / boards show their faces
      n.holder.rotation.set(0, Math.atan2(camLocal.x - n.cur.x, camLocal.z - n.cur.z), 0);
      _q.setFromEuler(_e.set(0.48 + Math.sin(t * 0.7 + n.i) * 0.12 + Math.sin(t * 42) * n.shake * 0.25, n.spin + happySpin, Math.sin(t * 0.5 + n.i) * 0.1 + Math.sin(t * 30) * n.shake * 0.35));
      // hovered: stops spinning and turns its best side to you (with a curious little sway)
      if (n.hover > 0.001) {
        _q2.setFromEuler(_e.set(0.4, Math.sin(t * 1.4) * 0.35 + happySpin, Math.sin(t * 1.1) * 0.06));
        _q.slerp(_q2, Ease.inOutCubic(n.hover) * 0.92);
      }
      n.spinner.quaternion.copy(_q);
      // gold ring for learned props
      if (n.ring) {
        n.ringK += ((owned ? 1 : 0) - n.ringK) * damp(3, dt);
        n.ring.scale.setScalar(Math.max(0.001, n.ringK) * (1 + 0.04 * Math.sin(t * 2 + n.i)));
        n.ring.rotation.set(1.15 + Math.sin(t * 0.8 + n.i) * 0.25, t * 1.6 + n.i, 0.3 * Math.sin(t * 0.6 + n.i * 2));
      }
      // sparkle
      if (owned && n.appear >= 1) {
        n.sparkT -= dt;
        if (n.sparkT <= 0) { n.sparkT = 0.35 + Math.random() * 0.5; burst(_v2.copy(n.cur).add(_v.set((Math.random() - 0.5) * 0.4, (Math.random() - 0.3) * 0.35, (Math.random() - 0.5) * 0.4)), 2, { color: 0xffe9a8, color2: 0xffffff, speed: 0.25, size: 0.03, life: 0.9, up: 0.15 }); }
      }
      // puff follows (below the prop)
      const sc = Math.max(0.001, pop) * (1 + n.hover * 0.12);
      this.puffs.off[n.group].set(n.cur.x, n.cur.y - 0.34 * sc, n.cur.z, sc);
      const g = this.puffs.glow[n.group];
      if (ready) g.set(C_GOLD.r, C_GOLD.g, C_GOLD.b, 0.55 + 0.4 * pulse);
      else if (owned) g.set(C_WARM.r, C_WARM.g, C_WARM.b, 0.35);
      else g.set(C_MIST.r, C_MIST.g, C_MIST.b, st === 'poor' ? 0.12 : 0.05);
      g.w += n.hover * 0.25 + n.U.flash.value * 0.5;
      // halo
      _c.copy(ready ? C_GOLD : owned ? C_WARM : C_MIST);
      const hk = ready ? 0.5 + 0.45 * pulse : owned ? 0.55 : st === 'poor' ? 0.12 : 0.05;
      this.halos.set(n.i, n.cur, (0.55 + n.hover * 0.12) * pop, _c, (hk + n.hover * 0.35 + n.U.flash.value * 0.8) * pop, ready ? 0.8 : owned ? 0.5 : 0, locked ? 1 - n.hover * 0.5 : 0, n.i * 0.37);
    }
    this.halos.commit(t);
    this.puffs.update(t);
    // cluster titles: above each cluster, facing you
    for (const c of this.clusters) {
      if (t > c.at && c.title.reveal !== Infinity && c.title.isReady) { c.title.popIn(0.04); c.sub.popIn(0.02); }
      const y = c.top + 0.62 + Math.sin(t * 0.9 + c.centre.x) * 0.04;
      c.title.position.set(c.centre.x, y, c.centre.z);
      c.sub.position.set(c.centre.x, y - 0.04, c.centre.z);
      const yaw = Math.atan2(camLocal.x - c.centre.x, camLocal.z - c.centre.z);
      c.title.rotation.set(0, yaw, 0);
      c.sub.rotation.set(0, yaw, 0);
    }
  }

  dispose() {
    for (const n of this.nodes) for (const m of n.mats) m.dispose();
    for (const c of this.clusters) { c.title.dispose(); c.sub.dispose(); }
    this.puffs.dispose();
    this.halos.dispose();
    this.ringGeo.dispose();
    this.ringMat.dispose();
    this.group.removeFromParent();
  }
}

const _box = new THREE.Box3();

// ------------------------------------------------------------------ hover info (real 3D text beside the prop)

interface InfoSet { key: string; root: THREE.Group; lines: Text3D[]; t: number; dying: number }

export class PropInfo {
  readonly group = new THREE.Group();
  private cur: InfoSet | null = null;
  private dying: InfoSet[] = [];

  show(n: PropNode | null, me: Ent, flash: string | null) {
    const st = n ? skillState(me, n.s) : null;
    const key = n ? `${n.s.id}:${st!.st}:${me.sp ?? 0}:${flash ?? ''}` : '';
    if (key === (this.cur?.key ?? '')) return;
    if (this.cur) { this.kill(this.cur); this.cur = null; }
    if (!n || !st) return;
    const s = n.s;
    const sp = me.sp ?? 0;
    const status = flash ?? (st.st === 'owned' ? 'ปลดแล้ว ✓ · learned'
      : st.st === 'ready' ? `คลิกเพื่อเรียน · ใช้ ${s.cost} แต้ม (มี ${sp})`
      : st.why?.th ?? '');
    const statusCol = flash ? 0xc0281a : st.st === 'ready' ? 0xb85200 : st.st === 'owned' ? 0x2c7a1e : 0x5c4c86;
    const root = new THREE.Group();
    const opts = { castShadow: false, align: 'left' as const, valign: 'top' as const };
    const lines = [
      text3d(s.name.th, { ...opts, font: 'bubbly', size: 0.12, color: 0xffc95a, side: 0x4a2208, emissive: 0.22, metalness: 0.35, roughness: 0.35, rim: 0xfff0c0, rimStrength: 0.7, maxWidth: 2.0 }),
      text3d(`ระดับ ${s.tier + 1} · ${s.cost} แต้ม  —  ${status}`, { ...opts, font: 'ui', size: 0.06, color: statusCol, side: 0x2a1406, emissive: 0.12, maxWidth: 2.1 }),
      text3d(s.desc.th, { ...opts, font: 'ui', size: 0.058, color: 0x3b2338, side: 0xfff2e2, emissive: 0.05, bevelFace: true, maxWidth: 1.9 }),
      text3d(`${s.name.en} — ${s.desc.en}`, { ...opts, font: 'ui', size: 0.042, color: 0x5a4470, side: 0xf6eeff, emissive: 0.05, bevelFace: true, maxWidth: 1.9 }),
    ];
    for (const l of lines) { l.popIn(0.012); root.add(l); }
    this.group.add(root);
    this.cur = { key, root, lines, t: 0, dying: 0 };
  }

  private kill(s: InfoSet) {
    let dur = 0;
    for (const l of s.lines) dur = Math.max(dur, l.vanish(0.004));
    s.dying = dur + 0.05;
    this.dying.push(s);
  }

  update(dt: number, n: PropNode | null, camLocal: THREE.Vector3, camRight?: THREE.Vector3) {
    if (this.cur && n) {
      // to the right of the prop (as seen from the camera), facing you
      const toCam = _v.copy(camLocal).sub(n.cur).normalize();
      const right = _v2.crossVectors(UP, toCam).normalize();
      const r = this.cur.root;
      // text goes on the side of the prop that faces the middle of the view
      let w = 0;
      for (const l of this.cur.lines) w = Math.max(w, l.width || 0);
      const onRight = camRight ? _tmp.copy(n.cur).sub(camLocal).dot(camRight) > 0.15 : false;
      r.position.copy(n.cur).addScaledVector(right, onRight ? -(0.4 + w) : 0.4).addScaledVector(toCam, 0.3);
      r.position.y += 0.24;
      r.lookAt(r.parent ? r.parent.localToWorld(_tmp.copy(camLocal)) : _tmp.copy(camLocal));
      let y = 0;
      for (const l of this.cur.lines) { l.position.set(0, y, 0); y -= (l.height || 0.06) + 0.035; }
    }
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      d.dying -= dt;
      if (d.dying <= 0) { for (const l of d.lines) l.dispose(); d.root.removeFromParent(); this.dying.splice(i, 1); }
    }
  }

  dispose() {
    for (const s of [...(this.cur ? [this.cur] : []), ...this.dying]) { for (const l of s.lines) l.dispose(); s.root.removeFromParent(); }
    this.cur = null; this.dying = [];
    this.group.removeFromParent();
  }
}

const _tmp = new THREE.Vector3();
