import * as THREE from 'three';
import { defineModule } from '../../game/contracts';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { Sound } from '../../core/audio';
import { tl } from '../../core/util';
import { defineCatalog, FURNITURE, FURN_BY_KIND, footprintOf, isFurniture } from './catalog';
import { check, yawOfQ, WHY_TEXT, type Why } from './place';
import { BuildMode } from './mode';
import { STORE, buildShowroom, DisplayColliders, placeKeeper, backdoorAnchor, type Showroom } from './showroom';
import { registerClarkDialogue, dressClark } from './keeper';

/* =============================================================================================
 * build — furniture store + BUILD MODE (โหมดจัดร้าน).
 *   • เจริญพาณิชย์เฟอร์นิเจอร์ (showroom.ts): real furniture models on display, bought through the shops module.
 *   • build mode (mode.ts): ghost preview, grid / wall / table snapping, rotation, click-and-hold drag & drop,
 *     sell-back 50 %, floating 3D key hints. Host-validated intents (below), everyone sees pieces move.
 *   • furniture catalogue (catalog.ts): ~26 pieces (seats, tables, counter, storage, fridge, food cabinet, fans,
 *     air-con, TV, register, lucky cat, clock, shrine shelf, menu lightbox, plants, lamps).
 *
 * API: (game as any).build = {
 *   decorScore(center: [x,y,z], radius = 8) → { decor, comfort, seats, tables, count, roles, ambience 0..1, cool 0..1 }
 *   footprintOf(kind), isFurniture(kind), catalog: FurnDef[], toggle(on?), active }
 * Events (local, every peer): 'build:placed' { id, k, p, by } · 'build:sold' { k, by, refund } · 'build:moved' { id, k, p, by }
 * Intents: build.place {slot,pos,yaw} · build.grab {id} · build.drag {id,pos,yaw} · build.drop {id,pos,yaw} ·
 *          build.cancel {id} · build.rotate {id,d} · build.sell {id}
 * Dev: ?buildlab → day 2, 11:00, 30 000 ฿, teleported into the furniture store.
 * ============================================================================================= */

const WOOD = /wood|cabinet|chalk|shrine|planter/;
const METAL = /steel|metal|fridge|fan|aircon|counter|tv|register|lamp|dispenser|formica/;
function thunk(kind: string) { return WOOD.test(kind) ? 'drop_wood' : METAL.test(kind) ? 'drop_metal' : /plant/.test(kind) ? 'drop_soft' : 'drop_plastic'; }

/** Ambience of a place: decor + cooling of the furniture standing within `radius` (restaurant comfort / tips). */
export function decorScore(game: Game, center: ArrayLike<number>, radius = 8) {
  let decor = 0, comfort = 0, seats = 0, tables = 0, count = 0;
  const roles: Record<string, number> = {};
  for (const e of game.state.all('item')) {
    if (e.holder != null || e.in != null || !e.p || e.disp || e.unpaid) continue;
    const f = footprintOf(e.k);
    if (!f) continue;
    if (Math.hypot(e.p[0] - center[0], e.p[2] - center[2]) > radius) continue;
    decor += f.decor; comfort += f.comfort ?? 0; count++;
    if (f.role === 'seat') seats++;
    if (f.role === 'table') tables++;
    roles[f.role] = (roles[f.role] ?? 0) + 1;
  }
  return { decor, comfort, seats, tables, count, roles, ambience: 1 - Math.exp(-decor / 10), cool: 1 - Math.exp(-comfort / 4) };
}

// ------------------------------------------------------------------ host intents

