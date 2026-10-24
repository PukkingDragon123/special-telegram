import { defineModule } from '../../game/contracts';
import type { Look } from '../../game/contracts';
import { params } from '../../core/util';
import { MenuScene } from './menu-scene';
import { Newspaper, SAMPLE_STATS } from './newspaper';
import { installSounds } from './sfx';
import { loadSettings, applySettings } from './settings';

/* ============================================================================================
 * menu module — the album-cover main menu ('menu'), the street + fashion magazine customize
 * scene ('customize'), the "ไทยรั่ว" newspaper and player settings.
 *   scenes:  'menu' (overrides the dev lobby), 'customize' (also reachable by clicking yourself)
 *   intents: 'player.setLook' {look}  · 'menu.setName' {name}  · 'menu.ready' {ready}
 *   API:     (game as any).newspaper.show(stats?) → Promise<void>
 *   URL:     ?host=tabs&autostart · ?join=CODE&net=tabs · ?autostart&skipintro (unchanged)
 *            ?customize (open the magazine directly) · ?newspaper (preview the day paper)
 * ========================================================================================== */

const HEX = /^#[0-9a-fA-F]{6}$/;
const ID = /^[a-z0-9_\-]{1,32}$/i;

/** HOST: validate a look sent by a client (unknown ids fall back to the previous value). */
function cleanLook(game: any, prev: Look, l: any): Look | null {
  if (!l || typeof l !== 'object') return null;
  const cat = game.chars.catalogue?.() ?? {};
  const has = (list: any[] | undefined, id: string) => !list?.length || list.some((x: any) => x.id === id);
  const part = (p: any, list: any[] | undefined, old: { id: string; color?: string }) => {
    if (!p || typeof p.id !== 'string' || !ID.test(p.id) || !has(list, p.id)) return old;
    return { id: p.id, ...(typeof p.color === 'string' && HEX.test(p.color) ? { color: p.color } : {}) };
  };
  const out: Look = {
    sex: l.sex === 'f' ? 'f' : 'm',
    height: Math.max(1.45, Math.min(1.95, Number(l.height) || prev.height || 1.72)),
    build: Math.max(0, Math.min(1, Number(l.build) ?? prev.build ?? 0.4)),
    skin: typeof l.skin === 'string' && HEX.test(l.skin) ? l.skin : prev.skin,
    face: typeof l.face === 'string' && ID.test(l.face) ? l.face : prev.face,
    hair: { style: typeof l.hair?.style === 'string' && ID.test(l.hair.style) && has(cat.hair, l.hair.style) ? l.hair.style : prev.hair.style, color: typeof l.hair?.color === 'string' && HEX.test(l.hair.color) ? l.hair.color : prev.hair.color },
    top: part(l.top, cat.tops, prev.top),
    bottom: part(l.bottom, cat.bottoms, prev.bottom),
    shoes: part(l.shoes, cat.shoes, prev.shoes),
    acc: Array.isArray(l.acc) ? l.acc.filter((a: any) => typeof a === 'string' && ID.test(a) && has(cat.acc, a)).slice(0, 6) : prev.acc,
  };
  return out;
}

export default defineModule({
  id: 'menu',
  deps: ['characters'],
  init(game) {
    installSounds();
    applySettings(loadSettings());
    game.scenes.register('menu', () => new MenuScene(game, 'album'));
    game.scenes.register('customize', () => new MenuScene(game, 'customize'));

    game.onIntent('player.setLook', (pl, d) => {
      const prev: Look = pl.look ?? game.chars.playerLook(pl.slot ?? 0);
      const look = cleanLook(game, prev, d?.look);
      if (look) pl.look = look;
    });
    game.onIntent('menu.setName', (pl, d) => {
      const name = String(d?.name ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
      if (name) pl.name = name;
    });
    game.onIntent('menu.ready', (pl, d) => { pl.ready = !!d?.ready; });

    const np = new Newspaper(game);
    (game as any).newspaper = { show: (stats?: any) => np.show(stats), frontPage: (stats?: any) => np.frontPage(stats) };

    if (params.has('newspaper')) {
      let shown = false;
      game.events.on('scene:entered', () => {
        if (shown) return;
        shown = true;
        setTimeout(() => np.show(SAMPLE_STATS), 600);
      });
    }
  },
});
