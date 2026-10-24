import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import type { TL } from '../../core/util';
import type { SayOpts } from '../../ui3d/bubbles';
import type { Action, Ctx } from '../../game/interact';
import { Sound } from '../../core/audio';
import { SHOPS, ShopDef, StockDef, PERSONALITIES, Personality, REPLY_CATS, ReplyCat, TUNE, inHours, alcoholHours } from './data';
import * as Lines from './lines';
import { fill, pickLine } from './lines';
import { buildFixture, setShutter, updateCard, ShopFix } from './fixtures';
import { spawnKeeper, keeperLife, wakeKeeper, setAnim, keeperCall, keeperSex, keeperFrame } from './keepers';
import { calcTex, canvasMat, hangTagTex, signTex } from './tex';
import { F } from '../../core/fonts';
import { dist2D, roundPrice, shuffle, sndKey, tl } from './util';

/* =============================================================================================
 * TRADE — host-authoritative shops: physical stock on display, buying (pick up = unpaid, pay at the
 * keeper), bargaining rounds, the MAD SYSTEM, Day-1 credit, delivery, bagging, opening hours,
 * unlocks by day / recipe, daily restock. Clients only send intents and show the 3-second choices.
 * ============================================================================================= */

type Session =
  | { kind: 'bargain'; pid: number; token: number; round: number; mood: number; base: number; price: number; cats: ReplyCat[]; deadline: number }
  | { kind: 'mad'; pid: number; token: number; reason: 'leave' | 'rude' | 'debt'; right: number; funny: number; deadline: number }
  | { kind: 'ask'; pid: number; token: number; q: 'bag' | 'salapao' | 'deliver'; items: number[]; deadline: number };

export interface ShopRT {
  def: ShopDef;
  pers: Personality;
  fix: ShopFix | null;
  ent: Ent;
  keeper: Ent | null;
  kinds: Map<string, string>;
  slotItem: (number | null)[];
  refillAt: number[];
  session: Session | null;
  queue: { pid: number; q: 'bag' | 'salapao' | 'deliver'; items: number[] }[];
  later: { at: number; fn: () => void }[];
  warned: Map<number, number>;
  greeted: Map<number, number>;
  idleNext: number;
  zapAt: number;
  now: number;
  chase: { pid: number; until: number; slapped: boolean } | null; // until = engine (game) time
  march: { phase: 'go' | 'wait' | 'back'; next: number } | null;
  inside: Map<number, boolean>;
  avail: Set<string>;
  say(line: TL, o?: SayOpts): void;
  relOf(pl: Ent): number;
  neighbour?(): Ent | null;
}

export const RT = new Map<string, ShopRT>();
let token = 1;
let G: Game;
let hostAcc = { scan: 0, sec: 0, life: 0 };

const realNow = () => performance.now() / 1000;
const abs = (game: Game) => (game.g.day ?? 1) * 24 + (game.g.time ?? 7);
const pkey = (pl: Ent) => (pl.name || 'P' + pl.slot) as string;

// ------------------------------------------------------------------ setup (every peer, on world:ready)

export function resolveKind(game: Game, st: StockDef): string {
  for (const k of st.kinds) if (game.items.def(k)) return k;
  return st.fb;
}

export function buildShops(game: Game) {
  G = game;
  for (const rt of RT.values()) rt.fix?.root.removeFromParent();
  RT.clear();
  for (const def of SHOPS) {
    const kinds = new Map(def.stock.map((st) => [st.id, resolveKind(game, st)]));
    let fix: ShopFix | null = null;
    try { fix = buildFixture(game, def, kinds); } catch (e) { console.error('[shops] fixture', def.id, e); }
    if (fix) game.scene!.add(fix.root);
    let ent = game.state.find('shop', (s) => s.sid === def.id);
    if (!ent && game.isHost) ent = game.state.spawn('shop', { sid: def.id, open: false, unlocked: false, left: {}, deal: {}, dealt: {}, ban: {}, bar: null, mood: 0, keeper: null, sold: 0 });
    const pers = PERSONALITIES[def.keeper.personality] ?? PERSONALITIES.soft_auntie;
    const rt: ShopRT = {
      def, pers, fix, ent: ent ?? ({ id: -1, t: 'shop', sid: def.id } as Ent), keeper: null, kinds,
      slotItem: fix ? fix.slots.map(() => null) : [], refillAt: fix ? fix.slots.map(() => 0) : [],
      session: null, queue: [], later: [], warned: new Map(), greeted: new Map(), idleNext: 0, zapAt: 0, now: 0, chase: null, march: null,
      inside: new Map(), avail: new Set(),
      say(line, o = {}) {
        if (!this.keeper) return;
        const mad = (this.ent.mood ?? 0) < -1.2 || this.session?.kind === 'mad';
        G.say(this.keeper.id, line, { voice: pers.voice, ...(mad ? { style: 'shout', fill: 0xffd9c9, cps: 70 } : {}), ...o });
      },
      relOf(pl) { return (G.g.shopRel?.[def.id]?.[pkey(pl)] ?? 0) as number; },
    };
    RT.set(def.id, rt);
  }
  // neighbours (market keepers gossip)
  for (const rt of RT.values()) rt.neighbour = () => {
    let best: Ent | null = null, bd = 16;
    for (const o of RT.values()) if (o !== rt && o.keeper && rt.keeper?.p && o.keeper.p) { const d = dist2D(o.keeper.p, rt.keeper.p); if (d < bd) { bd = d; best = o.keeper; } }
    return best;
  };
  if (game.isHost) hostSetup(game);
  else for (const rt of RT.values()) linkClient(rt);
}

function linkClient(rt: ShopRT) {
  const e = G.state.find('shop', (s) => s.sid === rt.def.id);
  if (e) rt.ent = e;
  rt.keeper = G.state.find('npc', (n) => n.role === 'shopkeeper:' + rt.def.id) ?? null;
}

function hostSetup(game: Game) {
  const g = game.g;
  g.debt ??= {}; g.debtDay ??= {}; g.creditUsed ??= {}; g.shopRel ??= {};
  for (const rt of RT.values()) {
    if (!rt.fix) continue;
    rt.keeper = spawnKeeper(game, rt);
    rt.ent.keeper = rt.keeper.id;
    // remove stale display items (saved games / scene re-entry), then restock
    for (const it of game.state.all('item')) if (it.shop === rt.def.id && it.disp) game.items.remove(it);
    if (!Object.keys(rt.ent.left ?? {}).length) restock(rt);
    rt.ent.open = false;
    rt.idleNext = 0;
  }
  hostTick(game, 0, true);
}

// ------------------------------------------------------------------ stock

export function isUnlocked(rt: ShopRT) {
  const u = G.g.unlocks?.shops;
  return (G.g.day ?? 1) >= rt.def.day || (Array.isArray(u) && u.includes(rt.def.id));
}

function unlockedRecipes(): string[] {
  const u = G.g.unlocks?.recipes;
  return Array.isArray(u) ? u : ['kaphrao_moo', 'khai_dao'];
}

export function stockAvailable(rt: ShopRT, st: StockDef) {
  const day = G.g.day ?? 1;
  if (day >= (st.day ?? rt.def.day)) return true;
  if (st.recipes?.length) { const r = unlockedRecipes(); return st.recipes.some((x) => r.includes(x)); }
  return false;
}

function restock(rt: ShopRT) {
  const left: Record<string, number> = {};
  for (const st of rt.def.stock) left[st.id] = st.qty;
  rt.ent.left = left;
}

function stockOf(rt: ShopRT, id: string) { return rt.def.stock.find((s) => s.id === id); }

function spawnDisplay(rt: ShopRT, i: number): boolean {
  const slot = rt.fix!.slots[i];
  const st = stockOf(rt, slot.stock);
  if (!st || !stockAvailable(rt, st)) return false;
  const left = rt.ent.left?.[st.id] ?? 0;
  if (left <= 0) return false;
  const kind = rt.kinds.get(st.id)!;
  const def = G.items.def(kind);
  if (!def) return false;
  const data = { ...(def.data?.() ?? {}), ...(st.data ?? {}), shop: rt.def.id };
  const e = G.items.spawn(kind, slot.p, { yaw: slot.yaw, noPhysics: true, data, extra: { shop: rt.def.id, sk: st.id, ss: i, price: st.price, disp: true } });
  if (!e) return false;
  rt.ent.left = { ...rt.ent.left, [st.id]: left - 1 };
  rt.slotItem[i] = e.id;
  return true;
}

function fillDisplays(rt: ShopRT, now: number, announce = false) {
  if (!rt.fix || !rt.ent.open) return;
  let added = 0;
  for (let i = 0; i < rt.fix.slots.length; i++) {
    const cur = rt.slotItem[i];
    const e = cur != null ? G.state.get(cur) : null;
    if (e && e.disp && e.ss === i) continue;
    rt.slotItem[i] = null;
    if (rt.refillAt[i] > now) continue;
    if (spawnDisplay(rt, i)) added++;
  }
  if (announce && added) rt.say(pickLine(Lines.NEW_STOCK, Lines.NEW_STOCK));
}

