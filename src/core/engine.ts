import * as THREE from 'three';
import { PostFX, Quality } from './postfx';
import { Input } from './input';
import { Sound } from './audio';
import { Assets } from './assets';
import { Ease, Tween, params } from './util';

export interface Frame { dt: number; rawDt: number; time: number; frame: number }
type Fn = (f: Frame) => void;

/**
 * Renderer + main loop.
 *  - onFixed: fixed 60 Hz steps (physics, host simulation). Keeps running at 20 Hz when the tab is hidden
 *    so a backgrounded host keeps the multiplayer game alive.
 *  - onFrame: once per rendered frame (visuals, interpolation, input handling).
 *  - onLate: after onFrame, before render (camera follow, UI billboards).
 * `timeScale` slows game time (slow-motion cutscenes); rawDt is real time.
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  post: PostFX;
  time = 0;
  realTime = 0;
  frame = 0;
  timeScale = 1;
  readonly fixedDt = 1 / 60;
  private acc = 0;
  private fixedFns = new Set<Fn>();
  private frameFns = new Set<Fn>();
  private lateFns = new Set<Fn>();
  private tweens: Tween[] = [];
  private last = performance.now();
  private running = false;
  private hiddenTimer: any = null;
  /** drawing-buffer pixel ratio (≤ device pixel ratio) */
  pixelRatio = 1;
  private maxPixelRatio = 1.5;
  /** internal render scale on top of the drawing buffer: ultra supersamples (>1), adaptive drops below 1 only when truly slow */
  renderScale = 1;
  private nominalScale = 1;
  private minScale = 0.7;
  private adaptive = true;
  private ftAvg = 16;
  private adaptCooldown = 4;
  private slowFor = 0;
  fps = 60;
  /** Called with Frame when an uncaught error happens inside a loop callback (shown in debug overlay). */
  onError: ((e: any) => void) | null = null;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: params.has('capture') });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x0b0906, 1);
    this.canvas = this.renderer.domElement;
    this.canvas.tabIndex = 0;
    container.appendChild(this.canvas);
    Assets.maxAnisotropy = Math.min(16, this.renderer.capabilities.getMaxAnisotropy());
    installAnisotropyFloor();
    // adaptive resolution is pointless on a software rasterizer (headless SwiftShader): keep the real look there
    if (params.get('adapt') === '0' || /swiftshader|llvmpipe|softpipe|software/i.test(rendererName(this.renderer))) this.adaptive = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 900);
    this.post = new PostFX(this.renderer, this.scene, this.camera);
    const q = (params.get('quality') as Quality) || (localStorage.getItem('hp.quality') as Quality) || 'high';
    this.setQuality(q);
    Input.attach(this.canvas);
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => this.onVisibility());
    this.resize();
  }

  /**
   * Quality tiers
   *  low     drawing buffer 0.85 (browser upscale), no AO / shafts / grain — fast
   *  medium  1× CSS pixels, no CA, no sharpening
   *  high    native device pixel ratio (up to 2) + light CAS sharpening; adaptive scale only drops below
   *          native when the frame time is really bad (> 30 ms for a while) and climbs back fast
   *  ultra   native DPR × 1.5–2 supersampling (≤ ~14.7 MP internal) with a tent downsample
   */
  setQuality(q: Quality) {
    this.post.setQuality(q);
    const dpr = window.devicePixelRatio || 1;
    this.maxPixelRatio = q === 'low' ? Math.min(dpr, 0.85) : q === 'medium' ? Math.min(dpr, 1) : Math.min(dpr, 2);
    this.pixelRatio = this.maxPixelRatio;
    const px = innerWidth * innerHeight * this.maxPixelRatio * this.maxPixelRatio;
    const ss = q === 'ultra' ? Math.max(1, Math.min(dpr >= 2 ? 1.5 : 2, Math.sqrt(14.7e6 / Math.max(1, px)))) : 1;
    this.nominalScale = ss;
    this.renderScale = ss;
    this.minScale = q === 'ultra' ? 0.75 : q === 'high' ? 0.7 : 1;
    this.renderer.shadowMap.type = q === 'low' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    try { localStorage.setItem('hp.quality', q); } catch {}
    this.adaptCooldown = 3;
    this.resize();
  }
  get quality(): Quality { return this.post.quality; }

  /** What to render. Scenes call this on enter. */
  setView(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    this.post.setView(scene, camera);
  }

  onFixed(fn: Fn) { this.fixedFns.add(fn); return () => this.fixedFns.delete(fn); }
  onFrame(fn: Fn) { this.frameFns.add(fn); return () => this.frameFns.delete(fn); }
  onLate(fn: Fn) { this.lateFns.add(fn); return () => this.lateFns.delete(fn); }

  /** Promise-based tween on game time (respects timeScale unless real=true). */
  tween(dur: number, onUpdate: (k: number) => void, ease: (t: number) => number = Ease.inOutCubic, delay = 0): Promise<void> {
    return new Promise((resolve) => {
      if (dur <= 0) { onUpdate(1); resolve(); return; }
      this.tweens.push({ t: 0, dur, ease, onUpdate, resolve, delay });
    });
  }
  /** Wait game seconds. */
  wait(sec: number) { return this.tween(sec, () => {}, Ease.linear); }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post.scale = this.renderScale;
    this.post.setSize(w, h);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = () => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      if (document.hidden) return;
      this.step();
    };
    requestAnimationFrame(loop);
  }

  private onVisibility() {
    if (document.hidden) {
      // Keep simulation alive in background (needed when this peer hosts).
      this.hiddenTimer = setInterval(() => {
        const now = performance.now();
        const raw = Math.min(0.25, (now - this.last) / 1000);
        this.last = now;
        this.runFixed(raw * this.timeScale);
      }, 50);
    } else {
      clearInterval(this.hiddenTimer);
      this.hiddenTimer = null;
      this.last = performance.now();
    }
  }

  private runFixed(dt: number) {
    this.acc += dt;
    let n = 0;
    while (this.acc >= this.fixedDt && n < 8) {
      const f = { dt: this.fixedDt, rawDt: this.fixedDt, time: this.time, frame: this.frame };
      for (const fn of this.fixedFns) this.safe(fn, f);
      this.acc -= this.fixedDt;
      n++;
    }
    if (n === 8) this.acc = 0;
  }

  private safe(fn: Fn, f: Frame) {
    try { fn(f); } catch (e) { console.error(e); this.onError?.(e); }
  }

  /** One frame. Exposed for tests (window.__hp.engine.step()). */
  step() {
    const now = performance.now();
    const raw = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const dt = raw * this.timeScale;
    this.time += dt;
    this.realTime += raw;
    this.frame++;
    this.runFixed(dt);
    const f: Frame = { dt, rawDt: raw, time: this.time, frame: this.frame };
    // tweens
    for (const tw of this.tweens) {
      if (tw.delay > 0) { tw.delay -= dt; continue; }
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      try { tw.onUpdate(tw.ease(k)); } catch (e) { console.error(e); }
      if (k >= 1) { tw.dead = true; tw.resolve(); }
    }
    this.tweens = this.tweens.filter((t) => !t.dead);
    for (const fn of this.frameFns) this.safe(fn, f);
    for (const fn of this.lateFns) this.safe(fn, f);
    Sound.setListener(this.camera);
    this.post.render(raw);
    Input.endFrame();
    this.adapt(raw);
  }

  /**
   * Adaptive resolution. high/ultra move the internal render scale (the drawing buffer stays native, the final
   * pass resamples + sharpens); low/medium move the drawing-buffer pixel ratio. Drops need a sustained bad frame
   * time; recovery is quick.
   */
  private adapt(raw: number) {
    this.ftAvg += (raw * 1000 - this.ftAvg) * 0.05;
    this.fps = 1000 / this.ftAvg;
    if (!this.adaptive || document.hidden) return;
    this.adaptCooldown -= raw;
    const q = this.post.quality;
    const scaled = q === 'high' || q === 'ultra';
    // ultra sheds supersampling first (> 20 ms), below native only when truly bad (> 30 ms)
    const badMs = scaled && this.renderScale > 1.001 ? 20 : scaled ? 30 : 24;
    this.slowFor = this.ftAvg > badMs ? this.slowFor + raw : 0;
    if (this.adaptCooldown > 0) return;
    if (scaled) {
      if (this.slowFor > 1.5 && this.renderScale > this.minScale + 1e-3) {
        const step = this.renderScale > 1.001 ? 0.25 : 0.1;
        this.renderScale = Math.max(this.minScale, this.renderScale - step);
        if (this.renderScale > 1 && this.renderScale < 1.12) this.renderScale = 1;
        this.resize();
        this.adaptCooldown = 1.5;
        this.slowFor = 0;
      } else if (this.ftAvg < (this.renderScale >= 1 ? 13 : 20) && this.renderScale < this.nominalScale - 1e-3) {
        this.renderScale = Math.min(this.nominalScale, this.renderScale + (this.renderScale >= 1 ? 0.25 : 0.1));
        this.resize();
        this.adaptCooldown = 0.75;
      }
      return;
    }
    if (this.slowFor > 1.5 && this.pixelRatio > 0.6) {
      this.pixelRatio = Math.max(0.6, this.pixelRatio - 0.1);
      this.resize();
      this.adaptCooldown = 1.5;
      this.slowFor = 0;
    } else if (this.ftAvg < 14 && this.pixelRatio < this.maxPixelRatio) {
      this.pixelRatio = Math.min(this.maxPixelRatio, this.pixelRatio + 0.1);
      this.resize();
      this.adaptCooldown = 0.75;
    }
  }
}

function rendererName(r: THREE.WebGLRenderer): string {
  try {
    const gl = r.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch { return ''; }
}

/**
 * Crisp textures at grazing angles everywhere: every trilinear-mipmapped texture gets at least the device's
 * max anisotropy (≤ 16), including the ones modules create with a hard-coded 4/8. (three only applies it to
 * mipmapped, non-nearest textures, so render targets are unaffected.)
 */
function installAnisotropyFloor() {
  const proto = THREE.Texture.prototype as any;
  if (proto.__anisoFloor) return;
  proto.__anisoFloor = true;
  const KEY = Symbol('aniso');
  Object.defineProperty(proto, 'anisotropy', {
    configurable: true,
    get(this: any) { return Math.max(this[KEY] ?? 1, Assets.maxAnisotropy); },
    set(this: any, v: number) { this[KEY] = v; },
  });
}
