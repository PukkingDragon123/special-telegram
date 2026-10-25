import * as THREE from 'three';
import { clone as skClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Assets } from '../../core/assets';
import { QB, QNB, QuadAnimator, QuadInput, QuadPose, QuadRigLike, Species } from './quad';
import { lifeTex } from './tex';

/* ============================================================================================
 * SCULPTED CREATURES — real rigged models (public/assets/gen/life/models/*.glb, converted with
 * headless Blender by scripts/life/bl_creature.py; sources & licences in references/credits/life.md)
 * driven by:
 *   1. authored clips through an AnimationMixer (idle / sit / shake / rollover / playdead …),
 *   2. the procedural quadruped layer (QuadAnimator: walk/trot/gallop gait, lie/sleep/beg poses,
 *      tail wag, look-at, bark/eat jaw) applied as creature-space rotations on mapped bones,
 *   3. a facial layer on the face rig (blink, happy squint, ear twitch/flatten, panting jaw +
 *      tongue, sniffing nose),
 * with SHELL-TEXTURED FUR (offset skinned shells, strand-noise alpha, root occlusion, gravity &
 * motion lag, real fur-photo detail; fewer shells with distance).
 * ========================================================================================== */

interface FurCfg {
  len: number;          // metres at length multiplier 1 (per-vertex multipliers from the bone rules)
  shells: number;       // at quality 1
  gravity: number;      // tip droop (fraction of the strand length)
  lie: number;          // 0 = strands stand up, 1 = lie flat along the comb
  density: number;      // strand cells per UV unit
  clump: number; clumpK: number;   // clump cells per UV unit, convergence toward the clump centre at the tip
  ao: number;           // root occlusion (colour multiplier at the skin)
  tip: [number, number, number];   // tip tint (sun-bleached)
  kk: [number, number, number, number]; // Kajiya-Kay: primary exponent, secondary exponent, primary strength, secondary strength
  wrap: number; sheen: number; wet: number;
  fins: number;         // fin strands per metre of edge (0 = no fins)
  albedo: string; fur: string; rules: string;  // baked textures (gen/life/tex) + comb rules (gen/life/data)
  breath: number;       // rib-cage breathing amplitude (metres along the normal)
  tint?: [number, number, number];
}
interface CreatureSpec {
  url: string;
  species: Species;
  /** semantic bone → regex on the sanitized node name */
  map: Record<string, RegExp>;
  tail: RegExp;      // capture (\d+) for the order
  tongue: RegExp;
  clips: { idle: string; sit?: string; shake?: string; roll?: string; dead?: string };
  /** the rig's rest pose & idle clip are SITTING (the cat): procedural stand-up deltas [bone, x, y, z] + COG lift (m) */
  stand?: { rot: [string, number, number, number][]; y: number };
  fur: FurCfg;
  face: { lidU: number; lidL: number; squint: number; lidMove?: number; lidOpen?: number };
  /** bone groups for translation-driven facial poses (browIn, browOut, corner, lipUp, squint) */
  groups?: Record<string, RegExp>;
  headH: number;
}

export const SPECS: Record<Species, CreatureSpec> = {
  dog: {
    url: 'gen/life/models/dog.glb',
    species: 'dog',
    map: {
      cog: /^COG/, hips: /^pelvis/, spine: /^spine_1/, spine2: /^spine_2/, chest: /^chest/, neck: /^neck_base/, neck2: /^neck_mid/, head: /^head_jnt/, jaw: /^jaw/,
      ear_l: /^L_ear_base/, ear_r: /^R_ear_base/, eartip_l: /^L_ear_tip/, eartip_r: /^R_ear_tip/,
      lidu_l: /^L_upper_lid_jnt/, lidl_l: /^L_lower_lid_jnt/, lidu_r: /^R_upper_lid_jnt/, lidl_r: /^R_lower_lid_jnt/,
      squint_l: /^L_squint/, squint_r: /^R_squint/, nose: /^nose/, nostril_l: /^L_nostril/, nostril_r: /^R_nostril/,
      mouth_l: /^L_mouth_corner/, mouth_r: /^R_mouth_corner/, eye_l: /^L_eye_jnt/, eye_r: /^R_eye_jnt/,
      sh_l: /^L_shoulder/, el_l: /^L_elbow/, wr_l: /^L_wrist/, sh_r: /^R_shoulder/, el_r: /^R_elbow/, wr_r: /^R_wrist/,
      hip_l: /^L_hip/, kn_l: /^L_knee/, ho_l: /^L_ankle/, hip_r: /^R_hip/, kn_r: /^R_knee/, ho_r: /^R_ankle/,
    },
    tail: /^tail_(\d)_jnt/,
    tongue: /^tongue_(\d)_jnt/,
    clips: { idle: 'idle', sit: 'sit', shake: 'shake', roll: 'rollover', dead: 'playdead' },
    fur: {
      len: 0.026, shells: 28, gravity: 0.35, lie: 0.6, density: 900, clump: 80, clumpK: 0.65, ao: 0.32, tip: [1.1, 1.06, 1.0],
      kk: [90, 28, 0.16, 0.22], wrap: 0.45, sheen: 0.6, wet: 0.18, fins: 520,
      albedo: 'dog_albedo.jpg', fur: 'dog_fur.jpg', rules: 'gen/life/data/fur_dog.json', breath: 0.007,
    },
    face: { lidU: 0.5, lidL: -0.25, squint: 0.35, lidMove: 0.017, lidOpen: 0.0025 },
    groups: { browIn: /^[LR]_brow_[12]_/, browOut: /^[LR]_brow_[345]_/, corner: /^[LR]_mouth_corner/, lipUp: /^[LR]_upperlip_[123]_/, squint: /^[LR]_squint/ },
    headH: 0.82,
  },
  cat: {
    url: 'gen/life/models/cat.glb',
    species: 'cat',
    map: {
      cog: /^j_body/, hips: /^j_hips/, spine: /^j_spine_2/, spine2: /^j_spine_3/, chest: /^j_spine_4/, neck: /^j_neck_base/, neck2: /^j_neck_1/, head: /^j_head/, jaw: /^j_jaw/,
      ear_l: /^j_l_ear/, ear_r: /^j_r_ear/, eye_l: /^j_l_eye_/, eye_r: /^j_r_eye_/,
      lidu_l: /^j_l_upper_eyelid/, lidl_l: /^j_l_lower_eyelid/, lidu_r: /^j_r_upper_eyelid/, lidl_r: /^j_r_lower_eyelid/,
      sh_l: /^j_l_humerous/, el_l: /^j_l_elbow/, wr_l: /^j_l_wrist/, sh_r: /^j_r_humerous/, el_r: /^j_r_elbow/, wr_r: /^j_r_wrist/,
      hip_l: /^j_l_femur/, kn_l: /^j_l_knee/, ho_l: /^j_l_ankle/, hip_r: /^j_r_femur/, kn_r: /^j_r_knee/, ho_r: /^j_r_ankle/,
      paw_l: /^j_l_ball/, paw_r: /^j_r_ball/,
    },
    tail: /^j_tail_(\d)/,
    tongue: /^j_tongue_(back|mid|tip)/,
    clips: { idle: 'idle', sit: 'idle' },
    stand: {
      rot: [['cog', 0.87, 0, 0], ['sh_l', -0.87, 0, 0], ['sh_r', -0.87, 0, 0], ['hip_l', 0.33, 0, 0], ['hip_r', 0.33, 0, 0],
        ['kn_l', -2.04, 0, 0], ['kn_r', -2.04, 0, 0], ['ho_l', 2.29, 0, 0], ['ho_r', 2.29, 0, 0], ['paw_l', -1.45, 0, 0], ['paw_r', -1.45, 0, 0], ['neck', -0.6, 0, 0]],
      y: 0.1,
    },
    fur: {
      len: 0.014, shells: 22, gravity: 0.25, lie: 0.7, density: 1100, clump: 190, clumpK: 0.45, ao: 0.5, tip: [1.25, 1.22, 1.2],
      kk: [110, 34, 0.22, 0.12], wrap: 0.4, sheen: 0.7, wet: 0.15, fins: 650,
      albedo: 'cat_albedo.jpg', fur: 'cat_fur.jpg', rules: 'gen/life/data/fur_cat.json', breath: 0.004,
    },
    face: { lidU: 0.55, lidL: -0.3, squint: 0.0 },
    groups: { browIn: /^j_[lr]_inner_eyebrow/, browOut: /^j_[lr]_outer_eyebrow/ },
    headH: 0.4,
  },
};

