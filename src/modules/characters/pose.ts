import * as THREE from 'three';
import { B, NB, RestSkel, restDir } from './skel';

/* ============================================================================================
 * Pose = local bone rotations (relative to the identity rest pose) + hips offset.
 * PoseBuilder: authoring helpers in degrees, model frame (+Y up, +Z forward, +X = left):
 *   arm(side, elev, azim, twist, elbow, wristPitch, wristRoll)
 *     elev: 0 = hanging down, 90 = horizontal, 180 = straight up
 *     azim: 0 = forward, 90 = out to the side, -90 = across the body, 180 = backwards
 *   leg(side, elev, azim, knee, foot)  (foot > 0 = toes down)
 *   spine/chest/neck/head(pitch, yaw, roll): pitch + = bend forward / nod down,
 *     yaw + = turn to the character's left, roll + = tilt to the character's right
 *   side: +1 = LEFT limb, -1 = RIGHT limb
 * ========================================================================================== */

export class Pose {
  q = new Float32Array(NB * 4);
  hp = new Float32Array(3);
  constructor() { this.identity(); }
  identity() { for (let i = 0; i < NB; i++) { this.q[i * 4] = 0; this.q[i * 4 + 1] = 0; this.q[i * 4 + 2] = 0; this.q[i * 4 + 3] = 1; } this.hp[0] = this.hp[1] = this.hp[2] = 0; return this; }
  copy(o: Pose) { this.q.set(o.q); this.hp.set(o.hp); return this; }
}

const D = Math.PI / 180;
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qc = new THREE.Quaternion();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

export function getQ(p: Pose, b: number, out: THREE.Quaternion) { const i = b * 4; return out.set(p.q[i], p.q[i + 1], p.q[i + 2], p.q[i + 3]); }
export function setQ(p: Pose, b: number, q: THREE.Quaternion) { const i = b * 4; p.q[i] = q.x; p.q[i + 1] = q.y; p.q[i + 2] = q.z; p.q[i + 3] = q.w; }

/** out = slerp(a, b, t) per bone, lerp hips */
export function blendPose(out: Pose, a: Pose, b: Pose, t: number, bones?: readonly number[]) {
  const list = bones ?? ALL;
  for (const bi of list) {
    getQ(a, bi, _qa); getQ(b, bi, _qb);
    _qa.slerp(_qb, t);
    setQ(out, bi, _qa);
  }
  if (!bones || bones.includes(B.hips)) for (let k = 0; k < 3; k++) out.hp[k] = a.hp[k] + (b.hp[k] - a.hp[k]) * t;
}
export const ALL = Array.from({ length: NB }, (_, i) => i);
export const UPPER = [B.spine, B.chest, B.neck, B.head, B.clav_l, B.upperarm_l, B.forearm_l, B.hand_l, B.clav_r, B.upperarm_r, B.forearm_r, B.hand_r];
export const ARM_L = [B.clav_l, B.upperarm_l, B.forearm_l, B.hand_l];
export const ARM_R = [B.clav_r, B.upperarm_r, B.forearm_r, B.hand_r];
export const LEGS = [B.hips, B.thigh_l, B.shin_l, B.foot_l, B.thigh_r, B.shin_r, B.foot_r];

interface LimbInfo { rest: THREE.Vector3; hinge: THREE.Vector3; restLow: THREE.Vector3; hingeLow: THREE.Vector3 }

export class PoseBuilder {
  p: Pose = new Pose();
  private arms: Record<number, LimbInfo> = {};
  private legs: Record<number, LimbInfo> = {};
  constructor(public sk: RestSkel) {
    for (const side of [1, -1]) {
      const L = side > 0;
      const ua = restDir(sk, L ? B.upperarm_l : B.upperarm_r), fa = restDir(sk, L ? B.forearm_l : B.forearm_r);
      const rest = new THREE.Vector3(...ua), restLow = new THREE.Vector3(...fa);
      this.arms[side] = { rest, restLow, hinge: new THREE.Vector3().crossVectors(rest, new THREE.Vector3(0, 0, 1)).normalize(), hingeLow: new THREE.Vector3().crossVectors(restLow, new THREE.Vector3(0, 0, 1)).normalize() };
      const th = restDir(sk, L ? B.thigh_l : B.thigh_r), sh = restDir(sk, L ? B.shin_l : B.shin_r);
      const lrest = new THREE.Vector3(...th), lrestLow = new THREE.Vector3(...sh);
      this.legs[side] = { rest: lrest, restLow: lrestLow, hinge: new THREE.Vector3().crossVectors(lrest, new THREE.Vector3(0, 0, -1)).normalize(), hingeLow: new THREE.Vector3().crossVectors(lrestLow, new THREE.Vector3(0, 0, -1)).normalize() };
    }
  }
  reset() { this.p.identity(); return this; }

