import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import type { DishData } from '../../game/contracts';
import { TL, clamp, dist2D, round, tl } from '../../core/util';
import { yawTo } from '../../game/mapplan';
import { archDef, archetypePool, weighted, pick, recipeInfo, isRaining } from './data';
import { L, X, MAD, pickL, fillL, stars as starStr, Line } from './lines';
import { makeOrder, orderSpeech, orderShort, judge, menuRecipes, menuPrice, Order, reviewBubble, JudgeCtx, SPICY_RECIPES } from './judge';
import { SEAT_KINDS, TABLE_KINDS, SEAT_H, TABLE_H, TABLE_SIZE, SODA_KINDS } from './furniture';
import { addReview, stats } from './stats';

/* =============================================================================================
 * CUSTOMERS (host AI). npc entities { role:'customer', look, arch, cs, mood, ord, seat, posture … }.
 * spawn (shop open × zone traffic × rush × reputation × price) → walk in → queue at the cart →
 * read the menu (price opinion) → order out loud → sit at a table (or stand / take away) → wait
 * with escalating body language → get served → eat → honest review + stars → pay the server
 * (+tip / less) → leave a dirty plate & tissues → walk off. Wrong / late / overpriced / bad food
 * → MAD SYSTEM (3-second reply). Reacts to ghosts, dogs, slaps, rain, pulled stools.
 * ============================================================================================= */

type CS = 'arrive' | 'queue' | 'menu' | 'order' | 'toseat' | 'wait' | 'eat' | 'mad' | 'leave' | 'flee';
const ORDERED: CS[] = ['toseat', 'wait'];
const now = () => performance.now() / 1000;
const V = (a: ArrayLike<number>) => new THREE.Vector3(a[0], a[1], a[2]);

let G: Game;
let spawnAcc = 0;
let scanT = 0;
const lastSlap = new Map<number, number>();
let qCounter = 0;

export function bindCustomers(game: Game) { G = game; }
export const customers = () => G.state.all('npc').filter((e) => e.role === 'customer');

// ------------------------------------------------------------------ geometry around the cart

export function cartFrame() {
  const c = G.state.find('cart', () => true);
  const a = G.world?.anchor('cart_start');
  const p = c?.p ?? a?.p ?? [4.9, 0.15, -23];
  const yaw = c?.yaw ?? a?.yaw ?? Math.PI / 2;
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  return { p, yaw, w: (lx: number, lz: number) => [p[0] + lx * cs + lz * sn, p[1], p[2] - lx * sn + lz * cs] as number[] };
}
const queueSpot = (i: number) => cartFrame().w(0.05 + 0.78 * i, -1.0 - (i > 0 ? 0.1 : 0));
const waitSpot = (k: number) => cartFrame().w(-1.75 - 0.5 * Math.floor(k / 3), -0.55 - 0.62 * (k % 3));

function yawOfQ(q?: number[]) { return q ? 2 * Math.atan2(q[1], q[3]) : 0; }
const upright = (e: Ent) => !e.q || (Math.abs(e.q[0]) < 0.12 && Math.abs(e.q[2]) < 0.12);
const freeItem = (e: Ent) => e.holder == null && e.in == null && !!e.p;

export interface Seat { stool: Ent; table: Ent | null; spot: number[] | null; face: number; shade: boolean }

/** Seats = stools/chairs standing near a table (auto-detected); free = no customer on it. */
export function findSeats(onlyFree = true): Seat[] {
  const items = G.state.all('item');
  const tables = items.filter((e) => TABLE_KINDS.includes(e.k) && freeItem(e) && upright(e));
  const umbrellas = items.filter((e) => e.k === 'umbrella_big' && freeItem(e));
  const taken = new Set(customers().map((c) => c.seat).filter((x) => x != null));
  const out: Seat[] = [];
  for (const s of items) {
    if (!SEAT_KINDS.includes(s.k) || !freeItem(s) || !upright(s)) continue;
    if (onlyFree && taken.has(s.id)) continue;
    let best: Ent | null = null, bd = 0.62, spot: number[] | null = null;
    for (const t of tables) {
      const ty = yawOfQ(t.q), c = Math.cos(ty), sn = Math.sin(ty);
      const dx = s.p![0] - t.p![0], dz = s.p![2] - t.p![2];
      const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
      const [W, D] = TABLE_SIZE[t.k] ?? [0.8, 0.6];
      const ex = Math.max(0, Math.abs(lx) - W / 2), ez = Math.max(0, Math.abs(lz) - D / 2);
      const d = Math.hypot(ex, ez);
      if (d < bd && Math.abs(s.p![1] - t.p![1]) < 0.3) {
        bd = d; best = t;
        const sx = clamp(lx, -W / 2 + 0.17, W / 2 - 0.17), sz = clamp(lz, -D / 2 + 0.15, D / 2 - 0.15);
        spot = [t.p![0] + sx * c + sz * sn, t.p![1] + (TABLE_H[t.k] ?? 0.66), t.p![2] - sx * sn + sz * c];
      }
    }
    if (!best) continue;
    const shade = umbrellas.some((u) => dist2D(u.p!, s.p!) < 1.35);
    out.push({ stool: s, table: best, spot, face: yawTo(spot![0] - s.p![0], spot![2] - s.p![2]), shade });
  }
  return out;
}

// ------------------------------------------------------------------ helpers

