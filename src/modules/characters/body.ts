import type { Look } from '../../game/contracts';
import { Geo, Ring, V3, W, frame, gridNormals, lerp, lerpArr, loft, loftGrid, profile, smooth, v3add, v3cross, v3mul, v3norm, v3sub, wb, wmix, clamp01 } from './geo';
import { B, RestSkel, restSkel } from './skel';
import {
  R, ruv, torsoT, legT, armT, neckT, handT, footT, faceU, faceV, SCALP_A0, SCALP_TOP, SCALP_BOT,
} from './layout';
import { AccSpec, BottomSpec, ShoeSpec, TopSpec, accSpec, bottomSpec, shoeSpec, topSpec } from './defs';

/* ============================================================================================
 * Procedural low-poly body: lofted torso/limbs with clothing baked into the silhouette
 * (sleeves, hems, trouser legs, skirts, collars), a sculpted head with nose & ears, mitten
 * hands with thumbs, feet/shoes. All skinned to the 19-bone skeleton (skel.ts).
 * ========================================================================================== */

export type Lod = 'high' | 'low';

export interface BodySpec {
  sex: 'm' | 'f';
  build: number;
  top: TopSpec;
  bottom: BottomSpec;
  shoe: ShoeSpec;
  hair: string;
  acc: AccSpec[];
}

export function bodySpec(look: Look): BodySpec {
  const sex = look.sex === 'f' ? 'f' : 'm';
  const build = Math.round(Math.max(0, Math.min(1, look.build ?? 0.4)) * 8) / 8;
  const acc = (look.acc ?? []).map((a) => accSpec(a)).filter(Boolean) as AccSpec[];
  // one item per slot (first wins)
  const seen = new Set<string>();
  const accU = acc.filter((a) => (seen.has(a.slot) && a.slot !== 'body' ? false : (seen.add(a.slot), true)));
  return { sex, build, top: topSpec(look.top?.id), bottom: bottomSpec(look.bottom?.id), shoe: shoeSpec(look.shoes?.id), hair: look.hair?.style ?? 'short', acc: accU };
}

export function shapeKey(s: BodySpec, lod: Lod) {
  return [s.sex, s.build, s.top.id, s.bottom.id, s.shoe.kind, s.hair, s.acc.map((a) => a.kind).sort().join('+'), lod].join('|');
}

// ------------------------------------------------------------------ clothing landmarks (shared with the painter)

export function sleeveEnd(top: TopSpec): number {
  switch (top.sleeve) {
    case 'none': return -1;
    case 'cap': return 0.065;
    case 'short': return 0.15;
    case 'elbow': return 0.27;
    case 'rolled': return 0.335;
    case 'long': return 0.535;
  }
}
export const isLegWear = (b: BottomSpec) => b.kind === 'shorts' || b.kind === 'trousers';
export const isTube = (b: BottomSpec) => b.kind === 'skirt' || b.kind === 'wrap';
/** Does the top cover the waistband (untucked)? */
export const untucked = (top: TopSpec, bot: BottomSpec) => top.hem < bot.waist - 0.01;

// ------------------------------------------------------------------ body profile tables (half-widths, metres)

// rows: y, front, frontSide, side, backSide, back, cz
type Row = [number, number, number, number, number, number, number];
const M0: Row[] = [
  [0.8, 0.04, 0.055, 0.07, 0.065, 0.05, -0.012], [0.84, 0.085, 0.112, 0.135, 0.135, 0.105, -0.012], [0.88, 0.095, 0.128, 0.15, 0.148, 0.118, -0.012],
  [0.92, 0.098, 0.13, 0.152, 0.146, 0.115, -0.01], [0.96, 0.095, 0.126, 0.148, 0.138, 0.105, -0.008], [1.0, 0.09, 0.118, 0.138, 0.128, 0.095, -0.006],
  [1.05, 0.087, 0.112, 0.128, 0.118, 0.088, -0.005], [1.1, 0.088, 0.113, 0.13, 0.12, 0.086, -0.006], [1.16, 0.093, 0.12, 0.136, 0.126, 0.088, -0.008],
  [1.22, 0.1, 0.128, 0.143, 0.133, 0.092, -0.01], [1.28, 0.106, 0.136, 0.15, 0.14, 0.096, -0.012], [1.33, 0.104, 0.14, 0.156, 0.146, 0.1, -0.014],
  [1.37, 0.096, 0.136, 0.158, 0.144, 0.098, -0.016], [1.405, 0.084, 0.124, 0.152, 0.13, 0.09, -0.018], [1.435, 0.066, 0.094, 0.115, 0.098, 0.072, -0.018],
  [1.46, 0.05, 0.06, 0.068, 0.062, 0.052, -0.016], [1.49, 0.044, 0.047, 0.05, 0.05, 0.045, -0.014],
];
const M1: Row[] = [
  [0.8, 0.05, 0.07, 0.085, 0.08, 0.062, -0.012], [0.84, 0.115, 0.15, 0.17, 0.165, 0.13, -0.01], [0.88, 0.135, 0.168, 0.185, 0.178, 0.14, -0.005],
  [0.92, 0.15, 0.18, 0.192, 0.18, 0.14, 0.0], [0.96, 0.165, 0.188, 0.195, 0.178, 0.135, 0.008], [1.0, 0.175, 0.192, 0.193, 0.172, 0.128, 0.014],
  [1.05, 0.182, 0.196, 0.192, 0.168, 0.122, 0.018], [1.1, 0.183, 0.197, 0.192, 0.168, 0.12, 0.018], [1.16, 0.176, 0.194, 0.192, 0.17, 0.12, 0.012],
  [1.22, 0.165, 0.19, 0.192, 0.172, 0.122, 0.006], [1.28, 0.155, 0.186, 0.193, 0.175, 0.124, 0.0], [1.33, 0.142, 0.18, 0.195, 0.178, 0.126, -0.006],
  [1.37, 0.125, 0.168, 0.193, 0.172, 0.122, -0.01], [1.405, 0.105, 0.15, 0.182, 0.155, 0.11, -0.014], [1.435, 0.08, 0.112, 0.138, 0.118, 0.088, -0.016],
  [1.46, 0.06, 0.072, 0.08, 0.074, 0.064, -0.016], [1.49, 0.052, 0.056, 0.058, 0.058, 0.054, -0.014],
];
const F0: Row[] = [
  [0.8, 0.04, 0.058, 0.075, 0.07, 0.052, -0.014], [0.84, 0.09, 0.122, 0.15, 0.15, 0.118, -0.016], [0.88, 0.098, 0.138, 0.165, 0.163, 0.13, -0.016],
  [0.92, 0.096, 0.136, 0.163, 0.155, 0.12, -0.014], [0.96, 0.09, 0.126, 0.15, 0.138, 0.104, -0.01], [1.0, 0.084, 0.112, 0.13, 0.12, 0.09, -0.008],
  [1.05, 0.08, 0.102, 0.115, 0.108, 0.082, -0.006], [1.1, 0.08, 0.102, 0.114, 0.106, 0.08, -0.006], [1.16, 0.086, 0.108, 0.12, 0.112, 0.083, -0.008],
  [1.22, 0.1, 0.118, 0.126, 0.118, 0.086, -0.01], [1.27, 0.118, 0.13, 0.13, 0.122, 0.088, -0.01], [1.31, 0.11, 0.128, 0.134, 0.126, 0.09, -0.012],
  [1.35, 0.09, 0.122, 0.138, 0.128, 0.09, -0.014], [1.39, 0.078, 0.112, 0.136, 0.12, 0.085, -0.016], [1.42, 0.064, 0.09, 0.11, 0.094, 0.068, -0.016],
  [1.445, 0.047, 0.055, 0.06, 0.056, 0.048, -0.015], [1.48, 0.04, 0.042, 0.044, 0.044, 0.04, -0.013],
];
const F1: Row[] = [
  [0.8, 0.05, 0.072, 0.09, 0.085, 0.064, -0.014], [0.84, 0.112, 0.15, 0.18, 0.18, 0.142, -0.014], [0.88, 0.125, 0.168, 0.195, 0.192, 0.15, -0.012],
  [0.92, 0.132, 0.172, 0.196, 0.186, 0.142, -0.008], [0.96, 0.142, 0.17, 0.19, 0.175, 0.13, -0.002], [1.0, 0.15, 0.168, 0.18, 0.162, 0.12, 0.004],
  [1.05, 0.152, 0.166, 0.172, 0.155, 0.112, 0.008], [1.1, 0.15, 0.164, 0.17, 0.152, 0.11, 0.008], [1.16, 0.148, 0.165, 0.172, 0.154, 0.112, 0.006],
  [1.22, 0.155, 0.168, 0.174, 0.158, 0.114, 0.002], [1.27, 0.168, 0.176, 0.176, 0.16, 0.116, 0.0], [1.31, 0.158, 0.172, 0.178, 0.162, 0.118, -0.004],
  [1.35, 0.125, 0.16, 0.176, 0.16, 0.115, -0.008], [1.39, 0.098, 0.14, 0.168, 0.148, 0.106, -0.012], [1.42, 0.076, 0.106, 0.13, 0.112, 0.082, -0.014],
  [1.445, 0.054, 0.064, 0.07, 0.066, 0.056, -0.014], [1.48, 0.046, 0.048, 0.05, 0.05, 0.046, -0.013],
];

