import * as THREE from 'three';
import type { Quality } from './postfx';

/* ============================================================================================
 * Frame-governor helpers (engine.ts): windowed frame statistics with hysteresis, display-refresh estimate,
 * GPU frame timer (EXT_disjoint_timer_query_webgl2), GPU class detection for quality 'auto'.
 * ========================================================================================== */

export type GpuTier = 'software' | 'integrated' | 'mobile' | 'discrete' | 'unknown';

/**
 * Decision helper for the frame governor: windowed stats, refresh-rate estimate, hysteresis + cooldowns,
 * and upward probing with back-off when the GPU time is unknown.
 */
export class Governor {
  refreshMs = 1000 / 60;
  intervalAvg = 16.7;
  cpuAvg = 0;
  slowSeconds = 0;
  private ticks: number[] = [];
  private win = { t: 0, n: 0, sum: 0, cpu: 0, miss: 0, hitch: false };
  private cooldown = 4;
  private slowWins = 0;
  private goodFor = 0;
  private probeWait = 6;
  private lastChange = '';
  private sinceChange = 99;

  reset(cool = 2) { this.cooldown = cool; this.slowWins = 0; this.goodFor = 0; this.win = { t: 0, n: 0, sum: 0, cpu: 0, miss: 0, hitch: false }; }

  /** rAF tick interval → display refresh estimate (robust low percentile, snapped to common rates) */
  refreshSample(dt: number) {
    if (dt <= 2 || dt > 60) return;
    this.ticks.push(dt);
    if (this.ticks.length < 90) return;
    const s = this.ticks.slice().sort((a, b) => a - b);
    const est = s[Math.floor(s.length * 0.2)];
    this.ticks.length = 0;
    const rates = [240, 165, 144, 120, 100, 90, 75, 60, 50, 30];
    let best = 1000 / 60, err = 1e9;
    for (const hz of rates) { const e = Math.abs(1000 / hz - est); if (e < err) { err = e; best = 1000 / hz; } }
    this.refreshMs = err < 0.12 * best ? best : est;
  }

  /** feed one rendered frame; returns a decision every 0.5 s window (or null) */
  frame(intervalMs: number, cpuMs: number, gpuMs: number, targetMs: number): 'slow' | 'up' | null {
    const w = this.win;
    const sec = intervalMs / 1000;
    this.cooldown -= sec;
    this.sinceChange += sec;
    // hitches (shader compiles, loading, scene switches) say nothing about steady-state cost
    if (intervalMs > 250) { w.hitch = true; this.cooldown = Math.max(this.cooldown, 1.5); }
    w.t += sec; w.n++; w.sum += intervalMs; w.cpu += cpuMs;
    if (intervalMs > targetMs * 1.45) w.miss++;
    if (w.t < 0.5) return null;
    const avg = w.sum / w.n, cpu = w.cpu / w.n, missRate = w.miss / w.n, hitch = w.hitch;
    this.win = { t: 0, n: 0, sum: 0, cpu: 0, miss: 0, hitch: false };
    if (hitch) return null;
    this.intervalAvg = avg; this.cpuAvg = cpu;
    const slow = avg > targetMs * 1.18 || missRate > 0.2;
    if (slow) { this.slowWins++; this.slowSeconds += 0.5; this.goodFor = 0; }
    else { this.slowWins = 0; this.slowSeconds = Math.max(0, this.slowSeconds - 0.25); this.goodFor += 0.5; }
    // an upward step that immediately made it slow → back off the next probe
    if (slow && this.lastChange.endsWith('-up') && this.sinceChange < 3) { this.probeWait = Math.min(90, this.probeWait * 2); this.lastChange = 'failed-up'; }
    if (this.cooldown > 0) return null;
    if (slow && this.slowWins >= 2) return 'slow';
    if (!slow) {
      // with a GPU timer we know the headroom → no need to wait long; without, probe with back-off
      const wait = gpuMs >= 0 ? 2 : this.probeWait;
      if (this.goodFor >= wait) { this.goodFor = 0; return 'up'; }
    }
    return null;
  }

  changed(what: string, cool = 1.25) { this.lastChange = what; this.sinceChange = 0; this.cooldown = cool; this.slowWins = 0; this.goodFor = 0; if (!what.endsWith('-up')) this.slowSeconds = Math.max(0, this.slowSeconds - 1); }

  canRaiseRate(newTargetMs: number, gpuMs: number) {
    const cost = Math.max(this.cpuAvg, gpuMs);
    return gpuMs >= 0 ? cost < newTargetMs * 0.8 : true;
  }

  canRaiseScale(cur: number, next: number, targetMs: number, gpuMs: number) {
    if (gpuMs < 0) return true;                       // probe (back-off handles failures)
    const pred = gpuMs * (next * next) / Math.max(1e-3, cur * cur);
    return pred < targetMs * 0.82;
  }
}

/** EXT_disjoint_timer_query_webgl2 frame timer (ring of queries, results read a few frames later). */
export class GpuTimer {
  private q: (WebGLQuery | null)[] = [];
  private busy: boolean[] = [];
  private i = 0;
  private active: WebGLQuery | null = null;
  private constructor(private gl: WebGL2RenderingContext, private ext: any) {
    for (let k = 0; k < 4; k++) { this.q.push(gl.createQuery()); this.busy.push(false); }
  }
  static create(r: THREE.WebGLRenderer): GpuTimer | null {
    try {
      const gl = r.getContext() as WebGL2RenderingContext;
      if (!(gl instanceof WebGL2RenderingContext)) return null;
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      return ext ? new GpuTimer(gl, ext) : null;
    } catch { return null; }
  }
  begin() {
    if (this.active || this.busy[this.i]) return;
    const q = this.q[this.i];
    if (!q) return;
    try { this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q); this.active = q; } catch { this.active = null; }
  }
  end() {
    if (!this.active) return;
    try { this.gl.endQuery(this.ext.TIME_ELAPSED_EXT); } catch {}
    this.busy[this.i] = true;
    this.active = null;
    this.i = (this.i + 1) % this.q.length;
  }
  /** newest finished measurement in ms, or -1 */
  poll(): number {
    const gl = this.gl;
    let out = -1;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    for (let k = 0; k < this.q.length; k++) {
      const q = this.q[k];
      if (!this.busy[k] || !q) continue;
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      this.busy[k] = false;
      if (!disjoint) out = ns / 1e6;
    }
    return out;
  }
}

/** GPU class from the unmasked renderer string (ANGLE wraps it: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 …)"). */
export function gpuTier(name: string): GpuTier {
  const n = name.toLowerCase();
  if (!n) return 'unknown';
  if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(n)) return 'software';
  if (/mali|adreno|powervr|apple a\d|apple gpu|videocore|tegra/.test(n)) return 'mobile';
  if (/geforce|nvidia|quadro|rtx|gtx|radeon rx|radeon pro|rx \d{3,4}|arc\(tm\)|intel\(r\) arc|apple m\d/.test(n) && !/mx\s?\d{3}|geforce gt \d{3}|geforce \d{3}m/.test(n)) return 'discrete';
  if (/intel|uhd|iris|hd graphics|radeon\(tm\) graphics|radeon graphics|vega \d\b|radeon \d{3}m|mx\s?\d{3}/.test(n)) return 'integrated';
  return 'unknown';
}

/** tier for quality 'auto' (the governor still adapts resolution / pacing within it) */
export function autoQuality(t: GpuTier): Quality {
  return t === 'integrated' ? 'medium' : 'high';
}

