import * as THREE from 'three';
import { F } from '../../core/fonts';

/* ============================================================================================
 * Manga SFX lettering — real typography (Dela Gothic One, OFL; Thai falls back to Noto Sans Thai
 * Looped Black) drawn the way it looks on a printed page: slanted, a solid offset extrusion, a thick
 * near-black contour, a vertical ink gradient inside and a thin paper-white rim. No glow, no bloom
 * (sprites stay below the bloom threshold). Canvases are cached per text+style once the font is in.
 *   sfxCanvas(text, style)  → canvas (cached)
 *   sfxTexture(text, style) → THREE.CanvasTexture (cached)
 * ========================================================================================== */

export type SfxStyle = 'menace' | 'impact' | 'gold' | 'blood' | 'ice' | 'pop' | 'thai' | 'white';

interface StyleDef { top: string; mid: string; bot: string; edge: string; ext: string; rim: string; skew: number; ext3d: number }

const STYLES: Record<SfxStyle, StyleDef> = {
  // purple→magenta ink: the classic menace look
  menace: { top: '#d58bff', mid: '#9d2fd0', bot: '#5a0c86', edge: '#0d0214', ext: '#2a0640', rim: 'rgba(255,240,255,0.75)', skew: -0.2, ext3d: 0.09 },
  // white→pale cyan with deep blue edge: impacts (ドン!)
  impact: { top: '#ffffff', mid: '#dff4ff', bot: '#8cc8f0', edge: '#06101e', ext: '#13324f', rim: 'rgba(255,255,255,0.9)', skew: -0.16, ext3d: 0.08 },
  gold: { top: '#fff2b8', mid: '#f0b52e', bot: '#a8620a', edge: '#160a00', ext: '#4a2804', rim: 'rgba(255,250,225,0.85)', skew: -0.18, ext3d: 0.09 },
  blood: { top: '#ff8a7a', mid: '#e0261c', bot: '#7d0806', edge: '#120100', ext: '#3c0402', rim: 'rgba(255,225,220,0.8)', skew: -0.18, ext3d: 0.08 },
  ice: { top: '#e6fbff', mid: '#6fd2ff', bot: '#1c6fb0', edge: '#020c18', ext: '#0b2d4d', rim: 'rgba(240,252,255,0.85)', skew: -0.14, ext3d: 0.07 },
  pop: { top: '#ffd0f0', mid: '#ff5cb8', bot: '#b0126e', edge: '#16000c', ext: '#4a0630', rim: 'rgba(255,240,250,0.85)', skew: -0.15, ext3d: 0.07 },
  // Thai onomatopoeia (ตูม! เพล้ง! ฉับ!) — white/red, heavier contour for the looped forms
  thai: { top: '#ffffff', mid: '#fff1e8', bot: '#ffb39a', edge: '#1a0300', ext: '#7a1406', rim: 'rgba(255,255,255,0.0)', skew: -0.12, ext3d: 0.07 },
  white: { top: '#ffffff', mid: '#f4f4f4', bot: '#d9d9d9', edge: '#0a0a0a', ext: '#2a2a2a', rim: 'rgba(255,255,255,0)', skew: -0.1, ext3d: 0.05 },
};

const FAMILY_JP = '"Dela Gothic One"';
let fontReady = false;
const waiters: (() => void)[] = [];
if (typeof document !== 'undefined' && (document as any).fonts) {
  (document as any).fonts.load(`80px ${FAMILY_JP}`, 'ゴドン').then(() => {
    fontReady = (document as any).fonts.check(`80px ${FAMILY_JP}`, 'ゴ');
    if (fontReady) { cvCache.clear(); for (const w of waiters.splice(0)) w(); }
  }).catch(() => { /* fallback faces still draw */ });
}
/** run fn once the manga font is available (immediately if it already is) */
export function whenFont(fn: () => void) { if (fontReady) fn(); else waiters.push(fn); }

const hasThai = (s: string) => /[฀-๿]/.test(s);
const cvCache = new Map<string, HTMLCanvasElement>();

