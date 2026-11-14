import * as THREE from 'three';
import type { Ent, State } from '../sim/state';
import type { Game } from './game';

/**
 * Views = visuals for entities. Register a factory per entity type; the manager creates a view
 * when an entity spawns (while the world scene is active), calls update() every frame and
 * disposes on despawn. Views READ entity state; they never mutate replicated fields.
 */
export interface View {
  /** Added to the world root automatically unless you parent it yourself. */
  object?: THREE.Object3D;
  update?(e: Ent, dt: number): void;
  dispose?(): void;
}
export type ViewFactory = (e: Ent, game: Game) => View | null | undefined;

export class ViewManager {
  readonly root = new THREE.Group();
  private factories = new Map<string, ViewFactory[]>();
  private views = new Map<number, View[]>();
  active = false;

  constructor(private game: Game, private state: State) {
    this.root.name = 'entity-views';
    state.spawned.add((e) => { if (this.active) this.create(e); });
    state.despawned.add((e) => this.destroy(e.id));
  }

  register(type: string, f: ViewFactory) {
    let a = this.factories.get(type);
    if (!a) this.factories.set(type, (a = []));
    a.push(f);
    if (this.active) this.state.each(type, (e) => this.createOne(e, f));
  }

  private createOne(e: Ent, f: ViewFactory) {
    let v: View | null | undefined = null;
    try { v = f(e, this.game); } catch (err) { console.error(`[view ${e.t}#${e.id}]`, err); }
    if (!v) return;
    if (v.object && !v.object.parent) this.root.add(v.object);
    if (v.object) v.object.userData.eid ??= e.id;
    let a = this.views.get(e.id);
    if (!a) this.views.set(e.id, (a = []));
    a.push(v);
  }

  private create(e: Ent) {
    const fs = this.factories.get(e.t);
    if (fs) for (const f of fs) this.createOne(e, f);
  }

  private destroy(id: number) {
    const a = this.views.get(id);
    if (!a) return;
    for (const v of a) {
      try { v.dispose?.(); } catch (err) { console.error(err); }
      v.object?.removeFromParent();
    }
    this.views.delete(id);
  }

  /** All views of an entity (first is usually the main visual). */
  of(id: number): View[] { return this.views.get(id) ?? []; }
  /** Main Object3D of an entity's first view. */
  objectOf(id: number | null | undefined): THREE.Object3D | null {
    if (id === null || id === undefined) return null;
    const a = this.views.get(id);
    return a?.find((v) => v.object)?.object ?? null;
  }

  activate(scene: THREE.Scene) {
    scene.add(this.root);
    this.active = true;
    for (const e of this.state.ents.values()) if (!this.views.has(e.id)) this.create(e);
  }

  deactivate() {
    this.active = false;
    for (const id of [...this.views.keys()]) this.destroy(id);
    this.root.removeFromParent();
  }

  /** per-entity accumulated time for distance-throttled views */
  private acc = new Map<number, number>();
  private frameN = 0;

  /**
   * Distance LOD: views farther than 40 m from the camera update every 3rd frame, beyond 90 m every 6th
   * (with the skipped time accumulated, so animation/smoothing stays correct). The local player, held items and
   * anything without a positioned object always update every frame. ?viewlod=0 disables it.
   */
  update(dt: number) {
    if (!this.active) return;
    this.frameN++;
    const cam = this.game.camera;
    const lod = this.lodOn;
    if (lod && cam) cam.getWorldPosition(_cp);
    const me = this.game.localPlayerId;
    for (const [id, a] of this.views) {
      const e = this.state.get(id);
      if (!e) continue;
      let step = dt;
      if (lod && cam && id !== me && e.holder == null && e.p) {
        const dx = e.p[0] - _cp.x, dz = e.p[2] - _cp.z, d2 = dx * dx + dz * dz;
        const every = d2 > 8100 ? 6 : d2 > 1600 ? 3 : 1;
        if (every > 1) {
          const t = (this.acc.get(id) ?? 0) + dt;
          if ((this.frameN + id) % every !== 0) { this.acc.set(id, t); continue; }
          this.acc.set(id, 0);
          step = Math.min(t, 0.25);
        } else if (this.acc.has(id)) { step = Math.min(dt + this.acc.get(id)!, 0.25); this.acc.delete(id); }
      }
      for (const v of a) {
        if (!v.update) continue;
        try { v.update(e, step); } catch (err) { console.error(`[view update ${e.t}#${id}]`, err); }
      }
    }
  }
  private lodOn = new URLSearchParams(location.search).get('viewlod') !== '0';
}

const _cp = new THREE.Vector3();

/** Smoothly move an object toward an entity's replicated transform. */
const _q = new THREE.Quaternion();
export function followEnt(obj: THREE.Object3D, e: Ent, dt: number, rate = 14, snap = false) {
  const k = snap ? 1 : 1 - Math.exp(-rate * dt);
  if (e.p) {
    if (snap || obj.position.distanceToSquared(new THREE.Vector3(e.p[0], e.p[1], e.p[2])) > 25) obj.position.set(e.p[0], e.p[1], e.p[2]);
    else obj.position.lerp(new THREE.Vector3(e.p[0], e.p[1], e.p[2]), k);
  }
  if (e.q) { _q.set(e.q[0], e.q[1], e.q[2], e.q[3]); obj.quaternion.slerp(_q, k); }
  else if (e.yaw !== undefined) {
    let cur = obj.rotation.y;
    let d = (e.yaw - cur) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    obj.rotation.set(0, cur + d * k, 0);
  }
}
