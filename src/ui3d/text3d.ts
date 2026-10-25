import * as THREE from 'three';
import { ShapeUtils } from 'three';
import hbSrc from 'harfbuzzjs/hb.js?raw';
import hbjsSrc from 'harfbuzzjs/hbjs.js?raw';
import hbWasmUrl from 'harfbuzzjs/hb.wasm?url';
import { asset } from '../core/util';

/**
 * REAL 3D LETTERING. HarfBuzz (harfbuzzjs wasm) shapes the text (correct Thai mark stacking, GPOS/GSUB),
 * gives each glyph's outline; outlines become bevelled, extruded meshes (cached per font + glyph) that
 * are merged into ONE draw call per text and lit by the scene (PBR, casts shadows).
 *
 * Per-glyph animation (typewriter pop-in, vanish, wobble, shake) runs in the vertex shader from a
 * per-vertex attribute `aGlyph = (x, y, appearTime, vanishTime)` and one global clock uniform, so a
 * look's material is shared by every text that uses it.
 *
 *   const t = text3d('กะเพราหมูสับ', { font: 'talk', size: 0.05, color: 0xfff1d6 });
 *   scene.add(t); t.reveal = 0; … t.reveal++ (each glyph pops in)
 *
 * Faces are looped Thai only (ไทยมีหัว). TTF subsets live in public/assets/gen/text3d/.
 */
export type Font3D = 'talk' | 'heavy' | 'ui' | 'bubbly' | 'display' | 'hand' | 'news';

export interface Text3DAnim {
  /** pop-in duration per glyph, s (default 0.32) */
  pop?: number;
  /** how far (em) a glyph rises while popping in (default 0.35) */
  rise?: number;
  /** pop-in flip/spin amount (default 1) */
  spin?: number;
  /** vanish duration per glyph, s (default 0.28) */
  vanish?: number;
  /** vanish drift in em: + floats up, − sinks (default 0.5) */
  drift?: number;
  /** per-glyph idle wobble amplitude, em (thoughts) */
  wobble?: number;
  /** per-glyph jitter amplitude, em (shouts) */
  shake?: number;
}

export interface Text3DOpts {
  /** looped Thai faces only: talk=Krub (default), heavy=K2D, ui=IBM Plex Sans Thai Looped, bubbly=Kodchasan, display=Chonburi, hand=Itim, news=Taviraj */
  font?: Font3D;
  /** letter height in metres (height of a Thai consonant, default 0.12) */
  size?: number;
  /** extrusion depth, fraction of size (default 0.18) */
  depth?: number;
  /** bevel, fraction of size (default 0.04) */
  bevel?: number;
  /** face colour */
  color?: THREE.ColorRepresentation;
  /** extrusion/side colour (default darker face colour) */
  side?: THREE.ColorRepresentation;
  metalness?: number;
  roughness?: number;
  /** self-illumination as a fraction of the face colour (0..1+) */
  emissive?: number;
  align?: 'left' | 'center' | 'right';
  /** metres; Thai-aware wrapping (Intl.Segmenter word boundaries) */
  maxWidth?: number;
  /** baseline-to-baseline spacing as a multiple of the em (CSS-like, default 1.3) */
  lineHeight?: number;
  castShadow?: boolean;
  // ---- extras (optional) ----
  /** where the group origin sits vertically (default 'middle') */
  valign?: 'top' | 'middle' | 'bottom' | 'baseline';
  /** < 1 makes the letters translucent */
  opacity?: number;
  /** drawn on top of the world (depth squeezed to the near plane) but still self-occluding */
  xray?: boolean;
  /** fresnel rim light on bevels/sides: colour + strength */
  rim?: THREE.ColorRepresentation;
  rimStrength?: number;
  /** bevel takes the face colour instead of the side colour (default false = dark outline ring) */
  bevelFace?: boolean;
  anim?: Text3DAnim;
}

// ============================================================================ HarfBuzz + fonts

const FACE_FILE: Record<Font3D, string> = { talk: 'talk', heavy: 'heavy', ui: 'ui', bubbly: 'bubbly', display: 'display', hand: 'hand', news: 'news' };

interface GlyphOutline {
  /** per solid: contours (outer CW, holes CCW) as flat xy arrays + cap triangles (indices into the concatenation) */
  solids: { contours: Float32Array[]; tris: number[] }[];
  minX: number; minY: number; maxX: number; maxY: number;
}

interface GlyphGeo { pos: Float32Array; nor: Float32Array; idx: Uint32Array; vcount: number; cx: number; cy: number }

interface FontRec {
  key: Font3D;
  hb: any;
  upem: number;
  /** consonant (ก) height, em */
  xh: number;
  outlines: Map<number, GlyphOutline | null>;
  geos: Map<string, GlyphGeo | null>;
  widthCache: Map<string, number>;
}

let HB: any = null;
let hbPromise: Promise<any> | null = null;
const fonts = new Map<Font3D, FontRec>();
const fontPromises = new Map<Font3D, Promise<FontRec | null>>();

