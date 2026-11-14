import * as THREE from 'three';
import type { AnimName, CarryPose, FaceVariant } from '../../game/contracts';
import { PoseBuilder, env, lerp, sm, track, pos } from './pose';
import type { ExprKey } from './face-expr';
import { B } from './skel';

/* ============================================================================================
 * Procedural animation library: every contract AnimName. Each anim writes a full pose through
 * the PoseBuilder. Locomotion (idle → walk → run) is a shared layer used by idle/walk/run and
 * by upper-body anims while standing. Postures (stand / sit / floor / lie) persist so that e.g.
 * 'sit' followed by 'eat' keeps the character seated.
 * ========================================================================================== */

export type Posture = 'stand' | 'sit' | 'floor' | 'lie';

export interface AnimCtx {
  pb: PoseBuilder;
  t: number; k: number; dt: number;
  speed: number; phase: number; moveW: number; runW: number;
  build: number; female: boolean; age: number; s: number; rnd: number;
  carry: CarryPose; posture: Posture; seat: number; gt: number;
  /** extra: 0..1 wobble for drunk/load */
  wob: number;
  /** smoothed idle weight shift −1 (right leg) … +1 (left leg) */
  shift?: number;
  /** per-character personality */
  pers?: Personality;
}

export interface Personality {
  /** −1 upright/proud … +1 slouched */
  slouch: number;
  /** habitual head tilt −1 … 1 */
  tilt: number;
  /** idle tempo multiplier ~0.8 … 1.25 */
  tempo: number;
  /** 0 calm … 1 restless (fidget frequency, gesture size) */
  energy: number;
}

export interface AnimDef {
  loop: boolean;
  dur: number;
  fade?: number;
  /** carry layer may override the arms */
  carry?: boolean;
  look?: boolean;
  face?: FaceVariant;
  /** posture this anim establishes (undefined = keep current) */
  posture?: Posture;
  /** one-shot that holds its final pose */
  hold?: boolean;
  /** uses locomotion (legs follow speed) */
  loco?: boolean;
  /** locomotion is allowed to override this anim when the character moves */
  movable?: boolean;
  /** facial expression while this anim plays (animated face) */
  expr?: ExprKey;
  /** time-varying expression (overrides expr when it returns a key) */
  exprAt?(k: number, t: number): ExprKey | null;
  /** mouth activity while this anim plays */
  mouth?: 'talk' | 'laugh' | 'chew' | 'scream';
  pose(c: AnimCtx): void;
}

const TAU = Math.PI * 2;
const sin = Math.sin, cos = Math.cos, abs = Math.abs, clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

// ------------------------------------------------------------------ shared layers

export interface LocoStyle { stride?: number; armSwing?: number; lean?: number; bounce?: number; knee?: number; arms?: boolean; drunk?: number; heavy?: number }

/** Standing locomotion (idle ↔ walk ↔ run) – legs, hips, spine, arms, head. */
export function loco(c: AnimCtx, st: LocoStyle = {}) {
  const pb = c.pb;
  const v = c.speed, mw = c.moveW, rw = c.runW;
  const age = c.age, bld = c.build;
  const idle = 1 - mw;
  const gt = c.gt + c.rnd * 20;
  const heavy = st.heavy ?? 0;
  const drunk = st.drunk ?? 0;
  // ---- amplitudes
  const hipWalk = clamp(9 + v * 7.5, 12, 34) * (1 - age * 0.35) * (1 - heavy * 0.45);
  const hipRun = clamp(30 + v * 2.6, 34, 46);
  const hipA = lerp(hipWalk, hipRun, rw) * (st.stride ?? 1) * mw;
  const kneeSwing = lerp(50 + v * 3, 92 + v * 3, rw) * (st.knee ?? 1);
  const leanF = lerp(2 + v * 1.4, 10 + v * 1.1, rw) * mw + (st.lean ?? 0) + age * 9 + heavy * 16;
  // ---- hips
  const uL = c.phase % 1, uR = (c.phase + 0.5) % 1;
  const bobW = (0.01 + v * 0.006) * (st.bounce ?? 1), bobR = 0.032 * (st.bounce ?? 1);
  let hy = (-bobW * cos(TAU * 2 * uL) - 0.008) * mw * (1 - rw) + (bobR * cos(TAU * 2 * (uL - 0.45)) - 0.035) * rw * mw;
  hy -= heavy * 0.04 + age * 0.015;
  const pers = c.pers;
  const tempo = pers?.tempo ?? 1;
  const shift = c.shift ?? sin(gt * 0.45);
  const sway = idle * (0.016 * shift + 0.003 * sin(gt * 1.3 * tempo) + 0.002 * sin(gt * 0.37 * tempo)) + drunk * 0.04 * sin(gt * 0.9);
  const yawP = (4 + v * 1.5) * cos(TAU * uL) * mw * (1 - rw * 0.3) + idle * 2.5 * shift;
  const rollP = idle * (2.2 * shift + 0.5 * sin(gt * 0.61 * tempo)) + mw * 2.5 * sin(TAU * 2 * uL) * (1 - rw) + drunk * 5 * sin(gt * 0.9 + 1);
  pb.hips(sway, hy, 0, leanF * 0.25, yawP, rollP);
  // ---- legs
  const legOne = (side: number, u: number) => {
    const hip = hipA * cos(TAU * u);
    // knee
    let kw: number, kr: number, fw: number, fr: number;
    if (u < 0.6) { kw = u < 0.3 ? 14 * sin((Math.PI * u) / 0.3) : 4; } else kw = kneeSwing * sin((Math.PI * (u - 0.6)) / 0.4);
    if (u < 0.4) kr = 22 + 16 * sin((Math.PI * u) / 0.4); else kr = 20 + kneeSwing * sin((Math.PI * (u - 0.4)) / 0.6);
    fw = u < 0.1 ? -8 * (1 - u / 0.1) : u < 0.45 ? 0 : u < 0.62 ? 18 * sin((Math.PI * (u - 0.45)) / 0.17) : u < 0.92 ? -9 : 0;
    fr = u < 0.4 ? 12 * sm(0.15, 0.38, u) : -14 * sin((Math.PI * (u - 0.4)) / 0.6);
    const knee = lerp(kw, kr, rw) * mw + idle * (3 + age * 6 + heavy * 12) + heavy * 10 * mw;
    const foot = lerp(fw, fr, rw) * mw;
    // idle: weight on one leg, the other relaxed (smooth: no pop when the weight changes sides)
    const relax = idle * 7 * clamp(-shift * side * 1.4, 0, 1);
    const abd = 3 + bld * 3 - (c.female ? 1.5 : 0) + drunk * 4;
    pb.legSA(side, hip + idle * (side > 0 ? 1 : -1) * 0.5, abd, knee + relax, foot - relax * 0.3);
  };
  legOne(1, uL); legOne(-1, uR);
  // ---- spine & head
  const breathe = sin(gt * 1.7) * 1.1 * (1 + rw);
  const slouch = (pers?.slouch ?? 0) * idle;
  const tilt = (pers?.tilt ?? 0) * 4 * idle;
  pb.spine(leanF * 0.45 + idle * 0.5 + slouch * 4, -yawP * 0.6, -rollP * 0.4);
  pb.chest(leanF * 0.3 + breathe * 0.4 + age * 4 + slouch * 5, -yawP * 0.5, -rollP * 0.3 + drunk * 6 * sin(gt * 0.7));
  const lookDrift = idle * (6 * sin(gt * 0.23 * tempo) + 3 * sin(gt * 0.61 * tempo));
  pb.neck(-leanF * 0.35 - age * 5 - slouch * 5, lookDrift * 0.4, drunk * 10 * sin(gt * 0.8) + tilt * 0.4);
  pb.head(-leanF * 0.25 + idle * 2 * sin(gt * 0.31) - age * 4 - slouch * 3, lookDrift * 0.6, drunk * 12 * sin(gt * 0.6 + 2) + tilt + rollP * 0.25);
  // ---- arms
  if (st.arms !== false) {
    const armSwing = lerp(6 + v * 8, 34, rw) * (st.armSwing ?? 1) * mw * (1 - heavy * 0.6);
    for (const side of [1, -1]) {
      const u = side > 0 ? uR : uL; // opposite leg
      const sw = armSwing * cos(TAU * u);
      const elbow = lerp(12 + v * 5 + pos(sw, 4) * 0.35, 88, rw) * mw + idle * (10 + age * 8) + drunk * 10;
      const abd = 7 + bld * 11 + rw * 4 + drunk * 14 * (0.5 + 0.5 * sin(gt * 1.3 + side));
      pb.armSA(side, sw + idle * 1.5 * sin(gt * 0.7 + side), abd, -8, elbow, idle * 4, 0);
    }
    pb.clav(1, breathe * 0.6, 0); pb.clav(-1, breathe * 0.6, 0);
  }
}

