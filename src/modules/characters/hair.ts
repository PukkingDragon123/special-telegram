import { Noise } from '../../core/rng';
import { Geo, Ring, V3, W, frame, lerp, loft, smooth, v3add, v3mul, v3norm, v3sub, wb, wmix, clamp01 } from './geo';
import { B, RestSkel } from './skel';
import { R, ruv, faceU, faceV, EYE_X, EYE_Y } from './layout';
import { HEAD_TOP, headAt, headScale, headWeights, BodySpec, Lod } from './body';
import type { AccSpec } from './defs';

/* ============================================================================================
 * Hair (parametric shells around the skull), hats and head/neck/wrist accessories.
 * ========================================================================================== */

const N3 = new Noise('hair');

interface Style {
  /** hairline ry (reference head units) at |θ| degrees (0 = front, 180 = back) */
  line: (a: number) => number;
  /** shell thickness at |θ|, ry */
  thick: (a: number, ry: number) => number;
  noise?: [number, number, number?, number?];
  /** hanging curtain below the hairline: end ry per |θ| (only where < hairline) */
  curtain?: (a: number) => number;
  /** curtain only for |θ| ≥ gap */
  gap?: number;
  flare?: number;
  extra?: 'ponytail' | 'bun';
  /** only columns |θ| ≥ this (bald horseshoe) */
  minA?: number;
  /** upper ry bound (bald horseshoe top edge) */
  top?: number;
  /** spikes amplitude */
  spikes?: number;
  /** asymmetric volume (side part) */
  sweep?: number;
  /** headband should sit under this hair (afro) */
  bandUnder?: boolean;
}

const lineStd = (front = 0.176, temple = 0.158, side = 0.124, behind = 0.098, back = 0.035) => (a: number) =>
  a < 45 ? lerp(front, temple, a / 45) : a < 90 ? lerp(temple, side, (a - 45) / 45) : a < 125 ? lerp(side, behind, (a - 90) / 35) : lerp(behind, back, (a - 125) / 55);

export const STYLES: Record<string, Style> = {
  buzz: { line: lineStd(0.174, 0.156, 0.12, 0.09, 0.03), thick: () => 0.0035 },
  school_cut: { line: lineStd(0.174, 0.156, 0.12, 0.09, 0.03), thick: (_a, ry) => (ry > 0.158 ? 0.011 : 0.0028) },
  short: { line: lineStd(), thick: (a, ry) => lerp(0.017, 0.008, smooth(0.2, 0.12, ry)) + (a < 40 ? 0.004 : 0), noise: [0.002, 18] },
  salt_pepper: { line: lineStd(0.18, 0.162, 0.124, 0.098, 0.035), thick: (_a, ry) => lerp(0.014, 0.007, smooth(0.2, 0.12, ry)), noise: [0.0015, 18] },
  side_part: { line: lineStd(0.178, 0.16, 0.122, 0.096, 0.035), thick: (a, ry) => lerp(0.02, 0.008, smooth(0.2, 0.12, ry)) + (a < 50 ? 0.006 * smooth(0.16, 0.2, ry) : 0), sweep: 0.007, noise: [0.0015, 14] },
  spiky: { line: lineStd(0.176, 0.158, 0.124, 0.096, 0.035), thick: (_a, ry) => lerp(0.024, 0.006, smooth(0.2, 0.13, ry)), spikes: 0.018, noise: [0.002, 16] },
  bowl: { line: (a) => (a < 50 ? lerp(0.14, 0.135, a / 50) : a < 100 ? lerp(0.135, 0.112, (a - 50) / 50) : lerp(0.112, 0.1, (a - 100) / 80)), thick: () => 0.016, noise: [0.001, 20] },
  mullet: { line: lineStd(0.176, 0.158, 0.124, 0.096, 0.03), thick: (a, ry) => lerp(0.018, 0.006, smooth(0.2, 0.12, ry)) + (a > 130 ? 0.008 : 0), curtain: (a) => (a > 125 ? lerp(0.03, -0.085, smooth(125, 165, a)) : 1), gap: 120, flare: 0.006, noise: [0.003, 12] },
  shaggy: { line: (a) => (a < 40 ? lerp(0.135, 0.15, a / 40) : lineStd(0.17, 0.156, 0.124, 0.096, 0.03)(a)), thick: (_a, ry) => lerp(0.026, 0.014, smooth(0.2, 0.1, ry)), curtain: (a) => (a < 60 ? 1 : a < 110 ? lerp(0.02, -0.04, smooth(60, 110, a)) : lerp(-0.04, -0.08, smooth(110, 170, a))), gap: 58, flare: 0.012, noise: [0.006, 11, 0.003, 26] },
  afro: { line: (a) => (a < 40 ? 0.166 : a < 95 ? lerp(0.166, 0.07, (a - 40) / 55) : lerp(0.07, 0.01, (a - 95) / 85)), thick: (a, ry) => 0.095 * (0.42 + 0.58 * smooth(0.06, 0.17, ry)) + (a < 30 ? -0.012 : 0), noise: [0.014, 6.5, 0.006, 15], bandUnder: true },
  long: { line: lineStd(0.178, 0.16, 0.122, 0.096, 0.04), thick: (_a, ry) => lerp(0.013, 0.01, smooth(0.2, 0.12, ry)), curtain: (a) => (a < 62 ? 1 : a < 112 ? lerp(-0.06, -0.12, smooth(62, 112, a)) : lerp(-0.12, -0.27, smooth(112, 160, a))), gap: 60, flare: 0.012, noise: [0.002, 10] },
  ponytail: { line: lineStd(0.178, 0.16, 0.122, 0.096, 0.04), thick: () => 0.008, extra: 'ponytail' },
  bob: { line: lineStd(0.176, 0.158, 0.124, 0.096, 0.04), thick: (_a, ry) => lerp(0.016, 0.012, smooth(0.2, 0.12, ry)), curtain: (a) => (a < 62 ? 1 : lerp(0.03, 0.045, smooth(70, 170, a))), gap: 60, flare: 0.008, noise: [0.0015, 14] },
  school_bob: { line: (a) => (a < 45 ? lerp(0.138, 0.142, a / 45) : lineStd(0.17, 0.156, 0.124, 0.096, 0.04)(a)), thick: () => 0.014, curtain: (a) => (a < 62 ? 1 : 0.068), gap: 60, flare: 0.006, noise: [0.001, 14] },
  auntie_perm: { line: lineStd(0.172, 0.155, 0.085, 0.06, 0.03), thick: (_a, ry) => 0.03 * (0.6 + 0.4 * smooth(0.06, 0.15, ry)), noise: [0.007, 24, 0.004, 48], curtain: (a) => (a > 120 ? 0.005 : 1), gap: 118, flare: 0.004 },
  bun: { line: lineStd(0.18, 0.162, 0.124, 0.098, 0.045), thick: () => 0.007, extra: 'bun' },
  bald: { line: lineStd(0.17, 0.15, 0.104, 0.085, 0.035), thick: () => 0.006, minA: 72, top: 0.148, noise: [0.001, 20] },
  shaved: { line: () => 1, thick: () => 0 },
};

