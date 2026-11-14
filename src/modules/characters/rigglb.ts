import * as THREE from 'three';
import type { AnimName, AttachPoint, CarryPose, CharacterRig, Expression, FaceVariant, Look } from '../../game/contracts';
import { B, NB, PARENT, REF_H, RestSkel, restSkel, restDir } from './skel';
import { bodySpec, BodySpec, Lod } from './body';
import { hairThickAt } from './hair';
import { Pose, PoseBuilder, blendPose, sm, HS_N, HAND_SHAPES } from './pose';
import { ANIMS, AnimCtx, AnimDef, FIDGETS, Personality, Posture } from './anims';
import { FaceRig, FACE_EXPR_PARS, FACE_EXPR_WARP, variantExpr, ExprKey } from './face-expr';
import { lookKey } from './atlas';
import { faceEntry } from './defs';
import { BodyTemplate, TEMPLATES, acquireLookGeometry, releaseLookGeometry } from './glb';
import { setInk } from '../../core/ink';
import { RigWorld, acquireAtlas, releaseAtlas, accessoryMaterial, silMat, proxyGeo, proxyMat, ATTACH, FOLLOW, estimateAge, QY_PI, ProcRig, RigOpts } from './rig';

/* ============================================================================================
 * Rig on a sculpted GLB body. Layers per tick:
 *  1. AnimationMixer: Quaternius UAL clips (locomotion idle/walk/jog/sprint phase-synced by speed,
 *     sitting, talking, dancing, pushing, death/fall, T-pose …), weights cross-faded
 *  2. procedural library (anims.ts) retargeted onto the skeleton (local deltas for the spine
 *     chain/feet, direction matching for limbs), masked (upper / arms / full) & cross-faded
 *  3. carry poses (arms aimed relative to the current chest), load hunch & wobble
 *  4. look-at (neck/head additive)  5. attach points / proxy / head height from FK
 * ========================================================================================== */

type Mask = 'upper' | 'arms' | 'full' | 'legs';
interface Plan { clip?: string; sitClip?: string; loco?: boolean; proc?: boolean; mask?: Mask; minSpeed?: number; once?: boolean; procWeight?: number }

const PLANS: Partial<Record<AnimName, Plan>> = {
  idle: { loco: true }, walk: { loco: true, minSpeed: 1.3 }, run: { loco: true, minSpeed: 4.8 },
  tpose: { clip: 'A_TPose' }, sit: { clip: 'Sitting_Idle_Loop' }, talk: { clip: 'Idle_Talking_Loop', sitClip: 'Sitting_Talking_Loop' },
  dance: { clip: 'Dance_Loop' }, push_cart: { clip: 'Push_Loop' }, fall: { clip: 'Death01', once: true }, punch: { clip: 'Punch_Cross', once: true }, kick: { proc: true, mask: 'full' },
  sit_floor: { proc: true, mask: 'full' }, sleep: { proc: true, mask: 'full' }, lie_cardboard: { proc: true, mask: 'full' },
  celebrate: { proc: true, mask: 'full' }, casino_cheer: { proc: true, mask: 'full' }, tug: { proc: true, mask: 'full' },
  wake_up: { proc: true, mask: 'full' }, stand_cool: { proc: true, mask: 'full' },
  scream_run: { loco: true, minSpeed: 4.8, proc: true, mask: 'arms' },
  drunk: { loco: true, proc: true, mask: 'upper', procWeight: 0.85 }, sad: { loco: true, proc: true, mask: 'upper' }, carry_heavy: { loco: true, proc: true, mask: 'upper' },
  jenga_pull: { clip: 'Sitting_Idle_Loop', proc: true, mask: 'upper' },
  cine_point: { proc: true, mask: 'full' }, cine_twist: { proc: true, mask: 'full' }, cine_lean: { proc: true, mask: 'full' },
  cine_menace: { proc: true, mask: 'full' }, cine_cross: { proc: true, mask: 'full' }, cine_hair: { proc: true, mask: 'full' },
  stretch: { proc: true, mask: 'full' }, sneak: { clip: 'Crouch_Fwd_Loop' },
};
/** anims whose feet stay planted (foot locking / ground IK allowed) besides locomotion */
const IK_OK = new Set<AnimName>(['stand_cool', 'cine_point', 'cine_twist', 'cine_lean', 'cine_menace', 'cine_cross', 'cine_hair', 'sneak']);
/** anims that bring a hand to the face (first person: kept out of the camera) */
const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const UPPER_PROC: AnimName[] = ['slap', 'get_slapped', 'highfive', 'give', 'point', 'wave', 'angry', 'shrug', 'count_coins', 'think', 'eat', 'drink', 'cook_stir', 'chop', 'wash', 'wipe', 'pray', 'casino_despair',
  'look_around', 'nod', 'laugh', 'facepalm', 'handshake', 'lecture'];
for (const a of UPPER_PROC) PLANS[a] = { proc: true, mask: 'upper' };

const LOCO = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop'];
const LOCO_SPEED = [0, 1.45, 3.3, 5.6]; // m/s of each clip for the 1.8 m body

