import * as THREE from 'three';
import type { AnimName, AttachPoint, CarryPose, CharacterRig, FaceVariant, Look } from '../../game/contracts';
import { B, NB, PARENT, REF_H, RestSkel, restSkel, restDir } from './skel';
import { buildBody, bodySpec, shapeKey, BodySpec, Lod, headScale, HEAD_TOP } from './body';
import { buildHairAndHead, hairThickAt } from './hair';
import { Pose, PoseBuilder, blendPose, getQ, ARM_L, ARM_R, sm } from './pose';
import { ANIMS, AnimCtx, AnimDef, FIDGETS, Posture } from './anims';
import { paintAtlas, repaintFace, lookKey, accessoryPalette } from './atlas';
import { faceEntry } from './defs';

/* ============================================================================================
 * CharacterRig implementation: one SkinnedMesh (atlas material + shared accessory palette
 * material), a 19-bone skeleton, procedural animation with cross-fades, carry & look-at layers,
 * distance LOD (low mesh, throttled / frozen updates, shadows only near the camera).
 * ========================================================================================== */

/** Per-frame context shared by all rigs (set by the module's frame()). */
export const RigWorld = {
  cam: new THREE.Vector3(0, 1.6, 0),
  frame: 0,
  shadowDist: 24,
  lodDist: 26,
  /** ms of atlas painting allowed per frame */
  budgetMs: 9,
  rigs: new Set<any>(),
};

// ------------------------------------------------------------------ shared caches

const geoCache = new Map<string, { geo: THREE.BufferGeometry; refs: number }>();
function acquireGeo(spec: BodySpec, lod: Lod): { key: string; geo: THREE.BufferGeometry } {
  const key = shapeKey(spec, lod);
  let e = geoCache.get(key);
  if (!e) {
    const { geo, skel } = buildBody(spec, lod);
    buildHairAndHead(geo, skel, spec, lod);
    const g = geo.build();
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.45);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(-1.2, -0.3, -1.2), new THREE.Vector3(1.2, 2.2, 1.2));
    e = { geo: g, refs: 0 };
    geoCache.set(key, e);
  }
  e.refs++;
  return { key, geo: e.geo };
}
function releaseGeo(key: string) {
  const e = geoCache.get(key);
  if (!e) return;
  if (--e.refs <= 0) { e.geo.dispose(); geoCache.delete(key); }
}

interface AtlasEntry { tex: THREE.CanvasTexture; cv: HTMLCanvasElement; refs: number; painted: boolean; look: Look; variant: FaceVariant; size: number; at?: THREE.Object3D }
const atlasCache = new Map<string, AtlasEntry>();
const queue: AtlasEntry[] = [];
const PLACEHOLDER = (() => { const c = document.createElement('canvas'); c.width = c.height = 4; return c; })();

function atlasKey(look: Look, size: number, v: FaceVariant) { return lookKey(look) + '|' + size + '|' + v; }

function acquireAtlas(look: Look, size: number, v: FaceVariant, sync = false, at?: THREE.Object3D): { key: string; e: AtlasEntry } {
  const key = atlasKey(look, size, v);
  let e = atlasCache.get(key);
  if (!e) {
    const ph = document.createElement('canvas');
    ph.width = ph.height = 4;
    const g = ph.getContext('2d')!;
    g.fillStyle = look.skin || '#c69472'; g.fillRect(0, 0, 4, 4);
    const tex = new THREE.CanvasTexture(ph);
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    e = { tex, cv: ph, refs: 0, painted: false, look: JSON.parse(JSON.stringify(look)), variant: v, size };
    atlasCache.set(key, e);
    if (sync) paintEntry(e); else queue.push(e);
  }
  if (at && !e.at) e.at = at;
  e.refs++;
  return { key, e };
}
function releaseAtlas(key: string) {
  const e = atlasCache.get(key);
  if (!e) return;
  if (--e.refs <= 0) {
    e.tex.dispose();
    atlasCache.delete(key);
    const qi = queue.indexOf(e);
    if (qi >= 0) queue.splice(qi, 1);
  }
}