  euler(b: number, pitch: number, yaw = 0, roll = 0) {
    _e.set(pitch * D, yaw * D, roll * D, 'YXZ');
    _qa.setFromEuler(_e);
    setQ(this.p, b, _qa);
    return this;
  }
  /** multiply an extra euler rotation onto a bone (post-multiplied, local) */
  add(b: number, pitch: number, yaw = 0, roll = 0) {
    _e.set(pitch * D, yaw * D, roll * D, 'YXZ');
    _qb.setFromEuler(_e);
    getQ(this.p, b, _qa).multiply(_qb);
    setQ(this.p, b, _qa);
    return this;
  }
  hips(dx = 0, dy = 0, dz = 0, pitch = 0, yaw = 0, roll = 0) { this.p.hp[0] = dx; this.p.hp[1] = dy; this.p.hp[2] = dz; return this.euler(B.hips, pitch, yaw, roll); }
  spine(pitch = 0, yaw = 0, roll = 0) { return this.euler(B.spine, pitch, yaw, roll); }
  chest(pitch = 0, yaw = 0, roll = 0) { return this.euler(B.chest, pitch, yaw, roll); }
  neck(pitch = 0, yaw = 0, roll = 0) { return this.euler(B.neck, pitch, yaw, roll); }
  head(pitch = 0, yaw = 0, roll = 0) { return this.euler(B.head, pitch, yaw, roll); }
  /** shoulder shrug: up (deg), forward (deg) */
  clav(side: number, up = 0, fwd = 0) { return this.euler(side > 0 ? B.clav_l : B.clav_r, 0, -fwd * side, up * side); }

  private dir(side: number, elev: number, azim: number, out: THREE.Vector3) {
    const e = elev * D, a = azim * D;
    return out.set(Math.sin(e) * Math.sin(a) * side, -Math.cos(e), Math.sin(e) * Math.cos(a)).normalize();
  }

  arm(side: number, elev: number, azim: number, twist = 0, elbow = 10, wristPitch = 0, wristRoll = 0) {
    const L = side > 0;
    const info = this.arms[side];
    this.dir(side, elev, azim, _v);
    _qa.setFromUnitVectors(info.rest, _v);
    _qb.setFromAxisAngle(info.rest, twist * D * side);
    _qa.multiply(_qb);
    setQ(this.p, L ? B.upperarm_l : B.upperarm_r, _qa);
    _qc.setFromAxisAngle(info.hingeLow, Math.max(0, elbow) * D);
    setQ(this.p, L ? B.forearm_l : B.forearm_r, _qc);
    _qa.setFromAxisAngle(info.hingeLow, wristPitch * D);
    _qb.setFromAxisAngle(info.restLow, wristRoll * D * side);
    _qa.multiply(_qb);
    setQ(this.p, L ? B.hand_l : B.hand_r, _qa);
    return this;
  }

  leg(side: number, elev: number, azim: number, knee = 3, foot = 0) {
    const L = side > 0;
    const info = this.legs[side];
    this.dir(side, elev, azim, _v);
    _qa.setFromUnitVectors(info.rest, _v);
    setQ(this.p, L ? B.thigh_l : B.thigh_r, _qa);
    _qc.setFromAxisAngle(info.hingeLow, Math.max(0, knee) * D);
    setQ(this.p, L ? B.shin_l : B.shin_r, _qc);
    _qa.setFromAxisAngle(_v2.set(1, 0, 0), foot * D);
    setQ(this.p, L ? B.foot_l : B.foot_r, _qa);
    return this;
  }

  /** arm by sagittal swing (+ forward, deg) and abduction (+ out, deg) */
  armSA(side: number, swing: number, abd: number, twist = 0, elbow = 10, wristPitch = 0, wristRoll = 0) {
    const s = swing * D, a = abd * D;
    const x = Math.sin(a), y = -Math.cos(a) * Math.cos(s), z = Math.cos(a) * Math.sin(s);
    const elev = Math.acos(Math.max(-1, Math.min(1, -y))) / D;
    const azim = Math.atan2(x, z) / D;
    return this.arm(side, elev, azim, twist, elbow, wristPitch, wristRoll);
  }
  /** leg by sagittal swing (+ forward) and abduction (+ out) */
  legSA(side: number, swing: number, abd: number, knee = 3, foot = 0) {
    const s = swing * D, a = abd * D;
    const x = Math.sin(a), y = -Math.cos(a) * Math.cos(s), z = Math.cos(a) * Math.sin(s);
    const elev = Math.acos(Math.max(-1, Math.min(1, -y))) / D;
    const azim = Math.atan2(x, z) / D;
    return this.leg(side, elev, azim, knee, foot);
  }

  /** set the whole hips orientation from an explicit basis (lying poses) */
  hipsBasis(x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3) {
    const m = new THREE.Matrix4().makeBasis(x, y, z);
    _qa.setFromRotationMatrix(m);
    setQ(this.p, B.hips, _qa);
    return this;
  }
}

// ------------------------------------------------------------------ easing / tracks

export const sm = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** 0→1 between a..b, hold, 1→0 between c..d */
export const env = (k: number, a: number, b: number, c: number, d: number) => sm(a, b, k) * (1 - sm(c, d, k));
/** keyframe track: [[t, v], ...] with smoothstep interpolation */
export function track(k: number, keys: [number, number][]) {
  if (k <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, v0] = keys[i], [t1, v1] = keys[i + 1];
    if (k <= t1) return lerp(v0, v1, sm(t0, t1, k));
  }
  return keys[keys.length - 1][1];
}
