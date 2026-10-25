import * as THREE from 'three';
import type { AnimName, CarryPose, FaceVariant } from '../../game/contracts';
import { PoseBuilder, env, lerp, sm, track } from './pose';
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
  const sway = idle * (0.011 * sin(gt * 0.45) + 0.004 * sin(gt * 1.3)) + drunk * 0.04 * sin(gt * 0.9);
  const yawP = (4 + v * 1.5) * cos(TAU * uL) * mw * (1 - rw * 0.3);
  const rollP = idle * 1.6 * sin(gt * 0.45) + mw * 2.5 * sin(TAU * 2 * uL) * (1 - rw) + drunk * 5 * sin(gt * 0.9 + 1);
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
    // idle: weight on one leg, other relaxed
    const relax = idle * (sin(gt * 0.45) * side > 0 ? 0 : 6);
    const abd = 3 + bld * 3 - (c.female ? 1.5 : 0) + drunk * 4;
    pb.legSA(side, hip + idle * (side > 0 ? 1 : -1) * 0.5, abd, knee + relax, foot - relax * 0.3);
  };
  legOne(1, uL); legOne(-1, uR);
  // ---- spine & head
  const breathe = sin(gt * 1.7) * 1.1 * (1 + rw);
  pb.spine(leanF * 0.45 + idle * 0.5, -yawP * 0.6, -rollP * 0.4);
  pb.chest(leanF * 0.3 + breathe * 0.4 + age * 4, -yawP * 0.5, -rollP * 0.3 + drunk * 6 * sin(gt * 0.7));
  const lookDrift = idle * (6 * sin(gt * 0.23) + 3 * sin(gt * 0.61));
  pb.neck(-leanF * 0.35 - age * 5, lookDrift * 0.4, drunk * 10 * sin(gt * 0.8));
  pb.head(-leanF * 0.25 + idle * 2 * sin(gt * 0.31) - age * 4, lookDrift * 0.6, drunk * 12 * sin(gt * 0.6 + 2));
  // ---- arms
  if (st.arms !== false) {
    const armSwing = lerp(6 + v * 8, 34, rw) * (st.armSwing ?? 1) * mw * (1 - heavy * 0.6);
    for (const side of [1, -1]) {
      const u = side > 0 ? uR : uL; // opposite leg
      const sw = armSwing * cos(TAU * u);
      const elbow = lerp(12 + v * 5 + Math.max(0, sw) * 0.35, 88, rw) * mw + idle * (10 + age * 8) + drunk * 10;
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
  if (c.posture === 'stand') { pb.legSA(R, -12 * Math.max(0, wind) + 18 * Math.max(0, -wind), 6, 10, 0); pb.p.hp[2] += -0.04 * wind; }
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
  if (c.posture === 'stand') { pb.p.hp[0] += -0.08 * snap; pb.p.hp[1] += 0.03 * Math.max(0, snap - 0.9); pb.legSA(L, 0, 18 * snap + 4, 16 * snap, 0); }
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
  const jump = Math.max(0, sin(u * TAU)) * 0.14;
  const crouch = Math.max(0, -sin(u * TAU)) * 0.08;
  pb.hips(0, jump - crouch, 0, 4, 0, 0);
  const kn = crouch * 500;
  pb.leg(L, kn * 0.5, 8, kn, jump > 0.02 ? 15 : 0); pb.leg(R, kn * 0.5, 8, kn, jump > 0.02 ? 15 : 0);
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
  pb.leg(L, 8 + 10 * Math.max(0, sway), 8, 12 + 20 * bounce + 25 * Math.max(0, sway), 0);
  pb.leg(R, 8 + 10 * Math.max(0, -sway), 8, 12 + 20 * bounce + 25 * Math.max(0, -sway), 0);
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
  const chew = lift > 0.9 ? sin(c.t * 14) * 2 : 0;
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
  const toss = Math.max(0, sin(t * TAU / 1.2 * 2)) ;
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
  pb.spine(20, -6, 0); pb.chest(14, -8, 0); pb.neck(8, 0, 0); pb.head(16, 10, 4);
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
