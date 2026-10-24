import * as THREE from 'three';
import { defineModule } from '../../game/contracts';
import type { Game } from '../../game/game';
import { Sound, SoundHandle } from '../../core/audio';
import { params } from '../../core/util';
import { loadCookingManifests } from './assets';
import { defineCookingItems, setItemFX } from './items';
import { defineDish, setDishFX } from './dish';
import { CookFX } from './fx';
import { cartView, cartProvider, cartHostUpdate, installCartIntents, pushLateUpdate, carts, spawnCart } from './cart';
import { installCookIntents, cookHostUpdate } from './sim';
import { cookingProvider } from './actions';
import { RecipeBook } from './book';
import { bindKit, cookingApi, spawnCartTools, kitchenLab } from './kit';
import { ANCHORS } from '../../game/mapplan';
import { pickKey } from './util';

/* =============================================================================================
 * MODULE: cooking — the food cart, every ingredient / tool / dish item, the cooking simulation,
 * plating & dish evaluation, recipes, the recipe book, starter kit and ?kitchenlab.
 * Other modules: use `game.cooking` (== cookingApi, see kit.ts).
 * ============================================================================================= */

export { cookingApi };

const fx = new CookFX();
let book: RecipeBook | null = null;
const heatState = { v: 0.6, t: 0 };
const loops = new Map<number, { sizzle?: SoundHandle; boil?: SoundHandle; egg?: SoundHandle }>();

function ensureCart(game: Game) {
  if (!game.isHost) return;
  if (params.has('kitchenlab')) { kitchenLab(game); return; }
  if (carts(game).length) return;
  const a = game.world?.anchor('cart_start') ?? ANCHORS.cart_start;
  const gy = game.physics?.groundY(a.p[0], a.p[2]) ?? a.p[1];
  const c = spawnCart(game, [a.p[0], gy, a.p[2]], a.yaw ?? 0, 'oldman');
  spawnCartTools(game, c.id);
}

function updateLoops(game: Game) {
  const cam = game.camera;
  if (!cam || !game.scene) return;
  const cp = cam.getWorldPosition(new THREE.Vector3());
  const seen = new Set<number>();
  for (const w of game.state.all('item')) {
    if (w.k !== 'wok' || !w.data) continue;
    const p = game.items.worldPos(w);
    if (!p || p.distanceTo(cp) > 20) continue;
    const d = w.data;
    const T = d.T ?? 25;
    const solids = Object.values<any>(d.it ?? {}).reduce((a, v) => a + (v?.g ?? 0), 0);
    const L = loops.get(w.id) ?? {};
    loops.set(w.id, L);
    seen.add(w.id);
    const sizzle = T > 105 && (solids > 3 || (d.oil ?? 0) > 2 || d.egg?.n || d.om?.n) && (d.w ?? 0) < 40 ? Math.min(1, (T - 100) / 110) * Math.min(1, 0.35 + solids / 150 + (d.oil ?? 0) / 80) : 0;
    if (sizzle > 0.02) {
      L.sizzle ??= Sound.loop(pickKey(['wok_sizzle_loop']), { pos: p, vol: 0 });
      L.sizzle.setPos(p); L.sizzle.setVolume(sizzle * 1.1, 0.15); L.sizzle.setPitch(0.85 + sizzle * 0.35, 0.2);
    } else if (L.sizzle) { L.sizzle.stop(0.5); L.sizzle = undefined; }
    const boil = (d.w ?? 0) > 25 && T >= 98 ? Math.min(1, (d.w ?? 0) / 300) : 0;
    if (boil > 0) { L.boil ??= Sound.loop(pickKey(['boil_loop']), { pos: p, vol: 0 }); L.boil.setPos(p); L.boil.setVolume(0.3 + boil * 0.6, 0.3); }
    else if (L.boil) { L.boil.stop(0.6); L.boil = undefined; }
    const egg = (d.egg?.n || d.om?.n) && T > 140 ? Math.min(1, (d.oil ?? 0) / 80 + 0.3) : 0;
    if (egg > 0) { L.egg ??= Sound.loop(pickKey(['egg_fry_crackle_loop']), { pos: p, vol: 0 }); L.egg.setPos(p); L.egg.setVolume(egg * 0.9, 0.2); }
    else if (L.egg) { L.egg.stop(0.5); L.egg = undefined; }
  }
  for (const [id, L] of loops) if (!seen.has(id)) { L.sizzle?.stop(0.4); L.boil?.stop(0.4); L.egg?.stop(0.4); loops.delete(id); }
}

export default defineModule({
  id: 'cooking',
  deps: ['characters'],
  async init(game: Game) {
    bindKit(game);
    (game as any).cooking = cookingApi;
    await loadCookingManifests();
    setItemFX(fx);
    setDishFX(fx);
    defineCookingItems(game);
    defineDish(game);
    installCartIntents(game);
    installCookIntents(game);
    game.registerView('cart', cartView(game, fx));
    game.interact.provide(cartProvider(game, heatState), 10);
    game.interact.provide(cookingProvider(game), 11);
    book = new RecipeBook(game);
    game.events.on('cook:openBook', (id: number) => book?.openBook(id));
    game.on('cook:flare', (d: { wok: number; k: number }) => {
      const w = game.state.get(d.wok);
      const p = w ? game.items.worldPos(w) : null;
      if (p) fx.flare(p.add(new THREE.Vector3(0, 0.08, 0)), d.k ?? 0.6);
    });
    game.events.on('world:ready', () => {
      if (game.scene) fx.attach(game.scene);
      ensureCart(game);
    });
    game.events.on('world:exit', () => { fx.detach(); book?.close(); for (const L of loops.values()) { L.sizzle?.stop(0.1); L.boil?.stop(0.1); L.egg?.stop(0.1); } loops.clear(); });
    game.engine.onLate((f) => { if (game.scene && game.player) pushLateUpdate(game, f.dt); });
    Sound.preload(['wok_sizzle_loop', 'sizzle_burst', 'oil_pour', 'sauce_glug', 'spatula_scrape', 'egg_crack', 'gas_ignite', 'burner_roar_loop', 'knife_chop_board', 'mortar_pound', 'rice_scoop', 'plate_down', 'fire_whoosh', 'egg_fry_crackle_loop', 'page_turn', 'book_open']);
  },
  hostUpdate(game: Game, dt: number) {
    if (!game.scene) return;
    cartHostUpdate(game, dt);
    cookHostUpdate(game, dt);
  },
  frame(game: Game, dt: number) {
    if (!game.scene) return;
    fx.update(dt);
    book?.frame(dt);
    updateLoops(game);
  },
});