const QNAMES = ['hips', 'spine', 'chest', 'neck', 'head', 'jaw', 'ear_l', 'ear_r', 'tail1', 'tail2', 'tail3', 'sh_l', 'el_l', 'wr_l', 'sh_r', 'el_r', 'wr_r', 'hip_l', 'kn_l', 'ho_l', 'hip_r', 'kn_r', 'ho_r'];

// ============================================================================================
// FUR — shells + silhouette fins on the creature's skinned body mesh.
//   * per-vertex comb direction (strand flow) from the bone chains (same rules as scripts/life/bake_fur.py,
//     read from gen/life/data/fur_<species>.json) + per-vertex length multiplier (short face/paws, ruff, tail)
//   * shells: strands lie along the comb, clump into tufts toward the tips, per-strand length from the
//     REAL fur-photo strand map (baked along the flow), root occlusion, sun-bleached tips
//   * fins: one strand card per mesh edge, only drawn at the silhouette → fluffy outline
//   * Kajiya-Kay dual anisotropic highlight along the strand + wrap diffuse + rim sheen
//   * wind, gravity and a spring motion lag (fur overshoots when the animal stops), LOD by distance
// ============================================================================================

export interface FurRules { hipBone: string; headBone: string; rules: [string, string, number][]; noFurBones?: string[]; breathBones?: string }

const SH_PARS_V = /* glsl */`
attribute vec3 aComb; attribute float aFurLen; attribute float aBreath;
uniform float uBreath; uniform float uH; uniform float uLen; uniform vec3 uBend; uniform vec3 uWind; uniform float uTime; uniform float uLie;
varying vec3 vStrandT; varying float vH;
#ifdef FUR_FIN
attribute vec3 aFin; attribute vec3 aEdge;
varying vec3 vFin; varying float vFinVis;
#endif
`;
const SH_SKIN_V = /* glsl */`
vec3 furComb = aComb;
#ifdef FUR_FIN
vec3 furEdge = aEdge;
#endif
#ifdef USE_SKINNING
furComb = (skinMatrix * vec4(aComb, 0.0)).xyz;
#ifdef FUR_FIN
furEdge = (skinMatrix * vec4(aEdge, 0.0)).xyz;
#endif
#endif
`;
const SH_BREATH_V = 'transformed += normalize(objectNormal) * (aBreath * uBreath);\n';
const SH_DISP_V = /* glsl */`
{
  vec3 fn = normalize(objectNormal);
  vec3 fc = furComb - fn * dot(furComb, fn);
  fc = dot(fc, fc) > 1e-8 ? normalize(fc) : vec3(0.0, -1.0, 0.0);
  #ifdef FUR_FIN
    float h = aFin.y;
    vec3 mvB = (modelViewMatrix * vec4(transformed, 1.0)).xyz;
    vec3 Vv = normalize(-mvB);
    vec3 vn = normalize((modelViewMatrix * vec4(fn, 0.0)).xyz);
    vec3 ve = normalize((modelViewMatrix * vec4(furEdge, 0.0)).xyz);
    float sil = 1.0 - abs(dot(vn, Vv));
    float face = abs(dot(normalize(cross(ve, vn)), Vv));
    vFinVis = smoothstep(0.4, 0.78, sil) * smoothstep(0.1, 0.45, face);
    vFin = aFin;
    float L = uLen * aFurLen * 1.15;
    float lie = uLie * 0.4;
  #else
    float h = uH;
    float L = uLen * aFurLen;
    float lie = uLie;
  #endif
  float ph = uTime * 2.6 + uv.x * 41.0 + uv.y * 29.0;
  vec3 bend = uBend + uWind * (0.6 + 0.4 * sin(ph) + 0.25 * sin(ph * 2.3 + 1.7));
  vec3 dir = fn * (1.0 - lie) + fc * lie;
  vec3 curl = fc * 0.3 + bend;
  transformed += dir * (h * L) + curl * (h * h * L);
  vStrandT = normalize((modelViewMatrix * vec4(dir + curl * (2.0 * h), 0.0)).xyz);
  vH = h;
}
`;
const SH_PARS_F = /* glsl */`
uniform sampler2D uFur; uniform float uH; uniform float uDensity; uniform float uClump; uniform float uClumpK;
uniform vec3 uTip; uniform float uAO; uniform float uBaseAO; uniform vec4 uKK; uniform float uWrap; uniform float uSheen; uniform float uWet;
uniform float uFinDensity;
varying vec3 vStrandT; varying float vH;
#ifdef FUR_FIN
varying vec3 vFin; varying float vFinVis;
#endif
float furMaskG = 1.0; float furWetG = 0.0;
float fHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec2 fHash2(vec2 p) { return vec2(fHash(p), fHash(p + 17.31)); }
`;
const SH_MAP_F = /* glsl */`
#include <map_fragment>
{
  vec4 furD = texture2D(uFur, vMapUv);
  furMaskG = smoothstep(0.35, 0.65, furD.g);
  furWetG = furD.b;
  float hh = vH;
  #if defined(FUR_SHELL)
    // clumps: strands converge toward a jittered clump centre with height (inverse mapping of the root)
    vec2 uv0 = vMapUv;
    vec2 cid = floor(uv0 * uClump);
    vec2 c2 = fHash2(cid);
    vec2 cc = (cid + 0.5 + (c2 - 0.5) * 0.8) / uClump;
    vec2 ruv = cc + (uv0 - cc) / max(0.25, 1.0 - uClumpK * hh);
    float streak = texture2D(uFur, ruv).r;                 // real-photo strands, baked along the flow
    float grain = fHash(floor(ruv * uDensity));
    float sig = streak * 0.72 + grain * 0.28;
    float cl = 0.72 + 0.28 * c2.y;                          // per-clump length
    float thr = mix(0.12, 0.93, hh / cl);
    if (furMaskG < 0.5 || hh > cl || sig < thr) discard;
  #elif defined(FUR_FIN)
    float yy = vFin.y;
    float xx = vFin.x * vFin.z * uFinDensity + yy * 0.45;
    float sidx = floor(xx);
    float fx = fract(xx) - 0.5 - (fHash(vec2(sidx, 3.7)) - 0.5) * 0.5;
    float streak = texture2D(uFur, vMapUv).r;
    float sl = clamp((0.45 + 0.55 * fHash(vec2(sidx, 9.1))) * (0.4 + 0.9 * streak), 0.1, 1.0);
    float w = 0.36 * (1.0 - yy / sl);
    float dith = fHash(floor(gl_FragCoord.xy));
    if (furMaskG < 0.5 || yy > sl || abs(fx) > w || vFinVis < dith * 0.9 + 0.05) discard;
  #endif
  #ifdef FUR_FIN
    float ao = mix(0.72, 1.0, hh);            // fins only show at the silhouette: no deep root occlusion
  #else
    float ao = mix(uBaseAO, 1.0, pow(hh, 0.65));
  #endif
  #if !defined(FUR_SHELL) && !defined(FUR_FIN)
    if (!gl_FrontFacing) ao = max(ao, 0.8);   // thin parts seen from behind (inner ears) carry no shells
  #endif
  diffuseColor.rgb *= ao;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uTip, smoothstep(0.45, 1.0, hh));
}
`;
const SH_ROUGH_F = /* glsl */`
#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, uWet, furWetG);
`;
const SH_LIGHT_F = (() => {
  let c = THREE.ShaderChunk.lights_physical_pars_fragment;
  c = c.replace('float dotNL = saturate( dot( geometryNormal, directLight.direction ) );\n\n\tvec3 irradiance = dotNL * directLight.color;',
    `float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	float dotNLw = mix(dotNL, saturate((dot(geometryNormal, directLight.direction) + uWrap) / (1.0 + uWrap)), furMaskG);
	vec3 irradiance = dotNLw * directLight.color;`);
  c = c.replace('reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );\n}',
    `reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	{
		vec3 T = normalize(vStrandT);
		vec3 Hh = normalize(directLight.direction + geometryViewDir);
		float tH = dot(T, Hh);
		float s1 = pow(sqrt(max(0.0, 1.0 - tH * tH)), uKK.x);
		vec3 T2 = normalize(T - geometryNormal * 0.3);
		float tH2 = dot(T2, Hh);
		float s2 = pow(sqrt(max(0.0, 1.0 - tH2 * tH2)), uKK.y);
		float nl = saturate(dot(geometryNormal, directLight.direction) * 0.6 + 0.4);
		reflectedLight.directSpecular += directLight.color * nl * (uKK.z * s1 + uKK.w * s2 * material.diffuseColor * 2.5) * furMaskG;
	}
}`);
  return c;
})();
const SH_RIM_F = /* glsl */`
#include <lights_fragment_end>
#ifndef FUR_FIN
{
  float fres = pow(1.0 - saturate(dot(normal, geometryViewDir)), 3.0);
  reflectedLight.indirectDiffuse += reflectedLight.indirectDiffuse * (uSheen * fres * furMaskG * 2.0);
  reflectedLight.directDiffuse += reflectedLight.directDiffuse * (uSheen * fres * furMaskG);
}
#else
reflectedLight.directSpecular *= 0.35;
#endif
`;