function anim(e: Ent, a: string, loop = false) { e.anim = a; e.animT = G.g.time + Math.random() * 0.001; e.animLoop = loop; }
function voice(c: Ent) { return c.look?.sex === 'f' ? 1.25 + (c.id % 5) * 0.03 : 0.85 + (c.id % 5) * 0.03; }
function say(c: Ent, l: TL | Line, o: { style?: 'speech' | 'thought' | 'shout'; duration?: number } = {}) {
  G.say(c.id, { th: l.th, en: l.en }, { voice: o.style === 'thought' ? 0 : voice(c), ...o });
  c._lastSay = now();
}
function head(c: Ent) { return [c.p![0], c.p![1] + 1.85, c.p![2]]; }
function nearPlayer(c: Ent, r: number) { return G.nearestPlayer(c.p!, r); }
function go(c: Ent, to: ArrayLike<number>, speed = 1.25, cb?: () => void, face?: number) {
  G.npcs.go(c, to, { speed, onArrive: cb, face, radius: 0.3 });
}
function sit(c: Ent, s: Seat) {
  G.npcs.stop(c);
  c.p = [round(s.stool.p![0], 3), round(s.stool.p![1], 3), round(s.stool.p![2], 3)];
  c.yaw = round(s.face, 3);
  c.posture = 'sit';
  c.seatH = SEAT_H[s.stool.k] ?? 0.44;
  c.seat = s.stool.id;
  c.spot = s.spot ? s.spot.map((v) => round(v, 3)) : null;
  c.tbl = s.table?.id ?? null;
  c._shade = s.shade;
  c._mess = s.table?.data?.mess ?? 0;
  anim(c, 'sit', true);
  G.sfx('plastic_chair_scrape', c.p, { vol: 0.5 });
}
/** HOST: put a customer straight onto a seat, waiting (tests / lab). */
export function seatCustomer(c: Ent, s: Seat) { sit(c, s); c._wet = 0; setCS(c, 'wait'); }
function standUp(c: Ent) {
  c.posture = 'stand';
  c.seat = null; c.tbl = null; c.spot = null;
  anim(c, 'idle', true);
}
function setCS(c: Ent, s: CS) { c.cs = s; c._t = 0; }

function dirtyNear(p: ArrayLike<number>) {
  // flies: messy tables / trash bags close to this point
  for (const e of G.state.all('item')) {
    if (!e.p || e.holder != null) continue;
    if ((TABLE_KINDS.includes(e.k) && (e.data?.mess ?? 0) > 0.45) || e.k === 'trash_bag') if (dist2D(e.p, p) < 2.2) return true;
  }
  return false;
}
function tissueNear(p: ArrayLike<number>) { return G.state.all('item').some((e) => e.k === 'tissue_box' && e.p && e.holder == null && dist2D(e.p, p) < 1.0); }

function restaurantHasWater() { return G.state.all('item').some((e) => e.k === 'water_dispenser' && (e.data?.water ?? 0) > 0.3) && G.state.all('item').some((e) => e.k === 'cup_plastic'); }
function restaurantHasSoda() {
  const cp = cartFrame().p;
  return G.state.all('item').some((e) => SODA_KINDS.includes(e.k) && e.k !== 'water_bottle' && !e.data?.empty && (G.items.worldPos(e)?.distanceTo(V(cp)) ?? 99) < 8);
}

// ------------------------------------------------------------------ spawning

export function spawnRate(): number {
  const g = G.g;
  if (!g.shopOpen || g.scene !== 'world' || g.paused) return 0;
  const t = G.clock.time;
  if (t < 6.2 || t > 23.6) return 0;
  const menu = menuRecipes(G);
  if (!menu.length) return 0;
  const cp = cartFrame().p;
  const zone = G.world?.zoneAt(cp);
  const traffic = zone?.traffic ?? 1;
  const rep = g.reputation ?? 3;
  const repMul = 0.45 + (rep / 5) * 1.1;
  let attract = 0;
  for (const r of menu) attract += clamp(Math.pow(recipeInfo(G, r).price * (zone?.priceFactor ?? 1) / Math.max(5, menuPrice(G, r)), 1.6), 0.25, 2);
  attract /= menu.length;
  const day = g.day ?? 1;
  const dayF = clamp(0.5 + 0.12 * day, 0.6, 2.2);
  const players = Math.max(1, G.players().length);
  const yest = g.restYesterday ?? 1;
  return (1 / 70) * dayF * traffic * (G.clock.rush / 0.8) * repMul * attract * (0.7 + 0.1 * players) * yest;
}

export function maxCustomers() { return Math.min(12, 4 + findSeats(false).length); }

export function spawnCustomer(o: { arch?: string; at?: number[]; state?: CS; order?: Order } = {}): Ent | null {
  const cf = cartFrame();
  const zone = G.world?.zoneAt(cf.p);
  const arch = o.arch ?? weighted(archetypePool(zone?.kind, G.clock.time));
  let at = o.at;
  if (!at) {
    const base = V(cf.p);
    for (let i = 0; i < 14 && !at; i++) {
      const q = G.world?.nav.randomPoint(i < 7 ? zone?.id : undefined);
      if (q && q.distanceTo(base) > 14 && q.distanceTo(base) < 42) at = [q.x, q.y, q.z];
    }
    if (!at) { const a = Math.random() * Math.PI * 2; at = [cf.p[0] + Math.cos(a) * 3 - 22 * Math.sign(Math.random() - 0.5) * 0, cf.p[1], cf.p[2] + (Math.random() < 0.5 ? -24 : 24)]; }
  }
  const seed = (Math.random() * 1e9) | 0;
  const look = G.chars.randomLook(arch, seed);
  const c = G.state.spawn('npc', {
    role: 'customer', look, arch, p: [round(at[0], 3), round(at[1], 3), round(at[2], 3)], yaw: 0, anim: 'idle', animT: 0, animLoop: true,
    face: null, lookAt: null, hold: null, posture: 'stand', cs: 'arrive', mood: 1, ord: null, seat: null, spot: null, tbl: null,
  });
  c._t = 0; c._qt = ++qCounter; c._pf = zone?.priceFactor ?? 1;
  const a = archDef(arch);
  c._pat = (95 + Math.random() * 55) * a.patience * (G.clock.rush > 1.2 ? 0.85 : 1) * (0.85 + (G.g.reputation ?? 3) * 0.05);
  c._waited = 0;
  c._moneyDelta = 0;
  if (o.order) c.ord = o.order;
  if (o.state) setCS(c, o.state);
  return c;
}

