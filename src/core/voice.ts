import * as THREE from 'three';
import { Sound } from './audio';
import { asset } from './util';

/* ============================================================================================
 * Voice acting. Every Thai line the game speaks (cutscenes, the tutorial, the stand, NPC barks,
 * conversations) may have a pre-generated clip in public/assets/audio/voice/, keyed by an FNV-1a
 * hash of the line's Thai text (scripts/voice/extract_lines.py + gen_voice.py — Meta MMS-TTS Thai,
 * CC-BY-NC 4.0, non-commercial fan project). One neutral take per line; characters get their own
 * voice at runtime: playback rate (pitch + pace), EQ and an FX send (hall reverb for the casino,
 * spooky echo for ghosts and the stand, phone/radio band-pass).
 *   Voice.say(text, { rate, fx, pos, vol }) → VoiceClip | null (null = no clip for this line)
 *   Voice.duration(text, rate)               → seconds the clip will take (or 0)
 * While any line plays, music and ambience duck. Settings: bus 'voice' (Sound.setBusVolume).
 * ========================================================================================== */

export type VoiceFx = 'none' | 'hall' | 'echo' | 'ghost' | 'radio' | 'inner';

export interface VoiceOpts {
  /** playback rate: < 1 deeper + slower (old man 0.86), > 1 higher + quicker (aunties 1.18) */
  rate?: number;
  fx?: VoiceFx;
  /** world position (positional, follows setPos); omit = 2D (conversations, cutscene subtitles) */
  pos?: THREE.Vector3 | null;
  vol?: number;
  /** a second line from the same channel stops the previous one (e.g. one speaker) */
  channel?: unknown;
}

export interface VoiceClip {
  readonly duration: number;
  readonly playing: boolean;
  stop(fade?: number): void;
  setPos(p: THREE.Vector3): void;
}

