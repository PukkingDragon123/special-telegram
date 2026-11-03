import type { RNG } from '../../core/rng';
import type { GarmentKind } from './api';

/* ============================================================================================
 * GARMENT PATTERNS → cloth meshes.
 *
 * Every garment is a real sewing-pattern outline (metres, x across, y up, y = 0 at the top edge / shoulder
 * line, garment hangs toward -y). The outline is meshed with a regular grid (spacing h): nodes inside the
 * outline are kept, cells become triangles, then every border node is SNAPPED onto the outline, so sleeves,
 * necklines and leg openings have smooth real silhouettes, not stair steps or rectangles.
 * Output also carries per-node distance-to-edge (hem / seam shading) and named pin candidates.
 * ========================================================================================== */

export type Pt = [number, number];

export interface GarmentMesh {
  kind: GarmentKind;
  /** node rest positions in pattern space (x, y) */
  xy: Float32Array;
  n: number;
  tris: Uint32Array;
  /** distance of each node to the outline (m) */
  edge: Float32Array;
  /** pattern bounding box */
  w: number; h: number; x0: number; y0: number;
  /** pin candidate points in pattern space */
  pins: { shoulders?: Pt[]; top?: Pt[]; hem?: Pt[]; middle?: number };
  /** grid spacing used */
  step: number;
}

// ------------------------------------------------------------------ outlines

