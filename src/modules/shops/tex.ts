import * as THREE from 'three';
import { Assets } from '../../core/assets';
import { F } from '../../core/fonts';

/**
 * Shops textures. CLIENT RULE: all art is real photos from the internet — they live in
 * public/assets/gen/shops/ (sources in references/credits/shops.md) and public/assets/img/labels/.
 * Text (prices, names) is rendered with LOOPED Thai fonts on top of those photos.
 * Every texture is returned immediately and refreshed when its photo arrives (non-blocking).
 */

export const GEN = 'gen/shops/';

/** Manifest of our processed photos: key → { file, alpha?, … } (gen/shops/manifest.json). */
let manifest: Record<string, { file: string; w?: number; h?: number; desc?: string }> = {};
let manifestReady: Promise<void> | null = null;
export function loadShopManifest() {
  if (!manifestReady) manifestReady = Assets.jsonSafe<any>(GEN + 'manifest.json', {}).then((j) => { manifest = j?.files ?? j ?? {}; });
  return manifestReady;
}
export function hasPhoto(key: string) { return !!manifest[key]; }
export function photoPath(key: string): string | null { const e = manifest[key]; return e ? (e.file.includes('/') ? e.file : GEN + e.file) : null; }

const texCache = new Map<string, THREE.Texture>();
/** Plain photo texture by manifest key (or a direct asset path). */
export function photo(keyOrPath: string, o: { repeat?: [number, number]; clamp?: boolean } = {}): THREE.Texture | null {
  const path = keyOrPath.includes('/') ? keyOrPath : photoPath(keyOrPath);
  if (!path) return null;
  const ck = path + JSON.stringify(o);
  let t = texCache.get(ck);
  if (!t) {
    t = Assets.texture(path, { srgb: true, repeat: o.repeat, wrap: !o.clamp });
    t.anisotropy = 4;
    texCache.set(ck, t);
  }
  return t;
}

const imgCache = new Map<string, HTMLImageElement | null>();
const imgWait = new Map<string, Promise<HTMLImageElement | null>>();
function loadImg(path: string): Promise<HTMLImageElement | null> {
  let p = imgWait.get(path);
  if (!p) {
    p = Assets.image(path).then((im) => { imgCache.set(path, im); return im; }).catch(() => { imgCache.set(path, null); return null; });
    imgWait.set(path, p);
  }
  return p;
}

/**
 * Composed canvas texture: `draw(ctx, w, h, img)` paints text over a real photo `base`
 * (manifest key or path). Drawn once immediately (img = null → neutral paper) and again when the
 * photo has loaded.
 */
export function composed(key: string, w: number, h: number, base: string | null, draw: (ctx: CanvasRenderingContext2D, w: number, h: number, img: HTMLImageElement | null) => void, alpha = true): THREE.CanvasTexture {
  const hit = texCache.get('c:' + key) as THREE.CanvasTexture;
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d')!;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  texCache.set('c:' + key, tex);
  const paint = (img: HTMLImageElement | null) => {
    ctx.clearRect(0, 0, w, h);
    if (!alpha) { ctx.fillStyle = '#ddd5c4'; ctx.fillRect(0, 0, w, h); }
    try { draw(ctx, w, h, img); } catch (e) { console.warn('[shops] tex draw', key, e); }
    tex.needsUpdate = true;
  };
  const path = base ? (base.includes('/') ? base : photoPath(base)) : null;
  const cached = path ? imgCache.get(path) : null;
  paint(cached ?? null);
  if (path && !cached) loadImg(path).then((im) => { if (im) paint(im); });
  else if (!path && base) loadShopManifest().then(() => { const p2 = photoPath(base); if (p2) loadImg(p2).then((im) => { if (im) paint(im); }); });
  return tex;
}