export function hairStyle(id: string): Style { return STYLES[id] ?? STYLES.short; }

/** outer hair surface offset (m) at a head point, used to fit hats/bands */
export function hairThickAt(id: string, thDeg: number, ry: number) {
  const st = hairStyle(id);
  if (id === 'shaved' || ry < st.line(thDeg) - 0.005) return 0;
  if (st.minA && thDeg < st.minA) return 0;
  return st.thick(thDeg, ry);
}

interface HCtx { G: Geo; sk: RestSkel; s: BodySpec; hi: boolean; hs: number; Hd: V3 }

/** head surface point + outward normal */
function headPt(c: HCtx, th: number, ry: number): { p: V3; n: V3 } {
  const h = headAt(th, ry / c.hs, c.hs);
  const p: V3 = [c.Hd[0] + Math.sin(th) * h.r, c.Hd[1] + ry, c.Hd[2] + h.cz + Math.cos(th) * h.r];
  const ctr: V3 = [c.Hd[0], c.Hd[1] + 0.105 * c.hs, c.Hd[2] - 0.005];
  const radial = v3norm(v3sub(p, ctr));
  const horiz = v3norm([Math.sin(th), 0, Math.cos(th)]);
  const k = smooth(0.06, 0.16, ry / c.hs);
  return { p, n: v3norm(v3add(v3mul(radial, 0.35 + 0.65 * k), v3mul(horiz, (1 - k) * 0.9))) };
}

export function buildHairAndHead(G: Geo, sk: RestSkel, s: BodySpec, lod: Lod) {
  const hs = headScale(s.sex, s.build);
  const c: HCtx = { G, sk, s, hi: lod === 'high', hs, Hd: sk.J[B.head] };
  const hat = s.acc.find((a) => a.slot === 'hat') ?? null;
  buildHair(c, s.hair, hat);
  for (const a of s.acc) buildAcc(c, a, s.hair, hat);
}

// ------------------------------------------------------------------ hair

