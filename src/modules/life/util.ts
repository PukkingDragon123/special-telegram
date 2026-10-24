import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { params } from '../../core/util';

/* ============================================================================================
 * life — small shared helpers (hashing, seeded picks, geometry bits, quality).
 * ========================================================================================== */

/** 32-bit integer hash of several ints (deterministic across peers). */
export function hashN(...n: number[]): number {
  let h = 0x811c9dc5 | 0;
  for (const v of n) {
    let k = (v | 0) ^ Math.imul((v * 4096) | 0, 0x9e3779b1);
    k = Math.imul(k ^ (k >>> 16), 0x85ebca6b);
    k = Math.imul(k ^ (k >>> 13), 0xc2b2ae35);
    h = Math.imul(h ^ k ^ (k >>> 16), 0x01000193);
  }
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return h >>> 0;
}
/** hash → [0,1) */
export const h01 = (...n: number[]) => hashN(...n) / 4294967296;
/** deterministic pick */
export const hpick = <T>(arr: readonly T[], ...n: number[]): T => arr[Math.floor(h01(...n) * arr.length) % arr.length];
/** weighted deterministic pick */
export function hweighted<T>(items: readonly T[], weights: readonly number[], ...n: number[]): T {
  let s = 0;
  for (const w of weights) s += w;
  let r = h01(...n) * s;
  for (let i = 0; i < items.length; i++) if ((r -= weights[i]) <= 0) return items[i];
  return items[items.length - 1];
}

/** gaussian bump */
export const bump = (t: number, c: number, w: number, a = 1) => a * Math.exp(-((t - c) ** 2) / (2 * w * w));

export type Quality = 'low' | 'medium' | 'high' | 'ultra';
export function quality(): Quality {
  const q = params.get('quality');
  if (q === 'low' || q === 'medium' || q === 'high' || q === 'ultra') return q;
  return 'high';
}
export const qmul = () => ({ low: 0.45, medium: 0.7, high: 1, ultra: 1.3 }[quality()]);

/** World ground height (falls back to sidewalk heuristics before the world module lands). */
export function groundY(game: Game, x: number, z: number) {
  return game.world?.groundY(x, z) ?? 0;
}

/** Anchor position (with stub fallback). */
export function anchorP(game: Game, name: string, fallback: [number, number, number] = [0, 0, 0]): THREE.Vector3 {
  const a = game.world?.anchors?.[name];
  const p = a?.p ?? fallback;
  return new THREE.Vector3(p[0], p[1], p[2]);
}
export function anchorYaw(game: Game, name: string, fallback = 0): number {
  return game.world?.anchors?.[name]?.yaw ?? fallback;
}

export const v3 = (p: ArrayLike<number>) => new THREE.Vector3(p[0], p[1], p[2]);
export const dist2 = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/** Is this held item something a dog / cat would eat? */
export function isFoodItem(game: Game, e: Ent | null | undefined, who: 'dog' | 'cat' | 'pret' = 'dog'): boolean {
  if (!e || e.t !== 'item') return false;
  const def = game.items.defOf(e);
  const k = String(e.k ?? '');
  const tags = def?.tags ?? [];
  if (k === 'dog_food') return who !== 'pret';
  if (who === 'cat' && /fish|pla|tuna|sardine/.test(k)) return true;
  if (tags.includes('dish') || k === 'dish' || /^dish/.test(k)) return true;
  if (tags.includes('meat') || /pork|moo|chicken|kai_|gai|beef|fish|meat|sausage|liver|bone|crispy/.test(k)) return true;
  if (who !== 'cat' && (tags.includes('food') || /rice_cooked|khao|egg_fried|omelet|noodle|bread|banana|snack/.test(k))) return true;
  if (who === 'pret' && (tags.includes('food') || tags.includes('ingredient') || k === 'garland')) return true;
  return false;
}

/** Thai-ish name for an item (for bubbles). */
export function itemName(game: Game, e: Ent | null | undefined): string {
  if (!e) return '';
  try { return game.items.name(e).th; } catch { return String(e.k); }
}

/** Does any player stand within r metres (2D) of p? */
export function playerNear(game: Game, p: ArrayLike<number>, r: number): Ent | null {
  let best: Ent | null = null, bd = r;
  for (const pl of game.players()) {
    if (!pl.p) continue;
    const d = dist2(pl.p, p);
    if (d < bd) { bd = d; best = pl; }
  }
  return best;
}

/** Shared invisible-but-raycastable proxy material (material.visible=false → not drawn, still hit). */
let proxyMat: THREE.MeshBasicMaterial | null = null;
export function proxyMaterial() {
  if (!proxyMat) { proxyMat = new THREE.MeshBasicMaterial(); proxyMat.visible = false; }
  return proxyMat;
}

/** Simple smoothed value helper. */
export class Smooth {
  v: number;
  constructor(v = 0, public rate = 6) { this.v = v; }
  to(target: number, dt: number) { this.v += (target - this.v) * (1 - Math.exp(-this.rate * dt)); return this.v; }
}

/** Ray from the local camera: is `p` roughly under the crosshair (within angle) and within range? */
export function cameraLooksAt(cam: THREE.Camera, p: THREE.Vector3, maxDist: number, cosAngle = 0.96): boolean {
  const o = cam.getWorldPosition(_tmpA);
  const d = _tmpB.subVectors(p, o);
  const dist = d.length();
  if (dist > maxDist || dist < 1e-3) return false;
  const f = _tmpC.set(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(_tmpQ));
  return d.dot(f) / dist > cosAngle;
}
const _tmpA = new THREE.Vector3(), _tmpB = new THREE.Vector3(), _tmpC = new THREE.Vector3(), _tmpQ = new THREE.Quaternion();

export function onceKey(set: Set<string>, k: string) { if (set.has(k)) return false; set.add(k); return true; }
