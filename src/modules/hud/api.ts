import type * as THREE from 'three';
import type { Game } from '../../game/game';
import type { TL } from '../../core/util';

/* ============================================================================================
 * HUD contract (module `hud`, local to each peer). Screen-space game UI: wallet (auto, from the
 * local player's `wallet` + the 'money' event), clock, the objective list with an on-screen
 * marker + distance, toasts, the "talk to yourself" monologue subtitle and cinematic letterbox.
 *   import { hud } from '../hud/api';   hud(game)?.setObjective({...})
 * Objectives are LOCAL: set them on every peer from replicated state (e.g. g.introStep).
 * ========================================================================================== */

export type HudText = TL | string;

export interface HudObjective {
  /** stable id; setObjective with the same id updates in place */
  id: string;
  /** headline, e.g. tl('ขโมยรถเข็นของลุง', 'Steal the old man\'s cart') */
  text: HudText;
  /** smaller hint line under it (key hints like "[E]" welcome) */
  sub?: HudText;
  /** world point for the marker + distance; a function is re-evaluated every frame */
  target?: THREE.Vector3 | (() => THREE.Vector3 | null) | null;
  /** lower shows first (tutorial 0, main story 5, quests 10, side jobs 20) */
  priority?: number;
  /** optional counter shown as "2/3" */
  progress?: { have: number; need: number };
}

export interface HudApi {
  setObjective(o: HudObjective): void;
  /** remove; completed=true plays the tick/strike-out animation first */
  clearObjective(id: string, completed?: boolean): void;
  /** short notification in the top-centre */
  toast(text: HudText, opts?: { kind?: 'info' | 'good' | 'bad'; dur?: number }): void;
  /** inner monologue of the local player, shown as an italic subtitle (+ thought bubble handled by caller if wanted) */
  monologue(text: HudText, dur?: number): void;
  /** cutscenes: hide the HUD and slide in letterbox bars */
  setCinematic(on: boolean): void;
  /** hide everything (menus, photo mode) */
  hidden: boolean;
}

export function hud(game: Game): HudApi | null {
  return ((game as any).hud as HudApi) ?? null;
}