/** smooth closed curve through control points (Catmull-Rom, `sub` samples per span) */
function smooth(pts: Pt[], sub = 4, closed = true): Pt[] {
  const out: Pt[] = [];
  const n = pts.length;
  const at = (i: number) => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  const spans = closed ? n : n - 1;
  for (let i = 0; i < spans; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let k = 0; k < sub; k++) {
      const t = k / sub, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return out;
}

/** polyline with sharp corners kept: corners listed as [x, y, round?] — round=1 → smoothed locally */
function poly(pts: [number, number, number?][]): Pt[] {
  const out: Pt[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    if (p[2]) {
      // rounded corner: replace the corner by a short arc between its neighbours' directions
      const a = pts[(i - 1 + n) % n];
      const r = p[2];
      const d1 = norm([a[0] - p[0], a[1] - p[1]]), d2 = norm([q[0] - p[0], q[1] - p[1]]);
      const s: Pt = [p[0] + d1[0] * r, p[1] + d1[1] * r], e: Pt = [p[0] + d2[0] * r, p[1] + d2[1] * r];
      for (let k = 0; k <= 4; k++) {
        const t = k / 4, u = 1 - t;
        out.push([u * u * s[0] + 2 * u * t * p[0] + t * t * e[0], u * u * s[1] + 2 * u * t * p[1] + t * t * e[1]]);
      }
    } else out.push([p[0], p[1]]);
    // densify long straight edges so snapping has a dense target
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const k = Math.floor(L / 0.03);
    for (let j = 1; j < k; j++) out.push([p[0] + (q[0] - p[0]) * (j / k), p[1] + (q[1] - p[1]) * (j / k)]);
  }
  return out;
}
function norm(v: Pt): Pt { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }

export interface Pattern { outline: Pt[]; pins: GarmentMesh['pins']; step: number; key?: string }

/** T-shirt: body W × L, short sleeves angled down, scooped crew neck */
function tshirt(W: number, L: number, sl = 0.19, slA = 0.55): Pattern {
  const hw = W / 2, nk = W * 0.17, sh = 0.03;
  const sx = Math.cos(slA) * sl, sy = Math.sin(slA) * sl, cuff = 0.15;
  const o = poly([
    [-nk, 0, 0.02], [-hw + 0.02, -sh], [-hw - sx, -sh - sy], [-hw - sx + Math.sin(slA) * cuff, -sh - sy - Math.cos(slA) * cuff],
    [-hw, -0.21, 0.03], [-hw + 0.01, -L + 0.02, 0.02], [hw - 0.01, -L + 0.02, 0.02], [hw, -0.21, 0.03],
    [hw + sx - Math.sin(slA) * cuff, -sh - sy - Math.cos(slA) * cuff], [hw + sx, -sh - sy], [hw - 0.02, -sh], [nk, 0, 0.02],
    [nk * 0.6, -0.055], [0, -0.07], [-nk * 0.6, -0.055],
  ]);
  return { outline: o, pins: { shoulders: [[-hw + 0.06, -sh * 0.8], [-nk - 0.02, -0.005], [nk + 0.02, -0.005], [hw - 0.06, -sh * 0.8]], hem: [[-hw + 0.03, -L + 0.03], [hw - 0.03, -L + 0.03]] }, step: 0.045 };
}

/** button shirt / school shirt: like a tee with longer sleeves, a collar and a curved shirt-tail hem */
function shirt(W: number, L: number): Pattern {
  const hw = W / 2, nk = W * 0.15, slA = 0.75, sl = 0.24, cuff = 0.15;
  const sx = Math.cos(slA) * sl, sy = Math.sin(slA) * sl;
  const o = poly([
    [-nk - 0.03, 0.025], [-hw + 0.02, -0.035], [-hw - sx, -0.035 - sy], [-hw - sx + Math.sin(slA) * cuff, -0.035 - sy - Math.cos(slA) * cuff],
    [-hw, -0.23, 0.03], [-hw, -L + 0.08], [-hw * 0.55, -L + 0.02, 0.04], [0, -L - 0.03, 0.05], [hw * 0.55, -L + 0.02, 0.04], [hw, -L + 0.08], [hw, -0.23, 0.03],
    [hw + sx - Math.sin(slA) * cuff, -0.035 - sy - Math.cos(slA) * cuff], [hw + sx, -0.035 - sy], [hw - 0.02, -0.035], [nk + 0.03, 0.025],
    [nk * 0.5, -0.06], [0, -0.09], [-nk * 0.5, -0.06],
  ]);
  return { outline: o, pins: { shoulders: [[-hw + 0.06, -0.03], [-nk - 0.02, 0.0], [nk + 0.02, 0.0], [hw - 0.06, -0.03]], hem: [[-hw + 0.03, -L + 0.09], [hw - 0.03, -L + 0.09]] }, step: 0.045 };
}

/** เสื้อกล้าม singlet: deep arm holes, narrow straps, scoop neck */
function singlet(W: number, L: number): Pattern {
  const hw = W / 2, st = 0.05;
  const o = poly([
    [-hw * 0.42 - st, 0], [-hw * 0.42, 0], [-hw * 0.3, -0.12, 0.04], [0, -0.17, 0.06], [hw * 0.3, -0.12, 0.04], [hw * 0.42, 0], [hw * 0.42 + st, 0],
    [hw * 0.62, -0.16, 0.05], [hw, -0.28, 0.05], [hw - 0.005, -L + 0.02, 0.02], [-hw + 0.005, -L + 0.02, 0.02], [-hw, -0.28, 0.05], [-hw * 0.62, -0.16, 0.05],
  ]);
  return { outline: o, pins: { shoulders: [[-hw * 0.42 - st / 2, -0.01], [hw * 0.42 + st / 2, -0.01]], hem: [[-hw + 0.03, -L + 0.03], [hw - 0.03, -L + 0.03]] }, step: 0.04 };
}

/** moto-taxi vest: sleeveless, V neck, wider armholes, boxy */
function vest(W: number, L: number): Pattern {
  const hw = W / 2;
  const o = poly([
    [-hw * 0.32, 0, 0.01], [-hw * 0.5, 0], [-hw * 0.82, -0.2, 0.06], [-hw, -0.25], [-hw, -L + 0.02, 0.02], [hw, -L + 0.02, 0.02], [hw, -0.25], [hw * 0.82, -0.2, 0.06],
    [hw * 0.5, 0], [hw * 0.32, 0, 0.01], [0, -0.22],
  ]);
  return { outline: o, pins: { shoulders: [[-hw * 0.42, -0.01], [hw * 0.42, -0.01]], hem: [[-hw + 0.03, -L + 0.03], [hw - 0.03, -L + 0.03]] }, step: 0.045 };
}

/** long-sleeve jacket (delivery rider): sleeves hang close to the body */
function jacket(W: number, L: number): Pattern {
  const hw = W / 2, nk = W * 0.16, slA = 1.05, sl = 0.5, cuff = 0.12;
  const sx = Math.cos(slA) * sl, sy = Math.sin(slA) * sl;
  const o = poly([
    [-nk, 0.02, 0.02], [-hw + 0.02, -0.04], [-hw - sx, -0.04 - sy], [-hw - sx + Math.sin(slA) * cuff, -0.04 - sy - Math.cos(slA) * cuff],
    [-hw, -0.25, 0.02], [-hw, -L + 0.02, 0.02], [hw, -L + 0.02, 0.02], [hw, -0.25, 0.02],
    [hw + sx - Math.sin(slA) * cuff, -0.04 - sy - Math.cos(slA) * cuff], [hw + sx, -0.04 - sy], [hw - 0.02, -0.04], [nk, 0.02, 0.02], [0, -0.06],
  ]);
  return { outline: o, pins: { shoulders: [[-hw + 0.06, -0.035], [-nk - 0.02, 0.01], [nk + 0.02, 0.01], [hw - 0.06, -0.035]], hem: [[-hw + 0.03, -L + 0.03], [hw - 0.03, -L + 0.03]] }, step: 0.05 };
}

/** shorts / boxers / trousers: waistband on top, two legs split by the crotch */
function bottoms(W: number, L: number, crotch: number, flare = 0.02): Pattern {
  const hw = W / 2, gap = 0.012;
  const o = poly([
    [-hw, 0, 0.01], [hw, 0, 0.01], [hw + flare, -L, 0.012], [gap, -L, 0.01], [gap, -crotch, 0.025], [-gap, -crotch, 0.025], [-gap, -L, 0.01], [-hw - flare, -L, 0.012],
  ]);
  return { outline: o, pins: { top: [[-hw + 0.02, -0.01], [0, -0.01], [hw - 0.02, -0.01]], hem: [[-hw + 0.03, -L + 0.02], [hw - 0.03, -L + 0.02]] }, step: L > 0.7 ? 0.055 : 0.04 };
}

/** rectangle (towel / ผ้าขาวม้า / sarong / sheet), slightly irregular hand-woven edges */
function rect(W: number, L: number, step: number): Pattern {
  const hw = W / 2;
  const o = poly([[-hw, 0], [hw, 0], [hw, -L], [-hw, -L]]);
  return { outline: o, pins: { top: [[-hw + 0.02, -0.01], [0, -0.01], [hw - 0.02, -0.01]], hem: [[-hw + 0.02, -L + 0.02], [hw - 0.02, -L + 0.02]], middle: -L / 2 }, step };
}

/** a sock (L-shape), toe pointing +x */
function sock(): Pattern {
  const o = poly([[-0.045, 0, 0.01], [0.045, 0, 0.01], [0.05, -0.17, 0.03], [0.14, -0.2, 0.035], [0.14, -0.27, 0.035], [0.02, -0.27, 0.03], [-0.05, -0.22, 0.04]]);
  return { outline: o, pins: { top: [[0, -0.008]] }, step: 0.025 };
}

export function pattern(kind: GarmentKind, rng: RNG, size?: [number, number]): Pattern {
  // sizes snap to 2 cm so garments of the same cut share one cached mesh
  const r = (a: number, b: number) => Math.round(rng.range(a, b) * 50) / 50;
  if (size && (kind === 'towel' || kind === 'phakhaoma' || kind === 'sarong' || kind === 'sheet')) return rect(size[0], size[1], kind === 'sheet' ? 0.09 : 0.04);
  const p = patternRaw(kind, r);
  p.key = kind + ':' + p.outline.length + ':' + p.outline.reduce((a, q) => a + q[0] * 7.1 + q[1] * 3.3, 0).toFixed(4);
  return p;
}
function patternRaw(kind: GarmentKind, r: (a: number, b: number) => number): Pattern {
  switch (kind) {
    case 'tshirt': return tshirt(r(0.46, 0.56), r(0.64, 0.74), r(0.17, 0.21));
    case 'shirt': return shirt(r(0.48, 0.56), r(0.7, 0.78));
    case 'singlet': return singlet(r(0.4, 0.48), r(0.6, 0.7));
    case 'vest': return vest(r(0.5, 0.56), r(0.62, 0.68));
    case 'jacket': return jacket(r(0.54, 0.6), r(0.64, 0.7));
    case 'shorts': return bottoms(r(0.36, 0.42), r(0.42, 0.5), r(0.24, 0.28), 0.03);
    case 'boxers': return bottoms(r(0.34, 0.4), r(0.3, 0.36), r(0.2, 0.24), 0.04);
    case 'pants': return bottoms(r(0.36, 0.42), r(0.92, 1.0), r(0.27, 0.31), 0.03);
    case 'towel': return rect(r(0.34, 0.42), r(0.62, 0.75), 0.04);
    case 'phakhaoma': return rect(r(0.38, 0.46), r(0.9, 1.15), 0.045);
    case 'sarong': return rect(r(0.85, 1.0), r(0.95, 1.05), 0.06);
    case 'sheet': return rect(r(1.2, 1.5), r(1.6, 1.9), 0.09);
    case 'socks': return sock();
  }
}

// ------------------------------------------------------------------ meshing

function inside(pt: Pt, poly: Pt[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1] + 1e-12) + a[0]) c = !c;
  }
  return c;
}
/** closest point on the outline + distance */
function closest(pt: Pt, poly: Pt[]): { p: Pt; d: number } {
  let best = 1e9, bx = pt[0], by = pt[1];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((pt[0] - a[0]) * ex + (pt[1] - a[1]) * ey) / (ex * ex + ey * ey + 1e-12)));
    const x = a[0] + ex * t, y = a[1] + ey * t;
    const d = Math.hypot(pt[0] - x, pt[1] - y);
    if (d < best) { best = d; bx = x; by = y; }
  }
  return { p: [bx, by], d: best };
}

