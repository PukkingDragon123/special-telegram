import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { tl } from '../../core/util';
import { ING } from './data';
import { RECIPES, WokData, EggState, evaluate, cookParams, classifyEgg, qualityWord, ISSUE_TH, DEFAULT_UNLOCKED } from './recipes';
import { burnerOf } from './cart';
import { entPos, nearPlayer, sfx, rd, clamp01 } from './util';
import { amountOf } from './items';

/* =============================================================================================
 * HOST COOKING SIMULATION
 *  - continuous "hold" acts (pour / stir / chop / pound / whisk / scoop) per player via 'cook.act'
 *  - discrete intents: crack egg, plate, spoon, bag, rice cooker, egg tray, toss/flip, dump, read
 *  - wok thermal model + per-ingredient cook/burn, fried egg & omelette models, rice cooker
 * Vessel state lives in e.data (quantized, replicated ~10 Hz); full precision in e._s (host only).
 * ============================================================================================= */

interface Act { a: string; src?: number; dst?: number; t: number; last: number; base?: number }
const acts = new Map<number, Act>();

/** Who may receive what (shared with the client provider). */
export function canPourInto(srcKind: string, dst: Ent | null | undefined): boolean {
  if (!dst || dst.t !== 'item') return false;
  const d = ING[srcKind];
  switch (dst.k) {
    case 'wok': return !!d ? d.into !== 'raw' && d.into !== 'egg' : ['mortar', 'chopping_board', 'bowl', 'plate', 'takeaway_box'].includes(srcKind);
    case 'mortar': return !!d?.mortar;
    case 'chopping_board': return !!d?.board;
    case 'bowl': return !!d?.bowl;
    case 'rice_pot': return !!d?.pot;
    default: return false;
  }
}

// ------------------------------------------------------------------ host scratch state

const isVessel = (e: Ent) => e.k === 'wok' || e.k === 'mortar' || e.k === 'chopping_board' || e.k === 'bowl' || e.k === 'rice_pot';
function S(e: Ent): any {
  const js = JSON.stringify(e.data);
  if (!e._s || e._pub !== js) { e._s = JSON.parse(js ?? '{}'); e._pub = js; }
  return e._s;
}
const q = (v: number, d: number) => rd(v ?? 0, d);
function publish(e: Ent) {
  const s = e._s;
  if (!s) return;
  let out: any;
  if (e.k === 'wok') {
    const it: any = {};
    for (const [k, v] of Object.entries<any>(s.it ?? {})) if (v && v.g > 0.05) it[k] = { g: q(v.g, 1), c: q(v.c, 2), b: q(v.b, 2), p: q(v.p ?? 0, 2) };
    const sa: any = {};
    for (const [k, v] of Object.entries<any>(s.sa ?? {})) if (v > 0.05) sa[k] = q(v, 1);
    out = { T: Math.round(s.T ?? 25), oil: q(s.oil, 1), w: q(s.w, 1), it, sa, wh: q(s.wh ?? 0, 2), ob: q(s.ob ?? 0, 2), st: q(s.st ?? 0, 1), sm: q(s.sm ?? 0, 2) };
    if (s.egg && s.egg.n > 0) out.egg = { n: s.egg.n, wh: q(s.egg.wh, 2), cr: q(s.egg.cr, 2), yk: q(s.egg.yk, 2), b: q(s.egg.b, 2) };
    if (s.om && s.om.n > 0) out.om = { n: s.om.n, c: q(s.om.c, 2), cr: q(s.om.cr, 2), b: q(s.om.b, 2), f: s.om.f ? 1 : 0, w: q(s.om.w, 2), fish: q(s.om.fish, 1) };
  } else if (e.k === 'mortar' || e.k === 'chopping_board') {
    const it: any = {};
    for (const [k, v] of Object.entries<any>(s.it ?? {})) if (v && v.g > 0.05) it[k] = { g: q(v.g, 1) };
    out = { ...s, it };
    if (e.k === 'mortar') out.pound = q(s.pound ?? 0, 2); else out.chop = q(s.chop ?? 0, 2);
  } else if (e.k === 'rice_pot') {
    out = { g: q(s.g, 0), raw: q(s.raw, 0), water: q(s.water, 0), cook: q(s.cook, 2), on: !!s.on, q: q(s.q ?? 1, 2), wet: q(s.wet ?? 0, 2) };
  } else {
    out = JSON.parse(JSON.stringify(s));
    if (out.whisk !== undefined) out.whisk = q(out.whisk, 2);
    if (out.rice !== undefined) out.rice = q(out.rice, 0);
    if (out.sa) for (const k of Object.keys(out.sa)) out.sa[k] = q(out.sa[k], 1);
  }
  e.data = out;
  e._pub = JSON.stringify(out);
}

// ------------------------------------------------------------------ adding stuff

function wokHeatCap(s: any) {
  let solids = 0;
  for (const [k, v] of Object.entries<any>(s.it ?? {})) solids += (v?.g ?? 0) * (ING[k]?.cp ?? 0.8);
  solids += (s.egg?.n ?? 0) * 50 * 0.8 + (s.om?.n ?? 0) * 55 * 0.8;
  return 1.0 + solids / 1000 * 3.0 + (s.oil ?? 0) / 1000 * 1.8 + (s.w ?? 0) / 1000 * 4.2;
}

function mixTemp(s: any, amt: number, tIn: number, cp: number) {
  const C = wokHeatCap(s), Ci = amt / 1000 * cp * 3.6;
  s.T = ((s.T ?? 25) * C + tIn * Ci) / (C + Ci);
}