/** seated on a stool/chair of height `seat` (m): feet planted on the floor */
export function sitBase(c: AnimCtx, seat = c.seat, slouch = 1) {
  const pb = c.pb;
  const s = c.s;
  const hipsY = (seat + 0.13) / s; // pelvis centre (model units)
  const dy = hipsY - 0.95;
  const hipJoint = hipsY - 0.05, thighL = 0.42, shinL = 0.405, ankle = 0.075;
  let ca = (hipJoint - shinL - ankle) / thighL;
  ca = clamp(ca, -0.45, 0.85);
  const alpha = Math.acos(ca) / (Math.PI / 180); // thigh elevation from straight down
  const gt = c.gt + c.rnd * 20;
  pb.hips(0, dy, -0.06, -6, 0, 0);
  const spread = 7 + c.build * 6 - (c.female ? 5 : 0);
  pb.leg(1, alpha, spread, alpha - 4, -4);
  pb.leg(-1, alpha, spread, alpha - 4, -4);
  const breathe = sin(gt * 1.6) * 1.1;
  pb.spine(10 * slouch + c.age * 6, 0, 0);
  pb.chest(6 * slouch + breathe * 0.4, 0, 0);
  pb.neck(-8 * slouch, 3 * sin(gt * 0.2), 0);
  pb.head(-4, 5 * sin(gt * 0.27), 0);
  // hands resting on the thighs
  pb.arm(1, 38, -6, -10, 52, 10); pb.arm(-1, 38, -6, -10, 52, 10);
}

export function floorBase(c: AnimCtx) {
  const pb = c.pb;
  const s = c.s;
  const gt = c.gt + c.rnd * 20;
  pb.hips(0, 0.13 / s - 0.95, -0.04, -12, 0, 0);
  pb.leg(1, 78, 58, 132, 20); pb.leg(-1, 82, 50, 138, 25);
  pb.spine(14, 0, 0); pb.chest(8 + sin(gt * 1.6) * 0.5, 0, 0);
  pb.neck(-10, 0, 0); pb.head(-6, 4 * sin(gt * 0.25), 0);
  pb.arm(1, 40, 18, -10, 40, 10); pb.arm(-1, 40, 18, -10, 40, 10);
}

/** posture base for upper-body anims */
export function base(c: AnimCtx) {
  if (c.posture === 'sit') sitBase(c);
  else if (c.posture === 'floor') floorBase(c);
  else loco(c);
}

/** lying on the side, curled (cardboard sleep) */
function lieSide(c: AnimCtx, curl = 1) {
  const pb = c.pb;
  const s = c.s;
  // spine points +Z (head forward), right side down, chest facing +X
  pb.hipsBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0));
  pb.p.hp[0] = 0.0; pb.p.hp[1] = 0.16 / s - 0.95; pb.p.hp[2] = -0.25;
  const gt = c.gt + c.rnd * 20;
  const br = sin(gt * 1.1) * 1.5;
  pb.spine(18 * curl, 0, 0); pb.chest(14 * curl + br, 0, 0);
  pb.neck(10 * curl, 0, 8); pb.head(14 * curl, 0, 10);
  pb.leg(1, 70 * curl + 10, 8, 95 * curl, 15); pb.leg(-1, 60 * curl + 12, -4, 105 * curl, 18);
  pb.arm(1, 70, -35, 10, 115, 20); pb.arm(-1, 85, -10, 30, 120, 10);
}

/** lying on the back (after a fall) */
function lieBack(c: AnimCtx, k = 1) {
  const pb = c.pb;
  const s = c.s;
  pb.hipsBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0));
  pb.p.hp[1] = 0.1 / s - 0.95; pb.p.hp[2] = 0.3;
  pb.spine(-4, 0, 0); pb.chest(-3, 0, 0); pb.neck(8, 0, 0); pb.head(10 * k, 15, 0);
  pb.leg(1, 30, 18, 40, 10); pb.leg(-1, 12, 10, 10, 15);
  pb.arm(1, 95, 70, 0, 30, 10); pb.arm(-1, 80, 85, 0, 20, 0);
}

// ------------------------------------------------------------------ animation table

const R = -1, L = 1; // sides
const A: Partial<Record<AnimName, AnimDef>> = {};
const def = (name: AnimName, d: AnimDef) => { A[name] = d; };

def('idle', { loop: true, dur: 1, carry: true, loco: true, posture: 'stand', pose: (c) => loco(c) });
def('walk', { loop: true, dur: 1, carry: true, loco: true, posture: 'stand', pose: (c) => loco(c) });
def('run', { loop: true, dur: 1, carry: true, loco: true, posture: 'stand', pose: (c) => loco(c) });

def('tpose', { loop: true, dur: 1, look: false, posture: 'stand', fade: 0.12, pose: (c) => {
  const pb = c.pb;
  const j = sin(c.gt * 0.9) * 0.6;
  pb.hips(0, 0, 0, 0, j * 0.3, 0); pb.spine(0, 0, 0); pb.chest(0, 0, 0); pb.neck(0, 0, 0); pb.head(0, 0, 0);
  pb.arm(L, 90, 90, 0, 0, 0); pb.arm(R, 90, 90, 0, 0, 0);
  pb.leg(L, 0, 4, 0, 0); pb.leg(R, 0, 4, 0, 0);
} });

def('sit', { loop: true, dur: 1, carry: true, posture: 'sit', fade: 0.45, pose: (c) => sitBase(c) });
def('sit_floor', { loop: true, dur: 1, carry: true, posture: 'floor', fade: 0.55, pose: (c) => floorBase(c) });
def('sleep', { loop: true, dur: 1, look: false, face: 'sleep', posture: 'lie', fade: 0.7, pose: (c) => lieSide(c, 1) });
def('lie_cardboard', { loop: true, dur: 1, look: false, face: 'sleep', posture: 'lie', fade: 0.7, pose: (c) => lieSide(c, 0.85) });

def('slap', { loop: false, dur: 1.15, fade: 0.08, face: 'shock', pose: (c) => {
  base(c);
  const pb = c.pb, k = c.k;
  const wind = track(k, [[0, 0], [0.38, 1], [0.48, 1], [0.58, -0.6], [0.7, -1], [1, 0]]);
  const elev = track(k, [[0, 20], [0.38, 115], [0.5, 100], [0.62, 95], [1, 20]]);
  const azim = track(k, [[0, 20], [0.38, 155], [0.5, 60], [0.62, -45], [0.72, -70], [1, 15]]);
  const elbow = track(k, [[0, 15], [0.38, 75], [0.52, 20], [0.66, 25], [1, 15]]);
  pb.arm(R, elev, azim, 20, elbow, -20 * (1 - abs(wind)));
  pb.chest(-6 * wind, -38 * wind, 4 * wind);
  pb.spine(-4 * wind, -14 * wind, 0);
  pb.head(4, 18 * wind, 0);
  pb.arm(L, 25 + 15 * abs(wind), 25, 0, 40, 0);
  if (c.posture === 'stand') { pb.legSA(R, -12 * pos(wind) + 18 * pos(-wind), 6, 10, 0); pb.p.hp[2] += -0.04 * wind; }
} });

