import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import type { Action, Ctx } from '../../game/interact';
import { tl, clamp, round, dist3 } from '../../core/util';
import { Sound, SoundHandle } from '../../core/audio';
import { TABLE_KINDS, SODA_KINDS, VESSELS } from './furniture';
import { customers, serve, resolveMad, orderText } from './customers';
import { applyMenuEdit } from './menuposter';
import { recipeInfo } from './data';
import { pickL, X } from './lines';

/* =============================================================================================
 * Service interactions: shop sign (E flip → g.shopOpen), menu board (E close-up), serving
 * customers (LMB with dish / drink on them or their table), water dispenser (hold LMB with a
 * cup), ice bucket, refills, wiping tables (hold LMB with sponge), washing dishes in the tub
 * (hold LMB → scrub → squeaky clean → dish rack), trash bin (tie the full bag).
 * ============================================================================================= */

let G: Game;
const workers = new Map<number, { kind: 'fill' | 'wipe' | 'scrub'; id: number; acc: number }>();
const near = (pl: Ent, e: Ent, r = 3.2) => { const p = G.items.worldPos(e); return !!(p && pl.p && dist3([pl.p[0], pl.p[1] + 1.1, pl.p[2]], [p.x, p.y, p.z]) <= r); };
const sel = (pl: Ent) => G.items.selected(pl);
const isDrink = (e: Ent | null) => !!e && (e.k === 'cup_plastic' || SODA_KINDS.includes(e.k));
const dirtyVessel = (e: Ent) => VESSELS.includes(e.k) && !!e.data?.dirty;

export function bindService(game: Game) { G = game; }

// ------------------------------------------------------------------ host intents

