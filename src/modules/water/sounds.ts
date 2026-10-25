import * as THREE from 'three';
import { Sound, SoundOpts } from '../../core/audio';

/**
 * Water sounds: CC0 recordings in public/assets/gen/water/audio (credits: gen/water/CREDITS.md),
 * registered into the shared audio manifest at runtime under `wt_*` keys (the manifest file is not
 * ours). Falls back to the existing kitchen water sounds when a key is missing.
 */
const A = (names: string[], vol: number, loop = false, pitchVar = 0.08, desc = '') => ({
  files: names.map((n) => '../gen/water/audio/' + n + '.mp3'), vol, loop, cat: loop ? 'amb' : 'sfx', pitchVar, desc,
});

export function registerWaterSounds() {
  const m = Sound.manifest as Record<string, any>;
  const add = (k: string, e: any) => { if (!m[k]) m[k] = e; };
  add('wt_drip', A(['drip_1', 'drip_2', 'drip_3', 'drip_4'], 0.45, false, 0.18, 'single water drop hitting water/concrete'));
  add('wt_plop', A(['plop_1', 'plop_2', 'plop_3', 'plop_4'], 0.55, false, 0.12, 'small object plops into water'));
  add('wt_splash_m', A(['splash_m_1', 'splash_m_2', 'splash_m_3', 'splash_m_4', 'splash_m_5'], 0.6, false, 0.1, 'medium splash'));
  add('wt_splash_l', A(['splash_l_1', 'splash_l_2', 'splash_l_3', 'splash_l_4'], 0.75, false, 0.08, 'big splash (body / bucket into water)'));
  add('wt_bubble', A(['bubble_1', 'bubble_2', 'bubble_3'], 0.4, false, 0.15, 'bubbles rising from a sinking object'));
  add('wt_stream_loop', A(['stream_loop'], 0.5, true, 0, 'continuous water stream (tap / hose / pouring)'));
  add('wt_trickle_loop', A(['trickle_loop'], 0.45, true, 0, 'trickle / dripping gutter'));
  add('wt_gurgle_loop', A(['gurgle_loop'], 0.45, true, 0, 'water gurgling down a drain'));
  add('wt_spill', A(['spill_1'], 0.7, false, 0.08, 'container tipped over, water gushes out'));
}

const FALLBACK: Record<string, string> = { wt_drip: 'liquid_splash', wt_plop: 'liquid_splash', wt_splash_m: 'water_splash', wt_splash_l: 'water_splash', wt_bubble: 'sauce_glug', wt_stream_loop: 'tap_water_loop', wt_trickle_loop: 'tap_water_loop', wt_gurgle_loop: 'sauce_glug', wt_spill: 'water_splash' };

const _v = new THREE.Vector3();
/** Local positional one-shot (visual-side sounds; never networked). */
export function wsnd(key: string, pos: ArrayLike<number> | THREE.Vector3 | null, o: SoundOpts = {}) {
  const k = Sound.has(key) ? key : FALLBACK[key] ?? key;
  const p = pos ? ((pos as any).isVector3 ? pos as THREE.Vector3 : _v.set((pos as any)[0], (pos as any)[1], (pos as any)[2])) : null;
  return Sound.play(k, { ...o, pos: p ? p.clone() : undefined });
}
export function wloop(key: string, pos: ArrayLike<number> | THREE.Vector3 | null, o: SoundOpts = {}) {
  const k = Sound.has(key) ? key : FALLBACK[key] ?? key;
  return Sound.loop(k, { ...o, pos: pos ? ((pos as any).isVector3 ? (pos as THREE.Vector3).clone() : [(pos as any)[0], (pos as any)[1], (pos as any)[2]]) : undefined });
}
