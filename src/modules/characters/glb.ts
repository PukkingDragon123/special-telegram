import * as THREE from 'three';
import { Assets } from '../../core/assets';
import { Geo, V3, profile, mergeGeos } from './geo';
import { B, NB, RestSkel, restSkel } from './skel';
import { BodySpec, Lod, buildBodyExtras, setHeadModel, isTube } from './body';
import { buildHairAndHead, setFitHooks } from './hair';
import { EYE_Y } from './layout';

/* ============================================================================================
 * Sculpted, rigged bodies (Quaternius CC0 "Universal Base Characters", processed by
 * scripts/characters/build_chars.py in headless Blender) + the Quaternius CC0 "Universal
 * Animation Library" clips, retargeted onto each body skeleton at load time.
 * body_<sex>.glb: armature + body_hi/body_lo + fitted clothing shells + skirts + shoe shell,
 * UV0 = characters atlas layout (layout.ts), _FAT attribute (build inflation weight).
 * ========================================================================================== */

const BASE = 'gen/characters/';

export interface BodyInfo {
  sex: 'm' | 'f'; height: number; eyes: number[][]; iod: number; bones: Record<string, number[]>; zmap: [number, number][];
  headTable: number[][]; headCenterZ: number; torsoTable: number[][]; neckTable: number[][]; armMap: [number, number][];
}

export interface BodyTemplate {
  sex: 'm' | 'f';
  info: BodyInfo;
  height: number;
  names: string[];
  parent: number[];
  index: Record<string, number>;
  restPos: THREE.Vector3[];
  restQuat: THREE.Quaternion[];
  restScale: THREE.Vector3[];
  boneInverses: THREE.Matrix4[];
  /** rest world (model space) rotation / position per bone */
  Gq: THREE.Quaternion[];
  Gp: THREE.Vector3[];
  geos: Record<string, THREE.BufferGeometry>;
  clips: Map<string, THREE.AnimationClip>;
  /** my 19-bone index → template bone index */
  map: number[];
  /** reference body height y → model y */
  yOf: (yRef: number) => number;
  /** measured torso radius / centre at reference heights (model metres) */
  torsoR: (yRef: number, th: number) => number;
  torsoC: (yRef: number) => number;
  /** my-skeleton stand-in (joints in model space) for accessory generators */
  sk: RestSkel;
  headModel: { table: number[][]; top: number; scale: number };
}

export const TEMPLATES: { m: BodyTemplate | null; f: BodyTemplate | null } = { m: null, f: null };

const MY_TO_GLB: Record<number, string> = {
  [B.hips]: 'pelvis', [B.spine]: 'spine_01', [B.chest]: 'spine_03', [B.neck]: 'neck_01', [B.head]: 'Head',
  [B.clav_l]: 'clavicle_l', [B.upperarm_l]: 'upperarm_l', [B.forearm_l]: 'lowerarm_l', [B.hand_l]: 'hand_l',
  [B.clav_r]: 'clavicle_r', [B.upperarm_r]: 'upperarm_r', [B.forearm_r]: 'lowerarm_r', [B.hand_r]: 'hand_r',
  [B.thigh_l]: 'thigh_l', [B.shin_l]: 'calf_l', [B.foot_l]: 'foot_l', [B.thigh_r]: 'thigh_r', [B.shin_r]: 'calf_r', [B.foot_r]: 'foot_r',
};

function interp(pairs: [number, number][], x: number) {
  const p = pairs.slice().sort((a, b) => a[0] - b[0]);
  let i = 0;
  while (i < p.length - 2 && x > p[i + 1][0]) i++;
  const [x0, y0] = p[i], [x1, y1] = p[i + 1];
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
}