function buildHair(c: HCtx, id: string, hat: AccSpec | null) {
  if (id === 'shaved') return;
  const st = hairStyle(id);
  const { G, hi, hs } = c;
  const J = hi ? 18 : 10, K = hi ? 7 : 4;
  const underHat = hat && hat.kind !== 'straw' ? (hat.kind === 'helmet' ? 0.13 : 0.12) : 9;
  const nz = st.noise;
  const hairW = (ry: number): W => headWeights(ry);
  const minA = st.minA ?? 0;
  // columns: θ from -π..π (seam at the back); bald: only |θ| ≥ minA
  const cols: number[] = [];
  for (let j = 0; j <= J; j++) cols.push(-Math.PI + (2 * Math.PI * j) / J);
  const topRy = (st.top ?? HEAD_TOP) * hs;
  const rowsAt = (a: number) => {
    const line = Math.min(st.line(a), topRy / hs - 0.01) * hs;
    const out: number[] = [];
    for (let k = 0; k <= K; k++) out.push(lerp(topRy - (st.top ? 0 : 0.006 * hs), line, Math.pow(k / K, st.top ? 1 : 0.8)));
    return out;
  };
  const ptAt = (th: number, ry: number, a: number, extraOut = 0): { p: V3; n: V3 } => {
    const hp = headPt(c, th, ry);
    let t = st.thick(a, ry / hs) * (ry / hs > underHat ? 0.25 : 1);
    if (nz) t += N3.n3(hp.n[0] * nz[1], hp.n[1] * nz[1], hp.n[2] * nz[1]) * nz[0] + (nz[2] ? N3.n3(hp.n[0] * nz[3]! + 9, hp.n[1] * nz[3]!, hp.n[2] * nz[3]!) * nz[2] : 0);
    if (st.spikes && ry / hs > 0.15) t += Math.max(0, N3.n3(hp.n[0] * 9, hp.n[1] * 9, hp.n[2] * 9)) * st.spikes * smooth(0.15, 0.21, ry / hs);
    if (st.sweep) t += Math.sin(th) * st.sweep * smooth(0.13, 0.19, ry / hs);
    t = Math.max(0.0025, t) + extraOut;
    return { p: v3add(hp.p, v3mul(hp.n, t)), n: hp.n };
  };
  // grid
  const grid: { p: V3; n: V3; ry: number }[][] = [];
  for (const th of cols) {
    const a = (Math.abs(th) * 180) / Math.PI;
    const col: { p: V3; n: V3; ry: number }[] = [];
    const rr = rowsAt(a);
    for (const ry of rr) { const q = ptAt(th, ry, a); col.push({ ...q, ry }); }
    grid.push(col);
  }
  const [u0, v0] = [0, 0];
  void u0; void v0;
  const idx: number[][] = grid.map((col, j) => col.map((q, k) => {
    const [u, v] = ruv(R.hair, j / J, (k / K) * 0.62);
    return G.v(q.p, q.n, u, v, hairW(q.ry));
  }));
  const okCol = (j: number) => (Math.abs(cols[j]) * 180) / Math.PI >= minA - 0.1;
  for (let j = 0; j < J; j++) {
    if (!okCol(j) || !okCol(j + 1)) continue;
    for (let k = 0; k < K; k++) {
      const a = idx[j][k], b = idx[j][k + 1], cc = idx[j + 1][k], d = idx[j + 1][k + 1];
      const out = grid[j][k + 1].n;
      G.triOut(a, b, cc, out); G.triOut(cc, b, d, out);
    }
  }
  // crown fan (not for horseshoe)
  if (!st.top) {
    const q = ptAt(0, topRy, 0);
    const crown: V3 = [c.Hd[0], q.p[1] + 0.002, c.Hd[2] - 0.008 * hs];
    const [u, v] = ruv(R.hair, 0.5, 0);
    const ci = G.v(crown, [0, 1, 0], u, v, wb(B.head));
    for (let j = 0; j < J; j++) G.triOut(idx[j][0], idx[j + 1][0], ci, [0, 1, 0]);
  }
  // bottom lip back to the scalp (gives the shell a visible thickness)
  const lip: number[] = [];
  for (let j = 0; j <= J; j++) {
    const th = cols[j];
    const a = (Math.abs(th) * 180) / Math.PI;
    const ry = grid[j][K].ry;
    const hp = headPt(c, th, ry + 0.002);
    const p = v3add(hp.p, v3mul(hp.n, 0.001));
    const [u, v] = ruv(R.hair, j / J, 0.64);
    lip.push(G.v(p, [hp.n[0], -0.6, hp.n[2]], u, v, hairW(ry)));
    void a;
  }
  for (let j = 0; j < J; j++) {
    if (!okCol(j) || !okCol(j + 1)) continue;
    const down: V3 = v3norm([grid[j][K].n[0], -1.2, grid[j][K].n[2]]);
    G.triOut(idx[j][K], lip[j], idx[j + 1][K], down); G.triOut(idx[j + 1][K], lip[j], lip[j + 1], down);
  }
  // curtain (long hair hanging below the hairline)
  if (st.curtain && (!hat || hat.kind === 'straw' || hat.kind === 'bucket' || hat.kind === 'cap' || hat.kind === 'cap_back')) {
    const gap = st.gap ?? 60;
    const ci: number[] = [];
    for (let j = 0; j <= J; j++) if ((Math.abs(cols[j]) * 180) / Math.PI >= gap) ci.push(j);
    // split into contiguous runs across the seam (back): order from left (+θ) round the back to right (-θ)
    const left = ci.filter((j) => cols[j] > 0).sort((x, y) => cols[x] - cols[y]);
    const right = ci.filter((j) => cols[j] <= 0).sort((x, y) => cols[x] - cols[y]);
    const run = [...left, ...right.map((j) => j + J)]; // unwrap: θ increasing through +π
    const CR = hi ? 5 : 3;
    const cIdx: number[][] = [];
    for (let r = 0; r < run.length; r++) {
      const jj = run[r] % J === 0 && run[r] >= J ? J : run[r] % (J + 1);
      const j = run[r] >= J ? run[r] - J : run[r];
      const th = cols[j];
      const a = (Math.abs(th) * 180) / Math.PI;
      const startQ = grid[j][K];
      const endRy = Math.min(st.curtain(a), startQ.ry / hs - 0.01) * hs;
      const colIdx: number[] = [];
      const horiz: V3 = v3norm([Math.sin(th), 0, Math.cos(th)]);
      const jag = nz ? N3.n2(j * 0.9, 3.3) * 0.012 * hs : 0;
      for (let k = 0; k <= CR; k++) {
        const t = k / CR;
        const ry = lerp(startQ.ry, endRy + jag * t, t);
        // hang straight down from the widest point, flare outward, drape over the back
        let p: V3 = [startQ.p[0], c.Hd[1] + ry, startQ.p[2]];
        const flare = (st.flare ?? 0.008) * t;
        p = v3add(p, v3mul(horiz, flare));
        const backness = smooth(100, 170, a);
        const drop = Math.max(0, -ry / hs);
        if (drop > 0) p = v3add(p, [0, 0, -backness * drop * 0.15 - (1 - backness) * 0 ]);
        if (drop > 0 && a < 120 && a > 55) p = v3add(p, v3mul(horiz, drop * 0.35));
        const w: W = ry / hs > -0.02 ? hairW(ry) : wmix(wb(B.head), wmix(wb(B.neck), wb(B.chest), smooth(-0.1, -0.2, ry / hs)), smooth(-0.02, -0.12, ry / hs));
        const [u, v] = ruv(R.hair, (r / Math.max(1, run.length - 1)), 0.66 + t * 0.34);
        colIdx.push(G.v(p, horiz, u, v, w));
      }
      void jj;
      cIdx.push(colIdx);
    }
    for (let r = 0; r < cIdx.length - 1; r++) {
      const j = run[r] >= J ? run[r] - J : run[r];
      const th = cols[j];
      const out: V3 = [Math.sin(th), 0, Math.cos(th)];
      for (let k = 0; k < CR; k++) {
        const a = cIdx[r][k], b = cIdx[r][k + 1], cc = cIdx[r + 1][k], d = cIdx[r + 1][k + 1];
        G.triOut(a, b, cc, out); G.triOut(cc, b, d, out);
        // inner side (visible from below / behind)
        G.triOut(a, cc, b, v3mul(out, -1)); G.triOut(cc, d, b, v3mul(out, -1));
      }
    }
  }
  if (st.extra === 'ponytail' && (!hat || hat.kind === 'cap' || hat.kind === 'cap_back')) buildPonytail(c);
  if (st.extra === 'bun' && !hat) buildBun(c);
}