/** HOST: add an amount of an ingredient into a wok's scratch state. Returns sizzle strength. */
export function addToWok(game: Game, wok: Ent, kind: string, amt: number, extra: { p?: number; c?: number; b?: number } = {}) {
  const s = S(wok);
  s.it ??= {}; s.sa ??= {};
  const d = ING[kind];
  const T0 = s.T ?? 25;
  const into = d?.into ?? 'it';
  if (into === 'oil') { mixTemp(s, amt, d.temp ?? 28, 0.5); s.oil = (s.oil ?? 0) + amt; }
  else if (into === 'w') { mixTemp(s, amt, d.temp ?? 28, 1.15); s.w = (s.w ?? 0) + amt; }
  else if (into === 'sa') { mixTemp(s, amt, 26, 0.9); s.sa[kind] = (s.sa[kind] ?? 0) + amt; }
  else {
    mixTemp(s, amt, d?.temp ?? 26, d?.cp ?? 0.8);
    const cur = s.it[kind] ?? { g: 0, c: 0, b: 0, p: 0 };
    const g = cur.g + amt;
    cur.c = (cur.c * cur.g + (extra.c ?? 0) * amt) / g;
    cur.b = (cur.b * cur.g + (extra.b ?? 0) * amt) / g;
    cur.p = ((cur.p ?? 0) * cur.g + (extra.p ?? 0) * amt) / g;
    cur.g = g;
    s.it[kind] = cur;
  }
  return T0;
}

function flare(game: Game, wok: Ent, k: number) {
  const now = performance.now() / 1000;
  if (now - (wok._flareT ?? 0) < 0.55) return;
  wok._flareT = now;
  const s = S(wok);
  s.wh = Math.min(1, (s.wh ?? 0) + 0.2 * k);
  const cart = burnerOf(game, wok);
  game.emit('cook:flare', { wok: wok.id, cart: cart?.id, k: rd(k, 2) });
  const p = entPos(game, wok);
  sfx(game, ['fire_whoosh'], p, { vol: 0.6 + k * 0.4 });
}

// ------------------------------------------------------------------ intents