// ------------------------------------------------------------------ per-tick AI

function queueList() { return customers().filter((c) => ['arrive', 'queue', 'menu', 'order'].includes(c.cs)).sort((a, b) => a._qt - b._qt); }
function waiters() { return customers().filter((c) => (c.cs === 'wait' || c.cs === 'eat' || c.cs === 'toseat') && c.seat == null && c.ord).sort((a, b) => a._qt - b._qt); }

export function customersHost(dt: number) {
  const g = G.g;
  // spawn
  const rate = spawnRate();
  if (rate > 0 && customers().length < maxCustomers() && queueList().length < 6) {
    spawnAcc += rate * dt;
    if (spawnAcc >= 1) { spawnAcc = 0; spawnCustomer(); }
  } else spawnAcc = Math.min(spawnAcc, 0.5);
  // queue positions
  const q = queueList();
  q.forEach((c, i) => {
    if (c._qi !== i) {
      c._qi = i;
      if (c.cs === 'arrive' || c.cs === 'queue') {
        const cf = cartFrame();
        const sp = queueSpot(i);
        go(c, sp, c.cs === 'arrive' ? 1.25 : 0.9, () => { if (c.cs === 'arrive' || c.cs === 'queue') setCS(c, 'queue'); c.yaw = round(cf.yaw + Math.PI, 3); }, cf.yaw + Math.PI);
      }
    }
  });
  for (const c of customers()) {
    try { tick(c, dt, q); } catch (e) { console.error('[restaurant] customer', e); }
  }
  // reactions (ghosts / dogs / slaps / rain), 2 Hz
  scanT += dt;
  if (scanT > 0.5) { scanT = 0; reactions(); }
  void g;
}

function patienceTick(c: Ent, dt: number, k = 1) {
  c._waited += dt * k;
  const f = 1 - c._waited / c._pat;
  const mood = round(clamp(f, 0, 1), 2);
  if (Math.abs((c.mood ?? 1) - mood) >= 0.05 || mood === 0) c.mood = mood;
  return f;
}

function tick(c: Ent, dt: number, q: Ent[]) {
  c._t = (c._t ?? 0) + dt;
  const t = c._t;
  const cf = cartFrame();
  switch (c.cs as CS) {
    case 'arrive': {
      if (!G.g.shopOpen && t > 1) { leave(c, pickL(X.closing)); return; }
      if (!G.npcs.isMoving(c) && t > 2) { c._qi = -1; } // re-path
      break;
    }
    case 'queue': {
      patienceTick(c, dt, 0.5);
      if (!G.g.shopOpen) { leave(c, pickL(X.closing)); return; }
      if (q[0] === c && !G.npcs.isMoving(c)) { setCS(c, 'menu'); anim(c, 'think', true); c.lookAt = null; }
      else if (t > 6 && Math.random() < dt * 0.05) say(c, pickL(X.waitThink), { style: 'thought', duration: 2.5 });
      if (c._waited > c._pat * 0.7) { leave(c, pickL(L.bad.wait)); return; }
      break;
    }
    case 'menu': {
      patienceTick(c, dt, 0.5);
      if (!c._menuRead && t > 1.4) {
        c._menuRead = true;
        const o = makeOrder(G, c, { drinks: { water: restaurantHasWater(), soda: restaurantHasSoda() } });
        if (!o) { leave(c, pickL(X.closing)); return; }
        c._order = o;
        const r = o.r ?? menuRecipes(G)[0];
        const exp = recipeInfo(G, r).price * c._pf * archDef(c.arch).budget;
        const price = menuPrice(G, r);
        const ratio = price / Math.max(5, exp);
        c._ratio = ratio;
        const v = { dish: recipeInfo(G, r).name.th, price };
        if (ratio > 1.75 && Math.random() < 0.6) { leave(c, fillL(pickL(X.tooPricey), v), true); return; }
        if (ratio > 1.45 && Math.random() < 0.35) { startMad(c, 'price_too_high', { price }); return; }
        if (ratio > 1.15 && Math.random() < 0.55) say(c, fillL(pickL(X.pricey), v), { duration: 2.6 });
        else if (ratio < 0.82 && Math.random() < 0.55) say(c, fillL(pickL(X.cheap), v), { duration: 2.6 });
        else if (Math.random() < 0.2) say(c, pickL(L.greet), { duration: 2.4 });
      }
      if (t > 3.6) {
        // somebody has to be at the cart to take the order
        if (!G.nearestPlayer(cf.p, 7)) {
          patienceTick(c, dt, 0.6);
          if (now() - (c._lastSay ?? 0) > 6.5) { say(c, pickL(X.call), { duration: 3 }); anim(c, 'wave'); }
          return;
        }
        const o: Order = c._order;
        setCS(c, 'order');
        c.ord = o;
        anim(c, 'point');
        say(c, orderSpeech(G, c, o), { duration: 5.5 });
        stats().orders = (stats().orders ?? 0) + 1;
      }
      break;
    }
    case 'order': {
      patienceTick(c, dt, 0.6);
      if (t > 2.4) toSeatOrWait(c);
      break;
    }
    case 'toseat': {
      patienceTick(c, dt);
      if (t > 25) toSeatOrWait(c, true);
      break;
    }
    case 'wait': {
      const f = patienceTick(c, dt);
      waitBehaviour(c, f, t);
      if (f <= 0) { if (!c._madLate) { c._madLate = true; startMad(c, 'waited_too_long'); } else leave(c, pickL(L.bad.wait), true, 'late'); }
      if (c._wet !== undefined && isRaining(G) && c.seat != null && !c._shade) { c._wet += dt; if (c._wet > 5 && !c._rainSaid) { c._rainSaid = true; say(c, pickL(X.rain)); } }
      break;
    }
    case 'eat': {
      eatTick(c, dt, t);
      break;
    }
    case 'mad': {
      if (c._mad && now() > c._mad.deadline) resolveMad(c, -1);
      break;
    }
    case 'leave': case 'flee': {
      if (!G.npcs.isMoving(c) && t > 1.5) G.state.despawn(c);
      if (t > 60) G.state.despawn(c);
      break;
    }
  }
}

