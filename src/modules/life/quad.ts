import * as THREE from 'three';

/* ============================================================================================
 * Procedural low-poly SKINNED quadruped (Thai street dog / street cat) + procedural animator.
 *
 * Model frame: +Z forward, +Y up, +X = the animal's LEFT. `inner` is rotated π so the animal
 * faces -Z in the world (same yaw convention as every rig). One SkinnedMesh (fur photo texture ×
 * vertex-colour markings), plus small attached meshes (eyes, nose, tongue, collar).
 * Gaits: walk (lateral sequence) · trot (diagonal pairs) · gallop (rotary). Poses: stand, sit,
 * lie, sleep, beg. Layers: wag, eat (chew), bark (jerk + jaw), scratch, sniff, pant, look-at.
 * ========================================================================================== */

type V3 = [number, number, number];
type W = number[]; // [bone, weight, bone, weight…]

export const QB = {
  hips: 0, spine: 1, chest: 2, neck: 3, head: 4, jaw: 5, ear_l: 6, ear_r: 7,
  tail1: 8, tail2: 9, tail3: 10,
  sh_l: 11, el_l: 12, wr_l: 13, sh_r: 14, el_r: 15, wr_r: 16,
  hip_l: 17, kn_l: 18, ho_l: 19, hip_r: 20, kn_r: 21, ho_r: 22,
} as const;
const NB = 23;
const PARENT = [-1, 0, 1, 2, 3, 4, 4, 4, 0, 8, 9, 2, 11, 12, 2, 14, 15, 0, 17, 18, 0, 20, 21];

export type Species = 'dog' | 'cat';

interface Section { z: number; y: number; rx: number; ry: number; x?: number }
interface Dims {
  J: V3[];                 // joint rest positions (model space)
  body: Section[];         // rump → chest front
  neck: [V3, number][];    // centre, radius
  skull: Section[];        // back of skull → muzzle start (full rings)
  muzzle: Section[];       // muzzle (split upper/lower for the jaw)
  ear: { base: V3; tip: V3; w: number; d: number };
  tail: [V3, number][];
  fore: { r: number[] };   // radii: shoulder, upper mid, elbow, fore mid, wrist, pastern
  hind: { r: number[] };   // radii: hip, thigh mid, knee, shin mid, hock, meta
  paw: [number, number, number];
  eye: { p: V3; r: number };
  nose: { p: V3; s: V3 };
  furTile: number;         // metres per fur texture tile
}

const DOG: Dims = {
  J: [
    [0, 0.5, -0.2], [0, 0.505, -0.02], [0, 0.5, 0.14], [0, 0.545, 0.245], [0, 0.69, 0.335], [0, 0.668, 0.398],
    [0.04, 0.752, 0.33], [-0.04, 0.752, 0.33],
    [0, 0.53, -0.305], [0, 0.6, -0.36], [0, 0.672, -0.362],
    [0.072, 0.44, 0.185], [0.078, 0.27, 0.152], [0.078, 0.085, 0.17],
    [-0.072, 0.44, 0.185], [-0.078, 0.27, 0.152], [-0.078, 0.085, 0.17],
    [0.068, 0.46, -0.215], [0.074, 0.3, -0.128], [0.074, 0.125, -0.255],
    [-0.068, 0.46, -0.215], [-0.074, 0.3, -0.128], [-0.074, 0.125, -0.255],
  ],
  body: [
    { z: -0.345, y: 0.505, rx: 0.03, ry: 0.03 },
    { z: -0.325, y: 0.5, rx: 0.07, ry: 0.075 },
    { z: -0.28, y: 0.49, rx: 0.088, ry: 0.098 },
    { z: -0.2, y: 0.485, rx: 0.094, ry: 0.104 },
    { z: -0.11, y: 0.492, rx: 0.086, ry: 0.088 },
    { z: -0.03, y: 0.488, rx: 0.088, ry: 0.098 },
    { z: 0.05, y: 0.474, rx: 0.098, ry: 0.122 },
    { z: 0.13, y: 0.468, rx: 0.104, ry: 0.138 },
    { z: 0.2, y: 0.478, rx: 0.098, ry: 0.13 },
    { z: 0.255, y: 0.51, rx: 0.076, ry: 0.098 },
    { z: 0.285, y: 0.535, rx: 0.04, ry: 0.05 },
  ],
  neck: [[[0, 0.515, 0.2], 0.072], [[0, 0.575, 0.262], 0.062], [[0, 0.635, 0.305], 0.056], [[0, 0.682, 0.33], 0.053]],
  skull: [
    { z: 0.296, y: 0.706, rx: 0.034, ry: 0.034 },
    { z: 0.315, y: 0.71, rx: 0.058, ry: 0.058 },
    { z: 0.35, y: 0.714, rx: 0.068, ry: 0.064 },
    { z: 0.385, y: 0.706, rx: 0.06, ry: 0.056 },
  ],
  muzzle: [
    { z: 0.398, y: 0.694, rx: 0.05, ry: 0.048 },
    { z: 0.43, y: 0.682, rx: 0.038, ry: 0.038 },
    { z: 0.465, y: 0.673, rx: 0.03, ry: 0.031 },
    { z: 0.497, y: 0.669, rx: 0.025, ry: 0.025 },
    { z: 0.51, y: 0.669, rx: 0.014, ry: 0.014 },
  ],
  ear: { base: [0.04, 0.745, 0.33], tip: [0.058, 0.83, 0.32], w: 0.036, d: 0.016 },
  tail: [[[0, 0.53, -0.3], 0.03], [[0, 0.565, -0.335], 0.027], [[0, 0.61, -0.36], 0.024], [[0, 0.655, -0.366], 0.02], [[0, 0.695, -0.355], 0.016], [[0, 0.722, -0.33], 0.012], [[0, 0.735, -0.305], 0.006]],
  fore: { r: [0.052, 0.04, 0.03, 0.024, 0.021, 0.021] },
  hind: { r: [0.068, 0.052, 0.034, 0.026, 0.022, 0.019] },
  paw: [0.026, 0.02, 0.036],
  eye: { p: [0.034, 0.716, 0.398], r: 0.0115 },
  nose: { p: [0, 0.676, 0.51], s: [0.017, 0.013, 0.012] },
  furTile: 0.16,
};

