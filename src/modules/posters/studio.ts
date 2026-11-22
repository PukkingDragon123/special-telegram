import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CharacterRig } from '../../game/contracts';

/* ============================================================================================
 * Poster studio (build-time only, see scripts/posters.mjs): renders the game's REAL 3D models
 * (characters, dishes, wok, cart) as clean transparent cut-outs under natural studio light.
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

// ------------------------------------------------------------------ helpers

export function hashStr(s: string) { let x = 2166136261; for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619); return x >>> 0; }

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