function clearDisplays(rt: ShopRT) {
  for (let i = 0; i < rt.slotItem.length; i++) {
    const id = rt.slotItem[i];
    const e = id != null ? G.state.get(id) : null;
    if (e && e.disp) { rt.ent.left = { ...rt.ent.left, [e.sk]: (rt.ent.left?.[e.sk] ?? 0) + 1 }; G.items.remove(e); }
    rt.slotItem[i] = null;
  }
}

function markPaid(e: Ent) {
  e.unpaid = false; e.disp = false;
  delete e.shop; delete e.price; delete e.buyer; delete e.sk; delete e.ss;
  if (e.data) { const d = { ...e.data }; delete d.unpaid; delete d.shop; e.data = d; }
}

/** Return an item to the shop (fly FX), back into its slot when free, otherwise into the stock count. */
function returnItem(rt: ShopRT, e: Ent, fly = true, toPos?: number[]) {
  // eject foreign contents of returned containers
  for (const c of G.items.contents(e)) {
    if (c.unpaid && c.shop === rt.def.id) returnItem(rt, c, fly);
    else { const p = G.items.worldPos(e); G.items.toWorld(c, p ? [p.x, p.y + 0.3, p.z] : (toPos ?? [0, 1, 0])); }
  }
  const from = G.items.worldPos(e);
  const i = e.ss as number;
  const slot = rt.fix?.slots[i];
  if (fly && from && slot) G.emit('shop:fly', { k: e.k, a: [from.x, from.y, from.z], b: slot.p });
  const curId = rt.slotItem[i];
  const cur = curId != null ? G.state.get(curId) : null;
  if (slot && rt.ent.open && (!cur || !cur.disp)) {
    G.items.detach(e);
    e.p = [...slot.p];
    e.q = [0, Math.sin(slot.yaw / 2), 0, Math.cos(slot.yaw / 2)];
    e.disp = true; e.unpaid = false; delete e.buyer;
    if (e.data) { const d = { ...e.data }; delete d.unpaid; e.data = d; }
    rt.slotItem[i] = e.id;
    rt.refillAt[i] = 0;
  } else {
    rt.ent.left = { ...rt.ent.left, [e.sk]: (rt.ent.left?.[e.sk] ?? 0) + 1 };
    G.items.remove(e);
  }
}

// ------------------------------------------------------------------ queries (all peers)

/** The player carrying an item (through containers), or null. */
export function carrierOf(e: Ent): Ent | null {
  let cur: Ent | undefined = e, n = 0;
  while (cur && n++ < 6) {
    if (cur.holder != null) return G.state.get(cur.holder) ?? null;
    if (cur.in == null) return null;
    cur = G.state.get(cur.in);
  }
  return null;
}

function itemPos(e: Ent): number[] | null {
  const c = carrierOf(e);
  if (c?.p) return c.p;
  let cur: Ent | undefined = e, n = 0;
  while (cur && cur.in != null && n++ < 6) cur = G.state.get(cur.in);
  return cur?.p ?? e.p ?? null;
}

export function insideShop(rt: ShopRT, p: ArrayLike<number>, margin = 0) {
  const f = rt.fix;
  if (!f) return false;
  if (f.rect) { const [a, b, c, d] = f.rect; return p[0] >= a - margin && p[0] <= c + margin && p[2] >= b - margin && p[2] <= d + margin; }
  return dist2D(p, f.center) <= f.radius + margin;
}

export function unpaidOf(sid: string, pid: number): Ent[] {
  const out: Ent[] = [];
  G.state.each('item', (e) => { if (e.unpaid && e.shop === sid && e.buyer === pid) out.push(e); });
  return out;
}

export function regularDisc(rt: ShopRT, pl: Ent) {
  const rel = rt.relOf(pl);
  let d = 0;
  for (const r of TUNE.regular) if (rel >= r.at) d = r.disc;
  return rt.pers.bargain ? d : 0;
}

/** Bill for a player at a shop (with LPG swap, bargain deal and regular discount). */
export function billOf(rt: ShopRT, pl: Ent) {
  const items = unpaidOf(rt.def.id, pl.id);
  let sum = 0;
  const empties = emptyTanks(pl, rt);
  let swaps = 0;
  for (const e of items) {
    const st = stockOf(rt, e.sk);
    let price = e.price ?? st?.price ?? 0;
    if (st?.swapPrice && swaps < empties.length) { price = st.swapPrice; swaps++; }
    sum += price;
  }
  const pct = (rt.ent.deal?.[pl.id] ?? 0) + regularDisc(rt, pl);
  const total = items.length ? roundPrice(sum * (1 - Math.min(0.35, pct))) : 0;
  return { items, sum, total, swaps, empties: empties.slice(0, swaps) };
}

/** Empty LPG tanks the player brings (carried or standing in the shop area). */
function emptyTanks(pl: Ent, rt: ShopRT): Ent[] {
  const out: Ent[] = [];
  G.state.each('item', (e) => {
    if (e.unpaid || e.disp || !/gas_tank/.test(e.k)) return;
    const d = e.data ?? {};
    const fill = d.gas ?? d.kg ?? d.fill ?? d.lpg;
    const max = d.gas !== undefined || d.kg !== undefined || d.lpg !== undefined ? 15 : 1;
    if (fill === undefined || fill / max > 0.15) return;
    const c = carrierOf(e);
    const p = itemPos(e);
    if (c?.id === pl.id || (p && insideShop(rt, p))) out.push(e);
  });
  return out;
}

export function isBanned(rt: ShopRT, pid: number) { return (rt.ent.ban?.[pid] ?? 0) > abs(G); }

function creditAllowed(rt: ShopRT) {
  const k = rt.def.debtKey;
  if (!k) return false;
  return !G.g.creditUsed?.[k] && ((G.g.day ?? 1) <= 1 || !!G.g.shopCreditOffer);
}

// ------------------------------------------------------------------ choices (host → one client)

function ask(rt: ShopRT, pid: number, options: TL[], colors: number[] | undefined, extra: Partial<Session> & { kind: Session['kind'] }, seconds = 3) {
  const tk = token++;
  rt.session = { ...(extra as any), pid, token: tk, deadline: rt.now + seconds * 3 + 12 };
  G.emit('shop:choose', { pid, sid: rt.def.id, token: tk, options, colors, seconds });
}

function onPick(pl: Ent, d: { sid: string; token: number; i: number }) {
  const rt = RT.get(d.sid);
  const s = rt?.session;
  if (!rt || !s || s.token !== d.token || s.pid !== pl.id) return;
  rt.session = null;
  const i = Number.isInteger(d.i) ? d.i : -1;
  if (s.kind === 'bargain') bargainReply(rt, pl, s, i);
  else if (s.kind === 'mad') madReply(rt, pl, s, i);
  else askReply(rt, pl, s, i);
}

function later(rt: ShopRT, sec: number, fn: () => void) { rt.later.push({ at: rt.now + sec, fn }); }

// ------------------------------------------------------------------ PAY