def('get_slapped', { loop: false, dur: 1.2, fade: 0.04, face: 'shock', pose: (c) => {
  base(c);
  const pb = c.pb, k = c.k;
  // anime timing: whip past the target, wobble back, overshoot the rest pose, settle
  const snap = track(k, [[0, 0], [0.05, 1.3], [0.14, 0.92], [0.26, 1.08], [0.5, 0.62], [0.72, -0.14], [0.86, 0.06], [1, 0]]);
  pb.neck(6 * snap, -38 * snap, 14 * snap);
  pb.head(8 * snap, -52 * snap, 26 * snap);
  pb.chest(-6 * snap, -18 * snap, 9 * snap);
  pb.spine(-8 * snap, -9 * snap, 6 * snap);
  // hand to the cheek
  const hand = env(k, 0.2, 0.42, 0.82, 1);
  pb.arm(L, lerp(10, 70, hand), lerp(10, -20, hand), lerp(0, 40, hand), lerp(15, 150, hand), lerp(0, -30, hand));
  pb.arm(R, 20 + 30 * snap, 40 * snap + 10, 0, 30 + 40 * snap, 0);
  if (c.posture === 'stand') { pb.p.hp[0] += -0.08 * snap; pb.p.hp[1] += 0.03 * pos(snap - 0.9, 0.05); pb.legSA(L, 0, 18 * snap + 4, 16 * snap, 0); }
} });

def('highfive', { loop: false, dur: 0.95, fade: 0.1, pose: (c) => {
  base(c);
  const pb = c.pb, k = c.k;
  const up = env(k, 0.0, 0.32, 0.62, 0.95);
  const slap = env(k, 0.32, 0.4, 0.42, 0.55);
  pb.arm(R, lerp(15, 150, up), lerp(10, 15, up), lerp(0, 30, up), lerp(15, 18, up) + slap * 25, lerp(0, -30, up) + slap * 35);
  pb.chest(-6 * up, -8 * up, -3 * up); pb.head(-10 * up, -6 * up, 0);
  if (c.posture === 'stand') pb.p.hp[1] += 0.03 * slap;
} });

def('give', { loop: false, dur: 1.1, fade: 0.12, pose: (c) => {
  base(c);
  const pb = c.pb, k = c.k;
  const out = env(k, 0.0, 0.35, 0.7, 1);
  pb.arm(R, lerp(15, 72, out), lerp(10, -4, out), lerp(0, 70, out), lerp(15, 18, out), lerp(0, -15, out));
  pb.chest(8 * out, -6 * out, 0); pb.spine(5 * out, 0, 0); pb.head(8 * out, 0, 0);
} });

def('point', { loop: false, dur: 1.5, fade: 0.12, pose: (c) => {
  base(c);
  const pb = c.pb, k = c.k;
  const out = env(k, 0.0, 0.22, 0.75, 1);
  const jab = sin(c.t * 9) * 3 * env(k, 0.25, 0.3, 0.6, 0.7);
  pb.arm(R, lerp(15, 90, out) + jab, lerp(10, 2, out), lerp(0, -20, out), lerp(15, 2, out), 0);
  pb.chest(-3 * out, -10 * out, 0); pb.head(-2 * out, -8 * out, 0);
} });

def('wave', { loop: false, dur: 1.8, fade: 0.15, pose: (c) => {
  base(c);
  const pb = c.pb, k = c.k;
  const up = c.k >= 0 ? env(k, 0, 0.18, 0.82, 1) : 1;
  const wv = sin(c.t * TAU * 2.6) * 26;
  pb.arm(R, lerp(15, 145, up), lerp(10, 45, up), lerp(0, 60, up) + wv * up, lerp(15, 65, up), 0, 0);
  pb.chest(-3 * up, -5 * up, -4 * up); pb.head(-5 * up, -8 * up, 4 * up * sin(c.t * 5));
} });

def('talk', { loop: true, dur: 3.2, carry: false, pose: (c) => {
  base(c);
  const pb = c.pb, t = c.t + c.rnd * 5;
  const g1 = 0.5 + 0.5 * sin(t * 2.3), g2 = 0.5 + 0.5 * sin(t * 1.7 + 2);
  pb.arm(R, 25 + 25 * g1, 5 + 15 * g2, 40 + 20 * sin(t * 3.1), 70 + 25 * g1, -10 + 15 * sin(t * 4.3));
  pb.arm(L, 20 + 18 * g2, 10 + 10 * g1, 30, 55 + 30 * g2, -5);
  pb.head(4 * sin(t * 2.9) - 2, 8 * sin(t * 0.9), 4 * sin(t * 1.3));
  pb.chest(3 + 2 * sin(t * 1.9), 6 * sin(t * 0.8), 0);
} });

def('angry', { loop: false, dur: 1.5, fade: 0.1, carry: false, pose: (c) => {
  base(c);
  const pb = c.pb, k = c.k, t = c.t;
  const on = env(k, 0, 0.12, 0.85, 1);
  const shake = sin(t * 38) * 3 * on;
  pb.arm(R, 25 * on + 10, 15, -20, 100 * on + 10, 20 * on, 0); pb.arm(L, 25 * on + 10, 15, -20, 100 * on + 10, 20 * on, 0);
  pb.add(B.upperarm_r, shake, 0, 0); pb.add(B.upperarm_l, -shake, 0, 0);
  pb.chest(12 * on, 0, shake * 0.5); pb.spine(6 * on, 0, 0); pb.neck(-14 * on, 0, 0); pb.head(-6 * on + shake, 0, 0);
  pb.clav(1, 8 * on, 6 * on); pb.clav(-1, 8 * on, 6 * on);
  if (c.posture === 'stand') {
    const stomp = Math.max(env(k, 0.18, 0.28, 0.3, 0.36), env(k, 0.55, 0.65, 0.67, 0.73));
    pb.legSA(R, 30 * stomp, 6, 70 * stomp, -10 * stomp);
    pb.p.hp[1] += -0.012 * (1 - stomp) * on;
  }
} });

def('shrug', { loop: false, dur: 1.3, fade: 0.12, pose: (c) => {
  base(c);
  const pb = c.pb, k = c.k;
  const on = env(k, 0, 0.3, 0.7, 1);
  for (const sd of [L, R]) { pb.arm(sd, 22 * on + 8, 42 * on + 10, -70 * on, 85 * on + 12, -25 * on); pb.clav(sd, 16 * on, 0); }
  pb.head(-4 * on, 0, 12 * on); pb.neck(-6 * on, 0, 0);
} });

def('count_coins', { loop: true, dur: 3, pose: (c) => {
  base(c);
  const pb = c.pb, t = c.t;
  pb.arm(L, 28, -25, 60, 98, -20);
  const pick = 0.5 + 0.5 * sin(t * 5.2);
  pb.arm(R, 32 + 4 * pick, -32, 30, 100 + 10 * pick, 10 * pick);
  pb.neck(18, 0, 0); pb.head(16 + 2 * sin(t * 1.3), 4 * sin(t * 0.7), 0);
  pb.chest(6, 0, 0);
} });

def('think', { loop: true, dur: 4, face: 'think', fade: 0.35, pose: (c) => {
  base(c);
  const pb = c.pb, t = c.t + c.rnd * 4;
  const sway = sin(t * 0.8);
  // hand on chin, other arm across the belly holding the elbow, head tilted up (dumb thinking)
  pb.arm(R, 34, -38, 30, 142, -35, 0);
  pb.arm(L, 24, -55, 20, 95, 0, 0);
  pb.chest(-4 + sway, 4 * sway, 2 * sway);
  pb.neck(-10, 5, 6); pb.head(-16 + 2 * sin(t * 1.1), 10 + 4 * sway, 9 + 3 * sin(t * 0.6));
  if (c.posture === 'stand') pb.p.hp[0] += 0.012 * sway;
} });