const GLB_ORDER = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r', 'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r'];
const UPPER_SET = new Set(['spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r']);
const LEGS_SET = new Set(['pelvis', 'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r']);
const ARMS_SET = new Set(['neck_01', 'Head', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r']);
const DIR_CHILD: Record<string, string> = { upperarm_l: 'lowerarm_l', lowerarm_l: 'hand_l', hand_l: 'middle_01_l', upperarm_r: 'lowerarm_r', lowerarm_r: 'hand_r', hand_r: 'middle_01_r', thigh_l: 'calf_l', calf_l: 'foot_l', thigh_r: 'calf_r', calf_r: 'foot_r' };
const MY_OF: Record<string, number> = {
  pelvis: B.hips, spine_01: B.spine, spine_02: B.chest, spine_03: B.chest, neck_01: B.neck, Head: B.head, clavicle_l: B.clav_l, upperarm_l: B.upperarm_l, lowerarm_l: B.forearm_l, hand_l: B.hand_l,
  clavicle_r: B.clav_r, upperarm_r: B.upperarm_r, lowerarm_r: B.forearm_r, hand_r: B.hand_r, thigh_l: B.thigh_l, calf_l: B.shin_l, foot_l: B.foot_l, thigh_r: B.thigh_r, calf_r: B.shin_r, foot_r: B.foot_r,
};

// per-template precomputed retarget data
interface Finger { i: number; side: number; f: number; seg: number; flex: THREE.Vector3; spread: THREE.Vector3 }
interface TData { order: number[]; dirLocal: Map<number, THREE.Vector3>; QpInv: THREE.Quaternion[]; offLocal: Map<AttachPoint, { b: number; off: THREE.Vector3 }>; fingers: Finger[]; inBones: number[] }
const tdata = new WeakMap<BodyTemplate, TData>();
function templateData(t: BodyTemplate): TData {
  let d = tdata.get(t);
  if (d) return d;
  const order = GLB_ORDER.map((n) => t.index[n]).filter((i) => i !== undefined);
  const dirLocal = new Map<number, THREE.Vector3>();
  for (const [n, c] of Object.entries(DIR_CHILD)) {
    const bi = t.index[n], ci = t.index[c];
    if (bi === undefined || ci === undefined) continue;
    const e = t.Gp[ci].clone().sub(t.Gp[bi]).normalize();
    dirLocal.set(bi, e.applyQuaternion(t.Gq[bi].clone().invert()));
  }
  const QpInv = t.names.map((_, i) => (t.parent[i] >= 0 ? t.Gq[t.parent[i]].clone().invert() : new THREE.Quaternion()));
  const offLocal = new Map<AttachPoint, { b: number; off: THREE.Vector3 }>();
  const put = (pt: AttachPoint, bone: string, off: THREE.Vector3) => { const b = t.index[bone]; offLocal.set(pt, { b, off: off.applyQuaternion(t.Gq[b].clone().invert()) }); };
  // offsets in rest model space (T-pose: left hand points +X, palm down)
  put('hand_l', 'hand_l', new THREE.Vector3(0.085, -0.035, 0.01));
  put('hand_r', 'hand_r', new THREE.Vector3(-0.085, -0.035, 0.01));
  put('arm_l', 'upperarm_l', new THREE.Vector3(0.12, -0.06, 0.03));
  put('arm_r', 'upperarm_r', new THREE.Vector3(-0.12, -0.06, 0.03));
  put('mouth', 'Head', new THREE.Vector3(0, t.info.eyes[0][1] - t.Gp[t.index.Head].y - 0.055, t.info.eyes[0][2] - t.Gp[t.index.Head].z + 0.04));
  put('back', 'spine_03', new THREE.Vector3(0, 0.08, -0.17));
  put('chest', 'spine_03', new THREE.Vector3(0, -0.12, 0.3));
  put('hip', 'pelvis', new THREE.Vector3(-0.19, -0.04, 0.02));
  put('head', 'Head', new THREE.Vector3(0, t.height - t.Gp[t.index.Head].y + 0.004, -0.01));
  // finger joints: flex (towards the palm) & spread axes in each joint's parent rest frame (T-pose: palms down)
  const fingers: Finger[] = [];
  const palmN = new THREE.Vector3(0, -1, 0);
  for (const [side, sfx] of [[1, 'l'], [-1, 'r']] as [number, string][]) {
    FINGERS.forEach((fn, f) => {
      for (let seg = 1; seg <= 3; seg++) {
        const i = t.index[`${fn}_0${seg}_${sfx}`], ci = t.index[`${fn}_0${seg + 1}${seg === 3 ? '_leaf' : ''}_${sfx}`];
        if (i === undefined || ci === undefined) continue;
        const dir = t.Gp[ci].clone().sub(t.Gp[i]).normalize();
        const flex = new THREE.Vector3().crossVectors(dir, palmN).normalize();
        const spread = palmN.clone().multiplyScalar(side);
        const p = t.parent[i];
        const inv = p >= 0 ? t.Gq[p].clone().invert() : new THREE.Quaternion();
        fingers.push({ i, side, f, seg, flex: flex.applyQuaternion(inv).normalize(), spread: spread.applyQuaternion(inv).normalize() });
      }
    });
  }
  const inBones = [...order, ...fingers.map((x) => x.i)];
  d = { order, dirLocal, QpInv, offLocal, fingers, inBones };
  tdata.set(t, d);
  return d;
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _q4 = new THREE.Quaternion();
const _m4 = new THREE.Matrix4(), _w1 = new THREE.Vector3(), _w2 = new THREE.Vector3(), _w3 = new THREE.Vector3(), _w4 = new THREE.Vector3(), _w5 = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const IK_T = [new THREE.Vector3(), new THREE.Vector3()];
/** follow-through time constants (1/s): higher = tighter */
const LAG_RATES: [number, number][] = [
  [B.spine, 28], [B.chest, 24], [B.neck, 18], [B.head, 14], [B.clav_l, 22], [B.clav_r, 22],
  [B.upperarm_l, 22], [B.upperarm_r, 22], [B.forearm_l, 15], [B.forearm_r, 15], [B.hand_l, 11], [B.hand_r, 11],
];
const LAG_PASS = Array.from({ length: NB }, (_, i) => i).filter((i) => !LAG_RATES.some(([b]) => b === i));
const _m4r = new THREE.Matrix4(), _wR = new THREE.Vector3();   // foot targets (never used as scratch)
const _ikT = new THREE.Vector3();
const warned = new Set<string>();
const GRIP2 = (() => { const a = new Float32Array(HS_N * 2); const g = [0.55, 0.62, 0.7, 0.76, 0.82, 0]; a.set(g, 0); a.set(g, HS_N); return a; })();
const D2 = Math.PI / 180;
const FLEX_DEG = [[28, 32, 38], [72, 95, 62], [74, 98, 64], [76, 98, 64], [78, 96, 62]];
const SPREAD_DEG = [14, 10, 2, -6, -13];
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const D2R = Math.PI / 180;

/* ---- photo-real skin / eyes / hair / fabric on the single atlas material ----------------------------
 * skin mask (painter: final atlas == skin-only paint) → skin gets wrap-lit, red-shifted soft terminator and
 * warm back-light translucency (ears, nose rim, fingers), real pore detail (photo, painted into the atlas) as
 * bump, satin roughness; eyes (face-photo landmarks) get a wet, glossy surface + a tiny catchlight;
 * hair (atlas hair region) gets a dual Kajiya-Kay strand highlight; fabric weave relief = bump from the
 * real fabric photos in the albedo. */
const WHITE1 = (() => { const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); t.needsUpdate = true; return t; })();
const CHAR_PARS_F = FACE_EXPR_PARS + /* glsl */`
uniform sampler2D uSkinMask;
float skinG = 0.0; float wetG = 0.0; float hairG = 0.0; float catchG = 0.0; float bumpK = 1.0;
bool inRect(vec2 p, vec4 r) { return p.x > r.x && p.y > r.y && p.x < r.x + r.z && p.y < r.y + r.w; }
`;
const CHAR_MAP_F = /* glsl */`
// ---- animated face: warp the photo (brows / eyes / mouth), eyelids, mouth interior (face-expr.ts)
vec2 mUv = vMapUv;
float lidCover = 0.0, lashK = 0.0, mouthIn = 0.0;
vec2 lidSrc = vec2(0.0), eyeShift = vec2(0.0);
vec3 mouthCol = vec3(0.0);
if (uFaceOn > 0.5 && inRect(vMapUv * 1024.0, vec4(5.0, 405.0, 310.0, 310.0))) {
  vec2 f = (vMapUv * 1024.0 - vec2(5.0, 405.0)) / 310.0;
  vec2 fd = f;
  ${FACE_EXPR_WARP}
  mUv = (vec2(5.0, 405.0) + clamp(fd, 0.0, 1.0) * 310.0) / 1024.0;
}
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D(map, mUv);
  if (lidCover > 0.001) {
    vec3 lc = texture2D(map, (vec2(5.0, 405.0) + clamp(lidSrc, 0.0, 1.0) * 310.0) / 1024.0).rgb;
    sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, lc * mix(1.0, 0.16, lashK), lidCover);
  }
  if (mouthIn > 0.001) sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, mouthCol, mouthIn);
  diffuseColor *= sampledDiffuseColor;
#endif
{
  vec2 ap = vMapUv * 1024.0;                        // virtual atlas px (layout.ts)
  skinG = texture2D(uSkinMask, vMapUv).r;
  bumpK = mix(1.0, 0.3, skinG);
  if (inRect(ap, vec4(5.0, 405.0, 310.0, 310.0))) {  // face photo: eye landmarks at (0.36,0.44)/(0.64,0.44)
    vec2 f = (ap - vec2(5.0, 405.0)) / 310.0 - eyeShift;
    vec2 e1 = (f - vec2(0.36, 0.442)) * vec2(1.0, 1.7), e2 = (f - vec2(0.64, 0.442)) * vec2(1.0, 1.7);
    wetG = (1.0 - smoothstep(0.03, 0.045, min(length(e1), length(e2)))) * (1.0 - lidCover);
    float dc = min(length(f - vec2(0.352, 0.432)), length(f - vec2(0.632, 0.432)));
    catchG = (1.0 - smoothstep(0.0035, 0.007, dc)) * (1.0 - lidCover);
    bumpK = 0.12;
    skinG = max(skinG, 0.85) * (1.0 - wetG) * (1.0 - mouthIn);
    wetG = max(wetG, mouthIn * 0.55);
  }
  if (inRect(ap, vec4(704.0, 400.0, 320.0, 272.0))) {
    hairG = 1.0; skinG = 0.0; bumpK = 0.9;
    // alpha-tested strand ends on the shell edges (hairline rim t≈0.62, curtain tips t→1): no helmet edge
    vec2 h = (ap - vec2(709.0, 405.0)) / vec2(310.0, 262.0);
    float col = floor(h.x * 190.0);
    float n1 = fract(sin(col * 12.9898) * 43758.5453), n2 = fract(sin(col * 78.233 + 3.1) * 23421.631);
    float rim = (h.y - 0.565) / 0.055, tip = (h.y - 0.9) / 0.1;
    if ((rim > 0.0 && rim < 1.0 && rim > 0.25 + n1 * 0.75) || (tip > 0.0 && tip > 0.15 + n2 * 0.85)) discard;
  }
}
`;
const CHAR_ROUGH_F = /* glsl */`
#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.52, skinG);
roughnessFactor = mix(roughnessFactor, 0.62, hairG);
roughnessFactor = mix(roughnessFactor, 0.08, wetG);
`;
const CHAR_EMIS_F = /* glsl */`
#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(0.9, 0.92, 0.95) * catchG;
`;
/** bump with NaN guards: on dense meshes (the face scan) the screen-space derivatives can be zero/parallel →
 *  normalize(0) = NaN → the NaN guard paints the pixel black (black blotches on faces) */
const CHAR_BUMP_F = THREE.ShaderChunk.bumpmap_pars_fragment.replace(/bumpScale \*/g, 'bumpScale * bumpK *')
  .replace('vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );\n\t\tvec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );',
    'vec3 sdx = dFdx( surf_pos.xyz ), sdy = dFdy( surf_pos.xyz );\n\t\tif ( dot( sdx, sdx ) < 1e-24 || dot( sdy, sdy ) < 1e-24 ) return surf_norm;\n\t\tvec3 vSigmaX = normalize( sdx );\n\t\tvec3 vSigmaY = normalize( sdy );')
  .replace('return normalize( abs( fDet ) * surf_norm - vGrad );', 'vec3 pn = abs( fDet ) * surf_norm - vGrad;\n\t\treturn dot( pn, pn ) > 1e-20 ? normalize( pn ) : surf_norm;');
if (!CHAR_BUMP_F.includes('sdx') || !CHAR_BUMP_F.includes('pn, pn')) console.warn('[characters] bump guard patch did not apply');
const CHAR_LIGHT_F = THREE.ShaderChunk.lights_physical_pars_fragment
  .replace('float dotNL = saturate( dot( geometryNormal, directLight.direction ) );\n\n\tvec3 irradiance = dotNL * directLight.color;',
    `float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 wrapS = vec3(0.42, 0.24, 0.17);
	vec3 dotNLs = saturate((dot(geometryNormal, directLight.direction) + wrapS) / (1.0 + wrapS));
	vec3 irradiance = mix(vec3(dotNL), dotNLs, skinG) * directLight.color;`)
  .replace('reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );\n}',
    `reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	{
		// skin: warm translucency when back-lit (ear rims, nose, fingers)
		float bl = pow(saturate(dot(geometryViewDir, -directLight.direction)), 3.0) * pow(1.0 - saturate(dot(geometryNormal, geometryViewDir)), 1.5);
		reflectedLight.directDiffuse += directLight.color * bl * skinG * vec3(1.0, 0.32, 0.18) * material.diffuseColor * 1.6;
		// hair: dual Kajiya-Kay highlight along the strands (combed down from the crown)
		if (hairG > 0.5) {
			vec3 up = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
			vec3 T = up - geometryNormal * dot(up, geometryNormal);
			T = dot(T, T) > 1e-6 ? normalize(T) : up;
			vec3 Hh = normalize(directLight.direction + geometryViewDir);
			float t1 = dot(T, Hh), t2 = dot(normalize(T + geometryNormal * 0.25), Hh);
			float s1 = pow(sqrt(max(0.0, 1.0 - t1 * t1)), 80.0), s2 = pow(sqrt(max(0.0, 1.0 - t2 * t2)), 22.0);
			float nl = saturate(dot(geometryNormal, directLight.direction) * 0.5 + 0.5);
			reflectedLight.directSpecular += directLight.color * nl * (0.05 * s1 + 0.16 * s2 * material.diffuseColor);
		}
	}
}`);

/* First-person body (camera pass only — shadows use the depth material, so the full body + head still cast):
 * every vertex carries fpCull = (region, hidden weight) baked from its skin weights. With uFpOn the upper
 * torso / neck / head / clavicles collapse onto the pelvis (closing the waist into a small cap at the belt), the
 * upper arms onto their elbows — so looking down you see only hips, legs, feet, forearms and hands, never the
 * inside of the chest, the neck stump or shoulders clipping the near plane. */
const FP_PARS = `attribute vec2 fpCull;
uniform float uFpOn;
uniform vec3 uFpC[3];`;
const FP_MAIN = `if (uFpOn > 0.5 && fpCull.y > 0.001) {
  vec3 fpc = fpCull.x < 1.5 ? uFpC[0] : (fpCull.x < 2.5 ? uFpC[1] : uFpC[2]);
  transformed = mix(transformed, fpc, clamp(fpCull.y * 1.15, 0.0, 1.0));
}`;
const FP_TORSO = ['spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', 'clavicle_l', 'clavicle_r'];
/** bake the fpCull attribute (region 1 torso, 2 left upper arm, 3 right upper arm) from the skin weights */
function ensureFpCull(geo: THREE.BufferGeometry, index: Record<string, number>) {
  if (geo.getAttribute('fpCull')) return;
  const si = geo.getAttribute('skinIndex'), sw = geo.getAttribute('skinWeight');
  const n = geo.getAttribute('position').count;
  const out = new Float32Array(n * 2);
  if (si && sw) {
    const reg = new Map<number, number>();
    for (const b of FP_TORSO) if (index[b] !== undefined) reg.set(index[b], 1);
    if (index.upperarm_l !== undefined) reg.set(index.upperarm_l, 2);
    if (index.upperarm_r !== undefined) reg.set(index.upperarm_r, 3);
    for (let v = 0; v < n; v++) {
      const w = [0, 0, 0, 0];
      for (let k = 0; k < 4; k++) {
        const r = reg.get(si.getComponent(v, k));
        if (r) w[r] += sw.getComponent(v, k);
      }
      const tot = w[1] + w[2] + w[3];
      if (tot <= 0.001) continue;
      const r = w[1] >= w[2] && w[1] >= w[3] ? 1 : w[2] >= w[3] ? 2 : 3;
      out[v * 2] = r; out[v * 2 + 1] = Math.min(1, tot);
    }
  }
  geo.setAttribute('fpCull', new THREE.BufferAttribute(out, 2));
}

function makeAtlasMaterial() {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.84, metalness: 0, envMapIntensity: 0.85, bumpScale: 1.4 });
  m.name = 'char-atlas';
  m.userData.uFat = { value: 0 };
  m.userData.uSkin = { value: WHITE1 };
  m.userData.uFace = { value: new Float32Array(20) };
  m.userData.uFaceOn = { value: 0 };
  m.userData.uFpOn = { value: 0 };
  m.userData.uFpC = { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFat = m.userData.uFat;
    sh.uniforms.uSkinMask = m.userData.uSkin;
    sh.uniforms.uFace = m.userData.uFace;
    sh.uniforms.uFaceOn = m.userData.uFaceOn;
    sh.uniforms.uFpOn = m.userData.uFpOn;
    sh.uniforms.uFpC = m.userData.uFpC;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float afat;\nuniform float uFat;\n' + FP_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normal * afat * uFat;')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\n' + FP_MAIN);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + CHAR_PARS_F)
      .replace('#include <map_fragment>', CHAR_MAP_F)
      .replace('#include <roughnessmap_fragment>', CHAR_ROUGH_F)
      .replace('#include <emissivemap_fragment>', CHAR_EMIS_F)
      .replace('#include <bumpmap_pars_fragment>', CHAR_BUMP_F)
      .replace('#include <lights_physical_pars_fragment>', CHAR_LIGHT_F);
  };
  m.customProgramCacheKey = () => 'char-atlas-skin3-face-fp1';
  return m;
}

