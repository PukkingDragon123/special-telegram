import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import type { Action, Ctx } from '../../game/interact';
import { tl, TL } from '../../core/util';
import { ING } from './data';
import { canPourInto } from './sim';
import { localAct, amountOf } from './items';
import { itemOnBurner } from './cart';
import { CART } from './cartspec';

/* =============================================================================================
 * Client-side interaction provider: what LMB / E / R / F do with the held item on the target.
 * Continuous work (pour, stir, chop, pound, whisk, scoop) is a HOLD action that keeps a host act
 * alive; the tag title shows live amounts ("12 ก. กำลังใส่") like ref1's "1 g Pouring".
 * ============================================================================================= */

const CONTAINERS = new Set(['mortar', 'chopping_board', 'bowl', 'plate', 'takeaway_box']);
const VESSELS = new Set(['plate', 'bowl', 'takeaway_box']);

function amountIn(dst: Ent | undefined, kind: string): number {
  if (!dst?.data) return 0;
  const d = dst.data;
  const def = ING[kind];
  switch (dst.k) {
    case 'wok':
      if (!def) return 0;
      if (def.into === 'oil') return d.oil ?? 0;
      if (def.into === 'w') return d.w ?? 0;
      if (def.into === 'sa') return d.sa?.[kind] ?? 0;
      return d.it?.[kind]?.g ?? 0;
    case 'mortar': case 'chopping_board': return d.it?.[kind]?.g ?? 0;
    case 'bowl': return d.sa?.[kind] ?? 0;
    case 'rice_pot': return def?.into === 'raw' ? d.raw ?? 0 : d.water ?? 0;
  }
  return 0;
}

const solidsOf = (d: any) => Object.values<any>(d?.it ?? {}).reduce((a, v) => a + (v?.g ?? 0), 0);
const hasFood = (w: Ent) => { const d = w.data ?? {}; return solidsOf(d) > 2 || (d.egg?.n ?? 0) > 0 || (d.om?.n ?? 0) > 0 || (d.w ?? 0) > 30; };
const hasContents = (e: Ent) => {
  const d = e.data ?? {};
  if (e.k === 'wok') return hasFood(e) || (d.oil ?? 0) > 1;
  if (e.k === 'mortar' || e.k === 'chopping_board') return solidsOf(d) > 0.5;
  if (e.k === 'bowl') return (d.egg ?? 0) > 0 || Object.values<any>(d.sa ?? {}).some((v) => v > 0.5) || (d.rice ?? 0) > 1;
  if (e.k === 'plate' || e.k === 'takeaway_box') return (d.rice ?? 0) > 1;
  return false;
};

