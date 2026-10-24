import * as THREE from 'three';
import type { FaceVariant, Look } from '../../game/contracts';
import { Assets } from '../../core/assets';
import { Noise, RNG } from '../../core/rng';
import { R, Region, INSET, ATLAS, torsoT, legT, armT, neckT, footT } from './layout';
import { BodySpec, bodySpec, sleeveEnd, isTube, untucked } from './body';
import { faceEntry, TopSpec, BottomSpec } from './defs';
import { faceCanvas, hexToRgb } from './face';

/* ============================================================================================
 * ATLAS PAINTER — one texture per character: skin (+ baked AO), face photo, clothing made from
 * real fabric photographs (Poly Haven CC0 + the shared PBR library + the research agent's
 * clothing/hair photos when present), prints, details (buttons, seams, pockets, embroidery),
 * shoes, accessories, hair. Procedural drawing is only the fallback for prints.
 * ========================================================================================== */

// ------------------------------------------------------------------ fabric library (real photos)

interface Fab { path: string; tile: number; img?: HTMLImageElement | null; det?: HTMLCanvasElement; col?: HTMLCanvasElement; mean?: number }
const GEN = 'gen/characters/fab/';
export const FABRICS: Record<string, Fab> = {
  jersey: { path: 'textures/pbr/cotton_jersey/albedo.jpg', tile: 0.26 },
  melange: { path: GEN + 'jersey_melange.jpg', tile: 0.3 },
  pique: { path: GEN + 'waffle_pique_cotton.jpg', tile: 0.2 },
  rib: { path: GEN + 'ribbed_corduroy.jpg', tile: 0.16 },
  poplin: { path: GEN + 'stretch_poplin.jpg', tile: 0.25 },
  linen: { path: GEN + 'rough_linen.jpg', tile: 0.3 },
  satin: { path: GEN + 'crepe_satin.jpg', tile: 0.3 },
  jacquard: { path: GEN + 'floral_jacquard.jpg', tile: 0.35 },
  gingham: { path: GEN + 'gingham_check.jpg', tile: 0.11 },
  terry: { path: GEN + 'terry_cloth.jpg', tile: 0.2 },
  hessian: { path: GEN + 'hessian_230.jpg', tile: 0.18 },
  tatami: { path: GEN + 'tatami_mat.jpg', tile: 0.5 },
  denim: { path: 'textures/pbr/denim/albedo.jpg', tile: 0.27 },
  denim_light: { path: GEN + 'denim_fabric_03.jpg', tile: 0.27 },
  denim_black: { path: GEN + 'denim_fabric_06.jpg', tile: 0.27 },
  canvas: { path: 'textures/pbr/canvas_tarp/albedo.jpg', tile: 0.12 },
  leather: { path: 'textures/pbr/leather_black/albedo.jpg', tile: 0.4 },
  rubber: { path: 'textures/pbr/rubber_black/albedo.jpg', tile: 0.5 },
  velvet: { path: 'textures/pbr/velvet_red/albedo.jpg', tile: 0.28 },
  check_red: { path: GEN + 'check_red.jpg', tile: 0.12 },
  check_blue: { path: GEN + 'check_blue.jpg', tile: 0.12 },
  check_green: { path: GEN + 'check_green.jpg', tile: 0.12 },
  window_blue: { path: GEN + 'windowpane_blue.jpg', tile: 0.3 },
  window_red: { path: GEN + 'windowpane_red.jpg', tile: 0.3 },
  window_green: { path: GEN + 'windowpane_green.jpg', tile: 0.3 },
  herringbone: { path: GEN + 'herringbone.jpg', tile: 0.22 },
  rib_knit: { path: GEN + 'rib_knit.jpg', tile: 0.1 },
  twill_beige: { path: GEN + 'twill_beige.jpg', tile: 0.14 },
  grid_red: { path: GEN + 'grid_red.jpg', tile: 0.24 },
  stripe_check: { path: GEN + 'stripe_check.jpg', tile: 0.2 },
  quilted: { path: GEN + 'quilted.jpg', tile: 0.3 },
};

/** pick the real check/plaid photo whose colourway is closest to the wanted colour */
function hueOf(h: string) { const [r, g, b] = hexToRgb(h).map((v) => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx - mn < 0.06) return -1; let hu = mx === r ? (g - b) / (mx - mn) : mx === g ? 2 + (b - r) / (mx - mn) : 4 + (r - g) / (mx - mn); hu *= 60; if (hu < 0) hu += 360; return hu; }
function pickCheck(color: string, fam: 'check' | 'window'): { fab: string; exact: boolean } {
  const h = hueOf(color);
  const k = h < 0 ? 'blue' : h < 40 || h >= 320 ? 'red' : h < 170 ? 'green' : h < 260 ? 'blue' : 'red';
  const exact = h >= 0 && (k === 'red' ? h < 25 || h >= 335 : k === 'green' ? h > 80 && h < 160 : h > 190 && h < 250);
  return { fab: `${fam}_${k}`, exact };
}

/** research-agent photo textures (public/assets/textures/clothing|hair), by manifest id */
interface PhotoRec { id: string; img: HTMLCanvasElement; tile: number; tint: boolean; avg: [number, number, number] | null }
const PHOTO: { clothing: Record<string, PhotoRec>; hair: Record<string, PhotoRec> } = { clothing: {}, hair: {} };
/** catalogue id / pattern → candidate real-photo textures (nearest average colour wins; recoloured when far) */
const PHOTO_USE: Record<string, { ids: string[]; tile?: number; recolor?: boolean }> = {
  singlet_white: { ids: ['singlet_rib_white', 'singlet_rib_yellowed'], tile: 0.2 },
  shirt_stripe_white: { ids: ['stripe_white_grey_thin'], tile: 0.32 },
  hawaiian_green: { ids: ['hawaiian_green_leaf_ref4'], tile: 0.42 },
  hawaiian: { ids: ['hawaiian_red_hibiscus', 'hawaiian_blue_floral', 'hawaiian_sage_hibiscus', 'hawaiian_palm_sage', 'thai_songkran_floral'], tile: 0.42 },
  polo_stripe_green: { ids: ['stripe_green_white_ref4'], tile: 0.3 },
  shirt_paisley: { ids: ['paisley_blue_white'], tile: 0.3 },
  shirt_white: { ids: ['shirt_white_poplin'], tile: 0.22 },
  school_shirt: { ids: ['shirt_white_poplin'], tile: 0.22 },
  school_blouse: { ids: ['shirt_white_poplin'], tile: 0.22 },
  temple_white: { ids: ['shirt_white_poplin'], tile: 0.22 },
  dress_shirt: { ids: ['stripe_blue_shirting', 'shirt_white_poplin'], tile: 0.25 },
  suit_black: { ids: ['suit_black_wool'], tile: 0.22 },
  suit_maroon: { ids: ['casino_maroon_velvet'], tile: 0.3 },
  suit_gold: { ids: ['casino_gold_satin'], tile: 0.3 },
  moto_vest: { ids: ['vest_orange_poly'], tile: 0.25, recolor: true },
  auntie_blouse: { ids: ['auntie_blouse_pink_ditsy', 'auntie_blouse_mint_ditsy'], tile: 0.28 },
  house_dress: { ids: ['thai_songkran_floral', 'hawaiian_palm_sage', 'auntie_blouse_mint_ditsy'], tile: 0.4 },
  police_shirt: { ids: ['police_khaki_brown'], tile: 0.25 },
  rider_jacket: { ids: ['rider_green_poly', 'rider_pink_poly'], tile: 0.25, recolor: true },
  tshirt: { ids: ['jersey_grey', 'stripe_heather_wide'], tile: 0.25, recolor: true },
  polo: { ids: ['pique_white', 'stripe_green_white_pique'], tile: 0.2, recolor: true },
  boxer_plaid: { ids: ['boxer_plaid_navy_beige', 'boxer_plaid_black_white', 'boxer_plaid_navy_green'], tile: 0.3 },
  slacks: { ids: ['suit_black_wool', 'suit_grey_wool', 'police_khaki_brown', 'cotton_black', 'school_navy_twill'], tile: 0.22, recolor: true },
  khaki_pants: { ids: ['cotton_khaki_twill', 'police_khaki_brown'], tile: 0.25, recolor: true },
  cloth_shorts: { ids: ['cotton_khaki_twill', 'cotton_black', 'school_navy_twill'], tile: 0.25, recolor: true },
  shorts_school: { ids: ['school_navy_twill', 'cotton_khaki_twill'], tile: 0.25 },
  skirt_school: { ids: ['school_navy_twill', 'cotton_black'], tile: 0.25 },
  pha_khao_ma: { ids: ['phakhaoma_blue_white', 'phakhaoma_red_yellow', 'phakhaoma_rainbow', 'phakhaoma_green_yellow'], tile: 0.4 },
  sarong_m: { ids: ['sarong_red_purple', 'phakhaoma_blue_white', 'phakhaoma_green_yellow'], tile: 0.45 },
  khakuay: { ids: ['khakuay_indigo_cotton'], tile: 0.3, recolor: true },
  apron: { ids: ['apron_stained'], tile: 0.5, recolor: true },
  towel_neck: { ids: ['terry_white_headband'], tile: 0.2, recolor: true },
  headband_white: { ids: ['terry_white_headband'], tile: 0.2, recolor: true },
  sneakers: { ids: ['sneaker_white_leather'], tile: 0.25, recolor: true },
  hair_straight: { ids: ['hair_black_straight', 'hair_dyed_brown', 'hair_salt_pepper'] },
  hair_curly: { ids: ['hair_afro_black', 'hair_perm_black', 'hair_perm_light_brown', 'hair_perm_dark_burgundy'] },
  hair_buzz: { ids: ['hair_buzz_scalp'] },
};

const DET = 256;
function makeDetail(f: Fab) {
  const im = f.img!;
  const cv = document.createElement('canvas');
  cv.width = cv.height = DET;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(im, 0, 0, DET, DET);
  f.col = document.createElement('canvas');
  f.col.width = f.col.height = DET;
  f.col.getContext('2d', { willReadFrequently: true })!.drawImage(cv, 0, 0);
  const d = g.getImageData(0, 0, DET, DET);
  let sum = 0;
  const L = new Float32Array(DET * DET);
  for (let i = 0; i < L.length; i++) { const l = d.data[i * 4] * 0.299 + d.data[i * 4 + 1] * 0.587 + d.data[i * 4 + 2] * 0.114; L[i] = l; sum += l; }
  const mean = sum / L.length;
  f.mean = mean;
  for (let i = 0; i < L.length; i++) { const v = Math.max(0, Math.min(255, 128 + (L[i] - mean) * (128 / Math.max(40, mean)))); d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = v; d.data[i * 4 + 3] = 255; }
  g.putImageData(d, 0, 0);
  f.det = cv;
}

let preloadP: Promise<void> | null = null;
export function preloadFabrics(): Promise<void> {
  if (preloadP) return preloadP;
  const fabs = Object.values(FABRICS).map((f) => Assets.image(f.path).then((im) => { f.img = im; makeDetail(f); }).catch(() => { f.img = null; }));
  const clothing = Assets.jsonSafe<any>('textures/clothing/manifest.json', null).then((m) => ingestPhotoManifest(m, 'textures/clothing/', PHOTO.clothing));
  const hair = Assets.jsonSafe<any>('textures/hair/manifest.json', null).then((m) => ingestPhotoManifest(m, 'textures/hair/', PHOTO.hair));
  preloadP = Promise.all([...fabs, clothing, hair]).then(() => undefined);
  return preloadP;
}

async function ingestPhotoManifest(m: any, base: string, out: Record<string, PhotoRec>) {
  if (!m) return;
  const src = m.textures ?? m.items ?? m;
  const list: any[] = Array.isArray(src) ? src : Object.entries(src).filter(([k]) => !k.startsWith('_') && k !== 'about').map(([k, v]: any) => (typeof v === 'string' ? { id: k, file: v } : { id: k, ...(v ?? {}) }));
  await Promise.all(list.map(async (e) => {
    const file = e.file ?? e.albedo ?? e.path ?? e.image;
    if (!file || !e.id || !/tileable/.test(String(e.kind ?? 'tileable'))) return;
    const path = /^(textures|gen|https?:)/.test(file) ? file : base + file;
    try {
      const im = await Assets.image(path);
      // resample to 512² CPU canvas: cheap repeated pattern fills
      const cv = document.createElement('canvas');
      cv.width = cv.height = 512;
      cv.getContext('2d', { willReadFrequently: true })!.drawImage(im, 0, 0, 512, 512);
      let avg: number[] | null = typeof e.avgRGB === 'string' ? hexToRgb(e.avgRGB) : null;
      if (!avg) {
        const one = document.createElement('canvas'); one.width = one.height = 1;
        const g1 = one.getContext('2d', { willReadFrequently: true })!;
        g1.drawImage(cv, 0, 0, 1, 1);
        avg = Array.from(g1.getImageData(0, 0, 1, 1).data.slice(0, 3));
      }
      out[e.id] = { id: e.id, img: cv, tile: e.tileMeters ?? 0.3, tint: !!(e.tint ?? e.tintable), avg: [avg[0], avg[1], avg[2]] };
    } catch { /* missing file → keep procedural fallback */ }
  }));
}