function installIntents(game: Game) {
  const near = (pl: Ent, p: ArrayLike<number>, r = 5.8) => !!pl.p && Math.hypot(pl.p[0] - p[0], pl.p[2] - p[2]) <= r && Math.abs(pl.p[1] - p[1]) < 4.5;
  const refuse = (pl: Ent, why: Exclude<Why, null>, p?: ArrayLike<number>) => game.emit('build:refuse', { to: pl.id, why, p: p ? [p[0], p[1], p[2]] : null });
  const okPos = (p: any) => Array.isArray(p) && p.length === 3 && p.every((v) => Number.isFinite(v));
  const done = (e: Ent, pl: Ent, ev = 'build:placed') => game.emit(ev, { id: e.id, k: e.k, p: e.p, by: pl.id });

  game.onIntent('build.place', (pl, d: { slot?: number; pos: number[]; yaw: number }) => {
    const slot = d.slot ?? pl.sel ?? 0;
    const e = game.state.get(pl.inv?.[slot]);
    if (!e || !isFurniture(e.k) || !okPos(d.pos)) return;
    if (e.unpaid || e.disp) return refuse(pl, 'unpaid', d.pos);
    if (!near(pl, d.pos)) return refuse(pl, 'far', d.pos);
    const yaw = Number.isFinite(d.yaw) ? d.yaw : pl.yaw ?? 0;
    const why = check(game, e.k, d.pos, yaw, { exclude: e.id });
    if (why) return refuse(pl, why, d.pos);
    game.items.toWorld(e, d.pos, [0, 0, 0], yaw);
    done(e, pl);
    game.events.emit('item:placed', { player: pl.id, item: e.id });
  });
  const grabbable = (pl: Ent, e: Ent | undefined): e is Ent => !!e && e.t === 'item' && isFurniture(e.k) && game.items.isFree(e) && !e.disp && !e.unpaid && !!e.p && (!e._drag || e._drag === pl.id);
  game.onIntent('build.grab', (pl, d: { id: number }) => {
    const e = game.state.get(d.id);
    if (!grabbable(pl, e) || !near(pl, e.p!)) return;
    e._drag = pl.id; e._dragT = game.g.time; e._dragFrom = [...e.p!, yawOfQ(e.q)];
    game.items.setPose(e, [e.p![0], e.p![1] + 0.07, e.p![2]], yawOfQ(e.q), false);
    game.sfx('table_drag', e.p, { vol: 0.4 });
  });
  game.onIntent('build.drag', (pl, d: { id: number; pos: number[]; yaw: number }) => {
    const e = game.state.get(d.id);
    if (!e || e._drag !== pl.id || !okPos(d.pos) || !near(pl, d.pos, 7)) return;
    e._dragT = game.g.time;
    game.items.setPose(e, [d.pos[0], d.pos[1] + 0.07, d.pos[2]], d.yaw ?? 0, false);
  });
  const revert = (e: Ent) => {
    const f = e._dragFrom as number[] | undefined;
    if (f) game.items.setPose(e, [f[0], f[1], f[2]], f[3] ?? 0, true);
    else game.items.setPose(e, e.p!, yawOfQ(e.q), true);
    e._drag = null; e._dragFrom = null;
  };
  game.onIntent('build.drop', (pl, d: { id: number; pos: number[]; yaw: number }) => {
    const e = game.state.get(d.id);
    if (!e || e._drag !== pl.id) return;
    if (!okPos(d.pos) || !near(pl, d.pos, 7)) { revert(e); return refuse(pl, 'far', d.pos); }
    const why = check(game, e.k, d.pos, d.yaw ?? 0, { exclude: e.id });
    if (why) { revert(e); return refuse(pl, why, d.pos); }
    game.items.setPose(e, d.pos, d.yaw ?? 0, true);
    e._drag = null; e._dragFrom = null;
    done(e, pl);
    game.emit('build:moved', { id: e.id, k: e.k, p: e.p, by: pl.id });
  });
  game.onIntent('build.cancel', (pl, d: { id: number }) => { const e = game.state.get(d.id); if (e && e._drag === pl.id) revert(e); });
  game.onIntent('build.rotate', (pl, d: { id: number; d: number }) => {
    const e = game.state.get(d.id);
    if (!grabbable(pl, e) || !near(pl, e.p!) || e._drag) return;
    const yaw = yawOfQ(e.q) + (Number.isFinite(d.d) ? d.d : Math.PI / 2);
    const why = check(game, e.k, e.p!, yaw, { exclude: e.id });
    if (why) return refuse(pl, why, e.p!);
    game.items.setPose(e, e.p!, yaw, true);
    game.emit('build:rotated', { id: e.id, by: pl.id });
  });
  game.onIntent('build.sell', (pl, d: { id: number }) => {
    const e = game.state.get(d.id);
    if (!grabbable(pl, e) || !near(pl, e.p!) || e._drag) return;
    const refund = Math.round((game.items.def(e.k)?.price ?? FURN_BY_KIND[e.k]?.price ?? 0) * 0.5);
    const p = [...e.p!];
    game.items.remove(e);
    if (refund > 0) game.money(pl.id, refund, 'build.sell', [p[0], p[1] + 1.2, p[2]]);
    game.emit('build:sold', { k: e.k, by: pl.id, refund, p });
  });
}

// ------------------------------------------------------------------ client feedback (thunk, dust puff, squash)