export function installServiceIntents(game: Game) {
  game.onIntent('rest.sign', (pl, d: { id: number }) => {
    const s = game.state.get(d.id);
    if (!s || s.k !== 'shop_sign' || !near(pl, s, 3.6)) return;
    const open = !game.g.shopOpen;
    game.g.shopOpen = open;
    for (const e of game.state.all('item')) if (e.k === 'shop_sign') e.data = { ...e.data, open };
    game.sfx('whoosh_swing', game.items.worldPos(s), { vol: 0.5 });
    game.sfx(open ? 'icecream_cart_bell' : 'paper_rustle', game.items.worldPos(s), { vol: 0.45 });
    game.say(pl.id, open ? tl('เปิดร้านแล้วจ้าาา!', "We're OPEN!") : tl('ปิดร้าน พักก่อน', 'Closing up'), { duration: 2 });
    game.events.emit('restaurant:open', { open, by: pl.id });
  });
  game.onIntent('rest.menu', (_pl, d) => applyMenuEdit(game, d));
  game.onIntent('rest.serve', (pl, d: { cid: number; item?: number }) => {
    const c = game.state.get(d.cid);
    const it = game.state.get(d.item ?? pl.inv?.[pl.sel ?? 0]);
    if (!c || !it || it.holder !== pl.id) return;
    if (!pl.p || !c.p || dist3(pl.p, c.p) > 3.6) return;
    serve(pl, c, it);
  });
  game.onIntent('rest.talk', (pl, d: { cid: number }) => {
    const c = game.state.get(d.cid);
    if (!c || c.role !== 'customer') return;
    if (c.ord) game.say(c.id, { th: 'บอกแล้วไง ' + orderText(c), en: 'I told you: ' + (c.ord.any ? 'anything' : recipeInfo(game, c.ord.r).name.en) }, { voice: c.look?.sex === 'f' ? 1.25 : 0.9, duration: 3.5 });
    else game.say(c.id, pickL(X.waitThink), { style: 'thought', voice: 0, duration: 2 });
    void pl;
  });
  game.onIntent('rest.madReply', (pl, d: { cid: number; pick: number }) => {
    const c = game.state.get(d.cid);
    if (c) resolveMad(c, typeof d.pick === 'number' ? d.pick : -1, pl);
  });
  game.onIntent('rest.work', (pl, d: { kind: 'fill' | 'wipe' | 'scrub'; id: number; on: boolean }) => {
    const prev = workers.get(pl.id);
    if (prev && prev.kind === 'scrub') { const t = game.state.get(prev.id); if (t?.data) t.data = { ...t.data, busy: null }; }
    if (!d.on) { workers.delete(pl.id); if (pl.anim === 'wash' || pl.anim === 'wipe') { pl.anim = 'idle'; pl.animT = game.g.time + Math.random() * 1e-3; pl.animLoop = true; } return; }
    const e = game.state.get(d.id);
    if (!e || !near(pl, e, 3.4)) return;
    workers.set(pl.id, { kind: d.kind, id: d.id, acc: 0 });
    if (d.kind !== 'fill') { pl.anim = d.kind === 'wipe' ? 'wipe' : 'wash'; pl.animT = game.g.time + Math.random() * 1e-3; pl.animLoop = true; }
  });
  game.onIntent('rest.ice', (pl, d: { id: number }) => {
    const b = game.state.get(d.id), cup = sel(pl);
    if (!b || !cup || cup.k !== 'cup_plastic' || cup.data?.dirty || !near(pl, b)) return;
    if ((b.data?.ice ?? 0) < 2) { game.say(pl.id, tl('น้ำแข็งหมด!', 'out of ice!'), { duration: 1.6 }); return; }
    const add = Math.min(4 - (cup.data?.ice ?? 0), 2);
    if (add <= 0) return;
    cup.data = { ...cup.data, ice: (cup.data?.ice ?? 0) + add };
    b.data = { ...b.data, ice: (b.data?.ice ?? 0) - add };
    game.sfx('ice_cubes', game.items.worldPos(b), { vol: 0.7 });
  });
  game.onIntent('rest.refill', (pl, d: { id: number }) => {
    const t = game.state.get(d.id), h = sel(pl);
    if (!t || !h || !near(pl, t)) return;
    if (t.k === 'water_dispenser' && h.k === 'water_bottle_20l') {
      t.data = { ...t.data, water: 18.9 };
      game.items.remove(h);
      game.sfx('sauce_glug', game.items.worldPos(t), { vol: 0.9, pitch: 0.6 });
      game.sfx('grunt', pl.p, { vol: 0.6 });
    } else if (t.k === 'ice_bucket' && h.k === 'ice_bag') {
      t.data = { ...t.data, ice: Math.min(80, (t.data?.ice ?? 0) + (h.data?.ice ?? 40)) };
      game.items.remove(h);
      game.sfx('ice_cubes', game.items.worldPos(t), { vol: 1, pitch: 0.8 });
    }
  });
  game.onIntent('rest.tub.take', (pl, d: { id: number }) => {
    const t = game.state.get(d.id);
    if (!t || !near(pl, t) || game.items.isOverloaded(pl)) return;
    const kids = game.items.contents(t);
    const it = kids.filter((k) => !k.data?.dirty).pop() ?? kids[kids.length - 1];
    if (it && game.items.putInInventory(pl, it)) { game.sfx('water_splash', game.items.worldPos(t), { vol: 0.4 }); game.events.emit('item:picked', { player: pl.id, item: it.id, from: t.id }); }
  });
  game.onIntent('rest.bin.tie', (pl, d: { id: number }) => {
    const b = game.state.get(d.id);
    if (!b || b.k !== 'trash_bin' || !near(pl, b)) return;
    const kids = game.items.contents(b);
    if (kids.length < 3) return;
    for (const k of kids) game.items.remove(k);
    const p = game.items.worldPos(b)!;
    game.items.spawn('trash_bag', [p.x + 0.45, p.y + 0.1, p.z], { vel: [0.5, 1, 0] });
    game.sfx('plastic_bag_rustle', p, { vol: 0.9 });
    game.xp(pl.id, 'clean', 3);
    game.say(pl.id, tl('มัดถุงขยะเรียบร้อย', 'bag tied up'), { duration: 1.6 });
  });
}