function patchFur(m: THREE.MeshStandardMaterial, kind: 'base' | 'shell' | 'fin', U: Record<string, THREE.IUniform>, h: number) {
  const own = { uH: { value: h } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, own);
    sh.defines = sh.defines ?? {};
    if (kind === 'shell') sh.defines.FUR_SHELL = '';
    if (kind === 'fin') sh.defines.FUR_FIN = '';
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + SH_PARS_V)
      .replace('#include <skinnormal_vertex>', '#include <skinnormal_vertex>\n' + SH_SKIN_V)
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\n' + SH_BREATH_V + (kind === 'base' ? 'vStrandT = normalize((modelViewMatrix * vec4(furComb, 0.0)).xyz); vH = 0.0;' : SH_DISP_V));
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + SH_PARS_F)
      .replace('#include <map_fragment>', SH_MAP_F)
      .replace('#include <roughnessmap_fragment>', SH_ROUGH_F)
      .replace('#include <lights_physical_pars_fragment>', SH_LIGHT_F)
      .replace('#include <lights_fragment_end>', SH_RIM_F)
      .replace('#include <normal_fragment_begin>', kind === 'fin' ? '#include <normal_fragment_begin>\n#ifdef DOUBLE_SIDED\nnormal *= faceDirection;\n#endif' : '#include <normal_fragment_begin>');
  };
  m.customProgramCacheKey = () => 'life_fur2_' + kind;
  m.needsUpdate = true;
}

