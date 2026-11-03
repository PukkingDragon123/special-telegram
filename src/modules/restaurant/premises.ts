import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { tl, round, clamp, params, type TL } from '../../core/util';
import { yawTo } from '../../game/mapplan';
import { CLOSED_HOUSE, SW_H, RESTAURANT_UNITS } from '../world/layout';
import { Dialogues, Quests, unlockRecipe, questApi, type DlgCtx, type TalkTarget, type DlgNode } from '../quests/api';

/* =============================================================================================
 * PREMISES — from the street cart to a REAL shophouse restaurant ("ร้านเฮียผัด อาหารตามสั่ง").
 *
 *  g.restaurant = { stage 0 cart | 1 shophouse | 2 expanded, rented, opened, shutter[2], rentDue,
 *                   paidUntil, overdue, padlock, upgrades[], haggle, servedInside }   (saved with g)
 *
 *  main quest chain (quests module runtime; the logic below works without it):
 *    rest_savings  "เก็บเงินเปิดร้านจริง"  party ≥ 3,000 ฿ OR day ≥ 4 OR ★ ≥ 3.5 → เจ๊ลำไย shows up
 *    rest_rent     talk to the landlord: haggle, read the (stupid) contract, sign, pay the deposit
 *    rest_open     pull the rusty shutter up (grand opening: rat na unlocked) → serve 3 customers inside
 *  rent is collected every morning; unpaid → she comes back angry; 4 days late → padlock on the shutter.
 *  upgrades (bought from her): air-con, TV, LED sign, the unit next door (stage 2).
 *
 *  serviceFrame(): the "service point" customers queue at / order at / price against — the open
 *  restaurant once it exists, the cart otherwise (customers.ts, menuposter.ts, shops delivery).
 * ============================================================================================= */

// ------------------------------------------------------------------ tunables (one table)

export const RENT = {
  deposit: 3000,
  rentPerDay: 150,
  /** qualification for เจ๊ลำไย to offer the unit (any one) */
  qualifyMoney: 3000, qualifyDay: 4, qualifyRep: 3.5,
  /** haggling: each successful round knocks this much off the deposit (third round = she gets mad) */
  haggleOff: [200, 100],
  /** days of unpaid rent before she padlocks the shutter */
  padlockDays: 4,
  /** indoors vs the street cart */
  indoorPriceFactor: 1.25, indoorPatience: 1.1, indoorCapacity: 6,
  /** customers needed inside to finish the grand-opening quest */
  openServe: 3,
  landlordHours: [7.0, 20.5] as [number, number],
  upgrades: {
    aircon: { price: 4500, th: 'ติดแอร์', en: 'air-con', patience: 1.25, tip: 1.2, pf: 0.1, spawn: 1.05, capacity: 0, rentAdd: 30 },
    tv: { price: 2500, th: 'ทีวีจอแบน', en: 'flat TV', patience: 1.15, tip: 1.05, pf: 0, spawn: 1.0, capacity: 0, rentAdd: 0 },
    led: { price: 1200, th: 'ป้ายไฟ LED วิ่ง', en: 'LED sign', patience: 1.0, tip: 1.0, pf: 0, spawn: 1.15, capacity: 0, rentAdd: 0 },
    expand: { price: 4000, th: 'เช่าห้องข้างๆ เพิ่ม', en: 'rent the unit next door', patience: 1.0, tip: 1.0, pf: 0.05, spawn: 1.15, capacity: 6, rentAdd: 120 },
  } as Record<string, { price: number; th: string; en: string; patience: number; tip: number; pf: number; spawn: number; capacity: number; rentAdd: number }>,
};
export type UpgradeId = keyof typeof RENT.upgrades;

// ------------------------------------------------------------------ geometry of the two units

/** world-space description of a restaurant unit (front faces west at x = CLOSED_HOUSE.x0) */
export interface UnitGeo { i: number; a0: number; a1: number; W: number; frontX: number; depth: number }
export const DEPTH = 9.0;
export const UNITS: UnitGeo[] = RESTAURANT_UNITS.map((a0, i) => ({ i, a0, a1: a0 + 4.83, W: 4.83, frontX: CLOSED_HOUSE.x0, depth: DEPTH }));

/** unit space (x along the facade, y up, z outward: interior is z < 0) → world */
export function unitToWorld(u: UnitGeo, x: number, y: number, z: number): [number, number, number] {
  return [u.frontX - z, y, u.a0 + x];
}
export function inUnit(u: UnitGeo, p: ArrayLike<number>, pad = 0) {
  return p[0] >= u.frontX - pad && p[0] <= u.frontX + u.depth + pad && p[2] >= u.a0 - pad && p[2] <= u.a1 + pad;
}

// ------------------------------------------------------------------ state

export interface RestState {
  stage: number; rented: boolean; rentedDay: number; opened: boolean; shutter: number[];
  rentDue: number; paidUntil: number; overdue: number; padlock: boolean; upgrades: string[];
  haggle: number; servedInside: number; flattered: number; begged: number; grandDay: number;
}
const DEF: RestState = { stage: 0, rented: false, rentedDay: 0, opened: false, shutter: [0, 0], rentDue: 0, paidUntil: 0, overdue: 0, padlock: false, upgrades: [], haggle: 0, servedInside: 0, flattered: 0, begged: 0, grandDay: 0 };

let G: Game;
export function bindPremises(game: Game) { G = game; }