def('scream_run', { loop: true, dur: 1, loco: true, face: 'scream', posture: 'stand', pose: (c) => {
  const cc = { ...c, speed: Math.max(c.speed, 3.5), runW: Math.max(c.runW, 0.85), moveW: 1 };
  if (c.speed < 0.3) cc.phase = (c.t * 1.6) % 1;
  loco(cc, { knee: 1.25, arms: false, lean: -8, bounce: 1.3 });
  const pb = c.pb, t = c.t;
  pb.arm(L, 150 + 22 * sin(t * 13), 30 + 25 * sin(t * 9), 20, 30 + 25 * sin(t * 11), 20 * sin(t * 15));
  pb.arm(R, 150 + 22 * sin(t * 12 + 2), 30 + 25 * sin(t * 8 + 1), 20, 30 + 25 * sin(t * 10 + 1), 20 * sin(t * 14));
  pb.neck(-12, 0, 0); pb.head(-18 + 6 * sin(t * 17), 14 * sin(t * 7), 8 * sin(t * 9));
  pb.clav(1, 18, 0); pb.clav(-1, 18, 0);
} });

def('drunk', { loop: true, dur: 1, loco: true, face: 'drunk', posture: 'stand', carry: true, pose: (c) => {
  loco(c, { drunk: 1, stride: 0.8, armSwing: 1.4 });
  const pb = c.pb, t = c.gt + c.rnd * 9;
  pb.add(B.spine, 4 * sin(t * 0.7), 6 * sin(t * 0.4), 6 * sin(t * 0.9));
  pb.add(B.head, 10 + 8 * sin(t * 0.5), 0, 14 * sin(t * 0.8));
} });

def('celebrate', { loop: true, dur: 0.9, posture: 'stand', fade: 0.15, pose: (c) => {
  const pb = c.pb, t = c.t;
  const u = (t / 0.9) % 1;
  const jump = pos(sin(u * TAU)) * 0.14;
  const crouch = pos(-sin(u * TAU)) * 0.08;
  pb.hips(0, jump - crouch, 0, 4, 0, 0);
  const kn = crouch * 500;
  const toe = 15 * sm(0.0, 0.05, jump);
  pb.leg(L, kn * 0.5, 8, kn, toe); pb.leg(R, kn * 0.5, 8, kn, toe);
  const pump = sin(u * TAU * 2) * 12;
  pb.arm(L, 160 + pump, 30, 30, 40 + pump, 20); pb.arm(R, 160 - pump, 30, 30, 40 - pump, 20);
  pb.spine(-4, 0, 0); pb.chest(-8, 0, 0); pb.neck(-10, 0, 0); pb.head(-14, 0, 6 * sin(t * 4));
  pb.clav(1, 15, 0); pb.clav(-1, 15, 0);
} });

def('casino_cheer', { loop: true, dur: 1.6, posture: 'stand', fade: 0.2, pose: (c) => {
  loco({ ...c, moveW: 0 });
  const pb = c.pb, t = c.t + c.rnd * 3;
  const b = 0.5 + 0.5 * sin(t * 6);
  pb.p.hp[1] += 0.025 * b - 0.02;
  pb.leg(L, 6, 8, 10 + 12 * (1 - b), 0); pb.leg(R, 6, 8, 10 + 12 * (1 - b), 0);
  pb.arm(L, 140 + 10 * sin(t * 6), 40, 20, 70 + 20 * b, 10); pb.arm(R, 145 + 10 * sin(t * 6 + 1), 40, 20, 65 + 20 * b, 10);
  pb.chest(-10, 8 * sin(t * 1.5), 0); pb.head(-18, 10 * sin(t * 1.5), 5 * sin(t * 3)); pb.clav(1, 12, 0); pb.clav(-1, 12, 0);
} });

def('casino_despair', { loop: true, dur: 3, face: 'shock', fade: 0.4, pose: (c) => {
  base(c);
  const pb = c.pb, t = c.t + c.rnd * 3;
  const rock = sin(t * 1.3);
  pb.spine(18 + 4 * rock, 0, 0); pb.chest(14, 0, 0); pb.neck(20, 0, 0); pb.head(18 + 5 * rock, 6 * sin(t * 0.7), 0);
  // head in hands
  pb.arm(L, 62, -16, 40, 150, -30); pb.arm(R, 62, -16, 40, 150, -30);
  if (c.posture === 'stand') { pb.p.hp[1] -= 0.03; pb.leg(L, 8, 6, 14, 0); pb.leg(R, 8, 6, 14, 0); }
} });

def('dance', { loop: true, dur: 2, posture: 'stand', fade: 0.25, pose: (c) => {
  const pb = c.pb, t = c.t;
  const beat = t * 2.1 * TAU / 2;
  const bounce = 0.5 + 0.5 * sin(beat * 2);
  const sway = sin(beat);
  pb.hips(0.05 * sway, -0.03 * bounce, 0, 4, 18 * sin(beat * 0.5), 8 * sway);
  pb.leg(L, 8 + 10 * pos(sway), 8, 12 + 20 * bounce + 25 * pos(sway), 0);
  pb.leg(R, 8 + 10 * pos(-sway), 8, 12 + 20 * bounce + 25 * pos(-sway), 0);
  // ram wong style hands circling at shoulder height
  pb.arm(L, 85 + 18 * sin(beat), 55 + 15 * cos(beat), 80, 95 + 15 * sin(beat), -50 + 25 * sin(beat * 2));
  pb.arm(R, 85 - 18 * sin(beat), 55 - 15 * cos(beat), 80, 95 - 15 * sin(beat), -50 - 25 * sin(beat * 2));
  pb.spine(2, -10 * sin(beat * 0.5), -6 * sway); pb.chest(-2, -6 * sin(beat * 0.5), -4 * sway);
  pb.neck(0, 8 * sin(beat * 0.5), 6 * sway); pb.head(-4, 6 * sin(beat * 0.5), 8 * sway);
} });

def('eat', { loop: true, dur: 2.4, look: false, pose: (c) => {
  base(c);
  const pb = c.pb, k = c.k;
  const lift = track(k, [[0, 0], [0.2, 0], [0.42, 1], [0.6, 1], [0.8, 0], [1, 0]]);
  const chew = sin(c.t * 14) * 2 * sm(0.85, 0.97, lift);
  pb.arm(L, 30, -18, 50, 92, 0);
  pb.arm(R, lerp(28, 42, lift), lerp(-12, -38, lift), lerp(20, 50, lift), lerp(78, 142, lift), lerp(10, -30, lift));
  pb.chest(10 - 4 * lift, 0, 0); pb.neck(10 - 6 * lift, 0, 0); pb.head(14 - 10 * lift + chew, -6 * lift, 0);
} });

def('drink', { loop: true, dur: 3.2, look: false, pose: (c) => {
  base(c);
  const pb = c.pb, k = c.k;
  const up = env(k, 0.05, 0.25, 0.6, 0.78);
  pb.arm(R, lerp(30, 58, up), lerp(-5, -28, up), lerp(30, 40, up), lerp(85, 135, up), lerp(0, -40, up));
  pb.neck(-10 * up, 0, 0); pb.head(-22 * up, 0, 0); pb.chest(-4 * up, 0, 0);
} });

def('cook_stir', { loop: true, dur: 1.2, look: false, pose: (c) => {
  base(c);
  const pb = c.pb, t = c.t;
  const toss = pos(sin(t * TAU / 1.2 * 2));
  const stir = t * TAU * 1.4;
  pb.arm(L, 42 + 10 * toss, 12, 20, 60 - 20 * toss, -10);
  pb.arm(R, 44 + 6 * sin(stir), -12 + 14 * cos(stir), 30, 72 + 12 * sin(stir), -15);
  pb.spine(10, 4, 0); pb.chest(8 + 3 * toss, 0, 0); pb.neck(14, 0, 0); pb.head(12, 4 * sin(t * 0.6), 0);
  if (c.posture === 'stand') pb.p.hp[1] -= 0.01 * toss;
} });

def('chop', { loop: true, dur: 0.5, look: false, pose: (c) => {
  base(c);
  const pb = c.pb, t = c.t;
  const ch = 0.5 + 0.5 * sin(t * TAU * 3.6);
  pb.arm(R, 34 + 8 * ch, -10, 30, 70 + 40 * ch, -10 + 20 * ch);
  pb.arm(L, 32, -20, 40, 85, 10);
  pb.spine(12, 0, 0); pb.chest(10, 0, 0); pb.neck(18, 0, 0); pb.head(18, 0, 0);
} });