function loadHB(): Promise<any> {
  if (hbPromise) return hbPromise;
  hbPromise = (async () => {
    // hb.js / hbjs.js are CommonJS-ish emscripten files: evaluate them as plain scripts (no Vite dep pre-bundling).
    const createHarfBuzz = new Function('module', 'exports', 'define', `${hbSrc}\n;return createHarfBuzz;`)(undefined, undefined, undefined);
    const hbjs = new Function('module', `${hbjsSrc}\n;return hbjs;`)(undefined);
    const wasm = await (await fetch(hbWasmUrl)).arrayBuffer();
    const Module = await createHarfBuzz({ wasmBinary: wasm });
    HB = hbjs(Module);
    return HB;
  })();
  hbPromise.catch((e) => console.warn('[text3d] harfbuzz failed', e));
  return hbPromise;
}

function loadFont(key: Font3D): Promise<FontRec | null> {
  let p = fontPromises.get(key);
  if (p) return p;
  p = (async () => {
    try {
      const [hb, buf] = await Promise.all([loadHB(), fetch(asset(`gen/text3d/${FACE_FILE[key]}.ttf`)).then((r) => { if (!r.ok) throw new Error(r.status + ''); return r.arrayBuffer(); })]);
      const blob = hb.createBlob(buf);
      const face = hb.createFace(blob, 0);
      const font = hb.createFont(face);
      const rec: FontRec = { key, hb: font, upem: face.upem || 1000, xh: 0.5, outlines: new Map(), geos: new Map(), widthCache: new Map() };
      // consonant height from the outline of ก
      const g = shapeRaw(rec, 'ก')[0];
      const o = g ? outlineOf(rec, g.g) : null;
      if (o && o.maxY > 0.2) rec.xh = o.maxY;
      fonts.set(key, rec);
      return rec;
    } catch (e) {
      console.warn('[text3d] font failed', key, e);
      return null;
    }
  })();
  fontPromises.set(key, p);
  return p;
}

let preloadP: Promise<void> | null = null;
/** Load HarfBuzz + every 3D face (call early; text3d() works before it resolves and fills in later). */
export function preloadText3D(): Promise<void> {
  if (!preloadP) {
    preloadP = Promise.all((Object.keys(FACE_FILE) as Font3D[]).map(loadFont)).then(() => {
      // warm the glyph cache of the dialogue faces in idle time (first lines then pop without a hitch)
      const warm = [...'กขคงจฉชซญดตถทธนบปผพฟภมยรลวศสหอฮะาำิีึืุูเแโใไ่้๊๋็์ั'];
      const jobs: [Font3D, string][] = [];
      for (const f of ['talk', 'ui'] as Font3D[]) for (const ch of warm) jobs.push([f, ch]);
      const step = (dl?: { timeRemaining(): number }) => {
        const t0 = performance.now();
        while (jobs.length && (dl ? dl.timeRemaining() > 2 : performance.now() - t0 < 4)) {
          const [f, ch] = jobs.pop()!;
          const rec = fonts.get(f);
          if (rec) for (const g of shapeRaw(rec, ch)) outlineOf(rec, g.g);
        }
        if (jobs.length) idle(step);
      };
      idle(step);
    });
  }
  return preloadP;
}
const idle = (fn: (dl?: any) => void) => ((window as any).requestIdleCallback ? (window as any).requestIdleCallback(fn, { timeout: 500 }) : setTimeout(fn, 16));

interface HbGlyph { g: number; cl: number; ax: number; ay: number; dx: number; dy: number }

function shapeRaw(rec: FontRec, text: string): HbGlyph[] {
  const buf = HB.createBuffer();
  try {
    buf.addText(text);
    buf.guessSegmentProperties();
    HB.shape(rec.hb, buf);
    return buf.json();
  } finally {
    buf.destroy();
  }
}

// symbols the Thai faces lack → drawn procedurally
const SYNTH: Record<string, number> = { '♥': -1, '❤': -1, '★': -2, '☆': -2 };

function synthOutline(id: number): number[][] {
  const pts: number[] = [];
  if (id === -1) {
    for (let i = 0; i < 40; i++) {
      const t = (i / 40) * Math.PI * 2;
      const x = 16 * Math.sin(t) ** 3, y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      pts.push(0.4 + x * 0.022, 0.33 + y * 0.022);
    }
  } else {
    for (let i = 0; i < 10; i++) {
      const a = Math.PI / 2 + (i / 10) * Math.PI * 2, r = i % 2 ? 0.17 : 0.4;
      pts.push(0.42 + Math.cos(a) * r, 0.36 + Math.sin(a) * r);
    }
  }
  // make clockwise (solid)
  const out: number[] = [];
  for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i], pts[i + 1]);
  return [out];
}

// ============================================================================ outlines → contours → geometry

function area(c: ArrayLike<number>) {
  let a = 0;
  const n = c.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) a += c[j * 2] * c[i * 2 + 1] - c[i * 2] * c[j * 2 + 1];
  return a / 2;
}