export function cookingProvider(game: Game) {
  const get = (id: number) => game.state.get(id);

  /** Generic host-backed hold action. */
  const holdAct = (a: string, src: Ent | null, dst: Ent, label: TL, priority: number, status: () => string): Action => {
    let keep = 0;
    const msg = (on: boolean) => game.intent('cook.act', { a, src: src?.id, dst: dst.id, on });
    return {
      key: 'LMB', label, hold: true, priority, status,
      run: () => { keep = 0.3; msg(true); if (src) localAct.set(src.id, a); if (a !== 'pour' && a !== 'scoop') localAct.set(dst.id, a); },
      tick: (_c, dt) => { keep -= dt; if (keep <= 0) { keep = 0.3; msg(true); } },
      end: () => { msg(false); if (src) localAct.delete(src.id); localAct.delete(dst.id); },
    };
  };

  /** Resolve what we're working on: an item, or the wok sitting on a cart burner we're looking at. */
  const target = (ctx: Ctx): Ent | null => {
    const h = ctx.hit;
    if (!h) return null;
    if (h.ent?.t === 'item') return h.ent;
    if (h.kind === 'cart' && h.ent) {
      const lp = h.object.worldToLocal(h.point.clone());
      if (Math.hypot(lp.x - CART.burner.x, lp.z - CART.burner.z) < 0.3 && lp.y > 0.5) return itemOnBurner(game, h.ent);
    }
    return null;
  };

  return (ctx: Ctx): Action[] | null => {
    const acts: Action[] = [];
    const held = ctx.held;
    const t = target(ctx);
    const hk = held?.k;
    // ------------------------------------------------ recipe book
    if (hk === 'recipe_book') {
      acts.push({ key: 'F', label: tl('อ่านสูตร', 'read'), priority: 8, run: () => game.events.emit('cook:openBook', held!.id) });
      if (!ctx.hit && !ctx.surface) acts.push({ key: 'LMB', label: tl('อ่านสูตร', 'read'), priority: 0, run: () => game.events.emit('cook:openBook', held!.id) });
    }
    // ------------------------------------------------ egg tray: take one egg
    if (t?.k === 'egg_tray' && t.holder == null) {
      if ((t.data?.n ?? 0) > 0) acts.push({ key: 'E', label: tl('หยิบไข่ 1 ฟอง', 'take an egg'), priority: 3, run: () => game.intent('cook.takeEgg', { tray: t.id }) });
      acts.push({ key: 'F', label: tl('ยกทั้งแผง', 'pick up tray'), priority: 2, run: () => game.intent('item.pickup', { id: t.id }) });
    }
    // ------------------------------------------------ rice cooker button
    if (t?.k === 'rice_pot') {
      const on = !!t.data?.on;
      acts.push({ key: 'R', label: tl(on ? 'หยุดหุง' : 'กดหุงข้าว', on ? 'stop' : 'cook rice'), priority: 6, run: () => game.intent('cook.rice', { pot: t.id }) });
    }
    if (!held) {
      if (t && t.k === 'mortar' && solidsOf(t.data) > 0.5) acts.push(holdAct('pound', null, t, tl('ตำ', 'pound'), 6, () => `ตำ ${Math.round((get(t.id)?.data?.pound ?? 0) * 100)}%`));
      if (t && t.k === 'bowl' && (t.data?.egg ?? 0) > 0) acts.push(holdAct('whisk', null, t, tl('ตีไข่', 'whisk'), 6, () => `ตีไข่ ${Math.round((get(t.id)?.data?.whisk ?? 0) * 100)}%`));
      return acts;
    }
    const hdef = ING[hk!];
    // ------------------------------------------------ R: dump the held vessel
    if (CONTAINERS.has(hk!) || hk === 'wok') {
      if (hasContents(held) && !(t?.k === 'rice_pot')) acts.push({ key: 'R', label: tl('เททิ้ง', 'dump'), priority: 1, run: () => game.intent('cook.dump', { id: held.id }) });
    }
    if (!t) return acts;
    // ------------------------------------------------ ingredient → vessel (pour)
    if (hdef && hk !== 'egg' && canPourInto(hk!, t)) {
      const name = hdef.name.th;
      const unit = hdef.unit === 'ml' ? 'มล.' : 'ก.';
      let base = 0;
      const a = holdAct('pour', held, t, tl(`${hdef.verb}${name}`, 'pour'), 7, () => {
        const have = amountOf(get(held.id));
        if (have <= 0.05) return `${name} หมดแล้ว!`;
        const d = amountIn(get(t.id), hk!) - base;
        return `${d < 9.95 ? (Math.round(d * 10) / 10).toFixed(1) : Math.round(d)} ${unit} กำลัง${hdef.verb}`;
      });
      const run0 = a.run!;
      a.run = (c) => { base = amountIn(get(t.id), hk!); run0(c); };
      acts.push(a);
    }
    // ------------------------------------------------ egg → wok / bowl
    if (hk === 'egg' && (t.k === 'wok' || t.k === 'bowl')) {
      acts.push({ key: 'LMB', label: tl('ตอกไข่', 'crack egg'), priority: 7, run: () => game.intent('cook.crack', { egg: held.id, dst: t.id }) });
    }
    // ------------------------------------------------ spatula / ladle on a wok
    if ((hk === 'spatula' || hk === 'ladle') && t.k === 'wok') {
      acts.push(holdAct('stir', held, t, tl(hk === 'ladle' ? 'คน' : 'ผัด', 'stir'), 7, () => {
        const w = get(t.id)?.data ?? {};
        return `ผัดๆๆ · ${Math.round(w.T ?? 25)}°C`;
      }));
      const om = (t.data?.om?.n ?? 0) > 0;
      acts.push({ key: 'R', label: tl(om ? 'กลับไข่' : 'โยนกระทะ', om ? 'flip' : 'toss'), priority: 7, run: () => game.intent('cook.toss', { wok: t.id }) });
    }
    if ((hk === 'spatula' || hk === 'spoon_fork') && t.k === 'bowl' && (t.data?.egg ?? 0) > 0) {
      acts.push(holdAct('whisk', null, t, tl('ตีไข่', 'whisk'), 7, () => `ตีไข่ ${Math.round((get(t.id)?.data?.whisk ?? 0) * 100)}%`));
    }
    // ------------------------------------------------ cleaver on the board
    if (hk === 'cleaver' && t.k === 'chopping_board' && solidsOf(t.data) > 0.5) {
      acts.push(holdAct('chop', held, t, tl('หั่น', 'chop'), 7, () => `หั่น ${Math.round((get(t.id)?.data?.chop ?? 0) * 100)}%`));
    }
    // ------------------------------------------------ pound / whisk with anything else in hand
    if (t.k === 'mortar' && solidsOf(t.data) > 0.5 && !(hdef?.mortar)) {
      acts.push(holdAct('pound', null, t, tl('ตำ', 'pound'), 5, () => `ตำ ${Math.round((get(t.id)?.data?.pound ?? 0) * 100)}%`));
    }
    // ------------------------------------------------ vessel at the rice pot: scoop rice
    if (VESSELS.has(hk!) && !held.data?.dirty && t.k === 'rice_pot' && (t.data?.g ?? 0) > 1 && !t.data?.on) {
      acts.push(holdAct('scoop', held, t, tl('ตักข้าว', 'scoop rice'), 7, () => `ข้าว ${Math.round(get(held.id)?.data?.rice ?? 0)} ก.`));
    }
    // ------------------------------------------------ plating: vessel ↔ wok
    if ((VESSELS.has(hk!) || hk === 'dish') && t.k === 'wok' && hasFood(t)) {
      acts.push({ key: 'LMB', label: tl(hk === 'dish' ? 'ตักใส่จานนี้' : 'ตักใส่จาน', 'plate it'), priority: 8, run: () => game.intent('cook.plate', { vessel: held.id, wok: t.id }) });
    }
    if (hk === 'wok' && hasFood(held) && (VESSELS.has(t.k) || t.k === 'dish')) {
      acts.push({ key: 'LMB', label: tl('เทใส่จาน', 'plate it'), priority: 8, run: () => game.intent('cook.plate', { vessel: t.id, wok: held.id }) });
    }
    // ------------------------------------------------ containers → wok (mortar paste, chopped veg, eggs, rice)
    if (CONTAINERS.has(hk!) && t.k === 'wok' && hasContents(held) && !(VESSELS.has(hk!) && hasFood(t) && (held.data?.rice ?? 0) > 1 && hk !== 'bowl')) {
      const lbl = hk === 'mortar' ? 'เทกระเทียมพริกลงกระทะ' : hk === 'chopping_board' ? 'กวาดลงกระทะ' : hk === 'bowl' ? 'เทไข่ลงกระทะ' : 'เทข้าวลงกระทะ';
      let base = 0;
      const a = holdAct('pour', held, t, tl(lbl, 'pour in'), (VESSELS.has(hk!) && hk !== 'bowl') ? 6 : 7, () => `${Math.round(solidsOf(get(t.id)?.data) - base)} ก. ลงกระทะ`);
      const run0 = a.run!;
      a.run = (c) => { base = solidsOf(get(t.id)?.data); run0(c); };
      acts.push(a);
    }
    // ------------------------------------------------ finishing touches on a dish
    if (t.k === 'dish') {
      if (hk === 'spoon_fork' && !t.data?.spoon) acts.push({ key: 'LMB', label: tl('วางช้อนส้อม', 'add spoon & fork'), priority: 8, run: () => game.intent('cook.spoon', { spoon: held.id, dish: t.id }) });
      if (hk === 'plastic_bag' && !t.data?.bag) acts.push({ key: 'LMB', label: tl('ใส่ถุง', 'bag it'), priority: 8, run: () => game.intent('cook.bag', { bag: held.id, dish: t.id }) });
    }
    return acts;
  };
}

export const _v = new THREE.Vector3();