export function installCookIntents(game: Game) {
  const items = game.items;
  const held = (pl: Ent, id: number | undefined) => { const e = game.state.get(id); return e && e.holder === pl.id ? e : null; };

  game.onIntent('cook.act', (pl, d: { a: string; src?: number; dst?: number; on: boolean }) => {
    const now = performance.now() / 1000;
    const cur = acts.get(pl.id);
    if (!d.on) { if (cur) stopAct(game, pl, cur); return; }
    if (cur && cur.a === d.a && cur.src === d.src && cur.dst === d.dst) { cur.last = now; return; }
    if (cur) stopAct(game, pl, cur);
    const dst = game.state.get(d.dst);
    if (!dst || !nearPlayer(game, pl, dst, 3.6)) return;
    const src = d.src != null ? game.state.get(d.src) : null;
    if (d.a === 'pour' || d.a === 'scoop') { if (!src || src.holder !== pl.id) return; }
    const act: Act = { a: d.a, src: d.src, dst: d.dst, t: 0, last: now };
    acts.set(pl.id, act);
    startActFx(game, pl, act, src, dst);
  });

  game.onIntent('cook.crack', (pl, d: { egg: number; dst: number }) => {
    const egg = held(pl, d.egg);
    const dst = game.state.get(d.dst);
    if (!egg || egg.k !== 'egg' || !dst || !nearPlayer(game, pl, dst, 3.6)) return;
    const p = entPos(game, dst);
    if (dst.k === 'wok') {
      const s = S(dst);
      const solids = Object.values<any>(s.it ?? {}).reduce((a, v) => a + (v?.g ?? 0), 0);
      if (solids > 25) addToWok(game, dst, 'egg_scr', 50);
      else { mixTemp(s, 50, 8, 0.85); s.egg = s.egg?.n ? { ...s.egg, n: s.egg.n + 1, wh: s.egg.wh * 0.6, cr: s.egg.cr * 0.6 } : { n: 1, wh: 0, cr: 0, yk: 0, b: 0 }; }
      publish(dst);
      sfx(game, 'egg_crack', p, { vol: 0.9 });
      if ((s.T ?? 25) > 130) sfx(game, ['sizzle_burst'], p, { vol: Math.min(1, (s.T - 100) / 120) });
    } else if (dst.k === 'bowl') {
      const s = S(dst);
      s.egg = (s.egg ?? 0) + 1;
      s.whisk = (s.whisk ?? 0) * ((s.egg - 1) / s.egg);
      publish(dst);
      sfx(game, 'egg_crack', p, { vol: 0.8 });
    } else return;
    items.remove(egg);
  });

  game.onIntent('cook.plate', (pl, d: { vessel: number; wok: number }) => {
    const vessel = game.state.get(d.vessel), wok = game.state.get(d.wok);
    if (!vessel || !wok || wok.k !== 'wok') return;
    if (vessel.holder !== pl.id && wok.holder !== pl.id) return;
    if (!nearPlayer(game, pl, vessel, 3.6) || !nearPlayer(game, pl, wok, 3.6)) return;
    plateFromWok(game, pl, vessel, wok);
  });

  game.onIntent('cook.spoon', (pl, d: { spoon: number; dish: number }) => {
    const sp = held(pl, d.spoon), dish = game.state.get(d.dish);
    if (!sp || sp.k !== 'spoon_fork' || !dish || dish.k !== 'dish' || dish.data?.spoon || !nearPlayer(game, pl, dish, 3.6)) return;
    dish.data = { ...dish.data, spoon: true, issues: (dish.data.issues ?? []).filter((i: string) => i !== 'no_spoon') };
    items.remove(sp);
    sfx(game, 'spoon_clink', entPos(game, dish), { vol: 0.8 });
  });

  game.onIntent('cook.bag', (pl, d: { bag: number; dish: number }) => {
    const bag = held(pl, d.bag), dish = game.state.get(d.dish);
    if (!bag || bag.k !== 'plastic_bag' || !dish || dish.k !== 'dish' || dish.data?.bag || !nearPlayer(game, pl, dish, 3.6)) return;
    dish.data = { ...dish.data, bag: true, takeaway: true };
    items.remove(bag);
    sfx(game, 'plastic_bag_rustle', entPos(game, dish), { vol: 0.9 });
  });

  game.onIntent('cook.rice', (pl, d: { pot: number }) => {
    const pot = game.state.get(d.pot);
    if (!pot || pot.k !== 'rice_pot' || !nearPlayer(game, pl, pot, 3.4)) return;
    const s = S(pot);
    const p = entPos(game, pot);
    if (s.on) { s.on = false; publish(pot); sfx(game, ['rice_cooker_click'], p); return; }
    if ((s.raw ?? 0) < 50) { game.say(pl.id, tl('ใส่ข้าวสารก่อนสิ!', 'add raw rice first!'), { duration: 2 }); return; }
    if ((s.water ?? 0) < 30) { game.say(pl.id, tl('ลืมใส่น้ำ!', 'forgot the water!'), { duration: 2 }); return; }
    s.on = true; s.cook = 0;
    publish(pot);
    sfx(game, ['rice_cooker_click'], p, { vol: 0.9 });
  });

  game.onIntent('cook.takeEgg', (pl, d: { tray: number }) => {
    const tray = game.state.get(d.tray);
    if (!tray || tray.k !== 'egg_tray' || (tray.data?.n ?? 0) <= 0 || !nearPlayer(game, pl, tray, 3.4)) return;
    if (items.freeSlots(pl) < 1) { game.emit('item:full', { player: pl.id }); return; }
    tray.data = { ...tray.data, n: tray.data.n - 1 };
    items.give(pl, 'egg');
    sfx(game, 'pickup', pl.p, { vol: 0.5, pitch: 1.3 });
  });

  game.onIntent('cook.toss', (pl, d: { wok: number }) => {
    const wok = game.state.get(d.wok);
    const tool = items.selected(pl);
    if (!wok || wok.k !== 'wok' || !tool || !(tool.k === 'spatula' || tool.k === 'ladle') || !nearPlayer(game, pl, wok, 3.4)) return;
    const s = S(wok);
    const p = entPos(game, wok);
    if (s.om?.n) { s.om.f = 1; sfx(game, ['wok_toss'], p); }
    else {
      s.st = 1.5;
      sfx(game, ['wok_toss'], p);
      const liquid = Object.entries<any>(s.sa ?? {}).reduce((a, [k, v]) => a + (ING[k]?.unit === 'ml' || k === 'oyster_sauce' ? v : 0), 0) + (s.w ?? 0);
      if ((s.T ?? 25) > 200 && liquid > 5) flare(game, wok, Math.min(1, ((s.T ?? 25) - 190) / 80));
    }
    if (s.egg?.n && s.egg.wh > 0.5) { s.egg.yk += 0.08; }
    publish(wok);
    pl.anim = 'cook_stir'; pl.animT = game.g.time + Math.random(); pl.animLoop = false;
  });

  game.onIntent('cook.dump', (pl, d: { id: number }) => {
    const e = game.state.get(d.id);
    if (!e || !nearPlayer(game, pl, e, 3.4)) return;
    const p = entPos(game, e);
    if (e.k === 'wok') e.data = { T: e.data?.T ?? 25, oil: 0, w: 0, it: {}, sa: {} };
    else if (e.k === 'mortar') e.data = { it: {}, pound: 0 };
    else if (e.k === 'chopping_board') e.data = { it: {}, chop: 0 };
    else if (e.k === 'bowl') e.data = { dirty: true, rice: 0, egg: 0, whisk: 0, sa: {} };
    else if (e.k === 'plate' || e.k === 'takeaway_box') e.data = { ...e.data, rice: 0, dirty: e.k === 'plate' ? true : e.data?.dirty };
    else return;
    e._s = null; e._pub = null;
    sfx(game, ['liquid_splash', 'drop_soft'], p, { vol: 0.7 });
  });

  game.onIntent('cook.read', (pl, d: { on: boolean }) => {
    if (d.on) {
      const book = items.selected(pl);
      if (!book || book.k !== 'recipe_book' || (pl.mode && pl.mode !== 'free')) return;
      pl.mode = 'book';
      sfx(game, ['book_open', 'page_turn'], pl.p, { vol: 0.7 });
    } else if (pl.mode === 'book') {
      pl.mode = 'free';
      sfx(game, ['page_turn', 'book_open'], pl.p, { vol: 0.5, pitch: 0.8 });
    }
  });
  game.onIntent('cook.page', (pl, d: { page: number }) => {
    const book = items.selected(pl);
    if (book?.k === 'recipe_book') { book.data = { ...book.data, page: d.page | 0 }; sfx(game, 'page_turn', pl.p, { vol: 0.6 }); }
  });
}

function startActFx(game: Game, pl: Ent, a: Act, src: Ent | null | undefined, dst: Ent) {
  const p = entPos(game, dst);
  if (a.a === 'pour' && src) {
    src.act = 'pour';
    if (dst.k === 'wok') {
      const s = S(dst);
      a.base = s.T;
      const hot = (s.T ?? 25) > 140;
      const d = ING[src.k];
      if (hot && d && d.into !== 'sa') sfx(game, ['sizzle_burst'], p, { vol: Math.min(1, ((s.T ?? 25) - 100) / 110) });
      if (d?.kind === 'chili' && (s.T ?? 25) > 180) setTimeout(() => sneeze(game, dst), 900);
    }
  } else if (a.a === 'stir') { dst.act = 'stir'; if (src) src.act = 'stir'; pl.anim = 'cook_stir'; pl.animT = game.g.time + Math.random(); pl.animLoop = true; }
  else if (a.a === 'chop') { dst.act = 'chop'; if (src) src.act = 'chop'; pl.anim = 'chop'; pl.animT = game.g.time + Math.random(); pl.animLoop = true; }
  else if (a.a === 'pound') { dst.act = 'pound'; pl.anim = 'chop'; pl.animT = game.g.time + Math.random(); pl.animLoop = true; }
  else if (a.a === 'whisk') { dst.act = 'whisk'; pl.anim = 'cook_stir'; pl.animT = game.g.time + Math.random(); pl.animLoop = true; }
  else if (a.a === 'scoop') { dst.act = 'scoop'; if (src) src.act = 'scoop'; sfx(game, ['rice_scoop'], p, { vol: 0.8 }); }
}