export function voiceKey(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  let h = 0x811c9dc5;
  const b = new TextEncoder().encode(t);
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** A plausible speaking rate from a babble pitch / speaker hints (bubbles + dialogues pass babble pitches 0.5–1.5). */
export function rateFromPitch(p: number | undefined): number {
  const v = p ?? 1;
  return Math.max(0.74, Math.min(1.32, 0.62 + v * 0.38));
}

class VoiceSys {
  private man: Record<string, [string, number]> = {};
  private loading: Promise<void> | null = null;
  private bufs = new Map<string, Promise<AudioBuffer | null>>();
  private live = new Set<{ stop(f?: number): void; playing: boolean }>();
  private channels = new Map<unknown, VoiceClip>();
  private fxNodes: Partial<Record<VoiceFx, AudioNode>> = {};
  private duckK = 1;
  /** voice volume multiplier on top of the voice bus (settings) */
  enabled = true;
  /** log plays (tests: window.__voiceLog) */
  log: { k: string; t: number; d: number; rate: number; fx: string }[] = [];

  load() {
    if (!this.loading) {
      this.loading = fetch(asset('audio/voice/manifest.json'))
        .then((r) => (r.ok ? r.json() : {}))
        .then((m) => { this.man = m ?? {}; })
        .catch(() => { this.man = {}; });
      (window as any).__voice = this;
    }
    return this.loading;
  }

  get count() { return Object.keys(this.man).length; }

  has(text: string | undefined | null) { return !!text && !!this.man[voiceKey(text)]; }

  /** clip length at this rate (0 = no clip) */
  duration(text: string | undefined | null, rate = 1) {
    if (!text) return 0;
    const e = this.man[voiceKey(text)];
    return e ? e[1] / Math.max(0.3, rate) : 0;
  }

  /** prefetch clips for lines that are about to play (cutscene beats) */
  prefetch(texts: (string | undefined)[]) { for (const t of texts) if (t) { const e = this.man[voiceKey(t)]; if (e) this.buffer(e[0]); } }

  private buffer(file: string) {
    let p = this.bufs.get(file);
    if (!p) {
      const ctx = Sound.ctx;
      if (!ctx) return Promise.resolve(null);   // audio not started yet: don't cache the miss
      p = fetch(asset('audio/voice/' + file))
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
        .then((ab) => ctx.decodeAudioData(ab))
        .catch(() => null);
      this.bufs.set(file, p);
      if (this.bufs.size > 160) { const first = this.bufs.keys().next().value; if (first !== undefined && first !== file) this.bufs.delete(first); }
    }
    return p;
  }

  /** shared FX returns (created lazily, feeding the voice bus) */
  private fx(kind: VoiceFx, ctx: AudioContext): AudioNode | null {
    if (kind === 'none' || kind === 'radio' || kind === 'inner') return null;
    let n = this.fxNodes[kind];
    if (n) return n;
    const bus = Sound.buses.voice ?? Sound.master;
    const inp = ctx.createGain();
    if (kind === 'hall') {
      // short dense room: a few tapped delays with damping
      const out = ctx.createGain(); out.gain.value = 0.28;
      for (const [t, g] of [[0.031, 0.5], [0.053, 0.42], [0.079, 0.33], [0.113, 0.25], [0.161, 0.17]] as const) {
        const d = ctx.createDelay(0.5); d.delayTime.value = t;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
        const gg = ctx.createGain(); gg.gain.value = g;
        inp.connect(d).connect(lp).connect(gg).connect(out);
      }
      out.connect(bus);
    } else {
      // feedback echo (stand: metallic slap; ghost: long and dark)
      const ghost = kind === 'ghost';
      const d = ctx.createDelay(1.5); d.delayTime.value = ghost ? 0.34 : 0.19;
      const fb = ctx.createGain(); fb.gain.value = ghost ? 0.46 : 0.32;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = ghost ? 1600 : 4200;
      const wet = ctx.createGain(); wet.gain.value = ghost ? 0.6 : 0.42;
      inp.connect(d); d.connect(lp).connect(fb).connect(d); lp.connect(wet).connect(bus);
    }
    this.fxNodes[kind] = inp;
    return inp;
  }

  /** Play the voiced clip of a line. Returns null when the line has no clip (callers fall back to babble). */
  say(text: string | undefined | null, o: VoiceOpts = {}): VoiceClip | null {
    if (!text || !this.enabled) return null;
    const e = this.man[voiceKey(text)];
    const ctx = Sound.ctx;
    if (!e || !ctx || Sound.muted) return null;
    if (o.channel !== undefined) { this.channels.get(o.channel)?.stop(0.08); }
    const rate = Math.max(0.5, Math.min(1.6, (o.rate ?? 1) * (Sound.timeScale || 1)));
    const fxKind = o.fx ?? 'none';
    const dur = e[1] / rate;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    let head: AudioNode = gain;
    // character EQ: deep voices lose some top, high voices a little bottom; radio = narrow band
    const eq = ctx.createBiquadFilter();
    if (fxKind === 'radio') { eq.type = 'bandpass'; eq.frequency.value = 1500; eq.Q.value = 1.1; }
    else if (fxKind === 'inner') { eq.type = 'lowpass'; eq.frequency.value = 2600; }
    else if (rate < 0.92) { eq.type = 'lowshelf'; eq.frequency.value = 220; eq.gain.value = 3.5; }
    else { eq.type = 'highpass'; eq.frequency.value = rate > 1.12 ? 160 : 90; }
    gain.connect(eq); head = eq;
    let panner: PannerNode | null = null;
    if (o.pos) {
      panner = ctx.createPanner();
      panner.panningModel = 'equalpower'; panner.distanceModel = 'inverse';
      panner.refDistance = 2.5; panner.maxDistance = 40; panner.rolloffFactor = 1.2;
      setPos(panner, o.pos, ctx, true);
      head.connect(panner); head = panner;
    }
    const bus = Sound.buses.voice ?? Sound.master;
    head.connect(bus);
    const send = this.fx(fxKind, ctx);
    if (send) head.connect(send);
    const vol = (o.vol ?? 1) * (fxKind === 'inner' ? 0.7 : 1);
    let src: AudioBufferSourceNode | null = null;
    let stopped = false;
    const state = { playing: true };
    const t0 = ctx.currentTime;
    const clip: VoiceClip & { playing: boolean } = {
      duration: dur,
      get playing() { return state.playing; },
      set playing(v: boolean) { state.playing = v; },
      stop: (fade = 0.12) => {
        if (stopped) return;
        stopped = true; state.playing = false;
        const t = ctx.currentTime;
        gain.gain.cancelScheduledValues(t); gain.gain.setValueAtTime(gain.gain.value, t); gain.gain.linearRampToValueAtTime(0, t + fade);
        setTimeout(() => { try { src?.stop(); } catch { /* */ } cleanup(); }, fade * 1000 + 40);
      },
      setPos: (p) => { if (panner) setPos(panner, p, ctx, false); },
    };
    const cleanup = () => { this.live.delete(clip); try { gain.disconnect(); eq.disconnect(); panner?.disconnect(); } catch { /* */ } this.duck(); };
    this.buffer(e[0]).then((buf) => {
      if (!buf || stopped) { state.playing = false; cleanup(); return; }
      src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      src.connect(gain);
      const t = Math.max(ctx.currentTime, t0);
      gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(vol, t + 0.012);
      src.start(t);
      src.onended = () => { state.playing = false; cleanup(); };
    });
    this.live.add(clip);
    if (o.channel !== undefined) this.channels.set(o.channel, clip);
    this.log.push({ k: voiceKey(text), t: Math.round(performance.now()), d: +dur.toFixed(2), rate: +rate.toFixed(2), fx: fxKind });
    if (this.log.length > 200) this.log.shift();
    this.duck();
    return clip;
  }

  stopAll(fade = 0.15) { for (const c of [...this.live]) c.stop(fade); }

  /** music + ambience dip while anyone talks */
  private duck() {
    const ctx = Sound.ctx;
    if (!ctx) return;
    const want = this.live.size ? 0.45 : 1;
    if (want === this.duckK) return;
    this.duckK = want;
    const t = ctx.currentTime;
    for (const b of ['music', 'amb'] as const) {
      const g = Sound.buses[b];
      if (g) g.gain.setTargetAtTime((Sound.volumes as any)[b] * want, t, want < 1 ? 0.08 : 0.5);
    }
  }
}

function setPos(p: PannerNode, v: THREE.Vector3, ctx: AudioContext, snap: boolean) {
  if (p.positionX) {
    if (snap) { p.positionX.value = v.x; p.positionY.value = v.y; p.positionZ.value = v.z; }
    else { const t = ctx.currentTime; p.positionX.setTargetAtTime(v.x, t, 0.03); p.positionY.setTargetAtTime(v.y, t, 0.03); p.positionZ.setTargetAtTime(v.z, t, 0.03); }
  } else (p as any).setPosition(v.x, v.y, v.z);
}

export const Voice = new VoiceSys();
