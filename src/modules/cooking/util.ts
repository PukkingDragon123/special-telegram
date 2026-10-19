import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { Sound, SoundOpts } from '../../core/audio';

/** Shared little helpers for the cooking module. */

export const rd = (v: number, d = 1) => { const m = 10 ** d; return Math.round(v * m) / m; };
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Deterministic PRNG (mulberry32). */
export function mulberry(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap smooth 3D value noise for vertex displacement (deterministic, allocation free). */
function h3(x: number, y: number, z: number) {
  let n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return n - Math.floor(n);
}
export function vnoise3(x: number, y: number, z: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const a = h3(xi, yi, zi), b = h3(xi + 1, yi, zi), c = h3(xi, yi + 1, zi), d = h3(xi + 1, yi + 1, zi);
  const e = h3(xi, yi, zi + 1), f = h3(xi + 1, yi, zi + 1), g = h3(xi, yi + 1, zi + 1), hh = h3(xi + 1, yi + 1, zi + 1);
  const x1 = a + (b - a) * u, x2 = c + (d - c) * u, x3 = e + (f - e) * u, x4 = g + (hh - g) * u;
  const y1 = x1 + (x2 - x1) * v, y2 = x3 + (x4 - x3) * v;
  return (y1 + (y2 - y1) * w) * 2 - 1;
}
export function fbm3(x: number, y: number, z: number, oct = 3) {
  let a = 0.5, s = 0, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise3(x * f, y * f, z * f); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}

/** First audio key that exists in the manifest (falls back to the first; unknown keys only warn once). */
const keyCache = new Map<string, string>();
export function pickKey(keys: string | string[]): string {
  if (typeof keys === 'string') return keys;
  const ck = keys.join('|');
  const hit = keyCache.get(ck);
  if (hit && Sound.has(hit)) return hit;
  const k = keys.find((x) => Sound.has(x)) ?? keys[0];
  if (Sound.has(k)) keyCache.set(ck, k);
  return k;
}

/** Networked one-shot (host or client) with key fallbacks. */
export function sfx(game: Game, keys: string | string[], pos: ArrayLike<number> | THREE.Vector3 | null | undefined, o: Omit<SoundOpts, 'pos'> = {}) {
  game.sfx(pickKey(keys), pos ?? null, o);
}
/** Local positional one-shot. */
export function lsfx(keys: string | string[], pos: THREE.Vector3 | ArrayLike<number> | null, o: Omit<SoundOpts, 'pos'> = {}) {
  return Sound.play(pickKey(keys), { ...o, pos: pos ?? undefined });
}

/** World position of an entity (item → follows holder/container visuals, others → p). */
export function entPos(game: Game, e: Ent | null | undefined): THREE.Vector3 | null {
  if (!e) return null;
  if (e.t === 'item') return game.items.worldPos(e);
  const o = game.views.objectOf(e.id);
  if (o) return o.getWorldPosition(new THREE.Vector3());
  return e.p ? new THREE.Vector3(e.p[0], e.p[1], e.p[2]) : null;
}

export function playerEye(pl: Ent): THREE.Vector3 {
  const p = pl.p ?? [0, 0, 0];
  return new THREE.Vector3(p[0], p[1] + 1.15, p[2]);
}

/** Is a player close enough to work with an entity (host-side validation). */
export function nearPlayer(game: Game, pl: Ent, e: Ent | null | undefined, max = 3.4) {
  if (!e || !pl.p) return false;
  const p = entPos(game, e);
  if (!p) return false;
  return p.distanceTo(playerEye(pl)) <= max;
}

export const now = () => performance.now() / 1000;

/** Disable raycasting on an object tree (VFX, glass, steam…). */
export function noRaycast(o: THREE.Object3D) {
  o.traverse((m: any) => { if (m.isMesh || m.isPoints || m.isLine) m.raycast = () => {}; });
  return o;
}

export function setShadows(o: THREE.Object3D, cast = true, receive = true) {
  o.traverse((m: any) => { if (m.isMesh) { m.castShadow = cast; m.receiveShadow = receive; } });
}