function stopAct(game: Game, pl: Ent, a: Act) {
  acts.delete(pl.id);
  for (const id of [a.src, a.dst]) { const e = game.state.get(id); if (e && e.act) delete e.act; }
  if (['stir', 'chop', 'pound', 'whisk'].includes(a.a) && pl.mode !== 'push') { pl.anim = 'idle'; pl.animT = game.g.time + Math.random(); pl.animLoop = true; }
  const dst = game.state.get(a.dst);
  if (dst && isVessel(dst) && dst._s) publish(dst);
}

function sneeze(game: Game, wok: Ent) {
  const p = entPos(game, wok);
  if (!p) return;
  const pl = game.nearestPlayer([p.x, p.y, p.z], 3);
  if (!pl) return;
  const r = Math.random();
  sfx(game, r < 0.5 ? 'sneeze' : 'cough', pl.p, { vol: 0.8 });
  game.say(pl.id, r < 0.5 ? tl('ฮัดชิ่ววว!', 'achoo!') : tl('แค่กๆ ฉุนพริก!', '*cough* chili fumes!'), { duration: 1.6, voice: 0 });
}

// ------------------------------------------------------------------ plating

function eggScoreLite(e: EggState) {
  const white = clamp01((e.wh - 0.3) / 0.7), crisp = clamp01(e.cr / 0.6), yolk = e.yk < 0.6 ? 1 : e.yk < 1.2 ? 0.75 : 0.55, burn = clamp01(1 - Math.max(0, e.b - 0.25) * 1.6);
  return white * 0.35 + crisp * 0.3 + yolk * 0.15 + burn * 0.2;
}

/** HOST: wok → vessel (plate / bowl / takeaway box / existing dish). */
export function plateFromWok(game: Game, pl: Ent, vessel: Ent, wok: Ent) {
  const s = S(wok);
  const solids = Object.values<any>(s.it ?? {}).reduce((a, v) => a + (v?.g ?? 0), 0);
  const water = s.w ?? 0;
  const eggN = s.egg?.n ?? 0, omN = s.om?.n ?? 0;
  const p = entPos(game, vessel);
  const isDish = vessel.k === 'dish';
  if (solids < 3 && eggN === 0 && omN === 0 && water < 30) { game.say(pl.id, tl('กระทะยังว่างอยู่เลย', 'the wok is empty'), { duration: 1.6 }); return; }
  if (vessel.data?.dirty) { game.say(pl.id, tl('จานสกปรก! ล้างก่อน', 'dirty plate!'), { duration: 1.8 }); return; }
  const unlocked: string[] = game.g.unlocks?.recipes ?? DEFAULT_UNLOCKED;
  void unlocked;
  // fried egg only → one egg goes onto the vessel
  if (solids < 3 && omN === 0 && water < 30 && eggN > 0) {
    const e: EggState = { n: 1, wh: s.egg.wh, cr: s.egg.cr, yk: s.egg.yk, b: s.egg.b };
    if (isDish) {
      if (vessel.data?.egg && vessel.data.egg !== 'none') { game.say(pl.id, tl('มีไข่ดาวแล้ว!', 'already has an egg'), { duration: 1.6 }); return; }
      const dd = { ...vessel.data };
      dd.egg = classifyEgg(e);
      dd.eggSt = { wh: rd(e.wh, 2), cr: rd(e.cr, 2), yk: rd(e.yk, 2), b: rd(e.b, 2) };
      dd.taste = rd(clamp01((dd.taste ?? 0.5) * 0.82 + eggScoreLite(e) * 0.18 + 0.04), 2);
      if (e.wh < 0.8) dd.issues = [...new Set([...(dd.issues ?? []), 'raw_egg'])];
      if (e.b > 0.75) dd.issues = [...new Set([...(dd.issues ?? []), 'burnt_egg'])];
      dd.vis = { ...(dd.vis ?? {}), yolk: e.yk < 0.6 ? 'runny' : 'set' };
      vessel.data = dd;
    } else {
      const dish = evaluate({ T: s.T, oil: s.oil, w: 0, it: {}, sa: {}, egg: e } as WokData, { rice: vessel.data?.rice ?? 0, riceQ: vessel.data?.riceQ, riceWet: vessel.data?.riceWet, egg: e, cook: pl.id });
      replaceWithDish(game, pl, vessel, { ...dish, eggSt: { wh: rd(e.wh, 2), cr: rd(e.cr, 2), yk: rd(e.yk, 2), b: rd(e.b, 2) } });
    }
    s.egg.n -= 1;
    if (s.egg.n <= 0) s.egg = null;
    s.oil = Math.max(0, (s.oil ?? 0) - 6);
    publish(wok);
    sfx(game, ['plate_down'], p, { vol: 0.7 });
    if (!isDish) award(game, pl, vessel);
    return;
  }
  // everything else → evaluate as a dish
  let rice = vessel.data?.rice ?? 0;
  let eggSt: EggState | null = null;
  if (isDish) {
    rice = vessel.data?.rice ?? 0;
    if (vessel.data?.eggSt) eggSt = { n: 1, ...vessel.data.eggSt };
    if ((vessel.data?.portion ?? 0) > 30 && vessel.data?.recipe !== 'khai_dao') { game.say(pl.id, tl('จานนี้มีกับข้าวแล้ว!', 'this plate already has food'), { duration: 1.8 }); return; }
  }
  if (!eggSt && eggN > 0 && (solids >= 3 || omN > 0)) { eggSt = { n: 1, wh: s.egg.wh, cr: s.egg.cr, yk: s.egg.yk, b: s.egg.b }; s.egg.n -= 1; if (s.egg.n <= 0) s.egg = null; }
  const snap: WokData = JSON.parse(JSON.stringify({ T: s.T, oil: s.oil, w: s.w, it: s.it, sa: s.sa, egg: null, om: s.om, wh: s.wh, ob: s.ob }));
  const dish = evaluate(snap, { rice, riceQ: vessel.data?.riceQ, riceWet: vessel.data?.riceWet, egg: eggSt, cook: pl.id, takeaway: vessel.k === 'takeaway_box' });
  replaceWithDish(game, pl, vessel, { ...dish, eggSt: eggSt ? { wh: rd(eggSt.wh, 2), cr: rd(eggSt.cr, 2), yk: rd(eggSt.yk, 2), b: rd(eggSt.b, 2) } : undefined });
  // wok keeps a film of oil
  s.it = {}; s.sa = {}; s.w = 0; s.om = null; s.oil = Math.min(4, (s.oil ?? 0) * 0.08); s.wh = 0; s.ob = (s.ob ?? 0) * 0.5;
  publish(wok);
  sfx(game, ['plate_down'], p, { vol: 0.8 });
  sfx(game, ['spatula_scrape'], p, { vol: 0.6 });
  award(game, pl, vessel);
}

