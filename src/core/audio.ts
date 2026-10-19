import * as THREE from 'three';
import { asset } from './util';

/**
 * WebAudio sound system.
 *  - Keys come from public/assets/audio/manifest.json: { key: { files[], vol, loop, cat, pitchVar } }
 *  - play(key, {pos}) → positional one-shot (HRTF-free equal-power panner, distance rolloff)
 *  - loop(key, {pos}) → handle you can move / fade / stop (sizzles, engines, ambience)
 *  - music(key) crossfades the music bus; buses: master, sfx, amb, music, voice, meme
 *  - Unknown keys warn once and play nothing (never throw).
 */
export interface SoundOpts {
  pos?: THREE.Vector3 | ArrayLike<number> | null; // world position (omit = 2D)
  vol?: number;
  pitch?: number;         // playback rate multiplier
  loop?: boolean;
  bus?: 'sfx' | 'amb' | 'music' | 'voice' | 'meme' | 'ui';
  ref?: number;           // distance at which volume starts to fall (m)
  max?: number;           // distance where it is ~silent (m)
  delay?: number;         // seconds
  offset?: number;        // start offset seconds (random for loops by default)
  variant?: number;       // force a variant index
  lowpass?: number;       // Hz, e.g. muffled
}

export interface SoundHandle {
  readonly key: string;
  stop(fade?: number): void;
  setPos(p: THREE.Vector3 | ArrayLike<number>): void;
  setVolume(v: number, fade?: number): void;
  setPitch(p: number, fade?: number): void;
  readonly playing: boolean;
}

interface ManifestEntry { files?: string[]; file?: string; vol?: number; loop?: boolean; cat?: string; pitchVar?: number; desc?: string }

const NULL_HANDLE: SoundHandle = { key: '', stop() {}, setPos() {}, setVolume() {}, setPitch() {}, playing: false };

class AudioSys {
  ctx: AudioContext | null = null;
  master!: GainNode;
  buses: Record<string, GainNode> = {};
  manifest: Record<string, ManifestEntry> = {};
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private warned = new Set<string>();
  private listenerPos = new THREE.Vector3();
  private musicHandle: SoundHandle | null = null;
  private musicKey = '';
  private active = new Set<any>();
  volumes = { master: 0.9, sfx: 1, amb: 0.8, music: 0.55, voice: 1, meme: 0.9, ui: 0.8 };
  muted = false;
  /** global slow-motion factor for cutscenes (affects new sounds' pitch) */
  timeScale = 1;

  init() {
    if (this.ctx) return;
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const ctx = this.ctx!;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.gain.value = this.volumes.master;
    this.master.connect(comp).connect(ctx.destination);
    for (const b of ['sfx', 'amb', 'music', 'voice', 'meme', 'ui']) {
      const g = ctx.createGain();
      g.gain.value = (this.volumes as any)[b];
      g.connect(this.master);
      this.buses[b] = g;
    }
    const resume = () => { if (ctx.state !== 'running') ctx.resume().catch(() => {}); };
    window.addEventListener('pointerdown', resume, { capture: true });
    window.addEventListener('keydown', resume, { capture: true });
  }

  async loadManifest() {
    try {
      const r = await fetch(asset('audio/manifest.json'));
      if (r.ok) this.manifest = await r.json();
    } catch { /* no manifest yet */ }
  }

  has(key: string) { return !!this.manifest[key]; }

  setBusVolume(bus: string, v: number) {
    (this.volumes as any)[bus] = v;
    if (bus === 'master' && this.master) this.master.gain.value = this.muted ? 0 : v;
    else if (this.buses[bus]) this.buses[bus].gain.value = v;
  }

  private files(e: ManifestEntry) { return e.files ?? (e.file ? [e.file] : []); }

