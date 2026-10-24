import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { asset } from './util';
import { proceduralTexture } from './proctex';

export interface TexOpts {
  srgb?: boolean;          // color data (albedo/emissive/UI) → true; data maps (normal/orm/height) → false
  repeat?: number | [number, number];
  wrap?: boolean;          // RepeatWrapping (default true)
  flipY?: boolean;
  anisotropy?: number;
  nearest?: boolean;
}

export interface PbrEntry { albedo: string; normal?: string; orm?: string; height?: string; tileMeters?: number; tint?: boolean; tags?: string[] }

export interface PbrOpts {
  /** UV repeat applied to all maps (if your UVs are in metres, use 1/tileMeters — see `pbrWorld`). */
  repeat?: number | [number, number];
  color?: THREE.ColorRepresentation;  // multiplies albedo (tint)
  roughness?: number;                 // multiplies ORM roughness
  metalness?: number;                 // multiplies ORM metalness (default 1 → use map)
  normalScale?: number;
  aoIntensity?: number;
  side?: THREE.Side;
  transparent?: boolean;
  alphaTest?: number;
  envMapIntensity?: number;
  /** fallback base colour if the material id is missing from the manifest */
  fallback?: THREE.ColorRepresentation;
}

/**
 * Asset loading & caching. Textures return immediately and fill in when loaded (non-blocking),
 * so building scenes never waits on the network. Use `load*` variants when you must await.
 */
class AssetSys {
  readonly tex = new THREE.TextureLoader();
  readonly rgbe = new RGBELoader();
  readonly gltf = new GLTFLoader();
  private texCache = new Map<string, THREE.Texture>();
  private baseTex = new Map<string, { tex: THREE.Texture | null; loaded: boolean; variants: THREE.Texture[] }>();
  private jsonCache = new Map<string, Promise<any>>();
  private imgCache = new Map<string, Promise<HTMLImageElement>>();
  private matCache = new Map<string, THREE.Material>();
  pbrManifest: Record<string, PbrEntry> = {};
  maxAnisotropy = 8;
  pending = 0;
  loaded = 0;
  onProgress: ((loaded: number, pending: number) => void) | null = null;

  url(p: string) { return /^(https?:|data:|blob:)/.test(p) ? p : asset(p); }

  private track<T>(p: Promise<T>): Promise<T> {
    this.pending++;
    return p.finally(() => { this.pending--; this.loaded++; this.onProgress?.(this.loaded, this.pending); });
  }

  /** Non-blocking texture getter (cached per url+opts). */
  texture(path: string, opts: TexOpts = {}): THREE.Texture {
    const key = path + JSON.stringify(opts);
    let t = this.texCache.get(key);
    if (t) return t;
    // All variants (different repeat / colour space) share one image source.
    let entry = this.baseTex.get(path);
    if (!entry) {
      const e: { tex: THREE.Texture | null; loaded: boolean; variants: THREE.Texture[] } = (entry = { tex: null, loaded: false, variants: [] });
      this.baseTex.set(path, e);
      this.pending++;
      e.tex = this.tex.load(
        this.url(path),
        () => {
          e.loaded = true;
          for (const v of e.variants) v.needsUpdate = true;
          this.pending--; this.loaded++; this.onProgress?.(this.loaded, this.pending);
        },
        undefined,
        () => {
          console.warn('[assets] missing texture', path);
          this.pending--; this.onProgress?.(this.loaded, this.pending);
        },
      );
    }
    t = entry.tex!.clone();
    this.applyOpts(t, opts);
    // clone() bumps version; keep 0 until the shared image arrives (avoids 'no image data' warnings)
    if (entry.loaded) t.needsUpdate = true;
    else t.version = 0;
    entry.variants.push(t);
    this.texCache.set(key, t);
    return t;
  }

  async loadTexture(path: string, opts: TexOpts = {}): Promise<THREE.Texture> {
    const t = await this.track(this.tex.loadAsync(this.url(path)));
    this.applyOpts(t, opts);
    return t;
  }