function paintEntry(e: AtlasEntry) {
  if (e.painted) return;
  const onFace = () => { if (!atlasCache.has(atlasKey(e.look, e.size, e.variant))) return; repaintFace(e.cv, e.look, e.variant); e.tex.needsUpdate = true; };
  // variants reuse the neutral atlas when it is already painted
  const base = e.variant !== 'neutral' ? atlasCache.get(atlasKey(e.look, e.size, 'neutral')) : null;
  let cv: HTMLCanvasElement;
  if (base?.painted) {
    cv = document.createElement('canvas');
    cv.width = cv.height = e.size;
    cv.getContext('2d', { willReadFrequently: true })!.drawImage(base.cv, 0, 0);
    repaintFace(cv, e.look, e.variant, onFace);
  } else cv = paintAtlas(e.look, e.size, e.variant, onFace);
  e.cv = cv;
  // the GPU texture was allocated at the placeholder size (immutable storage) → re-create it
  e.tex.dispose();
  e.tex.image = cv;
  e.tex.needsUpdate = true;
  e.painted = true;
}

/** Paint queued atlases within the per-frame budget (call every frame). */
const _qp = new THREE.Vector3();
export function processAtlasQueue() {
  if (!queue.length) return;
  const t0 = performance.now();
  while (queue.length && performance.now() - t0 < RigWorld.budgetMs) {
    // nearest character first
    let bi = 0, bd = Infinity;
    for (let i = 0; i < queue.length; i++) {
      const o = queue[i].at;
      const d = o ? o.getWorldPosition(_qp).distanceToSquared(RigWorld.cam) : 1e6 + i;
      if (d < bd) { bd = d; bi = i; }
    }
    const e = queue.splice(bi, 1)[0];
    try { paintEntry(e); } catch (err) { console.error('[characters] atlas paint failed', err); e.painted = true; }
  }
}
export function atlasQueueLength() { return queue.length; }
void PLACEHOLDER;

let accMat: THREE.MeshStandardMaterial | null = null;
function accessoryMaterial() {
  if (accMat) return accMat;
  const pal = accessoryPalette();
  accMat = new THREE.MeshStandardMaterial({ map: pal.map, roughnessMap: pal.orm, metalnessMap: pal.orm, roughness: 1, metalness: 1, vertexColors: true, envMapIntensity: 1.2 });
  accMat.name = 'char-acc';
  return accMat;
}
const silMat = new THREE.MeshBasicMaterial({ color: 0x050403 });
silMat.name = 'char-silhouette';
const proxyGeo = new THREE.BoxGeometry(1, 1, 1);
const proxyMat = new THREE.MeshBasicMaterial({ visible: false });

// ------------------------------------------------------------------ temps

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
export { acquireAtlas, releaseAtlas, accessoryMaterial, silMat, proxyGeo, proxyMat, ATTACH, FOLLOW, estimateAge, QY_PI };
const QY_PI = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

const ATTACH: AttachPoint[] = ['hand_r', 'hand_l', 'arm_r', 'arm_l', 'head', 'back', 'mouth', 'chest', 'hip'];
const FOLLOW: Record<AttachPoint, number> = { hand_r: 0.25, hand_l: 0.25, arm_r: 0.5, arm_l: 0.5, head: 0.65, back: 0.85, mouth: 1, chest: 0.6, hip: 0.6 };

export interface RigOpts { lod?: 'high' | 'low'; castShadow?: boolean }

let rigSeq = 0;

