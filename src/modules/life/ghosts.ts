import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import type { Life } from './index';
export class Ghosts {
  constructor(private game: Game, private life: Life) {}
  init() {}
  buildLocal() {}
  disposeLocal() {}
  hostUpdate(_dt: number) {}
  frame(_dt: number) {}
  onNewDay(_d: number) {}
  near(_p: ArrayLike<number>, _r: number): Ent | null { return null; }
  scare(_g: Ent, _by: string) {}
  debugSpawn(_k: string) {}
}
