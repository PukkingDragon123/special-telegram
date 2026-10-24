import type { FaceVariant } from '../../game/contracts';
import { Assets } from '../../core/assets';
import { RNG, Noise } from '../../core/rng';
import { FaceEntry } from './defs';

/* ============================================================================================
 * Faces. Photo faces (public/assets/textures/faces, eye-aligned 512²: eyes (0.36,0.44)/(0.64,0.44),
 * mouth (0.5,0.73)) are re-tinted to any skin colour with the research pipeline's formula:
 *    D = lin2srgb(clamp(K · lin(face) / lin(avgSkin)))      (K = 0.2158, stored as *_detail.jpg)
 *    tinted = lin2srgb(lin(D) / K · lin(skin)),  mixed with the original by *_mask.png
 * Until photos exist, a procedural painted face in the same layout is used.
 * Faces never animate: variants are separate static images.
 * ========================================================================================== */

export const FACE_PX = 512;
const K_DETAIL = 0.2158;

const S2L = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; S2L[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
const l2s = (l: number) => (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);
export const hexToRgb = (h: string): [number, number, number] => { const n = parseInt((h || '#c69472').replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

// ------------------------------------------------------------------ image cache

const imgs = new Map<string, HTMLImageElement | null>();
const waiting = new Map<string, Promise<HTMLImageElement | null>>();
export function getImage(path: string | undefined): HTMLImageElement | null | undefined {
  if (!path) return null;
  if (imgs.has(path)) return imgs.get(path);
  if (!waiting.has(path)) waiting.set(path, Assets.image(path).then((im) => { imgs.set(path, im); return im; }).catch(() => { imgs.set(path, null); return null; }));
  return undefined; // loading
}
export function whenImage(path: string | undefined): Promise<HTMLImageElement | null> {
  if (!path) return Promise.resolve(null);
  if (imgs.has(path)) return Promise.resolve(imgs.get(path) ?? null);
  getImage(path);
  return waiting.get(path)!;
}

function pixels(im: HTMLImageElement | HTMLCanvasElement, size = FACE_PX): Uint8ClampedArray {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(im, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}

// ------------------------------------------------------------------ face canvases (cached)

const faceCache = new Map<string, HTMLCanvasElement>();

/** Returns the face image for (entry, variant, skin) or null while photos are still loading. */
export function faceCanvas(f: FaceEntry, v: FaceVariant, skin: string, onReady?: () => void): HTMLCanvasElement {
  if (f.photo) {
    const vv = v !== 'neutral' && f.photo.variants[v] ? f.photo.variants[v] : null;
    const src = vv ?? { base: f.photo.base, detail: f.photo.detail, mask: f.photo.mask };
    const key = `p|${src.base}|${skin}`;
    const hit = faceCache.get(key);
    if (hit) return hit;
    const base = getImage(src.base), det = getImage(src.detail), mask = getImage(src.mask);
    if (base === undefined || det === undefined || mask === undefined) {
      Promise.all([whenImage(src.base), whenImage(src.detail), whenImage(src.mask)]).then(() => onReady?.());
      // meanwhile: procedural stand-in (same layout), not cached under the photo key
      return proceduralFace({ ...f, photo: undefined, seed: hash(f.id) }, v, skin);
    }
    if (!base) return proceduralFace({ ...f, photo: undefined, seed: hash(f.id) }, v, skin);
    const cv = tintPhoto(base, det, mask, skin, f.photo.avg);
    faceCache.set(key, cv);
    return cv;
  }
  return proceduralFace(f, v, skin);
}

function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

function tintPhoto(base: HTMLImageElement, det: HTMLImageElement | null, mask: HTMLImageElement | null, skin: string, avg?: [number, number, number]) {
  const S = FACE_PX;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  const bp = pixels(base);
  const out = ctx.createImageData(S, S);
  const o = out.data;
  const T = hexToRgb(skin).map((c) => S2L[c]);
  if (det) {
    const dp = pixels(det);
    const mp = mask ? pixels(mask) : null;
    const lut = [0, 1, 2].map((ch) => { const a = new Uint8ClampedArray(256); for (let d = 0; d < 256; d++) a[d] = Math.round(Math.min(1, l2s(Math.min(1, (S2L[d] / K_DETAIL) * T[ch]))) * 255); return a; });
    for (let i = 0; i < o.length; i += 4) {
      const m = mp ? mp[i] / 255 : 1;
      o[i] = lut[0][dp[i]] * m + bp[i] * (1 - m);
      o[i + 1] = lut[1][dp[i + 1]] * m + bp[i + 1] * (1 - m);
      o[i + 2] = lut[2][dp[i + 2]] * m + bp[i + 2] * (1 - m);
      o[i + 3] = 255;
    }
  } else {
    // no detail map: per-channel linear colour transfer from the photo's average skin
    const A = (avg ?? [200, 160, 130]).map((c) => S2L[Math.round(c)]);
    const lut = [0, 1, 2].map((ch) => { const a = new Uint8ClampedArray(256); for (let d = 0; d < 256; d++) a[d] = Math.round(Math.min(1, l2s(Math.min(1, (S2L[d] / Math.max(1e-3, A[ch])) * T[ch]))) * 255); return a; });
    for (let i = 0; i < o.length; i += 4) { o[i] = lut[0][bp[i]]; o[i + 1] = lut[1][bp[i + 1]]; o[i + 2] = lut[2][bp[i + 2]]; o[i + 3] = 255; }
  }
  ctx.putImageData(out, 0, 0);
  return cv;
}

// ------------------------------------------------------------------ procedural face

interface FP {
  sex: 'm' | 'f'; age: FaceEntry['age'];
  eyeW: number; eyeH: number; lid: number; tilt: number; irisR: number;
  browW: number; browArch: number; browDark: number; browY: number;
  noseW: number; lipW: number; lipFull: number; lipTint: number;
  stubble: number; mustache: number; wrinkles: number; blush: number; mole: number; jaw: number;
}

function faceParams(f: FaceEntry): FP {
  const r = new RNG(f.seed ?? hash(f.id));
  const m = f.sex === 'm';
  const old = f.age === 'old', mid = f.age === 'middle';
  return {
    sex: f.sex, age: f.age,
    eyeW: (m ? 50 : 52) + r.range(-4, 5), eyeH: (m ? 15 : 17) + r.range(-3, 3), lid: r.next(), tilt: r.range(-0.08, 0.12), irisR: 12.5 + r.range(-1, 1),
    browW: m ? r.range(7, 11) : r.range(4, 6.5), browArch: r.range(0.1, 0.5), browDark: old ? r.range(0.35, 0.6) : r.range(0.7, 0.95), browY: r.range(-4, 4),
    noseW: (m ? 40 : 34) + r.range(-4, 6), lipW: (m ? 70 : 64) + r.range(-6, 6), lipFull: r.range(0.6, 1.2), lipTint: m ? 0 : r.range(0.2, 0.75),
    stubble: m ? (old ? r.range(0.2, 0.6) : r.chance(0.45) ? r.range(0.2, 0.7) : 0) : 0, mustache: m && (mid || old) && r.chance(0.35) ? r.range(0.4, 0.9) : 0,
    wrinkles: old ? r.range(0.6, 1) : mid ? r.range(0.2, 0.5) : 0, blush: r.range(0.15, 0.45), mole: r.chance(0.3) ? r.next() : -1, jaw: r.range(-1, 1),
  };
}

const NZ = new Noise('faceskin');
let poreTile: HTMLCanvasElement | null = null;
function pores(): HTMLCanvasElement {
  if (poreTile) return poreTile;
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  const im = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = NZ.n2(x * 0.35, y * 0.35) * 0.5 + NZ.n2(x * 1.3, y * 1.3) * 0.35 + (Math.random() - 0.5) * 0.5;
    const v = 128 + n * 30;
    const i = (y * S + x) * 4;
    im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
  return (poreTile = cv);
}

function shade(hex: string, k: number, rAdd = 0, gAdd = 0, bAdd = 0) {
  const [r, g, b] = hexToRgb(hex);
  const f = (v: number, a: number) => Math.max(0, Math.min(255, Math.round(v * k + a)));
  return `rgb(${f(r, rAdd)},${f(g, gAdd)},${f(b, bAdd)})`;
}
const rgba = (hex: string, a: number, k = 1) => { const [r, g, b] = hexToRgb(hex); return `rgba(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)},${a})`; };

export function proceduralFace(f: FaceEntry, v: FaceVariant, skin: string): HTMLCanvasElement {
  const key = `g|${f.id}|${f.seed}|${v}|${skin}`;
  const hit = faceCache.get(key);
  if (hit) return hit;
  const S = FACE_PX;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  const p = faceParams(f);
  const old = p.age === 'old';
  // --- base skin & form shading
  g.fillStyle = skin;
  g.fillRect(0, 0, S, S);
  const ov = (cx: number, cy: number, rx: number, ry: number, col: string, a0: number, a1 = 0) => {
    g.save(); g.translate(cx, cy); g.scale(1, ry / rx);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    gr.addColorStop(0, col.replace('A)', `${a0})`)); gr.addColorStop(1, col.replace('A)', `${a1})`));
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rx, 0, Math.PI * 2); g.fill(); g.restore();
  };
  const [sr, sg, sb] = hexToRgb(skin);
  const dark = `rgba(${Math.round(sr * 0.55)},${Math.round(sg * 0.42)},${Math.round(sb * 0.38)},A)`;
  const light = `rgba(${Math.min(255, sr + 40)},${Math.min(255, sg + 32)},${Math.min(255, sb + 26)},A)`;
  const red = `rgba(${Math.min(255, sr + 30)},${Math.round(sg * 0.7)},${Math.round(sb * 0.7)},A)`;
  // jaw / temple form shadows (outside the oval → stays skin at the border)
  g.save();
  g.globalCompositeOperation = 'source-over';
  ov(256, 300, 230, 260, dark, 0, 0.0);
  // side shading
  for (const sx of [1, -1]) {
    ov(256 + sx * 150, 300, 70, 160, dark, 0.22, 0);
    ov(256 + sx * 122, 168, 50, 60, dark, 0.12, 0);
  }
  // under the jaw
  ov(256, 470, 150, 40, dark, 0.32, 0);
  // forehead & nose bridge light
  ov(256, 140, 120, 60, light, 0.18, 0);
  ov(256, 270, 16, 70, light, 0.2, 0);
  ov(256, 318, 18, 12, light, 0.25, 0);
  // cheeks
  for (const sx of [1, -1]) ov(256 + sx * 82, 300, 48, 34, red, p.blush * 0.35 + (v === 'drunk' ? 0.35 : 0), 0);
  if (v === 'drunk') ov(256, 315, 24, 18, red, 0.35, 0);
  if (v === 'shock') ov(256, 260, 200, 230, light, 0.12, 0);
  // eye sockets
  for (const sx of [1, -1]) ov(256 + sx * 72, 228, 46, 26, dark, 0.22, 0);
  // nose sides & under-nose
  for (const sx of [1, -1]) ov(256 + sx * 20, 292, 10, 30, dark, 0.18, 0);
  ov(256, 336, 30, 9, dark, 0.28, 0);
  // nasolabial folds
  g.strokeStyle = rgba(skin, 0.18 + p.wrinkles * 0.25, 0.55); g.lineWidth = 3;
  for (const sx of [1, -1]) { g.beginPath(); g.moveTo(256 + sx * 30, 322); g.quadraticCurveTo(256 + sx * 52, 350, 256 + sx * 50, 392); g.stroke(); }
  g.restore();

  // --- brows
  const browCol = old ? '#7a756e' : '#1a1410';
  const eyeY = 225, eL = 184, eR = 328;
  const browUp = v === 'shock' || v === 'scream' ? -14 : v === 'think' ? -6 : v === 'sleep' ? 3 : 0;
  for (const sx of [-1, 1]) {
    const cx = sx < 0 ? eL : eR;
    const lift = v === 'think' && sx > 0 ? -9 : 0;
    g.save();
    g.strokeStyle = browCol;
    g.globalAlpha = p.browDark;
    g.lineCap = 'round';
    for (let k = 0; k < 7; k++) {
      g.lineWidth = p.browW * (1 - k * 0.1);
      g.beginPath();
      const y0 = eyeY - 36 + p.browY + browUp + lift;
      g.moveTo(cx - sx * 32, y0 + 5 + k * 0.3);
      g.quadraticCurveTo(cx + sx * 2, y0 - 8 * p.browArch - 2 - k * 0.2, cx + sx * 34, y0 + 3 + p.browArch * 3);
      g.globalAlpha = p.browDark * 0.22;
      g.stroke();
    }
    g.restore();
  }

  // --- eyes
  const eyeOpen = v === 'sleep' ? 0 : v === 'drunk' ? 0.45 : v === 'shock' || v === 'scream' ? 1.45 : 1;
  for (const sx of [-1, 1]) {
    const cx = sx < 0 ? eL : eR, cy = eyeY;
    const w = p.eyeW / 2, h = (p.eyeH / 2) * eyeOpen;
    const tilt = p.tilt * -sx;
    g.save(); g.translate(cx, cy); g.rotate(tilt);
    if (eyeOpen > 0.05) {
      // almond shape
      const path = () => { g.beginPath(); g.moveTo(-w, 0); g.bezierCurveTo(-w * 0.45, -h * 1.5, w * 0.5, -h * 1.45, w, -h * 0.1); g.bezierCurveTo(w * 0.45, h * 1.15, -w * 0.45, h * 1.1, -w, 0); };
      path(); g.fillStyle = v === 'drunk' ? '#e6c8bf' : '#ece6df'; g.fill();
      g.save(); path(); g.clip();
      // iris
      const look = v === 'think' ? [sx * -4 + 4, -h * 0.55] : [0, 0];
      const ir = p.irisR * (v === 'shock' || v === 'scream' ? 0.82 : 1);
      const gr = g.createRadialGradient(look[0], look[1], 1, look[0], look[1], ir);
      gr.addColorStop(0, '#0d0907'); gr.addColorStop(0.35, '#2a1a10'); gr.addColorStop(0.85, '#3b2618'); gr.addColorStop(1, '#140d09');
      g.fillStyle = gr; g.beginPath(); g.arc(look[0], look[1], ir, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.75)'; g.beginPath(); g.arc(look[0] + 4, look[1] - 4, 2.6, 0, Math.PI * 2); g.fill();
      // upper lid shadow
      const sh = g.createLinearGradient(0, -h * 1.3, 0, h * 0.2);
      sh.addColorStop(0, 'rgba(40,20,10,0.55)'); sh.addColorStop(1, 'rgba(40,20,10,0)');
      g.fillStyle = sh; g.fillRect(-w, -h * 1.5, w * 2, h * 1.8);
      if (v === 'drunk') { g.fillStyle = shade(skin, 0.92); g.fillRect(-w, -h * 1.6, w * 2, h * 1.1); }
      g.restore();
      // lash line
      g.strokeStyle = '#120c09'; g.lineWidth = p.sex === 'f' ? 3.6 : 2.8; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-w - 1, 1); g.bezierCurveTo(-w * 0.45, -h * 1.5, w * 0.5, -h * 1.45, w + 2, -h * 0.15); g.stroke();
      g.strokeStyle = 'rgba(60,35,25,0.45)'; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(-w * 0.8, h * 0.5); g.bezierCurveTo(-w * 0.4, h * 1.12, w * 0.45, h * 1.1, w * 0.9, h * 0.2); g.stroke();
      // double-eyelid crease
      if (p.lid > 0.45) { g.strokeStyle = 'rgba(70,40,28,0.35)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(-w * 0.7, -h * 1.0); g.quadraticCurveTo(0, -h * 2.1 - 3, w * 0.85, -h * 0.9); g.stroke(); }
    } else {
      // closed: curved lash line
      g.strokeStyle = '#1a110c'; g.lineWidth = 3; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-w, -1); g.quadraticCurveTo(0, 7, w, -2); g.stroke();
      g.strokeStyle = 'rgba(60,35,25,0.35)'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(-w * 0.7, -8); g.quadraticCurveTo(0, -12, w * 0.8, -8); g.stroke();
    }
    // crow's feet / bags
    if (p.wrinkles > 0.3) { g.strokeStyle = rgba(skin, p.wrinkles * 0.35, 0.6); g.lineWidth = 1.2; for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(sx * (w + 4), -4 + k * 5); g.lineTo(sx * (w + 16), -9 + k * 7); g.stroke(); } g.beginPath(); g.arc(0, h + 8, w * 0.7, 0.2, Math.PI - 0.2); g.stroke(); }
    g.restore();
  }

  // --- nose
  g.fillStyle = rgba(skin, 0.75, 0.35);
  for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(256 + sx * (p.noseW * 0.24), 330, 6.5, 4, sx * 0.4, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = rgba(skin, 0.35, 0.55); g.lineWidth = 2;
  for (const sx of [-1, 1]) { g.beginPath(); g.arc(256 + sx * (p.noseW * 0.36), 322, 11, sx > 0 ? -1.3 : Math.PI - 1.9, sx > 0 ? 1.9 : Math.PI + 1.3); g.stroke(); }

  // --- mouth
  const mw = p.lipW / 2;
  const lipCol = p.lipTint > 0 ? `rgb(${Math.round(150 + p.lipTint * 50)},${Math.round(70 - p.lipTint * 20)},${Math.round(75 - p.lipTint * 10)})` : shade(skin, 0.7, 18, -8, -4);
  g.save(); g.translate(256, 374);
  if (v === 'shock' || v === 'scream' || v === 'think' || v === 'sleep') {
    const oh = v === 'scream' ? 50 : v === 'shock' ? 30 : v === 'think' ? 12 : 7;
    const ow = v === 'scream' ? mw * 0.9 : v === 'shock' ? mw * 0.55 : v === 'think' ? mw * 0.45 : mw * 0.5;
    const dx = v === 'think' ? 10 : 0;
    g.fillStyle = lipCol; g.beginPath(); g.ellipse(dx, oh * 0.35, ow + 6, oh * 0.62 + 6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2a0f0d'; g.beginPath(); g.ellipse(dx, oh * 0.35, ow, oh * 0.62, 0, 0, Math.PI * 2); g.fill();
    if (v === 'scream' || v === 'shock') { g.fillStyle = '#e9e2d6'; g.beginPath(); g.ellipse(dx, oh * 0.35 - oh * 0.5, ow * 0.7, 5, 0, 0, Math.PI); g.fill(); g.fillStyle = '#9c3a3a'; g.beginPath(); g.ellipse(dx, oh * 0.35 + oh * 0.35, ow * 0.6, oh * 0.18, 0, 0, Math.PI * 2); g.fill(); }
    if (v === 'sleep') { g.strokeStyle = 'rgba(220,230,240,0.6)'; g.lineWidth = 2; g.beginPath(); g.moveTo(dx + ow * 0.6, 5); g.quadraticCurveTo(dx + ow * 0.8, 20, dx + ow * 0.7, 30); g.stroke(); }
  } else {
    const grin = v === 'drunk' ? 1 : 0;
    // upper lip
    g.fillStyle = lipCol;
    g.beginPath(); g.moveTo(-mw, 0); g.quadraticCurveTo(-mw * 0.4, -9 * p.lipFull, -4, -6 * p.lipFull); g.quadraticCurveTo(0, -3, 4, -6 * p.lipFull); g.quadraticCurveTo(mw * 0.4, -9 * p.lipFull, mw, -grin * 8); g.quadraticCurveTo(0, 2, -mw, 0); g.fill();
    // lower lip
    g.fillStyle = shade(lipCol.startsWith('rgb(') ? '#a86a62' : lipCol, 1.08);
    g.fillStyle = lipCol;
    g.globalAlpha = 0.85;
    g.beginPath(); g.moveTo(-mw * 0.92, 1); g.quadraticCurveTo(0, 15 * p.lipFull, mw * 0.92, 1 - grin * 8); g.quadraticCurveTo(0, 3, -mw * 0.92, 1); g.fill();
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(255,240,230,0.25)'; g.beginPath(); g.ellipse(0, 7 * p.lipFull, mw * 0.35, 3, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(55,22,18,0.75)'; g.lineWidth = 2.4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-mw - 2, 0); g.quadraticCurveTo(0, 3, mw + 2, -grin * 9); g.stroke();
  }
  g.restore();

  // --- facial hair & age
  if (p.stubble > 0) {
    g.save();
    g.beginPath(); g.ellipse(256, 410, 120, 95, 0, 0, Math.PI * 2); g.ellipse(256, 352, 60, 18, 0, 0, Math.PI * 2); g.clip();
    const r = new RNG(f.seed ?? 1);
    g.fillStyle = `rgba(40,38,45,${0.12 * p.stubble})`;
    for (let i = 0; i < 2600 * p.stubble; i++) { const x = 130 + r.next() * 252, y = 330 + r.next() * 150; if (Math.hypot((x - 256) / 1.0, (y - 374) / 0.6) < 40) continue; g.fillRect(x, y, 1.6, 1.6); }
    g.restore();
  }
  if (p.mustache > 0) {
    g.fillStyle = old ? `rgba(120,115,108,${p.mustache})` : `rgba(25,18,14,${p.mustache * 0.85})`;
    g.beginPath(); g.moveTo(256 - mw * 0.95, 368); g.quadraticCurveTo(256, 336, 256 + mw * 0.95, 368); g.quadraticCurveTo(256, 352, 256 - mw * 0.95, 368); g.fill();
  }
  if (p.wrinkles > 0.4) { g.strokeStyle = rgba(skin, p.wrinkles * 0.22, 0.6); g.lineWidth = 1.6; for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(190, 140 + k * 14); g.quadraticCurveTo(256, 132 + k * 14, 322, 140 + k * 14); g.stroke(); } }
  if (p.mole >= 0) { g.fillStyle = 'rgba(50,30,20,0.7)'; g.beginPath(); g.arc(200 + p.mole * 120, 300 + p.mole * 90, 2.6, 0, Math.PI * 2); g.fill(); }

  // --- pores & softening
  g.save();
  g.globalCompositeOperation = 'overlay';
  g.globalAlpha = 0.5;
  g.fillStyle = g.createPattern(pores(), 'repeat')!;
  g.fillRect(0, 0, S, S);
  g.restore();
  const soft = document.createElement('canvas');
  soft.width = soft.height = S;
  const sg2 = soft.getContext('2d', { willReadFrequently: true })!;
  sg2.filter = 'blur(1.1px)';
  sg2.drawImage(cv, 0, 0);
  g.drawImage(soft, 0, 0);
  // feather the border into flat skin (matches the body skin exactly)
  const edge = g.createRadialGradient(256, 290, 190, 256, 290, 262);
  edge.addColorStop(0, rgba(skin, 0)); edge.addColorStop(1, rgba(skin, 1));
  g.fillStyle = edge;
  g.fillRect(0, 0, S, S);
  void sr; void sg; void sb;
  faceCache.set(key, cv);
  return cv;
}
