import * as THREE from 'three';
import { Assets } from '../../core/assets';
import { proceduralCanvas, ProcKind } from '../../core/proctex';

/* ============================================================================================
 * Texture loading with graceful fallback (never renders black if a file is missing).
 * Files live in public/assets/gen/life/tex/ (real photos, credits in references/credits/life.md).
 * ========================================================================================== */

const cache = new Map<string, THREE.Texture>();
const loader = new THREE.TextureLoader();

export function lifeTex(file: string, o: { srgb?: boolean; repeat?: [number, number]; fallback?: string; kind?: ProcKind; clamp?: boolean; flipY?: boolean; onLoad?: () => void } = {}): THREE.Texture {
  const key = file + JSON.stringify({ ...o, onLoad: undefined });
  const hit = cache.get(key);
  if (hit) return hit;
  // start with a procedural canvas placeholder, swap the image in when it arrives
  const cv = proceduralCanvas(o.kind ?? 'fabric', { size: 64, color: (o.fallback ?? '#8a7a66').replace('#', ''), seed: file });
  const tex = new THREE.Texture(cv);
  tex.needsUpdate = true;
  tex.colorSpace = o.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = o.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  tex.anisotropy = 8;
  if (o.repeat) tex.repeat.set(o.repeat[0], o.repeat[1]);
  if (o.flipY === false) tex.flipY = false;
  cache.set(key, tex);
  const url = Assets.url(file.includes('/') ? file : 'gen/life/tex/' + file);
  loader.load(url, (t) => {
    // new size → free the GPU texture first (immutable storage is reallocated on next upload)
    tex.dispose();
    tex.source = t.source;
    tex.needsUpdate = true;
    o.onLoad?.();
  }, undefined, () => console.warn('[life] missing texture', file));
  return tex;
}

/** Load an image as a canvas (for compositing posters etc.). Resolves null on failure. */
export function loadImage(file: string): Promise<HTMLImageElement | null> {
  return Assets.image(file.includes('/') ? file : 'gen/life/tex/' + file).catch(() => null);
}

/** Small radial-gradient sprite texture (glows, hearts backdrop). */
let glowTex: THREE.Texture | null = null;
export function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  glowTex = new THREE.CanvasTexture(cv);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}
