import * as THREE from 'three';
import { Assets } from '../../core/assets';

/**
 * Runtime texture atlas: packs real photo cut-outs (signs, decals, foliage cards) into one canvas
 * so each kind is a single material / draw call per chunk.
 */

export interface AtlasRect { u0: number; v0: number; u1: number; v1: number; aspect: number; meta?: any }
export interface AtlasItem { id: string; url: string; w: number; h: number; meta?: any; cells?: [number, number] }

export class Atlas {
  readonly rects = new Map<string, AtlasRect>();
  tex: THREE.CanvasTexture;
  constructor(public canvas: HTMLCanvasElement) {
    this.tex = new THREE.CanvasTexture(canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = Assets.maxAnisotropy;
    this.tex.generateMipmaps = true;
    this.tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.tex.flipY = true;
  }
  get(id: string): AtlasRect | undefined { return this.rects.get(id); }
  has(id: string) { return this.rects.has(id); }
  ids(prefix = '') { return [...this.rects.keys()].filter((k) => k.startsWith(prefix)); }

  /** sub-rect of a cell grid inside an entry (cx,cy from the top-left) */
  cell(id: string, cx: number, cy: number, nx: number, ny: number): AtlasRect | undefined {
    const r = this.rects.get(id);
    if (!r) return undefined;
    const du = (r.u1 - r.u0) / nx, dv = (r.v1 - r.v0) / ny;
    // v1 is the TOP of the image (flipY)
    return { u0: r.u0 + du * cx, u1: r.u0 + du * (cx + 1), v1: r.v1 - dv * cy, v0: r.v1 - dv * (cy + 1), aspect: r.aspect * ny / nx, meta: r.meta };
  }

  /**
   * Build: loads all images (missing ones are skipped), shelf-packs them (sizes in px), draws them.
   */
  static async build(items: AtlasItem[], size = 4096, pad = 4, bg: string | null = null): Promise<Atlas> {
    const imgs = await Promise.all(items.map(async (it) => {
      try { return { it, img: await Assets.image(it.url) }; } catch { return null; }
    }));
    const ok = imgs.filter(Boolean) as { it: AtlasItem; img: HTMLImageElement }[];
    // shrink everything if it doesn't fit
    let scale = 1;
    const layout = (s: number) => {
      const placed: { it: AtlasItem; img: HTMLImageElement; x: number; y: number; w: number; h: number }[] = [];
      const sorted = [...ok].sort((a, b) => b.it.h - a.it.h);
      let x = 0, y = 0, rowH = 0;
      for (const o of sorted) {
        const w = Math.max(8, Math.round(o.it.w * s)), h = Math.max(8, Math.round(o.it.h * s));
        if (x + w + pad * 2 > size) { x = 0; y += rowH; rowH = 0; }
        if (y + h + pad * 2 > size) return null;
        placed.push({ ...o, x: x + pad, y: y + pad, w, h });
        x += w + pad * 2;
        rowH = Math.max(rowH, h + pad * 2);
      }
      return placed;
    };
    let placed = layout(scale);
    while (!placed && scale > 0.1) { scale *= 0.85; placed = layout(scale); }
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d')!;
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, size, size); }
    const atlas = new Atlas(cv);
    for (const p of placed ?? []) {
      // edge extrusion (reduces mip bleeding): draw slightly enlarged first, then the real image
      ctx.drawImage(p.img, p.x - pad, p.y - pad, p.w + pad * 2, p.h + pad * 2);
      ctx.clearRect(p.x - pad, p.y - pad, p.w + pad * 2, p.h + pad * 2);
      ctx.drawImage(p.img, p.x - 1, p.y - 1, p.w + 2, p.h + 2);
      ctx.drawImage(p.img, p.x, p.y, p.w, p.h);
      atlas.rects.set(p.it.id, {
        u0: (p.x + 0.5) / size, u1: (p.x + p.w - 0.5) / size,
        v1: 1 - (p.y + 0.5) / size, v0: 1 - (p.y + p.h - 0.5) / size,
        aspect: p.img.naturalWidth / Math.max(1, p.img.naturalHeight),
        meta: p.it.meta,
      });
    }
    atlas.tex.needsUpdate = true;
    return atlas;
  }
}
