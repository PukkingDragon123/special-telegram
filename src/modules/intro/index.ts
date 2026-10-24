import { defineModule } from '../../game/contracts';
import type { Game } from '../../game/game';
import { params } from '../../core/util';
import { CasinoScene, installCasinoIntents } from './casino';
import { IntroHost, STEPS, Step } from './steps';
import { IntroLocal } from './local';

/* ============================================================================================
 * MODULE `intro` — "รวยแป๊บเดียว": the casino cutscene (scene 'casino') and the in-world intro
 * (g.introStep: wake → see_cart → pay → starter → dog → go_market → done).
 *
 * Public hub: (game as any).intro = { step, go(step) (host), skip() (host), casino }
 * Events (network, all peers): 'intro:think' {id,text} · 'intro:coins' {from,to,n} · 'intro:caught' {by,old}
 *   'intro:shock' {sec} · 'intro:dogEat' {dog,cart} · 'intro:cartOwned' {cart} · 'intro:goMarket' {stall}
 * Local events: 'intro:step' {step, prev} (every peer) · 'intro:done' {skipped} (host)
 * URL: ?skipintro (straight to 'done': cart owned + starter kit minus pork/rice) · ?intro=<step> (test jump)
 *      ?scene=casino&autostart → play the cutscene directly
 * ========================================================================================== */

let host: IntroHost | null = null;
let local: IntroLocal | null = null;
let casino: CasinoScene | null = null;

export default defineModule({
  id: 'intro',
  deps: ['characters', 'world', 'cooking', 'life', 'shops'],
  init(game: Game) {
    game.scenes.register('casino', () => (casino = new CasinoScene(game)));
    installCasinoIntents(game, () => (game.scenes.currentName === 'casino' ? casino : null));
    host = new IntroHost(game);
    local = new IntroLocal(game);
    game.events.on('net:session', () => host?.reset());
    (game as any).intro = {
      get step() { return game.g.introStep; },
      steps: STEPS,
      /** HOST: jump the intro to a step (tests). */
      go: (s: Step) => { if (game.isHost) host?.jump(s); },
      /** HOST: skip everything (cart owned, starter kit minus pork/rice). */
      skip: () => { if (game.isHost) { if (game.g.scene === 'casino') casino?.finish(); host?.skipAll(); } },
      get casino() { return casino; },
    };
    // ?scene=casino → let the host jump straight into the cutscene once a session exists
    if (params.get('scene') === 'casino') {
      let done = false;
      game.events.on('net:session', () => { if (done) return; done = true; setTimeout(() => { if (game.isHost) game.g.scene = 'casino'; }, 50); });
    }
  },
  hostUpdate(game: Game, dt: number) {
    host?.update(dt);
  },
  frame(game: Game, dt: number) {
    local?.frame(dt);
  },
});
