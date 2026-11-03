import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { G, groups } from '../../sim/physics';
import { footprintOf, type Footprint } from './catalog';

/* =============================================================================================
 * BUILD — placement maths shared by the client preview and the host validation:
 * oriented footprint boxes, overlap (SAT in xz + y range), clearance against the static world (Rapier shape
 * query), floor support (corner rays), wall / ceiling mounting.
 * ============================================================================================= */

export interface OBB { cx: number; cz: number; hx: number; hz: number; c: number; s: number; y0: number; y1: number }

export function yawOfQ(q?: number[] | null) { return q ? 2 * Math.atan2(q[1], q[3]) : 0; }

export function obb(size: [number, number, number], p: ArrayLike<number>, yaw: number, shrink = 0): OBB {
  return { cx: p[0], cz: p[2], hx: Math.max(0.01, size[0] / 2 - shrink), hz: Math.max(0.01, size[2] / 2 - shrink), c: Math.cos(yaw), s: Math.sin(yaw), y0: p[1] + shrink, y1: p[1] + size[1] - shrink };
}

/** separating-axis test of two yawed rectangles + vertical overlap */
export function overlap(a: OBB, b: OBB): boolean {
  if (a.y1 <= b.y0 || b.y1 <= a.y0) return false;
  const dx = b.cx - a.cx, dz = b.cz - a.cz;
  // axes: a.x, a.z, b.x, b.z (x axis = (c, -s), z axis = (s, c) for a three.js yaw)
  const axes = [[a.c, -a.s], [a.s, a.c], [b.c, -b.s], [b.s, b.c]];
  for (const [ax, az] of axes) {
    const ra = a.hx * Math.abs(a.c * ax - a.s * az) + a.hz * Math.abs(a.s * ax + a.c * az);
    const rb = b.hx * Math.abs(b.c * ax - b.s * az) + b.hz * Math.abs(b.s * ax + b.c * az);
    if (Math.abs(dx * ax + dz * az) > ra + rb) return false;
  }
  return true;
}

/** world corners of a footprint (xz) */
export function corners(f: OBB): [number, number][] {
  const out: [number, number][] = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const lx = sx * f.hx, lz = sz * f.hz;
    out.push([f.cx + lx * f.c + lz * f.s, f.cz - lx * f.s + lz * f.c]);
  }
  return out;
}

/** placed furniture that blocks (everything with a footprint lying free in the world, shop displays included) */
export function blockers(game: Game, exclude?: number): { e: Ent; f: Footprint; box: OBB }[] {
  const out: { e: Ent; f: Footprint; box: OBB }[] = [];
  for (const e of game.state.all('item')) {
    if (e.id === exclude || e.holder != null || e.in != null || !e.p) continue;
    const f = footprintOf(e.k);
    if (!f) continue;
    out.push({ e, f, box: obb(f.size, e.p, yawOfQ(e.q), 0.015) });
  }
  return out;
}

export type Why = null | 'blocked' | 'wall' | 'floor' | 'far' | 'mount' | 'unpaid';
export const WHY_TEXT: Record<Exclude<Why, null>, { th: string; en: string }> = {
  blocked: { th: 'ชนของ', en: 'overlaps something' },
  wall: { th: 'ติดผนัง/ของแข็ง', en: 'blocked by the building' },
  floor: { th: 'พื้นไม่เรียบ', en: 'not on level ground' },
  far: { th: 'ไกลเกินไป', en: 'too far' },
  mount: { th: 'ต้องติดผนัง/เพดาน', en: 'needs a wall / ceiling' },
  unpaid: { th: 'จ่ายเงินก่อน!', en: 'pay for it first!' },
};

const _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _o = new THREE.Vector3(), _d = new THREE.Vector3(0, -1, 0);

/** Can `kind` stand at p (bottom centre) facing yaw? Returns null when fine, else the reason. */
export function check(game: Game, kind: string, p: ArrayLike<number>, yaw: number, opts: { exclude?: number; mountOk?: boolean } = {}): Why {
  const f = footprintOf(kind);
  if (!f) return 'blocked';
  if (opts.mountOk === false) return 'mount';
  const mine = obb(f.size, p, yaw, 0.02);
  for (const b of blockers(game, opts.exclude)) {
    // table-top pieces may stand ON counters / tables / shelves (they are above them)
    if (f.mount === 'top' && Math.abs(b.box.y1 - p[1]) < 0.06) continue;
    if (overlap(mine, b.box)) return 'blocked';
  }
  const phys = game.physics;
  if (phys) {
    const [w, h, d] = f.size;
    const hy = Math.max(0.02, h / 2 - 0.05);
    const probe = new phys.R.Cuboid(Math.max(0.02, w / 2 - 0.035), hy, Math.max(0.02, d / 2 - 0.035));
    _q.setFromAxisAngle(_up, yaw);
    if (phys.world.intersectionWithShape({ x: p[0], y: p[1] + h / 2 + 0.01, z: p[2] }, { x: _q.x, y: _q.y, z: _q.z, w: _q.w }, probe, undefined, groups(G.ALL, G.STATIC))) return 'wall';
    // floor support: corners + centre must touch ground at the same height (no hanging over kerbs / stairs)
    if (f.mount === 'floor') {
      const pts = [...corners(obb(f.size, p, yaw, 0.04)), [p[0], p[2]] as [number, number]];
      for (const [x, z] of pts) {
        const hit = phys.raycast(_o.set(x, p[1] + 0.35, z), _d, 0.6, G.STATIC);
        if (!hit || Math.abs(hit.point.y - p[1]) > 0.06 || hit.normal.y < 0.85) return 'floor';
      }
    }
  }
  return null;
}

/** Floor height directly under a point (static world), or null. */
export function floorAt(game: Game, x: number, y: number, z: number): number | null {
  const hit = game.physics?.raycast(_o.set(x, y + 0.4, z), _d, 1.2, G.STATIC);
  return hit && hit.normal.y > 0.85 ? hit.point.y : null;
}

/** Ceiling height above a point (static world), or null. */
export function ceilingAt(game: Game, x: number, y: number, z: number): number | null {
  const hit = game.physics?.raycast(_o.set(x, y + 0.3, z), _up, 4.5, G.STATIC);
  return hit && hit.normal.y < -0.6 ? hit.point.y : null;
}