function toSeatOrWait(c: Ent, forceStand = false) {
  const o: Order = c.ord;
  const cf = cartFrame();
  if (!o.req.includes('takeaway') && !forceStand) {
    const seats = findSeats(true);
    if (seats.length) {
      // prefer shade when raining or sunny noon, else nearest
      const rain = isRaining(G);
      seats.sort((a, b) => ((rain || (G.clock.time > 11 && G.clock.time < 15)) ? (Number(b.shade) - Number(a.shade)) * 3 : 0) + dist2D(a.stool.p!, c.p!) - dist2D(b.stool.p!, c.p!));
      const s = seats[0];
      c.seat = s.stool.id; // reserve
      setCS(c, 'toseat');
      // walk around the cart (vendor side) instead of through it
      const side = (s.stool.p![0] - cf.p[0]) * Math.cos(cf.yaw) - (s.stool.p![2] - cf.p[2]) * Math.sin(cf.yaw) > 0 ? 1 : -1;
      const via = cf.w(side * 1.75, 0.0);
      go(c, via, 1.2, () => go(c, s.stool.p!, 1.1, () => {
        const fresh = findSeats(false).find((x) => x.stool.id === s.stool.id);
        if (!fresh) { c.seat = null; toSeatOrWait(c, true); return; }
        sit(c, fresh);
        c._wet = 0;
        setCS(c, 'wait');
        if ((fresh.table?.data?.mess ?? 0) > 0.65 && Math.random() < 0.4 && !c._madUsed) startMad(c, 'dirty_table');
      }));
      return;
    }
    if (!o.req.includes('takeaway') && Math.random() < 0.6) say(c, pickL(X.noSeat), { duration: 2.5 });
  }
  c.seat = null;
  setCS(c, 'wait');
  const k = waiters().indexOf(c);
  go(c, waitSpot(Math.max(0, k)), 1.0, () => { c.yaw = round(cf.yaw + Math.PI * 0.75, 3); anim(c, 'idle', true); });
}

function waitBehaviour(c: Ent, f: number, t: number) {
  const since = now() - (c._lastSay ?? 0);
  if (f < 0.12 && since > 7) { say(c, pickL(X.waitShout), { style: 'shout', duration: 2.6 }); anim(c, 'angry'); c.face = 'shock'; G.sfx('angry_grumble', c.p, { vol: 0.5 }); }
  else if (f < 0.35 && since > 9) { say(c, Math.random() < 0.5 ? pickL(L.waitLong) : pickL(X.waitNudge), { duration: 2.8 }); anim(c, c.seat != null ? 'angry' : 'shrug'); }
  else if (f < 0.6 && since > 12 && t > 4) { say(c, pickL(X.waitThink), { style: 'thought', duration: 2.5 }); if (c.seat == null) anim(c, 'think'); }
  if (c.seat != null && c.anim !== 'sit' && G.g.time - (c.animT ?? 0) > 0.05) anim(c, 'sit', true);
}

// ------------------------------------------------------------------ serving

/** HOST: player `pl` hands item `it` to customer `c`. Returns true if accepted. */
export function serve(pl: Ent, c: Ent, it: Ent): boolean {
  if (!c || c.role !== 'customer' || !it) return false;
  if (['leave', 'flee', 'mad', 'eat'].includes(c.cs) && !(c.cs === 'eat' && isDrink(it))) return false;
  if (isDrink(it)) return serveDrink(pl, c, it);
  if (it.k !== 'dish') return false;
  const d: DishData = it.data;
  const o: Order | null = c.ord ?? null;
  if (!o) {
    // served before ordering: fine if it's on the menu
    c.ord = { r: d.recipe, req: [], drink: null };
  }
  const ord: Order = c.ord;
  c._dish = it.id;
  c._by = pl.id;
  c._servedAt = now();
  c.lookAt = null;
  G.npcs.stop(c);
  // where does the plate go?
  if (c.spot && c.seat != null) {
    G.items.toWorld(it, c.spot, [0, 0, 0], (c.yaw ?? 0));
  } else {
    G.items.detach(it);
    it.holder = c.id;
  }
  G.sfx('plate_down', c.p, { vol: 0.6 });
  G.xp(pl.id, 'serve', 2);
  const wrong = !ord.any && ord.r && d.recipe !== ord.r;
  if (wrong) {
    G.sfx('nii_arai', c.p, { vol: 0.8 });
    startMad(c, 'wrong_dish', { ordered: recipeInfo(G, ord.r!).name.th, got: recipeInfo(G, d.recipe).name.th, ordered_en: recipeInfo(G, ord.r!).name.en ?? '', got_en: recipeInfo(G, d.recipe).name.en ?? '' });
    return true;
  }
  if (ord.req.includes('takeaway') || (c.seat == null && d.takeaway)) { payAndGo(c, true); return true; }
  const fast = (c._waited / c._pat) < 0.3;
  say(c, pickL(fast ? X.servedFast : X.served), { duration: 2 });
  G.sfx('khob_khun', c.p, { vol: 0.6 });
  startEating(c);
  return true;
}

