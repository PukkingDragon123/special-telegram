import * as THREE from 'three';
import type { AnimName, AttachPoint, CarryPose, CharacterRig, FaceVariant, Look } from '../../game/contracts';
import { B, NB, PARENT, REF_H, RestSkel, restSkel, restDir } from './skel';
import { bodySpec, BodySpec, Lod } from './body';
import { hairThickAt } from './hair';
import { Pose, PoseBuilder, blendPose, sm } from './pose';
import { ANIMS, AnimCtx, AnimDef, FIDGETS, Posture } from './anims';
import { lookKey } from './atlas';
import { faceEntry } from './defs';
import { BodyTemplate, TEMPLATES, acquireLookGeometry, releaseLookGeometry } from './glb';
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
  dance: { clip: 'Dance_Loop' }, push_cart: { clip: 'Push_Loop' }, fall: { clip: 'Death01', once: true },
  sit_floor: { proc: true, mask: 'full' }, sleep: { proc: true, mask: 'full' }, lie_cardboard: { proc: true, mask: 'full' },
  celebrate: { proc: true, mask: 'full' }, casino_cheer: { proc: true, mask: 'full' }, tug: { proc: true, mask: 'full' },
  wake_up: { proc: true, mask: 'full' }, stand_cool: { proc: true, mask: 'full' },
  scream_run: { loco: true, minSpeed: 4.8, proc: true, mask: 'arms' },
  drunk: { loco: true, proc: true, mask: 'upper', procWeight: 0.85 }, sad: { loco: true, proc: true, mask: 'upper' }, carry_heavy: { loco: true, proc: true, mask: 'upper' },
  jenga_pull: { clip: 'Sitting_Idle_Loop', proc: true, mask: 'upper' },
};
const UPPER_PROC: AnimName[] = ['slap', 'get_slapped', 'highfive', 'give', 'point', 'wave', 'angry', 'shrug', 'count_coins', 'think', 'eat', 'drink', 'cook_stir', 'chop', 'wash', 'wipe', 'pray', 'casino_despair'];
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
interface TData { order: number[]; dirLocal: Map<number, THREE.Vector3>; QpInv: THREE.Quaternion[]; offLocal: Map<AttachPoint, { b: number; off: THREE.Vector3 }> }
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
  d = { order, dirLocal, QpInv, offLocal };
  tdata.set(t, d);
  return d;
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _q4 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const D2R = Math.PI / 180;

