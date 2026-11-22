import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { asset, BASE, params } from './util';

/** production builds: GPU-compressed copies of GPU-only textures (scripts/ktx2.mjs): original rel → .ktx2 rel */
const KTX2_MAP: Record<string, string> = (globalThis as any).__HP_KTX2__ ?? {};
/** one shared image/KTX2 source per path; `variants` are the per-options clones that share it */
interface TexEntry { tex: THREE.Texture | null; loaded: boolean; variants: THREE.Texture[]; ktx?: THREE.CompressedTexture; ktxPending?: boolean }
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
  private baseTex = new Map<string, TexEntry>();
  /** KTX2 (Basis) transcoder; set up by useRenderer() when the build ships KTX2 textures */
  private ktx2: KTX2Loader | null = null;
  /** counters for the perf readout */
  ktxStats = { ok: 0, fail: 0 };
  /** the renderer (eager GPU uploads) */
  private R: THREE.WebGLRenderer | null = null;
  /**
   * Textures whose pixels just arrived, uploaded a few per frame (≤ ~3 ms) instead of all on the first frame that
   * shows them — streamed-in props near each other otherwise bunched a dozen texture uploads + mipmap builds into
   * one frame. ?noeager turns it off.
   */
  private upQ: (THREE.Texture | THREE.Object3D)[] = [];
  private upPumping = false;
  private eagerUpload(ts: (THREE.Texture | THREE.Object3D)[]) {
    if (!this.R || params.has('noeager') || !ts.length) return;
    for (const t of ts) this.upQ.push(t);
    if (this.upPumping) return;
    this.upPumping = true;
    const pump = () => {
      const t0 = performance.now();
      while (this.upQ.length && performance.now() - t0 < 3) {
        const t: any = this.upQ.shift()!;
        if (t.isObject3D) {
          const ts = new Set<THREE.Texture>();
          t.traverse((o: any) => {
            const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
            for (const m of ms) for (const k in m) { const v = m[k]; if (v && v.isTexture) ts.add(v); }
          });
          this.upQ.unshift(...ts);
          continue;
        }
        try { if (t.image && t.version > 0) this.R!.initTexture(t); } catch { /* the first render will retry */ }
      }
      if (this.upQ.length) requestAnimationFrame(pump); else this.upPumping = false;
    };
    requestAnimationFrame(pump);
  }
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

  /** Give the loaders the renderer (KTX2 needs it to pick the GPU's compressed format: BC7/BC1/BC3, ETC2, ASTC…). */
  useRenderer(r: THREE.WebGLRenderer) {
    this.R = r;
    if (this.ktx2 || !Object.keys(KTX2_MAP).length || params.has('noktx')) return;
    try {
      this.ktx2 = new KTX2Loader().setTranscoderPath(`${BASE}basis/`).setWorkerLimit(2).detectSupport(r);
      this.gltf.setKTX2Loader(this.ktx2);
    } catch (e) { console.warn('[assets] KTX2 unavailable', e); this.ktx2 = null; }
  }

  /** KTX2 arrived: give a variant (a CompressedTexture) the transcoded mip chain and format */
  private static asCompressed(v: THREE.Texture, ct: THREE.CompressedTexture) {
    const t: any = v;
    t.image = ct.image;
    t.mipmaps = ct.mipmaps;
    t.format = ct.format;
    t.type = ct.type;
    t.generateMipmaps = false;
    t.flipY = false;              // compressed blocks can't be flipped: the encoder stored them bottom-up (--lower_left_maps_to_s0t0)
    if (t.minFilter === THREE.LinearMipmapLinearFilter && ct.mipmaps.length <= 1) t.minFilter = THREE.LinearFilter;
    v.needsUpdate = true;
  }

  /** KTX2 failed: turn a variant back into an ordinary image texture (the original file loads next) */
  private static asImage(v: THREE.Texture) {
    const t: any = v;
    t.isCompressedTexture = false;
    t.mipmaps = [];
    t.generateMipmaps = true;
    t.flipY = v.userData.hpFlipY ?? true;
    t.version = 0;
  }

  /** Non-blocking texture getter (cached per url+opts). */
  texture(path: string, opts: TexOpts = {}): THREE.Texture {
    const key = path + JSON.stringify(opts);
    let t = this.texCache.get(key);
    if (t) return t;
    // All variants (different repeat / colour space) share one image source.
    let entry = this.baseTex.get(path);
    if (!entry) {
      const e: TexEntry = (entry = { tex: null, loaded: false, variants: [] });
      this.baseTex.set(path, e);
      this.pending++;
      const rel = path.replace(/^(\.\/)?\/?(assets\/)?/, '');
      const kpath = this.ktx2 && !/^(https?:|data:|blob:)/.test(path) ? KTX2_MAP[rel] : undefined;
      // GPU-compressed copy: no image decode, ~4× less VRAM. The base is a real CompressedTexture so every clone
      // (ours, and other modules' t.clone() for their own repeat) keeps the compressed upload path.
      const base = (e.tex = kpath ? new THREE.CompressedTexture([], 0, 0) : new THREE.Texture());
      if (kpath) {
        e.ktxPending = true;
        // no image yet (like a pending image Texture): three skips the upload even if someone sets needsUpdate
        // ("no image data"), instead of uploading an empty mip chain. The Source is shared by every clone.
        (base as any).image = null;
        AssetSys.trackClones(base, e);
      }
      const finish = () => { this.pending--; this.loaded++; this.onProgress?.(this.loaded, this.pending); };
      // HTMLImageElement + decode(): the image is decoded off the main thread BEFORE three uploads it, instead of
      // a synchronous decode inside texImage2D on the first frame that shows it (a hitch per texture)
      const loadImage = () => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.decoding = 'async';
        let settled = false;
        const ok = () => {
          if (settled) return; settled = true;
          base.image = img;
          e.loaded = true;
          for (const v of e.variants) v.needsUpdate = true;
          finish();
          this.eagerUpload(e.variants);
        };
        const fail = () => {
          if (settled) return; settled = true;
          console.warn('[assets] missing texture', path);
          this.pending--; this.onProgress?.(this.loaded, this.pending);
        };
        img.onload = () => { img.decode().then(ok, ok); };
        img.onerror = fail;
        img.src = this.url(path);
      };
      if (kpath) {
        this.ktx2!.load(asset(kpath), (ct) => {
          e.ktxPending = false;
          e.ktx = ct;
          AssetSys.asCompressed(base, ct);
          for (const v of e.variants) AssetSys.asCompressed(v, ct);
          e.loaded = true;
          this.ktxStats.ok++;
          finish();
          this.eagerUpload(e.variants);
        }, undefined, (err) => {
          console.warn('[assets] KTX2 failed, using the original', path, err);
          e.ktxPending = false;
          this.ktxStats.fail++;
          AssetSys.asImage(base);
          for (const v of e.variants) AssetSys.asImage(v);
          loadImage();
        });
      } else loadImage();
    }
    t = entry.tex!.clone();
    t.userData.hpFlipY = opts.flipY ?? true;
    this.applyOpts(t, opts);
    if (entry.ktx) AssetSys.asCompressed(t, entry.ktx);
    else if (entry.ktxPending) { t.flipY = false; AssetSys.trackClones(t, entry); }
    // clone() bumps version; keep 0 until the shared image arrives (avoids 'no image data' warnings)
    if (entry.loaded) t.needsUpdate = true;
    else t.version = 0;
    if (!entry.variants.includes(t)) entry.variants.push(t);
    this.texCache.set(key, t);
    return t;
  }

  /** While a KTX2 load is pending, clones of `t` (anyone's) are registered as variants: they get the mip chain
   *  when it arrives, and never try to upload the empty placeholder meanwhile */
  private static trackClones(t: THREE.Texture, e: TexEntry) {
    const own = Object.getPrototypeOf(t).clone as () => THREE.Texture;
    (t as any).clone = function (this: THREE.Texture) {
      const c = own.call(this);
      if (e.ktxPending) { c.version = 0; e.variants.push(c); AssetSys.trackClones(c, e); }
      else if (e.ktx) AssetSys.asCompressed(c, e.ktx);
      else {
        // KTX2 failed → image fallback: the clone is still a CompressedTexture instance, make it a plain one
        AssetSys.asImage(c);
        if (e.loaded) c.needsUpdate = true; else e.variants.push(c);
        AssetSys.trackClones(c, e);
      }
      return c;
    };
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
        im.decoding = 'async';
        im.onload = () => { im.decode().then(() => res(im), () => res(im)); };
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

  async glb(path: string) {
    const g = await this.track(this.gltf.loadAsync(this.url(path)));
    this.uploadSoon(g.scene);
    return g;
  }

  /** queue every texture of a freshly loaded model for the budgeted per-frame upload (see eagerUpload). The model
   *  is expanded only when its turn comes, so textures a loader swapped out meanwhile (recolours…) are skipped. */
  uploadSoon(root: THREE.Object3D | null | undefined) {
    if (!root || !this.R) return;
    this.eagerUpload([root as any]);
  }

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
