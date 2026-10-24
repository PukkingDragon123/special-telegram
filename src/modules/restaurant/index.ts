import * as THREE from 'three';
import { defineModule } from '../../game/contracts';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { Sound, SoundHandle } from '../../core/audio';
import { params, tl, round } from '../../core/util';
import { F } from '../../core/fonts';
import { yawTo } from '../../game/mapplan';
import { defineFurniture, TABLE_KINDS, SEAT_KINDS } from './furniture';
import { RestFX, paperCanvas, paperMesh } from './fx';
import { MenuCloseup, refreshPosters } from './menuposter';
import { bindCustomers, customersHost, customers, spawnCustomer, cartFrame, findSeats, serve, onGhostScare, onItemPicked, onItemPlaced, orderText, startMad, spawnRate, seatCustomer } from './customers';
import { bindService, installServiceIntents, serviceHost, serviceProvider, refreshTubs } from './service';
import { bindStats, stats, rollDay, freshStats } from './stats';
import { unlockedRecipes, recipeInfo, DEFAULT_EXTRAS } from './data';
import { stars as starStr } from './lines';

/* =============================================================================================
 * MODULE: restaurant — customers (npc role 'customer', host AI), furniture & service items,
 * the menu board & pricing (g.menu), shop sign (g.shopOpen), honest reviews & ratings, the mad
 * system for customers, dirty dishes / washing / wiping / trash / flies, g.reputation,
 * g.dayStats. Dev: ?restaurantlab. Debug API: window.__rest / (game as any).restaurant.
 * ============================================================================================= */

const fx = new RestFX();
let closeup: MenuCloseup | null = null;
let flyT = 0;
let flyLoop: SoundHandle | null = null;
const slips: { m: THREE.Mesh; t: number; v: THREE.Vector3 }[] = [];

function initHost(game: Game) {
  const g = game.g;
  if (g.menu === undefined) {
    const menu: any = { extras: { ...DEFAULT_EXTRAS } };
    for (const r of unlockedRecipes(game)) menu[r] = r === 'kaphrao_moo' ? 40 : recipeInfo(game, r).price;
    g.menu = menu;
  }
  g.menuPrices ??= {};
  g.shopOpen ??= false;
  g.reputation ??= 3;
  if (!g.dayStats) g.dayStats = freshStats(g.day ?? 1);
}

/** HOST: one-time service kit next to the cart: open/closed sign, menu board, wash tub + sponge. */
function starterKit(game: Game) {
  if (!game.isHost || game.g.restKit) return;
  const c = game.state.find('cart', () => true);
  if (!c) return;
  game.g.restKit = true;
  const cf = cartFrame();
  const put = (k: string, lx: number, lz: number, yaw: number, data?: any) => {
    const p = cf.w(lx, lz);
    const y = game.physics?.groundY(p[0], p[2]) ?? p[1];
    return game.items.spawn(k, [p[0], y + 0.02, p[2]], { yaw, data });
  };
  put('menu_poster', 1.6, -0.75, cf.yaw + Math.PI + 0.3);
  put('shop_sign', -1.55, -0.85, cf.yaw + Math.PI - 0.2, { open: !!game.g.shopOpen });
  put('wash_tub', -0.9, 1.05, cf.yaw);
  const s = put('sponge', -0.6, 1.0, cf.yaw);
  if (s) s.p![1] += 0.25;
}

