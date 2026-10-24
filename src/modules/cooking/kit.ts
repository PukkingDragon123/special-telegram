import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { ING, TOOL_META } from './data';
import { RECIPES, RECIPE_IDS, DEFAULT_UNLOCKED, evaluate, matchRecipe, qualityWord, ISSUE_TH } from './recipes';
import { SPOTS, CART } from './cartspec';
import { spawnCart, putOnCart, cartLocalToWorld, carts } from './cart';
import { dishToDirtyPlate, dishLabel } from './dish';
import { ANCHORS } from '../../game/mapplan';

/* =============================================================================================
 * Starter kit, cart equipment, ?kitchenlab and the public API other modules use:
 *   game.cooking (== cookingApi) — see the bottom of this file.
 * ============================================================================================= */

let G: Game | null = null;
export function bindKit(game: Game) { G = game; }

function onCart(game: Game, cart: Ent, kind: string, spot: string | number[], data?: any): Ent | null {
  const at = typeof spot === 'string' ? SPOTS[spot] : spot;
  if (!at) return null;
  const e = game.items.spawn(kind, [0, 0, 0], { data, noPhysics: true });
  if (!e) return null;
  putOnCart(game, e, cart, at);
  return e;
}

/** HOST: the cart's own equipment (wok on the burner, utensils, plates). */
export function spawnCartTools(game: Game, cartId: number) {
  const cart = game.state.get(cartId);
  if (!cart) return;
  onCart(game, cart, 'wok', 'burner');
  onCart(game, cart, 'spatula', 'spatula');
  onCart(game, cart, 'ladle', 'ladle');
  onCart(game, cart, 'mortar', 'mortar');
  onCart(game, cart, 'chopping_board', 'board');
  onCart(game, cart, 'cleaver', 'cleaver');
  onCart(game, cart, 'plate', 'plates', { dirty: false, rice: 0, style: 'flora' });
  onCart(game, cart, 'plate', 'plates2', { dirty: false, rice: 0, style: 'flora' });
  onCart(game, cart, 'plate', 'plates3', { dirty: false, rice: 0, style: 'blue' });
  onCart(game, cart, 'spoon_fork', 'spoon1');
  onCart(game, cart, 'spoon_fork', 'spoon2');
}

/** HOST: what the intro finds inside the old man's cart. */
export function spawnStarterKit(game: Game, cartId: number) {
  const cart = game.state.get(cartId);
  if (!cart) return [];
  const out: (Ent | null)[] = [];
  out.push(onCart(game, cart, 'recipe_book', 'book'));
  out.push(onCart(game, cart, 'rice_pot', 'rice', { g: 2200, raw: 0, water: 0, cook: 0, on: false, q: 0.95, wet: 0.05 }));
  out.push(onCart(game, cart, 'pork_minced', 'disp0', { g: 500 }));
  out.push(onCart(game, cart, 'holy_basil', 'disp1', { g: 100 }));
  out.push(onCart(game, cart, 'garlic', 'disp2', { g: 200 }));
  out.push(onCart(game, cart, 'chili', 'disp3', { g: 100 }));
  out.push(onCart(game, cart, 'egg_tray', 'shelf2', { n: 10 }));
  out.push(onCart(game, cart, 'oyster_sauce', 'rack0', { g: 770 }));
  out.push(onCart(game, cart, 'fish_sauce', 'rack1', { ml: 700 }));
  out.push(onCart(game, cart, 'soy_light', 'rack2', { ml: 700 }));
  out.push(onCart(game, cart, 'soy_dark', 'rack3', { g: 950 }));
  out.push(onCart(game, cart, 'sugar', 'rack4', { g: 1000 }));
  out.push(onCart(game, cart, 'cooking_oil', 'rack5', { ml: 1000 }));
  out.push(onCart(game, cart, 'seasoning_sauce', 'rack6', { ml: 600 }));
  out.push(onCart(game, cart, 'water_jug', 'rack7', { ml: 1500 }));
  return out.filter(Boolean) as Ent[];
}

/** HOST: the stray dog eats the rice and the pork (intro). Returns what disappeared + where. */
export function eatFoodFromCart(game: Game, cartId: number) {
  const cart = game.state.get(cartId);
  const res = { pork: 0, rice: 0, at: null as number[] | null };
  if (!cart) return res;
  for (const e of game.state.all('item')) {
    if (e.in !== cart.id) continue;
    if (e.k === 'pork_minced' || e.k === 'chicken_minced' || e.k === 'pork_sliced') { res.pork += e.data?.g ?? 0; game.items.remove(e); }
    if (e.k === 'rice_pot') { res.rice += e.data?.g ?? 0; e.data = { ...e.data, g: 0 }; e._s = null; e._pub = null; }
  }
  const p = cartLocalToWorld(game, cart, [0, CART.top, -0.5]);
  res.at = [p.x, p.y, p.z];
  return res;
}

// ------------------------------------------------------------------ ?kitchenlab

const LAB_EXTRA = [
  'pork_minced', 'chicken_minced', 'pork_sliced', 'shrimp', 'holy_basil', 'garlic', 'chili', 'long_beans', 'onion', 'kale', 'morning_glory',
  'lemongrass', 'galangal', 'kaffir_lime', 'mushroom', 'tomato', 'spring_onion', 'cucumber', 'lime', 'noodles_wide', 'curry_paste',
  'tomyum_paste', 'gravy_starch', 'msg', 'white_pepper', 'chili_flakes', 'rice_bag', 'water_jug', 'cooking_oil', 'egg_tray',
  'bowl', 'bowl', 'plate', 'plate', 'takeaway_box', 'takeaway_box', 'plastic_bag', 'spoon_fork', 'spoon_fork', 'rice_paddle', 'gas_tank', 'wok',
];