function makeAtlasMaterial() {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0, envMapIntensity: 0.85 });
  m.name = 'char-atlas';
  m.userData.uFat = { value: 0 };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFat = m.userData.uFat;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float afat;\nuniform float uFat;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normal * afat * uFat;');
  };
  m.customProgramCacheKey = () => 'char-atlas-fat';
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
  private fpMats: THREE.Material[] | null = null;
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
    if (this.meshLo) { this.meshLo.removeFromParent(); if (this.geoKeyLo) releaseLookGeometry(this.geoKeyLo); this.meshLo = null; this.geoKeyLo = ''; }
    this.lodLevel = 'high';
    this.mat.userData.uFat.value = (spec.build - 0.42) * 0.05;
    this.atlasSize = this.opts.lod === 'high' ? 1024 : this.opts.lod === 'low' ? 256 : 512;
    this.setAtlas(this.faceCur);
    const hat = spec.acc.find((a) => a.slot === 'hat');
    this.hairTop = hairThickAt(spec.hair, 0, 0.22) * t.headModel.scale * (hat ? 0.3 : 1) + (hat ? (hat.kind === 'straw' ? 0.08 : hat.kind === 'helmet' ? 0.045 : 0.025) : 0);
    this.applyMaterials();
    this.tick(0);
  }

  private makeMesh(geo: THREE.BufferGeometry) {
    const m = new THREE.SkinnedMesh(geo, [this.mat, accessoryMaterial()]);
    m.name = 'character-mesh';
    m.bind(this.skeleton, new THREE.Matrix4());
    m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 1.5);
    m.castShadow = this.opts.castShadow !== false;
    m.receiveShadow = true;
    m.raycast = () => {};
    this.inner.add(m);
    return m;
  }

  private setAtlas(v: FaceVariant) {
    const prev = this.atlasKey;
    const { key, e } = acquireAtlas(this.look, this.atlasSize, v, this.opts.lod === 'high');
    this.atlasKey = key;
    this.mat.map = e.tex;
    this.mat.needsUpdate = true;
    if (this.fpMats) (this.fpMats[0] as THREE.MeshStandardMaterial).map = e.tex;
    if (prev) releaseAtlas(prev);
  }

  private applyMaterials() {
    let mats: THREE.Material[];
    if (this.mode === 'sil') mats = [silMat, silMat];
    else if (this.mode === 'fp') {
      if (!this.fpMats) {
        const a = this.mat.clone(); a.colorWrite = false; a.depthWrite = false; (a as any).userData = { uFat: this.mat.userData.uFat }; a.onBeforeCompile = this.mat.onBeforeCompile;
        const b = accessoryMaterial().clone(); b.colorWrite = false; b.depthWrite = false;
        this.fpMats = [a, b];
      }
      mats = this.fpMats;
    } else mats = [this.mat, accessoryMaterial()];
    for (const m of [this.mesh, this.meshLo]) if (m) m.material = mats;
  }

  // ---------------------------------------------------------------- contract API

  setLook(look: Look) {
    const prev = lookKey(this.look), ph = this.height;
    this.look = look;
    if (lookKey(look) === prev && Math.abs((look.height || 1.7) - ph) < 1e-4) return;
    this.build(look);
  }

  play(anim: AnimName, opts: { loop?: boolean; speed?: number; fade?: number; onEnd?: () => void } = {}) {
    const d = ANIMS[anim];
    if (!d) { console.warn('[characters] unknown anim', anim); return; }
    const plan = PLANS[anim] ?? { proc: true, mask: 'upper' as Mask };
    const loop = opts.loop ?? d.loop;
    if (this.cur.name === anim && loop && this.cur.loop && !this.cur.ended) { this.cur.speed = opts.speed ?? 1; this.cur.onEnd = opts.onEnd; return; }
    if (this.cur.loop && !this.cur.ended && !loop) this.resume = this.cur.name;
    if (loop) this.resume = anim;
    this.fadeFrom.copy(this.out);
    this.fadeT = 0;
    this.fadeDur = opts.fade ?? d.fade ?? 0.25;
    this.cur = { name: anim, def: d, plan, t: 0, loop, speed: opts.speed ?? 1, onEnd: opts.onEnd, ended: false };
    if (d.posture) this.posture = d.posture;
    if (anim === 'jenga_pull') this.seat = 0.42;
    if (plan.once && plan.clip) { const a = this.action(plan.clip); if (a) { a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } }
    else if (plan.clip) { const a = this.action(plan.clip); if (a && (this.wClip.get(plan.clip) ?? 0) < 0.05) a.reset(); }
    this.fidget = null;
    this.updateFace();
  }

  setMove(speed: number) { this.moveTarget = Math.max(0, Number.isFinite(speed) ? speed : 0); }
  setCarry(p: CarryPose) { if (p) this.carry = p; }
  setFace(v: FaceVariant) { this.faceOverride = (v as any) ?? null; this.updateFace(); }
  lookAt(p: THREE.Vector3 | null) { if (p) { if (!this.lookTarget) this.lookTarget = new THREE.Vector3(); this.lookTarget.copy(p); } else this.lookTarget = null; }
  attach(point: AttachPoint): THREE.Object3D { return this.attachPts.get(point) ?? this.attachPts.get('hand_r')!; }
  setSilhouette(on: boolean) { this.mode = on ? 'sil' : this.mode === 'sil' ? 'normal' : this.mode; this.applyMaterials(); }
  setFirstPerson(on: boolean) { this.mode = on ? 'fp' : this.mode === 'fp' ? 'normal' : this.mode; this.applyMaterials(); }

  // extras
  setPosture(p: Posture) { if (p && p !== this.posture) { this.fadeFrom.copy(this.out); this.fadeT = 0; this.fadeDur = 0.4; this.posture = p; } }
  get anim() { return this.cur.name; }
  get lod() { return this.lodLevel; }
  get mesh_() { return this.mesh; }
  headWorld(out = new THREE.Vector3()) { this.root.updateWorldMatrix(true, false); return out.set(0, this.headHeight, 0).applyMatrix4(this.root.matrixWorld); }

  // ---------------------------------------------------------------- update

  update(dt: number) {
    if (this.disposed) return;
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
    this.tick(step);
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
      if (this.wProc > 0.002) {
        const upperW = locoOnly ? this.wProc * (1 - this.moveW) : this.wProc;
        if (this.procMask === 'full' && !standLegs) this.applyProc(this.out, 'full', upperW);
        else {
          this.applyProc(this.out, this.procMask === 'arms' ? 'arms' : 'upper', upperW);
          if (legW > 0.002) this.applyProc(this.out, 'legs', this.wProc * legW);
        }
      }
    }
    this.fk();
    // ---- idle fidgets (as a light procedural overlay on the arms/head)
    if (c.name === 'idle' && v < 0.08 && this.posture === 'stand' && cw.r + cw.l + cw.two + cw.head < 0.05 && this.mode !== 'sil') {
      if (!this.fidget) { this.fidgetWait -= dt; if (this.fidgetWait < 0) { this.fidget = { i: Math.floor(Math.random() * FIDGETS.length), t: 0, dur: 2.2 + Math.random() * 1.2 }; this.fidgetWait = 7 + Math.random() * 10; } }
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
          this.applyProc(p, 'arms', Math.sin(Math.min(1, fk) * Math.PI) * 0.95);
          this.fk();
        }
      }
    } else if (this.fidget) this.fidget = null;
    // ---- carry layer
    if (cw.r + cw.l + cw.two + cw.head > 0.01 && c.name !== 'tpose' && this.posture !== 'lie') this.applyCarry();
    // load hunch & wobble
    if (cw.load > 0.02 && this.posture === 'stand') {
      this.wobble += dt;
      this.addLocal('spine_02', cw.load * 12, 0, Math.sin(this.wobble * 3.1) * cw.load * 4);
      this.fk();
    }
    // ---- look-at
    this.applyLook(dt, c.def.look !== false && this.posture !== 'lie');
    this.fk();
    this.updateAttach();
    if (c.name === 'wake_up') this.updateFace();
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
    const want = allowed && this.lookTarget ? 1 : 0;
    this.lookW += (want - this.lookW) * (1 - Math.exp(-5 * dt));
    if (this.lookW < 0.01) { this.lookYaw *= 0.9; this.lookPitch *= 0.9; return; }
    const t = this.t;
    if (this.lookTarget) {
      this.root.updateWorldMatrix(true, false);
      const s = this.height / t.height;
      const hp = this.Fp[t.index.Head];
      _v.set(-hp.x * s, (hp.y + 0.08) * s, -hp.z * s).applyMatrix4(this.root.matrixWorld);
      _v2.copy(this.lookTarget).sub(_v);
      if (_v2.lengthSq() > 1e-6) {
        const sp = t.index.spine_03;
        this.root.getWorldQuaternion(_q);
        _q.multiply(QY_PI).multiply(_q2.copy(this.Fq[sp]).multiply(_q3.copy(t.Gq[sp]).invert()));
        _v2.applyQuaternion(_q.invert()).normalize();
        let yaw = Math.atan2(_v2.x, _v2.z) / D2R;
        let pitch = -Math.asin(Math.max(-1, Math.min(1, _v2.y))) / D2R;
        if (Math.abs(yaw) > 115) yaw = 0;
        yaw = Math.max(-75, Math.min(75, yaw)); pitch = Math.max(-40, Math.min(50, pitch));
        const kk = 1 - Math.exp(-7 * dt);
        this.lookYaw += (yaw - this.lookYaw) * kk; this.lookPitch += (pitch - this.lookPitch) * kk;
      }
    }
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

  private updateFace() {
    let f: FaceVariant = this.faceOverride ?? this.cur.def.face ?? 'neutral';
    if (!this.faceOverride && this.cur.name === 'wake_up') f = this.cur.t / this.cur.def.dur < 0.45 ? 'sleep' : 'neutral';
    if (f === this.faceCur) return;
    this.faceCur = f;
    const fe = faceEntry(this.look.face, this.look.sex === 'f' ? 'f' : 'm');
    const v: FaceVariant = fe.photo && f !== 'neutral' && !fe.photo.variants[f] ? 'neutral' : f;
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
    if (this.fpMats) for (const m of this.fpMats) m.dispose();
    this.skeleton?.dispose();
  }
}

/** Factory helper: sculpted rig when the GLB templates are loaded, procedural fallback otherwise. */
export function createRig(look: Look, opts: RigOpts = {}): Rig | ProcRig {
  return Rig.available(look) ? new Rig(look, opts) : new ProcRig(look, opts);
}
export type AnyRig = Rig | ProcRig;