const CAT: Dims = {
  J: [
    [0, 0.255, -0.125], [0, 0.262, -0.02], [0, 0.255, 0.075], [0, 0.275, 0.135], [0, 0.345, 0.185], [0, 0.33, 0.215],
    [0.028, 0.39, 0.182], [-0.028, 0.39, 0.182],
    [0, 0.27, -0.2], [0, 0.31, -0.255], [0, 0.38, -0.29],
    [0.04, 0.225, 0.1], [0.043, 0.138, 0.082], [0.043, 0.043, 0.092],
    [-0.04, 0.225, 0.1], [-0.043, 0.138, 0.082], [-0.043, 0.043, 0.092],
    [0.04, 0.24, -0.135], [0.044, 0.158, -0.085], [0.044, 0.07, -0.158],
    [-0.04, 0.24, -0.135], [-0.044, 0.158, -0.085], [-0.044, 0.07, -0.158],
  ],
  body: [
    { z: -0.215, y: 0.262, rx: 0.02, ry: 0.02 },
    { z: -0.2, y: 0.258, rx: 0.046, ry: 0.05 },
    { z: -0.165, y: 0.252, rx: 0.058, ry: 0.064 },
    { z: -0.1, y: 0.25, rx: 0.062, ry: 0.068 },
    { z: -0.03, y: 0.252, rx: 0.058, ry: 0.064 },
    { z: 0.03, y: 0.248, rx: 0.058, ry: 0.07 },
    { z: 0.08, y: 0.246, rx: 0.058, ry: 0.072 },
    { z: 0.12, y: 0.256, rx: 0.05, ry: 0.062 },
    { z: 0.148, y: 0.272, rx: 0.026, ry: 0.034 },
  ],
  neck: [[[0, 0.262, 0.115], 0.042], [[0, 0.292, 0.15], 0.04], [[0, 0.325, 0.175], 0.038], [[0, 0.343, 0.186], 0.036]],
  skull: [
    { z: 0.16, y: 0.352, rx: 0.026, ry: 0.026 },
    { z: 0.172, y: 0.355, rx: 0.044, ry: 0.044 },
    { z: 0.195, y: 0.355, rx: 0.05, ry: 0.046 },
    { z: 0.215, y: 0.348, rx: 0.044, ry: 0.04 },
  ],
  muzzle: [
    { z: 0.222, y: 0.342, rx: 0.034, ry: 0.032 },
    { z: 0.236, y: 0.337, rx: 0.026, ry: 0.024 },
    { z: 0.246, y: 0.335, rx: 0.018, ry: 0.017 },
    { z: 0.252, y: 0.335, rx: 0.008, ry: 0.008 },
  ],
  ear: { base: [0.028, 0.382, 0.18], tip: [0.042, 0.43, 0.178], w: 0.032, d: 0.013 },
  tail: [[[0, 0.27, -0.195], 0.016], [[0, 0.29, -0.235], 0.015], [[0, 0.33, -0.26], 0.014], [[0, 0.38, -0.278], 0.013], [[0, 0.43, -0.288], 0.012], [[0, 0.475, -0.282], 0.011], [[0, 0.505, -0.262], 0.009], [[0, 0.515, -0.24], 0.005]],
  fore: { r: [0.03, 0.024, 0.018, 0.015, 0.013, 0.013] },
  hind: { r: [0.042, 0.032, 0.02, 0.016, 0.013, 0.012] },
  paw: [0.017, 0.012, 0.022],
  eye: { p: [0.024, 0.358, 0.226], r: 0.0105 },
  nose: { p: [0, 0.342, 0.25], s: [0.008, 0.006, 0.005] },
  furTile: 0.11,
};

export interface QuadColors {
  base: string; light: string; dark: string; nose: string; eye: string; inner: string;
  socks?: string | null; mask?: string | null; tailTip?: string | null; stripes?: boolean;
}

export interface QuadSpec {
  species: Species;
  scale?: number;
  fur?: THREE.Texture | null;
  furNormal?: THREE.Texture | null;
  colors: QuadColors;
  /** 0..1 build (lean ↔ chunky) */
  build?: number;
}

// ------------------------------------------------------------------ geometry accumulator

class SkinGeo {
  P: number[] = []; UV: number[] = []; C: number[] = []; SI: number[] = []; SW: number[] = []; I: number[] = [];
  get n() { return this.P.length / 3; }
  v(p: V3, u: number, v: number, w: W, c: THREE.Color) {
    this.P.push(p[0], p[1], p[2]);
    this.UV.push(u, v);
    this.C.push(c.r, c.g, c.b);
    const acc = new Map<number, number>();
    for (let i = 0; i < w.length; i += 2) if (w[i + 1] > 1e-4) acc.set(w[i], (acc.get(w[i]) ?? 0) + w[i + 1]);
    const arr = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    let s = 0;
    for (const e of arr) s += e[1];
    for (let i = 0; i < 4; i++) { this.SI.push(arr[i] ? arr[i][0] : 0); this.SW.push(arr[i] ? arr[i][1] / (s || 1) : 0); }
    return this.n - 1;
  }
  tri(a: number, b: number, c: number) { this.I.push(a, b, c); }
  quad(a: number, b: number, c: number, d: number) { this.I.push(a, b, c, a, c, d); }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.UV, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.SI, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.SW, 4));
    g.setIndex(this.I);
    g.computeVertexNormals();
    return g;
  }
}

const wmix = (a: W, b: W, t: number): W => {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const o: W = [];
  for (let i = 0; i < a.length; i += 2) o.push(a[i], a[i + 1] * (1 - t));
  for (let i = 0; i < b.length; i += 2) o.push(b[i], b[i + 1] * t);
  return o;
};
const wb = (b: number): W => [b, 1];
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const sstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Simple value noise for fur-colour variation (deterministic). */
function vnoise(x: number, y: number, z: number) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

interface RingOpts {
  /** ring centre */ c: V3;
  /** local frame: side (x-ish) and up (y-ish) unit vectors */ side: V3; up: V3;
  rx: number; ry: number;
  /** angle range (default full) */ a0?: number; a1?: number;
  w: W;
  v: number;
  seg: number;
  color: (dirSide: number, dirUp: number, p: V3) => THREE.Color;
  /** squash the bottom (flatter belly) */ flatBottom?: number;
}

function ring(G: SkinGeo, o: RingOpts): number[] {
  const out: number[] = [];
  const a0 = o.a0 ?? 0, a1 = o.a1 ?? Math.PI * 2;
  const full = o.a0 === undefined;
  const n = o.seg;
  const circ = Math.PI * (o.rx + o.ry);
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n);
    const cs = Math.cos(a), sn = Math.sin(a);
    // a=0 → top (up), a=π/2 → side(+x)
    let du = cs, ds = sn;
    if (o.flatBottom && du < 0) du *= 1 - o.flatBottom * 0.35;
    const p: V3 = [
      o.c[0] + o.side[0] * ds * o.rx + o.up[0] * du * o.ry,
      o.c[1] + o.side[1] * ds * o.rx + o.up[1] * du * o.ry,
      o.c[2] + o.side[2] * ds * o.rx + o.up[2] * du * o.ry,
    ];
    const u = full ? (i / n) * circ : ((a - a0) / (Math.PI * 2)) * circ;
    out.push(G.v(p, u, o.v, o.w, o.color(sn, cs, p)));
  }
  return out;
}
function bridge(G: SkinGeo, a: number[], b: number[]) {
  for (let i = 0; i < a.length - 1; i++) G.quad(a[i], a[i + 1], b[i + 1], b[i]);
}
function capFan(G: SkinGeo, r: number[], centre: V3, w: W, c: THREE.Color, v: number, flip: boolean) {
  const ci = G.v(centre, 0.5, v, w, c);
  for (let i = 0; i < r.length - 1; i++) flip ? G.tri(ci, r[i + 1], r[i]) : G.tri(ci, r[i], r[i + 1]);
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** frame for a tube segment with tangent t and a preferred up */
function frame(t: V3, prefUp: V3): { side: V3; up: V3 } {
  let side = cross(prefUp, t);
  if (Math.hypot(side[0], side[1], side[2]) < 1e-4) side = cross([0, 0, 1], t);
  side = norm(side);
  const up = norm(cross(t, side));
  return { side, up };
}

/** Generic tube along points with radii & weights. */
function tube(G: SkinGeo, pts: V3[], rad: number[], ws: W[], prefUp: V3, seg: number, color: RingOpts['color'], capStart: boolean, capEnd: boolean, flatX = 1) {
  let vAcc = 0;
  let prev: number[] | null = null;
  const rings: number[][] = [];
  for (let i = 0; i < pts.length; i++) {
    const t = norm(sub(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]));
    const f = frame(t, prefUp);
    if (i > 0) vAcc += Math.hypot(...sub(pts[i], pts[i - 1]) as [number, number, number]);
    const r = ring(G, { c: pts[i], side: f.side, up: f.up, rx: rad[i] * flatX, ry: rad[i], w: ws[i], v: vAcc, seg, color });
    if (prev) bridge(G, prev, r);
    prev = r;
    rings.push(r);
  }
  const t0 = norm(sub(pts[1], pts[0]));
  const tn = norm(sub(pts[pts.length - 1], pts[pts.length - 2]));
  if (capStart) capFan(G, rings[0], add(pts[0], mul(t0, -rad[0] * 0.6)), ws[0], color(0, -1, pts[0]), 0, true);
  if (capEnd) capFan(G, rings[rings.length - 1], add(pts[pts.length - 1], mul(tn, rad[rad.length - 1] * 0.6)), ws[ws.length - 1], color(0, -1, pts[pts.length - 1]), vAcc, false);
  return rings;
}