def('wash', { loop: true, dur: 1.4, look: false, pose: (c) => {
  base(c);
  const pb = c.pb, t = c.t;
  const a = t * TAU * 1.3;
  pb.arm(L, 38 + 6 * sin(a), -12 + 8 * cos(a), 20, 55 + 10 * cos(a), 10);
  pb.arm(R, 38 + 6 * sin(a + 2), -12 + 8 * cos(a + 2), 20, 55 + 10 * cos(a + 2), 10);
  pb.spine(22, 0, 0); pb.chest(12, 0, 0); pb.neck(16, 0, 0); pb.head(16, 0, 0);
  if (c.posture === 'stand') { pb.p.hp[2] -= 0.05; pb.leg(L, 8, 8, 16, 0); pb.leg(R, 8, 8, 16, 0); }
} });

def('wipe', { loop: true, dur: 1.6, look: false, pose: (c) => {
  base(c);
  const pb = c.pb, t = c.t;
  const a = t * TAU / 1.6 * 1.5;
  pb.arm(R, 62 + 8 * sin(a), -10 + 28 * cos(a), 20, 28 + 10 * sin(a), 20);
  pb.arm(L, 55, 10, 10, 30, 30);
  pb.spine(26, -6 * cos(a), 0); pb.chest(16, -8 * cos(a), 0); pb.neck(12, 0, 0); pb.head(14, -6 * cos(a), 0);
  if (c.posture === 'stand') { pb.p.hp[2] -= 0.07; pb.leg(L, 10, 8, 14, 0); pb.leg(R, 4, 8, 8, 0); }
} });

def('push_cart', { loop: true, dur: 1, loco: true, posture: 'stand', pose: (c) => {
  loco(c, { arms: false, lean: 10, stride: 0.85 });
  const pb = c.pb;
  const bob = sin(c.phase * TAU * 2) * 2 * c.moveW;
  pb.arm(L, 58 + bob, 4, 30, 42, 25); pb.arm(R, 58 + bob, 4, 30, 42, 25);
  pb.add(B.chest, 6, 0, 0);
} });

def('sad', { loop: true, dur: 4, loco: true, posture: 'stand', carry: true, pose: (c) => {
  loco(c, { stride: 0.7, armSwing: 0.3, lean: 6 });
  const pb = c.pb, t = c.t + c.rnd * 3;
  pb.add(B.spine, 6, 0, 0); pb.add(B.chest, 8, 0, 0); pb.neck(16, 0, 0); pb.head(14 + 2 * sin(t * 0.5), 4 * sin(t * 0.3), 4);
  pb.clav(1, -6, 10); pb.clav(-1, -6, 10);
} });

def('tug', { loop: true, dur: 0.8, posture: 'stand', fade: 0.2, pose: (c) => {
  const pb = c.pb, t = c.t;
  const pull = 0.5 + 0.5 * sin(t * TAU * 1.6);
  const jit = sin(t * 31) * 1.5;
  pb.hips(0, -0.07 - 0.02 * pull, -0.06 - 0.03 * pull, -16 - 6 * pull, 8, jit * 0.3);
  pb.legSA(L, 22, 8, 40, -10); pb.legSA(R, -18, 8, 25 + 10 * pull, 10);
  pb.spine(-12 - 6 * pull, -6, 0); pb.chest(-6, -6, jit * 0.5);
  pb.neck(14, 0, 0); pb.head(8 + jit, 0, 0);
  pb.arm(L, 62 - 6 * pull, -12, 40, 25 + 15 * pull, 10); pb.arm(R, 58 - 6 * pull, -20, 40, 30 + 15 * pull, 10);
  pb.clav(1, 0, 10); pb.clav(-1, 0, 10);
} });

def('pray', { loop: true, dur: 4, fade: 0.5, pose: (c) => {
  base(c);
  const pb = c.pb, t = c.t;
  const bow = c.t < 2.4 ? env(c.t / 2.4, 0.2, 0.45, 0.6, 0.95) : 0;
  // wai: palms together at chest/face height
  pb.arm(L, 34, -50, 85, 128, -25, 0); pb.arm(R, 34, -50, 85, 128, -25, 0);
  pb.spine(4 + 14 * bow, 0, 0); pb.chest(2 + 10 * bow, 0, 0); pb.neck(10 + 10 * bow, 0, 0); pb.head(12 + 8 * bow, 0, 0);
  void t;
} });

def('carry_heavy', { loop: true, dur: 1, loco: true, posture: 'stand', pose: (c) => {
  const cc = { ...c, speed: Math.min(c.speed, 1.4) };
  loco(cc, { heavy: 1, arms: false, stride: 0.75 });
  const pb = c.pb, t = c.gt;
  const wob = sin(t * 3.3) * 3;
  pb.arm(L, 48 + wob, -22, 60, 75, 10); pb.arm(R, 48 - wob, -22, 60, 75, 10);
  pb.add(B.spine, 6, 0, wob * 0.6); pb.add(B.chest, 4, 0, 0); pb.neck(-14, 0, 0); pb.head(-8, 0, wob);
} });

def('fall', { loop: false, dur: 1.3, hold: true, look: false, face: 'shock', posture: 'lie', fade: 0.06, pose: (c) => {
  const pb = c.pb, k = c.k;
  if (k < 0.55) {
    // stagger & topple backwards
    const a = sm(0, 0.55, k);
    loco({ ...c, moveW: 0 }, { arms: false });
    pb.hips(0, -0.25 * a * a, 0.08 * a, -60 * a * a, 0, 8 * a);
    pb.leg(L, 30 * a, 12, 40 * a, -10); pb.leg(R, 50 * a, 6, 60 * a, -15);
    pb.arm(L, 100 + 40 * a, 60, 0, 30, 0); pb.arm(R, 110 + 30 * a, 50, 0, 40, 0);
    pb.spine(-15 * a, 0, 0); pb.head(-20 * a, 10, 0);
  } else {
    lieBack(c, sm(0.55, 1, k));
    const bounce = env(k, 0.55, 0.65, 0.68, 0.85) * 0.03;
    pb.p.hp[1] += bounce;
  }
} });

def('wake_up', { loop: false, dur: 2.6, look: false, posture: 'stand', fade: 0.2, pose: (c) => {
  const pb = c.pb, k = c.k;
  if (k < 0.3) { lieSide(c, 1 - k); return; }
  if (k < 0.62) {
    // sit up on the floor, rub eyes
    const a = sm(0.3, 0.62, k);
    floorBase(c);
    pb.p.hp[1] = lerp(0.16 / c.s - 0.95, 0.13 / c.s - 0.95, a);
    pb.arm(L, 60, -20, 30, 150, -20); pb.arm(R, 40 + 20 * a, -10, 30, 120, -10);
    pb.head(10 - 15 * a, 10 * sin(c.t * 3), 0);
    return;
  }
  // stand up via a crouch, then stretch
  const a = sm(0.62, 0.86, k), st = env(k, 0.82, 0.9, 0.96, 1);
  loco({ ...c, moveW: 0 });
  pb.hips(0, lerp(-0.45, 0, a), lerp(-0.1, 0, a), lerp(40, 0, a), 0, 0);
  pb.leg(L, lerp(100, 2, a), 10, lerp(130, 4, a), 0); pb.leg(R, lerp(80, 2, a), 10, lerp(120, 4, a), 0);
  pb.spine(lerp(20, 0, a) - 8 * st, 0, 0);
  pb.arm(L, lerp(30, 170, st), 25, 30, lerp(30, 20, st), 0); pb.arm(R, lerp(30, 170, st), 25, 30, lerp(30, 20, st), 0);
  pb.head(-15 * st, 0, 0);
} });

def('jenga_pull', { loop: true, dur: 4, posture: 'sit', fade: 0.4, pose: (c) => {
  sitBase(c, 0.42, 0.4);
  const pb = c.pb, t = c.t + c.rnd * 4;
  const pull = sm(0.2, 0.9, (t % 4) / 4);
  const tremble = sin(t * 23) * 0.8;
  // lean in toward the tower, but keep the head up (the rig's look-at aims the eyes)
  pb.spine(10, -5, 0); pb.chest(6, -6, 0); pb.neck(2, 0, 0); pb.head(5, 8, 3);
  pb.arm(R, 72 - 4 * pull, -12, 40, 26 + 14 * pull, -10 + tremble, tremble);
  pb.arm(L, 40, 6, 0, 60, 10);
} });

