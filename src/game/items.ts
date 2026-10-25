import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Game } from './game';
import type { Ent } from '../sim/state';
import type { AttachPoint, CarryPose, CharacterRig } from './contracts';
import { ShapeDesc, G } from '../sim/physics';
import { TL, clamp, damp, dist3, round } from '../core/util';
import { followEnt } from './views';

/**
 * ITEMS — every grabbable thing (ingredients, tools, dishes, chairs, money bags, cardboard…).
 *
 * Item entity: { t:'item', k:kind, p, q, holder?:playerId, slot?:0-4, in?:containerId, at?:[x,y,z], data:{} }
 *  free   → (host) dynamic Rapier body, transform replicated
 *  held   → parented to the holder's body attach point (others see it); local player sees the
 *           SELECTED item floating lower-right of the view (no hands)
 *  inside → parented to its container's visual at `at` (or auto pile)
 *
 * Inventory: player.inv = 5 slots of item ids (big items fill several slots with the same id).
 * Weight slows you down; 5 full slots = OVERLOADED (can't act until you drop something).
 */
export type CarryStyle = 'hand' | 'twohand' | 'underarm' | 'head' | 'back' | 'mouth';

export interface ItemDef {
  kind: string;
  name: TL;
  /** kg — affects movement speed */
  weight?: number;
  /** inventory slots taken (default 1; a plastic table might take 3) */
  slots?: number;
  carry?: CarryStyle;
  /** physics collider; defaults to a box fitted to the visual */
  shape?: ShapeDesc;
  mass?: number;
  tags?: string[];
  /** base shop price (baht) */
  price?: number;
  /** Build the textured low-poly visual. Origin = bottom centre (sits on surfaces). */
  build(e: Ent, game: Game): THREE.Object3D;
  /** Update the visual when e.data changes (called when JSON of data changes). */
  refresh?(obj: THREE.Object3D, e: Ent, game: Game): void;
  /** Per-frame visual animation (steam, wobble…). */
  animate?(obj: THREE.Object3D, e: Ent, dt: number, game: Game): void;
  /** Dynamic label (e.g. "หมูสับ 320 g"). */
  label?(e: Ent): TL;
  /** First-person held transform tweak. */
  hold?: { pos?: [number, number, number]; rot?: [number, number, number]; scale?: number };
  /** Discrete-item container (basket, tray, plate rack…). Quantity containers (wok contents) are module data. */
  container?: { capacity: number; accepts?: (child: Ent, def: ItemDef) => boolean; layout?: 'pile' | 'row' | 'stack'; spots?: [number, number, number][] };
  /** Initial data for spawns */
  data?: () => any;
  /** Placed furniture: fixed in place (no tipping). Still pick-up-able with E. */
  fixed?: boolean;
  /** Can't be picked up (e.g. bolted stove). */
  noPickup?: boolean;
  /** Bigger interaction radius for tiny items */
  pickRadius?: number;
  /** Rapier tuning of the free body: bounciness, grip, air drag, spin drag; `bouncy` keeps the
   *  restitution against (non-bouncy) static colliders instead of averaging it away. */
  phys?: { restitution?: number; friction?: number; linDamp?: number; angDamp?: number; bouncy?: boolean };
  /** effective density kg/m³ for water buoyancy (water module; < 1000 floats, > 1000 sinks) */
  density?: number;
}

export const SLOT_COUNT = 5;

interface BodyRec { body: RAPIER.RigidBody; fixed: boolean }

export class ItemSystem {
  readonly defs = new Map<string, ItemDef>();
  private bodies = new Map<number, BodyRec>();
  /** Local first-person viewmodel anchor (child of the camera). */
  readonly viewModel = new THREE.Group();
  private vmItem: number | null = null;
  private vmSwitch = 0;
  private vmBob = 0;

  constructor(private game: Game) {
    this.viewModel.name = 'viewmodel';
    this.installIntents();
    game.on('physics:post', () => this.syncBodies());
    this.bindState();
  }