export function rs(game: Game = G): RestState { return { ...DEF, ...(game.g.restaurant ?? {}) }; }
/** HOST: patch the replicated state (always a fresh object so the diff sees it) */
export function setRS(game: Game, patch: Partial<RestState>) { game.g.restaurant = { ...rs(game), ...patch }; }

export const hasUp = (game: Game, id: string) => rs(game).upgrades.includes(id);
export function rentPerDay(game: Game) {
  let r = RENT.rentPerDay;
  for (const u of rs(game).upgrades) r += RENT.upgrades[u]?.rentAdd ?? 0;
  return r;
}
export function depositNow(game: Game) {
  const h = rs(game).haggle;
  let d = RENT.deposit;
  for (let i = 0; i < Math.min(h, RENT.haggleOff.length); i++) d -= RENT.haggleOff[i];
  return d;
}
/** is the shophouse the service point right now? */
export function shopActive(game: Game = G) {
  const s = rs(game);
  return s.rented && !s.padlock && (s.shutter[0] ?? 0) > 0;
}
/** combined effect of the upgrades + being indoors */
export function restMods(game: Game = G) {
  const s = rs(game);
  const m = { patience: 1, tip: 1, pf: 1, spawn: 1, capacity: 0, active: shopActive(game) };
  if (!m.active) return m;
  m.patience = RENT.indoorPatience; m.pf = RENT.indoorPriceFactor; m.capacity = RENT.indoorCapacity;
  for (const id of s.upgrades) {
    const u = RENT.upgrades[id];
    if (!u) continue;
    if (id === 'expand' && !(s.shutter[1] > 0)) continue;
    m.patience *= u.patience; m.tip *= u.tip; m.pf += u.pf; m.spawn *= u.spawn; m.capacity += u.capacity;
  }
  // the LED sign only pulls people in after dark
  if (s.upgrades.includes('led') && game.clock.time < 18.3) m.spawn /= RENT.upgrades.led.spawn;
  return m;
}

export const partyMoney = (game: Game) => game.players().reduce((a, p) => a + Math.max(0, p.wallet ?? 0), 0);

/** HOST: everyone chips in (proportional to their wallets). false (nothing charged) if the party can't afford it. */
export function chargeParty(game: Game, amount: number, reason: string, at?: ArrayLike<number> | null): boolean {
  const pl = game.players().filter((p) => (p.wallet ?? 0) > 0);
  const total = pl.reduce((a, p) => a + p.wallet, 0);
  if (amount <= 0) return true;
  if (total < amount) return false;
  let left = amount;
  pl.sort((a, b) => b.wallet - a.wallet);
  pl.forEach((p, i) => {
    const share = i === pl.length - 1 ? left : Math.min(p.wallet, Math.round((amount * p.wallet) / total));
    const s = Math.min(share, left, p.wallet);
    if (s > 0) { game.money(p.id, -s, reason, at ?? null); left -= s; }
  });
  if (left > 0) for (const p of pl) { const s = Math.min(left, p.wallet); if (s > 0) { game.money(p.id, -s, reason, at ?? null); left -= s; } }
  return left <= 0;
}

export function qualifies(game: Game = G) {
  const g = game.g;
  if (g.introStep && g.introStep !== 'done') return false;
  if (rs(game).rented) return true;
  return partyMoney(game) >= RENT.qualifyMoney || (g.day ?? 1) >= RENT.qualifyDay || (g.reputation ?? 3) >= RENT.qualifyRep;
}

function newsEvent(game: Game, th: string) {
  const ds = game.g.dayStats;
  if (!ds) return;
  game.g.dayStats = { ...ds, events: [...(ds.events ?? []), th].slice(-8) };
}

// ------------------------------------------------------------------ service frame

export interface SvcFrame {
  mode: 'cart' | 'shop';
  p: number[]; yaw: number;
  w: (lx: number, lz: number) => number[];
  queueSpot: (i: number) => number[];
  queueFace: number;
  waitSpot: (k: number) => number[];
  waitFace: number;
  /** somebody has to stand this close to take orders */
  orderRadius: number;
  /** zone price factor × indoor / upgrades */
  priceFactor: number;
  zone: any;
}

function cartBase(game: Game) {
  const c = game.state.find('cart', () => true);
  const a = game.world?.anchor('cart_start');
  const p = c?.p ?? a?.p ?? [4.9, 0.15, -23];
  const yaw = c?.yaw ?? a?.yaw ?? Math.PI / 2;
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  return { p, yaw, w: (lx: number, lz: number) => [p[0] + lx * cs + lz * sn, p[1], p[2] - lx * sn + lz * cs] as number[] };
}

