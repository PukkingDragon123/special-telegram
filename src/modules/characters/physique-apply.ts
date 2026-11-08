import * as THREE from 'three';
import type { Look } from '../../game/contracts';
import type { BodyTemplate } from './glb';

/* ============================================================================================
 * Physique variety on the sculpted GLB bodies (Look.physique: muscle / shoulders / belly / legs / head,
 * all 0..1 with 0.5 = average; plus the existing height (uniform scale) and build (_FAT inflation)).
 *
 *  • skeleton proportions — rest-pose bone OFFSETS (never touched by the mixer, which only animates
 *    rotations + pelvis translation, so the rig's own FK, attach points and head height stay right):
 *      shoulders → upperarm joints slide out along the clavicles
 *      legs      → knee + ankle joints slide along the leg (longer/shorter legs); the root bone lifts the
 *                  whole body by the same amount while standing so the feet stay on the ground
 *      head      → uniform Head bone scale (head, face scan, hair and hats are all skinned to it)
 *  • soft tissue — vertex-shader inflation along the bind normal, weighted by which bones the vertex is
 *    skinned to. Clothing shells share the body's skinning, so shirts and trousers stay fitted:
 *      belly  → forward-biased bulge around the navel (negative = flatter)
 *      muscle → chest / neck, upper & fore arms, thighs & calves thicker (negative = wiry)
 * Applied from Rig.build() through TEMPLATES.onRigBuild (glb.ts) after every (re)build.
 * ========================================================================================== */

const MAX_BONES = 72;

interface PhysRig {
  t: BodyTemplate;
  bones: THREE.Bone[];
  mat: THREE.MeshStandardMaterial;
  posture: string;
  look: Look;
  update(dt: number): void;
  __phys?: PhysState;
}

interface PhysState {
  /** root lift while standing (model metres, template space) */
  lift: number;
  w: number;
  regions: THREE.Vector4[];
  amp: THREE.Vector4;
  belly: THREE.Vector3;
  t: BodyTemplate | null;
  look: Look | null;
  /** head bone scale factor (re-applied every update: the first-person view collapses/restores the head bone) */
  head: number;
}

/** per-template bone region membership (belly, chest, arms, legs) */
const REGION_W: Record<string, [number, number, number, number]> = {
  // belly membership is 1 on every trunk bone (the navel gaussian does the vertical falloff) so layered
  // garments skinned to different trunk bones (jacket shell vs apron bib) bulge by the same amount
  pelvis: [1, 0, 0, 0.3],
  spine_01: [1, 0.05, 0, 0],
  spine_02: [1, 0.4, 0, 0],
  spine_03: [1, 1, 0, 0],
  neck_01: [0, 0.75, 0, 0],
  clavicle_l: [0, 1, 0.35, 0], clavicle_r: [0, 1, 0.35, 0],
  upperarm_l: [0, 0.15, 1, 0], upperarm_r: [0, 0.15, 1, 0],
  lowerarm_l: [0, 0, 0.62, 0], lowerarm_r: [0, 0, 0.62, 0],
  thigh_l: [0, 0, 0, 1], thigh_r: [0, 0, 0, 1],
  calf_l: [0, 0, 0, 0.7], calf_r: [0, 0, 0, 0.7],
};

const regionCache = new WeakMap<BodyTemplate, THREE.Vector4[]>();
function regionsFor(t: BodyTemplate): THREE.Vector4[] {
  let r = regionCache.get(t);
  if (r) return r;
  r = Array.from({ length: MAX_BONES }, () => new THREE.Vector4());
  for (const [name, w] of Object.entries(REGION_W)) {
    const i = t.index[name];
    if (i !== undefined && i < MAX_BONES) r[i].set(w[0], w[1], w[2], w[3]);
  }
  regionCache.set(t, r);
  return r;
}

const ZERO_STATE = { regions: Array.from({ length: MAX_BONES }, () => new THREE.Vector4()), amp: new THREE.Vector4(), belly: new THREE.Vector3(1, 0.2, 0) };

const VERT_PARS = /* glsl */ `
uniform vec4 uPhR[${MAX_BONES}];
uniform vec4 uPhA;
uniform vec3 uPhB;`;

const VERT_MAIN = /* glsl */ `
#ifdef USE_SKINNING
{
  vec4 phr = uPhR[int(skinIndex.x)] * skinWeight.x + uPhR[int(skinIndex.y)] * skinWeight.y
           + uPhR[int(skinIndex.z)] * skinWeight.z + uPhR[int(skinIndex.w)] * skinWeight.w;
  float bgy = (position.y - uPhB.x) / uPhB.y;
  float bg = exp(-bgy * bgy);
  float fr = clamp(normal.z * 0.5 + 0.5, 0.0, 1.0);
  float fr2 = fr * fr;
  float bel = phr.x * bg * uPhA.x;
  transformed += normal * bel * (0.22 + 0.78 * fr2) + vec3(0.0, -0.12 * bel * fr2, bel * fr2 * fr * 0.85);
  transformed += normal * (phr.y * uPhA.y * (0.6 + 0.4 * fr) + phr.z * uPhA.z + phr.w * uPhA.w);
}
#endif`;

const MARK = 'transformed += normal * afat * uFat;';

function patchMaterial(m: THREE.MeshStandardMaterial) {
  if ((m.userData as any).__physPatched) return;
  (m.userData as any).__physPatched = true;
  const orig = m.onBeforeCompile;
  const origKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = function (this: THREE.Material, sh: any, r: THREE.WebGLRenderer) {
    orig.call(this, sh, r);
    const st: PhysState | typeof ZERO_STATE = (this.userData as any).uPhys ?? ZERO_STATE;
    sh.uniforms.uPhR = { value: st.regions };
    sh.uniforms.uPhA = { value: st.amp };
    sh.uniforms.uPhB = { value: st.belly };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>' + VERT_PARS);
    sh.vertexShader = sh.vertexShader.includes(MARK)
      ? sh.vertexShader.replace(MARK, MARK + VERT_MAIN)
      : sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>' + VERT_MAIN);
  } as any;
  m.customProgramCacheKey = () => origKey() + '+phys1';
  m.needsUpdate = true;
}

