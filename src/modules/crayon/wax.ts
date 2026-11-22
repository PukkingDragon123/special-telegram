import { F } from '../../core/fonts';

/* ============================================================================================
 * Wax-crayon rendering on 2D canvases (transparent background):
 *   crayonText(canvas, text, o)  hand-scrawled lettering: per-letter jitter (tilt, size, baseline,
 *                                spacing), lines that slope, two overlapping passes, a slow wobble
 *                                warp, rough edges and wax grain that skips on the surface texture.
 *   CrayonBrush                  freehand strokes (graffiti): a soft core line + wax specks, eroded by
 *                                the same grain so it reads as crayon, not a vector line.
 * Deterministic for a given seed, so every peer draws the same thing.
 * ========================================================================================== */

export function rng(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0) / 4294967296);
}
export function hashStr(s: string) { let x = 2166136261; for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619); return x >>> 0; }

const hash2 = (x: number, y: number, s: number) => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
/** smooth value noise in [0,1] */
function vnoise(x: number, y: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** a tileable-ish grain field (alpha = where the wax does NOT stick), cached per size */
let grainC: HTMLCanvasElement | null = null;
function grain(): HTMLCanvasElement {
  if (grainC) return grainC;
  const S = 256;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d')!;
  const im = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = vnoise(x / 3.2, y / 2.4, 7) * 0.55 + hash2(x, y, 3) * 0.45 + Math.max(0, Math.sin(y * 0.55 + vnoise(x / 30, 0, 9) * 3)) * 0.18;
    const a = Math.max(0, Math.min(1, (n - 0.62) * 3.2));
    const i = (y * S + x) * 4;
    im.data[i] = im.data[i + 1] = im.data[i + 2] = 0; im.data[i + 3] = Math.round(a * 255);
  }
  g.putImageData(im, 0, 0);
  return (grainC = c);
}

