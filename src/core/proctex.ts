import * as THREE from 'three';
import { Noise } from './rng';

/**
 * Procedural canvas textures (noise based). Used as fallbacks and for details that are
 * better generated than downloaded (grime overlays, fabric weave, paper, cloud masks).
 * Everything is tileable unless noted. Results are cached by kind+opts.
 */
export type ProcKind = 'grime' | 'fabric' | 'plastic' | 'metal' | 'paper' | 'skin' | 'stain' | 'cloudMask' | 'concrete' | 'wood';

export interface ProcOpts {
  size?: number;
  color?: string;   // hex without #
  color2?: string;
  seed?: string | number;
  scale?: number;
  contrast?: number;
}

const cache = new Map<string, THREE.CanvasTexture>();

function hexToRgb(h: string) {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Tileable 2D fbm by sampling 4D-ish torus via 3D noise on a cylinder pair. */
function tileFbm(N: Noise, u: number, v: number, freq: number, oct: number) {
  // Map (u,v) on two circles → seamless (uses 3D noise twice, blended).
  const a = u * Math.PI * 2, b = v * Math.PI * 2;
  const r = freq / (Math.PI * 2);
  const x = Math.cos(a) * r, y = Math.sin(a) * r, z = Math.cos(b) * r, w = Math.sin(b) * r;
  return N.fbm3(x + w * 0.37, y + z * 0.61, z - w * 0.43 + x * 0.21, oct) * 0.85 + N.n3(w * 1.7, x * 1.3, y * 1.9) * 0.15;
}

export function proceduralCanvas(kind: ProcKind, o: ProcOpts = {}): HTMLCanvasElement {
  const S = o.size ?? 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const N = new Noise(o.seed ?? kind);
  const c1 = hexToRgb(o.color ?? '9a948a');
  const c2 = hexToRgb(o.color2 ?? '000000');
  const sc = o.scale ?? 1;
  const con = o.contrast ?? 1;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      let r = c1[0], g = c1[1], b = c1[2], a = 255;
      switch (kind) {
        case 'grime':
        case 'concrete': {
          const n1 = tileFbm(N, u, v, 4 * sc, 5);
          const n2 = tileFbm(N, u + 0.31, v + 0.17, 22 * sc, 3);
          const spots = Math.max(0, tileFbm(N, u + 0.7, v, 9 * sc, 3) - 0.25) * 2.2;
          const k = 1 + (n1 * 0.18 + n2 * 0.07) * con - spots * 0.35 * con;
          r *= k; g *= k * 0.99; b *= k * 0.97;
          break;
        }
        case 'stain': {
          // alpha mask of blotchy stains (not tileable-critical)
          const n = tileFbm(N, u, v, 3 * sc, 5);
          const m = Math.max(0, n - 0.05) * 2.5;
          r = c1[0]; g = c1[1]; b = c1[2]; a = Math.min(255, m * 255 * con);
          break;
        }
        case 'fabric': {
          const weaveX = Math.sin(u * S * Math.PI * 0.5 * sc), weaveY = Math.sin(v * S * Math.PI * 0.5 * sc);
          const w = (weaveX * weaveY) * 0.06;
          const n = tileFbm(N, u, v, 6, 3) * 0.08 + tileFbm(N, u, v, 40, 2) * 0.05;
          const k = 1 + w + n;
          r *= k; g *= k; b *= k;
          break;
        }
        case 'plastic': {
          const n = tileFbm(N, u, v, 8 * sc, 3) * 0.04 + tileFbm(N, u, v, 60, 2) * 0.03;
          const scratches = Math.pow(Math.max(0, Math.abs(N.n2(u * 3, v * 90)) - 0.92), 1) * 3;
          const k = 1 + n + scratches * 0.2;
          r *= k; g *= k; b *= k;
          break;
        }
        case 'metal': {
          const brushed = N.n2(u * 2 * sc, v * 300 * sc) * 0.06;
          const n = tileFbm(N, u, v, 5, 4) * 0.08;
          const k = 1 + brushed + n;
          r *= k; g *= k; b *= k;
          break;
        }
        case 'paper': {
          const fiber = tileFbm(N, u, v, 50, 3) * 0.035 + tileFbm(N, u, v, 7, 3) * 0.04;
          const k = 1 + fiber;
          r *= k; g *= k; b *= k * 0.985;
          break;
        }
        case 'skin': {
          const pores = tileFbm(N, u, v, 70, 2) * 0.03;
          const blotch = tileFbm(N, u, v, 5, 4) * 0.05;
          const k = 1 + pores + blotch;
          r *= k * 1.01; g *= k; b *= k * 0.99;
          break;
        }
        case 'wood': {
          const n = tileFbm(N, u, v, 3, 3);
          const rings = Math.sin((v * 18 + n * 3) * Math.PI * sc) * 0.5 + 0.5;
          const grain = N.n2(u * 120, v * 4) * 0.05;
          const k = 0.82 + rings * 0.22 + grain;
          r *= k; g *= k * 0.97; b *= k * 0.92;
          break;
        }
        case 'cloudMask': {
          // radial puffy cloud with fbm edge — NOT tileable, alpha mask
          const dx = u - 0.5, dy = v - 0.5;
          const rr = Math.sqrt(dx * dx + dy * dy) * 2;
          const ang = Math.atan2(dy, dx);
          const edge = 0.78 + N.fbm2(Math.cos(ang) * 2.2, Math.sin(ang) * 2.2, 4) * 0.18 + Math.sin(ang * 7) * 0.035;
          const m = Math.max(0, Math.min(1, (edge - rr) * 14));
          const shade = 1 - Math.max(0, dy) * 0.25 + N.fbm2(u * 6, v * 6, 3) * 0.05;
          r = 255 * shade; g = 255 * shade; b = 255 * shade; a = m * 255;
          break;
        }
      }
      const i = (y * S + x) * 4;
      if (kind !== 'stain' && kind !== 'cloudMask' && o.color2) {
        const t = Math.max(0, tileFbm(N, u * 1.3, v * 1.1, 3, 4)) * 0.5;
        r = r * (1 - t) + c2[0] * t; g = g * (1 - t) + c2[1] * t; b = b * (1 - t) + c2[2] * t;
      }
      d[i] = Math.max(0, Math.min(255, r));
      d[i + 1] = Math.max(0, Math.min(255, g));
      d[i + 2] = Math.max(0, Math.min(255, b));
      d[i + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

export function proceduralTexture(kind: ProcKind, o: ProcOpts = {}): THREE.CanvasTexture {
  const key = kind + JSON.stringify(o);
  const hit = cache.get(key);
  if (hit) return hit.clone();
  const t = new THREE.CanvasTexture(proceduralCanvas(kind, o));
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  cache.set(key, t);
  return t;
}

/** Tangent-space normal map from a height canvas (Sobel). */
export function normalFromHeight(src: HTMLCanvasElement, strength = 2): THREE.CanvasTexture {
  const S = src.width, H = src.height;
  const sctx = src.getContext('2d')!;
  const sd = sctx.getImageData(0, 0, S, H).data;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = H;
  const ctx = cv.getContext('2d')!;
  const out = ctx.createImageData(S, H);
  const h = (x: number, y: number) => sd[(((y + H) % H) * S + ((x + S) % S)) * 4] / 255;
  for (let y = 0; y < H; y++) for (let x = 0; x < S; x++) {
    const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
    const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
    const len = Math.hypot(dx, dy, 1);
    const i = (y * S + x) * 4;
    out.data[i] = (-dx / len * 0.5 + 0.5) * 255;
    out.data[i + 1] = (dy / len * 0.5 + 0.5) * 255;
    out.data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
    out.data[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Quick noise-textured standard material — use only for placeholders / tiny details. */
export function noiseMaterial(color: THREE.ColorRepresentation, kind: ProcKind = 'grime', extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  const c = new THREE.Color(color);
  const map = proceduralTexture(kind, { color: c.getHexString(), seed: kind + c.getHexString() });
  return new THREE.MeshStandardMaterial({ map, roughness: 0.8, metalness: 0, ...extra });
}