export class Rig implements CharacterRig {
  readonly root = new THREE.Group();
  private inner = new THREE.Group();
  look: Look;
  height = 1.7;
  private opts: RigOpts;
  private t!: BodyTemplate;
  private td!: TData;
  private spec!: BodySpec;
  private mySk!: RestSkel;
  private bones: THREE.Bone[] = [];
  private skeleton!: THREE.Skeleton;
  private mesh: THREE.SkinnedMesh | null = null;
  private meshLo: THREE.SkinnedMesh | null = null;
  private geoKey = '';
  private geoKeyLo = '';
  private mat = makeAtlasMaterial();
  private face3d: THREE.SkinnedMesh | null = null;
  private faceMat: THREE.MeshStandardMaterial | null = null;
  private atlasE: { mtex?: THREE.Texture } | null = null;
  private atlasKey = '';
  private atlasSize = 512;
  private attachPts = new Map<AttachPoint, THREE.Object3D>();
  private proxy: THREE.Mesh;
  private mixer!: THREE.AnimationMixer;
  private acts = new Map<string, THREE.AnimationAction>();
  private wClip = new Map<string, number>();
  private wLoco = 1;
  private locoPhase = Math.random();
  private wProc = 0;
  private procMask: Mask = 'upper';
  private pb!: PoseBuilder;
  private target = new Pose();
  private out = new Pose();
  private fadeFrom = new Pose();
  private fadeT = 1;
  private fadeDur = 0.25;
  private cur: { name: AnimName; def: AnimDef; plan: Plan; t: number; loop: boolean; speed: number; onEnd?: () => void; ended: boolean };
  private resume: AnimName = 'idle';
  posture: Posture = 'stand';
  seat = 0.45;
  private moveTarget = 0;
  private speed = 0;
  private phase = Math.random();
  private moveW = 0;
  private runW = 0;
  private carry: CarryPose = { r: false, l: false, two: false, head: false, load: 0 };
  private carryW = { r: 0, l: 0, two: 0, head: 0, load: 0 };
  private faceOverride: FaceVariant | null = null;
  private faceCur: FaceVariant = 'neutral';
  private lookTarget: THREE.Vector3 | null = null;
  private lookW = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private gt = Math.random() * 100;
  private rnd = Math.random();
  private stagger = Math.floor(Math.random() * 8);
  private accDt = 0;
  private mode: 'normal' | 'sil' | 'fp' = 'normal';
  private lodLevel: 'high' | 'low' = 'high';
  private fidget: { i: number; t: number; dur: number } | null = null;
  private fidgetWait = 4 + Math.random() * 8;
  private disposed = false;
  private age = 0;
  private wobble = 0;
  private Fq: THREE.Quaternion[] = [];
  private Fp: THREE.Vector3[] = [];
  private myWq: THREE.Quaternion[] = Array.from({ length: NB }, () => new THREE.Quaternion());
  headHeight = 1.7;
  private hairTop = 0;
  // ---- animated face
  readonly face: FaceRig;
  private explicitTalk = false;
  /** ambient behaviour (glances at the camera, micro reactions); scenes may switch it off per rig */
  ambient = true;
  private amb = { t: 3 + Math.random() * 6, dur: 0, on: false, p: new THREE.Vector3() };
  // ---- personality & idle weight shifts
  private pers: Personality;
  private shift = 0;
  private shiftTarget = 0;
  private shiftT = 2 + Math.random() * 5;
  // ---- inertial transitions (pop-free blending of the final skeleton pose)
  private inPrev = new Float32Array(0);
  private inOff = new Float32Array(0);
  private inPrevP = new THREE.Vector3();
  private inOffP = new THREE.Vector3();
  private inT = 1;
  private inDur = 0.3;
  private inPending = 0;
  private inHas = false;
  // ---- root motion measurement & secondary motion
  private rPrev = new THREE.Vector3();
  private rVel = new THREE.Vector3();
  private rHas = false;
  private rYaw = 0;
  private rSpeed = 0;
  private accF = 0; private accL = 0; private yawRate = 0;
  private spr = new Float32Array(10);
  private exert = 0;
  // ---- foot locking / ground IK
  private feet = [0, 1].map(() => ({ lock: false, lp: new THREE.Vector3(), rel: -1, from: new THREE.Vector3(), prev: new THREE.Vector3(), has: false }));
  private ikW = 0;
  private pelvisDrop = 0;
  // ---- first person
  private fpFrame = -1;

  constructor(look: Look, opts: RigOpts = {}) {
    this.opts = opts;
    this.look = look;
    this.root.name = 'character';
    this.inner.rotation.y = Math.PI;
    this.root.add(this.inner);
    for (const p of ATTACH) { const o = new THREE.Group(); o.name = 'attach_' + p; this.root.add(o); this.attachPts.set(p, o); }
    this.proxy = new THREE.Mesh(proxyGeo, proxyMat);
    this.proxy.name = 'character-proxy';
    this.root.add(this.proxy);
    this.cur = { name: 'idle', def: ANIMS.idle, plan: PLANS.idle!, t: 0, loop: true, speed: 1, ended: false };
    const r = (k: number) => { const x = Math.sin((this.rnd * 1000 + k) * 12.9898) * 43758.5453; return x - Math.floor(x); };
    this.pers = { slouch: r(1) * 2 - 1, tilt: r(2) * 2 - 1, tempo: 0.8 + r(3) * 0.45, energy: r(4) };
    this.face = new FaceRig(r(5));
    this.build(look);
    RigWorld.rigs.add(this);
  }

  static available(look: Look) { return !!(look?.sex === 'f' ? TEMPLATES.f : TEMPLATES.m); }

  // ---------------------------------------------------------------- build