function sampleRows(rows: Row[], y: number): number[] {
  if (y <= rows[0][0]) return rows[0].slice(1);
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i], b = rows[i + 1];
    if (y <= b[0]) { const t = (y - a[0]) / (b[0] - a[0]); return a.slice(1).map((v, k) => v + (b[k + 1] - v) * t); }
  }
  return rows[rows.length - 1].slice(1);
}

/** 5 torso radii + cz at height y (reference body) */
export function torsoProfile(sex: 'm' | 'f', build: number, y: number): number[] {
  const a = sampleRows(sex === 'f' ? F0 : M0, y), b = sampleRows(sex === 'f' ? F1 : M1, y);
  // build response is non-linear: most people are near average, bellies grow fast near 1
  const t = Math.pow(build, 1.35);
  return lerpArr(a, b, t);
}

// ------------------------------------------------------------------ limb profiles

// arms: [d, lat, lat-front, front, med-front, med, med-back, back, lat-back]
const ARM: number[][] = [
  [0.0, 0.054, 0.052, 0.048, 0.044, 0.042, 0.044, 0.05, 0.054],
  [0.05, 0.05, 0.049, 0.047, 0.042, 0.04, 0.043, 0.047, 0.05],
  [0.12, 0.042, 0.044, 0.045, 0.04, 0.037, 0.04, 0.044, 0.043],
  [0.2, 0.037, 0.039, 0.04, 0.036, 0.034, 0.037, 0.04, 0.038],
  [0.255, 0.035, 0.035, 0.034, 0.033, 0.034, 0.036, 0.037, 0.036],
  [0.29, 0.036, 0.034, 0.032, 0.033, 0.035, 0.037, 0.038, 0.037],
  [0.33, 0.038, 0.038, 0.036, 0.034, 0.034, 0.036, 0.038, 0.039],
  [0.39, 0.035, 0.036, 0.035, 0.032, 0.031, 0.032, 0.034, 0.035],
  [0.46, 0.028, 0.029, 0.029, 0.026, 0.025, 0.026, 0.028, 0.028],
  [0.52, 0.021, 0.024, 0.027, 0.024, 0.02, 0.023, 0.026, 0.023],
  [0.55, 0.02, 0.023, 0.026, 0.023, 0.019, 0.022, 0.025, 0.022],
];
function armProf(d: number): number[] {
  if (d <= ARM[0][0]) return ARM[0].slice(1);
  for (let i = 0; i < ARM.length - 1; i++) {
    const a = ARM[i], b = ARM[i + 1];
    if (d <= b[0]) { const t = (d - a[0]) / (b[0] - a[0]); return a.slice(1).map((v, k) => v + (b[k + 1] - v) * t); }
  }
  return ARM[ARM.length - 1].slice(1);
}

// legs: [y, front, front-out, out, back-out, back, back-in, in, front-in]
const LEG: number[][] = [
  [0.99, 0.075, 0.082, 0.085, 0.085, 0.08, 0.07, 0.06, 0.065],
  [0.9, 0.08, 0.088, 0.09, 0.09, 0.088, 0.08, 0.072, 0.074],
  [0.82, 0.077, 0.083, 0.083, 0.082, 0.08, 0.076, 0.07, 0.072],
  [0.72, 0.068, 0.072, 0.071, 0.07, 0.068, 0.064, 0.06, 0.063],
  [0.62, 0.06, 0.062, 0.06, 0.058, 0.056, 0.054, 0.052, 0.055],
  [0.54, 0.054, 0.053, 0.05, 0.048, 0.047, 0.046, 0.046, 0.05],
  [0.48, 0.052, 0.05, 0.047, 0.046, 0.046, 0.045, 0.045, 0.049],
  [0.43, 0.046, 0.046, 0.045, 0.048, 0.052, 0.05, 0.044, 0.044],
  [0.36, 0.042, 0.044, 0.046, 0.054, 0.06, 0.056, 0.046, 0.042],
  [0.27, 0.036, 0.038, 0.04, 0.044, 0.046, 0.044, 0.038, 0.036],
  [0.18, 0.03, 0.031, 0.032, 0.033, 0.033, 0.032, 0.03, 0.029],
  [0.12, 0.027, 0.028, 0.029, 0.03, 0.03, 0.029, 0.027, 0.026],
  [0.08, 0.03, 0.034, 0.036, 0.034, 0.032, 0.034, 0.036, 0.032],
];
function legProf(y: number): number[] {
  if (y >= LEG[0][0]) return LEG[0].slice(1);
  for (let i = 0; i < LEG.length - 1; i++) {
    const a = LEG[i], b = LEG[i + 1];
    if (y >= b[0]) { const t = (a[0] - y) / (a[0] - b[0]); return a.slice(1).map((v, k) => v + (b[k + 1] - v) * t); }
  }
  return LEG[LEG.length - 1].slice(1);
}

// head: [ry, cz, r(0°), 22.5, 45, 67.5, 90, 112.5, 135, 157.5, 180]
export const HEAD: number[][] = [
  [-0.03, -0.005, 0.048, 0.048, 0.048, 0.048, 0.048, 0.048, 0.048, 0.048, 0.048],
  [-0.012, 0.0, 0.04, 0.042, 0.046, 0.05, 0.052, 0.054, 0.055, 0.056, 0.056],
  [0.005, 0.004, 0.078, 0.07, 0.058, 0.054, 0.054, 0.058, 0.06, 0.06, 0.06],
  [0.022, 0.006, 0.088, 0.08, 0.066, 0.062, 0.062, 0.068, 0.072, 0.074, 0.074],
  [0.04, 0.007, 0.093, 0.088, 0.075, 0.068, 0.066, 0.074, 0.082, 0.086, 0.086],
  [0.058, 0.008, 0.094, 0.09, 0.08, 0.073, 0.071, 0.08, 0.089, 0.093, 0.093],
  [0.075, 0.008, 0.093, 0.091, 0.086, 0.079, 0.075, 0.084, 0.093, 0.097, 0.098],
  [0.095, 0.008, 0.091, 0.089, 0.088, 0.083, 0.078, 0.087, 0.096, 0.1, 0.101],
  [0.112, 0.008, 0.092, 0.084, 0.086, 0.083, 0.079, 0.088, 0.097, 0.101, 0.102],
  [0.13, 0.008, 0.095, 0.093, 0.088, 0.082, 0.079, 0.088, 0.097, 0.101, 0.102],
  [0.15, 0.007, 0.092, 0.09, 0.086, 0.081, 0.079, 0.088, 0.097, 0.1, 0.101],
  [0.172, 0.005, 0.084, 0.083, 0.08, 0.077, 0.076, 0.084, 0.092, 0.095, 0.096],
  [0.192, 0.002, 0.07, 0.069, 0.068, 0.066, 0.066, 0.073, 0.08, 0.082, 0.083],
  [0.21, -0.002, 0.05, 0.05, 0.05, 0.049, 0.049, 0.054, 0.058, 0.059, 0.06],
  [0.222, -0.005, 0.028, 0.028, 0.028, 0.028, 0.028, 0.03, 0.032, 0.033, 0.033],
];
export let HEAD_TOP = 0.229;
let HEADT: number[][] = HEAD;
let HSCALE: number | null = null;
/** Use a measured head (rows like HEAD, reference units) for hair/hat fitting; null restores the procedural head. */
export function setHeadModel(table: number[][] | null, top: number | null, scale: number | null) { HEADT = table ?? HEAD; HEAD_TOP = top ?? 0.229; HSCALE = scale; }

