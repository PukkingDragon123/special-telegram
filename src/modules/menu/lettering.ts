import { F } from '../../core/fonts';

/* ============================================================================================
 * Album-cover lettering (ref4 "Tattoo Colour" style) rendered on a canvas at runtime so any
 * text (names, room codes, buttons) gets the same print look as the title:
 *   hard drop shadow → thin dark outer edge → thick green band (vertical gradient)
 *   → thin near-black inner contour → warm-white fill (slightly fattened = bubbly corners).
 * Outlines of neighbouring letters merge, exactly like the cover. LOOPED Thai fonts only (F.*).
 * ========================================================================================== */

export interface LetterStyle {
  fill: string; fillLo: string; inner: string; green: string; greenHi: string; greenLo: string; outer: string; shadow: string;
}

export const COVER: LetterStyle = { fill: '#FBFDF8', fillLo: '#E9EBDF', inner: '#0F1A0B', green: '#6CBF4B', greenHi: '#86CF66', greenLo: '#4E9E3A', outer: '#1E3314', shadow: '#0F1A0B' };
export const HOVER: LetterStyle = { ...COVER, fill: '#FFE96A', fillLo: '#FFD23A' };
export const PRESSED: LetterStyle = { ...COVER, fill: '#F2C230', fillLo: '#E0A820', green: '#5AAE3C', greenHi: '#6CBF4B', greenLo: '#3F8A2E' };
export const DISABLED: LetterStyle = { ...COVER, fill: '#D9D6CC', fillLo: '#C9C6BA', green: '#8FA088', greenHi: '#A3B19C', greenLo: '#768871', outer: '#3A4236', shadow: '#1d2119' };
export const DANGER: LetterStyle = { ...COVER, fill: '#FFF4EC', fillLo: '#F6DCCF', green: '#E0583A', greenHi: '#F27552', greenLo: '#B8402A', outer: '#3A140C', inner: '#2a0d06', shadow: '#2a0d06' };
export const GOLD: LetterStyle = { ...COVER, fill: '#FFF7D6', fillLo: '#FFE79A', green: '#E8A33D', greenHi: '#F5C25A', greenLo: '#C47F22', outer: '#3A2408', inner: '#2a1804', shadow: '#2a1804' };

export interface LineSpec {
  text: string;
  /** px (canvas space at scale 1) */
  size: number;
  font?: string;
  weight?: number | string;
  /** extra px between letters */
  spacing?: number;
  style?: LetterStyle;
  /** vertical gap before this line (px, can be negative) */
  gap?: number;
  /** relative band width multiplier for this line (small English lines use a thinner band) */
  band?: number;
}

export interface AlbumOpts {
  style?: LetterStyle;
  /** device pixel multiplier (crispness) */
  scale?: number;
  align?: 'center' | 'left' | 'right';
  /** widths as fractions of the font size */
  fat?: number; inner?: number; band?: number; edge?: number;
  shadow?: [number, number];
  /** squash horizontally to fit (px at scale 1) */
  maxWidth?: number;
  /** override canvas */
  canvas?: HTMLCanvasElement;
  /** extra padding px */
  pad?: number;
}

export interface AlbumCanvas extends HTMLCanvasElement { cssW: number; cssH: number }

const fontOf = (l: LineSpec) => `${l.weight ?? 700} ${l.size}px ${l.font ?? F.bubbly}, ${F.ui}, sans-serif`;

/**
 * Render one or more lines of album-cover lettering into a tight canvas.
 * Returns the canvas with `cssW/cssH` = logical size (canvas.width = cssW * scale).
 */