/** Draw an image to cover/contain a rect. */
export function drawImg(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, mode: 'cover' | 'contain' | 'stretch' = 'stretch') {
  if (mode === 'stretch') { ctx.drawImage(img, x, y, w, h); return; }
  const s = mode === 'cover' ? Math.max(w / img.width, h / img.height) : Math.min(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** Fit text into a width by shrinking the font size. */
export function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, font: string, weight: number | string = 700, color = '#1a1a1a', stroke?: string, sw = 0) {
  let s = size;
  ctx.font = `${weight} ${s}px ${font}, "Sarabun", sans-serif`;
  while (s > 10 && ctx.measureText(text).width > maxW) { s -= 2; ctx.font = `${weight} ${s}px ${font}, "Sarabun", sans-serif`; }
  if (stroke && sw) { ctx.lineJoin = 'round'; ctx.strokeStyle = stroke; ctx.lineWidth = sw; ctx.strokeText(text, x, y); }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  return s;
}

/** Slightly wobbly marker handwriting (per-glyph jitter). */
export function handText(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, maxW: number, size: number, color: string, font: string = F.scrawl, seed = 1) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const r = (k: number) => Math.sin(seed * 91.7 + k * 12.9898) * 0.5;
  ctx.translate(cx, cy);
  ctx.rotate(r(1) * 0.08);
  fitText(ctx, text, 0, 0, maxW, size, font, 400, color);
  ctx.restore();
}

// ------------------------------------------------------------------ price cards & tags

export type CardStyle = 'star' | 'card' | 'shelf' | 'yellow';
const STAR_TINTS = ['star_pink', 'star_yellow', 'star_green', 'star_orange'];

/** Market / shop price card for a product ("หมูสับ ถุงละ 75"). */
/** Card proportions + real-photo base per style. */
export function cardSpec(style: CardStyle, seed = 0): { w: number; h: number; base: string } {
  if (style === 'shelf' || style === 'yellow') return { w: 512, h: 192, base: style === 'yellow' ? 'shelf_label_yellow' : 'shelf_label' };
  if (style === 'star') return { w: 384, h: 384, base: STAR_TINTS[seed % STAR_TINTS.length] };
  return { w: 448, h: 320, base: 'card_kraft' };
}