/** where customers queue, order, wait and compare prices: the open shophouse, else the cart */
export function serviceFrame(game: Game = G): SvcFrame {
  if (shopActive(game)) {
    const u = UNITS[0];
    const p = unitToWorld(u, 2.35, SW_H, -1.35) as number[];
    const yaw = Math.PI / 2;
    const zone = game.world?.zoneAt(p);
    const m = restMods(game);
    return {
      mode: 'shop', p, yaw,
      w: (lx, lz) => [p[0] + lz, p[1], p[2] - lx],
      queueSpot: (i) => [u.frontX - 0.75, SW_H, p[2] - 0.15 - 0.72 * i],
      queueFace: yawTo(1, 0),
      waitSpot: (k) => unitToWorld(u, u.W - 0.55 - 0.55 * Math.floor(k / 5), SW_H, -0.85 - 0.62 * (k % 5)) as number[],
      waitFace: yawTo(-0.4, -1),
      orderRadius: 9,
      priceFactor: (zone?.priceFactor ?? 1) * m.pf,
      zone,
    };
  }
  const cf = cartBase(game);
  const zone = game.world?.zoneAt(cf.p);
  return {
    mode: 'cart', p: cf.p, yaw: cf.yaw, w: cf.w,
    queueSpot: (i) => cf.w(0.05 + 0.78 * i, -1.0 - (i > 0 ? 0.1 : 0)),
    queueFace: cf.yaw + Math.PI,
    waitSpot: (k) => cf.w(-1.75 - 0.5 * Math.floor(k / 3), -0.55 - 0.62 * (k % 3)),
    waitFace: cf.yaw + Math.PI * 0.75,
    orderRadius: 7,
    priceFactor: zone?.priceFactor ?? 1,
    zone,
  };
}

/** where big deliveries (furniture, gas) are dropped: inside the open restaurant, else next to the cart */
export function deliverySpot(game: Game = G): number[] {
  if (shopActive(game)) return unitToWorld(UNITS[0], 1.0, SW_H + 0.02, -2.2) as number[];
  const cf = cartBase(game);
  return cf.w(-2.3, 1.2);
}

/** a customer sitting inside one of the open units (for the "serve 3 inside" quest + stats) */
export function isInside(p: ArrayLike<number>, game: Game = G) {
  const s = rs(game);
  if (!s.rented) return false;
  return inUnit(UNITS[0], p) || (s.shutter[1] > 0 && inUnit(UNITS[1], p));
}

// ------------------------------------------------------------------ landlord (host)

export const LANDLORD_NAME: TL = { th: 'เจ๊ลำไย', en: 'Jeh Lamyai (landlord)' };
const landlordSpot = () => { const u = UNITS[0]; return [u.frontX - 1.0, SW_H, u.a0 - 1.3]; };
export const landlord = (game: Game = G) => game.state.find('npc', (e) => e.role === 'landlord');

function anim(game: Game, e: Ent, a: string, loop = false) { e.anim = a; e.animLoop = loop; e.animT = (game.g.time ?? 0) + Math.random() * 1e-3; }

function landlordHost(game: Game, dt: number) {
  const s = rs(game);
  const t = game.clock.time;
  const want = (qualifies(game) || s.rented) && t >= RENT.landlordHours[0] && t <= RENT.landlordHours[1];
  let e = landlord(game);
  if (want && !e) {
    const look = game.chars.randomLook('housewife', 4242);
    (look as any).acc = [...new Set([...((look as any).acc ?? []), 'gold_chain', 'watch_casio'])];
    (look as any).height = 1.56;
    const sp = landlordSpot();
    e = game.state.spawn('npc', {
      role: 'landlord', name: LANDLORD_NAME, look, p: sp, yaw: yawTo(-1, 0.25), anim: 'count_coins', animT: 0, animLoop: true,
      face: s.overdue > 0 ? 'shock' : 'neutral', lookAt: null, hold: null, posture: 'stand',
    });
    e._t = 0;
    if (!s.rented) game.say(e.id, tl('ห้องว่างจ้า ห้องว่าง! ใครอยากเปิดร้านจริงๆ มาคุยกับเจ๊', 'unit for rent! want a real shop? talk to me'), { duration: 4, voice: 1.3 });
  } else if (!want && e) {
    game.state.despawn(e);
    return;
  }
  if (!e) return;
  e._t = (e._t ?? 0) + dt;
  // idle loop: count money, fan herself, glare at the players' cart
  if (e._t > 9 + (e.id % 5)) {
    e._t = 0;
    const r = Math.random();
    anim(game, e, s.overdue > 0 ? 'angry' : r < 0.4 ? 'count_coins' : r < 0.7 ? 'talk' : 'idle', true);
    e.lookAt = game.nearestPlayer(e.p!, 6)?.id ?? null;
  }
}

// ------------------------------------------------------------------ host intents

function sayLL(game: Game, th: string, en: string, o: any = {}) { const e = landlord(game); if (e) game.say(e.id, tl(th, en), { duration: 3.5, voice: 1.3, ...o }); }