/** Fallback: fully procedural low-poly body (used if the sculpted GLB assets fail to load). */
export class ProcRig implements CharacterRig {
  readonly root = new THREE.Group();
  private inner = new THREE.Group();
  look: Look;
  height = 1.7;
  private opts: RigOpts;
  private spec!: BodySpec;
  private sk!: RestSkel;
  private bones: THREE.Bone[] = [];
  private skeleton!: THREE.Skeleton;
  private meshHi: THREE.SkinnedMesh | null = null;
  private meshLo: THREE.SkinnedMesh | null = null;
  private geoKeyHi = '';
  private geoKeyLo = '';
  private mat: THREE.MeshStandardMaterial;
  private fpMats: THREE.Material[] | null = null;
  private atlasKey = '';
  private atlasSize = 512;
  private attachPts = new Map<AttachPoint, THREE.Object3D>();
  private proxy: THREE.Mesh;
  private pb!: PoseBuilder;
  private target = new Pose();
  private out = new Pose();
  private fadeFrom = new Pose();
  private fadeT = 1;
  private fadeDur = 0.25;
  private cur: { name: AnimName; def: AnimDef; t: number; loop: boolean; speed: number; onEnd?: () => void; ended: boolean } ;
  private resume: AnimName = 'idle';
  posture: Posture = 'stand';
  /** seat height for 'sit' (m) */
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
  private stagger = rigSeq++ % 8;
  private accDt = 0;
  private mode: 'normal' | 'sil' | 'fp' = 'normal';
  private lodLevel: 'high' | 'low' = 'high';
  private fidget: { i: number; t: number; dur: number } | null = null;
  private fidgetWait = 4 + Math.random() * 8;
  private disposed = false;
  private age = 0;
  // FK (model space)
  private Wq: THREE.Quaternion[] = Array.from({ length: NB }, () => new THREE.Quaternion());
  private Wp: THREE.Vector3[] = Array.from({ length: NB }, () => new THREE.Vector3());
  private headTop = 0.24;
  /** head top height above the feet in root space (updated every tick) */
  headHeight = 1.7;
  private wobble = 0;
  private dist = 0;