/** Draw one price card into ctx at (0,0,w,h). */
export function drawCard(ctx: CanvasRenderingContext2D, w: number, h: number, img: HTMLImageElement | null, style: CardStyle, name: string, unit: string, price: number, seed = 0, sold = false) {
  const k = w / cardSpec(style).w; // scale fonts with the cell size
  if (style === 'shelf' || style === 'yellow') {
    if (img) drawImg(ctx, img, 0, 0, w, h, 'cover');
    else { ctx.fillStyle = '#f7f7f2'; ctx.fillRect(0, 0, w, h); }
    if (style === 'yellow') { ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = '#ffd814'; ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#d8231a'; ctx.fillRect(0, 0, w, 14 * k); }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    fitText(ctx, name, 22 * k, 64 * k, w * 0.62, 48 * k, F.ui, 600, '#1d1d1d');
    ctx.textAlign = 'right';
    fitText(ctx, sold ? 'หมด' : String(price), w - 26 * k, 150 * k, w * 0.42, 118 * k, F.heavy, 800, style === 'yellow' || sold ? '#c4121a' : '#111');
    ctx.textAlign = 'left';
    if (!sold) fitText(ctx, 'บาท', 24 * k, 152 * k, 120 * k, 40 * k, F.body, 600, '#333');
    return;
  }
  if (style === 'star') {
    if (img) drawImg(ctx, img, 0, 0, w, h, 'contain');
    else { starPath(ctx, w / 2, h / 2, w * 0.48, w * 0.3, 12); ctx.fillStyle = ['#ff5fa8', '#ffe94d', '#7dff6a', '#ff9a3c'][seed % 4]; ctx.fill(); }
    handText(ctx, name, w / 2, h * 0.36, w * 0.62, 56 * k, '#1a1a1a', F.scrawl, seed);
    handText(ctx, sold ? 'หมดแล้ว' : `${unit} ${price}`.trim(), w / 2, h * 0.6, w * 0.66, 92 * k, sold ? '#c4121a' : '#111', F.scrawl, seed + 3);
    return;
  }
  if (img) drawImg(ctx, img, 0, 0, w, h, 'cover');
  else { ctx.fillStyle = '#c8a77a'; ctx.fillRect(0, 0, w, h); }
  handText(ctx, name, w / 2, h * 0.33, w * 0.86, 70 * k, '#16243f', F.scrawl, seed);
  handText(ctx, sold ? 'หมดแล้ว' : `${unit} ${price}`.trim(), w / 2, h * 0.7, w * 0.9, 104 * k, '#a3121a', F.scrawl, seed + 5);
}

export function priceCardTex(style: CardStyle, name: string, unit: string, price: number, seed = 0): THREE.CanvasTexture {
  const sp = cardSpec(style, seed);
  return composed(`card:${style}:${name}:${unit}:${price}:${seed % 4}`, sp.w, sp.h, sp.base, (ctx, w, h, img) => drawCard(ctx, w, h, img, style, name, unit, price, seed), style === 'star');
}

/**
 * All price cards of one shop in ONE canvas atlas (one texture, one merged mesh → 1 draw call per
 * shop instead of one per card). Cells re-render when their photo base loads or the price changes.
 */
export class CardAtlas {
  static CW = 320; static CH = 224; static COLS = 4;
  canvas = document.createElement('canvas');
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  cells: { style: CardStyle; name: string; unit: string; price: number; seed: number; sold: boolean; hidden: boolean; key: string }[] = [];
  constructor(n: number) {
    const rows = Math.max(1, Math.ceil(n / CardAtlas.COLS));
    this.canvas.width = CardAtlas.CW * CardAtlas.COLS;
    this.canvas.height = CardAtlas.CH * rows;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
  }
  /** cell rect of the drawn card (pixels) */
  rect(i: number) {
    const c = this.cells[i];
    const sp = cardSpec(c.style);
    const s = Math.min(CardAtlas.CW / sp.w, CardAtlas.CH / sp.h);
    const w = sp.w * s, h = sp.h * s;
    const x = (i % CardAtlas.COLS) * CardAtlas.CW + (CardAtlas.CW - w) / 2, y = Math.floor(i / CardAtlas.COLS) * CardAtlas.CH + (CardAtlas.CH - h) / 2;
    return { x, y, w, h };
  }
  add(style: CardStyle, name: string, unit: string, price: number, seed: number) {
    this.cells.push({ style, name, unit, price, seed, sold: false, hidden: false, key: '' });
    const i = this.cells.length - 1;
    this.draw(i);
    return i;
  }
  /** UV rect (three.js, flipY) for cell i */
  uv(i: number) {
    const r = this.rect(i), W = this.canvas.width, H = this.canvas.height;
    return { u0: r.x / W, u1: (r.x + r.w) / W, v0: 1 - (r.y + r.h) / H, v1: 1 - r.y / H };
  }
  set(i: number, o: { price?: number; sold?: boolean; hidden?: boolean; name?: string }) {
    const c = this.cells[i];
    if (!c) return;
    Object.assign(c, Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)));
    this.draw(i);
  }
  draw(i: number) {
    const c = this.cells[i];
    const key = `${c.price}|${c.sold}|${c.hidden}|${c.name}`;
    if (key === c.key) return;
    c.key = key;
    const r = this.rect(i);
    const ctx = this.ctx;
    ctx.save();
    ctx.clearRect((i % CardAtlas.COLS) * CardAtlas.CW, Math.floor(i / CardAtlas.COLS) * CardAtlas.CH, CardAtlas.CW, CardAtlas.CH);
    if (!c.hidden) {
      const sp = cardSpec(c.style, c.seed);
      const path = photoPath(sp.base);
      const img = path ? imgCache.get(path) ?? null : null;
      if (path && imgCache.get(path) === undefined) loadImg(path).then((im) => { if (im) { c.key = ''; this.draw(i); } });
      else if (!path) loadShopManifest().then(() => { if (photoPath(sp.base)) { c.key = ''; this.draw(i); } });
      ctx.translate(r.x, r.y);
      ctx.beginPath(); ctx.rect(0, 0, r.w, r.h); ctx.clip();
      drawCard(ctx, r.w, r.h, img, c.style, c.name, c.unit, c.price, c.seed, c.sold);
    }
    ctx.restore();
    this.tex.needsUpdate = true;
  }
}

export function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r0: number, r1: number, n: number) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? r1 : r0;
    ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