class Juice {
  private puffs: { pts: THREE.Points; t: number; v: Float32Array }[] = [];
  private squash = new Map<number, number>();
  private tex: THREE.Texture;
  constructor(private game: Game) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d')!;
    const gr = x.createRadialGradient(32, 32, 2, 32, 32, 30); gr.addColorStop(0, 'rgba(225,215,195,0.9)'); gr.addColorStop(1, 'rgba(225,215,195,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    this.tex = new THREE.CanvasTexture(c);
  }
  placed(d: { id: number; k: string; p: number[] }) {
    const g = this.game;
    Sound.play(thunk(d.k), { pos: new THREE.Vector3(d.p[0], d.p[1], d.p[2]), vol: 0.8, pitch: 0.85 + Math.random() * 0.15 } as any);
    this.squash.set(d.id, 0);
    const f = footprintOf(d.k);
    if (!f || f.mount === 'wall' || f.mount === 'ceiling' || !g.scene) return;
    const n = 18, pos = new Float32Array(n * 3), vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
      const r = Math.max(f.size[0], f.size[2]) * 0.5;
      pos.set([d.p[0] + Math.cos(a) * r, d.p[1] + 0.04, d.p[2] + Math.sin(a) * r], i * 3);
      vel.set([Math.cos(a) * (0.6 + Math.random() * 0.5), 0.15 + Math.random() * 0.25, Math.sin(a) * (0.6 + Math.random() * 0.5)], i * 3);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: this.tex, size: 0.22, transparent: true, depthWrite: false, opacity: 0.8, sizeAttenuation: true }));
    pts.frustumCulled = false;
    g.scene.add(pts);
    this.puffs.push({ pts, t: 0, v: vel });
  }
  frame(dt: number) {
    for (const p of [...this.puffs]) {
      p.t += dt;
      const a = p.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < a.count; i++) { a.setXYZ(i, a.getX(i) + p.v[i * 3] * dt, a.getY(i) + p.v[i * 3 + 1] * dt, a.getZ(i) + p.v[i * 3 + 2] * dt); p.v[i * 3] *= 0.9; p.v[i * 3 + 2] *= 0.9; }
      a.needsUpdate = true;
      const m = p.pts.material as THREE.PointsMaterial;
      m.opacity = 0.8 * Math.max(0, 1 - p.t / 0.8); m.size = 0.22 + p.t * 0.35;
      if (p.t > 0.8) { p.pts.removeFromParent(); p.pts.geometry.dispose(); m.dispose(); this.puffs.splice(this.puffs.indexOf(p), 1); }
    }
    for (const [id, t0] of [...this.squash]) {
      const t = t0 + dt;
      const o = this.game.views.objectOf(id)?.children[0];
      if (!o || t > 0.45) { if (o) o.scale.set(1, 1, 1); this.squash.delete(id); continue; }
      this.squash.set(id, t);
      // squash down, overshoot up, settle (damped spring look)
      const k = Math.exp(-t * 9) * Math.cos(t * 30);
      o.scale.set(1 + k * 0.06, 1 - k * 0.1, 1 + k * 0.06);
    }
  }
}

// ------------------------------------------------------------------ module

let MODE: BuildMode | null = null;
let JUICE: Juice | null = null;
let COLS: DisplayColliders | null = null;
let ROOM: Showroom | null = null;

function swapShowroom(game: Game) {
  const rt = (game as any).shops?._rt?.get(STORE.id);
  if (!rt?.fix) return;
  const keep = new Set<THREE.Object3D>([rt.fix.shutter?.obj].filter(Boolean));
  for (const c of rt.fix.root.children) if (!keep.has(c)) c.visible = false;
  for (const c of rt.fix.colliders ?? []) { try { c.setEnabled?.(false); } catch {} }   // (static colliders: disable, never remove)
  ROOM = buildShowroom(game);
  game.scene!.add(ROOM.root);
  rt.fix.slots = ROOM.slots;
  rt.fix.colliders = ROOM.colliders;
  rt.fix.keeper = ROOM.keeper;
  rt.slotItem = ROOM.slots.map(() => null);
  rt.refillAt = ROOM.slots.map(() => 0);
  COLS?.init(ROOM.slots);
  if (game.isHost) {
    // displays put out at the generic slots → back into the stock count; the shop refills at the showroom slots
    for (const it of game.state.all('item')) if (it.shop === STORE.id && it.disp) { rt.ent.left = { ...(rt.ent.left ?? {}), [it.sk]: (rt.ent.left?.[it.sk] ?? 0) + 1 }; game.items.remove(it); }
    placeKeeper(game, rt.keeper, ROOM.keeper);
    dressClark(game, rt.keeper);
  }
  if (game.world) {
    const early = (game.world.anchors as any).furniture_backdoor;
    if (early?.p && Math.hypot(early.p[0] - ROOM.backdoor.p[0], early.p[2] - ROOM.backdoor.p[2]) > 0.05)
      console.warn('[build] furniture_backdoor moved after world:ready', early.p, '→', ROOM.backdoor.p);
    (game.world.anchors as any).furniture_backdoor = ROOM.backdoor;
  }
}