// ------------------------------------------------------------------ builder

export interface QuadRig {
  root: THREE.Group;
  inner: THREE.Group;
  mesh: THREE.SkinnedMesh;
  bones: THREE.Bone[];
  eyes: THREE.Mesh[];
  tongue: THREE.Mesh;
  collar: THREE.Group;
  species: Species;
  dims: Dims;
  height: number;
  dispose(): void;
}

const _c = new THREE.Color();

export function buildQuad(spec: QuadSpec): QuadRig {
  const D = spec.species === 'cat' ? CAT : DOG;
  const build = spec.build ?? 0.4;
  const col = spec.colors;
  const cBase = new THREE.Color(col.base), cLight = new THREE.Color(col.light), cDark = new THREE.Color(col.dark);
  const cInner = new THREE.Color(col.inner);
  const cSocks = col.socks ? new THREE.Color(col.socks) : null;
  const cMask = col.mask ? new THREE.Color(col.mask) : null;
  const cTip = col.tailTip ? new THREE.Color(col.tailTip) : null;
  const G = new SkinGeo();
  const tint = (c: THREE.Color, p: V3, k = 0.08) => {
    const n = vnoise(p[0] * 9, p[1] * 9, p[2] * 9) - 0.5;
    return _c.copy(c).multiplyScalar(1 + n * k).clone();
  };
  // stripes for tabby (cat): dark bands across the back
  const stripe = (p: V3, up: number) => {
    if (!col.stripes || up < -0.2) return 0;
    const s = Math.sin(p[2] * 95 + Math.sin(p[0] * 40) * 1.5);
    return sstep(0.45, 0.9, s) * clamp01(up + 0.3);
  };
  const bodyColor = (ds: number, du: number, p: V3) => {
    // du: +1 top … -1 belly
    let c = cBase.clone();
    if (du < -0.25) c.lerp(cLight, sstep(-0.25, -0.75, du));
    if (du > 0.45) c.lerp(cDark, sstep(0.45, 1.0, du) * 0.55);
    const st = stripe(p, du);
    if (st > 0) c.lerp(cDark, st * 0.75);
    return tint(c, p);
  };
  const bw = (build - 0.4) * 0.25 + 1;

  // ---- body (rump → chest) with bone weights by z
  const centres = [
    [D.J[QB.hips][2], QB.hips], [D.J[QB.spine][2], QB.spine], [D.J[QB.chest][2], QB.chest],
  ] as [number, number][];
  const bodyW = (z: number): W => {
    if (z <= centres[0][0]) return wb(QB.hips);
    if (z >= centres[2][0]) return wb(QB.chest);
    for (let i = 0; i < 2; i++) {
      const [za, ba] = centres[i], [zb, bbn] = centres[i + 1];
      if (z >= za && z <= zb) return wmix(wb(ba), wb(bbn), sstep(za, zb, z));
    }
    return wb(QB.spine);
  };
  {
    let prev: number[] | null = null, vAcc = 0, first: number[] | null = null, last: number[] | null = null;
    const S = D.body;
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      if (i > 0) vAcc += Math.hypot(s.z - S[i - 1].z, s.y - S[i - 1].y);
      const r = ring(G, { c: [s.x ?? 0, s.y, s.z], side: [1, 0, 0], up: [0, 1, 0], rx: s.rx * bw, ry: s.ry, w: bodyW(s.z), v: vAcc, seg: 14, color: bodyColor, flatBottom: 0.3 });
      if (prev) bridge(G, r, prev);
      if (!first) first = r;
      prev = r; last = r;
    }
    capFan(G, first!, [0, S[0].y, S[0].z - 0.01], wb(QB.hips), bodyColor(0, 0, [0, S[0].y, S[0].z]), 0, false);
    capFan(G, last!, [0, S[S.length - 1].y, S[S.length - 1].z + 0.008], wb(QB.chest), bodyColor(0, 0, [0, 0, 0]), vAcc, true);
  }

  // ---- neck
  {
    const pts = D.neck.map((n) => n[0]);
    const rad = D.neck.map((n) => n[1] * bw);
    const ws: W[] = pts.map((_, i) => (i === 0 ? wmix(wb(QB.chest), wb(QB.neck), 0.35) : i === pts.length - 1 ? wmix(wb(QB.neck), wb(QB.head), 0.6) : wb(QB.neck)));
    tube(G, pts, rad, ws, [0, 0, -1], 12, (ds, du, p) => {
      // neck "du" here is relative to the tube's up (toward the back of the neck)
      let c = cBase.clone();
      if (du < -0.3) c.lerp(cLight, sstep(-0.3, -0.8, du) * 0.9);
      if (du > 0.5) c.lerp(cDark, 0.3);
      return tint(c, p);
    }, false, false);
  }

  // ---- skull (full rings) + muzzle (upper → head, lower → jaw)
  const headColor = (ds: number, du: number, p: V3) => {
    let c = cBase.clone();
    if (du < -0.4) c.lerp(cLight, 0.6);
    if (cMask && p[2] > D.muzzle[0].z - 0.01) c.lerp(cMask, sstep(D.muzzle[0].z - 0.01, D.muzzle[1].z, p[2]) * 0.85);
    const st = stripe(p, du) * 0.6;
    if (st > 0) c.lerp(cDark, st);
    return tint(c, p, 0.06);
  };
  {
    let prev: number[] | null = null, vAcc = 0, first: number[] | null = null;
    for (let i = 0; i < D.skull.length; i++) {
      const s = D.skull[i];
      if (i > 0) vAcc += Math.abs(s.z - D.skull[i - 1].z);
      const r = ring(G, { c: [0, s.y, s.z], side: [1, 0, 0], up: [0, 1, 0], rx: s.rx, ry: s.ry, w: wb(QB.head), v: vAcc, seg: 14, color: headColor });
      if (prev) bridge(G, r, prev);
      if (!first) first = r;
      prev = r;
    }
    capFan(G, first!, [0, D.skull[0].y, D.skull[0].z - 0.006], wb(QB.head), headColor(0, 0, [0, 0, 0]), 0, false);
    // connect skull's last ring to muzzle halves: top half (a ∈ [-π/2, π/2]) & bottom half
    const M = D.muzzle;
    const lastSk = D.skull[D.skull.length - 1];
    let upPrev: number[] | null = null, loPrev: number[] | null = null;
    const half = 7;
    const jawPalate = new THREE.Color(col.inner);
    for (let i = -1; i < M.length; i++) {
      const s = i < 0 ? lastSk : M[i];
      const v = vAcc + (i < 0 ? 0 : Math.abs(s.z - lastSk.z));
      const lw = i < 0 ? wb(QB.head) : i === 0 ? wmix(wb(QB.head), wb(QB.jaw), 0.7) : wb(QB.jaw);
      const up = ring(G, { c: [0, s.y, s.z], side: [1, 0, 0], up: [0, 1, 0], rx: s.rx, ry: s.ry, a0: -Math.PI / 2, a1: Math.PI / 2, w: wb(QB.head), v, seg: half, color: headColor });
      const lo = ring(G, { c: [0, s.y - 0.002, s.z], side: [1, 0, 0], up: [0, 1, 0], rx: s.rx * 0.96, ry: s.ry * 0.92, a0: Math.PI / 2, a1: Math.PI * 1.5, w: lw, v, seg: half, color: headColor });
      if (upPrev) bridge(G, up, upPrev);
      if (loPrev) bridge(G, lo, loPrev);
      upPrev = up; loPrev = lo;
    }
    // palate (flat dark inner face of the upper muzzle) & tongue bed (lower)
    const z0 = M[0].z, z1 = M[M.length - 1].z;
    const pal = (zz: number, wlist: W, yoff: number, flip: boolean) => {
      const a = G.v([M[0].rx * 0.9, M[0].y + yoff, z0], 0, 0, wlist, jawPalate);
      const b = G.v([-M[0].rx * 0.9, M[0].y + yoff, z0], 0, 0, wlist, jawPalate);
      const c = G.v([-M[M.length - 2].rx * 0.9, M[M.length - 2].y + yoff, zz], 0, 0, wlist, jawPalate);
      const d = G.v([M[M.length - 2].rx * 0.9, M[M.length - 2].y + yoff, zz], 0, 0, wlist, jawPalate);
      flip ? G.quad(a, d, c, b) : G.quad(a, b, c, d);
    };
    pal(z1 - 0.004, wb(QB.head), 0.0, false);
    pal(z1 - 0.004, wb(QB.jaw), -0.003, true);
  }

  // ---- ears (thin pyramids, inner face pink)
  for (const side of [1, -1]) {
    const e = D.ear;
    const bone = side > 0 ? QB.ear_l : QB.ear_r;
    const base: V3 = [e.base[0] * side, e.base[1], e.base[2]];
    const tip: V3 = [e.tip[0] * side, e.tip[1], e.tip[2]];
    const fi: V3 = [base[0] - side * e.w * 0.45, base[1], base[2] + e.d * 0.6];
    const fo: V3 = [base[0] + side * e.w * 0.55, base[1] - 0.006, base[2] + e.d * 0.4];
    const bk: V3 = [base[0], base[1] + 0.004, base[2] - e.d];
    const mid: V3 = [base[0], base[1] + (tip[1] - base[1]) * 0.15, base[2] + e.d * 0.9];
    const w = wmix(wb(QB.head), wb(bone), 0.85);
    const wt = wb(bone);
    const outer = tint(cDark.clone().lerp(cBase, 0.35), base);
    const inn = cInner.clone().lerp(cBase, 0.35);
    // outer back faces
    let a = G.v(fi, 0, 0, w, outer), b = G.v(bk, 0.05, 0, w, outer), t = G.v(tip, 0.02, 0.08, wt, outer);
    side > 0 ? G.tri(a, t, b) : G.tri(a, b, t);
    a = G.v(bk, 0.05, 0, w, outer); b = G.v(fo, 0.1, 0, w, outer); t = G.v(tip, 0.07, 0.08, wt, outer);
    side > 0 ? G.tri(a, t, b) : G.tri(a, b, t);
    // inner (front) face, cupped
    a = G.v(fi, 0, 0, w, inn); b = G.v(mid, 0.05, 0.01, w, inn); const c2 = G.v(fo, 0.1, 0, w, inn); t = G.v(tip, 0.05, 0.08, wt, inn);
    side > 0 ? (G.tri(a, b, t), G.tri(b, c2, t)) : (G.tri(a, t, b), G.tri(b, t, c2));
  }

  // ---- tail
  {
    const pts = D.tail.map((t) => t[0]);
    const rad = D.tail.map((t) => t[1]);
    const n = pts.length;
    const ws: W[] = pts.map((_, i) => {
      const f = i / (n - 1);
      if (f < 0.3) return wmix(wmix(wb(QB.hips), wb(QB.tail1), clamp01(f / 0.08)), wb(QB.tail2), sstep(0.15, 0.3, f));
      if (f < 0.65) return wmix(wb(QB.tail2), wb(QB.tail3), sstep(0.4, 0.65, f));
      return wb(QB.tail3);
    });
    tube(G, pts, rad, ws, [0, 1, 0], 8, (ds, du, p) => {
      const f = (p[1] - pts[0][1]) / Math.max(0.01, pts[n - 1][1] - pts[0][1]);
      let c = cBase.clone().lerp(cDark, 0.25);
      if (du < -0.3) c.lerp(cLight, 0.5);
      if (cTip) c.lerp(cTip, sstep(0.75, 0.95, f));
      const st = stripe([p[0], p[1], p[1] * 1.3], 1) * 0.8;
      if (st > 0) c.lerp(cDark, st);
      return tint(c, p);
    }, true, true);
  }

  // ---- legs
  const legColor = (sock: boolean) => (ds: number, du: number, p: V3) => {
    let c = cBase.clone();
    if (sock && cSocks && p[1] < 0.15 * (D === CAT ? 0.5 : 1)) c.lerp(cSocks, sstep(0.15 * (D === CAT ? 0.5 : 1), 0.06 * (D === CAT ? 0.5 : 1), p[1]));
    if (ds * (p[0] > 0 ? -1 : 1) > 0.3) c.lerp(cLight, 0.45); // inner side lighter
    if (!sock || !cSocks) c.lerp(cLight, sstep(0.2, 0.05, p[1] / (D === CAT ? 0.5 : 1)) * 0.35);
    const st = stripe([p[0], p[1] * 3, p[1] * 3], 1) * 0.5;
    if (st > 0) c.lerp(cDark, st);
    return tint(c, p);
  };
  for (const side of [1, -1]) {
    const L = side > 0;
    // fore
    const sh = D.J[L ? QB.sh_l : QB.sh_r], el = D.J[L ? QB.el_l : QB.el_r], wr = D.J[L ? QB.wr_l : QB.wr_r];
    const bsh = L ? QB.sh_l : QB.sh_r, bel = L ? QB.el_l : QB.el_r, bwr = L ? QB.wr_l : QB.wr_r;
    const ground = D === CAT ? 0.012 : 0.022;
    const pastern: V3 = [wr[0], ground + (wr[1] - ground) * 0.45, wr[2] + (D === CAT ? 0.005 : 0.01)];
    const fpts: V3[] = [
      [sh[0] * 0.8, sh[1] + 0.03, sh[2] + 0.01], sh, lerp3(sh, el, 0.55), el, lerp3(el, wr, 0.5), wr, pastern,
    ];
    const fr = D.fore.r;
    const frad = [fr[0] * 0.9 * bw, fr[0] * bw, fr[1] * bw, fr[2], fr[3], fr[4], fr[5]];
    const fws: W[] = [wb(bsh), wb(bsh), wb(bsh), wmix(wb(bsh), wb(bel), 0.5), wb(bel), wmix(wb(bel), wb(bwr), 0.5), wb(bwr)];
    tube(G, fpts, frad, fws, [0, 0, 1], 9, legColor(true), true, false);
    // hind
    const hp = D.J[L ? QB.hip_l : QB.hip_r], kn = D.J[L ? QB.kn_l : QB.kn_r], ho = D.J[L ? QB.ho_l : QB.ho_r];
    const bhp = L ? QB.hip_l : QB.hip_r, bkn = L ? QB.kn_l : QB.kn_r, bho = L ? QB.ho_l : QB.ho_r;
    const meta: V3 = [ho[0], ground + 0.012, ho[2] + (D === CAT ? 0.03 : 0.05)];
    const hpts: V3[] = [
      [hp[0] * 0.7, hp[1] + 0.04, hp[2] + 0.01], hp, lerp3(hp, kn, 0.5), kn, lerp3(kn, ho, 0.5), ho, lerp3(ho, meta, 0.6), meta,
    ];
    const hr = D.hind.r;
    const hrad = [hr[0] * 0.95 * bw, hr[0] * bw, hr[1] * bw, hr[2], hr[3], hr[4], hr[5], hr[5] * 0.95];
    const hws: W[] = [wmix(wb(QB.hips), wb(bhp), 0.6), wb(bhp), wb(bhp), wmix(wb(bhp), wb(bkn), 0.5), wb(bkn), wmix(wb(bkn), wb(bho), 0.5), wb(bho), wb(bho)];
    tube(G, hpts, hrad, hws, [0, 0, 1], 9, legColor(true), true, false);
    // paws (squashed spheres)
    for (const [pp, bone] of [[pastern, bwr], [meta, bho]] as [V3, number][]) {
      const pc: V3 = [pp[0], ground + D.paw[1] * 0.5, pp[2] + D.paw[2] * 0.45];
      const pc2 = legColor(true)(0, 0, [pp[0], 0.01, pp[2]]);
      const rings: number[][] = [];
      const nLat = 4, nLon = 8;
      for (let i = 0; i <= nLat; i++) {
        const lat = -Math.PI / 2 + (Math.PI * i) / nLat;
        const r: number[] = [];
        for (let j = 0; j <= nLon; j++) {
          const lon = (Math.PI * 2 * j) / nLon;
          const p: V3 = [pc[0] + Math.cos(lat) * Math.sin(lon) * D.paw[0], Math.max(0.0, pc[1] + Math.sin(lat) * D.paw[1]), pc[2] + Math.cos(lat) * Math.cos(lon) * D.paw[2]];
          r.push(G.v(p, j / nLon * 0.1, i / nLat * 0.05, wb(bone), pc2));
        }
        rings.push(r);
      }
      for (let i = 0; i < nLat; i++) bridge(G, rings[i + 1], rings[i]);
    }
  }

  const geo = G.build();
  geo.computeBoundingSphere();

  // ---- material
  const mat = new THREE.MeshStandardMaterial({
    map: spec.fur ?? null, normalMap: spec.furNormal ?? null, vertexColors: true, roughness: 0.92, metalness: 0,
  });
  if (spec.furNormal) mat.normalScale.set(0.6, 0.6);
  if (spec.fur) {
    spec.fur.wrapS = spec.fur.wrapT = THREE.RepeatWrapping;
    spec.fur.repeat.set(1 / D.furTile, 1 / D.furTile);
  }
  mat.name = 'life_fur_' + spec.species;

  // ---- skeleton
  const bones: THREE.Bone[] = [];
  for (let i = 0; i < NB; i++) {
    const b = new THREE.Bone();
    b.name = Object.keys(QB)[i];
    const p = D.J[i], pp = PARENT[i] >= 0 ? D.J[PARENT[i]] : [0, 0, 0];
    b.position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
    bones.push(b);
  }
  for (let i = 0; i < NB; i++) if (PARENT[i] >= 0) bones[PARENT[i]].add(bones[i]);
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.add(bones[0]);
  mesh.updateMatrixWorld(true);
  const skel = new THREE.Skeleton(bones);
  mesh.bind(skel);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  // ---- attached parts
  const glossy = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.18, metalness: 0.0 });
  const eyeMat = glossy(col.eye);
  const eyes: THREE.Mesh[] = [];
  const eyeGeo = new THREE.SphereGeometry(D.eye.r, 8, 6);
  for (const side of [1, -1]) {
    const m = new THREE.Mesh(eyeGeo, eyeMat);
    const hp = D.J[QB.head];
    m.position.set(D.eye.p[0] * side - hp[0], D.eye.p[1] - hp[1], D.eye.p[2] - hp[2]);
    m.scale.set(0.9, 0.85, 0.6);
    bones[QB.head].add(m);
    eyes.push(m);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), glossy(col.nose));
  {
    const hp = D.J[QB.head];
    nose.position.set(D.nose.p[0] - hp[0], D.nose.p[1] - hp[1], D.nose.p[2] - hp[2]);
    nose.scale.set(D.nose.s[0], D.nose.s[1], D.nose.s[2]);
    bones[QB.head].add(nose);
  }
  const tongue = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 5), new THREE.MeshStandardMaterial({ color: '#d0566a', roughness: 0.35 }));
  {
    const jp = D.J[QB.jaw], M = D.muzzle;
    const len = (M[M.length - 1].z - M[0].z) * 0.8;
    tongue.scale.set(M[1].rx * 0.7, 0.006, len * 0.55);
    tongue.position.set(0, M[1].y - jp[1] - 0.004, (M[0].z + M[M.length - 1].z) / 2 - jp[2]);
    tongue.visible = false;
    bones[QB.jaw].add(tongue);
  }
  // collar (hidden until adopted)
  const collar = new THREE.Group();
  {
    const n0 = D.neck[0][0], n1 = D.neck[1][0];
    const c = lerp3(n0, n1, 0.55);
    const np = D.J[QB.neck];
    const r = D.neck[1][1] * bw * 1.06;
    const torus = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.16, 5, 14), new THREE.MeshStandardMaterial({ color: '#b3202a', roughness: 0.6 }));
    const dir = norm(sub(n1, n0));
    torus.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(dir[0], dir[1], dir[2]));
    collar.add(torus);
    const tag = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.32, r * 0.32, 0.004, 10), new THREE.MeshStandardMaterial({ color: '#e0b440', roughness: 0.25, metalness: 0.9 }));
    tag.rotation.x = Math.PI / 2;
    tag.position.set(0, -r * 1.12, r * 0.15);
    collar.add(tag);
    collar.position.set(c[0] - np[0], c[1] - np[1], c[2] - np[2]);
    collar.visible = false;
    bones[QB.neck].add(collar);
  }

  const inner = new THREE.Group();
  inner.rotation.y = Math.PI;
  inner.add(mesh);
  const root = new THREE.Group();
  root.add(inner);
  const s = spec.scale ?? 1;
  inner.scale.setScalar(s);
  root.userData.headHeight = (D.J[QB.head][1] + 0.18) * s;

  return {
    root, inner, mesh, bones, eyes, tongue, collar, species: spec.species, dims: D, height: D.J[QB.head][1] * s,
    dispose: () => {
      geo.dispose(); mat.dispose(); eyeGeo.dispose(); eyeMat.dispose();
      nose.geometry.dispose(); (nose.material as THREE.Material).dispose();
      tongue.geometry.dispose(); (tongue.material as THREE.Material).dispose();
      collar.traverse((o: any) => { o.geometry?.dispose(); o.material?.dispose?.(); });
      skel.dispose();
    },
  };
}