function inside(x: number, y: number, c: ArrayLike<number>) {
  let r = false;
  const n = c.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = c[i * 2], yi = c[i * 2 + 1], xj = c[j * 2], yj = c[j * 2 + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) r = !r;
  }
  return r;
}

function reversed(c: number[]) {
  const o: number[] = [];
  for (let i = c.length - 2; i >= 0; i -= 2) o.push(c[i], c[i + 1]);
  return o;
}

/** SVG-ish path commands from HarfBuzz (font units, y up) → flat contours in em. Adaptive curve steps (≤ 4). */
function contoursFromCmds(cmds: { type: string; values: number[] }[], upem: number): number[][] {
  const inv = 1 / upem;
  const out: number[][] = [];
  let cur: number[] = [];
  let px = 0, py = 0;
  const add = (x: number, y: number) => {
    const n = cur.length;
    if (n && Math.abs(cur[n - 2] - x) < 2e-4 && Math.abs(cur[n - 1] - y) < 2e-4) return;
    cur.push(x, y);
  };
  const close = () => {
    if (cur.length >= 4) {
      const n = cur.length;
      if (Math.abs(cur[0] - cur[n - 2]) < 2e-4 && Math.abs(cur[1] - cur[n - 1]) < 2e-4) cur.length = n - 2;
      if (cur.length >= 6) out.push(cur);
    }
    cur = [];
  };
  for (const c of cmds) {
    const v = c.values.map((x) => x * inv);
    switch (c.type) {
      case 'M': close(); add(v[0], v[1]); px = v[0]; py = v[1]; break;
      case 'L': add(v[0], v[1]); px = v[0]; py = v[1]; break;
      case 'Q': {
        const len = Math.hypot(v[0] - px, v[1] - py) + Math.hypot(v[2] - v[0], v[3] - v[1]);
        const n = Math.max(1, Math.min(4, Math.ceil(len / 0.075)));
        for (let k = 1; k <= n; k++) {
          const t = k / n, u = 1 - t;
          add(u * u * px + 2 * u * t * v[0] + t * t * v[2], u * u * py + 2 * u * t * v[1] + t * t * v[3]);
        }
        px = v[2]; py = v[3];
        break;
      }
      case 'C': {
        const len = Math.hypot(v[0] - px, v[1] - py) + Math.hypot(v[2] - v[0], v[3] - v[1]) + Math.hypot(v[4] - v[2], v[5] - v[3]);
        const n = Math.max(2, Math.min(4, Math.ceil(len / 0.075)));
        for (let k = 1; k <= n; k++) {
          const t = k / n, u = 1 - t;
          add(u * u * u * px + 3 * u * u * t * v[0] + 3 * u * t * t * v[2] + t * t * t * v[4], u * u * u * py + 3 * u * u * t * v[1] + 3 * u * t * t * v[3] + t * t * t * v[5]);
        }
        px = v[4]; py = v[5];
        break;
      }
      case 'Z': close(); break;
    }
  }
  close();
  return out;
}

function outlineOf(rec: FontRec, gid: number): GlyphOutline | null {
  if (rec.outlines.has(gid)) return rec.outlines.get(gid)!;
  let raw: number[][];
  try {
    raw = gid < 0 ? synthOutline(gid) : contoursFromCmds(rec.hb.glyphToJson(gid), rec.upem);
  } catch (e) {
    raw = [];
  }
  const cs = raw.map((c) => ({ c, a: area(c) })).filter((x) => Math.abs(x.a) > 1e-6).sort((a, b) => Math.abs(b.a) - Math.abs(a.a));
  if (!cs.length) { rec.outlines.set(gid, null); return null; }
  // nesting depth by containment (robust to either winding convention)
  const depth: number[] = [];
  const parent: number[] = [];
  for (let i = 0; i < cs.length; i++) {
    let d = 0, par = -1;
    const x = cs[i].c[0], y = cs[i].c[1];
    for (let j = 0; j < i; j++) if (inside(x, y, cs[j].c)) { d++; par = j; }
    depth.push(d); parent.push(par);
  }
  const solids: { contours: Float32Array[]; tris: number[] }[] = [];
  const solidOf = new Map<number, number>();
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (let i = 0; i < cs.length; i++) {
    let c = cs[i].c;
    for (let k = 0; k < c.length; k += 2) { minX = Math.min(minX, c[k]); maxX = Math.max(maxX, c[k]); minY = Math.min(minY, c[k + 1]); maxY = Math.max(maxY, c[k + 1]); }
    if (depth[i] % 2 === 0) {
      if (cs[i].a > 0) c = reversed(c); // solids clockwise
      solidOf.set(i, solids.length);
      solids.push({ contours: [new Float32Array(c)], tris: [] });
    } else {
      // hole: attach to its nearest solid ancestor
      let p = parent[i];
      while (p >= 0 && depth[p] % 2 === 1) p = parent[p];
      const si = solidOf.get(p);
      if (si === undefined) continue;
      if (cs[i].a < 0) c = reversed(c); // holes counter-clockwise
      solids[si].contours.push(new Float32Array(c));
    }
  }
  for (const s of solids) {
    const toV = (c: Float32Array) => { const a: THREE.Vector2[] = []; for (let k = 0; k < c.length; k += 2) a.push(new THREE.Vector2(c[k], c[k + 1])); return a; };
    try {
      const faces = ShapeUtils.triangulateShape(toV(s.contours[0]), s.contours.slice(1).map(toV));
      const all: number[] = [];
      for (const c of s.contours) for (let k = 0; k < c.length; k++) all.push(c[k]);
      for (const f of faces) {
        let [a, b, c] = f;
        const cross = (all[b * 2] - all[a * 2]) * (all[c * 2 + 1] - all[a * 2 + 1]) - (all[b * 2 + 1] - all[a * 2 + 1]) * (all[c * 2] - all[a * 2]);
        if (cross < 0) { const t = b; b = c; c = t; }
        s.tris.push(a, b, c);
      }
    } catch { /* degenerate glyph: sides only */ }
  }
  const o: GlyphOutline = { solids, minX, minY, maxX, maxY };
  rec.outlines.set(gid, o);
  return o;
}

