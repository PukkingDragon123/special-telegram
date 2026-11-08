import * as THREE from 'three';
import { PostFX, Quality } from './postfx';
import { Input } from './input';
import { Sound } from './audio';
import { Assets } from './assets';
import { Ease, Tween, params } from './util';
import { Governor, GpuTimer, gpuTier, autoQuality, GpuTier } from './perf';

export interface Frame { dt: number; rawDt: number; time: number; frame: number }
type Fn = (f: Frame) => void;
/** 'auto' = no explicit choice saved: the tier is picked from the GPU and may step down at runtime. */
export type QualityMode = Quality | 'auto';
export type { GpuTier } from './perf';

/**
 * Internal render-resolution budget per quality (megapixels of the 3D render, before the final resample).
 * The old behaviour rendered every effect at the full device resolution — fine on a phone (≈1.3 MP), but a
 * maximized window on a 1440p / 4K PC monitor is 3.7–8.3 MP (×DPR²) and every pass (AO, bloom, SMAA, shafts,
 * planar reflection) scales with it. `start` is where a session begins; the frame governor moves between
 * `min` and the native resolution (×supersampling at ultra) from measured frame times.
 */
const QKEY = 'hp.qualityMode';
const BUDGET: Record<Quality, { dpr: number; startMP: number; minMP: number; maxSS: number }> = {
  low: { dpr: 1, startMP: 0.95, minMP: 0.45, maxSS: 1 },
  medium: { dpr: 1.25, startMP: 1.6, minMP: 0.8, maxSS: 1 },
  high: { dpr: 2, startMP: 2.6, minMP: 1.2, maxSS: 1 },
  ultra: { dpr: 2, startMP: 8.3, minMP: 2.0, maxSS: 2 },
};

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
  private overlayFns = new Set<Fn>();
  private tweens: Tween[] = [];
  private last = performance.now();
  private running = false;
  private hiddenTimer: any = null;
  /** drawing-buffer pixel ratio (≤ device pixel ratio) */
  pixelRatio = 1;
  /** internal render scale on top of the drawing buffer: ultra supersamples (>1), the governor drops below 1 under load */
  renderScale = 1;
  /** highest scale the governor may use (native, or the supersampling factor at ultra) */
  private maxScale = 1;
  private minScale = 0.7;
  private adaptive = true;
  private ftAvg = 16;
  fps = 60;
  /** quality chosen by the player, or 'auto' */
  qualityMode: QualityMode = 'auto';
  readonly gpu: { name: string; tier: GpuTier };
  /** display refresh interval (ms), measured from requestAnimationFrame ticks */
  refreshMs = 1000 / 60;
  /** render on every n-th display refresh (smooth frame pacing on 120–240 Hz monitors that can't be fed) */
  frameDivider = 1;
  /** sun shadow maps re-rendered every n-th frame (only throttled under heavy load) */
  shadowEvery = 1;
  /** JS time per frame (simulation + scene update + draw submission), ms (smoothed) */
  cpuMs = 0;
  /** GPU time per frame from EXT_disjoint_timer_query_webgl2 (ms, smoothed), -1 = unavailable */
  gpuMs = -1;
  private resizePending = false;
  private gov = new Governor();
  private gpuTimer: GpuTimer | null = null;
  private tick = 0;
  private lastTick = 0;
  private lastPx = 0;
  /** optional-work hint for modules (planar reflection, far LOD updates…): render it every n-th frame. 1 normally,
   *  2 while the governor is throttling shadows (heavy load). */
  reflectEvery = 1;
  /** Called with Frame when an uncaught error happens inside a loop callback (shown in debug overlay). */
  onError: ((e: any) => void) | null = null;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: params.has('capture') });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x0b0906, 1);
    // draw-call / triangle counters cover the whole frame (scene + shadows + reflection + post), reset per frame
    this.renderer.info.autoReset = false;
    this.canvas = this.renderer.domElement;
    this.canvas.tabIndex = 0;
    container.appendChild(this.canvas);
    Assets.maxAnisotropy = Math.min(16, this.renderer.capabilities.getMaxAnisotropy());
    installAnisotropyFloor();
    const name = rendererName(this.renderer);
    this.gpu = { name, tier: gpuTier(name) };
    // adaptive resolution is pointless on a software rasterizer (headless SwiftShader): keep the real look there
    if (params.get('adapt') === '0' || this.gpu.tier === 'software') this.adaptive = false;
    if (this.adaptive) this.gpuTimer = GpuTimer.create(this.renderer);
    // a lost context (driver reset, GPU switch, sleep) must not leave a black canvas forever
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); console.warn('[engine] WebGL context lost'); }, false);
    this.canvas.addEventListener('webglcontextrestored', () => { console.warn('[engine] WebGL context restored'); this.resizePending = true; }, false);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 900);
    this.post = new PostFX(this.renderer, this.scene, this.camera);
    // ?quality=low|medium|high|ultra wins for this session only (not saved); otherwise the saved menu choice
    // no saved choice (or saved 'auto') → pick from the GPU; the governor keeps it smooth at runtime
    // (new key: the old 'hp.quality' was written on every launch, so it never meant an explicit choice)
    const urlQ = params.get('quality') === 'auto' ? 'auto' : asQuality(params.get('quality'));
    let savedQ: QualityMode | null = null;
    try { const v = localStorage.getItem(QKEY); savedQ = v === 'auto' ? 'auto' : asQuality(v); } catch {}
    this.setQuality(urlQ ?? savedQ ?? 'auto', false);
    Input.attach(this.canvas);
    // window resizes are applied at the start of the next frame, right before it renders (see step())
    window.addEventListener('resize', () => { this.resizePending = true; });
    document.addEventListener('visibilitychange', () => this.onVisibility());
    window.addEventListener('keydown', (e) => { if (e.code === 'F9') this.perfHud(!this.hudEl); });
    if (params.has('perf')) this.perfHud(true);
    this.applyResize();
  }

  /**
   * Quality tiers (all render the 3D view at an internal resolution inside a per-tier pixel budget, see BUDGET;
   * the final pass resamples to the native drawing buffer with contrast-adaptive sharpening)
   *  low     ≤ 0.95 MP, no AO / shafts / grain / reflections — fast
   *  medium  ≤ 1.6 MP, no CA, no sharpening, env-map reflections
   *  high    ≤ 2.6 MP to start (1080p native), planar reflections, AO; the governor climbs to native when the
   *          GPU has headroom and drops (to ≥ 1.2 MP) when the frame time is over budget
   *  ultra   supersampled (≤ 8.3 MP) with a tent downsample
   * `q` may be 'auto' (pick from the GPU, may step down at runtime). Explicit choices are saved.
   */
  setQuality(q: QualityMode, persist = true) {
    const mode: QualityMode = q === 'auto' ? 'auto' : asQuality(q) ?? 'high';
    this.qualityMode = mode;
    if (persist) { try { localStorage.setItem(QKEY, mode); } catch {} }
    this.applyQuality(mode === 'auto' ? autoQuality(this.gpu.tier) : mode);
  }

  /** set the effective tier (keeps qualityMode) */
  private applyQuality(q: Quality) {
    this.post.setQuality(q);
    // anisotropic filtering is texture bandwidth: full on high/ultra (unchanged look), cheaper on the low tiers
    // (applies to textures uploaded from now on — tiers are normally chosen before the world loads)
    const maxA = Math.min(16, this.renderer.capabilities.getMaxAnisotropy());
    Assets.maxAnisotropy = q === 'low' ? Math.min(2, maxA) : q === 'medium' ? Math.min(4, maxA) : maxA;
    this.renderer.shadowMap.type = q === 'low' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    this.gov.reset(4);
    this.shadowEvery = 1;
    this.reflectEvery = 1;
    this.frameDivider = 1;
    this.fitBudget(true);
  }

  /** Recompute drawing-buffer DPR + the internal scale range from the tier budget and the window size. */
  private fitBudget(reset: boolean) {
    const q = this.post.quality, b = BUDGET[q];
    const dpr = window.devicePixelRatio || 1;
    this.pixelRatio = Math.min(dpr, b.dpr);
    const px = Math.max(1, innerWidth * innerHeight * this.pixelRatio * this.pixelRatio);
    const fit = (mp: number) => Math.sqrt((mp * 1e6) / px);
    // ultra: supersample up to 2× (1.5× on hi-dpi screens) within its budget; others never above native
    this.maxScale = q === 'ultra' ? Math.max(1, Math.min(dpr >= 2 ? 1.5 : b.maxSS, fit(14.7))) : 1;
    this.minScale = Math.min(this.maxScale, Math.max(0.45, fit(b.minMP)));
    const start = this.adaptive ? Math.min(this.maxScale, fit(b.startMP)) : (q === 'ultra' ? Math.min(this.maxScale, fit(b.startMP)) : 1);
    if (reset || !this.adaptive) this.renderScale = Math.max(this.minScale, start);
    else this.renderScale = Math.max(this.minScale, Math.min(this.maxScale, this.renderScale));
    // the old tiers at native size on a software rasterizer (tests / headless): unchanged look
    if (!this.adaptive && q !== 'ultra') this.renderScale = q === 'low' ? Math.min(1, Math.max(0.5, fit(b.startMP))) : 1;
    this.resizePending = true;
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
  /** after post-processing: draw screen-space 3D overlays (HUD hotbar items) straight onto the canvas */
  onOverlay(fn: Fn) { this.overlayFns.add(fn); return () => this.overlayFns.delete(fn); }

  /** Promise-based tween on game time (respects timeScale unless real=true). */
  tween(dur: number, onUpdate: (k: number) => void, ease: (t: number) => number = Ease.inOutCubic, delay = 0): Promise<void> {
    return new Promise((resolve) => {
      if (dur <= 0) { onUpdate(1); resolve(); return; }
      this.tweens.push({ t: 0, dur, ease, onUpdate, resolve, delay });
    });
  }
  /** Wait game seconds. */
  wait(sec: number) { return this.tween(sec, () => {}, Ease.linear); }

  /** Request a resize; applied at the start of the next frame (never between a render and its presentation). */
  resize() { this.resizePending = true; }

  /**
   * Resizing the canvas (even to the same size) resets the WebGL drawing buffer. Doing it after a frame was
   * rendered but before the browser presented it shows the clear colour (near black) for one frame — the old
   * adaptive-resolution code did exactly that on every step, which flashed black on PCs hovering around the
   * threshold. Now: only at the start of a frame, only touching the canvas when its size really changes.
   */
  private applyResize() {
    this.resizePending = false;
    const w = window.innerWidth, h = window.innerHeight;
    // a much bigger / smaller window (maximize, other monitor, DPR change) restarts from the tier budget
    const px = w * h * (window.devicePixelRatio || 1) ** 2;
    this.fitBudget(Math.abs(px - this.lastPx) > 0.2 * Math.max(1, this.lastPx));
    this.lastPx = px;
    this.resizePending = false;
    const cw = Math.floor(w * this.pixelRatio), ch = Math.floor(h * this.pixelRatio);
    if (this.canvas.width !== cw || this.canvas.height !== ch || this.renderer.getPixelRatio() !== this.pixelRatio) {
      this.renderer.setPixelRatio(this.pixelRatio);
      this.renderer.setSize(w, h, false);
    }
    if (this.canvas.style.width !== w + 'px') this.canvas.style.width = w + 'px';
    if (this.canvas.style.height !== h + 'px') this.canvas.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post.scale = this.renderScale;
    this.post.setSize(w, h);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (ts: number) => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      if (document.hidden) return;
      // every display refresh ticks; we render on every frameDivider-th tick (even pacing on 120–240 Hz screens)
      if (this.lastTick) this.gov.refreshSample(ts - this.lastTick);
      this.lastTick = ts;
      this.refreshMs = this.gov.refreshMs;
      if (++this.tick % this.frameDivider !== 0) return;
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
    if (this.resizePending) this.applyResize();
    const interval = now - this.last;
    const raw = Math.min(0.1, interval / 1000);
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
    // shadow throttling (governor, heavy load only): re-render the shadow maps every n-th frame
    const sm = this.renderer.shadowMap;
    if (this.shadowEvery > 1) { sm.autoUpdate = false; sm.needsUpdate = this.frame % this.shadowEvery === 0; }
    else if (!sm.autoUpdate) sm.autoUpdate = true;
    this.renderer.info.reset();
    this.gpuTimer?.begin();
    this.post.render(raw);
    for (const fn of this.overlayFns) this.safe(fn, f);
    this.gpuTimer?.end();
    Input.endFrame();
    const cpu = performance.now() - now;
    this.cpuMs += (cpu - this.cpuMs) * 0.1;
    if (this.gpuTimer) { const g = this.gpuTimer.poll(); if (g >= 0) this.gpuMs = this.gpuMs < 0 ? g : this.gpuMs + (g - this.gpuMs) * 0.1; }
    this.adapt(interval, cpu);
    this.updateHud(raw);
  }

  /**
   * Frame governor (desktop lag). Every 0.5 s window it compares the delivered frame interval with the target
   * (display refresh × divider) and, when frames are missed, in this order: halves the frame rate on 120–240 Hz
   * monitors (even pacing beats a judder between 70 and 144), lowers the internal resolution (GPU-bound only —
   * when the JS side is the bottleneck pixels don't help), throttles the shadow maps, and finally (quality
   * 'auto' only) steps the tier down. It climbs back when the GPU timer shows headroom, or by probing with an
   * exponential back-off when no timer exists. Off on software rasterizers and with ?adapt=0.
   */
  private adapt(intervalMs: number, cpuMs: number) {
    this.ftAvg += (intervalMs - this.ftAvg) * 0.05;
    this.fps = 1000 / Math.max(1, this.ftAvg);
    if (!this.adaptive || document.hidden) return;
    const d = this.gov.frame(intervalMs, cpuMs, this.gpuMs, this.refreshMs * this.frameDivider);
    if (!d) return;
    const q = this.post.quality;
    if (d === 'slow') {
      // 1) pacing on high-refresh screens: 144 → 72, 165 → 82, 240 → 120/80/60 (never below ~55 fps)
      if (1000 / (this.refreshMs * (this.frameDivider + 1)) >= 55 && this.refreshMs < 12) { this.frameDivider++; this.gov.changed('divider'); return; }
      // CPU-bound: the JS side alone overruns the frame budget (vsync inflates the measured interval, so compare
      // with the budget, not the interval) — fewer pixels would only make it blurrier
      const budget = this.refreshMs * this.frameDivider;
      const cpuBound = this.gpuMs >= 0 ? this.gov.cpuAvg >= this.gpuMs && this.gov.cpuAvg > 0.7 * budget : this.gov.cpuAvg > 0.85 * budget;
      // 2) resolution (GPU-bound)
      if (!cpuBound && this.renderScale > this.minScale + 1e-3) {
        this.renderScale = Math.max(this.minScale, this.renderScale * (this.renderScale > 1.001 ? 0.8 : 0.88));
        if (this.renderScale > 1 && this.renderScale < 1.08) this.renderScale = 1;
        this.resizePending = true; this.gov.changed('scale'); return;
      }
      // 3) shadows at half rate (helps both CPU — fewer draw calls — and GPU)
      if (this.shadowEvery === 1) { this.shadowEvery = 2; this.reflectEvery = 2; this.gov.changed('shadow'); return; }
      // 4) auto quality: one tier down after a sustained struggle
      if (this.qualityMode === 'auto' && q !== 'low' && !cpuBound && this.gov.slowSeconds > 8) {
        const next: Quality = q === 'ultra' ? 'high' : q === 'high' ? 'medium' : 'low';
        console.info(`[engine] auto quality ${q} → ${next} (${this.fps.toFixed(0)} fps, gpu ${this.gpuMs.toFixed(1)} ms, cpu ${this.gov.cpuAvg.toFixed(1)} ms)`);
        this.post.setQuality(next);
        this.renderer.shadowMap.type = next === 'low' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
        this.fitBudget(false);
        this.gov.changed('tier', 6);
      }
      return;
    }
    // d === 'up': undo the cheapest-to-undo degradation first
    if (this.shadowEvery > 1) { this.shadowEvery = 1; this.reflectEvery = 1; this.gov.changed('shadow-up'); return; }
    if (this.frameDivider > 1 && this.gov.canRaiseRate(this.refreshMs * (this.frameDivider - 1), this.gpuMs)) { this.frameDivider--; this.gov.changed('divider-up'); return; }
    if (this.renderScale < this.maxScale - 1e-3 && this.gov.canRaiseScale(this.renderScale, Math.min(this.maxScale, this.renderScale * 1.1), this.refreshMs * this.frameDivider, this.gpuMs)) {
      this.renderScale = Math.min(this.maxScale, this.renderScale * (this.renderScale >= 1 ? 1.15 : 1.1));
      if (this.renderScale > 0.97 && this.renderScale < 1.03) this.renderScale = 1;
      this.resizePending = true; this.gov.changed('scale-up');
    }
  }

  private hudEl: HTMLDivElement | null = null;
  private hudT = 0;
  /** Tiny perf readout (top-left): ?perf, or `__hp.engine.perfHud(true)` / F9 in game builds. */
  perfHud(on: boolean) {
    if (!on) { this.hudEl?.remove(); this.hudEl = null; return; }
    if (this.hudEl) return;
    const d = (this.hudEl = document.createElement('div'));
    d.style.cssText = 'position:fixed;left:6px;top:6px;z-index:99;font:11px/1.35 ui-monospace,monospace;color:#e8ffe0;background:rgba(0,0,0,.55);padding:4px 7px;border-radius:4px;pointer-events:none;white-space:pre';
    document.body.appendChild(d);
  }
  private updateHud(raw: number) {
    if (!this.hudEl || (this.hudT += raw) < 0.5) return;
    this.hudT = 0;
    const p = this.perfInfo(), i = this.renderer.info.render;
    this.hudEl.textContent = `${p.fps} fps · ${p.refreshHz} Hz${p.divider > 1 ? ' ÷' + p.divider : ''} · ${p.quality}${p.mode === 'auto' ? ' (auto)' : ''}\n`
      + `render ${p.internal} (×${p.scale}) · shadows 1/${p.shadowEvery}\ncpu ${p.cpuMs} ms · gpu ${p.gpuMs < 0 ? 'n/a' : p.gpuMs + ' ms'} · ${i.calls} calls · ${(i.triangles / 1e6).toFixed(2)} M tris\n${p.gpu.name.slice(0, 64)}`;
  }

  /** Debug / HUD: what the governor is doing. */
  perfInfo() {
    const r = this.post.renderSize;
    return { quality: this.post.quality, mode: this.qualityMode, gpu: this.gpu, fps: +this.fps.toFixed(1), refreshHz: +(1000 / this.refreshMs).toFixed(0), divider: this.frameDivider,
      scale: +this.renderScale.toFixed(3), internal: `${r.w}×${r.h}`, shadowEvery: this.shadowEvery, cpuMs: +this.cpuMs.toFixed(2), gpuMs: +this.gpuMs.toFixed(2), adaptive: this.adaptive };
  }
}

function asQuality(v: string | null | undefined): Quality | null {
  return v === 'low' || v === 'medium' || v === 'high' || v === 'ultra' ? v : null;
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