/** fill zero radii (sparse sampling) from angular/vertical neighbours */
function fillZeros(rows: number[][], c0: number, c1: number) {
  for (let pass = 0; pass < 3; pass++) for (let i = 0; i < rows.length; i++) for (let c = c0; c <= c1; c++) {
    if (rows[i][c] > 0) continue;
    const nb: number[] = [];
    if (c > c0 && rows[i][c - 1] > 0) nb.push(rows[i][c - 1]);
    if (c < c1 && rows[i][c + 1] > 0) nb.push(rows[i][c + 1]);
    if (i > 0 && rows[i - 1][c] > 0) nb.push(rows[i - 1][c]);
    if (i < rows.length - 1 && rows[i + 1][c] > 0) nb.push(rows[i + 1][c]);
    if (nb.length) rows[i][c] = nb.reduce((a, b) => a + b, 0) / nb.length;
  }
}

function normalizeGeometry(g: THREE.BufferGeometry, remap: number[] | null): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const n = g.attributes.position.count;
  out.setAttribute('position', new THREE.Float32BufferAttribute(Float32Array.from(g.attributes.position.array as ArrayLike<number>), 3));
  if (g.attributes.normal) out.setAttribute('normal', new THREE.Float32BufferAttribute(Float32Array.from(g.attributes.normal.array as ArrayLike<number>), 3));
  else { out.computeVertexNormals(); }
  const uv = g.attributes.uv;
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv ? Float32Array.from(uv.array as ArrayLike<number>) : new Float32Array(n * 2), 2));
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const SI = new Uint16Array(n * 4), SW = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < 4; k++) {
      const idx = si ? si.getComponent(i, k) : 0;
      SI[i * 4 + k] = remap ? remap[idx] ?? 0 : idx;
      const w = sw ? sw.getComponent(i, k) : k === 0 ? 1 : 0;
      SW[i * 4 + k] = w; s += w;
    }
    if (s > 0) for (let k = 0; k < 4; k++) SW[i * 4 + k] /= s;
  }
  out.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4));
  out.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
  const fat = (g.attributes as any)._fat ?? (g.attributes as any).afat;
  out.setAttribute('afat', new THREE.Float32BufferAttribute(fat ? Float32Array.from(fat.array as ArrayLike<number>) : new Float32Array(n), 1));
  out.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  if (g.index) out.setIndex(Array.from(g.index.array as ArrayLike<number>));
  else out.setIndex(Array.from({ length: n }, (_, i) => i));
  return out;
}