/**
 * Bevelled extrusion, front-facing only (front cap + chamfer + side wall; back stays open — the text always
 * faces the camera, the shadow pass renders double-sided). Smooth normals on curves, split on corners.
 */
function glyphGeo(rec: FontRec, gid: number, depth: number, bevel: number): GlyphGeo | null {
  const key = `${gid}|${depth.toFixed(4)}|${bevel.toFixed(4)}`;
  if (rec.geos.has(key)) return rec.geos.get(key)!;
  const o = outlineOf(rec, gid);
  if (!o) { rec.geos.set(key, null); return null; }
  const cx = (o.minX + o.maxX) / 2, cy = (o.minY + o.maxY) / 2;
  const bi = bevel * 0.3, bo = bevel * 0.7, bt = bevel;
  const hasBevel = bevel > 1e-5;
  const P: number[] = [], N: number[] = [], I: number[] = [];
  const COS_SHARP = Math.cos((38 * Math.PI) / 180);
  for (const s of o.solids) {
    // per-point miter data for every contour of this solid
    const data = s.contours.map((c) => {
      const n = c.length / 2;
      const en = new Float32Array(n * 2); // edge i→i+1 outward normal
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        let dx = c[j * 2] - c[i * 2], dy = c[j * 2 + 1] - c[i * 2 + 1];
        const l = Math.hypot(dx, dy) || 1;
        dx /= l; dy /= l;
        en[i * 2] = -dy; en[i * 2 + 1] = dx;
      }
      const mv = new Float32Array(n * 2); // miter vector (direction × length)
      const vn = new Float32Array(n * 2); // smooth vertex normal
      const sharp = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const h = (i + n - 1) % n;
        const ax = en[h * 2], ay = en[h * 2 + 1], bx = en[i * 2], by = en[i * 2 + 1];
        let mx = ax + bx, my = ay + by;
        const ml = Math.hypot(mx, my);
        if (ml < 1e-4) { mx = bx; my = by; } else { mx /= ml; my /= ml; }
        const cosHalf = Math.max(0.4, mx * bx + my * by);
        const len = Math.min(2.2, 1 / cosHalf);
        mv[i * 2] = mx * len; mv[i * 2 + 1] = my * len;
        vn[i * 2] = mx; vn[i * 2 + 1] = my;
        sharp[i] = ax * bx + ay * by < COS_SHARP ? 1 : 0;
      }
      return { c, n, en, mv, vn, sharp };
    });
    // front cap (inset by bi), z = 0
    const capBase = P.length / 3;
    for (const d of data) for (let i = 0; i < d.n; i++) {
      P.push(d.c[i * 2] - d.mv[i * 2] * bi - cx, d.c[i * 2 + 1] - d.mv[i * 2 + 1] * bi - cy, 0);
      N.push(0, 0, 1);
    }
    for (const t of s.tris) I.push(capBase + t);
    // bands: [offset, z] rings; normal kind: 0 = chamfer, 1 = wall
    const rings: [number, number, number, number, number][] = hasBevel
      ? [[-bi, 0, bo, -bt, 0], [bo, -bt, bo, -depth, 1]]
      : [[0, 0, 0, -depth, 1]];
    const nz = bi + bo, nl = Math.hypot(bt, nz) || 1;
    for (const [oa, za, ob, zb, kind] of rings) {
      for (const d of data) {
        const { c, n, en, mv, vn, sharp } = d;
        const aIn = new Int32Array(n), aOut = new Int32Array(n), bIn = new Int32Array(n), bOut = new Int32Array(n);
        const vert = (i: number, off: number, z: number, nx: number, ny: number) => {
          P.push(c[i * 2] + mv[i * 2] * off - cx, c[i * 2 + 1] + mv[i * 2 + 1] * off - cy, z);
          if (kind === 0) N.push((nx * bt) / nl, (ny * bt) / nl, nz / nl);
          else N.push(nx, ny, 0);
          return P.length / 3 - 1;
        };
        for (let i = 0; i < n; i++) {
          const h = (i + n - 1) % n;
          if (sharp[i]) {
            aIn[i] = vert(i, oa, za, en[h * 2], en[h * 2 + 1]); bIn[i] = vert(i, ob, zb, en[h * 2], en[h * 2 + 1]);
            aOut[i] = vert(i, oa, za, en[i * 2], en[i * 2 + 1]); bOut[i] = vert(i, ob, zb, en[i * 2], en[i * 2 + 1]);
          } else {
            aIn[i] = aOut[i] = vert(i, oa, za, vn[i * 2], vn[i * 2 + 1]);
            bIn[i] = bOut[i] = vert(i, ob, zb, vn[i * 2], vn[i * 2 + 1]);
          }
        }
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          I.push(aOut[i], aIn[j], bIn[j], aOut[i], bIn[j], bOut[i]);
        }
      }
    }
  }
  const g: GlyphGeo = { pos: new Float32Array(P), nor: new Float32Array(N), idx: new Uint32Array(I), vcount: P.length / 3, cx, cy };
  rec.geos.set(key, g);
  return g;
}