function replaceWithDish(game: Game, pl: Ent, vessel: Ent, data: any) {
  const items = game.items;
  const style = vessel.k === 'plate' ? vessel.data?.style ?? 'flora' : vessel.data?.plate ?? 'flora';
  const vk = vessel.k === 'dish' ? vessel.data?.vessel ?? 'plate' : vessel.k === 'takeaway_box' ? 'box' : vessel.k;
  const full = { ...data, plate: style, vessel: vk, takeaway: vk === 'box' || !!data.takeaway || !!vessel.data?.takeaway, bag: !!vessel.data?.bag };
  if (vessel.data?.spoon) { full.spoon = true; full.issues = (full.issues ?? []).filter((i: string) => i !== 'no_spoon'); }
  const where = { holder: vessel.holder, slot: vessel.slot, in: vessel.in, at: vessel.at, p: entPos(game, vessel), q: vessel.q };
  const wasSel = where.holder === pl.id && pl.inv?.[pl.sel ?? 0] === vessel.id;
  items.remove(vessel);
  let dish: Ent | null;
  if (where.holder != null) {
    const owner = game.state.get(where.holder)!;
    dish = items.spawn('dish', [where.p?.x ?? 0, where.p?.y ?? 0, where.p?.z ?? 0], { data: full, noPhysics: true });
    if (dish && !items.putInInventory(owner, dish)) items.toWorld(dish, [where.p!.x, where.p!.y, where.p!.z]);
    if (wasSel && dish && owner.inv) { const i = owner.inv.indexOf(dish.id); if (i >= 0) owner.sel = i; }
  } else if (where.in != null) {
    dish = items.spawn('dish', [0, 0, 0], { data: full, in: where.in, at: where.at ?? undefined, noPhysics: true });
  } else {
    dish = items.spawn('dish', [where.p?.x ?? 0, (where.p?.y ?? 0), where.p?.z ?? 0], { data: full, q: where.q });
  }
  if (dish) game.events.emit('cook:dish', { player: pl.id, dish: dish.id, data: full });
  return dish;
}

function award(game: Game, pl: Ent, vessel: Ent) {
  // the newest dish by this cook
  const dish = game.state.all('item').filter((e) => e.k === 'dish' && e.data?.cook === pl.id).sort((a, b) => b.id - a.id)[0];
  if (!dish) return;
  const d = dish.data;
  const xp = Math.round(6 + 34 * (d.taste ?? 0));
  game.xp(pl.id, 'cook', xp);
  const p = entPos(game, dish) ?? entPos(game, pl);
  const name = RECIPES[d.recipe]?.name.th ?? 'อะไรสักอย่าง';
  const issue = (d.issues ?? []).find((i: string) => i !== 'no_spoon' && ISSUE_TH[i]);
  if (p) game.popup([p.x, p.y + 0.35, p.z], `${name}${d.egg && d.egg !== 'none' && d.recipe !== 'khai_dao' ? ' + ไข่ดาว' : ''} · ${qualityWord(d.taste ?? 0)}${issue ? ' (' + ISSUE_TH[issue] + ')' : ''}`);
  void vessel;
}

// ------------------------------------------------------------------ host update

let pubAcc = 0, slowAcc = 0;

