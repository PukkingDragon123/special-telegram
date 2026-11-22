import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CharacterRig } from '../../game/contracts';

/* ============================================================================================
 * Poster studio (build-time only, see scripts/posters.mjs): renders the game's REAL 3D models
 * (characters, dishes, wok, cart) as transparent cut-outs, plus the print helpers that turn a
 * composed canvas into a printed sheet: paper fibres, halftone shadows, CMY misregistration, ink
 * wear, a real creased-paper multiply. Same method as the Gacha Garage flyers.
 * ========================================================================================== */

export interface ShotOpts {
  w: number; h: number;
  /** camera position / target (world) */
  pos: [number, number, number]; look: [number, number, number];
  fov?: number;
  /** key light position (dramatic side light by default) */
  key?: [number, number, number];
  keyCol?: number; rimCol?: number; keyI?: number; rimI?: number;
}

export class Studio {
  readonly scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(30, 1, 0.02, 80);
  private key: THREE.DirectionalLight;
  private rim: THREE.DirectionalLight;
  private rt: THREE.WebGLRenderTarget | null = null;

  constructor(private r: THREE.WebGLRenderer) {
    const pm = new THREE.PMREMGenerator(r);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    (this.scene as any).environmentIntensity = 0.6;
    this.scene.add(new THREE.HemisphereLight(0xfff2e4, 0x3a2e2a, 0.9));
    this.key = new THREE.DirectionalLight(0xfff0dc, 2.6); this.key.position.set(-1.6, 2.6, 2.6);
    this.rim = new THREE.DirectionalLight(0xc4dcff, 1.8); this.rim.position.set(2.2, 1.8, -2.4);
    const fill = new THREE.DirectionalLight(0xffd6c0, 0.45); fill.position.set(2.4, 0.6, 2);
    this.scene.add(this.key, this.rim, fill);
  }

  /** Render objects into a transparent canvas (straight alpha, sRGB). */
  shot(objs: THREE.Object3D[], o: ShotOpts): HTMLCanvasElement {
    const r = this.r, w = Math.round(o.w), h = Math.round(o.h);
    if (!this.rt || this.rt.width !== w || this.rt.height !== h) {
      this.rt?.dispose();
      this.rt = new THREE.WebGLRenderTarget(w, h, { samples: 4 });
      this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    }
    const prevParents = objs.map((ob) => ob.parent);
    for (const ob of objs) { this.scene.add(ob); ob.updateMatrixWorld(true); }
    this.key.position.set(...(o.key ?? [-1.6, 2.6, 2.6]));
    this.key.color.set(o.keyCol ?? 0xfff0dc); this.key.intensity = o.keyI ?? 2.6;
    this.rim.color.set(o.rimCol ?? 0xc4dcff); this.rim.intensity = o.rimI ?? 1.8;
    const cam = this.cam;
    cam.fov = o.fov ?? 30; cam.aspect = w / h;
    cam.position.set(...o.pos); cam.lookAt(...o.look);
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    const prevRT = r.getRenderTarget(), prevC = r.getClearColor(new THREE.Color()), prevA = r.getClearAlpha();
    const prevTone = r.toneMapping, prevExp = r.toneMappingExposure;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.scene, cam);
    const px = new Uint8Array(w * h * 4);
    r.readRenderTargetPixels(this.rt, 0, 0, w, h, px);
    r.setRenderTarget(prevRT);
    r.setClearColor(prevC, prevA);
    r.toneMapping = prevTone; r.toneMappingExposure = prevExp;
    objs.forEach((ob, i) => { this.scene.remove(ob); prevParents[i]?.add(ob); });
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d')!;
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w * 4, dst = y * w * 4;
      for (let x = 0; x < w * 4; x += 4) {
        const a = px[src + x + 3], k = a > 0 && a < 255 ? 255 / a : 1;
        img.data[dst + x] = Math.min(255, px[src + x] * k);
        img.data[dst + x + 1] = Math.min(255, px[src + x + 1] * k);
        img.data[dst + x + 2] = Math.min(255, px[src + x + 2] * k);
        img.data[dst + x + 3] = a;
      }
    }
    g.putImageData(img, 0, 0);
    return trim(c);
  }

  dispose() { this.rt?.dispose(); }
}

