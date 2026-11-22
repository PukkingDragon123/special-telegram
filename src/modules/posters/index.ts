import { defineModule } from '../../game/contracts';
import { params } from '../../core/util';

/* ============================================================================================
 * Posters: the printed wall art (fight night, luk thung, the movie, memes, casino + shop posters)
 * is PRE-RENDERED at build time into public/assets/gen/posters/*.webp (scripts/posters.mjs), so the
 * game pays nothing at runtime. With ?posters=gen this module renders them in the page instead
 * (studio renders of the real 3D models + real photos) and exposes them on window.__posters.
 * ========================================================================================== */

export default defineModule({
  id: 'posters',
  async init(game) {
    if (params.get('posters') !== 'gen') return;
    const only = params.get('posterIds')?.split(',').filter(Boolean);
    let started = false;
    const run = async () => {
      if (started) return;
      started = true;
      const { generatePosters } = await import('./gen');
      try {
        (window as any).__posters = await generatePosters(game, only);
      } catch (e) { console.error('[posters]', e); (window as any).__posters = []; }
      (window as any).__postersDone = true;
    };
    game.events.on('net:session', () => setTimeout(run, 300));
    setTimeout(run, 8000);
  },
});