function buildPonytail(c: HCtx) {
  const { G, hs, Hd, hi } = c;
  const path: V3[] = [[0, 0.152, -0.108], [0, 0.125, -0.135], [0, 0.07, -0.148], [0, 0.0, -0.142], [0, -0.07, -0.13], [0, -0.12, -0.12]].map((p) => [Hd[0] + p[0], Hd[1] + p[1] * hs, Hd[2] + p[2] * hs]);
  const rad = [0.02, 0.026, 0.028, 0.024, 0.018, 0.008];
  const n = hi ? 7 : 5;
  const rings: Ring[] = path.map((p, i) => {
    const a = v3norm(v3sub(path[Math.min(path.length - 1, i + 1)], path[Math.max(0, i - 1)]));
    const fr = frame(a, [0, 0, -1]);
    const ry = (p[1] - Hd[1]) / hs;
    const w: W = ry > 0.05 ? wb(B.head) : wmix(wb(B.head), wb(B.neck), smooth(0.05, -0.1, ry));
    return { c: p, f: fr.f, s: fr.s, r: new Array(n).fill(rad[i] * hs), t: 0.7 + (i / (path.length - 1)) * 0.3, w };
  });
  loft(G, rings, { n, uv: (u, v) => ruv(R.hair, u, v), capStart: { depth: 0.005 }, capEnd: { depth: 0.01 } });
}

function buildBun(c: HCtx) {
  const { G, hs, Hd, hi } = c;
  const ctr: V3 = [Hd[0], Hd[1] + 0.155 * hs, Hd[2] - 0.112 * hs];
  const n = hi ? 8 : 6;
  const ys = [-1, -0.75, -0.3, 0.25, 0.7, 1];
  const rings: Ring[] = ys.map((k) => ({
    c: [ctr[0], ctr[1] + k * 0.03 * hs, ctr[2] - k * 0.012 * hs], f: [0, 0, -1], s: [-1, 0, 0],
    r: new Array(n).fill(Math.sqrt(Math.max(0.02, 1 - k * k)) * 0.042 * hs), t: 0.7 + (k + 1) * 0.15, w: wb(B.head),
  }));
  loft(G, rings, { n, uv: (u, v) => ruv(R.hair, u, v), capStart: { depth: 0.004 }, capEnd: { depth: 0.004 } });
}

// ------------------------------------------------------------------ accessories

// accessory palette swatches (see atlas.ts makePalette): uv centres
export const SW = { metal: 0, brushed: 1, gloss: 2, matte: 3, lens: 4, lcd: 5, rubber: 6, gold: 7 } as const;
export function swatchUV(i: number): [number, number] { return [((i % 4) + 0.5) / 4, (Math.floor(i / 4) + 0.5) / 4]; }
const hexRGB = (h: string): V3 => { const n = parseInt(h.replace('#', ''), 16); const f = (x: number) => Math.pow(x / 255, 2.2); return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)]; };

function buildAcc(c: HCtx, a: AccSpec, hairId: string, hat: AccSpec | null) {
  switch (a.kind) {
    case 'cap': case 'cap_back': case 'bucket': case 'helmet': case 'police_cap': buildHat(c, a, hairId); break;
    case 'straw': buildStraw(c); break;
    case 'headband': if (!hat || hat.kind === 'straw') buildBand(c, hairId); break;
    case 'mask': buildMask(c); break;
    case 'sunglasses': case 'glasses': buildGlasses(c, a); break;
    case 'chain': buildChain(c, a); break;
    case 'watch': buildWatch(c, a); break;
    case 'earrings': buildEarrings(c, a, hairId); break;
    default: break;
  }
}

