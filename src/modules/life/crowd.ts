import type { Game } from '../../game/game';
import type { Life } from './index';
export class Crowd {
  constructor(private game: Game, private life: Life) {}
  init() {}
  build() {}
  frame(_dt: number) {}
  dispose() {}
}