export function installPremisesIntents(game: Game) {
  game.onIntent('rest.haggle', (pl) => {
    const s = rs(game);
    if (s.rented) return;
    setRS(game, { haggle: s.haggle + 1 });
    const e = landlord(game);
    if (e) anim(game, e, s.haggle >= RENT.haggleOff.length ? 'angry' : 'shrug');
    void pl;
  });
  game.onIntent('rest.rent', (pl) => {
    const s = rs(game);
    if (s.rented || !qualifies(game)) return;
    const dep = depositNow(game);
    const e = landlord(game);
    if (!chargeParty(game, dep, 'deposit', e?.p ? [e.p[0], e.p[1] + 1.9, e.p[2]] : null)) {
      sayLL(game, 'เงินไม่ครบ! เจ๊ไม่รับผ่อนนะ', "that's not enough! no instalments");
      return;
    }
    const day = game.g.day ?? 1;
    setRS(game, { rented: true, stage: Math.max(1, s.stage), rentedDay: day, paidUntil: day, rentDue: 0, overdue: 0 });
    game.sfx('paper_rustle', e?.p ?? pl.p, { vol: 0.8 });
    game.sfx('cash_drawer', e?.p ?? pl.p, { vol: 0.7, delay: 0.4 });
    newsEvent(game, `ร้านรถเข็นเฮียผัดเซ็นสัญญาเช่าห้องแถวกับเจ๊ลำไย มัดจำ ${dep.toLocaleString()} บาท`);
    if (e) anim(game, e, 'give');
    game.emit('rest:rented', { by: pl.id });
  });
  game.onIntent('rest.shutter', (pl, d: { unit: number; open: boolean }) => {
    const s = rs(game);
    const i = d.unit === 1 ? 1 : 0;
    if (!s.rented || (i === 1 && !s.upgrades.includes('expand'))) return;
    if (s.padlock && d.open) { game.say(pl.id, tl('ล็อคกุญแจ! เจ๊ลำไยล่ามโซ่ไว้ ต้องจ่ายค่าเช่าก่อน', 'padlocked! pay the rent first'), { duration: 3 }); return; }
    const sh = [...s.shutter];
    sh[i] = d.open ? 1 : 0;
    const first = d.open && i === 0 && !s.opened;
    setRS(game, { shutter: sh, ...(first ? { opened: true, grandDay: game.g.day ?? 1 } : {}) });
    const u = UNITS[i];
    game.sfx('chain_rattle', unitToWorld(u, u.W / 2, 2.5, 0), { vol: 0.9 });
    if (first) grandOpening(game);
  });
  game.onIntent('rest.payRent', (pl) => {
    const s = rs(game);
    if (s.rentDue <= 0) return;
    const e = landlord(game);
    if (!chargeParty(game, s.rentDue, 'rent', e?.p ? [e.p[0], e.p[1] + 1.9, e.p[2]] : null)) { sayLL(game, 'ไม่พอก็ไปหามา! ขายกะเพราเพิ่มสิ', 'not enough — go sell more kaphrao!'); return; }
    setRS(game, { rentDue: 0, overdue: 0, padlock: false, paidUntil: game.g.day ?? 1 });
    game.sfx('cash_drawer', e?.p ?? pl.p, { vol: 0.7 });
    if (s.padlock) game.sfx('chain_rattle', unitToWorld(UNITS[0], 2.4, 1.0, 0), { vol: 0.7 });
    if (e) { anim(game, e, 'count_coins', true); e.face = 'neutral'; }
  });
  game.onIntent('rest.upgrade', (pl, d: { id: string }) => {
    const s = rs(game);
    const u = RENT.upgrades[d.id];
    if (!u || !s.rented || s.upgrades.includes(d.id)) return;
    const e = landlord(game);
    if (!chargeParty(game, u.price, 'upgrade:' + d.id, e?.p ? [e.p[0], e.p[1] + 1.9, e.p[2]] : null)) { sayLL(game, 'เงินไม่พอจ้า ฝันไปก่อน', 'not enough, keep dreaming'); return; }
    const patch: Partial<RestState> = { upgrades: [...s.upgrades, d.id] };
    if (d.id === 'expand') { patch.stage = 2; }
    setRS(game, patch);
    game.sfx('tada', pl.p, { vol: 0.6 });
    newsEvent(game, d.id === 'aircon' ? 'ร้านเฮียผัดติดแอร์แล้ว ลูกค้านั่งตากแอร์จนลืมกลับบ้าน'
      : d.id === 'tv' ? 'ร้านเฮียผัดติดทีวีจอแบน ลุงๆ มานั่งดูบอลสั่งกะเพราคนละสามจาน'
      : d.id === 'led' ? 'ป้ายไฟวิ่งร้านเฮียผัดสว่างจนเครื่องบินบินวน'
      : 'ร้านเฮียผัดขยายสาขา (ไปห้องข้างๆ) ทุบผนังโชว์กลางซอย');
    game.emit('rest:upgrade', { id: d.id, by: pl.id });
  });
  game.onIntent('rest.flatter', () => {
    const s = rs(game);
    setRS(game, { flattered: s.flattered + 1, ...(s.rentDue > 20 && s.flattered < 1 ? { rentDue: s.rentDue - 20 } : {}) });
  });
  game.onIntent('rest.beg', () => {
    const s = rs(game);
    setRS(game, { begged: s.begged + 1, ...(s.begged < 1 && s.overdue > 0 ? { overdue: Math.max(0, s.overdue - 1) } : {}) });
  });
}

/** HOST: first time the shutter goes up */
function grandOpening(game: Game) {
  unlockRecipe(game, 'rat_na', 'restaurant');
  newsEvent(game, 'เปิดแล้ว! ร้านเฮียผัด อาหารตามสั่ง ห้องแถวกลางซอย เมนูใหม่ ราดหน้าหมู');
  game.g.reputation = round(clamp((game.g.reputation ?? 3) + 0.15, 0, 5), 3);
  game.emit('rest:grand', {});
  sayLL(game, 'เปิดร้านแล้วอย่าลืมจ่ายค่าเช่านะ! ทุกเช้า วันละ ' + rentPerDay(game) + ' บาท', `don't forget the rent! every morning, ${rentPerDay(game)} baht`);
}

