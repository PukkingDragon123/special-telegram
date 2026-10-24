import { defineModule } from '../../game/contracts';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { Sound } from '../../core/audio';
import { params } from '../../core/util';
import { SHOPS, SHOP_BY_ID, basePrice, inHours } from './data';
import { defineOwnItems, defineFallbacks } from './items';
import { loadShopManifest } from './tex';
import { registerFallbackKeeperView, clearKeeperProxies } from './keepers';
import { RT, buildShops, hostTick, clientFrame, newDay, installIntents, installClient, resolveKind, billOf, isBanned, insideShop, unpaidOf, startMad } from './trade';

/**
 * SHOPS module — เฮียผัด!'s market stalls, shophouses, 8-Twelve and แม็กโคร่ง: shopkeepers with idle
 * life, physical stock with diegetic price tags, buying, bargaining, the mad system, Day-1 credit,
 * opening hours / unlocks by day, daily restock. See data.ts (economy table) and trade.ts (logic).
 *
 * API: (game as any).shops = { priceOf, isOpen, isUnlocked, list, stockLeft, bill, debt, keeperOf, shopAt, data }
 * Events (host, local): 'shop:bought' {player, shop, items, total, credit}, 'shop:mad', 'shop:banned', 'shop:debtPaid'.
 * Listens: 'intro:goMarket' (auntie offers credit to the broke gang).
 */

const A = '../gen/shops/audio/';
function registerSounds() {
  const add = (k: string, files: string[], vol: number, extra: any = {}) => {
    if (!Sound.manifest[k]) (Sound.manifest as any)[k] = { files: files.map((f) => A + f), vol, cat: 'sfx', pitchVar: 0.04, ...extra };
  };
  add('shop_door_chime', ['door_chime.mp3'], 0.75, { desc: '8-Twelve door chime (ding-dong)' });
  add('shop_scan', ['scan_beep.mp3', 'scan_beep_2.mp3'], 0.55, { desc: 'barcode scanner beep' });
  add('shop_zap', ['zap_1.mp3', 'zap_2.mp3', 'zap_3.mp3'], 0.6, { desc: 'electric fly-swatter zap', pitchVar: 0.12 });
  add('shop_fly_buzz', ['fly_buzz.mp3'], 0.35, { loop: true, desc: 'flies around the market stalls' });
  add('shop_alarm', ['alarm.mp3'], 0.6, { desc: 'convenience-store anti-theft gate' });
  add('shop_shutter', ['shutter.mp3', 'shutter_2.mp3'], 0.75, { desc: 'roller shutter rattling up/down' });
  add('shop_buzz', ['buzz_wrong.mp3'], 0.6, { desc: 'wrong-answer buzzer' });
  add('shop_whistle', ['whistle.mp3'], 0.7, { desc: 'keeper whistles: HEY, you have not paid!' });
  add('shop_dazzle', ['dazzle.mp3'], 0.6, { desc: 'stars & birds after a slap' });
  add('shop_fail', ['fail.mp3'], 0.6, { desc: 'funny fail tone' });
  add('shop_laugh', ['laugh.mp3', 'laugh_2.mp3'], 0.6, { desc: 'keeper laughs at a joke' });
  add('shop_deal', ['deal.mp3'], 0.6, { desc: 'good deal bell' });
  add('shop_calc', ['calc_1.mp3', 'calc_2.mp3', 'calc_3.mp3'], 0.5, { desc: 'calculator key pip', pitchVar: 0.1 });
}

function anchorOf(game: Game, id: string) { return game.world?.anchors[id]; }