/** HOST, 30 Hz: progress of held work actions. */
export function serviceHost(dt: number) {
  for (const [pid, w] of [...workers]) {
    const pl = G.state.get(pid), e = G.state.get(w.id);
    if (!pl || !e || !near(pl, e, 3.6)) { workers.delete(pid); continue; }
    const h = sel(pl);
    w.acc += dt;
    if (w.kind === 'fill') {
      if (!h || h.k !== 'cup_plastic' || h.data?.dirty) { workers.delete(pid); continue; }
      if ((e.data?.water ?? 0) <= 0.01) { G.say(pl.id, tl('น้ำหมดถัง! เปลี่ยนถังก่อน', 'bottle empty!'), { duration: 1.8 }); workers.delete(pid); continue; }
      const f = Math.min(1, (h.data?.fill ?? 0) + dt * 0.45);
      if (f >= 1 && (h.data?.fill ?? 0) >= 1) { workers.delete(pid); continue; }
      if (w.acc > 0.15) { h.data = { ...h.data, fill: round(f, 2) }; e.data = { ...e.data, water: round(Math.max(0, (e.data?.water ?? 0) - w.acc * 0.12), 2) }; w.acc = 0; }
      if (f >= 1) { h.data = { ...h.data, fill: 1 }; G.sfx('drop_plastic', G.items.worldPos(e), { vol: 0.2, pitch: 1.6 }); workers.delete(pid); }
    } else if (w.kind === 'wipe') {
      if (!h || h.k !== 'sponge' || !TABLE_KINDS.includes(e.k)) { workers.delete(pid); continue; }
      const m0 = e.data?.mess ?? 0;
      if (m0 <= 0) { workers.delete(pid); continue; }
      if (w.acc > 0.2) {
        const m = Math.max(0, m0 - w.acc * 0.4 * G.skillMul(pl, 'clean') * G.skillMul(pl, 'wipe'));
        e.data = { ...e.data, mess: round(m, 2) };
        G.xp(pid, 'clean', (m0 - m) * 8);
        w.acc = 0;
        if (m <= 0) { G.sfx('sparkle_chime', G.items.worldPos(e), { vol: 0.4 }); G.popup([e.p![0], e.p![1] + 0.95, e.p![2]], 'สะอาด!', { font: '"Kodchasan"', size: 52, weight: 700, color: '#bff7ff', stroke: '#14424a', strokeWidth: 6 }); workers.delete(pid); }
      }
    } else if (w.kind === 'scrub') {
      if (e.k !== 'wash_tub') { workers.delete(pid); continue; }
      const kids = G.items.contents(e);
      const dirt = kids.filter(dirtyVessel);
      if (!dirt.length) { e.data = { ...e.data, busy: null, scrub: 0 }; workers.delete(pid); continue; }
      const mul = (h?.k === 'sponge' ? 1 : 0.45) * G.skillMul(pl, 'wash') * G.skillMul(pl, 'clean') * (0.6 + 0.4 * (e.data?.soap ?? 1));
      const s = (e.data?.scrub ?? 0) + dt * mul / 2.4;
      if (s >= 1) {
        const it = dirt[dirt.length - 1];
        it.data = { ...it.data, dirty: false };
        if (it.k === 'cup_plastic') it.data = { fill: 0, ice: 0, dirty: false };
        e.data = { ...e.data, scrub: 0, busy: pid, dirt: round(Math.min(1, (e.data?.dirt ?? 0) + 0.07), 2), soap: round(Math.max(0.15, (e.data?.soap ?? 1) - 0.05), 2) };
        const p = G.items.worldPos(e)!;
        G.sfx('squeaky_toy', p, { vol: 0.55, pitch: 1.6 });
        G.sfx('water_splash', p, { vol: 0.5 });
        G.emit('rest:fx', { k: 'clean', p: [p.x, p.y + 0.25, p.z] });
        G.xp(pid, 'clean', 3);
        // clean plates hop into a dish rack nearby
        const rack = G.state.all('item').filter((r) => r.k === 'dish_rack' && r.p && G.items.contents(r).length < 16).sort((a, b) => dist3(a.p!, [p.x, p.y, p.z]) - dist3(b.p!, [p.x, p.y, p.z]))[0];
        if (rack && dist3(rack.p!, [p.x, p.y, p.z]) < 2.6 && VESSELS.includes(it.k)) { G.items.toContainer(it, rack); G.sfx('dishes_stack', rack.p, { vol: 0.5 }); }
        stats_cleaned++;
      } else if (Math.abs(s - (e.data?.scrub ?? 0)) >= 0.05 || e.data?.busy !== pid) e.data = { ...e.data, scrub: round(s, 2), busy: pid };
      else e.data.scrub = s; // (sub-step: not replicated until it moves 5 %)
    }
  }
}
export let stats_cleaned = 0;