/** HOST, every morning */
export function premisesNewDay(game: Game, day: number) {
  const s = rs(game);
  if (!s.rented || s.paidUntil >= day) return;
  const due = s.rentDue + rentPerDay(game);
  // auto-collected first thing in the morning — if the party can't pay, she comes back angry
  if (chargeParty(game, due, 'rent')) {
    setRS(game, { rentDue: 0, overdue: 0, padlock: false, paidUntil: day });
    newsEvent(game, `จ่ายค่าเช่าเจ๊ลำไย ${due} บาท ตรงเวลา (เจ๊ยิ้มครั้งแรกในรอบปี)`);
    return;
  }
  const overdue = s.overdue + 1;
  const padlock = overdue >= RENT.padlockDays;
  setRS(game, { rentDue: due, overdue, padlock, ...(padlock ? { shutter: [0, 0] } : {}) });
  newsEvent(game, padlock ? 'เจ๊ลำไยล่ามโซ่ร้านเฮียผัด! ค้างค่าเช่า ' + due + ' บาท' : 'เจ๊ลำไยทวงค่าเช่าเสียงดังสามซอย ร้านเฮียผัดค้าง ' + due + ' บาท');
}

// ------------------------------------------------------------------ dialogue + quests (quests runtime)

const T = (th: string, en: string): TL => ({ th, en });
const lockMoney = (n: number) => (c: DlgCtx) => (partyMoney(c.game) < n ? `ต้องมีเงินรวม ${n.toLocaleString()} ฿` : null);