function buildHat(c: HCtx, a: AccSpec, hairId: string) {
  const { G, hs, Hd, hi } = c;
  const J = hi ? 16 : 10, K = hi ? 4 : 3;
  const back = a.kind === 'cap_back';
  const helmet = a.kind === 'helmet', bucket = a.kind === 'bucket', police = a.kind === 'police_cap';
  const lift = hairId === 'afro' ? 0.08 : 0; // perched on top of the afro
  const sc = helmet ? 1.18 : 1.04;
  const bandRy = (thDeg: number) => {
    const t = back ? 180 - thDeg : thDeg;
    if (helmet) return t < 50 ? 0.165 : t < 100 ? lerp(0.165, 0.085, (t - 50) / 50) : lerp(0.085, 0.07, (t - 100) / 80);
    if (bucket) return lerp(0.15, 0.115, smooth(0, 180, thDeg));
    if (police) return lerp(0.158, 0.135, smooth(0, 180, thDeg));
    return lerp(0.162, 0.118, smooth(0, 180, t));
  };
  const grid: number[][] = [];
  const pos: V3[][] = [];
  const crownY = (HEAD_TOP + (police ? 0.035 : bucket ? 0.022 : helmet ? 0.03 : 0.014) + lift) * hs;
  for (let j = 0; j <= J; j++) {
    const th = -Math.PI + (2 * Math.PI * j) / J;
    const ad = (Math.abs(th) * 180) / Math.PI;
    const br = bandRy(ad) * hs + lift * hs;
    const col: number[] = [], pc: V3[] = [];
    for (let k = 0; k <= K; k++) {
      const t = k / K; // 0 crown → 1 band
      const ry = lerp(crownY, br, Math.pow(t, police ? 0.35 : 0.7));
      const hry = Math.min(ry - lift * hs, HEAD_TOP * hs - 0.004);
      const hp = headPt(c, th, Math.max(0.02 * hs, hry));
      const ht = Math.max(0.006, hairThickAt(hairId, ad, hry / hs) * (hairId === 'afro' ? 1 : 0.35));
      let r = Math.hypot(hp.p[0] - Hd[0], hp.p[2] - (Hd[2] + headAt(th, hry / hs, hs).cz));
      r = (r + ht + 0.006) * sc;
      if (police) r = Math.max(r, (headAt(th, 0.16, hs).r + 0.012) * (1 + (1 - t) * 0.12));
      if (k === 0) r *= police ? 1 : 0.0;
      const cz = Hd[2] + headAt(th, hry / hs, hs).cz;
      const p: V3 = [Hd[0] + Math.sin(th) * r, Hd[1] + ry, cz + Math.cos(th) * r];
      const [u, v] = ruv(R.hat, (j / J) * 0.66, t);
      col.push(G.v(p, v3norm([Math.sin(th), 1 - t, Math.cos(th)]), u, v, wb(B.head)));
      pc.push(p);
    }
    grid.push(col); pos.push(pc);
  }
  const ctr: V3 = [Hd[0], Hd[1] + crownY, Hd[2]];
  for (let j = 0; j < J; j++) for (let k = 0; k < K; k++) {
    const th = -Math.PI + (2 * Math.PI * (j + 0.5)) / J;
    const out: V3 = v3norm([Math.sin(th), 0.6 * (1 - k / K), Math.cos(th)]);
    G.triOut(grid[j][k], grid[j][k + 1], grid[j + 1][k], out); G.triOut(grid[j + 1][k], grid[j][k + 1], grid[j + 1][k + 1], out);
  }
  if (police) { const [u, v] = ruv(R.hat, 0.33, 0); const ci = G.v(ctr, [0, 1, 0], u, v, wb(B.head)); for (let j = 0; j < J; j++) G.triOut(grid[j][0], grid[j + 1][0], ci, [0, 1, 0]); }
  // brim
  const brim = (from: number, to: number, len: (t: number) => number, drop: number) => {
    const M = hi ? 8 : 5;
    const inner: number[] = [], outer: number[] = [], innerB: number[] = [], outerB: number[] = [];
    for (let m = 0; m <= M; m++) {
      const th = lerp(from, to, m / M);
      const j = Math.round(((th + Math.PI) / (Math.PI * 2)) * J);
      const pin = pos[((j % J) + J) % J][K];
      const dir: V3 = [Math.sin(th), 0, Math.cos(th)];
      const L = len(m / M);
      const pout: V3 = [pin[0] + dir[0] * L, pin[1] - drop * (L / 0.07), pin[2] + dir[2] * L];
      const [u1, v1] = ruv(R.hat, 0.7 + (m / M) * 0.28, 0.1);
      const [u2, v2] = ruv(R.hat, 0.7 + (m / M) * 0.28, 0.9);
      inner.push(G.v(pin, [0, 1, 0], u1, v1, wb(B.head))); outer.push(G.v(pout, [0, 1, 0], u2, v2, wb(B.head)));
      innerB.push(G.v(pin, [0, -1, 0], u1, v1, wb(B.head))); outerB.push(G.v(pout, [0, -1, 0], u2, v2, wb(B.head)));
    }
    for (let m = 0; m < M; m++) {
      G.triOut(inner[m], outer[m], inner[m + 1], [0, 1, 0]); G.triOut(inner[m + 1], outer[m], outer[m + 1], [0, 1, 0]);
      G.triOut(innerB[m], innerB[m + 1], outerB[m], [0, -1, 0]); G.triOut(innerB[m + 1], outerB[m + 1], outerB[m], [0, -1, 0]);
    }
  };
  if (a.kind === 'cap' || a.kind === 'cap_back' || police) {
    const base = back ? Math.PI : 0;
    const half = police ? 1.05 : 1.2;
    const L0 = police ? 0.055 : 0.078;
    const from = base - half, to = base + half;
    brim(from, to, (t) => L0 * Math.pow(Math.sin(t * Math.PI), 0.55) + 0.004, police ? 0.022 : 0.012);
  } else if (bucket) {
    brim(-Math.PI, Math.PI, () => 0.055, 0.03);
  } else if (helmet) {
    brim(-0.9, 0.9, (t) => 0.03 * Math.sin(t * Math.PI) + 0.004, 0.006);
  }
}