  private build(look: Look) {
    const spec = bodySpec(look);
    const t = (spec.sex === 'f' ? TEMPLATES.f : TEMPLATES.m)!;
    const newSkel = this.t !== t;
    this.spec = spec;
    this.t = t;
    this.td = templateData(t);
    this.mySk = restSkel(spec.sex, spec.build);
    this.pb = new PoseBuilder(this.mySk);
    this.height = Math.max(1.2, Math.min(2.1, look.height || 1.7));
    this.inner.scale.setScalar(this.height / t.height);
    this.age = estimateAge(look);
    if (newSkel) {
      for (const b of this.bones) b.removeFromParent();
      this.bones = t.names.map((n, i) => { const b = new THREE.Bone(); b.name = n; b.position.copy(t.restPos[i]); b.quaternion.copy(t.restQuat[i]); b.scale.copy(t.restScale[i]); return b; });
      this.bones.forEach((b, i) => { const p = t.parent[i]; if (p >= 0) this.bones[p].add(b); else this.inner.add(b); });
      this.skeleton = new THREE.Skeleton(this.bones, t.boneInverses.map((m) => m.clone()));
      this.Fq = t.names.map(() => new THREE.Quaternion());
      this.Fp = t.names.map(() => new THREE.Vector3());
      this.mixer?.stopAllAction();
      this.mixer = new THREE.AnimationMixer(this.inner);
      this.acts.clear(); this.wClip.clear();
    }
    const lod: Lod = this.opts.lod === 'low' ? 'low' : 'high';
    const g = acquireLookGeometry(t, spec, lod);
    if (this.geoKey) releaseLookGeometry(this.geoKey);
    this.geoKey = g.key;
    this.mesh?.removeFromParent();
    this.mesh = this.makeMesh(g.geo);
    // photoscanned 3D face (near LOD); the photo-projected head underneath stays as far LOD / fallback
    this.face3d?.removeFromParent();
    this.face3d = null;
    if (t.faceMask && lod === 'high') {
      if (!this.faceMat) {
        // own material: same atlas/skin shader, but no screen-space ink creases across the scanned relief
        const f = this.mat.clone();
        f.onBeforeCompile = this.mat.onBeforeCompile;
        f.customProgramCacheKey = this.mat.customProgramCacheKey;
        f.userData = { ...this.mat.userData };
        // softer cel banding on the scanned relief. Ink mask MUST stay 1: the ink mask is written to the scene alpha and
        // alpha 0 comes out of the post chain as black (the black blotches that covered half of every face)
        setInk(f, 1, 0.3);
        // the scan sits almost on the photo-projected head under it: win the depth test (no z-fighting seams/double mouths)
        f.polygonOffset = true; f.polygonOffsetFactor = -1; f.polygonOffsetUnits = -4;
        this.faceMat = f;
      }
      const fm = new THREE.SkinnedMesh(t.faceMask, this.faceMat);
      fm.name = 'face-scan';
      fm.bind(this.skeleton, new THREE.Matrix4());
      fm.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 1.5);
      fm.castShadow = false;
      fm.receiveShadow = true;
      fm.raycast = () => {};
      fm.userData.noHull = true;          // the body's ink hull already outlines the head
      this.fpHooks(fm);
      this.inner.add(fm);
      this.face3d = fm;
    }
    if (this.meshLo) { this.meshLo.removeFromParent(); if (this.geoKeyLo) releaseLookGeometry(this.geoKeyLo); this.meshLo = null; this.geoKeyLo = ''; }
    this.lodLevel = 'high';
    this.mat.userData.uFat.value = (spec.build - 0.42) * 0.05;
    this.atlasSize = this.opts.lod === 'high' ? 1024 : this.opts.lod === 'low' ? 256 : 512;
    this.setAtlas(this.faceCur);
    const hat = spec.acc.find((a) => a.slot === 'hat');
    this.hairTop = hairThickAt(spec.hair, 0, 0.22) * t.headModel.scale * (hat ? 0.3 : 1) + (hat ? (hat.kind === 'straw' ? 0.08 : hat.kind === 'helmet' ? 0.045 : 0.025) : 0);
    this.applyMaterials();
    TEMPLATES.onRigBuild?.(this, look); // physique hook
    this.tick(0);
  }

  private makeMesh(geo: THREE.BufferGeometry) {
    ensureFpCull(geo, this.t.index);
    const m = new THREE.SkinnedMesh(geo, [this.mat, accessoryMaterial()]);
    m.name = 'character-mesh';
    m.bind(this.skeleton, new THREE.Matrix4());
    m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 1.5);
    m.castShadow = this.opts.castShadow !== false;
    m.receiveShadow = true;
    m.raycast = () => {};
    this.fpHooks(m);
    this.inner.add(m);
    return m;
  }

  /** First person: camera draws collapse the upper body (see FP_MAIN) — shadow draws don't run onBeforeRender and
   *  use the depth material, so the shadow keeps the whole body. Centres are refreshed once per frame. */
  private fpHooks(m: THREE.Mesh) {
    m.onBeforeRender = (renderer: THREE.WebGLRenderer) => {
      const on = this.mode === 'fp' ? 1 : 0;
      for (const mat of [this.mat, this.fpAcc]) { const u = mat?.userData?.uFpOn; if (u) u.value = on; }
      if (!on) return;
      const f = renderer.info.render.frame;
      if (this.fpFrame === f) return;
      this.fpFrame = f;
      const C = this.mat.userData.uFpC.value as THREE.Vector3[];
      const I = this.t.index;
      const bone = (n: string, o: THREE.Vector3) => { const i = I[n]; if (i === undefined) return false; this.bones[i].getWorldPosition(o); m.worldToLocal(o); return true; };
      // the torso folds into the hips: waist cap sits at the belt (pelvis joint, nudged forward a touch)
      // (pushed back toward the spine and down a little: the cap tilts away from the eyes, the front of the hips/legs stays)
      if (bone('pelvis', C[0])) { C[0].z -= 0.16 / Math.max(0.5, m.getWorldScale(_w5).y); C[0].y -= 0.04; }
      if (!bone('lowerarm_l', C[1])) C[1].copy(C[0]);
      if (!bone('lowerarm_r', C[2])) C[2].copy(C[0]);
      if (this.fpAcc) for (let k = 0; k < 3; k++) (this.fpAcc.userData.uFpC.value as THREE.Vector3[])[k].copy(C[k]);
    };
  }
  /** first person: a private copy of the shared accessory material carrying the same cull (hats, glasses, chains) */
  private fpAcc: THREE.MeshStandardMaterial | null = null;
  private fpAccMat() {
    if (this.fpAcc) return this.fpAcc;
    const base = accessoryMaterial() as THREE.MeshStandardMaterial;
    const m = base.clone();
    m.userData = { uFpOn: { value: 0 }, uFpC: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] } };
    m.onBeforeCompile = (sh: any) => {
      sh.uniforms.uFpOn = m.userData.uFpOn; sh.uniforms.uFpC = m.userData.uFpC;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + FP_PARS)
        .replace('#include <skinning_vertex>', '#include <skinning_vertex>\n' + FP_MAIN);
    };
    m.customProgramCacheKey = () => 'char-acc-fp1';
    return (this.fpAcc = m);
  }
  private headScaled = false;
  private setHeadScale(k: number) {
    const i = this.t.index.Head;
    if (i === undefined) return;
    if ((k !== 1) === this.headScaled) return;
    this.headScaled = k !== 1;
    const h = this.bones[i];
    h.scale.copy(this.t.restScale[i]).multiplyScalar(k);
    h.updateMatrixWorld(true);
  }

  private setAtlas(v: FaceVariant) {
    const prev = this.atlasKey;
    const { key, e } = acquireAtlas(this.look, this.atlasSize, v, this.opts.lod === 'high', this.root);
    this.atlasKey = key;
    this.mat.map = e.tex;
    this.mat.bumpMap = e.tex;
    if (this.faceMat) { this.faceMat.map = e.tex; this.faceMat.bumpMap = null; this.faceMat.needsUpdate = true; }   // the scan has real relief
    this.atlasE = e;
    this.mat.userData.uSkin.value = e.mtex ?? WHITE1;
    this.mat.needsUpdate = true;
    if (prev) releaseAtlas(prev);
  }

  private applyMaterials() {
    let mats: THREE.Material[];
    if (this.mode === 'sil') mats = [silMat, silMat];
    else mats = [this.mat, this.mode === 'fp' ? this.fpAccMat() : accessoryMaterial()];   // first person: upper body culled per camera draw (fpHooks)
    for (const m of [this.mesh, this.meshLo]) if (m) m.material = mats;
    if (this.face3d) { this.face3d.material = this.mode !== 'sil' && this.faceMat ? this.faceMat : mats[0]; this.face3d.visible = this.mode !== 'fp' && this.lodLevel === 'high'; }
  }

  // ---------------------------------------------------------------- contract API

  setLook(look: Look) {
    const prev = lookKey(this.look), ph = this.height;
    this.look = look;
    if (lookKey(look) === prev && Math.abs((look.height || 1.7) - ph) < 1e-4) return;
    this.build(look);
  }

  play(anim: AnimName, opts: { loop?: boolean; speed?: number; fade?: number; onEnd?: () => void } = {}) {
    let d = ANIMS[anim];
    if (!d) {
      // never T-pose / throw on a name this build doesn't know: keep going with a neutral idle
      if (!warned.has(anim)) { warned.add(anim); console.warn('[characters] unknown anim', anim); }
      if (this.cur.name !== 'idle') { anim = 'idle'; d = ANIMS.idle; } else { try { opts.onEnd?.(); } catch { /* */ } return; }
    }
    const plan = PLANS[anim] ?? { proc: true, mask: 'upper' as Mask };
    const loop = opts.loop ?? d.loop;
    if (this.cur.name === anim && loop && this.cur.loop && !this.cur.ended) { this.cur.speed = opts.speed ?? 1; this.cur.onEnd = opts.onEnd; return; }
    if (this.cur.loop && !this.cur.ended && !loop) this.resume = this.cur.name;
    if (loop) this.resume = anim;
    this.fadeFrom.copy(this.out);
    this.fadeT = 0;
    this.fadeDur = opts.fade ?? d.fade ?? 0.25;
    if (opts.fade !== 0) this.inertialize(Math.min(0.42, Math.max(0.16, this.fadeDur * 1.1)));
    this.cur = { name: anim, def: d, plan, t: 0, loop, speed: opts.speed ?? 1, onEnd: opts.onEnd, ended: false };
    this.face.setAnimExpression(d.exprAt?.(0, 0) ?? d.expr ?? 'neutral');
    this.face.mouthMode = d.mouth ?? null;
    if (d.posture) this.posture = d.posture;
    if (anim === 'jenga_pull') this.seat = 0.42;
    if (plan.once && plan.clip) { const a = this.action(plan.clip); if (a) { a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } }
    else if (plan.clip) { const a = this.action(plan.clip); if (a && (this.wClip.get(plan.clip) ?? 0) < 0.05) a.reset(); }
    this.fidget = null;
    this.updateFace();
    // reaction timing: anticipation squash, then stretch overshoot
    switch (anim) {
      case 'get_slapped': this.squashKick(-2.6); this.squashKick(1.2, 0.18); break;
      case 'slap': this.squashKick(-0.9); this.squashKick(2.0, 0.14); break;
      case 'highfive': this.squashKick(-0.6); this.squashKick(2.2, 0.12); break;
      case 'scream_run': case 'wake_up': this.squashKick(2.6); break;
      case 'fall': this.squashKick(-2.2); break;
      case 'angry': this.squashKick(-1.4); this.squashKick(1.6, 0.16); break;
      case 'wave': case 'point': case 'shrug': case 'give': case 'think': case 'count_coins': this.squashKick(0.9); break;
      case 'celebrate': case 'casino_cheer': this.squashKick(-1.0); this.squashKick(2.4, 0.15); break;
      case 'drunk': case 'sad': this.squashKick(-0.8); break;
      case 'cine_point': case 'cine_twist': case 'cine_lean': case 'cine_menace': case 'cine_cross': case 'cine_hair': this.squashKick(-1.6); this.squashKick(2.2, 0.16); this.face.blink(); break;
      case 'laugh': case 'facepalm': case 'lecture': this.squashKick(-0.7); break;
      case 'stretch': this.squashKick(1.2, 0.5); break;
    }
  }

  /** Blend to an animated facial expression (blinking & talking stay automatic). */
  setExpression(e: Expression, opts?: { weight?: number; hold?: number; fade?: number }) { this.face.setExpression(e as ExprKey, opts); }
  /** Mouth flap while speaking. */
  setTalking(on: boolean) { this.explicitTalk = !!on; }
  /** Eye midpoint in world space from the current skeleton. `stable` (default) ignores neck/head wobble (first-person camera). */
  eyeWorld(out = new THREE.Vector3(), stable = true) {
    const t = this.t, s = 1;
    const e = t.info.eyes;
    _v3.set((e[0][0] + e[1][0]) / 2, (e[0][1] + e[1][1]) / 2, (e[0][2] + e[1][2]) / 2);
    const b = stable ? t.index.spine_03 : t.index.Head;
    // rest offset from the bone → current: Fq·Gq⁻¹ rotates rest model space into the posed bone frame
    _v3.sub(t.Gp[b]).applyQuaternion(_q4.copy(this.Fq[b]).multiply(_q3.copy(t.Gq[b]).invert())).add(this.Fp[b]);
    void s;
    this.inner.updateWorldMatrix(true, false);
    return out.copy(_v3).applyMatrix4(this.inner.matrixWorld);
  }
  /**
   * Scripted hand reach: two-bone IK (upper arm → forearm) puts the WRIST of `side` (1 = left, -1 = right) on a
   * world point, blended by `w` over the animation (elbow bend plane follows the anim). `shape` sets the fingers
   * (HAND_SHAPES name or curl vector) with the same weight. Pass null to release. Persists until changed.
   */
  reach(side: 1 | -1, target: THREE.Vector3 | null, o: { w?: number; shape?: string | number[] } = {}) {
    const k = side > 0 ? 0 : 1;
    if (!target || (o.w ?? 1) <= 0.001) { this.reachT[k] = null; return; }
    const r = this.reachT[k] ?? (this.reachT[k] = { p: new THREE.Vector3(), w: 1, hs: null });
    r.p.copy(target); r.w = Math.min(1, o.w ?? 1);
    const sh = typeof o.shape === 'string' ? (HAND_SHAPES as any)[o.shape] : o.shape;
    if (sh) { const hs = r.hs ?? (r.hs = new Float32Array(HS_N * 2)); hs.set(sh, k * HS_N); } else r.hs = null;
  }
  private reachT: ({ p: THREE.Vector3; w: number; hs: Float32Array | null } | null)[] = [null, null];
  private reachLean = [0, 0];
  private leanAx = new THREE.Vector3(1, 0, 0);
  private applyReach() {
    if (!this.reachT[0] && !this.reachT[1]) return;
    this.reachLean[0] = this.reachLean[1] = 0;
    this.inner.updateWorldMatrix(true, false);
    const inv = _m4r.copy(this.inner.matrixWorld).invert();
    for (let k = 0; k < 2; k++) {
      const r = this.reachT[k];
      if (!r) continue;
      const sfx = k === 0 ? 'l' : 'r', I = this.t.index;
      const ia = I['upperarm_' + sfx], ib = I['lowerarm_' + sfx], ic = I['hand_' + sfx];
      if (ia === undefined || ib === undefined || ic === undefined) continue;
      const tgt = _wR.copy(r.p).applyMatrix4(inv);
      tgt.lerpVectors(this.Fp[ic], tgt, r.w);
      // out of arm's reach: lean the upper body toward the target first (spine chain), like a person reaching
      const reach = (this.Fp[ia].distanceTo(this.Fp[ib]) + this.Fp[ib].distanceTo(this.Fp[ic])) * 0.94;
      const sp = I.spine_01, pv = I.pelvis;
      if (sp !== undefined && pv !== undefined) {
        for (let it = 0; it < 3; it++) {
          const deficit = this.Fp[ia].distanceTo(tgt) - reach;
          if (deficit <= 0.005) break;
          // rotate the spine about the axis that swings the shoulder toward the target, around the lower spine
          const piv = this.Fp[sp];
          _w1.copy(this.Fp[ia]).sub(piv); _w2.copy(tgt).sub(piv);
          const ax = _w3.crossVectors(_w1, _w2);
          if (ax.lengthSq() < 1e-8) break;
          ax.normalize();
          const ang = Math.min(0.32, deficit / Math.max(0.25, _w1.length())) * r.w;
          if (this.reachLean[k] + ang > 0.62) break;
          this.reachLean[k] += ang;
          this.leanAx.copy(ax);
          for (const [bn, f] of [['spine_01', 0.4], ['spine_02', 0.35], ['spine_03', 0.25]] as const) {
            const bi = I[bn]; if (bi === undefined) continue;
            const pa = this.t.parent[bi];
            _qa.setFromAxisAngle(ax, ang * f);
            _qb.copy(this.Fq[pa]).multiply(this.bones[bi].quaternion).premultiply(_qa);
            this.bones[bi].quaternion.copy(_q.copy(this.Fq[pa]).invert().multiply(_qb));
            this.fk();
          }
        }
      }
      // keep the eyes on the target while leaning: the neck/head take back most of the bend
      if (this.reachLean[k] > 0.01) {
        for (const [bn, f] of [['neck_01', 0.35], ['Head', 0.35]] as const) {
          const bi = I[bn]; if (bi === undefined) continue;
          const pa = this.t.parent[bi];
          _qa.setFromAxisAngle(this.leanAx, -this.reachLean[k] * f);
          _qb.copy(this.Fq[pa]).multiply(this.bones[bi].quaternion).premultiply(_qa);
          this.bones[bi].quaternion.copy(_q.copy(this.Fq[pa]).invert().multiply(_qb));
        }
        this.fk();
      }
      this.solve2(ia, ib, ic, tgt);
      this.fk();
      if (r.hs && this.near) this.applyFingers(r.hs, k === 0 ? r.w : 0, k === 1 ? r.w : 0);
    }
  }
  /** queue an inertial blend of the whole skeleton from its current output (pop-free changes) */
  inertialize(dur = 0.28) { this.inPending = Math.max(this.inPending, dur); }

  setMove(speed: number) { this.moveTarget = Math.max(0, Number.isFinite(speed) ? speed : 0); }
  setCarry(p: CarryPose) { if (p) this.carry = p; }
  setFace(v: FaceVariant) {
    this.faceOverride = (v as any) ?? null; this.updateFace();
    if (v && v !== 'neutral') this.face.setExpression(variantExpr(v), { fade: 0.2 }); else this.face.setExpression('neutral', { fade: 0.3 });
  }
  lookAt(p: THREE.Vector3 | null) { if (p) { if (!this.lookTarget) this.lookTarget = new THREE.Vector3(); this.lookTarget.copy(p); } else this.lookTarget = null; }
  attach(point: AttachPoint): THREE.Object3D { return this.attachPts.get(point) ?? this.attachPts.get('hand_r')!; }
  setSilhouette(on: boolean) { this.mode = on ? 'sil' : this.mode === 'sil' ? 'normal' : this.mode; this.applyMaterials(); }
  setFirstPerson(on: boolean) { this.mode = on ? 'fp' : this.mode === 'fp' ? 'normal' : this.mode; this.applyMaterials(); }

  // extras
  setPosture(p: Posture) { if (p && p !== this.posture) { this.fadeFrom.copy(this.out); this.fadeT = 0; this.fadeDur = 0.4; this.posture = p; this.inertialize(0.4); } }
  get anim() { return this.cur.name; }
  get lod() { return this.lodLevel; }
  get mesh_() { return this.mesh; }
  headWorld(out = new THREE.Vector3()) { this.root.updateWorldMatrix(true, false); return out.set(0, this.headHeight, 0).applyMatrix4(this.root.matrixWorld); }

  // ---------------------------------------------------------------- update

  update(dt: number) {
    if (this.disposed) return;
    // the skin mask arrives with the (queued) atlas paint
    const mt = this.atlasE?.mtex;
    if (mt && this.mat.userData.uSkin.value !== mt) this.mat.userData.uSkin.value = mt;
    this.root.getWorldPosition(_v);
    const d = _v.distanceTo(RigWorld.cam);
    const wantLow = this.opts.lod === 'low' || (this.opts.lod !== 'high' && d > RigWorld.lodDist);
    this.setLod(wantLow ? 'low' : 'high');
    const shadow = this.opts.castShadow !== false && d < RigWorld.shadowDist && this.mode !== 'sil';
    if (this.mesh) this.mesh.castShadow = shadow;
    if (this.meshLo) this.meshLo.castShadow = shadow;
    this.accDt += dt;
    const interval = this.opts.lod === 'high' || d < 16 ? 1 : d < 34 ? 2 : d < 60 ? 3 : d < 110 ? 5 : 0;
    if (interval === 0) { if (this.accDt > 2) this.accDt = 0; return; }
    if ((RigWorld.frame + this.stagger) % interval !== 0) return;
    const step = Math.min(0.25, this.accDt);
    this.accDt = 0;
    // close-up detail (animated face, foot IK, secondary motion) fades out with distance
    this.near = this.lodLevel === 'high' && this.mode !== 'sil' && (d < 16 || this.opts.lod === 'high') ? 1 : 0;
    this.face.detail = this.mode === 'sil' || this.lodLevel !== 'high' ? 0 : 1 - sm(11, 16, d);
    this.tick(step);
    this.squashTick(step);
  }
  private near = 1;

  // ---------------------------------------------------------------- goofy anime squash & stretch
  // anticipation → overshoot → wobble on reactions (volume-preserving scale of the whole body)
  private sq = 0; private sqV = 0; private sqKicks: { t: number; v: number }[] = []; private sqBeat = 0;
  private squashKick(v: number, delay = 0) { if (delay <= 0) this.sqV += v; else this.sqKicks.push({ t: delay, v }); }
  private squashTick(dt: number) {
    for (let i = this.sqKicks.length - 1; i >= 0; i--) { const k = this.sqKicks[i]; k.t -= dt; if (k.t <= 0) { this.sqV += k.v; this.sqKicks.splice(i, 1); } }
    const n = this.cur.name;
    // looping happy bounces / trembling
    if ((n === 'celebrate' || n === 'casino_cheer' || n === 'dance') && !this.cur.ended) { this.sqBeat += dt; if (this.sqBeat > 0.42) { this.sqBeat = 0; this.sqV += 1.5; } }
    else if ((n === 'angry' || n === 'tug' || n === 'casino_despair') && !this.cur.ended) this.sqV += (Math.random() - 0.5) * 6 * dt * 10;
    const k = 230, c = 10;
    this.sqV += (-this.sq * k - this.sqV * c) * dt;
    this.sq = Math.max(-0.32, Math.min(0.32, this.sq + this.sqV * dt));
    const base = this.height / this.t.height;
    const sy = 1 + this.sq * 0.3, sx = 1 / Math.sqrt(sy);
    this.inner.scale.set(base * sx, base * sy, base * sx);
  }

  private setLod(l: 'high' | 'low') {
    if (l === this.lodLevel) return;
    this.lodLevel = l;
    if (l === 'low' && !this.meshLo && this.opts.lod !== 'high' && this.opts.lod !== 'low') {
      const g = acquireLookGeometry(this.t, this.spec, 'low');
      this.geoKeyLo = g.key;
      this.meshLo = this.makeMesh(g.geo);
      this.applyMaterials();
    }
    if (this.mesh && this.meshLo) { this.mesh.visible = l === 'high'; this.meshLo.visible = l === 'low'; }
    if (this.face3d) this.face3d.visible = l === 'high' && this.mode !== 'fp';
  }

  private action(name: string): THREE.AnimationAction | null {
    let a = this.acts.get(name);
    if (a) return a;
    const clip = this.t.clips.get(name);
    if (!clip) return null;
    a = this.mixer.clipAction(clip);
    a.enabled = true;
    a.setEffectiveWeight(0);
    a.play();
    this.acts.set(name, a);
    return a;
  }

  private tick(dt: number) {
    const c = this.cur;
    this.gt += dt;
    if (dt > 0) this.measureRoot(dt);
    // idle weight shifts: every few seconds the weight moves to the other leg (personality sets the rhythm)
    this.shiftT -= dt;
    if (this.shiftT <= 0) {
      this.shiftT = (3.5 + Math.random() * 7) / this.pers.tempo * (1.3 - this.pers.energy * 0.6);
      const r = Math.random();
      this.shiftTarget = r < 0.15 ? 0 : (this.shiftTarget > 0 ? -1 : 1) * (0.6 + Math.random() * 0.4);
    }
    this.shift += (this.shiftTarget - this.shift) * (1 - Math.exp(-dt * 1.6));
    // ---- locomotion state
    let sp = this.moveTarget;
    if (c.plan.minSpeed && sp < 0.3) sp = c.plan.minSpeed;
    this.speed += (sp - this.speed) * (1 - Math.exp(-8 * dt));
    const v = this.speed;
    if (v > 0.45 && this.posture !== 'stand' && (c.plan.loco || !c.loop || c.name === 'idle' || (!c.def.posture && !c.plan.loco))) this.posture = 'stand';
    if (v > 0.6 && c.loop && !c.plan.loco && c.def.posture === 'stand' && c.name !== 'tpose' && !c.def.loco && c.name !== 'push_cart') this.play('idle', { fade: 0.3 });
    this.moveW += (sm(0.06, 0.7, v) - this.moveW) * (1 - Math.exp(-10 * dt));
    this.runW += (sm(3.3, 4.7, v) - this.runW) * (1 - Math.exp(-6 * dt));
    const cadence = (1 - this.runW) * (1.0 + 0.75 * Math.min(v, 3.4)) + this.runW * (2.6 + 0.12 * v);
    this.phase = (this.phase + (cadence / 2) * dt * (v > 0.05 ? 1 : 0)) % 1;
    // ---- anim time & one-shot end
    c.t += dt * c.speed;
    const clipDur = c.plan.once && c.plan.clip ? this.t.clips.get(c.plan.clip)?.duration ?? c.def.dur : c.def.dur;
    let k = clipDur > 0 ? c.t / clipDur : 0;
    if (!c.loop) {
      if (k >= 1 && !c.ended) {
        c.ended = true;
        const cb = c.onEnd; c.onEnd = undefined;
        try { cb?.(); } catch (e) { console.error(e); }
        if (!c.def.hold && !c.plan.once && this.cur === c) {
          const back = this.resume && ANIMS[this.resume]?.loop ? this.resume : 'idle';
          this.play(back, { fade: 0.35 });
          return this.tick(0);
        }
      }
      k = Math.min(1, k);
    } else k = k % 1;
    // ---- clip weights
    const plan = c.plan;
    const fadeK = 1 - Math.exp(-dt / Math.max(0.05, this.fadeDur) * 3);
    let baseClip: string | null = null;
    let wantLoco = 0;
    if (plan.clip) baseClip = this.posture === 'sit' && plan.sitClip ? plan.sitClip : plan.clip;
    else if (plan.loco) wantLoco = 1;
    else if (plan.proc && plan.mask !== 'full') {
      if (this.posture === 'sit') baseClip = 'Sitting_Idle_Loop';
      else if (this.posture === 'stand') wantLoco = 1;
    }
    if (plan.clip === 'Sitting_Idle_Loop' && plan.sitClip === undefined && c.name === 'talk') baseClip = 'Sitting_Talking_Loop';
    // sneaking: mocap crouch walk while moving, crouch idle when still (cross-faded by the clip weights below)
    if (c.name === 'sneak') baseClip = v > 0.15 ? 'Crouch_Fwd_Loop' : 'Crouch_Idle_Loop';
    if (baseClip) this.action(baseClip);
    this.wLoco += (wantLoco - this.wLoco) * fadeK;
    for (const name of new Set([...this.acts.keys()])) {
      if (LOCO.includes(name)) continue;
      const want = name === baseClip ? 1 : 0;
      const w = (this.wClip.get(name) ?? 0) + (want - (this.wClip.get(name) ?? 0)) * fadeK;
      this.wClip.set(name, w);
      const a = this.acts.get(name)!;
      a.enabled = w > 0.002;
      a.setEffectiveWeight(w);
      if (name === 'Push_Loop') a.timeScale = Math.max(0.35, Math.min(1.6, v / 1.1 + 0.35));
      if (name === 'Crouch_Fwd_Loop') a.timeScale = Math.max(0.4, Math.min(1.7, v / 0.9));
    }
    // locomotion blend (manually phase-synced)
    const hs = this.height / this.t.height;
    const sv = v / Math.max(0.5, hs);
    const wl = [1, 0, 0, 0];
    if (sv > 0.04) {
      const w1 = sm(0.04, 0.9, sv);
      const w2 = sm(2.1, 3.1, sv), w3 = sm(4.3, 5.3, sv);
      wl[0] = 1 - w1; wl[1] = w1 * (1 - w2); wl[2] = w1 * w2 * (1 - w3); wl[3] = w1 * w2 * w3;
    }
    // standing still is handled by the procedural relaxed idle; clips only for moving
    wl[0] = 0;
    { const wm = wl[1] + wl[2] + wl[3]; if (wm > 1e-4) for (let i = 1; i < 4; i++) wl[i] /= wm; }
    let freq = 0;
    for (let i = 1; i < 4; i++) { const clip = this.t.clips.get(LOCO[i]); if (clip && wl[i] > 0) freq += wl[i] * (Math.max(0.55, Math.min(1.8, sv / LOCO_SPEED[i])) / clip.duration); }
    const wMove = wl[1] + wl[2] + wl[3];
    if (wMove > 0) this.locoPhase = (this.locoPhase + (freq / wMove) * dt) % 1;
    for (let i = 0; i < 4; i++) {
      const w = wl[i] * this.wLoco;
      const a = this.acts.get(LOCO[i]) ?? (w > 0.002 ? this.action(LOCO[i]) : null);
      if (!a) continue;
      a.enabled = w > 0.002;
      a.setEffectiveWeight(w);
      a.timeScale = 0;
      if (i > 0) a.time = this.locoPhase * a.getClip().duration;
      else a.time = (this.gt * 0.9) % a.getClip().duration;
    }
    this.mixer.update(dt);
    this.fk();
    // ---- procedural layer
    const locoOnly = !!plan.loco && !plan.proc;
    const wantProc = plan.proc ? plan.procWeight ?? 1 : locoOnly ? 1 : 0;
    this.wProc += (wantProc - this.wProc) * fadeK;
    this.procMask = plan.proc ? (plan.mask === 'upper' && (this.posture === 'floor' || this.posture === 'lie') ? 'full' : plan.mask ?? 'upper') : locoOnly ? 'full' : this.procMask;
    // legs/pelvis follow the walk clips while moving, the procedural stance while standing
    const standLegs = this.posture === 'stand' && (locoOnly || (plan.proc && plan.mask !== 'full' && (plan.loco || !plan.clip)));
    const legW = standLegs ? 1 - this.moveW : this.procMask === 'full' ? 1 : 0;
    const cw = this.carryW, cp = this.carry;
    const ck = 1 - Math.exp(-10 * dt);
    cw.r += ((cp.r ? 1 : 0) - cw.r) * ck; cw.l += ((cp.l ? 1 : 0) - cw.l) * ck; cw.two += ((cp.two ? 1 : 0) - cw.two) * ck;
    cw.head += ((cp.head ? 1 : 0) - cw.head) * ck; cw.load += ((cp.load ?? 0) - cw.load) * ck;
    const ctx: AnimCtx = {
      pb: this.pb, t: c.t, k, dt, speed: v, phase: this.phase, moveW: this.moveW, runW: this.runW,
      build: this.spec.build, female: this.spec.sex === 'f', age: this.age, s: this.height / REF_H, rnd: this.rnd,
      carry: this.carry, posture: this.posture, seat: this.seat, gt: this.gt, wob: this.wobble,
      shift: this.shift, pers: this.pers,
    };
    if (this.wProc > 0.002 || this.fadeT < 1) {
      this.pb.p = this.target;
      this.pb.reset();
      try { (plan.proc ? c.def : ANIMS.idle).pose(ctx); } catch (e) { console.error('[characters] anim', c.name, e); }
      if (this.fadeT < 1) {
        this.fadeT = Math.min(1, this.fadeT + dt / Math.max(0.001, this.fadeDur));
        const w = this.fadeT * this.fadeT * (3 - 2 * this.fadeT);
        blendPose(this.out, this.fadeFrom, this.target, w);
      } else this.out.copy(this.target);
      if (this.near && plan.proc) this.followThrough(dt); else this.lagOn = false;
      if (this.wProc > 0.002) {
        const upperW = locoOnly ? this.wProc * (1 - this.moveW) : this.wProc;
        if (this.procMask === 'full' && !standLegs) this.applyProc(this.out, 'full', upperW);
        else {
          this.applyProc(this.out, this.procMask === 'arms' ? 'arms' : 'upper', upperW);
          if (legW > 0.002) this.applyProc(this.out, 'legs', this.wProc * legW);
        }
        if (this.near) this.applyFingers(this.out.hs, upperW, upperW);
      }
    }
    this.fk();
    // ---- idle fidgets (as a light procedural overlay on the arms/head)
    if (c.name === 'idle' && v < 0.08 && this.posture === 'stand' && cw.r + cw.l + cw.two + cw.head < 0.05 && this.mode === 'normal') {
      if (!this.fidget) { this.fidgetWait -= dt; if (this.fidgetWait < 0) { this.fidget = { i: Math.floor(Math.random() * FIDGETS.length), t: 0, dur: (2.2 + Math.random() * 1.2) / this.pers.tempo }; this.fidgetWait = (7 + Math.random() * 10) * (1.35 - this.pers.energy * 0.7); } }
      if (this.fidget) {
        const f = this.fidget;
        f.t += dt;
        const fk = f.t / f.dur;
        if (fk >= 1) this.fidget = null;
        else {
          const p = new Pose();
          this.pb.p = p; this.pb.reset();
          ANIMS.idle.pose({ ...ctx, moveW: 0 });
          FIDGETS[f.i](ctx, 1, fk);
          const fw = Math.sin(Math.min(1, fk) * Math.PI) * 0.95;
          this.applyProc(p, 'arms', fw);
          if (this.near) this.applyFingers(p.hs, fw, fw);
          this.fk();
        }
      }
    } else if (this.fidget) this.fidget = null;
    // ---- carry layer
    if (cw.r + cw.l + cw.two + cw.head > 0.01 && c.name !== 'tpose' && this.posture !== 'lie') {
      this.applyCarry();
      if (this.near) {
        const gl = Math.max(cw.two, cw.l, cw.head), gr = Math.max(cw.two, cw.r);
        const shL = cp.gripL ? (HAND_SHAPES as any)[cp.gripL] : null, shR = cp.gripR ? (HAND_SHAPES as any)[cp.gripR] : null;
        if (shL || shR) {
          const hs = this.gripHs;
          hs.set(shL ?? HAND_SHAPES.grip, 0); hs.set(shR ?? HAND_SHAPES.grip, HS_N);
          this.applyFingers(hs, gl, gr);
        } else this.applyFingers(GRIP2, gl, gr);
      }
    }
    // load hunch & wobble
    if (cw.load > 0.02 && this.posture === 'stand') {
      this.wobble += dt;
      this.addLocal('spine_02', cw.load * 12, 0, Math.sin(this.wobble * 3.1) * cw.load * 4);
      this.fk();
    }
    // ---- secondary motion: lean into turns & acceleration, head/arm follow-through, post-sprint panting
    if (this.near && dt > 0) { this.secondary(dt, cw.r + cw.l + cw.two + cw.head); this.fk(); }
    // ---- look-at (+ eyes lead the head) and ambient glances
    this.ambientLook(dt);
    this.applyLook(dt, c.def.look !== false && this.posture !== 'lie');
    this.fk();
    // ---- inertial blend of the final pose (no pops on anim / posture / mask changes)
    if (dt > 0) { this.inertia(dt); this.fk(); }
    // ---- planted feet & ground fitting
    if (dt > 0) this.footIK(dt, this.near > 0 && this.posture === 'stand' && this.mode !== 'sil' && (!!c.plan.loco || standLegs || IK_OK.has(c.name)) && c.name !== 'tpose');
    // ---- scripted hand reach (two-bone arm IK onto a world point, e.g. pinching a Jenga block)
    this.applyReach();
    // ---- first person: keep hands out of the camera
    if (this.mode === 'fp') { this.fpHands(); this.fk(); }
    this.updateAttach();
    // ---- face
    if (dt > 0) {
      if (c.def.exprAt && !(c.ended && !c.def.hold)) this.face.setAnimExpression(c.def.exprAt(k, c.t) ?? c.def.expr ?? 'neutral');
      // out of breath after running: mouth hangs open
      this.face.mouthMode = c.def.mouth ?? (this.exert > 0.35 && this.posture === 'stand' ? 'chew' : null);
      this.face.talking = this.explicitTalk;
      this.face.update(dt);
      (this.mat.userData.uFace.value as Float32Array).set(this.face.u);
      this.mat.userData.uFaceOn.value = this.face.detail > 0.01 && !this.photoVariant ? 1 : 0;
    }
  }


  // ---------------------------------------------------------------- follow-through on procedural poses
  /** Overlapping action: each upper-body bone of the procedural pose chases its target with its own time constant
   *  (proximal fast, distal slower), so wrists trail forearms, forearms trail upper arms and the head settles after
   *  the chest — procedural motion stops looking like rigid in-phase sine waves. Fingers ease too. */
  private lagPose = new Pose();
  private gripHs = new Float32Array(HS_N * 2);
  private lagOn = false;
  private followThrough(dt: number) {
    const out = this.out, lag = this.lagPose;
    if (!this.lagOn || dt > 0.25) { lag.copy(out); this.lagOn = true; return; }
    for (const [bi, rate] of LAG_RATES) {
      const k = 1 - Math.exp(-rate * dt);
      const o = bi * 4;
      _qa.set(lag.q[o], lag.q[o + 1], lag.q[o + 2], lag.q[o + 3]);
      _qb.set(out.q[o], out.q[o + 1], out.q[o + 2], out.q[o + 3]);
      _qa.slerp(_qb, k);
      lag.q[o] = out.q[o] = _qa.x; lag.q[o + 1] = out.q[o + 1] = _qa.y; lag.q[o + 2] = out.q[o + 2] = _qa.z; lag.q[o + 3] = out.q[o + 3] = _qa.w;
    }
    const kf = 1 - Math.exp(-16 * dt);
    for (let i = 0; i < HS_N * 2; i++) { lag.hs[i] += (out.hs[i] - lag.hs[i]) * kf; out.hs[i] = lag.hs[i]; }
    for (const bi of LAG_PASS) { const o = bi * 4; for (let j = 0; j < 4; j++) lag.q[o + j] = out.q[o + j]; }
  }

  // ---------------------------------------------------------------- hands

  /** finger curls from a hand-shape vector (Pose.hs layout) blended over the current fingers */
  private applyFingers(hs: Float32Array, wl: number, wr: number) {
    if (wl < 0.01 && wr < 0.01) return;
    const t = this.t;
    for (const fg of this.td.fingers) {
      const w = fg.side > 0 ? wl : wr;
      if (w < 0.01) continue;
      const o = fg.side > 0 ? 0 : HS_N;
      const curl = hs[o + fg.f], spread = hs[o + 5];
      const ang = FLEX_DEG[fg.f][fg.seg - 1] * curl * D2;
      _qa.setFromAxisAngle(fg.flex, ang);
      if (fg.seg === 1) { _qb.setFromAxisAngle(fg.spread, SPREAD_DEG[fg.f] * spread * D2 * (1 - curl * 0.6)); _qa.multiply(_qb); }
      _qa.multiply(t.restQuat[fg.i]);
      this.bones[fg.i].quaternion.slerp(_qa, Math.min(1, w));
    }
  }

  // ---------------------------------------------------------------- root motion, secondary motion

  private measureRoot(dt: number) {
    this.root.updateWorldMatrix(true, false);
    const e = this.root.matrixWorld.elements;
    _w1.set(e[12], e[13], e[14]);
    // forward = -Z of the root (inner is turned by π: template +Z faces world -Z)
    const yaw = Math.atan2(-e[8], -e[10]);
    if (!this.rHas || _w1.distanceToSquared(this.rPrev) > 2.25) {
      this.rHas = true; this.rPrev.copy(_w1); this.rYaw = yaw; this.rVel.set(0, 0, 0); this.accF = this.accL = this.yawRate = 0;
      for (const f of this.feet) { f.lock = false; f.has = false; f.rel = -1; }
      return;
    }
    _w2.copy(_w1).sub(this.rPrev).divideScalar(dt);
    _w2.y = 0;
    const kv = 1 - Math.exp(-dt * 10);
    _w3.copy(this.rVel);
    this.rVel.lerp(_w2, kv);
    _w3.subVectors(this.rVel, _w3).divideScalar(dt);                  // acceleration of the smoothed velocity
    this.rSpeed = this.rVel.length();
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);                   // forward
    const lx = -Math.cos(yaw), lz = Math.sin(yaw);                    // character's left
    const ka = 1 - Math.exp(-dt * 6);
    this.accF += (Math.max(-12, Math.min(12, _w3.x * fx + _w3.z * fz)) - this.accF) * ka;
    this.accL += (Math.max(-12, Math.min(12, _w3.x * lx + _w3.z * lz)) - this.accL) * ka;
    let dy = yaw - this.rYaw;
    if (dy > Math.PI) dy -= Math.PI * 2; else if (dy < -Math.PI) dy += Math.PI * 2;
    this.yawRate += (Math.max(-6, Math.min(6, dy / dt)) - this.yawRate) * (1 - Math.exp(-dt * 8));
    this.rYaw = yaw;
    this.rPrev.copy(_w1);
    // exertion: builds while sprinting, slowly recovers
    this.exert = Math.max(0, Math.min(1, this.exert + (this.runW > 0.5 ? dt * 0.09 : -dt * 0.05)));
  }

  private secondary(dt: number, carrying: number) {
    const sp = this.spr;
    const n = Math.min(8, Math.ceil(dt / 0.017)), h = dt / n;
    const spring = (i: number, target: number, k: number, c: number) => {
      for (let j = 0; j < n; j++) { sp[i + 1] += ((target - sp[i]) * k - sp[i + 1] * c) * h; sp[i] += sp[i + 1] * h; }
      return sp[i];
    };
    const mv = Math.min(1, this.speed / 1.2);
    const stand = this.posture === 'stand' ? 1 : 0;
    // active lean: forward when speeding up, back when braking; bank into turns
    const lean = spring(0, Math.max(-8, Math.min(10, this.accF * 1.5)) * stand, 70, 16);
    const bank = spring(2, Math.max(-13, Math.min(13, -this.yawRate * this.speed * 3.2)) * stand, 60, 14);
    // passive follow-through (underdamped): head and arms lag, then overshoot
    const head = spring(4, -this.accF * 0.9 * stand, 95, 8);
    const armP = spring(6, Math.max(-14, Math.min(14, this.accF * 2.4)), 55, 5);
    const armR = spring(8, Math.max(-12, Math.min(12, -this.accL * 2.2 - this.yawRate * mv * 2)), 55, 5);
    this.addLocal('spine_01', lean * 0.6, 0, bank * 0.55); this.fk();
    this.addLocal('spine_03', lean * 0.4, 0, bank * 0.35); this.fk();
    this.addLocal('neck_01', head, 0, -bank * 0.25); this.fk();
    const free = Math.max(0, 1 - carrying);
    if (free > 0.02 && this.cur.def.look !== false) {
      this.addLocal('upperarm_l', armP * free, 0, armR * free);
      this.addLocal('upperarm_r', armP * free, 0, armR * free);
      this.fk();
    }
    // breathing on top of clips (procedural poses already breathe); panting after a sprint
    const ex = this.exert;
    if (ex > 0.02 || this.wLoco * this.moveW > 0.3) {
      const rate = 1.6 + ex * 5.5, amp = 0.5 + ex * 2.6;
      const br = Math.sin(this.gt * rate) * amp;
      this.addLocal('spine_03', -br * 0.6 + ex * 4 * (1 - mv), 0, 0);
      this.addLocal('clavicle_l', 0, 0, br * 0.5);
      this.addLocal('clavicle_r', 0, 0, -br * 0.5);
    }
  }

  // ---------------------------------------------------------------- ambient life: glances

  private ambientLook(dt: number) {
    const a = this.amb;
    if (!this.ambient || !RigWorld.ambientCam || this.mode !== 'normal' || this.lookTarget || !this.near) { a.on = false; return; }
    const n = this.cur.name;
    const calm = n === 'idle' || n === 'sit' || n === 'talk' || n === 'stand_cool' || n === 'sit_floor' || n === 'count_coins' || n === 'cook_stir' || n === 'wipe';
    a.t -= dt;
    if (a.on) { a.dur -= dt; if (a.dur <= 0 || !calm) { a.on = false; a.t = 4 + Math.random() * 9; } else a.p.copy(RigWorld.cam); return; }
    if (a.t > 0 || !calm || this.speed > 1.6) return;
    a.t = 3 + Math.random() * 6;
    this.root.getWorldPosition(_w1);
    const d = _w1.distanceTo(RigWorld.cam);
    if (d < 1.2 || d > 6) return;
    // only when the camera is in front of us
    const e = this.root.matrixWorld.elements;
    _w2.set(-e[8], 0, -e[10]).normalize();
    _w3.copy(RigWorld.cam).sub(_w1).setY(0).normalize();
    if (_w2.dot(_w3) < 0.25 || Math.random() < 0.35) return;
    a.on = true; a.dur = 1.2 + Math.random() * 2.2; a.p.copy(RigWorld.cam);
    if (Math.random() < 0.5) this.face.setExpression(Math.random() < 0.7 ? 'happy' : 'smug', { weight: 0.45, hold: a.dur * 0.8, fade: 0.3 });
  }

  // ---------------------------------------------------------------- inertialization

  private inertia(dt: number) {
    const bl = this.td.inBones, n = bl.length;
    if (this.inPrev.length !== n * 4) { this.inPrev = new Float32Array(n * 4); this.inOff = new Float32Array(n * 4); this.inHas = false; }
    const P = this.inPrev, O = this.inOff;
    const pelvis = this.bones[this.t.index.pelvis];
    // automatic pop guard: a bone jumping > ~34° in one short tick gets smoothed too
    if (this.inHas && this.inPending === 0 && this.inT >= 1 && dt < 0.05) {
      let mx = 0;
      for (let j = 0; j < this.td.order.length; j++) {
        const q = this.bones[bl[j]].quaternion;
        const d = Math.abs(q.x * P[j * 4] + q.y * P[j * 4 + 1] + q.z * P[j * 4 + 2] + q.w * P[j * 4 + 3]);
        if (d < 0.956) { mx = 1; break; }
      }
      if (mx) this.inPending = 0.18;
    }
    if (this.inPending > 0 && this.inHas) {
      for (let j = 0; j < n; j++) {
        const q = this.bones[bl[j]].quaternion;
        _qa.set(P[j * 4], P[j * 4 + 1], P[j * 4 + 2], P[j * 4 + 3]).multiply(_qb.copy(q).invert());
        if (_qa.w < 0) _qa.set(-_qa.x, -_qa.y, -_qa.z, -_qa.w);
        O[j * 4] = _qa.x; O[j * 4 + 1] = _qa.y; O[j * 4 + 2] = _qa.z; O[j * 4 + 3] = _qa.w;
      }
      this.inOffP.copy(this.inPrevP).sub(pelvis.position);
      if (this.inOffP.lengthSq() > 0.25) this.inOffP.set(0, 0, 0);
      this.inT = 0; this.inDur = this.inPending;
    }
    this.inPending = 0;
    if (this.inT < 1) {
      this.inT = Math.min(1, this.inT + dt / this.inDur);
      const x = this.inT, k = 1 - x * x * x * (x * (x * 6 - 15) + 10);
      for (let j = 0; j < n; j++) {
        _qa.set(O[j * 4], O[j * 4 + 1], O[j * 4 + 2], O[j * 4 + 3]);
        _qb.identity().slerp(_qa, k);
        const q = this.bones[bl[j]].quaternion;
        q.premultiply(_qb);
      }
      pelvis.position.addScaledVector(this.inOffP, k);
    }
    for (let j = 0; j < n; j++) { const q = this.bones[bl[j]].quaternion; P[j * 4] = q.x; P[j * 4 + 1] = q.y; P[j * 4 + 2] = q.z; P[j * 4 + 3] = q.w; }
    this.inPrevP.copy(pelvis.position);
    this.inHas = true;
  }

  // ---------------------------------------------------------------- feet: locking + ground fitting (two-bone IK)

  private footIK(dt: number, allowed: boolean) {
    this.ikW += ((allowed ? 1 : 0) - this.ikW) * (1 - Math.exp(-dt * 6));
    if (this.ikW < 0.01) { for (const f of this.feet) { f.lock = false; f.has = false; f.rel = -1; } this.pelvisDrop = 0; return; }
    const t = this.t;
    this.inner.updateWorldMatrix(true, false);
    const M = this.inner.matrixWorld;
    _m4.copy(M).invert();
    const me = this.root.matrixWorld.elements;
    const rootY = me[13];
    const sc = (this.height / t.height);
    const mv = this.moveW;
    // the character is really moving the way its legs say? (scripted root motion / walking in place → no locking)
    const coherent = Math.abs(this.rSpeed - this.speed) < 0.9;
    const legs: [string, string, string][] = [['thigh_l', 'calf_l', 'foot_l'], ['thigh_r', 'calf_r', 'foot_r']];
    const targets = IK_T;
    let drop = 0;
    for (let s = 0; s < 2; s++) {
      const f = this.feet[s];
      const [ta, tb, tc] = legs[s];
      const ia = t.index[ta], ic = t.index[tc];
      if (ia === undefined || ic === undefined) return;
      const fk = _w1.copy(this.Fp[ic]).applyMatrix4(M);
      const restAnkle = t.Gp[ic].y * sc;
      let gy = RigWorld.groundAt ? RigWorld.groundAt(fk.x, fk.z, rootY) : rootY;
      if (!Number.isFinite(gy) || Math.abs(gy - rootY) > 0.32) gy = rootY;
      const h = fk.y - rootY - restAnkle;
      const hv = f.has ? Math.hypot(fk.x - f.prev.x, fk.z - f.prev.z) / dt : 0;
      f.prev.copy(fk); f.has = true;
      const planted = coherent && h < 0.045 && hv < 0.45 + 0.12 * this.speed;
      if (!f.lock && planted && f.rel < 0) { f.lock = true; f.lp.set(fk.x, fk.y + (gy - rootY), fk.z); }
      if (f.lock) {
        const drift = Math.hypot(fk.x - f.lp.x, fk.z - f.lp.z);
        if (h > 0.075 || drift > 0.13 + 0.2 * mv || !coherent) { f.lock = false; f.rel = 0; f.from.copy(f.lp); }
      }
      const tg = targets[s];
      if (f.lock) tg.copy(f.lp);
      else {
        tg.set(fk.x, fk.y + (gy - rootY), fk.z);
        if (f.rel >= 0) {
          // release: glide (or, standing, a little stepping arc) from the old plant to where the clip wants the foot
          f.rel += dt / 0.2;
          const k = sm(0, 1, f.rel);
          tg.lerpVectors(f.from, tg, k);
          tg.y += Math.sin(Math.PI * Math.min(1, f.rel)) * 0.055 * (1 - mv);
          if (f.rel >= 1) f.rel = -1;
        }
      }
      tg.lerpVectors(fk, tg, this.ikW);
      // lower ground under this foot → the pelvis has to come down (only for the ground, not for planted-foot drift)
      drop = Math.max(drop, (rootY - gy) / sc * this.ikW);
      tg.applyMatrix4(_m4);           // → template model space
    }
    // lower the pelvis for uneven ground (smoothed), then solve both legs
    this.pelvisDrop += (Math.max(0, Math.min(0.22 / sc, drop)) - this.pelvisDrop) * (1 - Math.exp(-dt * 10));
    if (this.pelvisDrop > 1e-4) {
      const pi = t.index.pelvis, pr = t.parent[pi];
      _w2.set(0, -this.pelvisDrop, 0);
      if (pr >= 0) _w2.applyQuaternion(_q.copy(this.Fq[pr]).invert());
      this.bones[pi].position.add(_w2);
      this.fk();
    }
    for (let s = 0; s < 2; s++) { const [ta, tb, tc] = legs[s]; this.solve2(t.index[ta], t.index[tb], t.index[tc], targets[s]); }
    this.fk();
  }

  /** analytic two-bone IK in template model space; keeps the foot's orientation */
  private solve2(ia: number, ib: number, ic: number, target: THREE.Vector3) {
    const T = _ikT.copy(target);
    const a = this.Fp[ia], b = this.Fp[ib], c = this.Fp[ic];
    const lab = b.distanceTo(a), lcb = c.distanceTo(b);
    if (lab < 1e-4 || lcb < 1e-4) return;
    const at = _w1.copy(T).sub(a);
    const lat = Math.max(Math.abs(lab - lcb) * 1.02 + 1e-4, Math.min((lab + lcb) * 0.999, at.length()));
    const ac = _w2.copy(c).sub(a), lac = ac.length();
    if (lac < 1e-4) return;
    const footG = _q4.copy(this.Fq[ic]);
    // 1) bend: knee angle so that |ac| = lat (rotate about the leg's bend axis)
    const ab = _w3.copy(b).sub(a);
    const perp = ab.clone().addScaledVector(ac, -ab.dot(ac) / (lac * lac));
    if (perp.lengthSq() < 1e-8) perp.set(0, 0, 1).applyQuaternion(_q.copy(this.Fq[this.t.index.pelvis]).multiply(_q2.copy(this.t.Gq[this.t.index.pelvis]).invert()));
    const axis = new THREE.Vector3().crossVectors(ac, perp).normalize();
    const cl = (x: number) => Math.max(-1, Math.min(1, x));
    const ba_bc_0 = Math.acos(cl(_w5.copy(a).sub(b).normalize().dot(new THREE.Vector3().copy(c).sub(b).normalize())));
    const ba_bc_1 = Math.acos(cl((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb)));
    const ac_ab_0 = Math.acos(cl(ac.clone().normalize().dot(ab.clone().normalize())));
    const ac_ab_1 = Math.acos(cl((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat)));
    const pa = this.t.parent[ia];
    _qa.setFromAxisAngle(_w5.copy(axis).applyQuaternion(_q.copy(this.Fq[ia]).invert()), ac_ab_1 - ac_ab_0);
    this.bones[ia].quaternion.multiply(_qa);
    _qb.setFromAxisAngle(_w5.copy(axis).applyQuaternion(_q.copy(this.Fq[ib]).invert()), ba_bc_1 - ba_bc_0);
    this.bones[ib].quaternion.multiply(_qb);
    this.fkChain(ia, ib, ic);
    // 2) swing the whole leg so the ankle lands on the target
    _w2.copy(this.Fp[ic]).sub(a).normalize();
    _w1.copy(T).sub(a).normalize();
    _qa.setFromUnitVectors(_w2, _w1);
    const Gp = pa >= 0 ? this.Fq[pa] : _q2.identity();
    // new local = Gp⁻¹ · R · (Gp · local)
    _qb.copy(Gp).multiply(this.bones[ia].quaternion);
    _qb.premultiply(_qa);
    this.bones[ia].quaternion.copy(_q.copy(Gp).invert().multiply(_qb));
    this.fkChain(ia, ib, ic);
    // keep the foot's model-space orientation
    this.bones[ic].quaternion.copy(_q.copy(this.Fq[ib]).invert().multiply(footG));
    this.fkChain(ia, ib, ic);
  }
  private fkChain(...ids: number[]) {
    for (const i of ids) {
      const p = this.t.parent[i], b = this.bones[i];
      if (p < 0) { this.Fq[i].copy(b.quaternion); this.Fp[i].copy(b.position); }
      else { this.Fq[i].copy(this.Fq[p]).multiply(b.quaternion); this.Fp[i].copy(b.position).applyQuaternion(this.Fq[p]).add(this.Fp[p]); }
    }
  }

  // ---------------------------------------------------------------- first person: hands never fill the lens

  private fpHands() {
    const t = this.t, e = t.info.eyes;
    const eye = _w4.set((e[0][0] + e[1][0]) / 2, (e[0][1] + e[1][1]) / 2, (e[0][2] + e[1][2]) / 2);
    const hb = t.index.Head;
    eye.sub(t.Gp[hb]).applyQuaternion(_q4.copy(this.Fq[hb]).multiply(_q3.copy(t.Gq[hb]).invert())).add(this.Fp[hb]);
    for (const sfx of ['l', 'r']) {
      const ua = t.index['upperarm_' + sfx], ha = t.index['hand_' + sfx];
      if (ua === undefined || ha === undefined) continue;
      const rmin = 0.34;
      for (let it = 0; it < 2; it++) {
        const hand = this.Fp[ha];
        const d = hand.distanceTo(eye);
        if (d >= rmin) break;
        // swing the upper arm down/away from the eyes
        const sh = this.Fp[ua];
        _w1.copy(hand).sub(sh);
        _w2.copy(eye).sub(sh);
        const ax = _w3.crossVectors(_w2, _w1);
        if (ax.lengthSq() < 1e-8) ax.set(1, 0, 0);
        ax.normalize();
        const ang = Math.min(0.9, (rmin - d) / Math.max(0.2, _w1.length()) * 1.3);
        _qa.setFromAxisAngle(ax, ang);
        const p = t.parent[ua];
        _qb.copy(this.Fq[p]).multiply(this.bones[ua].quaternion).premultiply(_qa);
        this.bones[ua].quaternion.copy(_q.copy(this.Fq[p]).invert().multiply(_qb));
        this.fk();
      }
    }
  }

  // ---------------------------------------------------------------- retargeting

  /** FK over the template bones in model space (from current local transforms) */
  private fk() {
    const t = this.t;
    for (let i = 0; i < this.bones.length; i++) {
      const b = this.bones[i], p = t.parent[i];
      if (p < 0) { this.Fq[i].copy(b.quaternion); this.Fp[i].copy(b.position); }
      else { this.Fq[i].copy(this.Fq[p]).multiply(b.quaternion); this.Fp[i].copy(b.position).applyQuaternion(this.Fq[p]).add(this.Fp[p]); }
    }
  }

  /** my-skeleton world rotations (model space) for a pose */
  private myFK(pose: Pose) {
    const q = pose.q;
    for (let i = 0; i < NB; i++) {
      _q.set(q[i * 4], q[i * 4 + 1], q[i * 4 + 2], q[i * 4 + 3]);
      const p = PARENT[i];
      if (p < 0) this.myWq[i].copy(_q); else this.myWq[i].copy(this.myWq[p]).multiply(_q);
    }
  }

  /** world rotation of template bone i from its current parent world rotation and local */
  private worldOf(i: number, out: THREE.Quaternion) {
    const p = this.t.parent[i];
    return p < 0 ? out.copy(this.bones[i].quaternion) : out.copy(this.Fq[p]).multiply(this.bones[i].quaternion);
  }

  private applyProc(pose: Pose, mask: Mask, weight: number) {
    const t = this.t, td = this.td;
    this.myFK(pose);
    const set = mask === 'full' ? null : mask === 'upper' ? UPPER_SET : mask === 'legs' ? LEGS_SET : ARMS_SET;
    const q = pose.q;
    const spine03 = t.index.spine_03, pelvis = t.index.pelvis;
    for (const i of td.order) {
      const name = t.names[i];
      const p = t.parent[i];
      // keep FK for parents current
      if (p >= 0) { this.Fq[i].copy(this.Fq[p]).multiply(this.bones[i].quaternion); }
      if (set && !set.has(name)) continue;
      const my = MY_OF[name];
      const bone = this.bones[i];
      const dl = td.dirLocal.get(i);
      if (dl) {
        // direction matching: my limb direction (relative to my chest/hips) → relative to the current chest/pelvis
        const myRest = name.startsWith('hand') ? restDir(this.mySk, my === B.hand_l ? B.forearm_l : B.forearm_r) : restDir(this.mySk, my);
        _v.set(myRest[0], myRest[1], myRest[2]).applyQuaternion(this.myWq[my]);
        const leg = name.startsWith('thigh') || name.startsWith('calf');
        const refMy = leg ? B.hips : B.chest, refT = leg ? pelvis : spine03;
        _q2.copy(this.myWq[refMy]).invert();
        _v.applyQuaternion(_q2);
        _q3.copy(this.Fq[refT]).multiply(_q4.copy(t.Gq[refT]).invert());
        _v.applyQuaternion(_q3).normalize();
        // candidate: rest local under the current parent
        _q2.copy(this.Fq[p]).multiply(t.restQuat[i]);
        _v2.copy(dl).applyQuaternion(_q2).normalize();
        _q3.setFromUnitVectors(_v2, _v);
        _q2.premultiply(_q3);
        _q4.copy(this.Fq[p]).invert().multiply(_q2);
      } else {
        // local delta in model axes, conjugated by the parent's rest world rotation
        _q.set(q[my * 4], q[my * 4 + 1], q[my * 4 + 2], q[my * 4 + 3]);
        if (name === 'spine_02' || name === 'spine_03') _q.slerp(_q2.identity(), 0.5);
        const Qp = p >= 0 ? t.Gq[p] : new THREE.Quaternion();
        _q4.copy(td.QpInv[i]).multiply(_q).multiply(Qp).multiply(t.restQuat[i]);
      }
      bone.quaternion.slerp(_q4, weight);
      if (p >= 0) this.Fq[i].copy(this.Fq[p]).multiply(bone.quaternion); else this.Fq[i].copy(bone.quaternion);
      if (name === 'pelvis' && (!set || mask === 'legs')) {
        const k = t.Gp[pelvis].y / 0.95;
        _v3.set(pose.hp[0] * k, pose.hp[1] * k, pose.hp[2] * k);
        const pr = t.parent[pelvis];
        if (pr >= 0) _v3.applyQuaternion(_q.copy(t.Gq[pr]).invert());
        _v2.copy(t.restPos[pelvis]).add(_v3);
        bone.position.lerp(_v2, weight);
      }
    }
  }

  private aimPose = new Pose();
  private applyCarry() {
    const w = this.carryW;
    const p = this.aimPose;
    const pb = this.pb;
    pb.p = p; pb.reset();
    if (w.two > 0.01) { pb.arm(1, 52, -14, 60, 72, 10); pb.arm(-1, 52, -14, 60, 72, 10); }
    else {
      pb.arm(-1, 26 + Math.sin(this.phase * Math.PI * 2) * 4 * this.moveW, 6, 60, 78, -8);
      pb.arm(1, 26 + Math.sin(this.phase * Math.PI * 2 + Math.PI) * 4 * this.moveW, 6, 60, 78, -8);
    }
    if (w.head > 0.01) pb.arm(1, 158, 28, 40, 58, -20);
    // chest identity: directions are relative to the current chest
    const wl = w.two > 0.01 ? w.two : Math.max(w.l * (w.head > 0.5 ? 0 : 1), w.head);
    const wr = w.two > 0.01 ? w.two : w.r;
    this.myFK(p);
    for (const [names, wt] of [[['upperarm_l', 'lowerarm_l'], wl], [['upperarm_r', 'lowerarm_r'], wr]] as [string[], number][]) {
      if (wt < 0.01) continue;
      for (const n of names) this.aimBone(n, wt);
    }
  }

  private aimBone(name: string, weight: number) {
    const t = this.t, i = t.index[name], p = t.parent[i];
    const dl = this.td.dirLocal.get(i);
    if (!dl) return;
    const my = MY_OF[name];
    const r = restDir(this.mySk, my);
    _v.set(r[0], r[1], r[2]).applyQuaternion(this.myWq[my]);
    const sp = t.index.spine_03;
    _q3.copy(this.Fq[sp]).multiply(_q4.copy(t.Gq[sp]).invert());
    _v.applyQuaternion(_q3).normalize();
    this.Fq[i].copy(this.Fq[p]).multiply(this.bones[i].quaternion);
    _q2.copy(this.Fq[p]).multiply(t.restQuat[i]);
    _v2.copy(dl).applyQuaternion(_q2).normalize();
    _q3.setFromUnitVectors(_v2, _v);
    _q2.premultiply(_q3);
    _q4.copy(this.Fq[p]).invert().multiply(_q2);
    this.bones[i].quaternion.slerp(_q4, weight);
    this.fk();
  }

  /** additive rotation in model axes (degrees) on a template bone */
  private addLocal(name: string, pitch: number, yaw: number, roll: number) {
    const t = this.t, i = t.index[name];
    if (i === undefined) return;
    const p = t.parent[i];
    _q.setFromEuler(new THREE.Euler(pitch * D2R, yaw * D2R, roll * D2R, 'YXZ'));
    const Qp = p >= 0 ? t.Gq[p] : _q2.identity();
    _q3.copy(this.td.QpInv[i]).multiply(_q).multiply(Qp);
    this.bones[i].quaternion.premultiply(_q3);
  }

  private applyLook(dt: number, allowed: boolean) {
    const target = this.lookTarget ?? (this.amb.on ? this.amb.p : null);
    const want = allowed && target ? (this.lookTarget ? 1 : 0.75) : 0;
    this.lookW += (want - this.lookW) * (1 - Math.exp(-5 * dt));
    if (this.lookW < 0.01) { this.lookYaw *= 0.9; this.lookPitch *= 0.9; this.face.setGaze(null); return; }
    const t = this.t;
    if (target) {
      this.root.updateWorldMatrix(true, false);
      const s = this.height / t.height;
      const hp = this.Fp[t.index.Head];
      _v.set(-hp.x * s, (hp.y + 0.08) * s, -hp.z * s).applyMatrix4(this.root.matrixWorld);
      _v2.copy(target).sub(_v);
      if (_v2.lengthSq() > 1e-6) {
        const sp = t.index.spine_03;
        this.root.getWorldQuaternion(_q);
        _q.multiply(QY_PI).multiply(_q2.copy(this.Fq[sp]).multiply(_q3.copy(t.Gq[sp]).invert()));
        _v2.applyQuaternion(_q.invert()).normalize();
        let yaw = Math.atan2(_v2.x, _v2.z) / D2R;
        let pitch = -Math.asin(Math.max(-1, Math.min(1, _v2.y))) / D2R;
        if (Math.abs(yaw) > 115) yaw = 0;
        const yawRaw = yaw, pitchRaw = pitch;
        yaw = Math.max(-75, Math.min(75, yaw)); pitch = Math.max(-40, Math.min(50, pitch));
        const kk = 1 - Math.exp(-7 * dt);
        this.lookYaw += (yaw - this.lookYaw) * kk; this.lookPitch += (pitch - this.lookPitch) * kk;
        // eyes get there first; the head catches up (the eyes cover what the head hasn't turned yet)
        const w = this.lookW;
        this.face.setGaze((yawRaw - this.lookYaw * w) / 28 * w, -(pitchRaw - this.lookPitch * w) / 22 * w);
      }
    } else this.face.setGaze(null);
    const w = this.lookW;
    this.addLocal('neck_01', this.lookPitch * 0.35 * w, this.lookYaw * 0.4 * w, 0);
    this.fk();
    this.addLocal('Head', this.lookPitch * 0.6 * w, this.lookYaw * 0.6 * w, 0);
  }

  private updateAttach() {
    const t = this.t, s = this.height / t.height;
    for (const pt of ATTACH) {
      const rec = this.td.offLocal.get(pt);
      if (!rec) continue;
      const o = this.attachPts.get(pt)!;
      const b = rec.b;
      _v.copy(rec.off).applyQuaternion(this.Fq[b]).add(this.Fp[b]);
      if (pt === 'head') _v.y += this.hairTop;
      o.position.set(-_v.x * s, _v.y * s, -_v.z * s);
      _q2.copy(this.Fq[b]).multiply(_q3.copy(t.Gq[b]).invert());
      _q2.premultiply(QY_PI);
      o.quaternion.copy(QY_PI).slerp(_q2, FOLLOW[pt]);
    }
    // proxy & head height
    let minX = 1e9, minY = 1e9, minZ = 1e9, maxX = -1e9, maxY = -1e9, maxZ = -1e9;
    for (const n of ['Head', 'pelvis', 'foot_l', 'foot_r', 'hand_l', 'hand_r', 'spine_03', 'calf_l', 'calf_r']) {
      const p = this.Fp[t.index[n]];
      const x = -p.x * s, y = p.y * s, z = -p.z * s;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    const ho = this.td.offLocal.get('head')!;
    _v.copy(ho.off).applyQuaternion(this.Fq[ho.b]).add(this.Fp[ho.b]);
    this.headHeight = (_v.y + this.hairTop) * s;
    maxY = Math.max(maxY, this.headHeight);
    const m = 0.14;
    const y0 = Math.max(0, minY - 0.1);
    this.proxy.position.set((minX + maxX) / 2, (y0 + maxY) / 2, (minZ + maxZ) / 2);
    this.proxy.scale.set(maxX - minX + m * 2, maxY - y0 + 0.04, maxZ - minZ + m * 2);
  }

  /** Photo face variants are only used for explicit setFace() calls on faces that have that photo; everything
   *  else (anim faces, expressions) is the animated face shader on the neutral photo — no atlas repaints. */
  private photoVariant = false;
  private updateFace() {
    const f: FaceVariant = this.faceOverride ?? 'neutral';
    if (f === this.faceCur) return;
    this.faceCur = f;
    const fe = faceEntry(this.look.face, this.look.sex === 'f' ? 'f' : 'm');
    const v: FaceVariant = f !== 'neutral' && (!fe.photo || !fe.photo.variants[f]) ? 'neutral' : f;
    this.photoVariant = v !== 'neutral';
    this.setAtlas(v);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    RigWorld.rigs.delete(this);
    this.mixer?.stopAllAction();
    this.root.removeFromParent();
    if (this.geoKey) releaseLookGeometry(this.geoKey);
    if (this.geoKeyLo) releaseLookGeometry(this.geoKeyLo);
    if (this.atlasKey) releaseAtlas(this.atlasKey);
    this.mat.dispose();
    this.faceMat?.dispose();
    this.skeleton?.dispose();
  }
}

/** Factory helper: sculpted rig when the GLB templates are loaded, procedural fallback otherwise. */
export function createRig(look: Look, opts: RigOpts = {}): Rig | ProcRig {
  return Rig.available(look) ? new Rig(look, opts) : new ProcRig(look, opts);
}
export type AnyRig = Rig | ProcRig;