export function cookHostUpdate(game: Game, dt: number) {
  const now = performance.now() / 1000;
  // ---- hold acts
  for (const [pid, a] of [...acts]) {
    const pl = game.state.get(pid);
    if (!pl) { acts.delete(pid); continue; }
    if (now - a.last > 0.9) { stopAct(game, pl, a); continue; }
    const dst = game.state.get(a.dst);
    const src = a.src != null ? game.state.get(a.src) : null;
    if (!dst || !nearPlayer(game, pl, dst, 3.8) || (a.src != null && (!src || ((a.a === 'pour' || a.a === 'scoop') && src.holder !== pl.id)))) { stopAct(game, pl, a); continue; }
    a.t += dt;
    stepAct(game, pl, a, src, dst, dt);
  }
  // ---- vessels
  pubAcc += dt; slowAcc += dt;
  const pub = pubAcc >= 0.1;
  if (pub) pubAcc = 0;
  const slow = slowAcc >= 1;
  if (slow) slowAcc = 0;
  for (const e of game.state.all('item')) {
    if (e.k === 'wok') {
      const cart = burnerOf(game, e);
      const heat = cart && cart.burner?.on && (cart.gas ?? 0) > 0 ? cart.burner.heat ?? 0.6 : 0;
      const s = S(e);
      const idle = heat === 0 && Math.abs((s.T ?? 25) - 28) < 1 && !s.st;
      if (idle) continue;
      simWok(game, e, s, dt, heat);
      if (pub) publish(e);
    } else if (e.k === 'rice_pot') {
      const s = S(e);
      if (s.on) {
        s.cook = (s.cook ?? 0) + dt / (45 + (s.raw ?? 0) / 60);
        if (s.cook >= 1) {
          const raw = s.raw ?? 0, water = s.water ?? 0;
          const ratio = water / Math.max(1, raw);
          const wet = Math.max(-1, Math.min(1, (ratio - 1.3) / 0.55));
          const made = raw * 2.25;
          const g0 = s.g ?? 0;
          s.wet = (g0 * (s.wet ?? 0) + made * wet) / Math.max(1, g0 + made);
          s.q = (g0 * (s.q ?? 1) + made * (1 - Math.abs(wet))) / Math.max(1, g0 + made);
          s.g = g0 + made; s.raw = 0; s.water = 0; s.on = false; s.cook = 0;
          sfx(game, ['rice_cooker_click'], entPos(game, e), { vol: 1 });
          sfx(game, ['timer_ding'], entPos(game, e), { vol: 0.5, delay: 0.3 } as any);
        }
        if (pub) publish(e);
      }
    } else if (e.k === 'dish' && slow) {
      const d = e.data;
      if (!d || d.temp <= 0) continue;
      const t = Math.max(0, d.temp - 1 / ((d.takeaway ? 900 : 560)));
      const issues: string[] = d.issues ?? [];
      const cold = t < 0.35 && !issues.includes('cold');
      e.data = { ...d, temp: rd(t, 3), issues: cold ? [...issues, 'cold'] : issues };
    }
  }
}

function stepAct(game: Game, pl: Ent, a: Act, src: Ent | null | undefined, dst: Ent, dt: number) {
  const skill = (k: string) => game.skillMul(pl, k);
  switch (a.a) {
    case 'pour': {
      if (!src) return;
      if (src.k === 'mortar' || src.k === 'chopping_board' || src.k === 'bowl' || src.k === 'plate' || src.k === 'takeaway_box' || src.k === 'wok') { transferContainer(game, pl, a, src, dst, dt); return; }
      const d = ING[src.k];
      if (!d || !canPourInto(src.k, dst)) return;
      const have = amountOf(src);
      if (have <= 0.01) return;
      const ramp = Math.min(1, a.t / Math.max(0.05, d.ramp ?? 0.2));
      const amt = Math.min(have, d.rate * (0.15 + 0.85 * ramp) * dt);
      if (amt <= 0) return;
      const field = d.unit === 'ml' ? 'ml' : 'g';
      src.data = { ...src.data, [field]: rd(have - amt, 2) };
      if (dst.k === 'wok') {
        const T0 = addToWok(game, dst, src.k, amt);
        const liquidSauce = d.into === 'sa' && (d.unit === 'ml' || src.k === 'oyster_sauce' || src.k === 'soy_dark' || src.k === 'gravy_starch' || src.k === 'lime');
        if ((liquidSauce || d.into === 'w') && T0 > 205) flare(game, dst, Math.min(1, (T0 - 195) / 90) * (d.into === 'w' ? 0.6 : 1));
        if (d.into === 'w' && T0 > 150 && a.t < 0.1) sfx(game, ['steam_hiss', 'sizzle_burst'], entPos(game, dst), { vol: 0.8 });
      } else {
        const s = S(dst);
        if (dst.k === 'mortar' || dst.k === 'chopping_board') {
          s.it ??= {};
          const cur = s.it[src.k] ?? { g: 0 };
          const tot = Object.values<any>(s.it).reduce((x, v) => x + (v?.g ?? 0), 0);
          const pk = dst.k === 'mortar' ? 'pound' : 'chop';
          s[pk] = (s[pk] ?? 0) * (tot / Math.max(0.01, tot + amt));
          cur.g += amt;
          s.it[src.k] = cur;
        } else if (dst.k === 'bowl') { s.sa ??= {}; s.sa[src.k] = (s.sa[src.k] ?? 0) + amt; }
        else if (dst.k === 'rice_pot') { if (d.into === 'raw') s.raw = (s.raw ?? 0) + amt; else s.water = (s.water ?? 0) + amt; }
      }
      if ((dst._pubT = (dst._pubT ?? 0) + dt) > 0.1) { dst._pubT = 0; publish(dst); }
      return;
    }
    case 'stir': {
      if (dst.k !== 'wok') return;
      const s = S(dst);
      s.st = Math.min(1.5, (s.st ?? 0) + dt * 6 * skill('stir'));
      if (s.egg?.n) {
        if (s.egg.wh < 0.45) { // stirring a raw egg → scrambled
          const n = s.egg.n; s.egg = null; addToWok(game, dst, 'egg_scr', n * 50);
        } else { s.egg.yk += dt * 0.06; s.egg.cr += dt * 0.01; }
      }
      if (s.om?.n && s.om.c < 0.5) { const n = s.om.n; s.om = null; addToWok(game, dst, 'egg_scr', n * 50); }
      return;
    }
    case 'chop': {
      if (dst.k !== 'chopping_board') return;
      const s = S(dst);
      const tot = Object.values<any>(s.it ?? {}).reduce((x, v) => x + (v?.g ?? 0), 0);
      if (tot < 0.5) return;
      const before = s.chop ?? 0;
      s.chop = Math.min(1, before + dt * 0.3 * skill('chop') / (1 + tot / 150));
      if (before < 1 && s.chop >= 1) { game.xp(pl.id, 'prep', 4); sfx(game, ['knife_chop_board'], entPos(game, dst), { vol: 0.9, pitch: 1.2 }); }
      if ((dst._pubT = (dst._pubT ?? 0) + dt) > 0.12) { dst._pubT = 0; publish(dst); }
      return;
    }
    case 'pound': {
      if (dst.k !== 'mortar') return;
      const s = S(dst);
      const tot = Object.values<any>(s.it ?? {}).reduce((x, v) => x + (v?.g ?? 0), 0);
      if (tot < 0.5) return;
      const before = s.pound ?? 0;
      s.pound = Math.min(1, before + dt * 0.36 * skill('pound') / (1 + tot / 80));
      if (before < 1 && s.pound >= 1) game.xp(pl.id, 'prep', 4);
      if ((dst._pubT = (dst._pubT ?? 0) + dt) > 0.12) { dst._pubT = 0; publish(dst); }
      return;
    }
    case 'whisk': {
      if (dst.k !== 'bowl') return;
      const s = S(dst);
      if (!(s.egg > 0)) return;
      const before = s.whisk ?? 0;
      s.whisk = Math.min(1, before + dt * 0.5 * skill('whisk'));
      if (before < 1 && s.whisk >= 1) game.xp(pl.id, 'prep', 2);
      if ((dst._pubT = (dst._pubT ?? 0) + dt) > 0.12) { dst._pubT = 0; publish(dst); }
      return;
    }
    case 'scoop': {
      if (!src || dst.k !== 'rice_pot') return;
      const s = S(dst);
      const have = s.g ?? 0;
      if (have < 1) return;
      const cur = src.data?.rice ?? 0;
      if (cur >= 450) return;
      const amt = Math.min(have, 70 * dt * skill('scoop'), 450 - cur);
      s.g = have - amt;
      const prevQ = src.data?.riceQ ?? 1, prevW = src.data?.riceWet ?? 0;
      const ng = cur + amt;
      src.data = { ...src.data, rice: rd(ng, 1), riceQ: rd((prevQ * cur + (s.q ?? 1) * amt) / ng, 2), riceWet: rd((prevW * cur + (s.wet ?? 0) * amt) / ng, 2) };
      if ((dst._pubT = (dst._pubT ?? 0) + dt) > 0.1) { dst._pubT = 0; publish(dst); }
      return;
    }
  }
}

