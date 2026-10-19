import type { Sex } from '../../game/contracts';
import type { V3 } from './geo';

/* ============================================================================================
 * Skeleton definition. Internal model frame: +Y up, +Z forward, +X = the character's LEFT.
 * (The rig's `inner` group is rotated by π so the character faces -Z in the world, per contract.)
 * Rest pose: arms hang slightly out (A-pose ≈ 10°), all bone rotations identity.
 * Geometry is authored for a 1.70 m reference body and scaled by height / 1.70.
 * ========================================================================================== */

export const REF_H = 1.7;

export const BONE_NAMES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'clav_l', 'upperarm_l', 'forearm_l', 'hand_l',
  'clav_r', 'upperarm_r', 'forearm_r', 'hand_r',
  'thigh_l', 'shin_l', 'foot_l',
  'thigh_r', 'shin_r', 'foot_r',
] as const;
export const NB = BONE_NAMES.length;
export const PARENT = [-1, 0, 1, 2, 3, 2, 5, 6, 7, 2, 9, 10, 11, 0, 13, 14, 0, 16, 17];
export const B = {
  hips: 0, spine: 1, chest: 2, neck: 3, head: 4,
  clav_l: 5, upperarm_l: 6, forearm_l: 7, hand_l: 8,
  clav_r: 9, upperarm_r: 10, forearm_r: 11, hand_r: 12,
  thigh_l: 13, shin_l: 14, foot_l: 15,
  thigh_r: 16, shin_r: 17, foot_r: 18,
} as const;

export interface RestSkel {
  sex: Sex;
  build: number;
  /** joint positions in the model frame (reference 1.70 m) */
  J: V3[];
  /** arm rest angles (deg, outward from vertical) */
  armA: number;
  foreA: number;
  /** segment lengths */
  upperLen: number; foreLen: number; thighLen: number; shinLen: number;
}

const cache = new Map<string, RestSkel>();

export function restSkel(sex: Sex, build: number): RestSkel {
  const key = sex + build.toFixed(3);
  const hit = cache.get(key);
  if (hit) return hit;
  const f = sex === 'f';
  const bw = build - 0.5;
  const J: V3[] = new Array(NB);
  const shoulderX = (f ? 0.162 : 0.178) + bw * 0.016;
  const hipX = (f ? 0.094 : 0.09) + bw * 0.014;
  const armA = (f ? 12 : 10) + Math.max(0, bw) * 10;
  const foreA = armA + 2.5;
  const upperLen = f ? 0.28 : 0.29, foreLen = f ? 0.24 : 0.25;
  const hipsY = f ? 0.955 : 0.95;
  J[B.hips] = [0, hipsY, 0];
  J[B.spine] = [0, 1.05, -0.006];
  J[B.chest] = [0, 1.22, -0.012];
  J[B.neck] = [0, f ? 1.44 : 1.445, -0.016];
  J[B.head] = [0, f ? 1.548 : 1.555, -0.004];
  const thighLen = (f ? 0.91 : 0.9) - 0.48;
  const shinLen = 0.48 - 0.075;
  for (const side of [1, -1]) {
    const L = side === 1;
    const sx = side;
    const sa = (armA * Math.PI) / 180, fa = (foreA * Math.PI) / 180;
    const clav: V3 = [0.028 * sx, f ? 1.395 : 1.4, 0.004];
    const sh: V3 = [shoulderX * sx, f ? 1.4 : 1.405, -0.014];
    const el: V3 = [sh[0] + Math.sin(sa) * upperLen * sx, sh[1] - Math.cos(sa) * upperLen, sh[2] - 0.004];
    const fwd = 0.1; // forearm hangs a little forward
    const wr: V3 = [el[0] + Math.sin(fa) * foreLen * sx, el[1] - Math.cos(fa) * foreLen * Math.cos(fwd), el[2] + Math.sin(fwd) * foreLen];
    const th: V3 = [hipX * sx, f ? 0.91 : 0.9, 0.002];
    const kn: V3 = [(hipX - 0.004) * sx, 0.48, 0.006];
    const an: V3 = [(hipX - 0.006) * sx, 0.075, -0.012];
    J[L ? B.clav_l : B.clav_r] = clav;
    J[L ? B.upperarm_l : B.upperarm_r] = sh;
    J[L ? B.forearm_l : B.forearm_r] = el;
    J[L ? B.hand_l : B.hand_r] = wr;
    J[L ? B.thigh_l : B.thigh_r] = th;
    J[L ? B.shin_l : B.shin_r] = kn;
    J[L ? B.foot_l : B.foot_r] = an;
  }
  const r: RestSkel = { sex, build, J, armA, foreA, upperLen, foreLen, thighLen, shinLen };
  cache.set(key, r);
  return r;
}

/** rest direction (unit) of a bone = toward its main child joint */
export function restDir(sk: RestSkel, bone: number): V3 {
  const J = sk.J;
  const child: Record<number, number> = {
    [B.upperarm_l]: B.forearm_l, [B.forearm_l]: B.hand_l, [B.upperarm_r]: B.forearm_r, [B.forearm_r]: B.hand_r,
    [B.thigh_l]: B.shin_l, [B.shin_l]: B.foot_l, [B.thigh_r]: B.shin_r, [B.shin_r]: B.foot_r,
  };
  const c = child[bone];
  if (c === undefined) return [0, -1, 0];
  const d: V3 = [J[c][0] - J[bone][0], J[c][1] - J[bone][1], J[c][2] - J[bone][2]];
  const l = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / l, d[1] / l, d[2] / l];
}