async function loadTemplate(sex: 'm' | 'f', anims: any): Promise<BodyTemplate | null> {
  const [gltf, info] = await Promise.all([Assets.glb(BASE + `body_${sex}.glb`), Assets.json<BodyInfo>(BASE + `body_${sex}.json`)]);
  let skeleton: THREE.Skeleton | null = null;
  const meshes: THREE.SkinnedMesh[] = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o: any) => { if (o.isSkinnedMesh) { meshes.push(o); if (!skeleton) skeleton = o.skeleton; } });
  if (!skeleton) return null;
  const sk0 = skeleton as THREE.Skeleton;
  const names = sk0.bones.map((b) => b.name);
  const index: Record<string, number> = {};
  names.forEach((n, i) => (index[n] = i));
  const parent = sk0.bones.map((b) => (b.parent && (b.parent as any).isBone ? names.indexOf(b.parent.name) : -1));
  // rest transforms in the armature's space: bones' local TRS (the root bone's parent is the armature node)
  const restPos = sk0.bones.map((b) => b.position.clone());
  const restQuat = sk0.bones.map((b) => b.quaternion.clone());
  const restScale = sk0.bones.map((b) => b.scale.clone());
  // the armature node transform (between scene and root bone) — fold it into the root bone rest
  const rootBone = sk0.bones[parent.indexOf(-1)];
  const arm = rootBone.parent!;
  arm.updateMatrixWorld(true);
  const armM = arm.matrixWorld.clone();
  {
    const ri = names.indexOf(rootBone.name);
    const m = new THREE.Matrix4().compose(restPos[ri], restQuat[ri], restScale[ri]).premultiply(armM);
    m.decompose(restPos[ri], restQuat[ri], restScale[ri]);
  }
  const Gq: THREE.Quaternion[] = [], Gp: THREE.Vector3[] = [];
  for (let i = 0; i < names.length; i++) {
    const p = parent[i];
    if (p < 0) { Gq[i] = restQuat[i].clone(); Gp[i] = restPos[i].clone(); }
    else { Gq[i] = Gq[p].clone().multiply(restQuat[i]); Gp[i] = restPos[i].clone().multiply(restScale[p]).applyQuaternion(Gq[p]).add(Gp[p]); }
  }
  // bind inverses consistent with "mesh at identity inside the rig" (model space)
  const boneInverses = names.map((_, i) => new THREE.Matrix4().compose(Gp[i], Gq[i], new THREE.Vector3(1, 1, 1)).invert());
  // geometries (skin indices remapped to our bone order)
  const geos: Record<string, THREE.BufferGeometry> = {};
  for (const m of meshes) {
    const local = m.skeleton.bones.map((b) => index[b.name] ?? 0);
    // geometry is in the mesh's local space; bring it to model space (mesh may sit under the armature node)
    const g = normalizeGeometry(m.geometry, local);
    const mm = m.matrixWorld.clone();
    if (!mm.equals(new THREE.Matrix4())) { g.applyMatrix4(mm); }
    g.computeBoundingSphere();
    geos[m.name] = g;
  }
  // clips: retarget UAL rest → this skeleton (q' = Rt · Rs⁻¹ · q), keep only pelvis translation
  const clips = new Map<string, THREE.AnimationClip>();
  const srcRest = new Map<string, { q: THREE.Quaternion; p: THREE.Vector3 }>();
  anims.scene.traverse((o: any) => { if (o.isBone || o.type === 'Bone' || o.isObject3D) srcRest.set(o.name, { q: o.quaternion.clone(), p: o.position.clone() }); });
  const pelvisRatio = restPos[index.pelvis]?.y && srcRest.get('pelvis') ? Gp[index.pelvis].y / Math.max(0.1, worldY(anims.scene, 'pelvis')) : 1;
  const tq = new THREE.Quaternion(), sq = new THREE.Quaternion(), vq = new THREE.Quaternion();
  for (const clip of anims.animations as THREE.AnimationClip[]) {
    const name = clip.name.replace(/_Armature$/, '');
    const tracks: THREE.KeyframeTrack[] = [];
    for (const tr of clip.tracks) {
      const [node, prop] = tr.name.split('.');
      if (!(node in index) || /leaf|^root$/.test(node)) continue;
      if (prop === 'quaternion') {
        const src = srcRest.get(node);
        const vals = Float32Array.from(tr.values);
        if (src) {
          sq.copy(src.q).invert();
          tq.copy(restQuat[index[node]]).multiply(sq);
          for (let k = 0; k < vals.length; k += 4) { vq.set(vals[k], vals[k + 1], vals[k + 2], vals[k + 3]); vq.premultiply(tq); vals[k] = vq.x; vals[k + 1] = vq.y; vals[k + 2] = vq.z; vals[k + 3] = vq.w; }
        }
        tracks.push(new THREE.QuaternionKeyframeTrack(tr.name, Array.from(tr.times), Array.from(vals)));
      } else if (prop === 'position' && node === 'pelvis') {
        const vals = Float32Array.from(tr.values);
        for (let k = 0; k < vals.length; k++) vals[k] *= pelvisRatio;
        tracks.push(new THREE.VectorKeyframeTrack(tr.name, Array.from(tr.times), Array.from(vals)));
      }
    }
    clips.set(name, new THREE.AnimationClip(name, clip.duration, tracks));
  }
  // reference ↔ model height mapping and measured tables
  const zpairs = info.zmap.map(([z, yr]) => [yr, z] as [number, number]);
  const yOf = (yr: number) => interp(zpairs, yr);
  const tt = info.torsoTable.map((r) => r.slice());
  fillZeros(tt, 1, 5);
  const torsoR = (yr: number, th: number) => {
    let i = 0;
    while (i < tt.length - 2 && yr > tt[i + 1][0]) i++;
    const a = tt[i], b = tt[i + 1];
    const t = Math.max(0, Math.min(1, (yr - a[0]) / (b[0] - a[0] || 1)));
    const r5 = [1, 2, 3, 4, 5].map((k) => a[k] + (b[k] - a[k]) * t);
    const pr = profile(r5, 16, true);
    let ang = th; while (ang < -Math.PI) ang += Math.PI * 2; while (ang > Math.PI) ang -= Math.PI * 2;
    return pr[Math.round(((ang + Math.PI) / (Math.PI * 2)) * 16) % 16];
  };
  const torsoC = (yr: number) => {
    let i = 0;
    while (i < tt.length - 2 && yr > tt[i + 1][0]) i++;
    const a = tt[i], b = tt[i + 1];
    const t = Math.max(0, Math.min(1, (yr - a[0]) / (b[0] - a[0] || 1)));
    return a[6] + (b[6] - a[6]) * t;
  };
  // my-skeleton stand-in with joints at the sculpted body's joints (model space)
  const myJ: V3[] = new Array(NB);
  for (let i = 0; i < NB; i++) { const n = MY_TO_GLB[i]; const p = Gp[index[n]]; myJ[i] = [p.x, p.y, p.z]; }
  const base = restSkel(sex, 0.5);
  const sk: RestSkel = { ...base, J: myJ };
  // head model in reference units
  const hb = Gp[index.Head];
  const eyeY = info.eyes[0][1];
  const scale = (eyeY - hb.y) / EYE_Y;
  const ht = info.headTable.map((r) => r.slice());
  fillZeros(ht, 2, 10);
  const table = ht.map((r) => [r[0] / scale, r[1] / scale, ...r.slice(2).map((v) => v / scale)]);
  const top = (info.height - hb.y) / scale;
  const map = Array.from({ length: NB }, (_, i) => index[MY_TO_GLB[i]] ?? 0);
  return { sex, info, height: info.height, names, parent, index, restPos, restQuat, restScale, boneInverses, Gq, Gp, geos, clips, map, yOf, torsoR, torsoC, sk, headModel: { table, top, scale } };
}