const LANDLORD_NODES: DlgNode[] = [
  {
    id: 'hello', anim: 'talk',
    say: (c) => T(`อ้าว! พวกลื้อนี่เองที่ขายกะเพราหน้าตึกเจ๊ทุกวัน… ห้องนี้ว่างนะ มัดจำ ${depositNow(c.game).toLocaleString()} ค่าเช่าวันละ ${RENT.rentPerDay} สนใจไหม?`,
      `Oh, it's you lot selling kaphrao in front of my building. This unit's free: ${depositNow(c.game)} deposit, ${RENT.rentPerDay}/day. Interested?`),
    options: [
      { text: T('เช่าเลยครับเจ๊!', "I'll take it!"), next: 'contract', lock: (c) => lockMoney(depositNow(c.game))(c) },
      { text: T('ลดหน่อยได้ไหมเจ๊ คนกันเอง', 'discount? we are family'), next: 'haggle', if: (c) => rs(c.game).haggle <= RENT.haggleOff.length },
      { text: T('ห้องนี้ผีดุไหมครับ?', 'is it haunted?'), next: 'ghost' },
      { text: T('ไว้ก่อนครับ เงินยังไม่พอ', 'later, still broke'), end: true },
    ],
  },
  {
    id: 'haggle', anim: 'shrug',
    do: (c) => c.game.intent('rest.haggle', {}),
    say: (c) => {
      const h = rs(c.game).haggle;
      return h === 0 ? T('ลดให้สองร้อย เพราะหน้าตาดี… แต่ค่าน้ำค่าไฟแยกนะ', "200 off because you're cute… water & power extra")
        : h === 1 ? T('อีกร้อยเดียว! นี่เจ๊ใจดีสุดในสามซอยแล้วนะ', "100 more! I'm the kindest landlady in three sois")
        : T('ลดอีก!? ลื้อจะเอาตึกเจ๊ไปฟรีเลยไหม! ไม่ลดแล้ว!', 'MORE?! you want my building for free?! no more!');
    },
    options: [
      { text: T('งั้นเช่าเลยครับ', 'deal, I rent it'), next: 'contract', lock: (c) => lockMoney(depositNow(c.game))(c) },
      { text: T('ลดอีกนิดนะเจ๊นะ', 'just a tiny bit more?'), next: 'haggle', if: (c) => rs(c.game).haggle < RENT.haggleOff.length + 1 },
      { text: T('ขอคิดดูก่อน', "I'll think about it"), end: true },
    ],
  },
  {
    id: 'ghost', anim: 'think',
    say: T('ผีที่ดุที่สุดในตึกนี้คือเจ๊ตอนเก็บค่าเช่า… ส่วนผีจริงๆ ย้ายไปอยู่ร้านข้างๆ แล้ว เขาคิดค่าเช่าถูกกว่า', 'the scariest ghost here is me on rent day. the real one moved next door, cheaper rent'),
    next: 'hello',
  },
  {
    id: 'contract', anim: 'talk',
    say: T('สัญญาเช่า: ข้อ 1 ห้ามเลี้ยงจระเข้ ข้อ 2 ห้ามทำพิธีเรียกผีในร้าน (คนเช่าเก่าทำ ผีไม่ยอมย้ายออก) ข้อ 3 ค่าเช่าจ่ายทุกเช้า ห้ามเบี้ยว',
      'Contract: 1) no crocodiles 2) no ghost-summoning rituals inside (the last tenant did, the ghost never left) 3) rent every morning, no excuses'),
    options: [
      { text: T('เซ็นเลย! (จ่ายมัดจำ)', 'sign! (pay deposit)'), next: 'signed', lock: (c) => lockMoney(depositNow(c.game))(c), do: (c) => c.game.intent('rest.rent', {}) },
      { text: T('ขออ่านข้อ 4 ก่อน', 'read clause 4 first'), next: 'clause4' },
      { text: T('ไม่เอาแล้ว น่ากลัว', 'nope, scary'), end: true },
    ],
  },
  {
    id: 'clause4', anim: 'count_coins',
    say: T('ข้อ 4: ถ้าร้านดัง เจ๊ขอกินกะเพราฟรีทุกวัน ไข่ดาวไม่สุก', 'Clause 4: if the shop gets famous I eat kaphrao free every day, runny egg'),
    next: 'contract',
  },
  {
    id: 'signed', anim: 'give', face: 'neutral',
    say: T('เอ้า กุญแจ! ม่านเหล็กดึงเองนะ ฝืดหน่อย หยอดน้ำมันด้วย… แล้วอย่าลืมค่าเช่า!', "here's the key! pull the shutter yourself, it's stiff… and don't forget the rent!"),
  },
  {
    id: 'tenant', anim: 'talk',
    say: (c) => {
      const s = rs(c.game);
      return s.rentDue > 0 ? T(`ค่าเช่าค้าง ${s.rentDue} บาทนะจ๊ะ ผู้เช่าคนเก่ง`, `you owe ${s.rentDue} baht, darling`)
        : T('ว่าไงจ๊ะผู้เช่าคนเก่ง ร้านขายดีไหม? อยากได้อะไรเพิ่มบอกเจ๊', 'hello my favourite tenant! business good? want anything?');
    },
    options: [
      { text: (c) => T(`จ่ายค่าเช่า ${rs(c.game).rentDue} บาท`, `pay rent ${rs(c.game).rentDue} ฿`), if: (c) => rs(c.game).rentDue > 0, lock: (c) => lockMoney(rs(c.game).rentDue)(c), do: (c) => c.game.intent('rest.payRent', {}), next: 'paid' },
      { text: T('อยากปรับปรุงร้านครับ', 'I want to upgrade the shop'), next: 'upgrades' },
      { text: T('เจ๊วันนี้สวยจังเลย', 'you look lovely today'), next: 'flatter', do: (c) => c.game.intent('rest.flatter', {}) },
      { text: T('ไปละครับเจ๊', 'bye'), end: true },
    ],
  },
  {
    id: 'overdue', anim: 'angry', face: 'shock',
    say: (c) => {
      const s = rs(c.game);
      return s.padlock ? T(`ค้าง ${s.rentDue} บาท ${s.overdue} วัน! เจ๊ล่ามโซ่แล้ว! จ่ายมาถึงจะไขให้!`, `${s.rentDue} baht, ${s.overdue} days late! padlocked until you pay!`)
        : T(`ค่าเช่าล่ะ!? ${s.rentDue} บาท! เจ๊ไม่ใช่มูลนิธินะ!`, `where's my rent?! ${s.rentDue} baht! I'm not a charity!`);
    },
    options: [
      { text: (c) => T(`จ่ายเลยครับ ${rs(c.game).rentDue} บาท`, `pay ${rs(c.game).rentDue} ฿`), lock: (c) => lockMoney(rs(c.game).rentDue)(c), do: (c) => c.game.intent('rest.payRent', {}), next: 'paid' },
      { text: T('ขอผัดไปพรุ่งนี้ได้ไหมครับ', 'can I pay tomorrow?'), next: 'beg', do: (c) => c.game.intent('rest.beg', {}) },
      { text: T('เจ๊วันนี้สวยจังเลย', 'you look lovely today'), next: 'flatter', do: (c) => c.game.intent('rest.flatter', {}) },
    ],
  },
  { id: 'paid', anim: 'count_coins', say: T('ครบ! นับแล้วนับอีก… โอเค ร้านลื้อยังเป็นของลื้อ', "all there! counted twice… ok, the shop's still yours") },
  {
    id: 'beg', anim: 'shrug',
    say: (c) => (rs(c.game).begged <= 1 ? T('ผัดได้แต่กะเพรา ค่าเช่าผัดไม่ได้! …เอาเถอะ ครั้งเดียวนะ', "you can stir-fry kaphrao, not the rent! …fine, just this once")
      : T('ผัดอีกแล้ว!? ลื้อเป็นร้านอาหารตามสั่งหรือร้านผัดหนี้!', "again?! are you a restaurant or a debt-frying shop?!")),
  },
  {
    id: 'flatter', anim: 'celebrate',
    say: (c) => (rs(c.game).flattered <= 1 ? T('ปากหวานไม่ช่วยอะไรนะ… แต่ลดให้ยี่สิบบาท อิอิ', "sweet talk won't help… but here's 20 off, hehe")
      : T('ชมทุกวันเดี๋ยวเจ๊ขึ้นค่าเช่าเพราะหน้าบาน', 'keep that up and I raise the rent from all the blushing')),
    next: 'tenant',
  },
  {
    id: 'upgrades', anim: 'think',
    say: T('อยากได้อะไรล่ะ? เจ๊มีช่างประจำตึก ติดตั้งให้วันนี้เลย (ราคาเจ๊กำหนดเอง)', 'what do you want? my handyman installs today (my prices)'),
    options: [
      ...(['aircon', 'tv', 'led', 'expand'] as const).map((id) => ({
        text: T(`${RENT.upgrades[id].th} — ${RENT.upgrades[id].price.toLocaleString()} ฿`, `${RENT.upgrades[id].en} — ${RENT.upgrades[id].price} ฿`),
        if: (c: DlgCtx) => !hasUp(c.game, id),
        lock: lockMoney(RENT.upgrades[id].price),
        do: (c: DlgCtx) => c.game.intent('rest.upgrade', { id }),
        next: 'up_' + id,
      })),
      { text: T('ไว้ก่อนครับ', 'maybe later'), next: 'tenant' },
    ],
  },
  { id: 'up_aircon', anim: 'celebrate', say: T('แอร์ฉ่ำ! ลูกค้าจะนั่งนาน ทิปเยอะ… ค่าไฟเดือนนี้เจ๊บวกเพิ่มวันละสามสิบนะ', 'ice cold! longer stays, bigger tips… +30/day for the power bill') },
  { id: 'up_tv', anim: 'celebrate', say: T('ทีวีจอแบน! ช่องละครหลังข่าว ลุงๆ จะนั่งรอกะเพราได้ทั้งวัน', 'flat TV! soap operas — the uncles will wait for kaphrao all day') },
  { id: 'up_led', anim: 'celebrate', say: T('ป้ายไฟวิ่ง! กลางคืนสว่างจนผีต้องใส่แว่นกันแดด', "LED sign! at night it's so bright the ghosts wear sunglasses") },
  { id: 'up_expand', anim: 'celebrate', say: T('ห้องข้างๆ เป็นของลื้อแล้ว! ไปดึงม่านเหล็กขึ้นเอง ช่างทุบผนังให้แล้ว', "next door is yours! pull its shutter up, I've knocked the wall through") },
];