const isDrink = (it: Ent) => it.k === 'cup_plastic' || SODA_KINDS.includes(it.k);

function serveDrink(pl: Ent, c: Ent, it: Ent): boolean {
  if (it.k === 'cup_plastic' && ((it.data?.fill ?? 0) < 0.3 && (it.data?.ice ?? 0) < 1 || it.data?.dirty)) { say(c, tl('แก้วเปล่าจะให้กินอะไร', 'an empty cup?'), { duration: 2 }); return false; }
  if (it.data?.empty) return false;
  if (c._drink != null) return false;
  c._drink = it.id;
  c._by ??= pl.id;
  if (c.spot && c.seat != null) {
    const s = c.spot;
    const yaw = c.yaw ?? 0;
    const off = [Math.cos(yaw) * 0.16, 0, -Math.sin(yaw) * 0.16];
    G.items.toWorld(it, [s[0] + off[0], s[1], s[2] + off[2]], [0, 0, 0]);
  } else { G.items.detach(it); it.holder = c.id; }
  const soda = SODA_KINDS.includes(it.k) && it.k !== 'water_bottle';
  c._drinkOk = c.ord?.drink ? (c.ord.drink === 'soda' ? soda : it.k === 'cup_plastic' || it.k === 'water_bottle') : null;
  c._sodaPay = soda ? (G.g.menu?.extras?.soda ?? 20) : 0;
  G.sfx(soda ? (it.k.includes('can') || it.k === 'soda_fanta_green' ? 'can_open' : 'bottle_open_fizz') : 'ice_cubes', c.p, { vol: 0.7 });
  say(c, pickL(soda ? X.soda : X.water), { duration: 1.8 });
  G.xp(pl.id, 'serve', 1);
  return true;
}

function startEating(c: Ent) {
  setCS(c, 'eat');
  const it = G.state.get(c._dish);
  const portion = it?.data?.portion ?? 150;
  c._eatT = (9 + portion / 40) / archDef(c.arch).eat;
  c._bite = 0;
  c._react = false;
  if (c.seat != null) { c.posture = 'sit'; }
  anim(c, 'eat', true);
}

function eatTick(c: Ent, dt: number, t: number) {
  const it = G.state.get(c._dish);
  if (!it) { // the plate vanished (somebody snatched it)
    leaveAngry(c, pickL(X.foodStolen), 'stolen');
    return;
  }
  if (it.holder != null && it.holder !== c.id) { leaveAngry(c, pickL(X.foodStolen), 'stolen'); return; }
  if (it.holder === c.id && c.p) it.p = [round(c.p[0], 2), round(c.p[1] + 1.0, 2), round(c.p[2], 2)];
  c._bite += dt;
  if (c._bite > 1.3) { c._bite = 0; G.sfx(Math.random() < 0.7 ? 'eat_chomp' : 'spoon_clink', c.p, { vol: 0.35 }); }
  const d: DishData = it.data ?? {};
  const eaten = clamp(t / c._eatT, 0, 1);
  const step = Math.floor(eaten * 4) / 4;
  if ((it.data?.eaten ?? 0) !== step) it.data = { ...it.data, eaten: step };
  // first-bite reactions (and the food mad situations)
  if (!c._react && t > 2.2) {
    c._react = true;
    const o: Order = c.ord;
    const iss = d.issues ?? [];
    if (o.req.includes('mild') && (d.spicy ?? 0) > 0.4 && Math.random() < 0.6 && !c._madUsed) { G.sfx('cough', c.p); startMad(c, 'not_spicy_got_spicy'); return; }
    if ((iss.includes('burnt') || iss.includes('raw_pork')) && Math.random() < 0.5 && !c._madUsed) { startMad(c, 'burnt'); return; }
    if ((d.salty ?? 0) > 0.6 && Math.random() < 0.5 && !c._madUsed) { startMad(c, 'too_salty'); return; }
    if (iss.includes('no_spoon') && Math.random() < 0.3 && !c._madUsed) { startMad(c, 'no_spoon'); return; }
    if ((d.spicy ?? 0) > 0.55) { say(c, pickL(X.spicyEat), { duration: 1.8 }); G.sfx(Math.random() < 0.5 ? 'cough' : 'sneeze', c.p, { vol: 0.6 }); G.sfx('phet', c.p, { vol: 0.5, delay: 0.4 }); }
    else if ((d.salty ?? 0) > 0.45) say(c, pickL(X.saltyEat), { style: 'thought', duration: 1.8 });
    else if ((d.taste ?? 0) > 0.8) { say(c, pickL(X.yum), { duration: 1.8 }); G.sfx('aroi', c.p, { vol: 0.6 }); }
  }
  // drink
  const cup = c._drink != null ? G.state.get(c._drink) : null;
  if (cup && t > c._eatT * 0.5 && !cup.data?.empty && !cup.data?.drunk) {
    anim(c, 'drink'); G.sfx('drink_gulp', c.p, { vol: 0.5 });
    cup.data = cup.k === 'cup_plastic' ? { ...cup.data, fill: 0.1, ice: Math.max(0, (cup.data?.ice ?? 0) - 2), drunk: true } : { ...cup.data, drunk: true };
    setTimeout(() => { if (c.cs === 'eat') anim(c, 'eat', true); }, 1200);
  }
  if (t >= c._eatT) {
    if (Math.random() < 0.04 && !c._madUsed) { startMad(c, 'customer_wants_free_refill'); return; }
    if ((d.portion ?? 0) > 200 || Math.random() < 0.15) G.sfx('burp', c.p, { vol: 0.6 });
    payAndGo(c, false);
  }
}

// ------------------------------------------------------------------ judge, pay, mess, leave