/** Pour a container's contents (mortar paste, chopped veg, whisked eggs, plated rice, wok food) into the target. */
function transferContainer(game: Game, pl: Ent, a: Act, src: Ent, dst: Ent, dt: number) {
  if (src.k === 'wok') return; // wok → plate is 'cook.plate'
  const s = S(src);
  if (dst.k !== 'wok') return;
  const rate = 70 * dt;
  if (src.k === 'mortar' || src.k === 'chopping_board') {
    const prog = src.k === 'mortar' ? s.pound ?? 0 : s.chop ?? 0;
    let left = rate;
    for (const [k, v] of Object.entries<any>(s.it ?? {})) {
      if (!v || v.g <= 0 || left <= 0) continue;
      const amt = Math.min(v.g, left);
      v.g -= amt; left -= amt;
      addToWok(game, dst, k, amt, { p: prog });
      if (k === 'chili' && (S(dst).T ?? 25) > 180 && Math.random() < dt * 2) sneeze(game, dst);
    }
    for (const k of Object.keys(s.it ?? {})) if ((s.it[k]?.g ?? 0) <= 0.05) delete s.it[k];
    if (!Object.keys(s.it ?? {}).length) { if (src.k === 'mortar') s.pound = 0; else s.chop = 0; }
    publish(src);
    if ((dst._pubT = (dst._pubT ?? 0) + dt) > 0.1) { dst._pubT = 0; publish(dst); }
  } else if (src.k === 'bowl') {
    const n = s.egg ?? 0;
    const ds = S(dst);
    if (n > 0) {
      const solids = Object.values<any>(ds.it ?? {}).reduce((x, v) => x + (v?.g ?? 0), 0);
      const fish = (s.sa?.fish_sauce ?? 0) + (s.sa?.soy_light ?? 0) * 0.7 + (s.sa?.seasoning_sauce ?? 0) * 0.75;
      if (solids < 10 && (ds.oil ?? 0) >= 30 && !ds.om) {
        mixTemp(ds, n * 50, 10, 0.85);
        ds.om = { n, c: 0, cr: 0, b: 0, f: 0, w: s.whisk ?? 0, fish };
        if ((ds.T ?? 25) > 150) sfx(game, ['sizzle_burst'], entPos(game, dst), { vol: 1 });
      } else {
        addToWok(game, dst, 'egg_scr', n * 50);
        for (const [k, v] of Object.entries<any>(s.sa ?? {})) addToWok(game, dst, k, v);
      }
      s.egg = 0; s.whisk = 0; s.sa = {};
      s.dirty = true;
    } else {
      for (const [k, v] of Object.entries<any>(s.sa ?? {})) addToWok(game, dst, k, v);
      s.sa = {};
    }
    publish(src);
    publish(dst);
  } else if (src.k === 'plate' || src.k === 'takeaway_box') {
    const r = src.data?.rice ?? 0;
    if (r <= 0) return;
    const amt = Math.min(r, rate * 1.4);
    addToWok(game, dst, 'rice_cooked', amt, { c: 0.2 });
    src.data = { ...src.data, rice: rd(r - amt, 1) };
    if ((dst._pubT = (dst._pubT ?? 0) + dt) > 0.1) { dst._pubT = 0; publish(dst); }
  }
  void a; void pl;
}