  constructor(look: Look, opts: RigOpts = {}) {
    this.opts = opts;
    this.look = look;
    this.root.name = 'character';
    this.inner.name = 'character-inner';
    this.inner.rotation.y = Math.PI;
    this.root.add(this.inner);
    this.mat = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, envMapIntensity: 0.85 });
    this.mat.name = 'char-atlas';
    for (const p of ATTACH) { const o = new THREE.Group(); o.name = 'attach_' + p; this.root.add(o); this.attachPts.set(p, o); }
    this.proxy = new THREE.Mesh(proxyGeo, proxyMat);
    this.proxy.name = 'character-proxy';
    this.root.add(this.proxy);
    this.cur = { name: 'idle', def: ANIMS.idle, t: 0, loop: true, speed: 1, ended: false };
    this.build(look);
    RigWorld.rigs.add(this);
  }

  // ---------------------------------------------------------------- build

  private build(look: Look) {
    const spec = bodySpec(look);
    const sameBody = this.spec && this.spec.sex === spec.sex && this.spec.build === spec.build;
    this.spec = spec;
    this.height = Math.max(1.2, Math.min(2.1, look.height || 1.7));
    const s = this.height / REF_H;
    this.inner.scale.setScalar(s);
    this.age = estimateAge(look);
    if (!sameBody) {
      // skeleton
      for (const b of this.bones) b.removeFromParent();
      this.sk = restSkel(spec.sex, spec.build);
      const J = this.sk.J;
      this.bones = J.map((j, i) => { const b = new THREE.Bone(); b.name = 'b_' + i; const p = PARENT[i]; if (p < 0) b.position.set(j[0], j[1], j[2]); else b.position.set(j[0] - J[p][0], j[1] - J[p][1], j[2] - J[p][2]); return b; });
      this.bones.forEach((b, i) => { const p = PARENT[i]; if (p >= 0) this.bones[p].add(b); });
      this.inner.add(this.bones[0]);
      const inv = J.map((j) => new THREE.Matrix4().makeTranslation(-j[0], -j[1], -j[2]));
      this.skeleton = new THREE.Skeleton(this.bones, inv);
      this.pb = new PoseBuilder(this.sk);
    }
    // meshes
    const lod: Lod = this.opts.lod === 'low' ? 'low' : 'high';
    const hi = acquireGeo(spec, lod);
    if (this.geoKeyHi) releaseGeo(this.geoKeyHi);
    this.geoKeyHi = hi.key;
    this.meshHi?.removeFromParent();
    this.meshHi = this.makeMesh(hi.geo);
    if (this.meshLo) { this.meshLo.removeFromParent(); this.meshLo = null; releaseGeo(this.geoKeyLo); this.geoKeyLo = ''; }
    // atlas
    this.atlasSize = this.opts.lod === 'high' ? 1024 : this.opts.lod === 'low' ? 256 : 512;
    this.setAtlas(this.faceCur);
    // head-top offset for the 'head' attach point
    const hs = headScale(spec.sex, spec.build);
    const hat = spec.acc.find((a) => a.slot === 'hat');
    this.headTop = HEAD_TOP * hs + hairThickAt(spec.hair, 0, HEAD_TOP - 0.01) * (hat ? 0.3 : 1) + (hat ? (hat.kind === 'straw' ? 0.08 : hat.kind === 'helmet' ? 0.04 : 0.025) : 0);
    this.applyMaterials();
    this.tick(0);
  }

  private makeMesh(geo: THREE.BufferGeometry) {
    const m = new THREE.SkinnedMesh(geo, [this.mat, accessoryMaterial()]);
    m.name = 'character-mesh';
    m.bind(this.skeleton, new THREE.Matrix4());
    m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.45);
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
    if (this.fpMats) for (const m of this.fpMats) if ((m as any).isMeshStandardMaterial && m.name === 'char-atlas-fp') { (m as THREE.MeshStandardMaterial).map = e.tex; }
    if (prev) releaseAtlas(prev);
  }

  private applyMaterials() {
    const ms = [this.meshHi, this.meshLo].filter(Boolean) as THREE.SkinnedMesh[];
    let mats: THREE.Material | THREE.Material[];
    if (this.mode === 'sil') mats = [silMat, silMat];
    else if (this.mode === 'fp') {
      if (!this.fpMats) {
        const a = this.mat.clone(); a.name = 'char-atlas-fp'; a.colorWrite = false; a.depthWrite = false;
        const b = accessoryMaterial().clone(); b.colorWrite = false; b.depthWrite = false;
        this.fpMats = [a, b];
      }
      mats = this.fpMats;
    } else mats = [this.mat, accessoryMaterial()];
    for (const m of ms) m.material = mats;
  }

  // ---------------------------------------------------------------- contract API

  setLook(look: Look) {
    const prevKey = lookKey(this.look);
    this.look = look;
    if (lookKey(look) === prevKey && Math.abs((look.height || 1.7) - this.height) < 1e-4) return;
    this.build(look);
  }

  play(anim: AnimName, opts: { loop?: boolean; speed?: number; fade?: number; onEnd?: () => void } = {}) {
    const d = ANIMS[anim];
    if (!d) { console.warn('[characters] unknown anim', anim); return; }
    const loop = opts.loop ?? d.loop;
    if (this.cur.name === anim && loop && this.cur.loop && !this.cur.ended) { this.cur.speed = opts.speed ?? 1; this.cur.onEnd = opts.onEnd; return; }
    if (this.cur.loop && !this.cur.ended && !loop) this.resume = this.cur.name;
    if (loop) this.resume = anim;
    this.fadeFrom.copy(this.out);
    this.fadeT = 0;
    this.fadeDur = opts.fade ?? d.fade ?? 0.25;
    this.cur = { name: anim, def: d, t: 0, loop, speed: opts.speed ?? 1, onEnd: opts.onEnd, ended: false };
    if (d.posture) this.posture = d.posture;
    if (anim === 'jenga_pull') this.seat = 0.42;
    this.fidget = null;
    this.updateFace();
  }

  setMove(speed: number) { this.moveTarget = Math.max(0, Number.isFinite(speed) ? speed : 0); }
  setCarry(p: CarryPose) { this.carry = p ?? this.carry; }
  setFace(v: FaceVariant) { this.faceOverride = (v as any) ?? null; this.updateFace(); }
  lookAt(p: THREE.Vector3 | null) { if (p) { if (!this.lookTarget) this.lookTarget = new THREE.Vector3(); this.lookTarget.copy(p); } else this.lookTarget = null; }
  attach(point: AttachPoint): THREE.Object3D { return this.attachPts.get(point) ?? this.attachPts.get('hand_r')!; }
  setSilhouette(on: boolean) { this.mode = on ? 'sil' : this.mode === 'sil' ? 'normal' : this.mode; this.applyMaterials(); }
  setFirstPerson(on: boolean) { this.mode = on ? 'fp' : this.mode === 'fp' ? 'normal' : this.mode; this.applyMaterials(); }

  // ---------------------------------------------------------------- extras (not in the contract)

  /** 'stand' | 'sit' | 'floor' | 'lie' — upper-body anims keep the current posture */
  setPosture(p: Posture) { if (p && p !== this.posture) { this.fadeFrom.copy(this.out); this.fadeT = 0; this.fadeDur = 0.4; this.posture = p; } }
  get anim() { return this.cur.name; }
  get lod() { return this.lodLevel; }
  /** world position of the top of the head */
  headWorld(out = new THREE.Vector3()) { this.root.updateWorldMatrix(true, false); return out.set(0, this.headHeight, 0).applyMatrix4(this.root.matrixWorld); }
  get mesh() { return this.meshHi; }

  // ---------------------------------------------------------------- update

  update(dt: number) {
    if (this.disposed) return;
    this.root.getWorldPosition(_v);
    const d = (this.dist = _v.distanceTo(RigWorld.cam));
    // LOD
    const wantLow = this.opts.lod === 'low' || (this.opts.lod !== 'high' && d > RigWorld.lodDist);
    this.setLod(wantLow ? 'low' : 'high');
    const shadow = this.opts.castShadow !== false && d < RigWorld.shadowDist && this.mode !== 'sil';
    if (this.meshHi) this.meshHi.castShadow = shadow;
    if (this.meshLo) this.meshLo.castShadow = shadow;
    // throttle
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
    if (l === 'low' && !this.meshLo && this.opts.lod !== 'high') {
      if (this.opts.lod === 'low') { this.meshLo = this.meshHi; }
      else {
        const lo = acquireGeo(this.spec, 'low');
        this.geoKeyLo = lo.key;
        this.meshLo = this.makeMesh(lo.geo);
        this.applyMaterials();
      }
    }
    if (this.meshHi && this.meshLo && this.meshHi !== this.meshLo) { this.meshHi.visible = l === 'high'; this.meshLo.visible = l === 'low'; }
  }

  private tick(dt: number) {
    const c = this.cur;
    this.gt += dt;
    // ---- locomotion state
    let sp = this.moveTarget;
    if (c.name === 'walk' && sp < 0.3) sp = 1.3;
    if (c.name === 'run' && sp < 0.3) sp = 4.6;
    this.speed += (sp - this.speed) * (1 - Math.exp(-8 * dt));
    const v = this.speed;
    const movingAnim = c.def.loco || c.def.movable;
    // standing up automatically when walking off a seat
    if (v > 0.45 && this.posture !== 'stand' && (c.def.loco || !c.loop || c.name === 'idle' || isUpper(c.def))) this.posture = 'stand';
    // a stationary loop gets overridden by locomotion when the character moves
    if (v > 0.6 && !movingAnim && c.loop && c.def.posture !== undefined && c.name !== 'tpose' && !c.def.loco && this.posture === 'stand' && c.def.posture === 'stand') {
      // dance / celebrate / tug while moving: let locomotion take over
      this.play('idle', { fade: 0.3 });
    }
    this.moveW += (sm(0.06, 0.7, v) - this.moveW) * (1 - Math.exp(-10 * dt));
    this.runW += (sm(3.3, 4.7, v) - this.runW) * (1 - Math.exp(-6 * dt));
    const cadence = (1 - this.runW) * (1.0 + 0.75 * Math.min(v, 3.4)) + this.runW * (2.6 + 0.12 * v);
    this.phase = (this.phase + (cadence / 2) * dt * (v > 0.05 ? 1 : 0)) % 1;
    // ---- anim time
    c.t += dt * c.speed;
    let k = c.def.dur > 0 ? c.t / c.def.dur : 0;
    if (!c.loop) {
      if (k >= 1 && !c.ended) {
        c.ended = true;
        const cb = c.onEnd; c.onEnd = undefined;
        try { cb?.(); } catch (e) { console.error(e); }
        if (!c.def.hold && this.cur === c) {
          const back = this.resume && ANIMS[this.resume] && ANIMS[this.resume].loop ? this.resume : 'idle';
          this.play(back, { fade: 0.35 });
          return this.tick(0);
        }
      }
      k = Math.min(1, k);
    } else k = k % 1;
    // ---- carry smoothing
    const cw = this.carryW, cp = this.carry;
    const ck = 1 - Math.exp(-10 * dt);
    cw.r += ((cp.r ? 1 : 0) - cw.r) * ck; cw.l += ((cp.l ? 1 : 0) - cw.l) * ck; cw.two += ((cp.two ? 1 : 0) - cw.two) * ck;
    cw.head += ((cp.head ? 1 : 0) - cw.head) * ck; cw.load += ((cp.load ?? 0) - cw.load) * ck;
    // ---- evaluate
    const pb = this.pb;
    pb.p = this.target;
    pb.reset();
    const ctx: AnimCtx = {
      pb, t: c.t, k, dt, speed: v, phase: this.phase, moveW: this.moveW, runW: this.runW,
      build: this.spec.build, female: this.spec.sex === 'f', age: this.age, s: this.height / REF_H, rnd: this.rnd,
      carry: this.carry, posture: this.posture, seat: this.seat, gt: this.gt, wob: this.wobble,
    };
    try { c.def.pose(ctx); } catch (e) { console.error('[characters] anim', c.name, e); }
    // ---- idle fidgets
    if (c.name === 'idle' && v < 0.08 && this.posture === 'stand' && cw.r + cw.l + cw.two + cw.head < 0.05 && this.mode !== 'sil') {
      if (!this.fidget) { this.fidgetWait -= dt; if (this.fidgetWait < 0) { this.fidget = { i: Math.floor(Math.random() * FIDGETS.length), t: 0, dur: 2.2 + Math.random() * 1.2 }; this.fidgetWait = 6 + Math.random() * 10; } }
      if (this.fidget) {
        const f = this.fidget;
        f.t += dt;
        const fk = f.t / f.dur;
        if (fk >= 1) this.fidget = null;
        else FIDGETS[f.i](ctx, 1, fk);
      }
    } else if (this.fidget) this.fidget = null;
    // ---- carry layer
    if (c.def.carry !== false && (c.def.carry || c.def.loco || isUpper(c.def))) this.applyCarry(ctx);
    // load hunch & wobble
    if (cw.load > 0.02 && this.posture === 'stand') {
      this.wobble += dt;
      pb.add(B.spine, cw.load * 14, 0, Math.sin(this.wobble * 3.1) * cw.load * 4);
      pb.add(B.chest, cw.load * 6, 0, 0);
    }
    // ---- look-at layer
    this.applyLook(dt, c.def.look !== false && this.posture !== 'lie');
    // ---- cross-fade
    if (this.fadeT < 1) {
      this.fadeT = Math.min(1, this.fadeT + dt / Math.max(0.001, this.fadeDur));
      const w = this.fadeT * this.fadeT * (3 - 2 * this.fadeT);
      blendPose(this.out, this.fadeFrom, this.target, w);
    } else this.out.copy(this.target);
    // ---- apply
    const q = this.out.q;
    for (let i = 0; i < NB; i++) this.bones[i].quaternion.set(q[i * 4], q[i * 4 + 1], q[i * 4 + 2], q[i * 4 + 3]);
    const J = this.sk.J;
    this.bones[0].position.set(J[0][0] + this.out.hp[0], J[0][1] + this.out.hp[1], J[0][2] + this.out.hp[2]);
    // ---- FK → attach points, proxy, head height
    this.fk();
    this.updateAttach();
    // face for wake_up
    if (c.name === 'wake_up') this.updateFace();
  }

  private applyCarry(c: AnimCtx) {
    const pb = c.pb, w = this.carryW;
    const tmp = new Pose();
    if (w.two > 0.01) {
      tmp.copy(pb.p);
      pb.arm(1, 52, -14, 60, 72, 10); pb.arm(-1, 52, -14, 60, 72, 10);
      pb.add(B.spine, -4, 0, 0);
      blendPose(pb.p, tmp, pb.p, w.two, [...ARM_L, ...ARM_R, B.spine]);
    } else {
      if (w.r > 0.01) { tmp.copy(pb.p); pb.arm(-1, 26 + Math.sin(c.phase * Math.PI * 2) * 4 * c.moveW, 6, 60, 78, -8); blendPose(pb.p, tmp, pb.p, w.r, ARM_R); }
      if (w.l > 0.01 && w.head < 0.5) { tmp.copy(pb.p); pb.arm(1, 26 + Math.sin(c.phase * Math.PI * 2 + Math.PI) * 4 * c.moveW, 6, 60, 78, -8); blendPose(pb.p, tmp, pb.p, w.l, ARM_L); }
    }
    if (w.head > 0.01) {
      tmp.copy(pb.p);
      pb.arm(1, 158, 28, 40, 58, -20);
      blendPose(pb.p, tmp, pb.p, w.head, ARM_L);
    }
  }

  private applyLook(dt: number, allowed: boolean) {
    const want = allowed && this.lookTarget ? 1 : 0;
    this.lookW += (want - this.lookW) * (1 - Math.exp(-5 * dt));
    if (this.lookW < 0.01) { this.lookYaw *= 0.9; this.lookPitch *= 0.9; return; }
    if (this.lookTarget) {
      // head position (root space → world) and chest orientation from last FK
      this.root.updateWorldMatrix(true, false);
      const s = this.height / REF_H;
      const hp = this.Wp[B.head];
      _v.set(-hp.x * s, (hp.y + 0.1) * s, -hp.z * s).applyMatrix4(this.root.matrixWorld);
      _v2.copy(this.lookTarget).sub(_v);
      if (_v2.lengthSq() > 1e-6) {
        this.root.getWorldQuaternion(_q);
        _q.multiply(QY_PI).multiply(this.Wq[B.chest]);
        _v2.applyQuaternion(_q.invert()).normalize();
        let yaw = Math.atan2(_v2.x, _v2.z) * (180 / Math.PI);
        let pitch = -Math.asin(Math.max(-1, Math.min(1, _v2.y))) * (180 / Math.PI);
        if (Math.abs(yaw) > 115) yaw = 0; // behind: don't break the neck
        yaw = Math.max(-75, Math.min(75, yaw)); pitch = Math.max(-40, Math.min(50, pitch));
        const kk = 1 - Math.exp(-7 * dt);
        this.lookYaw += (yaw - this.lookYaw) * kk; this.lookPitch += (pitch - this.lookPitch) * kk;
      }
    }
    const w = this.lookW;
    this.pb.add(B.neck, this.lookPitch * 0.35 * w, this.lookYaw * 0.4 * w, 0);
    this.pb.add(B.head, this.lookPitch * 0.6 * w, this.lookYaw * 0.6 * w, 0);
  }

  private fk() {
    const J = this.sk.J, q = this.out.q;
    for (let i = 0; i < NB; i++) {
      _q.set(q[i * 4], q[i * 4 + 1], q[i * 4 + 2], q[i * 4 + 3]);
      const p = PARENT[i];
      if (p < 0) { this.Wq[i].copy(_q); this.Wp[i].set(J[0][0] + this.out.hp[0], J[0][1] + this.out.hp[1], J[0][2] + this.out.hp[2]); }
      else {
        this.Wq[i].copy(this.Wq[p]).multiply(_q);
        _v.set(J[i][0] - J[p][0], J[i][1] - J[p][1], J[i][2] - J[p][2]).applyQuaternion(this.Wq[p]);
        this.Wp[i].copy(this.Wp[p]).add(_v);
      }
    }
  }

  /** model-space point at a bone-local offset (rest frame) */
  private boneOff(b: number, x: number, y: number, z: number, out: THREE.Vector3) { return out.set(x, y, z).applyQuaternion(this.Wq[b]).add(this.Wp[b]); }

  private updateAttach() {
    const s = this.height / REF_H;
    const toRoot = (p: THREE.Vector3) => p.set(-p.x * s, p.y * s, -p.z * s);
    const sk = this.sk;
    const hs = headScale(this.spec.sex, this.spec.build);
    const set = (pt: AttachPoint, bone: number, off: THREE.Vector3) => {
      const o = this.attachPts.get(pt)!;
      this.boneOff(bone, off.x, off.y, off.z, _v3);
      o.position.copy(toRoot(_v3));
      _q2.copy(QY_PI).multiply(this.Wq[bone]);
      _q3.copy(QY_PI).slerp(_q2, FOLLOW[pt]);
      o.quaternion.copy(_q3);
      o.scale.setScalar(1);
    };
    for (const side of [1, -1]) {
      const L = side > 0;
      const fd = restDir(sk, L ? B.forearm_l : B.forearm_r);
      set(L ? 'hand_l' : 'hand_r', L ? B.hand_l : B.hand_r, _v.set(fd[0] * 0.075 - side * 0.035, fd[1] * 0.075, fd[2] * 0.075 + 0.012));
      const ud = restDir(sk, L ? B.upperarm_l : B.upperarm_r);
      set(L ? 'arm_l' : 'arm_r', L ? B.upperarm_l : B.upperarm_r, _v.set(ud[0] * 0.14 - side * 0.05, ud[1] * 0.14, ud[2] * 0.14 + 0.03));
    }
    set('head', B.head, _v.set(0, this.headTop + 0.005, -0.008));
    set('mouth', B.head, _v.set(0, 0.045 * hs, 0.11 * hs));
    const chestOff = 0.14 + this.spec.build * 0.06;
    set('back', B.chest, _v.set(0, 0.12, -(0.12 + this.spec.build * 0.04)));
    set('chest', B.chest, _v.set(0, -0.08, chestOff + 0.12));
    set('hip', B.hips, _v.set(-(0.17 + this.spec.build * 0.04), -0.05, 0.02));
    // proxy box & head height
    let minX = 1e9, minY = 1e9, minZ = 1e9, maxX = -1e9, maxY = -1e9, maxZ = -1e9;
    const pts = [B.head, B.hips, B.foot_l, B.foot_r, B.hand_l, B.hand_r, B.chest, B.shin_l, B.shin_r];
    for (const b of pts) {
      _v.copy(this.Wp[b]);
      toRoot(_v);
      minX = Math.min(minX, _v.x); maxX = Math.max(maxX, _v.x); minY = Math.min(minY, _v.y); maxY = Math.max(maxY, _v.y); minZ = Math.min(minZ, _v.z); maxZ = Math.max(maxZ, _v.z);
    }
    this.boneOff(B.head, 0, this.headTop, 0, _v); toRoot(_v);
    maxY = Math.max(maxY, _v.y);
    this.headHeight = _v.y;
    const m = 0.13;
    this.proxy.position.set((minX + maxX) / 2, (Math.max(0, minY - 0.08) + maxY) / 2, (minZ + maxZ) / 2);
    this.proxy.scale.set(maxX - minX + m * 2, maxY - Math.max(0, minY - 0.08) + 0.04, maxZ - minZ + m * 2);
  }

  private updateFace() {
    let f: FaceVariant = this.faceOverride ?? this.cur.def.face ?? 'neutral';
    if (!this.faceOverride && this.cur.name === 'wake_up') f = this.cur.t / this.cur.def.dur < 0.45 ? 'sleep' : 'neutral';
    if (!this.faceOverride && this.posture === 'lie' && (this.cur.name === 'idle')) f = 'sleep';
    if (f === this.faceCur) return;
    this.faceCur = f;
    // fall back to neutral when a photo face lacks this variant
    const fe = faceEntry(this.look.face, this.look.sex === 'f' ? 'f' : 'm');
    const v: FaceVariant = fe.photo && f !== 'neutral' && !fe.photo.variants[f] ? 'neutral' : f;
    this.setAtlas(v);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    RigWorld.rigs.delete(this);
    this.root.removeFromParent();
    if (this.geoKeyHi) releaseGeo(this.geoKeyHi);
    if (this.geoKeyLo) releaseGeo(this.geoKeyLo);
    if (this.atlasKey) releaseAtlas(this.atlasKey);
    this.mat.dispose();
    if (this.fpMats) for (const m of this.fpMats) m.dispose();
    this.skeleton?.dispose();
  }
}

function isUpper(d: AnimDef) { return !d.posture && !d.loco; }

function estimateAge(look: Look): number {
  const arch = (look as any).arch as string | undefined;
  if (arch && /old|grandpa|cart_owner/.test(arch)) return 1;
  const hc = look.hair?.color ?? '#141110';
  const n = parseInt(hc.replace('#', ''), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const l = (r + g + b) / 3, sat = Math.max(r, g, b) - Math.min(r, g, b);
  if (l > 120 && sat < 30) return 0.7;
  if (look.hair?.style === 'salt_pepper') return 0.6;
  return 0;
}

export { _m };