/** crop a transparent canvas to its opaque content (+2 px) */
export function trim(c: HTMLCanvasElement): HTMLCanvasElement {
  const g = c.getContext('2d')!;
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (d[(y * c.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return c;
  x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2); x1 = Math.min(c.width - 1, x1 + 2); y1 = Math.min(c.height - 1, y1 + 2);
  const o = document.createElement('canvas');
  o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
  o.getContext('2d')!.drawImage(c, -x0, -y0);
  return o;
}

/** Let a rig settle into its animation (clips stream in per body template: wait until it is out of the T-pose). */
export async function settle(rig: CharacterRig, seconds = 1.2, maxWaitMs = 20000) {
  const t0 = performance.now();
  const box = new THREE.Box3();
  for (;;) {
    for (let i = 0; i < 6; i++) rig.update(1 / 30);
    rig.root.updateMatrixWorld(true);
    box.setFromObject(rig.root, true);
    const w = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    if ((w < 1.15 && performance.now() - t0 > 400) || performance.now() - t0 > maxWaitMs) break;
    await new Promise((res) => setTimeout(res, 60));
  }
  const n = Math.round(seconds * 30);
  for (let i = 0; i < n; i++) rig.update(1 / 30);
  rig.root.updateMatrixWorld(true);
}

// ------------------------------------------------------------------ print helpers

export function rng(seed: number) { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0) / 4294967296); }
export function hashStr(s: string) { let x = 2166136261; for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619); return x >>> 0; }

/** cut-out with a sticker border + ink line (the meme / flyer look) */
export function sticker(g: CanvasRenderingContext2D, img: HTMLCanvasElement, x: number, y: number, w: number, o: { border?: number; borderCol?: string; ink?: number; inkCol?: string; shadow?: number } = {}) {
  const s = w / img.width, h = img.height * s;
  const pad = (o.border ?? 0) + (o.ink ?? 3) + 2;
  const c = document.createElement('canvas');
  c.width = Math.ceil(w + pad * 2); c.height = Math.ceil(h + pad * 2);
  const k = c.getContext('2d')!;
  const ring = (rad: number, col: string) => {
    if (rad <= 0) return;
    const t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
    const tg = t.getContext('2d')!;
    for (let a = 0; a < 20; a++) tg.drawImage(img, pad + Math.cos(a / 20 * Math.PI * 2) * rad, pad + Math.sin(a / 20 * Math.PI * 2) * rad, w, h);
    tg.globalCompositeOperation = 'source-in'; tg.fillStyle = col; tg.fillRect(0, 0, t.width, t.height);
    k.drawImage(t, 0, 0);
  };
  ring((o.border ?? 0) + (o.ink ?? 3), o.inkCol ?? '#120c0c');
  ring(o.border ?? 0, o.borderCol ?? '#ffffff');
  k.drawImage(img, pad, pad, w, h);
  g.save();
  if (o.shadow) { g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = o.shadow * 2; g.shadowOffsetX = o.shadow; g.shadowOffsetY = o.shadow; }
  g.drawImage(c, x - pad, y - pad);
  g.restore();
  return { w, h };
}

/** draw a cut-out scaled to width w at (x, y) (top-left); optional drop shadow / glow */
export function place(g: CanvasRenderingContext2D, img: HTMLCanvasElement, x: number, y: number, w: number, o: { shadow?: string; blur?: number; dx?: number; dy?: number; flip?: boolean; filter?: string } = {}) {
  const h = img.height * (w / img.width);
  g.save();
  if (o.shadow) { g.shadowColor = o.shadow; g.shadowBlur = o.blur ?? 18; g.shadowOffsetX = o.dx ?? 0; g.shadowOffsetY = o.dy ?? 0; }
  if (o.filter) g.filter = o.filter;
  if (o.flip) { g.translate(x + w, y); g.scale(-1, 1); g.drawImage(img, 0, 0, w, h); }
  else g.drawImage(img, x, y, w, h);
  g.restore();
  return h;
}

/** speed / sun rays from (cx, cy) */
export function rays(g: CanvasRenderingContext2D, cx: number, cy: number, n: number, r: number, col: string, a0 = 0) {
  g.save(); g.fillStyle = col;
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2, b = a + Math.PI / n;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); g.lineTo(cx + Math.cos(b) * r, cy + Math.sin(b) * r); g.closePath(); g.fill();
  }
  g.restore();
}