// ------------------------------------------------------------------ wok physics

function simWok(game: Game, e: Ent, s: any, dt: number, heat: number) {
  s.it ??= {}; s.sa ??= {};
  let T = s.T ?? 25;
  let solidsG = 0;
  for (const v of Object.values<any>(s.it)) solidsG += v?.g ?? 0;
  solidsG += (s.egg?.n ?? 0) * 50 + (s.om?.n ?? 0) * 55;
  const C = wokHeatCap(s);
  const Pin = heat * 10.0;
  // raw food releases moisture: it steams (keeps the wok ~110-160 °C) until it is cooked through
  let moist = 0;
  for (const [k, v] of Object.entries<any>(s.it)) {
    if (!v || v.g <= 0) continue;
    const wet = k === 'garlic' || k === 'chili' || k === 'curry_paste' ? 0.3 : (ING[k]?.tags?.includes('meat') || ING[k]?.tags?.includes('veg')) ? 1 : 0.5;
    moist += (v.g / 1000) * wet * Math.max(0, 1 - Math.min(1, v.c)) * 55;
  }
  const Ploss = (T - 25) * 0.025 + (solidsG / 1000) * Math.max(0, T - 100) * 0.035 + (T > 100 ? moist * Math.min(1, (T - 100) / 40) : 0);
  const w = s.w ?? 0;
  if (w > 0.5 && T >= 99.5) {
    const excess = Pin - Ploss;
    if (excess > 0) { s.w = Math.max(0, w - excess / 2.26 * dt); T = 100; }
    else T += excess / C * dt;
  } else T += (Pin - Ploss) / C * dt;
  if (w > 0.5 && T > 100) T = 100;
  T = Math.max(20, Math.min(420, T));
  s.T = T;
  s.st = Math.max(0, (s.st ?? 0) - dt * 2.2);
  const stirring = s.st > 0.3;
  const soup = (s.w ?? 0) > 50;
  const dryOil = (s.oil ?? 0) < 3 + solidsG * 0.012;
  let burning = 0;
  for (const [k, v] of Object.entries<any>(s.it)) {
    if (!v || v.g <= 0) continue;
    const cp = cookParams(k);
    const tMin = cp.tMin ?? 85;
    const f = soup ? Math.max(0, Math.min(1.1, (T - 60) / 40)) * ((cp as any).soup ? 1.25 : 0.85) : Math.max(0, Math.min(1.7, (T - tMin) / (190 - tMin)));
    v.c += f / cp.t * (stirring ? 1.15 : 0.82) * dt;
    if (!soup && (v.c > 0.8 || T > 235)) {
      const burnBase = Math.max(0, T - 188) / 80;
      // small aromatics are protected when buried in plenty of other food
      const crowd = v.g < 40 ? 1 / (1 + Math.max(0, solidsG - v.g) / 90) : 1;
      const before = v.b;
      v.b += burnBase * crowd * (stirring ? 0.14 : 1) * (dryOil ? 2.1 : 1) / cp.b * dt;
      if (before < 0.6 && v.b >= 0.6) sfx(game, ['burnt_smoke_hiss'], entPos(game, e), { vol: 0.9 });
    }
    if (v.b > 0.5) burning = Math.max(burning, v.b);
  }
  // ---- fried egg: white sets, edges crisp in deep hot oil, yolk slowly sets, burns
  const eg = s.egg;
  if (eg?.n) {
    const oil = s.oil ?? 0;
    eg.wh += Math.max(0, Math.min(1.8, (T - 90) / 90)) / 22 * dt;
    eg.cr += Math.min(1, oil / 60) * Math.max(0, Math.min(1.5, (T - 160) / 60)) / 18 * dt;
    eg.yk += Math.max(0, Math.min(1.5, (T - 90) / 100)) / 75 * dt;
    eg.b += (Math.max(0, Math.min(2, (T - 232) / 60)) / 10 + (oil < 12 ? Math.max(0, Math.min(2, (T - 150) / 80)) / 14 : 0) + (eg.cr > 1.1 ? 0.02 : 0)) * dt;
    if (eg.b > 0.6) burning = Math.max(burning, eg.b);
  }
  // ---- omelette: puffs in deep very hot oil, needs a flip
  const om = s.om;
  if (om?.n) {
    const oil = s.oil ?? 0;
    om.cr += Math.min(1, oil / 100) * Math.max(0, Math.min(1.5, (T - 170) / 50)) / 10 * dt;
    om.c += Math.max(0, Math.min(1.6, (T - 100) / 90)) / (om.f ? 16 : 26) * dt;
    om.b += (Math.max(0, (T - 235) / 60) / 12 + (om.c > 1.35 ? 0.04 : 0) + (!om.f && om.c > 0.9 ? 0.03 : 0)) * dt;
    if (om.b > 0.6) burning = Math.max(burning, om.b);
  }
  // ---- oil smoking / burning
  if ((s.oil ?? 0) > 1 && T > 235) s.ob = Math.min(1, (s.ob ?? 0) + (T - 235) / 70 / 25 * dt);
  // noodles & rice soak up liquid
  const soak = ((s.it.noodles_wide?.g ?? 0) + (s.it.rice_cooked?.g ?? 0)) / 1000;
  if (soak > 0 && (s.w ?? 0) > 0 && !soup) s.w = Math.max(0, s.w - soak * 12 * dt);
  // smoke amount (drives smoke VFX on every client)
  const fuel = (s.oil ?? 0) > 1 || solidsG > 5 ? 1 : 0.25;
  s.sm = Math.min(1, Math.max(0, (T - 205) / 110) * fuel + burning * 0.5 + (s.ob ?? 0) * 0.3);
  if (soup) s.sm *= 0.3;
}

export { evaluate };
export const _test = { acts, S, publish };
void THREE;