export function albumText(input: string | LineSpec | LineSpec[], o: AlbumOpts = {}): AlbumCanvas {
  const lines: LineSpec[] = typeof input === 'string' ? [{ text: input, size: 72 }] : Array.isArray(input) ? input : [input];
  const scale = o.scale ?? Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const cv = (o.canvas ?? document.createElement('canvas')) as AlbumCanvas;
  const ctx = cv.getContext('2d')!;
  // ---- measure
  type M = { l: LineSpec; w: number; asc: number; desc: number; left: number; sx: number; total: number; sh: [number, number] };
  const ms: M[] = [];
  let maxW = 0;
  for (const l of lines) {
    ctx.font = fontOf(l);
    (ctx as any).letterSpacing = `${l.spacing ?? 0}px`;
    const m = ctx.measureText(l.text || ' ');
    const s = l.size;
    const bandK = l.band ?? 1;
    const total = s * ((o.fat ?? 0.03) + (o.inner ?? 0.012) + (o.band ?? 0.085) * bandK + (o.edge ?? 0.018));
    const sh: [number, number] = [s * (o.shadow?.[0] ?? 0.03), s * (o.shadow?.[1] ?? 0.045)];
    const asc = Math.max(m.actualBoundingBoxAscent || s * 0.8, s * 0.72);
    const desc = Math.max(m.actualBoundingBoxDescent || s * 0.2, s * 0.08);
    let w = (m.actualBoundingBoxRight ?? m.width) + (m.actualBoundingBoxLeft ?? 0);
    if (!isFinite(w) || w <= 0) w = m.width;
    let sx = 1;
    if (o.maxWidth && w > o.maxWidth) sx = Math.max(0.55, o.maxWidth / w);
    ms.push({ l, w: w * sx, asc, desc, left: m.actualBoundingBoxLeft ?? 0, sx, total, sh });
    maxW = Math.max(maxW, w * sx + total * 2 + sh[0]);
  }
  const pad = o.pad ?? 4;
  let H = pad * 2;
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i];
    H += m.asc + m.desc + m.total * 2 + (i === ms.length - 1 ? m.sh[1] : 0) + (i > 0 ? (m.l.gap ?? 0) : 0);
  }
  const W = Math.ceil(maxW + pad * 2);
  cv.width = Math.max(2, Math.ceil(W * scale));
  cv.height = Math.max(2, Math.ceil(H * scale));
  cv.cssW = W;
  cv.cssH = Math.ceil(H);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.miterLimit = 2;
  // ---- baseline positions
  const pos: { x: number; y: number; top: number; bot: number }[] = [];
  let y = pad;
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i];
    if (i > 0) y += m.l.gap ?? 0;
    const top = y;
    y += m.total + m.asc;
    const base = y;
    y += m.desc + m.total;
    const align = o.align ?? 'center';
    const x = align === 'center' ? (W - m.w) / 2 : align === 'left' ? pad + m.total : W - pad - m.total - m.w - m.sh[0];
    pos.push({ x, y: base, top, bot: y });
  }
  const draw = (i: number, mode: 'fill' | 'stroke', lw: number, dx = 0, dy = 0) => {
    const m = ms[i], p = pos[i];
    ctx.save();
    ctx.font = fontOf(m.l);
    (ctx as any).letterSpacing = `${m.l.spacing ?? 0}px`;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.translate(p.x + dx + m.left * m.sx, p.y + dy);
    ctx.scale(m.sx, 1);
    if (mode === 'stroke') { ctx.lineWidth = lw / m.sx; ctx.strokeText(m.l.text, 0, 0); }
    ctx.fillText(m.l.text, 0, 0);
    ctx.restore();
  };
  const st = (i: number) => ms[i].l.style ?? o.style ?? COVER;
  const W_ = (i: number) => {
    const s = ms[i].l.size, k = ms[i].l.band ?? 1;
    const fat = s * (o.fat ?? 0.03), inn = s * (o.inner ?? 0.012), band = s * (o.band ?? 0.085) * k, edge = s * (o.edge ?? 0.018);
    return { fat, inn, band, edge };
  };
  // 1) shadow (whole silhouette, offset)
  for (let i = 0; i < ms.length; i++) {
    const w = W_(i), s = st(i);
    ctx.strokeStyle = ctx.fillStyle = s.shadow;
    ctx.globalAlpha = 0.92;
    draw(i, 'stroke', 2 * (w.fat + w.inn + w.band + w.edge), ms[i].sh[0], ms[i].sh[1]);
  }
  ctx.globalAlpha = 1;
  // 2) outer dark edge
  for (let i = 0; i < ms.length; i++) {
    const w = W_(i), s = st(i);
    ctx.strokeStyle = ctx.fillStyle = s.outer;
    draw(i, 'stroke', 2 * (w.fat + w.inn + w.band + w.edge));
  }
  // 3) green band with a soft vertical gradient
  for (let i = 0; i < ms.length; i++) {
    const w = W_(i), s = st(i), p = pos[i];
    const g = ctx.createLinearGradient(0, p.top, 0, p.bot);
    g.addColorStop(0, s.greenHi); g.addColorStop(0.5, s.green); g.addColorStop(1, s.greenLo);
    ctx.strokeStyle = ctx.fillStyle = g;
    draw(i, 'stroke', 2 * (w.fat + w.inn + w.band));
  }
  // 4) thin inner contour
  for (let i = 0; i < ms.length; i++) {
    const w = W_(i), s = st(i);
    ctx.strokeStyle = ctx.fillStyle = s.inner;
    draw(i, 'stroke', 2 * (w.fat + w.inn));
  }
  // 5) warm-white fill, fattened (round joins = bubbly corners), faint shade towards the bottom
  for (let i = 0; i < ms.length; i++) {
    const w = W_(i), s = st(i), p = pos[i];
    const g = ctx.createLinearGradient(0, p.top + ms[i].total, 0, p.bot - ms[i].total);
    g.addColorStop(0, s.fill); g.addColorStop(0.55, s.fill); g.addColorStop(1, s.fillLo);
    ctx.strokeStyle = ctx.fillStyle = g;
    draw(i, 'stroke', 2 * w.fat);
  }
  return cv;
}