function pay(rt: ShopRT, pl: Ent, o: { quiet?: boolean; credit?: boolean } = {}): boolean {
  const k = rt.keeper;
  let { items, total, empties } = billOf(rt, pl);
  if (!items.length) { if (!o.quiet) rt.say(pickLine(Lines.NOTHING, Lines.NOTHING)); return false; }
  // Thai law: alcohol only 11–14 & 17–24 → the clerk sends the beer back
  const booze = items.filter((e) => stockOf(rt, e.sk)?.alcohol);
  if (booze.length && !alcoholHours(G.clock.time)) {
    rt.say(Lines.NO_ALCOHOL);
    for (const b of booze) returnItem(rt, b, true);
    ({ items, total, empties } = billOf(rt, pl));
    if (!items.length) return false;
  }
  if (!o.credit) {
    if ((pl.wallet ?? 0) < total) {
      rt.say(fill(pickLine(Lines.BROKE, Lines.BROKE), { c: rt.pers.callPlayer, p: total - (pl.wallet ?? 0) }));
      if (creditAllowed(rt)) later(rt, 2.2, () => rt.say(pickLine(Lines.CREDIT_OFFER, Lines.CREDIT_OFFER)));
      G.sfx(sndKey('shop_fail'), pl.p, { vol: 0.5 });
      return false;
    }
    const at = k?.p ? [k.p[0], k.p[1] + 1.7, k.p[2]] : null;
    G.money(pl.id, -total, 'shop:' + rt.def.id, at);
  } else {
    const key = rt.def.debtKey!;
    G.g.debt = { ...G.g.debt, [key]: (G.g.debt?.[key] ?? 0) + total };
    G.g.debtDay = { ...G.g.debtDay, [key]: G.g.day ?? 1 };
    G.g.creditUsed = { ...G.g.creditUsed, [key]: true };
  }
  for (const t of empties) G.items.remove(t);
  const kinds = items.map((e) => e.k);
  const big = items.filter((e) => (G.items.defOf(e)?.slots ?? 1) >= 2 || stockOf(rt, e.sk)?.big);
  const small = items.filter((e) => !big.includes(e) && !G.items.defOf(e)?.container && (G.items.defOf(e)?.weight ?? 0.5) <= 2.6);
  for (const e of items) markPaid(e);
  // relationship: buying makes you a regular
  if (total >= 30) bumpRel(rt, pl, 1);
  rt.ent.deal = { ...rt.ent.deal, [pl.id]: 0 };
  rt.ent.dealt = { ...rt.ent.dealt, [pl.id]: false };
  rt.ent.sold = (rt.ent.sold ?? 0) + total;
  G.emit('shop:paid', { sid: rt.def.id, pid: pl.id, total, n: items.length, credit: !!o.credit, store: rt.def.kind === 'store' || rt.def.kind === 'warehouse', at: k?.p ?? pl.p });
  G.events.emit('shop:bought', { player: pl.id, shop: rt.def.id, items: kinds, total, credit: !!o.credit });
  if (k) { setAnim(G, k, 'give'); k.face = 'neutral'; }
  if (pl) { pl.anim = 'give'; pl.animLoop = false; pl.animT = (G.g.time ?? 0) + Math.random() * 1e-3; }
  if (!o.quiet && !o.credit) rt.say(pickLine(Lines.THANKS[rt.pers.id], Lines.THANKS._));
  if (swapsSaid(empties.length)) rt.say(fill(pickLine(Lines.SWAP_TANK, Lines.SWAP_TANK), { p: total }));
  // follow-up questions: salapao (8-Twelve), bag, delivery
  if (rt.pers.id === 'robot_clerk') rt.queue.push({ pid: pl.id, q: 'salapao', items: [] });
  if (small.length >= 2 && !o.credit) rt.queue.push({ pid: pl.id, q: 'bag', items: small.map((e) => e.id) });
  if (big.length) rt.queue.push({ pid: pl.id, q: 'deliver', items: big.map((e) => e.id) });
  if (rt.queue.length) later(rt, 1.6, () => nextQuestion(rt));
  return true;
}
const swapsSaid = (n: number) => n > 0;

function bumpRel(rt: ShopRT, pl: Ent, d: number) {
  const rel = { ...(G.g.shopRel ?? {}) };
  const m = { ...(rel[rt.def.id] ?? {}) };
  m[pkey(pl)] = Math.max(-5, Math.min(12, (m[pkey(pl)] ?? 0) + d));
  rel[rt.def.id] = m;
  G.g.shopRel = rel;
}

function nextQuestion(rt: ShopRT) {
  if (rt.session) { later(rt, 1.5, () => nextQuestion(rt)); return; }
  const q = rt.queue.shift();
  if (!q) return;
  const pl = G.state.get(q.pid);
  if (!pl) return nextQuestion(rt);
  if (q.q === 'salapao') { rt.say(Lines.ASK_SALAPAO); ask(rt, q.pid, Lines.SALAPAO_OPTS, [0xfffbf2, 0xfff1b8], { kind: 'ask', q: 'salapao', items: [] } as any); }
  else if (q.q === 'bag') { rt.say(Lines.ASK_BAG[rt.pers.id] ?? Lines.ASK_BAG._); ask(rt, q.pid, Lines.BAG_OPTS, [0xfffbf2, 0xe3f5e1], { kind: 'ask', q: 'bag', items: q.items } as any); }
  else { rt.say(Lines.ASK_DELIVER); ask(rt, q.pid, Lines.DELIVER_OPTS, [0xfff1b8, 0xfffbf2], { kind: 'ask', q: 'deliver', items: q.items } as any); }
}

function askReply(rt: ShopRT, pl: Ent, s: Extract<Session, { kind: 'ask' }>, i: number) {
  if (s.q === 'salapao') {
    rt.say(i === 1 ? tl('ขออภัยค่ะ ซาลาเปาหมดค่ะ', "Sorry, we're out of buns") : tl('ขอบคุณค่ะ', 'Thank you'));
  } else if (s.q === 'bag' && i === 0) {
    const robot = rt.pers.id === 'robot_clerk';
    if (robot && !G.money(pl.id, -1, 'shop:bag')) { rt.say(tl('ไม่มี 1 บาทเหรอคะ…', 'Not even 1 baht…')); }
    else bagItems(rt, pl, s.items);
  } else if (s.q === 'deliver' && i === 0) {
    if (G.money(pl.id, -TUNE.deliveryFee, 'shop:delivery', rt.keeper?.p ? [rt.keeper.p[0], rt.keeper.p[1] + 1.7, rt.keeper.p[2]] : null)) deliver(rt, pl, s.items);
    else rt.say(fill(pickLine(Lines.BROKE, Lines.BROKE), { c: rt.pers.callPlayer, p: TUNE.deliveryFee }));
  }
  later(rt, 1.4, () => nextQuestion(rt));
}

function bagItems(rt: ShopRT, pl: Ent, ids: number[]) {
  const kind = (G as any)._shopBagKind ?? 'plastic_bag';
  const its = ids.map((id) => G.state.get(id)).filter((e): e is Ent => !!e && carrierOf(e)?.id === pl.id && e.in == null);
  if (!its.length) return;
  const bag = G.items.spawn(kind, pl.p ?? [0, 0, 0], { noPhysics: true });
  if (!bag) return;
  for (const e of its) G.items.toContainer(e, bag);
  if (!G.items.putInInventory(pl, bag)) G.items.toWorld(bag, [pl.p![0], pl.p![1] + 0.8, pl.p![2]]);
  G.sfx('plastic_bag_rustle', pl.p, { vol: 0.8 });
  rt.say(tl('นี่จ้ะ ถุงนึง', 'Here, one bag'));
}

function deliveryTarget(): number[] {
  const cart = G.state.find('cart', () => true);
  const a = G.world?.anchors.tables_area ?? G.world?.anchors.cart_start;
  const base = cart?.p ?? a?.p ?? [5, 0.15, -23];
  return [base[0] + 1.6 + Math.random() * 1.2, base[1] + 0.3, base[2] + (Math.random() - 0.5) * 2];
}

function deliver(rt: ShopRT, pl: Ent, ids: number[]) {
  const its = ids.map((id) => G.state.get(id)).filter((e): e is Ent => !!e);
  const recs = its.map((e) => ({ k: e.k, data: e.data, q: e.q }));
  for (const e of its) G.items.remove(e);
  rt.say(tl('เดี๋ยวให้หลานขี่มอไซค์ไปส่งให้ แป๊บเดียว!', "My nephew will drive it over on the scooter!"));
  later(rt, TUNE.deliveryTime, () => {
    const at = deliveryTarget();
    for (const r of recs) { const p = deliveryTarget(); G.items.spawn(r.k, p, { data: r.data, q: r.q }); }
    G.popup([at[0], at[1] + 1.4, at[2]], pickLine(Lines.DELIVERED, Lines.DELIVERED).th);
    G.sfx(sndKey('shop_deal', 'timer_ding'), at, { vol: 0.8 });
    G.sfx('plastic_chair_scrape', at, { vol: 0.6 });
  });
}

// ------------------------------------------------------------------ BARGAIN

function startBargain(rt: ShopRT, pl: Ent) {
  const k = rt.keeper;
  if (!k) return;
  const b = billOf(rt, pl);
  if (!b.items.length) { rt.say(pickLine(Lines.NOTHING, Lines.NOTHING)); return; }
  if (!rt.pers.bargain) {
    const n = (rt.ent.robo ?? 0) as number;
    rt.ent.robo = n + 1;
    rt.say(Lines.ROBOT_NO_BARGAIN[Math.min(n, Lines.ROBOT_NO_BARGAIN.length - 1)]);
    setAnim(G, k, 'shrug');
    return;
  }
  if (rt.session || (rt.ent.bar && rt.ent.bar.pid !== pl.id)) { rt.say(pickLine(Lines.BUSY, Lines.BUSY)); return; }
  if (rt.ent.dealt?.[pl.id]) { rt.say(pickLine(Lines.AGAIN, Lines.AGAIN)); rt.ent.mood = (rt.ent.mood ?? 0) - 0.5; return; }
  k.kst = 'bargain'; k.hold = 'shop_calculator'; k.lookAt = pl.id; k.face = 'think';
  setAnim(G, k, 'think');
  const base = b.sum;
  const price = b.total;
  rt.ent.mood = Math.min(1, rt.relOf(pl) * 0.15);
  rt.ent.bar = { pid: pl.id, price, round: 0 };
  G.sfx(sndKey('shop_calc'), k.p, { vol: 0.7 });
  rt.say(fill(pickLine(Lines.QUOTE[rt.pers.id], Lines.QUOTE._), { p: price, c: rt.pers.callPlayer }));
  later(rt, 1.3, () => bargainRound(rt, pl, base, price, 0));
}