def('stand_cool', { loop: true, dur: 5, posture: 'stand', fade: 0.4, pose: (c) => {
  const pb = c.pb, t = c.t + c.rnd * 4;
  const br = sin(t * 1.4);
  pb.hips(0.035, -0.012, 0, 0, 8, -4);
  pb.legSA(L, 0, 5, 3, 0); pb.legSA(R, 12, 9, 22, 6);
  pb.spine(-2, -6, 3); pb.chest(-4 + br * 0.6, -6, 2);
  pb.neck(-4, 10 + 2 * sin(t * 0.3), 0); pb.head(-6, 12 + 3 * sin(t * 0.3), -5);
  // hand in pocket, other hand loose (or holding a jenga block)
  pb.arm(R, 12, 22, -30, 38, 20); pb.arm(L, 16, 14, -20, 30 + 4 * br, 10);
  pb.clav(1, 2, 0); pb.clav(-1, -3, 6);
} });

// ------------------------------------------------------------------ cinematic hero poses
// Manga-style "standing" poses (twisted torsos, hands framing the face, pointed fingers, leaning back).
// They snap in with a little overshoot, then hold with slow breathing and a faint sway.

/** 0 → 1 with a small overshoot over the first ~0.7 s of a pose */
const snapIn = (t: number) => track(Math.min(1, t / 0.75), [[0, 0], [0.55, 1.08], [0.8, 0.98], [1, 1]]);

function holdBreath(c: AnimCtx, amp = 1) {
  const pb = c.pb, t = c.t + c.rnd * 7;
  const br = sin(t * 1.25) * amp;
  pb.add(B.chest, -1.2 * br, 0, 0);
  pb.add(B.clav_l, 0, 0, 1.4 * br); pb.add(B.clav_r, 0, 0, -1.4 * br);
  pb.add(B.head, 0.6 * br, 0.8 * sin(t * 0.37), 0);
  pb.p.hp[1] += 0.003 * br;
}

def('cine_point', { loop: true, dur: 4, fade: 0.32, posture: 'stand', expr: 'determined', look: false, pose: (c) => {
  const pb = c.pb, e = snapIn(c.t);
  // turned 3/4 away, chest counter-twisted back to the target, accusing finger thrust forward
  pb.hips(0.02, -0.045, 0.01, -2, -32 * e, -3);
  pb.legSA(L, 20, 12, 22, -4); pb.legSA(R, -16, 13, 5, 8);
  pb.spine(-6 * e, 14 * e, 2); pb.chest(-9 * e, 30 * e, 3);
  pb.neck(-4, -6 * e, 0); pb.head(-9 * e, -12 * e, 7 * e);
  pb.arm(R, 76, -4, -10, 3, 6, 0); pb.hand(R, 'point');
  pb.arm(L, 24, 72, -45, 104, 10, 0); pb.hand(L, 'flat');
  pb.clav(-1, 6, 10); pb.clav(1, -2, 0);
  holdBreath(c);
} });

def('cine_twist', { loop: true, dur: 4, fade: 0.38, posture: 'stand', expr: 'smug', look: false, pose: (c) => {
  const pb = c.pb, e = snapIn(c.t);
  // weight on the right leg, hip cocked, torso wrung the other way, head thrown back over the shoulder
  pb.hips(-0.035, -0.02, 0, -4, 24 * e, 9 * e);
  pb.legSA(R, 2, 6, 5, 0); pb.leg(L, 22, -30, 42, 32);
  pb.spine(-8 * e, -22 * e, -6 * e); pb.chest(-10 * e, -34 * e, -12 * e);
  pb.neck(-6, 18 * e, -8 * e); pb.head(-16 * e, 26 * e, -14 * e);
  // one hand splayed over the brow, the other framing the face from across the body
  pb.arm(L, 150, 38, 60, 128, -24, 0); pb.hand(L, 'frame');
  pb.arm(R, 70, -58, 82, 150, -38, 0); pb.hand(R, 'claw');
  pb.clav(1, 14, 4); pb.clav(-1, 4, 14);
  holdBreath(c, 0.8);
} });

def('cine_lean', { loop: true, dur: 4, fade: 0.4, posture: 'stand', expr: 'cool', look: false, pose: (c) => {
  const pb = c.pb, e = snapIn(c.t);
  // leaning back, looking down the nose, arms opened wide, palms out
  pb.hips(0, -0.025, 0.05, -10 * e, 0, 0);
  pb.legSA(L, 7, 16, 7, 0); pb.legSA(R, -5, 16, 5, 0);
  pb.spine(-13 * e, 0, 0); pb.chest(-12 * e, 4 * e, 0);
  pb.neck(8 * e, 0, 0); pb.head(15 * e, -6, 6 * e);
  pb.arm(L, 52, 104, -82, 14, -24, 0); pb.arm(R, 52, 104, -82, 14, -24, 0);
  pb.hands('open');
  pb.clav(1, 4, -6); pb.clav(-1, 4, -6);
  holdBreath(c);
} });

def('cine_menace', { loop: true, dur: 4, fade: 0.42, posture: 'stand', expr: 'menace', look: false, pose: (c) => {
  const pb = c.pb, e = snapIn(c.t), t = c.t + c.rnd * 5;
  // hunched, knees deep, turned side-on, glaring up from under the brows
  pb.hips(-0.04, -0.1 * e, -0.02, 16 * e, -38 * e, 0);
  pb.legSA(L, 30, 15, 58, -10); pb.legSA(R, -17, 15, 8, 16);
  pb.spine(12 * e, 18 * e, -6); pb.chest(10 * e, 22 * e, -8);
  pb.neck(-6, 10, 0); pb.head(-18 * e, 16 * e, 9 + 1.5 * sin(t * 0.9));
  pb.arm(R, 36, -18, 30, 42, 22, 0); pb.hand(R, 'claw');
  pb.arm(L, 78, 12, 52, 142, 0, 0); pb.hand(L, 'fist');
  pb.clav(1, 16, 8); pb.clav(-1, 12, 10);
  holdBreath(c, 1.3);
} });

def('cine_cross', { loop: true, dur: 4.5, fade: 0.35, posture: 'stand', expr: 'cool', pose: (c) => {
  const pb = c.pb, e = snapIn(c.t);
  // arms folded high, chest out, chin up, weight on one leg
  pb.hips(0.03, -0.01, 0, 0, 10 * e, -3);
  pb.legSA(L, 0, 8, 3, 0); pb.legSA(R, 9, 15, 13, 4);
  pb.spine(-3, -4, 1); pb.chest(-7 * e, -6, 2);
  pb.neck(-5, 6, 0); pb.head(-10 * e, 10 * e, -6);
  pb.arm(L, 40, -72, 62, 112, 4, 0); pb.arm(R, 35, -78, 64, 106, 4, 0);
  pb.hands('grip');
  holdBreath(c);
} });

def('cine_hair', { loop: true, dur: 4, fade: 0.3, posture: 'stand', expr: 'cool', look: false, pose: (c) => {
  const pb = c.pb, t = c.t;
  // a slow sweep of the hand back through the hair, then holds it there; other hand on the hip
  const sw = sm(0.15, 1.15, t);
  const flick = env(Math.min(t, 1.6), 0.9, 1.15, 1.25, 1.6);
  pb.hips(-0.03, -0.015, 0, -2, 14, 7);
  pb.legSA(R, 0, 6, 4, 0); pb.legSA(L, 12, 12, 20, 6);
  pb.spine(-4, -6, -4); pb.chest(-6 - 4 * sw, -8, -6 * sw);
  pb.neck(-4 * sw, -8, -6 * sw); pb.head(-12 * sw + 4 * flick, -14, -12 * sw);
  pb.arm(R, lerp(118, 166, sw), lerp(-12, 46, sw), 40, lerp(150, 112, sw), lerp(-10, 20, sw), 0);
  pb.hand(R, sw < 0.8 ? 'claw' : 'relax');
  pb.arm(L, 25, 74, -42, 102, 12, 0); pb.hand(L, 'flat');
  holdBreath(c, 0.8);
} });