/** Small hanging paper tag with the price (dangles from unpaid items). */
export function hangTagTex(price: number): THREE.CanvasTexture {
  return composed('hang:' + price, 160, 256, 'hang_tag', (ctx, w, h, img) => {
    if (img) drawImg(ctx, img, 0, 0, w, h, 'contain');
    else { ctx.fillStyle = '#e9dcc0'; ctx.fillRect(10, 30, w - 20, h - 40); }
    handText(ctx, String(price), w / 2, h * 0.58, w * 0.8, 84, '#b0121c', F.scrawl, price);
    handText(ctx, '฿', w / 2, h * 0.82, w * 0.4, 40, '#222', F.hand, price + 1);
  });
}

/** Hand-written cardboard sign (closed notes, "หมดแล้ว", shop names on stalls). */
export function signTex(key: string, lines: { text: string; size: number; color?: string; font?: string }[], base = 'card_board', w = 640, h = 400): THREE.CanvasTexture {
  return composed('sign:' + key + base, w, h, base, (ctx, W, H, img) => {
    if (img) drawImg(ctx, img, 0, 0, W, H, 'cover');
    else { ctx.fillStyle = '#b9935f'; ctx.fillRect(0, 0, W, H); }
    const tot = lines.reduce((a, l) => a + l.size * 1.15, 0);
    let y = (H - tot) / 2 + lines[0].size * 0.55;
    lines.forEach((l, i) => { handText(ctx, l.text, W / 2, y, W * 0.88, l.size, l.color ?? '#151515', l.font ?? F.scrawl, i * 7 + key.length); y += l.size * 1.15; });
  }, false);
}

/** Calculator LCD read-out (bargaining: the keeper punches the price on a real calculator). */
export function calcTex(text: string): THREE.CanvasTexture {
  return composed('calc:' + text, 256, 384, 'calculator', (ctx, w, h, img) => {
    if (img) drawImg(ctx, img, 0, 0, w, h, 'stretch');
    else { ctx.fillStyle = '#2b2b2e'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#b9c4a8'; ctx.fillRect(w * 0.1, h * 0.12, w * 0.8, h * 0.18); }
    // LCD window (the photo's own LCD area is around the top quarter)
    ctx.fillStyle = 'rgba(182,196,164,0.93)';
    ctx.fillRect(w * 0.11, h * 0.115, w * 0.78, h * 0.15);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    fitText(ctx, text, w * 0.86, h * 0.19, w * 0.7, 64, F.heavy, 800, '#1b2216');
  }, false);
}

/** Material cache. */
const mats = new Map<string, THREE.Material>();
export function mat<T extends THREE.Material>(key: string, make: () => T): T {
  let m = mats.get(key) as T;
  if (!m) { m = make(); mats.set(key, m); }
  return m;
}

/** Photo material (falls back to a flat tint until/if the photo exists). */
export function photoMat(key: string, o: { color?: number; rough?: number; alpha?: boolean; side?: THREE.Side; emissive?: number; repeat?: [number, number] } = {}) {
  return mat('photo:' + key + JSON.stringify(o), () => {
    const t = photo(key, { repeat: o.repeat });
    const m = new THREE.MeshStandardMaterial({ map: t ?? null, color: t ? 0xffffff : (o.color ?? 0x9a9488), roughness: o.rough ?? 0.75, metalness: 0, side: o.side ?? THREE.FrontSide });
    if (o.alpha) { m.alphaTest = 0.4; m.transparent = false; }
    if (o.emissive) { m.emissive = new THREE.Color(0xffffff); m.emissiveMap = t; m.emissiveIntensity = o.emissive; }
    if (!t) loadShopManifest().then(() => { const t2 = photo(key, { repeat: o.repeat }); if (t2) { m.map = t2; m.color.set(0xffffff); if (o.emissive) m.emissiveMap = t2; m.needsUpdate = true; } });
    return m;
  });
}

export function canvasMat(tex: THREE.Texture, o: { alpha?: boolean; side?: THREE.Side; rough?: number; emissive?: number } = {}) {
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: o.rough ?? 0.85, metalness: 0, side: o.side ?? THREE.DoubleSide });
  if (o.alpha) { m.alphaTest = 0.35; }
  if (o.emissive) { m.emissive = new THREE.Color(0xffffff); m.emissiveMap = tex; m.emissiveIntensity = o.emissive; }
  return m;
}