/** HOST: after a new bucket of water: tubs refresh (soap back, water clean) every new day. */
export function refreshTubs() { for (const e of G.state.all('item')) if (e.k === 'wash_tub') e.data = { ...e.data, soap: 1, dirt: 0, scrub: 0, busy: null }; }

// ------------------------------------------------------------------ client providers

let fillLoop: SoundHandle | null = null;
let scrubLoop: SoundHandle | null = null;
let workT = 0;

export function serviceProvider(game: Game, openMenu: (id: number) => void) {
  return (ctx: Ctx) => {
    const acts: Action[] = [];
    const hit = ctx.hit, t = hit?.ent, held = ctx.held;
    // ---------------- customers
    if (hit && t && t.t === 'npc' && t.role === 'customer') {
      const ot = orderText(t);
      const waitS = Math.round((t.mood ?? 1) * 100);
      const status = () => (ot ? `สั่ง: ${ot}` : t.cs === 'eat' ? 'กำลังกิน…' : t.cs === 'leave' ? 'กำลังกลับ' : 'ลูกค้า') + (ot && t.cs !== 'eat' ? `  (ใจเย็น ${waitS}%)` : '');
      if (held && (held.k === 'dish' || isDrink(held))) {
        acts.push({ key: 'LMB', label: tl(held.k === 'dish' ? 'เสิร์ฟ' : 'ยื่นน้ำให้', 'serve'), priority: 9, status, run: () => game.intent('rest.serve', { cid: t.id, item: held.id }) });
      }
      acts.push({ key: 'E', label: tl('ถามออเดอร์', 'ask order'), priority: 4, status, run: () => game.intent('rest.talk', { cid: t.id }) });
      return acts;
    }
    if (!t || t.t !== 'item') return acts;
    switch (t.k) {
      case 'shop_sign':
        acts.push({ key: 'E', label: game.g.shopOpen ? tl('พลิกป้าย: ปิดร้าน', 'close shop') : tl('พลิกป้าย: เปิดร้าน!', 'open shop'), priority: 6, run: () => game.intent('rest.sign', { id: t.id }) });
        acts.push({ key: 'R', label: tl('ยกป้าย', 'pick up'), priority: 2, run: () => game.intent('item.pickup', { id: t.id }) });
        break;
      case 'menu_poster':
        acts.push({ key: 'E', label: tl('ดูเมนู / ตั้งราคา', 'menu & prices'), priority: 6, run: () => openMenu(t.id) });
        acts.push({ key: 'F', label: tl('ดูเมนู', 'read menu'), priority: 6, run: () => openMenu(t.id) });
        acts.push({ key: 'R', label: tl('ยกป้าย', 'pick up'), priority: 2, run: () => game.intent('item.pickup', { id: t.id }) });
        break;
      case 'water_dispenser':
        if (held?.k === 'cup_plastic' && !held.data?.dirty) acts.push(holdWork(game, 'fill', t, tl('กดน้ำ', 'fill cup'), () => `เติมน้ำ ${Math.round((game.items.selected(game.me!)?.data?.fill ?? 0) * 100)}%`));
        if (held?.k === 'cup_plastic' && held.data?.dirty) acts.push({ key: 'LMB', label: tl('กดน้ำ', 'fill'), disabled: tl('แก้วสกปรก ล้างก่อน', 'dirty cup') });
        if (held?.k === 'water_bottle_20l') acts.push({ key: 'LMB', label: tl('เปลี่ยนถังน้ำ', 'swap bottle'), priority: 8, run: () => game.intent('rest.refill', { id: t.id }) });
        break;
      case 'ice_bucket':
        if (held?.k === 'cup_plastic') acts.push({ key: 'LMB', label: tl('ตักน้ำแข็ง', 'scoop ice'), priority: 8, run: () => game.intent('rest.ice', { id: t.id }) });
        if (held?.k === 'ice_bag') acts.push({ key: 'LMB', label: tl('เทน้ำแข็งใส่ถัง', 'pour ice'), priority: 8, run: () => game.intent('rest.refill', { id: t.id }) });
        break;
      case 'trash_bin': {
        const n = game.items.contents(t).length;
        if (n >= 3) acts.push({ key: 'E', label: tl(n >= 14 ? 'ขยะเต็ม! มัดถุง' : 'มัดถุงขยะ', 'tie the bag'), priority: 4, run: () => game.intent('rest.bin.tie', { id: t.id }) });
        break;
      }
      case 'wash_tub': {
        const kids = game.items.contents(t);
        const dirty = kids.filter(dirtyVessel).length;
        if (dirty && !(held && VESSELS.includes(held.k))) acts.push(holdWork(game, 'scrub', t, held?.k === 'sponge' ? tl('ขัดจาน', 'scrub') : tl('ถูจานด้วยมือ (ช้า)', 'scrub by hand'), () => `ขัดจาน ${Math.round((game.state.get(t.id)?.data?.scrub ?? 0) * 100)}%  (เหลือ ${game.items.contents(t).filter(dirtyVessel).length})`));
        if (held && (VESSELS.includes(held.k) || held.k === 'spoon_fork')) acts.push({ key: 'LMB', label: tl(held.data?.dirty ? 'ใส่จานลงกะละมัง' : 'ใส่กะละมัง', 'put in tub'), priority: 6, run: () => game.intent('item.put', { slot: ctx.me.sel ?? 0, into: t.id }) });
        if (kids.length) acts.push({ key: 'E', label: kids.some((k) => !k.data?.dirty) ? tl('หยิบจานสะอาด', 'take clean dish') : tl('หยิบจาน', 'take'), priority: 3, run: () => game.intent('rest.tub.take', { id: t.id }) });
        break;
      }
    }
    // tables: wipe / serve the customer sitting there
    if (TABLE_KINDS.includes(t.k)) {
      if (held?.k === 'sponge' && (t.data?.mess ?? 0) > 0) acts.push(holdWork(game, 'wipe', t, tl('เช็ดโต๊ะ', 'wipe table'), () => `เช็ดโต๊ะ ${Math.round((1 - (game.state.get(t.id)?.data?.mess ?? 0)) * 100)}%`));
      if (held && (held.k === 'dish' || isDrink(held))) {
        const cs = customers().filter((c) => c.tbl === t.id && (c.cs === 'wait' || (c.cs === 'eat' && isDrink(held))));
        const pt = hit!.point;
        cs.sort((a, b) => (a.spot ? pt.distanceTo(new THREE.Vector3(a.spot[0], a.spot[1], a.spot[2])) : 9) - (b.spot ? pt.distanceTo(new THREE.Vector3(b.spot[0], b.spot[1], b.spot[2])) : 9));
        if (cs[0]) acts.push({ key: 'LMB', label: tl(`เสิร์ฟ (${orderText(cs[0]) || 'ลูกค้า'})`, 'serve'), priority: 8, run: () => game.intent('rest.serve', { cid: cs[0].id, item: held.id }) });
      }
    }
    // stools with somebody on them
    if (['stool_red', 'stool_blue', 'chair_plastic'].includes(t.k) && customers().some((c) => c.seat === t.id)) {
      acts.push({ key: 'E', label: tl('ดึงเก้าอี้ (มีคนนั่ง!)', 'pull the stool (occupied!)'), priority: 2, run: () => game.intent('item.pickup', { id: t.id }) });
    }
    return acts;
  };
}

function holdWork(game: Game, kind: 'fill' | 'wipe' | 'scrub', t: Ent, label: { th: string; en?: string }, status: () => string): Action {
  return {
    key: 'LMB', label, hold: true, priority: 8, status,
    run: () => { game.intent('rest.work', { kind, id: t.id, on: true }); workT = 0; },
    tick: (_c, dt) => {
      workT += dt;
      const p = game.items.worldPos(t) ?? undefined;
      if (kind === 'fill') { if (!fillLoop || workT > 1.1) { fillLoop?.stop(0.1); fillLoop = Sound.play('cup_fill', { pos: p, vol: 0.6 }); workT = 0; } }
      else if (!scrubLoop) scrubLoop = Sound.loop(kind === 'wipe' ? 'scrub_loop' : 'scrub_loop', { pos: p, vol: kind === 'wipe' ? 0.45 : 0.7, pitch: kind === 'wipe' ? 1.3 : 1 });
    },
    end: () => { game.intent('rest.work', { kind, id: t.id, on: false }); fillLoop?.stop(0.2); fillLoop = null; scrubLoop?.stop(0.25); scrubLoop = null; },
  };
}

void clamp;