function bargainRound(rt: ShopRT, pl: Ent, base: number, price: number, round: number) {
  const call = keeperCall(rt.def);
  const sexWord = keeperSex(rt) === 'm' ? 'หล่อ' : 'สวย';
  const cats = shuffle([...REPLY_CATS]).slice(0, 3) as ReplyCat[];
  const options = cats.map((c) => fill(pickLine(Lines.REPLIES[c], Lines.REPLIES.polite), { k: call, s: sexWord }));
  ask(rt, pl.id, options, cats.map((c) => Lines.CAT_COLORS[c]), { kind: 'bargain', round, mood: rt.ent.mood ?? 0, base, price, cats } as any);
}

function bargainReply(rt: ShopRT, pl: Ent, s: Extract<Session, { kind: 'bargain' }>, i: number) {
  const k = rt.keeper!;
  const cat: ReplyCat | null = i >= 0 ? s.cats[i] : null;
  const delta = cat ? rt.pers.likes[cat] + (Math.random() - 0.5) * 0.5 : -0.7;
  const mood = (rt.ent.mood ?? 0) + delta;
  rt.ent.mood = mood;
  if (cat === 'rude') bumpRel(rt, pl, -1); else if (cat && delta > 0.8) bumpRel(rt, pl, 0.5);
  if (mood <= rt.pers.madAt) { rt.ent.bar = null; startMad(rt, pl, 'rude'); return; }
  const pct = Math.max(-0.5, Math.min(1, mood / 4)) * rt.pers.maxDiscount;
  const reg = regularDisc(rt, pl);
  const price = roundPrice(s.base * (1 - Math.min(0.35, pct + reg)));
  rt.ent.bar = { pid: pl.id, price, round: s.round + 1 };
  G.sfx(sndKey('shop_calc'), k.p, { vol: 0.6 });
  if (!cat) rt.say(pickLine(Lines.TIMEOUT, Lines.TIMEOUT));
  else {
    const R = Lines.REACT[rt.pers.id] ?? Lines.REACT._;
    const pool = delta > 0 ? R.good : (cat === 'sweet' && R.sweetFail ? R.sweetFail : R.bad);
    rt.say(fill(pickLine(pool, R.good), { p: price }));
    if (delta > 0) { k.face = 'think'; setAnim(G, k, cat === 'funny' ? 'celebrate' : 'talk'); if (cat === 'funny') G.sfx(sndKey('shop_laugh'), k.p, { vol: 0.7 }); }
    else { k.face = 'shock'; setAnim(G, k, 'angry'); }
  }
  const last = s.round + 1 >= rt.pers.patience;
  if (last) {
    later(rt, TUNE.roundGap + 0.4, () => {
      rt.say(fill(pickLine(Lines.FINAL, Lines.FINAL), { p: price }));
      rt.ent.deal = { ...rt.ent.deal, [pl.id]: pct };
      rt.ent.dealt = { ...rt.ent.dealt, [pl.id]: true };
      if (pct > 0.001) G.sfx(sndKey('shop_deal'), k.p, { vol: 0.7 });
      endTalk(rt, 2.5);
    });
  } else later(rt, TUNE.roundGap + 0.6, () => bargainRound(rt, pl, s.base, price, s.round + 1));
}

function endTalk(rt: ShopRT, delay = 0) {
  later(rt, delay, () => {
    const k = rt.keeper;
    rt.ent.bar = null;
    if (k && (k.kst === 'bargain' || k.kst === 'talk' || k.kst === 'mad')) { k.kst = 'idle'; k.hold = null; k.face = 'neutral'; setAnim(G, k, rt.fix?.keeper.sit ? 'sit' : 'idle', true); rt.idleNext = rt.now + 4; }
  });
}

// ------------------------------------------------------------------ MAD SYSTEM

export function startMad(rt: ShopRT, pl: Ent, reason: 'leave' | 'rude' | 'debt') {
  const k = rt.keeper;
  if (!k) return;
  if (rt.session?.kind === 'mad') return;
  // placeholder session right away (the choice pops up after the shout) so scans don't re-trigger
  rt.session = { kind: 'mad', pid: pl.id, token: -1, reason, right: -1, funny: -1, deadline: rt.now + 6 };
  k.kst = 'mad'; k.face = 'scream'; k.lookAt = pl.id; k.hold = null;
  setAnim(G, k, 'angry', true);
  rt.ent.mood = Math.min(rt.ent.mood ?? 0, -2);
  const shout = reason === 'leave' ? pickLine(Lines.MAD_LEAVE[rt.pers.id], Lines.MAD_LEAVE._) : reason === 'rude' ? pickLine(Lines.MAD_RUDE, Lines.MAD_RUDE) : pickLine(Lines.MAD_DEBT, Lines.MAD_DEBT);
  rt.say(fill(shout, { d: G.g.debt?.[rt.def.debtKey ?? ''] ?? 0 }), { style: 'shout', fill: 0xffd9c9, cps: 80, duration: 3 });
  G.sfx(rt.pers.id === 'robot_clerk' ? sndKey('shop_alarm') : sndKey('shop_whistle'), k.p, { vol: 0.9 });
  const sets = Lines.MAD_OPTS[reason];
  const set = sets[rt.pers.id] ?? sets._;
  const right = pickLine(set.right, set.right);
  const wrong = shuffle([...set.wrong]).slice(0, 2);
  const opts = shuffle([right, ...wrong]);
  const funny = opts.findIndex((o) => /หมากิน/.test(o.th));
  later(rt, 0.9, () => ask(rt, pl.id, opts, undefined, { kind: 'mad', reason, right: opts.indexOf(right), funny } as any));
  G.events.emit('shop:mad', { shop: rt.def.id, player: pl.id, reason });
}

function madReply(rt: ShopRT, pl: Ent, s: Extract<Session, { kind: 'mad' }>, i: number) {
  const k = rt.keeper!;
  const ok = i === s.right;
  if (s.reason === 'debt' && i >= 0 && i === s.funny && rt.pers.id === 'soft_auntie' && !G.g.debtJoke) {
    G.g.debtJoke = true;
    G.g.debtDay = { ...G.g.debtDay, [rt.def.debtKey!]: G.g.day ?? 1 };
    rt.say(Lines.DEBT_FUNNY_ONCE); G.sfx(sndKey('shop_laugh'), k.p, { vol: 0.8 });
    rt.ent.mood = 0; endTalk(rt, 2);
    return;
  }
  if (ok) {
    rt.ent.mood = -0.5;
    k.face = 'neutral'; setAnim(G, k, 'talk');
    rt.say(pickLine(Lines.MAD_CALM[s.reason], Lines.MAD_CALM.leave), { style: 'speech' });
    if (s.reason === 'leave') { if (!pay(rt, pl, { quiet: true })) snapBackAll(rt, pl, true); }
    else if (s.reason === 'debt') repay(rt, pl);
    else { rt.ent.deal = { ...rt.ent.deal, [pl.id]: 0 }; rt.ent.dealt = { ...rt.ent.dealt, [pl.id]: true }; }
    endTalk(rt, 2.5);
    return;
  }
  // wrong / timeout → items snap back, chased, banned
  G.sfx(sndKey('shop_fail', 'shop_buzz'), pl.p, { vol: 0.7 });
  rt.say(pickLine(Lines.MAD_ANGRY[rt.pers.id], Lines.MAD_ANGRY._), { style: 'shout', fill: 0xffc4b0, cps: 80 });
  snapBackAll(rt, pl, true);
  const hours = (G.g.day ?? 1) <= 1 ? TUNE.banHoursDay1 : TUNE.banHours;
  rt.ent.ban = { ...rt.ent.ban, [pl.id]: abs(G) + hours };
  rt.ent.deal = { ...rt.ent.deal, [pl.id]: 0 };
  bumpRel(rt, pl, -2);
  G.events.emit('shop:banned', { shop: rt.def.id, player: pl.id, until: rt.ent.ban[pl.id] });
  if (rt.pers.chases) { rt.chase = { pid: pl.id, until: G.engine.time + 6, slapped: false }; k.kst = 'chase'; setAnim(G, k, 'run', true); }
  else endTalk(rt, 3);
}

function snapBackAll(rt: ShopRT, pl: Ent, fly: boolean) {
  for (const e of unpaidOf(rt.def.id, pl.id)) returnItem(rt, e, fly, pl.p);
}