function rgbOf(col: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(col.trim());
  const v = m ? parseInt(m[1], 16) : 0x222222;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** split into user-perceived characters (Thai vowels / tone marks stay on their consonant) */
function graphemes(s: string): string[] {
  const Seg = (Intl as any).Segmenter;
  if (Seg) return [...new Seg('th', { granularity: 'grapheme' }).segment(s)].map((x: any) => x.segment);
  return [...s];
}
/** wrap units: words (Thai has no spaces, so the segmenter's word boundaries) */
function words(s: string): string[] {
  const Seg = (Intl as any).Segmenter;
  if (Seg) return [...new Seg('th', { granularity: 'word' }).segment(s)].map((x: any) => x.segment);
  return s.split(/(\s+)/);
}

export interface CrayonTextOpts {
  color: string;
  seed: number;
  /** padding (fraction of the shorter side) */
  pad?: number;
  /** max lines */
  maxLines?: number;
  /** biggest letter size (px) */
  maxSize?: number;
  /** stroke weight 400–800 */
  weight?: number;
}

/** Draw hand-scrawled crayon lettering filling the canvas (cleared first). */
export function crayonText(c: HTMLCanvasElement, text: string, o: CrayonTextOpts) {
  const W = c.width, H = c.height;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.clearRect(0, 0, W, H);
  text = text.replace(/\s+/g, ' ').trim();
  if (!text) return;
  const r = rng(o.seed);
  const pad = Math.min(W, H) * (o.pad ?? 0.08);
  const wt = o.weight ?? 600;
  const font = (px: number) => `${wt} ${px}px ${F.ui}, sans-serif`;
  // ---- layout: biggest size whose word-wrap fits
  const ws = words(text);
  let size = Math.min(o.maxSize ?? H * 0.42, H * 0.6);
  let lines: string[] = [];
  for (let it = 0; it < 28; it++) {
    g.font = font(size);
    lines = [];
    let cur = '';
    for (const w of ws) {
      const t = cur + w;
      if (cur && g.measureText(t.trim()).width * 1.08 > W - pad * 2) { lines.push(cur.trim()); cur = w.trimStart(); }
      else cur = t;
    }
    if (cur.trim()) lines.push(cur.trim());
    const tooWide = lines.some((l) => g.measureText(l).width * 1.08 > W - pad * 2);
    if (!tooWide && lines.length * size * 1.25 <= H - pad * 2 && lines.length <= (o.maxLines ?? 6)) break;
    size *= 0.9;
  }
  // ---- mask: letters with hand jitter, two passes (went over it twice)
  const m = document.createElement('canvas'); m.width = W; m.height = H;
  const mg = m.getContext('2d', { willReadFrequently: true })!;
  mg.fillStyle = '#fff';
  mg.textBaseline = 'alphabetic';
  const lineH = size * 1.22;
  const top = (H - lines.length * lineH) / 2 + size * 0.95;
  for (let pass = 0; pass < 2; pass++) {
    const pr = rng(o.seed * 7 + 1);   // same layout both passes
    mg.globalAlpha = pass ? 0.75 : 1;
    lines.forEach((line, li) => {
      mg.font = font(size);
      const lw = mg.measureText(line).width * 1.04;
      let x = (W - lw) / 2 + (pr() - 0.5) * size * 0.5;
      const y0 = top + li * lineH + (pr() - 0.5) * size * 0.12;
      const slope = (pr() - 0.5) * 0.1;
      for (const ch of graphemes(line)) {
        const s = 1 + (pr() - 0.5) * 0.24;
        const rot = (pr() - 0.5) * 0.3;
        const jy = (pr() - 0.5) * size * 0.12;
        const cw = mg.measureText(ch).width;
        mg.save();
        mg.translate(x + (pass ? (r() - 0.5) * size * 0.035 : 0), y0 + (x - W / 2) * slope + jy + (pass ? (r() - 0.5) * size * 0.035 : 0));
        mg.rotate(rot + (pass ? (r() - 0.5) * 0.04 : 0));
        mg.scale(s, s * (1 + (pr() - 0.5) * 0.08));
        mg.font = font(size);
        mg.fillText(ch, 0, 0);
        mg.restore();
        x += cw * (1 + (pr() - 0.3) * 0.09) * s;
      }
    });
  }
  // ---- warp + rough edges + wax grain + pressure → coloured pixels
  const src = mg.getImageData(0, 0, W, H).data;
  const out = g.createImageData(W, H);
  const d = out.data;
  const [cr, cg, cb] = rgbOf(o.color);
  const amp = size * 0.03, fq = 1 / (size * 0.45);
  const sd = o.seed & 0xffff;
  // slow wobble displacement on a coarse grid (bilinear per pixel: cheap)
  const ST = 8, GW = Math.ceil(W / ST) + 2, GH = Math.ceil(H / ST) + 2;
  const gx = new Float32Array(GW * GH), gy = new Float32Array(GW * GH);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    gx[j * GW + i] = (vnoise(i * ST * fq, j * ST * fq, sd) - 0.5) * amp * 2;
    gy[j * GW + i] = (vnoise(i * ST * fq + 31.7, j * ST * fq + 11.3, sd) - 0.5) * amp * 2;
  }
  for (let y = 0; y < H; y++) {
    const fy = y / ST, j0 = Math.floor(fy), ty = fy - j0;
    for (let x = 0; x < W; x++) {
      const fx = x / ST, i0 = Math.floor(fx), tx = fx - i0;
      const k = j0 * GW + i0;
      const dx = (gx[k] * (1 - tx) + gx[k + 1] * tx) * (1 - ty) + (gx[k + GW] * (1 - tx) + gx[k + GW + 1] * tx) * ty;
      const dy = (gy[k] * (1 - tx) + gy[k + 1] * tx) * (1 - ty) + (gy[k + GW] * (1 - tx) + gy[k + GW + 1] * tx) * ty;
      const sx = Math.min(W - 1, Math.max(0, Math.round(x + dx)));
      const sy = Math.min(H - 1, Math.max(0, Math.round(y + dy)));
      const a0 = src[(sy * W + sx) * 4 + 3] / 255;
      if (a0 < 0.02) continue;
      // rough edge: noisy threshold; wax skips where the surface grain is high; pressure drifts slowly
      const edge = Math.max(0, Math.min(1, (a0 - 0.45 + (vnoise(x / 1.7, y / 1.7, 11) - 0.5) * 0.7 + (hash2(x, y, 13) - 0.5) * 0.3) * 3));
      // wax grain: fine speckle + the stroke direction of the crayon (diagonal hatching) + the board's flutes
      const gr = vnoise(x / 1.9, y / 1.4, 5) * 0.5 + hash2(x, y, 17) * 0.35;
      const hatch = (Math.sin((x * 0.78 + y * 0.62) * 0.9 + vnoise(x / 9, y / 9, 4) * 5) * 0.5 + 0.5) * 0.28;
      const corr = Math.max(0, Math.sin(y * 0.42 + vnoise(x / 40, y / 90, 2) * 4)) * 0.2;
      const skip = Math.max(0, Math.min(1, (gr + hatch + corr - 0.62) * 3.2));
      const press = 0.78 + vnoise(x / (size * 1.8), y / (size * 2.2), sd + 5) * 0.34;
      const a = edge * (1 - skip * 0.92) * Math.min(1, press);
      if (a < 0.03) continue;
      const lum = 0.9 + hash2(x, y, 23) * 0.18;
      const i = (y * W + x) * 4;
      d[i] = Math.min(255, cr * lum); d[i + 1] = Math.min(255, cg * lum); d[i + 2] = Math.min(255, cb * lum);
      d[i + 3] = Math.round(Math.min(1, a) * 245);
    }
  }
  g.putImageData(out, 0, 0);
}

