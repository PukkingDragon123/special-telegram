import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';

/* ============================================================================================
 * Inventory icons: each item kind's real 3D visual (ItemDef.build) rendered once into a small
 * transparent thumbnail (3/4 view, soft studio light + the world's IBL) with the main renderer,
 * cached as a data URL per kind + label. Async visuals (GLB still loading) are re-baked a few
 * times until they have a size.
 * ========================================================================================== */

const SIZE = 112;

export class IconBaker {
  private cache = new Map<string, string>();
  private pending = new Map<string, { e: Ent; tries: number; at: number }>();
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(28, 1, 0.01, 50);
  private rt: THREE.WebGLRenderTarget | null = null;
  private px = new Uint8Array(SIZE * SIZE * 4);
  private canvas = document.createElement('canvas');
  private listeners: (() => void)[] = [];

  constructor(private game: Game) {
    this.canvas.width = this.canvas.height = SIZE;
    const hemi = new THREE.HemisphereLight(0xfff6e6, 0x40362c, 1.4);
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(2, 4, 3);
    const rim = new THREE.DirectionalLight(0xbcd4ff, 1.2);
    rim.position.set(-3, 2, -2);
    this.scene.add(hemi, key, rim);
  }

  onChange(fn: () => void) { this.listeners.push(fn); }

  /** data URL of the icon (or null while it is being baked) */
  get(e: Ent): string | null {
    const def = this.game.items.defOf(e);
    if (!def) return null;
    const lbl = this.game.items.name(e).th;
    const key = e.k + '|' + lbl;
    const hit = this.cache.get(key);
    if (hit) return hit;
    if (!this.pending.has(key)) this.pending.set(key, { e, tries: 0, at: 0 });
    return null;
  }

  /** bake at most one icon per frame (cheap: one 112² render + readback) */
  update(now: number) {
    for (const [key, p] of this.pending) {
      if (now < p.at) continue;
      const url = this.bake(p.e);
      p.tries++;
      if (url) { this.cache.set(key, url); this.pending.delete(key); this.listeners.forEach((f) => f()); }
      else if (p.tries > 6) this.pending.delete(key);
      else p.at = now + 0.8 * p.tries;
      break;
    }
  }

  private bake(e: Ent): string | null {
    const def = this.game.items.defOf(e);
    const renderer = this.game.engine?.renderer;
    if (!def || !renderer) return null;
    let obj: THREE.Object3D;
    try { obj = def.build(e, this.game); def.refresh?.(obj, e, this.game); } catch { return null; }
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty() || !isFinite(box.min.x)) { disposeTree(obj); return null; }
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(0.02, size.length() / 2);
    obj.position.sub(center);
    const holder = new THREE.Group();
    holder.add(obj);
    holder.rotation.y = -0.6;
    this.scene.add(holder);
    const env = (this.game.scenes.current as any)?.scene?.environment ?? null;
    this.scene.environment = env;
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(this.cam.fov / 2)) * 1.02;
    this.cam.position.set(0, dist * 0.45, dist * 0.89);
    this.cam.lookAt(0, 0, 0);
    this.cam.updateMatrixWorld(true);
    if (!this.rt) {
      this.rt = new THREE.WebGLRenderTarget(SIZE, SIZE, { samples: 4, type: THREE.UnsignedByteType });
      this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    }
    const prevRT = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevTone = renderer.toneMapping;
    const prevShadow = renderer.shadowMap.autoUpdate;
    let url: string | null = null;
    try {
      renderer.shadowMap.autoUpdate = false;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.setRenderTarget(this.rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, false);
      renderer.render(this.scene, this.cam);
      renderer.readRenderTargetPixels(this.rt, 0, 0, SIZE, SIZE, this.px);
      const ctx = this.canvas.getContext('2d')!;
      const img = ctx.createImageData(SIZE, SIZE);
      // flip Y (GL origin is bottom-left)
      let any = false;
      for (let y = 0; y < SIZE; y++) {
        const src = (SIZE - 1 - y) * SIZE * 4;
        img.data.set(this.px.subarray(src, src + SIZE * 4), y * SIZE * 4);
      }
      for (let i = 3; i < img.data.length; i += 16) if (img.data[i] > 8) { any = true; break; }
      if (any) { ctx.clearRect(0, 0, SIZE, SIZE); ctx.putImageData(img, 0, 0); url = this.canvas.toDataURL('image/png'); }
    } catch { url = null; }
    finally {
      renderer.setRenderTarget(prevRT);
      renderer.setClearColor(prevClear, prevAlpha);
      renderer.toneMapping = prevTone;
      renderer.shadowMap.autoUpdate = prevShadow;
      this.scene.remove(holder);
      this.scene.environment = null;
      disposeTree(obj);
    }
    return url;
  }

  dispose() { this.rt?.dispose(); this.rt = null; }
}

function disposeTree(o: THREE.Object3D) {
  // geometries/materials of item visuals are usually shared caches — only drop per-instance canvas textures
  o.traverse((c: any) => { if (c.isMesh && c.material?.map?.isCanvasTexture && c.material.userData?.ownMap) c.material.map.dispose(); });
}