/** Per-vertex comb direction (mesh-local, tangent) + length multiplier + no-fur weight from the bone weights. */
function combDirs(body: THREE.SkinnedMesh, rules: FurRules) {
  const g = body.geometry;
  const P = g.attributes.position, N = g.attributes.normal;
  const SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
  const bones = body.skeleton.bones;
  const name = (b: THREE.Bone) => b.name.replace(/^mixamorig:?/, '');
  const BP = body.skeleton.boneInverses.map((m) => new THREE.Vector3().setFromMatrixPosition(m.clone().invert()));
  const find = (pat: string) => { const re = new RegExp(pat); return bones.findIndex((b) => re.test(name(b))); };
  const hi = find(rules.hipBone), he = find(rules.headBone);
  const fwd = hi >= 0 && he >= 0 ? BP[he].clone().sub(BP[hi]).setY(0).normalize() : new THREE.Vector3(0, 0, 1);
  const up = new THREE.Vector3(0, 1, 0);
  const res = rules.rules.map(([p, k, l]) => [new RegExp(p), k, l] as [RegExp, string, number]);
  const skip = /corrective|_end/;
  const chain = (i: number): THREE.Vector3 | null => {
    const c = bones[i].children.find((o) => (o as any).isBone && !skip.test(name(o as THREE.Bone))) as THREE.Bone | undefined;
    if (!c) return null;
    const ci = bones.indexOf(c);
    if (ci < 0) return null;
    const d = BP[ci].clone().sub(BP[i]);
    return d.lengthSq() > 1e-12 ? d.normalize() : null;
  };
  const noFur = (rules.noFurBones ?? []).map((p) => new RegExp(p));
  const bdir: THREE.Vector3[] = [], blen: number[] = [], bnf: number[] = [];
  bones.forEach((b, i) => {
    const n = name(b);
    let kind = 'back', lm = 1;
    for (const [re, k, l] of res) if (re.test(n)) { kind = k; lm = l; break; }
    let d: THREE.Vector3 | null;
    if (kind === 'down') d = up.clone().multiplyScalar(-0.85).addScaledVector(fwd, -0.3);
    else if (kind === 'chain') {
      d = chain(i);
      if (!d) { const p = b.parent as THREE.Bone; const pi = bones.indexOf(p); d = pi >= 0 ? chain(pi) : null; }
      if (!d) d = fwd.clone().negate();
    } else d = fwd.clone().negate();
    bdir.push(d.normalize()); blen.push(lm); bnf.push(noFur.some((re) => re.test(n)) ? 1 : 0);
  });
  const brRe = rules.breathBones ? new RegExp(rules.breathBones) : null;
  const bbr = bones.map((b) => (brRe && brRe.test(name(b)) ? 1 : 0));
  const n = P.count;
  const comb = new Float32Array(n * 3), len = new Float32Array(n), breath = new Float32Array(n);
  const bm = body.bindMatrix, bmi = body.bindMatrixInverse;
  const nm = new THREE.Matrix3().getNormalMatrix(bm);
  const c = new THREE.Vector3(), nv = new THREE.Vector3(), fb = new THREE.Vector3();
  for (let v = 0; v < n; v++) {
    c.set(0, -0.3, 0);
    let L = 0, nf = 0, br = 0;
    for (let k = 0; k < 4; k++) {
      const j = SI.getComponent(v, k), w = SW.getComponent(v, k);
      if (w <= 0 || !bdir[j]) continue;
      c.addScaledVector(bdir[j], w); L += blen[j] * w; nf += bnf[j] * w; br += bbr[j] * w;
    }
    nv.fromBufferAttribute(N, v).applyMatrix3(nm).normalize();
    breath[v] = Math.min(1, br) * (1 - Math.max(0, nv.y) * 0.8);
    c.addScaledVector(nv, -c.dot(nv));
    if (c.length() < 0.15) { fb.set(0, -1, 0); fb.addScaledVector(nv, -fb.dot(nv)); c.copy(fb); }
    c.normalize().transformDirection(bmi);
    comb[v * 3] = c.x; comb[v * 3 + 1] = c.y; comb[v * 3 + 2] = c.z;
    len[v] = L * Math.max(0, 1 - nf * 1.5);
  }
  return { comb, len, breath };
}

/** Fin geometry: one quad per (position-welded) edge, base at the surface, tip pushed out in the shader. */
function finGeometry(g: THREE.BufferGeometry, comb: Float32Array, len: Float32Array, breath: Float32Array): THREE.BufferGeometry {
  const P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv;
  const SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
  const idx = g.index!;
  // weld by position (UV seams duplicate vertices)
  const key = new Map<string, number>();
  const weld = new Int32Array(P.count);
  let bb = 0;
  g.computeBoundingBox();
  const sz = g.boundingBox!.getSize(new THREE.Vector3()).length();
  const q = 1e5 / Math.max(1e-6, sz);
  for (let i = 0; i < P.count; i++) {
    const k = `${Math.round(P.getX(i) * q)},${Math.round(P.getY(i) * q)},${Math.round(P.getZ(i) * q)}`;
    let w = key.get(k);
    if (w === undefined) { w = i; key.set(k, i); bb++; }
    weld[i] = w;
  }
  const edges = new Map<string, [number, number]>();
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
    for (const [x, y] of [[a, b], [b, c], [c, a]]) {
      if (len[x] < 0.05 && len[y] < 0.05) continue;
      const wx = weld[x], wy = weld[y];
      const k = wx < wy ? wx + '_' + wy : wy + '_' + wx;
      if (!edges.has(k)) edges.set(k, [x, y]);
    }
  }
  const E = edges.size;
  const pos = new Float32Array(E * 12), nor = new Float32Array(E * 12), uv = new Float32Array(E * 8);
  const si = new Uint16Array(E * 16), sw = new Float32Array(E * 16);
  const cb = new Float32Array(E * 12), fl = new Float32Array(E * 4), fbr = new Float32Array(E * 4), fin = new Float32Array(E * 12), ed = new Float32Array(E * 12);
  const ind = new Uint32Array(E * 6);
  const pa = new THREE.Vector3(), pb = new THREE.Vector3();
  let e = 0;
  for (const [a, b] of edges.values()) {
    pa.fromBufferAttribute(P, a); pb.fromBufferAttribute(P, b);
    const el = pa.distanceTo(pb);
    const dx = (pb.x - pa.x) / (el || 1), dy = (pb.y - pa.y) / (el || 1), dz = (pb.z - pa.z) / (el || 1);
    const verts = [[a, 0, 0], [b, 1, 0], [a, 0, 1], [b, 1, 1]];
    for (let k = 0; k < 4; k++) {
      const [v, ex, hy] = verts[k];
      const o = e * 4 + k;
      pos.set([P.getX(v), P.getY(v), P.getZ(v)], o * 3);
      nor.set([N.getX(v), N.getY(v), N.getZ(v)], o * 3);
      uv.set([UV.getX(v), UV.getY(v)], o * 2);
      si.set([SI.getX(v), SI.getY(v), SI.getZ(v), SI.getW(v)], o * 4);
      sw.set([SW.getX(v), SW.getY(v), SW.getZ(v), SW.getW(v)], o * 4);
      cb.set([comb[v * 3], comb[v * 3 + 1], comb[v * 3 + 2]], o * 3);
      fl[o] = len[v]; fbr[o] = breath[v];
      fin.set([ex, hy, el], o * 3);
      ed.set([dx, dy, dz], o * 3);
    }
    const b0 = e * 4;
    ind.set([b0, b0 + 1, b0 + 3, b0, b0 + 3, b0 + 2], e * 6);
    e++;
  }
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  fg.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  fg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  fg.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  fg.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  fg.setAttribute('aComb', new THREE.BufferAttribute(cb, 3));
  fg.setAttribute('aFurLen', new THREE.BufferAttribute(fl, 1));
  fg.setAttribute('aBreath', new THREE.BufferAttribute(fbr, 1));
  fg.setAttribute('aFin', new THREE.BufferAttribute(fin, 3));
  fg.setAttribute('aEdge', new THREE.BufferAttribute(ed, 3));
  fg.setIndex(new THREE.BufferAttribute(ind, 1));
  fg.boundingSphere = g.boundingSphere?.clone() ?? null;
  return fg;
}