/** Freehand crayon strokes onto a canvas (pixel coordinates). */
export class CrayonBrush {
  private tmp: HTMLCanvasElement;
  constructor(private c: HTMLCanvasElement) {
    this.tmp = document.createElement('canvas');
    this.tmp.width = c.width; this.tmp.height = c.height;
  }
  /** pts = [x0,y0,x1,y1,…] in px; width in px */
  stroke(pts: number[], color: string, width: number, seed: number) {
    if (pts.length < 2) return;
    const t = this.tmp.getContext('2d')!;
    t.clearRect(0, 0, this.tmp.width, this.tmp.height);
    const r = rng(seed);
    const [cr, cg, cb] = rgbOf(color);
    // soft core (a little uneven in width) …
    t.lineCap = 'round'; t.lineJoin = 'round';
    t.strokeStyle = `rgba(${cr},${cg},${cb},0.82)`;
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (let i = 0; i + 3 < pts.length || i === 0; i += 2) {
      const x0 = pts[i], y0 = pts[i + 1], x1 = pts[i + 2] ?? x0 + 0.01, y1 = pts[i + 3] ?? y0;
      t.lineWidth = width * (0.8 + r() * 0.35);
      t.beginPath(); t.moveTo(x0, y0); t.lineTo(x1, y1); t.stroke();
      minX = Math.min(minX, x0, x1); minY = Math.min(minY, y0, y1); maxX = Math.max(maxX, x0, x1); maxY = Math.max(maxY, y0, y1);
      if (pts.length < 4) break;
    }
    // … plus wax specks around the line (crumbs of crayon catching the surface)
    t.fillStyle = `rgb(${cr},${cg},${cb})`;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const x0 = pts[i], y0 = pts[i + 1], x1 = pts[i + 2], y1 = pts[i + 3];
      const len = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.ceil(len * 1.4);
      for (let k = 0; k < n; k++) {
        const f = k / n, a = r() * 6.283, rr = width * (0.35 + r() * 0.45);
        t.globalAlpha = 0.25 + r() * 0.5;
        const s = 0.6 + r() * 1.3;
        t.fillRect(x0 + (x1 - x0) * f + Math.cos(a) * rr, y0 + (y1 - y0) * f + Math.sin(a) * rr, s, s);
      }
    }
    t.globalAlpha = 1;
    // grain: knock holes in the wax
    const pad = width * 2;
    t.globalCompositeOperation = 'destination-out';
    const gp = t.createPattern(grain(), 'repeat');
    if (gp) { t.fillStyle = gp; t.fillRect(minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2); }
    t.globalCompositeOperation = 'source-over';
    this.c.getContext('2d')!.drawImage(this.tmp, 0, 0);
  }
}