/** Load an image (for kits / photos) – cached. */
const imgCache = new Map<string, Promise<HTMLImageElement | null>>();
export function loadImg(url: string): Promise<HTMLImageElement | null> {
  let p = imgCache.get(url);
  if (!p) {
    p = new Promise((res) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => res(im);
      im.onerror = () => { console.warn('[menu] missing image', url); res(null); };
      im.src = url;
    });
    imgCache.set(url, p);
  }
  return p;
}

/** Rounded rect path helper. */
export function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Wobbly hand-cut rounded rectangle (stickers are cut by hand, never perfect). */
export function wobblyRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, seed = 1, amp = 1.6) {
  const pts: [number, number][] = [];
  const rr = Math.min(r, w / 2, h / 2);
  const rnd = mulberry(seed);
  const N = 64;
  for (let i = 0; i < N; i++) {
    const t = i / N;
    // walk the rounded-rect perimeter
    const per = 2 * (w - 2 * rr) + 2 * (h - 2 * rr) + 2 * Math.PI * rr;
    let d = t * per;
    let px = 0, py = 0;
    const seg = [w - 2 * rr, (Math.PI / 2) * rr, h - 2 * rr, (Math.PI / 2) * rr, w - 2 * rr, (Math.PI / 2) * rr, h - 2 * rr, (Math.PI / 2) * rr];
    let k = 0;
    while (k < 8 && d > seg[k]) { d -= seg[k]; k++; }
    const a = d / rr;
    switch (k) {
      case 0: px = x + rr + d; py = y; break;
      case 1: px = x + w - rr + Math.sin(a) * rr; py = y + rr - Math.cos(a) * rr; break;
      case 2: px = x + w; py = y + rr + d; break;
      case 3: px = x + w - rr + Math.cos(a) * rr; py = y + h - rr + Math.sin(a) * rr; break;
      case 4: px = x + w - rr - d; py = y + h; break;
      case 5: px = x + rr - Math.sin(a) * rr; py = y + h - rr + Math.cos(a) * rr; break;
      case 6: px = x; py = y + h - rr - d; break;
      default: px = x + rr - Math.cos(a) * rr; py = y + rr - Math.sin(a) * rr; break;
    }
    pts.push([px + (rnd() - 0.5) * amp, py + (rnd() - 0.5) * amp]);
  }
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
    if (i === 0) ctx.moveTo(mx, my); else ctx.quadraticCurveTo(p[0], p[1], mx, my);
  }
  const p = pts[0], q = pts[1];
  ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
  ctx.closePath();
}

export function mulberry(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