function chaseTick(rt: ShopRT) {
  const c = rt.chase, k = rt.keeper;
  if (!c || !k) return;
  const pl = G.state.get(c.pid);
  const post = rt.fix!.keeper;
  if (!pl?.p || G.engine.time > c.until || dist2D(k.p!, post.p) > 22) {
    rt.chase = null;
    if (pl) rt.say(tl('แฮ่กๆ… อย่าให้เห็นหน้าอีกนะ!', 'Huff… never come back!'));
    k.kst = 'return';
    G.npcs.go(k, post.p, { speed: 2.2, direct: true, face: post.yaw, onArrive: () => { k.kst = 'idle'; k.face = 'neutral'; setAnim(G, k, post.sit ? 'sit' : 'idle', true); } });
    return;
  }
  const d = dist2D(k.p!, pl.p);
  if (d < 1.25 && !c.slapped) {
    c.slapped = true;
    G.npcs.stop(k);
    setAnim(G, k, 'slap');
    pl.anim = 'get_slapped'; pl.animLoop = false; pl.animT = (G.g.time ?? 0) + Math.random() * 1e-3;
    G.sfx('slap_hard', pl.p, { vol: 0.9 });
    G.sfx(sndKey('shop_dazzle'), pl.p, { vol: 0.6, delay: 0.15 } as any);
    G.popup([pl.p[0], pl.p[1] + 1.9, pl.p[2]], Lines.SLAP_POP);
    G.emit('shop:slapped', { pid: pl.id });
    c.until = Math.min(c.until, G.engine.time + 1.2);
  } else if (!c.slapped) G.npcs.go(k, pl.p, { speed: 4.3, direct: true });
}

// ------------------------------------------------------------------ CREDIT & DEBT

function credit(rt: ShopRT, pl: Ent) {
  if (!creditAllowed(rt)) { rt.say(pickLine(Lines.CREDIT_NO, Lines.CREDIT_NO)); return; }
  const b = billOf(rt, pl);
  if (!b.items.length) { rt.say(pickLine(Lines.NOTHING, Lines.NOTHING)); return; }
  if (b.total > TUNE.creditMax) { rt.say(tl(`ติดได้ไม่เกิน ${TUNE.creditMax} บาทนะ เอาของไปคืนบ้าง`, `Max ${TUNE.creditMax} on credit — put something back`)); return; }
  pay(rt, pl, { credit: true });
  const d = G.g.debt?.[rt.def.debtKey!] ?? b.total;
  rt.say(fill(pickLine(Lines.CREDIT_YES, Lines.CREDIT_YES), { d }));
  later(rt, 3.2, () => rt.say(fill(Lines.CREDIT_YES[1], { d })));
  G.sfx('paper_rustle', rt.keeper?.p, { vol: 0.7 });
  G.sfx('cardboard', pl.p, { vol: 0.5, delay: 0.4 } as any);
  G.popup([pl.p![0], pl.p![1] + 1.9, pl.p![2]], `แปะโป้ง! ติดป้า ${d} ฿`);
}

function repay(rt: ShopRT, pl: Ent) {
  const key = rt.def.debtKey;
  if (!key) return;
  const debt = G.g.debt?.[key] ?? 0;
  if (debt <= 0) return;
  const amt = Math.min(debt, pl.wallet ?? 0);
  if (amt <= 0) { rt.say(fill(pickLine(Lines.DEBT_PART, Lines.DEBT_PART), { d: debt })); return; }
  G.money(pl.id, -amt, 'shop:debt', rt.keeper?.p ? [rt.keeper.p[0], rt.keeper.p[1] + 1.7, rt.keeper.p[2]] : null);
  const left = debt - amt;
  G.g.debt = { ...G.g.debt, [key]: left };
  if (left <= 0) {
    rt.say(pickLine(Lines.DEBT_REPAID, Lines.DEBT_REPAID));
    bumpRel(rt, pl, 2);
    G.events.emit('shop:debtPaid', { shop: rt.def.id, player: pl.id });
    if (rt.march) { rt.march = { phase: 'back', next: 0 }; }
  } else rt.say(fill(pickLine(Lines.DEBT_PART, Lines.DEBT_PART), { d: left }));
}

function debtTick(rt: ShopRT) {
  const key = rt.def.debtKey;
  const k = rt.keeper;
  if (!key || !k) return;
  const debt = G.g.debt?.[key] ?? 0;
  const day = G.g.day ?? 1, t = G.clock.time;
  const due = (G.g.debtDay?.[key] ?? day) < day;
  // auntie calls out to the broke gang after the intro sends them to her
  if (G.g.shopCreditOffer && !G.g.creditUsed?.[key] && rt.ent.open && rt.now > (rt.ent._offerNext ?? 0)) {
    const near = G.nearestPlayer(k.p!, 9);
    if (near) { rt.ent._offerNext = rt.now + 40; rt.say(pickLine(Lines.CREDIT_OFFER, Lines.CREDIT_OFFER)); setAnim(G, k, 'wave'); }
  }
  if (debt <= 0) { if (rt.march && rt.march.phase !== 'back') rt.march = { phase: 'back', next: 0 }; marchTick(rt); return; }
  const near = G.nearestPlayer(k.p!, 7);
  if (near && rt.now > (rt.ent._remindNext ?? 0) && k.kst !== 'mad' && !rt.session) {
    rt.ent._remindNext = rt.now + TUNE.remindEvery;
    if (due && t >= 12 && G.g.debtMad?.[key] !== day) { G.g.debtMad = { ...G.g.debtMad, [key]: day }; startMad(rt, near, 'debt'); }
    else rt.say(fill(pickLine(due ? Lines.DEBT_REMIND2 : Lines.DEBT_REMIND1, Lines.DEBT_REMIND1), { d: debt }));
  }
  // not repaid by the next afternoon → auntie marches to the cart and waits there, arms crossed
  if (due && t >= 14.2 && t < 18 && !rt.march && !rt.ent.open) rt.march = { phase: 'go', next: 0 };
  if (rt.march && t >= 18 && rt.march.phase !== 'back') rt.march = { phase: 'back', next: 0 };
  marchTick(rt);
}

function marchTick(rt: ShopRT) {
  const m = rt.march, k = rt.keeper;
  if (!m || !k) return;
  const post = rt.fix!.keeper;
  if (m.phase === 'go') {
    if (!G.npcs.isMoving(k)) {
      const cart = G.state.find('cart', () => true)?.p ?? G.world?.anchors.cart_start?.p ?? [4.9, 0.15, -23];
      const tgt = [cart[0] + 1.6, cart[1], cart[2] - 0.8];
      k.kst = 'march'; k.face = 'scream'; k.hold = null; setAnim(G, k, 'walk', true);
      G.npcs.go(k, tgt, { speed: 1.5, onArrive: () => { m.phase = 'wait'; setAnim(G, k, 'angry', true); } });
      m.phase = 'wait'; m.next = rt.now + 60;
    }
  } else if (m.phase === 'wait') {
    if (!G.npcs.isMoving(k) && rt.now > m.next) {
      m.next = rt.now + 22;
      rt.say(fill(pickLine(Lines.DEBT_MARCH, Lines.DEBT_MARCH), { d: G.g.debt?.[rt.def.debtKey!] ?? 0 }), { style: 'shout', fill: 0xffd9c9 });
    }
  } else if (m.phase === 'back') {
    rt.march = null;
    k.kst = 'return'; k.face = 'neutral'; setAnim(G, k, 'walk', true);
    G.npcs.go(k, post.p, { speed: 1.4, face: post.yaw, onArrive: () => { k.kst = 'idle'; setAnim(G, k, post.sit ? 'sit' : 'idle', true); } });
  }
}

// ------------------------------------------------------------------ HOST TICK

function openShop(rt: ShopRT, open: boolean) {
  if (!!rt.ent.open === open) return;
  rt.ent.open = open;
  rt.idleNext = 0;
  if (open) {
    if (!Object.keys(rt.ent.left ?? {}).length) restock(rt);
    for (const st of rt.def.stock) if (stockAvailable(rt, st)) rt.avail.add(st.id);
    fillDisplays(rt, rt.now);
    if (rt.keeper) { rt.keeper.kst = 'idle'; rt.keeper.face = 'neutral'; setAnim(G, rt.keeper, rt.fix!.keeper.sit ? 'sit' : 'idle', true); }
    if (G.nearestPlayer(rt.fix!.center, 14)) rt.say(pickLine(Lines.OPENING, Lines.OPENING));
  } else {
    clearDisplays(rt);
    rt.session = null; rt.ent.bar = null;
    if (rt.keeper && G.nearestPlayer(rt.fix!.center, 10)) rt.say(pickLine(Lines.CLOSED[rt.def.kind] ?? Lines.CLOSED._, Lines.CLOSED._));
  }
  G.emit('shop:shutter', { sid: rt.def.id, open });
}

