import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { AnchorPt, Look } from '../../game/contracts';
import { ANCHORS } from '../../game/mapplan';
import type { Ent } from '../../sim/state';
import { Assets } from '../../core/assets';
import { Sound, SoundOpts } from '../../core/audio';

/* Shared helpers for the intro module (textures, sound keys, outfit overrides, small math). */

export const GEN = 'gen/intro/';

/** Real-photo texture shipped in public/assets/gen/intro (see references/credits/intro.md). */
export function tex(file: string, o: { repeat?: number | [number, number]; srgb?: boolean; wrap?: boolean } = {}) {
  const t = Assets.texture(GEN + file, { srgb: o.srgb !== false, repeat: o.repeat, wrap: o.wrap });
  return t;
}

/** First key that exists in the audio manifest (falls back to the last one; unknown keys only warn). */
export function key(...keys: string[]) {
  for (const k of keys) if (Sound.has(k)) return k;
  return keys[keys.length - 1];
}
export function play(keys: string | string[], o: SoundOpts = {}) {
  return Sound.play(key(...(Array.isArray(keys) ? keys : [keys])), o);
}
export function nsfx(game: Game, keys: string | string[], pos?: ArrayLike<number> | THREE.Vector3 | null, o: Omit<SoundOpts, 'pos'> = {}) {
  game.sfx(key(...(Array.isArray(keys) ? keys : [keys])), pos as any, o);
}

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
const KEEP_ACC = /sunglass|glasses|headband|cap|hat|watch/;

/** Casino outfit: shiny cheap suit (one maroon, one gold, one powder-blue, one black) + own face/hair/skin. */
export function suitLook(base: Look, slot: number): Look {
  const L = clone(base);
  const suits: [string, string][] = [['suit_maroon', '#5e1a22'], ['suit_gold', '#b8923a'], ['suit_black', '#8fb3d9'], ['suit_black', '#1e1f24']];
  const s = suits[((slot % 4) + 4) % 4];
  L.top = { id: s[0], color: s[1] };
  L.bottom = { id: 'slacks', color: slot % 4 === 2 ? '#7f9fc4' : '#1d1d1f' };
  L.shoes = { id: 'leather', color: '#1a1512' };
  L.acc = [...(L.acc ?? []).filter((a) => KEEP_ACC.test(a) && !/cap|hat/.test(a)), ...(slot % 2 === 1 ? ['gold_chain'] : [])];
  return L;
}

/** Morning-after outfit: ribbed singlet + boxer shorts + flip-flops. */
export function singletLook(base: Look, slot: number): Look {
  const L = clone(base);
  const boxers = ['#3a5aa0', '#a03a3a', '#3a7a4a', '#5a4a7a'];
  L.top = { id: 'singlet_white', color: ['#f1eee6', '#e8e2d2', '#f1eee6', '#e6e1d6'][slot % 4] };
  L.bottom = { id: 'boxer_plaid', color: boxers[((slot % 4) + 4) % 4] };
  L.shoes = { id: 'flipflops', color: ['#2f63b8', '#c8423a', '#2f8a4a', '#1d1d1f'][slot % 4] };
  L.acc = (L.acc ?? []).filter((a) => /headband/.test(a));
  return L;
}

export function v3(a: ArrayLike<number>) { return new THREE.Vector3(a[0], a[1], a[2]); }
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const smooth = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Rig of an entity's view on this peer (players / npcs), if any. */
export function rigOf(game: Game, id: number | null | undefined): any {
  if (id == null) return null;
  const v = game.views.of(id).find((x: any) => x.rig) as any;
  return v?.rig ?? null;
}

/** Head position of an entity for bubbles / look-at. */
export function headOf(game: Game, id: number, out = new THREE.Vector3()): THREE.Vector3 | null {
  const r = rigOf(game, id);
  if (r?.headWorld) return r.headWorld(out);
  const obj = game.views.objectOf(id);
  if (obj) return obj.localToWorld(out.set(0, (obj.userData.headHeight as number) ?? 1.7, 0));
  const e = game.state.get(id);
  return e?.p ? out.set(e.p[0], e.p[1] + 1.65, e.p[2]) : null;
}

export function playAnim(game: Game, e: Ent | undefined | null, anim: string, loop = false) {
  if (!e) return;
  e.anim = anim;
  e.animT = (game.g.time ?? 0) + Math.random();
  e.animLoop = loop;
}

export function anchor(game: Game, name: string): AnchorPt {
  return game.world?.anchors?.[name] ?? ANCHORS[name] ?? { p: [0, 0.15, 0] };
}