/** soft out-of-focus lights (concert / night market) */
export function bokeh(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number, cols: string[], n = 30, rMin = 10, rMax = 50) {
  const r = rng(seed);
  g.save();
  g.globalCompositeOperation = 'screen';
  for (let i = 0; i < n; i++) {
    const rad = rMin + r() * (rMax - rMin), cx = x + r() * w, cy = y + r() * h;
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
    const col = cols[Math.floor(r() * cols.length)];
    gr.addColorStop(0, col); gr.addColorStop(0.7, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 0.18 + r() * 0.35;
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}

export interface TextOpts {
  font: string; fill?: string | CanvasGradient; stroke?: string; sw?: number; align?: CanvasTextAlign; base?: CanvasTextBaseline;
  maxW?: number; shadow?: string; sdx?: number; sdy?: number; blur?: number; spacing?: number; skew?: number; rot?: number;
  /** a second, wider outline behind the first (layered poster lettering) */
  stroke2?: string; sw2?: number; extrude?: string; ex?: number;
}

/** poster lettering: fits maxW by squeezing horizontally (like condensed type), layered outlines + extrusion */
export function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, o: TextOpts) {
  g.save();
  g.font = o.font;
  (g as any).letterSpacing = (o.spacing ?? 0) + 'px';
  g.textAlign = o.align ?? 'center'; g.textBaseline = o.base ?? 'alphabetic';
  g.lineJoin = 'round'; g.miterLimit = 2;
  const mw = g.measureText(s).width;
  const sx = o.maxW && mw > o.maxW ? o.maxW / mw : 1;
  g.translate(x, y);
  if (o.rot) g.rotate(o.rot);
  if (o.skew) g.transform(1, 0, o.skew, 1, 0, 0);
  g.scale(sx, 1);
  if (o.extrude) { g.fillStyle = o.extrude; const n = o.ex ?? 6; for (let i = n; i > 0; i--) g.fillText(s, i * 0.7, i); }
  if (o.stroke2) { g.strokeStyle = o.stroke2; g.lineWidth = o.sw2 ?? 16; g.strokeText(s, 0, 0); }
  if (o.shadow) { g.shadowColor = o.shadow; g.shadowOffsetX = o.sdx ?? 0; g.shadowOffsetY = o.sdy ?? 4; g.shadowBlur = o.blur ?? 0; }
  if (o.stroke) { g.strokeStyle = o.stroke; g.lineWidth = o.sw ?? 8; g.strokeText(s, 0, 0); g.shadowColor = 'transparent'; }
  g.fillStyle = o.fill ?? '#fff'; g.fillText(s, 0, 0);
  g.restore();
}

/** halftone dots (multiply) over the darker parts of a region: printed-offset feel */
export function halftone(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, step = 5, strength = 0.32, angle = 0.26) {
  const src = g.getImageData(x, y, w, h);
  const d = src.data;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const k = c.getContext('2d')!;
  k.fillStyle = '#fff'; k.fillRect(0, 0, w, h);
  k.fillStyle = '#000';
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const R = Math.hypot(w, h);
  for (let v = -R; v < R; v += step) for (let u = -R; u < R; u += step) {
    const px = Math.round(w / 2 + u * ca - v * sa), py = Math.round(h / 2 + u * sa + v * ca);
    if (px < 0 || py < 0 || px >= w || py >= h) continue;
    const i = (py * w + px) * 4;
    const lum = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
    const rad = (1 - lum) * step * 0.62;
    if (rad < 0.3) continue;
    k.beginPath(); k.arc(px, py, rad, 0, Math.PI * 2); k.fill();
  }
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = strength;
  g.drawImage(c, x, y);
  g.restore();
}

/** offset-print finish: CMY misregistration, ink wear, paper fibres, creased paper multiply, edge grime, fold */
export function printFinish(g: CanvasRenderingContext2D, W: number, H: number, seed: number, paper: HTMLImageElement | null, o: { mis?: number; wear?: number; fold?: boolean; gloss?: boolean } = {}) {
  const r = rng(seed);
  // 1) misregistration: a faint shifted red/cyan copy
  const mis = o.mis ?? 2;
  if (mis > 0) {
    const copy = document.createElement('canvas'); copy.width = W; copy.height = H;
    const cg = copy.getContext('2d')!; cg.drawImage(g.canvas, 0, 0);
    const tint = (col: string, dx: number, dy: number) => {
      const t = document.createElement('canvas'); t.width = W; t.height = H;
      const tg = t.getContext('2d')!;
      tg.drawImage(copy, 0, 0); tg.globalCompositeOperation = 'multiply'; tg.fillStyle = col; tg.fillRect(0, 0, W, H);
      g.save(); g.globalCompositeOperation = 'screen'; g.globalAlpha = 0.12; g.drawImage(t, dx, dy); g.restore();
    };
    tint('#ff2a2a', mis, 0); tint('#00d8ff', -mis * 0.6, mis * 0.5);
  }
  // 2) paper fibres + grain
  g.save();
  for (let i = 0; i < 1400; i++) {
    const x = r() * W, y = r() * H, a = r() * Math.PI, l = 2 + r() * 9;
    g.strokeStyle = r() < 0.5 ? 'rgba(110,90,60,0.08)' : 'rgba(255,255,250,0.16)';
    g.lineWidth = 0.7;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  g.restore();
  // 3) ink wear: small scuffs where the ink rubbed off (lighten), denser near the edges
  const wear = o.wear ?? 0.5;
  g.save();
  g.globalCompositeOperation = 'screen';
  for (let i = 0; i < 260 * wear; i++) {
    const edge = r() < 0.6;
    const x = edge ? (r() < 0.5 ? r() * W * 0.12 : W - r() * W * 0.12) : r() * W;
    const y = edge ? r() * H : (r() < 0.5 ? r() * H * 0.1 : H - r() * H * 0.1);
    g.fillStyle = `rgba(240,232,214,${0.15 + r() * 0.35})`;
    g.beginPath(); g.ellipse(x, y, 1 + r() * 6, 0.5 + r() * 2.5, r() * 3, 0, Math.PI * 2); g.fill();
  }
  g.restore();
  // 4) the real creased paper photo (multiply) + slight warm yellowing
  if (paper) {
    g.save();
    g.globalCompositeOperation = 'multiply'; g.globalAlpha = 0.55;
    const sx = r() * paper.width * 0.25, sy = r() * paper.height * 0.25;
    g.drawImage(paper, sx, sy, paper.width * 0.75, paper.height * 0.75, 0, 0, W, H);
    g.restore();
  }
  g.save();
  g.globalCompositeOperation = 'multiply';
  const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  vg.addColorStop(0, 'rgba(255,255,255,0)'); vg.addColorStop(1, 'rgba(196,170,120,0.55)');
  g.fillStyle = vg; g.fillRect(0, 0, W, H);
  g.restore();
  // 5) a fold line across the middle (posters come folded in four)
  if (o.fold ?? true) {
    g.save();
    const fy = H * (0.48 + r() * 0.04);
    let gr = g.createLinearGradient(0, fy - 6, 0, fy + 6);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(40,30,20,0.22)'); gr.addColorStop(0.56, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, fy - 6, W, 12);
    const fx = W * (0.49 + r() * 0.02);
    gr = g.createLinearGradient(fx - 5, 0, fx + 5, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(40,30,20,0.14)'); gr.addColorStop(0.58, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(fx - 5, 0, 10, H);
    g.restore();
  }
}

/** vertical gradient fill */
export function vgrad(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, stops: [number, string][]) {
  const gr = g.createLinearGradient(0, y, 0, y + h);
  for (const [t, c] of stops) gr.addColorStop(t, c);
  g.fillStyle = gr; g.fillRect(x, y, w, h);
}

export function radial(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, inner: string, outer: string, cx = 0.5, cy = 0.45) {
  const gr = g.createRadialGradient(x + w * cx, y + h * cy, 0, x + w * cx, y + h * cy, Math.max(w, h) * 0.75);
  gr.addColorStop(0, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(x, y, w, h);
}

/** a photo texture laid over a region (cover-fit), with a colour grade */
export function photo(g: CanvasRenderingContext2D, img: HTMLImageElement | HTMLCanvasElement | null, x: number, y: number, w: number, h: number, o: { alpha?: number; filter?: string; comp?: GlobalCompositeOperation } = {}) {
  if (!img) return;
  const iw = (img as any).naturalWidth ?? img.width, ih = (img as any).naturalHeight ?? img.height;
  const s = Math.max(w / iw, h / ih), dw = iw * s, dh = ih * s;
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.globalAlpha = o.alpha ?? 1;
  if (o.filter) g.filter = o.filter;
  if (o.comp) g.globalCompositeOperation = o.comp;
  g.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  g.restore();
}