/** head size factor per sex/build (multiplies radii) */
export function headScale(sex: 'm' | 'f', build: number) { return HSCALE ?? (sex === 'f' ? 0.955 : 1) * (0.97 + build * 0.06); }

/** head radius at (θ from front, symmetric; ry relative to head bone) and ring centre z */
export function headAt(th: number, ry: number, hs = 1): { r: number; cz: number } {
  const a = Math.abs(((th + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI); // 0..π
  let row0 = HEADT[0], row1 = HEADT[0], t = 0;
  if (ry <= HEADT[0][0]) { row0 = row1 = HEADT[0]; }
  else if (ry >= HEADT[HEADT.length - 1][0]) { row0 = row1 = HEADT[HEADT.length - 1]; }
  else for (let i = 0; i < HEADT.length - 1; i++) if (ry <= HEADT[i + 1][0]) { row0 = HEADT[i]; row1 = HEADT[i + 1]; t = (ry - row0[0]) / (row1[0] - row0[0]); break; }
  const k = (a / Math.PI) * 8;
  const i0 = Math.min(7, Math.floor(k)), f = k - i0;
  const r0 = lerp(row0[2 + i0], row0[3 + i0], f), r1 = lerp(row1[2 + i0], row1[3 + i0], f);
  let r = lerp(r0, r1, t);
  if (ry > HEADT[HEADT.length - 1][0]) r *= clamp01((HEAD_TOP - ry) / (HEAD_TOP - HEADT[HEADT.length - 1][0]));
  return { r: r * hs, cz: lerp(row0[1], row1[1], t) * hs };
}

// ------------------------------------------------------------------ builder

export interface BodyResult { geo: Geo; skel: RestSkel; spec: BodySpec }

interface Ctx {
  G: Geo; sk: RestSkel; s: BodySpec; lod: Lod; hi: boolean;
  /** torso radius lookup (with clothing) for attachments */
  torsoR: (y: number, th: number) => number;
  torsoC: (y: number) => number;
}

export function buildBody(spec: BodySpec, lod: Lod): BodyResult {
  const sk = restSkel(spec.sex, spec.build);
  const G = new Geo();
  const hi = lod === 'high';
  const ctx: Ctx = { G, sk, s: spec, lod, hi, torsoR: () => 0.1, torsoC: () => 0 };
  buildTorso(ctx);
  buildNeck(ctx);
  for (const side of [1, -1]) { buildArm(ctx, side); buildHand(ctx, side); buildLeg(ctx, side); buildFoot(ctx, side); }
  buildHead(ctx);
  if (isTube(spec.bottom)) buildSkirt(ctx);
  buildCollar(ctx);
  for (const a of spec.acc) {
    if (a.kind === 'apron') buildApron(ctx);
    else if (a.kind === 'backpack') buildBackpack(ctx);
    else if (a.kind === 'towel') buildTowel(ctx);
  }
  return { geo: G, skel: sk, spec };
}

/** Clothing/accessory extras (collar, apron, backpack, towel) for an externally provided body
 *  (sculpted GLB): torsoR/torsoC give radii/centre at reference heights. Positions use reference y. */
export function buildBodyExtras(G: Geo, spec: BodySpec, lod: Lod, torsoR: (y: number, th: number) => number, torsoC: (y: number) => number, sk: RestSkel) {
  const ctx: Ctx = { G, sk, s: spec, lod, hi: lod === 'high', torsoR, torsoC };
  buildCollar(ctx);
  for (const a of spec.acc) {
    if (a.kind === 'apron') buildApron(ctx);
    else if (a.kind === 'backpack') buildBackpack(ctx);
    else if (a.kind === 'towel') buildTowel(ctx);
  }
}

// ------------------------------------------------------------------ torso

function topCoversAt(s: BodySpec, y: number) { return y >= s.top.hem; }

function buildTorso(c: Ctx) {
  const { G, s, hi } = c;
  const n = hi ? 12 : 8;
  const top = s.top, bot = s.bottom;
  let ys = hi
    ? [0.8, 0.84, 0.88, 0.92, 0.96, 1.0, 1.05, 1.1, 1.16, 1.22, 1.27, 1.31, 1.35, 1.385, 1.415, 1.44, 1.465, 1.49]
    : [0.8, 0.86, 0.94, 1.02, 1.12, 1.22, 1.3, 1.37, 1.42, 1.46, 1.49];
  const hemRings: number[] = [];
  const unt = untucked(top, bot);
  if (top.hem > 0.805 && top.hem < 1.4) hemRings.push(top.hem);
  if (!unt && !isTube(bot)) hemRings.push(bot.waist);
  for (const h of hemRings) ys = ys.filter((y) => Math.abs(y - h) > 0.018);
  const rows: { y: number; kind: 'n' | 'hemTop' | 'hemIn' | 'belt' }[] = ys.map((y) => ({ y, kind: 'n' as const }));
  if (top.hem > 0.805 && top.hem < 1.4) { rows.push({ y: top.hem, kind: 'hemTop' }, { y: top.hem - 0.005, kind: 'hemIn' }); }
  if (!unt && !isTube(bot)) rows.push({ y: bot.waist, kind: 'belt' });
  rows.sort((a, b) => a.y - b.y);

  const chest = torsoProfile(s.sex, s.build, s.sex === 'f' ? 1.27 : 1.29);
  const loose = top.loose;
  const radiiAt = (y: number, kind: string): { r5: number[]; cz: number } => {
    const p = torsoProfile(s.sex, s.build, y);
    const r5 = p.slice(0, 5), cz = p[5];
    let add = 0;
    const covered = kind === 'hemTop' ? true : kind === 'hemIn' ? false : topCoversAt(s, y);
    if (covered) {
      add = loose;
      // loose tops drape straight down from the chest
      if (loose >= 0.014 && y < 1.3) {
        const k = smooth(1.3, 1.12, y);
        r5[0] = Math.max(r5[0], lerp(r5[0], chest[0] * 0.97, k));
        r5[1] = Math.max(r5[1], lerp(r5[1], chest[1] * 0.97, k));
      }
      if (top.collar === 'robe') add += 0.004;
    } else if (y <= bot.waist + 0.005) {
      add = isTube(bot) ? 0.006 : bot.loose * 0.45 + 0.003;
    }
    if (kind === 'belt') add += 0.005;
    return { r5: r5.map((v) => v + add), cz };
  };
  c.torsoR = (y: number, th: number) => {
    const { r5 } = radiiAt(y, 'n');
    const pr = profile(r5, 16, true);
    let a = th; while (a < -Math.PI) a += Math.PI * 2; while (a > Math.PI) a -= Math.PI * 2;
    const j = Math.round(((a + Math.PI) / (Math.PI * 2)) * 16) % 16;
    return pr[j];
  };
  c.torsoC = (y: number) => torsoProfile(s.sex, s.build, y)[5];

  const rings: Ring[] = rows.map((row) => {
    const { r5, cz } = radiiAt(row.y, row.kind);
    const y = row.y;
    return {
      c: [0, y, cz], f: [0, 0, 1], s: [1, 0, 0], r: profile(r5, n, true), t: torsoT(y),
      w: (p: V3) => torsoWeights(y, p),
    };
  });
  loft(G, rings, { n, uv: (u, v) => ruv(R.torso, u, v), capStart: { depth: 0.012 }, capEnd: { depth: 0.006 } });
}

function torsoWeights(y: number, p: V3): W {
  let w: W;
  if (y <= 0.98) w = wb(B.hips);
  else if (y < 1.12) w = wmix(wb(B.hips), wb(B.spine), smooth(0.98, 1.12, y));
  else if (y < 1.28) w = wmix(wb(B.spine), wb(B.chest), smooth(1.12, 1.28, y));
  else w = wb(B.chest);
  if (y > 1.46) w = wmix(w, wb(B.neck), smooth(1.46, 1.5, y) * 0.5);
  const ax = Math.abs(p[0]);
  const wc = smooth(1.33, 1.43, y) * smooth(0.06, 0.15, ax) * 0.7;
  if (wc > 0) w = wmix(w, wb(p[0] > 0 ? B.clav_l : B.clav_r), wc);
  const wu = smooth(1.27, 1.38, y) * smooth(0.12, 0.165, ax) * 0.28;
  if (wu > 0) w = wmix(w, wb(p[0] > 0 ? B.upperarm_l : B.upperarm_r), wu);
  return w;
}

// ------------------------------------------------------------------ neck

function buildNeck(c: Ctx) {
  const { G, s, hi } = c;
  const n = hi ? 8 : 6;
  const k = (s.sex === 'f' ? 0.86 : 1) * (0.92 + s.build * 0.18);
  const base5 = [0.05, 0.052, 0.055, 0.058, 0.058].map((v) => v * k);
  const ys = hi ? [1.425, 1.46, 1.5, 1.54, 1.575, 1.605] : [1.425, 1.49, 1.55, 1.605];
  const robe = s.top.collar === 'robe';
  const rings: Ring[] = ys.map((y) => {
    const taper = 1 + smooth(1.47, 1.43, y) * 0.2;
    const cz = lerp(-0.022, -0.004, clamp01((y - 1.42) / 0.19));
    return {
      c: [0, y, cz], f: [0, 0, 1], s: [1, 0, 0], r: profile(base5.map((v) => v * taper), n, true), t: neckT(y),
      w: y < 1.47 ? wmix(wb(B.chest), wb(B.neck), smooth(1.425, 1.47, y)) : y > 1.53 ? wmix(wb(B.neck), wb(B.head), smooth(1.53, 1.6, y)) : wb(B.neck),
    };
  });
  void robe;
  loft(G, rings, { n, uv: (u, v) => ruv(R.neck, u, v) });
}

// ------------------------------------------------------------------ arms

function buildArm(c: Ctx, side: number) {
  const { G, sk, s, hi } = c;
  const n = hi ? 8 : 6;
  const L = side > 0;
  const S = sk.J[L ? B.upperarm_l : B.upperarm_r], E = sk.J[L ? B.forearm_l : B.forearm_r], Wr = sk.J[L ? B.hand_l : B.hand_r];
  const d1 = v3norm(v3sub(E, S)), d2 = v3norm(v3sub(Wr, E));
  const ul = sk.upperLen, fl = sk.foreLen;
  const scale = (s.sex === 'f' ? 0.86 : 1) * (0.84 + s.build * 0.34);
  const top = s.top;
  const se = sleeveEnd(top);
  const sl = top.sleeveLoose ?? Math.max(0.006, top.loose * 0.7);
  let ds = hi ? [-0.042, -0.03, -0.015, 0, 0.05, 0.12, 0.2, 0.255, 0.29, 0.33, 0.39, 0.46, 0.52, 0.548] : [-0.04, -0.015, 0.05, 0.16, 0.29, 0.4, 0.52, 0.548];
  type AR = { d: number; kind: 'n' | 'cuff' | 'skin' | 'roll' };
  let rows: AR[];
  if (se > 0) {
    ds = ds.filter((d) => Math.abs(d - se) > 0.016);
    rows = ds.map((d) => ({ d, kind: 'n' as const }));
    if (top.sleeve === 'rolled') rows.push({ d: se - 0.03, kind: 'roll' }, { d: se, kind: 'roll' });
    else rows.push({ d: se, kind: 'cuff' });
    if (se < 0.53) rows.push({ d: se + 0.005, kind: 'skin' });
    rows.sort((a, b) => a.d - b.d);
  } else rows = ds.map((d) => ({ d, kind: 'n' as const }));

  const fr1 = frame(d1, [side, 0, 0], [0, 0, 1]);
  const fr2 = frame(d2, [side, 0, 0], [0, 0, 1]);
  const rings: Ring[] = rows.map(({ d, kind }) => {
    let ctr: V3, f: V3, sv: V3;
    if (d <= ul) {
      ctr = v3add(S, v3mul(d1, d));
      const k = smooth(ul - 0.04, ul + 0.03, d);
      f = v3norm(v3add(v3mul(fr1.f, 1 - k), v3mul(fr2.f, k))); sv = v3norm(v3add(v3mul(fr1.s, 1 - k), v3mul(fr2.s, k)));
    } else {
      ctr = v3add(E, v3mul(d2, d - ul));
      const k = smooth(ul - 0.04, ul + 0.03, d);
      f = v3norm(v3add(v3mul(fr1.f, 1 - k), v3mul(fr2.f, k))); sv = v3norm(v3add(v3mul(fr1.s, 1 - k), v3mul(fr2.s, k)));
    }
    // shoulder dome
    let rs = armProf(Math.max(0, d)).map((v) => v * scale);
    if (d < 0) {
      const k = clamp01(-d / 0.05);
      const sc = Math.sqrt(Math.max(0, 1 - k * k * 0.86));
      rs = rs.map((v) => v * sc);
      ctr = v3add(ctr, [-side * 0.006 * k, 0, 0]);
    }
    const covered = se > 0 && (kind === 'cuff' || kind === 'roll' || (kind === 'n' && d < se));
    if (covered) {
      let add = sl;
      if (top.sleeve === 'short' || top.sleeve === 'cap') add += smooth(se - 0.08, se, d) * 0.008; // sleeve flare
      if (kind === 'roll') add += 0.01;
      if (kind === 'cuff' && top.sleeve === 'long') add += 0.004;
      rs = rs.map((v) => v + add);
    }
    if (top.collar === 'robe' && side < 0 && d < 0.22) rs = rs.map((v) => v + 0.02 * smooth(0.22, 0.05, d)); // robe over right shoulder
    // weights
    let w: W;
    if (d < 0.07) w = wmix(wmix(wb(L ? B.clav_l : B.clav_r), wb(L ? B.upperarm_l : B.upperarm_r), 0.55), wb(L ? B.upperarm_l : B.upperarm_r), smooth(-0.05, 0.07, d));
    else if (d < ul + 0.05) w = wmix(wb(L ? B.upperarm_l : B.upperarm_r), wb(L ? B.forearm_l : B.forearm_r), smooth(ul - 0.035, ul + 0.04, d));
    else w = wmix(wb(L ? B.forearm_l : B.forearm_r), wb(L ? B.hand_l : B.hand_r), smooth(ul + fl - 0.03, ul + fl + 0.01, d));
    return { c: ctr, f, s: sv, r: profile(rs, n, false), t: armT(d), w };
  });
  loft(G, rings, { n, uv: (u, v) => ruv(R.arm, u, v), capStart: { depth: 0.01 }, capEnd: { depth: 0.004 } });
}

// ------------------------------------------------------------------ hands (mitten + thumb)

function superR(hw: number, hh: number, p: number, n: number) {
  // radius per segment of a superellipse, θ=0 along "h" (f) axis, θ=90 along "w" (s) axis
  const out: number[] = [];
  for (let j = 0; j < n; j++) {
    const th = -Math.PI + (2 * Math.PI * j) / n;
    const c = Math.abs(Math.cos(th)), s = Math.abs(Math.sin(th));
    out.push(1 / Math.pow(Math.pow(c / hh, p) + Math.pow(s / hw, p), 1 / p));
  }
  return out;
}

function buildHand(c: Ctx, side: number) {
  const { G, sk, s, hi } = c;
  const L = side > 0;
  const n = hi ? 8 : 4;
  const E = sk.J[L ? B.forearm_l : B.forearm_r], Wr = sk.J[L ? B.hand_l : B.hand_r];
  const a = v3norm(v3sub(Wr, E));
  const fr = frame(a, [side, 0, 0], [0, 0, 1]); // f = back of hand (lateral), s = thumb side (front)
  const k = (s.sex === 'f' ? 0.89 : 1) * (0.95 + s.build * 0.1);
  const secs: [number, number, number, number][] = hi
    ? [[-0.012, 0.024, 0.017, 0], [0.0, 0.03, 0.018, 0], [0.03, 0.039, 0.018, 0], [0.065, 0.043, 0.016, 0.002], [0.095, 0.042, 0.014, 0.005], [0.125, 0.04, 0.012, 0.01], [0.155, 0.037, 0.011, 0.017], [0.175, 0.031, 0.009, 0.024]]
    : [[-0.012, 0.026, 0.017, 0], [0.04, 0.04, 0.017, 0], [0.1, 0.042, 0.014, 0.005], [0.17, 0.033, 0.01, 0.02]];
  const hb = L ? B.hand_l : B.hand_r, fb = L ? B.forearm_l : B.forearm_r;
  const rings: Ring[] = secs.map(([d, hw, ht, curl]) => ({
    c: v3add(v3add(Wr, v3mul(a, d * k)), v3mul(fr.f, -curl * k)),
    f: fr.f, s: fr.s, r: superR(hw * k, ht * k, 2.6, n), t: handT(d), w: d < 0.005 ? wmix(wb(fb), wb(hb), 0.6) : wb(hb),
  }));
  loft(G, rings, { n, uv: (u, v) => ruv(R.hand, u, v), capEnd: { depth: 0.008 * k } });
  if (hi) {
    // thumb
    const base = v3add(v3add(v3add(Wr, v3mul(a, 0.028 * k)), v3mul(fr.s, 0.028 * k)), v3mul(fr.f, -0.009 * k));
    const td = v3norm(v3add(v3add(v3mul(a, 0.62), v3mul(fr.s, 0.55)), v3mul(fr.f, -0.4)));
    const tf = frame(td, fr.f, fr.s);
    const tr: [number, number][] = [[-0.006, 0.0125], [0.022, 0.0115], [0.042, 0.0095], [0.056, 0.0075]];
    const trings: Ring[] = tr.map(([d, r]) => ({ c: v3add(base, v3mul(td, d * k)), f: tf.f, s: tf.s, r: new Array(6).fill(r * k), t: handT(0.05 + d), w: wb(hb) }));
    loft(G, trings, { n: 6, uv: (u, v) => ruv(R.hand, u * 0.25, v), capEnd: { depth: 0.006 * k } });
  }
}

// ------------------------------------------------------------------ legs

function buildLeg(c: Ctx, side: number) {
  const { G, sk, s, hi } = c;
  const L = side > 0;
  const n = hi ? 10 : 6;
  const H = sk.J[L ? B.thigh_l : B.thigh_r], K = sk.J[L ? B.shin_l : B.shin_r], A = sk.J[L ? B.foot_l : B.foot_r];
  const bot = s.bottom, shoe = s.shoe;
  const thighK = (s.sex === 'f' ? 0.97 : 1) * (0.8 + s.build * 0.42);
  const calfK = (s.sex === 'f' ? 0.9 : 1) * (0.86 + s.build * 0.3);
  let ys = hi ? [0.99, 0.94, 0.9, 0.84, 0.78, 0.71, 0.64, 0.57, 0.52, 0.48, 0.44, 0.39, 0.33, 0.26, 0.19, 0.13, 0.09] : [0.99, 0.86, 0.72, 0.58, 0.48, 0.38, 0.25, 0.13, 0.09];
  const legWear = isLegWear(bot);
  const tube = isTube(bot);
  const hem = bot.hem;
  const boot = shoe.kind === 'boot';
  const bootTop = 0.4;
  type LR = { y: number; kind: 'n' | 'hem' | 'skin' | 'bootTop' | 'bootIn' };
  let rows: LR[] = ys.map((y) => ({ y, kind: 'n' as const }));
  if (tube) rows = rows.filter((r) => r.y < hem + 0.04);
  if (legWear) {
    rows = rows.filter((r) => Math.abs(r.y - hem) > 0.016);
    rows.push({ y: hem, kind: 'hem' });
    if (hem > 0.1) rows.push({ y: hem - 0.005, kind: 'skin' });
    else rows = rows.filter((r) => r.kind === 'hem' || r.y > hem);
  }
  if (boot && !(legWear && hem < bootTop)) {
    rows = rows.filter((r) => Math.abs(r.y - bootTop) > 0.016);
    rows.push({ y: bootTop + 0.004, kind: 'bootIn' }, { y: bootTop, kind: 'bootTop' });
  }
  rows.sort((a, b) => b.y - a.y);
  if (!rows.length) return;
  const kneeR = legProf(0.48)[0] * thighK;
  const rings: Ring[] = rows.map(({ y, kind }) => {
    let ctr: V3;
    if (y >= K[1]) { const t = (H[1] - y) / (H[1] - K[1]); ctr = v3add(H, v3mul(v3sub(K, H), t)); }
    else { const t = (K[1] - y) / (K[1] - A[1]); ctr = v3add(K, v3mul(v3sub(A, K), t)); }
    ctr = [ctr[0] + side * 0.012 * smooth(0.74, 0.95, y), y, ctr[2] + 0.004 * smooth(0.74, 0.95, y)];
    const kk = y > 0.46 ? thighK : lerp(calfK, thighK, smooth(0.42, 0.48, y));
    let rs = legProf(y).map((v) => v * kk);
    const covered = legWear && (kind === 'hem' || (kind === 'n' && y > hem) || kind === 'bootIn' && y > hem);
    if (covered) {
      let add = bot.loose;
      if (bot.kind === 'trousers' && y < 0.5) {
        const straight = kneeR * 0.98 + bot.loose * 0.8;
        rs = rs.map((v) => Math.max(v + add * 0.4, straight * lerp(1, 0.92, smooth(0.5, 0.06, y))));
        add = 0;
      }
      if (kind === 'hem') add += bot.kind === 'shorts' ? 0.005 : 0.004;
      rs = rs.map((v) => v + add);
    }
    if (boot && (y < bootTop || kind === 'bootTop') && kind !== 'bootIn' && !(covered && bot.kind === 'trousers')) {
      rs = rs.map((v) => Math.max(v + 0.006, 0.05 * calfK + 0.008));
    }
    let w: W;
    if (y > 0.85) w = wmix(wb(L ? B.thigh_l : B.thigh_r), wb(B.hips), smooth(0.88, 1.0, y) * 0.6);
    else if (y > 0.4) w = wmix(wb(L ? B.thigh_l : B.thigh_r), wb(L ? B.shin_l : B.shin_r), smooth(0.53, 0.43, y));
    else w = wmix(wb(L ? B.shin_l : B.shin_r), wb(L ? B.foot_l : B.foot_r), smooth(0.13, 0.07, y));
    return { c: ctr, f: [0, 0, 1], s: [side, 0, 0], r: profile(rs, n, false), t: legT(y), w };
  });
  loft(G, rings, { n, uv: (u, v) => ruv(R.leg, u, v), capStart: { depth: 0.01 }, capEnd: { depth: 0.006 } });
}

// ------------------------------------------------------------------ feet & shoes

function buildFoot(c: Ctx, side: number) {
  const { G, sk, s, hi } = c;
  const L = side > 0;
  const n = hi ? 8 : 6;
  const A = sk.J[L ? B.foot_l : B.foot_r];
  const shoe = s.shoe;
  const fk = (s.sex === 'f' ? 0.9 : 1);
  // sections: z, half-width, bottom y, top y
  let secs: [number, number, number, number][] = [
    [-0.068, 0.026, 0.008, 0.045], [-0.05, 0.034, 0.0, 0.07], [-0.02, 0.037, 0.0, 0.095], [0.02, 0.04, 0.0, 0.085],
    [0.07, 0.044, 0.0, 0.062], [0.12, 0.048, 0.0, 0.042], [0.155, 0.047, 0.0, 0.032], [0.185, 0.043, 0.0, 0.026], [0.2, 0.032, 0.003, 0.021],
  ];
  let lift = 0;
  const kind = shoe.kind;
  if (kind === 'sneaker' || kind === 'boot') secs = secs.map(([z, w, b, t], i) => [z * 1.1 + (i === 0 ? -0.008 : 0), w + 0.009, Math.max(0, b - 0.003), t + (i >= 4 ? 0.02 : 0.016)]);
  else if (kind === 'leather' || kind === 'school') secs = secs.map(([z, w, b, t], i) => [z * 1.1 + (i === 8 ? 0.012 : 0), w + 0.005 - (i === 8 ? 0.006 : 0), b, t + (i >= 4 ? 0.012 : 0.01)]);
  else if (kind === 'flipflop' || kind === 'sandal' || kind === 'slipper') lift = kind === 'sandal' ? 0.016 : 0.012;
  if (kind === 'boot') secs[1][3] = secs[2][3] = 0.15;
  if (!hi) secs = [secs[0], secs[2], secs[4], secs[6], secs[8]];
  const yaw = side * 0.12;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const rot = (p: V3): V3 => {
    const dx = p[0] - A[0], dz = p[2] - A[2];
    return [A[0] + dx * cy + dz * sy, p[1], A[2] - dx * sy + dz * cy];
  };
  const fb = L ? B.foot_l : B.foot_r, sb = L ? B.shin_l : B.shin_r;
  const fwd: V3 = [sy, 0, cy];
  const rings: Ring[] = secs.map(([z, hw, yb, yt]) => {
    const ctr = rot([A[0], (yb + yt) / 2 + lift, A[2] + z * fk]);
    return {
      c: ctr, f: [0, 1, 0], s: v3norm(v3cross(fwd, [0, -side, 0]).map((v) => v) as V3), r: superR(hw * fk, (yt - yb) / 2, 2.8, n), t: footT(z),
      w: z < 0.0 && yt > 0.08 ? wmix(wb(fb), wb(sb), 0.35) : wb(fb),
    };
  });
  // s must point to the outer side
  for (const rg of rings) if (rg.s[0] * side < 0) rg.s = v3mul(rg.s, -1);
  loft(G, rings, { n, uv: (u, v) => ruv(R.foot, u, v), capStart: { depth: 0.008 }, capEnd: { depth: 0.006 } });
  if (lift > 0) {
    // sole slab (flip-flop / sandal / slide)
    const th = lift;
    const slab: [number, number][] = hi ? [[-0.074, 0.03], [-0.05, 0.038], [0.0, 0.04], [0.07, 0.047], [0.14, 0.052], [0.19, 0.047], [0.215, 0.03]] : [[-0.074, 0.032], [0.04, 0.046], [0.215, 0.034]];
    const srings: Ring[] = slab.map(([z, hw]) => ({
      c: rot([A[0], th / 2, A[2] + z * fk]), f: [0, 1, 0], s: [side * cy, 0, -side * sy], r: superR(hw * fk, th / 2, 5, n), t: (z + 0.08) / 0.3, w: wb(fb),
    }));
    loft(G, srings, { n, uv: (u, v) => ruv(R.sole, u, v), capStart: { depth: 0.004 }, capEnd: { depth: 0.006 } });
  }
}

// ------------------------------------------------------------------ head

export function headWeights(ry: number): W {
  return ry < 0.012 ? wmix(wb(B.neck), wb(B.head), smooth(-0.035, 0.012, ry)) : wb(B.head);
}

function buildHead(c: Ctx) {
  const { G, sk, s, hi } = c;
  const n = hi ? 16 : 10;
  const Hd = sk.J[B.head];
  const hs = headScale(s.sex, s.build);
  const rows = hi ? HEAD : [HEAD[0], HEAD[2], HEAD[4], HEAD[6], HEAD[8], HEAD[9], HEAD[11], HEAD[12], HEAD[13], HEAD[14]];
  const rings: Ring[] = rows.map((row) => {
    const ry = row[0] * hs;
    // chubby cheeks / jaw
    const ctrl = row.slice(2).map((v, i) => {
      let r = v * hs;
      if (row[0] < 0.1 && row[0] > 0.0 && i >= 2 && i <= 5) r *= 1 + (s.build - 0.4) * 0.07;
      if (s.sex === 'f' && row[0] < 0.05 && i >= 1 && i <= 4) r *= 0.95; // softer jaw
      return r;
    });
    return { c: [Hd[0], Hd[1] + ry, Hd[2] + row[1] * hs], f: [0, 0, 1], s: [1, 0, 0], r: profile(ctrl, n, true), t: 0, w: headWeights(ry) };
  });
  const P = loftGrid(rings, n);
  const N = gridNormals(rings, P, n);
  const jA = Math.round(n * 0.19), jB = n - jA; // front island columns [jA, jB]
  const thA = -Math.PI + (2 * Math.PI * jA) / n, thB = -Math.PI + (2 * Math.PI * jB) / n;
  const uvFront = (p: V3) => ruv(R.face, faceU(p[0] - Hd[0]), faceV(p[1] - Hd[1]));
  const uvBack = (p: V3, jj: number) => {
    const th = -Math.PI + (2 * Math.PI * jj) / n; // jj from jB .. n + jA
    const sN = (th - thB) / (Math.PI * 2 - (thB - thA));
    return ruv(R.scalp, sN, (SCALP_TOP - (p[1] - Hd[1])) / (SCALP_TOP - SCALP_BOT));
  };
  const f = loft(G, rings, { n, uv: () => [0, 0], cols: [jA, jB], normals: N, uvFn: (p) => uvFront(p) });
  const b = loft(G, rings, { n, uv: () => [0, 0], cols: [jB, n + jA], normals: N, uvFn: (p, jj) => uvBack(p, jj) });
  // crown caps (one per island)
  const topRing = rings[rings.length - 1];
  const crown: V3 = [Hd[0], Hd[1] + HEAD_TOP * hs, Hd[2] - 0.006 * hs];
  const up: V3 = [0, 1, 0];
  const cf = G.v(crown, up, ...uvFront(crown), wb(B.head));
  const [bu, bv] = ruv(R.scalp, 0.5, 0);
  const cb = G.v(crown, up, bu, bv, wb(B.head));
  const fr = f.idx[f.idx.length - 1], br = b.idx[b.idx.length - 1];
  for (let k = 0; k < fr.length - 1; k++) G.triOut(fr[k], fr[k + 1], cf, up);
  for (let k = 0; k < br.length - 1; k++) G.triOut(br[k], br[k + 1], cb, up);
  void topRing;
  buildNose(c, Hd, hs);
  if (hi) for (const side of [1, -1]) buildEar(c, Hd, hs, side);
}

function faceZ(ry: number, x: number, hs: number) {
  // z of the face surface at (x, ry) (head-local), via the head profile
  const th = Math.asin(Math.max(-1, Math.min(1, x / Math.max(0.03, headAt(0, ry / hs, hs).r))));
  const h = headAt(th, ry / hs, hs);
  return h.cz + Math.cos(th) * h.r;
}

function buildNose(c: Ctx, Hd: V3, hs: number) {
  const { G } = c;
  const P = (x: number, ry: number, dz: number): V3 => [Hd[0] + x * hs, Hd[1] + ry * hs, Hd[2] + faceZ(ry * hs, x * hs, hs) + dz * hs];
  const pts: Record<string, V3> = {
    top: P(0, 0.118, -0.001), mid: P(0, 0.097, 0.009), tip: P(0, 0.074, 0.023), base: P(0, 0.061, 0.009),
    sl: P(0.010, 0.108, -0.002), sr: P(-0.010, 0.108, -0.002),
    ll: P(0.018, 0.08, -0.002), lr: P(-0.018, 0.08, -0.002),
    wl: P(0.017, 0.066, 0.005), wr: P(-0.017, 0.066, 0.005),
    bl: P(0.012, 0.059, -0.002), br: P(-0.012, 0.059, -0.002),
    tl: P(0.008, 0.074, 0.016), tr: P(-0.008, 0.074, 0.016),
  };
  const idx: Record<string, number> = {};
  for (const [k, p] of Object.entries(pts)) {
    const nrm = v3norm(v3sub(p, [Hd[0], Hd[1] + 0.085 * hs, Hd[2] - 0.02]));
    const [u, v] = ruv(R.face, faceU(p[0] - Hd[0]), faceV(p[1] - Hd[1]));
    idx[k] = G.v(p, nrm, u, v, wb(B.head));
  }
  const out: V3 = [0, 0, 1];
  const T = (a: string, b2: string, c2: string, o: V3 = out) => G.triOut(idx[a], idx[b2], idx[c2], o);
  T('top', 'sl', 'mid'); T('top', 'mid', 'sr');
  T('sl', 'll', 'mid'); T('sr', 'mid', 'lr');
  T('mid', 'll', 'tl'); T('mid', 'tl', 'tip'); T('mid', 'tip', 'tr'); T('mid', 'tr', 'lr');
  T('ll', 'wl', 'tl'); T('lr', 'tr', 'wr');
  T('tl', 'wl', 'tip', [0.3, -0.2, 1]); T('tr', 'tip', 'wr', [-0.3, -0.2, 1]);
  T('wl', 'bl', 'base', [0.2, -1, 0.3]); T('wl', 'base', 'tip', [0, -1, 0.4]); T('wr', 'tip', 'base', [0, -1, 0.4]); T('wr', 'base', 'br', [-0.2, -1, 0.3]);
  T('ll', 'bl', 'wl', [1, -0.3, 0.3]); T('lr', 'wr', 'br', [-1, -0.3, 0.3]);
}

function buildEar(c: Ctx, Hd: V3, hs: number, side: number) {
  const { G } = c;
  // C-shaped flap: inner points on the head surface, outer rim sticking out
  const pts: [number, number][] = [[0.128, -0.004], [0.121, -0.016], [0.105, -0.021], [0.088, -0.018], [0.074, -0.011], [0.066, -0.002]];
  const th = (side > 0 ? 1 : -1) * (Math.PI / 2 + 0.12);
  const inner: number[] = [], outer: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const [ry, dz] = pts[i];
    const h = headAt(th, ry, hs);
    const base: V3 = [Hd[0] + Math.sin(th) * h.r * 0.97, Hd[1] + ry * hs, Hd[2] + h.cz + Math.cos(th) * h.r * 0.97 + dz * 0.4];
    const stick = (i === 0 || i === pts.length - 1 ? 0.008 : 0.016) * hs;
    const o: V3 = [base[0] + side * stick, base[1], base[2] + dz * hs - 0.004];
    const nrm: V3 = v3norm([side * 0.6, 0, 0.8]);
    const [u1, v1] = ruv(R.ear, 0.15, i / (pts.length - 1));
    const [u2, v2] = ruv(R.ear, 0.85, i / (pts.length - 1));
    inner.push(G.v(base, nrm, u1, v1, wb(B.head)));
    outer.push(G.v(o, nrm, u2, v2, wb(B.head)));
  }
  const fwd: V3 = v3norm([side * 0.5, 0, 1]);
  const back: V3 = v3norm([side * 0.5, 0, -1]);
  for (let i = 0; i < pts.length - 1; i++) {
    G.triOut(inner[i], outer[i], inner[i + 1], fwd); G.triOut(inner[i + 1], outer[i], outer[i + 1], fwd);
    G.triOut(inner[i], inner[i + 1], outer[i], back); G.triOut(inner[i + 1], outer[i + 1], outer[i], back);
  }
}

// ------------------------------------------------------------------ skirt / wrap tube

function skirtWeights(p: V3, y: number, hem: number): W {
  const k = smooth(0.88, 0.5, y) * 0.85;
  if (k <= 0) return wb(B.hips);
  const ts = clamp01(0.5 + p[0] / 0.16);
  const ks = hem < 0.35 ? smooth(0.46, 0.12, y) * 0.75 : 0;
  return [B.hips, 1 - k, B.thigh_l, k * ts * (1 - ks), B.thigh_r, k * (1 - ts) * (1 - ks), B.shin_l, k * ts * ks, B.shin_r, k * (1 - ts) * ks];
}

function buildSkirt(c: Ctx) {
  const { G, s, hi } = c;
  const n = hi ? 14 : 8;
  const bot = s.bottom;
  const waist = bot.waist + 0.012, hem = bot.hem;
  const flare = bot.flare ?? 0;
  const ys: number[] = [];
  const steps = hi ? 8 : 4;
  for (let i = 0; i <= steps; i++) ys.push(lerp(waist, hem, Math.pow(i / steps, 0.85)));
  const rings: Ring[] = ys.map((y) => {
    const t = (waist - y) / (waist - hem);
    const p = torsoProfile(s.sex, s.build, Math.max(0.84, Math.min(1.1, y)));
    const r5 = p.slice(0, 5);
    // enclose both legs below the crotch
    const legW = 0.175 + s.build * 0.03, legF = 0.11 + s.build * 0.02, legB = 0.125 + s.build * 0.02;
    const below = smooth(0.92, 0.8, y);
    const narrow = bot.kind === 'wrap' && hem < 0.3 ? smooth(0.6, hem, y) * 0.035 : 0;
    const ext = bot.loose + flare * t;
    const ctrl = [
      Math.max(r5[0], legF * below) + ext,
      Math.max(r5[1], (legF + legW) * 0.52 * below) + ext - narrow * 0.5,
      Math.max(r5[2], legW * below) + ext - narrow,
      Math.max(r5[3], (legB + legW) * 0.52 * below) + ext - narrow * 0.5,
      Math.max(r5[4], legB * below) + ext,
    ];
    return { c: [0, y, p[5]], f: [0, 0, 1], s: [1, 0, 0], r: profile(ctrl, n, true), t: clamp01(t), w: (pp: V3) => skirtWeights(pp, y, hem) };
  });
  // inner lip at the hem (thickness)
  const last = rings[rings.length - 1];
  rings.push({ ...last, c: [last.c[0], last.c[1] + 0.012, last.c[2]], r: last.r.map((v) => v - 0.01), t: 1 });
  loft(G, rings, { n, uv: (u, v) => ruv(R.skirt, u, v) });
}

// ------------------------------------------------------------------ collar

function buildCollar(c: Ctx) {
  const { G, s, hi } = c;
  const col = s.top.collar;
  if (!['polo', 'shirt', 'camp', 'suit', 'mandarin'].includes(col)) return;
  const n = hi ? 16 : 10;
  const k = (s.sex === 'f' ? 0.86 : 1) * (0.92 + s.build * 0.18);
  const rn = 0.056 * k;
  const open = col === 'camp' ? 0.75 : col === 'suit' ? 0.55 : col === 'mandarin' ? 0.22 : 0.38; // half opening (rad) at the front
  // rows: [y, radius add, t]
  const rows: [number, number, number][] = col === 'mandarin'
    ? [[1.438, 0.006, 1], [1.478, 0.008, 0]]
    : [[1.44, 0.006, 1], [1.487, 0.011, 0.45], [1.462, col === 'camp' ? 0.05 : 0.036, 0]];
  const jFrom = Math.ceil((n / (Math.PI * 2)) * (Math.PI + open));
  const jTo = Math.floor((n / (Math.PI * 2)) * (Math.PI * 3 - open));
  const rings: Ring[] = rows.map(([y, add, t]) => ({
    c: [0, y, -0.016], f: [0, 0, 1], s: [1, 0, 0], r: new Array(n).fill(0).map((_, j) => {
      const th = -Math.PI + (2 * Math.PI * j) / n;
      return rn + add + Math.cos(th) * 0.004;
    }), t, w: [B.neck, 0.35, B.chest, 0.65],
  }));
  const uvFn = (_p: V3, jj: number, i: number) => ruv(R.collar, (jj - jFrom) / Math.max(1, jTo - jFrom), rows[i][2]);
  const outer = loft(G, rings, { n, uv: () => [0, 0], cols: [jFrom, jTo], uvFn });
  // back faces (inside of the collar)
  const base = G.count;
  const P = outer.P, N = outer.N;
  const idx: number[][] = [];
  for (let i = 0; i < rows.length; i++) {
    const r: number[] = [];
    for (let jj = jFrom; jj <= jTo; jj++) {
      const j = jj % n;
      const [u, v] = uvFn(P[i][j], jj, i);
      r.push(G.v(P[i][j], v3mul(N[i][j], -1), u, v, [B.neck, 0.35, B.chest, 0.65]));
    }
    idx.push(r);
  }
  void base;
  for (let i = 0; i < idx.length - 1; i++) for (let kk = 0; kk < idx[i].length - 1; kk++) {
    const a = idx[i], b = idx[i + 1];
    const ctr: V3 = [0, rows[i][0], -0.016];
    const pa = P[i][(jFrom + kk) % n];
    const inward = v3sub(ctr, pa);
    G.triOut(a[kk], b[kk], a[kk + 1], inward); G.triOut(a[kk + 1], b[kk], b[kk + 1], inward);
  }
}

// ------------------------------------------------------------------ apron

function buildApron(c: Ctx) {
  const { G, s, hi } = c;
  const cols = hi ? 8 : 4;
  const ys = hi ? [1.31, 1.24, 1.16, 1.08, 1.0, 0.92, 0.84, 0.76, 0.66, 0.56] : [1.31, 1.12, 0.96, 0.8, 0.56];
  const front = (y: number, x: number) => {
    if (y > 0.86) {
      const th = Math.atan2(x, 0.12);
      return c.torsoC(y) + c.torsoR(y, th) * Math.cos(th) + 0.012;
    }
    return 0.125 + s.build * 0.05 - Math.abs(x) * 0.15;
  };
  const halfW = (y: number) => (y > 1.12 ? lerp(0.1, 0.13, smooth(1.31, 1.12, y)) : 0.17 + s.build * 0.04);
  const grid: number[][] = [], gridB: number[][] = [];
  for (let i = 0; i < ys.length; i++) {
    const y = ys[i];
    const row: number[] = [], rowB: number[] = [];
    for (let j = 0; j <= cols; j++) {
      const x = lerp(-halfW(y), halfW(y), j / cols);
      const p: V3 = [x, y, front(y, x)];
      const k = smooth(0.86, 0.6, y) * 0.8;
      const ts = clamp01(0.5 + x / 0.18);
      const base = y > 1.25 ? wb(B.chest) : y > 1.05 ? wmix(wb(B.spine), wb(B.chest), smooth(1.05, 1.25, y)) : wb(B.hips);
      const w: W = k > 0 ? [B.hips, 1 - k, B.thigh_l, k * ts, B.thigh_r, k * (1 - ts)] : base;
      const [u, v] = ruv(R.apron, j / cols, (1.31 - y) / (1.31 - 0.56));
      row.push(G.v(p, [x * 2, 0, 1], u, v, w));
      rowB.push(G.v(p, [-x * 2, 0, -1], u, v, w));
    }
    grid.push(row); gridB.push(rowB);
  }
  for (let i = 0; i < ys.length - 1; i++) for (let j = 0; j < cols; j++) {
    G.triOut(grid[i][j], grid[i + 1][j], grid[i][j + 1], [0, 0, 1]); G.triOut(grid[i][j + 1], grid[i + 1][j], grid[i + 1][j + 1], [0, 0, 1]);
    G.triOut(gridB[i][j], gridB[i][j + 1], gridB[i + 1][j], [0, 0, -1]); G.triOut(gridB[i][j + 1], gridB[i + 1][j + 1], gridB[i + 1][j], [0, 0, -1]);
  }
}

// ------------------------------------------------------------------ backpack

function buildBackpack(c: Ctx) {
  const { G, s, hi } = c;
  const n = hi ? 12 : 8;
  const ys = hi ? [1.0, 1.03, 1.12, 1.25, 1.36, 1.41, 1.43] : [1.0, 1.15, 1.35, 1.43];
  const rings: Ring[] = ys.map((y, i) => {
    const back = c.torsoC(y) - c.torsoR(y, Math.PI);
    const shrink = i === 0 || i === ys.length - 1 ? 0.75 : i === 1 || i === ys.length - 2 ? 0.94 : 1;
    const hw = 0.135 * shrink, hd = 0.075 * shrink;
    return { c: [0, y, back - hd - 0.008], f: [0, 0, -1], s: [-1, 0, 0], r: superR(hw, hd, 3.5, n), t: (y - 1.0) / 0.43, w: y > 1.25 ? wb(B.chest) : wmix(wb(B.spine), wb(B.chest), smooth(1.05, 1.25, y)) };
  });
  void s;
  loft(G, rings, { n, uv: (u, v) => ruv(R.pack, u, 1 - v), capStart: { depth: 0.01 }, capEnd: { depth: 0.01 } });
}

// ------------------------------------------------------------------ towel around the neck

function buildTowel(c: Ctx) {
  const { G, hi } = c;
  const path: V3[] = [];
  const pts: [number, number][] = [[1.24, 0.95], [1.33, 0.9], [1.42, 0.62], [1.475, 0.25], [1.49, 0.0]]; // y, angle (rad from back)
  const full: [number, number, number][] = [];
  for (const side of [1, -1]) for (const [y, a] of (side > 0 ? pts : pts.slice().reverse())) full.push([y, a * side, side]);
  // left chest → over left shoulder → behind neck → right shoulder → right chest
  const seq = full.filter((_, i, arr) => !(i > 0 && arr[i - 1][0] === full[i][0] && arr[i - 1][1] === full[i][1]));
  for (const [y, a] of seq) {
    // a: angle measured from the back (0) towards the front (±π)
    const th = Math.PI - Math.abs(a);
    const thS = a >= 0 ? th : -th;
    const ry = y > 1.44 ? 0.075 + (1.49 - y) * 0.4 : c.torsoR(y, thS) + 0.012;
    const cz = y > 1.44 ? -0.016 : c.torsoC(y);
    path.push([Math.sin(thS) * ry, y + 0.006, cz + Math.cos(thS) * ry]);
  }
  const segs = hi ? 6 : 4;
  const rings: Ring[] = path.map((p, i) => {
    const a = v3norm(v3sub(path[Math.min(path.length - 1, i + 1)], path[Math.max(0, i - 1)]));
    const outward = v3norm([p[0], 0, p[2] + 0.016]);
    const fr = frame(a, outward);
    const y = p[1];
    return { c: p, f: fr.f, s: fr.s, r: superR(0.032, 0.011, 2.2, segs).map((v, j) => v) as number[], t: i / (path.length - 1), w: y > 1.44 ? [B.chest, 0.6, B.neck, 0.4] : wb(B.chest) };
  });
  // superR's θ=0 axis is "h" (f) → swap so the flat side faces the body: radius along f is thickness
  for (const rg of rings) rg.r = superR(0.03, 0.011, 2.2, segs).map((_, j) => { const th = -Math.PI + (2 * Math.PI * j) / segs; const cc = Math.abs(Math.cos(th)), ss = Math.abs(Math.sin(th)); return 1 / Math.pow(Math.pow(cc / 0.011, 2.2) + Math.pow(ss / 0.03, 2.2), 1 / 2.2); });
  loft(G, rings, { n: segs, uv: (u, v) => ruv(R.towel, v, u), capStart: { depth: 0.004 }, capEnd: { depth: 0.004 } });
}

export { lerp };