  private buffer(file: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(file);
    if (!p) {
      p = fetch(asset('audio/' + file.replace(/^audio\//, '')))
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
        .then((ab) => this.ctx!.decodeAudioData(ab))
        .catch((e) => { console.warn('[audio] failed', file, e); return null; });
      this.buffers.set(file, p);
    }
    return p;
  }

  /** Preload keys (e.g. at scene start) so the first play has no latency. */
  preload(keys: string[]) {
    if (!this.ctx) return;
    for (const k of keys) { const e = this.manifest[k]; if (e) for (const f of this.files(e)) this.buffer(f); }
  }

  setListener(cam: THREE.Camera) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    cam.matrixWorld.decompose(p, q, s);
    this.listenerPos.copy(p);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q), u = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(p.x, t, 0.02); L.positionY.setTargetAtTime(p.y, t, 0.02); L.positionZ.setTargetAtTime(p.z, t, 0.02);
      L.forwardX.setTargetAtTime(f.x, t, 0.02); L.forwardY.setTargetAtTime(f.y, t, 0.02); L.forwardZ.setTargetAtTime(f.z, t, 0.02);
      L.upX.setTargetAtTime(u.x, t, 0.02); L.upY.setTargetAtTime(u.y, t, 0.02); L.upZ.setTargetAtTime(u.z, t, 0.02);
    } else {
      (L as any).setPosition(p.x, p.y, p.z);
      (L as any).setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  play(key: string, o: SoundOpts = {}): SoundHandle {
    if (!this.ctx || this.muted) return NULL_HANDLE;
    const e = this.manifest[key];
    if (!e) {
      if (!this.warned.has(key)) { this.warned.add(key); console.warn('[audio] unknown key', key); }
      return NULL_HANDLE;
    }
    const files = this.files(e);
    if (!files.length) return NULL_HANDLE;
    // Skip far-away one-shots entirely.
    if (o.pos && !o.loop && !e.loop) {
      const p = o.pos as any;
      const dx = (p.x ?? p[0]) - this.listenerPos.x, dz = (p.z ?? p[2]) - this.listenerPos.z;
      if (dx * dx + dz * dz > (o.max ?? 45) ** 2) return NULL_HANDLE;
    }
    const ctx = this.ctx;
    const file = files[o.variant ?? Math.floor(Math.random() * files.length)];
    const loop = o.loop ?? e.loop ?? false;
    const gain = ctx.createGain();
    const baseVol = (e.vol ?? 1) * (o.vol ?? 1);
    gain.gain.value = 0;
    let out: AudioNode = gain;
    let panner: PannerNode | null = null;
    if (o.lowpass) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = o.lowpass;
      gain.connect(lp); out = lp;
    }
    if (o.pos) {
      panner = ctx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = o.ref ?? 2;
      panner.maxDistance = o.max ?? 45;
      panner.rolloffFactor = 1.3;
      const p = o.pos as any;
      setPannerPos(panner, p.x ?? p[0], p.y ?? p[1], p.z ?? p[2], ctx.currentTime, true);
      out.connect(panner);
      out = panner;
    }
    const bus = this.buses[o.bus ?? (e.cat as any) ?? 'sfx'] ?? this.buses.sfx;
    out.connect(bus);
    const pv = e.pitchVar ?? 0.05;
    const rate = (o.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * pv) * this.timeScale;
    let src: AudioBufferSourceNode | null = null;
    let stopped = false;
    const state = { playing: true };
    const startAt = ctx.currentTime + (o.delay ?? 0);
    this.buffer(file).then((buf) => {
      if (!buf || stopped) return;
      src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = loop;
      src.playbackRate.value = rate;
      src.connect(gain);
      const off = o.offset ?? (loop ? Math.random() * buf.duration : 0);
      const t0 = Math.max(ctx.currentTime, startAt);
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(baseVol, t0 + (loop ? 0.25 : 0.005));
      src.start(t0, off % buf.duration);
      src.onended = () => { state.playing = false; this.active.delete(h); cleanup(); };
    });
    const cleanup = () => { try { gain.disconnect(); panner?.disconnect(); } catch {} };
    const h: SoundHandle = {
      key,
      get playing() { return state.playing; },
      stop: (fade = 0.15) => {
        if (stopped) return;
        stopped = true;
        state.playing = false;
        const t = ctx.currentTime;
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(gain.gain.value, t);
        gain.gain.linearRampToValueAtTime(0, t + fade);
        setTimeout(() => { try { src?.stop(); } catch {} cleanup(); this.active.delete(h); }, fade * 1000 + 50);
      },
      setPos: (p: any) => { if (panner) setPannerPos(panner, p.x ?? p[0], p.y ?? p[1], p.z ?? p[2], ctx.currentTime, false); },
      setVolume: (v: number, fade = 0.1) => { gain.gain.setTargetAtTime((e.vol ?? 1) * v, ctx.currentTime, Math.max(0.01, fade / 3)); },
      setPitch: (pp: number, fade = 0.1) => { if (src) src.playbackRate.setTargetAtTime(pp * this.timeScale, ctx.currentTime, Math.max(0.01, fade / 3)); },
    };
    this.active.add(h);
    return h;
  }

  /** Looping sound. Same as play(..., {loop:true}). */
  loop(key: string, o: SoundOpts = {}): SoundHandle { return this.play(key, { ...o, loop: true }); }

  /** Crossfade background music. Pass '' to stop. */
  music(key: string, fade = 2) {
    if (key === this.musicKey) return;
    this.musicKey = key;
    this.musicHandle?.stop(fade);
    this.musicHandle = key ? this.play(key, { loop: true, bus: 'music', offset: 0 }) : null;
  }

  stopAll(fade = 0.3) { for (const h of [...this.active]) h.stop(fade); this.musicKey = ''; }
}

function setPannerPos(p: PannerNode, x: number, y: number, z: number, t: number, snap: boolean) {
  if (p.positionX) {
    if (snap) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; }
    else { p.positionX.setTargetAtTime(x, t, 0.03); p.positionY.setTargetAtTime(y, t, 0.03); p.positionZ.setTargetAtTime(z, t, 0.03); }
  } else (p as any).setPosition(x, y, z);
}

export const Sound = new AudioSys();