function buildStraw(c: HCtx) {
  const { G, hs, Hd, hi } = c;
  const J = hi ? 16 : 10;
  const apex: V3 = [Hd[0], Hd[1] + 0.3 * hs, Hd[2] - 0.01];
  const rows = [[0, 0.3], [0.06, 0.27], [0.13, 0.215], [0.2, 0.165], [0.235, 0.138]];
  const top: number[][] = [], bot: number[][] = [];
  for (let k = 0; k < rows.length; k++) {
    const [r, y] = rows[k];
    const rt: number[] = [], rb: number[] = [];
    for (let j = 0; j <= J; j++) {
      const th = -Math.PI + (2 * Math.PI * j) / J;
      const p: V3 = [Hd[0] + Math.sin(th) * r * hs, Hd[1] + y * hs, Hd[2] - 0.01 + Math.cos(th) * r * hs];
      const [u, v] = ruv(R.hat, j / J, k / (rows.length - 1));
      rt.push(G.v(k === 0 ? apex : p, [Math.sin(th) * 0.5, 1, Math.cos(th) * 0.5], u, v, wb(B.head)));
      rb.push(G.v(k === 0 ? apex : [p[0], p[1] - 0.004, p[2]], [0, -1, 0], u, v, wb(B.head)));
    }
    top.push(rt); bot.push(rb);
  }
  for (let k = 0; k < rows.length - 1; k++) for (let j = 0; j < J; j++) {
    const th = -Math.PI + (2 * Math.PI * (j + 0.5)) / J;
    const up: V3 = [Math.sin(th) * 0.4, 1, Math.cos(th) * 0.4];
    G.triOut(top[k][j], top[k + 1][j], top[k][j + 1], up); G.triOut(top[k][j + 1], top[k + 1][j], top[k + 1][j + 1], up);
    G.triOut(bot[k][j], bot[k][j + 1], bot[k + 1][j], [0, -1, 0]); G.triOut(bot[k][j + 1], bot[k + 1][j + 1], bot[k + 1][j], [0, -1, 0]);
  }
}

function buildBand(c: HCtx, hairId: string) {
  const { G, hs, hi } = c;
  const J = hi ? 18 : 10;
  const under = hairStyle(hairId).bandUnder;
  const rows = [0, 1];
  const idx: number[][] = [];
  for (let j = 0; j <= J; j++) {
    const th = -Math.PI + (2 * Math.PI * j) / J;
    const ad = (Math.abs(th) * 180) / Math.PI;
    const lo = lerp(0.158, 0.125, smooth(0, 180, ad));
    const col: number[] = [];
    for (const r of rows) {
      const ry = (lo + r * 0.026) * hs;
      const hp = headPt(c, th, ry);
      const ht = under ? 0 : hairThickAt(hairId, ad, ry / hs);
      const p = v3add(hp.p, v3mul(hp.n, ht + 0.005));
      const [u, v] = ruv(R.band, j / J, r);
      col.push(G.v(p, hp.n, u, v, wb(B.head)));
    }
    idx.push(col);
  }
  for (let j = 0; j < J; j++) {
    const th = -Math.PI + (2 * Math.PI * (j + 0.5)) / J;
    const out: V3 = [Math.sin(th), 0, Math.cos(th)];
    G.triOut(idx[j][0], idx[j][1], idx[j + 1][0], out); G.triOut(idx[j + 1][0], idx[j][1], idx[j + 1][1], out);
  }
}

