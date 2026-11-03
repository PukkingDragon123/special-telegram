import type { Game } from '../../game/game';
import type { OfferKind, Oops } from './lines';

/* ============================================================================================
 * Replicated ritual state: game.g.ritual (host writes, everyone reads).
 * ========================================================================================== */

export type Phase =
  | 'idle'      // offerings accumulate on the table
  | 'chant'     // 3 rounds of chant choices (time frozen)
  | 'oops'      // a wrong word summoned nonsense (dog / mosquitoes / ex / …)
  | 'summon'    // the cinematic: wind, rain, flicker, lightning, the ghost appears and talks
  | 'demand'    // she waits at the cart for kaphrao moo + fried egg, extra spicy
  | 'eat'       // she eats (live-streaming it)
  | 'review'    // ghostly 3D stars
  | 'selfie'    // group selfie (local camera shot + polaroid)
  | 'numbers'   // she writes lucky lottery numbers in the air
  | 'bye';      // vanishes, time runs again

export interface RitualState {
  st: Phase;
  /** host seconds when the phase began (clients time their FX from the moment they see a change) */
  t0: number;
  off: Partial<Record<OfferKind, boolean>>;
  round?: number;
  /** display order of this round's 3 options (indices into CHANT[round].opts) */
  order?: number[];
  oops?: Oops;
  /** the ghost entity */
  gid?: number;
  /** player who started it */
  by?: number;
  /** demand deadline (host seconds) */
  until?: number;
  stars?: number;
  /** lucky numbers + where they float + the day of the draw */
  nums?: { two: string; three: string; day: number; p?: [number, number, number] };
  /** player id → number bought */
  tix?: Record<string, string>;
  drawn?: boolean;
  /** the day the ghost was last summoned (once a night) */
  done?: number;
}

export function rstate(game: Game): RitualState | null { return ((game.g as any).ritual as RitualState) ?? null; }

export function ensureState(game: Game): RitualState {
  const g: any = game.g;
  if (!g.ritual) g.ritual = { st: 'idle', t0: 0, off: {} } as RitualState;
  return g.ritual;
}

/** replace fields (new object so the JSON diff replicates) */
export function patch(game: Game, p: Partial<RitualState>) {
  const g: any = game.g;
  g.ritual = { ...(g.ritual ?? { st: 'idle', t0: 0, off: {} }), ...p };
  return g.ritual as RitualState;
}