// ============================================================================ layout

const segWord: any = (Intl as any).Segmenter ? new (Intl as any).Segmenter('th', { granularity: 'word' }) : null;
const segGraph: any = (Intl as any).Segmenter ? new (Intl as any).Segmenter('th', { granularity: 'grapheme' }) : null;

function advanceOf(rec: FontRec, s: string): number {
  let w = rec.widthCache.get(s);
  if (w === undefined) {
    w = 0;
    for (const g of shapeRaw(rec, s)) w += g.ax;
    w /= rec.upem;
    if (rec.widthCache.size > 4000) rec.widthCache.clear();
    rec.widthCache.set(s, w);
  }
  return w;
}

function wrapLines(rec: FontRec, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (!maxW || advanceOf(rec, para) <= maxW) { out.push(para.trim()); continue; }
    const words: string[] = segWord ? [...segWord.segment(para)].map((s: any) => s.segment) : para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const test = line + w;
      if (line.trim() && advanceOf(rec, test.trimEnd()) > maxW) {
        out.push(line.trim());
        line = w.trimStart();
        while (line.length > 1 && advanceOf(rec, line) > maxW) {
          const gs: string[] = segGraph ? [...segGraph.segment(line)].map((s: any) => s.segment) : [...line];
          let cut = gs.length - 1;
          while (cut > 1 && advanceOf(rec, gs.slice(0, cut).join('')) > maxW) cut--;
          out.push(gs.slice(0, cut).join(''));
          line = gs.slice(cut).join('');
        }
      } else line = test;
    }
    if (line.trim()) out.push(line.trim());
  }
  return out;
}

interface Placed { gid: number; x: number; y: number }

function layoutText(rec: FontRec, text: string, o: { maxW: number; align: string; lineH: number; valign: string }) {
  const lines = wrapLines(rec, text, o.maxW);
  const placed: Placed[] = [];
  const ascent = rec.xh * 1.75, descent = rec.xh * 0.55;
  let maxW = 0;
  const lineData: { gs: Placed[]; w: number }[] = [];
  lines.forEach((ln, li) => {
    const gs: Placed[] = [];
    let pen = 0;
    const y0 = -li * o.lineH;
    if (ln) {
      const shaped = shapeRaw(rec, ln);
      for (const g of shaped) {
        let gid = g.g, ax = g.ax / rec.upem;
        if (gid === 0) {
          const ch = ln.slice(g.cl, g.cl + 1);
          if (SYNTH[ch] !== undefined) { gid = SYNTH[ch]; ax = 0.85; } else gid = -999;
        }
        if (gid !== -999) gs.push({ gid, x: pen + g.dx / rec.upem, y: y0 + g.dy / rec.upem });
        pen += ax;
      }
    }
    lineData.push({ gs, w: pen });
    maxW = Math.max(maxW, pen);
  });
  const n = Math.max(1, lines.length);
  const top = ascent, bottom = -(n - 1) * o.lineH - descent;
  const yShift = o.valign === 'top' ? -top : o.valign === 'bottom' ? -bottom : o.valign === 'baseline' ? 0 : -(top + bottom) / 2;
  for (const L of lineData) {
    const xShift = o.align === 'left' ? 0 : o.align === 'right' ? -L.w : -L.w / 2;
    for (const g of L.gs) placed.push({ gid: g.gid, x: g.x + xShift, y: g.y + yShift });
  }
  const x0 = o.align === 'left' ? 0 : o.align === 'right' ? -maxW : -maxW / 2;
  return { placed, width: maxW, height: top - bottom, box: new THREE.Box3(new THREE.Vector3(x0, bottom + yShift, -1), new THREE.Vector3(x0 + maxW, top + yShift, 0.2)) };
}

// ============================================================================ materials (one per look, shared)

const T0 = performance.now();
/** the clock every glyph animation runs on (seconds) */
export function text3dNow() { return (performance.now() - T0) / 1000; }
const U_TIME = { value: 0 };
const HIDDEN = 1e6, SHOWN = -1e6;