/** nearest-colour real photo for these keys; `far` = colour distance (0..1) */
function pickPhoto(keys: string[], color: string | undefined, lib: Record<string, PhotoRec>): { rec: PhotoRec; tile: number; recolor: boolean; far: number } | null {
  for (const k of keys) {
    const use = PHOTO_USE[k];
    if (!use) continue;
    const recs = use.ids.map((id) => lib[id]).filter(Boolean);
    if (!recs.length) continue;
    const c = color ? hexToRgb(color) : null;
    let best = recs[0], bd = Infinity;
    if (c) for (const r of recs) { if (!r.avg) continue; const d = Math.hypot(r.avg[0] - c[0], r.avg[1] - c[1], r.avg[2] - c[2]) / 441; if (d < bd) { bd = d; best = r; } }
    return { rec: best, tile: use.tile ?? best.tile, recolor: !!use.recolor, far: bd === Infinity ? 0 : bd };
  }
  return null;
}

// ------------------------------------------------------------------ helpers

const NZ = new Noise('atlas');
const rgb = (h: string) => hexToRgb(h);
const css = (r: number, g: number, b: number, a = 1) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
function mix(h1: string, h2: string, t: number) { const a = rgb(h1), b = rgb(h2); return css(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t); }
function shade(h: string, k: number, a = 1) { const c = rgb(h); return css(Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k), a); }
function lum(h: string) { const c = rgb(h); return (c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114) / 255; }

let noiseTile: HTMLCanvasElement | null = null;
function noiseCanvas() {
  if (noiseTile) return noiseTile;
  const S = 256;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  const im = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    const a = u * Math.PI * 2, b = v * Math.PI * 2;
    const n = NZ.n3(Math.cos(a) * 2, Math.sin(a) * 2, Math.cos(b) * 2 + Math.sin(b) * 0.7) * 0.6 + NZ.n3(Math.cos(a) * 9 + 3, Math.sin(a) * 9, Math.sin(b) * 9) * 0.4;
    const i = (y * S + x) * 4;
    im.data[i] = im.data[i + 1] = im.data[i + 2] = 128 + n * 60; im.data[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  return (noiseTile = cv);
}

/** px per metre (virtual 1024 units) of each region: [horizontal, vertical] */
const PPM: Record<string, [number, number]> = {
  torso: [528, 542], leg: [505, 502], arm: [669, 629], neck: [505, 245], hand: [700, 400], foot: [700, 455],
  hat: [270, 500], collar: [600, 400], band: [383, 600], towel: [255, 600], mask: [590, 860], pack: [148, 274], apron: [328, 253], sole: [300, 300], ear: [600, 600], scalp: [600, 600], hair: [500, 500],
};

class Painter {
  g: CanvasRenderingContext2D;
  constructor(public cv: HTMLCanvasElement, public S: number) {
    this.g = cv.getContext('2d')!;
    const k = S / ATLAS;
    this.g.setTransform(k, 0, 0, k, 0, 0);
  }
  /** region-local rect → virtual px (extends into the inset margin at region edges) */
  rect(reg: Region, s0: number, t0: number, s1: number, t1: number): [number, number, number, number] {
    const iw = reg.w - 2 * INSET, ih = reg.h - 2 * INSET;
    const x0 = s0 <= 0 ? reg.x : reg.x + INSET + s0 * iw;
    const x1 = s1 >= 1 ? reg.x + reg.w : reg.x + INSET + s1 * iw;
    const y0 = t0 <= 0 ? reg.y : reg.y + INSET + t0 * ih;
    const y1 = t1 >= 1 ? reg.y + reg.h : reg.y + INSET + t1 * ih;
    return [x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)];
  }
  /** region-local point → virtual px */
  pt(reg: Region, s: number, t: number): [number, number] { return [reg.x + INSET + s * (reg.w - 2 * INSET), reg.y + INSET + t * (reg.h - 2 * INSET)]; }
  sx(reg: Region, ds: number) { return ds * (reg.w - 2 * INSET); }
  sy(reg: Region, dt: number) { return dt * (reg.h - 2 * INSET); }
  clipRegion(reg: Region, s0 = 0, t0 = 0, s1 = 1, t1 = 1) { const [x, y, w, h] = this.rect(reg, s0, t0, s1, t1); this.g.beginPath(); this.g.rect(x, y, w, h); this.g.clip(); }
  fill(reg: Region, color: string, s0 = 0, t0 = 0, s1 = 1, t1 = 1) { const [x, y, w, h] = this.rect(reg, s0, t0, s1, t1); this.g.fillStyle = color; this.g.fillRect(x, y, w, h); }

  /** Fill a rect with a real-photo fabric, tinted to `color`. mode: overlay (detail on colour), color (keep photo luminance), photo (as is). */
  fabric(regName: string, reg: Region, s0: number, t0: number, s1: number, t1: number, fab: string, color: string, o: { contrast?: number; mode?: 'overlay' | 'color' | 'photo' | 'multiply'; rot?: number; scale?: number; ppm?: [number, number]; noFill?: boolean } = {}) {
    const g = this.g;
    const [x, y, w, h] = this.rect(reg, s0, t0, s1, t1);
    if (w <= 0 || h <= 0) return;
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    const noFill = o.noFill ?? color === '#808080';
    if (!noFill) { g.fillStyle = color; g.fillRect(x, y, w, h); }
    const f = FABRICS[fab];
    if (f?.det) {
      const ppm = o.ppm ?? PPM[regName] ?? [500, 500];
      const sc = o.scale ?? 1;
      const m = new DOMMatrix().translate(x, y).rotate(o.rot ?? 0).scale((f.tile * ppm[0] * sc) / DET, (f.tile * ppm[1] * sc) / DET);
      const mode = o.mode ?? 'overlay';
      if (mode === 'photo' || mode === 'color') {
        const p = g.createPattern(f.col!, 'repeat')!;
        p.setTransform(m);
        g.fillStyle = p; g.fillRect(x, y, w, h);
        if (mode === 'color') {
          g.globalCompositeOperation = 'color'; g.fillStyle = color; g.fillRect(x, y, w, h);
          // match brightness of the target colour
          const k = lum(color) / Math.max(0.05, (f.mean ?? 128) / 255);
          g.globalCompositeOperation = k < 1 ? 'multiply' : 'screen';
          const kk = k < 1 ? k : Math.min(1, (k - 1) * 0.5);
          g.fillStyle = k < 1 ? css(255 * kk, 255 * kk, 255 * kk) : css(255 * kk, 255 * kk, 255 * kk);
          g.fillRect(x, y, w, h);
        }
      } else {
        const p = g.createPattern(f.det, 'repeat')!;
        p.setTransform(m);
        g.globalCompositeOperation = mode === 'multiply' ? 'multiply' : 'overlay';
        g.globalAlpha = o.contrast ?? 0.6;
        g.fillStyle = p; g.fillRect(x, y, w, h);
      }
    }
    g.restore();
  }

  /** real-photo fabric from the research agent (if any) for these keys; recoloured toward `tint` when the photo's colour is far off */
  photoPrint(keys: string[], regName: string, reg: Region, s0: number, t0: number, s1: number, t1: number, tint?: string, ppmO?: [number, number]): boolean {
    const pk = pickPhoto(keys, tint, PHOTO.clothing);
    if (!pk) return false;
    const { rec } = pk;
    const g = this.g;
    const [x, y, w, h] = this.rect(reg, s0, t0, s1, t1);
    if (w <= 0 || h <= 0) return true;
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    const p = g.createPattern(rec.img, 'repeat')!;
    const ppm = ppmO ?? PPM[regName] ?? [500, 500];
    p.setTransform(new DOMMatrix().translate(x, y).scale((pk.tile * ppm[0]) / rec.img.width, (pk.tile * ppm[1]) / rec.img.height));
    g.fillStyle = p; g.fillRect(x, y, w, h);
    if (tint && (pk.recolor || rec.tint) && pk.far > 0.12) {
      g.globalCompositeOperation = 'color'; g.fillStyle = tint; g.fillRect(x, y, w, h);
      const mean = rec.avg ? (rec.avg[0] * 0.299 + rec.avg[1] * 0.587 + rec.avg[2] * 0.114) / 255 : 0.5;
      const kk = lum(tint) / Math.max(0.05, mean);
      g.globalCompositeOperation = kk < 1 ? 'multiply' : 'screen';
      const v = kk < 1 ? 255 * kk : 255 * Math.min(1, (kk - 1) * 0.5);
      g.fillStyle = css(v, v, v); g.fillRect(x, y, w, h);
    }
    g.restore();
    return true;
  }

  noise(reg: Region, alpha: number, s0 = 0, t0 = 0, s1 = 1, t1 = 1, scale = 1) {
    const g = this.g;
    const [x, y, w, h] = this.rect(reg, s0, t0, s1, t1);
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    const p = g.createPattern(noiseCanvas(), 'repeat')!;
    p.setTransform(new DOMMatrix().translate(x, y).scale(scale, scale));
    g.globalCompositeOperation = 'overlay'; g.globalAlpha = alpha; g.fillStyle = p; g.fillRect(x, y, w, h);
    g.restore();
  }

  /** soft radial blob (AO, blush, stains) in region-local coords; r in region-local s units */
  blob(reg: Region, s: number, t: number, rs: number, rt: number, color: string, a: number, wrap = false) {
    const g = this.g;
    const draw = (ss: number) => {
      const [cx, cy] = this.pt(reg, ss, t);
      const rx = Math.max(0.5, this.sx(reg, rs)), ry = Math.max(0.5, this.sy(reg, rt));
      g.save();
      const [x, y, w, h] = this.rect(reg, 0, 0, 1, 1);
      g.beginPath(); g.rect(x, y, w, h); g.clip();
      g.translate(cx, cy); g.scale(1, ry / rx);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
      const c = rgb(color);
      gr.addColorStop(0, css(c[0], c[1], c[2], a)); gr.addColorStop(1, css(c[0], c[1], c[2], 0));
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rx, 0, Math.PI * 2); g.fill();
      g.restore();
    };
    draw(s);
    if (wrap) { if (s - rs < 0) draw(s + 1); if (s + rs > 1) draw(s - 1); }
  }

  /** horizontal band (t0..t1) across a region */
  band(reg: Region, t0: number, t1: number, color: string, a = 1, s0 = 0, s1 = 1) { const g = this.g; g.save(); g.globalAlpha = a; this.fill(reg, color, s0, t0, s1, t1); g.restore(); }

  line(reg: Region, pts: [number, number][], color: string, width: number, a = 1, dash?: number[]) {
    const g = this.g;
    g.save(); g.globalAlpha = a; g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round'; g.lineJoin = 'round';
    if (dash) g.setLineDash(dash);
    g.beginPath();
    pts.forEach(([s, t], i) => { const [x, y] = this.pt(reg, s, t); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke(); g.restore();
  }

  dot(reg: Region, s: number, t: number, r: number, color: string, hi?: string) {
    const g = this.g;
    const [x, y] = this.pt(reg, s, t);
    g.fillStyle = color; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    if (hi) { g.fillStyle = hi; g.beginPath(); g.arc(x - r * 0.3, y - r * 0.3, r * 0.4, 0, Math.PI * 2); g.fill(); }
  }

  text(reg: Region, s: number, t: number, str: string, font: string, size: number, color: string, o: { stroke?: string; sw?: number; rot?: number; sy?: number; align?: CanvasTextAlign } = {}) {
    const g = this.g;
    const [x, y] = this.pt(reg, s, t);
    g.save(); g.translate(x, y); if (o.rot) g.rotate(o.rot); g.scale(1, o.sy ?? 1);
    g.font = `${size}px ${font}, "Sarabun", sans-serif`; g.textAlign = o.align ?? 'center'; g.textBaseline = 'middle';
    if (o.stroke) { g.strokeStyle = o.stroke; g.lineWidth = o.sw ?? 3; g.lineJoin = 'round'; g.strokeText(str, 0, 0); }
    g.fillStyle = color; g.fillText(str, 0, 0);
    g.restore();
  }
}

// ------------------------------------------------------------------ public: paint

const LOOPED = { hand: '"Sriracha"', fun: '"Itim"', round: '"Mali"', block: '"Chonburi"', bubbly: '"Pattaya"', body: '"Noto Sans Thai Looped"' };

export function lookKey(look: Look) {
  return JSON.stringify([look.sex, Math.round((look.build ?? 0.4) * 8), look.skin, look.face, look.hair, look.top, look.bottom, look.shoes, [...(look.acc ?? [])].sort(), (look as any).arch ?? '']);
}

export function paintAtlas(look: Look, size: number, variant: FaceVariant, onFaceReady?: () => void): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  // CPU-backed canvas: predictable paint cost (no per-blend-mode GPU shader compiles), cheap readbacks for face tinting
  cv.getContext('2d', { willReadFrequently: true });
  const P = new Painter(cv, size);
  const spec = bodySpec(look);
  const skin = look.skin || '#c69472';
  const r = new RNG(hashStr(lookKey(look)));
  paintSkin(P, look, spec, skin);
  paintFace(P, look, skin, variant, onFaceReady);
  paintScalp(P, look, skin);
  paintBottom(P, look, spec, skin, r);
  paintTop(P, look, spec, skin, r);
  paintShoes(P, look, spec, skin);
  paintAcc(P, look, spec, skin, r);
  paintHair(P, look, r);
  paintGrime(P, look, spec, r);
  return cv;
}