// ------------------------------------------------------------------ animator

export type QuadPose = 'stand' | 'sit' | 'lie' | 'sleep' | 'beg';

export interface QuadInput {
  /** horizontal speed m/s */
  speed: number;
  /** yaw rate rad/s (body bends into turns) */
  turn: number;
  pose: QuadPose;
  wag: number;       // 0..1
  eat: boolean;
  scratch: boolean;
  sniff: boolean;
  pant: boolean;
  alert: number;     // ears forward 0..1, -1 = ears back
  tail: number;      // -1 tucked … 0 relaxed … 1 high
  /** world-space look target (head/neck) */
  look: THREE.Vector3 | null;
  /** cat: knead / swat with a front paw */
  swat?: boolean;
  /** float (ghost) — legs dangle */
}

const POSES: QuadPose[] = ['stand', 'sit', 'lie', 'sleep', 'beg'];
type EulerArr = Float32Array; // NB*3

function poseTargets(pose: QuadPose, sp: Species, out: EulerArr, root: { y: number; pitch: number }) {
  out.fill(0);
  const cat = sp === 'cat';
  const k = cat ? 0.5 : 1; // vertical scale of offsets
  const set = (b: number, x: number, y = 0, z = 0) => { out[b * 3] = x; out[b * 3 + 1] = y; out[b * 3 + 2] = z; };
  root.y = 0; root.pitch = 0;
  switch (pose) {
    case 'stand':
      set(QB.tail1, cat ? 0.25 : 0.15); set(QB.tail2, cat ? 0.2 : 0.1); set(QB.tail3, cat ? -0.4 : 0.1);
      break;
    case 'sit':
      root.y = -0.21 * k; root.pitch = 0;
      set(QB.hips, -0.62); set(QB.spine, 0.05); set(QB.chest, 0.03);
      set(QB.neck, 0.2); set(QB.head, 0.38);
      set(QB.sh_l, 0.55); set(QB.sh_r, 0.55); set(QB.el_l, -0.05); set(QB.el_r, -0.05); set(QB.wr_l, 0.05); set(QB.wr_r, 0.05);
      set(QB.hip_l, -0.75, 0, -0.18); set(QB.hip_r, -0.75, 0, 0.18); set(QB.kn_l, 1.75); set(QB.kn_r, 1.75); set(QB.ho_l, -1.05); set(QB.ho_r, -1.05);
      set(QB.tail1, -0.65 + (cat ? 0.3 : 0)); set(QB.tail2, cat ? -0.8 : -0.3); set(QB.tail3, cat ? 0.2 : -0.2);
      break;
    case 'beg':
      root.y = -0.2 * k;
      set(QB.hips, -1.08); set(QB.spine, -0.08); set(QB.chest, -0.05);
      set(QB.neck, 0.35); set(QB.head, 0.55);
      set(QB.sh_l, 0.25, 0, 0.1); set(QB.sh_r, 0.25, 0, -0.1); set(QB.el_l, 1.55); set(QB.el_r, 1.55); set(QB.wr_l, 0.6); set(QB.wr_r, 0.6);
      set(QB.hip_l, -0.4, 0, -0.2); set(QB.hip_r, -0.4, 0, 0.2); set(QB.kn_l, 1.95); set(QB.kn_r, 1.95); set(QB.ho_l, -1.25); set(QB.ho_r, -1.25);
      set(QB.tail1, -1.0); set(QB.tail2, -0.3);
      break;
    case 'lie':
      root.y = -0.355 * k;
      set(QB.neck, -0.15); set(QB.head, 0.3);
      set(QB.sh_l, -1.32, 0, 0.05); set(QB.sh_r, -1.32, 0, -0.05); set(QB.el_l, 0.15); set(QB.el_r, 0.15); set(QB.wr_l, -0.2); set(QB.wr_r, -0.2);
      set(QB.hip_l, -1.05, 0.25, -0.45); set(QB.hip_r, -1.05, -0.25, 0.45); set(QB.kn_l, 2.1); set(QB.kn_r, 2.1); set(QB.ho_l, -1.25); set(QB.ho_r, -1.25);
      set(QB.tail1, -0.9, 0.5); set(QB.tail2, -0.25, 0.4); set(QB.tail3, 0, 0.3);
      break;
    case 'sleep':
      root.y = -0.37 * k;
      set(QB.spine, 0, 0.18); set(QB.chest, 0, 0.15);
      set(QB.neck, 0.55, 0.3); set(QB.head, 0.5, 0.25, 0.2);
      set(QB.sh_l, -1.4, 0.2, 0.05); set(QB.sh_r, -1.35, 0.1, -0.05); set(QB.el_l, 0.2); set(QB.el_r, 0.3); set(QB.wr_l, -0.25); set(QB.wr_r, -0.3);
      set(QB.hip_l, -1.15, 0.35, -0.5); set(QB.hip_r, -1.0, 0.1, 0.4); set(QB.kn_l, 2.15); set(QB.kn_r, 2.1); set(QB.ho_l, -1.3); set(QB.ho_r, -1.25);
      set(QB.tail1, -1.0, 0.9); set(QB.tail2, -0.2, 0.6); set(QB.tail3, 0, 0.5);
      break;
  }
}