export function hostTick(game: Game, dt: number, force = false) {
  G = game;
  const now = realNow();
  hostAcc.scan += dt; hostAcc.sec += dt; hostAcc.life += dt;
  for (const rt of RT.values()) {
    if (!rt.fix || rt.ent.id < 0) continue;
    rt.now = now;
    // scheduled actions
    if (rt.later.length) { const due = rt.later.filter((l) => l.at <= now); rt.later = rt.later.filter((l) => l.at > now); for (const l of due) { try { l.fn(); } catch (e) { console.error('[shops] later', e); } } }
    // session timeout (client never answered)
    if (rt.session && now > rt.session.deadline) { const s = rt.session; const pl = game.state.get(s.pid); if (pl) onPick(pl, { sid: rt.def.id, token: s.token, i: -1 }); else rt.session = null; }
    if (rt.chase) chaseTick(rt);
    if (rt.zapAt && now > rt.zapAt) { rt.zapAt = 0; const k = rt.keeper; if (k?.p) game.emit('shop:zap', { p: [k.p[0] - Math.sin(k.yaw ?? 0) * 0.5, k.p[1] + 1.55, k.p[2] - Math.cos(k.yaw ?? 0) * 0.5] }); }
  }
  if (hostAcc.life >= 0.1) { const t = hostAcc.life; hostAcc.life = 0; for (const rt of RT.values()) if (rt.fix) { try { keeperLife(game, rt, now); } catch (e) { console.error(e); } void t; } }
  if (hostAcc.scan >= 0.2 || force) { hostAcc.scan = 0; scan(game, now); }
  if (hostAcc.sec >= 1 || force) {
    hostAcc.sec = 0;
    const t = game.clock.time;
    for (const rt of RT.values()) {
      if (!rt.fix || rt.ent.id < 0) continue;
      const unlocked = isUnlocked(rt);
      if (rt.ent.unlocked !== unlocked) rt.ent.unlocked = unlocked;
      const want = unlocked && inHours(rt.def, t) && !rt.march;
      openShop(rt, want);
      if (rt.ent.open) {
        // newly unlocked recipes → new stock appears
        let fresh = false;
        for (const st of rt.def.stock) if (!rt.avail.has(st.id) && stockAvailable(rt, st)) { rt.avail.add(st.id); fresh = true; }
        fillDisplays(rt, now, fresh);
        if (t > rt.def.close - 0.35 && t < rt.def.close && rt.def.close < 24 && rt.ent._closing !== game.g.day) {
          const pending = game.players().some((p) => unpaidOf(rt.def.id, p.id).length);
          if (pending) { rt.ent._closing = game.g.day; rt.say(pickLine(Lines.CLOSING_SOON, Lines.CLOSING_SOON)); }
        }
      }
      debtTick(rt);
    }
  }
}

/** Unpaid items: who carries them, did they leave the shop? (5 Hz) */
function scan(game: Game, now: number) {
  const byShop = new Map<string, Ent[]>();
  game.state.each('item', (e) => { if (e.unpaid && e.shop) { let a = byShop.get(e.shop); if (!a) byShop.set(e.shop, (a = [])); a.push(e); } });
  for (const [sid, items] of byShop) {
    const rt = RT.get(sid);
    if (!rt?.fix) continue;
    const leavers = new Set<Ent>();
    for (const e of items) {
      const c = carrierOf(e);
      const p = itemPos(e);
      if (!p) continue;
      if (c) {
        if (e.buyer !== c.id) e.buyer = c.id;
        e._idle = 0;
        if (!insideShop(rt, p, rt.fix.rect ? 0.4 : 1.0)) leavers.add(c);
        else if (!insideShop(rt, p) && now - (rt.warned.get(c.id) ?? -1e9) > 20) { rt.warned.set(c.id, now); rt.say(pickLine(Lines.WARN_LEAVE, Lines.WARN_LEAVE)); }
      } else {
        // lying around: outside the shop → the keeper takes it back; inside & forgotten → put back
        e._idle = (e._idle ?? 0) + 0.2;
        if (!insideShop(rt, p, 1.5)) { returnItem(rt, e, true); rt.say(pickLine(Lines.DROPPED, Lines.DROPPED)); }
        else if (e._idle > 75) returnItem(rt, e, true);
      }
    }
    for (const pl of leavers) {
      if (rt.session?.kind === 'mad' && rt.session.pid === pl.id) continue;
      if (isBanned(rt, pl.id)) { snapBackAll(rt, pl, true); continue; }
      startMad(rt, pl, 'leave');
    }
  }
  // 8-Twelve door chime (+ greeting) when someone walks in or out
  for (const rt of RT.values()) {
    if (!rt.fix?.door) continue;
    for (const pl of game.players()) {
      if (!pl.p) continue;
      const inside = insideShop(rt, pl.p);
      const was = rt.inside.get(pl.id);
      if (was !== undefined && was !== inside) {
        game.emit('shop:chime', { p: rt.fix.door });
        if (rt.def.kind === 'store' && rt.ent.open) rt.say(inside ? Lines.DOOR_IN : Lines.DOOR_OUT);
      }
      rt.inside.set(pl.id, inside);
    }
  }
}

/** HOST: a new day — restock everything, forgive bans, reset deals. */
export function newDay(game: Game) {
  for (const rt of RT.values()) {
    if (!rt.fix || rt.ent.id < 0) continue;
    clearDisplays(rt);
    restock(rt);
    rt.ent.ban = {}; rt.ent.deal = {}; rt.ent.dealt = {}; rt.ent.mood = 0; rt.ent.robo = 0; rt.ent.bar = null;
    rt.session = null; rt.queue = []; rt.chase = null; rt.avail.clear();
    rt.ent.open = false;
    rt.slotItem = rt.slotItem.map(() => null);
  }
  hostTick(game, 0, true);
}

// ------------------------------------------------------------------ intents

export function installIntents(game: Game) {
  G = game;
  const near = (rt: ShopRT, pl: Ent, max = 4.2) => {
    if (!pl.p) return false;
    if (rt.keeper?.p && dist2D(pl.p, rt.keeper.p) <= max) return true;
    return !!rt.fix && insideShop(rt, pl.p) && (!rt.keeper?.p || dist2D(pl.p, rt.keeper.p) <= max + 2);
  };
  const withShop = (fn: (rt: ShopRT, pl: Ent, d: any) => void) => (pl: Ent, d: any) => {
    const rt = RT.get(d?.sid);
    if (!rt?.fix || !rt.keeper) return;
    if (!near(rt, pl)) return;
    rt.now = realNow();
    fn(rt, pl, d);
  };
  game.onIntent('shop.pay', withShop((rt, pl) => {
    if (isBanned(rt, pl.id)) { rt.say(pickLine(Lines.BANNED, Lines.BANNED), { style: 'shout' }); return; }
    if (rt.session && rt.session.pid !== pl.id) { rt.say(pickLine(Lines.BUSY, Lines.BUSY)); return; }
    if (rt.session?.kind === 'bargain') rt.session = null;
    const k = rt.keeper!;
    if (rt.pers.id === 'robot_clerk') { // beep beep beep… then the total
      const n = unpaidOf(rt.def.id, pl.id).length;
      for (let i = 0; i < Math.min(n, 6); i++) game.sfx(sndKey('shop_scan'), k.p, { vol: 0.6, delay: i * 0.22 } as any);
      later(rt, Math.min(n, 6) * 0.22 + 0.2, () => { const b = billOf(rt, pl); if (b.items.length) rt.say(fill(pickLine(Lines.QUOTE.robot_clerk, Lines.QUOTE._), { p: b.total })); pay(rt, pl, { quiet: true }); later(rt, 1.2, () => rt.say(Lines.THANKS.robot_clerk[0])); });
      return;
    }
    pay(rt, pl);
    endTalk(rt, 2);
  }));
  game.onIntent('shop.bargain', withShop((rt, pl) => { if (isBanned(rt, pl.id)) { rt.say(pickLine(Lines.BANNED, Lines.BANNED)); return; } startBargain(rt, pl); }));
  game.onIntent('shop.credit', withShop((rt, pl) => credit(rt, pl)));
  game.onIntent('shop.repay', withShop((rt, pl) => repay(rt, pl)));
  game.onIntent('shop.talk', withShop((rt, pl) => {
    if (isBanned(rt, pl.id)) { rt.say(pickLine(Lines.BANNED, Lines.BANNED), { style: 'shout' }); return; }
    if (!rt.ent.open) { rt.say(pickLine(Lines.CLOSED[rt.def.kind] ?? Lines.CLOSED._, Lines.CLOSED._)); return; }
    rt.say(fill(pickLine(Lines.TALK[rt.pers.id], Lines.TALK._), { c: rt.pers.callPlayer, n: pl.name }));
    if (rt.keeper) { rt.keeper.lookAt = pl.id; setAnim(game, rt.keeper, 'talk'); }
  }));
  game.onIntent('shop.wake', withShop((rt) => {
    const k = rt.keeper!;
    if (k.face !== 'sleep') return;
    wakeKeeper(game, rt);
    rt.say(pickLine(Lines.WOKE, Lines.WOKE), { style: 'shout' });
    game.sfx(sndKey('shop_whistle'), k.p, { vol: 0.3, pitch: 1.4 });
    if (!rt.ent.open) later(rt, 1.6, () => { rt.say(fill(pickLine(Lines.CLOSED[rt.def.kind] ?? Lines.CLOSED._, Lines.CLOSED._), {})); later(rt, 3, () => { k.kst = 'idle'; rt.idleNext = 0; }); });
  }));
  game.onIntent('shop.pick', (pl, d) => onPick(pl, d));
  game.onIntent('shop.putBack', (pl, d: { id: number }) => {
    const e = game.state.get(d?.id);
    if (!e?.unpaid || !e.shop) return;
    const rt = RT.get(e.shop);
    if (!rt || carrierOf(e)?.id !== pl.id || !pl.p || !insideShop(rt, pl.p, 0.5)) return;
    rt.now = realNow();
    returnItem(rt, e, true);
    if (Math.random() < 0.5) rt.say(pickLine(Lines.PUT_BACK, Lines.PUT_BACK));
  });
  // picking up stock = yours-but-unpaid
  game.events.on('item:picked', (d: { player: number; item: number }) => {
    const e = game.state.get(d.item);
    const pl = game.state.get(d.player);
    if (!e || !pl || !e.shop) return;
    const rt = RT.get(e.shop);
    if (!rt) return;
    rt.now = realNow();
    if (e.disp) {
      if (isBanned(rt, pl.id) || !rt.ent.open) { returnItem(rt, e, true); rt.say(pickLine(Lines.BANNED, Lines.BANNED), { style: 'shout' }); return; }
      e.disp = false; e.unpaid = true; e.buyer = pl.id;
      e.data = { ...(e.data ?? {}), unpaid: true, shop: rt.def.id };
      if (e.ss != null && rt.slotItem[e.ss] === e.id) { rt.slotItem[e.ss] = null; rt.refillAt[e.ss] = rt.now + TUNE.refill; }
      if (rt.keeper && rt.keeper.face !== 'sleep') rt.keeper.lookAt = pl.id;
    } else if (e.unpaid) e.buyer = pl.id;
  });
}