function worldY(scene: THREE.Object3D, name: string) {
  const o = scene.getObjectByName(name);
  if (!o) return 1;
  scene.updateMatrixWorld(true);
  return o.getWorldPosition(new THREE.Vector3()).y;
}

let loading: Promise<void> | null = null;
export function loadTemplates(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    try {
      const anims = await Assets.glb(BASE + 'anims.glb');
      const [m, f] = await Promise.all([loadTemplate('m', anims), loadTemplate('f', anims)]);
      TEMPLATES.m = m; TEMPLATES.f = f;
      console.info('[characters] sculpted bodies loaded', m ? Object.keys(m.geos).length : 0, 'pieces, clips', m?.clips.size);
    } catch (e) {
      console.warn('[characters] sculpted bodies unavailable, procedural fallback', e);
    }
  })();
  return loading;
}

// ------------------------------------------------------------------ per-look geometry

export function topShell(spec: BodySpec): string | null {
  const t = spec.top;
  if (t.sleeve === 'none' && t.collar !== 'robe' && t.loose < 0.02) return null;
  if (t.collar === 'suit' || t.loose >= 0.028) return 'shell_top_j';
  if (t.hem >= 0.95) return 'shell_top_t';
  if (t.loose >= 0.018) return 'shell_top_l';
  return 'shell_top_u';
}
export function sleeveShell(spec: BodySpec): string | null {
  const s = spec.top.sleeve;
  return s === 'none' ? null : s === 'elbow' ? 'shell_sleeve_rolled' : 'shell_sleeve_' + s;
}
export function bottomShell(spec: BodySpec): string | null {
  const b = spec.bottom;
  if (b.kind === 'skirt') return 'skirt_knee';
  if (b.kind === 'wrap') return b.hem < 0.3 ? 'skirt_wrap' : 'skirt_wrapknee';
  if (b.kind === 'shorts') return b.hem > 0.62 ? 'shell_bot_shorts' : 'shell_bot_knee';
  return b.loose >= 0.028 ? 'shell_bot_loose' : 'shell_bot_trousers';
}