const VERT_HEAD = /* glsl */ `
attribute vec4 aGlyph;
uniform float uT3dTime;
uniform vec4 uT3dA;   // pop, vanish, wobble, shake
uniform vec4 uT3dB;   // rise, drift, spin, -
varying float vT3dFace;
mat3 t3dR; float t3dS; vec3 t3dO;
float t3dBack(float t){ float s = 2.2; t -= 1.0; return 1.0 + (s + 1.0) * t * t * t + s * t * t; }
void t3dSetup(){
  float seed = fract(sin(aGlyph.x * 12.9898 + aGlyph.y * 78.233) * 43758.5453);
  float ka = clamp((uT3dTime - aGlyph.z) / uT3dA.x, 0.0, 1.0);
  float kv = clamp((uT3dTime - aGlyph.w) / uT3dA.y, 0.0, 1.0);
  float pa = 1.0 - ka;
  float sv = kv * kv * (3.0 - 2.0 * kv);
  t3dS = max(0.0, ka >= 1.0 ? 1.0 : t3dBack(ka)) * (1.0 - sv);
  float az = (seed - 0.5) * 1.3 * pa * pa * uT3dB.z + (seed - 0.5) * 1.6 * sv;
  float ax = -1.25 * pa * pa * uT3dB.z;
  float t = uT3dTime;
  vec3 off = vec3((seed - 0.5) * 0.4 * sv, -uT3dB.x * pa * pa + uT3dB.y * sv, 0.0);
  if (uT3dA.z > 0.0) {
    off.y += sin(t * 2.1 + aGlyph.x * 2.3) * uT3dA.z;
    off.x += cos(t * 1.7 + aGlyph.x * 1.9) * uT3dA.z * 0.35;
    az += sin(t * 1.6 + aGlyph.x * 1.7) * uT3dA.z * 1.4;
  }
  if (uT3dA.w > 0.0) {
    off.x += sin(t * 47.0 + seed * 40.0) * uT3dA.w;
    off.y += cos(t * 53.0 + seed * 31.0) * uT3dA.w;
    az += sin(t * 39.0 + seed * 17.0) * uT3dA.w * 1.6;
  }
  float cz = cos(az), sz = sin(az), cx = cos(ax), sx = sin(ax);
  mat3 rz = mat3(cz, sz, 0.0, -sz, cz, 0.0, 0.0, 0.0, 1.0);
  mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, cx, sx, 0.0, -sx, cx);
  t3dR = rz * rx;
  t3dO = off;
}
`;

function patchVert(src: string, lit: boolean, xray: boolean) {
  let s = VERT_HEAD + src;
  if (lit) {
    s = s.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      t3dSetup(); vT3dFace = smoothstep(0.9, 0.98, objectNormal.z); objectNormal = t3dR * objectNormal;`);
    s = s.replace('#include <begin_vertex>', `#include <begin_vertex>
      transformed = vec3(aGlyph.xy, 0.0) + t3dR * (transformed * t3dS) + t3dO;`);
  } else {
    s = s.replace('#include <begin_vertex>', `t3dSetup();
      #include <begin_vertex>
      transformed = vec3(aGlyph.xy, 0.0) + t3dR * (transformed * t3dS) + t3dO;`);
  }
  if (xray) s = s.replace('#include <project_vertex>', `#include <project_vertex>
      gl_Position.z = (gl_Position.z / gl_Position.w * 0.02 - 0.98) * gl_Position.w;`);
  return s;
}

function patchFrag(src: string) {
  return `uniform vec3 uT3dSide; uniform vec4 uT3dRim; varying float vT3dFace;\n` + src
    .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( mix( uT3dSide, diffuse, vT3dFace ), opacity );')
    .replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive * mix( 0.3, 1.0, vT3dFace );')
    .replace('#include <opaque_fragment>', `outgoingLight += uT3dRim.rgb * uT3dRim.a * pow( 1.0 - clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 ), 2.0 );
      #include <opaque_fragment>`);
}

interface LookMats { mat: THREE.MeshStandardMaterial; depth: THREE.MeshDepthMaterial; dist: THREE.MeshDistanceMaterial }
const looks = new Map<string, LookMats>();

interface LookKey {
  color: number; side: number; metal: number; rough: number; emis: number; opacity: number; xray: boolean;
  rim: number; rimS: number; bevelFace: boolean; a: number[]; b: number[];
}