const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _e = new THREE.Euler();

export class QuadAnimator {
  private cur = new Float32Array(NB * 3);
  private tgt = new Float32Array(NB * 3);
  private tmp = new Float32Array(NB * 3);
  private w: Record<QuadPose, number> = { stand: 1, sit: 0, lie: 0, sleep: 0, beg: 0 };
  private rootY = 0; private rootPitch = 0;
  private phase = 0;
  private gaitAmp = 0;
  private trotK = 0; private gallopK = 0;
  private t = Math.random() * 100;
  private barkT = 9; private barkN = 0;
  private wagK = 0; private eatK = 0; private scratchK = 0; private sniffK = 0; private pantK = 0; private alertK = 0; private tailK = 0;
  private lookYaw = 0; private lookPitch = 0;
  private blinkT = 2;
  private idleLookT = 3; private idleYaw = 0; private idlePitch = 0;
  private turnK = 0;
  private swatK = 0;
  private sitBlend = 0;

  constructor(private rig: QuadRig) {}

  /** trigger a bark (or meow for cats): head jerk + jaw */
  bark(n = 1) { this.barkT = 0; this.barkN = n; }

  update(dt: number, inp: QuadInput) {
    const rig = this.rig;
    const sp = rig.species;
    const cat = sp === 'cat';
    this.t += dt;
    const ease = (cur: number, to: number, rate: number) => cur + (to - cur) * (1 - Math.exp(-rate * dt));

    // ---- pose weights
    const moving = inp.speed > 0.15;
    const wantPose: QuadPose = moving ? 'stand' : inp.pose;
    for (const p of POSES) this.w[p] = ease(this.w[p], p === wantPose ? 1 : 0, p === wantPose && p !== 'stand' ? 4 : 6);
    const tot = POSES.reduce((a, p) => a + this.w[p], 0) || 1;
    this.tgt.fill(0);
    let ry = 0, rp = 0;
    const rootTmp = { y: 0, pitch: 0 };
    for (const p of POSES) {
      const wt = this.w[p] / tot;
      if (wt < 0.001) continue;
      poseTargets(p, sp, this.tmp, rootTmp);
      for (let i = 0; i < NB * 3; i++) this.tgt[i] += this.tmp[i] * wt;
      ry += rootTmp.y * wt; rp += rootTmp.pitch * wt;
    }
    const standW = this.w.stand / tot;
    this.sitBlend = 1 - standW;

    // ---- layers
    this.wagK = ease(this.wagK, inp.wag, 5);
    this.eatK = ease(this.eatK, inp.eat ? 1 : 0, 5);
    this.scratchK = ease(this.scratchK, inp.scratch ? 1 : 0, 6);
    this.sniffK = ease(this.sniffK, inp.sniff ? 1 : 0, 3);
    this.pantK = ease(this.pantK, inp.pant ? 1 : 0, 4);
    this.alertK = ease(this.alertK, inp.alert, 5);
    this.tailK = ease(this.tailK, inp.tail, 3);
    this.swatK = ease(this.swatK, inp.swat ? 1 : 0, 8);
    this.turnK = ease(this.turnK, Math.max(-1, Math.min(1, inp.turn * 0.5)), 4);
    const T = this.tgt;
    const addB = (b: number, x: number, y = 0, z = 0) => { T[b * 3] += x; T[b * 3 + 1] += y; T[b * 3 + 2] += z; };

    // breathing / idle
    const breath = Math.sin(this.t * (this.pantK > 0.3 ? 9 : 1.6));
    addB(QB.chest, breath * (0.012 + this.pantK * 0.02));
    // tail carriage: -1 tucked .. +1 high
    addB(QB.tail1, this.tailK * (cat ? 0.6 : 0.7) * standW + (this.tailK < 0 ? this.tailK * 0.5 : 0));
    addB(QB.tail2, this.tailK * 0.25);
    // wag (dogs: fast sideways; cats: slow swish)
    if (this.wagK > 0.01) {
      const f = cat ? 2.2 : 9.5;
      const a = cat ? 0.35 : 0.75;
      const s = Math.sin(this.t * f);
      addB(QB.tail1, 0, s * a * this.wagK);
      addB(QB.tail2, 0, Math.sin(this.t * f - 0.7) * a * 0.7 * this.wagK);
      addB(QB.tail3, 0, Math.sin(this.t * f - 1.4) * a * 0.6 * this.wagK);
      if (!cat) addB(QB.hips, 0, -s * 0.05 * this.wagK * standW);
    } else if (cat) {
      // idle tail tip curl
      addB(QB.tail3, 0, Math.sin(this.t * 0.9) * 0.25);
    }
    // eat: head down to the bowl, chew
    if (this.eatK > 0.01) {
      const chew = Math.max(0, Math.sin(this.t * 11));
      addB(QB.neck, (cat ? 0.95 : 1.05) * this.eatK);
      addB(QB.head, (0.55 + Math.sin(this.t * 5.5) * 0.06) * this.eatK);
      addB(QB.jaw, chew * 0.28 * this.eatK);
      addB(QB.sh_l, 0.12 * this.eatK, 0, 0.06 * this.eatK); addB(QB.sh_r, 0.12 * this.eatK, 0, -0.06 * this.eatK);
    }
    // sniff (head low, side to side)
    if (this.sniffK > 0.01 && this.eatK < 0.5) {
      addB(QB.neck, 0.6 * this.sniffK, Math.sin(this.t * 1.7) * 0.35 * this.sniffK);
      addB(QB.head, 0.3 * this.sniffK);
      addB(QB.jaw, Math.max(0, Math.sin(this.t * 14)) * 0.03 * this.sniffK);
    }
    // pant (mouth open, tongue)
    addB(QB.jaw, this.pantK * (0.2 + Math.sin(this.t * 9) * 0.04));
    rig.tongue.visible = this.pantK > 0.35 || this.eatK > 0.6;
    // scratch: hind right leg up to the ear, fast
    if (this.scratchK > 0.01) {
      const s = Math.sin(this.t * 22);
      addB(QB.hip_r, (-1.25 + s * 0.22) * this.scratchK, 0, -0.35 * this.scratchK);
      addB(QB.kn_r, 0.4 * this.scratchK);
      addB(QB.ho_r, 0.6 * this.scratchK);
      addB(QB.neck, -0.1 * this.scratchK, -0.35 * this.scratchK, 0.25 * this.scratchK);
      addB(QB.head, 0, -0.25 * this.scratchK, 0.35 * this.scratchK);
    }
    // swat (cat front paw)
    if (this.swatK > 0.01) {
      const s = Math.max(0, Math.sin(this.t * 13));
      addB(QB.sh_r, (-1.2 - s * 0.3) * this.swatK, 0, -0.15 * this.swatK);
      addB(QB.el_r, (0.6 - s * 0.4) * this.swatK);
      addB(QB.wr_r, -0.3 * this.swatK);
    }
    // ears
    addB(QB.ear_l, this.alertK * 0.28, 0, (this.alertK < 0 ? -this.alertK * 0.7 : 0));
    addB(QB.ear_r, this.alertK * 0.28, 0, (this.alertK < 0 ? this.alertK * 0.7 : 0));
    if (Math.sin(this.t * 0.7 + 1.3) > 0.985) addB(QB.ear_l, 0.25);
    if (Math.sin(this.t * 0.6 + 4.1) > 0.985) addB(QB.ear_r, 0.25);

    // bark: head jerk + jaw snap (repeats barkN times)
    this.barkT += dt;
    const bdur = cat ? 0.55 : 0.28;
    if (this.barkT < bdur * this.barkN) {
      const lt = (this.barkT % bdur) / bdur;
      const env = Math.sin(Math.min(1, lt * 1.6) * Math.PI);
      addB(QB.neck, -0.22 * env);
      addB(QB.head, -0.18 * env);
      addB(QB.jaw, (cat ? 0.32 : 0.55) * env);
      addB(QB.chest, 0.06 * env);
      ry -= 0.01 * env;
    }

    // look-at (head & neck yaw/pitch) — idle glances when no target
    let wantYaw = 0, wantPitch = 0;
    if (inp.look) {
      rig.root.updateMatrixWorld();
      _m.copy(rig.inner.matrixWorld).invert();
      _v.copy(inp.look).applyMatrix4(_m);
      const hp = rig.dims.J[QB.head];
      const dx = _v.x - hp[0], dy = _v.y - hp[1], dz = _v.z - hp[2];
      wantYaw = Math.atan2(dx, dz);
      wantPitch = -Math.atan2(dy, Math.hypot(dx, dz));
      if (Math.abs(wantYaw) > 2.2) wantYaw = 0;
      wantYaw = Math.max(-1.1, Math.min(1.1, wantYaw));
      wantPitch = Math.max(-0.7, Math.min(0.6, wantPitch));
    } else if (!moving) {
      this.idleLookT -= dt;
      if (this.idleLookT < 0) {
        this.idleLookT = 1.5 + Math.random() * 4;
        this.idleYaw = (Math.random() - 0.5) * 1.4;
        this.idlePitch = (Math.random() - 0.4) * 0.4;
      }
      wantYaw = this.idleYaw; wantPitch = this.idlePitch;
    }
    const lookK = 1 - this.eatK * 0.9 - this.scratchK;
    this.lookYaw = ease(this.lookYaw, wantYaw * lookK, 5);
    this.lookPitch = ease(this.lookPitch, wantPitch * lookK, 5);
    addB(QB.neck, this.lookPitch * 0.4, this.lookYaw * 0.45);
    addB(QB.head, this.lookPitch * 0.6, this.lookYaw * 0.55);

    // blink
    this.blinkT -= dt;
    const sleeping = (this.w.sleep / tot) > 0.6;
    const blink = this.blinkT < 0.12 && this.blinkT > 0;
    if (this.blinkT < 0) this.blinkT = 2 + Math.random() * 4;
    for (const e of rig.eyes) e.scale.y = sleeping || blink ? 0.12 : 0.85;

    // ---- smooth pose layer
    const rate = 9;
    const k = 1 - Math.exp(-rate * dt);
    for (let i = 0; i < NB * 3; i++) this.cur[i] += (T[i] - this.cur[i]) * k;
    this.rootY += (ry - this.rootY) * k;
    this.rootPitch += (rp - this.rootPitch) * k;

    // ---- gait layer (unsmoothed cycle, smoothed amplitude)
    const s = inp.speed;
    this.gaitAmp = ease(this.gaitAmp, moving ? Math.min(1, s / 0.5) : 0, 8);
    const sc = cat ? 0.55 : 1;
    this.trotK = ease(this.trotK, s > 1.1 * sc ? 1 : 0, 4);
    this.gallopK = ease(this.gallopK, s > 3.0 * sc ? 1 : 0, 4);
    const strideLen = (cat ? 0.32 : 0.62) * (1 + this.trotK * 0.25 + this.gallopK * 0.9);
    const freq = Math.max(0.6, s / strideLen);
    this.phase = (this.phase + dt * freq) % 1;
    const G = new Float32Array(NB * 3);
    let gy = 0, gp = 0;
    if (this.gaitAmp > 0.01) {
      const amp = Math.min(0.55, 0.22 + s * (cat ? 0.25 : 0.1)) * this.gaitAmp;
      // phase offsets: [LF, RF, LH, RH]
      const walkOff = [0.5, 0.0, 0.75, 0.25];
      const trotOff = [0.5, 0.0, 0.0, 0.5];
      const galOff = [0.55, 0.65, 0.0, 0.1];
      const off = [0, 1, 2, 3].map((i) => {
        const w0 = walkOff[i], w1 = trotOff[i], w2 = galOff[i];
        const a = w0 + (w1 - w0) * this.trotK;
        return a + (w2 - a) * this.gallopK;
      });
      const duty = 0.62 - this.trotK * 0.12 - this.gallopK * 0.12;
      const leg = (ph: number) => {
        ph = ((ph % 1) + 1) % 1;
        if (ph < duty) { const t = ph / duty; return { swing: 1 - 2 * t, lift: 0 }; } // +1 forward → -1 back
        const t = (ph - duty) / (1 - duty);
        return { swing: -1 + 2 * (t * t * (3 - 2 * t)), lift: Math.sin(t * Math.PI) };
      };
      const g = (b: number, x: number, y = 0, z = 0) => { G[b * 3] += x; G[b * 3 + 1] += y; G[b * 3 + 2] += z; };
      const L = [leg(this.phase + off[0]), leg(this.phase + off[1]), leg(this.phase + off[2]), leg(this.phase + off[3])];
      // forelegs: negative x = forward
      const fl = (l: { swing: number; lift: number }, sh: number, el: number, wr: number) => {
        g(sh, -l.swing * amp);
        g(el, l.lift * amp * 1.7);
        g(wr, l.lift * amp * 2.2 - Math.max(0, -l.swing) * 0.15 * this.gaitAmp);
      };
      const hl = (l: { swing: number; lift: number }, hp: number, kn: number, ho: number) => {
        g(hp, -l.swing * amp * 0.95);
        g(kn, l.lift * amp * 1.5);
        g(ho, -l.lift * amp * 1.6);
      };
      fl(L[0], QB.sh_l, QB.el_l, QB.wr_l);
      fl(L[1], QB.sh_r, QB.el_r, QB.wr_r);
      hl(L[2], QB.hip_l, QB.kn_l, QB.ho_l);
      hl(L[3], QB.hip_r, QB.kn_r, QB.ho_r);
      // body
      const ph2 = this.phase * Math.PI * 4;
      gy = (Math.abs(Math.sin(ph2 / 2)) - 0.5) * 0.012 * this.gaitAmp * (1 + this.gallopK * 2) * (cat ? 0.5 : 1);
      g(QB.spine, Math.sin(this.phase * Math.PI * 2) * 0.12 * this.gallopK);
      g(QB.chest, -Math.sin(this.phase * Math.PI * 2) * 0.1 * this.gallopK);
      gp = Math.sin(this.phase * Math.PI * 2 + 0.6) * 0.08 * this.gallopK;
      g(QB.hips, 0, Math.sin(this.phase * Math.PI * 2) * 0.05 * (1 - this.gallopK), Math.sin(this.phase * Math.PI * 2) * 0.03);
      g(QB.neck, Math.sin(ph2) * 0.04 + this.gallopK * -0.15, 0, 0);
      g(QB.head, -Math.sin(ph2) * 0.03, 0, 0);
      // tail streams back when running
      g(QB.tail1, -0.25 * this.gallopK);
      // turning: bend the spine into the turn
      g(QB.spine, 0, this.turnK * 0.2);
      g(QB.chest, 0, this.turnK * 0.2);
      g(QB.neck, 0, this.turnK * 0.25);
    }

    // ---- apply
    const B = rig.bones;
    for (let i = 0; i < NB; i++) {
      _e.set(this.cur[i * 3] + G[i * 3], this.cur[i * 3 + 1] + G[i * 3 + 1], this.cur[i * 3 + 2] + G[i * 3 + 2], 'YXZ');
      B[i].quaternion.setFromEuler(_e);
    }
    const J = rig.dims.J;
    B[QB.hips].position.set(J[QB.hips][0], J[QB.hips][1] + this.rootY + gy, J[QB.hips][2]);
    rig.inner.rotation.x = -(this.rootPitch + gp);
  }
}

export { DOG as DOG_DIMS, CAT as CAT_DIMS };
