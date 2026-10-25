import { defineModule } from '../../game/contracts';
import type { Game } from '../../game/game';
import { params } from '../../core/util';
import { EscapeDirector } from './director';
import { registerSounds } from './util';

/* ============================================================================================
 * MODULE `escape` — the four friends are WANTED after the casino raid, so they can't leave the
 * neighbourhood: walking into an edge zone plays a local cinematic (police patrol, หมายจับ poster
 * with your own face, dive into a hiding place, cops leave, back in first person). See director.ts.
 *
 * Network: client-local presentation; intent 'escape.state' {mode:'free'|'hiding', anim, loop}
 * lets the host replicate the hero's pose/anim to everyone else (no new entities).
 * Dev: ?escape=1 (teleport to the east main-road barrier and play the full cinematic after load),
 *      ?escape=short (short version), ?escape=W|N|S|canal|rural (other edges).
 *      window.__esc = { director, trigger(short), go(edgeName) }
 * ========================================================================================== */

let director: EscapeDirector | null = null;

const DEV_SPOTS: Record<string, [number, number, number, number]> = {
  // x, z, yaw, extra metres to walk in
  '1': [120.8, 2.6, -Math.PI / 2, 0],
  E: [120.8, 2.6, -Math.PI / 2, 0],
  short: [120.8, 2.6, -Math.PI / 2, 0],
  W: [-120.8, 24.4, Math.PI / 2, 0],
  canal: [-120.5, -157, Math.PI / 2, 0],
  rural: [121.5, -221, -Math.PI / 2, 0],
  N: [-82, -262.5, 0, 0],
  S: [92, 82.5, Math.PI, 0],
  drum: [121.2, 4.8, -Math.PI / 2, 0],
  trash: [120.6, 24.2, -Math.PI / 2, 0],
};

export default defineModule({
  id: 'escape',
  deps: ['characters', 'world', 'life'],
  init(game: Game) {
    registerSounds();
    game.onIntent('escape.state', (pl, d: { mode?: string; anim?: string; loop?: boolean }) => {
      if (pl.mode && pl.mode !== 'free' && pl.mode !== 'hiding') return;
      pl.mode = d?.mode === 'hiding' ? 'hiding' : 'free';
      if (d?.anim && typeof d.anim === 'string') {
        pl.anim = d.anim;
        pl.animT = (game.g.time ?? 0) + Math.random();
        pl.animLoop = !!d.loop;
      }
    });
    game.events.on('world:exit', () => { director?.dispose(); director = null; });
    (window as any).__esc = {
      get director() { return director; },
      trigger: (short = false) => director?.trigger(short),
      go: (name = 'E', short = false) => {
        const s = DEV_SPOTS[name] ?? DEV_SPOTS.E;
        const y = game.world?.groundY(s[0], s[1]) ?? 0.15;
        game.player?.teleport([s[0], y, s[1]], s[2]);
        setTimeout(() => director?.trigger(short || name === 'short'), 60);
      },
    };
  },
  async buildWorld(game: Game) {
    registerSounds();
    director?.dispose();
    director = new EscapeDirector(game);
    await director.build();
    const p = params.get('escape');
    if (p) {
      let fired = false;
      const off = game.events.on('world:ready', () => {
        off();
        if (fired) return;
        fired = true;
        setTimeout(() => (window as any).__esc?.go(p, p === 'short'), 3500);
      });
    }
  },
  frame(game: Game, dt: number) {
    director?.frame(dt);
  },
});
