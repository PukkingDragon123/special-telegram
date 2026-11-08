import type { Expression, FaceVariant } from '../../game/contracts';

/* ============================================================================================
 * Animated faces on top of the static photo faces.
 * The photo stays in the atlas; the atlas shader (rigglb.ts, FACE_EXPR_F) warps the UVs of the brow /
 * eye / mouth regions of the eye-aligned 512² face (eyes (0.36,0.44)/(0.64,0.44), mouth (0.5,0.73)),
 * paints eyelids in the face's own lid skin (blinks, squints, closed eyes), a dark mouth interior with
 * teeth and tongue (talking, laughing, shock), moves the irises (saccades / look-at) and the wet-eye
 * catchlights with them.
 * FaceRig blends expression targets, adds automatic blinking, talk mouth-flap, micro-expressions and
 * eye saccades, and packs everything into 20 floats (uniform vec4 uFace[5]).
 * ========================================================================================== */

/** parameter slots (L = character's left = image right) */
export const enum FP {
  browUpL, browUpR, browInL, browInR, lidL, lidR, squintL, squintR, smileL, smileR,
  open, wide, teeth, cheek, sneer, gazeX, gazeY, shiftX, tongue, _pad,
}
export const FP_N = 20;

type P = Partial<Record<keyof typeof NAMES, number>>;
const NAMES = {
  browUp: 0, browUpL: 0, browUpR: 0, browIn: 0, browInL: 0, browInR: 0, lid: 0, lidL: 0, lidR: 0, squint: 0, squintL: 0, squintR: 0,
  smile: 0, smileL: 0, smileR: 0, open: 0, wide: 0, teeth: 0, cheek: 0, sneer: 0, gazeX: 0, gazeY: 0, shiftX: 0, tongue: 0,
};

/** expression → parameters. Extra internal keys: think, scream, yawn, chew, menace, cool */
const TABLE: Record<string, P> = {
  neutral: {},
  happy: { smile: 0.7, cheek: 0.45, squint: 0.3, browUp: 0.12, open: 0.06, teeth: 0.55 },
  laugh: { smile: 1, cheek: 0.9, squint: 0.65, lid: 0.22, browUp: 0.3, browIn: 0.25, open: 0.45, wide: 0.35, teeth: 1, tongue: 0.6 },
  smug: { smileL: 0.75, smileR: 0.1, shiftX: 0.18, lid: 0.38, browUpR: 0.45, browUpL: -0.15, cheek: 0.2, squintL: 0.25 },
  angry: { browIn: -1, browUp: -0.45, squint: 0.45, lid: -0.15, smile: -0.45, open: 0.1, teeth: 0.9, sneer: 0.45, wide: 0.25 },
  shocked: { browUp: 1, browIn: 0.35, lid: -0.75, open: 0.62, wide: -0.3, teeth: 0.35, tongue: 0.3 },
  scared: { browIn: 1, browUp: 0.65, lid: -0.5, open: 0.32, wide: 0.55, smile: -0.35, teeth: 0.8 },
  sad: { browIn: 1, browUp: -0.15, lid: 0.32, smile: -0.65, gazeY: -0.45, wide: -0.1 },
  determined: { browIn: -0.55, browUp: -0.25, squint: 0.38, smile: -0.12, wide: -0.12, lid: 0.08 },
  disgust: { sneer: 1, browIn: -0.45, browUpR: 0.15, squintL: 0.55, squintR: 0.3, smileL: -0.35, smileR: 0.15, shiftX: -0.15, open: 0.1, teeth: 0.55 },
  wink: { lidL: 1, squintL: 0.6, smileL: 0.55, smileR: 0.3, cheek: 0.45, browUpR: 0.35, browUpL: -0.2, shiftX: 0.12 },
  sleepy: { lid: 0.62, browUp: -0.12, browIn: 0.15, open: 0.04, gazeY: -0.3 },
  drunk: { lidL: 0.55, lidR: 0.4, smile: 0.3, smileR: 0.45, open: 0.14, browUpL: 0.25, browIn: 0.2, cheek: 0.2 },
  pain: { browIn: 0.85, browUp: -0.1, squint: 0.85, lid: 0.55, smile: -0.5, open: 0.26, wide: 0.75, teeth: 1, sneer: 0.5 },
  // internal
  think: { browUpL: 0.65, browUpR: -0.2, browInR: -0.2, smileL: -0.15, smileR: 0.15, shiftX: -0.22, wide: -0.25, gazeX: 0.45, gazeY: 0.55, squintR: 0.2 },
  scream: { browUp: 0.85, browIn: 0.9, lid: -0.6, open: 1, wide: 0.25, teeth: 0.9, tongue: 0.7, smile: -0.25 },
  yawn: { lid: 0.85, browUp: 0.35, browIn: 0.3, open: 1, wide: -0.15, teeth: 0.3, tongue: 0.8, squint: 0.3 },
  menace: { browIn: -0.75, browUp: -0.3, lid: 0.25, squint: 0.3, smileL: 0.45, smileR: -0.05, shiftX: 0.15, gazeY: 0.25 },
  cool: { lid: 0.3, browUpR: 0.3, browIn: -0.25, smileL: 0.35, shiftX: 0.1, squint: 0.15 },
  sleep: { lid: 1, browUp: -0.1, open: 0.03 },
};