function ctxOf(c: Ent): JudgeCtx {
  return {
    waited: (c._servedAt ? c._waited : c._waited), patience: c._pat, mess: c._mess ?? 0, flies: c.p ? dirtyNear(c.p) : false,
    tissue: c.spot ? tissueNear(c.spot) : true, shade: !!c._shade, wet: c._wet ?? 0, drinkOk: c.ord?.drink ? (c._drinkOk ?? false) : (c._drinkOk ? true : null),
    soda: c._sodaPay ?? 0, sawSlap: !!c._sawSlap, madCalmed: !!c._madOK, moneyDelta: c._moneyDelta ?? 0,
  };
}

function payAndGo(c: Ent, takeaway: boolean) {
  const it = G.state.get(c._dish);
  const d: DishData = it?.data ?? { recipe: c.ord?.r ?? 'kaphrao_moo', taste: 0.5, issues: [] } as any;
  const v = judge(G, c, d, c.ord ?? { r: d.recipe, req: [] }, ctxOf(c));
  if (c._half) v.pay = Math.round(v.pay * 0.5 / 5) * 5;
  // homeless-man karma (life module) multiplies tips
  const tipMul = (G as any).life?.tipMul?.() ?? 1;
  if (v.tip) v.tip = Math.max(0, Math.round(v.tip * tipMul));
  const server = G.state.get(c._by) ?? G.nearestPlayer(c.p!, 50);
  anim(c, 'give');
  G.sfx('banknote', c.p, { vol: 0.6 });
  if (server && v.pay > 0) {
    G.money(server.id, v.pay + v.tip, 'restaurant', head(c));
    G.sfx('ka_ching', c.p, { vol: 0.5, delay: 0.3 });
  }
  if (server) {
    G.xp(server.id, 'serve', 4 + v.stars * 2);
    if (d.cook != null && v.stars >= 4) G.xp(d.cook, 'cook', v.stars);
  }
  addReview(c, v, d.recipe, v.pay + v.tip, false);
  // honest review bubble + floating star slip (all peers)
  G.emit('rest:review', { cid: c.id, stars: v.stars, th: v.review.th, en: v.review.en, pay: v.pay, tip: v.tip });
  const line = reviewBubble(v);
  setTimeout(() => { if (G.state.get(c.id)) say(c, v.tip ? { th: line.th + ' ' + pickL(X.tip).th, en: line.en } : line, { duration: 5 }); }, 600);
  // mess on the table
  if (it) {
    if (it.holder === c.id || takeaway) {
      if (takeaway) { G.items.remove(it); c.hold = 'plastic_bag'; }
      else { G.items.detach(it); it.holder = null; dropDirty(c, it); }
    } else dirty(c, it);
  }
  const cup = c._drink != null ? G.state.get(c._drink) : null;
  if (cup) {
    if (cup.holder === c.id) { G.items.detach(cup); G.items.toWorld(cup, [c.p![0], c.p![1] + 0.3, c.p![2]]); }
    cup.data = cup.k === 'cup_plastic' ? { fill: 0, ice: 0, dirty: true } : { ...cup.data, empty: true };
  }
  const t = G.state.get(c.tbl);
  if (t && !takeaway) {
    const add = 0.18 + Math.random() * 0.22 + (1 - (d.taste ?? 0.5)) * 0.15;
    t.data = { ...t.data, mess: round(clamp((t.data?.mess ?? 0) + add, 0, 1), 2) };
    const nT = tissueNear(c.spot ?? c.p!) ? 1 + (Math.random() < 0.4 ? 1 : 0) : 0;
    for (let i = 0; i < nT; i++) {
      const s = c.spot ?? c.p!;
      G.items.spawn('trash_tissue', [s[0] + (Math.random() - 0.5) * 0.25, s[1] + 0.05, s[2] + (Math.random() - 0.5) * 0.2], { vel: [0, 0.4, 0] });
    }
  }
  const good = v.stars >= 4;
  setTimeout(() => {
    if (!G.state.get(c.id)) return;
    leave(c, good ? pickL(X.leaveGood) : v.stars <= 2 ? pickL(X.leaveBad) : null);
    if (good) G.sfx('im_laew', c.p, { vol: 0.4 });
  }, takeaway ? 2200 : 3800);
  setCS(c, 'leave');
  c._t = -5;
}

/** Eaten dish on the table → dirty plate (cooking module helper) right there. */
function dirty(c: Ent, it: Ent) {
  const ck: any = (G as any).cooking;
  const leftover = (it.data?.taste ?? 0.6) < 0.45;
  if (ck?.dishToDirtyPlate && !leftover) ck.dishToDirtyPlate(it);
  else if (ck?.dishToDirtyPlate) { it.data = { ...it.data, eaten: 0.5 }; ck.dishToDirtyPlate(it); }
  else G.items.remove(it);
  void c;
}

/** Standing customers put the plate in a nearby tub, on a table, or on the ground next to them. */
function dropDirty(c: Ent, it: Ent) {
  const tub = G.state.all('item').find((e) => (e.k === 'wash_tub' || e.k === 'bus_tub') && e.p && dist2D(e.p, c.p!) < 3.5 && G.items.contents(e).length < 8);
  const ck: any = (G as any).cooking;
  const plate = ck?.dishToDirtyPlate ? null : it;
  const p = [c.p![0] - Math.sin(c.yaw ?? 0) * 0.35, c.p![1] + 0.3, c.p![2] - Math.cos(c.yaw ?? 0) * 0.35];
  G.items.toWorld(it, p);
  const np = ck?.dishToDirtyPlate ? ck.dishToDirtyPlate(it) : plate;
  if (np && tub) G.items.toContainer(np, tub);
}