// ------------------------------------------------------------------ CLIENT: providers, choices, FX, visuals

export function installClient(game: Game) {
  G = game;
  // the 3-second reply picker on the right client
  game.on('shop:choose', (d: { pid: number; sid: string; token: number; options: TL[]; colors?: number[]; seconds?: number }) => {
    if (d.pid !== game.localPlayerId) return;
    game.ui.choose({ options: d.options, colors: d.colors, seconds: d.seconds ?? 3, onPick: (i) => game.intent('shop.pick', { sid: d.sid, token: d.token, i }) });
  });
  game.on('shop:chime', (d: { p: number[] }) => Sound.play(sndKey('shop_door_chime'), { pos: new THREE.Vector3(d.p[0], d.p[1] + 2.2, d.p[2]), vol: 0.9 }));
  game.on('shop:paid', (d: { at: number[]; store: boolean; total: number }) => {
    const p = d.at ? new THREE.Vector3(d.at[0], d.at[1] + 1, d.at[2]) : undefined;
    Sound.play(d.store ? 'cash_drawer' : 'banknote', { pos: p, vol: 0.8 });
    Sound.play('coin_clink', { pos: p, vol: 0.6, delay: 0.3 });
  });
  game.on('shop:shutter', (d: { sid: string; open: boolean }) => {
    const rt = RT.get(d.sid);
    const sh = rt?.fix?.shutter;
    if (sh) Sound.play(sndKey('shop_shutter'), { pos: sh.obj.getWorldPosition(new THREE.Vector3()), vol: 0.9 });
  });
  game.on('shop:zap', (d: { p: number[] }) => zapFx(game, d.p));
  game.on('shop:fly', (d: { k: string; a: number[]; b: number[] }) => flyFx(game, d));
  game.on('shop:slapped', (d: { pid: number }) => { if (d.pid === game.localPlayerId) shakeCam(game); });

  // providers: keeper / counter / stock / put back
  game.interact.provide((ctx: Ctx) => {
    const hit = ctx.hit;
    const out: Action[] = [];
    if (hit) {
      let sid: string | null = null;
      if (hit.kind === 'shopkeeper') sid = hit.data?.sid ?? hit.ent?.sid ?? null;
      else if (hit.kind === 'npc' && hit.ent?.role?.startsWith?.('shopkeeper:')) sid = hit.ent.sid;
      else if (hit.kind === 'shop_counter') sid = hit.data?.sid ?? null;
      if (sid) { const rt = RT.get(sid); if (rt) out.push(...keeperActions(rt, ctx)); }
      const e = hit.ent;
      if (e?.t === 'item' && e.shop && e.disp) {
        const rt = RT.get(e.shop);
        if (rt && isBanned(rt, ctx.me.id)) out.push({ key: 'E', label: tl('หยิบ', 'take'), disabled: tl('โดนแบนวันนี้', 'banned today'), priority: 4 });
        else if (game.items.freeSlots(ctx.me) >= (game.items.defOf(e)?.slots ?? 1)) out.push({ key: 'E', label: tl(`หยิบ · ${e.price} ฿`, `take · ${e.price} ฿`), priority: 3, run: () => game.intent('item.pickup', { id: e.id }) });
      }
    }
    // holding an unpaid item: put it back on its stall
    const held = ctx.held;
    if (held?.unpaid && held.shop) {
      const rt = RT.get(held.shop);
      const onIt = hit && ((hit.ent?.shop === held.shop) || (hit.kind === 'shopkeeper' && hit.data?.sid === held.shop));
      if (rt && ctx.me.p && insideShop(rt, ctx.me.p) && (onIt || ctx.surface)) out.push({ key: 'LMB', label: tl('วางคืน', 'put back'), priority: 3, run: () => game.intent('shop.putBack', { id: held.id }) });
    }
    return out;
  }, 10);
}

function keeperActions(rt: ShopRT, ctx: Ctx): Action[] {
  const me = ctx.me;
  const out: Action[] = [];
  const k = rt.keeper ?? G.state.get(rt.ent.keeper);
  if (!rt.keeper && k) rt.keeper = k;
  if (isBanned(rt, me.id)) { out.push({ key: 'E', label: tl('ซื้อ', 'buy'), disabled: tl('ไม่ขายให้แล้ววันนี้!', 'banned today!'), priority: 6 }); return out; }
  if (k?.face === 'sleep') out.push({ key: 'E', label: tl(`ปลุก${keeperCall(rt.def)}`, 'wake up'), priority: 6, run: () => G.intent('shop.wake', { sid: rt.def.id }) });
  const b = billOf(rt, me);
  const wallet = me.wallet ?? 0;
  if (b.items.length) {
    if (k?.face !== 'sleep') {
      if (wallet >= b.total) out.push({ key: 'E', label: tl(`จ่าย ${b.total} ฿`, `pay ${b.total} ฿`), priority: 6, run: () => G.intent('shop.pay', { sid: rt.def.id }) });
      else out.push({ key: 'E', label: tl(`จ่าย ${b.total} ฿`, `pay ${b.total} ฿`), disabled: tl(`เงินไม่พอ (มี ${wallet} ฿)`, `not enough (${wallet} ฿)`), priority: 6 });
      if (!rt.ent.dealt?.[me.id]) out.push({ key: 'R', label: tl('ต่อราคา', 'haggle'), priority: 6, run: () => G.intent('shop.bargain', { sid: rt.def.id }) });
      if (creditAllowed(rt) && wallet < b.total) out.push({ key: 'F', label: Lines.CREDIT_ASK, priority: 6, run: () => G.intent('shop.credit', { sid: rt.def.id }) });
    }
  } else if (rt.def.debtKey && (G.g.debt?.[rt.def.debtKey] ?? 0) > 0) {
    const d = G.g.debt[rt.def.debtKey];
    out.push(wallet > 0 ? { key: 'E', label: tl(`คืนเงินป้า ${Math.min(d, wallet)} ฿ (ติดอยู่ ${d})`, `repay ${Math.min(d, wallet)} ฿`), priority: 6, run: () => G.intent('shop.repay', { sid: rt.def.id }) }
      : { key: 'E', label: tl(`ติดป้าอยู่ ${d} ฿`, `you owe ${d} ฿`), disabled: tl('ไม่มีตังค์', 'broke'), priority: 6 });
  } else if (k?.face !== 'sleep') out.push({ key: 'E', label: tl('คุย', 'talk'), priority: 5, run: () => G.intent('shop.talk', { sid: rt.def.id }) });
  return out;
}

// ------------------------------------------------------------------ client visuals

let visAcc = 1;
const tagViews = new Map<number, { g: THREE.Group; price: number; ang: number; vel: number; last: THREE.Vector3 | null }>();
const calcs = new Map<string, { mesh: THREE.Mesh; text: string }>();

/** World scene left: drop local caches (meshes lived in the old scene). */
export function clearClient() {
  for (const t of tagViews.values()) t.g.removeFromParent();
  tagViews.clear();
  for (const c of calcs.values()) c.mesh.removeFromParent();
  calcs.clear();
  for (const rt of RT.values()) rt.fix?.root.removeFromParent();
}