function lookOf(k: LookKey): LookMats {
  const key = JSON.stringify(k);
  let L = looks.get(key);
  if (L) return L;
  const face = new THREE.Color(k.color);
  const mat = new THREE.MeshStandardMaterial({
    color: face, metalness: k.metal, roughness: k.rough,
    emissive: face.clone().multiplyScalar(k.emis),
    transparent: k.opacity < 1, opacity: k.opacity, depthWrite: true,
  });
  mat.shadowSide = THREE.DoubleSide;
  const uni = {
    uT3dTime: U_TIME,
    uT3dA: { value: new THREE.Vector4(...k.a) },
    uT3dB: { value: new THREE.Vector4(...k.b) },
    uT3dSide: { value: new THREE.Color(k.side) },
    uT3dRim: { value: new THREE.Vector4(...new THREE.Color(k.rim).toArray(), k.rimS) },
  };
  const xray = k.xray;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = patchVert(sh.vertexShader, true, xray);
    sh.fragmentShader = patchFrag(sh.fragmentShader);
    if (k.bevelFace) sh.vertexShader = sh.vertexShader.replace('smoothstep(0.9, 0.98, objectNormal.z)', 'smoothstep(0.08, 0.3, objectNormal.z)');
  };
  mat.customProgramCacheKey = () => `t3d${xray ? 'x' : ''}${k.bevelFace ? 'b' : ''}`;
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (sh) => { Object.assign(sh.uniforms, uni); sh.vertexShader = patchVert(sh.vertexShader, false, false); };
  depth.customProgramCacheKey = () => 't3dDepth';
  const dist = new THREE.MeshDistanceMaterial();
  dist.onBeforeCompile = (sh) => { Object.assign(sh.uniforms, uni); sh.vertexShader = patchVert(sh.vertexShader, false, false); };
  dist.customProgramCacheKey = () => 't3dDist';
  L = { mat, depth, dist };
  looks.set(key, L);
  return L;
}

// ============================================================================ Text3D

const DEF = { font: 'talk' as Font3D, size: 0.12, depth: 0.18, bevel: 0.04, metalness: 0.05, roughness: 0.42, emissive: 0.12, lineHeight: 1.3 };

function colorNum(c: THREE.ColorRepresentation | undefined, def: number) {
  if (c === undefined || c === null) return def;
  return new THREE.Color(c as any).getHex();
}

export class Text3D extends THREE.Group {
  readonly mesh: THREE.Mesh;
  readonly ready: Promise<void>;
  private o: Text3DOpts;
  private text: string;
  private rec: FontRec | null = null;
  private _w = 0;
  private _h = 0;
  private _count = 0;
  private _reveal = Infinity;
  private shown = 0;
  private ranges: Int32Array = new Int32Array(1);
  private ag: THREE.BufferAttribute | null = null;
  private pendingPop = -1;
  private vanishing = false;
  private disposed = false;

  constructor(text: string, o: Text3DOpts = {}) {
    super();
    this.o = { ...o };
    this.text = text ?? '';
    this.name = 'text3d';
    const geo = new THREE.BufferGeometry();
    this.mesh = new THREE.Mesh(geo, this.look().mat);
    this.mesh.onBeforeRender = () => { U_TIME.value = text3dNow(); };
    this.applyLook();
    this.add(this.mesh);
    this.ready = loadFont(this.o.font ?? DEF.font).then((rec) => {
      if (!rec && (this.o.font ?? DEF.font) !== 'ui') return loadFont('ui');
      return rec;
    }).then((rec) => {
      if (this.disposed || !rec) return;
      this.rec = rec;
      this.build();
    });
  }

  get width() { return this._w; }
  get height() { return this._h; }
  get glyphCount() { return this._count; }
  /** the font is loaded and the geometry built */
  get isReady() { return !!this.rec; }

  /** glyphs shown (typewriter; each newly shown glyph pops in). Infinity = all, instantly. */
  get reveal() { return this._reveal; }
  set reveal(v: number) {
    this._reveal = v;
    if (!this.ag) return;
    const target = Math.max(0, Math.min(this._count, Math.floor(v)));
    if (target === this.shown) return;
    const now = text3dNow();
    U_TIME.value = now;
    if (target > this.shown) for (let i = this.shown; i < target; i++) this.setTime(i, 2, now);
    else for (let i = target; i < this.shown; i++) this.setTime(i, 2, HIDDEN);
    this.shown = target;
  }

  /** (re)play the pop-in of every glyph, `stagger` seconds apart */
  popIn(stagger = 0.03) {
    this._reveal = Infinity;
    if (!this.ag) { this.pendingPop = stagger; return; }
    const now = text3dNow();
    U_TIME.value = now;
    for (let i = 0; i < this._count; i++) this.setTime(i, 2, now + i * stagger, false);
    this.shown = this._count;
    this.ag.needsUpdate = true;
    this.ag.clearUpdateRanges();
  }

  /** pop every glyph out (staggered); returns seconds until fully gone */
  vanish(stagger = 0.012): number {
    this.vanishing = true;
    const dur = (this.o.anim?.vanish ?? 0.28);
    if (!this.ag) return 0;
    const now = text3dNow();
    U_TIME.value = now;
    for (let i = 0; i < this._count; i++) this.setTime(i, 3, now + i * stagger, false);
    this.ag.needsUpdate = true;
    this.ag.clearUpdateRanges();
    return this._count * stagger + dur;
  }

  setText(text: string) {
    text = text ?? '';
    if (text === this.text) return;
    this.text = text;
    if (this.rec) this.build();
  }