// ------------------------------------------------------------------ everyday acting

def('stretch', { loop: false, dur: 3.6, fade: 0.3, posture: 'stand', look: false, exprAt: (k) => (k > 0.18 && k < 0.72 ? 'yawn' : k < 0.85 ? 'sleepy' : null), pose: (c) => {
  base(c);
  const pb = c.pb, k = c.k;
  const up = env(k, 0.06, 0.3, 0.78, 0.96);
  const sway = sin(sm(0.35, 0.72, k) * TAU) * env(k, 0.35, 0.42, 0.66, 0.72);
  const toes = env(k, 0.22, 0.34, 0.62, 0.74);
  pb.arm(L, lerp(12, 172, up), lerp(10, -14, up), lerp(0, 70, up), lerp(14, 24, up), lerp(0, 30, up));
  pb.arm(R, lerp(12, 172, up), lerp(10, -14, up), lerp(0, 70, up), lerp(14, 24, up), lerp(0, 30, up));
  pb.hands(up > 0.6 ? 'grip' : 'relax');
  pb.spine(-8 * up, 0, 9 * sway); pb.chest(-10 * up, 0, 7 * sway);
  pb.neck(-6 * up, 0, 0); pb.head(-14 * up, 0, -4 * sway);
  pb.clav(1, 18 * up, 0); pb.clav(-1, 18 * up, 0);
  if (c.posture === 'stand') { pb.p.hp[1] += 0.025 * toes; pb.leg(L, 0, 6, 2, 26 * toes); pb.leg(R, 0, 6, 2, 26 * toes); }
} });

def('look_around', { loop: false, dur: 3.4, fade: 0.25, look: false, expr: 'think', pose: (c) => {
  base(c);
  const pb = c.pb, k = c.k;
  const yaw = track(k, [[0, 0], [0.1, 0], [0.28, 48], [0.42, 46], [0.58, -50], [0.75, -48], [0.92, 0], [1, 0]]);
  const shade = env(k, 0.5, 0.6, 0.78, 0.9);
  pb.add(B.spine, 0, yaw * 0.15, 0); pb.add(B.chest, 0, yaw * 0.25, 0);
  pb.neck(-2, yaw * 0.25, 0); pb.head(-4 - 4 * shade, yaw * 0.35, 3 * sin(c.t * 2));
  // shading the eyes with a flat hand on the second look
  if (shade > 0) { pb.arm(R, lerp(12, 112, shade), lerp(10, -22, shade), lerp(0, -30, shade), lerp(14, 128, shade), lerp(0, 20, shade)); pb.hand(R, 'flat', shade); }
} });

def('nod', { loop: false, dur: 1.15, fade: 0.12, expr: 'happy', pose: (c) => {
  base(c);
  const pb = c.pb, k = c.k;
  const n = track(k, [[0, 0], [0.12, 0], [0.26, 1], [0.4, -0.15], [0.55, 0.85], [0.72, -0.1], [0.88, 0], [1, 0]]);
  pb.add(B.neck, 7 * n, 0, 0); pb.add(B.head, 11 * n, 0, 0); pb.add(B.chest, 2 * n, 0, 0);
} });

def('laugh', { loop: true, dur: 2.6, fade: 0.2, expr: 'laugh', mouth: 'laugh', pose: (c) => {
  base(c);
  const pb = c.pb, t = c.t + c.rnd * 3, k = c.k;
  const big = 0.5 + 0.5 * sin(k * TAU - 1);              // swells and fades within the loop
  const ha = Math.sqrt(sin(t * 15) ** 2 + 0.04) * (0.4 + 0.6 * big);  // "ha-ha-ha" shoulder bounce
  const slap = env((k * 2) % 1, 0.3, 0.42, 0.46, 0.6) * big;
  pb.add(B.spine, -4 * big + 3 * ha, 0, 0); pb.add(B.chest, -8 * big + 4 * ha, 3 * sin(t * 1.3), 0);
  pb.neck(-10 * big, 0, 3 * sin(t * 1.1)); pb.head(-16 * big + 5 * ha, 6 * sin(t * 0.9), 5 * sin(t * 1.4));
  pb.clav(1, 6 * ha, 0); pb.clav(-1, 6 * ha, 0);
  pb.arm(L, 28, -34, 50, 96, 10); pb.hand(L, 'flat');     // hand on the belly
  pb.arm(R, lerp(30, 58, slap), lerp(18, 4, slap), 40, lerp(40, 20, slap), -10); pb.hand(R, 'flat');
  if (c.posture === 'stand') pb.p.hp[1] -= 0.012 * big;
} });

def('facepalm', { loop: false, dur: 2.6, fade: 0.18, exprAt: (k) => (k < 0.2 ? 'disgust' : k < 0.88 ? 'pain' : 'sad'), pose: (c) => {
  base(c);
  const pb = c.pb, k = c.k;
  const up = env(k, 0.08, 0.28, 0.82, 0.98);
  const shake = sin(c.t * 7) * 6 * env(k, 0.35, 0.45, 0.72, 0.8);
  pb.arm(R, lerp(12, 64, up), lerp(10, -24, up), lerp(0, 60, up), lerp(14, 152, up), lerp(0, 34, up)); pb.hand(R, 'flat', up);
  pb.arm(L, 24, 74, -42, 100, 12); pb.hand(L, 'flat');
  pb.add(B.spine, 6 * up, 0, 0); pb.add(B.chest, 6 * up, 0, 0);
  pb.neck(14 * up, shake * 0.4, 0); pb.head(16 * up, shake, 0);
} });

def('handshake', { loop: false, dur: 2.2, fade: 0.2, expr: 'happy', pose: (c) => {
  base(c);
  const pb = c.pb, k = c.k;
  // reach (palm sideways), grip, two firm pumps, release
  const out = env(k, 0.04, 0.26, 0.82, 0.98);
  const grip = env(k, 0.24, 0.3, 0.8, 0.86);
  const pump = sin(sm(0.32, 0.74, k) * Math.PI * 4) * env(k, 0.3, 0.36, 0.7, 0.76);
  pb.arm(R, lerp(12, 62, out) + 9 * pump, lerp(10, -6, out), lerp(0, 72, out), lerp(14, 34, out) - 6 * pump, lerp(0, -6, out) + 6 * pump, 0);
  pb.hand(R, grip > 0.5 ? 'grip' : 'flat');
  pb.add(B.spine, 5 * out, 0, 0); pb.add(B.chest, 4 * out, -6 * out, 0);
  pb.head(4 * out + 3 * pump, -3 * out, 0);
  pb.clav(-1, 0, 8 * out);
} });

def('sneak', { loop: true, dur: 1, posture: 'stand', fade: 0.3, expr: 'determined', pose: (c) => {
  const pb = c.pb, t = c.t, v = Math.min(c.speed, 2);
  // cartoon tiptoe: slow, exaggerated high steps, crouched, hands up in front, looking around
  const moving = sm(0.08, 0.4, v);
  const ph = c.phase % 1;                                        // integrated by the rig (no jumps on speed changes)
  const uL = ph, uR = (ph + 0.5) % 1;
  const bob = Math.abs(sin(ph * TAU)) * 0.03 * moving;
  pb.hips(0.01 * sin(ph * TAU) * moving, -0.11 + bob, -0.03, 12, 6 * sin(ph * TAU) * moving, 3 * sin(ph * TAU) * moving);
  const legOne = (side: number, u: number) => {
    const swing = u > 0.5 ? sin((u - 0.5) * TAU) : 0;           // high knee lift in the swing half
    const hip = (cos(u * TAU) * 24 + 26) * moving + 30 * (1 - moving);
    const knee = (52 + 58 * swing) * moving + 58 * (1 - moving);
    pb.legSA(side, hip - 10, 9, knee, 24 + 12 * swing * moving);
  };
  legOne(L, uL); legOne(R, uR);
  pb.spine(14, 0, 0); pb.chest(8, 8 * sin(t * 0.8), 0);
  pb.neck(-14, 18 * sin(t * 0.9), 0); pb.head(-8, 22 * sin(t * 0.9 + 0.4), 4 * sin(t * 1.7));
  const lift = 0.5 + 0.5 * sin(ph * TAU * 2) * moving;
  pb.arm(L, 64 + 6 * lift, 18, 40, 112, 46, 0); pb.arm(R, 64 + 6 * (1 - lift), 18, 40, 112, 46, 0);
  pb.hands('relax'); pb.clav(1, 12, 6); pb.clav(-1, 12, 6);
} });