/** Draw manga SFX text into a cached canvas. px = glyph size in canvas pixels. */
export function sfxCanvas(text: string, style: SfxStyle = 'impact', px = 160): HTMLCanvasElement {
  const key = text + '|' + style + '|' + px;
  const hit = cvCache.get(key);
  if (hit) return hit;
  const S = STYLES[style];
  const thai = hasThai(text);
  const fam = thai ? `900 ${px}px ${F.ui}` : `${px}px ${F.jpDisplay}`;
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = fam;
  const m = probe.measureText(text);
  const w = Math.ceil(m.width + px * 0.9 + Math.abs(S.skew) * px * 1.3);
  const h = Math.ceil(px * (thai ? 1.75 : 1.5));
  const cv = document.createElement('canvas');
  cv.width = Math.max(8, w); cv.height = Math.max(8, h);
  const x = cv.getContext('2d')!;
  x.font = fam;
  x.textBaseline = 'middle';
  x.textAlign = 'center';
  x.lineJoin = 'round';
  x.miterLimit = 2;
  const cx = cv.width / 2 - S.skew * px * 0.25, cy = cv.height / 2 + (thai ? px * 0.06 : 0);
  // slant like hand lettering on the page
  x.setTransform(1, 0, S.skew, 1, -S.skew * cy, 0);
  // solid offset extrusion (stacked, down-right)
  const steps = Math.max(3, Math.round(px * S.ext3d / 2));
  for (let i = steps; i >= 1; i--) {
    const o = (i / steps) * px * S.ext3d;
    x.lineWidth = px * 0.17;
    x.strokeStyle = S.edge; x.strokeText(text, cx + o, cy + o * 0.9);
    x.fillStyle = S.ext; x.fillText(text, cx + o, cy + o * 0.9);
  }
  // thick contour
  x.lineWidth = px * 0.17; x.strokeStyle = S.edge; x.strokeText(text, cx, cy);
  // ink gradient fill
  const g = x.createLinearGradient(0, cy - px * 0.55, 0, cy + px * 0.55);
  g.addColorStop(0, S.top); g.addColorStop(0.5, S.mid); g.addColorStop(1, S.bot);
  x.fillStyle = g; x.fillText(text, cx, cy);
  // halftone band across the lower half (printed feel)
  x.save();
  x.globalCompositeOperation = 'source-atop';
  x.fillStyle = 'rgba(0,0,0,0.16)';
  const dot = Math.max(2, px * 0.035);
  for (let yy = cy + px * 0.05; yy < cy + px * 0.6; yy += dot * 2.2) for (let xx = 0; xx < cv.width; xx += dot * 2.2) {
    x.beginPath(); x.arc(xx + ((yy / (dot * 2.2)) % 2) * dot, yy, dot * 0.55, 0, Math.PI * 2); x.fill();
  }
  x.restore();
  // paper-white rim along the top-left edges
  if (S.rim !== 'rgba(255,255,255,0)' && !thai) {
    x.save(); x.lineWidth = px * 0.028; x.strokeStyle = S.rim; x.translate(-px * 0.012, -px * 0.016); x.strokeText(text, cx, cy); x.restore();
    x.lineWidth = px * 0.03; x.strokeStyle = S.edge; x.strokeText(text, cx, cy);
  }
  if (fontReady || thai) cvCache.set(key, cv);
  return cv;
}

const texCache = new Map<string, THREE.CanvasTexture>();
export function sfxTexture(text: string, style: SfxStyle = 'impact', px = 160): THREE.CanvasTexture {
  const key = text + '|' + style + '|' + px + '|' + (fontReady ? 1 : 0);
  let t = texCache.get(key);
  if (t) return t;
  t = new THREE.CanvasTexture(sfxCanvas(text, style, px));
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (fontReady || hasThai(text)) texCache.set(key, t);
  return t;
}

/** aspect (w/h) of a cached SFX canvas */
export function sfxAspect(text: string, style: SfxStyle = 'impact', px = 160) {
  const c = sfxCanvas(text, style, px);
  return c.width / c.height;
}

const urlCache = new Map<string, string>();
export function sfxDataURL(text: string, style: SfxStyle = 'impact', px = 160): string {
  const key = text + '|' + style + '|' + px + '|' + (fontReady ? 1 : 0);
  let u = urlCache.get(key);
  if (u) return u;
  u = sfxCanvas(text, style, px).toDataURL('image/png');
  if (fontReady || hasThai(text)) urlCache.set(key, u);
  return u;
}