/** ?restaurantlab: open shop with tables, stools, service gear and a few customers. */
function lab(game: Game) {
  if (!game.isHost) return;
  const g = game.g;
  initHost(game);
  g.time = 12.0;
  g.shopOpen = true;
  starterKit(game);
  for (const e of game.state.all('item')) if (e.k === 'shop_sign') e.data = { ...e.data, open: true };
  const ta = game.world?.anchor('tables_area') ?? { p: [9.2, 0.15, -23] };
  const gy = (x: number, z: number) => game.physics?.groundY(x, z) ?? ta.p[1];
  const sp = (k: string, x: number, z: number, yaw = 0, data?: any) => game.items.spawn(k, [x, gy(x, z) + 0.01, z], { yaw, data });
  const T = [[ta.p[0] - 1.0, ta.p[2] - 1.1, 0, 'table_plastic'], [ta.p[0] + 0.9, ta.p[2] + 0.6, 0.15, 'table_steel'], [ta.p[0] - 1.2, ta.p[2] + 1.5, -0.1, 'table_plastic']] as const;
  T.forEach(([x, z, yaw, k], i) => {
    sp(k, x, z, yaw, { mess: i === 2 ? 0.8 : 0 });
    const [W, D] = k === 'table_steel' ? [0.9, 0.62] : [0.8, 0.62];
    const seats: [number, number][] = [[0, -D / 2 - 0.3], [0, D / 2 + 0.3], [W / 2 + 0.3, 0]];
    seats.forEach(([lx, lz], j) => { const c = Math.cos(yaw), s = Math.sin(yaw); sp(j % 2 ? 'stool_blue' : 'stool_red', x + lx * c + lz * s, z - lx * s + lz * c, Math.random() * 6); });
    const tp = gy(x, z) + (k === 'table_steel' ? 0.72 : 0.67);
    if (i < 2) game.items.spawn('tissue_box', [x + 0.25, tp, z + 0.12], { yaw: yaw + 0.4 });
  });
  sp('umbrella_big', ta.p[0] - 1.0, ta.p[2] - 0.3);
  sp('chair_plastic', ta.p[0] + 2.2, ta.p[2] - 1.2, 2.4);
  const cf = cartFrame();
  const at = (lx: number, lz: number) => cf.w(lx, lz);
  let p = at(-0.2, 1.5); sp('dish_rack', p[0], p[2], cf.yaw);
  p = at(-1.6, 1.2); sp('water_dispenser', p[0], p[2], cf.yaw + Math.PI);
  p = at(1.4, 1.1); sp('ice_bucket', p[0], p[2], 0);
  p = at(2.0, 1.4); sp('trash_bin', p[0], p[2], 0);
  p = at(1.0, 1.6); sp('bus_tub', p[0], p[2], cf.yaw);
  for (let i = 0; i < 4; i++) { p = at(-1.2 + i * 0.12, 0.85); game.items.spawn('cup_plastic', [p[0], gy(p[0], p[2]) + 0.9, p[2]]); }
  for (const [k, dx] of [['soda_cola_can', 0], ['soda_fanta_can', 0.1], ['soda_red', 0.2], ['water_bottle', 0.3]] as const) { p = at(0.7 + dx, 0.95); game.items.spawn(k, [p[0], gy(p[0], p[2]) + 0.92, p[2]]); }
  // a few customers in different states
  setTimeout(() => {
    const seats = findSeats(true);
    const ck: any = (game as any).cooking;
    // 1) seated, waiting for a runny-egg kaphrao (+ water)
    if (seats[0]) { const c = spawnCustomer({ arch: 'office_worker_m', at: seats[0].stool.p }); if (c) { c.ord = { r: 'kaphrao_moo', req: ['egg', 'egg_runny', 'hot'], drink: 'water' }; seatCustomer(c, seats[0]); } }
    // 2) eating a crispy-egg kaphrao
    if (seats[2] && ck?.spawnDish) {
      const c = spawnCustomer({ arch: 'auntie_vendor', at: seats[2].stool.p });
      if (c) {
        c.ord = { r: 'kaphrao_moo', req: ['egg', 'egg_crispy'], drink: null };
        seatCustomer(c, seats[2]);
        const pl = game.players()[0];
        const d = ck.spawnDish('kaphrao_moo', seats[2].spot ?? seats[2].stool.p, { egg: 'crispy', spoon: true, issues: [], taste: 0.86 });
        if (d && pl) { game.items.putInInventory(pl, d); serve(pl, c, d); }
      }
    }
    // 3) two in the queue
    spawnCustomer({ arch: 'student_f', at: cf.w(2.8, -2.5) });
    spawnCustomer({ arch: 'moto_taxi', at: cf.w(4.5, -3.0) });
    // teleport the player to look at the scene
    const pp = [ta.p[0] + 2.6, ta.p[1], ta.p[2] + 2.8];
    game.player?.teleport(pp, yawTo(cf.p[0] - pp[0] + 2, cf.p[2] - pp[2] - 1));
    if (game.player) game.player.pitch = -0.28;
  }, 400);
}
// ------------------------------------------------------------------ client: customer extras (order ticket, review slip)