def('lecture', { loop: true, dur: 4.2, fade: 0.28, expr: 'angry', mouth: 'talk', exprAt: (k) => (k > 0.86 ? 'sad' : k > 0.45 ? 'determined' : null), pose: (c) => {
  base(c);
  const pb = c.pb, k = c.k, t = c.t + c.rnd * 4;
  // 1) finger raised and wagging, head shaking  2) jabbing a finger into the open palm  3) sigh, hands drop
  const wag = env(k, 0.02, 0.1, 0.4, 0.48);
  const tap = env(k, 0.44, 0.52, 0.8, 0.88);
  const sigh = env(k, 0.84, 0.9, 0.97, 1);
  const wig = sin(t * 13) * wag;
  pb.arm(R, lerp(14, 52, wag) + lerp(0, 44, tap), lerp(10, -8, wag) + lerp(0, -36, tap), lerp(0, 40, wag), lerp(14, 128, wag) + lerp(0, 70, tap) - 40 * tap * pos(sin(t * 9)), lerp(0, -10, wag) + 18 * tap * pos(sin(t * 9)), 22 * wig);
  pb.hand(R, wag + tap > 0.3 ? 'point' : 'relax');
  pb.arm(L, lerp(18, 42, tap), lerp(10, -28, tap), lerp(0, -80, tap), lerp(18, 88, tap), lerp(0, -10, tap)); pb.hand(L, 'flat', tap);
  pb.add(B.spine, 6 * (wag + tap) + 4 * sigh, 0, 0); pb.add(B.chest, 4 * wag, 0, 0);
  pb.neck(-6 * wag + 10 * tap, 12 * sin(t * 5.5) * wag, 0);
  pb.head(-4 * wag + 12 * tap + 10 * sigh, 10 * sin(t * 5.5) * wag + 4 * sin(t * 0.9), 4 * sin(t * 1.3));
  pb.clav(1, -6 * sigh, 0); pb.clav(-1, -6 * sigh, 0);
} });

// ------------------------------------------------------------------ expressions, mouths and hands for the older anims
const DRESS: Partial<Record<AnimName, { expr?: ExprKey; mouth?: AnimDef['mouth']; l?: string; r?: string }>> = {
  slap: { expr: 'angry', r: 'flat' }, get_slapped: { expr: 'pain' }, highfive: { expr: 'laugh', r: 'open' }, think: { expr: 'think', r: 'relax' },
  scream_run: { expr: 'scream', mouth: 'scream', l: 'open', r: 'open' }, drunk: { expr: 'drunk' }, celebrate: { expr: 'laugh', mouth: 'laugh', l: 'fist', r: 'fist' },
  dance: { expr: 'happy', l: 'flat', r: 'flat' }, eat: { mouth: 'chew', r: 'grip' }, drink: { r: 'grip' }, cook_stir: { expr: 'determined', l: 'grip', r: 'grip' },
  chop: { expr: 'determined', l: 'flat', r: 'grip' }, wash: { l: 'flat', r: 'flat' }, wipe: { r: 'flat' }, point: { r: 'point' }, wave: { expr: 'happy', r: 'open' },
  talk: { mouth: 'talk' }, angry: { expr: 'angry', l: 'fist', r: 'fist' }, push_cart: { l: 'grip', r: 'grip' }, sad: { expr: 'sad' }, tug: { expr: 'pain', l: 'fist', r: 'fist' },
  give: { expr: 'happy', r: 'flat' }, pray: { expr: 'sleepy', l: 'flat', r: 'flat' }, carry_heavy: { expr: 'pain', l: 'grip', r: 'grip' }, fall: { expr: 'shocked' },
  jenga_pull: { expr: 'determined', r: 'point' }, stand_cool: { expr: 'cool' }, casino_cheer: { expr: 'laugh', mouth: 'laugh', l: 'fist', r: 'fist' },
  casino_despair: { expr: 'pain', l: 'claw', r: 'claw' }, shrug: { expr: 'smug', l: 'open', r: 'open' }, count_coins: { expr: 'smug', l: 'grip', r: 'grip' },
  sleep: { expr: 'sleep' }, lie_cardboard: { expr: 'sleep' }, sit_floor: {}, tpose: { l: 'flat', r: 'flat' },
};
for (const [name, d] of Object.entries(DRESS) as [AnimName, NonNullable<(typeof DRESS)[AnimName]>][]) {
  const a = A[name];
  if (!a) continue;
  if (d.expr && !a.expr) a.expr = d.expr;
  if (d.mouth && !a.mouth) a.mouth = d.mouth;
  if (d.l || d.r) {
    const orig = a.pose;
    a.pose = (c) => { orig(c); if (d.l) c.pb.hand(L, d.l as any); if (d.r) c.pb.hand(R, d.r as any); };
  }
}
A.wake_up!.exprAt = (k) => (k < 0.4 ? 'sleep' : k < 0.75 ? 'sleepy' : 'yawn');

export const ANIMS = A as Record<AnimName, AnimDef>;
export const ANIM_NAMES = Object.keys(A) as AnimName[];

// ------------------------------------------------------------------ idle fidgets (internal)

export type Fidget = (c: AnimCtx, w: number, k: number) => void;
export const FIDGETS: Fidget[] = [
  // wipe sweat from the forehead (it's HOT)
  (c, w, k) => { const pb = c.pb; const a = env(k, 0.1, 0.3, 0.7, 0.9); if (a <= 0) return; pb.arm(R, lerp(10, 112, a * w), lerp(10, -25, a * w), 30 * a, lerp(15, 135, a * w), -20 * a + 15 * sin(k * 30) * a); pb.add(B.head, -6 * a * w, 0, 0); },
  // scratch head
  (c, w, k) => { const pb = c.pb; const a = env(k, 0.1, 0.3, 0.75, 0.95); if (a <= 0) return; pb.arm(L, lerp(10, 135, a * w), lerp(10, 40, a * w), 20, lerp(15, 120, a * w), 10 * sin(k * 60) * a); pb.add(B.head, 4 * a * w, 0, -6 * a * w); },
  // look around
  (c, w, k) => { const pb = c.pb; const a = sin(k * Math.PI); pb.add(B.neck, 0, 25 * sin(k * TAU) * w * a, 0); pb.add(B.head, 0, 30 * sin(k * TAU) * w * a, 0); },
  // stretch back
  (c, w, k) => { const pb = c.pb; const a = env(k, 0.15, 0.4, 0.65, 0.9) * w; if (a <= 0) return; pb.add(B.spine, -10 * a, 0, 0); pb.add(B.chest, -8 * a, 0, 0); pb.arm(L, lerp(10, 25, a), lerp(10, 160, a), 0, lerp(15, 110, a), 0); pb.arm(R, lerp(10, 25, a), lerp(10, 160, a), 0, lerp(15, 110, a), 0); },
  // hands on hips
  (c, w, k) => { const pb = c.pb; const a = env(k, 0.1, 0.25, 0.8, 0.95) * w; if (a <= 0) return; pb.arm(L, lerp(10, 28, a), lerp(10, 70, a), -40 * a, lerp(15, 95, a), 0); pb.arm(R, lerp(10, 28, a), lerp(10, 70, a), -40 * a, lerp(15, 95, a), 0); },
  // check phone / watch (left wrist)
  (c, w, k) => { const pb = c.pb; const a = env(k, 0.1, 0.3, 0.7, 0.9) * w; if (a <= 0) return; pb.arm(L, lerp(10, 45, a), lerp(10, -20, a), 50 * a, lerp(15, 110, a), 0); pb.add(B.neck, 10 * a, 6 * a, 0); pb.add(B.head, 12 * a, 6 * a, 0); },
];