function buildlab(game: Game) {
  const q = new URLSearchParams(location.search);
  if (!q.has('buildlab') || !game.isHost) return;
  const g = game.g;
  if ((g.day ?? 1) < 2) g.day = 2;
  g.time = Number(q.get('buildtime') ?? 11);
  for (const pl of game.players()) pl.wallet = Number(q.get('buildmoney') ?? 30000);
  const a = STORE.anchor;
  game.player?.teleport([a.p[0] - 0.4, a.p[1], a.p[2] + 0.3], a.yaw);
}

export default defineModule({
  id: 'build',
  deps: ['world', 'shops', 'restaurant', 'cooking'],
  init(game) {
    defineCatalog(game);
    installIntents(game);
    registerClarkDialogue();
    game.onIntent('build.clarkMet', (pl) => { const g: any = game.g; g.clarkMet = { ...(g.clarkMet ?? {}), [pl.id]: true }; });
    MODE = new BuildMode(game);
    JUICE = new Juice(game);
    COLS = new DisplayColliders(game);
    // holding furniture: the click is build mode's (snapped, validated) — never the generic unsnapped "place"
    game.interact.provide((ctx) => {
      const h = ctx.held;
      if (!h || !isFurniture(h.k) || h.unpaid) return null;
      return { key: 'LMB', label: tl('วาง (คลิก) · หมุน [R]', 'place · rotate [R]'), priority: 2, run: () => {} };
    }, 50);
    game.on('build:placed', (d: any) => JUICE?.placed(d));
    game.on('build:refuse', (d: { to: number; why: Exclude<Why, null>; p: number[] | null }) => {
      if (d.to !== game.localPlayerId) return;
      Sound.play('shop_buzz', { vol: 0.4 });
      const w = WHY_TEXT[d.why];
      if (d.p) game.ui.popup(new THREE.Vector3(d.p[0], d.p[1] + 1.1, d.p[2]), w.th);
    });
    game.on('build:sold', (d: { p: number[] }) => Sound.play('cash_drawer', { pos: new THREE.Vector3(d.p[0], d.p[1], d.p[2]), vol: 0.7 } as any));
    game.on('build:rotated', () => Sound.play('plastic_chair_scrape', { vol: 0.35 }));
    game.events.on('world:ready', () => {
      try { swapShowroom(game); } catch (e) { console.error('[build] showroom', e); }
      try { buildlab(game); } catch (e) { console.error('[build] buildlab', e); }
    });
    game.events.on('world:exit', () => { MODE?.toggle(false); COLS?.clear(); ROOM?.root.removeFromParent(); ROOM = null; });
    (game as any).build = {
      decorScore: (center: ArrayLike<number>, radius?: number) => decorScore(game, center, radius),
      footprintOf, isFurniture, catalog: FURNITURE,
      toggle: (on?: boolean) => MODE?.toggle(on),
      get active() { return !!MODE?.active; },
      get mode() { return MODE; },
    };
  },
  buildWorld(game) {
    // the store's anchor (1.2 m inside the facade, facing into the shop) — read by the shops module on world:ready
    if (game.world) {
      (game.world.anchors as any)[STORE.id] = { p: [...STORE.anchor.p], yaw: STORE.anchor.yaw };
      // the STAFF ONLY door → backrooms (published now so later modules can read it in their buildWorld)
      try { (game.world.anchors as any).furniture_backdoor = backdoorAnchor(game); } catch (e) { console.warn('[build] backdoor anchor', e); }
    }
  },
  hostUpdate(game) {
    // a drag nobody is finishing (player left / tabbed out) snaps back after a few seconds
    for (const e of game.state.all('item')) {
      if (!e._drag) continue;
      const pl = game.state.get(e._drag);
      if (!pl || Math.abs((game.g.time ?? 0) - (e._dragT ?? 0)) > 0.04) {
        const f = e._dragFrom as number[] | undefined;
        if (f) game.items.setPose(e, [f[0], f[1], f[2]], f[3] ?? 0, true);
        e._drag = null; e._dragFrom = null;
      }
    }
  },
  frame(game, dt) {
    if (!game.scene || game.scenes.currentName !== 'world') return;
    MODE?.frame(dt);
    JUICE?.frame(dt);
    COLS?.update(dt);
    if (ROOM) { const c = game.engine.camera.position; const a = STORE.anchor.p; ROOM.root.visible = Math.hypot(c.x - a[0], c.z - a[2]) < 75; }
  },
});