const cache = new Map<string, { geo: THREE.BufferGeometry; refs: number }>();

export function lookGeometryKey(t: BodyTemplate, spec: BodySpec, lod: Lod) {
  return [t.sex, lod, topShell(spec), sleeveShell(spec), bottomShell(spec), spec.shoe.kind, spec.hair, spec.acc.map((a) => a.kind).sort().join('+'), spec.top.collar].join('|');
}

export function acquireLookGeometry(t: BodyTemplate, spec: BodySpec, lod: Lod): { key: string; geo: THREE.BufferGeometry } {
  const key = lookGeometryKey(t, spec, lod);
  let e = cache.get(key);
  if (!e) { e = { geo: buildLookGeometry(t, spec, lod), refs: 0 }; cache.set(key, e); }
  e.refs++;
  return { key, geo: e.geo };
}
export function releaseLookGeometry(key: string) {
  const e = cache.get(key);
  if (!e) return;
  if (--e.refs <= 0) { e.geo.dispose(); cache.delete(key); }
}

function remapGeo(g: THREE.BufferGeometry | null, map: number[], yOf?: (y: number) => number) {
  if (!g) return null;
  const si = g.attributes.skinIndex as THREE.BufferAttribute;
  for (let i = 0; i < si.array.length; i++) (si.array as Uint16Array)[i] = map[(si.array as Uint16Array)[i]] ?? 0;
  if (yOf) { const p = g.attributes.position as THREE.BufferAttribute; for (let i = 0; i < p.count; i++) p.setY(i, yOf(p.getY(i))); g.computeVertexNormals(); }
  return g;
}

function buildLookGeometry(t: BodyTemplate, spec: BodySpec, lod: Lod): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const acc: THREE.BufferGeometry[] = [];
  parts.push(t.geos[lod === 'low' ? 'body_lo' : 'body_hi']);
  if (lod === 'high') {
    for (const k of [topShell(spec), sleeveShell(spec), bottomShell(spec)]) if (k && t.geos[k]) parts.push(t.geos[k]);
    if (['sneaker', 'leather', 'school', 'boot'].includes(spec.shoe.kind) && t.geos.shell_shoe) parts.push(t.geos.shell_shoe);
    // collar / apron / backpack / towel (reference heights → model heights)
    const G1 = new Geo();
    buildBodyExtras(G1, spec, lod, t.torsoR, t.torsoC, t.sk);
    const [a1, b1] = G1.buildSplit();
    if (a1) parts.push(remapGeo(a1, t.map, t.yOf)!);
    if (b1) acc.push(remapGeo(b1, t.map, t.yOf)!);
  }
  // hair, hats, face/head accessories (fitted to the measured head)
  setHeadModel(t.headModel.table, t.headModel.top, t.headModel.scale);
  setFitHooks(t.yOf, t.torsoC, Math.abs(t.info.eyes[0][0]));
  try {
    const G2 = new Geo();
    const spec2 = lod === 'high' ? spec : { ...spec, acc: spec.acc.filter((a) => ['cap', 'cap_back', 'bucket', 'helmet', 'police_cap', 'straw'].includes(a.kind)) };
    buildHairAndHead(G2, t.sk, spec2, lod);
    const [a2, b2] = G2.buildSplit();
    if (a2) parts.push(remapGeo(a2, t.map)!);
    if (b2) acc.push(remapGeo(b2, t.map)!);
  } finally { setHeadModel(null, null, null); setFitHooks(null, null, null); }
  void isTube;
  const A = mergeGeos(parts, false);
  const geo = acc.length ? mergeGeos([A, mergeGeos(acc, false)], true) : (() => { A.clearGroups(); A.addGroup(0, A.index!.count, 0); return A; })();
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 1.5);
  return geo;
}