/** Repaint only the face rect of an existing atlas canvas (face variant swap / photo arrival). */
export function repaintFace(cv: HTMLCanvasElement, look: Look, variant: FaceVariant, onFaceReady?: () => void) {
  const P = new Painter(cv, cv.width);
  paintFace(P, look, look.skin || '#c69472', variant, onFaceReady);
}

function hashStr(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// ------------------------------------------------------------------ skin

function paintSkin(P: Painter, look: Look, spec: BodySpec, skin: string) {
  const g = P.g;
  g.fillStyle = skin;
  g.fillRect(0, 0, ATLAS, ATLAS);
  const dark = shade(skin, 0.62);
  const AO = (reg: Region, s: number, t: number, rs: number, rt: number, a: number, wrap = false) => P.blob(reg, s, t, rs, rt, rgbHex(shade(skin, 0.55)), a, wrap);
  // body form shading (zero-mean-ish noise + AO)
  for (const reg of [R.torso, R.leg, R.arm, R.neck, R.hand, R.foot, R.scalp, R.ear]) P.noise(reg, 0.16, 0, 0, 1, 1, 0.6);
  // torso: armpits, under chest, navel, back crease, crotch
  const tc = torsoT(1.3), ta = torsoT(1.36);
  AO(R.torso, 0.25, ta, 0.06, 0.08, 0.5); AO(R.torso, 0.75, ta, 0.06, 0.08, 0.5);
  if (spec.sex === 'm') { for (const s of [0.43, 0.57]) { AO(R.torso, s, tc + 0.02, 0.05, 0.02, 0.25); P.dot(R.torso, s, tc - 0.01, 1.4, shade(skin, 0.72)); } }
  else { AO(R.torso, 0.5, torsoT(1.24), 0.09, 0.035, 0.35); }
  P.blob(R.torso, 0.5, torsoT(1.05), 0.012, 0.012, rgbHex(dark), 0.7);
  AO(R.torso, 0.5, torsoT(1.0) + (spec.build - 0.4) * 0.05, 0.12, 0.03, spec.build * 0.35);
  AO(R.torso, 0.0, 0.7, 0.03, 0.3, 0.2, true); // spine groove
  AO(R.torso, 0.5, 0.98, 0.12, 0.05, 0.45); AO(R.torso, 0.0, 0.96, 0.08, 0.05, 0.4, true);
  // collarbones / neck base
  for (const s of [0.42, 0.58]) P.line(R.torso, [[0.5, torsoT(1.43)], [s + (s - 0.5) * 1.2, torsoT(1.425)]], shade(skin, 0.8), 2, 0.35);
  // legs: knees, inner thigh, shins
  AO(R.leg, 0.5, legT(0.5), 0.07, 0.03, 0.18); P.blob(R.leg, 0.5, legT(0.47), 0.05, 0.02, rgbHex(shade(skin, 1.12)), 0.25);
  AO(R.leg, 0.25, legT(0.9), 0.08, 0.1, 0.35); AO(R.leg, 0.0, legT(0.46), 0.08, 0.03, 0.35, true);
  // arms: elbow crease (front), armpit top
  AO(R.arm, 0.75, armT(0.29), 0.06, 0.02, 0.35); AO(R.arm, 0.0, armT(0.0), 0.1, 0.08, 0.4, true);
  // neck: under the jaw, adam's apple
  AO(R.neck, 0.5, 0.0, 0.3, 0.35, 0.45, true);
  if (spec.sex === 'm') AO(R.neck, 0.5, neckT(1.5), 0.04, 0.12, 0.25);
  // hands: knuckles, finger lines, nails
  const hk = R.hand;
  for (const s of [0.42, 0.5, 0.58]) P.line(hk, [[s, 0.62], [s, 0.98]], shade(skin, 0.6), 1.4, 0.55);
  for (const s of [0.38, 0.46, 0.54, 0.62]) P.dot(hk, s, 0.52, 1.6, shade(skin, 0.8));
  for (const s of [0.39, 0.46, 0.54, 0.61]) P.blob(hk, s, 0.94, 0.03, 0.04, '#f2d0c0', 0.55);
  AO(hk, 0.0, 0.6, 0.15, 0.4, 0.25, true);
  // feet: toes & nails (top of the foot is s≈0.5, toes at t→1)
  const fk = R.foot;
  for (const s of [0.42, 0.48, 0.54, 0.6]) P.line(fk, [[s, 0.86], [s, 0.99]], shade(skin, 0.65), 1.2, 0.5);
  for (const s of [0.4, 0.46, 0.52, 0.57, 0.62]) P.blob(fk, s, 0.94, 0.022, 0.03, '#efd2c2', 0.5);
  P.band(fk, 0, 1, shade(skin, 0.78), 0.45, 0, 0.12); P.band(fk, 0, 1, shade(skin, 0.78), 0.45, 0.88, 1);
  // ears
  P.blob(R.ear, 0.55, 0.5, 0.25, 0.3, rgbHex(shade(skin, 0.6)), 0.55);
  P.blob(R.ear, 0.85, 0.5, 0.2, 0.5, rgbHex(shade(skin, 1.1, 1)), 0.3);
  void look;
}

function rgbHex(c: string) {
  const m = /rgba?\((\d+),(\d+),(\d+)/.exec(c.replace(/\s/g, ''));
  if (!m) return c;
  return '#' + [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, '0')).join('');
}

// ------------------------------------------------------------------ face & scalp

function paintFace(P: Painter, look: Look, skin: string, variant: FaceVariant, onReady?: () => void) {
  const f = faceEntry(look.face, look.sex === 'f' ? 'f' : 'm');
  const img = faceCanvas(f, variant, skin, onReady);
  P.fill(R.face, skin);
  const [x, y] = P.pt(R.face, 0, 0);
  const g = P.g;
  g.drawImage(img, x, y, R.face.w - 2 * INSET, R.face.h - 2 * INSET);
}

function paintScalp(P: Painter, look: Look, skin: string) {
  const style = look.hair?.style ?? 'short';
  const hc = look.hair?.color ?? '#141110';
  if (style === 'shaved') {
    P.blob(R.scalp, 0.5, 0.25, 0.6, 0.5, rgbHex(mix(skin, '#3a3a40', 0.35)), 0.55);
    // faint stubble also at the top of the face rect (above the forehead)
    P.band(R.face, 0, 0.06, mix(skin, '#45454c', 0.18), 0.6);
    return;
  }
  if (style === 'bald') {
    P.blob(R.scalp, 0.5, 0.55, 0.6, 0.25, hc, 0.6);
    return;
  }
  // under the hair: dark scalp so gaps never show skin; soft nape hairline
  const g = P.g;
  const [x, y, w, h] = P.rect(R.scalp, 0, 0, 1, 1);
  const gr = g.createLinearGradient(0, y, 0, y + h);
  const c = rgb(hc);
  const endT = style === 'afro' || style === 'long' || style === 'shaggy' || style === 'bob' || style === 'mullet' ? 0.85 : 0.68;
  gr.addColorStop(0, css(c[0], c[1], c[2], 0.95)); gr.addColorStop(endT - 0.12, css(c[0], c[1], c[2], 0.9)); gr.addColorStop(endT, css(c[0], c[1], c[2], 0));
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  P.noise(R.scalp, 0.3, 0, 0, 1, endT);
}

// ------------------------------------------------------------------ bottoms

function paintBottom(P: Painter, look: Look, spec: BodySpec, skin: string, r: RNG) {
  const b = spec.bottom;
  const col = look.bottom?.color ?? b.color;
  const c2 = b.color2 ?? '#f2efe8';
  const tw = torsoT(b.waist);
  const tube = isTube(b);
  const legEnd = b.kind === 'trousers' ? 1 : legT(b.hem);
  const regions: [string, Region, number, number][] = [['torso', R.torso, tw, 1]];
  if (!tube) regions.push(['leg', R.leg, 0, legEnd]);
  else regions.push(['skirt', R.skirt as Region, 0, 1]);
  const skirtPPM: [number, number] = [312, 190 / Math.max(0.3, b.waist - b.hem)];
  for (const [rn, reg, t0, t1] of regions) {
    const ppm = rn === 'skirt' ? skirtPPM : undefined;
    baseBottomFabric(P, b, rn, reg, t0, t1, col, c2, ppm);
  }
  const T = R.torso, L = R.leg;
  // waistband
  if (!tube) {
    if (b.pattern === 'denim' || b.pattern === 'denim_light' || b.pattern === 'twill_fine' || b.pattern === 'twill' && b.kind === 'trousers') {
      // belt + loops + buckle
      const bt0 = tw - 0.004, bt1 = tw + 0.045;
      P.fabric('torso', T, 0, bt0, 1, bt1, 'leather', b.pattern === 'twill' ? '#5a3a22' : '#231a14', { contrast: 0.5 });
      P.line(T, [[0, bt0 + 0.004], [1, bt0 + 0.004]], 'rgba(255,255,255,0.15)', 1.2);
      const [bx, by] = P.pt(T, 0.5, (bt0 + bt1) / 2);
      const g = P.g;
      g.fillStyle = '#b8a070'; g.fillRect(bx - 9, by - 8, 18, 16); g.fillStyle = '#3a2a18'; g.fillRect(bx - 5, by - 4, 10, 8);
      for (const s of [0.36, 0.64, 0.12, 0.88]) P.band(T, bt0 - 0.005, bt1 + 0.005, shade(col, 0.85), 1, s - 0.006, s + 0.006);
    } else {
      // elastic waistband (+ drawstring for shorts)
      P.band(T, tw, tw + 0.05, shade(col, 0.82), 1);
      for (let i = 0; i < 6; i++) P.line(T, [[0, tw + 0.006 + i * 0.008], [1, tw + 0.006 + i * 0.008]], shade(col, 0.68), 0.8, 0.5);
      if (b.kind === 'shorts') { P.line(T, [[0.49, tw + 0.03], [0.47, tw + 0.12]], '#f2efe6', 2.2); P.line(T, [[0.51, tw + 0.03], [0.53, tw + 0.11]], '#f2efe6', 2.2); }
    }
  }
  if (b.kind === 'trousers' || b.kind === 'shorts') {
    // fly, pockets, seams
    const denim = b.pattern.startsWith('denim');
    const stitch = denim ? '#c8923a' : shade(col, 0.6);
    if (b.pattern !== 'mesh' && b.pattern !== 'elephant' && b.pattern !== 'plaid') {
      P.line(T, [[0.5, tw + 0.05], [0.5, 0.9]], shade(col, 0.55), 1.6, 0.8);
      P.line(T, [[0.52, tw + 0.05], [0.52, 0.85], [0.5, 0.9]], stitch, 1, 0.8, [3, 2]);
      for (const sd of [-1, 1]) {
        P.line(T, [[0.5 + sd * 0.13, tw + 0.05], [0.5 + sd * 0.19, tw + 0.22], [0.5 + sd * 0.25, tw + 0.25]], shade(col, 0.5), 1.6, 0.85);
        if (denim) P.line(T, [[0.5 + sd * 0.12, tw + 0.06], [0.5 + sd * 0.18, tw + 0.23]], stitch, 1, 0.8, [3, 2]);
        // back pockets
        const bs = sd < 0 ? 0.07 : 0.93;
        P.line(T, [[bs - 0.05, tw + 0.1], [bs + 0.05, tw + 0.1], [bs + 0.045, tw + 0.32], [bs, tw + 0.36], [bs - 0.045, tw + 0.32], [bs - 0.05, tw + 0.1]], shade(col, 0.55), 1.4, 0.8);
        if (denim) P.line(T, [[bs - 0.035, tw + 0.2], [bs, tw + 0.16], [bs + 0.035, tw + 0.2]], stitch, 1, 0.85);
      }
    }
    // leg side seams (outer at s=.75, inner at s=.25)
    if (!tube) {
      P.line(L, [[0.75, 0], [0.75, legEnd]], shade(col, 0.6), 1.4, 0.7);
      P.line(L, [[0.25, 0], [0.25, legEnd]], shade(col, 0.6), 1.2, 0.5);
      if (denim) { P.line(L, [[0.765, 0], [0.765, legEnd]], stitch, 0.9, 0.7, [3, 2]); }
      // knee fading & creases
      if (denim) { P.blob(L, 0.5, legT(0.5), 0.12, 0.08, '#ffffff', 0.13); P.blob(L, 0.5, legT(0.78), 0.12, 0.12, '#ffffff', 0.08); for (let i = 0; i < 4; i++) P.line(L, [[0.42, legT(0.84) + i * 0.012], [0.58, legT(0.845) + i * 0.012]], shade(col, 0.7), 1, 0.35); }
      if (b.pattern === 'twill_fine') P.line(L, [[0.5, legT(0.85)], [0.5, legEnd]], shade(col, 1.25), 1.2, 0.45); // crease
      // hem
      const ht = legT(b.hem);
      P.band(L, ht - 0.018, Math.min(1, ht + 0.004), shade(col, 0.82), 1);
      P.line(L, [[0, ht - 0.016], [1, ht - 0.016]], b.pattern.startsWith('denim') ? stitch : shade(col, 0.6), 1, 0.8, [3, 2]);
      if (b.pattern === 'mesh') { P.band(L, 0.0, ht, c2, 1, 0.72, 0.78); P.band(L, 0, ht, c2, 1, 0.22, 0.28); }
      // skin below shorts gets AO under the hem
      if (b.kind === 'shorts') P.band(L, ht, ht + 0.03, shade(skin, 0.72), 0.35);
    }
  }
  if (tube) {
    const S = R.skirt as Region;
    if (b.pattern === 'pleat') for (let i = 0; i < 28; i++) { const s = i / 28; P.line(S, [[s, 0.08], [s, 1]], shade(col, 0.65), 1.4, 0.6); P.line(S, [[s + 0.006, 0.08], [s + 0.006, 1]], shade(col, 1.25), 1, 0.4); }
    if (b.kind === 'wrap') {
      // wrap fold + knot at the front waist
      P.line(S, [[0.56, 0], [0.6, 1]], shade(col, 0.55), 2, 0.6);
      P.band(S, 0, 0.09, shade(col, 0.85), 1);
      P.blob(S, 0.52, 0.06, 0.03, 0.05, rgbHex(shade(col, 0.6)), 0.6);
      for (let i = 0; i < 5; i++) P.line(S, [[0.47 + i * 0.012, 0.09], [0.45 + i * 0.016, 0.4 + r.next() * 0.2]], shade(col, 0.7), 1.2, 0.35);
      P.band(T, tw, tw + 0.07, shade(col, 0.85), 1);
    }
    P.band(S, 0.96, 1, shade(col, 0.75), 1);
  }
}

function baseBottomFabric(P: Painter, b: BottomSpec, rn: string, reg: Region, t0: number, t1: number, col: string, c2: string, ppm?: [number, number]) {
  const ids = [b.id, b.pattern];
  if (P.photoPrint(ids, rn, reg, 0, t0, 1, t1, col, ppm)) return;
  switch (b.pattern) {
    case 'denim': P.fabric(rn, reg, 0, t0, 1, t1, lum(col) < 0.12 ? 'denim_black' : 'denim', col, { mode: 'color', ppm }); break;
    case 'denim_light': P.fabric(rn, reg, 0, t0, 1, t1, 'denim_light', col, { mode: 'color', ppm }); break;
    case 'plaid': case 'checker': {
      // real woven check photographs (Poly Haven fabric_pattern_07 colourways), recoloured only when needed
      const pc = pickCheck(col, 'check');
      P.fabric(rn, reg, 0, t0, 1, t1, pc.fab, col, { mode: pc.exact ? 'photo' : 'color', scale: b.pattern === 'checker' ? 1.7 : 1.15, ppm });
      if (b.pattern === 'checker') {
        // pha khao ma: a second-colour overcheck stripe every few checks
        const g = P.g; const [x, y, w, h] = P.rect(reg, 0, t0, 1, t1); const pp = ppm ?? PPM[rn] ?? [500, 500];
        g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.globalAlpha = 0.45; g.fillStyle = c2;
        const st = 0.16 * pp[0], sy = 0.16 * pp[1];
        for (let xx = x + st * 0.3; xx < x + w; xx += st) g.fillRect(xx, y, st * 0.1, h);
        for (let yy = y + sy * 0.3; yy < y + h; yy += sy) g.fillRect(x, yy, w, sy * 0.1);
        g.restore();
      }
      break;
    }
    case 'sarong_plaid': {
      const pc = pickCheck(col, 'check');
      P.fabric(rn, reg, 0, t0, 1, t1, pc.fab, col, { mode: 'color', scale: 2.4, ppm });
      const pw = pickCheck(c2, 'window');
      P.fabric(rn, reg, 0, t0, 1, t1, pw.fab, '#808080', { mode: 'multiply', contrast: 0.35, scale: 1.4, ppm });
      break;
    }
    case 'twill': P.fabric(rn, reg, 0, t0, 1, t1, 'twill_beige', col, { mode: 'color', ppm }); P.noise(reg, 0.12, 0, t0, 1, t1); break;
    case 'twill_fine': P.fabric(rn, reg, 0, t0, 1, t1, 'herringbone', col, { contrast: 0.35, ppm }); break;
    case 'mesh': P.fabric(rn, reg, 0, t0, 1, t1, 'pique', col, { contrast: 0.55, ppm, scale: 0.6 }); break;
    case 'batik': paintBatik(P, rn, reg, t0, t1, col, c2, ppm); break;
    case 'elephant': P.fabric(rn, reg, 0, t0, 1, t1, 'linen', col, { contrast: 0.5, ppm }); paintElephants(P, rn, reg, t0, t1, c2, ppm, 0.11); break;
    case 'pleat': case 'plain_fabric': P.fabric(rn, reg, 0, t0, 1, t1, 'poplin', col, { contrast: 0.5, ppm }); break;
    case 'robe': P.fabric(rn, reg, 0, t0, 1, t1, 'linen', col, { contrast: 0.7, ppm }); break;
    default: P.fabric(rn, reg, 0, t0, 1, t1, 'jersey', col, { contrast: 0.5, ppm });
  }
}

// ------------------------------------------------------------------ tops

function paintTop(P: Painter, look: Look, spec: BodySpec, skin: string, r: RNG) {
  const top = spec.top, bot = spec.bottom;
  const col = look.top?.color ?? top.color;
  const c2 = top.color2 ?? '#f2efe8';
  const T = R.torso, A = R.arm;
  const tHem = top.hem <= 0.8 ? 1 : torsoT(top.hem);
  const se = sleeveEnd(top);
  const tSleeve = se > 0 ? armT(se) : -1;
  baseTopFabric(P, top, 'torso', T, 0, tHem, col, c2, r);
  if (tSleeve > 0) baseTopFabric(P, top, 'arm', A, 0, tSleeve, col, c2, r);
  // collar strip (geometry)
  baseTopFabric(P, top, 'collar', R.collar, 0, 1, top.pattern === 'polo_stripe' ? c2 : col, c2, r);
  const neckF = torsoT(1.44), neckB = torsoT(1.465);
  const neckline = (front: number, back: number, color: string) => {
    // paint skin above a smooth neckline curve (front lower)
    const g = P.g;
    g.save();
    P.clipRegion(T, 0, 0, 1, 0.6);
    g.fillStyle = color;
    g.beginPath();
    const [x0, y0] = P.pt(T, 0, 0);
    g.moveTo(x0 - 10, y0 - 10);
    for (let i = 0; i <= 48; i++) {
      const s = i / 48;
      const k = Math.pow(Math.cos((s - 0.5) * Math.PI) ** 2, 1.4); // 1 at front, 0 at back
      const t = back + (front - back) * k;
      const [x, y] = P.pt(T, s, t);
      g.lineTo(x, y);
    }
    const [x1] = P.pt(T, 1, 0);
    g.lineTo(x1 + 10, y0 - 10);
    g.closePath(); g.fill();
    g.restore();
  };
  const collarBand = (front: number, back: number, color: string, w = 0.012) => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 48; i++) { const s = i / 48; const k = Math.pow(Math.cos((s - 0.5) * Math.PI) ** 2, 1.4); pts.push([s, back + (front - back) * k + w * 0.5]); }
    P.line(T, pts, color, P.sy(T, w) * 1.0, 1);
  };
  switch (top.collar) {
    case 'crew': neckline(neckF + 0.005, neckB, skin); collarBand(neckF + 0.005, neckB, shade(col, 0.88), 0.016); break;
    case 'vneck': neckline(torsoT(1.39), neckB, skin); break;
    case 'scoop': neckline(torsoT(top.sleeve === 'none' ? 1.34 : 1.4), torsoT(1.43), skin); if (top.pattern === 'rib') collarBand(torsoT(1.34), torsoT(1.43), shade(col, 0.93), 0.01); break;
    case 'polo': case 'shirt': case 'mandarin': neckline(neckF + 0.004, neckB, skin); break;
    case 'camp': neckline(neckF, neckB, skin); break;
    case 'suit': neckline(neckF, neckB, skin); break;
    case 'robe': break;
    default: neckline(neckF, neckB, skin);
  }
  // armholes for sleeveless tops (straps over the shoulders)
  if (top.sleeve === 'none' && top.collar !== 'robe') {
    for (const s of [0.25, 0.75]) {
      P.blob(T, s, torsoT(1.4), 0.135, 0.17, rgbHex(skin), 1);
      P.blob(T, s, torsoT(1.38), 0.12, 0.14, rgbHex(skin), 1);
    }
    // re-establish the straps' fabric edge with a little shade
    for (const s of [0.25, 0.75]) P.blob(T, s, torsoT(1.29), 0.06, 0.03, rgbHex(shade(col, 0.8)), 0.4);
  }
  // details by type
  const front = 0.5;
  const placket = (t0: number, t1: number, n: number, btn = '#efece4') => {
    P.band(T, t0, t1, shade(col, 0.95), 1, front - 0.018, front + 0.018);
    P.line(T, [[front - 0.018, t0], [front - 0.018, t1]], shade(col, 0.72), 1.1, 0.8);
    P.line(T, [[front + 0.018, t0], [front + 0.018, t1]], shade(col, 0.8), 0.9, 0.6);
    for (let i = 0; i < n; i++) P.dot(T, front, t0 + 0.02 + ((t1 - t0 - 0.03) * i) / Math.max(1, n - 1), 2.6, btn, 'rgba(255,255,255,0.5)');
  };
  const pocket = (s: number, t: number, w = 0.06, h = 0.09) => {
    P.line(T, [[s - w / 2, t], [s - w / 2, t + h], [s + w / 2, t + h], [s + w / 2, t]], shade(col, 0.72), 1.3, 0.8);
    P.line(T, [[s - w / 2, t + 0.008], [s + w / 2, t + 0.008]], shade(col, 0.75), 1, 0.6);
  };
  const tH = tHem;
  switch (top.pattern) {
    case 'polo_stripe': case 'pique': placket(neckF, torsoT(1.33), 3); break;
    case 'oxford': case 'satin': case 'satin_plain': case 'white_blouse': case 'police': case 'security': case 'school': case 'school_girl':
      placket(neckF, tH, Math.max(3, Math.round((tH - neckF) / 0.09))); if (top.pattern !== 'satin' && top.pattern !== 'white_blouse' && top.pattern !== 'satin_plain') pocket(0.6, torsoT(1.33)); break;
    case 'hawaiian': {
      // open shirt over a white undershirt
      const und = top.under ?? '#f4f2ec';
      const g = P.g; g.save(); P.clipRegion(T, 0, 0, 1, tH);
      g.fillStyle = und;
      g.beginPath();
      const p1 = P.pt(T, 0.5 - 0.07, neckF - 0.01), p2 = P.pt(T, 0.5 + 0.07, neckF - 0.01), p3 = P.pt(T, 0.5 + 0.035, tH), p4 = P.pt(T, 0.5 - 0.035, tH);
      g.moveTo(...p1); g.lineTo(...p2); g.lineTo(...p3); g.lineTo(...p4); g.closePath(); g.fill(); g.restore();
      P.fabric('torso', T, 0.43, neckF - 0.01, 0.57, tH, 'jersey', und, { contrast: 0.4, mode: 'overlay' });
      // re-cut with the shirt fronts (lapels)
      for (const sd of [-1, 1]) P.line(T, [[0.5 + sd * 0.07, neckF - 0.01], [0.5 + sd * 0.045, torsoT(1.32)], [0.5 + sd * 0.036, tH]], shade(col, 0.6), 2, 0.9);
      P.line(T, [[0.43, neckF + 0.005], [0.57, neckF + 0.005]], und, 3, 1);
      neckline(neckF + 0.01, neckB, skin);
      break;
    }
    case 'suit': case 'suit_shiny': {
      // white shirt + tie in the lapel V, lapels, buttons, pocket square
      const vb = torsoT(1.18);
      const g = P.g; g.save(); P.clipRegion(T, 0, 0, 1, 1);
      g.fillStyle = c2 === '#1d1d1f' ? '#f3f1ec' : c2;
      g.beginPath();
      const a1 = P.pt(T, 0.5 - 0.085, neckF - 0.02), a2 = P.pt(T, 0.5 + 0.085, neckF - 0.02), a3 = P.pt(T, 0.5, vb);
      g.moveTo(...a1); g.lineTo(...a2); g.lineTo(...a3); g.closePath(); g.fill();
      const tie = top.id === 'suit_gold' ? '#1d1d1f' : '#7a1622';
      g.fillStyle = tie;
      const k1 = P.pt(T, 0.5 - 0.012, neckF + 0.01), k2 = P.pt(T, 0.5 + 0.012, neckF + 0.01), k3 = P.pt(T, 0.5 + 0.02, vb - 0.02), k4 = P.pt(T, 0.5, vb + 0.005), k5 = P.pt(T, 0.5 - 0.02, vb - 0.02);
      g.beginPath(); g.moveTo(...k1); g.lineTo(...k2); g.lineTo(...k3); g.lineTo(...k4); g.lineTo(...k5); g.closePath(); g.fill();
      g.restore();
      for (const sd of [-1, 1]) {
        P.line(T, [[0.5 + sd * 0.085, neckF - 0.02], [0.5 + sd * 0.11, torsoT(1.34)], [0.5 + sd * 0.0, vb]], shade(col, 0.55), 2.2, 0.9);
        P.line(T, [[0.5 + sd * 0.11, torsoT(1.34)], [0.5 + sd * 0.135, torsoT(1.36)]], shade(col, 0.55), 1.6, 0.9);
      }
      for (const t of [torsoT(1.1), torsoT(1.02)]) P.dot(T, 0.5, t, 3, shade(col, 0.5), 'rgba(255,255,255,0.3)');
      P.line(T, [[0.5, vb], [0.5, 1]], shade(col, 0.5), 1.6, 0.8);
      P.band(T, torsoT(1.33), torsoT(1.31), '#f4f2ee', 1, 0.58, 0.64);
      for (const s of [0.37, 0.63]) P.line(T, [[s - 0.04, torsoT(1.0)], [s + 0.04, torsoT(1.0)]], shade(col, 0.5), 1.5, 0.8);
      // white cuffs
      P.band(A, armT(0.5), armT(0.535), '#f3f1ec', 1);
      break;
    }
    case 'moto_vest': {
      // the shirt underneath shows on the arms and shoulder tops; vest number on the back
      const shirt = c2;
      P.fabric('arm', A, 0, 0, 1, tSleeve, 'poplin', shirt, { contrast: 0.45 });
      for (const s of [0.25, 0.75]) P.blob(T, s, torsoT(1.39), 0.11, 0.13, rgbHex(shirt), 1);
      neckline(torsoT(1.38), neckB, rgbHex(shirt));
      neckline(neckF + 0.004, neckB + 0.01, skin);
      P.band(T, torsoT(1.12), torsoT(1.08), '#d9dcd8', 0.9, 0, 1); // reflective strip
      // back number plate (back = s 0/1)
      const num = String(1 + (hashStr(lookKey(look)) % 49));
      for (const s of [0.0, 1.0]) {
        const [cx, cy] = P.pt(T, s, torsoT(1.24));
        const g = P.g; g.save(); P.clipRegion(T);
        g.fillStyle = '#f4f2ea'; g.beginPath(); (g as any).roundRect?.(cx - 34, cy - 30, 68, 56, 10); g.fill();
        g.restore();
        P.text(T, s, torsoT(1.24) + 0.002, num, LOOPED.block, 40, '#1d1d1f');
        P.text(T, s, torsoT(1.34), 'วินเฮียผัด', LOOPED.fun, 22, '#1d1d1f');
      }
      P.text(T, 0.62, torsoT(1.3), num, LOOPED.block, 18, '#1d1d1f');
      break;
    }
    case 'school': case 'school_girl': break;
    case 'rider': {
      P.band(T, torsoT(1.24), torsoT(1.21), '#d6d8d4', 1); P.band(A, armT(0.2), armT(0.23), '#d6d8d4', 1);
      for (const sd of [0.25, 0.75]) P.band(T, 0.15, tH, c2, 1, sd - 0.05, sd + 0.05);
      P.line(T, [[0.5, neckF], [0.5, tH]], '#1d1d1f', 2.2, 0.9);
      P.text(T, 0.0, torsoT(1.3), 'หิวส่งไว', LOOPED.block, 30, '#f4f2ea', { stroke: shade(col, 0.5), sw: 3 });
      P.text(T, 1.0, torsoT(1.3), 'หิวส่งไว', LOOPED.block, 30, '#f4f2ea', { stroke: shade(col, 0.5), sw: 3 });
      P.text(T, 0.62, torsoT(1.32), 'หิวส่งไว', LOOPED.block, 12, '#f4f2ea');
      P.band(A, armT(0.5), armT(0.535), '#1d1d1f', 1);
      break;
    }
    case 'sweeper': {
      for (const t of [torsoT(1.25), torsoT(1.1)]) P.band(T, t, t + 0.035, c2, 1);
      P.band(A, armT(0.3), armT(0.33), c2, 1);
      P.text(T, 0.0, torsoT(1.34), 'เขตเฮียผัด', LOOPED.block, 22, '#1d1d1f');
      P.text(T, 1.0, torsoT(1.34), 'เขตเฮียผัด', LOOPED.block, 22, '#1d1d1f');
      break;
    }
    case 'robe': {
      // saffron robe over the left shoulder: right shoulder & upper right chest bare
      P.blob(T, 0.25, torsoT(1.4), 0.17, 0.26, rgbHex(skin), 1);
      P.blob(T, 0.32, torsoT(1.33), 0.1, 0.12, rgbHex(skin), 1);
      for (let i = 0; i < 9; i++) { const t = torsoT(1.42) + i * 0.07; P.line(T, [[0.66, t - 0.08], [0.3, t + 0.12]], shade(col, 0.72), 2.4, 0.5); }
      P.line(T, [[0.72, torsoT(1.46)], [0.38, torsoT(1.0)]], shade(col, 0.6), 3, 0.7);
      break;
    }
    default: break;
  }
  // embroidery / prints
  if (top.pattern === 'school' || top.pattern === 'school_girl') {
    P.text(T, 0.4, torsoT(1.32), 'ส.ห.ผ.', LOOPED.body, 13, c2);
    P.text(T, 0.4, torsoT(1.29), (look.sex === 'f' ? 'ด.ญ.' : 'ด.ช.') + ' ' + ['สมชาย', 'สมศรี', 'มานี', 'ปิติ', 'ชูใจ', 'วีระ'][hashStr(lookKey(look)) % 6], LOOPED.body, 10, c2);
    if (top.pattern === 'school_girl') { // navy tie knot
      const g = P.g; const [cx, cy] = P.pt(T, 0.5, neckF + 0.04);
      g.fillStyle = c2; g.beginPath(); g.moveTo(cx - 7, cy - 8); g.lineTo(cx + 7, cy - 8); g.lineTo(cx + 12, cy + 30); g.lineTo(cx, cy + 36); g.lineTo(cx - 12, cy + 30); g.closePath(); g.fill();
    }
  }
  if (top.pattern === 'police') {
    for (const s of [0.36, 0.64]) P.line(T, [[s - 0.03, torsoT(1.405)], [s + 0.03, torsoT(1.405)]], '#2a1d14', 3, 1);
    P.band(T, torsoT(1.34), torsoT(1.32), '#1d1d1f', 1, 0.36, 0.44);
    P.text(T, 0.4, torsoT(1.33), 'สมพงษ์', LOOPED.body, 8, '#f2f2f2');
    const [bx, by] = P.pt(T, 0.6, torsoT(1.33));
    const g = P.g; g.fillStyle = '#c9b06a'; g.beginPath(); for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 - Math.PI / 2; const rr = i % 2 ? 4 : 9; g.lineTo(bx + Math.cos(a) * rr, by + Math.sin(a) * rr); } g.closePath(); g.fill();
  }
  if (top.pattern === 'security') {
    P.text(T, 0.0, torsoT(1.32), 'SECURITY', LOOPED.body, 20, c2); P.text(T, 1.0, torsoT(1.32), 'SECURITY', LOOPED.body, 20, c2);
    P.text(T, 0.0, torsoT(1.27), 'รักษาความปลอดภัย', LOOPED.body, 12, c2); P.text(T, 1.0, torsoT(1.27), 'รักษาความปลอดภัย', LOOPED.body, 12, c2);
    P.band(A, armT(0.06), armT(0.12), c2, 0.9, 0.6, 0.9);
    P.text(A, 0.75, armT(0.09), 'รปภ.', LOOPED.body, 10, '#1d1d1f');
  }
  if (top.pattern === 'tee_print') {
    const lines = ['กินข้าวยัง?', 'ไม่เป็นไร', 'ใจเย็นๆ', 'รวยมาก', 'หิวตลอด', 'สู้ๆ นะ', 'อ้วนแต่หล่อ'];
    const txt = lines[hashStr(lookKey(look)) % lines.length];
    const ink = lum(col) > 0.5 ? '#1d1d1f' : '#f2efe6';
    P.text(T, 0.5, torsoT(1.28), txt, LOOPED.hand, 34, ink, { rot: -0.05 });
    P.noise(T, 0.25, 0.38, torsoT(1.33), 0.62, torsoT(1.22));
  }
  if (top.pattern === 'gamer') {
    const g = P.g; const [cx, cy] = P.pt(T, 0.5, torsoT(1.27));
    const px = 7, art = ['0011110', '0111111', '1101011', '1111111', '0100010', '1100011'];
    art.forEach((row, yy) => [...row].forEach((c, xx) => { if (c === '1') { g.fillStyle = '#7ad04a'; g.fillRect(cx - 24 + xx * px, cy - 28 + yy * px, px - 1, px - 1); } }));
    P.text(T, 0.5, torsoT(1.19), 'GG', LOOPED.block, 30, '#e8e4dc');
  }
  if (top.pattern === 'elephant_tank') paintElephants(P, 'torso', T, torsoT(1.33), tH, '#f1e6c6', undefined, 0.09);
  if (top.pattern === 'ragged') {
    for (let i = 0; i < 7; i++) { const s = r.next(), t = 0.15 + r.next() * (tH - 0.2); P.blob(T, s, t, 0.012 + r.next() * 0.02, 0.014 + r.next() * 0.02, rgbHex(skin), 1); P.blob(T, s, t, 0.03, 0.035, '#3a2f22', 0.25); }
  }
  // sleeve hems & cuffs
  if (tSleeve > 0) {
    if (top.sleeve === 'rolled') { P.band(A, armT(se - 0.03), tSleeve, shade(col, 0.88), 1); P.line(A, [[0, armT(se - 0.015)], [1, armT(se - 0.015)]], shade(col, 0.7), 1.4, 0.8); }
    else { P.band(A, tSleeve - 0.02, tSleeve, shade(col, 0.85), 1); P.line(A, [[0, tSleeve - 0.018], [1, tSleeve - 0.018]], shade(col, 0.68), 1, 0.7, [3, 2]); }
    if (top.sleeve === 'long' && top.pattern !== 'suit' && top.pattern !== 'suit_shiny') { P.band(A, armT(0.5), armT(0.535), shade(col, 0.9), 1); P.dot(A, 0.85, armT(0.52), 2, '#efece4'); }
  }
  // hem (when untucked) & shirt-tail shading
  if (top.hem > 0.8 && untucked(top, bot)) { P.band(T, tH - 0.022, tH, shade(col, 0.86), 1); P.line(T, [[0, tH - 0.018], [1, tH - 0.018]], shade(col, 0.68), 1, 0.7, [3, 2]); }
  else if (top.hem > 0.8) { for (let i = 0; i < 8; i++) P.line(T, [[i / 8 + 0.02, tH - 0.05], [i / 8 + 0.04, tH]], shade(col, 0.75), 1.2, 0.4); }
  // cloth folds / AO on the top
  P.blob(T, 0.25, torsoT(1.34), 0.06, 0.06, rgbHex(shade(col, 0.6)), 0.4); P.blob(T, 0.75, torsoT(1.34), 0.06, 0.06, rgbHex(shade(col, 0.6)), 0.4);
  if (top.loose > 0.015) for (let i = 0; i < 6; i++) { const s = r.next(); P.line(T, [[s, torsoT(1.25)], [s + (r.next() - 0.5) * 0.04, tH - 0.03]], shade(col, 0.78), 2.2, 0.25); }
  P.blob(A, 0.75, armT(0.29), 0.08, 0.03, rgbHex(shade(col, 0.65)), tSleeve > armT(0.3) ? 0.4 : 0);
}