function leave(c: Ent, line: TL | Line | null, angry = false, why?: string) {
  if (c.seat != null) standUp(c);
  if (line) say(c, line, { style: angry ? 'shout' : 'speech', duration: 2.8 });
  if (angry) { anim(c, 'angry'); G.sfx('angry_grumble', c.p, { vol: 0.5 }); }
  if (why === 'late') { stats().angry++; G.g.reputation = round(clamp((G.g.reputation ?? 3) - 0.1, 0, 5), 3); }
  setCS(c, 'leave');
  c.ord = c.ord ?? null;
  c.mood = angry ? 0 : c.mood;
  const cf = cartFrame();
  let to: number[] | null = null;
  for (let i = 0; i < 10 && !to; i++) { const q = G.world?.nav.randomPoint(); if (q && dist2D([q.x, 0, q.z], cf.p) > 22 && dist2D([q.x, 0, q.z], cf.p) < 50) to = [q.x, q.y, q.z]; }
  to ??= [cf.p[0] - 1, cf.p[1], cf.p[2] + (Math.random() < 0.5 ? 30 : -30)];
  setTimeout(() => { if (G.state.get(c.id) && (c.cs === 'leave' || c.cs === 'flee')) go(c, to!, c.cs === 'flee' ? 4.2 : 1.3, () => G.state.despawn(c)); }, angry ? 900 : 300);
}

/** Storm off without paying: review bomb + reputation hit. */
function leaveAngry(c: Ent, line: TL | Line, why: string) {
  stats().angry++;
  const v = { stars: 1, review: pickL(L.angry), pay: 0, tip: 0 } as any;
  addReview(c, v, c.ord?.r ?? null, 0, true);
  G.g.reputation = round(clamp((G.g.reputation ?? 3) - 0.3, 0, 5), 3);
  G.emit('rest:review', { cid: c.id, stars: 1, th: v.review.th, en: v.review.en, pay: 0, tip: 0 });
  c.face = 'shock';
  leave(c, { th: line.th, en: line.en }, true, why);
  setTimeout(() => { if (G.state.get(c.id)) say(c, { th: `${starStr(1)}  ${v.review.th}`, en: v.review.en }, { style: 'shout', duration: 3.5 }); }, 2600);
  // a served-but-rejected dish stays where it is (still on the table → clear it)
  const it = G.state.get(c._dish);
  if (it && it.holder === c.id) { G.items.detach(it); G.items.toWorld(it, [c.p![0], c.p![1] + 0.9, c.p![2]]); }
}

// ------------------------------------------------------------------ MAD SYSTEM (host side)

export function startMad(c: Ent, sit: string, vars: Record<string, string | number> = {}) {
  const S = MAD[sit];
  if (!S) { leaveAngry(c, pickL(L.angry), sit); return; }
  c._madUsed = true;
  c._madResume = c.cs;
  c._madSit = sit;
  setCS(c, 'mad');
  G.npcs.stop(c);
  anim(c, 'angry');
  c.face = 'shock';
  let prompt: Line = S.prompt;
  if (sit === 'wrong_dish' && vars.ordered) prompt = fillL(pickL(X.wrongShout), vars);
  prompt = fillL(prompt, { price: vars.price ?? menuPrice(G, c.ord?.r ?? 'kaphrao_moo'), ...vars });
  say(c, prompt, { style: 'shout', duration: 3.6 });
  G.sfx('dun_dun_dunn', c.p, { vol: 0.5 });
  const pl = G.nearestPlayer(c.p!, 14) ?? G.state.get(c._by) ?? null;
  const order = [0, 1, 2].slice(0, S.options.length).sort(() => Math.random() - 0.5);
  c._mad = { sit, order, pid: pl?.id ?? -1, deadline: now() + (pl ? 4.4 : 1.5) };
  if (pl) G.emit('rest:mad', { cid: c.id, pid: pl.id, prompt, opts: order.map((i) => ({ th: S.options[i].th, en: S.options[i].en })), seconds: 3 });
}

/** HOST: reply index (in the shuffled order) or -1 on timeout. */
export function resolveMad(c: Ent, pick_: number, pl?: Ent) {
  const m = c._mad;
  if (!m || c.cs !== 'mad') return;
  if (pl && m.pid !== pl.id) return;
  c._mad = null;
  const S = MAD[m.sit];
  const opt = pick_ >= 0 ? S.options[m.order[pick_]] : null;
  const type = opt?.type ?? 'timeout';
  c.face = null;
  const humor = ['tourist_backpacker', 'teen_gamer', 'gangster_lite', 'moto_taxi', 'student_m', 'student_f', 'karaoke_uncle'].includes(c.arch) ? 0.7 : ['auntie_vendor', 'old_lady', 'office_worker_f'].includes(c.arch) ? 0.3 : 0.5;
  if (type === 'correct' || (type === 'funny' && Math.random() < humor)) {
    c._madOK = true;
    c._moneyDelta = (c._moneyDelta ?? 0) + (opt?.money_delta ?? 0);
    if (type === 'funny') { c._half = true; G.sfx('crowd_laugh', c.p, { vol: 0.4 }); say(c, pickL(X.calmFunny), { duration: 2.4 }); }
    else { say(c, pickL(X.calmGood), { duration: 2.4 }); G.sfx('mai_pen_rai', c.p, { vol: 0.5 }); }
    if (type === 'correct' && Math.random() < 0.25) c._moneyDelta += 5; // a little tip for the nice words
    if (pl) G.xp(pl.id, 'serve', 3);
    c.mood = round(clamp((c.mood ?? 0.5) + 0.35, 0, 1), 2);
    // resume what they were doing
    const r: CS = c._madResume;
    if (m.sit === 'waited_too_long') { c._pat += 50; setCS(c, 'wait'); anim(c, c.seat != null ? 'sit' : 'idle', true); }
    else if (m.sit === 'price_too_high') { setCS(c, 'menu'); c._t = 3; anim(c, 'think', true); }
    else if (m.sit === 'dirty_table') { setCS(c, 'wait'); anim(c, 'sit', true); }
    else if (G.state.get(c._dish)) { if (r === 'eat' || m.sit === 'wrong_dish' || c.cs === 'mad') startEating(c); c._t = r === 'eat' ? 2.3 : 0; }
    else { setCS(c, r === 'mad' ? 'wait' : r); anim(c, c.seat != null ? 'sit' : 'idle', true); }
  } else {
    G.sfx(type === 'timeout' ? 'wrong_buzz' : 'sad_trombone', c.p, { vol: 0.5 });
    leaveAngry(c, pickL(X.stormOff), m.sit);
  }
}