export function clientFrame(game: Game, dt: number) {
  G = game;
  keeperFrame(game, dt);
  visAcc += Math.max(dt, 0.05);
  for (const rt of RT.values()) {
    if (!rt.fix) continue;
    if (rt.ent.id < 0 || !game.state.get(rt.ent.id)) linkClient(rt);
    // shutters / stall tarp follow the replicated open state
    const closed = rt.ent.id >= 0 && !rt.ent.open;
    if (rt.fix.shutter) { const sh = rt.fix.shutter; const want = closed ? 1 : 0; const k = sh.k + Math.sign(want - sh.k) * Math.min(Math.abs(want - sh.k), dt * 0.55); setShutter(game, rt.fix, k); }
    if (rt.fix.tarp) rt.fix.tarp.visible = closed;
    // closed sign: "not open yet today" vs. "locked until day N" (funny reasons)
    const sign = rt.fix.closedSign;
    if (sign && rt.ent.id >= 0) {
      const mode = rt.ent.unlocked === false && rt.def.lockedNote ? 'locked' : 'closed';
      if (sign.userData.mode !== mode) {
        sign.userData.mode = mode;
        const note = mode === 'locked' ? rt.def.lockedNote! : (rt.def.closedNote ?? tl('ปิด', 'closed'));
        (sign.material as THREE.MeshStandardMaterial).map = signTex('closed:' + note.th, [{ text: note.th, size: 72, color: '#b11414' }, ...(note.en ? [{ text: note.en, size: 30, color: '#333', font: F.hand }] : [])], 'card_board', 640, 400);
        (sign.material as THREE.MeshStandardMaterial).needsUpdate = true;
      }
    }
    // bargaining calculator (diegetic price display in front of the keeper)
    calcFrame(game, rt);
  }
  if (visAcc > 0.5) { visAcc = 0; updateCards(game); cull(game); }
  tagFrame(game, dt);
}

/** Cheap LOD: hide far fixtures and far display stock (client-local visuals only). */
function cull(game: Game) {
  const cam = game.camera?.getWorldPosition(new THREE.Vector3());
  if (!cam) return;
  for (const rt of RT.values()) {
    if (!rt.fix) continue;
    const c = rt.fix.center;
    const d = Math.hypot(c[0] - cam.x, c[2] - cam.z);
    rt.fix.root.visible = d < 55 + rt.fix.radius;
  }
  game.state.each('item', (e) => {
    if (!e.disp || !e.p) return;
    const obj = game.views.objectOf(e.id);
    const vis = obj?.children[0];
    if (!vis) return;
    vis.visible = Math.hypot(e.p[0] - cam.x, e.p[2] - cam.z) < 32;
    // small goods on display don't need to cast shadows (saves a shadow-pass draw per mesh)
    if (!vis.userData.noShadow) { vis.userData.noShadow = true; vis.traverse((m: any) => { if (m.isMesh) m.castShadow = false; }); }
  });
}

function updateCards(game: Game) {
  const shown = new Map<string, number>();
  game.state.each('item', (e) => { if (e.disp && e.shop) { const k = e.shop + ':' + e.sk; shown.set(k, (shown.get(k) ?? 0) + 1); } });
  for (const rt of RT.values()) {
    if (!rt.fix || !rt.fix.root.visible) continue;
    for (const st of rt.def.stock) {
      const avail = stockAvailable(rt, st);
      const visible = avail && (!!rt.ent.open || rt.def.kind === 'store');
      const sold = (rt.ent.left?.[st.id] ?? 1) <= 0 && !shown.get(rt.def.id + ':' + st.id);
      const name = st.label?.th ?? game.items.def(rt.kinds.get(st.id)!)?.name.th ?? st.id;
      updateCard(rt.fix, st, name, st.price, sold, !visible);
    }
  }
}

function calcFrame(game: Game, rt: ShopRT) {
  const bar = rt.ent.bar;
  let c = calcs.get(rt.def.id);
  const k = rt.keeper ?? game.state.get(rt.ent.keeper);
  if (!bar || !k?.p) { if (c) c.mesh.visible = false; return; }
  if (!c) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.3), canvasMat(calcTex('0')));
    mesh.renderOrder = 5;
    game.scene!.add(mesh);
    c = { mesh, text: '' };
    calcs.set(rt.def.id, c);
  }
  const text = String(bar.price);
  if (c.text !== text) { c.text = text; (c.mesh.material as THREE.MeshStandardMaterial).map = calcTex(text); (c.mesh.material as THREE.MeshStandardMaterial).needsUpdate = true; Sound.play(sndKey('shop_calc'), { pos: c.mesh.position, vol: 0.5 }); }
  const yaw = k.yaw ?? 0;
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  c.mesh.visible = true;
  c.mesh.position.set(k.p[0] + fwd.x * 0.42, k.p[1] + 1.32 + Math.sin(performance.now() / 300) * 0.01, k.p[2] + fwd.z * 0.42);
  c.mesh.rotation.set(-0.25, yaw + Math.PI, 0, 'YXZ');
}

/** Dangling price tags on carried unpaid items (all peers, also in the first-person view). */
function tagFrame(game: Game, dt: number) {
  const live = new Set<number>();
  game.state.each('item', (e) => {
    if (!e.unpaid || !e.shop) return;
    const obj = game.views.objectOf(e.id);
    if (!obj) return;
    live.add(e.id);
    let t = tagViews.get(e.id);
    const price = e.price ?? 0;
    if (!t || t.price !== price || t.g.parent !== obj) {
      t?.g.removeFromParent();
      const g = new THREE.Group();
      g.name = 'shop-tag';
      const box = new THREE.Box3().setFromObject(obj.children[0] ?? obj);
      const size = box.getSize(new THREE.Vector3());
      const top = obj.children[0] ? Math.max(0.05, size.y) : 0.15;
      g.position.set(Math.min(0.12, size.x * 0.4), top, 0);
      const str = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 0.07, 3).translate(0, -0.035, 0), new THREE.MeshBasicMaterial({ color: 0xd8c8a0 }));
      const card = new THREE.Mesh(new THREE.PlaneGeometry(0.055, 0.088).translate(0, -0.11, 0), canvasMat(hangTagTex(price), { alpha: true }));
      card.raycast = () => {}; str.raycast = () => {};
      g.add(str, card);
      obj.add(g);
      t = { g, price, ang: 0, vel: 0, last: null };
      tagViews.set(e.id, t);
    }
    // pendulum from the holder's motion
    const wp = t.g.getWorldPosition(new THREE.Vector3());
    if (t.last) { const v = wp.clone().sub(t.last); t.vel += (v.x + v.z) * 9; }
    t.last = wp;
    t.vel += (-t.ang * 40 - t.vel * 3.5) * dt;
    t.ang += t.vel * dt;
    t.g.rotation.z = Math.max(-1.1, Math.min(1.1, t.ang));
  });
  for (const [id, t] of tagViews) if (!live.has(id)) { t.g.removeFromParent(); tagViews.delete(id); }
}

const zapGeo = new THREE.IcosahedronGeometry(0.06, 0);
function zapFx(game: Game, p: number[]) {
  if (!game.scene) return;
  const pos = new THREE.Vector3(p[0], p[1], p[2]);
  Sound.play(sndKey('shop_zap'), { pos, vol: 0.7 });
  // additive flash (no lights: adding a light would recompile every shader)
  const spark = new THREE.Mesh(zapGeo, new THREE.MeshBasicMaterial({ color: 0xbfeaff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  spark.position.copy(pos);
  game.scene.add(spark);
  let t = 0;
  const off = game.engine.onFrame((f) => {
    t += f.rawDt;
    spark.scale.setScalar(1 + t * 10 + Math.random() * 2);
    (spark.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t / 0.25) * (Math.random() > 0.3 ? 1 : 0.3);
    if (t > 0.25) { spark.removeFromParent(); (spark.material as THREE.Material).dispose(); off(); }
  });
}

function flyFx(game: Game, d: { k: string; a: number[]; b: number[] }) {
  if (!game.scene) return;
  const def = game.items.def(d.k);
  let obj: THREE.Object3D;
  try { obj = def ? def.build({ id: -1, t: 'item', k: d.k, data: def.data?.() ?? {} } as Ent, game) : new THREE.Group(); } catch { obj = new THREE.Group(); }
  game.scene.add(obj);
  const a = new THREE.Vector3(...(d.a as [number, number, number])), b = new THREE.Vector3(...(d.b as [number, number, number]));
  Sound.play('whoosh_swing', { pos: a, vol: 0.6 });
  let t = 0;
  const dur = 0.6;
  const off = game.engine.onFrame((f) => {
    t += f.dt;
    const k = Math.min(1, t / dur);
    const p = a.clone().lerp(b, k);
    p.y += Math.sin(k * Math.PI) * (1.2 + a.distanceTo(b) * 0.15);
    obj.position.copy(p);
    obj.rotation.set(k * 9, k * 6, 0);
    if (k >= 1) { obj.removeFromParent(); off(); Sound.play('drop_soft', { pos: b, vol: 0.4 }); }
  });
}

function shakeCam(game: Game) {
  let t = 0;
  const off = game.engine.onLate?.(() => {
    t += 1 / 60;
    const k = Math.max(0, 1 - t / 0.45);
    game.camera.rotation.z += Math.sin(t * 70) * 0.04 * k;
    game.camera.position.x += Math.sin(t * 53) * 0.03 * k;
    if (t > 0.45) off?.();
  });
}