function baseTopFabric(P: Painter, top: TopSpec, rn: string, reg: Region, t0: number, t1: number, col: string, c2: string, r: RNG) {
  if (P.photoPrint([top.id, top.pattern], rn, reg, 0, t0, 1, t1, col)) return;
  const pp = PPM[rn] ?? [500, 500];
  switch (top.pattern) {
    case 'rib': P.fabric(rn, reg, 0, t0, 1, t1, 'rib_knit', col, { contrast: 0.7, rot: 90, scale: 0.7 }); break;
    case 'jersey': case 'tee_print': case 'gamer': case 'ragged': case 'cute': P.fabric(rn, reg, 0, t0, 1, t1, lum(col) < 0.3 ? 'melange' : 'jersey', col, { contrast: lum(col) < 0.3 ? 0.35 : 0.55 });
      if (top.pattern === 'cute') { const g = P.g; const [x, y, w, h] = P.rect(reg, 0, t0, 1, t1); g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.fillStyle = 'rgba(255,255,255,0.75)'; const st = 0.035 * pp[0]; for (let yy = y; yy < y + h; yy += st) for (let xx = x + ((yy / st) % 2) * st * 0.5; xx < x + w; xx += st) { g.beginPath(); g.arc(xx, yy, st * 0.12, 0, 7); g.fill(); } g.restore(); }
      break;
    case 'stripe_h': case 'polo_stripe': {
      P.fabric(rn, reg, 0, t0, 1, t1, top.pattern === 'polo_stripe' ? 'pique' : 'jersey', top.pattern === 'polo_stripe' ? c2 : col, { contrast: 0.5 });
      const g = P.g; const [x, y, w, h] = P.rect(reg, 0, t0, 1, t1);
      g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
      const per = (top.pattern === 'polo_stripe' ? 0.05 : 0.032) * pp[1];
      const sw = top.pattern === 'polo_stripe' ? per * 0.5 : per * 0.22;
      g.fillStyle = top.pattern === 'polo_stripe' ? col : c2;
      g.globalAlpha = 0.95;
      for (let yy = y + per * 0.3; yy < y + h; yy += per) g.fillRect(x, yy, w, sw);
      g.restore();
      P.fabric(rn, reg, 0, t0, 1, t1, top.pattern === 'polo_stripe' ? 'pique' : 'jersey', '#808080', { contrast: 0.3, mode: 'overlay' });
      break;
    }
    case 'hawaiian': paintHawaiian(P, rn, reg, t0, t1, col, c2, r); break;
    case 'floral': case 'floral_small': case 'house': paintFloral(P, rn, reg, t0, t1, col, c2, r, top.pattern === 'floral_small' ? 0.5 : 1); break;
    case 'pique': P.fabric(rn, reg, 0, t0, 1, t1, 'pique', col, { contrast: 0.6 }); break;
    case 'oxford': case 'school': case 'school_girl': case 'police': case 'security': case 'white_blouse': P.fabric(rn, reg, 0, t0, 1, t1, 'poplin', col, { contrast: 0.45 }); P.fabric(rn, reg, 0, t0, 1, t1, 'linen', col, { contrast: 0.0 }); break;
    case 'satin': case 'satin_plain': case 'suit_shiny': {
      P.fabric(rn, reg, 0, t0, 1, t1, 'satin', col, { contrast: 0.5 });
      // sheen bands
      for (let i = 0; i < 6; i++) { const s = (i + r.next() * 0.5) / 6; P.blob(reg, s, (t0 + t1) / 2, 0.03, (t1 - t0) * 0.6, '#ffffff', 0.22); }
      if (top.pattern === 'suit_shiny') break;
      break;
    }
    case 'suit': P.fabric(rn, reg, 0, t0, 1, t1, 'herringbone', col, { contrast: 0.4 }); P.noise(reg, 0.08, 0, t0, 1, t1); break;
    case 'moto_vest': P.fabric(rn, reg, 0, t0, 1, t1, 'twill_beige', col, { mode: 'color' }); break;
    case 'rider': P.fabric(rn, reg, 0, t0, 1, t1, 'quilted', col, { mode: 'color', scale: 0.8 }); break;
    case 'work': P.fabric(rn, reg, 0, t0, 1, t1, 'twill_beige', col, { mode: 'color' }); P.noise(reg, 0.3, 0, t0, 1, t1); break;
    case 'sweeper': P.fabric(rn, reg, 0, t0, 1, t1, 'canvas', col, { contrast: 0.3 }); break;
    case 'elephant_tank': P.fabric(rn, reg, 0, t0, 1, t1, 'jersey', col, { contrast: 0.55 }); break;
    case 'robe': P.fabric(rn, reg, 0, t0, 1, t1, 'linen', col, { contrast: 0.75 }); break;
    default: P.fabric(rn, reg, 0, t0, 1, t1, 'jersey', col, { contrast: 0.5 });
  }
}