  applyOpts(t: THREE.Texture, opts: TexOpts) {
    t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    const wrap = opts.wrap !== false;
    t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    if (opts.repeat !== undefined) {
      const r = typeof opts.repeat === 'number' ? [opts.repeat, opts.repeat] : opts.repeat;
      t.repeat.set(r[0], r[1]);
    }
    if (opts.flipY !== undefined) t.flipY = opts.flipY;
    t.anisotropy = opts.anisotropy ?? this.maxAnisotropy;
    if (opts.nearest) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter; }
  }

  json<T = any>(path: string): Promise<T> {
    let p = this.jsonCache.get(path);
    if (!p) {
      p = this.track(fetch(this.url(path)).then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${path}`);
        return r.json();
      }));
      this.jsonCache.set(path, p);
    }
    return p;
  }

  /** Same as json() but resolves to `fallback` instead of throwing. */
  async jsonSafe<T = any>(path: string, fallback: T): Promise<T> {
    try { return await this.json<T>(path); } catch { return fallback; }
  }

  image(path: string): Promise<HTMLImageElement> {
    let p = this.imgCache.get(path);
    if (!p) {
      p = this.track(new Promise<HTMLImageElement>((res, rej) => {
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => res(im);
        im.onerror = () => rej(new Error('image ' + path));
        im.src = this.url(path);
      }));
      this.imgCache.set(path, p);
    }
    return p;
  }

  async hdr(path: string): Promise<THREE.DataTexture> {
    const t = await this.track(this.rgbe.loadAsync(this.url(path)));
    t.mapping = THREE.EquirectangularReflectionMapping;
    return t;
  }

  async glb(path: string) { return this.track(this.gltf.loadAsync(this.url(path))); }

  async loadManifests() {
    this.pbrManifest = await this.jsonSafe('textures/pbr/manifest.json', {});
  }

  hasPbr(id: string) { return !!this.pbrManifest[id]; }
  listPbr(tag?: string) {
    return Object.keys(this.pbrManifest).filter((k) => !tag || this.pbrManifest[k].tags?.includes(tag));
  }

  /**
   * PBR material from the library (public/assets/textures/pbr/manifest.json).
   * Missing ids fall back to a procedural noise material so nothing ever renders flat.
   */
  pbr(id: string, o: PbrOpts = {}): THREE.MeshStandardMaterial {
    const key = 'pbr:' + id + JSON.stringify(o);
    const cached = this.matCache.get(key) as THREE.MeshStandardMaterial;
    if (cached) return cached;
    const e = this.pbrManifest[id];
    const rep = o.repeat ?? 1;
    let m: THREE.MeshStandardMaterial;
    if (!e) {
      const tex = proceduralTexture('grime', { color: new THREE.Color(o.fallback ?? 0x9a948a).getHexString(), seed: id });
      tex.repeat.set(typeof rep === 'number' ? rep : rep[0], typeof rep === 'number' ? rep : rep[1]);
      m = new THREE.MeshStandardMaterial({ map: tex, roughness: o.roughness ?? 0.85, metalness: o.metalness ?? 0 });
    } else {
      const dir = 'textures/pbr/';
      const p = (f: string) => (f.includes('/') || f.startsWith('textures') ? (f.startsWith('textures') ? f : dir + f) : dir + id + '/' + f);
      m = new THREE.MeshStandardMaterial({
        map: this.texture(p(e.albedo), { srgb: true, repeat: rep }),
        roughness: o.roughness ?? 1,
        metalness: o.metalness ?? (e.orm ? 1 : 0),
      });
      if (e.normal) {
        m.normalMap = this.texture(p(e.normal), { srgb: false, repeat: rep });
        const ns = o.normalScale ?? 1;
        m.normalScale.set(ns, ns);
      }
      if (e.orm) {
        const orm = this.texture(p(e.orm), { srgb: false, repeat: rep });
        m.roughnessMap = orm;
        m.metalnessMap = orm;
        m.aoMap = orm;
        m.aoMapIntensity = o.aoIntensity ?? 1;
      }
    }
    if (o.color !== undefined) m.color = new THREE.Color(o.color);
    if (o.side !== undefined) m.side = o.side;
    if (o.transparent) m.transparent = true;
    if (o.alphaTest !== undefined) m.alphaTest = o.alphaTest;
    if (o.envMapIntensity !== undefined) m.envMapIntensity = o.envMapIntensity;
    m.name = id;
    this.matCache.set(key, m);
    return m;
  }

  /** PBR material for geometry whose UVs are in METRES: repeat = 1 / tileMeters. */
  pbrWorld(id: string, o: PbrOpts = {}) {
    const tm = this.pbrManifest[id]?.tileMeters ?? 2;
    return this.pbr(id, { ...o, repeat: 1 / tm });
  }
}

export const Assets = new AssetSys();
