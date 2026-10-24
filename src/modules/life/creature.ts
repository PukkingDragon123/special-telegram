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

interface FurCfg { len: number; shells: number; density: number; gravity: number; minLum: number; detail: string; detailRep: number; tint?: [number, number, number] }
interface CreatureSpec {
  url: string;
  species: Species;
  /** semantic bone → regex on the sanitized node name */
  map: Record<string, RegExp>;
  tail: RegExp;      // capture (\d+) for the order
  tongue: RegExp;
  clips: { idle: string; sit?: string; shake?: string; roll?: string; dead?: string };
  fur: FurCfg;
  face: { lidU: number; lidL: number; squint: number };
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
      mouth_l: /^L_mouth_corner/, mouth_r: /^R_mouth_corner/,
      sh_l: /^L_shoulder/, el_l: /^L_elbow/, wr_l: /^L_wrist/, sh_r: /^R_shoulder/, el_r: /^R_elbow/, wr_r: /^R_wrist/,
      hip_l: /^L_hip/, kn_l: /^L_knee/, ho_l: /^L_ankle/, hip_r: /^R_hip/, kn_r: /^R_knee/, ho_r: /^R_ankle/,
    },
    tail: /^tail_(\d)_jnt/,
    tongue: /^tongue_(\d)_jnt/,
    clips: { idle: 'idle', sit: 'sit', shake: 'shake', roll: 'rollover', dead: 'playdead' },
    fur: { len: 0.011, shells: 14, density: 340, gravity: 0.55, minLum: 0.1, detail: 'fur_detail.jpg', detailRep: 9 },
    face: { lidU: 0.5, lidL: -0.25, squint: 0.35 },
    headH: 0.82,
  },
  cat: {
    url: 'gen/life/models/cat.glb',
    species: 'cat',
    map: {
      cog: /^j_body/, hips: /^j_hips/, spine: /^j_spine_2/, spine2: /^j_spine_3/, chest: /^j_spine_4/, neck: /^j_neck_base/, neck2: /^j_neck_1/, head: /^j_head/, jaw: /^j_jaw/,
      ear_l: /^j_l_ear/, ear_r: /^j_r_ear/,
      lidu_l: /^j_l_upper_eyelid/, lidl_l: /^j_l_lower_eyelid/, lidu_r: /^j_r_upper_eyelid/, lidl_r: /^j_r_lower_eyelid/,
      sh_l: /^j_l_humerous/, el_l: /^j_l_elbow/, wr_l: /^j_l_wrist/, sh_r: /^j_r_humerous/, el_r: /^j_r_elbow/, wr_r: /^j_r_wrist/,
      hip_l: /^j_l_femur/, kn_l: /^j_l_knee/, ho_l: /^j_l_ankle/, hip_r: /^j_r_femur/, kn_r: /^j_r_knee/, ho_r: /^j_r_ankle/,
    },
    tail: /^j_tail_(\d)/,
    tongue: /^j_tongue_(back|mid|tip)/,
    clips: { idle: 'idle' },
    fur: { len: 0.007, shells: 12, density: 420, gravity: 0.35, minLum: 0.0, detail: 'fur_detail_cat.jpg', detailRep: 10, tint: [0.16, 0.15, 0.15] },
    face: { lidU: 0.55, lidL: -0.3, squint: 0.0 },
    headH: 0.4,
  },
};

const QNAMES = ['hips', 'spine', 'chest', 'neck', 'head', 'jaw', 'ear_l', 'ear_r', 'tail1', 'tail2', 'tail3', 'sh_l', 'el_l', 'wr_l', 'sh_r', 'el_r', 'wr_r', 'hip_l', 'kn_l', 'ho_l', 'hip_r', 'kn_r', 'ho_r'];