function customerView(game: Game) {
  return (e: Ent) => {
    if (e.role !== 'customer') return null;
    const holder = new THREE.Group();
    holder.name = 'cust-extra:' + e.id;
    let ticket: THREE.Mesh | null = null;
    let key = '';
    const tmp = new THREE.Vector3();
    game.views.root.add(holder);
    return {
      update: (e: Ent, dt: number) => {
        const obj = game.views.objectOf(e.id);
        if (!obj) { holder.visible = false; return; }
        holder.visible = true;
        obj.getWorldPosition(tmp);
        const hh = (obj.userData.headHeight as number) ?? 1.85;
        holder.position.set(tmp.x, tmp.y + hh + 0.12 + Math.sin(performance.now() / 600 + e.id) * 0.012, tmp.z);
        // order ticket while waiting
        const show = !!e.ord && ['order', 'toseat', 'wait', 'mad'].includes(e.cs);
        const urgent = (e.mood ?? 1) < 0.35;
        const k = show ? orderText(e) + (urgent ? '!' : '') + (e.cs === 'mad' ? 'M' : '') : '';
        if (k !== key) {
          key = k;
          if (ticket) { ticket.removeFromParent(); ticket.geometry.dispose(); ((ticket.material as THREE.MeshBasicMaterial).map as THREE.Texture)?.dispose(); (ticket.material as THREE.Material).dispose(); ticket = null; }
          if (show) {
            const words = orderText(e).split(' · ');
            const lines: [string, number, string, string?][] = [[`โต๊ะ ${e.seat != null ? '' : '—'} #${e.id % 100}`, 26, '#7a2a20', F.hand], ...words.slice(0, 3).map((w, i) => [w, i === 0 ? 40 : 32, '#1b2b6b'] as [string, number, string])];
            const cv = paperCanvas(320, 64 + lines.length * 42, lines, { tint: urgent ? '#ffd2c8' : undefined, stamp: e.cs === 'mad' ? 'โกรธ!' : urgent ? 'ด่วน!' : undefined });
            ticket = paperMesh(cv, 0.2);
            ticket.renderOrder = 5;
            holder.add(ticket);
          }
        }
        if (ticket) {
          const cam = game.camera;
          ticket.quaternion.copy(cam.quaternion);
          ticket.rotateZ(Math.sin(performance.now() / 900 + e.id) * 0.05);
          const d = cam.position.distanceTo(holder.position);
          ticket.visible = d < 16;
          ticket.scale.setScalar(Math.max(0.8, Math.min(1.8, d / 4)));
          const mt = ticket.material as THREE.MeshBasicMaterial;
          mt.opacity = Math.max(0, Math.min(1, (16 - d) / 4));
        }
        void dt;
      },
      dispose: () => { holder.removeFromParent(); if (ticket) { ticket.geometry.dispose(); (ticket.material as THREE.Material).dispose(); } },
    };
  };
}

function spawnSlip(game: Game, d: { cid: number; stars: number; th: string; pay: number; tip: number }) {
  const obj = game.views.objectOf(d.cid);
  const e = game.state.get(d.cid);
  const p = obj ? obj.getWorldPosition(new THREE.Vector3()) : e?.p ? new THREE.Vector3(e.p[0], e.p[1], e.p[2]) : null;
  if (!p || !game.scene) return;
  const col = d.stars >= 4 ? '#c47a00' : d.stars <= 2 ? '#b0141a' : '#5a4a2a';
  const cv = paperCanvas(360, 250, [[starStr(d.stars), 64, col, F.body], [d.th.length > 26 ? d.th.slice(0, 25) + '…' : d.th, 30, '#1b2b6b'], [d.pay > 0 ? `จ่าย ${d.pay}.-${d.tip ? `  ทิป ${d.tip}` : ''}` : 'ไม่จ่าย!', 34, d.pay > 0 ? '#2a5a1a' : '#b0141a']], { stamp: d.stars >= 5 ? 'อร่อย!' : d.stars <= 1 ? 'แย่!' : undefined });
  const m = paperMesh(cv, 0.34);
  m.position.copy(p).add(new THREE.Vector3(0, 2.0, 0));
  m.renderOrder = 6;
  game.scene.add(m);
  slips.push({ m, t: 0, v: new THREE.Vector3((Math.random() - 0.5) * 0.15, 0.32, (Math.random() - 0.5) * 0.15) });
  Sound.play(d.stars >= 4 ? 'sparkle_chime' : d.stars <= 2 ? 'wrong_buzz' : 'paper_rustle', { pos: p, vol: 0.45 });
}