const meshCache = new Map<string, GarmentMesh>();

/** Mesh a pattern (cached by kind + rng-derived size, so repeats share topology). */
export function meshGarment(kind: GarmentKind, pat: Pattern, key?: string): GarmentMesh {
  if (key && meshCache.has(key)) return meshCache.get(key)!;
  const P = pat.outline;
  const h = pat.step;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const p of P) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  const nx = Math.ceil((x1 - x0) / h) + 1, ny = Math.ceil((y1 - y0) / h) + 1;
  const ox = (x0 + x1) / 2 - ((nx - 1) * h) / 2, oy = (y0 + y1) / 2 - ((ny - 1) * h) / 2;
  const gid = (i: number, j: number) => j * nx + i;
  const isIn = new Uint8Array(nx * ny);
  const near = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const p: Pt = [ox + i * h, oy + j * h];
    const c = closest(p, P);
    const ins = inside(p, P);
    near[gid(i, j)] = ins ? c.d : -c.d;
    isIn[gid(i, j)] = ins || c.d < h * 0.42 ? 1 : 0;
  }
  // triangles from cells
  const triL: number[] = [];
  const cent = (a: number, b: number, c: number): Pt => [ox + (((a % nx) + (b % nx) + (c % nx)) * h) / 3, oy + ((Math.floor(a / nx) + Math.floor(b / nx) + Math.floor(c / nx)) * h) / 3];
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = gid(i, j), b = gid(i + 1, j), c = gid(i + 1, j + 1), d = gid(i, j + 1);
    const k = isIn[a] + isIn[b] + isIn[c] + isIn[d];
    const flip = (i + j) & 1;
    const tri = (p: number, q: number, r: number) => { if (inside(cent(p, q, r), P)) triL.push(p, q, r); };
    if (k === 4) { if (flip) { tri(a, b, c); tri(a, c, d); } else { tri(a, b, d); tri(b, c, d); } }
    else if (k === 3) {
      const q = [a, b, c, d].filter((v) => isIn[v]);
      tri(q[0], q[1], q[2]);
    }
  }
  // compact node list
  const remap = new Int32Array(nx * ny).fill(-1);
  const xyL: number[] = [], edL: number[] = [];
  for (const g of triL) if (remap[g] < 0) { remap[g] = xyL.length / 2; xyL.push(ox + (g % nx) * h, oy + Math.floor(g / nx) * h); edL.push(Math.max(0, near[g])); }
  const n = xyL.length / 2;
  const tris = new Uint32Array(triL.map((g) => remap[g]));
  // fix winding so all triangles face +z in pattern space
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    const cr = (xyL[b * 2] - xyL[a * 2]) * (xyL[c * 2 + 1] - xyL[a * 2 + 1]) - (xyL[b * 2 + 1] - xyL[a * 2 + 1]) * (xyL[c * 2] - xyL[a * 2]);
    if (cr < 0) { tris[t + 1] = c; tris[t + 2] = b; }
  }
  // border nodes: on an edge used by exactly one triangle → snap onto the outline
  const ec = new Map<number, number>();
  const ek = (a: number, b: number) => (a < b ? a * 65536 + b : b * 65536 + a);
  for (let t = 0; t < tris.length; t += 3) for (let e = 0; e < 3; e++) { const k = ek(tris[t + e], tris[t + ((e + 1) % 3)]); ec.set(k, (ec.get(k) ?? 0) + 1); }
  const border = new Uint8Array(n);
  for (const [k, c] of ec) if (c === 1) { border[Math.floor(k / 65536)] = 1; border[k % 65536] = 1; }
  const xy = new Float32Array(xyL);
  const edge = new Float32Array(edL);
  for (let i = 0; i < n; i++) {
    if (!border[i]) continue;
    const c = closest([xy[i * 2], xy[i * 2 + 1]], P);
    if (c.d < h * 0.8) { xy[i * 2] = c.p[0]; xy[i * 2 + 1] = c.p[1]; }
    edge[i] = 0;
  }
  // distance to edge for interior nodes: recompute after snapping (cheap, n is small)
  for (let i = 0; i < n; i++) if (!border[i]) edge[i] = closest([xy[i * 2], xy[i * 2 + 1]], P).d;
  const m: GarmentMesh = { kind, xy, n, tris, edge, w: x1 - x0, h: y1 - y0, x0, y0, pins: pat.pins, step: h };
  if (key) meshCache.set(key, m);
  return m;
}