const cache = new Map<string, Promise<any>>();
export function loadCreature(sp: Species): Promise<any> {
  const spec = SPECS[sp];
  let p = cache.get(spec.url);
  if (!p) {
    p = Promise.all([Assets.glb(spec.url), Assets.jsonSafe<FurRules | null>(spec.fur.rules, null)]).then(([g, r]) => { (g as any).userData = { ...(g as any).userData, furRules: r }; return g; });
    cache.set(spec.url, p);
  }
  return p;
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _m = new THREE.Matrix4();

/** One live instance of a sculpted creature. Implements QuadRigLike so QuadAnimator can drive it. */
export class Creature implements QuadRigLike {
  readonly root = new THREE.Group();
  readonly inner = new THREE.Group();
  readonly species: Species;
  readonly dims: { J: [number, number, number][] };
  readonly clipPoses = new Set<QuadPose>();
  readonly anim: QuadAnimator;
  private model: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private actions: Record<string, THREE.AnimationAction> = {};
  private bl: THREE.Bone[] = [];
  private parentIdx: number[] = [];
  private restQ: THREE.Quaternion[] = [];
  private restP: THREE.Vector3[] = [];
  private Q: THREE.Quaternion[] = [];
  private named: Record<string, number> = {};
  private tail: number[] = [];
  private tng: number[] = [];
  private delta = new Map<number, THREE.Euler>();
  private qArm = new THREE.Quaternion();
  private unit = 1;            // metres per bone unit
  private shells: THREE.SkinnedMesh[] = [];
  private shellMats: THREE.MeshStandardMaterial[] = [];
  private body: THREE.SkinnedMesh | null = null;
  private t = Math.random() * 10;
  private oneShot: { name: string; t: number; dur: number } | null = null;
  private twitch = { t: 2, side: 0, k: 0 };
  happy = 0;
  private lastPos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private furLocalLen = 1;
  private furScale = 1;
  private groups: Record<string, number[]> = {};
  private pd = new Map<number, THREE.Vector3>();
  private headR = new THREE.Quaternion();
  private headRestInv = new THREE.Quaternion();

  constructor(gltf: any, readonly spec: CreatureSpec, quality = 1) {
    this.species = spec.species;
    this.model = skClone(gltf.scene);
    this.inner.rotation.y = Math.PI;      // GLB faces +Z → our rigs face -Z
    this.inner.add(this.model);
    this.root.add(this.inner);
    this.root.userData.headHeight = spec.headH + 0.18;
    // ---- meshes & skeleton
    let skel: THREE.Skeleton | null = null;
    this.model.traverse((o: any) => {
      if (o.isSkinnedMesh) {
        o.frustumCulled = false;
        o.castShadow = true;
        o.receiveShadow = true;
        if (!this.body || o.geometry.attributes.position.count > this.body.geometry.attributes.position.count) this.body = o;
        skel = o.skeleton;
      } else if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; }
    });
    if (!skel) throw new Error('creature without skeleton');
    // unlit (KHR_materials_unlit) parts → lit PBR (wet eyes, whiskers) so they sit in the scene lighting
    this.model.traverse((o: any) => {
      if (!o.isMesh || o === this.body) return;
      const m = o.material as THREE.MeshBasicMaterial;
      if (!m || !(m as any).isMeshBasicMaterial) return;
      o.material = new THREE.MeshStandardMaterial({ map: m.map, color: m.color, transparent: m.transparent, alphaTest: m.alphaTest, side: m.side, depthWrite: m.depthWrite, roughness: 0.22, metalness: 0 });
    });
    const S = skel as THREE.Skeleton;
    this.bl = S.bones.slice();
    // hierarchy order (parents before children)
    const order: THREE.Bone[] = [];
    const visit = (b: THREE.Object3D) => { if ((b as any).isBone) order.push(b as THREE.Bone); for (const c of b.children) visit(c); };
    const tops = this.bl.filter((b) => !(b.parent as any)?.isBone);
    for (const t of tops) visit(t);
    for (const b of this.bl) if (!order.includes(b)) order.push(b);
    this.bl = order;
    this.parentIdx = order.map((b) => order.indexOf(b.parent as THREE.Bone));
    this.restQ = order.map((b) => b.quaternion.clone());
    this.restP = order.map((b) => b.position.clone());
    this.Q = order.map(() => new THREE.Quaternion());
    // armature (top bones' parent) rotation & scale relative to the model root
    this.model.updateMatrixWorld(true);
    const armNode = tops[0].parent!;
    _m.copy(this.model.matrixWorld).invert().multiply(armNode.matrixWorld);
    const sc = new THREE.Vector3();
    _m.decompose(_v, this.qArm, sc);
    this.unit = sc.x;
    // name mapping
    const base = (n: string) => n.replace(/^mixamorig/, '');
    order.forEach((b, i) => {
      const n = base(b.name);
      for (const [k, re] of Object.entries(spec.map)) if (this.named[k] === undefined && re.test(n)) this.named[k] = i;
      const tm = spec.tail.exec(n); if (tm) this.tail.push(i);
      const gm = spec.tongue.exec(n); if (gm) this.tng.push(i);
    });
    const ord = (re: RegExp, list: number[]) => list.sort((a, b) => {
      const ka = re.exec(base(order[a].name))![1], kb = re.exec(base(order[b].name))![1];
      const rank = (s: string) => (isNaN(+s) ? ['back', 'mid', 'tip'].indexOf(s) : +s);
      return rank(ka) - rank(kb);
    });
    ord(spec.tail, this.tail);
    ord(spec.tongue, this.tng);
    for (const [g, re] of Object.entries(spec.groups ?? {})) this.groups[g] = order.map((b, i) => (re.test(base(b.name)) ? i : -1)).filter((i) => i >= 0);
    // head orientation at rest (facial translations are authored in head-rest space)
    {
      const Qr: THREE.Quaternion[] = [];
      order.forEach((b, i) => { const p = this.parentIdx[i]; Qr.push((p >= 0 ? Qr[p] : this.qArm).clone().multiply(b.quaternion)); });
      if (this.named.head !== undefined) this.headRestInv.copy(Qr[this.named.head]).invert();
    }
    // approximate joint table for the animator's look-at (head position in creature space, metres)
    const J: [number, number, number][] = [];
    for (let i = 0; i < QNB; i++) J.push([0, 0.5, 0]);
    const hb = this.named.head;
    if (hb !== undefined) {
      const hp = order[hb].getWorldPosition(new THREE.Vector3());
      this.model.worldToLocal(hp);
      J[QB.head] = [hp.x, hp.y, hp.z];
    }
    this.dims = { J };
    // ---- clips
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const clip of gltf.animations as THREE.AnimationClip[]) {
      const a = this.mixer.clipAction(clip);
      a.enabled = true;
      a.setEffectiveWeight(0);
      a.play();
      this.actions[clip.name] = a;
    }
    const idle = this.actions[spec.clips.idle];
    if (idle) idle.setEffectiveWeight(1);
    if (spec.clips.sit && this.actions[spec.clips.sit]) { this.clipPoses.add('sit'); this.clipPoses.add('beg'); }
    for (const k of ['shake', 'roll', 'dead'] as const) {
      const a = this.actions[spec.clips[k] ?? ''];
      if (a) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.stop(); }
    }
    // ---- fur
    this.buildFur(quality, gltf.userData?.furRules ?? null);
    this.anim = new QuadAnimator(this);
  }

  // ------------------------------------------------------------------ fur shells

  private buildFur(quality: number, rules: FurRules | null) {
    const body = this.body;
    if (!body) return;
    const F = this.spec.fur;
    const src = (Array.isArray(body.material) ? body.material[0] : body.material) as THREE.MeshStandardMaterial;
    // unlit / basic source materials (the cat) → lit standard material with the same map
    const baseMat = (src as any).isMeshStandardMaterial ? src : new THREE.MeshStandardMaterial({ map: (src as any).map ?? null, color: 0xffffff, roughness: 0.9 });
    const g = body.geometry;
    // per-geometry fur attributes (shared by every clone)
    let fd = g.userData.fur as { comb: Float32Array; len: Float32Array; breath: Float32Array; fins?: THREE.BufferGeometry } | undefined;
    if (!fd) {
      const r: FurRules = rules ?? { hipBone: '^$', headBone: '^$', rules: [] };
      fd = combDirs(body, r);
      g.setAttribute('aComb', new THREE.BufferAttribute(fd.comb, 3));
      g.setAttribute('aFurLen', new THREE.BufferAttribute(fd.len, 1));
      g.setAttribute('aBreath', new THREE.BufferAttribute(fd.breath, 1));
      g.userData.fur = fd;
    }
    // metres → mesh-local units
    this.root.updateMatrixWorld(true);
    const ws = new THREE.Vector3();
    _m.copy(this.root.matrixWorld).invert().multiply(body.matrixWorld).decompose(_v, _q, ws);
    this.furScale = Math.max(1e-6, ws.x);
    this.furLocalLen = F.len / this.furScale;
    const albedo = lifeTex(F.albedo, { srgb: true, flipY: false, fallback: '#b08050' });
    const furTex = lifeTex(F.fur, { srgb: false, flipY: false, fallback: '#80ff80' });
    const U: Record<string, THREE.IUniform> = {
      uLen: { value: this.furLocalLen }, uBend: { value: new THREE.Vector3(0, -F.gravity, 0) }, uWind: { value: new THREE.Vector3() },
      uTime: { value: 0 }, uLie: { value: F.lie }, uFur: { value: furTex }, uDensity: { value: F.density }, uClump: { value: F.clump },
      uClumpK: { value: F.clumpK }, uTip: { value: new THREE.Vector3(...F.tip) }, uBaseAO: { value: F.ao }, uKK: { value: new THREE.Vector4(...F.kk) },
      uWrap: { value: F.wrap }, uSheen: { value: F.sheen }, uWet: { value: F.wet }, uFinDensity: { value: F.fins }, uBreath: { value: 0 },
    };
    this.furU = U;
    const mk = () => {
      const m = baseMat.clone();
      m.map = albedo;
      m.color.setRGB(...(F.tint ?? [1, 1, 1]));
      m.metalness = 0;
      return m;
    };
    // base skin: own AO uniform (brighter when the shells are culled at distance)
    const bm = mk();
    this.baseAO = { value: F.ao };
    patchFur(bm, 'base', { ...U, uBaseAO: this.baseAO }, 0);
    body.material = bm;
    const n = Math.max(0, Math.round(F.shells * quality));
    for (let i = 1; i <= n; i++) {
      const m = mk();
      m.roughness = 1;
      m.roughnessMap = null;
      m.metalnessMap = null;
      patchFur(m, 'shell', U, i / n);
      const s = new THREE.SkinnedMesh(g, m);
      s.bind(body.skeleton, body.bindMatrix);
      s.position.copy(body.position); s.quaternion.copy(body.quaternion); s.scale.copy(body.scale);
      s.frustumCulled = false;
      s.castShadow = false;
      s.receiveShadow = true;
      s.renderOrder = 1;
      body.parent!.add(s);
      this.shells.push(s);
      this.shellMats.push(m);
    }
    // silhouette fins
    if (F.fins > 0 && quality >= 0.5) {
      if (!fd.fins) fd.fins = finGeometry(g, fd.comb, fd.len, fd.breath);
      const m = mk();
      m.roughness = 1; m.roughnessMap = null; m.metalnessMap = null;
      m.side = THREE.DoubleSide;
      patchFur(m, 'fin', U, 1);
      const f = new THREE.SkinnedMesh(fd.fins, m);
      f.bind(body.skeleton, body.bindMatrix);
      f.position.copy(body.position); f.quaternion.copy(body.quaternion); f.scale.copy(body.scale);
      f.frustumCulled = false; f.castShadow = false; f.receiveShadow = false; f.renderOrder = 2;
      body.parent!.add(f);
      this.fins = f;
      this.shellMats.push(m);
    }
  }
  private furU: Record<string, THREE.IUniform> | null = null;
  private baseAO = { value: 0.5 };
  private fins: THREE.SkinnedMesh | null = null;
  private bend = new THREE.Vector3();
  private bendV = new THREE.Vector3();
  private windT = Math.random() * 100;

  // ------------------------------------------------------------------ one-shot clips

  /** play a one-shot authored clip ('shake' | 'roll' | 'dead'); returns false if missing */
  playOnce(kind: 'shake' | 'roll' | 'dead'): boolean {
    const name = this.spec.clips[kind];
    const a = name ? this.actions[name] : null;
    if (!a) return false;
    a.reset(); a.setEffectiveWeight(0); a.play();
    this.oneShot = { name: name!, t: 0, dur: a.getClip().duration };
    return true;
  }
  stopOnce() { this.oneShot = null; }

  // ------------------------------------------------------------------ per frame

  update(dt: number, inp: QuadInput, camPos: THREE.Vector3 | null) {
    this.t += dt;
    // restore last frame's CLIP output (the mixer only re-applies values that changed), let clips write, snapshot
    for (let i = 0; i < this.bl.length; i++) { this.bl[i].quaternion.copy(this.restQ[i]); this.bl[i].position.copy(this.restP[i]); }
    // clip weights from pose weights + one-shot
    const W = this.anim.poseW;
    const sitW = this.clipPoses.has('sit') ? Math.min(1, W.sit + W.beg) : 0;
    let osW = 0;
    if (this.oneShot) {
      this.oneShot.t += dt;
      const o = this.oneShot;
      osW = Math.min(1, o.t / 0.3, Math.max(0, (o.dur - o.t) / 0.4));
      if (o.t > o.dur || inp.speed > 0.4) { this.oneShot = null; osW = 0; }
    }
    const idle = this.actions[this.spec.clips.idle], sit = this.spec.clips.sit ? this.actions[this.spec.clips.sit] : null;
    if (this.spec.stand) { if (idle) idle.setEffectiveWeight(sitW * (1 - osW)); }
    else {
      if (idle) idle.setEffectiveWeight(Math.max(0, 1 - sitW) * (1 - osW));
      if (sit) sit.setEffectiveWeight(sitW * (1 - osW));
    }
    for (const k of ['shake', 'roll', 'dead'] as const) {
      const n = this.spec.clips[k];
      if (n && this.actions[n]) this.actions[n].setEffectiveWeight(this.oneShot?.name === n ? osW : 0);
    }
    this.mixer.update(dt);
    for (let i = 0; i < this.bl.length; i++) { this.restQ[i].copy(this.bl[i].quaternion); this.restP[i].copy(this.bl[i].position); }
    // procedural layers (QuadAnimator → apply())
    this.oneShotW = osW;
    this.anim.update(dt, inp);
    // fur: LOD + spring motion lag + wind
    if (this.furU) {
      const F = this.spec.fur;
      const wp = this.root.getWorldPosition(_v);
      const d = camPos ? wp.distanceTo(camPos) : 0;
      const ns = this.shells.length;
      const nVis = d < 4.5 ? ns : d < 9 ? Math.round(ns * 0.6) : d < 18 ? Math.round(ns * 0.35) : d < 32 ? Math.min(ns, 4) : 0;
      for (let i = 0; i < ns; i++) this.shells[i].visible = i < nVis;
      if (this.fins) this.fins.visible = d < 8;
      this.baseAO.value = nVis === 0 ? 0.92 : nVis < ns * 0.5 ? (F.ao + 1) * 0.5 : F.ao;
      // world velocity → spring-lagged bend (fur trails behind, overshoots when stopping)
      const dtc = Math.max(dt, 1e-3);
      const vx = (wp.x - this.lastPos.x) / dtc, vy = (wp.y - this.lastPos.y) / dtc, vz = (wp.z - this.lastPos.z) / dtc;
      this.lastPos.copy(wp);
      const fast = vx * vx + vy * vy + vz * vz > 100;
      const tx = fast ? 0 : -vx * 0.14, ty = fast ? 0 : -vy * 0.14, tz = fast ? 0 : -vz * 0.14;
      const k = 70, c = 7;
      this.bendV.x += ((tx - this.bend.x) * k - this.bendV.x * c) * dtc;
      this.bendV.y += ((ty - this.bend.y) * k - this.bendV.y * c) * dtc;
      this.bendV.z += ((tz - this.bend.z) * k - this.bendV.z * c) * dtc;
      this.bend.addScaledVector(this.bendV, dtc);
      if (this.bend.length() > 0.9) this.bend.setLength(0.9);
      this.windT += dt;
      const gust = 0.5 + 0.5 * Math.sin(this.windT * 0.37) * Math.sin(this.windT * 0.11 + 1.3);
      const body = this.body!;
      const qi = _qi.copy(body.getWorldQuaternion(_q)).invert();
      (this.furU.uBend.value as THREE.Vector3).set(this.bend.x, this.bend.y - F.gravity, this.bend.z).applyQuaternion(qi);
      (this.furU.uWind.value as THREE.Vector3).set(0.12 * gust, 0.02, 0.06 * gust).applyQuaternion(qi);
      this.furU.uTime.value = this.windT;
    }
  }
  private oneShotW = 0;

  /** QuadRigLike.apply — creature-space Euler deltas per QB bone + root height/pitch. */
  apply(eul: Float32Array, rootY: number, pitch: number) {
    const N = this.named;
    const d = this.delta;
    d.clear();
    const fade = 1 - this.oneShotW; // authored one-shots own the body
    const add = (idx: number | undefined, x: number, y: number, z: number, k = 1) => {
      if (idx === undefined) return;
      const e = d.get(idx);
      if (e) { e.x += x * k; e.y += y * k; e.z += z * k; } else d.set(idx, new THREE.Euler(x * k, y * k, z * k, 'YXZ'));
    };
    for (let qi = 0; qi < QNB; qi++) {
      const x = eul[qi * 3] * fade, y = eul[qi * 3 + 1] * fade, z = eul[qi * 3 + 2] * fade;
      if (x === 0 && y === 0 && z === 0) continue;
      const name = QNAMES[qi];
      if (name === 'neck' && N.neck2 !== undefined) { add(N.neck, x, y, z, 0.55); add(N.neck2, x, y, z, 0.45); continue; }
      if (name === 'spine' && N.spine2 !== undefined) { add(N.spine, x, y, z, 0.5); add(N.spine2, x, y, z, 0.5); continue; }
      if (name.startsWith('tail')) {
        const n = this.tail.length;
        if (!n) continue;
        const seg = name === 'tail1' ? 0 : name === 'tail2' ? 1 : 2;
        for (let i = 0; i < n; i++) {
          const t = i / Math.max(1, n - 1);
          const w = seg === 0 ? Math.max(0, 1 - t * 2.2) : seg === 1 ? Math.max(0, 1 - Math.abs(t - 0.5) * 2.4) : Math.max(0, t * 2.2 - 1.2);
          add(this.tail[i], x, y, z, w * (3 / n) * 1.1);
        }
        continue;
      }
      add(N[name], x, y, z);
    }
    // sitting rig → stand it up for stand / walk / lie / sleep (procedural poses then work from a standing base)
    const stS = this.spec.stand;
    if (stS) {
      const W = this.anim.poseW;
      const k = Math.max(0, 1 - W.sit - W.beg) * fade;
      if (k > 0.001) {
        for (const [bn, x, y, z] of stS.rot) add(N[bn], x, y, z, k);
        rootY += stS.y * k;
      }
    }
    // beg = authored sit clip + forepaws raised, head up
    const bw = this.clipPoses.has('beg') ? this.anim.poseW.beg * fade : 0;
    if (bw > 0.01) {
      const paw = Math.sin(this.t * 3) * 0.12;
      add(N.chest, -0.25, 0, 0, bw); add(N.spine, -0.15, 0, 0, bw);
      add(N.sh_l, -1.05 + paw, 0, 0.12, bw); add(N.sh_r, -1.05 - paw, 0, -0.12, bw);
      add(N.el_l, 1.5, 0, 0, bw); add(N.el_r, 1.5, 0, 0, bw);
      add(N.wr_l, 0.6, 0, 0, bw); add(N.wr_r, 0.6, 0, 0, bw);
      add(N.head, 0.15, 0, 0, bw);
    }
    // ---- facial layer (rotations: creature space; translations: head-rest space, metres)
    const F = this.anim.face;
    const sp = this.spec;
    const G = this.groups;
    const pd = this.pd;
    pd.clear();
    const addP = (list: number[] | number | undefined, x: number, y: number, z: number, side = 0) => {
      if (list === undefined) return;
      for (const idx of Array.isArray(list) ? list : [list]) {
        const v = pd.get(idx);
        const sx = side ? x * side : x;
        if (v) v.x += sx, v.y += y, v.z += z; else pd.set(idx, new THREE.Vector3(sx, y, z));
      }
    };
    const blink = F.blink;
    const happy = this.happy;
    const fs = sp.face;
    if (fs.lidMove) {
      // lids slide over the eyeball (the rig's lid pivots are broken → translate the lid joints)
      const up = -fs.lidMove * blink + fs.lidOpen * (1 - blink), lo = fs.lidMove * 0.3 * blink + 0.004 * happy * (1 - blink);
      addP(N.lidu_l, 0, up, 0.001 * blink); addP(N.lidu_r, 0, up, 0.001 * blink);
      addP(N.lidl_l, 0, lo, 0); addP(N.lidl_r, 0, lo, 0);
      addP(G.squint, 0, 0.005 * happy + 0.003 * F.yawn, 0);
    } else {
      add(N.lidu_l, fs.lidU * blink, 0, 0); add(N.lidu_r, fs.lidU * blink, 0, 0);
      add(N.lidl_l, fs.lidL * blink, 0, 0); add(N.lidl_r, fs.lidL * blink, 0, 0);
      if (happy > 0.01 && fs.squint) { add(N.squint_l, -fs.squint * happy, 0, 0); add(N.squint_r, -fs.squint * happy, 0, 0); }
    }
    // eyes follow the look target (lead the head), REM twitches while dreaming
    const rem = F.dream > 0 ? Math.sin(this.t * 31) * 0.12 * F.dream : 0;
    add(N.eye_l, F.eyePitch, F.eyeYaw + rem, 0); add(N.eye_r, F.eyePitch, F.eyeYaw + rem, 0);
    // brows: +1 inner brows up (puppy eyes), -1 furrowed
    const brow = F.brow * (1 - blink * 0.5);
    addP(G.browIn, 0, 0.022 * brow, 0.004 * Math.max(0, -brow));
    addP(G.browOut, 0, 0.01 * brow - 0.006 * happy, 0);
    // ear twitches & flicks (stronger while dreaming)
    this.twitch.t -= 1 / 60;
    if (this.twitch.t < 0) { this.twitch.t = 1.5 + Math.random() * 4; this.twitch.side = Math.random() < 0.5 ? 1 : -1; this.twitch.k = 1; }
    this.twitch.k *= 0.86;
    const tw = this.twitch.k * Math.sin(this.t * 40) * 0.3;
    if (this.twitch.side > 0) add(N.ear_l, tw, tw * 0.5, tw * 0.6); else add(N.ear_r, tw, -tw * 0.5, -tw * 0.6);
    // ears swivel toward where the eyes look
    add(N.ear_l, 0, F.eyeYaw * 0.6, 0); add(N.ear_r, 0, F.eyeYaw * 0.6, 0);
    // mouth: panting smile, tongue out / curled in a yawn, snarl
    const pant = Math.max(F.pant, F.eat * 0.5);
    addP(G.corner, 0, 0.003 * pant + 0.002 * happy, -0.009 * pant - 0.006 * F.yawn - 0.006 * F.snarl);
    addP(G.lipUp, 0, 0.013 * F.snarl + 0.002 * F.yawn, -0.003 * F.snarl);
    addP(N.nose, 0, 0.004 * F.snarl + Math.sin(this.t * 26) * 0.0016 * F.sniff, 0);
    addP(N.nostril_l, 0.0025 * F.sniff * (0.5 + 0.5 * Math.sin(this.t * 26)), 0, 0); addP(N.nostril_r, -0.0025 * F.sniff * (0.5 + 0.5 * Math.sin(this.t * 26)), 0, 0);
    if (this.tng.length) {
      if (pant > 0.05) {
        const wob = Math.sin(this.t * 9) * 0.05;
        addP(this.tng[0], 0, -0.006 * pant, 0.016 * pant);
        this.tng.forEach((ti, i) => add(ti, (0.12 + i * 0.06 + wob) * pant, 0, 0));
      }
      if (F.yawn > 0.05) this.tng.forEach((ti, i) => add(ti, -(0.08 + i * 0.07) * F.yawn, 0, 0));
    }
    if (F.sniff > 0.05) add(N.nose, Math.sin(this.t * 26) * 0.06 * F.sniff, 0, 0);
    // breathing → fur/body shader
    if (this.furU) this.furU.uBreath.value = F.breath * this.spec.fur.breath / this.furScale;

    // ---- apply top-down in creature space
    const B = this.bl;
    for (let i = 0; i < B.length; i++) {
      const p = this.parentIdx[i];
      const Qp = p >= 0 ? this.Q[p] : this.qArm;
      const e = d.get(i);
      if (e) {
        // local' = Qp^-1 · D · Qp · local
        _q.setFromEuler(e);
        _qi.copy(Qp).invert();
        _q2.copy(_qi).multiply(_q).multiply(Qp);
        B[i].quaternion.premultiply(_q2);
      }
      this.Q[i].copy(Qp).multiply(B[i].quaternion);
      if (i === N.head) this.headR.copy(this.Q[i]).multiply(this.headRestInv);
      const pv = pd.get(i);
      if (pv) {
        _v.copy(pv).applyQuaternion(this.headR).applyQuaternion(_qi.copy(Qp).invert()).divideScalar(this.unit);
        B[i].position.add(_v);
      }
    }
    // root height: move the COG (in its parent space, bone units)
    const cog = N.cog;
    if (cog !== undefined && Math.abs(rootY) > 1e-4) {
      const p = this.parentIdx[cog];
      const Qp = p >= 0 ? this.Q[p] : this.qArm;
      _v.set(0, rootY / this.unit, 0).applyQuaternion(_qi.copy(Qp).invert());
      B[cog].position.add(_v);
    }
    this.inner.rotation.x = -pitch;
  }

  /** world position of a semantic bone */
  bonePos(name: string, out = new THREE.Vector3()): THREE.Vector3 | null {
    const i = this.named[name];
    return i === undefined ? null : this.bl[i].getWorldPosition(out);
  }

  /** Attach a collar ring around the neck (world-transform preserving). */
  attachCollar(obj: THREE.Object3D, radius: number) {
    const a = this.named.neck, b = this.named.neck2 ?? this.named.head;
    if (a === undefined || b === undefined) return false;
    this.root.updateMatrixWorld(true);
    const pa = this.bl[a].getWorldPosition(new THREE.Vector3()), pb = this.bl[b].getWorldPosition(new THREE.Vector3());
    const c = pa.clone().lerp(pb, 0.35);
    const dir = pb.clone().sub(pa).normalize();
    obj.position.copy(c);
    obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    obj.scale.setScalar(radius);
    this.root.add(obj);
    obj.updateMatrixWorld(true);
    this.bl[a].attach(obj);
    return true;
  }

  dispose() {
    this.mixer.stopAllAction();
    for (const s of this.shells) s.removeFromParent();
    this.fins?.removeFromParent();
    for (const m of this.shellMats) m.dispose();
    this.model.traverse((o: any) => { if (o.isMesh && o.material && !Array.isArray(o.material)) o.material.dispose?.(); });
  }
}