function updateSlips(game: Game, dt: number) {
  for (let i = slips.length - 1; i >= 0; i--) {
    const s = slips[i];
    s.t += dt;
    s.m.position.addScaledVector(s.v, dt);
    s.v.multiplyScalar(0.985);
    s.m.quaternion.copy(game.camera.quaternion);
    s.m.rotateZ(Math.sin(s.t * 3) * 0.12);
    const k = s.t < 0.3 ? s.t / 0.3 : 1;
    s.m.scale.setScalar(0.4 + k * 0.6 + (s.t < 0.45 ? Math.sin(s.t / 0.45 * Math.PI) * 0.15 : 0));
    (s.m.material as THREE.MeshBasicMaterial).opacity = s.t > 4.5 ? Math.max(0, 1 - (s.t - 4.5) / 0.8) : 1;
    if (s.t > 5.3) { s.m.removeFromParent(); s.m.geometry.dispose(); ((s.m.material as THREE.MeshBasicMaterial).map as THREE.Texture)?.dispose(); (s.m.material as THREE.Material).dispose(); slips.splice(i, 1); }
  }
}

// ------------------------------------------------------------------ client: flies & tub bubbles

function updateFlies(game: Game, dt: number) {
  flyT += dt;
  if (flyT < 0.5) return;
  flyT = 0;
  const cam = game.camera.getWorldPosition(new THREE.Vector3());
  const centers: { p: THREE.Vector3; n: number }[] = [];
  let loudest: THREE.Vector3 | null = null, ld = 99;
  for (const e of game.state.all('item')) {
    if (!e.p || e.holder != null || e.in != null) continue;
    let n = 0, y = e.p[1];
    if (TABLE_KINDS.includes(e.k) && (e.data?.mess ?? 0) > 0.4) { n = 2 + Math.round(e.data.mess * 5); y += e.k === 'table_steel' ? 0.72 : 0.67; }
    else if (e.k === 'trash_bag') { n = 4; y += 0.4; }
    else if (e.k === 'trash_bin' && game.items.contents(e).length >= 10) { n = 3; y += 0.62; }
    else if ((e.k === 'plate' || e.k === 'bowl') && e.data?.dirty) n = 1;
    if (!n) continue;
    const p = new THREE.Vector3(e.p[0], y, e.p[2]);
    const d = p.distanceTo(cam);
    if (d > 30) continue;
    centers.push({ p, n });
    if (n >= 3 && d < ld) { ld = d; loudest = p; }
  }
  fx.setFlies(centers);
  if (loudest && ld < 9) { if (!flyLoop) flyLoop = Sound.loop('rest_fly_loop', { pos: loudest, vol: 0.35, ref: 0.6, max: 9 }); flyLoop.setPos(loudest); }
  else if (flyLoop) { flyLoop.stop(0.5); flyLoop = null; }
}

const tubT = new Map<number, number>();
function updateTubs(game: Game, dt: number) {
  for (const e of game.state.all('item')) {
    if (e.k !== 'wash_tub' || e.data?.busy == null) continue;
    const t = (tubT.get(e.id) ?? 0) + dt;
    if (t > 0.18) {
      tubT.set(e.id, 0);
      const p = game.items.worldPos(e);
      if (p) { fx.bubbles(p.clone().add(new THREE.Vector3(0, 0.21, 0)), 3, 0.2); if (Math.random() < 0.35) fx.splash(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.22, (Math.random() - 0.5) * 0.3)), 5, 0.6); }
    } else tubT.set(e.id, t);
  }
}

// ------------------------------------------------------------------ module