/** index of the node nearest to a pattern point */
export function nearestNode(m: GarmentMesh, p: Pt): number {
  let best = 0, bd = 1e9;
  for (let i = 0; i < m.n; i++) {
    const d = (m.xy[i * 2] - p[0]) ** 2 + (m.xy[i * 2 + 1] - p[1]) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** nodes along the top edge (y within tol of the max y), sorted by x */
export function topRow(m: GarmentMesh, tol = 0.02): number[] {
  let ymax = -1e9;
  for (let i = 0; i < m.n; i++) ymax = Math.max(ymax, m.xy[i * 2 + 1]);
  const out: number[] = [];
  for (let i = 0; i < m.n; i++) if (m.xy[i * 2 + 1] > ymax - tol) out.push(i);
  return out.sort((a, b) => m.xy[a * 2] - m.xy[b * 2]);
}

/** nodes on a horizontal row nearest to y */
export function rowAt(m: GarmentMesh, y: number): number[] {
  let bestY = 0, bd = 1e9;
  for (let i = 0; i < m.n; i++) { const d = Math.abs(m.xy[i * 2 + 1] - y); if (d < bd) { bd = d; bestY = m.xy[i * 2 + 1]; } }
  const out: number[] = [];
  for (let i = 0; i < m.n; i++) if (Math.abs(m.xy[i * 2 + 1] - bestY) < m.step * 0.3) out.push(i);
  return out.sort((a, b) => m.xy[a * 2] - m.xy[b * 2]);
}