export type ExprKey = Expression | 'think' | 'scream' | 'yawn' | 'menace' | 'cool' | 'sleep';

const PACKED = new Map<string, Float32Array>();
function packed(name: string): Float32Array {
  let a = PACKED.get(name);
  if (a) return a;
  a = new Float32Array(FP_N);
  const p = TABLE[name] ?? {};
  const both = (k: string, l: FP, r: FP) => { const v = (p as any)[k]; if (v !== undefined) { a![l] += v; a![r] += v; } };
  both('browUp', FP.browUpL, FP.browUpR); both('browIn', FP.browInL, FP.browInR); both('lid', FP.lidL, FP.lidR);
  both('squint', FP.squintL, FP.squintR); both('smile', FP.smileL, FP.smileR);
  const one: [string, FP][] = [['browUpL', FP.browUpL], ['browUpR', FP.browUpR], ['browInL', FP.browInL], ['browInR', FP.browInR], ['lidL', FP.lidL], ['lidR', FP.lidR],
    ['squintL', FP.squintL], ['squintR', FP.squintR], ['smileL', FP.smileL], ['smileR', FP.smileR], ['open', FP.open], ['wide', FP.wide], ['teeth', FP.teeth],
    ['cheek', FP.cheek], ['sneer', FP.sneer], ['gazeX', FP.gazeX], ['gazeY', FP.gazeY], ['shiftX', FP.shiftX], ['tongue', FP.tongue]];
  for (const [k, i] of one) { const v = (p as any)[k]; if (v !== undefined) a[i] = (k.endsWith('L') || k.endsWith('R')) && ['browUp', 'browIn', 'lid', 'squint', 'smile'].includes(k.slice(0, -1)) ? a[i] + v : v; }
  PACKED.set(name, a);
  return a;
}

export const EXPRESSIONS: Expression[] = ['neutral', 'happy', 'laugh', 'smug', 'angry', 'shocked', 'scared', 'sad', 'determined', 'disgust', 'wink', 'sleepy', 'drunk', 'pain'];

