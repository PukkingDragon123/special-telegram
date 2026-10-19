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

  update(dt: number) {
    if (!this.active) return;
    for (const [id, a] of this.views) {
      const e = this.state.get(id);
      if (!e) continue;
      for (const v of a) {
        if (!v.update) continue;
        try { v.update(e, dt); } catch (err) { console.error(`[view update ${e.t}#${id}]`, err); }
      }
    }
  }
}

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