function registerContent() {
  Dialogues.register({
    id: 'landlord',
    match: (t) => t.role === 'landlord',
    priority: 5,
    voice: 1.3,
    start: (c) => {
      const s = rs(c.game);
      if (!s.rented) return 'hello';
      if (s.rentDue > 0 && (s.overdue > 0 || s.padlock)) return 'overdue';
      return 'tenant';
    },
    nodes: LANDLORD_NODES,
    barks: (_t, game) => {
      const s = rs(game);
      if (!s.rented) return [T('ห้องว่างให้เช่า! ทำเลทอง หน้าร้านมีรถเข็นกะเพราด้วย', 'unit for rent! golden spot, comes with a kaphrao cart out front'), T('สนใจเปิดร้านจริงๆ ไหมจ๊ะ', 'want a real shop, darling?')];
      if (s.rentDue > 0) return [T('ค่าเช่าล่ะ!!', 'MY RENT!!'), T('เจ๊จำหน้าได้นะ!', "I know your face!")];
      return [T('ค่าเช่าไม่เคยลด มีแต่ขึ้น', 'rent never goes down, only up'), T('หน้าร้านกวาดหน่อยนะ!', 'sweep the front!'), T('ได้ข่าวว่ากะเพราร้านนี้เผ็ดจนผีร้อง', 'heard your kaphrao makes ghosts cry'), T('ไฟดับอย่ามาโทษเจ๊นะ', "power cut? not my fault")];
    },
  });

  const lspot = () => landlordSpot() as [number, number, number];
  Quests.register({
    id: 'rest_savings', order: -30,
    title: T('เก็บเงินเปิดร้านจริง', 'Save up for a real restaurant'),
    available: (game) => !rs(game).rented && (!game.g.introStep || game.g.introStep === 'done'),
    steps: [{
      id: 'qualify',
      text: (game: Game) => T(`เงินรวมทั้งแก๊ง ${partyMoney(game).toLocaleString()} / ${RENT.qualifyMoney.toLocaleString()} ฿ (หรือดาว ${RENT.qualifyRep}★ / วันที่ ${RENT.qualifyDay})`,
        `party money ${partyMoney(game)} / ${RENT.qualifyMoney} ฿ (or ${RENT.qualifyRep}★ / day ${RENT.qualifyDay})`),
      done: (game) => qualifies(game),
    }],
    reward: { note: T('เจ๊ลำไยเจ้าของตึกมาเปิดห้องให้ดู!', 'the landlady wants to show you the unit!') },
  });
  Quests.register({
    id: 'rest_rent', order: -29,
    title: T('เช่าห้องแถวจากเจ๊ลำไย', 'Rent the shophouse from Jeh Lamyai'),
    available: (game) => qualifies(game) && !rs(game).rented,
    steps: [{
      id: 'sign', at: 'landlord', where: () => lspot(),
      text: (game: Game) => T(`คุยกับเจ๊ลำไยหน้าตึก เซ็นสัญญา มัดจำ ${depositNow(game).toLocaleString()} ฿`, `talk to Jeh Lamyai, sign, pay the ${depositNow(game)} ฿ deposit`),
      done: (game) => rs(game).rented,
    }],
    reward: { note: T('ได้กุญแจห้องแถว!', 'you got the keys!') },
  });
  Quests.register({
    id: 'rest_open', order: -28,
    title: T('เปิดร้านเฮียผัด!', 'Grand opening of Hia Phat!'),
    available: (game) => rs(game).rented,
    steps: [
      { id: 'shutter', where: () => unitToWorld(UNITS[0], 2.4, 1.2, 0.3) as [number, number, number], text: T('ดึงม่านเหล็กหน้าร้านขึ้น (E)', 'pull the shop shutter up (E)'), done: (game) => rs(game).opened },
      { id: 'serve', text: (game: Game) => T(`จัดโต๊ะในร้าน แล้วเสิร์ฟลูกค้าที่นั่งในร้าน ${Math.min(rs(game).servedInside, RENT.openServe)}/${RENT.openServe}`, `set tables inside and serve seated customers ${Math.min(rs(game).servedInside, RENT.openServe)}/${RENT.openServe}`), done: (game) => rs(game).servedInside >= RENT.openServe },
    ],
    reward: { money: 100, rep: 0.2, recipes: ['rat_na'], note: T('ร้านจริงแล้ว! ลูกค้าในร้านจ่ายแพงขึ้น ใจเย็นขึ้น', 'a real restaurant! indoor customers pay more and wait longer') },
    doneLine: T('ร้านเต็มแล้ว! อย่าลืมค่าเช่าพรุ่งนี้เช้านะ', "full house! don't forget tomorrow's rent"),
  });
}