function makeApi(game: Game) {
  const api = {
    data: SHOPS,
    /** Price of an item kind at a shop (or the reference market price). */
    priceOf(kind: string, shopId?: string): number | null {
      if (shopId) {
        const rt = RT.get(shopId);
        const st = SHOP_BY_ID[shopId]?.stock.find((s) => (rt?.kinds.get(s.id) ?? resolveKind(game, s)) === kind || s.kinds.includes(kind));
        return st ? st.price : null;
      }
      const b = basePrice(kind);
      if (b !== null) return b;
      for (const s of SHOPS) for (const st of s.stock) if ((RT.get(s.id)?.kinds.get(st.id)) === kind) return st.price;
      return game.items.def(kind)?.price ?? null;
    },
    isOpen(id: string) { const rt = RT.get(id); return rt ? !!rt.ent.open : (SHOP_BY_ID[id] ? inHours(SHOP_BY_ID[id], game.clock.time) && (game.g.day ?? 1) >= SHOP_BY_ID[id].day : false); },
    isUnlocked(id: string) { const s = SHOP_BY_ID[id]; return !!s && ((game.g.day ?? 1) >= s.day || !!game.g.unlocks?.shops?.includes?.(id)); },
    list() { return SHOPS.map((s) => ({ id: s.id, name: s.name, open: api.isOpen(s.id), unlocked: api.isUnlocked(s.id), hours: [s.open, s.close], day: s.day, keeper: RT.get(s.id)?.keeper?.id ?? null })); },
    stockLeft(id: string, stockId?: string) { const left = RT.get(id)?.ent.left ?? {}; return stockId ? left[stockId] ?? 0 : { ...left }; },
    /** What a player owes at a shop right now. */
    bill(playerId: number, id: string) { const rt = RT.get(id); const pl = game.state.get(playerId); return rt && pl ? billOf(rt, pl) : null; },
    unpaid(playerId: number, id?: string): Ent[] { return id ? unpaidOf(id, playerId) : SHOPS.flatMap((s) => unpaidOf(s.id, playerId)); },
    debt() { return { ...(game.g.debt ?? {}) }; },
    isBanned(playerId: number, id: string) { const rt = RT.get(id); return rt ? isBanned(rt, playerId) : false; },
    keeperOf(id: string) { return RT.get(id)?.keeper ?? null; },
    shopAt(p: ArrayLike<number>) { for (const rt of RT.values()) if (rt.fix && insideShop(rt, p)) return rt.def.id; return null; },
    /** HOST/dev: make a keeper angry at a player (tests). */
    _mad(id: string, playerId: number, reason: 'leave' | 'rude' | 'debt' = 'rude') { const rt = RT.get(id); const pl = game.state.get(playerId); if (rt && pl && game.isHost) startMad(rt, pl, reason); },
    _rt: RT,
  };
  (game as any).shops = api;
  return api;
}

function shoplab(game: Game) {
  if (!params.has('shoplab') || !game.isHost) return;
  const g = game.g;
  const day = Number(params.get('shopday') ?? 0);
  if (day > 0 && day !== g.day) { g.day = day; newDay(game); }
  g.time = Number(params.get('shoptime') ?? 9);
  const money = Number(params.get('shopmoney') ?? 1000);
  for (const pl of game.players()) pl.wallet = money;
  const at = params.get('shopat') ?? 'auntie_stall';
  const a = anchorOf(game, SHOP_BY_ID[at]?.counter ?? SHOP_BY_ID[at]?.anchor ?? at);
  if (a && game.player) {
    const yaw = a.yaw ?? 0;
    const back = 0.9;
    game.player.teleport([a.p[0] + Math.sin(yaw) * back, a.p[1], a.p[2] + Math.cos(yaw) * back], yaw);
  }
  console.info('[shops] shoplab: day', g.day, 'time', g.time, 'money', money, 'at', at);
}

export default defineModule({
  id: 'shops',
  deps: ['characters', 'cooking'],
  init(game) {
    registerSounds();
    loadShopManifest();
    defineOwnItems(game);
    registerFallbackKeeperView(game);
    installIntents(game);
    installClient(game);
    game.volatile.add('shop');
    makeApi(game);
    // the intro tells the broke gang to go to auntie → she offers credit (แปะโป้ง)
    game.events.on('intro:goMarket', () => { if (game.isHost) game.g.shopCreditOffer = true; });
    game.events.on('world:ready', () => {
      try { buildShops(game); shoplab(game); } catch (e) { console.error('[shops] build', e); }
    });
    game.events.on('world:exit', () => { clearKeeperProxies(game); RT.clear(); });
  },
  buildWorld(game) {
    // fallback item kinds for stock nobody else defines (all module inits are done by now)
    const need = new Set<string>();
    for (const s of SHOPS) for (const st of s.stock) if (!st.kinds.some((k) => game.items.def(k))) need.add(st.fb);
    defineFallbacks(game, need);
  },
  hostUpdate(game, dt) { if (RT.size) hostTick(game, dt); },
  frame(game, dt) { if (RT.size) clientFrame(game, dt); },
  onNewDay(game) { newDay(game); },
});