// ------------------------------------------------------------------ procedural print fallbacks

function paintHawaiian(P: Painter, rn: string, reg: Region, t0: number, t1: number, col: string, c2: string, r: RNG) {
  P.fabric(rn, reg, 0, t0, 1, t1, 'poplin', col, { contrast: 0.4 });
  const g = P.g; const [x, y, w, h] = P.rect(reg, 0, t0, 1, t1);
  const pp = PPM[rn] ?? [500, 500];
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  const leafSize = 0.07 * pp[0];
  const n = Math.ceil((w * h) / (leafSize * leafSize) * 1.3);
  const lightLeaf = mix(col, '#ffffff', 0.55), darkLeaf = c2;
  for (let i = 0; i < n; i++) {
    const cx = x + r.next() * w, cy = y + r.next() * h, a = r.next() * Math.PI * 2, s = leafSize * (0.6 + r.next() * 0.7);
    g.save(); g.translate(cx, cy); g.rotate(a);
    const lc = r.next() < 0.55 ? darkLeaf : lightLeaf;
    g.fillStyle = lc;
    g.beginPath(); g.moveTo(0, -s); g.bezierCurveTo(s * 0.55, -s * 0.5, s * 0.5, s * 0.4, 0, s); g.bezierCurveTo(-s * 0.5, s * 0.4, -s * 0.55, -s * 0.5, 0, -s); g.fill();
    g.strokeStyle = mix(rgbHex(lc), '#000000', 0.25); g.lineWidth = Math.max(0.6, s * 0.05);
    g.beginPath(); g.moveTo(0, -s * 0.9); g.lineTo(0, s * 0.9); g.stroke();
    for (let k = -3; k <= 3; k++) { g.beginPath(); g.moveTo(0, k * s * 0.22); g.lineTo(s * 0.4, k * s * 0.22 - s * 0.2); g.moveTo(0, k * s * 0.22); g.lineTo(-s * 0.4, k * s * 0.22 - s * 0.2); g.stroke(); }
    g.restore();
    if (r.next() < 0.18) { // hibiscus
      const fx = x + r.next() * w, fy = y + r.next() * h, fs = leafSize * 0.55;
      g.fillStyle = '#f4f0e6';
      for (let k = 0; k < 5; k++) { const ang = (k / 5) * Math.PI * 2; g.beginPath(); g.ellipse(fx + Math.cos(ang) * fs * 0.55, fy + Math.sin(ang) * fs * 0.55, fs * 0.55, fs * 0.38, ang, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#e2b84a'; g.beginPath(); g.arc(fx, fy, fs * 0.18, 0, 7); g.fill();
    }
  }
  g.restore();
  P.fabric(rn, reg, 0, t0, 1, t1, 'poplin', '#808080', { contrast: 0.25 });
}

function paintFloral(P: Painter, rn: string, reg: Region, t0: number, t1: number, col: string, c2: string, r: RNG, scale: number) {
  P.fabric(rn, reg, 0, t0, 1, t1, 'linen', col, { contrast: 0.5 });
  const g = P.g; const [x, y, w, h] = P.rect(reg, 0, t0, 1, t1);
  const pp = PPM[rn] ?? [500, 500];
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  const fs = 0.045 * pp[0] * scale;
  const n = Math.ceil((w * h) / (fs * fs) * 0.7);
  const cols = [c2, mix(col, '#ffffff', 0.6), mix(c2, '#c84a6a', 0.4)];
  for (let i = 0; i < n; i++) {
    const cx = x + r.next() * w, cy = y + r.next() * h, s = fs * (0.6 + r.next() * 0.6);
    const c = cols[i % cols.length];
    // leaves
    g.fillStyle = mix(col, '#1f3a1a', 0.6);
    for (let k = 0; k < 2; k++) { const a = r.next() * 6.28; g.beginPath(); g.ellipse(cx + Math.cos(a) * s * 0.9, cy + Math.sin(a) * s * 0.9, s * 0.45, s * 0.18, a, 0, 7); g.fill(); }
    g.fillStyle = c;
    const petals = 5 + (i % 3);
    for (let k = 0; k < petals; k++) { const a = (k / petals) * 6.28 + i; g.beginPath(); g.ellipse(cx + Math.cos(a) * s * 0.42, cy + Math.sin(a) * s * 0.42, s * 0.42, s * 0.26, a, 0, 7); g.fill(); }
    g.fillStyle = mix(rgbHex(c), '#3a1a10', 0.5); g.beginPath(); g.arc(cx, cy, s * 0.16, 0, 7); g.fill();
  }
  g.restore();
  P.fabric(rn, reg, 0, t0, 1, t1, 'jacquard', '#808080', { contrast: 0.2 });
}

function paintBatik(P: Painter, rn: string, reg: Region, t0: number, t1: number, col: string, c2: string, ppm?: [number, number]) {
  P.fabric(rn, reg, 0, t0, 1, t1, 'linen', col, { contrast: 0.55, ppm });
  const g = P.g; const [x, y, w, h] = P.rect(reg, 0, t0, 1, t1);
  const pp = ppm ?? PPM[rn] ?? [500, 500];
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  const st = 0.08 * pp[0];
  g.strokeStyle = c2; g.fillStyle = c2; g.lineWidth = Math.max(1, st * 0.05); g.globalAlpha = 0.8;
  let row = 0;
  for (let yy = y; yy < y + h + st; yy += st * 0.8, row++) for (let xx = x + (row % 2) * st * 0.5; xx < x + w + st; xx += st) {
    g.beginPath(); g.ellipse(xx, yy, st * 0.32, st * 0.2, 0, 0, 7); g.stroke();
    g.beginPath(); g.arc(xx, yy, st * 0.06, 0, 7); g.fill();
    for (let k = 0; k < 4; k++) { const a = (k / 4) * 6.28 + 0.78; g.beginPath(); g.moveTo(xx + Math.cos(a) * st * 0.12, yy + Math.sin(a) * st * 0.08); g.lineTo(xx + Math.cos(a) * st * 0.3, yy + Math.sin(a) * st * 0.18); g.stroke(); }
  }
  // border band at the hem (typical pha thung)
  g.globalAlpha = 0.9; g.fillStyle = mix(col, c2, 0.6);
  g.fillRect(x, y + h - st * 0.6, w, st * 0.35);
  g.restore();
}

function paintElephants(P: Painter, rn: string, reg: Region, t0: number, t1: number, color: string, ppm: [number, number] | undefined, size: number) {
  const g = P.g; const [x, y, w, h] = P.rect(reg, 0, t0, 1, t1);
  const pp = ppm ?? PPM[rn] ?? [500, 500];
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  const s = size * pp[0];
  g.fillStyle = color;
  let row = 0;
  for (let yy = y + s * 0.5; yy < y + h + s; yy += s * 1.15, row++) for (let xx = x + (row % 2) * s * 0.6; xx < x + w + s; xx += s * 1.25) {
    g.save(); g.translate(xx, yy); g.scale(row % 2 ? -1 : 1, 1);
    g.beginPath(); g.ellipse(0, 0, s * 0.36, s * 0.24, 0, 0, 7); g.fill(); // body
    g.beginPath(); g.ellipse(s * 0.34, -s * 0.1, s * 0.17, s * 0.16, 0, 0, 7); g.fill(); // head
    g.beginPath(); g.ellipse(s * 0.27, -s * 0.06, s * 0.1, s * 0.14, 0.3, 0, 7); g.fill(); // ear
    g.lineWidth = s * 0.07; g.strokeStyle = color; g.lineCap = 'round';
    g.beginPath(); g.moveTo(s * 0.47, -s * 0.05); g.quadraticCurveTo(s * 0.58, s * 0.15, s * 0.5, s * 0.28); g.stroke(); // trunk
    for (const lx of [-0.24, -0.1, 0.08, 0.22]) g.fillRect(lx * s - s * 0.04, s * 0.12, s * 0.08, s * 0.2);
    g.restore();
  }
  g.restore();
}

// ------------------------------------------------------------------ shoes

function paintShoes(P: Painter, look: Look, spec: BodySpec, skin: string) {
  const sh = spec.shoe;
  const col = look.shoes?.color ?? sh.color;
  const F = R.foot, L = R.leg, S = R.sole;
  const socks = sh.socks;
  if (socks) P.fabric('leg', L, 0, legT(0.15), 1, 1, 'jersey', socks, { contrast: 0.5 });
  switch (sh.kind) {
    case 'flipflop': {
      // the classic blue-white rubber thong: Y strap on the bare foot, white sole top, coloured bottom
      const g = P.g;
      for (const [a, b] of [[[0.5, 0.86], [0.24, 0.5]], [[0.5, 0.86], [0.76, 0.5]]] as [[number, number], [number, number]][]) P.line(F, [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 0.02], b], col, 9, 1);
      P.dot(F, 0.5, 0.86, 4.5, shade(col, 0.8));
      void g;
      P.fabric('sole', S, 0, 0, 1, 1, 'rubber', '#f1f0ea', { contrast: 0.25 });
      P.band(S, 0, 1, col, 1, 0, 0.3); P.band(S, 0, 1, col, 1, 0.7, 1);
      P.band(S, 0, 1, shade(col, 0.8), 1, 0.28, 0.31); P.band(S, 0, 1, shade(col, 0.8), 1, 0.69, 0.72);
      break;
    }
    case 'sandal': {
      for (const t of [0.42, 0.72]) P.band(F, t, t + 0.07, col, 1, 0.15, 0.85);
      P.band(F, 0.0, 0.12, col, 1, 0.1, 0.9);
      P.fabric('sole', S, 0, 0, 1, 1, 'leather', mix(col, '#2a1a10', 0.3), { contrast: 0.4 });
      break;
    }
    case 'slipper': {
      P.fabric('foot', F, 0.18, 0.5, 0.82, 0.82, 'rubber', col, { contrast: 0.3 });
      P.fabric('sole', S, 0, 0, 1, 1, 'rubber', shade(col, 0.6), { contrast: 0.3 });
      break;
    }
    case 'sneaker': {
      if (!P.photoPrint(['sneakers'], 'foot', F, 0, 0, 1, 1, col)) P.fabric('foot', F, 0, 0, 1, 1, 'canvas', col, { contrast: 0.22, scale: 0.6 });
      // rubber sole band (bottom & lower sides = s near 0/1), toe cap, laces
      P.band(F, 0, 1, '#ecebe6', 1, 0, 0.16); P.band(F, 0, 1, '#ecebe6', 1, 0.84, 1);
      P.band(F, 0, 1, '#b9b8b2', 1, 0.155, 0.17); P.band(F, 0, 1, '#b9b8b2', 1, 0.83, 0.845);
      P.band(F, 0.86, 1, '#ecebe6', 1, 0.2, 0.8);
      for (let i = 0; i < 5; i++) { const t = 0.42 + i * 0.07; P.line(F, [[0.42, t], [0.58, t + 0.05]], '#f4f4f0', 2.4, 1); P.line(F, [[0.58, t], [0.42, t + 0.05]], '#f4f4f0', 2.4, 1); }
      P.line(F, [[0.4, 0.4], [0.4, 0.78]], shade(col, 0.6), 1.2, 0.7); P.line(F, [[0.6, 0.4], [0.6, 0.78]], shade(col, 0.6), 1.2, 0.7);
      const accent = sh.color2 ?? '#2a2f3a';
      for (const s of [0.27, 0.73]) P.line(F, [[s, 0.25], [s + (s < 0.5 ? 0.02 : -0.02), 0.5], [s, 0.7]], accent, 4, 0.85);
      P.band(F, 0, 0.12, shade(col, 0.9), 1, 0.3, 0.7);
      break;
    }
    case 'leather': case 'school': {
      P.fabric('foot', F, 0, 0, 1, 1, 'leather', col, { contrast: 0.45 });
      P.band(F, 0, 1, '#2a1c14', 1, 0, 0.1); P.band(F, 0, 1, '#2a1c14', 1, 0.9, 1);
      P.blob(F, 0.5, 0.82, 0.12, 0.08, '#ffffff', 0.18); P.blob(F, 0.35, 0.3, 0.05, 0.15, '#ffffff', 0.1);
      for (let i = 0; i < 3; i++) P.line(F, [[0.45, 0.45 + i * 0.06], [0.55, 0.45 + i * 0.06]], '#0e0a08', 1.6, 0.9);
      P.line(F, [[0.2, 0.62], [0.5, 0.58], [0.8, 0.62]], shade(col, 0.6), 1, 0.6, [2, 2]);
      break;
    }
    case 'boot': {
      P.fabric('foot', F, 0, 0, 1, 1, 'rubber', col, { contrast: 0.3 });
      P.fabric('leg', L, 0, legT(0.405), 1, 1, 'rubber', col, { contrast: 0.3 });
      P.band(L, legT(0.405), legT(0.39), shade(col, 1.4), 1);
      P.blob(F, 0.5, 0.7, 0.15, 0.15, '#ffffff', 0.12);
      break;
    }
    case 'barefoot': default: {
      // dusty soles & a bit of grime
      P.band(F, 0, 1, '#6b5a48', 0.35, 0, 0.1); P.band(F, 0, 1, '#6b5a48', 0.35, 0.9, 1);
      P.blob(F, 0.5, 0.95, 0.4, 0.15, '#6b5a48', 0.18);
      break;
    }
  }
  void skin;
}

// ------------------------------------------------------------------ accessories

function paintAcc(P: Painter, look: Look, spec: BodySpec, skin: string, r: RNG) {
  const T = R.torso;
  for (const a of spec.acc) {
    const col = a.color;
    switch (a.kind) {
      case 'cap': case 'cap_back': {
        const H = R.hat as Region;
        P.fabric('hat', H, 0, 0, 1, 1, 'canvas', col, { contrast: 0.3, scale: 0.6 });
        for (let i = 0; i < 6; i++) P.line(H, [[(i / 6) * 0.66, 0], [(i / 6) * 0.66, 1]], shade(col, 0.65), 1.4, 0.8);
        P.dot(H, 0.33, 0.02, 4, shade(col, 0.8));
        for (let i = 0; i < 4; i++) P.line(H, [[0.7, 0.2 + i * 0.18], [0.98, 0.2 + i * 0.18]], shade(col, 0.7), 1, 0.6, [3, 2]);
        P.band(H, 0.92, 1, shade(col, 0.75), 1, 0, 0.66);
        break;
      }
      case 'bucket': { const H = R.hat as Region; P.fabric('hat', H, 0, 0, 1, 1, 'canvas', col, { contrast: 0.35, scale: 0.7 }); for (let i = 0; i < 5; i++) P.line(H, [[0.7, 0.15 + i * 0.17], [0.98, 0.15 + i * 0.17]], shade(col, 0.7), 1, 0.7, [3, 2]); P.band(H, 0.85, 1, shade(col, 0.7), 1, 0, 0.66); break; }
      case 'helmet': { const H = R.hat as Region; P.fill(H, col); P.blob(H, 0.33, 0.25, 0.3, 0.4, '#ffffff', 0.35); P.band(H, 0, 1, shade(col, 0.6), 1, 0.3, 0.36); P.band(H, 0.85, 1, '#1d1d1f', 1, 0, 0.66); P.fill(H, '#1d1d1f', 0.7, 0, 1, 1); break; }
      case 'police_cap': { const H = R.hat as Region; P.fabric('hat', H, 0, 0, 0.66, 1, 'linen', col, { contrast: 0.5 }); P.fill(H, '#121212', 0.68, 0, 1, 1); P.blob(H, 0.85, 0.5, 0.2, 0.3, '#ffffff', 0.15); P.band(H, 0.7, 0.85, '#1d1d1f', 1, 0, 0.66); P.dot(H, 0.33, 0.6, 6, '#c9b06a', '#fff4c0'); break; }
      case 'straw': { const H = R.hat as Region; P.fabric('hat', H, 0, 0, 1, 1, 'hessian', '#cfae6a', { mode: 'overlay', contrast: 0.85, scale: 0.6 }); for (let i = 1; i < 5; i++) P.band(H, i * 0.2 - 0.01, i * 0.2 + 0.01, '#8a6a3a', 0.4); break; }
      case 'headband': if (!P.photoPrint(['headband_white'], 'band', R.band, 0, 0, 1, 1, col)) P.fabric('band', R.band, 0, 0, 1, 1, 'terry', col, { contrast: 0.7 }); P.band(R.band, 0, 0.12, shade(col, 0.85), 1); P.band(R.band, 0.88, 1, shade(col, 0.85), 1); break;
      case 'mask': {
        const M = R.mask;
        P.fabric('mask', M, 0, 0, 1, 1, 'poplin', col, { contrast: 0.4 });
        for (const t of [0.32, 0.5, 0.68]) { P.line(M, [[0.05, t], [0.95, t]], shade(col, 0.75), 2, 0.8); P.line(M, [[0.05, t + 0.03], [0.95, t + 0.03]], shade(col, 1.12), 1.4, 0.6); }
        P.band(M, 0, 0.06, '#f2f2f0', 1); P.band(M, 0, 1, shade(col, 0.85), 1, 0, 0.05); P.band(M, 0, 1, shade(col, 0.85), 1, 0.95, 1);
        break;
      }
      case 'towel': {
        const W = R.towel;
        if (!P.photoPrint(['towel_neck'], 'towel', W, 0, 0, 1, 1, col)) P.fabric('towel', W, 0, 0, 1, 1, 'terry', col, { contrast: 0.8 });
        const stripe = lum(col) > 0.7 ? '#4a7ab8' : '#f2f0ea';
        for (const s of [0.06, 0.1, 0.9, 0.94]) P.band(W, 0, 1, stripe, 0.85, s - 0.012, s + 0.012);
        P.noise(W, 0.25);
        if ((look as any).arch === 'homeless_man' || (look as any).arch === 'construction_worker') P.blob(W, 0.5, 0.5, 0.4, 0.6, '#6b5a40', 0.3);
        break;
      }
      case 'backpack': {
        const K = R.pack;
        P.fabric('pack', K, 0, 0, 1, 1, 'canvas', col, { contrast: 0.35, scale: 0.6 });
        P.line(K, [[0.2, 0.3], [0.5, 0.25], [0.8, 0.3]], '#1d1d1f', 2.5, 0.9);
        P.line(K, [[0.25, 0.55], [0.75, 0.55], [0.75, 0.85], [0.25, 0.85], [0.25, 0.55]], shade(col, 0.6), 2, 0.9);
        // straps on the torso front (over the shoulders)
        for (const s of [0.38, 0.62]) P.band(T, 0, torsoT(1.12), mix(col, '#1d1d1f', 0.4), 1, s - 0.022, s + 0.022);
        for (const s of [0.1, 0.9]) P.band(T, 0, torsoT(1.05), mix(col, '#1d1d1f', 0.4), 1, s - 0.022, s + 0.022);
        break;
      }
      case 'apron': {
        const Ap = R.apron;
        if (!P.photoPrint(['apron'], 'apron', Ap, 0, 0, 1, 1, col)) P.fabric('apron', Ap, 0, 0, 1, 1, 'canvas', col, { contrast: 0.35, scale: 0.8 });
        P.line(Ap, [[0.2, 0.55], [0.8, 0.55], [0.8, 0.75], [0.2, 0.75], [0.2, 0.55]], shade(col, 0.65), 2, 0.8);
        P.line(Ap, [[0.5, 0.55], [0.5, 0.75]], shade(col, 0.65), 1.5, 0.8);
        P.band(Ap, 0, 0.03, shade(col, 0.8), 1);
        for (let i = 0; i < 6; i++) P.blob(Ap, r.next(), 0.3 + r.next() * 0.6, 0.04 + r.next() * 0.05, 0.03 + r.next() * 0.04, r.next() < 0.5 ? '#7a4a20' : '#a8742a', 0.25 + r.next() * 0.2);
        // neck strap & waist ties painted on the torso
        P.line(T, [[0.46, torsoT(1.32)], [0.4, torsoT(1.45)], [0.25, torsoT(1.48)]], col, 5, 1);
        P.line(T, [[0.54, torsoT(1.32)], [0.6, torsoT(1.45)], [0.75, torsoT(1.48)]], col, 5, 1);
        P.band(T, torsoT(1.06), torsoT(1.04), col, 1, 0, 0.3); P.band(T, torsoT(1.06), torsoT(1.04), col, 1, 0.7, 1);
        P.line(T, [[0.02, torsoT(1.05)], [0.05, torsoT(0.95)]], col, 4, 1); P.line(T, [[0.98, torsoT(1.05)], [0.95, torsoT(0.94)]], col, 4, 1);
        break;
      }
      case 'lanyard': {
        P.line(T, [[0.38, torsoT(1.45)], [0.47, torsoT(1.22)]], col, 3, 1); P.line(T, [[0.62, torsoT(1.45)], [0.53, torsoT(1.22)]], col, 3, 1);
        P.line(T, [[0.38, torsoT(1.45)], [0.25, torsoT(1.48)], [0.0, torsoT(1.49)]], col, 3, 1); P.line(T, [[0.62, torsoT(1.45)], [0.75, torsoT(1.48)], [1.0, torsoT(1.49)]], col, 3, 1);
        const [cx, cy] = P.pt(T, 0.5, torsoT(1.16));
        const g = P.g; g.fillStyle = '#f4f4f2'; g.fillRect(cx - 12, cy - 16, 24, 32); g.fillStyle = col; g.fillRect(cx - 12, cy - 16, 24, 7); g.fillStyle = '#c8b8a0'; g.fillRect(cx - 7, cy - 6, 9, 11);
        break;
      }
      case 'sash': {
        const g = P.g; g.save(); P.clipRegion(T);
        g.strokeStyle = col; g.lineWidth = 26; g.globalAlpha = 0.95;
        g.beginPath(); g.moveTo(...P.pt(T, 0.75, -0.05)); g.lineTo(...P.pt(T, 0.42, torsoT(1.0))); g.stroke();
        g.beginPath(); g.moveTo(...P.pt(T, 0.75, -0.05)); g.lineTo(...P.pt(T, 0.98, torsoT(1.0))); g.stroke();
        g.restore();
        break;
      }
      default: break;
    }
  }
  void skin;
}

// ------------------------------------------------------------------ hair texture

function paintHair(P: Painter, look: Look, r: RNG) {
  const style = look.hair?.style ?? 'short';
  const col = look.hair?.color ?? '#141110';
  const H = R.hair;
  const hk = style === 'afro' || style === 'auntie_perm' ? 'hair_curly' : style === 'buzz' || style === 'shaved' ? 'hair_buzz' : 'hair_straight';
  const pk = pickPhoto([hk], style === 'salt_pepper' ? '#8a8682' : col, PHOTO.hair);
  const ph = pk ? { img: pk.rec.img, tint: pk.far > 0.08 } : null;
  const [x, y, w, h] = P.rect(H, 0, 0, 1, 1);
  const g = P.g;
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = col; g.fillRect(x, y, w, h);
  if (ph) {
    const p = g.createPattern(ph.img, 'repeat')!;
    p.setTransform(new DOMMatrix().translate(x, y).scale((w / ph.img.width) * 0.5, (h / ph.img.height) * 0.6));
    g.fillStyle = p; g.globalCompositeOperation = ph.tint ? 'overlay' : 'source-over'; g.fillRect(x, y, w, h);
    g.globalCompositeOperation = 'color'; g.fillStyle = col; g.globalAlpha = ph.tint ? 0.6 : 0; g.fillRect(x, y, w, h);
  } else {
    const curly = style === 'afro' || style === 'auntie_perm';
    const c = rgb(col);
    const lightK = 0.25 + (1 - lum(col)) * 0.18;
    if (curly) {
      for (let i = 0; i < 2200; i++) {
        const cx = x + r.next() * w, cy = y + r.next() * h, rr = 2 + r.next() * 4;
        const k = r.next() < 0.5 ? 1 + lightK : 0.6;
        g.strokeStyle = css(c[0] * k + 10, c[1] * k + 8, c[2] * k + 6, 0.35); g.lineWidth = 1.2;
        g.beginPath(); g.arc(cx, cy, rr, r.next() * 6, r.next() * 6 + 3); g.stroke();
      }
    } else {
      const n = 900;
      for (let i = 0; i < n; i++) {
        const sx = x + r.next() * w, len = h * (0.2 + r.next() * 0.5), sy = y + r.next() * h - len * 0.3;
        const k = r.next() < 0.45 ? 1 + lightK * (0.6 + r.next()) : 0.55 + r.next() * 0.3;
        let rr = c[0] * k + 6, gg = c[1] * k + 5, bb = c[2] * k + 4;
        if (style === 'salt_pepper' && r.next() < 0.5) { const v = 150 + r.next() * 80; rr = gg = bb = v; }
        g.strokeStyle = css(rr, gg, bb, 0.28 + r.next() * 0.25); g.lineWidth = 0.8 + r.next() * 1.4;
        g.beginPath(); g.moveTo(sx, sy); g.quadraticCurveTo(sx + (r.next() - 0.5) * 8, sy + len * 0.5, sx + (r.next() - 0.5) * 10, sy + len); g.stroke();
      }
      // anisotropic sheen band
      const gr = g.createLinearGradient(0, y, 0, y + h);
      gr.addColorStop(0.0, 'rgba(255,255,255,0)'); gr.addColorStop(0.28, `rgba(255,245,230,${0.06 + lightK * 0.12})`); gr.addColorStop(0.42, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x, y, w, h);
      if (style === 'side_part') P.line(H, [[0.62, 0], [0.62, 0.3]], shade(col, 1.6), 2, 0.5);
      if (style === 'long' || style === 'ponytail' || style === 'bun') P.line(H, [[0.5, 0], [0.5, 0.25]], shade(col, 1.5), 1.5, 0.4);
    }
    // darker roots near the scalp edge & tips variation
    const gr2 = g.createLinearGradient(0, y, 0, y + h);
    gr2.addColorStop(0, 'rgba(0,0,0,0.25)'); gr2.addColorStop(0.15, 'rgba(0,0,0,0)'); gr2.addColorStop(0.6, 'rgba(0,0,0,0)'); gr2.addColorStop(0.66, 'rgba(0,0,0,0.3)'); gr2.addColorStop(0.7, 'rgba(0,0,0,0)');
    g.fillStyle = gr2; g.fillRect(x, y, w, h);
  }
  g.restore();
  // hair tie for ponytails/buns
  if (style === 'ponytail') P.band(H, 0.7, 0.73, '#1d1d1f', 1);
}

// ------------------------------------------------------------------ grime & wear

function paintGrime(P: Painter, look: Look, spec: BodySpec, r: RNG) {
  const arch = (look as any).arch as string | undefined;
  const dirty = arch === 'homeless_man' ? 1 : arch === 'construction_worker' ? 0.7 : arch === 'uncle_singlet' || arch === 'street_sweeper' || arch === 'old_man_cart_owner' ? 0.4 : 0.12;
  const T = R.torso, L = R.leg;
  const top = spec.top;
  // sweat / yellowing on singlets and white tees (hot Thai street)
  if (top.pattern === 'rib' || (lum(look.top?.color ?? top.color) > 0.75 && top.sleeve !== 'long')) {
    for (const s of [0.25, 0.75]) P.blob(T, s, torsoT(1.32), 0.06, 0.06, '#c9a84a', 0.22 + dirty * 0.2);
    P.blob(T, 0.5, torsoT(1.38), 0.08, 0.05, '#c9a84a', 0.1 + dirty * 0.15);
    P.blob(T, 0.0, torsoT(1.3), 0.08, 0.1, '#c9a84a', 0.12, true);
  }
  for (let i = 0; i < Math.round(3 + dirty * 14); i++) {
    const reg = r.next() < 0.6 ? T : L;
    P.blob(reg, r.next(), 0.2 + r.next() * 0.8, 0.02 + r.next() * 0.06, 0.02 + r.next() * 0.05, r.next() < 0.5 ? '#5a4632' : '#3a2e22', 0.06 + dirty * 0.22);
  }
  // dust on trouser bottoms / shins
  P.band(L, legT(0.2), 1, '#8a7a62', 0.08 + dirty * 0.2);
}

// ------------------------------------------------------------------ accessory palette (shared)

let paletteTex: { map: THREE.Texture; orm: THREE.Texture } | null = null;
export function accessoryPalette() {
  if (paletteTex) return paletteTex;
  const mk = (fn: (g: CanvasRenderingContext2D) => void) => { const cv = document.createElement('canvas'); cv.width = cv.height = 32; const g = cv.getContext('2d')!; fn(g); const t = new THREE.CanvasTexture(cv); t.flipY = false; t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; return t; };
  // swatches 0 metal, 1 brushed, 2 gloss, 3 matte, 4 lens, 5 lcd, 6 rubber, 7 gold
  const alb = ['#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#a9b59a', '#ffffff', '#ffd88a'];
  const rough = [0.28, 0.45, 0.28, 0.7, 0.06, 0.35, 0.9, 0.3];
  const metal = [1, 1, 0, 0, 0.35, 0, 0, 1];
  const map = mk((g) => { alb.forEach((c, i) => { g.fillStyle = c; g.fillRect((i % 4) * 8, Math.floor(i / 4) * 8, 8, 8); }); g.fillStyle = '#2a3326'; g.fillRect(9 + 1, 11, 6, 2); });
  map.colorSpace = THREE.SRGBColorSpace;
  const orm = mk((g) => { rough.forEach((rv, i) => { g.fillStyle = `rgb(255,${Math.round(rv * 255)},${Math.round(metal[i] * 255)})`; g.fillRect((i % 4) * 8, Math.floor(i / 4) * 8, 8, 8); }); });
  orm.colorSpace = THREE.NoColorSpace;
  paletteTex = { map, orm };
  return paletteTex;
}

export const _unused = { footT, neckT };