  /** change colours / material look without relayout (materials are cached per look) */
  setLook(o: Partial<Text3DOpts>) {
    Object.assign(this.o, o);
    this.applyLook();
  }

  dispose() {
    this.disposed = true;
    this.removeFromParent();
    this.mesh.geometry.dispose();
  }

  // ---------------------------------------------------------------- internals
  private look(): LookMats {
    const o = this.o;
    const color = colorNum(o.color, 0xfff3dc);
    const sideDef = new THREE.Color(color).multiplyScalar(0.42).getHex();
    const a = o.anim ?? {};
    return lookOf({
      color, side: colorNum(o.side, sideDef), metal: o.metalness ?? DEF.metalness, rough: o.roughness ?? DEF.roughness,
      emis: o.emissive ?? DEF.emissive, opacity: o.opacity ?? 1, xray: !!o.xray, rim: colorNum(o.rim, 0xffffff), rimS: o.rimStrength ?? 0,
      bevelFace: !!o.bevelFace,
      a: [a.pop ?? 0.32, a.vanish ?? 0.28, a.wobble ?? 0, a.shake ?? 0],
      b: [a.rise ?? 0.35, a.drift ?? 0.5, a.spin ?? 1, 0],
    });
  }

  private applyLook() {
    const L = this.look();
    this.mesh.material = L.mat;
    this.mesh.customDepthMaterial = L.depth;
    this.mesh.customDistanceMaterial = L.dist;
    this.mesh.castShadow = this.o.castShadow ?? !this.o.xray;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = this.o.xray ? 1001 : 0;
  }

  private setTime(i: number, comp: 2 | 3, t: number, upload = true) {
    const a = this.ag!;
    const arr = a.array as Float32Array;
    const v0 = this.ranges[i], v1 = this.ranges[i + 1];
    for (let v = v0; v < v1; v++) arr[v * 4 + comp] = t;
    if (upload) { a.addUpdateRange(v0 * 4, (v1 - v0) * 4); a.needsUpdate = true; }
  }

  private build() {
    const rec = this.rec!;
    const o = this.o;
    const size = o.size ?? DEF.size;
    const em = size / rec.xh; // metres per em
    const depthEm = ((o.depth ?? DEF.depth) * size) / em;
    const bevelEm = Math.min(((o.bevel ?? DEF.bevel) * size) / em, depthEm * 0.6);
    const lay = layoutText(rec, this.text, {
      maxW: o.maxWidth ? o.maxWidth / em : 0, align: o.align ?? 'center', lineH: o.lineHeight ?? DEF.lineHeight, valign: o.valign ?? 'middle',
    });
    const parts: { g: GlyphGeo; x: number; y: number }[] = [];
    let vt = 0, it = 0;
    for (const p of lay.placed) {
      const g = glyphGeo(rec, p.gid, depthEm, bevelEm);
      if (!g || !g.vcount) continue;
      parts.push({ g, x: p.x + g.cx, y: p.y + g.cy });
      vt += g.vcount; it += g.idx.length;
    }
    const pos = new Float32Array(vt * 3), nor = new Float32Array(vt * 3), ag = new Float32Array(vt * 4);
    const idx = vt > 65535 ? new Uint32Array(it) : new Uint16Array(it);
    const ranges = new Int32Array(parts.length + 1);
    const showN = Math.min(parts.length, Math.floor(this._reveal));
    const pop = this.pendingPop;
    const now = text3dNow();
    let v = 0, ii = 0;
    parts.forEach((p, k) => {
      ranges[k] = v;
      pos.set(p.g.pos, v * 3);
      nor.set(p.g.nor, v * 3);
      const appear = pop >= 0 ? now + k * pop : k < showN ? SHOWN : HIDDEN;
      const vanish = this.vanishing ? now : HIDDEN;
      for (let q = 0; q < p.g.vcount; q++) { const b = (v + q) * 4; ag[b] = p.x; ag[b + 1] = p.y; ag[b + 2] = appear; ag[b + 3] = vanish; }
      const src = p.g.idx;
      for (let q = 0; q < src.length; q++) idx[ii + q] = src[q] + v;
      v += p.g.vcount; ii += src.length;
    });
    ranges[parts.length] = v;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    const agAttr = new THREE.BufferAttribute(ag, 4);
    agAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aGlyph', agAttr);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const box = lay.box.clone();
    box.min.z = -depthEm - 0.5; box.max.z = 0.5;
    box.expandByScalar(0.6);
    geo.boundingBox = box;
    geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    this.mesh.geometry.dispose();
    this.mesh.geometry = geo;
    this.mesh.scale.setScalar(em);
    this.ag = agAttr;
    this.ranges = ranges;
    this._count = parts.length;
    this.shown = pop >= 0 ? parts.length : showN;
    this.pendingPop = -1;
    this._w = lay.width * em;
    this._h = lay.height * em;
  }
}

/** Sync: returns a Text3D right away; its geometry fills in when the font is loaded (`await t.ready`). */
export function text3d(text: string, o?: Text3DOpts): Text3D {
  return new Text3D(text, o);
}
