import type { Game } from '../../game/game';
import type { Life } from './index';
export class Eggs {
  constructor(private game: Game, private life: Life) {}
  init() {}
  async build() {}
  frame(_dt: number) {}
  dispose() {}
}