// ------------------------------------------------------------------ reactions

function reactions() {
  const cs = customers().filter((c) => !['leave', 'flee'].includes(c.cs));
  if (!cs.length) return;
  // ghosts
  for (const gh of G.state.all('ghost')) {
    if (!gh.p || (gh.vis ?? 1) < 0.3) continue;
    for (const c of cs) if (c.p && dist2D(c.p, gh.p) < 11) flee(c);
  }
  // dogs near eaters
  for (const d of G.state.all('dog')) {
    if (!d.p) continue;
    for (const c of cs) if (c.cs === 'eat' && !c._dogSaid && c.p && dist2D(c.p, d.p) < 2.4) { c._dogSaid = true; say(c, Math.random() < 0.5 ? pickL(L.dog) : pickL(X.dogShoo), { duration: 2.4 }); }
  }
  // players slapping each other
  for (const pl of G.players()) {
    if (pl.anim === 'slap' && pl.animT !== lastSlap.get(pl.id)) {
      lastSlap.set(pl.id, pl.animT);
      const near = cs.filter((c) => c.p && pl.p && dist2D(c.p, pl.p) < 10).slice(0, 2);
      near.forEach((c, i) => { c._sawSlap = true; setTimeout(() => { if (G.state.get(c.id)) say(c, pickL(X.slapLaugh), { duration: 2.2 }); }, 400 + i * 700); });
      if (near.length) G.sfx('crowd_laugh', near[0].p, { vol: 0.4 });
    }
  }
  // seats that got pulled away / knocked over
  for (const c of cs) {
    if (c.seat == null || !['wait', 'eat'].includes(c.cs)) continue;
    const s = G.state.get(c.seat);
    if (!s || s.holder != null || !upright(s) || dist2D(s.p!, c.p!) > 0.35) {
      c.posture = 'floor'; anim(c, 'fall'); G.sfx('body_thud', c.p, { vol: 0.8 });
      say(c, pickL(X.stoolPulled), { style: 'shout', duration: 2.4 });
      c.seat = null;
      setTimeout(() => { if (G.state.get(c.id)) leaveAngry(c, pickL(X.stormOff), 'stool'); }, 1600);
    }
  }
}

export function onGhostScare(d: { p: number[]; r?: number }) {
  for (const c of customers()) if (c.p && d.p && dist2D(c.p, d.p) < (d.r ?? 11) && !['leave', 'flee'].includes(c.cs)) flee(c);
}

function flee(c: Ent) {
  if (c.cs === 'flee' || c.cs === 'leave') return;
  const ate = c.cs === 'eat' && c._t > c._eatT * 0.5;
  if (c.seat != null) standUp(c);
  G.npcs.stop(c);
  c.face = 'scream';
  anim(c, 'scream_run', true);
  say(c, ate ? X.ghostRun[2] : pickL(L.ghost), { style: 'shout', duration: 2.2 });
  G.sfx(c.look?.sex === 'f' ? 'female_scream_comedic' : 'gasp', c.p, { vol: 0.8 });
  stats().ghostScares = (stats().ghostScares ?? 0) + 1;
  if (ate) { const s = G.state.get(c._by) ?? G.nearestPlayer(c.p!, 60); if (s) G.money(s.id, menuPrice(G, c.ord?.r ?? 'kaphrao_moo'), 'restaurant', head(c)); }
  const it = G.state.get(c._dish);
  if (it && it.holder === c.id) { G.items.detach(it); G.items.toWorld(it, [c.p![0], c.p![1] + 0.9, c.p![2]], [0, 1, 0]); }
  setCS(c, 'flee');
  const cf = cartFrame();
  const away = new THREE.Vector3(c.p![0] - cf.p[0], 0, c.p![2] - cf.p[2]).normalize().multiplyScalar(35);
  go(c, [c.p![0] + away.x, c.p![1], c.p![2] + away.z], 4.5, () => G.state.despawn(c));
}

/** HOST: called on 'item:picked' — a customer's dish / seat was taken by a player. */
export function onItemPicked(d: { player: number; item: number }) {
  for (const c of customers()) {
    if (c._dish === d.item && c.cs === 'eat') leaveAngry(c, pickL(X.foodStolen), 'stolen');
  }
}

/** HOST: dish (or drink) placed on a table near a waiting customer's spot → served. */
export function onItemPlaced(d: { player: number; item: number }) {
  const it = G.state.get(d.item);
  const pl = G.state.get(d.player);
  if (!it || !pl || !it.p) return;
  if (it.k !== 'dish' && !isDrink(it)) return;
  let best: Ent | null = null, bd = 0.45;
  for (const c of customers()) {
    if (!c.spot || !ORDERED.concat(['wait', 'eat'] as CS[]).includes(c.cs)) continue;
    if (it.k === 'dish' && c.cs === 'eat') continue;
    const dd = dist2D(c.spot, it.p);
    if (dd < bd) { bd = dd; best = c; }
  }
  if (best) serve(pl, best, it);
}

/** Orders as text for UI (look-at tag / ticket). */
export function orderText(c: Ent) { return c.ord ? orderShort(G, c.ord) : ''; }

export { SPICY_RECIPES, pick };