const cache = new Map<string, Promise<any>>();
export function loadCreature(sp: Species): Promise<any> {
  const spec = SPECS[sp];
  let p = cache.get(spec.url);
  if (!p) { p = Assets.glb(spec.url); cache.set(spec.url, p); }
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
    if (spec.clips.sit && this.actions[spec.clips.sit]) this.clipPoses.add('sit');
    for (const k of ['shake', 'roll', 'dead'] as const) {
      const a = this.actions[spec.clips[k] ?? ''];
      if (a) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.stop(); }
    }
    // ---- fur
    this.buildFur(quality);
    this.anim = new QuadAnimator(this);
  }

  // ------------------------------------------------------------------ fur shells

  private buildFur(quality: number) {
    const body = this.body;
    if (!body) return;
    const F = this.spec.fur;
    const baseMat = (Array.isArray(body.material) ? body.material[0] : body.material) as THREE.MeshStandardMaterial;
    const detail = lifeTex(F.detail, { srgb: false, fallback: '#808080', kind: 'fabric' });
    detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
    this.furLocalLen = F.len / Math.max(1e-6, this.unit);
    // detail on the base skin too
    const patch = (m: THREE.MeshStandardMaterial, h: number, shell: boolean) => {
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uH = { value: h };
        sh.uniforms.uLen = { value: this.furLocalLen };
        sh.uniforms.uGrav = { value: new THREE.Vector3(0, -F.gravity, 0) };
        sh.uniforms.uDensity = { value: F.density };
        sh.uniforms.uDetail = { value: detail };
        sh.uniforms.uDetailRep = { value: F.detailRep };
        sh.uniforms.uMinLum = { value: F.minLum };
        sh.uniforms.uTint = { value: new THREE.Vector3(...(F.tint ?? [1, 1, 1])) };
        (m as any).userData.sh = sh;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uH; uniform float uLen; uniform vec3 uGrav;')
          .replace('#include <skinning_vertex>', `#include <skinning_vertex>
            ${shell ? 'transformed += normalize(objectNormal) * (uH * uLen) + uGrav * (uH * uH * uLen);' : ''}`);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uH; uniform float uDensity; uniform sampler2D uDetail; uniform float uDetailRep; uniform float uMinLum; uniform vec3 uTint;')
          .replace('#include <map_fragment>', `#include <map_fragment>
            #ifdef USE_MAP
              vec2 fuv = vMapUv;
            #else
              vec2 fuv = vec2(0.0);
            #endif
            float det = texture2D(uDetail, fuv * uDetailRep).r;
            float lumF = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
            ${shell ? `
              vec2 st = fuv * uDensity;
              vec2 cell = floor(st);
              float rnd = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
              vec2 f = fract(st) - 0.5;
              float rad = 0.46 * (1.0 - uH) * (0.55 + 0.45 * rnd);
              if (rnd < uH * 0.92 || length(f) > rad) discard;
              float redness = diffuseColor.r - max(diffuseColor.g, diffuseColor.b);
              if (lumF < uMinLum || redness > 0.22) discard;
            ` : ''}
            diffuseColor.rgb *= uTint * (0.78 + 0.44 * det);
            ${shell ? 'diffuseColor.rgb *= mix(0.55, 1.12, uH);' : ''}`);
      };
      m.customProgramCacheKey = () => 'life_fur_' + (shell ? 's' : 'b');
      m.needsUpdate = true;
    };
    // base: keep the model's own albedo, add detail
    const bm = baseMat.clone();
    patch(bm, 0, false);
    body.material = bm;
    const n = Math.max(0, Math.round(F.shells * quality));
    for (let i = 1; i <= n; i++) {
      const m = baseMat.clone();
      m.roughness = 1;
      m.metalness = 0;
      patch(m, i / n, true);
      const s = new THREE.SkinnedMesh(body.geometry, m);
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
  }

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
    // reset bones to rest, then let clips write
    for (let i = 0; i < this.bl.length; i++) { this.bl[i].quaternion.copy(this.restQ[i]); this.bl[i].position.copy(this.restP[i]); }
    // clip weights from pose weights + one-shot
    const W = this.anim.poseW;
    const sitW = this.clipPoses.has('sit') ? W.sit : 0;
    let osW = 0;
    if (this.oneShot) {
      this.oneShot.t += dt;
      const o = this.oneShot;
      osW = Math.min(1, o.t / 0.3, Math.max(0, (o.dur - o.t) / 0.4));
      if (o.t > o.dur || inp.speed > 0.4) { this.oneShot = null; osW = 0; }
    }
    const idle = this.actions[this.spec.clips.idle], sit = this.spec.clips.sit ? this.actions[this.spec.clips.sit] : null;
    if (idle) idle.setEffectiveWeight(Math.max(0, 1 - sitW) * (1 - osW));
    if (sit) sit.setEffectiveWeight(sitW * (1 - osW));
    for (const k of ['shake', 'roll', 'dead'] as const) {
      const n = this.spec.clips[k];
      if (n && this.actions[n]) this.actions[n].setEffectiveWeight(this.oneShot?.name === n ? osW : 0);
    }
    this.mixer.update(dt);
    // procedural layers (QuadAnimator → apply())
    this.oneShotW = osW;
    this.anim.update(dt, inp);
    // fur: LOD + motion lag
    if (this.shells.length) {
      const wp = this.root.getWorldPosition(_v);
      const d = camPos ? wp.distanceTo(camPos) : 0;
      const vis = d < 6 ? 1 : d < 14 ? 0.6 : d < 28 ? 0.3 : 0;
      const nVis = Math.round(this.shells.length * vis);
      // world velocity → creature-local lag (fur trails behind)
      this.vel.subVectors(wp, this.lastPos).divideScalar(Math.max(dt, 1e-3));
      this.lastPos.copy(wp);
      if (this.vel.lengthSq() > 100) this.vel.set(0, 0, 0);
      const inv = _qi.copy(this.model.getWorldQuaternion(_q)).invert();
      const lag = this.vel.clone().applyQuaternion(inv).multiplyScalar(-0.06);
      lag.applyQuaternion(_q2.copy(this.qArm).invert());
      for (let i = 0; i < this.shells.length; i++) {
        this.shells[i].visible = i < nVis;
        const sh = (this.shellMats[i] as any).userData.sh;
        if (sh) sh.uniforms.uGrav.value.set(lag.x, -this.spec.fur.gravity + lag.y, lag.z);
      }
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
    // ---- facial layer
    const F = this.anim.face;
    const sp = this.spec;
    const blink = F.blink;
    add(N.lidu_l, sp.face.lidU * blink, 0, 0); add(N.lidu_r, sp.face.lidU * blink, 0, 0);
    add(N.lidl_l, sp.face.lidL * blink, 0, 0); add(N.lidl_r, sp.face.lidL * blink, 0, 0);
    const happy = this.happy;
    if (happy > 0.01 && sp.face.squint) { add(N.squint_l, -sp.face.squint * happy, 0, 0); add(N.squint_r, -sp.face.squint * happy, 0, 0); add(N.lidl_l, -0.12 * happy, 0, 0); add(N.lidl_r, -0.12 * happy, 0, 0); }
    // ear twitches
    this.twitch.t -= 1 / 60;
    if (this.twitch.t < 0) { this.twitch.t = 1.5 + Math.random() * 4; this.twitch.side = Math.random() < 0.5 ? 1 : -1; this.twitch.k = 1; }
    this.twitch.k *= 0.86;
    const tw = this.twitch.k * Math.sin(this.t * 40) * 0.25;
    if (this.twitch.side > 0) add(N.ear_l, tw, 0, tw * 0.6); else add(N.ear_r, tw, 0, -tw * 0.6);
    // panting tongue (dog) / eat
    if (this.tng.length && (F.pant > 0.05 || F.eat > 0.3)) {
      const k = Math.max(F.pant, F.eat * 0.6);
      const wob = Math.sin(this.t * 9) * 0.06;
      this.tng.forEach((ti, i) => add(ti, (0.18 + i * 0.07 + wob) * k, 0, 0));
    }
    // sniffing nose
    if (F.sniff > 0.05) {
      const s = Math.sin(this.t * 26) * 0.08 * F.sniff;
      add(N.nose, s, 0, 0); add(N.nostril_l, 0, 0, s * 2); add(N.nostril_r, 0, 0, -s * 2);
    }
    if (happy > 0.05) { add(N.mouth_l, 0, -0.15 * happy, 0); add(N.mouth_r, 0, 0.15 * happy, 0); }

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
    for (const m of this.shellMats) m.dispose();
    this.model.traverse((o: any) => { if (o.isMesh && o.material && !Array.isArray(o.material)) o.material.dispose?.(); });
  }
}