export function kitchenLab(game: Game) {
  const sp = game.world?.anchor('player_spawn') ?? ANCHORS.player_spawn;
  const p = [sp.p[0] + 3.0, 0, sp.p[2]];
  const gy = game.physics?.groundY(p[0], p[2]) ?? 0;
  let cart = carts(game)[0];
  if (!cart) cart = spawnCart(game, [p[0], gy, p[2]], -Math.PI / 2, 'players');
  else { cart.p = [p[0], gy, p[2]]; cart.yaw = -Math.PI / 2; cart.owner = 'players'; }
  const has = game.state.all('item').some((e) => e.in === cart.id);
  if (!has) { spawnCartTools(game, cart.id); spawnStarterKit(game, cart.id); }
  // the rest of the pantry on the ground north of the cart (?kitchenlab=lite skips it)
  if (new URLSearchParams(location.search).get('kitchenlab') !== 'lite') LAB_EXTRA.forEach((k, i) => {
    const x = sp.p[0] + 1.2 + (i % 8) * 0.42, z = sp.p[2] - 3.2 - Math.floor(i / 8) * 0.5;
    game.items.spawn(k, [x, (game.physics?.groundY(x, z) ?? 0) + 0.05, z], { yaw: Math.PI / 2 });
  });
  game.g.unlocks = { ...(game.g.unlocks ?? {}), recipes: [...RECIPE_IDS] };
  console.info('[cooking] kitchenlab ready: cart', cart.id);
  return cart;
}

// ------------------------------------------------------------------ public API

function need() { if (!G) throw new Error('[cooking] not initialised'); return G; }

export const cookingApi = {
  recipes: RECIPES,
  recipeIds: RECIPE_IDS,
  ingredients: ING,
  tools: TOOL_META,
  /** evaluate(wokData, {rice, egg, spoon, cook…}) → DishData (+vis) */
  evaluate,
  matchRecipe,
  qualityWord,
  issueText: ISSUE_TH,
  dishLabel,
  /** unlocked recipe ids (g.unlocks.recipes, default kaphrao + khai dao) */
  unlocked(): string[] { const u = need().g.unlocks?.recipes; return Array.isArray(u) && u.length ? u : DEFAULT_UNLOCKED; },
  /** HOST: spawn a cart (default at anchor cart_start, owner 'oldman') with its equipment. */
  spawnCart(p?: ArrayLike<number>, yaw?: number, owner: 'oldman' | 'players' = 'oldman', tools = true) {
    const game = need();
    const a = game.world?.anchor('cart_start') ?? ANCHORS.cart_start;
    const pos = p ?? a.p;
    const c = spawnCart(game, pos, yaw ?? a.yaw ?? 0, owner);
    if (tools) spawnCartTools(game, c.id);
    return c;
  },
  carts(): Ent[] { return carts(need()); },
  findCart(): Ent | null { return carts(need())[0] ?? null; },
  spawnCartTools(cartId: number) { spawnCartTools(need(), cartId); },
  /** HOST: recipe book, cooked rice, minced pork, basil, garlic, chili, eggs & seasonings into the cart. */
  spawnStarterKit(cartId: number) { return spawnStarterKit(need(), cartId); },
  /** HOST: the stray dog eats the cart's rice + pork. */
  eatFoodFromCart(cartId: number) { return eatFoodFromCart(need(), cartId); },
  /** HOST: put an item onto a cart at a named spot (see SPOTS) or local [x,y,z,yaw]. */
  putOnCart(itemId: number, cartId: number, spot: string | number[]) {
    const game = need();
    const it = game.state.get(itemId), c = game.state.get(cartId);
    const at = typeof spot === 'string' ? SPOTS[spot] : spot;
    if (it && c && at) putOnCart(game, it, c, at);
  },
  spots: SPOTS,
  /** World position of a cart spot (e.g. 'burner', 'rice'). */
  cartSpot(cartId: number, spot: string): number[] | null {
    const game = need();
    const c = game.state.get(cartId);
    const at = SPOTS[spot];
    if (!c || !at) return null;
    const v = cartLocalToWorld(game, c, at, new THREE.Vector3());
    return [v.x, v.y, v.z];
  },
  /** HOST: eaten dish → dirty plate/bowl in the same place. */
  dishToDirtyPlate(dish: Ent | number) { const game = need(); const d = typeof dish === 'number' ? game.state.get(dish) : dish; return d ? dishToDirtyPlate(game, d) : null; },
  /** HOST: spawn a ready dish (tests / NPC props). */
  spawnDish(recipe: string, pos: ArrayLike<number>, over: any = {}) {
    const game = need();
    const r = RECIPES[recipe] ?? RECIPES.kaphrao_moo;
    const data = { recipe: r.id, egg: r.egg === 'topping' ? 'crispy' : 'none', rice: r.rice, portion: 150, taste: 0.85, salty: 0, spicy: 0.3, sweet: 0, cooked: 0, temp: 1, issues: ['no_spoon'], vessel: r.vessel, plate: 'flora', vis: { burn: 0, sauce: 0.5, herb: 1, chili: 0.5, size: 1, raw: 0 }, ...over };
    return game.items.spawn('dish', pos, { data });
  },
};
export type CookingApi = typeof cookingApi;