const c01 = (v: number | undefined, d = 0.5) => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(1, v)) : d);

/** resolved physique numbers (exported for tests / the crowd baker) */
export function physiqueOf(look: Look) {
  const p = look.physique ?? {};
  return { muscle: c01(p.muscle), shoulders: c01(p.shoulders), belly: c01(p.belly), legs: c01(p.legs), head: c01(p.head) };
}

export function applyPhysique(rigAny: unknown, look: Look) {
  const rig = rigAny as PhysRig;
  const t = rig.t, bones = rig.bones;
  if (!t || !bones?.length || !rig.mat) return;
  const ph = physiqueOf(look);
  const fem = look.sex === 'f';
  let st = rig.__phys;
  if (!st) {
    st = rig.__phys = { lift: 0, w: 1, regions: regionsFor(t), amp: new THREE.Vector4(), belly: new THREE.Vector3(), t: null, look: null, head: 1 };
    // posture-aware root lift (the feet stay planted with longer/shorter legs) — runs before the rig's own tick
    const upd = rig.update;
    rig.update = function (this: PhysRig, dt: number) {
      const s = this.__phys;
      // setLook() skips the rebuild when only the physique changed (same atlas key) → re-apply here
      if (s && this.look && s.look !== this.look) applyPhysique(this, this.look);
      if (s && s.head !== 1) {
        const hi = this.t.index.Head, hb = hi !== undefined ? this.bones[hi] : null;
        if (hb && hb.scale.x > 0.01 && Math.abs(hb.scale.x - this.t.restScale[hi].x * s.head) > 1e-4) hb.scale.copy(this.t.restScale[hi]).multiplyScalar(s.head);
      }
      if (s && s.lift !== 0) {
        const want = this.posture === 'stand' ? 1 : this.posture === 'sit' ? 0.45 : 0;
        s.w += (want - s.w) * Math.min(1, dt * 6);
        const ri = this.t.parent.indexOf(-1);
        const rb = this.bones[ri];
        if (rb) rb.position.y = this.t.restPos[ri].y + s.lift * s.w;
      }
      return upd.call(this, dt);
    } as any;
  }
  if (st.t !== t) { st.regions = regionsFor(t); st.t = t; }
  st.look = look;

  // ---- skeleton proportions (absolute from the template rest pose → idempotent)
  const I = t.index;
  const set = (name: string, k: number) => { const i = I[name]; if (i !== undefined && bones[i]) bones[i].position.copy(t.restPos[i]).multiplyScalar(k); };
  // shoulders: ±2.6 cm per side (women's range a bit narrower)
  const sh = (ph.shoulders - 0.5) * 2 * (fem ? 0.02 : 0.026) + (ph.muscle - 0.5) * 0.008;
  for (const side of ['l', 'r']) {
    const i = I['upperarm_' + side];
    if (i === undefined) continue;
    const len = t.restPos[i].length() || 0.18;
    set('upperarm_' + side, 1 + sh / len);
  }
  // legs: ±4.5 % knee + ankle
  const lf = 1 + (ph.legs - 0.5) * 0.09;
  let legLen = 0;
  for (const side of ['l', 'r']) { set('calf_' + side, lf); set('foot_' + side, lf); }
  { const a = I.calf_l, b = I.foot_l; if (a !== undefined && b !== undefined) legLen = t.restPos[a].length() + t.restPos[b].length(); }
  st.lift = (lf - 1) * legLen;
  {
    const ri = t.parent.indexOf(-1);
    if (bones[ri]) bones[ri].position.y = t.restPos[ri].y + st.lift * (rig.posture === 'stand' ? 1 : 0);
    st.w = rig.posture === 'stand' ? 1 : 0;
  }
  // head: ±6 %
  st.head = 1 + (ph.head - 0.5) * 0.12;
  { const i = I.Head; if (i !== undefined && bones[i]) bones[i].scale.copy(t.restScale[i]).multiplyScalar(st.head); }

  // ---- soft tissue (template metres; the rig's uniform height scale applies on top)
  const m = (ph.muscle - 0.5) * 2;
  const bel = (ph.belly - 0.5) * 2;
  const mk = m > 0 ? 1 : 0.55;
  st.amp.set(
    bel > 0 ? bel * (fem ? 0.07 : 0.1) : bel * 0.016,
    m * mk * (fem ? 0.007 : 0.011),
    m * mk * (fem ? 0.008 : 0.013),
    m * mk * (fem ? 0.009 : 0.011),
  );
  const py = t.Gp[I.pelvis]?.y ?? 0.95, s2 = t.Gp[I.spine_02]?.y ?? 1.18, s3 = t.Gp[I.spine_03]?.y ?? 1.31;
  st.belly.set(py + (s2 - py) * 0.62, Math.max(0.12, (s3 - py) * 0.56), 0);
  (rig.mat.userData as any).uPhys = st;
  patchMaterial(rig.mat);

  // tall toque: the rig's head attach point / speech-bubble height must clear the hat
  const hat = (look.acc ?? []).find((a) => /^chef_hat/.test(a) || /toque/.test(a));
  if (hat && typeof (rigAny as any).hairTop === 'number') (rigAny as any).hairTop = 0.215 * (t.headModel?.scale ?? 1);
}