function buildMask(c: HCtx) {
  const { G, hs, Hd, hi } = c;
  const J = hi ? 10 : 6, K = hi ? 5 : 3;
  const idx: number[][] = [];
  for (let j = 0; j <= J; j++) {
    const th = lerp(-1.4, 1.4, j / J);
    const col: number[] = [];
    for (let k = 0; k <= K; k++) {
      const ry = lerp(0.1, -0.004, k / K) * hs;
      const hp = headPt(c, th, ry);
      const nose = Math.exp(-((th / 0.33) ** 2)) * smooth(0.04, 0.075, ry / hs) * 0.024 * hs;
      const chin = Math.exp(-((th / 0.6) ** 2)) * smooth(0.03, 0.0, ry / hs) * 0.008;
      const p = v3add(hp.p, v3mul(hp.n, 0.006 + nose + chin));
      const [u, v] = ruv(R.mask, j / J, k / K);
      col.push(G.v(p, hp.n, u, v, headWeights(ry)));
    }
    idx.push(col);
  }
  void Hd;
  for (let j = 0; j < J; j++) for (let k = 0; k < K; k++) {
    const th = lerp(-1.4, 1.4, (j + 0.5) / J);
    const out: V3 = [Math.sin(th), 0, Math.cos(th)];
    G.triOut(idx[j][k], idx[j][k + 1], idx[j + 1][k], out); G.triOut(idx[j + 1][k], idx[j][k + 1], idx[j + 1][k + 1], out);
  }
}

/** flat-ish shape fan in the group-1 (palette) material */
function fan(G: Geo, ctr: V3, pts: V3[], nrm: V3, sw: number, w: W) {
  const [u, v] = swatchUV(sw);
  const ci = G.v(ctr, nrm, u, v, w);
  const ids = pts.map((p) => G.v(p, nrm, u, v, w));
  for (let i = 0; i < ids.length; i++) G.triOut(ci, ids[i], ids[(i + 1) % ids.length], nrm, 1);
}

function box(G: Geo, c0: V3, ax: V3, ay: V3, az: V3, sw: number, w: W) {
  // oriented box: centre c0, half-axes ax, ay, az
  const [u, v] = swatchUV(sw);
  const faces: [V3, V3, V3][] = [[ax, ay, az], [v3mul(ax, -1), ay, v3mul(az, -1)], [ay, az, ax], [v3mul(ay, -1), az, v3mul(ax, -1)], [az, ax, ay], [v3mul(az, -1), ax, v3mul(ay, -1)]];
  for (const [n, a, b] of faces) {
    const fc = v3add(c0, n);
    const q = [v3add(v3add(fc, a), b), v3add(v3sub(fc, a), b), v3sub(v3sub(fc, a), b), v3sub(v3add(fc, a), b)].map((p) => G.v(p, n, u, v, w));
    G.triOut(q[0], q[1], q[2], n, 1); G.triOut(q[0], q[2], q[3], n, 1);
  }
}

function buildGlasses(c: HCtx, a: AccSpec) {
  const { G, hs, Hd } = c;
  const sun = a.kind === 'sunglasses';
  const w: W = wb(B.head);
  const frameCol = hexRGB(sun ? (a.color === '#b0642a' ? '#c9a24a' : '#1d1d1f') : a.color);
  const lensCol = hexRGB(sun ? a.color : '#d8e4ea');
  for (const side of [1, -1]) {
    const ex = side * EYE_X * hs, ey = EYE_Y * hs;
    const fz = headAt(Math.asin(Math.min(0.9, (EYE_X * hs) / 0.09)), ey / hs, hs);
    const zf = Hd[2] + fz.cz + Math.cos(Math.asin(Math.min(0.9, (EYE_X * hs) / 0.09))) * fz.r + 0.016 * hs;
    const ctr: V3 = [Hd[0] + ex, Hd[1] + ey - (sun ? 0.003 : 0), zf];
    const pts: V3[] = [];
    const M = 12;
    const hw = (sun ? 0.027 : 0.023) * hs, hh = (sun ? 0.02 : 0.015) * hs;
    for (let i = 0; i < M; i++) {
      const t = (i / M) * Math.PI * 2;
      const cx = Math.cos(t), cy = Math.sin(t);
      // aviator: wider at the top-outer corner
      const sx = hw * (1 + (sun ? 0.08 * cy * cx * side : 0)), sy = hh * (cy > 0 ? 1 : sun ? 1.18 : 1);
      const x = cx * sx, y = cy * sy;
      pts.push([ctr[0] + x, ctr[1] + y, ctr[2] - (x * side) * 0.18 - (x * x) * 2]);
    }
    G.color = lensCol;
    fan(G, ctr, pts, [side * 0.1, 0, 1], SW.lens, w);
    // rim (slightly bigger fan behind the lens)
    G.color = frameCol;
    const rim = pts.map((p) => [ctr[0] + (p[0] - ctr[0]) * 1.12, ctr[1] + (p[1] - ctr[1]) * 1.14, p[2] - 0.0015] as V3);
    fan(G, [ctr[0], ctr[1], ctr[2] - 0.0015], rim, [side * 0.1, 0, 1], sun ? SW.gold : SW.gloss, w);
    // temple arm to the ear
    const earTh = side * (Math.PI / 2 + 0.05);
    const eh = headAt(earTh, 0.112, hs);
    const earP: V3 = [Hd[0] + Math.sin(earTh) * (eh.r + 0.004), Hd[1] + 0.112 * hs, Hd[2] + eh.cz + Math.cos(earTh) * eh.r - 0.02];
    const st: V3 = [ctr[0] + side * hw * 1.1, ctr[1] + hh * 0.4, ctr[2] - 0.004];
    const mid = v3mul(v3add(st, earP), 0.5);
    const along = v3mul(v3sub(earP, st), 0.5);
    box(G, mid, along, [0, 0.0018, 0], v3mul(v3norm([side, 0, 0.15]), 0.0012), sun ? SW.gold : SW.gloss, w);
  }
  // bridge
  G.color = frameCol;
  const by = Hd[1] + (EYE_Y + 0.006) * hs;
  const bz = Hd[2] + headAt(0, EYE_Y + 0.006, hs).cz + headAt(0, EYE_Y + 0.006, hs).r + 0.019 * hs;
  box(G, [Hd[0], by, bz], [0.009 * hs, 0, 0], [0, 0.0016, 0], [0, 0, 0.0016], sun ? SW.gold : SW.gloss, w);
  G.color = [1, 1, 1];
  void faceU; void faceV;
}

