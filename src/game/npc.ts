import * as THREE from 'three';
import type { Game } from './game';
import type { Ent } from '../sim/state';
import { angleDiff, damp, round } from '../core/util';
import { yawTo } from './mapplan';

/**
 * HOST helper that walks NPC-like entities (anything with p/yaw: 'npc', 'dog', 'cat', 'ghost')
 * along nav paths with simple separation. Views animate locomotion from the replicated motion.
 *
 *   game.npcs.go(e, target, { speed: 1.3, onArrive: () => … })
 *
 * Path/runtime data lives in `_`-prefixed (local-only) fields, so nothing extra is replicated.
 */
export interface GoOpts { speed?: number; onArrive?: () => void; face?: number; avoidRoads?: boolean; direct?: boolean; radius?: number }

export class NpcMover {
  private moving = new Set<Ent>();
  constructor(private game: Game) {
    game.on('host:update', (dt: number) => this.update(dt));
  }

  go(e: Ent, to: ArrayLike<number> | THREE.Vector3, o: GoOpts = {}) {
    const target = (to as any).isVector3 ? (to as THREE.Vector3).clone() : new THREE.Vector3(to[0], to[1] ?? 0, to[2]);
    const from = new THREE.Vector3(e.p![0], e.p![1], e.p![2]);
    const path = o.direct || !this.game.world ? [target] : this.game.world.nav.path(from, target, { avoidRoads: o.avoidRoads });
    if (!path.length || path[path.length - 1].distanceTo(target) > 0.3) path.push(target);
    e._path = path;
    e._speed = o.speed ?? 1.3;
    e._onArrive = o.onArrive;
    e._face = o.face;
    e._radius = o.radius ?? 0.35;
    this.moving.add(e);
  }

  stop(e: Ent) { this.moving.delete(e); e._path = null; }
  isMoving(e: Ent) { return this.moving.has(e); }

  /** Turn to face a point (host). */
  faceTo(e: Ent, p: ArrayLike<number>) {
    if (!e.p) return;
    e.yaw = round(yawTo(p[0] - e.p[0], p[2] - e.p[2]), 3);
  }

  private update(dt: number) {
    const all = [...this.moving];
    const others = [...this.game.state.all('npc'), ...this.game.state.all('player')];
    for (const e of all) {
      if (!this.game.state.get(e.id)) { this.moving.delete(e); continue; }
      const path: THREE.Vector3[] = e._path;
      if (!path?.length || !e.p) { this.moving.delete(e); continue; }
      const p = new THREE.Vector3(e.p[0], e.p[1], e.p[2]);
      const tgt = path[0];
      const to = new THREE.Vector3(tgt.x - p.x, 0, tgt.z - p.z);
      const d = to.length();
      const last = path.length === 1;
      if (d < (last ? 0.12 : 0.45)) {
        path.shift();
        if (!path.length) {
          this.moving.delete(e);
          if (e._face !== undefined) e.yaw = e._face;
          const cb = e._onArrive;
          e._onArrive = null;
          cb?.();
        }
        continue;
      }
      to.normalize();
      // separation from nearby people
      const sep = new THREE.Vector3();
      for (const o of others) {
        if (o === e || !o.p) continue;
        const dx = p.x - o.p[0], dz = p.z - o.p[2];
        const dd = dx * dx + dz * dz;
        if (dd < 0.7 && dd > 1e-4) sep.add(new THREE.Vector3(dx, 0, dz).multiplyScalar((0.7 - dd) / dd * 0.25));
      }
      const dir = to.add(sep.clampLength(0, 0.8)).normalize();
      const sp = Math.min(e._speed, d / dt);
      p.addScaledVector(dir, sp * dt);
      const gy = this.game.world?.groundY(p.x, p.z) ?? p.y;
      p.y += (gy - p.y) * damp(12, dt);
      e.p = [round(p.x, 3), round(p.y, 3), round(p.z, 3)];
      const want = yawTo(dir.x, dir.z);
      e.yaw = round((e.yaw ?? 0) + angleDiff(e.yaw ?? 0, want) * damp(8, dt), 3);
    }
  }
}