/** HOST: keep the main quest chain moving (no-op without the quests runtime) */
let questT = 0;
function questsHost(game: Game, dt: number) {
  questT += dt;
  if (questT < 1) return;
  questT = 0;
  const q = questApi(game);
  if (!q) return;
  const s = rs(game);
  const intro = !game.g.introStep || game.g.introStep === 'done';
  if (!intro) return;
  if (!s.rented && !q.state('rest_savings')) q.start('rest_savings');
  if (!s.rented && qualifies(game) && !q.state('rest_rent') && q.state('rest_savings')?.status === 'done') q.start('rest_rent');
  if (s.rented && !q.state('rest_open')) q.start('rest_open');
}

// ------------------------------------------------------------------ fallback conversation (no quests runtime)

/** minimal talk UI with the existing 3D speech + numbered choice, used only when the quests module isn't loaded */
export function fallbackTalk(game: Game, npc: Ent) {
  const target: TalkTarget = {
    kind: 'entity', eid: npc.id, key: 'e' + npc.id, role: npc.role, name: LANDLORD_NAME,
    head: () => { const o = game.views.objectOf(npc.id); return o ? o.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.9, 0)) : null; },
  };
  const d = Dialogues.list.find((x) => x.match(target, game));
  if (!d) return;
  const ctx: DlgCtx = { game, target, npc, me: game.me!, vars: {} };
  const txt = (l: any): TL => { const v = typeof l === 'function' ? l(ctx) : l; return typeof v === 'string' ? { th: v } : v; };
  const show = (id: string | undefined) => {
    const n = id ? d.nodes.find((x) => x.id === id) : null;
    if (!n) return;
    n.do?.(ctx);
    const head = () => target.head();
    game.ui.say(head, txt(n.say), { duration: 6, voice: d.voice ?? 1 });
    const opts = (n.options ?? []).filter((o) => !o.if || o.if(ctx));
    if (!opts.length) { if (n.next) setTimeout(() => show(n.next), 2600); return; }
    setTimeout(() => {
      game.ui.choose({
        prompt: LANDLORD_NAME, seconds: 25,
        options: opts.map((o) => { const t = txt(o.text); const lk = o.lock?.(ctx); return lk ? { th: t.th + ` (${lk})`, en: t.en } : t; }),
        onPick: (i: number) => {
          const o = opts[i];
          if (!o || o.lock?.(ctx)) return;
          o.do?.(ctx);
          if (!o.end && o.next) setTimeout(() => show(o.next), 350);
        },
      });
    }, 900);
  };
  show(d.start(ctx));
}

// ------------------------------------------------------------------ module glue

export function premisesInit(game: Game) {
  bindPremises(game);
  registerContent();
  installPremisesIntents(game);
  // E on the landlord when no quests runtime is around
  game.interact.provide((ctx) => {
    const t = ctx.hit?.ent;
    if (!t || t.t !== 'npc' || t.role !== 'landlord' || questApi(game)) return null;
    return { key: 'E', label: tl('คุยกับเจ๊ลำไย', 'talk'), priority: -5, run: () => fallbackTalk(game, t) };
  }, 20);
}

export function premisesHost(game: Game, dt: number) {
  if (game.g.scene !== 'world') return;
  landlordHost(game, dt);
  questsHost(game, dt);
}

/** HOST, world ready: dev shortcut ?restaurant=open (rented + shutter up + a few tables inside) */
export function premisesWorldReady(game: Game) {
  if (!game.isHost) return;
  if (!game.g.restaurant) game.g.restaurant = { ...DEF };
  const p = params.get('restaurant');
  if (!p) return;
  const day = game.g.day ?? 1;
  const ups = p === 'full' ? ['aircon', 'tv', 'led', 'expand'] : [];
  setRS(game, { rented: true, stage: ups.includes('expand') ? 2 : 1, rentedDay: day, paidUntil: day, opened: true, grandDay: day, shutter: [1, ups.includes('expand') ? 1 : 0], upgrades: ups });
  unlockRecipe(game, 'rat_na', 'restaurant');
  // furnish the room so customers have somewhere to sit
  setTimeout(() => {
    const u = UNITS[0];
    const sp = (k: string, x: number, z: number, yaw = 0) => { const w = unitToWorld(u, x, SW_H + 0.01, z); return game.items.spawn(k, w, { yaw }); };
    const tables: [number, number, string][] = [[1.25, -3.2, 'table_steel'], [3.35, -3.2, 'table_plastic'], [1.25, -5.6, 'table_plastic'], [3.35, -5.6, 'table_steel']];
    for (const [x, z, k] of tables) {
      sp(k, x, z, Math.PI / 2);
      sp('stool_red', x - 0.0, z + 0.62, 0); sp('stool_blue', x, z - 0.62, 1.2);
      if (x > 2) sp('stool_red', x + 0.62, z, 0.5);
    }
  }, 600);
}
