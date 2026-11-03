import * as THREE from 'three';
import { Sound } from '../../core/audio';

/* ============================================================================================
 * Synthesised ATM sounds (WebAudio, through the game's sfx bus, positional):
 *   beep (piezo keypad), err (3 low beeps), card motor (in / out), counter (note-counting riffle),
 *   shutter (motor + clunk), printer (thermal stepper + cutter snip), retract warning.
 * Nothing in the shared audio manifest sounds like an ATM, so these are generated on the fly.
 * ========================================================================================== */

export type AtmSfx = 'beep' | 'err' | 'ok' | 'cardIn' | 'cardOut' | 'counter' | 'shutterOpen' | 'shutterClose' | 'printer' | 'warn' | 'swallow';

let noiseBuf: AudioBuffer | null = null;
function noise(ctx: AudioContext) {
  if (noiseBuf) return noiseBuf;
  const n = ctx.sampleRate * 2;
  noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

function out(ctx: AudioContext, pos: THREE.Vector3 | null, vol: number) {
  const g = ctx.createGain();
  g.gain.value = vol;
  let node: AudioNode = g;
  if (pos) {
    const p = ctx.createPanner();
    p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 1.2; p.maxDistance = 25; p.rolloffFactor = 1.4;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else (p as any).setPosition(pos.x, pos.y, pos.z);
    g.connect(p); node = p;
  }
  node.connect(Sound.buses.sfx ?? Sound.master);
  return g;
}

function tone(ctx: AudioContext, dst: AudioNode, t0: number, f: number, dur: number, type: OscillatorType = 'sine', vol = 1, f1?: number) {
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (f1) o.frequency.linearRampToValueAtTime(f1, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.004);
  g.gain.setValueAtTime(vol, t0 + Math.max(0.005, dur - 0.02));
  g.gain.linearRampToValueAtTime(0, t0 + dur);
  o.connect(g).connect(dst);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

function burst(ctx: AudioContext, dst: AudioNode, t0: number, dur: number, type: BiquadFilterType, freq: number, q: number, vol: number, attack = 0.002) {
  const s = ctx.createBufferSource(); s.buffer = noise(ctx);
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
  s.connect(f).connect(g).connect(dst);
  s.start(t0, Math.random()); s.stop(t0 + dur + 0.02);
}

/** motor whine: saw through a low-pass, pitch glide */
function motor(ctx: AudioContext, dst: AudioNode, t0: number, dur: number, f0: number, f1: number, vol: number) {
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(f0, t0); o.frequency.linearRampToValueAtTime(f1, t0 + dur);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.05);
  g.gain.setValueAtTime(vol, t0 + dur - 0.08); g.gain.linearRampToValueAtTime(0, t0 + dur);
  o.connect(lp).connect(g).connect(dst);
  o.start(t0); o.stop(t0 + dur + 0.02);
  burst(ctx, dst, t0, dur, 'bandpass', 1400, 1.5, vol * 0.25, 0.05);
}

export function atmSfx(kind: AtmSfx, pos: THREE.Vector3 | null = null, vol = 1) {
  const ctx = Sound.ctx;
  if (!ctx || Sound.muted || ctx.state !== 'running') return;
  const t = ctx.currentTime + 0.005;
  const o = out(ctx, pos, 0.55 * vol);
  switch (kind) {
    case 'beep': tone(ctx, o, t, 2350, 0.075, 'square', 0.12); tone(ctx, o, t, 2350, 0.075, 'sine', 0.35); break;
    case 'ok': tone(ctx, o, t, 1760, 0.09, 'sine', 0.35); tone(ctx, o, t + 0.11, 2350, 0.12, 'sine', 0.35); break;
    case 'err': for (let i = 0; i < 3; i++) { tone(ctx, o, t + i * 0.16, 620, 0.11, 'square', 0.12); tone(ctx, o, t + i * 0.16, 620, 0.11, 'sine', 0.3); } break;
    case 'warn': for (let i = 0; i < 2; i++) tone(ctx, o, t + i * 0.25, 1900, 0.16, 'sine', 0.4); break;
    case 'cardIn':
      burst(ctx, o, t, 0.05, 'highpass', 2500, 0.7, 0.5);
      motor(ctx, o, t + 0.05, 0.75, 120, 165, 0.32);
      burst(ctx, o, t + 0.82, 0.06, 'lowpass', 600, 1, 0.6);
      break;
    case 'cardOut':
      burst(ctx, o, t, 0.05, 'lowpass', 600, 1, 0.5);
      motor(ctx, o, t + 0.04, 0.6, 165, 120, 0.32);
      burst(ctx, o, t + 0.66, 0.05, 'highpass', 2500, 0.7, 0.45);
      break;
    case 'swallow':
      motor(ctx, o, t, 1.1, 120, 200, 0.35);
      burst(ctx, o, t + 1.12, 0.12, 'lowpass', 350, 1, 0.8);
      break;
    case 'counter': {
      // the dispenser picks and counts notes: hum + a fast flutter of paper clicks
      motor(ctx, o, t, 1.5, 70, 90, 0.18);
      const n = 34;
      for (let i = 0; i < n; i++) burst(ctx, o, t + 0.15 + i * 0.032 + Math.random() * 0.006, 0.02, 'bandpass', 3200 + Math.random() * 1500, 1.2, 0.5);
      burst(ctx, o, t + 1.35, 0.12, 'bandpass', 900, 0.8, 0.4, 0.01);
      break;
    }
    case 'shutterOpen': motor(ctx, o, t, 0.42, 240, 190, 0.25); burst(ctx, o, t + 0.42, 0.08, 'lowpass', 420, 1, 0.7); break;
    case 'shutterClose': motor(ctx, o, t, 0.38, 190, 240, 0.25); burst(ctx, o, t + 0.38, 0.09, 'lowpass', 380, 1, 0.8); break;
    case 'printer': {
      // thermal printer: stepper buzz in short bursts, then the cutter
      for (let i = 0; i < 6; i++) {
        const t0 = t + i * 0.22;
        const osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = 1150 + (i % 2) * 90;
        const am = ctx.createOscillator(); am.frequency.value = 48;
        const amg = ctx.createGain(); amg.gain.value = 0.5;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 1.4;
        const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.16, t0 + 0.01); g.gain.setValueAtTime(0.16, t0 + 0.17); g.gain.linearRampToValueAtTime(0, t0 + 0.19);
        am.connect(amg).connect(g.gain);
        osc.connect(bp).connect(g).connect(o);
        osc.start(t0); osc.stop(t0 + 0.2); am.start(t0); am.stop(t0 + 0.2);
      }
      burst(ctx, o, t + 1.42, 0.07, 'highpass', 3000, 0.8, 0.7);
      break;
    }
  }
}