export default defineModule({
  id: 'restaurant',
  deps: ['characters', 'cooking'],
  init(game: Game) {
    bindCustomers(game); bindService(game); bindStats(game);
    // our own sounds (merged into the shared Sound manifest under rest_* keys)
    Object.assign(Sound.manifest, { rest_fly_loop: { files: ['../gen/restaurant/sfx/fly_buzz_loop.mp3'], vol: 0.5, loop: true, cat: 'amb', desc: 'flies buzzing over a dirty table (restaurant, synthesized CC0)' } });
    defineFurniture(game);
    installServiceIntents(game);
    game.registerView('npc', customerView(game));
    game.interact.provide(serviceProvider(game, (id) => openMenu(game, id)), 5);
    game.events.on('host:init', () => initHost(game));
    game.events.on('item:picked', (d: any) => { if (game.isHost) onItemPicked(d); });
    game.events.on('item:placed', (d: any) => { if (game.isHost) onItemPlaced(d); });
    game.events.on('life:ghost_scare', (d: any) => { if (game.isHost) onGhostScare(d); });
    game.on('rest:review', (d: any) => spawnSlip(game, d));
    game.on('rest:fx', (d: any) => { if (d.k === 'clean') { const p = new THREE.Vector3(d.p[0], d.p[1], d.p[2]); fx.bubbles(p, 14, 0.25); fx.splash(p, 12, 0.9); } });
    game.on('rest:mad', (d: any) => {
      if (d.pid !== game.localPlayerId) return;
      closeup?.close();
      game.ui.choose({ prompt: d.prompt, options: d.opts, seconds: d.seconds ?? 3, onPick: (i: number) => game.intent('rest.madReply', { cid: d.cid, pick: i }) });
    });
    game.events.on('world:ready', () => {
      if (game.scene) fx.attach(game.scene);
      if (game.isHost) { initHost(game); setTimeout(() => { starterKit(game); if (params.has('restaurantlab')) lab(game); }, 250); }
    });
    game.events.on('world:exit', () => { fx.detach(); closeup?.dispose(); closeup = null; flyLoop?.stop(0.1); flyLoop = null; for (const s of slips) s.m.removeFromParent(); slips.length = 0; });
    Sound.preload(['plate_down', 'khob_khun', 'aroi', 'ka_ching', 'banknote', 'scrub_loop', 'squeaky_toy', 'cup_fill', 'ice_cubes', 'eat_chomp', 'dun_dun_dunn']);
    // public API (other modules, tests)
    const api = {
      customers, spawnCustomer, findSeats, cartFrame, serve, startMad, spawnRate, stats,
      /** HOST: put a customer on a seat (tests) */
      seatCustomer,
      open: (on = true) => { game.g.shopOpen = on; for (const e of game.state.all('item')) if (e.k === 'shop_sign') e.data = { ...e.data, open: on }; },
      /** HOST: give the first player a dish (cooking API) — tests */
      fakeDish: (recipe = 'kaphrao_moo', over: any = {}) => {
        const ck: any = (game as any).cooking;
        const pl = game.players()[0];
        if (!ck?.spawnDish || !pl?.p) return null;
        const d = ck.spawnDish(recipe, [pl.p[0], pl.p[1] + 1, pl.p[2]], { spoon: true, issues: [], ...over });
        if (d) game.items.putInInventory(pl, d);
        return d;
      },
      seats: SEAT_KINDS, tables: TABLE_KINDS,
    };
    (game as any).restaurant = api;
    (window as any).__rest = api;
  },
  hostUpdate(game: Game, dt: number) {
    if (game.g.scene !== 'world' || !game.scene) return;
    customersHost(dt);
    serviceHost(dt);
  },
  frame(game: Game, dt: number) {
    if (!game.scene) return;
    refreshPosters(game);
    if (closeup) {
      if (game.player?.mode === 'play') closeup.close(); // resumed from pause etc.
      if (closeup && closeup.update(dt) === false) closeup = null;
    }
    fx.update(dt);
    updateSlips(game, dt);
    updateFlies(game, dt);
    updateTubs(game, dt);
  },
  onNewDay(game: Game, day: number) {
    rollDay(day);
    refreshTubs();
    for (const c of customers()) game.state.despawn(c);
    if (game.g.shopOpen) game.g.shopOpen = false;
    for (const e of game.state.all('item')) if (e.k === 'shop_sign') e.data = { ...e.data, open: false };
  },
});

function openMenu(game: Game, _id: number) {
  if (closeup) return;
  closeup = new MenuCloseup(game, () => { closeup = null; });
}

void tl; void round; void stats;