  /** (Re)attach to the current State (called by Game whenever the session/state changes). */
  bindState() {
    for (const id of [...this.bodies.keys()]) this.dropBody(id);
    this.game.state.despawned.add((e) => this.dropBody(e.id));
  }

  define(def: ItemDef) {
    if (this.defs.has(def.kind)) console.warn('[items] redefined', def.kind);
    this.defs.set(def.kind, def);
  }
  def(kind: string): ItemDef | undefined { return this.defs.get(kind); }
  defOf(e: Ent | undefined | null) { return e ? this.defs.get(e.k) : undefined; }
  name(e: Ent): TL { const d = this.defOf(e); return d?.label?.(e) ?? d?.name ?? { th: e.k }; }

  // ------------------------------------------------------------------ queries (all peers)

  /** Unique items carried by a player, in slot order. */
  carried(pl: Ent): Ent[] {
    const out: Ent[] = [];
    const seen = new Set<number>();
    for (const id of pl.inv ?? []) {
      if (id === null || seen.has(id)) continue;
      seen.add(id);
      const e = this.game.state.get(id);
      if (e) out.push(e);
    }
    return out;
  }
  freeSlots(pl: Ent) { return (pl.inv ?? []).filter((x: any) => x === null).length; }
  isOverloaded(pl: Ent) { return this.freeSlots(pl) === 0; }
  weight(pl: Ent) { return this.carried(pl).reduce((a, e) => a + (this.defOf(e)?.weight ?? 0.5), 0); }
  /** Movement speed multiplier from load. */
  speedMul(pl: Ent) {
    if (this.isOverloaded(pl)) return 0.22;
    const w = this.weight(pl);
    const used = SLOT_COUNT - this.freeSlots(pl);
    return clamp(1 - w * 0.035 - used * 0.06, 0.38, 1);
  }
  selected(pl: Ent): Ent | null {
    const id = pl.inv?.[pl.sel ?? 0];
    return id === null || id === undefined ? null : this.game.state.get(id) ?? null;
  }
  contents(container: Ent | number): Ent[] {
    const id = typeof container === 'number' ? container : container.id;
    return this.game.state.all('item').filter((e) => e.in === id).sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0));
  }
  isFree(e: Ent) { return e.holder == null && e.in == null; }

  // ------------------------------------------------------------------ host API

  /** HOST: spawn an item. Free items get physics unless opts.noPhysics. */
  spawn(kind: string, pos: ArrayLike<number>, opts: { data?: any; q?: number[]; yaw?: number; in?: number; at?: number[]; vel?: number[]; noPhysics?: boolean; extra?: any } = {}): Ent | null {
    const def = this.defs.get(kind);
    if (!def) { console.warn('[items] unknown kind', kind); return null; }
    const q = opts.q ?? (opts.yaw !== undefined ? [0, Math.sin(opts.yaw / 2), 0, Math.cos(opts.yaw / 2)] : [0, 0, 0, 1]);
    const e = this.game.state.spawn('item', {
      k: kind, p: [pos[0], pos[1], pos[2]], q, holder: null, slot: null, in: opts.in ?? null, at: opts.at ?? null,
      data: opts.data ?? def.data?.() ?? {}, ...(opts.extra ?? {}),
    });
    if (e.in == null && !opts.noPhysics) this.makeBody(e, opts.vel);
    return e;
  }

  /** HOST: give an item straight into a player's hands (or drop at their feet if full). */
  give(pl: Ent, kind: string, opts: { data?: any } = {}): Ent | null {
    const p = pl.p ?? [0, 0, 0];
    const e = this.spawn(kind, [p[0], p[1] + 1, p[2]], { data: opts.data, noPhysics: true });
    if (!e) return null;
    if (!this.putInInventory(pl, e)) this.makeBody(e);
    return e;
  }

  /** HOST: remove an item entirely. */
  remove(e: Ent | number) {
    const it = typeof e === 'number' ? this.game.state.get(e) : e;
    if (!it) return;
    this.detach(it);
    for (const c of this.contents(it)) this.remove(c);
    this.game.state.despawn(it);
  }

  /** HOST: put an existing (free/in-container) item into the inventory. */
  putInInventory(pl: Ent, e: Ent): boolean {
    const def = this.defOf(e);
    const need = def?.slots ?? 1;
    const inv: (number | null)[] = pl.inv;
    const free = inv.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
    if (free.length < need) return false;
    this.detach(e);
    // prefer the selected slot if it's free
    const sel = pl.sel ?? 0;
    const order = free.includes(sel) ? [sel, ...free.filter((i) => i !== sel)] : free;
    const use = order.slice(0, need);
    for (const i of use) inv[i] = e.id;
    pl.inv = [...inv];
    e.holder = pl.id;
    e.slot = use[0];
    return true;
  }

  /** HOST: release an item from wherever it is (inventory / container / physics). */
  detach(e: Ent) {
    if (e.holder != null) {
      const pl = this.game.state.get(e.holder);
      if (pl?.inv) pl.inv = pl.inv.map((v: number | null) => (v === e.id ? null : v));
    }
    e.holder = null;
    e.slot = null;
    e.in = null;
    e.at = null;
    this.dropBody(e.id);
  }

  /** HOST: place an item free in the world (physics) at a position. */
  toWorld(e: Ent, pos: ArrayLike<number>, vel?: ArrayLike<number>, yaw?: number) {
    this.detach(e);
    e.p = [pos[0], pos[1], pos[2]];
    if (yaw !== undefined) e.q = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
    this.makeBody(e, vel);
  }

  /** HOST: put an item into a container. */
  toContainer(e: Ent, container: Ent, at?: number[]): boolean {
    const cdef = this.defOf(container)?.container;
    if (!cdef) return false;
    const kids = this.contents(container);
    if (kids.length >= cdef.capacity) return false;
    const def = this.defOf(e);
    if (cdef.accepts && def && !cdef.accepts(e, def)) return false;
    this.detach(e);
    e.in = container.id;
    e.at = at ?? null;
    e.ord = (kids[kids.length - 1]?.ord ?? 0) + 1;
    return true;
  }

  // ------------------------------------------------------------------ physics (host)

  private makeBody(e: Ent, vel?: ArrayLike<number>) {
    const phys = this.game.physics;
    if (!phys || !this.game.isHost || !this.game.scene) return;
    this.dropBody(e.id);
    const def = this.defOf(e);
    const shape = def?.shape ?? this.fitShape(e);
    const p = e.p ?? [0, 1, 0];
    const fixed = !!def?.fixed;
    let body: RAPIER.RigidBody;
    // collider origin is the shape centre; item origin is bottom centre
    const h = shapeHalfHeight(shape);
    if (fixed) {
      const R = phys.R;
      const bd = R.RigidBodyDesc.fixed().setTranslation(p[0], p[1] + h, p[2]);
      if (e.q) bd.setRotation({ x: e.q[0], y: e.q[1], z: e.q[2], w: e.q[3] });
      body = phys.world.createRigidBody(bd);
      const cd = phys.shapeDesc(shape).setCollisionGroups(((G.ITEM & 0xffff) << 16) | (G.ALL & 0xffff));
      const c = phys.world.createCollider(cd, body);
      phys.tags.set(c.handle, { eid: e.id });
    } else {
      const ph = def?.phys;
      body = phys.addDynamic(shape, def?.mass ?? def?.weight ?? 0.5, [p[0], p[1] + h, p[2]], e.q, { tag: { eid: e.id }, linvel: vel, friction: ph?.friction, restitution: ph?.restitution, damping: ph?.linDamp });
      if (ph?.angDamp !== undefined) body.setAngularDamping(ph.angDamp);
      if (ph?.bouncy) body.collider(0)?.setRestitutionCombineRule(phys.R.CoefficientCombineRule.Max);
    }
    (body as any).userData = { h };
    this.bodies.set(e.id, { body, fixed });
  }

  /** HOST: the free (non-fixed) dynamic body of an item, if any (water buoyancy, effects). */
  bodyOf(id: number): RAPIER.RigidBody | null { const r = this.bodies.get(id); return r && !r.fixed ? r.body : null; }

  private dropBody(id: number) {
    const r = this.bodies.get(id);
    if (!r) return;
    this.game.physics?.removeBody(r.body);
    this.bodies.delete(id);
  }

  /** Approximate collider from the def's visual bounds (cached per kind). */
  private shapeCache = new Map<string, ShapeDesc>();
  private fitShape(e: Ent): ShapeDesc {
    const hit = this.shapeCache.get(e.k);
    if (hit) return hit;
    const def = this.defOf(e);
    let s: ShapeDesc = { type: 'box', size: [0.2, 0.2, 0.2] };
    if (def) {
      try {
        const o = def.build(e, this.game);
        const b = new THREE.Box3().setFromObject(o);
        const v = b.getSize(new THREE.Vector3());
        s = { type: 'box', size: [Math.max(0.03, v.x), Math.max(0.02, v.y), Math.max(0.03, v.z)] };
        o.traverse((m: any) => m.geometry?.dispose());
      } catch {}
    }
    this.shapeCache.set(e.k, s);
    return s;
  }

  /** Re-create bodies for all free items (after the world scene/physics is (re)built). */
  rebuildBodies() {
    for (const id of [...this.bodies.keys()]) this.dropBody(id);
    if (!this.game.isHost) return;
    this.game.state.each('item', (e) => { if (this.isFree(e)) this.makeBody(e); });
  }

  private syncBodies() {
    for (const [id, r] of this.bodies) {
      if (r.fixed || r.body.isSleeping()) continue;
      const e = this.game.state.get(id);
      if (!e) continue;
      const t = r.body.translation(), q = r.body.rotation();
      const h = (r.body as any).userData?.h ?? 0;
      // rotate the centre→bottom offset by the body rotation
      const off = new THREE.Vector3(0, -h, 0).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
      e.p = [round(t.x + off.x, 3), round(t.y + off.y, 3), round(t.z + off.z, 3)];
      e.q = [round(q.x, 4), round(q.y, 4), round(q.z, 4), round(q.w, 4)];
      if (t.y < -15) { // fell out of the world → back to a safe spot
        const a = this.game.world?.anchor('item_respawn')?.p ?? [0, 1, 0];
        r.body.setTranslation({ x: a[0], y: a[1] + 1, z: a[2] }, true);
        r.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
  }

  // ------------------------------------------------------------------ intents (host handlers)

  private installIntents() {
    const g = this.game;
    const near = (pl: Ent, e: Ent, max = 3.4) => {
      const p = this.worldPos(e);
      return pl.p && p && dist3([pl.p[0], pl.p[1] + 1.1, pl.p[2]], [p.x, p.y, p.z]) <= max;
    };
    g.onIntent('item.pickup', (pl, d: { id: number }) => {
      const e = g.state.get(d.id);
      if (!e || e.t !== 'item') return;
      const def = this.defOf(e);
      if (def?.noPickup) return;
      if (e.holder != null && e.holder !== pl.id) { g.events.emit('item:snatch', { by: pl.id, from: e.holder, item: e.id }); return; }
      if (e.holder === pl.id || !near(pl, e)) return;
      if (this.isOverloaded(pl)) return;
      const from = e.in;
      if (!this.putInInventory(pl, e)) { g.emit('item:full', { player: pl.id }); return; }
      g.sfx('pickup', pl.p, { vol: 0.7 });
      g.events.emit('item:picked', { player: pl.id, item: e.id, from });
    });
    g.onIntent('item.drop', (pl, d: { slot?: number; throw?: boolean; dir?: number[] }) => {
      const slot = d.slot ?? pl.sel ?? 0;
      const id = pl.inv?.[slot];
      const e = g.state.get(id);
      if (!e) return;
      const yaw = pl.yaw ?? 0, pitch = pl.pitch ?? 0;
      const fwd = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      const p = pl.p ?? [0, 0, 0];
      const pos = [p[0] + fwd.x * 0.45, p[1] + 1.15, p[2] + fwd.z * 0.45];
      const sp = d.throw ? 6.5 : 1.4;
      this.toWorld(e, pos, [fwd.x * sp, fwd.y * sp + (d.throw ? 1.5 : 0.5), fwd.z * sp], yaw);
      g.sfx(d.throw ? 'whoosh_swing' : 'drop_soft', pos, { vol: 0.6 });
      g.events.emit('item:dropped', { player: pl.id, item: e.id, thrown: !!d.throw });
    });
    g.onIntent('item.place', (pl, d: { slot?: number; pos: number[]; yaw?: number }) => {
      const slot = d.slot ?? pl.sel ?? 0;
      const e = g.state.get(pl.inv?.[slot]);
      if (!e || !Array.isArray(d.pos) || !pl.p) return;
      if (dist3([pl.p[0], pl.p[1] + 1.1, pl.p[2]], d.pos) > 3.6) return;
      this.toWorld(e, [d.pos[0], d.pos[1] + 0.01, d.pos[2]], [0, 0, 0], d.yaw ?? pl.yaw);
      g.sfx('plate_down', d.pos, { vol: 0.5 });
      g.events.emit('item:placed', { player: pl.id, item: e.id });
    });
    g.onIntent('item.put', (pl, d: { slot?: number; into: number; at?: number[] }) => {
      const slot = d.slot ?? pl.sel ?? 0;
      const e = g.state.get(pl.inv?.[slot]);
      const c = g.state.get(d.into);
      if (!e || !c || c === e || !near(pl, c, 3.8)) return;
      if (this.toContainer(e, c, d.at)) {
        g.sfx('drop_soft', this.worldPos(c), { vol: 0.5 });
        g.events.emit('item:put', { player: pl.id, item: e.id, into: c.id });
      }
    });
    g.onIntent('item.take', (pl, d: { from: number }) => {
      const c = g.state.get(d.from);
      if (!c || !near(pl, c, 3.8) || this.isOverloaded(pl)) return;
      const kids = this.contents(c);
      const top = kids[kids.length - 1];
      if (top && this.putInInventory(pl, top)) {
        g.sfx('pickup', pl.p, { vol: 0.6 });
        g.events.emit('item:picked', { player: pl.id, item: top.id, from: c.id });
      }
    });
  }

  /** World position of an item (follows holder / container visuals on this peer). */
  worldPos(e: Ent): THREE.Vector3 | null {
    const obj = this.game.views.objectOf(e.id);
    if (obj && obj.parent) return obj.getWorldPosition(new THREE.Vector3());
    if (e.holder != null) return this.game.posOf(e.holder)?.add(new THREE.Vector3(0, 1.1, 0)) ?? null;
    if (e.in != null) { const c = this.game.state.get(e.in); return c ? this.worldPos(c) : null; }
    return e.p ? new THREE.Vector3(e.p[0], e.p[1], e.p[2]) : null;
  }

  // ------------------------------------------------------------------ visuals

  /** View factory for item entities (registered by the WorldScene). */
  makeView = (e: Ent) => {
    const def = this.defOf(e);
    if (!def) return null;
    const game = this.game;
    const holder = new THREE.Group();
    holder.name = 'item:' + e.k;
    let vis: THREE.Object3D;
    try { vis = def.build(e, game); } catch (err) { console.error('[items] build', e.k, err); vis = new THREE.Group(); }
    vis.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    holder.add(vis);
    holder.userData.eid = e.id;
    holder.userData.interact = { kind: 'item', eid: e.id };
    if (e.p) holder.position.set(e.p[0], e.p[1], e.p[2]);
    if (e.q) holder.quaternion.set(e.q[0], e.q[1], e.q[2], e.q[3]);
    let lastData = '';
    let wob = new THREE.Vector2();
    let wobV = new THREE.Vector2();
    let lastParent: THREE.Object3D | null = null;
    let state: 'free' | 'held' | 'in' | 'vm' = 'free';
    game.interact?.register(holder);
    return {
      object: holder,
      update: (e: Ent, dt: number) => {
        const js = JSON.stringify(e.data);
        if (js !== lastData) { lastData = js; try { def.refresh?.(vis, e, game); } catch (err) { console.error(err); } }
        def.animate?.(vis, e, dt, game);
        // where should it live?
        let parent: THREE.Object3D | null = null;
        let mode: typeof state = 'free';
        let local: { pos: THREE.Vector3; rot: THREE.Euler; scale: number } | null = null;
        if (e.holder != null) {
          const isMe = e.holder === game.localPlayerId;
          const pl = game.state.get(e.holder);
          if (isMe && pl && game.player?.firstPerson && this.selected(pl)?.id === e.id) {
            parent = this.viewModel; mode = 'vm';
            const hp = def.hold?.pos ?? [0, 0, 0];
            const hr = def.hold?.rot ?? [0, -0.5, 0];
            local = { pos: new THREE.Vector3(hp[0], hp[1], hp[2]), rot: new THREE.Euler(hr[0], hr[1], hr[2]), scale: def.hold?.scale ?? 1 };
          } else {
            const rig: CharacterRig | undefined = (game.views.of(e.holder).find((v: any) => v.rig) as any)?.rig;
            const slotInfo = rig ? this.carrySpot(pl!, e) : null;
            if (rig && slotInfo) {
              parent = rig.attach(slotInfo.point); mode = 'held';
              local = { pos: slotInfo.offset, rot: slotInfo.rot, scale: 1 };
              holder.visible = !(isMe && game.player?.firstPerson);
            }
          }
        } else if (e.in != null) {
          const cobj = game.views.objectOf(e.in);
          const c = game.state.get(e.in);
          if (cobj && c) {
            parent = (cobj.getObjectByName('contents') as THREE.Object3D) ?? cobj; mode = 'in';
            local = { pos: this.containerSpot(c, e), rot: new THREE.Euler(0, e.at?.[3] ?? (e.id * 1.7) % 6.28, 0), scale: 1 };
          }
        }
        if (mode !== 'held') holder.visible = true;
        if (parent && local) {
          if (lastParent !== parent) { parent.add(holder); lastParent = parent; if (mode === 'vm') this.vmSwitch = 0; }
          const k = mode === 'vm' ? 1 : damp(18, dt);
          holder.position.lerp(local.pos, k);
          // wobble when carried
          if (mode === 'held') {
            wobV.x += (-wob.x * 60 - wobV.x * 6) * dt + (Math.random() - 0.5) * 0.4 * dt * (game.views.of(e.holder)[0] ? 1 : 0);
            wobV.y += (-wob.y * 60 - wobV.y * 6) * dt;
            wob.addScaledVector(wobV, dt);
          } else { wob.set(0, 0); wobV.set(0, 0); }
          const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(local.rot.x + wob.x, local.rot.y, local.rot.z + wob.y));
          holder.quaternion.slerp(target, k);
          holder.scale.setScalar(local.scale);
        } else {
          if (lastParent !== game.views.root) { game.views.root.add(holder); lastParent = game.views.root; holder.scale.setScalar(1); if (e.p) holder.position.set(e.p[0], e.p[1], e.p[2]); }
          followEnt(holder, e, dt, 20);
        }
        state = mode;
      },
      dispose: () => {
        game.interact?.unregister(holder);
        holder.traverse((o: any) => { o.geometry?.dispose?.(); });
      },
    };
  };

  /** Where on the body a carried item sits (by inventory order & carry style). */
  carrySpot(pl: Ent, e: Ent): { point: AttachPoint; offset: THREE.Vector3; rot: THREE.Euler } {
    const items = this.carried(pl);
    const order: AttachPoint[] = [];
    const used = new Map<AttachPoint, number>();
    let result: { point: AttachPoint; offset: THREE.Vector3; rot: THREE.Euler } | null = null;
    const hasTwo = items.some((it) => this.defOf(it)?.carry === 'twohand');
    for (const it of items) {
      const st = this.defOf(it)?.carry ?? 'hand';
      let chain: AttachPoint[];
      switch (st) {
        case 'twohand': chain = ['chest', 'head', 'back']; break;
        case 'head': chain = ['head', 'back', 'arm_l', 'arm_r']; break;
        case 'back': chain = ['back', 'head', 'arm_l']; break;
        case 'mouth': chain = ['mouth', 'arm_r', 'arm_l', 'head']; break;
        case 'underarm': chain = ['arm_l', 'arm_r', 'back', 'head']; break;
        default: chain = hasTwo ? ['arm_r', 'arm_l', 'head', 'back', 'mouth'] : ['hand_r', 'hand_l', 'arm_r', 'arm_l', 'head', 'back', 'mouth'];
      }
      let pt = chain.find((c) => !used.has(c)) ?? chain[0];
      const n = used.get(pt) ?? 0;
      used.set(pt, n + 1);
      order.push(pt);
      if (it.id === e.id) {
        // stack repeated spots upward
        const off = new THREE.Vector3(0, n * 0.14, 0);
        const rot = new THREE.Euler(0, 0, 0);
        if (pt === 'head') off.y += 0.02;
        if (pt === 'back') rot.set(0.2, Math.PI, 0);
        if (pt === 'arm_l' || pt === 'arm_r') rot.set(0, 0, pt === 'arm_l' ? 0.6 : -0.6);
        if (pt === 'mouth') rot.set(0, Math.PI / 2, 0);
        result = { point: pt, offset: off, rot };
      }
    }
    return result ?? { point: 'hand_r', offset: new THREE.Vector3(), rot: new THREE.Euler() };
  }

  /** Carry pose for a player's rig from their inventory. */
  carryPose(pl: Ent): CarryPose {
    const pose: CarryPose = { r: false, l: false, two: false, head: false, load: 0 };
    for (const it of this.carried(pl)) {
      const s = this.carrySpot(pl, it).point;
      if (s === 'hand_r') pose.r = true;
      if (s === 'hand_l') pose.l = true;
      if (s === 'chest') pose.two = true;
      if (s === 'head') pose.head = true;
    }
    pose.load = clamp((SLOT_COUNT - this.freeSlots(pl)) / SLOT_COUNT * 0.6 + this.weight(pl) * 0.03, 0, 1);
    return pose;
  }

  private containerSpot(c: Ent, e: Ent): THREE.Vector3 {
    if (e.at) return new THREE.Vector3(e.at[0], e.at[1], e.at[2]);
    const cdef = this.defOf(c)?.container;
    const kids = this.contents(c);
    const i = Math.max(0, kids.findIndex((k) => k.id === e.id));
    if (cdef?.spots?.[i]) { const s = cdef.spots[i]; return new THREE.Vector3(s[0], s[1], s[2]); }
    if (cdef?.layout === 'stack') return new THREE.Vector3(0, 0.02 + i * 0.03, 0);
    if (cdef?.layout === 'row') return new THREE.Vector3((i - (kids.length - 1) / 2) * 0.12, 0.02, 0);
    const a = i * 2.39996;
    const r = 0.04 + Math.sqrt(i) * 0.05;
    return new THREE.Vector3(Math.cos(a) * r, 0.03 + Math.floor(i / 6) * 0.05, Math.sin(a) * r);
  }

  /** Per-frame local viewmodel motion (bob/sway/switch). Called by the player controller. */
  updateViewModel(dt: number, moveSpeed: number, lookDX: number, lookDY: number) {
    const vm = this.viewModel;
    this.vmSwitch = Math.min(1, this.vmSwitch + dt * 5);
    this.vmBob += dt * (moveSpeed > 0.2 ? 7.5 + moveSpeed : 1.5);
    const bobAmp = moveSpeed > 0.2 ? 0.012 : 0.004;
    const sw = (1 - this.vmSwitch) ** 2;
    vm.position.set(0.3 + Math.cos(this.vmBob * 0.5) * bobAmp - lookDX * 0.0006, -0.3 + Math.abs(Math.sin(this.vmBob)) * bobAmp - sw * 0.35 + lookDY * 0.0004, -0.55);
    vm.rotation.set(-lookDY * 0.0008, -lookDX * 0.0008, 0);
  }
}

function shapeHalfHeight(s: ShapeDesc) {
  switch (s.type) {
    case 'box': return s.size[1] / 2;
    case 'cyl': return s.h / 2;
    case 'ball': return s.r;
    case 'capsule': return s.h / 2;
  }
}