/** FaceVariant (old static photo variants) → animated expression */
export function variantExpr(v: FaceVariant | null | undefined): ExprKey {
  switch (v) {
    case 'think': return 'think';
    case 'drunk': return 'drunk';
    case 'sleep': return 'sleep';
    case 'shock': return 'shocked';
    case 'scream': return 'scream';
    default: return 'neutral';
  }
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

interface Layer { name: ExprKey; w: number; target: number; fadeRate: number; hold: number }

/** Per-character face state. Call update() every rendered tick, read `.u` (Float32Array(20)) into the uniform. */
export class FaceRig {
  /** packed uniform values */
  readonly u = new Float32Array(FP_N);
  /** smoothed parameter state */
  private s = new Float32Array(FP_N);
  private tgt = new Float32Array(FP_N);
  /** explicit expression (setExpression) and the anim's own expression */
  private explicit: Layer | null = null;
  private animExpr: ExprKey = 'neutral';
  private animW = 0;
  private animFrom: ExprKey = 'neutral';
  private animFromW = 0;
  talking = false;
  /** anim-requested mouth activity: 'talk' | 'laugh' | 'chew' | null */
  mouthMode: 'talk' | 'laugh' | 'chew' | 'scream' | null = null;
  private t = Math.random() * 50;
  // blink
  private blinkT = 1 + Math.random() * 3;
  private blinkK = -1;
  private doubleBlink = false;
  // talk
  private syl = 0; private sylT = 0; private sylTarget = 0; private sylWide = 0; private pause = 0;
  // micro-expressions
  private microT = 2 + Math.random() * 5;
  private micro: { name: string; t: number; dur: number; a: Float32Array } | null = null;
  // eyes
  private sacT = 0.5;
  private sac = [0, 0];
  private gazeIn = [0, 0];
  private gazeHas = false;
  private eye = [0, 0];
  /** 0..1, set by the rig from distance (1 = full detail) */
  detail = 1;
  /** personality: some people are more expressive than others */
  private expressive: number;
  constructor(seed = Math.random()) { this.expressive = 0.75 + seed * 0.5; }

  setExpression(e: ExprKey, opts: { weight?: number; hold?: number; fade?: number } = {}) {
    if (!TABLE[e]) e = 'neutral';
    const w = clamp(opts.weight ?? 1, 0, 1.5);
    const fade = Math.max(0.03, opts.fade ?? 0.22);
    if (e === 'neutral' && opts.hold === undefined) { if (this.explicit) { this.explicit.target = 0; this.explicit.fadeRate = 1 / fade; } return; }
    const prevW = this.explicit && this.explicit.name === e ? this.explicit.w : 0;
    if (this.explicit && this.explicit.name !== e && this.explicit.w > 0.05) {
      // the old explicit face becomes the "from" of a crossfade through the anim channel
      this.animFrom = this.explicit.name; this.animFromW = this.explicit.w;
    }
    this.explicit = { name: e, w: prevW, target: w, fadeRate: 1 / fade, hold: opts.hold ?? Infinity };
  }
  /** expression implied by the current animation (rig calls this on play()) */
  setAnimExpression(e: ExprKey) {
    if (e === this.animExpr) return;
    this.animFrom = this.animExpr; this.animFromW = this.animW;
    this.animExpr = e; this.animW = 0;
  }
  /** look direction for the eyes relative to the head (x = character's left, y = up, ~ -1..1), or null = wander */
  setGaze(x: number | null, y = 0) {
    if (x === null) { this.gazeHas = false; return; }
    this.gazeHas = true; this.gazeIn[0] = clamp(x, -1.2, 1.2); this.gazeIn[1] = clamp(y, -1, 1);
  }
  /** trigger a blink now (big head turns, surprises) */
  blink() { if (this.blinkK < 0) { this.blinkK = 0; } }
  get expression(): ExprKey { return this.explicit && this.explicit.target > 0 ? this.explicit.name : this.animExpr; }

  update(dt: number) {
    if (dt <= 0) { this.pack(); return; }
    this.t += dt;
    const tg = this.tgt;
    tg.fill(0);
    // ---- anim expression channel (crossfade from previous)
    this.animW = Math.min(1, this.animW + dt * 5);
    this.animFromW = Math.max(0, this.animFromW - dt * 5);
    let wAnim = this.animW;
    // ---- explicit layer
    const ex = this.explicit;
    if (ex) {
      if (ex.hold !== Infinity) { ex.hold -= dt; if (ex.hold <= 0) { ex.hold = Infinity; ex.target = 0; ex.fadeRate = Math.min(ex.fadeRate, 4); } }
      const d = ex.target - ex.w;
      ex.w += Math.sign(d) * Math.min(Math.abs(d), dt * ex.fadeRate);
      if (ex.target === 0 && ex.w <= 0.001) this.explicit = null;
    }
    const exW = this.explicit ? Math.min(1, this.explicit.w) : 0;
    wAnim *= 1 - exW;
    const add = (name: string, w: number) => { if (w <= 0.001) return; const a = packed(name); for (let i = 0; i < FP_N; i++) tg[i] += a[i] * w; };
    add(this.animExpr, wAnim);
    add(this.animFrom, this.animFromW * (1 - exW));
    if (this.explicit) add(this.explicit.name, this.explicit.w);
    const xp = this.expressive;
    for (let i = 0; i < FP.gazeX; i++) tg[i] *= xp;
    // ---- micro-expressions (subtle, frequent: people are never still)
    this.microT -= dt;
    if (this.microT < 0 && !this.micro) {
      this.microT = 2.5 + Math.random() * 6;
      const r = Math.random();
      const a = new Float32Array(FP_N);
      let name = 'flick', dur = 0.45;
      if (r < 0.3) { a[FP.browUpL] = a[FP.browUpR] = 0.3; }
      else if (r < 0.5) { name = 'press'; dur = 0.8; a[FP.wide] = -0.22; a[FP.smileL] = a[FP.smileR] = -0.12; }
      else if (r < 0.68) { name = 'half'; dur = 1.4; a[Math.random() < 0.5 ? FP.smileL : FP.smileR] = 0.3; a[FP.cheek] = 0.1; }
      else if (r < 0.8) { name = 'sniff'; dur = 0.35; a[FP.sneer] = 0.3; a[FP.squintL] = a[FP.squintR] = 0.15; }
      else if (r < 0.9) { name = 'browtilt'; dur = 1.1; a[FP.browUpL] = 0.35; a[FP.browUpR] = -0.1; }
      else { name = 'squint'; dur = 0.9; a[FP.squintL] = a[FP.squintR] = 0.3; a[FP.browInL] = a[FP.browInR] = -0.15; }
      this.micro = { name, t: 0, dur, a };
    }
    if (this.micro) {
      const m = this.micro;
      m.t += dt;
      const k = m.t / m.dur;
      if (k >= 1) this.micro = null;
      else { const e = Math.sin(Math.min(1, k) * Math.PI); for (let i = 0; i < FP_N; i++) tg[i] += m.a[i] * e * 0.8; }
    }
    // ---- mouth activity
    const mode = this.talking ? 'talk' : this.mouthMode;
    if (mode === 'talk' || mode === 'laugh' || mode === 'scream') {
      this.sylT -= dt;
      if (this.pause > 0) { this.pause -= dt; this.sylTarget = 0; }
      else if (this.sylT <= 0) {
        if (mode === 'laugh') { this.sylT = 0.13 + Math.random() * 0.05; this.sylTarget = this.sylTarget > 0.3 ? 0.15 : 0.55 + Math.random() * 0.3; }
        else if (mode === 'scream') { this.sylT = 0.25; this.sylTarget = 0.85 + Math.random() * 0.15; }
        else {
          this.sylT = 0.07 + Math.random() * 0.1;
          this.sylTarget = Math.random() < 0.18 ? 0.02 : 0.1 + Math.random() * 0.34;
          this.sylWide = (Math.random() - 0.4) * 0.7;
          if (Math.random() < 0.05) this.pause = 0.2 + Math.random() * 0.35;
        }
      }
      this.syl += (this.sylTarget - this.syl) * (1 - Math.exp(-dt * 26));
      tg[FP.open] = Math.max(tg[FP.open] * 0.6, 0) + this.syl;
      tg[FP.wide] += this.sylWide * (mode === 'talk' ? 1 : 0.3);
      tg[FP.teeth] = Math.max(tg[FP.teeth], mode === 'talk' ? 0.55 : 0.9);
      tg[FP.tongue] = Math.max(tg[FP.tongue], 0.35);
      if (mode === 'talk') { tg[FP.browUpL] += Math.max(0, this.syl - 0.3) * 0.5; tg[FP.browUpR] += Math.max(0, this.syl - 0.3) * 0.5; }
    } else if (mode === 'chew') {
      const c = Math.max(0, Math.sin(this.t * 9));
      tg[FP.open] += 0.06 * c; tg[FP.wide] -= 0.15; tg[FP.cheek] += 0.15 * c;
    } else this.syl *= Math.exp(-dt * 10);
    // ---- eyes: saccades around the look direction, small fixational drift
    this.sacT -= dt;
    if (this.sacT <= 0) {
      const looking = this.gazeHas;
      this.sacT = looking ? 0.35 + Math.random() * 1.6 : 0.6 + Math.random() * 2.6;
      const amp = looking ? 0.12 : 0.45;
      this.sac[0] = (Math.random() - 0.5) * 2 * amp;
      this.sac[1] = (Math.random() - 0.5) * amp * 0.8 - (looking ? 0 : 0.08);
      if (!looking && Math.random() < 0.25) { this.sac[0] *= 2; if (Math.random() < 0.5) this.blink(); }
    }
    const gx = (this.gazeHas ? this.gazeIn[0] : 0) + this.sac[0] + tg[FP.gazeX];
    const gy = (this.gazeHas ? this.gazeIn[1] : 0) + this.sac[1] + tg[FP.gazeY];
    // saccade: very fast, ballistic
    const ks = 1 - Math.exp(-dt * 34);
    const ngx = this.eye[0] + (clamp(gx, -1, 1) - this.eye[0]) * ks;
    if (Math.abs(ngx - this.eye[0]) > 0.35 && this.blinkK < 0 && Math.random() < 0.5) this.blink();
    this.eye[0] = ngx;
    this.eye[1] += (clamp(gy, -1, 1) - this.eye[1]) * ks;
    // ---- smoothing towards the target (muscles have mass)
    const k = 1 - Math.exp(-dt * 14);
    for (let i = 0; i < FP_N; i++) this.s[i] += (tg[i] - this.s[i]) * k;
    // ---- blink (overrides lids)
    this.blinkT -= dt;
    if (this.blinkT <= 0 && this.blinkK < 0) this.blinkK = 0;
    let bl = 0;
    if (this.blinkK >= 0) {
      this.blinkK += dt / 0.17;
      const b = this.blinkK;
      bl = b < 0.35 ? b / 0.35 : Math.max(0, 1 - (b - 0.35) / 0.65);
      bl = bl * bl * (3 - 2 * bl);
      if (b >= 1) {
        this.blinkK = -1;
        if (!this.doubleBlink && Math.random() < 0.12) { this.doubleBlink = true; this.blinkT = 0.12; }
        else { this.doubleBlink = false; this.blinkT = 1.6 + Math.random() * 4.2; }
      }
    }
    this.pack(bl);
  }

  private pack(blink = 0) {
    const u = this.u, s = this.s, d = this.detail;
    for (let i = 0; i < FP_N; i++) u[i] = s[i] * d;
    // closing lids: expression + blink (a wide-eyed face still blinks)
    for (const i of [FP.lidL, FP.lidR]) { const v = u[i]; u[i] = v + (1.05 - v) * blink * Math.min(1, d * 1.5); }
    u[FP.gazeX] = this.eye[0] * d; u[FP.gazeY] = this.eye[1] * d;
    u[FP.open] = clamp(u[FP.open], 0, 1);
    u[FP.lidL] = clamp(u[FP.lidL], -1, 1.05); u[FP.lidR] = clamp(u[FP.lidR], -1, 1.05);
  }
}

/* ---- GLSL: runs inside the atlas material's map_fragment; f = face-photo coords (0..1, y down).
 * Writes: mUv (warped atlas uv), and overlay masks lidCover / mouthIn with their colours. */
export const FACE_EXPR_PARS = /* glsl */`
uniform vec4 uFace[5];
uniform float uFaceOn;
float gk2(vec2 p, vec2 c, vec2 r) { vec2 q = (p - c) / r; return exp(-dot(q, q)); }
`;

/** expects: vec2 f (face coords), outputs vec2 fd (warped face coords), float lidCover, vec2 lidSrc, float lashK,
 *  float mouthIn, vec3 mouthCol, vec2 eyeShift */
export const FACE_EXPR_WARP = /* glsl */`
{
  vec4 A = uFace[0], Bq = uFace[1], C = uFace[2], Dq = uFace[3], E = uFace[4];
  float browUpL = A.x, browUpR = A.y, browInL = A.z, browInR = A.w;
  float lidL = Bq.x, lidR = Bq.y, squintL = Bq.z, squintR = Bq.w;
  float smileL = C.x, smileR = C.y, mOpen = C.z, mWide = C.w;
  float teeth = Dq.x, cheek = Dq.y, sneer = Dq.z, gazeX = Dq.w;
  float gazeY = E.x, shiftX = E.y, tongue = E.z;
  vec2 d = vec2(0.0);
  // ---------- brows (image right = character's left)
  for (int s = 0; s < 2; s++) {
    float ex = s == 0 ? 0.64 : 0.36;
    float up = s == 0 ? browUpL : browUpR;
    float inn = s == 0 ? browInL : browInR;
    float toC = s == 0 ? -1.0 : 1.0;                       // image direction towards the nose
    float g = gk2(f, vec2(ex, 0.372), vec2(0.105, 0.075)) * smoothstep(0.445, 0.395, f.y);
    float tilt = clamp((f.x - ex) * toC / 0.075, -1.0, 1.0); // +1 inner end, -1 outer end
    d.y += g * (up * 0.022 + inn * 0.02 * (0.55 + 0.45 * tilt));
    d.x += g * min(inn, 0.0) * 0.008 * toC;                  // knit: brows pull together
  }
  // ---------- eyes: iris look, wide open
  eyeShift = vec2(gazeX * 0.013, -gazeY * 0.008);
  for (int s = 0; s < 2; s++) {
    float ex = s == 0 ? 0.64 : 0.36;
    float lid = s == 0 ? lidL : lidR;
    vec2 q = (f - vec2(ex, 0.442)) / vec2(0.05, 0.024);
    float m = 1.0 - smoothstep(0.55, 1.15, length(q));
    d -= eyeShift * m;
    float wide = max(-lid, 0.0);
    d.y -= (f.y - 0.442) * wide * 0.32 * (1.0 - smoothstep(0.7, 1.6, length(q)));
  }
  // ---------- cheeks & nose
  d.y += cheek * 0.014 * (gk2(f, vec2(0.62, 0.575), vec2(0.075, 0.07)) + gk2(f, vec2(0.38, 0.575), vec2(0.075, 0.07)));
  d.y += sneer * 0.012 * (gk2(f, vec2(0.535, 0.655), vec2(0.045, 0.045)) + gk2(f, vec2(0.465, 0.655), vec2(0.045, 0.045)));
  // ---------- mouth
  float my = 0.732;
  float cx = 0.5 + shiftX * 0.02;
  // corners up/out (smile) or down (frown)
  for (int s = 0; s < 2; s++) {
    float side = s == 0 ? 1.0 : -1.0;
    float sm2 = s == 0 ? smileL : smileR;
    float g = gk2(f, vec2(cx + side * 0.1, my + 0.004), vec2(0.06, 0.048));
    d.y += g * sm2 * 0.022;
    d.x -= g * side * max(sm2, 0.0) * 0.01;
  }
  float gM = gk2(f, vec2(cx, my), vec2(0.16, 0.075));
  d.x += (f.x - cx) * gM * (mWide < 0.0 ? -mWide * 0.42 : -mWide * 0.2);
  d.x -= shiftX * 0.02 * gM;
  // jaw drop: lower lip & chin slide down, upper lip lifts a little
  float wq = (f.x - cx) / (0.135 * (1.0 + 0.25 * mWide));
  float wx = exp(-wq * wq);
  float gap = mOpen * 0.068 * wx;
  float upLift = mOpen * 0.012 * wx + sneer * 0.006 * wx;
  float below = smoothstep(my - 0.004, my + 0.004, f.y);
  float chinFade = 1.0 - smoothstep(0.86, 0.99, f.y);
  d.y -= below * gap * chinFade;
  d.y += (1.0 - below) * upLift * smoothstep(0.6, my, f.y);
  fd = f + d;
  // ---------- mouth interior (between the moved lips)
  float hw = 0.082 * (1.0 + 0.32 * mWide) + 0.006 * (smileL + smileR);
  float top = my - upLift, bot = my + gap;
  float hh = max((bot - top) * 0.5, 1e-4);
  vec2 mq = vec2((f.x - cx) / hw, (f.y - (top + bot) * 0.5) / hh);
  float ell = dot(mq, mq);
  mouthIn = (1.0 - smoothstep(0.78, 1.0, ell)) * smoothstep(0.004, 0.012, gap);
  float vy = (f.y - top) / max(bot - top, 1e-4);             // 0 top .. 1 bottom
  vec3 cav = mix(vec3(0.16, 0.05, 0.05), vec3(0.03, 0.008, 0.01), smoothstep(0.0, 0.6, vy) * (1.0 - smoothstep(0.75, 1.0, vy) * 0.5));
  float tTop = smoothstep(0.0, 0.03, 0.022 * teeth - (f.y - top)) * step(0.001, teeth);
  float tBot = smoothstep(0.0, 0.02, 0.012 * teeth * step(0.35, mOpen) - (bot - f.y));
  float teethGap = 0.75 + 0.25 * smoothstep(0.0, 0.25, abs(fract((f.x - cx) / 0.021 + 0.5) - 0.5));
  vec3 toothC = vec3(0.6, 0.56, 0.48) * teethGap * (0.65 + 0.35 * (1.0 - abs(mq.x)));
  float tng = tongue * smoothstep(0.55, 0.85, vy) * (1.0 - smoothstep(0.6, 1.0, abs(mq.x)));
  mouthCol = mix(cav, vec3(0.42, 0.12, 0.12), tng);
  mouthCol = mix(mouthCol, toothC, max(tTop, tBot * (1.0 - tng)));
  // ---------- eyelids (upper lid slides down over the eye, lower lid rises in a squint)
  lidCover = 0.0; lidSrc = f; lashK = 0.0;
  for (int s = 0; s < 2; s++) {
    float ex = s == 0 ? 0.64 : 0.36;
    float lid = s == 0 ? lidL : lidR;
    float sq = s == 0 ? squintL : squintR;
    float dx = (f.x - ex) / 0.056;
    if (abs(dx) < 1.15) {
      float arc = dx * dx;
      float restU = 0.442 - 0.026 + arc * 0.016;
      float close = clamp(lid, 0.0, 1.05);
      float lidY = mix(restU, 0.449 + arc * 0.002, close);
      float restL = 0.442 + 0.022 - arc * 0.012;
      float lowY = mix(restL, 0.444, clamp(sq, 0.0, 1.0) * 0.55);
      float inU = smoothstep(restU - 0.002, restU + 0.004, f.y) * (1.0 - smoothstep(lidY - 0.0025, lidY + 0.0015, f.y));
      float inL = smoothstep(lowY - 0.002, lowY + 0.002, f.y) * (1.0 - smoothstep(restL - 0.002, restL + 0.004, f.y));
      float edge = 1.0 - smoothstep(0.95, 1.15, abs(dx));
      float cu = inU * smoothstep(0.02, 0.12, close) * edge;
      float cl = inL * smoothstep(0.02, 0.12, sq) * edge;
      if (cu + cl > lidCover) {
        lidCover = max(cu, cl);
        // lid skin from just above the natural lid crease / below the lower lid
        lidSrc = cu >= cl ? vec2(f.x, restU - 0.024 - (lidY - f.y) * 0.3) : vec2(f.x, restL + 0.016);
        lashK = cu >= cl ? (1.0 - smoothstep(0.0, 0.0045, abs(f.y - lidY))) * smoothstep(0.25, 0.6, close) : 0.0;
      }
    }
  }
}
`;