function buildChain(c: HCtx, a: AccSpec) {
  const { G, sk, s, hi } = c;
  const k = (s.sex === 'f' ? 0.86 : 1) * (0.92 + s.build * 0.18);
  const M = hi ? 20 : 12, n = hi ? 5 : 4;
  const col = hexRGB(a.color);
  G.color = col;
  const path: V3[] = [];
  for (let i = 0; i < M; i++) {
    const t = (i / M) * Math.PI * 2; // 0 = front
    const front = Math.max(0, Math.cos(t));
    const y = 1.445 - front * front * 0.085 - (s.build - 0.4) * 0.01 * front;
    const rx = (0.074 + front * 0.02) * k, rz = (0.07 + front * 0.03 + s.build * 0.02 * front) * k;
    path.push([Math.sin(t) * rx, y, -0.014 + Math.cos(t) * rz]);
  }
  const rings: Ring[] = [];
  for (let i = 0; i <= M; i++) {
    const p = path[i % M];
    const a2 = v3norm(v3sub(path[(i + 1) % M], path[(i - 1 + M) % M]));
    const fr = frame(a2, [0, 1, 0]);
    const t = (i / M) * Math.PI * 2;
    rings.push({ c: p, f: fr.f, s: fr.s, r: new Array(n).fill(0.0052), t: 0, w: Math.cos(t) > 0.3 ? wb(B.chest) : [B.chest, 0.75, B.neck, 0.25] });
  }
  const [u, v] = swatchUV(SW.gold);
  loft(G, rings, { n, uv: () => [u, v], group: 1 });
  G.color = [1, 1, 1];
  void sk;
}

function buildWatch(c: HCtx, a: AccSpec) {
  const { G, sk, s } = c;
  const E = sk.J[B.forearm_l], Wr = sk.J[B.hand_l];
  const d = v3norm(v3sub(Wr, E));
  const fr = frame(d, [1, 0, 0], [0, 0, 1]);
  const k = (s.sex === 'f' ? 0.86 : 1) * (0.84 + s.build * 0.34);
  const pos = v3add(E, v3mul(d, sk.foreLen - 0.035));
  const rWrist = 0.024 * k;
  const w: W = [B.forearm_l, 0.8, B.hand_l, 0.2];
  // strap ring
  G.color = hexRGB(a.color === '#2a2a2c' ? '#1d1d1f' : a.color);
  const n = 8;
  const rings: Ring[] = [-0.008, 0.008].map((o) => ({ c: v3add(pos, v3mul(d, o)), f: fr.f, s: fr.s, r: new Array(n).fill(rWrist + 0.004), t: 0, w }));
  const [u, v] = swatchUV(SW.rubber);
  loft(G, rings, { n, uv: () => [u, v], group: 1 });
  // case on the back of the wrist
  G.color = hexRGB(a.color);
  const cc = v3add(pos, v3mul(fr.f, rWrist + 0.007));
  box(G, cc, v3mul(d, 0.017), v3mul(fr.s, 0.015), v3mul(fr.f, 0.005), a.color === '#2a2a2c' ? SW.gloss : SW.metal, w);
  G.color = [1, 1, 1];
  fan(G, v3add(cc, v3mul(fr.f, 0.0052)), [v3add(v3add(cc, v3mul(fr.f, 0.0052)), v3add(v3mul(d, 0.011), v3mul(fr.s, 0.01))), v3add(v3add(cc, v3mul(fr.f, 0.0052)), v3add(v3mul(d, -0.011), v3mul(fr.s, 0.01))), v3add(v3add(cc, v3mul(fr.f, 0.0052)), v3add(v3mul(d, -0.011), v3mul(fr.s, -0.01))), v3add(v3add(cc, v3mul(fr.f, 0.0052)), v3add(v3mul(d, 0.011), v3mul(fr.s, -0.01)))], fr.f, SW.lcd, w);
}

function buildEarrings(c: HCtx, a: AccSpec, hairId: string) {
  const { G, hs, Hd } = c;
  if (['long', 'afro', 'bob'].includes(hairId)) return;
  G.color = hexRGB(a.color);
  for (const side of [1, -1]) {
    const th = side * (Math.PI / 2 + 0.1);
    const h = headAt(th, 0.068, hs);
    const p: V3 = [Hd[0] + Math.sin(th) * (h.r + 0.008), Hd[1] + 0.06 * hs, Hd[2] + h.cz + Math.cos(th) * h.r - 0.004];
    box(G, p, [0.0035, 0, 0], [0, 0.0045, 0], [0, 0, 0.0035], SW.gold, wb(B.head));
  }
  G.color = [1, 1, 1];
}

export { clamp01 };
